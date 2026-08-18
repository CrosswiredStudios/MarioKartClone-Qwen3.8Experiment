/**
 * Pure race standings — rank karts by progress (06-phase-4-race-loop-and-ai.md, Step 1).
 *
 * Ordering is coarse-to-fine so it never regresses within a lap:
 *   1. `lap` descending          (completed laps)
 *   2. `checkpointIdx` descending (progress through the current lap)
 *   3. spline `t` descending      (sub-checkpoint refinement)
 *   4. kart id ascending          (deterministic tie-break — architecture §9)
 *
 * No Babylon, no mutation: returns a fresh array of {id, rank} with rank 1 = leader.
 */

import type { KartEntity } from "../entities/KartEntity.js";
import type { TrackSpline } from "../tracks/TrackSpline.js";

export interface StandingRow {
  readonly id: string;
  readonly rank: number; // 1-based, 1 = leader
}

/** Rank karts by (lap desc, checkpointIdx desc, spline t desc), ties broken by id asc. */
export function computeStandings(
  karts: ReadonlyArray<KartEntity>,
  spline: TrackSpline,
): StandingRow[] {
  // Resolve each kart's fine-grained progress once; keep a lookup for the sort.
  const tById = new Map<string, number>();
  for (const k of karts) {
    tById.set(k.id, spline.closestPoint({ x: k.state.pos.x, z: k.state.pos.z }).t);
  }

  const ordered = [...karts].sort((a, b) => {
    if (a.state.lap !== b.state.lap) return b.state.lap - a.state.lap; // lap desc
    if (a.state.checkpointIdx !== b.state.checkpointIdx) {
      return b.state.checkpointIdx - a.state.checkpointIdx; // checkpoint desc
    }
    const ta = tById.get(a.id)!;
    const tb = tById.get(b.id)!;
    if (ta !== tb) return tb - ta; // spline t desc
    return a.id < b.id ? -1 : 1; // exact tie → id asc (determinism)
  });

  return ordered.map((k, i) => ({ id: k.id, rank: i + 1 }));
}
