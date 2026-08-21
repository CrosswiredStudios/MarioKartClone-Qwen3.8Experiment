/**
 * Phase 7 — finish-out + perfect-start unit tests (headless, no Babylon).
 *
 * Verifies the RaceController behavior changes:
 *   - the race does NOT end when the player crosses the line on the last lap;
 *     `race:playerFinished` fires, the sim keeps stepping (AI-driven player), and
 *     `race:finished` only lands once every kart has finished or the grace deadline passes.
 *   - `skipFinishOut()` finalizes immediately with DNFs for unfinished karts.
 *   - a FRESH accelerate press (edge, not a hold) within the last 0.3 s before GO
 *     awards a one-shot "start" boost (kart:boosted); holding gas does not.
 */

import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { createRaceConfig } from "../../src/core/RaceConfig.js";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { createRng } from "../../src/core/Rng.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { RaceController } from "../../src/race/RaceController.js";
import type { IInputSource } from "../../src/input/IInputSource.js";

const DT = 1 / 60;
/** A full headless race is ~55–70 s of sim time — well over Vitest's default 5 s. */
const HEAVY_TIMEOUT = 90_000;

/**
 * Mutable mock input. `justThrottle` is the accelerate PRESS edge — tests set it
 * true for exactly one update() call (headless tests never run endLogicStep, so the
 * test owns clearing it, mirroring how GameApp clears the real edge each step).
 */
function makeMockInput(throttle = 0): { input: IInputSource; justThrottle: { value: boolean } } {
  const justThrottle = { value: false };
  const input: IInputSource = {
    axis: (name) => (name === "throttle" ? throttle : 0),
    button: () => false,
    buttonHeld: () => false,
    justPressed: (name) => (name === "throttle" ? justThrottle.value : false),
  };
  return { input, justThrottle };
}

interface FinishOutRace {
  ctrl: RaceController;
  bus: EventBus<GameEvents>;
  playerFinished: boolean;
  finishedPayload: GameEvents["race:finished"] | null;
  startBoosts: Array<{ kartId: string; tier: string }>;
}

/** Build a headless race with an optional mock input (player-driven) and event capture. */
function buildRace(seed: number, input?: IInputSource): FinishOutRace {
  const config = createRaceConfig("marvin", "basher", MEADOWS_TRACK.id);
  const spline = new TrackSpline(MEADOWS_TRACK.controlPoints, MEADOWS_TRACK.roadWidth, TUNING.physics.onRoadMargin);
  const bus = new EventBus<GameEvents>();

  // One shared mutable object: the event listeners mutate it in place so test code
  // (which holds the same reference) always sees live values.
  const state: FinishOutRace = {
    ctrl: null as unknown as RaceController,
    bus,
    playerFinished: false,
    finishedPayload: null,
    startBoosts: [],
  };
  bus.on("race:playerFinished", () => {
    state.playerFinished = true;
  });
  bus.on("race:finished", (p) => {
    state.finishedPayload = p;
  });
  bus.on("kart:boosted", ({ kartId, tier }) => {
    if (tier === "start") state.startBoosts.push({ kartId, tier });
  });

  state.ctrl = new RaceController({ config, track: MEADOWS_TRACK, spline, bus, rng: createRng(seed), input, renderEnabled: false });

  return state;
}

/** Step the race until `race:playerFinished` fires (or MAX_STEPS). Returns steps taken. */
function stepUntilPlayerFinished(race: FinishOutRace): number {
  let steps = 0;
  const MAX_STEPS = 5 * 60 * 60;
  while (steps < MAX_STEPS && !race.playerFinished) {
    race.ctrl.update(DT);
    steps++;
  }
  return steps;
}

describe("Phase 7 finish-out", () => {
  it("race keeps simulating after the player finishes; ends only when all karts/timeout", { timeout: HEAVY_TIMEOUT }, () => {
    const race = buildRace(1234);
    const stepsAtPlayerFinish = stepUntilPlayerFinished(race);

    // The player actually finished (event fired) and the controller agrees.
    expect(stepsAtPlayerFinish).toBeGreaterThan(0);
    expect(race.playerFinished).toBe(true);
    expect(race.ctrl.isPlayerFinished).toBe(true);
    expect(race.ctrl.phase).toBe("racing"); // NOT "finished" — finish-out is active

    // The player kart keeps moving under AI control (spectator mode).
    const player = race.ctrl.karts().find((k) => k.isPlayer)!;
    const posBefore = { ...player.state.pos };
    for (let i = 0; i < 60 * 5; i++) race.ctrl.update(DT); // +5 s of sim
    expect(player.state.pos.x).not.toBeCloseTo(posBefore.x, 3);
    expect(player.state.pos.z).not.toBeCloseTo(posBefore.z, 3);

    // The race eventually ends (all karts finished or the grace deadline passed) and
    // every kart has a rank; finishers have real times.
    const MAX_STEPS = 5 * 60 * 60;
    let steps = 0;
    while (race.ctrl.phase !== "finished" && steps < MAX_STEPS) {
      race.ctrl.update(DT);
      steps++;
    }
    expect(race.finishedPayload).not.toBeNull();
    const ranks = race.finishedPayload!.standings.map((s) => s.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);

    // The player's total time is recorded (they crossed the line for real).
    const playerTime = race.finishedPayload!.times["player"];
    expect(playerTime).toBeGreaterThan(0);
  });

  it("skipFinishOut() finalizes immediately with DNFs for unfinished karts", { timeout: HEAVY_TIMEOUT }, () => {
    const race = buildRace(1234);
    stepUntilPlayerFinished(race);
    expect(race.ctrl.phase).toBe("racing");

    // Skip right after the player finishes — at least one AI is still out there.
    race.ctrl.skipFinishOut();

    expect(race.ctrl.phase).toBe("finished");
    expect(race.finishedPayload).not.toBeNull();
    // The player has a real time; any kart that hadn't crossed the line is a DNF (null).
    const times = race.finishedPayload!.times;
    expect(times["player"]).toBeGreaterThan(0);
    const dnfCount = Object.values(race.ctrl.finalStandings()!).filter((s) => s.totalMs === null).length;
    // Only the player has crossed so far, so at least one of the other three karts is a DNF.
    expect(dnfCount).toBeGreaterThanOrEqual(1);

    // A second skip is a no-op (phase already "finished").
    const standings = race.ctrl.finalStandings()!;
    race.ctrl.skipFinishOut();
    expect(race.ctrl.finalStandings()).toEqual(standings);
  });

  it("skipFinishOut() before the player finishes is a no-op", () => {
    const race = buildRace(1234);
    for (let i = 0; i < 60 * 5; i++) race.ctrl.update(DT); // mid-race, well after GO
    expect(race.ctrl.phase).toBe("racing");
    race.ctrl.skipFinishOut();
    expect(race.ctrl.phase).toBe("racing"); // unchanged — player hasn't finished yet
  });

  it("perfect start: fresh accelerate press in the last 0.3 s before GO awards a one-shot 'start' boost", () => {
    const { input, justThrottle } = makeMockInput(1); // throttle held from t=0
    const race = buildRace(7, input);

    const totalSteps = Math.round((TUNING.race.countdownSeconds + 2) / DT);
    // Press on the step at t≈2.8 s — inside the [2.7, 3.0) window before GO.
    const pressStep = Math.round(2.8 / DT);
    for (let i = 0; i < totalSteps; i++) {
      if (i === pressStep) justThrottle.value = true;
      race.ctrl.update(DT);
      justThrottle.value = false; // consume the edge, as GameApp's endLogicStep would
    }

    // Exactly one start boost, on the player kart — granted at the GO transition.
    expect(race.startBoosts).toHaveLength(1);
    expect(race.startBoosts[0].kartId).toBe("player");
  });

  it("no perfect-start boost when gas is held but never freshly pressed in the window", () => {
    const { input } = makeMockInput(1); // throttle held from t=0, but justThrottle stays false
    const race = buildRace(7, input);

    for (let i = 0; i < Math.round((TUNING.race.countdownSeconds + 2) / DT); i++) {
      race.ctrl.update(DT);
    }

    expect(race.startBoosts).toHaveLength(0);
  });

  it("no perfect-start boost when the press lands before the window", () => {
    const { input, justThrottle } = makeMockInput(1);
    const race = buildRace(7, input);

    const totalSteps = Math.round((TUNING.race.countdownSeconds + 2) / DT);
    // Press at t≈2.5 s — 0.2 s BEFORE the [2.7, 3.0) window opens.
    const pressStep = Math.round(2.5 / DT);
    for (let i = 0; i < totalSteps; i++) {
      if (i === pressStep) justThrottle.value = true;
      race.ctrl.update(DT);
      justThrottle.value = false;
    }

    expect(race.startBoosts).toHaveLength(0);
  });
});
