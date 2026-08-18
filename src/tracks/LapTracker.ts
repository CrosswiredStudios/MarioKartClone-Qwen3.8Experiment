/**
 * Checkpoint-sequence → lap counting (pure, no Babylon).
 *
 * Rules (05-phase-3-track-system.md):
 * 1. Checkpoints must be hit IN ORDER with wraparound: from lastCheckpointIdx the
 *    only acceptable next index is (last + 1) % totalCheckpoints; anything else
 *    is ignored (state unchanged). Out-of-order or skipped checkpoints count for nothing.
 * 2. The start line IS checkpoint 0 (t = 0). Crossing it counts a lap ONLY if the
 *    previous valid checkpoint was totalCheckpoints - 1 — i.e. the kart actually went
 *    around the loop since its last line crossing. This makes reverse-laps and shortcuts
 *    worthless: driving backwards across the line never advances you to cp7 first.
 * 3. On a valid lap completion: lap += 1, lastCheckpointIdx = 0; if lap reaches
 *    totalLaps (default 3) the result also carries raceFinished: true.
 *
 * AS-BUILT DEVIATION (documented per plan): the doc's pseudocode combined with an
 * initial lastCheckpointIdx of 7 would count the FIRST line crossing from spawn as a
 * completed lap (expected = (7+1)%8 = 0, and cp0 always completes). That contradicts
 * test spec (a) — "sequential checkpoints 0..7 THEN start-line wrap → lapCompleted,
 * lap = 1" — and the doc's own note that "the first full loop completes lap 1". We
 * therefore initialize lastCheckpointIdx to the sentinel -1 ("no checkpoint passed
 * yet"). The next-expected index is still 0 ((−1+1)%8), so a kart spawning just behind
 * the line has cp0 as its first real checkpoint exactly as intended; the difference is
 * that crossing the line at spawn does NOT complete a lap — only the crossing after
 * passing cp0..cp7 in order does.
 *
 * Crossing detection (whoever calls onCheckpoint — RaceController in Phase 4):
 *   prevT/newT from consecutive closestPoint() calls; for each checkpoint i whose
 *   t_i = i/totalCheckpoints lies in (min(prev,new), max(prev,new]] call onCheckpoint.
 *   On wraparound (prevT > newT) also test checkpoints in (prevT, 1] ∪ [0, newT].
 */

export interface LapState {
  lap: number; // completed laps so far
  lastCheckpointIdx: number; // -1 = none passed yet (spawn sentinel); else 0-based index
}

export interface CheckpointResult {
  state: LapState;
  lapCompleted?: boolean;
  raceFinished?: boolean;
}

/** Initial lap state for a kart spawned just behind the start line. */
export function initialLapState(): LapState {
  return { lap: 0, lastCheckpointIdx: -1 };
}

export function onCheckpoint(
  state: LapState,
  checkpointIdx: number,
  totalCheckpoints: number,
  totalLaps = 3,
): CheckpointResult {
  const expected = (state.lastCheckpointIdx + 1) % totalCheckpoints;
  if (checkpointIdx !== expected) return { state }; // out of order → ignore

  const next: LapState = { lap: state.lap, lastCheckpointIdx: checkpointIdx };
  if (checkpointIdx === 0 && state.lastCheckpointIdx === totalCheckpoints - 1) {
    // Start line crossed with cp7 as the previous valid checkpoint → full loop done.
    next.lap = state.lap + 1;
    const finished = next.lap >= totalLaps;
    return { state: next, lapCompleted: true, raceFinished: finished || undefined };
  }
  return { state: next };
}
