/**
 * Builds the drivable world from a TrackDefinition (Babylon side of Phase 3).
 *
 * Pure data in, meshes out: road ribbon + procedural lane texture,
 * ground plane, and item-box anchor TransformNodes. Everything is parented under a
 * single root node so FreeDriveScene can dispose the whole track at once.
 *
 * This file MAY import Babylon — it is the render layer. The spline math itself
 * (TrackSpline) stays pure and headless-testable.
 */

import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type PBRMaterial,
  type Scene,
} from "@babylonjs/core";
import { TUNING } from "../data/tuning.js";
import { createAsphaltMaterial, createGrassMaterial } from "../rendering/materials.js";
import type { TrackDefinition } from "../data/tracks/shared.js";
import { makeHeightField, type HeightField } from "./TrackElevation.js";
import type { TrackSpline } from "./TrackSpline.js";

/** Number of ribbon rings around the loop (≈400 per plan). */
const ROAD_SAMPLES = 400;

export interface SplinePlacement {
  pos: Vector3; // y = 0
  rotationY: number; // radians, forward aligned with the tangent
}

/**
 * Position + yaw for a point at arc position `t`, offset laterally by
 * `lateralOffset` meters (positive = to the left of travel). Exported so the
 * scene can place karts / item boxes / hazards consistently.
 */
export function placeAlongSpline(spline: TrackSpline, t: number, lateralOffset: number): SplinePlacement {
  const p = spline.pointAt(t);
  const tan = spline.tangentAt(t);
  // Left normal in the XZ plane (rotate tangent +90° about Y).
  const nx = -tan.z;
  const nz = tan.x;
  return {
    pos: new Vector3(p.x + nx * lateralOffset, 0, p.z + nz * lateralOffset),
    rotationY: Math.atan2(tan.x, tan.z),
  };
}

export class TrackBuilder {
  // Created with the scene so it (and its children) live in the render tree.
  readonly root: TransformNode;

  /**
   * The pure heightfield — SINGLE SOURCE OF TRUTH for elevation. Both this
   * render layer and the game logic (kart Y, slope model, skid marks) sample
   * it, so nothing can drift between what is drawn and what is simulated.
   */
  readonly field: HeightField;

  constructor(
    private readonly scene: Scene,
    private readonly spline: TrackSpline,
    private readonly track: TrackDefinition,
  ) {
    this.root = new TransformNode("track-root", this.scene);
    this.field = makeHeightField(spline, track);
  }

  /** Builds all meshes into the scene under this.root. */
  build(): void {
    this.buildGround();
    this.buildRoad();
    this.buildItemBoxAnchors();
  }

  dispose(): void {
    this.root.dispose(true);
  }

  private buildGround(): void {
    const res = TUNING.terrain.gridResolution;
    const b = this.field.bounds;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;

    // Two-pass encode: first sample every vertex height to find the ACTUAL surface
    // min/max (the field's minH/maxH carry generous ±1.5·amp headroom that would waste
    // half the 8-bit range), then normalize to that tight span → full resolution, no
    // clipping. This keeps quantization error small enough that a rounded-up vertex
    // can't poke through the road ribbon (which sits roadYOffset above the field).
    const heights = new Float32Array(res * res);
    let realMin = Infinity;
    let realMax = -Infinity;
    for (let r = 0; r < res; r++) {
      // Buffer row 0 sits on the +z side (maxZ) — Babylon's vertex→buffer map.
      const z = b.maxZ - (r / (res - 1)) * spanZ;
      for (let c = 0; c < res; c++) {
        const x = b.minX + (c / (res - 1)) * spanX;
        const h = this.field.heightAt(x, z);
        heights[r * res + c] = h;
        if (h < realMin) realMin = h;
        if (h > realMax) realMax = h;
      }
    }
    const tightRange = Math.max(1e-6, realMax - realMin);

    // Encode the heightfield into an RGBA buffer: R=G=B=255·normalized height, A=255.
    // With colorFilter (1/3, 1/3, 1/3) Babylon's gradient becomes exactly the normalized
    // height → minHeight + range·gradient = our heightAt value.
    const data = new Uint8Array(res * res * 4);
    for (let i = 0; i < heights.length; i++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, (heights[i] - realMin) / tightRange)));
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }

    const ground = MeshBuilder.CreateGroundFromHeightMap(
      "track-ground",
      { data, width: res, height: res },
      {
        width: spanX,
        height: spanZ,
        subdivisions: res - 1, // one vertex per buffer pixel
        minHeight: realMin,
        maxHeight: realMax,
        colorFilter: new Color3(1 / 3, 1 / 3, 1 / 3),
      },
      this.scene,
    );
    // The heightmap mesh is centered on its position → shift to bounds center.
    ground.position.x = (b.minX + b.maxX) / 2;
    ground.position.z = (b.minZ + b.maxZ) / 2;
    const mat = createGrassMaterial(this.scene, "ground-mat");
    const grassTex = new Texture("textures/grass.jpg", this.scene);
    grassTex.wrapU = Texture.WRAP_ADDRESSMODE;
    grassTex.wrapV = Texture.WRAP_ADDRESSMODE;
    // v9: boolean anisotropicFiltering was removed — level 8 ≈ the old `true` (max AF).
    grassTex.anisotropicFilteringLevel = 8;
    // ~2 m per tile so individual grass blades read at chase-camera distance.
    grassTex.uScale = spanX / 2;
    grassTex.vScale = spanZ / 2;
    mat.albedoTexture = grassTex; // PBR: albedoTexture replaces diffuseTexture
    ground.material = mat;
    ground.parent = this.root;
  }

  private buildRoad(): void {
    // Build the road with MeshBuilder.CreateRibbon — the proven approach from
    // Jerome Bousquie's terrainRoad demo (and far less error-prone than hand-
    // written vertex buffers, which rendered as hairline strips in this build).
    // CreateRibbon generates positions/normals/UVs/indices from path arrays.
    // Phase 6: the half-width is sampled PER RING via spline.halfWidthAt(t) so
    // widthOverride spans (bridges) narrow smoothly — no kink at the edges.
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    // Slab bottom edges: flared outward beyond the road and buried below local terrain,
    // so the asphalt sheet gains real thickness and no ground vertex can poke through.
    const botLeft: Vector3[] = [];
    const botRight: Vector3[] = [];
    for (let i = 0; i <= ROAD_SAMPLES; i++) {
      const t = i / ROAD_SAMPLES; // ring N wraps to ring 0 → closed loop
      const halfWidth = this.spline.halfWidthAt(t);
      const p = this.spline.pointAt(t);
      const tan = this.spline.tangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      const lx = p.x + nx * halfWidth;
      const lz = p.z + nz * halfWidth;
      const rx = p.x - nx * halfWidth;
      const rz = p.z - nz * halfWidth;
      // Road hugs the heightfield (single source of truth) with a small offset
      // so it never z-fights the ground mesh.
      left.push(new Vector3(lx, this.field.heightAt(lx, lz) + TUNING.terrain.roadYOffset, lz));
      right.push(new Vector3(rx, this.field.heightAt(rx, rz) + TUNING.terrain.roadYOffset, rz));

      // Slab bottom edge: same lateral direction as the top edge but pushed out by
      // shoulderFlareM and sunk buryDepthM below the local (quantized) terrain so it
      // always tucks under the ground mesh — no visible seam at the shoulder.
      const flare = TUNING.terrain.shoulderFlareM;
      const blx = p.x + nx * (halfWidth + flare);
      const blz = p.z + nz * (halfWidth + flare);
      const brx = p.x - nx * (halfWidth + flare);
      const brz = p.z - nz * (halfWidth + flare);
      botLeft.push(new Vector3(blx, this.field.heightAt(blx, blz) - TUNING.terrain.buryDepthM, blz));
      botRight.push(new Vector3(brx, this.field.heightAt(brx, brz) - TUNING.terrain.buryDepthM, brz));
    }

    const road = MeshBuilder.CreateRibbon("track-road", { pathArray: [left, right] }, this.scene);
    road.material = this.buildRoadMaterial();
    road.parent = this.root;

    // Slab body beneath the asphalt: left wall + bottom face + right wall. Gives the
    // road thickness and hides any heightmap vertex that would otherwise poke through.
    this.buildRoadSlab(left, botLeft, botRight, right);

    // Phase 6: beside each widthOverride span the off-road surface is a VOID — a dark
    // plane sits bridgeVoidDropM below road level so falling off reads as a cliff drop.
    this.buildBridgeVoids();
  }

  /**
   * Slab body under the asphalt ribbon. One CreateRibbon with four paths
   * [topLeft, botLeft, botRight, topRight] yields exactly three faces — left wall,
   * bottom face, right wall (the top is intentionally omitted; that's the asphalt).
   * Double-sided so walls/underside read correctly from any camera angle regardless of
   * ribbon winding. Dark solid material — no texture, auto UVs are irrelevant.
   */
  private buildRoadSlab(topLeft: Vector3[], botLeft: Vector3[], botRight: Vector3[], topRight: Vector3[]): void {
    const slab = MeshBuilder.CreateRibbon(
      "track-road-slab",
      { pathArray: [topLeft, botLeft, botRight, topRight], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    const mat = new StandardMaterial("road-slab-mat", this.scene);
    // Slightly darker than the asphalt so the shoulder reads as a cut edge.
    mat.diffuseColor = new Color3(0.16, 0.15, 0.17);
    mat.specularColor = Color3.Black();
    slab.material = mat;
    slab.parent = this.root;
  }

  /** Dark void ribbons flanking every widthOverride span, dropped below road level. */
  private buildBridgeVoids(): void {
    const overrides = this.track.widthOverrides ?? [];
    if (overrides.length === 0) return;
    const baseHalf = this.track.roadWidth / 2;
    const drop = TUNING.vfx.bridgeVoidDropM;

    for (const ov of overrides) {
      // Sample the span (plus a hair past each edge so it meets the terrain). Pad is in t units.
      const padT = 0.004;
      const t0 = Math.max(0, ov.tStart - padT);
      const t1 = Math.min(1, ov.tEnd + padT);
      const steps = Math.max(8, Math.ceil((t1 - t0) * ROAD_SAMPLES));

      for (const side of [-1, 1]) {
        const inner: Vector3[] = [];
        const outer: Vector3[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = t0 + ((t1 - t0) * i) / steps;
          const p = this.spline.pointAt(t);
          const tan = this.spline.tangentAt(t);
          const nx = -tan.z;
          const nz = tan.x;
          // Inner edge hugs the narrowed road; outer edge reaches the base half-width
          // (where normal terrain resumes). The ribbon is flat at road level − drop.
          const roadY = this.field.heightAt(p.x, p.z) + TUNING.terrain.roadYOffset - drop;
          const xi = p.x + nx * side * this.spline.halfWidthAt(t);
          const zi = p.z + nz * side * this.spline.halfWidthAt(t);
          const xo = p.x + nx * side * baseHalf;
          const zo = p.z + nz * side * baseHalf;
          inner.push(new Vector3(xi, roadY, zi));
          outer.push(new Vector3(xo, roadY, zo));
        }
        const voidMesh = MeshBuilder.CreateRibbon(`bridge-void-${ov.tStart}-${side}`, { pathArray: [inner, outer] }, this.scene);
        const mat = new StandardMaterial(`bridge-void-mat-${ov.tStart}-${side}`, this.scene);
        mat.diffuseColor = new Color3(0.05, 0.04, 0.08); // near-black abyss
        mat.specularColor = Color3.Black();
        voidMesh.material = mat;
        voidMesh.parent = this.root;
      }
    }
  }

  private buildRoadMaterial(): PBRMaterial {
    const mat = createAsphaltMaterial(this.scene, "road-mat");
    // Procedural asphalt + lane markings + rumble strips. The texture repeats
    // along the loop via UV u (see below).
    const tex = new DynamicTexture("road-tex", { width: 256, height: 128 }, this.scene, false);
    drawLaneTexture(tex.getContext(), this.track.theme.accentColor);
    // CRITICAL: push the canvas content to the GPU. Without update() a fresh
    // DynamicTexture is transparent, so a lit material sampling it renders nothing
    // (this was the "invisible road" bug).
    tex.update();
    // CRITICAL: DynamicTexture defaults to CLAMP addressing — without WRAP, uScale > 1
    // clamps everything past u=1 to the last pixel column instead of tiling.
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    // CreateRibbon maps u ALONG each path (the loop) and v ACROSS the two edge
    // paths (road width). So repeat along u — one tile ≈ trackLength/100 of
    // track — and leave v unscaled so the texture spans the road width once.
    tex.uScale = ROAD_SAMPLES / 4;
    mat.albedoTexture = tex; // PBR: albedoTexture replaces diffuseTexture
    return mat;
  }

  private buildItemBoxAnchors(): void {
    // Phase 5 spawns the actual boxes here; for now just mark cluster anchors.
    this.track.itemBoxClusters.forEach((cluster, i) => {
      const place = placeAlongSpline(this.spline, cluster.t, cluster.lateralOffset ?? 0);
      const groundY = this.field.heightAt(place.pos.x, place.pos.z);
      const anchor = new TransformNode(`itembox-cluster-${i}`, this.scene);
      anchor.position.set(place.pos.x, groundY + 1.2, place.pos.z);
      anchor.rotation.y = place.rotationY;
      anchor.parent = this.root;
    });
  }
}

/** Minimal canvas context surface — matches Babylon's ICanvasRenderingContext. */
interface LaneCtx {
  canvas: { width: number; height: number };
  // string | object accepts both plain colors and ICanvasGradient.
  fillStyle: string | object;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Asphalt with grain, tire-wear bands, rumble strips at the edges, a dashed
 * center line and solid edge lines. 256×128: x (u) repeats along the loop
 * (uScale = ROAD_SAMPLES/4 → one tile ≈ trackLength/100 of track), y (v) spans
 * the road width exactly once — matching CreateRibbon's UV layout, where u is
 * distance ALONG each path and v is ACROSS the two edge paths.
 */
function drawLaneTexture(ctx: LaneCtx, accentHex: string): void {
  const w = ctx.canvas.width; // along the track loop (u)
  const h = ctx.canvas.height; // across the road width (v)
  // Asphalt base.
  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, w, h);
  // Asphalt grain: deterministic speckle (no Math.random — keeps the bake stable).
  for (let i = 0; i < 900; i++) {
    const gx = (i * 73) % w;
    const gy = (i * 151) % h;
    const shade = 40 + ((i * 37) % 30);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
    ctx.fillRect(gx, gy, 2, 2);
  }
  // Tire-wear bands: darker strips where the karts actually drive.
  ctx.fillStyle = "rgba(20,22,26,0.35)";
  ctx.fillRect(0, h * 0.28, w, h * 0.14);
  ctx.fillRect(0, h * 0.58, w, h * 0.14);
  // Rumble strips: red/white blocks at both edges (the iconic kart look).
  const rumbleH = 7;
  const blockW = w / 8;
  for (let x = 0; x < w; x += blockW) {
    const even = Math.floor(x / blockW) % 2 === 0;
    ctx.fillStyle = even ? "#d23b2f" : "#f2f2f2";
    ctx.fillRect(x, 0, blockW, rumbleH);
    ctx.fillRect(x, h - rumbleH, blockW, rumbleH);
  }
  // Solid edge lines just inside the rumble strips.
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(0, rumbleH + 2, w, 3);
  ctx.fillRect(0, h - rumbleH - 5, w, 3);
  // Dashed center line.
  ctx.fillStyle = accentHex;
  const dashW = w / 2;
  for (let x = 0; x < w; x += dashW * 2) {
    ctx.fillRect(x + dashW * 0.15, h / 2 - 3, dashW * 0.7, 6);
  }
}
