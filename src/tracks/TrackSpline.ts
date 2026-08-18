/**
 * Closed-loop Catmull-Rom track spline with an arc-length table (pure TS, no Babylon).
 *
 * Construction: each control-point segment is sampled `samplesPerSegment` times
 * (default 24) into a dense polyline of N = n × samplesPerSegment points. A
 * cumulative arc-length table s[i] (distance from point 0 to point i along the
 * loop, s[0] = 0) makes t → position mapping O(log n) via binary search + linear
 * interpolation between bracketing polyline points.
 *
 * closestPoint(p, hintT?) performance contract:
 * - WITH a hint (each kart carries its "last known t"): convert the hint to an
 *   arc-length position, binary-search s[] for the bracketing segment, then scan
 *   only that segment's samples plus one neighbor segment each side for the true
 *   minimum → O(log n + samplesPerSegment).
 * - WITHOUT a hint (first frame / AI spawn): one full O(n) scan; callers should
 *   cache the returned t as their new hint.
 */
import type { Vec2, Vec3 } from "../core/Vec.js";
import type { WidthOverride } from "../data/tracks/shared.js";

export interface ClosestPointResult {
  readonly t: number; // 0..1 along the loop
  readonly distance: number; // meters (XZ plane) to the nearest polyline point
  readonly onRoad: boolean; // distance <= halfWidthAt(t) + margin
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

export class TrackSpline {
  readonly length: number; // total arc length, meters

  /** Base road width in meters — exposed for shell wall-bounce checks (Phase 5). */
  get roadWidth(): number {
    return this.roadWidth_;
  }

  /**
   * Half-width of the drivable surface at normalized arc position t (Phase 6).
   * Returns base `roadWidth/2`, or a widthOverride span's half-width when t falls
   * inside one — with a smooth ~0.5 m ease across each span edge so the ribbon
   * doesn't kink and on-road detection stays continuous at the boundary.
   */
  halfWidthAt(t: number): number {
    const baseHalf = this.roadWidth_ / 2;
    if (this.widthOverrides_.length === 0) return baseHalf;
    const w = this.wrapT(t);
    const ov = this.spanContaining(w);
    if (!ov) return baseHalf;

    const target = ov.widthOverride / 2;
    if (target === baseHalf) return baseHalf;

    // Ease over ~0.5 m of arc length at each edge: full override in the span's
    // interior, smoothstep blend to/from the base width across the transition.
    const ease = Math.min(
      WIDTH_EASE_M,
      ((ov.tEnd - ov.tStart) * this.length) / 2, // never wider than half the span
    );
    const dEdge = Math.min(w - ov.tStart, ov.tEnd - w) * this.length;
    const u = Math.min(1, dEdge / ease);
    const blend = u * u * (3 - 2 * u); // smoothstep
    return baseHalf + (target - baseHalf) * blend;
  }

  /** True when t is inside any widthOverride span. */
  inWidthOverrideSpan(t: number): boolean {
    if (this.widthOverrides_.length === 0) return false;
    const w = this.wrapT(t);
    for (const ov of this.widthOverrides_) {
      if (w >= ov.tStart && w < ov.tEnd) return true;
    }
    return false;
  }

  /** The span containing t, or null. */
  private spanContaining(w: number): WidthOverride | null {
    for (const ov of this.widthOverrides_) {
      if (w >= ov.tStart && w < ov.tEnd) return ov;
    }
    return null;
  }

  private readonly points: Vec2[] = []; // dense polyline, N points (loop, no duplicate end)
  private readonly s: number[] = []; // cumulative arc length, s[i] for points[i], s[0]=0
  private readonly widthOverrides_: WidthOverride[];

  constructor(
    controlPoints: Vec2[],
    /** Base road width in meters (barrier distance from centerline is halfWidthAt(t)). */
    private readonly roadWidth_: number,
    private readonly onRoadMargin: number,
    samplesPerSegment = 24,
    /** Phase 6 — optional per-segment full-width overrides (bridges). */
    widthOverrides?: WidthOverride[],
  ) {
    this.widthOverrides_ = widthOverrides ?? [];
    if (controlPoints.length < 3) throw new Error("TrackSpline needs at least 3 control points");

    const n = controlPoints.length;
    for (let i = 0; i < n; i++) {
      const p0 = controlPoints[(i - 1 + n) % n];
      const p1 = controlPoints[i];
      const p2 = controlPoints[(i + 1) % n];
      const p3 = controlPoints[(i + 2) % n];
      for (let k = 0; k < samplesPerSegment; k++) {
        this.points.push(catmullRom(p0, p1, p2, p3, k / samplesPerSegment));
      }
    }

    const count = this.points.length;
    let total = 0;
    for (let i = 0; i < count; i++) {
      this.s.push(total);
      const a = this.points[i];
      const b = this.points[(i + 1) % count];
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    // Close the loop: s must span exactly `length` so t=1 maps back to point 0.
    this.length = total;
  }

  /** Position at normalized arc position t (wrapped into 0..1). y is always 0. */
  pointAt(t: number): Vec3 {
    const [i, f] = this.bracket(this.wrapT(t) * this.length);
    const a = this.points[i];
    const b = this.points[(i + 1) % this.points.length];
    return { x: a.x + (b.x - a.x) * f, y: 0, z: a.z + (b.z - a.z) * f };
  }

  /** Unit tangent at normalized arc position t. */
  tangentAt(t: number): Vec2 {
    const [i] = this.bracket(this.wrapT(t) * this.length);
    const a = this.points[i];
    const b = this.points[(i + 1) % this.points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /**
   * Nearest point on the spline to p. Pass the kart's previous t as `hintT` for
   * O(log n); omit it for a one-shot full scan (result.t becomes the new hint).
   */
  closestPoint(p: Vec2, hintT?: number): ClosestPointResult {
    const count = this.points.length;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintT === undefined) {
      for (let i = 0; i < count; i++) {
        const d = distSq(p, this.points[i]);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestIdx = i;
        }
      }
    } else {
      // Coarse: binary-search the arc table for the segment containing hint×length.
      const target = this.wrapT(hintT) * this.length;
      let lo = 0;
      let hi = count - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.s[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      // Fine: scan the bracketing segment plus one neighbor each side.
      for (let off = -HINT_SCAN_RADIUS; off <= HINT_SCAN_RADIUS; off++) {
        const i = (lo + off + count) % count;
        const d = distSq(p, this.points[i]);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestIdx = i;
        }
      }
    }

    // Convert the winning polyline index back to a normalized t.
    const t = this.s[bestIdx] / this.length;
    // Phase 6: on-road uses the LOCAL half-width, so driving "off" a narrowed
    // bridge span is impossible (barriers + cliff void handle the visual side).
    const dist = Math.sqrt(bestDistSq);
    return { t, distance: dist, onRoad: dist <= this.halfWidthAt(t) + this.onRoadMargin };
  }

  /** [index, fraction] of the polyline segment containing arc length `arc`. */
  private bracket(arc: number): [number, number] {
    const count = this.points.length;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= arc) lo = mid;
      else hi = mid - 1;
    }
    const a = this.s[lo];
    // The last segment wraps around the loop: its end is the full length.
    const bEnd = lo === count - 1 ? this.length : this.s[lo + 1];
    const span = bEnd - a || 1;
    return [lo, Math.min(1, Math.max(0, (arc - a) / span))];
  }

  private wrapT(t: number): number {
    const w = t % 1;
    return w < 0 ? w + 1 : w;
  }
}

/**
 * Hint-scan radius in polyline samples around the hinted segment. Two full
 * sample runs (2 × 24 at default density) each side — generous enough that hint
 * drift between consecutive frames can never miss the true nearest point.
 */
const HINT_SCAN_RADIUS = 48;

/** Arc length (m) over which halfWidthAt eases across a widthOverride span edge. */
const WIDTH_EASE_M = 0.5;

function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
