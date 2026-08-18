/**
 * Shell projectile physics — pure, no Babylon (07-phase-5 Step 4–5).
 *
 * `stepShell` advances one fixed step for a green/red/blue shell and returns the new
 * state plus which kart (if any) was struck this step. It is deterministic: all
 * randomness lives in the RaceController, never here. World objects are plain records.
 *
 * Kinds:
 *  - green: straight travel, bounces off barriers AND off hit karts (reflects about
 *    the target's forward axis), removed after `shellBounceMax` total bounces.
 *  - red:   homes to the nearest kart ahead within `redRangeM`, speed held at
 *    `redSpeedFactor × owner maxSpeed`; consumed on hit; expires after `redExpiresSec`.
 *  - blue:  targets the current rank-1 (non-finished) kart regardless of distance,
 *    speed `blueSpeedFactor × maxSpeedBase`; consumed on hit; expires after `blueExpiresSec`.
 */

import type { Vec3 } from "../core/Vec.js";
import { TUNING } from "../data/tuning.js";
import type { KartEntity } from "../entities/KartEntity.js";
import type { TrackSpline } from "../tracks/TrackSpline.js";

export type ShellKind = "green" | "red" | "blue";

/** A live shell in the world. Mutated only by stepShell (which returns a fresh copy). */
export interface ShellState {
  pos: Vec3; // y is fixed at spawn height — shells travel in the XZ plane
  vel: Vec3; // m/s, XZ motion (y unused)
  kind: ShellKind;
  ownerId: string;
  bounces: number; // wall + kart bounces (green counts toward the limit)
  expiresAt: number; // sim-time seconds; Infinity for green (bounded by bounce limit)
  spawnAt: number; // sim-time of creation — owner immunity window starts here
}

/** Init passed to RaceController.spawnProjectile for a shell. */
export interface ShellProjectileInit {
  readonly kind: ShellKind;
  readonly owner: KartEntity;
}

/** Init for a Bullet Bill (owner transforms, not a projectile). */
export interface BulletBillInit {
  readonly owner: KartEntity;
}

export type ProjectileInit = ShellProjectileInit | BulletBillInit;

/** Optional per-step context the controller supplies (sim time + targeting data). */
export interface StepShellOpts {
  readonly simTime: number; // current sim time — expiry + owner immunity
  /** Karts that have finished the race (excluded from blue-shell targeting). */
  readonly finishedIds?: ReadonlySet<string>;
  /** Current standings snapshot (rank 1 first) — used for blue-shell leader lookup. */
  readonly standings?: ReadonlyArray<{ id: string; rank: number }>;
}

export interface StepShellResult {
  shell: ShellState; // fresh state (pos/vel/bounces updated)
  hit?: string; // kart id struck this step, if any
  removed?: boolean; // true → controller should drop this shell (bounce limit / expiry)
}

/** Unit forward vector of a heading in the XZ plane (heading 0 = +Z). */
function forwardOf(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function len2(x: number, z: number): number {
  return Math.hypot(x, z);
}

/**
 * Build a live ShellState from an init at `simTime`. Direction starts along the
 * owner's forward; red/blue then home each step. Speed is fixed per kind here and
 * held constant by stepShell (red/blue) — green keeps its launch speed.
 */
export function makeShell(init: ShellProjectileInit, simTime: number): ShellState {
  const o = init.owner.state;
  const f = forwardOf(o.heading);
  let speed: number;
  let expiresAt: number;
  switch (init.kind) {
    case "green":
      // 2× the owner's CURRENT speed at fire (a slow owner fires a weak shell).
      speed = Math.max(1, TUNING.items.greenSpeedFactor * o.speed);
      expiresAt = Infinity;
      break;
    case "red": {
      const maxSpeed = TUNING.physics.maxSpeedBase * (0.8 + 0.04 * o.profile.topSpeedStat) * init.owner.topSpeedScale;
      speed = TUNING.items.redSpeedFactor * maxSpeed;
      expiresAt = simTime + TUNING.items.redExpiresSec;
      break;
    }
    case "blue":
      speed = TUNING.items.blueSpeedFactor * TUNING.physics.maxSpeedBase;
      expiresAt = simTime + TUNING.items.blueExpiresSec;
      break;
  }
  return {
    pos: { x: o.pos.x, y: o.pos.y + 0.5, z: o.pos.z },
    vel: { x: f.x * speed, y: 0, z: f.z * speed },
    kind: init.kind,
    ownerId: init.owner.id,
    bounces: 0,
    expiresAt,
    spawnAt: simTime,
  };
}

/**
 * Minimum distance from point P to the segment AB in the XZ plane. Used for swept
 * shell collision so a fast shell can't tunnel past a kart between fixed steps.
 */
function distToSegment(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const len2 = abx * abx + abz * abz;
  // Clamp the projection parameter to [0,1] (closest point on the segment).
  let t = len2 > 0 ? (apx * abx + apz * abz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

/** Rotate a 2D velocity about Y by `turn` radians (positive = clockwise from +Z). */
function rotateVel(vel: { x: number; z: number }, turn: number): { x: number; z: number } {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  // World XZ with heading convention (x=sin, z=cos): a +turn about Y maps
  // (x,z) → (x·c + z·s, −x·s + z·c).
  return { x: vel.x * c + vel.z * s, z: -vel.x * s + vel.z * c };
}

/** Signed angle from direction a to b in the XZ plane, in (−π, π]. */
function signedAngle(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const cross = a.x * b.z - a.z * b.x; // sin of (b − a) under the heading convention
  const dot = a.x * b.x + a.z * b.z;
  return Math.atan2(cross, dot);
}

/**
 * Advance one shell by `dt`. Pure — returns a fresh ShellState. Handles integration,
 * wall bounce (reflection about the barrier normal), homing steer for red/blue, kart
 * collision (with owner immunity), green's kart-bounce continuation, and expiry.
 */
export function stepShell(
  shell: ShellState,
  karts: ReadonlyArray<KartEntity>,
  spline: TrackSpline,
  dt: number,
  opts: StepShellOpts,
): StepShellResult {
  const it = TUNING.items;
  const prevPos = { x: shell.pos.x, z: shell.pos.z }; // for swept collision below
  let pos = { ...shell.pos };
  let vel = { x: shell.vel.x, z: shell.vel.z };
  let bounces = shell.bounces;

  // ── expiry (red/blue); green is bounded by bounce limit instead ────────────────
  if (opts.simTime >= shell.expiresAt) {
    return { shell: { ...shell, pos, vel: { x: vel.x, y: 0, z: vel.z } }, removed: true };
  }

  // ── homing steer for red/blue (rotate velocity toward target at a bounded rate) ─
  if (shell.kind === "red" || shell.kind === "blue") {
    const target = findTarget(shell, karts, spline, opts);
    if (target) {
      const dx = target.state.pos.x - pos.x;
      const dz = target.state.pos.z - pos.z;
      const dist = len2(dx, dz);
      if (dist > 1e-4) {
        const desired = { x: dx / dist, z: dz / dist };
        const speedNow = len2(vel.x, vel.z) || 1;
        const velDir = { x: vel.x / speedNow, z: vel.z / speedNow };
        // signedAngle(a,b) returns (h_a − h_b); the turn that rotates velDir TOWARD
        // desired is therefore the NEGATIVE of that. (Steering by +err would diverge.)
        const err = -signedAngle(velDir, desired);
        const maxTurn = it.shellHomingRate * dt;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, err));
        if (turn !== 0) {
          const rotated = rotateVel({ x: vel.x, z: vel.z }, turn);
          // Hold |vel| at the kind's speed.
          const rLen = len2(rotated.x, rotated.z) || 1;
          vel = { x: (rotated.x / rLen) * speedNow, z: (rotated.z / rLen) * speedNow };
        }
      }
    }
  }

  // ── integrate ───────────────────────────────────────────────────────────────────
  pos = { ...pos, x: pos.x + vel.x * dt, z: pos.z + vel.z * dt };

  // ── wall bounce (barrier at roadWidth/2 from the centerline) ────────────────────
  const cp = spline.closestPoint({ x: pos.x, z: pos.z });
  if (cp.distance > spline.roadWidth / 2) {
    const center = spline.pointAt(cp.t);
    let nx = pos.x - center.x;
    let nz = pos.z - center.z;
    const nl = len2(nx, nz) || 1;
    nx /= nl;
    nz /= nl; // unit outward normal from centerline to shell
    const dot = vel.x * nx + vel.z * nz;
    if (dot > 0) {
      // Reflect v' = v − 2(v·n)n — preserves |v| exactly.
      vel = { x: vel.x - 2 * dot * nx, z: vel.z - 2 * dot * nz };
      // Push back just inside the barrier so it can't tunnel out next step.
      const inset = spline.roadWidth / 2 - 0.1;
      pos = { ...pos, x: center.x + nx * inset, z: center.z + nz * inset };
    }
    bounces += 1;
    if (shell.kind === "green" && bounces > it.shellBounceMax) {
      return { shell: { ...shell, pos, vel: { x: vel.x, y: 0, z: vel.z }, bounces }, removed: true };
    }
  }

  // ── kart collision (swept: the motion segment must pass within hit radius) ─────
  // A shell moves ~0.7–1 m per step, comparable to the 0.8 m hit radius, so a plain
  // point-in-radius test can tunnel through a target between steps. Testing distance
  // from each kart to the prevPos→pos segment makes hits deterministic and robust.
  const ownerImmune = opts.simTime - shell.spawnAt < it.ownerImmunitySec;
  let hitId: string | undefined;
  for (const k of karts) {
    if (k.id === shell.ownerId && ownerImmune) continue;
    if (distToSegment(k.state.pos.x, k.state.pos.z, prevPos.x, prevPos.z, pos.x, pos.z) < it.shellHitRadiusM) {
      hitId = k.id;
      break;
    }
  }

  let removed = false;
  if (hitId !== undefined) {
    const target = karts.find((k) => k.id === hitId)!;
    if (shell.kind === "green") {
      // Classic rule: bounce off the hit kart and keep flying. Reflect about the
      // target's forward axis, count a bounce, continue until the limit is reached.
      const f = forwardOf(target.state.heading);
      const dot = vel.x * f.x + vel.z * f.z;
      vel = { x: vel.x - 2 * dot * f.x, z: vel.z - 2 * dot * f.z };
      bounces += 1;
      if (bounces > it.shellBounceMax) removed = true;
    } else {
      // Red/blue are consumed on hit.
      removed = true;
    }
  }

  return { shell: { ...shell, pos, vel: { x: vel.x, y: 0, z: vel.z }, bounces }, hit: hitId, removed };
}

/**
 * Find the homing target for a red/blue shell. Red → nearest non-owner kart AHEAD on
 * track (by t-progress) within `redRangeM`. Blue → current rank-1 among non-finished
 * karts regardless of distance. Returns undefined when no valid target exists (the
 * shell then flies straight until expiry).
 */
function findTarget(
  shell: ShellState,
  karts: ReadonlyArray<KartEntity>,
  spline: TrackSpline,
  opts: StepShellOpts,
): KartEntity | null {
  const it = TUNING.items;
  if (shell.kind === "blue") {
    // Rank-1 among non-finished. Prefer the standings snapshot when provided.
    const finished = opts.finishedIds ?? new Set<string>();
    let leader: KartEntity | null = null;
    let bestRank = Infinity;
    for (const row of opts.standings ?? []) {
      if (finished.has(row.id)) continue;
      if (row.rank < bestRank) {
        bestRank = row.rank;
        const k = karts.find((kk) => kk.id === row.id);
        if (k) leader = k;
      }
    }
    // Fallback: highest total progress among non-finished.
    if (!leader && !opts.standings) {
      let bestProg = -Infinity;
      for (const k of karts) {
        if (finished.has(k.id)) continue;
        const t = spline.closestPoint({ x: k.state.pos.x, z: k.state.pos.z }).t;
        const prog = k.state.lap * spline.length + t * spline.length;
        if (prog > bestProg) {
          bestProg = prog;
          leader = k;
        }
      }
    }
    return leader;
  }

  // Red: nearest kart ahead within range. "Ahead" = the kart's wrapped t is just
  // beyond the shell's t (within half a lap), and it's close in world distance.
  const shellCp = spline.closestPoint({ x: shell.pos.x, z: shell.pos.z });
  let best: KartEntity | null = null;
  let bestDist = Infinity;
  for (const k of karts) {
    if (k.id === shell.ownerId) continue;
    const kCp = spline.closestPoint({ x: k.state.pos.x, z: k.state.pos.z });
    // Wrapped delta in t; ahead means a small positive fraction (< half lap).
    let dtT = kCp.t - shellCp.t;
    if (dtT < 0) dtT += 1;
    const ahead = dtT > 0 && dtT < 0.5;
    if (!ahead) continue;
    const dx = k.state.pos.x - shell.pos.x;
    const dz = k.state.pos.z - shell.pos.z;
    const dist = len2(dx, dz);
    if (dist <= it.redRangeM && dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return best;
}
