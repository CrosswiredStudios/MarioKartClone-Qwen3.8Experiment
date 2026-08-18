import { describe, expect, it } from "vitest";
import { countdownZoomEase, finishOutEase } from "../../src/scene/cameraEasing.js";

describe("countdownZoomEase (ease-in cubic)", () => {
  it("maps 0 → 0 and 1 → 1", () => {
    expect(countdownZoomEase(0)).toBe(0);
    expect(countdownZoomEase(1)).toBe(1);
  });

  it("clamps out-of-range input to [0, 1]", () => {
    expect(countdownZoomEase(-0.5)).toBe(0);
    expect(countdownZoomEase(2)).toBe(1);
  });

  it("is monotonically non-decreasing and ease-in (slow start)", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = countdownZoomEase(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Ease-in: at the halfway point we're well below half progress.
    expect(countdownZoomEase(0.5)).toBeLessThan(0.5);
    // And near the end it's close to 1 (fast finish).
    expect(countdownZoomEase(0.9)).toBeGreaterThan(0.7);
  });
});

describe("finishOutEase (ease-in-out cubic)", () => {
  it("maps 0 → 0, 0.5 → 0.5 and 1 → 1", () => {
    expect(finishOutEase(0)).toBe(0);
    expect(finishOutEase(0.5)).toBeCloseTo(0.5, 10);
    expect(finishOutEase(1)).toBe(1);
  });

  it("clamps out-of-range input to [0, 1]", () => {
    expect(finishOutEase(-1)).toBe(0);
    expect(finishOutEase(3)).toBe(1);
  });

  it("is monotonically non-decreasing and symmetric (slow start AND end)", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = finishOutEase(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Slow start: a quarter of the way in we're well under a quarter of the distance.
    expect(finishOutEase(0.25)).toBeCloseTo(0.0625, 10);
    // Symmetric slow end: f(0.75) = 1 - f(0.25).
    expect(finishOutEase(0.75)).toBeCloseTo(1 - finishOutEase(0.25), 10);
  });
});
