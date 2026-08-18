import { describe, expect, it } from "vitest";
import { initialLapState, onCheckpoint, type LapState } from "../../src/tracks/LapTracker.js";

const CP = 8; // checkpoints are at t = i/8 (architecture §4)

/** Feed a sequence of checkpoint indices through the tracker, returning all results. */
function feed(
  start: LapState,
  seq: number[],
  totalLaps?: number,
): { final: LapState; results: ReturnType<typeof onCheckpoint>[] } {
  let state = start;
  const results: ReturnType<typeof onCheckpoint>[] = [];
  for (const idx of seq) {
    const r = onCheckpoint(state, idx, CP, totalLaps);
    state = r.state;
    results.push(r);
  }
  return { final: state, results };
}

// One full loop from spawn: cross the line (cp0 — no lap yet), then cp1..7.
const SETUP_LAP = [0, 1, 2, 3, 4, 5, 6, 7];
// A lap-completing pass: cross the line after cp7 was last passed, then continue.
const COMPLETING_LAP = [0, 1, 2, 3, 4, 5, 6, 7];

describe("LapTracker.onCheckpoint", () => {
  it("(a) sequential checkpoints 0..7 then start-line wrap → lapCompleted === true, lap = 1", () => {
    const start = initialLapState();
    expect(start).toEqual({ lap: 0, lastCheckpointIdx: -1 });

    // First loop from spawn: cp0 crossing does NOT complete (no cp7 passed yet),
    // but it is accepted as the first checkpoint. After cp1..7, lastCP = 7.
    const setup = feed(start, SETUP_LAP);
    expect(setup.final).toEqual({ lap: 0, lastCheckpointIdx: 7 });
    expect(setup.results.every((r) => !r.lapCompleted)).toBe(true);

    // Second pass: the start-line crossing now completes lap 1.
    const { final, results } = feed(setup.final, COMPLETING_LAP);
    expect(final).toEqual({ lap: 1, lastCheckpointIdx: 7 });
    const finishEvent = results[0]; // cp0 is first in the sequence
    expect(finishEvent.lapCompleted).toBe(true);
    expect(results.slice(1).every((r) => !r.lapCompleted)).toBe(true);
  });

  it("(b) skipping checkpoint 3 → later start-line crossings do NOT count laps", () => {
    const start = initialLapState();
    // 0,1,2 accepted; 4 is out of order (expected 3) → ignored and everything after.
    const { final, results } = feed(start, [0, 1, 2, 4, 5, 6, 7, 0]);
    expect(final).toEqual({ lap: 0, lastCheckpointIdx: 2 }); // state frozen at the skip
    expect(results.every((r) => !r.lapCompleted)).toBe(true);

    // After re-passing cp3..cp7 and crossing the line again — that IS a valid full loop.
    const { final: f2 } = feed(final, [3, 4, 5, 6, 7, 0]);
    expect(f2).toEqual({ lap: 1, lastCheckpointIdx: 0 });
  });

  it("(c) reverse traversal (7,6,5,...) → no laps ever", () => {
    // From the spawn state, every reverse checkpoint is out of order.
    const start = initialLapState();
    const { final } = feed(start, [7, 6, 5, 4, 3, 2, 1]);
    expect(final).toEqual({ lap: 0, lastCheckpointIdx: -1 }); // state never changed

    // From a mid-track state, driving backwards across the line is worthless:
    // cp0 is not "expected" until cp7 has been passed in order.
    const { final: f2, results } = feed({ lap: 1, lastCheckpointIdx: 3 }, [2, 1, 0]);
    expect(f2).toEqual({ lap: 1, lastCheckpointIdx: 3 });
    expect(results.every((r) => !r.lapCompleted)).toBe(true);
  });

  it("(d) two laps in a row works (lap = 2 after second full sequence)", () => {
    const start = initialLapState();
    // Setup loop, then two lap-completing passes.
    const { final, results } = feed(start, [...SETUP_LAP, ...COMPLETING_LAP, ...COMPLETING_LAP]);
    expect(final).toEqual({ lap: 2, lastCheckpointIdx: 7 });
    const laps = results.filter((r) => r.lapCompleted);
    expect(laps.length).toBe(2);
  });

  it("(e) raceFinished set when configured totalLaps reached", () => {
    // Default totalLaps = 3: setup loop + three completing passes.
    const start = initialLapState();
    let state = feed(start, SETUP_LAP).final;
    for (let lap = 0; lap < 3; lap++) {
      const { results } = feed(state, COMPLETING_LAP);
      state = results[results.length - 1].state;
      const finishEvent = results.find((r) => r.lapCompleted)!;
      if (lap < 2) expect(finishEvent.raceFinished).toBeUndefined();
      else expect(finishEvent.raceFinished).toBe(true);
    }
    expect(state.lap).toBe(3);

    // Custom totalLaps: a 1-lap race finishes on the first completion.
    const one = feed(initialLapState(), [...SETUP_LAP, 0], 1);
    const finishEvent = one.results[one.results.length - 1];
    expect(finishEvent.raceFinished).toBe(true);
    expect(one.final.lap).toBe(1);
  });

  it("out-of-order single events leave state unchanged", () => {
    const start: LapState = { lap: 0, lastCheckpointIdx: 2 };
    for (const idx of [0, 1, 4, 5, 6]) {
      expect(onCheckpoint(start, idx, CP).state).toEqual(start);
    }
    const ok = onCheckpoint(start, 3, CP);
    expect(ok.state).toEqual({ lap: 0, lastCheckpointIdx: 3 });
    expect(ok.lapCompleted).toBeUndefined();
  });

  it("returns the same state reference when ignored (no allocation churn)", () => {
    const start: LapState = { lap: 1, lastCheckpointIdx: 4 };
    expect(onCheckpoint(start, 0, CP).state).toBe(start);
  });
});
