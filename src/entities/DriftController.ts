/**
 * Drift charge tiers — pure, no Babylon (01-architecture.md §4).
 *
 * AS-BUILT DEVIATION (documented per plan): the doc signature is
 * `updateDrift(state: DriftChargeState, input, dt) → { charge, releasedBoost? }`, but
 * the tier transition needs a running charge timer that callers must persist. We
 * therefore extend the state to `DriftCharge { tier, chargeTime }` — callers store it
 * on the kart (KartEntity keeps both the tier for the renderer and this wrapper).
 *
 * Rules (from 05-phase-3-track-system.md, resolved against its test list):
 * - Charging begins when drifting && |steer| > 0.3; the tier is still "none" until
 *   charge1Time (0.6s) of continuous charging accumulates → then "charging1".
 * - After the full charge2Time (1.4s total) → "charging2" (super, maxed).
 *   (The doc's prose says "enter charging1 when drifting && |steer|>0.3" and
 *   "after charge1Time → charging2", but its test list — which is the executable
 *   spec — requires: (b) enters charging1 after charge1Time ± dt, (c) continues to
 *   charging2 after total charge time (charge2Time), (e) releasing without ever
 *   having charged returns no boost. The tier schedule above satisfies all of them.)
 * - Releasing drift in "charging1" → releasedBoost "mini"; in "charging2" → "super";
 *   releasing before any tier was reached → undefined.
 * - Drift held with |steer| ≤ 0.3 PAUSES the timer (does not reset it).
 * - Releasing resets to none.
 */

import { TUNING } from "../data/tuning.js";
import type { DriveInput } from "./KartPhysics.js";

export type DriftChargeState = "none" | "charging1" | "charging2";
export type BoostTier = "mini" | "super";

/** Persistent drift state: tier + accumulated charge seconds. */
export interface DriftCharge {
  tier: DriftChargeState;
  chargeTime: number; // seconds of continuous charging (capped at charge2Time)
}

export const NO_DRIFT: Readonly<DriftCharge> = Object.freeze({ tier: "none", chargeTime: 0 });

const STEER_THRESHOLD = 0.3;

export interface DriftResult {
  charge: DriftCharge;
  releasedBoost?: BoostTier;
}

/** Advances drift charging one fixed step. Pure: returns a fresh state, mutates nothing. */
export function updateDrift(state: DriftCharge, input: DriveInput, dt: number): DriftResult {
  const d = TUNING.drift;

  // Released → reset to none; grant boost only if a charge tier was actually reached.
  // Releasing before any tier (chargeTime < charge1Time) gives nothing.
  if (!input.drifting) {
    let releasedBoost: BoostTier | undefined;
    if (state.tier === "charging2") releasedBoost = "super";
    else if (state.tier === "charging1") releasedBoost = "mini";
    return { charge: { tier: "none", chargeTime: 0 }, ...(releasedBoost ? { releasedBoost } : {}) };
  }

  // Drifting but not turning hard enough → pause (do NOT reset) the timer.
  if (Math.abs(input.steer) <= STEER_THRESHOLD) {
    return { charge: state };
  }

  const chargeTime = state.chargeTime + dt;
  // Tier schedule (see header): none → charging1 at charge1Time → charging2 at charge2Time.
  let tier: DriftChargeState;
  if (chargeTime >= d.charge2Time) tier = "charging2";
  else if (chargeTime >= d.charge1Time) tier = "charging1";
  else tier = state.tier === "none" ? "none" : state.tier;

  return { charge: { tier, chargeTime } };
}
