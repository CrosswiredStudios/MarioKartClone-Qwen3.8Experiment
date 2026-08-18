import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import type { DriveInput } from "../../src/entities/KartPhysics.js";
import { NO_DRIFT, updateDrift, type DriftCharge } from "../../src/entities/DriftController.js";

const DT = 1 / 60;

function input(over: Partial<DriveInput> = {}): DriveInput {
  return Object.freeze({ throttle: 0, steer: 0, drifting: false, useItem: false, ...over });
}

/** Run n steps with a constant input from the given charge state. */
function run(state: DriftCharge, inp: DriveInput, steps: number): DriftCharge {
  let s = state;
  for (let i = 0; i < steps; i++) s = updateDrift(s, inp, DT).charge;
  return s;
}

const HARD_STEER = input({ drifting: true, steer: 1 }); // |steer| > 0.3 → charges

describe("DriftController.updateDrift", () => {
  it("(a) no drift input → stays 'none', no boost", () => {
    const r = updateDrift(NO_DRIFT, input({ throttle: 1 }), DT);
    expect(r.charge).toEqual({ tier: "none", chargeTime: 0 });
    expect(r.releasedBoost).toBeUndefined();

    // Even drifting without steering never charges.
    const s = run(NO_DRIFT, input({ drifting: true, steer: 0.1 }), 60);
    expect(s.tier).toBe("none");
    expect(s.chargeTime).toBe(0);
  });

  it("(b) drifting + |steer| > 0.3 enters charging1 after charge1Time ± dt", () => {
    // Find the first step at which the tier becomes charging1; must be ≈ charge1Time/DT.
    let s = NO_DRIFT;
    let enteredAt: number | null = null;
    for (let i = 1; i <= 60 * 3; i++) {
      s = updateDrift(s, HARD_STEER, DT).charge;
      if (s.tier === "charging1") {
        enteredAt = i;
        break;
      }
    }
    expect(enteredAt).not.toBeNull();
    const expectedSteps = TUNING.drift.charge1Time / DT; // 36
    expect(Math.abs((enteredAt as number) - expectedSteps)).toBeLessThanOrEqual(2);

    // Still charging1 well before charge2Time.
    const mid = run(NO_DRIFT, HARD_STEER, Math.round(((TUNING.drift.charge1Time + TUNING.drift.charge2Time) / 2) / DT));
    expect(mid.tier).toBe("charging1");
  });

  it("(c) continues to charging2 after the total charge time (charge2Time) elapses", () => {
    // Find the first step at which the tier becomes charging2; must be ≈ charge2Time/DT.
    let s = NO_DRIFT;
    let enteredAt: number | null = null;
    for (let i = 1; i <= 60 * 5; i++) {
      s = updateDrift(s, HARD_STEER, DT).charge;
      if (s.tier === "charging2") {
        enteredAt = i;
        break;
      }
    }
    expect(enteredAt).not.toBeNull();
    const expectedSteps = TUNING.drift.charge2Time / DT; // 84
    expect(Math.abs((enteredAt as number) - expectedSteps)).toBeLessThanOrEqual(2);

    // Maxed: keeps charging past charge2Time but stays in charging2.
    const over = run(NO_DRIFT, HARD_STEER, Math.round((TUNING.drift.charge2Time + 1) / DT));
    expect(over.tier).toBe("charging2");
  });

  it("(d) release in charging1 → mini; in charging2 → super", () => {
    const c1 = run(NO_DRIFT, HARD_STEER, Math.round(TUNING.drift.charge1Time / DT) + 3);
    expect(c1.tier).toBe("charging1");
    const r1 = updateDrift(c1, input({ steer: 1 }), DT); // drift released
    expect(r1.releasedBoost).toBe("mini");
    expect(r1.charge).toEqual({ tier: "none", chargeTime: 0 });

    const c2 = run(NO_DRIFT, HARD_STEER, Math.round(TUNING.drift.charge2Time / DT) + 3);
    expect(c2.tier).toBe("charging2");
    const r2 = updateDrift(c2, input({ steer: 1 }), DT);
    expect(r2.releasedBoost).toBe("super");
  });

  it("(e) releasing without ever having charged → no boost", () => {
    // Never entered drift at all.
    expect(updateDrift(NO_DRIFT, input(), DT).releasedBoost).toBeUndefined();

    // Drift held for a single frame (below charge1Time), then released.
    const oneFrame = updateDrift(NO_DRIFT, HARD_STEER, DT);
    expect(oneFrame.charge.tier).toBe("none");
    const r = updateDrift(oneFrame.charge, input({ steer: 1 }), DT);
    expect(r.releasedBoost).toBeUndefined();
  });

  it("(f) drift held with |steer| ≤ 0.3 pauses the timer rather than resetting it", () => {
    // Charge to just under charge1Time…
    const partial = run(NO_DRIFT, HARD_STEER, Math.round(TUNING.drift.charge1Time / DT) - 5);
    expect(partial.tier).toBe("none");

    // …hold drift with low steer for a while: timer frozen.
    const paused = run(partial, input({ drifting: true, steer: 0.2 }), 60 * 3);
    expect(paused.chargeTime).toBeCloseTo(partial.chargeTime, 10);

    // …resume hard steering: completes charging1 in the remaining time (+2 steps float slack).
    const resumed = run(paused, HARD_STEER, Math.round(TUNING.drift.charge1Time / DT) - Math.round(partial.chargeTime / DT) + 2);
    expect(resumed.tier).toBe("charging1");
  });

  it("is pure: returns fresh objects and never mutates its input", () => {
    const state: DriftCharge = { tier: "charging1", chargeTime: 0.5 };
    const before = { ...state };
    updateDrift(state, HARD_STEER, DT);
    expect(state).toEqual(before);

    const a = updateDrift(NO_DRIFT, HARD_STEER, DT);
    const b = updateDrift(NO_DRIFT, HARD_STEER, DT);
    expect(a.charge).toEqual(b.charge);
    expect(a.charge).not.toBe(b.charge); // fresh object each call
  });
});
