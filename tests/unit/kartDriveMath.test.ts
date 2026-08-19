import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { driveImpulse, forwardVec, targetSpeedOf, targetYawRate } from "../../src/entities/kartDriveMath.js";

const DT = 1 / 60;
const MASS = 150; // kg — arbitrary; the math is linear in mass.

/**
 * Physics rewrite (todo #3) — pure drive-math unit tests for KartBody's "muscle" layer.
 * These pin the bounded-authority contract: normal accel/brake impulses are clamped to
 * maxDriveAccelMps2·m·dt per step so kart↔kart bumps perturb velocity visibly, while yaw
 * rate is exactly Δheading/dt (the brain's steering intent).
 */

describe("driveImpulse", () => {
  it("returns zero when already at target speed", () => {
    expect(driveImpulse(20, 20, MASS, DT)).toBe(0);
  });

  it("accelerates forward (positive impulse) below target", () => {
    // Delta within the per-step budget (maxDriveAccelMps2·dt ≈ 0.67 m/s at 40 m/s²).
    const imp = driveImpulse(19.5, 20, MASS, DT);
    expect(imp).toBeGreaterThan(0);
    // Full delta when within the per-step authority budget.
    expect(imp).toBeCloseTo((20 - 19.5) * MASS, 6);
  });

  it("brakes (negative impulse) above target", () => {
    const imp = driveImpulse(20.5, 20, MASS, DT);
    expect(imp).toBeLessThan(0);
    expect(imp).toBeCloseTo((20 - 20.5) * MASS, 6);
  });

  it("clamps to maxDriveAccelMps2·m·dt when the delta is large", () => {
    const maxDelta = TUNING.physicsWorld.maxDriveAccelMps2 * DT;
    // From standstill to top speed: raw delta (30 m/s) far exceeds one step's budget.
    expect(driveImpulse(0, 30, MASS, DT)).toBeCloseTo(maxDelta * MASS, 6);
    // Braking from a big overshoot clamps symmetrically.
    expect(driveImpulse(40, 0, MASS, DT)).toBeCloseTo(-maxDelta * MASS, 6);
  });

  it("scales linearly with mass", () => {
    const imp = driveImpulse(5, 15, MASS, DT);
    expect(driveImpulse(5, 15, MASS * 2, DT)).toBeCloseTo(imp * 2, 6);
  });

  it("scales with dt (shorter step → smaller impulse)", () => {
    const imp = driveImpulse(0, 30, MASS, DT); // clamped case
    expect(driveImpulse(0, 30, MASS, DT / 2)).toBeCloseTo(imp / 2, 6);
  });
});

describe("targetYawRate", () => {
  it("is Δheading/dt for a right turn (positive)", () => {
    expect(targetYawRate(0, 0.3, DT)).toBeCloseTo(0.3 / DT, 6);
  });

  it("is negative for a left turn", () => {
    expect(targetYawRate(1, 0.7, DT)).toBeCloseTo(-0.3 / DT, 6);
  });

  it("is zero when heading is unchanged", () => {
    expect(targetYawRate(2.5, 2.5, DT)).toBe(0);
  });
});

describe("forwardVec", () => {
  it("heading 0 points +Z (kart forward convention)", () => {
    const f = forwardVec(0);
    expect(f.x).toBeCloseTo(0, 12);
    expect(f.z).toBeCloseTo(1, 12);
  });

  it("heading π/2 points +X", () => {
    const f = forwardVec(Math.PI / 2);
    expect(f.x).toBeCloseTo(1, 12);
    expect(f.z).toBeCloseTo(0, 12);
  });

  it("is a unit vector for arbitrary headings", () => {
    for (const h of [0.1, -1.3, 4.7]) {
      const f = forwardVec(h);
      expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 12);
    }
  });

  it("matches the stepKart integration convention (x=sin h, z=cos h)", () => {
    // KartPhysics integrates newX = x + sin(h)·s·dt; newZ = z + cos(h)·s·dt.
    const h = 0.9;
    const f = forwardVec(h);
    expect(f.x).toBeCloseTo(Math.sin(h), 12);
    expect(f.z).toBeCloseTo(Math.cos(h), 12);
  });
});

describe("targetSpeedOf", () => {
  it("returns the brain's speed as the body's chase target", () => {
    const state = { speed: 17.5 } as never;
    expect(targetSpeedOf(state)).toBe(17.5);
  });
});
