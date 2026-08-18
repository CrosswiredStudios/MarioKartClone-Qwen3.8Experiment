import { describe, expect, it, vi } from "vitest";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";

describe("EventBus", () => {
  it("emit reaches subscriber with the exact payload", () => {
    const bus = new EventBus<GameEvents>();
    const listener = vi.fn();
    bus.on("race:lapCompleted", listener);
    bus.emit("race:lapCompleted", { kartId: "k1", lap: 2, timeMs: 45000 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kartId: "k1", lap: 2, timeMs: 45000 });
  });

  it("off removes a subscriber so it is not called again", () => {
    const bus = new EventBus<GameEvents>();
    const listener = vi.fn();
    bus.on("race:start", listener);
    bus.off("race:start", listener);
    bus.emit("race:start", {});
    expect(listener).not.toHaveBeenCalled();
  });

  it("on() returns an unsubscribe function that works", () => {
    const bus = new EventBus<GameEvents>();
    const listener = vi.fn();
    const off = bus.on("kart:hit", listener);
    off();
    bus.emit("kart:hit", { kartId: "k1" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple subscribers all receive the event, in registration order", () => {
    const bus = new EventBus<GameEvents>();
    const calls: string[] = [];
    bus.on("item:pickedUp", (p) => calls.push(`a:${p.item}`));
    bus.on("item:pickedUp", (p) => calls.push(`b:${p.item}`));
    bus.emit("item:pickedUp", { kartId: "k1", item: "mushroom" });
    expect(calls).toEqual(["a:mushroom", "b:mushroom"]);
  });

  it("no throw when emitting with zero listeners", () => {
    const bus = new EventBus<GameEvents>();
    expect(() => bus.emit("race:finished", { standings: [], times: {} })).not.toThrow();
  });

  it("emitting one event does not invoke subscribers of other events", () => {
    const bus = new EventBus<GameEvents>();
    const other = vi.fn();
    bus.on("kart:boosted", other);
    bus.emit("kart:skid", { kartId: "k1", cause: "banana" });
    expect(other).not.toHaveBeenCalled();
  });
});
