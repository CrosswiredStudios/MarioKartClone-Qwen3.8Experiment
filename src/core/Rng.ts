/**
 * Deterministic seeded RNG (01-architecture.md §9). All race randomness flows through
 * this — NEVER Math.random() — so headless tests are reproducible for a given seed.
 *
 * mulberry32: tiny, fast, good-enough distribution for gameplay skill factors. The
 * race seed itself is derived from the setup via {@link raceSeed} (a pure hash of the
 * three ids) so a given character/vehicle/map combo always produces the same AI field.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max]. */
  range(min: number, max: number): number;
  /** Uniform integer in [0, n) — for picking from a table of length n. */
  int(n: number): number;
}

/** Create a seeded RNG (mulberry32). Same seed → identical sequence. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
  };
}

/** Pure FNV-1a hash of the three race ids → a stable 32-bit seed for a given setup. */
export function raceSeed(characterId: string, vehicleId: string, mapId: string): number {
  const str = `${characterId}|${vehicleId}|${mapId}`;
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}
