/**
 * Arcade kart physics — pure, no Babylon (01-architecture.md §4).
 *
 * `stepKart` advances one fixed step and returns a FRESH state object; it never
 * mutates its inputs. All magic numbers come from TUNING (src/data/tuning.ts).
 *
 * AS-BUILT DEVIATION (documented per plan): the architecture signature is
 * `stepKart(state, input, surface, dt)` and the doc says to "keep that signature by
 * storing the profile in an extended state field" — so KartState carries a
 * `profile: PhysicsProfile` set at kart creation. Everything else follows the doc's
 * exact physics model (see 05-phase-3-track-system.md, "Physics model (exact)").
 */

import type { Vec3 } from "../core/Vec.js";
import { TUNING } from "../data/tuning.js";
import type { DriftCharge } from "./DriftController.js";

/** Item ids — the full set is defined in Phase 5; declared here because KartState.item needs it. */
export type ItemId =
  | "mushroom"
  | "greenShell"
  | "redShell"
  | "blueShell"
  | "star"
  | "lightning"
  | "banana"
  | "bulletBill";

/**
 * Active timed effects on a kart (Phase 5 completes the union).
 *
 * `boost` is unified across shroom / drift-turbo: it carries an absolute target
 * speed and, while active, forces `speed = max(speed, boost.speed)` and raises the
 * effective cap so the kart can actually reach it. The controller still knows which
 * tier fired (for the `kart:boosted` event) — physics only needs the number.
 */
export type StatusEffect =
  | { kind: "boost"; speed: number; remaining: number } // shroom / drift turbo: force speed while active
  | { kind: "star"; remaining: number } // invincible + sustained boost (speed handled in controller)
  | { kind: "shrink"; remaining: number } // lightning: maxSpeed ×0.75, steerRate ×0.8
  | { kind: "skid"; remaining: number } // banana/oil: spin replaces steering, throttle ignored
  | { kind: "hit"; remaining: number } // shell impact: speed ×0.3 (heading kick applied once at grant)
  | { kind: "bulletBill"; remaining: number }; // transform: forced straight-line speed

/** Per-kart stat-driven physics, set once at creation (combined character+vehicle stats). */
export interface PhysicsProfile {
  readonly topSpeedStat: number; // 1..5
  readonly accelStat: number; // 1..5
}

export type SurfaceKind = "road" | "offRoad" | "oilSlick";

/**
 * Elevation sampler (Phase 4.1). The track's pure HeightField satisfies this —
 * physics stays Babylon-free and headless-testable.
 */
export interface TerrainSampler {
  readonly heightAt: (x: number, z: number) => number;
}

export interface DriveInput {
  readonly throttle: number; // -1..1 (negative = brake/reverse)
  readonly steer: number; // -1..1
  readonly drifting: boolean; // Space held while turning
  readonly useItem: boolean; // edge-triggered, consumed by RaceController
  /**
   * Level-triggered: true while the item button is held. The RaceController uses
   * this for the hold-to-charge mechanic on chargeable items (green/red shell,
   * banana): the item is "loaded" on the kart's rear while held and fires on
   * release. Non-chargeable items still fire on the `useItem` edge. AI karts
   * always report false (they fire immediately).
   */
  readonly itemHeld: boolean;
}

export interface KartState {
  pos: Vec3;
  vy: number; // vertical velocity, m/s (negative = falling); 0 while grounded
  heading: number; // radians; 0 = +Z forward
  speed: number; // m/s, signed (negative = reversing)
  lap: number;
  checkpointIdx: number; // 0-based
  item: ItemId | null;
  /**
   * Hold-to-charge (Phase 5.1): the item currently "loaded" on the kart's rear
   * while the player holds the item button. Set by the RaceController for
   * chargeable items (green/red shell, banana); null when not charging. The
   * render layer reads this to show the charge indicator; the item is consumed
   * on release.
   */
  charging: ItemId | null;
  statusEffects: StatusEffect[];
  driftCharge: DriftCharge; // full wrapper {tier, chargeTime} — see DriftController header
  speedRatio: number; // 0..1 normalized top speed (audio/camera)
  profile: PhysicsProfile; // AS-BUILT: per-kart stats carried in state (see header)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Base top speed for a kart's stat profile. */
export function maxSpeedFor(profile: PhysicsProfile): number {
  return TUNING.physics.maxSpeedBase * (0.8 + 0.04 * profile.topSpeedStat);
}

/** Sustained-boost target while starred (shroomBoost × 0.9, per the Phase 5 rules). */
export function starBoostSpeed(): number {
  return TUNING.items.shroomBoost * 0.9;
}

/**
 * Advances one fixed step. Pure: returns a new state, mutates nothing.
 *
 * `topSpeedScale` / `accelScale` (Phase 4) are optional trailing params defaulting to 1 so the
 * Phase 3 contract and all existing tests are unchanged. RaceController passes the owning
 * KartEntity's scales; free-drive omits them (player kart, scale 1). They live on the entity —
 * not KartState — because physics owns speed caps but the controller owns per-racer skill/rubber-band.
 *
 * `terrain` (Phase 4.1) is optional: when present the kart is glued to the surface
 * (`pos.y = heightAt`) and a mild slope model scales the top-speed cap — uphill slows
 * slightly, downhill speeds up (TUNING.terrain.slopeFactor / slopeClamp). Omitted →
 * flat-world behavior exactly as before.
 */
export function stepKart(
  state: KartState,
  input: DriveInput,
  surface: SurfaceKind,
  dt: number,
  topSpeedScale = 1,
  accelScale = 1,
  terrain?: TerrainSampler,
): KartState {
  const p = TUNING.physics;
  const it = TUNING.items;
  const maxSpeed = maxSpeedFor(state.profile) * topSpeedScale;

  // ── status effects: decrement + drop expired (fresh array, never mutate) ────────
  let skidActive = false;
  let bulletBillActive = false;
  let starActive = false;
  let shrinkActive = false;
  let hitActive = false;
  let boostSpeed: number | null = null; // highest active boost target (shroom / drift turbo)
  const statusEffects: StatusEffect[] = [];
  for (const fx of state.statusEffects) {
    const remaining = fx.remaining - dt;
    if (remaining <= 0) continue; // expired this step
    switch (fx.kind) {
      case "skid":
        skidActive = true;
        break;
      case "bulletBill":
        bulletBillActive = true;
        break;
      case "star":
        starActive = true;
        break;
      case "shrink":
        shrinkActive = true;
        break;
      case "hit":
        hitActive = true;
        break;
      case "boost":
        if (boostSpeed === null || fx.speed > boostSpeed) boostSpeed = fx.speed;
        break;
    }
    statusEffects.push(remaining < fx.remaining ? { ...fx, remaining } : fx);
  }

  // ── mild slope model (Phase 4.1): uphill slows slightly, downhill speeds up ───
  let slopeScale = 1;
  if (terrain) {
    const d = TUNING.terrain.slopeSampleDist;
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    // Central difference along the travel direction; >0 means uphill.
    const gradient =
      (terrain.heightAt(state.pos.x + fx * d, state.pos.z + fz * d) -
        terrain.heightAt(state.pos.x - fx * d, state.pos.z - fz * d)) /
      (2 * d);
    slopeScale = 1 - clamp(gradient, -TUNING.terrain.slopeClamp, TUNING.terrain.slopeClamp) * TUNING.terrain.slopeFactor;
  }

  // ── effective top speed: base × hit/shrink caps, surface drag, boost override ───
  let cap = maxSpeed;
  if (hitActive) cap *= it.hitSlowFactor; // shell impact: crawl at 30%
  if (shrinkActive) cap *= it.shrinkMaxSpeedFactor; // lightning: 75% top speed
  let effectiveMax = cap * (surface === "offRoad" ? p.offRoadDrag : 1);
  const boostTarget = starActive ? Math.max(boostSpeed ?? 0, starBoostSpeed()) : boostSpeed;
  if (boostTarget !== null) {
    // Boosts override the cap; off-road still drags a boosted kart down proportionally.
    effectiveMax = surface === "offRoad" ? Math.max(effectiveMax, boostTarget * p.offRoadDrag) : Math.max(effectiveMax, boostTarget);
  }
  effectiveMax *= slopeScale;

  let speed = state.speed;

  // ── throttle / brake / reverse (ignored while skidding — the kart coasts) ───────
  if (!skidActive && !bulletBillActive) {
    if (input.throttle > 0 && speed < effectiveMax) {
      const accel = p.accelBase * (0.8 + 0.04 * state.profile.accelStat) * accelScale;
      speed += input.throttle * accel * dt;
    } else if (input.throttle < 0) {
      // Braking is stronger than acceleration; below zero it becomes reverse.
      speed += input.throttle * p.brakeForce * accelScale * dt;
    }

    // ── drag: terminal-speed model ───────────────────────────────────────────
    if (speed > effectiveMax) {
      const k = surface === "offRoad" ? p.dragCoef * 2 : p.dragCoef;
      speed -= (speed - effectiveMax) * Math.min(1, k * dt);
    } else if ((speed > 0 && input.throttle <= 0) || (speed < 0 && input.throttle >= 0)) {
      // Coasting with no throttle pushing that way: decay toward a stop.
      speed -= speed * p.dragCoef * dt;
    }

    // Boost/star: force at least the boost target while active (brake still works above it).
    if (boostTarget !== null && speed < boostTarget) {
      speed = boostTarget;
    }
  } else if (skidActive) {
    // Skidding: no engine, no brake — just coast with normal drag toward the cap.
    if (speed > effectiveMax) {
      const k = surface === "offRoad" ? p.dragCoef * 2 : p.dragCoef;
      speed -= (speed - effectiveMax) * Math.min(1, k * dt);
    } else {
      speed -= speed * p.dragCoef * dt;
    }
  }

  if (speed > effectiveMax) speed = effectiveMax;
  if (speed < p.reverseMax) speed = p.reverseMax;

  // Bullet Bill: forced straight-line speed, ignoring throttle/brake/drag entirely.
  if (bulletBillActive) speed = it.bulletBillSpeed;

  // ── steering ─────────────────────────────────────────────────────────────────────
  let heading = state.heading;
  if (skidActive) {
    // Skid: a fixed spin replaces steering; throttle/steer inputs are ignored.
    heading += it.skidSpinRate * dt * Math.sign(speed || 1);
  } else if (!bulletBillActive) {
    let steer = input.steer;
    if (shrinkActive) steer *= it.shrinkSteerFactor; // lightning: reduced steering authority
    const speedFactor = clamp(Math.abs(speed) / (maxSpeed * 0.4), 0, 1);
    const reverseSign = speed < 0 ? -1 : 1;
    const steerAngle =
      steer * p.steerRateBase * speedFactor * reverseSign * (input.drifting ? 1.35 : 1);
    heading += steerAngle * dt;
    // bulletBill: heading frozen (no steering) — falls through with no change.
  }

  // ── integration (heading 0 = +Z forward; karts are glued to the surface) ───────
  const newX = state.pos.x + Math.sin(heading) * speed * dt;
  const newZ = state.pos.z + Math.cos(heading) * speed * dt;

  // ── vertical: simple gravity (Phase 4.1). The kart is glued to the surface
  // while grounded; when the surface falls away faster than it can follow (a
  // cliff drop / steep downhill at speed) it goes airborne, keeps its horizontal
  // momentum, accelerates under gravity, and lands on contact.
  let newY = state.pos.y;
  let newVy = state.vy;
  if (terrain) {
    const groundY = terrain.heightAt(newX, newZ);
    if (state.pos.y > groundY + TUNING.terrain.airborneEpsilon) {
      // Airborne: integrate vertical velocity under gravity.
      newVy = state.vy - TUNING.terrain.gravity * dt;
      newY = state.pos.y + newVy * dt;
      if (newY <= groundY) { newY = groundY; newVy = 0; } // landed
    } else {
      // Grounded: snap to the surface, no vertical velocity.
      newY = groundY;
      newVy = 0;
    }
  }

  const pos: Vec3 = { x: newX, y: newY, z: newZ };

  return {
    ...state,
    pos,
    vy: newVy,
    heading,
    speed,
    statusEffects,
    speedRatio: clamp(Math.abs(speed) / maxSpeed, 0, 1),
  };
}
