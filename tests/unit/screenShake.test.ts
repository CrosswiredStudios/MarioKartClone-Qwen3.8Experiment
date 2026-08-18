/**
 * ScreenShake envelope tests (07-phase-5 Step 10). Headless — no Babylon.
 *
 * Envelope: offset(t) = A · e^(−decayPerSec·t) · sin(2π·freqHz·t), applied along a fixed
 * axis per trigger. Verified properties:
 *   - t=0 → exactly 0 (sin(0)=0);
 *   - peak within the first period is near A/√2 (the sine's max of ±1 sits at t=1/(4f);
 *     by then e^(−decay·t) has only shaved a little, so |offset| ≈ A·e^(−decay/(4f)) ≥ A/√2
 *     for our tuning: decay 4 s⁻¹, f 9 Hz → e^(−0.111)=0.895 > 0.707);
 *   - decays below 1% of A by ~2 s (e^(−4·2) = 0.000335 ≪ 0.01).
 */

import { describe, it, expect } from "vitest";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { TUNING } from "../../src/data/tuning.js";
import { ScreenShake, shakeOffset } from "../../src/vfx/ScreenShake.js";

const DT = 1 / 60;

describe("shakeOffset (pure envelope)", () => {
  it("is exactly 0 at t=0", () => {
    expect(shakeOffset(0.25, 0, TUNING.shake.decayPerSec, TUNING.shake.freqHz)).toBe(0);
  });

  it("clamps negative time to the t=0 value (0)", () => {
    expect(shakeOffset(0.25, -1, TUNING.shake.decayPerSec, TUNING.shake.freqHz)).toBe(0);
  });

  it("peaks near A/√2 within the first period", () => {
    const A = 0.25;
    const f = TUNING.shake.freqHz;
    // Sample densely across one full period and take the max |offset|.
    let peak = 0;
    for (let i = 0; i <= 60 * Math.ceil(f); i++) {
      const t = i / 60;
      if (t > 1 / f) break;
      peak = Math.max(peak, Math.abs(shakeOffset(A, t, TUNING.shake.decayPerSec, f)));
    }
    // Theoretical max of the envelope over [0, 1/f] is A·e^(−decay/(4f)) ≈ 0.895A;
    // assert it lands between A/√2 and A (discrete sampling can only undershoot).
    expect(peak).toBeGreaterThan(A / Math.SQRT2);
    expect(peak).toBeLessThanOrEqual(A + 1e-9);
  });

  it("decays below 1% of A by ~2 s", () => {
    const A = 0.35;
    // At t=2 the envelope bound is A·e^(−8) ≈ 0.000117A — far under 1%.
    for (let i = 0; i < 60 * 4; i++) {
      const t = 2 + i / 60; // sample [2, 4] s
      expect(Math.abs(shakeOffset(A, t, TUNING.shake.decayPerSec, TUNING.shake.freqHz))).toBeLessThan(0.01 * A);
    }
  });
});

describe("ScreenShake (event wiring + per-frame offset)", () => {
  it("starts idle: no events → zero offset and isActive false", () => {
    const shake = new ScreenShake();
    expect(shake.isActive).toBe(false);
    for (let i = 0; i < 120; i++) {
      const o = shake.offset(DT);
      expect(o.x).toBe(0);
      expect(o.z).toBe(0);
    }
  });

  it("kart:hit on the player triggers a hit-amplitude shake", () => {
    const bus = new EventBus<GameEvents>();
    const shake = new ScreenShake();
    shake.attach(bus);

    // AI kart hit → no camera shake (not in view).
    bus.emit("kart:hit", { kartId: "terry" });
    expect(shake.isActive).toBe(false);

    bus.emit("kart:hit", { kartId: "player", shellKind: "red" });
    expect(shake.isActive).toBe(true);
    // Peak magnitude over the first period must match the hit amplitude envelope.
    let peak = 0;
    for (let i = 0; i < 60 * Math.ceil(TUNING.shake.freqHz); i++) {
      const o = shake.offset(DT);
      peak = Math.max(peak, Math.hypot(o.x, o.z));
    }
    expect(peak).toBeGreaterThan(TUNING.shake.hitMeters / Math.SQRT2);
    expect(peak).toBeLessThanOrEqual(TUNING.shake.hitMeters + 1e-9);
  });

  it("kart:boosted (any tier) triggers a boost shake; lightning shakes hardest", () => {
    const bus = new EventBus<GameEvents>();
    const shake = new ScreenShake();
    shake.attach(bus);

    bus.emit("kart:boosted", { kartId: "player", tier: "shroom" });
    expect(shake.isActive).toBe(true);
    let boostPeak = 0;
    for (let i = 0; i < 60 * Math.ceil(TUNING.shake.freqHz); i++) {
      const o = shake.offset(DT);
      boostPeak = Math.max(boostPeak, Math.hypot(o.x, o.z));
    }
    expect(boostPeak).toBeGreaterThan(TUNING.shake.boostMeters / Math.SQRT2);

    // Lightning (via item:used) replaces the in-flight boost shake with a bigger one.
    bus.emit("item:used", { kartId: "player", item: "lightning" });
    let lightPeak = 0;
    for (let i = 0; i < 60 * Math.ceil(TUNING.shake.freqHz); i++) {
      const o = shake.offset(DT);
      lightPeak = Math.max(lightPeak, Math.hypot(o.x, o.z));
    }
    expect(lightPeak).toBeGreaterThan(TUNING.shake.lightningMeters / Math.SQRT2);
  });

  it("item:used with a non-lightning item does NOT shake", () => {
    const bus = new EventBus<GameEvents>();
    const shake = new ScreenShake();
    shake.attach(bus);
    bus.emit("item:used", { kartId: "player", item: "mushroom" });
    expect(shake.isActive).toBe(false);
  });

  it("newer events replace older ones (no stacking)", () => {
    const bus = new EventBus<GameEvents>();
    const shake = new ScreenShake();
    shake.attach(bus);

    // Hit first, then a boost mid-shake: the envelope restarts at the SMALLER boost A.
    bus.emit("kart:hit", { kartId: "player" });
    for (let i = 0; i < 30; i++) shake.offset(DT); // let it run half a second
    bus.emit("kart:boosted", { kartId: "player", tier: "mini" });

    // After the replace, the peak can never exceed the boost amplitude.
    let peak = 0;
    for (let i = 0; i < 60 * Math.ceil(TUNING.shake.freqHz); i++) {
      const o = shake.offset(DT);
      peak = Math.max(peak, Math.hypot(o.x, o.z));
    }
    expect(peak).toBeLessThanOrEqual(TUNING.shake.boostMeters + 1e-9);
  });

  it("settles to zero and deactivates after ~2 s", () => {
    const shake = new ScreenShake();
    shake.trigger("hit");
    let lastNonZeroAt = -1;
    for (let i = 0; i < 60 * 5; i++) {
      const o = shake.offset(DT);
      if (Math.hypot(o.x, o.z) > 0) lastNonZeroAt = i / 60;
    }
    expect(shake.isActive).toBe(false);
    // The envelope is numerically dead well before 2 s.
    expect(lastNonZeroAt).toBeLessThan(2);
  });

  it("detach() stops reacting to events", () => {
    const bus = new EventBus<GameEvents>();
    const shake = new ScreenShake();
    shake.attach(bus);
    shake.detach();
    bus.emit("kart:hit", { kartId: "player" });
    expect(shake.isActive).toBe(false);
  });
});
