/**
 * TrackElevation — pure heightfield for themed terrain (Phase 4.1).
 *
 * Single source of truth for elevation: the SAME `heightAt(x, z)` function is
 * sampled by the render layer (TrackBuilder's heightmap ground + road ribbon)
 * AND by game logic (kart Y, slope speed model, skid marks), so mesh and
 * physics can never drift apart. No Babylon imports — headless-testable.
 *
 * Model:
 *  - The ROAD CORRIDOR is flattened to the centerline elevation profile
 *    (MK-style): a periodic Catmull-Rom over per-track (t, y) control points.
 *  - OFF-ROAD terrain adds seeded value-noise that fades to zero inside the
 *    corridor (smoothstep between `corridorHalfWidth` and `+ corridorMargin`),
 *    so the surface blends seamlessly into the flat road.
 */

import type { TrackSpline } from "./TrackSpline.js";
import type { ElevationProfile, TrackDefinition } from "../data/tracks/shared.js";
import { TUNING } from "../data/tuning.js";

/** World-space height sampler — the one function everything samples. */
export interface HeightField {
  /** Terrain surface height (meters) at world XZ position. */
  readonly heightAt: (x: number, z: number) => number;
  /** Bounding box of the sampled region (render layer sizes its grid to this). */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Min/max surface height over the whole field (heightmap normalization). */
  readonly minH: number;
  readonly maxH: number;
}

/**
 * Elevation at normalized arc position t of a track's centerline profile.
 *
 * Periodic Catmull-Rom over the (t, y) control points. Each segment is
 * pre-sampled into a dense table (like TrackSpline's polyline), so lookups are
 * O(1): value-continuous at every knot, EXACT at every control point, and the
 * loop wraps seamlessly across t=0/1. Points must be strictly ascending in t
 * within [0,1) (enforced by validateTrackDefinition).
 */
export function elevationAt(profile: ElevationProfile, t: number): number {
  const pts = profile.points;
  const n = pts.length;
  if (n === 1) return pts[0].y;

  let w = t % 1;
  if (w < 0) w += 1;

  // Segment k spans [pts[k].t, pts[(k+1)%n].t]; segment n-1 wraps past 1 and in
  // wrapped coords covers [pts[n-1].t, 1) ∪ [0, pts[0].t).
  let i: number;
  if (w < pts[0].t || w >= pts[n - 1].t) {
    i = n - 1; // wrap segment
  } else {
    i = n - 2;
    for (let k = 0; k < n - 1; k++) {
      if (w >= pts[k].t && w < pts[k + 1].t) {
        i = k;
        break;
      }
    }
  }

  const tbl = tableFor(profile);
  const t1 = pts[i].t;
  let t2 = pts[(i + 1) % n].t;
  if (t2 <= t1) t2 += 1; // last segment wraps past 1
  const s = w < t1 ? w + 1 : w; // unwrap for the wrap segment's [0, pts[0].t) half
  const u = (s - t1) / (t2 - t1); // local parameter in [0,1]

  const f = u * PROFILE_SAMPLES_PER_SEG;
  const k = Math.min(PROFILE_SAMPLES_PER_SEG, Math.floor(f));
  const frac = f - k;
  const base = i * (PROFILE_SAMPLES_PER_SEG + 1);
  return tbl.values[base + k] + (tbl.values[base + k + 1] - tbl.values[base + k]) * frac;
}

/** Dense per-segment CR samples: values[i*(N+1)+k], k=0..N, u=k/N. */
interface ProfileTable {
  readonly values: Float64Array;
}

const PROFILE_SAMPLES_PER_SEG = 32;
const tableCache = new WeakMap<ElevationProfile, ProfileTable>();

function tableFor(profile: ElevationProfile): ProfileTable {
  const cached = tableCache.get(profile);
  if (cached) return cached;

  const pts = profile.points;
  const n = pts.length;
  const values = new Float64Array(n * (PROFILE_SAMPLES_PER_SEG + 1));
  for (let i = 0; i < n; i++) {
    const y0 = pts[(i - 1 + n) % n].y;
    const y1 = pts[i].y;
    const y2 = pts[(i + 1) % n].y;
    const y3 = pts[(i + 2) % n].y;
    for (let k = 0; k <= PROFILE_SAMPLES_PER_SEG; k++) {
      const u = k / PROFILE_SAMPLES_PER_SEG;
      const u2 = u * u;
      const u3 = u2 * u;
      values[i * (PROFILE_SAMPLES_PER_SEG + 1) + k] =
        0.5 * (2 * y1 + (-y0 + y2) * u + (2 * y0 - 5 * y1 + 4 * y2 - y3) * u2 + (-y0 + 3 * y1 - 3 * y2 + y3) * u3);
    }
  }

  const table: ProfileTable = { values };
  tableCache.set(profile, table);
  return table;
}

/** Deterministic hash → [0,1) for value-noise lattice corners. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0,1). */
function valueNoise(x: number, z: number, freq: number, seed: number): number {
  const fx = x * freq;
  const fz = z * freq;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smoothstep(0, 1, fx - ix);
  const tz = smoothstep(0, 1, fz - iz);

  const v00 = hash2(ix, iz, seed);
  const v10 = hash2(ix + 1, iz, seed);
  const v01 = hash2(ix, iz + 1, seed);
  const v11 = hash2(ix + 1, iz + 1, seed);

  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

/**
 * Build the pure heightfield for a track. Deterministic: same track + seed →
 * identical surface. The spline is used ONLY to find each XZ point's nearest
 * centerline position (t + lateral distance); all elevation math is local.
 */
export function makeHeightField(spline: TrackSpline, track: TrackDefinition): HeightField {
  const profile = track.elevation;
  if (!profile) throw new Error(`track ${track.id}: makeHeightField requires an elevation profile`);

  const terrain = TUNING.terrain;
  const seed = profile.seed ?? 1337;
  const noiseAmp = (profile.noiseAmplitudeMin + profile.noiseAmplitudeMax) / 2;
  const freq = profile.noiseFrequency;

  // ── bounds: control-point extent + margin for the off-road field ─────────
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.controlPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const margin = terrain.boundMargin + noiseAmp * 4; // generous: props live out here too
  minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;

  // NOTE: no shared closest-point cache here. The field is sampled by MANY
  // independent callers (ground grid, road ribbon, barriers, each kart) whose
  // query order interleaves; a mutable hint reused across them made
  // `closestPoint` lock onto the wrong segment on curves/parallel sections,
  // baking wrong elevations into the mesh. A fresh resolve per call is correct
  // for every caller and cheap (~400-point scan, build-time + 4 karts/frame).
  const heightAt = (x: number, z: number): number => {
    const cp = spline.closestPoint({ x, z });
    const base = elevationAt(profile, cp.t);
    if (noiseAmp <= 0) return base;

    // Corridor falloff: 0 on the road → 1 beyond corridorHalfWidth+margin.
    const fade = smoothstep(terrain.corridorHalfWidth, terrain.corridorHalfWidth + terrain.corridorMargin, cp.distance);
    if (fade === 0) return base;

    // Two octaves of value noise, centered on 0 → ±noiseAmp off-road.
    const n1 = valueNoise(x, z, freq, seed) - 0.5;
    const n2 = valueNoise(x, z, freq * 2.7, seed + 101) - 0.5;
    return base + fade * noiseAmp * (n1 + 0.5 * n2);
  };

  // ── min/max over the field: profile extremes + off-road amplitude ─────────
  let profMin = Infinity, profMax = -Infinity;
  for (let i = 0; i <= 64; i++) {
    const y = elevationAt(profile, i / 64);
    if (y < profMin) profMin = y;
    if (y > profMax) profMax = y;
  }

  return {
    heightAt,
    bounds: { minX, maxX, minZ, maxZ },
    minH: profMin - noiseAmp * 1.5,
    maxH: profMax + noiseAmp * 1.5,
  };
}
