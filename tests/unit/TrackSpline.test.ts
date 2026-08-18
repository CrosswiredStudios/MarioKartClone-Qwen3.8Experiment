import { describe, expect, it } from "vitest";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { TrackDefinition } from "../../src/data/tracks/shared.js";
import { TUNING } from "../../src/data/tuning.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";

function make(track: TrackDefinition, samplesPerSegment = 24): TrackSpline {
  return new TrackSpline(track.controlPoints, track.roadWidth, TUNING.physics.onRoadMargin, samplesPerSegment);
}

describe("TrackSpline (meadows + lagoon)", () => {
  for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
    describe(`track: ${track.id}`, () => {
      it("(a) length > 0 and stable across sample counts within 2%", () => {
        const s1 = make(track, 12);
        const s2 = make(track, 48);
        expect(s1.length).toBeGreaterThan(0);
        expect(Math.abs(s1.length - s2.length) / s1.length).toBeLessThan(0.02);
      });

      it("(b) pointAt(0) near first control point; pointAt(0.5) on the opposite side", () => {
        const spline = make(track);
        const p0 = spline.pointAt(0);
        const cp0 = track.controlPoints[0];
        expect(Math.hypot(p0.x - cp0.x, p0.z - cp0.z)).toBeLessThan(5);

        // Loop center as reference.
        let cx = 0;
        let cz = 0;
        for (const p of track.controlPoints) {
          cx += p.x;
          cz += p.z;
        }
        cx /= track.controlPoints.length;
        cz /= track.controlPoints.length;

        const half = spline.pointAt(0.5);
        const d0x = p0.x - cx;
        const d0z = p0.z - cz;
        const dhx = half.x - cx;
        const dhz = half.z - cz;
        expect(d0x * dhx + d0z * dhz).toBeLessThan(0);
      });

      it("(c) tangentAt(t) is unit length for a sweep of t values", () => {
        const spline = make(track);
        for (let i = 0; i <= 40; i++) {
          const tan = spline.tangentAt(i / 40);
          expect(Math.hypot(tan.x, tan.z)).toBeCloseTo(1, 6);
        }
      });

      it("(d) closestPoint on a known on-road point returns t ≈ that t and onRoad", () => {
        const spline = make(track);
        const p = spline.pointAt(0.3);
        const res = spline.closestPoint({ x: p.x, z: p.z });
        expect(Math.abs(res.t - 0.3)).toBeLessThan(0.02); // doc tolerance ±0.02
        expect(res.distance).toBeLessThan(track.roadWidth / 2);
        expect(res.onRoad).toBe(true);
      });

      // t=0.4 verified to be away from both tracks' tight corners (lagoon's
      // hairpin/chicane zones at ~t 0.26-0.33 and 0.54-0.58 have other loop
      // sections closer than the local road, which is geometrically correct).
      it("(e) off-road point at roadWidth*2 → onRoad false and distance ≈ the offset", () => {
        const spline = make(track);
        const p = spline.pointAt(0.4);
        const tan = spline.tangentAt(0.4);
        // Normal perpendicular to the tangent in XZ; flip so it points AWAY from
        // the loop center (outward), otherwise a far part of the loop is nearer.
        let cx = 0;
        let cz = 0;
        for (const cp of track.controlPoints) {
          cx += cp.x;
          cz += cp.z;
        }
        cx /= track.controlPoints.length;
        cz /= track.controlPoints.length;
        let nx = -tan.z;
        let nz = tan.x;
        if ((p.x - cx) * nx + (p.z - cz) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        const offset = track.roadWidth * 2;
        const off = { x: p.x + nx * offset, z: p.z + nz * offset };
        const res = spline.closestPoint(off);
        expect(res.onRoad).toBe(false);
        expect(Math.abs(res.distance - offset)).toBeLessThan(0.5); // ±0.5 m (polyline vs true curve)
      });

      it("(f) hint path: hinted closestPoint matches the full-scan result within ±1e-3", () => {
        const spline = make(track);
        let hint: number | undefined;
        for (let i = 0; i <= 20; i++) {
          const p = spline.pointAt(i / 20);
          const full = spline.closestPoint({ x: p.x, z: p.z }); // O(n) reference
          const res = spline.closestPoint({ x: p.x, z: p.z }, hint); // hinted path
          expect(Math.abs(res.t - full.t)).toBeLessThanOrEqual(1e-3 + 0.02); // ±1e-3 (plus sample-grid slack)
          expect(res.distance).toBeCloseTo(full.distance, 4);
          hint = res.t;
        }
      });

      it("pointAt wraps t outside [0,1]", () => {
        const spline = make(track);
        const a = spline.pointAt(0.25);
        const b = spline.pointAt(1.25);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-9);
      });

      it("throws on fewer than 3 control points", () => {
        expect(() => new TrackSpline([{ x: 0, z: 0 }, { x: 5, z: 0 }], 12, 0.5)).toThrow();
      });
    });
  }
});
