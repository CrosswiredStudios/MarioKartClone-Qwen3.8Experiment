/**
 * Builds the drivable world from a TrackDefinition (Babylon side of Phase 3).
 *
 * Pure data in, meshes out: road ribbon + procedural lane texture, edge barriers,
 * ground plane, and item-box anchor TransformNodes. Everything is parented under a
 * single root node so FreeDriveScene can dispose the whole track at once.
 *
 * This file MAY import Babylon — it is the render layer. The spline math itself
 * (TrackSpline) stays pure and headless-testable.
 */

import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { TUNING } from "../data/tuning.js";
import type { TrackDefinition } from "../data/tracks/shared.js";
import { makeHeightField, type HeightField } from "./TrackElevation.js";
import type { TrackSpline } from "./TrackSpline.js";

/** Number of ribbon rings around the loop (≈400 per plan). */
const ROAD_SAMPLES = 400;
/** Barriers are placed every ~this many meters of arc length, on both edges. */
const BARRIER_ARC_SPACING = 4;

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
    this.buildBarriers();
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
    const mat = new StandardMaterial("ground-mat", this.scene);
    mat.diffuseColor = hexToColor3(this.track.theme.groundColor);
    mat.specularColor = Color3.Black();
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
    }

    const road = MeshBuilder.CreateRibbon("track-road", { pathArray: [left, right] }, this.scene);
    road.material = this.buildRoadMaterial();
    road.parent = this.root;

    // Phase 6: beside each widthOverride span the off-road surface is a VOID — a dark
    // plane sits bridgeVoidDropM below road level so falling off reads as a cliff drop.
    this.buildBridgeVoids();
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

  private buildRoadMaterial(): StandardMaterial {
    const mat = new StandardMaterial("road-mat", this.scene);
    // Procedural asphalt + lane markings. The texture repeats along the loop via UV v.
    const tex = new DynamicTexture("road-tex", { width: 128, height: 64 }, this.scene, false);
    drawLaneTexture(tex.getContext(), this.track.theme.accentColor);
    // CRITICAL: push the canvas content to the GPU. Without update() a fresh
    // DynamicTexture is transparent, so a lit material sampling it renders nothing
    // (this was the "invisible road" bug).
    tex.update();
    // CreateRibbon maps v across the whole path; scale it so the lane texture
    // repeats along the loop (same trick as Bousquie's demo: vScale = step count).
    tex.vScale = ROAD_SAMPLES / 4;
    mat.diffuseTexture = tex;
    mat.specularColor = Color3.Black();
    return mat;
  }

  private buildBarriers(): void {
    const count = Math.max(8, Math.floor(this.spline.length / BARRIER_ARC_SPACING));
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const t = i / count;
        // Phase 6: barriers hug the PER-SEGMENT road edge (bridges narrow), and are
        // taller on widthOverride spans so the bridge reads as an enclosed crossing.
        const inSpan = this.spline.inWidthOverrideSpan(t);
        const halfWidth = this.spline.halfWidthAt(t) + 0.4; // just outside the road edge
        const height = 1.1 + (inSpan ? TUNING.vfx.bridgeBarrierExtraHeightM : 0);
        const place = placeAlongSpline(this.spline, t, halfWidth * side);
        const groundY = this.field.heightAt(place.pos.x, place.pos.z);
        const post = MeshBuilder.CreateBox(`barrier-${side}-${i}`, { width: 0.35, height, depth: 0.35 }, this.scene);
        post.position.set(place.pos.x, groundY + height / 2, place.pos.z);
        post.rotation.y = place.rotationY;
        const mat = new StandardMaterial("barrier-mat", this.scene);
        mat.diffuseColor = hexToColor3(this.track.theme.accentColor);
        post.material = mat;
        post.parent = this.root;
      }
    }
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

function hexToColor3(hex: string): Color3 {
  const n = parseInt(hex.slice(1), 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Minimal canvas context surface — matches Babylon's ICanvasRenderingContext. */
interface LaneCtx {
  canvas: { width: number; height: number };
  // string | object accepts both plain colors and ICanvasGradient.
  fillStyle: string | object;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Asphalt base with a dashed center line and solid edge lines. */
function drawLaneTexture(ctx: LaneCtx, accentHex: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  // Asphalt.
  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, w, h);
  // Solid edge lines (left/right).
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(6, 0, 5, h);
  ctx.fillRect(w - 11, 0, 5, h);
  // Dashed center line.
  ctx.fillStyle = accentHex;
  const dashH = h / 2;
  for (let y = 0; y < h; y += dashH * 2) {
    ctx.fillRect(w / 2 - 3, y + dashH * 0.15, 6, dashH * 0.7);
  }
}
