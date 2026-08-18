/**
 * SkidMarks — drifting leaves fading tire marks on the road
 * (05-phase-3-track-system.md, Task 6).
 *
 * While `drifting` is true, each frame appends the rear-wheel world position to a
 * capped buffer. The marks render as two thin ribbons (left + right rear wheel) that
 * fade out over SKID_LIFETIME seconds and are dropped once expired. Geometry is
 * REUSED: one Mesh with preallocated vertex/index buffers, updated in place via
 * updateVerticesData/setIndices — no per-frame mesh allocation.
 *
 * AS-BUILT DEVIATION (documented): the doc says "two quads per frame segment"; this
 * renders two thin ribbons (left/right rear wheel), each a quad per segment — i.e.
 * exactly two quads per segment, matching the spec.
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import { MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";

/** Seconds a mark stays visible before fading out completely. */
const SKID_LIFETIME = 2;
/** Max buffered points (≈300 segments). Oldest are dropped beyond this. */
const MAX_POINTS = 301;
/** Half the rear-wheel track width (m) — offsets the two ribbons from centerline. */
const WHEEL_TRACK_HALF = 0.35;
/** Half-width of each ribbon line (m). */
const RIBBON_HALF_WIDTH = 0.06;
/** Offset just above the terrain surface to avoid z-fighting (Phase 4.1: marks follow the heightfield). */
const MARK_Y_OFFSET = 0.03;
/** Fresh mark color (dark rubber) and expired color (blends into asphalt). */
const FRESH: readonly [number, number, number] = [0.08, 0.08, 0.1];
const EXPIRED: readonly [number, number, number] = [0.227, 0.239, 0.259]; // ≈ asphalt #3a3d42

interface SkidPoint {
  x: number;
  y: number; // terrain height at the rear wheel (marks follow the surface)
  z: number;
  birth: number; // seconds (scene clock) when recorded
}

export class SkidMarks {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private points: SkidPoint[] = [];

  // Preallocated, reused every frame (no per-frame allocation).
  private readonly posBuf: Float32Array;
  private readonly colorBuf: Float32Array;

  constructor(scene: Scene) {
    this.material = new StandardMaterial("skid-mat", scene);
    // Diffuse is white so the vertex color IS the mark. We fade by lerping RGB from
    // dark rubber toward asphalt as marks age (StandardMaterial has no per-vertex alpha).
    // Vertex colors are auto-detected from the "color" geometry buffer — no material flag needed.
    this.material.diffuseColor.set(1, 1, 1);
    this.material.specularColor.set(0, 0, 0);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;

    // One quad per ribbon-line per segment → 8 verts, 12 indices per segment.
    const maxSegments = MAX_POINTS - 1;
    this.posBuf = new Float32Array(maxSegments * 8 * 3);
    this.colorBuf = new Float32Array(maxSegments * 8 * 4);

    // Start as a flat, empty ribbon (no vertices drawn until we setIndices).
    const m = MeshBuilder.CreateGround("skid-marks", { width: 1, height: 1 }, scene);
    this.mesh = m;
    this.mesh.material = this.material;
    // Vertices carry absolute world Y (terrain + MARK_Y_OFFSET) — no mesh offset.
    this.mesh.isPickable = false;
    // Empty geometry until the first drift.
    this.mesh.setVerticesData("position", new Float32Array(0));
    this.mesh.setIndices([]);
  }

  /** Record a rear-wheel position while drifting, then rebuild the visible marks. */
  update(rearX: number, rearY: number, rearZ: number, drifting: boolean, nowSeconds: number): void {
    if (drifting) {
      // Avoid stacking duplicate points when barely moving.
      const last = this.points[this.points.length - 1];
      if (!last || Math.hypot(rearX - last.x, rearZ - last.z) > 0.05) {
        this.points.push({ x: rearX, y: rearY, z: rearZ, birth: nowSeconds });
      }
    }

    // Drop expired points (oldest first).
    while (this.points.length && nowSeconds - this.points[0].birth >= SKID_LIFETIME) {
      this.points.shift();
    }
    // Cap the buffer.
    while (this.points.length > MAX_POINTS) this.points.shift();

    this.rebuild(nowSeconds);
  }

  /** Rebuild vertex/index buffers in place from the live point list. */
  private rebuild(nowSeconds: number): void {
    const n = this.points.length;
    if (n < 2) {
      this.mesh.setVerticesData("position", new Float32Array(0));
      this.mesh.setIndices([]);
      return;
    }

    let vCount = 0; // vertex count written so far
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue; // skip degenerate segment
      const px = -dz / len; // perpendicular in XZ
      const pz = dx / len;

      const fadeA = this.fade(a.birth, nowSeconds);
      const fadeB = this.fade(b.birth, nowSeconds);

      // Left ribbon (offset +perp*WHEEL_TRACK_HALF) and right ribbon (-perp).
      vCount += this.appendRibbon(this.posBuf, this.colorBuf, vCount, idx, a.x, a.y, a.z, b.x, b.y, b.z, px, pz, WHEEL_TRACK_HALF, fadeA, fadeB);
      vCount += this.appendRibbon(this.posBuf, this.colorBuf, vCount, idx, a.x, a.y, a.z, b.x, b.y, b.z, px, pz, -WHEEL_TRACK_HALF, fadeA, fadeB);
    }

    if (vCount === 0) {
      this.mesh.setVerticesData("position", new Float32Array(0));
      this.mesh.setIndices([]);
      return;
    }

    // updateVerticesData reuses the mesh's buffer storage and marks it dirty.
    this.mesh.updateVerticesData("position", this.posBuf.subarray(0, vCount * 3));
    this.mesh.updateVerticesData("color", this.colorBuf.subarray(0, vCount * 4));
    this.mesh.setIndices(idx);
  }

  /**
   * Append one thin ribbon quad (2 triangles) between two centerline points, offset
   * laterally by `offset` and given a half-width. Returns the number of vertices added.
   */
  private appendRibbon(
    pos: Float32Array,
    color: Float32Array,
    base: number,
    idx: number[],
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    px: number, pz: number,
    offset: number,
    fadeA: number,
    fadeB: number,
  ): number {
    const w = RIBBON_HALF_WIDTH;
    // Centerline endpoints after lateral offset.
    const axc = ax + px * offset, azc = az + pz * offset;
    const bxc = bx + px * offset, bzc = bz + pz * offset;
    // Four corners: a-side ±w along perp, b-side ±w along perp.
    const v0x = axc - px * w, v0z = azc - pz * w;
    const v1x = axc + px * w, v1z = azc + pz * w;
    const v2x = bxc + px * w, v2z = bzc + pz * w;
    const v3x = bxc - px * w, v3z = bzc - pz * w;

    const write = (i: number, x: number, y: number, z: number, fade: number) => {
      pos[(base + i) * 3] = x;
      pos[(base + i) * 3 + 1] = y + MARK_Y_OFFSET;
      pos[(base + i) * 3 + 2] = z;
      // Lerp RGB from fresh (dark rubber, fade=0) toward asphalt (fade=1).
      const t = fade;
      color[(base + i) * 4] = FRESH[0] + (EXPIRED[0] - FRESH[0]) * t;
      color[(base + i) * 4 + 1] = FRESH[1] + (EXPIRED[1] - FRESH[1]) * t;
      color[(base + i) * 4 + 2] = FRESH[2] + (EXPIRED[2] - FRESH[2]) * t;
      color[(base + i) * 4 + 3] = 1; // opaque — fade is carried by RGB, not alpha
    };

    // a-side corners use the a-point's terrain height; b-side corners use b's.
    write(0, v0x, ay, v0z, fadeA);
    write(1, v1x, ay, v1z, fadeA);
    write(2, v2x, by, v2z, fadeB);
    write(3, v3x, by, v3z, fadeB);

    idx.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    return 4;
  }

  /** Age fraction 0 (fresh) → 1 (expired). */
  private fade(birth: number, nowSeconds: number): number {
    const age = nowSeconds - birth;
    if (age <= 0) return 0;
    if (age >= SKID_LIFETIME) return 1;
    return age / SKID_LIFETIME;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
