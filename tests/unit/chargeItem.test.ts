import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { createRaceConfig } from "../../src/core/RaceConfig.js";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { createRng } from "../../src/core/Rng.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { RaceController } from "../../src/race/RaceController.js";
import type { IInputSource } from "../../src/input/IInputSource.js";
import { createKart } from "../../src/entities/KartEntity.js";
import { makeShell } from "../../src/items/ShellProjectile.js";

const DT = 1 / 60;

/**
 * Phase 5.1 — hold-to-charge item mechanic (green/red shell, banana).
 *
 * The player HOLDS the item button to "load" a chargeable item on the kart's rear
 * (state.charging); it fires on release. Blue shell + the rest fire on the press
 * edge. AI karts always fire immediately (no charge) — keeps headless determinism.
 *
 * These tests drive a real headless RaceController with a controllable mock input
 * so the charge state machine (in updateItems) is exercised end-to-end.
 */

interface TestRace {
  ctrl: RaceController;
  /** Mutable knobs the mock input reads each step. */
  input: { throttle: number; itemHeld: boolean; useItem: boolean };
}

function buildRace(seed = 1234): TestRace {
  const config = createRaceConfig("marvin", "basher", MEADOWS_TRACK.id);
  const spline = new TrackSpline(MEADOWS_TRACK.controlPoints, MEADOWS_TRACK.roadWidth, TUNING.physics.onRoadMargin);
  const bus = new EventBus<GameEvents>();
  const input = { throttle: 1, itemHeld: false, useItem: false };
  const mockInput: IInputSource = {
    axis: (name) => (name === "throttle" ? input.throttle : 0),
    button: () => false,
    buttonHeld: (name) => (name === "item" ? input.itemHeld : false),
    justPressed: (name) => (name === "item" ? input.useItem : false),
  };
  const ctrl = new RaceController({
    config,
    track: MEADOWS_TRACK,
    spline,
    bus,
    rng: createRng(seed),
    input: mockInput,
    renderEnabled: false,
  });
  return { ctrl, input };
}

/** Step through the 3 s countdown until the race is live. */
function stepToRacing(ctrl: RaceController): void {
  let steps = 0;
  while (ctrl.phase !== "racing" && steps < 600) {
    ctrl.update(DT);
    steps++;
  }
  expect(ctrl.phase).toBe("racing");
}

/** True if any live shell was fired by the given kart id. */
function hasShellFrom(ctrl: RaceController, kartId: string): boolean {
  return ctrl.shells().some((s) => s.ownerId === kartId);
}

describe("Phase 5.1 hold-to-charge item mechanic", () => {
  it("chargeable item: holding loads it (no fire, item retained)", () => {
    const { ctrl, input } = buildRace();
    stepToRacing(ctrl);

    ctrl.debugSetPlayerItem("greenShell");
    input.itemHeld = true;
    ctrl.update(DT);

    const player = ctrl.karts().find((k) => k.isPlayer)!;
    expect(player.state.charging).toBe("greenShell"); // loaded on the rear
    expect(player.state.item).toBe("greenShell"); // NOT consumed while charging
    expect(hasShellFrom(ctrl, "player")).toBe(false); // nothing fired yet
  });

  it("chargeable item: releasing fires it (shell spawned, charge cleared)", () => {
    const { ctrl, input } = buildRace();
    stepToRacing(ctrl);

    ctrl.debugSetPlayerItem("greenShell");
    input.itemHeld = true;
    ctrl.update(DT); // load
    expect(ctrl.karts().find((k) => k.isPlayer)!.state.charging).toBe("greenShell");

    input.itemHeld = false;
    ctrl.update(DT); // release → launch

    const player = ctrl.karts().find((k) => k.isPlayer)!;
    expect(player.state.charging).toBe(null); // charge cleared
    expect(player.state.item).not.toBe("greenShell"); // the green shell was consumed
    expect(hasShellFrom(ctrl, "player")).toBe(true); // a shell is now in the world
  });

  it("non-chargeable item (mushroom): fires on the press edge, never charges", () => {
    const { ctrl, input } = buildRace();
    stepToRacing(ctrl);

    ctrl.debugSetPlayerItem("mushroom");
    input.useItem = true; // press edge
    ctrl.update(DT);

    const player = ctrl.karts().find((k) => k.isPlayer)!;
    expect(player.state.item).not.toBe("mushroom"); // consumed on the press
    expect(player.state.charging).toBe(null); // mushrooms are not chargeable
    expect(hasShellFrom(ctrl, "player")).toBe(false); // a shroom is a boost, not a shell
  });

  it("blue shell: NOT chargeable — holding does nothing, press edge fires it", () => {
    const { ctrl, input } = buildRace();
    stepToRacing(ctrl);

    // Holding the blue shell must NOT load a charge (it targets the leader from
    // anywhere, so there's no aiming value in holding it).
    ctrl.debugSetPlayerItem("blueShell");
    input.itemHeld = true;
    input.useItem = false;
    ctrl.update(DT);

    let player = ctrl.karts().find((k) => k.isPlayer)!;
    expect(player.state.charging).toBe(null); // never charged
    expect(player.state.item).toBe("blueShell"); // still held (no press edge → not fired)
    expect(hasShellFrom(ctrl, "player")).toBe(false);

    // The press edge fires it immediately.
    input.itemHeld = false;
    input.useItem = true;
    ctrl.update(DT);

    player = ctrl.karts().find((k) => k.isPlayer)!;
    expect(player.state.item).not.toBe("blueShell"); // consumed
    expect(hasShellFrom(ctrl, "player")).toBe(true); // blue shell in the world
  });

  it("AI karts fire immediately (no charge) when holding an item", () => {
    const { ctrl } = buildRace();
    stepToRacing(ctrl);

    const ai = ctrl.karts().find((k) => !k.isPlayer)!;
    const before = ctrl.shells().filter((s) => s.ownerId === ai.id).length;

    ai.state.item = "greenShell"; // force an item onto an AI kart
    ctrl.update(DT); // AI always fires on the next step (no hold required)

    const after = ctrl.shells().filter((s) => s.ownerId === ai.id).length;
    expect(after).toBe(before + 1); // the AI's shell launched immediately
    expect(ai.state.charging).toBe(null); // AI never enters a charge state
  });

  it("charge clears when the item is lost mid-charge", () => {
    const { ctrl, input } = buildRace();
    stepToRacing(ctrl);

    ctrl.debugSetPlayerItem("greenShell");
    input.itemHeld = true;
    ctrl.update(DT);
    expect(ctrl.karts().find((k) => k.isPlayer)!.state.charging).toBe("greenShell");

    // Simulate losing the item (e.g. a shell hit) while still holding the button.
    const player = ctrl.karts().find((k) => k.isPlayer)!;
    player.state.item = null;
    ctrl.update(DT);

    expect(player.state.charging).toBe(null); // stale charge cleared
  });
});

describe("Phase 5.1 shell spawn offset (makeShell)", () => {
  it("spawns 1.2 m behind the kart along -forward (heading 0 = +Z)", () => {
    const kart = createKart({
      id: "t",
      name: "T",
      isPlayer: true,
      color: [1, 0, 0],
      pos: { x: 10, y: 0, z: 20 },
      heading: 0,
    });
    const shell = makeShell({ kind: "green", owner: kart }, 0);
    // forward = (sin 0, cos 0) = (0, 1); rear = -forward → z decreases.
    expect(shell.pos.x).toBeCloseTo(10, 5);
    expect(shell.pos.y).toBeCloseTo(0.5, 5); // fixed spawn height
    expect(shell.pos.z).toBeCloseTo(20 - TUNING.items.shellLaunchOffsetM, 5);
  });

  it("spawns behind along -forward for a non-zero heading (π/2 = +X)", () => {
    const kart = createKart({
      id: "t2",
      name: "T2",
      isPlayer: true,
      color: [0, 1, 0],
      pos: { x: 0, y: 0, z: 0 },
      heading: Math.PI / 2,
    });
    const shell = makeShell({ kind: "green", owner: kart }, 0);
    // forward = (sin π/2, cos π/2) = (1, 0); rear = -forward → x decreases.
    expect(shell.pos.x).toBeCloseTo(-TUNING.items.shellLaunchOffsetM, 5);
    expect(shell.pos.y).toBeCloseTo(0.5, 5);
    expect(shell.pos.z).toBeCloseTo(0, 5);
  });
});
