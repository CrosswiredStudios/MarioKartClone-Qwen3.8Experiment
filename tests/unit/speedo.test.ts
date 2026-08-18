/**
 * speedoAngle (06-phase-4 Step 8) — pure needle-angle mapping.
 * Maps a normalized speed ratio onto the gauge's 240° sweep: 0 → −120°, 1 → +120°.
 */

import { describe, expect, it } from "vitest";
import { speedoAngle } from "../../src/ui/Hud.js";

describe("speedoAngle", () => {
  it("maps the full sweep endpoints exactly", () => {
    expect(speedoAngle(0)).toBe(-120);
    expect(speedoAngle(1)).toBe(120);
  });

  it("is linear through the middle (straight up at half speed)", () => {
    expect(speedoAngle(0.5)).toBe(0);
    expect(speedoAngle(0.25)).toBe(-60);
    expect(speedoAngle(0.75)).toBe(60);
  });

  it("clamps out-of-range ratios instead of overshooting the arc", () => {
    expect(speedoAngle(-0.5)).toBe(-120);
    expect(speedoAngle(1.5)).toBe(120);
    // NaN must not leak into an SVG transform — clamp it to the low end.
    expect(speedoAngle(Number.NaN)).toBe(-120);
  });
});
