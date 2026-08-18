/**
 * PropBuilder — themed roadside props for both maps (08-phase-6-vfx-audio-polish.md T12/T13).
 *
 * Pure data in (`track.propCatalog`), meshes out. Each prop KIND is built ONCE as a merged
 * source mesh (multi-part kinds are combined via `Mesh.MergeMeshes(..., multiMultiMaterials:
 * true)`, which bakes each part's world transform into the vertex data and keeps one sub-mesh
 * per material). Every placed prop is then a single InstancedMesh → low draw calls.
 *
 * Density scales with the active quality preset (`propDensity`): `floor(count × density)` of
 * the catalog are placed, chosen by a DETERMINISTIC seeded shuffle (FNV-1a of the track id) so
 * Low/Medium/High show consistent subsets — never a different random set per launch.
 *
 * Lagoon extras: geyser particle plumes (continuous, budget-scaled) and torch point lights that
 * exist ONLY at the High preset (re-evaluated on live quality change via QualityManager's
 * onPresetChanged hook; lower presets fall back to emissive-only flames).
 *
 * This file MAY import Babylon (render layer). Placement reuses TrackBuilder.placeAlongSpline +
 * the track HeightField so props sit exactly on the drawn terrain. No gameplay logic here.
 */

import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import { createRng } from "../core/Rng.js";
import type { IQualityProbe } from "../core/GameStateMachine.js";
import type { PropKind, TrackDefinition } from "../data/tracks/shared.js";
import { placeAlongSpline } from "./TrackBuilder.js";
import type { HeightField } from "./TrackElevation.js";
import type { TrackSpline } from "./TrackSpline.js";
import { hash01, type Rgb } from "./terrainShading.js";

/** v9 built-in polyhedron types: 0=tetra, 1=octa, 2=dodeca, 3=icosa. */
const POLY_OCTA = 1;
const POLY_DODECA = 2;
const POLY_ICOSA = 3;

/** Geyser plume tuning (visual only — no gameplay). */
const GEYSER_EMIT_RATE = 40; // × quality budget() at High
const GEYSER_LIFE_SEC = 1.6;
/** Torch point-light settings (High preset only). */
const TORCH_LIGHT_RANGE = 9;
const TORCH_LIGHT_INTENSITY = 0.55;
/** Y offset of the torch flame above ground — matches buildSource's part layout. */
const TORCH_FLAME_Y = 1.55;
/** Rocks are squashed on Y for a boulder silhouette (visual only). */
const ROCK_FLATTEN = 0.6;

export class PropBuilder {
  readonly root: TransformNode;

  private instances: AbstractMesh[] = []; // every placed InstancedMesh (disposed on rebuild/teardown)
  private torchLights: PointLight[] = [];
  private geyserSystems: ParticleSystem[] = [];
  /** Merged source mesh per kind — survives rebuilds, disposed with the builder. Typed Mesh (not AbstractMesh) because we call createInstance() on it. */
  private sources = new Map<PropKind, Mesh | null>();
  /** Shared soft-dot texture for geyser plumes; disposed with the builder. */
  private readonly dotTexture: DynamicTexture;
  /** Clears our onPresetChanged hook on dispose (only if we still own it). */
  private clearQualityHook: (() => void) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly spline: TrackSpline,
    private readonly track: TrackDefinition,
    private readonly field: HeightField,
    /** Opaque quality probe (QualityManager implements IQualityProbe). */
    private readonly quality: IQualityProbe,
    /** Parent node for the props root — pass track.root so props share its dispose + shadow-caster sweep. Defaults to the scene. */
    parent?: TransformNode,
  ) {
    this.root = new TransformNode("props-root", scene);
    if (parent) this.root.parent = parent;
    this.dotTexture = PropBuilder.makeDotTexture(scene);
    // Live quality change (SettingsPanel) → re-place props at the new density and
    // re-evaluate torch lights in place. Rebuild is cheap (tens of instances).
    const cb = (): void => this.rebuild();
    this.quality.onPresetChanged = cb;
    this.clearQualityHook = () => {
      if (this.quality.onPresetChanged === cb) this.quality.onPresetChanged = null;
    };
  }

  /** Build all prop instances for the current quality preset. Idempotent (rebuilds). */
  build(): void {
    this.rebuild();
  }

  /** Re-place every prop at the active density + re-evaluate torch lights / plumes. */
  rebuild(): void {
    // Tear down placed instances + dynamic bits; keep source meshes + dot texture.
    for (const m of this.instances) m.dispose();
    this.instances = [];
    for (const l of this.torchLights) l.dispose();
    this.torchLights = [];
    for (const s of this.geyserSystems) s.dispose(false); // shared dot texture stays alive
    this.geyserSystems = [];

    const byKind = new Map<PropKind, number[]>(); // kind → indices into propCatalog
    this.track.propCatalog.forEach((spawn, i) => {
      const arr = byKind.get(spawn.kind) ?? [];
      arr.push(i);
      byKind.set(spawn.kind, arr);
    });

    for (const [kind, idxs] of byKind) {
      const count = Math.floor(idxs.length * this.quality.propDensity());
      if (count === 0) continue;
      for (const catalogIdx of this.sampleOrder(idxs, count)) {
        const spawn = this.track.propCatalog[catalogIdx];
        this.placeOne(kind, spawn.t, spawn.lateralOffset, spawn.scale ?? 1, spawn.rotationY ?? 0);
      }
    }

    // Torch point lights only at High (re-evaluated on every rebuild).
    if (this.quality.current === "high") {
      for (const pos of this.placedTorchPositions) {
        const light = new PointLight(`torch-light-${pos.x.toFixed(1)}-${pos.z.toFixed(1)}`, pos, this.scene);
        light.diffuse = new Color3(1, 0.6, 0.25);
        light.intensity = TORCH_LIGHT_INTENSITY;
        light.range = TORCH_LIGHT_RANGE;
        this.torchLights.push(light);
      }
    }
    this.placedTorchPositions = [];
  }

  /** World positions of torch flames placed in the current rebuild pass. */
  private placedTorchPositions: Vector3[] = [];

  /** Deterministic stable subset: seeded shuffle (FNV-1a of track id), take `count`. */
  private sampleOrder(idxs: number[], count: number): number[] {
    const rng = createRng(this.trackSeed());
    const pool = idxs.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  /** Stable per-track seed (FNV-1a of the track id) — independent of race setup. */
  private trackSeed(): number {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < this.track.id.length; i++) {
      h ^= this.track.id.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    return h >>> 0;
  }

  /** Place one prop instance of `kind` at arc t / lateral offset. */
  private placeOne(kind: PropKind, t: number, lateralOffset: number, scale: number, rotationY: number): void {
    const source = this.sourceFor(kind);
    if (!source) return;

    const place = placeAlongSpline(this.spline, t, lateralOffset);
    const groundY = this.field.heightAt(place.pos.x, place.pos.z);

    const inst = source.createInstance(`prop-${kind}-${t.toFixed(3)}${lateralOffset}`);
    inst.position.set(place.pos.x, groundY + 0.02, place.pos.z); // tiny lift to avoid z-fight
    inst.rotation.y = rotationY + place.rotationY;
    if (kind === "rock") {
      inst.scaling.set(scale, scale * ROCK_FLATTEN, scale); // squashed boulder silhouette
    } else {
      inst.scaling.setAll(scale);
    }
    this.instances.push(inst);

    if (kind === "torch") {
      this.placedTorchPositions.push(new Vector3(place.pos.x, groundY + TORCH_FLAME_Y, place.pos.z));
    } else if (kind === "geyser") {
      this.startGeyserPlume(new Vector3(place.pos.x, groundY + 0.7, place.pos.z));
    }
  }

  /** Lazily build + cache the merged source mesh for a kind. */
  private sourceFor(kind: PropKind): Mesh | null {
    if (this.sources.has(kind)) return this.sources.get(kind) ?? null;
    const mesh = this.buildSource(kind);
    this.sources.set(kind, mesh);
    return mesh;
  }

  /** Build one merged source mesh for a kind. Parts are positioned FIRST — MergeMeshes bakes each part's world matrix into the vertex data (verified in v9), so the merged geometry is the finished prop standing on y=0. */
  private buildSource(kind: PropKind): Mesh | null {
    const accent = hexToColor3(this.track.theme.accentColor);
    switch (kind) {
      case "tree": // trunk + 3-tier conifer canopy (reads as a real tree, not a cone)
        return this.merge([
          this.part("trunk", () => MeshBuilder.CreateCylinder(`src-tree-trunk`, { height: 1.2, diameter: 0.4 }, this.scene), new Color3(0.42, 0.28, 0.15)),
          this.part("canopyLow", () => MeshBuilder.CreateCylinder(`src-tree-canopy-low`, { height: 1.8, diameterTop: 0, diameterBottom: 2.4 }, this.scene), new Color3(0.16, 0.44, 0.18)),
          this.part("canopyMid", () => MeshBuilder.CreateCylinder(`src-tree-canopy-mid`, { height: 1.5, diameterTop: 0, diameterBottom: 1.9 }, this.scene), new Color3(0.18, 0.5, 0.2)),
          this.part("canopyTop", () => MeshBuilder.CreateCylinder(`src-tree-canopy-top`, { height: 1.2, diameterTop: 0, diameterBottom: 1.3 }, this.scene), new Color3(0.2, 0.55, 0.22)),
        ]);
      case "mushroom": // cylinder stem + sphere cap (red) + white spot spheres
        return this.merge([
          this.part("stem", () => MeshBuilder.CreateCylinder(`src-mush-stem`, { height: 0.7, diameter: 0.4 }, this.scene), new Color3(0.92, 0.88, 0.8)),
          this.part("cap", () => MeshBuilder.CreateSphere(`src-mush-cap`, { diameter: 1.3, segments: 8 }, this.scene), new Color3(0.85, 0.15, 0.12)),
          this.part("spot1", () => MeshBuilder.CreateSphere(`src-mush-spot1`, { diameter: 0.28, segments: 6 }, this.scene), new Color3(0.95, 0.93, 0.88)),
          this.part("spot2", () => MeshBuilder.CreateSphere(`src-mush-spot2`, { diameter: 0.22, segments: 6 }, this.scene), new Color3(0.95, 0.93, 0.88)),
          this.part("spot3", () => MeshBuilder.CreateSphere(`src-mush-spot3`, { diameter: 0.2, segments: 6 }, this.scene), new Color3(0.95, 0.93, 0.88)),
        ]);
      case "sign": // box board on a pole
        return this.merge([
          this.part("pole", () => MeshBuilder.CreateCylinder(`src-sign-pole`, { height: 1.4, diameter: 0.12 }, this.scene), new Color3(0.5, 0.5, 0.5)),
          this.part("board", () => MeshBuilder.CreateBox(`src-sign-board`, { width: 1.1, height: 0.7, depth: 0.08 }, this.scene), accent),
        ]);
      case "flower": // stem + icosahedron bloom
        return this.merge([
          this.part("stem", () => MeshBuilder.CreateCylinder(`src-flower-stem`, { height: 0.5, diameter: 0.06 }, this.scene), new Color3(0.2, 0.5, 0.25)),
          this.part("bloom", () => MeshBuilder.CreatePolyhedron("src-flower-bloom", { type: POLY_ICOSA, size: 0.35, flat: true }, this.scene), new Color3(0.9, 0.4, 0.6)),
        ]);
      case "rock": // flattened dodecahedron, dark stone + vertex mottling
        return this.single(
          MeshBuilder.CreatePolyhedron("src-rock", { type: POLY_DODECA, size: 1.1, flat: true }, this.scene),
          new Color3(0.28, 0.24, 0.26),
          undefined,
          { r: 0.28, g: 0.24, b: 0.26 },
        );
      case "geyser": // tapered cylinder vent base (plume is particles) + vertex mottling
        return this.single(
          MeshBuilder.CreateCylinder("src-geyser", { height: 0.7, diameterTop: 1.0, diameterBottom: 1.5 }, this.scene),
          new Color3(0.35, 0.32, 0.34),
          undefined,
          { r: 0.35, g: 0.32, b: 0.34 },
        );
      case "torch": // pole + emissive flame sphere (point light only at High)
        return this.merge([
          this.part("pole", () => MeshBuilder.CreateCylinder(`src-torch-pole`, { height: 1.4, diameter: 0.16 }, this.scene), new Color3(0.35, 0.25, 0.18)),
          this.part("flame", () => MeshBuilder.CreateSphere(`src-torch-flame`, { diameter: 0.5, segments: 6 }, this.scene), new Color3(1, 0.55, 0.15)),
        ]);
      case "crystal": // emissive octahedron in the track accent color + vertex mottling
        return this.single(
          MeshBuilder.CreatePolyhedron("src-crystal", { type: POLY_OCTA, size: 0.7, flat: true }, this.scene),
          accent,
          new Color3(accent.r * 0.5, accent.g * 0.5, accent.b * 0.5),
          { r: accent.r, g: accent.g, b: accent.b },
        );
      default:
        return null;
    }
  }

  // ── source-mesh helpers ────────────────────────────────────────────────

  /** Single-part source mesh with its own material (optional emissive + vertex mottling). */
  private single(mesh: Mesh, color: Color3, emissive?: Color3, mottleBase?: Rgb): Mesh {
    const mat = new StandardMaterial(`mat-${mesh.name}`, this.scene);
    mat.diffuseColor = color;
    if (emissive) mat.emissiveColor = emissive;
    if (mottleBase) this.bakeMottling(mesh, mottleBase);
    mesh.material = mat;
    this.parkSource(mesh);
    return mesh;
  }

  /**
   * Bake per-vertex mottling (±12% brightness, deterministic hash of local XZ) so
   * flat-shaded polyhedra read as organic stone/crystal instead of a single tone.
   * v9 auto-detects the color buffer (mesh.useVertexColors defaults to true).
   */
  private bakeMottling(mesh: Mesh, base: Rgb): void {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3];
      const z = positions[i * 3 + 2];
      const k = 0.88 + 0.24 * hash01(x * 3.1, z * 3.1);
      colors[i * 3] = base.r * k;
      colors[i * 3 + 1] = base.g * k;
      colors[i * 3 + 2] = base.b * k;
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  }

  /** Create a raw part + assign it its own material (kept per-part via multiMultiMaterials). */
  private part(name: string, make: () => Mesh, color: Color3): [Mesh, Color3] {
    const m = make();
    const mat = new StandardMaterial(`mat-${m.name}`, this.scene);
    mat.diffuseColor = color;
    if (name === "flame") mat.emissiveColor = new Color3(0.9, 0.45, 0.1); // visible even without the point light
    m.material = mat;
    return [m, color];
  }

  /** Merge positioned parts into one source mesh (one sub-mesh per material). */
  private merge(parts: Array<[Mesh, Color3]>): Mesh | null {
    if (parts.length === 0) return null;
    this.layoutParts(parts); // position each part so the finished prop stands on y=0
    const merged = Mesh.MergeMeshes(
      parts.map(([m]) => m),
      true, // disposeSource — the raw parts are consumed into the merged geometry
      false,
      undefined,
      false,
      true, // multiMultiMaterials — keep one sub-mesh per part material
    );
    if (!merged) return null;
    this.parkSource(merged);
    return merged;
  }

  /** Stack the parts of a multi-part prop so its base sits at y=0 (builders are centered). */
  private layoutParts(parts: Array<[Mesh, Color3]>): void {
    const names = new Set(parts.map(([m]) => m.name));
    if (names.has("trunk") && names.has("canopyLow")) {
      // 3-tier conifer: tiers overlap so the silhouette is a layered cone.
      this.setY(parts, "trunk", 0.6); // cylinder height 1.2 / 2
      this.setY(parts, "canopyLow", 1.2 + 0.9); // trunk top + low tier half-height (1.8 / 2)
      this.setY(parts, "canopyMid", 1.2 + 1.6 + 0.75); // low tier top + mid half (1.5 / 2)
      this.setY(parts, "canopyTop", 1.2 + 2.3 + 0.6); // mid tier top + top half (1.2 / 2)
    } else if (names.has("stem") && names.has("cap")) {
      this.setY(parts, "stem", 0.35); // cylinder height 0.7 / 2
      this.setY(parts, "cap", 1.05); // overlaps the stem top so there's no gap
      // White spots sit on the upper hemisphere of the cap (cap center y=1.05, r=0.65).
      this.setPos(parts, "spot1", 0.3, 1.5, 0.15);
      this.setPos(parts, "spot2", -0.25, 1.45, -0.2);
      this.setPos(parts, "spot3", 0.05, 1.62, -0.25);
    } else if (names.has("stem") && names.has("bloom")) {
      this.setY(parts, "stem", 0.25); // cylinder height 0.5 / 2
      this.setY(parts, "bloom", 0.55); // bloom just above the stem top
    } else if (names.has("pole") && names.has("board")) {
      this.setY(parts, "pole", 0.7); // cylinder height 1.4 / 2
      this.setY(parts, "board", 1.2); // near the pole top
    } else if (names.has("pole") && names.has("flame")) {
      this.setY(parts, "pole", 0.7); // cylinder height 1.4 / 2
      this.setY(parts, "flame", TORCH_FLAME_Y); // just above the pole top
    }
  }

  private setY(parts: Array<[Mesh, Color3]>, name: string, y: number): void {
    for (const [m] of parts) if (m.name === name) m.position.y = y;
  }

  private setPos(parts: Array<[Mesh, Color3]>, name: string, x: number, y: number, z: number): void {
    for (const [m] of parts) if (m.name === name) m.position.set(x, y, z);
  }

  /** Park a source mesh under root, far below the terrain. Instances keep their OWN transforms and visibility — only the (invisible) source geometry is hidden this way. */
  private parkSource(mesh: Mesh): void {
    mesh.parent = this.root;
    mesh.position.y = -1000;
  }

  /** Continuous geyser plume (budget-scaled). Emitter is a static world-space Vector3. */
  private startGeyserPlume(pos: Vector3): void {
    const budget = this.quality.budget();
    const rate = Math.max(4, Math.round(GEYSER_EMIT_RATE * budget));
    const sys = new ParticleSystem(`geyser-${pos.x.toFixed(1)}-${pos.z.toFixed(1)}`, rate, this.scene);
    sys.emitter = pos.clone();
    sys.direction1 = new Vector3(-0.25, 1, -0.25);
    sys.direction2 = new Vector3(0.25, 1.4, 0.25);
    sys.minEmitPower = 2.5;
    sys.maxEmitPower = 4.5;
    const box = 0.3;
    sys.minEmitBox = new Vector3(-box, 0, -box);
    sys.maxEmitBox = new Vector3(box, 0.2, box);
    sys.minLifeTime = GEYSER_LIFE_SEC * 0.7;
    sys.maxLifeTime = GEYSER_LIFE_SEC;
    sys.minSize = 0.4;
    sys.maxSize = 1.1;
    sys.color1 = new Color4(1, 0.85, 0.5, 0.9);
    sys.color2 = new Color4(1, 0.6, 0.3, 0.7);
    sys.colorDead = new Color4(0.8, 0.5, 0.3, 0);
    sys.blendMode = ParticleSystem.BLENDMODE_ADD;
    sys.gravity = new Vector3(0, -1.5, 0);
    sys.particleTexture = this.dotTexture;
    sys.start();
    this.geyserSystems.push(sys);
  }

  /** Full teardown (scene exit): instances, lights, plumes, sources, dot texture. */
  dispose(): void {
    if (this.clearQualityHook) {
      this.clearQualityHook();
      this.clearQualityHook = null;
    }
    for (const m of this.instances) m.dispose();
    this.instances = [];
    for (const l of this.torchLights) l.dispose();
    this.torchLights = [];
    for (const s of this.geyserSystems) s.dispose(false);
    this.geyserSystems = [];
    // Source meshes are children of root → disposed with it.
    this.root.dispose(true);
    this.dotTexture.dispose();
  }

  /** Soft radial dot texture shared by geyser plumes (mirrors ParticleFactory's). */
  private static makeDotTexture(scene: Scene): DynamicTexture {
    const size = 64;
    const tex = new DynamicTexture("prop-dot", { width: size, height: size }, scene, false);
    const ctx = tex.getContext();
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    tex.update();
    return tex;
  }
}

function hexToColor3(hex: string): Color3 {
  const n = parseInt(hex.slice(1), 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
