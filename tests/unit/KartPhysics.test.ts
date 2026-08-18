import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import type { DriveInput, KartState, PhysicsProfile, StatusEffect } from "../../src/entities/KartPhysics.js";
import { maxSpeedFor, stepKart } from "../../src/entities/KartPhysics.js";
import { NO_DRIFT } from "../../src/entities/DriftController.js";

const DT = 1 / 60;
const PROFILE: PhysicsProfile = { topSpeedStat: 3, accelStat: 3 }; // stat 3 → 27.6 m/s
const MAX_SPEED = maxSpeedFor(PROFILE); // 30 * (0.8 + 0.04*3) = 27.6

function makeState(overrides: Partial<KartState> = {}): KartState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vy: 0,
    heading: 0,
    speed: 0,
    lap: 0,
    checkpointIdx: -1,
    item: null,
    charging: null,
    statusEffects: [],
    driftCharge: { ...NO_DRIFT },
    speedRatio: 0,
    profile: PROFILE,
    ...overrides,
  };
}

function input(over: Partial<DriveInput> = {}): DriveInput {
  return Object.freeze({ throttle: 0, steer: 0, drifting: false, useItem: false, itemHeld: false, ...over });
}

/** Run n steps with a constant input; returns the final state. */
function run(state: KartState, inp: DriveInput, surface: Parameters<typeof stepKart>[2], steps: number): KartState {
  let s = state;
  for (let i = 0; i < steps; i++) s = stepKart(s, inp, surface, DT);
  return s;
}

describe("KartPhysics.stepKart", () => {
  it("(a) throttle from rest approaches maxSpeed asymptotically and never exceeds it ×1.001", () => {
    let s = makeState();
    for (let i = 0; i < 60 * 30; i++) {
      const next = stepKart(s, input({ throttle: 1 }), "road", DT);
      // Non-decreasing while below the cap (float rounding at the exact cap can dip ~1e-15).
      expect(next.speed).toBeGreaterThanOrEqual(s.speed - 1e-9);
      expect(next.speed).toBeLessThanOrEqual(MAX_SPEED * 1.001);
      s = next;
    }
    expect(Math.abs(s.speed - MAX_SPEED)).toBeLessThan(0.5); // converged near the cap

    // With an active boost effect, speed may exceed base maxSpeed up to the boost headroom.
    const boosted: StatusEffect[] = [{ kind: "boost", speed: TUNING.drift.miniBoostSpeed, remaining: 5 }];
    let b = makeState({ statusEffects: boosted });
    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) { // sample within the 5s boost window
      b = stepKart(b, input({ throttle: 1 }), "road", DT);
      expect(b.speed).toBeLessThanOrEqual(TUNING.drift.miniBoostSpeed * 1.001);
      peak = Math.max(peak, b.speed);
    }
    expect(peak).toBeGreaterThan(MAX_SPEED); // boost actually pushed past base max
  });

  it("(b) brake from maxSpeed reaches ≤ 0 without overshoot; held reverse clamps at reverseMax", () => {
    let s = makeState({ speed: MAX_SPEED });
    for (let i = 0; i < 60 * 5 && s.speed > 0; i++) {
      const next = stepKart(s, input({ throttle: -1 }), "road", DT);
      expect(next.speed).toBeLessThanOrEqual(s.speed); // monotonically decreasing
      s = next;
    }
    expect(s.speed).toBeLessThanOrEqual(0.5); // effectively stopped (no deep overshoot)

    // Keep braking → reverse, clamped at TUNING.physics.reverseMax.
    const rev = run(makeState({ speed: 0 }), input({ throttle: -1 }), "road", 60 * 10);
    expect(rev.speed).toBeGreaterThanOrEqual(TUNING.physics.reverseMax - 1e-9);
    expect(rev.speed).toBeLessThan(0);
  });

  it("(c) offRoad terminal speed ≈ maxSpeed × offRoadDrag (±5%)", () => {
    const s = run(makeState(), input({ throttle: 1 }), "offRoad", 60 * 30);
    const expected = MAX_SPEED * TUNING.physics.offRoadDrag;
    expect(Math.abs(s.speed - expected) / expected).toBeLessThan(0.05);

    // Entering grass at full speed visibly slows the kart down toward that cap.
    const entered = run(makeState({ speed: MAX_SPEED }), input({ throttle: 1 }), "offRoad", 60 * 3);
    expect(entered.speed).toBeLessThan(MAX_SPEED - 2);
  });

  it("(d) steer ±1 at zero speed produces no heading change", () => {
    const s = makeState();
    for (const steer of [-1, 1]) {
      // Coasting at exactly zero speed: the clamp(speed/(maxSpeed*0.4), 0, 1) factor is 0.
      const next = stepKart(s, input({ throttle: 0, steer }), "road", DT);
      expect(next.heading).toBe(0);

      // With throttle from rest, one frame of acceleration allows a TINY turn —
      // bounded by the speed gained in that single step.
      const n2 = stepKart(makeState(), input({ throttle: 1, steer }), "road", DT);
      expect(Math.abs(n2.heading)).toBeLessThan(0.005);
    }
  });

  it("(e) steering authority peaks near 40% of top speed; drift multiplies by 1.35", () => {
    // Sweep speeds, measure |Δheading/dt| at steer = 1.
    let bestRatio = -1;
    let bestRate = 0;
    for (let i = 0; i <= 40; i++) {
      const speed = (i / 40) * MAX_SPEED;
      const s = makeState({ speed });
      const next = stepKart(s, input({ throttle: 1, steer: 1 }), "road", DT);
      const rate = Math.abs(next.heading - s.heading) / DT;
      if (rate > bestRate) {
        bestRate = rate;
        bestRatio = speed / MAX_SPEED;
      }
    }
    // The clamp saturates at 0.4·maxSpeed, so the argmax sits right around there.
    expect(bestRatio).toBeGreaterThanOrEqual(0.35);
    expect(bestRatio).toBeLessThanOrEqual(0.45);

    // Drift multiplies the rate by exactly 1.35 in the saturated band.
    const s = makeState({ speed: MAX_SPEED });
    const plain = stepKart(s, input({ throttle: 1, steer: 1 }), "road", DT);
    const drifting = stepKart(s, input({ throttle: 1, steer: 1, drifting: true }), "road", DT);
    expect(drifting.heading / plain.heading).toBeCloseTo(1.35, 6);
  });

  it("(f) purity: same inputs → deep-equal states; inputs never mutated", () => {
    const state = makeState({ speed: 20, heading: 0.7, statusEffects: [{ kind: "skid", remaining: 1 }] });
    const inp = input({ throttle: 1, steer: -0.5, drifting: true });
    const stateBefore = structuredClone(state);
    const inpBefore = { ...inp };

    const a = stepKart(state, inp, "road", DT);
    const b = stepKart(state, inp, "road", DT);
    expect(a).toEqual(b); // deep-equal across two calls
    expect(state).toEqual(stateBefore); // state untouched
    expect(inp).toEqual(inpBefore); // input untouched

    // statusEffects array is fresh and decremented, not the original reference.
    expect(a.statusEffects).not.toBe(state.statusEffects);
    expect(a.statusEffects[0].remaining).toBeCloseTo(1 - DT, 6);
  });

  it("(g) reverse coasting (no throttle while backing up) decays to a stop", () => {
    let s = makeState({ speed: -8 });
    for (let i = 0; i < 60 * 10 && Math.abs(s.speed) > 0.05; i++) {
      const next = stepKart(s, input(), "road", DT); // throttle 0 while reversing
      expect(next.speed).toBeGreaterThanOrEqual(s.speed - 1e-9); // rising toward 0
      expect(next.speed).toBeLessThan(0); // never overshoots into forward
      s = next;
    }
    expect(Math.abs(s.speed)).toBeLessThan(0.5); // actually stopped, not coasting forever
  });

  it("(h) steering works while reversing and inverts direction", () => {
    // Use a speed within both the forward cap and reverseMax (−8 m/s) so the
    // authority factor is identical for both directions.
    const fwd = stepKart(makeState({ speed: 6 }), input({ steer: 1 }), "road", DT);
    const rev = stepKart(makeState({ speed: -6 }), input({ steer: 1 }), "road", DT);
    expect(fwd.heading).toBeGreaterThan(0.02); // forward: steer right → +heading
    expect(rev.heading).toBeLessThan(-0.02); // reverse: same input → −heading (inverted)
    // Same |speed| → same authority magnitude.
    expect(Math.abs(rev.heading)).toBeCloseTo(fwd.heading, 6);

    // At standstill there is still no turning even with the new model.
    const stopped = stepKart(makeState({ speed: 0 }), input({ steer: 1 }), "road", DT);
    expect(stopped.heading).toBe(0);
  });

  it("skid effect spins the kart at skidSpinRate and ignores throttle/steer", () => {
    const s = makeState({ speed: MAX_SPEED, heading: 0, statusEffects: [{ kind: "skid", remaining: 2 }] });
    // Full spin regardless of steer input; sign(speed)=+1 → +heading.
    const next = stepKart(s, input({ throttle: 1, steer: -1 }), "road", DT);
    expect(next.heading).toBeCloseTo(TUNING.items.skidSpinRate * DT, 6);
    // Reversing skid spins the other way (sign(speed)=-1).
    const rev = stepKart(makeState({ speed: -MAX_SPEED, statusEffects: [{ kind: "skid", remaining: 2 }] }), input(), "road", DT);
    expect(rev.heading).toBeCloseTo(-TUNING.items.skidSpinRate * DT, 6);
  });

  it("hit effect caps effective maxSpeed at hitSlowFactor × base (immediate slow applied by controller)", () => {
    // The controller multiplies speed × hitSlowFactor when granting "hit"; physics then
    // holds the kart near that reduced cap. Start just above the cap and confirm it can't
    // climb back to full speed while the effect is active.
    const s = makeState({ speed: MAX_SPEED * TUNING.items.hitSlowFactor + 1, statusEffects: [{ kind: "hit", remaining: 5 }] });
    let next = s;
    for (let i = 0; i < 60 * 3; i++) next = stepKart(next, input({ throttle: 1 }), "road", DT);
    expect(next.speed).toBeLessThanOrEqual(MAX_SPEED * TUNING.items.hitSlowFactor + 0.5);
  });

  it("shrink effect caps maxSpeed at shrinkMaxSpeedFactor × base under full throttle", () => {
    const plain = run(makeState(), input({ throttle: 1 }), "road", 60 * 8); // converge to base cap
    let shrunk = makeState({ statusEffects: [{ kind: "shrink", remaining: 99 }] });
    for (let i = 0; i < 60 * 8; i++) shrunk = stepKart(shrunk, input({ throttle: 1 }), "road", DT);
    expect(shrunk.speed).toBeCloseTo(plain.speed * TUNING.items.shrinkMaxSpeedFactor, 1);
  });

  it("bulletBill forces speed to bulletBillSpeed and freezes heading regardless of input", () => {
    const s = makeState({ speed: 5, heading: 0.3, statusEffects: [{ kind: "bulletBill", remaining: 2 }] });
    const next = stepKart(s, input({ throttle: -1, steer: 1 }), "road", DT);
    expect(next.speed).toBe(TUNING.items.bulletBillSpeed);
    expect(next.heading).toBeCloseTo(0.3, 6); // frozen — no steering applied
  });

  it("star grants a sustained boost to at least starBoostSpeed while active", () => {
    const s = makeState({ speed: 5, statusEffects: [{ kind: "star", remaining: 2 }] });
    const next = stepKart(s, input(), "road", DT);
    expect(next.speed).toBeGreaterThanOrEqual(TUNING.items.shroomBoost * 0.9 - 1e-6);
  });

  it("speedRatio is |speed|/maxSpeed clamped to [0,1]", () => {
    const atHalf = stepKart(makeState({ speed: MAX_SPEED / 2 }), input(), "road", DT);
    // Coasting drag shaves a little off in the same step; ratio stays ≈ 0.5.
    expect(atHalf.speedRatio).toBeGreaterThan(0.48);
    expect(atHalf.speedRatio).toBeLessThan(0.5);

    // Boosted above base max → ratio clamps to 1.
    const boosted = makeState({ speed: TUNING.drift.superBoostSpeed, statusEffects: [{ kind: "boost", speed: TUNING.drift.superBoostSpeed, remaining: 2 }] });
    expect(stepKart(boosted, input(), "road", DT).speedRatio).toBe(1);
  });

  it("integration moves the kart along its heading (heading 0 = +Z)", () => {
    const s = makeState({ speed: 10 });
    const next = stepKart(s, input({ throttle: 1 }), "road", DT);
    expect(next.pos.z).toBeGreaterThan(10 * DT - 1e-9); // forward ≈ +Z
    expect(Math.abs(next.pos.x)).toBeLessThan(1e-9);

    const east = makeState({ speed: 10, heading: Math.PI / 2 });
    const n2 = stepKart(east, input(), "road", DT);
    expect(n2.pos.x).toBeGreaterThan(9 * DT); // heading π/2 → +X (drag shaves a bit)
    expect(Math.abs(n2.pos.z)).toBeLessThan(1e-9);
  });

  describe("terrain gravity (Phase 4.1)", () => {
    /** Flat terrain at height `h` everywhere. */
    const flat = (h: number): Parameters<typeof stepKart>[6] => ({ heightAt: () => h });

    it("glues a grounded kart to the surface and zeroes vy", () => {
      // Kart starts exactly on a 5 m plateau, coasting forward.
      const s = makeState({ pos: { x: 0, y: 5, z: 0 }, speed: 10 });
      const next = stepKart(s, input(), "road", DT, 1, 1, flat(5));
      expect(next.pos.y).toBeCloseTo(5, 6);
      expect(next.vy).toBe(0);
    });

    it("goes airborne over a cliff drop and falls under gravity", () => {
      // Surface is 0 m ahead but the kart sits at +10 m (a ledge): it launches off.
      const s = makeState({ pos: { x: 0, y: 10, z: 0 }, speed: 20 });
      let next = stepKart(s, input(), "road", DT, 1, 1, flat(0));
      // First airborne step: vy becomes negative (falling), kart still above ground.
      expect(next.vy).toBeLessThan(0);
      expect(next.pos.y).toBeGreaterThan(0);

      // Keep stepping until it lands; y must monotonically decrease to the surface.
      let landed = false;
      for (let i = 0; i < 600 && !landed; i++) {
        next = stepKart(next, input(), "road", DT, 1, 1, flat(0));
        if (next.pos.y <= 0.001) landed = true;
      }
      expect(landed).toBe(true);
      expect(next.pos.y).toBeCloseTo(0, 3); // rests on the surface
      expect(next.vy).toBe(0); // no bounce: vy zeroed on contact
    });

    it("does not go airborne from a small step (within airborneEpsilon)", () => {
      // Surface is just below the kart by less than epsilon → treated as grounded.
      const gap = TUNING.terrain.airborneEpsilon * 0.5;
      expect(gap).toBeLessThan(TUNING.terrain.airborneEpsilon);
      const s = makeState({ pos: { x: 0, y: gap, z: 0 }, speed: 5 });
      const next = stepKart(s, input(), "road", DT, 1, 1, flat(0));
      expect(next.pos.y).toBeCloseTo(0, 6); // snapped down to surface, not airborne
      expect(next.vy).toBe(0);
    });

    it("keeps horizontal momentum while airborne (no XZ snap)", () => {
      const s = makeState({ pos: { x: 0, y: 10, z: 0 }, speed: 20 });
      const next = stepKart(s, input(), "road", DT, 1, 1, flat(0));
      // Still moving forward in +Z while falling.
      expect(next.pos.z).toBeGreaterThan(0);
    });
  });
});
