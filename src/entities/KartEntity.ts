/**
 * A kart in the world: identity + mutable simulation state (05-phase-3-track-system.md).
 *
 * `state` is mutated ONLY by the owning controller's fixed-step update
 * (FreeDriveScene this phase, RaceController in Phase 4) — never by render code.
 *
 * Spawn convention: a kart spawns just BEHIND the start line with
 * `checkpointIdx = -1` ("no checkpoint passed yet" sentinel). Its first real
 * checkpoint to hit is 0 (the line itself); per LapTracker's rules that crossing
 * only completes lap 1 after cp0..cp7 have been passed in order — i.e. the first
 * FULL loop completes lap 1, exactly as the plan requires.
 */

import type { Vec3 } from "../core/Vec.js";
import type { KartState, PhysicsProfile } from "./KartPhysics.js";
import { NO_DRIFT } from "./DriftController.js";
import { initialLapState } from "../tracks/LapTracker.js";

/**
 * Physics rewrite — opaque per-kart rigid-body drive handle. The concrete class lives in
 * src/entities/KartBody.ts (Babylon/Havok); this structural interface keeps the race
 * controller core/Babylon-free. Null in headless tests → the legacy kinematic path runs
 * unchanged, so the determinism gate and unit tests are unaffected.
 */
export interface IKartDrive {
  /** Body → state: read pos/heading/speed/vy from the rigid body BEFORE the brain step. */
  sync(k: KartEntity): void;
  /** Brain target → body: apply drive force + yaw rate AFTER `k.state = next`. */
  apply(next: KartState, dt: number): void;
  /** Scale forward speed in place (impulse). Lateral velocity is preserved. */
  scaleSpeed(factor: number): void;
  /** Set forward speed directly (impulse) — e.g. bullet-bill snap to 45 m/s. */
  setSpeed(speed: number): void;
  /** One-frame yaw nudge (rad) — makes a shell-hit heading kick physically real. */
  kickYaw(deltaRad: number, dt: number): void;
}

export interface KartEntity {
  readonly id: string;
  readonly name: string;
  readonly isPlayer: boolean;
  /** PBR tint [r,g,b] each 0..1 — the character's color. */
  readonly color: [number, number, number];
  state: KartState; // mutable ONLY inside the controller's fixed-step update
  /**
   * Phase 4 (06-phase-4-race-loop-and-ai.md Step 2): AI skill factor baked into top
   * speed. Player = 1.0; each AI draws one value from the seeded RNG in
   * [1 − TUNING.ai.speedVariance, 1 + …]. Read by stepKart to scale maxSpeed.
   */
  readonly topSpeedScale: number;
  /**
   * Rubber-band multiplier, rewritten by RaceController each step (default 1).
   * >1 when the AI is behind the player (catch-up boost), <1 when ahead. Read by
   * stepKart to scale acceleration. Mutable ONLY inside the controller's update.
   */
  accelScale: number;
  /**
   * Phase 5 — oil-slick re-trigger guard. Records the index of the last hazard patch
   * that granted this kart a skid, so sitting on the same patch doesn't re-skid every
   * frame (per-patch memory is intentional: patches are avoidable hazards). Mutable
   * ONLY inside the controller's update.
   */
  lastOilPatchId: number | null;
  /**
   * Physics rewrite — the kart's rigid-body drive (set by the scene on enter, cleared on
   * exit). Undefined/null → legacy kinematic integration in stepKart is authoritative.
   */
  drive?: IKartDrive | null;
}

export interface CreateKartOpts {
  id: string;
  name: string;
  isPlayer: boolean;
  color: [number, number, number];
  pos: Vec3;
  heading: number;
  profile?: PhysicsProfile; // defaults to a balanced stat-3 kart (free-drive)
  topSpeedScale?: number; // Phase 4 — default 1.0 (player / free-drive karts)
}

const DEFAULT_PROFILE: PhysicsProfile = { topSpeedStat: 3, accelStat: 3, steerEaseRate: 0 };

export function createKart(opts: CreateKartOpts): KartEntity {
  const lapState = initialLapState();
  return {
    id: opts.id,
    name: opts.name,
    isPlayer: opts.isPlayer,
    color: [...opts.color] as [number, number, number],
    topSpeedScale: opts.topSpeedScale ?? 1,
    accelScale: 1, // rubber-band default; RaceController rewrites each step (Phase 4)
    lastOilPatchId: null, // Phase 5 oil-slick re-trigger guard
    state: {
      pos: { ...opts.pos },
      vy: 0, // grounded at spawn (pos.y is set to the surface height by callers)
      heading: opts.heading,
      speed: 0,
      lap: lapState.lap,
      checkpointIdx: lapState.lastCheckpointIdx, // -1 spawn sentinel (see header)
      item: null,
      charging: null,
      statusEffects: [],
      driftCharge: { ...NO_DRIFT },
      speedRatio: 0,
      profile: opts.profile ?? DEFAULT_PROFILE,
      smoothedSteer: 0, // no turn in progress at spawn
    },
  };
}
