/**
 * Pure math for the hybrid rigid-body drive model (physics rewrite). Babylon-free —
 * unit-testable in Node, same as KartPhysics.
 *
 * The "brain" is stepKart: it already encodes every TUNING curve + status effect and
 * produces a target speed/heading each fixed step. The "muscle" (KartBody) chases that
 * target on a real Havok body with bounded authority, so bumps perturb the kart for a
 * visible moment instead of being cancelled in one frame (arcade feel).
 */

import { TUNING } from "../data/tuning.js";
import type { KartState, TerrainSampler } from "./KartPhysics.js";

/**
 * The drive impulse (kg·m/s) that closes the gap between the body's current forward
 * speed and the brain's target, clamped to ±maxDriveAccelMps2 × mass × dt.
 *
 * Positive = accelerate along forward; negative = brake/reverse. Bounded authority is
 * what makes a bump matter: after an impact steals 10 m/s of forward velocity, the
 * engine needs ~10/40 ≈ 0.25 s to claw it back instead of snapping instantly.
 */
export function driveImpulse(
  currentForwardSpeed: number,
  targetSpeed: number,
  massKg: number,
  dt: number,
  // `number` (not the literal type from `TUNING ... as const`) so callers can pass a scaled value.
  maxAccelMps2: number = TUNING.physicsWorld.maxDriveAccelMps2,
): number {
  const delta = targetSpeed - currentForwardSpeed;
  const maxDelta = maxAccelMps2 * dt;
  return Math.sign(delta) * Math.min(Math.abs(delta), maxDelta) * massKg;
}

/**
 * Clamped uphill gradient (dy/dx along heading) at a world XZ position. Returns 0 when
 * flat or downhill; up to TUNING.terrain.slopeClamp when climbing steeply. Reuses the exact
 * central-difference convention from stepKart's slope model so the muscle and brain agree on
 * what "uphill" means. KartBody scales drive authority by (1 + uphillPowerFactor × g).
 */
export function uphillGradient(
  terrain: TerrainSampler,
  x: number,
  z: number,
  heading: number,
): number {
  const d = TUNING.terrain.slopeSampleDist;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // Central difference along the travel direction; >0 means uphill.
  const gradient =
    (terrain.heightAt(x + fx * d, z + fz * d) - terrain.heightAt(x - fx * d, z - fz * d)) /
    (2 * d);
  return Math.max(0, Math.min(gradient, TUNING.terrain.slopeClamp));
}

/**
 * Yaw rate (rad/s) the brain wants this step: Δheading/dt from the last state. KartBody
 * sets the body's angular velocity to exactly this (X/Z zeroed → yaw-only rotation).
 */
export function targetYawRate(prevHeading: number, nextHeading: number, dt: number): number {
  return (nextHeading - prevHeading) / dt;
}

/** Forward unit vector for a heading (heading 0 = +Z, matches stepKart's integration). */
export function forwardVec(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Reconstruct the brain's target speed from a KartState WITHOUT re-running stepKart.
 * Used by KartBody when it needs to know "what speed does the brain want right now" —
 * but in practice KartBody just reads `next.speed` after the brain step, so this helper
 * exists for tests and for the scaleSpeed/setSpeed impulse paths that need a reference.
 */
export function targetSpeedOf(state: KartState): number {
  return state.speed;
}
