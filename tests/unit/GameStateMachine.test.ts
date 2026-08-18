import { describe, expect, it, vi, type Mock } from "vitest";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import {
  GAME_SCREEN_IDS,
  GameStateMachine,
  TRANSITIONS,
  type GameContext,
  type GameScreenId,
  type IGameScreen,
} from "../../src/core/GameStateMachine.js";

/** A fake screen whose enter/exit are real vi.fn() mocks (for call-order asserts). */
interface FakeScreen extends IGameScreen {
  enter: Mock;
  exit: Mock;
}

function makeFakeScreen(id: GameScreenId): FakeScreen {
  return { id, enter: vi.fn(), exit: vi.fn() };
}

const ctx: GameContext = { engine: null, scene: null, eventBus: new EventBus<GameEvents>(), raceConfig: null, pendingSelection: {}, input: {} as never, freeDriveMode: false, renderPipeline: null, particleVfx: null, qualityProbe: null };

/** Registers every screen as a fake and returns the machine + screens map. */
function makeMachine(initial: GameScreenId) {
  const bus = new EventBus<GameEvents>();
  const machine = new GameStateMachine(initial, bus, ctx);
  const screens = new Map<GameScreenId, FakeScreen>();
  for (const id of GAME_SCREEN_IDS) {
    const screen = makeFakeScreen(id);
    screens.set(id, screen);
    machine.register(screen);
  }
  return { bus, machine, screens };
}

describe("GameStateMachine transitions", () => {
  it.each(
    (Object.entries(TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => [from as GameScreenId, to] as const),
    )) as Array<[GameScreenId, GameScreenId]>,
  )("transition %s -> %s succeeds", (from, to) => {
    const { machine } = makeMachine(from);
    machine.activateInitial();
    expect(() => machine.transition(to)).not.toThrow();
    expect(machine.currentId).toBe(to);
  });

  it.each(
    GAME_SCREEN_IDS.flatMap((from) =>
      GAME_SCREEN_IDS.filter((to) => to !== from && !TRANSITIONS[from].includes(to)).map(
        (to) => [from, to] as const,
      ),
    ),
  )("canTransition rejects %s -> %s", (from, to) => {
    const { machine } = makeMachine(from);
    expect(machine.canTransition(to)).toBe(false);
  });

  it.each(
    GAME_SCREEN_IDS.flatMap((from) =>
      GAME_SCREEN_IDS.filter((to) => to !== from && !TRANSITIONS[from].includes(to)).map(
        (to) => [from, to] as const,
      ),
    ),
  )("transition throws on forced %s -> %s", (from, to) => {
    const { machine } = makeMachine(from);
    expect(() => machine.transition(to)).toThrow(/Illegal transition/);
    // State is unchanged after a rejected transition.
    expect(machine.currentId).toBe(from);
  });

  it("canTransition accepts every target in the table", () => {
    for (const from of GAME_SCREEN_IDS) {
      const { machine } = makeMachine(from);
      for (const to of TRANSITIONS[from]) {
        expect(machine.canTransition(to)).toBe(true);
      }
    }
  });

  it("register throws on duplicate and unknown ids", () => {
    const { machine, screens } = makeMachine("MainMenu");
    expect(() => machine.register(screens.get("MainMenu")!)).toThrow(/Duplicate/);
    // @ts-expect-error deliberately invalid id to exercise the guard
    expect(() => machine.register(makeFakeScreen("NotAScreen"))).toThrow(/Unknown screen/);
  });

  it("unregister allows re-registering a replacement for the same id (second-race scene)", () => {
    const { machine, screens } = makeMachine("MainMenu");
    machine.activateInitial();
    // Walk to Racing with the first scene instance.
    machine.transition("CharacterSelect");
    machine.transition("VehicleSelect");
    machine.transition("MapSelect");
    machine.transition("Countdown");
    machine.transition("Racing");

    const second = makeFakeScreen("Racing");
    expect(() => machine.register(second)).toThrow(/Duplicate/);

    // Teardown path: drop the per-race screen, then register a fresh one.
    machine.unregister("Racing");
    expect(machine.has("Racing")).toBe(false);
    machine.register(second);
    expect(machine.has("Racing")).toBe(true);

    // A later transition into Racing enters the NEW screen, not the stale one.
    machine.transition("Results");
    machine.transition("CharacterSelect");
    machine.transition("VehicleSelect");
    machine.transition("MapSelect");
    machine.transition("Countdown");
    machine.transition("Racing");
    expect(second.enter).toHaveBeenCalledTimes(1);
    expect(screens.get("Racing")!.enter).toHaveBeenCalledTimes(1); // old one never re-entered
  });

  it("unregister on an unregistered id is a no-op", () => {
    const { machine } = makeMachine("MainMenu");
    expect(() => machine.unregister("Racing")).not.toThrow();
    expect(machine.has("Racing")).toBe(false);
  });
});

describe("GameStateMachine enter/exit", () => {
  it("calls exit() on the old screen and enter(ctx) on the new one, in that order", () => {
    const { machine, screens } = makeMachine("MainMenu");
    machine.activateInitial();
    const mainMenu = screens.get("MainMenu")!;
    const characterSelect = screens.get("CharacterSelect")!;

    expect(mainMenu.enter).toHaveBeenCalledTimes(1);
    expect(mainMenu.enter).toHaveBeenCalledWith(ctx);

    machine.transition("CharacterSelect");

    // exit() strictly before enter().
    expect(characterSelect.exit.mock.invocationCallOrder[0]).toBeUndefined();
    expect(mainMenu.exit.mock.invocationCallOrder[0]).toBeLessThan(
      characterSelect.enter.mock.invocationCallOrder[0],
    );
    expect(characterSelect.enter).toHaveBeenCalledWith(ctx);
  });

  it("emits ui:navigate with { to } after a successful transition", () => {
    const { bus, machine } = makeMachine("MainMenu");
    const navs: Array<{ to: GameScreenId }> = [];
    bus.on("ui:navigate", (p) => navs.push(p));
    machine.activateInitial();

    machine.transition("CharacterSelect");
    expect(navs).toEqual([{ to: "CharacterSelect" }]);

    // Listeners observe the already-updated currentId when they run.
    let observed: GameScreenId | null = null;
    bus.on("ui:navigate", () => {
      observed = machine.currentId;
    });
    machine.transition("VehicleSelect");
    expect(observed).toBe("VehicleSelect");
  });

  it("activateInitial is idempotent and enters the initial screen once", () => {
    const { machine, screens } = makeMachine("MainMenu");
    machine.activateInitial();
    machine.activateInitial();
    expect(screens.get("MainMenu")!.enter).toHaveBeenCalledTimes(1);
  });
});
