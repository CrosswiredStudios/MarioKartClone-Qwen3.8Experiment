import { describe, expect, it } from "vitest";
import { createRaceConfig } from "../../src/core/RaceConfig.js";

describe("createRaceConfig", () => {
  it("accepts a valid config and fields round-trip", () => {
    const cfg = createRaceConfig("marvin", "zippy", "meadows");
    expect(cfg).toEqual({ characterId: "marvin", vehicleId: "zippy", mapId: "meadows" });
  });

  it("accepts every valid id combination from the rosters", () => {
    for (const characterId of ["marvin", "louie", "pearl", "terry"]) {
      for (const vehicleId of ["basher", "zippy", "quadzilla"]) {
        for (const mapId of ["meadows", "lagoon"]) {
          expect(() => createRaceConfig(characterId, vehicleId, mapId)).not.toThrow();
        }
      }
    }
  });

  it("rejects an unknown character id with a descriptive error", () => {
    expect(() => createRaceConfig("nope", "zippy", "meadows")).toThrow(/unknown characterId: nope/);
  });

  it("rejects an unknown vehicle id with a descriptive error", () => {
    expect(() => createRaceConfig("marvin", "hovercraft", "meadows")).toThrow(/unknown vehicleId: hovercraft/);
  });

  it("rejects an unknown map id with a descriptive error", () => {
    expect(() => createRaceConfig("marvin", "zippy", "moonbase")).toThrow(/unknown mapId: moonbase/);
  });

  it("returns a frozen (immutable) object", () => {
    const cfg = createRaceConfig("pearl", "quadzilla", "lagoon");
    expect(Object.isFrozen(cfg)).toBe(true);
    // strict-mode assignment to a frozen property throws at runtime
    expect(() => {
      (cfg as unknown as { characterId: string }).characterId = "x";
    }).toThrow();
  });
});
