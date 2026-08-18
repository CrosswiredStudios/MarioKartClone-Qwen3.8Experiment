/**
 * Phase 5, Step 4–5 — ShellProjectile pure step function.
 * Verifies straight travel, wall-bounce reflection (|v'| = |v|), green's bounce-limit
 * removal, red nearest-ahead homing, blue rank-based targeting, and expiry windows.
 */

import { describe, it, expect } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { createKart, type KartEntity } from "../../src/entities/KartEntity.js";
import { makeShell, stepShell, type ShellState } from "../../src/items/ShellProjectile.js";

const DT = 1 / 60;
const spline = new TrackSpline(
  MEADOWS_TRACK.controlPoints,
  MEADOWS_TRACK.roadWidth,
  TUNING.physics.onRoadMargin,
);
const RW_HALF = spline.roadWidth / 2; // barrier distance from centerline

/** Build a kart parked at track fraction `t` with an optional lateral offset (m). */
function kartAt(id: string, t: number, lateral = 0, speed = 0): KartEntity {
  const p = spline.pointAt(t);
  const tan = spline.tangentAt(t);
  const nx = -tan.z; // left normal
  const nz = tan.x;
  const k = createKart({
    id,
    name: id,
    isPlayer: false,
    color: [1, 0.5, 0.2],
    pos: { x: p.x + nx * lateral, y: 0, z: p.z + nz * lateral },
    heading: Math.atan2(tan.x, tan.z),
    profile: { topSpeedStat: 3, accelStat: 3 },
  });
  k.state.speed = speed;
  return k;
}

/** Step a shell until it hits or is removed (or maxSteps). Returns first hit id + errs. */
function stepUntil(
  shell: ShellState,
  karts: KartEntity[],
  optsBase: { simTime: number; finishedIds?: Set<string>; standings?: Array<{ id: string; rank: number }> },
  targetId?: string,
  maxSteps = 600,
): { hit: string | undefined; removed: boolean; steps: number; errs: number[] } {
  let s = shell;
  let simTime = optsBase.simTime;
  const errs: number[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (targetId) {
      const tk = karts.find((k) => k.id === targetId)!;
      const dx = tk.state.pos.x - s.pos.x;
      const dz = tk.state.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const vlen = Math.hypot(s.vel.x, s.vel.z) || 1;
      const cross = (s.vel.x / vlen) * (dz / d) - (s.vel.z / vlen) * (dx / d);
      const dot = (s.vel.x / vlen) * (dx / d) + (s.vel.z / vlen) * (dz / d);
      errs.push(Math.abs(Math.atan2(cross, dot)));
    }
    const r = stepShell(s, karts, spline, DT, { ...optsBase, simTime });
    if (r.hit !== undefined || r.removed) return { hit: r.hit, removed: !!r.removed, steps: i + 1, errs };
    s = r.shell;
    simTime += DT;
  }
  return { hit: undefined, removed: false, steps: maxSteps, errs };
}

describe("green shell — straight travel", () => {
  it("travels in a straight line at constant speed (±2%) with no obstacles", () => {
    const owner = kartAt("shooter", 0.4, 0, 10); // green speed = max(1, 2×10) = 20 m/s
    const shell = makeShell({ kind: "green", owner }, 0);
    expect(Math.hypot(shell.vel.x, shell.vel.z)).toBeCloseTo(20, 6);

    let s = shell;
    for (let i = 1; i <= 30; i++) {
      const r = stepShell(s, [owner], spline, DT, { simTime: i * DT });
      expect(r.removed).toBeFalsy(); // no wall/kart contact on the centerline (owner immune <1s)
      s = r.shell;
    }
    // After 30 steps at 20 m/s it should be ~10 m along its launch direction.
    const dx = s.pos.x - shell.pos.x;
    const dz = s.pos.z - shell.pos.z;
    expect(Math.abs(Math.hypot(dx, dz) - 20 * 30 * DT)).toBeLessThan(0.5); // ±~0.5 m (2%)
    // Speed magnitude unchanged.
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(20, 6);
  });
});

describe("wall bounce — reflection preserves |v|", () => {
  it("reflects about the barrier normal: |v'| === |v| and velocity turns inward", () => {
    const p0 = spline.pointAt(0.4);
    const tan = spline.tangentAt(0.4);
    const nx = -tan.z; // outward (left) unit normal
    const nz = tan.x;
    const speed = 30;
    const shell: ShellState = {
      pos: { x: p0.x + nx * (RW_HALF - 0.05), y: 0.5, z: p0.z + nz * (RW_HALF - 0.05) }, // just inside barrier
      vel: { x: nx * speed, y: 0, z: nz * speed }, // aimed outward at the wall
      kind: "green",
      ownerId: "shooter",
      bounces: 0,
      expiresAt: Infinity,
      spawnAt: 0,
    };

    const r = stepShell(shell, [], spline, DT, { simTime: DT });
    expect(r.removed).toBeFalsy(); // green survives its first bounce
    expect(r.shell.bounces).toBe(1);

    const before = Math.hypot(shell.vel.x, shell.vel.z);
    const after = Math.hypot(r.shell.vel.x, r.shell.vel.z);
    expect(after).toBeCloseTo(before, 6); // |v'| === |v| exactly (reflection)

    // Velocity now points back INWARD: dot(v', outwardNormal) < 0.
    const inwardDot = r.shell.vel.x * nx + r.shell.vel.z * nz;
    expect(inwardDot).toBeLessThan(0);
  });

  it("is removed on its 4th bounce (shellBounceMax = 3)", () => {
    const p0 = spline.pointAt(0.4);
    const tan = spline.tangentAt(0.4);
    const nx = -tan.z;
    const nz = tan.x;
    const shell: ShellState = {
      pos: { x: p0.x + nx * (RW_HALF - 0.05), y: 0.5, z: p0.z + nz * (RW_HALF - 0.05) },
      vel: { x: nx * 30, y: 0, z: nz * 30 },
      kind: "green",
      ownerId: "shooter",
      bounces: TUNING.items.shellBounceMax, // already at the limit → next bounce removes it
      expiresAt: Infinity,
      spawnAt: 0,
    };

    const r = stepShell(shell, [], spline, DT, { simTime: DT });
    expect(r.removed).toBe(true);
    expect(r.shell.bounces).toBe(TUNING.items.shellBounceMax + 1);
  });
});

describe("red shell — nearest-ahead homing", () => {
  it("homes to the nearer of two in-range karts ahead and converges on it", () => {
    const shooter = kartAt("shooter", 0.4, 0, 15);
    const near = kartAt("near", 0.42, 0, 27); // ~13 m ahead (in range)
    const far = kartAt("far", 0.44, 0, 27); // ~26 m ahead (also in range, but farther)
    const karts = [shooter, near, far];

    const shell = makeShell({ kind: "red", owner: shooter }, 0);
    const { hit, removed, errs } = stepUntil(shell, karts, { simTime: 0 }, "near");

    // It strikes the NEAR kart first (nearest-ahead selection), consumed on impact.
    expect(hit).toBe("near");
    expect(removed).toBe(true);
    // Homing error to the near target shrinks over the approach.
    expect(errs.length).toBeGreaterThan(3);
    expect(errs[errs.length - 1]).toBeLessThan(errs[0] * 0.5 + 1e-6);
    // Error is (near-)monotonic: no step regresses by more than a small tolerance.
    for (let i = 1; i < errs.length; i++) {
      expect(errs[i]).toBeLessThanOrEqual(errs[i - 1] + 0.02);
    }
  });
});

describe("blue shell — rank-based targeting", () => {
  it("strikes the current leader even when a lower-rank kart is closer", () => {
    const shooter = kartAt("shooter", 0.4, 0, 15);
    const leader = kartAt("leader", 0.5, 0, 27); // rank 1, ~65 m ahead on the centerline
    const decoy = kartAt("decoy", 0.46, 3, 27); // rank 2 — passes within ~2.5 m of the shell's path but is NOT rank 1
    const karts = [shooter, leader, decoy];

    const standings = [
      { id: "leader", rank: 1 },
      { id: "decoy", rank: 2 },
      { id: "shooter", rank: 3 },
    ];

    const shell = makeShell({ kind: "blue", owner: shooter }, 0);
    const { hit, removed } = stepUntil(shell, karts, { simTime: 0, standings });

    // Blue ignores distance and homes to the leader — not the much-closer decoy.
    expect(hit).toBe("leader");
    expect(removed).toBe(true); // consumed on impact
  });
});

describe("expiry windows", () => {
  /** Step a shell continuously from t=0; return the sim-time at which it is removed. */
  function removalTime(shell: ShellState, karts: KartEntity[]): number | null {
    let s = shell;
    for (let i = 1; i <= 60 * 20; i++) {
      const r = stepShell(s, karts, spline, DT, { simTime: i * DT });
      if (r.removed) return i * DT;
      s = r.shell;
    }
    return null; // never removed within the window
  }

  it("red expires at redExpiresSec and blue at blueExpiresSec (no other targets)", () => {
    const shooter = kartAt("shooter", 0.4, 0, 15);
    // Empty collision list: the owner is only referenced by id for immunity, so a
    // stationary shooter can't be struck after its 1 s immunity window lapses.
    const karts: KartEntity[] = [];

    const red = makeShell({ kind: "red", owner: shooter }, 0);
    expect(red.expiresAt).toBeCloseTo(TUNING.items.redExpiresSec, 6);
    const redRemovedAt = removalTime(red, karts);
    // Removed exactly at the expiry boundary (within one step), not earlier.
    expect(redRemovedAt).not.toBeNull();
    expect(Math.abs(redRemovedAt! - TUNING.items.redExpiresSec)).toBeLessThanOrEqual(DT + 1e-9);

    const blue = makeShell({ kind: "blue", owner: shooter }, 0);
    expect(blue.expiresAt).toBeCloseTo(TUNING.items.blueExpiresSec, 6);
    const blueRemovedAt = removalTime(blue, karts);
    expect(blueRemovedAt).not.toBeNull();
    expect(Math.abs(blueRemovedAt! - TUNING.items.blueExpiresSec)).toBeLessThanOrEqual(DT + 1e-9);
  });
});
