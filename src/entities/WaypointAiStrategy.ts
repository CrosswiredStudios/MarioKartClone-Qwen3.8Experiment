/**
 * Waypoint-following AI (06-phase-4-race-loop-and-ai.md, Step 2). Pure, no Babylon.
 *
 * Each step the strategy looks a speed-scaled distance AHEAD along the spline and
 * steers toward that waypoint: signed angle error → clamped steer; large errors
 * scale throttle down to a floor so the kart slows into tight corners instead of
 * plowing off-road. AI never handbrakes or drifts in Phase 4 (drifting is a player
 * skill; Phase 5 may add it).
 *
 * Also exports {@link rubberBandMultiplier}, the pure catch-up/penalty helper used by
 * RaceController (NOT the strategy) to rewrite each AI's accelScale.
 */

import { TUNING } from "../data/tuning.js";
import type { TrackSpline } from "../tracks/TrackSpline.js";
import type { IAiStrategy, RaceView } from "./IAiStrategy.js";
import type { KartEntity } from "./KartEntity.js";
import type { DriveInput } from "./KartPhysics.js";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalize an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = (a + Math.PI) % twoPi;
  if (x < 0) x += twoPi;
  return x - Math.PI;
}

/** Throttle floor once the angle error exceeds the "full throttle" band. */
const THROTTLE_FLOOR = 0.25;
/** Angle error (rad) up to which the AI holds full throttle. */
const FULL_THROTTLE_BAND = 0.5;

export class WaypointAiStrategy implements IAiStrategy {
  constructor(private readonly spline: TrackSpline) {}

  decide(kart: KartEntity, _view: RaceView, _dt: number): DriveInput {
    const ownT = this.spline.closestPoint({ x: kart.state.pos.x, z: kart.state.pos.z }).t;
    // Lookahead in meters grows with speed so the target stays ahead at high velocity.
    const lookAheadM = TUNING.ai.waypointLookahead * (0.5 + kart.state.speedRatio);
    const targetT = (ownT + lookAheadM / this.spline.length) % 1;
    const w = this.spline.pointAt(targetT);

    // Signed angle error to the waypoint, normalized to (-π, π]. Heading 0 = +Z forward.
    const desired = Math.atan2(w.x - kart.state.pos.x, w.z - kart.state.pos.z);
    const err = normalizeAngle(desired - kart.state.heading);

    const steer = clamp(err, -1, 1); // clamped signed angle error
    // Full throttle on track; past the band, scale down proportionally to a floor.
    const absErr = Math.abs(err);
    const throttle = absErr <= FULL_THROTTLE_BAND ? 1 : Math.max(THROTTLE_FLOOR, 1 - (absErr - FULL_THROTTLE_BAND));

    return Object.freeze({ throttle, steer, drifting: false, useItem: false });
  }
}

/**
 * Pure rubber-band helper. `gapMeters > 0` → this AI is BEHIND the player and gets a
 * catch-up accel boost; `< 0` → ahead of the player and gets a symmetric penalty.
 * Linear at TUNING.ai.rubberBandFactor per 50 m, capped to [0.75, 1.25] so even a huge
 * gap never produces teleport-y acceleration (see Step 2 rationale).
 */
export function rubberBandMultiplier(gapMeters: number): number {
  return clamp(1 + (TUNING.ai.rubberBandFactor * gapMeters) / 50, 0.75, 1.25);
}
