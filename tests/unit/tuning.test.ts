import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";

/** Recursively collect [path, leaf] pairs for every non-object value in TUNING. */
function leaves(value: unknown, path = ""): Array<[string, number | boolean]> {
  if (typeof value === "number" || typeof value === "boolean") {
    return [[path, value]];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  throw new Error(`unexpected TUNING leaf type at ${path}: ${typeof value}`);
}

describe("TUNING", () => {
  it("every numeric leaf is finite (pixelRatioCap may be Infinity); booleans are allowed feature flags", () => {
    const all = leaves(TUNING);
    expect(all.length).toBeGreaterThan(0);
    for (const [path, value] of all) {
      if (typeof value === "boolean") continue; // ssao / bloom toggles
      if (path.endsWith("pixelRatioCap")) continue; // documented unbounded on high preset
      expect(Number.isFinite(value), `TUNING${path} must be a finite number`).toBe(true);
    }
  });

  it("physics.offRoadDrag is in (0, 1)", () => {
    const drag = TUNING.physics.offRoadDrag;
    expect(drag).toBeGreaterThan(0);
    expect(drag).toBeLessThan(1);
  });

  it("drift charge times are ordered and boosts increase", () => {
    expect(TUNING.drift.charge1Time).toBeLessThan(TUNING.drift.charge2Time);
    expect(TUNING.drift.miniBoostSpeed).toBeLessThan(TUNING.drift.superBoostSpeed);
  });

  it("quality presets are monotonic low <= medium <= high for numeric fields", () => {
    const { low, medium, high } = TUNING.quality;
    for (const key of ["shadowMapSize", "particleBudget", "propDensity"] as const) {
      expect(low[key]).toBeLessThanOrEqual(medium[key]);
      expect(medium[key]).toBeLessThanOrEqual(high[key]);
    }
  });

  it("quality presets are strictly ordered for the fields that must differ", () => {
    const { low, medium, high } = TUNING.quality;
    expect(low.shadowMapSize).toBeLessThan(medium.shadowMapSize);
    expect(medium.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(low.particleBudget).toBeLessThan(medium.particleBudget);
    expect(medium.particleBudget).toBeLessThan(high.particleBudget);
  });
});
