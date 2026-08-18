/**
 * Shared track-data types used by both track definition files.
 * Pure data, zero Babylon imports (architecture §2).
 */
import type { Vec2 } from "../../core/Vec.js";

export interface TrackTheme {
  readonly groundColor: string; // hex, e.g. "#3fa34d"
  readonly accentColor: string; // hex — props/lava accents
  readonly skyTop: string; // hex gradient top (fog/clear + MapSelect swatch)
  readonly skyBottom: string; // hex gradient bottom (fog/clear + MapSelect swatch)
  /** CubeTexture base path under public/ — faces are `{skybox}_{px,nx,py,ny,pz,nz}.jpg`. */
  readonly skybox: string;
  readonly fogColor: string; // hex
  readonly fogDensity: number; // per-meter exponential density
  readonly sunIntensity: number; // directional light intensity
  readonly ambientIntensity: number;
}

export interface ItemBoxCluster {
  readonly t: number;
  readonly lateralOffset?: number;
}

export interface HazardPlacement {
  readonly kind: "oilSlick";
  readonly t: number;
  readonly lateralOffset: number;
  readonly size: number;
}

/**
 * Centerline elevation profile (Phase 4.1). The road corridor is flattened to
 * this height; off-road terrain adds seeded noise on top (see TrackElevation).
 */
export interface ElevationProfile {
  /** (t, y) control points — t strictly ascending in [0,1), y in meters. ≥2 points. */
  readonly points: ReadonlyArray<{ readonly t: number; readonly y: number }>;
  /** Off-road noise amplitude range (meters); the field uses their midpoint. */
  readonly noiseAmplitudeMin: number;
  readonly noiseAmplitudeMax: number;
  /** Value-noise spatial frequency (1/m). Lower = broader hills. */
  readonly noiseFrequency: number;
  /** Deterministic seed for the off-road noise field. */
  readonly seed?: number;
}

export type PropKind = "tree" | "mushroom" | "sign" | "flower" | "rock" | "geyser" | "torch" | "crystal";

export interface PropSpawn {
  readonly kind: PropKind;
  readonly t: number;
  readonly lateralOffset: number;
  readonly scale?: number;
  readonly rotationY?: number;
}

/**
 * Per-segment road-width override (Phase 6). `widthOverride` is the FULL width in
 * meters for the span [tStart, tEnd) — e.g. a bridge narrower than the base road.
 * The spline eases between widths over ~0.5 m at each edge so the ribbon doesn't kink.
 */
export interface WidthOverride {
  readonly tStart: number; // in [0,1), strictly < tEnd (no wrap-around spans)
  readonly tEnd: number; // in (tStart, 1] — 1 means "up to the loop seam"
  readonly widthOverride: number; // meters, full width
}

export interface TrackDefinition {
  readonly id: string;
  readonly name: string;
  readonly laps: number; // always 3 in this project
  readonly roadWidth: number; // meters
  readonly controlPoints: Vec2[]; // Catmull-Rom loop, XZ plane (y=0)
  /** Themed terrain elevation (Phase 4.1). Required — every track has a profile. */
  readonly elevation: ElevationProfile;
  readonly theme: TrackTheme;
  readonly itemBoxClusters: ItemBoxCluster[];
  readonly hazards: HazardPlacement[];
  readonly propCatalog: PropSpawn[];
  /** Phase 6 — optional per-segment width overrides (bridges). Omit for uniform width. */
  readonly widthOverrides?: WidthOverride[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Throws on structural problems: <8 control points, t outside [0,1), non-finite numbers, laps !== 3. */
export function validateTrackDefinition(track: TrackDefinition): void {
  if (track.laps !== 3) throw new Error(`track ${track.id}: laps must be 3, got ${track.laps}`);
  if (!isFiniteNumber(track.roadWidth) || track.roadWidth <= 0) {
    throw new Error(`track ${track.id}: roadWidth must be a positive finite number`);
  }
  if (track.controlPoints.length < 8) {
    throw new Error(`track ${track.id}: needs at least 8 control points, got ${track.controlPoints.length}`);
  }
  for (const p of track.controlPoints) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.z)) {
      throw new Error(`track ${track.id}: non-finite control point (${p.x}, ${p.z})`);
    }
  }

  const theme = track.theme;
  for (const key of ["groundColor", "accentColor", "skyTop", "skyBottom", "fogColor"] as const) {
    if (!HEX_COLOR.test(theme[key])) throw new Error(`track ${track.id}: theme.${key} is not a #rrggbb hex color`);
  }
  for (const key of ["fogDensity", "sunIntensity", "ambientIntensity"] as const) {
    if (!isFiniteNumber(theme[key]) || theme[key] < 0) {
      throw new Error(`track ${track.id}: theme.${key} must be a non-negative finite number`);
    }
  }
  // CubeTexture base path: relative, no extension — face suffixes are appended by the loader.
  if (!/^textures\/[a-z0-9_-]+$/.test(theme.skybox)) {
    throw new Error(`track ${track.id}: theme.skybox must look like "textures/<name>" (no extension): ${theme.skybox}`);
  }

  for (const cluster of track.itemBoxClusters) {
    if (!isFiniteNumber(cluster.t) || cluster.t < 0 || cluster.t >= 1) {
      throw new Error(`track ${track.id}: item box cluster t out of [0,1): ${cluster.t}`);
    }
    if (cluster.lateralOffset !== undefined && !isFiniteNumber(cluster.lateralOffset)) {
      throw new Error(`track ${track.id}: item box cluster lateralOffset not finite`);
    }
  }

  for (const hazard of track.hazards) {
    if (!isFiniteNumber(hazard.t) || hazard.t < 0 || hazard.t >= 1) {
      throw new Error(`track ${track.id}: hazard t out of [0,1): ${hazard.t}`);
    }
    if (!isFiniteNumber(hazard.lateralOffset) || !isFiniteNumber(hazard.size)) {
      throw new Error(`track ${track.id}: hazard lateralOffset/size not finite`);
    }
  }

  for (const prop of track.propCatalog) {
    if (!isFiniteNumber(prop.t) || prop.t < 0 || prop.t >= 1) {
      throw new Error(`track ${track.id}: prop t out of [0,1): ${prop.t}`);
    }
    if (!isFiniteNumber(prop.lateralOffset)) {
      throw new Error(`track ${track.id}: prop lateralOffset not finite`);
    }
    if (prop.scale !== undefined && !isFiniteNumber(prop.scale)) {
      throw new Error(`track ${track.id}: prop scale not finite`);
    }
  }

  for (const w of track.widthOverrides ?? []) {
    if (!isFiniteNumber(w.tStart) || w.tStart < 0 || w.tStart >= 1) {
      throw new Error(`track ${track.id}: widthOverride tStart out of [0,1): ${w.tStart}`);
    }
    if (!isFiniteNumber(w.tEnd) || w.tEnd <= w.tStart || w.tEnd > 1) {
      throw new Error(`track ${track.id}: widthOverride tEnd must be in (tStart, 1]: ${w.tEnd}`);
    }
    if (!isFiniteNumber(w.widthOverride) || w.widthOverride <= 0) {
      throw new Error(`track ${track.id}: widthOverride width must be a positive finite number`);
    }
  }

  const elev = track.elevation;
  if (!elev || elev.points.length < 2) {
    throw new Error(`track ${track.id}: elevation profile needs at least 2 points, got ${elev?.points.length ?? 0}`);
  }
  for (let i = 0; i < elev.points.length; i++) {
    const pt = elev.points[i];
    if (!isFiniteNumber(pt.t) || pt.t < 0 || pt.t >= 1) {
      throw new Error(`track ${track.id}: elevation point t out of [0,1): ${pt.t}`);
    }
    if (!isFiniteNumber(pt.y)) {
      throw new Error(`track ${track.id}: elevation point y not finite: ${pt.y}`);
    }
    if (i > 0 && pt.t <= elev.points[i - 1].t) {
      throw new Error(`track ${track.id}: elevation points must be strictly ascending in t`);
    }
  }
  for (const key of ["noiseAmplitudeMin", "noiseAmplitudeMax", "noiseFrequency"] as const) {
    if (!isFiniteNumber(elev[key]) || elev[key] < 0) {
      throw new Error(`track ${track.id}: elevation.${key} must be a non-negative finite number`);
    }
  }
  if (elev.noiseAmplitudeMax < elev.noiseAmplitudeMin) {
    throw new Error(`track ${track.id}: elevation.noiseAmplitudeMax < noiseAmplitudeMin`);
  }
  if (elev.seed !== undefined && (!Number.isInteger(elev.seed) || elev.seed < 0)) {
    throw new Error(`track ${track.id}: elevation.seed must be a non-negative integer`);
  }
}
