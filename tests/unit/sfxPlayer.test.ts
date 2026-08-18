import { describe, expect, it } from "vitest";
import { enginePitchFor } from "../../src/audio/SfxPlayer.js";
import { TUNING } from "../../src/data/tuning.js";

const MIN = TUNING.audio.enginePitchMinHz; // 80 Hz idle
const MAX = TUNING.audio.enginePitchMaxHz; // 240 Hz top speed

describe("enginePitchFor", () => {
  it("is monotonic non-decreasing over a dense [0,1] sweep", () => {
    const N = 200;
    let prev = enginePitchFor(0);
    for (let i = 1; i <= N; i++) {
      const r = i / N;
      const p = enginePitchFor(r);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
    }
  });

  it("maps the endpoints to ~80 Hz and ~240 Hz within ±5%", () => {
    expect(enginePitchFor(0)).toBeCloseTo(MIN, 6);
    expect(enginePitchFor(1)).toBeCloseTo(MAX, 6);
    // Tolerance form (guards against a future curve change drifting the ends).
    expect(Math.abs(enginePitchFor(0) - MIN) / MIN).toBeLessThan(0.05);
    expect(Math.abs(enginePitchFor(1) - MAX) / MAX).toBeLessThan(0.05);
  });

  it("clamps inputs below 0 and above 1 to the endpoints", () => {
    expect(enginePitchFor(-0.5)).toBeCloseTo(MIN, 6);
    expect(enginePitchFor(-100)).toBeCloseTo(MIN, 6);
    expect(enginePitchFor(1.5)).toBeCloseTo(MAX, 6);
    expect(enginePitchFor(99)).toBeCloseTo(MAX, 6);
  });

  it("stays within [min,max] for all in-range inputs", () => {
    for (let i = 0; i <= 100; i++) {
      const p = enginePitchFor(i / 100);
      expect(p).toBeGreaterThanOrEqual(MIN);
      expect(p).toBeLessThanOrEqual(MAX);
    }
  });

  it("uses a power curve (heavier low end): midpoint is below linear", () => {
    const mid = enginePitchFor(0.5);
    const linearMid = (MIN + MAX) / 2;
    expect(mid).toBeLessThan(linearMid);
  });
});
