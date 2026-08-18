import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { createRaceConfig } from "../../src/core/RaceConfig.js";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { createRng } from "../../src/core/Rng.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { RaceController } from "../../src/race/RaceController.js";

const DT = 1 / 60;
const MAX_STEPS = 5 * 60 * 60; // ≤ 5 min sim time

interface RaceResult {
  finished: GameEvents["race:finished"] | null;
  ctrl: RaceController;
  lapTimes: Map<string, number[]>;
  /** Ordered item:pickedUp events (kartId + item) — Phase 5 determinism check. */
  pickups: Array<{ kartId: string; item: string }>;
  simSeconds: number;
}

function buildRace(seed: number): RaceResult {
  const config = createRaceConfig("marvin", "basher", MEADOWS_TRACK.id);
  const spline = new TrackSpline(MEADOWS_TRACK.controlPoints, MEADOWS_TRACK.roadWidth, TUNING.physics.onRoadMargin);
  const bus = new EventBus<GameEvents>();

  // Capture per-kart lap times (in completion order) and the finish payload.
  const lapTimes = new Map<string, number[]>();
  const pickups: Array<{ kartId: string; item: string }> = [];
  let finished: GameEvents["race:finished"] | null = null;
  bus.on("race:lapCompleted", ({ kartId, timeMs }) => {
    const arr = lapTimes.get(kartId) ?? [];
    arr.push(timeMs);
    lapTimes.set(kartId, arr);
  });
  bus.on("item:pickedUp", (p) => pickups.push({ kartId: p.kartId, item: p.item }));
  bus.on("race:finished", (p) => {
    finished = p;
  });

  const ctrl = new RaceController({ config, track: MEADOWS_TRACK, spline, bus, rng: createRng(seed), renderEnabled: false });

  let steps = 0;
  for (; steps < MAX_STEPS && !finished; steps++) ctrl.update(DT);

  return { finished, ctrl, lapTimes, pickups, simSeconds: steps / 60 };
}

// A full headless race is ~18k fixed steps × 4 karts — well over Vitest's default 5 s.
const HEAVY_TIMEOUT = 60_000;

describe("headless full race (the key Phase 4 test)", () => {
  it("completes a full 3-lap race in a sane window", { timeout: HEAVY_TIMEOUT }, () => {
    const { finished, ctrl, lapTimes, simSeconds } = buildRace(1234);

    expect(finished).not.toBeNull();
    // Bounds tuned after the Phase 4.1 re-author: a 3-lap Meadows race at base
    // speed is ~55 s of sim time (Meadows ≈ 650 m/lap, ~18 s/lap).
    expect(simSeconds).toBeGreaterThanOrEqual(45);
    expect(simSeconds).toBeLessThan(75);

    const ranks = finished!.standings.map((s) => s.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]); // exactly four unique ranks

    const player = ctrl.karts().find((k) => k.id === "player")!;
    expect(player.state.lap).toBe(3); // completed exactly 3 laps
    expect(lapTimes.get("player")).toHaveLength(3);

    // Every recorded lap time is plausible (not stuck, not teleporting): a single
    // Meadows lap at base speed is now ~18 s (Phase 4.1 longer course); keep the
    // generous per-lap bounds.
    for (const times of lapTimes.values()) {
      for (const t of times) {
        expect(t).toBeGreaterThan(5_000);
        expect(t).toBeLessThan(30_000);
      }
    }

    // No NaN anywhere in final positions.
    for (const k of ctrl.karts()) {
      expect([k.state.pos.x, k.state.pos.y, k.state.pos.z].every(Number.isFinite)).toBe(true);
    }
  });

  it("is deterministic: same seed → identical standings and lap times", { timeout: HEAVY_TIMEOUT }, () => {
    const a = buildRace(42);
    const b = buildRace(42);

    expect(a.finished).not.toBeNull();
    expect(b.finished).not.toBeNull();
    expect(a.finished!.standings.map((s) => s.id)).toEqual(b.finished!.standings.map((s) => s.id));

    const allIds = a.ctrl.karts().map((k) => k.id);
    for (const id of allIds) {
      expect(a.lapTimes.get(id)).toEqual(b.lapTimes.get(id)); // ±0 ms — fixed timestep, no float drift tolerance needed
    }
  });

  it("different seeds can produce a different field order (skill factors vary)", () => {
    // Not guaranteed to differ for every seed pair, but across a small sweep at least one
    // ordering should change — sanity that the RNG actually feeds the AI skill factor.
    const orders = [1, 2, 3, 4, 5].map((s) => buildRace(s).finished!.standings.map((x) => x.id).join(","));
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it("Phase 5: items are active and item:pickedUp sequences are deterministic per seed", { timeout: HEAVY_TIMEOUT }, () => {
    const a = buildRace(42);
    const b = buildRace(42);

    // Items actually fire in a full race (boxes exist on Meadows; AI auto-uses).
    expect(a.pickups.length, "expected at least one item pickup over the race").toBeGreaterThan(0);

    // Same seed → identical ordered pickup sequences (kartId + rolled item).
    expect(a.pickups).toEqual(b.pickups);
  });
});
