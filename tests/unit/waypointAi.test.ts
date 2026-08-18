import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { KartEntity } from "../../src/entities/KartEntity.js";
import { createKart } from "../../src/entities/KartEntity.js";
import { stepKart, type DriveInput } from "../../src/entities/KartPhysics.js";
import { rubberBandMultiplier, WaypointAiStrategy } from "../../src/entities/WaypointAiStrategy.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";

const DT = 1 / 60;
const spline = new TrackSpline(MEADOWS_TRACK.controlPoints, MEADOWS_TRACK.roadWidth, TUNING.physics.onRoadMargin);
const strategy = new WaypointAiStrategy(spline);

function kartAtT(t: number): KartEntity {
  const p = spline.pointAt(t);
  return createKart({ id: "ai", name: "AI", isPlayer: false, color: [0, 1, 0], pos: { x: p.x, y: 0, z: p.z }, heading: 0 });
}

describe("WaypointAiStrategy (headless, real Meadows spline)", () => {
  it("(a) stays on the road for 60 s and (b) covers > 1.5 laps", () => {
    const kart = kartAtT(0);
    let maxOffRoadDist = 0;
    // Track total progress by accumulating signed Δt across the loop (handles wrap).
    let prevT = 0;
    let totalProgressLaps = 0;

    for (let i = 0; i < 60 * 60; i++) {
      const input: DriveInput = strategy.decide(kart, { standings: [] }, DT);
      kart.state = stepKart(kart.state, input, "road", DT, kart.topSpeedScale, kart.accelScale);

      // (a) never leaves the road.
      const cp = spline.closestPoint({ x: kart.state.pos.x, z: kart.state.pos.z });
      maxOffRoadDist = Math.max(maxOffRoadDist, cp.distance);
      expect(cp.distance).toBeLessThan(MEADOWS_TRACK.roadWidth / 2 + 0.5); // small tolerance for corner apex

      // (b) accumulate progress in laps.
      let dT = cp.t - prevT;
      if (dT > 0.5) dT -= 1; // wrapped forward across the line
      else if (dT < -0.5) dT += 1; // wrapped backward
      totalProgressLaps += dT;
      prevT = cp.t;
    }

    expect(maxOffRoadDist).toBeLessThan(MEADOWS_TRACK.roadWidth / 2 + 0.5);
    expect(totalProgressLaps).toBeGreaterThan(1.5); // > 1.5 laps in 60 s at base speed
  });

  it("(c) rubberBandMultiplier: 1 at gap 0, clamps to [0.75, 1.25], monotonic in gap", () => {
    expect(rubberBandMultiplier(0)).toBe(1);
    // Far behind → capped at the +25% boost; far ahead → capped at −25%.
    expect(rubberBandMultiplier(1e6)).toBeCloseTo(1.25, 9);
    expect(rubberBandMultiplier(-1e6)).toBeCloseTo(0.75, 9);

    // Monotonic non-decreasing in the gap over a wide sweep (never dips).
    let prev = rubberBandMultiplier(-400);
    for (let g = -390; g <= 400; g += 10) {
      const v = rubberBandMultiplier(g);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // And strictly increasing through the uncapped middle region.
    expect(rubberBandMultiplier(50)).toBeGreaterThan(rubberBandMultiplier(0));
    expect(rubberBandMultiplier(-50)).toBeLessThan(rubberBandMultiplier(0));
  });

  it("produces a valid frozen DriveInput (no drift, bounded throttle/steer)", () => {
    const kart = kartAtT(0.1);
    const input = strategy.decide(kart, { standings: [] }, DT);
    expect(input.drifting).toBe(false);
    expect(input.useItem).toBe(false);
    expect(input.throttle).toBeGreaterThanOrEqual(0.25);
    expect(input.throttle).toBeLessThanOrEqual(1);
    expect(Math.abs(input.steer)).toBeLessThanOrEqual(1);
  });
});
