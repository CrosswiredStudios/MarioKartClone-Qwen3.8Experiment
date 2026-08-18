import { describe, expect, it } from "vitest";
import { CHARACTER_ROSTER, validateCharacterRoster } from "../../src/data/characters.js";

describe("CHARACTER_ROSTER", () => {
  it("has exactly 4 entries with the expected unique ids", () => {
    expect(CHARACTER_ROSTER).toHaveLength(4);
    const ids = CHARACTER_ROSTER.map((c) => c.id).sort();
    expect(ids).toEqual(["louie", "marvin", "pearl", "terry"]);
  });

  it("matches the overview stat table exactly", () => {
    const byId = new Map(CHARACTER_ROSTER.map((c) => [c.id, c]));
    expect(byId.get("marvin")?.stats).toEqual({ accel: 3, topSpeed: 3, handling: 3, offRoad: 3 });
    expect(byId.get("louie")?.stats).toEqual({ accel: 4, topSpeed: 2, handling: 4, offRoad: 5 });
    expect(byId.get("pearl")?.stats).toEqual({ accel: 2, topSpeed: 5, handling: 2, offRoad: 3 });
    expect(byId.get("terry")?.stats).toEqual({ accel: 1, topSpeed: 4, handling: 2, offRoad: 4 });
  });

  it("every stat is an integer in 1..5", () => {
    for (const c of CHARACTER_ROSTER) {
      for (const value of Object.values(c.stats)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });

  it("each color is a 3-tuple of numbers in 0..1", () => {
    for (const c of CHARACTER_ROSTER) {
      expect(c.color).toHaveLength(3);
      for (const channel of c.color) {
        expect(typeof channel).toBe("number");
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every entry has a non-empty display name", () => {
    for (const c of CHARACTER_ROSTER) {
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe("validateCharacterRoster", () => {
  it("throws on a duplicate id", () => {
    // rename the first entry to collide with the real pearl entry
    const roster = CHARACTER_ROSTER.map((c, i) => (i === 0 ? { ...c, id: "pearl" } : c));
    expect(() => validateCharacterRoster(roster)).toThrow(/duplicate character id: pearl/);
  });

  it("throws on a stat out of range (accel = 6)", () => {
    const roster = CHARACTER_ROSTER.map((c, i) => (i === 0 ? { ...c, stats: { ...c.stats, accel: 6 } } : c));
    expect(() => validateCharacterRoster(roster)).toThrow(/stat accel out of range 1..5/);
  });

  it("throws on a non-integer stat", () => {
    const roster = CHARACTER_ROSTER.map((c, i) => (i === 0 ? { ...c, stats: { ...c.stats, handling: 2.5 } } : c));
    expect(() => validateCharacterRoster(roster)).toThrow(/stat handling out of range 1..5/);
  });

  it("returns the roster unchanged when valid", () => {
    const result = validateCharacterRoster(CHARACTER_ROSTER);
    expect(result).toBe(CHARACTER_ROSTER);
  });
});
