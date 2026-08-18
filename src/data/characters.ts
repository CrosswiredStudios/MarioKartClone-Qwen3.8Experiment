/**
 * Character roster — pure data, zero Babylon imports (architecture §2).
 * Stat vectors are fixed by 00-overview.md §3; do not deviate.
 */

export interface CharacterDef {
  readonly id: string;
  readonly name: string;
  // punSource is an internal comment only — it must NEVER be rendered in the UI (IP safety, overview §2)
  readonly stats: Readonly<{ accel: number; topSpeed: number; handling: number; offRoad: number }>; // each 1–5
  readonly color: [number, number, number]; // RGB 0..1, kart body tint
}

const STAT_AXES = ["accel", "topSpeed", "handling", "offRoad"] as const;

export const CHARACTER_ROSTER: readonly CharacterDef[] = [
  {
    id: "marvin",
    name: "Marvin",
    // pun archetype (internal only): balanced all-rounder, red-cap plumber pun
    stats: { accel: 3, topSpeed: 3, handling: 3, offRoad: 3 },
    color: [0.85, 0.16, 0.16], // red
  },
  {
    id: "louie",
    name: "Louie",
    // pun archetype (internal only): nimble green gardener, fast off-road
    stats: { accel: 4, topSpeed: 2, handling: 4, offRoad: 5 },
    color: [0.16, 0.72, 0.25], // green
  },
  {
    id: "pearl",
    name: "Pearl",
    // pun archetype (internal only): top-speed queen, pink, fragile handling
    stats: { accel: 2, topSpeed: 5, handling: 2, offRoad: 3 },
    color: [0.98, 0.62, 0.82], // pink
  },
  {
    id: "terry",
    name: "Terry",
    // pun archetype (internal only): slow-but-sturdy purple brute
    stats: { accel: 1, topSpeed: 4, handling: 2, offRoad: 4 },
    color: [0.35, 0.22, 0.75], // purple
  },
];

/** Throws Error on duplicate ids or any stat outside 1..5 (non-integer included). Returns the roster when valid. */
export function validateCharacterRoster(roster: ReadonlyArray<CharacterDef>): readonly CharacterDef[] {
  const seen = new Set<string>();
  for (const c of roster) {
    if (seen.has(c.id)) throw new Error(`duplicate character id: ${c.id}`);
    seen.add(c.id);
    for (const axis of STAT_AXES) {
      const value = c.stats[axis];
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error(`character ${c.id} stat ${axis} out of range 1..5`);
      }
    }
  }
  return roster;
}

// Fail fast in dev and tests if the roster is ever tampered with.
validateCharacterRoster(CHARACTER_ROSTER);
