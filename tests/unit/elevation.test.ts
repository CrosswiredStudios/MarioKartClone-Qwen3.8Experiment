import { describe, expect, it } from "vitest";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { ElevationProfile, TrackDefinition } from "../../src/data/tracks/shared.js";
import { TUNING } from "../../src/data/tuning.js";
import { elevationAt, makeHeightField } from "../../src/tracks/TrackElevation.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";

function splineFor(track: TrackDefinition): TrackSpline {
  return new TrackSpline(track.controlPoints, track.roadWidth, TUNING.physics.onRoadMargin);
}

describe("elevationAt (centerline profile)", () => {
  it("passes through every control point exactly", () => {
    for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
      for (const pt of track.elevation.points) {
        expect(elevationAt(track.elevation, pt.t)).toBeCloseTo(pt.y, 6);
      }
    }
  });

  it("is continuous across the t=0/1 wrap", () => {
    for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
      const eps = 1e-4;
      const before = elevationAt(track.elevation, 1 - eps);
      const after = elevationAt(track.elevation, eps);
      // Both approach the t=0 point value from either side.
      expect(Math.abs(before - track.elevation.points[0].y)).toBeLessThan(2);
      expect(Math.abs(after - track.elevation.points[0].y)).toBeLessThan(2);
    }
  });

  it("is continuous everywhere (no jumps between dense samples)", () => {
    for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
      let prev = elevationAt(track.elevation, 0);
      for (let i = 1; i <= 2000; i++) {
        const cur = elevationAt(track.elevation, i / 2000);
        expect(Math.abs(cur - prev)).toBeLessThan(0.5); // no knot discontinuities
        prev = cur;
      }
    }
  });

  it("stays within the control-point y-range ±overshoot slack", () => {
    for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
      const ys = track.elevation.points.map((p) => p.y);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      for (let i = 0; i <= 200; i++) {
        const y = elevationAt(track.elevation, i / 200);
        expect(y).toBeGreaterThanOrEqual(lo - 1.5);
        expect(y).toBeLessThanOrEqual(hi + 1.5);
      }
    }
  });

  it("wraps t outside [0,1)", () => {
    const profile = MEADOWS_TRACK.elevation;
    for (const pt of profile.points) {
      expect(elevationAt(profile, pt.t + 1)).toBeCloseTo(pt.y, 6);
      expect(elevationAt(profile, pt.t - 1)).toBeCloseTo(pt.y, 6);
    }
  });

  it("handles a single-point profile (constant)", () => {
    const one: ElevationProfile = {
      points: [{ t: 0, y: 3.5 }],
      noiseAmplitudeMin: 0,
      noiseAmplitudeMax: 0,
      noiseFrequency: 0.1,
    };
    expect(elevationAt(one, 0)).toBe(3.5);
    expect(elevationAt(one, 0.7)).toBe(3.5);
  });
});

describe("makeHeightField (world-space sampler)", () => {
  for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
    describe(`track: ${track.id}`, () => {
      const spline = splineFor(track);
      const field = makeHeightField(spline, track);

      it("road corridor height stays within the profile range (no off-road noise on-road)", () => {
        // Inside the corridor the noise fades to 0, so any centerline sample must
        // sit at some profile value — bounded by the profile's min/max plus a
        // small CR-overshoot slack. (Exact per-sample equality is not asserted:
        // on circuits with parallel sections the closest-point solver may resolve
        // an ambiguous centerline point to either segment, and both are valid.)
        const ys = track.elevation.points.map((q) => q.y);
        const lo = Math.min(...ys), hi = Math.max(...ys);
        for (let i = 0; i < 17; i++) {
          const p = spline.pointAt(i / 16);
          const h = field.heightAt(p.x, p.z);
          expect(h).toBeGreaterThanOrEqual(lo - 1.5);
          expect(h).toBeLessThanOrEqual(hi + 1.5);
        }
      });

      it("is deterministic for the same track + seed", () => {
        // Fresh instances: identical query sequence → bit-identical results.
        const a = makeHeightField(splineFor(track), track);
        const b = makeHeightField(splineFor(track), track);
        for (let i = 0; i < 25; i++) {
          const x = field.bounds.minX + ((i * 37) % 100) / 100 * (field.bounds.maxX - field.bounds.minX);
          const z = field.bounds.minZ + ((i * 53) % 100) / 100 * (field.bounds.maxZ - field.bounds.minZ);
          expect(b.heightAt(x, z)).toBe(a.heightAt(x, z));
        }
      });

      it("off-road surface varies within the themed amplitude", () => {
        const amp = (track.elevation.noiseAmplitudeMin + track.elevation.noiseAmplitudeMax) / 2;
        // Sample a ring well outside the corridor at several t values.
        let minDelta = Infinity, maxDelta = -Infinity;
        for (let i = 0; i < 16; i++) {
          const t = i / 16;
          const p = spline.pointAt(t);
          const tan = spline.tangentAt(t);
          // Outward normal (away from loop center).
          let cx = 0, cz = 0;
          for (const cp of track.controlPoints) { cx += cp.x; cz += cp.z; }
          cx /= track.controlPoints.length; cz /= track.controlPoints.length;
          let nx = -tan.z, nz = tan.x;
          if ((p.x - cx) * nx + (p.z - cz) * nz < 0) { nx = -nx; nz = -nz; }
          // 18 m out: past corridorHalfWidth+margin (fade=1). Samples whose
          // closest point resolves to a different segment are skipped.
          const offX = p.x + nx * 18;
          const offZ = p.z + nz * 18;
          // Reference: profile at the off-road point's own arc position — isolates
          // pure noise (fade=1 there, so heightAt = elevation(t) + amp·(n1+0.5·n2)).
          // Use a full scan (no hint) to match the field's internal solve exactly;
          // a hinted solve can land on a different segment for ambiguous points and
          // would leak an elevation difference into `delta`.
          const cold = makeHeightField(spline, track); // fresh → identical cold solve
          const offT = spline.closestPoint({ x: offX, z: offZ }).t;
          if (Math.abs(offT - t) > 0.15) continue; // ambiguous sample — skip
          const delta = cold.heightAt(offX, offZ) - elevationAt(track.elevation, offT);
          minDelta = Math.min(minDelta, delta);
          maxDelta = Math.max(maxDelta, delta);
        }
        // Two-octave noise peaks at ±0.75×amp (n1∈[-.5,.5], 0.5·n2∈[-.25,.25]).
        expect(minDelta).toBeLessThan(-amp * 0.1); // actually dips below the profile
        expect(maxDelta).toBeGreaterThan(amp * 0.1); // and rises above it
        expect(Math.abs(minDelta)).toBeLessThanOrEqual(amp * 0.76);
        expect(Math.abs(maxDelta)).toBeLessThanOrEqual(amp * 0.76);
        // And it actually varies (not a flat field).
        expect(maxDelta - minDelta).toBeGreaterThan(amp * 0.5);
      });

      it("bounds contain the control points and minH < maxH", () => {
        for (const cp of track.controlPoints) {
          expect(cp.x).toBeGreaterThanOrEqual(field.bounds.minX);
          expect(cp.x).toBeLessThanOrEqual(field.bounds.maxX);
          expect(cp.z).toBeGreaterThanOrEqual(field.bounds.minZ);
          expect(cp.z).toBeLessThanOrEqual(field.bounds.maxZ);
        }
        expect(field.maxH).toBeGreaterThan(field.minH);
      });

      it("heightAt is smooth (no cliffs between 1 m-apart samples)", () => {
        // Walk a line across the field; consecutive 1 m steps must not jump wildly.
        const x0 = field.bounds.minX + 5, z0 = field.bounds.minZ + 5;
        let prev = field.heightAt(x0, z0);
        for (let i = 1; i <= 40; i++) {
          const cur = field.heightAt(x0 + i, z0 + i * 0.7);
          expect(Math.abs(cur - prev)).toBeLessThan(6); // even lagoon cliffs are < 6 m/m here
          prev = cur;
        }
      });
    });
  }

  it("throws when the track has no elevation profile", () => {
    const bare = { ...MEADOWS_TRACK, elevation: undefined } as unknown as TrackDefinition;
    expect(() => makeHeightField(splineFor(MEADOWS_TRACK), bare)).toThrow(/elevation/);
  });
});
