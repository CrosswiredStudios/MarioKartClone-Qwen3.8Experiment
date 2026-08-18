import { describe, expect, it } from "vitest";
import { CHARACTER_ROSTER } from "../../src/data/characters.js";
import { combinedStats, VEHICLE_ROSTER, validateVehicleRoster } from "../../src/data/vehicles.js";

describe("VEHICLE_ROSTER", () => {
  it("has exactly 3 entries with the expected ids and types", () => {
    expect(VEHICLE_ROSTER).toHaveLength(3);
    const byId = new Map(VEHICLE_ROSTER.map((v) => [v.id, v]));
    expect(byId.get("basher")?.type).toBe("kart");
    expect(byId.get("zippy")?.type).toBe("bike");
    expect(byId.get("quadzilla")?.type).toBe("atv");
  });

  it("matches the overview modifier table exactly", () => {
    const byId = new Map(VEHICLE_ROSTER.map((v) => [v.id, v]));
    expect(byId.get("basher")?.modifiers).toEqual({ accel: 0, topSpeed: 0, handling: 0, offRoad: 0 });
    expect(byId.get("zippy")?.modifiers).toEqual({ accel: 1, topSpeed: -1, handling: 1, offRoad: 0 });
    expect(byId.get("quadzilla")?.modifiers).toEqual({ accel: -1, topSpeed: 1, handling: -1, offRoad: 1 });
  });

  it("all modifiers are integers in -1..+1", () => {
    for (const v of VEHICLE_ROSTER) {
      for (const value of Object.values(v.modifiers)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("combinedStats", () => {
  it.each(CHARACTER_ROSTER.flatMap((c) => VEHICLE_ROSTER.map((v) => [c.id, v.id] as const)))(
    "%s + %s: every axis clamps into 1..5 (all 12 pairs)",
    (characterId, vehicleId) => {
      const stats = combinedStats(characterId, vehicleId);
      for (const value of Object.values(stats)) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    },
  );

  it("spot-asserts the documented clamp cases", () => {
    // terry accel = 1, basher adds 0 -> stays 1 (floor)
    expect(combinedStats("terry", "basher").accel).toBe(1);
    // louie topSpeed = 2, zippy -1 -> clamped to 1 (floor)
    expect(combinedStats("louie", "zippy").topSpeed).toBe(1);
    // pearl topSpeed = 5, quadzilla +1 -> clamped to 5 (ceiling)
    expect(combinedStats("pearl", "quadzilla").topSpeed).toBe(5);
    // marvin + basher is identity
    expect(combinedStats("marvin", "basher")).toEqual({ accel: 3, topSpeed: 3, handling: 3, offRoad: 3 });
  });

  it("throws on an unknown character id", () => {
    expect(() => combinedStats("nope", "basher")).toThrow(/unknown id in combinedStats/);
  });

  it("throws on an unknown vehicle id", () => {
    expect(() => combinedStats("marvin", "hovercraft")).toThrow(/unknown id in combinedStats/);
  });
});

describe("validateVehicleRoster", () => {
  it("throws on a duplicate id", () => {
    // rename the first entry to collide with the real zippy entry
    const roster = VEHICLE_ROSTER.map((v, i) => (i === 0 ? { ...v, id: "zippy" } : v));
    expect(() => validateVehicleRoster(roster)).toThrow(/duplicate vehicle id: zippy/);
  });

  it("throws on a modifier out of range", () => {
    const roster = VEHICLE_ROSTER.map((v, i) => (i === 0 ? { ...v, modifiers: { ...v.modifiers, accel: 2 } } : v));
    expect(() => validateVehicleRoster(roster)).toThrow(/modifier accel out of range/);
  });

  it("returns the roster unchanged when valid", () => {
    const result = validateVehicleRoster(VEHICLE_ROSTER);
    expect(result).toBe(VEHICLE_ROSTER);
  });
});
