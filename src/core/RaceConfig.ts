/**
 * Immutable race configuration assembled at MapSelect confirm (Phase 2, Task 8).
 * Pure data — zero Babylon imports.
 */
import { CHARACTER_ROSTER } from "../data/characters.js";
import { VEHICLE_ROSTER } from "../data/vehicles.js";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../data/tracks/index.js";

export interface RaceConfig {
  readonly characterId: string;
  readonly vehicleId: string;
  readonly mapId: string;
}

const MAP_IDS = new Set([MEADOWS_TRACK.id, LAGOON_TRACK.id]);

/** Validates all three ids against the rosters (throws Error otherwise), then Object.freeze()s and returns. */
export function createRaceConfig(characterId: string, vehicleId: string, mapId: string): RaceConfig {
  if (!CHARACTER_ROSTER.some((c) => c.id === characterId)) throw new Error(`unknown characterId: ${characterId}`);
  if (!VEHICLE_ROSTER.some((v) => v.id === vehicleId)) throw new Error(`unknown vehicleId: ${vehicleId}`);
  if (!MAP_IDS.has(mapId)) throw new Error(`unknown mapId: ${mapId}`);
  return Object.freeze({ characterId, vehicleId, mapId });
}
