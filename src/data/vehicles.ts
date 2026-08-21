/**
 * Vehicle roster — pure data, zero Babylon imports (architecture §2).
 * Modifier values are fixed by 00-overview.md §3; do not deviate.
 */

import { TUNING } from "./tuning.js";
import { CHARACTER_ROSTER } from "./characters.js";

export interface VehicleDef {
  readonly id: string;
  readonly name: string;
  readonly type: "kart" | "bike" | "atv";
  // modifiers added to character stats, clamped to 1..5 by combinedStats(); each in -1..+1
  readonly modifiers: Readonly<{ accel: number; topSpeed: number; handling: number; offRoad: number }>;
}

export interface CombinedStats {
  accel: number;
  topSpeed: number;
  handling: number;
  offRoad: number;
}

const MOD_AXES = ["accel", "topSpeed", "handling", "offRoad"] as const;

export const VEHICLE_ROSTER: readonly VehicleDef[] = [
  {
    id: "basher",
    name: "Basher",
    type: "kart",
    // neutral all-rounder kart — no stat modifiers
    modifiers: { accel: 0, topSpeed: 0, handling: 0, offRoad: 0 },
  },
  {
    id: "zippy",
    name: "Zippy",
    type: "bike",
    // twitchy bike — quick to launch and turn, lower top speed
    modifiers: { accel: 1, topSpeed: -1, handling: 1, offRoad: 0 },
  },
  {
    id: "quadzilla",
    name: "Quadzilla",
    type: "atv",
    // heavy ATV — fast and stable off-road, sluggish to launch and turn
    modifiers: { accel: -1, topSpeed: 1, handling: -1, offRoad: 1 },
  },
];

/**
 * Steer onset easing rate for a vehicle type (per second; 0 = instant). Bikes steer
 * instantly; the 4-wheelers (kart/ATV) ease their effective steer toward the input so
 * turns build up gradually. See TUNING.physics.steerEase4w.
 */
export function steerEaseRateFor(type: VehicleDef["type"]): number {
  return type === "bike" ? 0 : TUNING.physics.steerEase4w;
}

/** character stats + vehicle modifiers, each axis clamped to [1, 5]. Throws if an id is unknown. */
export function combinedStats(characterId: string, vehicleId: string): CombinedStats {
  const c = CHARACTER_ROSTER.find((x) => x.id === characterId);
  const v = VEHICLE_ROSTER.find((x) => x.id === vehicleId);
  if (!c || !v) throw new Error(`unknown id in combinedStats: ${characterId}/${vehicleId}`);
  const clamp = (n: number): number => Math.min(5, Math.max(1, n));
  return {
    accel: clamp(c.stats.accel + v.modifiers.accel),
    topSpeed: clamp(c.stats.topSpeed + v.modifiers.topSpeed),
    handling: clamp(c.stats.handling + v.modifiers.handling),
    offRoad: clamp(c.stats.offRoad + v.modifiers.offRoad),
  };
}

/** Throws on duplicate ids or any modifier outside -1..+1. Returns the roster when valid. */
export function validateVehicleRoster(roster: ReadonlyArray<VehicleDef>): readonly VehicleDef[] {
  const seen = new Set<string>();
  for (const v of roster) {
    if (seen.has(v.id)) throw new Error(`duplicate vehicle id: ${v.id}`);
    seen.add(v.id);
    for (const axis of MOD_AXES) {
      const value = v.modifiers[axis];
      if (!Number.isInteger(value) || value < -1 || value > 1) {
        throw new Error(`vehicle ${v.id} modifier ${axis} out of range -1..+1`);
      }
    }
  }
  return roster;
}

// Fail fast in dev and tests if the roster is ever tampered with.
validateVehicleRoster(VEHICLE_ROSTER);
