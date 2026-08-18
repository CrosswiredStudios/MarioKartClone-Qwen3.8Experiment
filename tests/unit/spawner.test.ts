/**
 * Phase 5, Step 9 — ItemBoxSpawner.
 * Verifies pickup + event emission, the cooldown (no re-pickup until boxRespawnSec),
 * one-kart-per-cycle determinism, and no double-pickup while a kart holds an item.
 */

import { describe, it, expect } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { createRng } from "../../src/core/Rng.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { createKart, type KartEntity } from "../../src/entities/KartEntity.js";
import { ItemBoxSpawner } from "../../src/items/ItemBoxSpawner.js";

const DT = 1 / 60;
const spline = new TrackSpline(
  MEADOWS_TRACK.controlPoints,
  MEADOWS_TRACK.roadWidth,
  TUNING.physics.onRoadMargin,
);

interface Harness {
  spawner: ItemBoxSpawner;
  bus: EventBus<GameEvents>;
  karts: KartEntity[];
  /** Park a kart exactly on box `boxId` (mutates its pos). */
  parkOn: (kart: KartEntity, boxId: number) => void;
}

function buildHarness(seed = 7): Harness {
  const bus = new EventBus<GameEvents>();
  const spawner = new ItemBoxSpawner(MEADOWS_TRACK, spline, bus, createRng(seed));
  const karts: KartEntity[] = ["a", "b"].map((id) =>
    createKart({ id, name: id, isPlayer: false, color: [1, 0.5, 0.2], pos: { x: 0, y: 0, z: 0 }, heading: 0 }),
  );
  const boxes = spawner.boxes();
  return {
    spawner,
    bus,
    karts,
    parkOn: (kart, boxId) => {
      const b = boxes[boxId];
      kart.state.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    },
  };
}

describe("ItemBoxSpawner", () => {
  it("builds one box per cluster anchor at the track's itemBoxClusters", () => {
    const { spawner } = buildHarness();
    expect(spawner.boxes()).toHaveLength(MEADOWS_TRACK.itemBoxClusters.length);
    for (const b of spawner.boxes()) {
      expect(b.respawnAt).toBe(0); // available at race start
      expect(b.item).toBeNull(); // nothing rolled yet
    }
  });

  it("grants an item + emits item:pickedUp when a kart is in range", () => {
    const h = buildHarness();
    let picked: GameEvents["item:pickedUp"] | null = null;
    h.bus.on("item:pickedUp", (p) => (picked = p));

    h.parkOn(h.karts[0], 0); // kart "a" on box 0, holding nothing
    const standings = [{ id: "a", rank: 4 }, { id: "b", rank: 3 }];
    h.spawner.update(h.karts, standings, 10, DT);

    expect(picked).not.toBeNull();
    expect(picked!.kartId).toBe("a");
    expect(h.karts[0].state.item).toBe(picked!.item); // kart holds what was rolled
    // The box is now on cooldown.
    const box = h.spawner.boxes()[0];
    expect(box.respawnAt).toBeCloseTo(10 + TUNING.items.boxRespawnSec, 6);
  });

  it("does NOT re-pickup while the box is still on cooldown (t+0.1)", () => {
    const h = buildHarness();
    let count = 0;
    h.bus.on("item:pickedUp", () => count++);

    h.parkOn(h.karts[0], 0);
    h.spawner.update(h.karts, [{ id: "a", rank: 4 }], 10, DT); // first pickup at t=10
    expect(count).toBe(1);

    // Same kart still in range a tenth of a second later — box is on cooldown.
    h.spawner.update(h.karts, [{ id: "a", rank: 4 }], 10 + 0.1, DT);
    expect(count).toBe(1); // no second pickup
  });

  it("allows a fresh pickup once the cooldown elapses (t+5.01)", () => {
    const h = buildHarness();
    let count = 0;
    h.bus.on("item:pickedUp", () => count++);

    h.parkOn(h.karts[0], 0);
    h.spawner.update(h.karts, [{ id: "a", rank: 4 }], 10, DT); // pickup at t=10 → respawnAt = 15
    expect(count).toBe(1);

    // Just before the window closes — still on cooldown (kart would be eligible if not).
    h.spawner.update(h.karts, [{ id: "a", rank: 4 }], 10 + TUNING.items.boxRespawnSec - 0.01, DT);
    expect(count).toBe(1);

    // Just after — the box re-rolls and can be taken again. (In a real race the kart
    // would have USED its item in between; simulate that by clearing it.)
    h.karts[0].state.item = null;
    h.spawner.update(h.karts, [{ id: "a", rank: 4 }], 10 + TUNING.items.boxRespawnSec + 0.01, DT);
    expect(count).toBe(2);
  });

  it("grants only one kart per cycle — the first eligible kart in fixed order wins", () => {
    const h = buildHarness();
    let count = 0;
    h.bus.on("item:pickedUp", () => count++);

    // Both karts parked on the SAME box, both holding nothing.
    h.parkOn(h.karts[0], 0);
    h.parkOn(h.karts[1], 0);
    const standings = [{ id: "a", rank: 4 }, { id: "b", rank: 3 }];

    h.spawner.update(h.karts, standings, 20, DT);

    // Exactly one pickup this cycle; the first kart in array order ("a") wins.
    expect(count).toBe(1);
    expect(h.karts[0].state.item).not.toBeNull();
    expect(h.karts[1].state.item).toBeNull();
  });

  it("does not double-pickup a kart that already holds an item", () => {
    const h = buildHarness();
    let count = 0;
    h.bus.on("item:pickedUp", () => count++);

    // Kart "a" already holds an item and is in range.
    h.karts[0].state.item = "mushroom";
    h.parkOn(h.karts[0], 0);
    const standings = [{ id: "a", rank: 4 }, { id: "b", rank: 3 }];

    h.spawner.update(h.karts, standings, 30, DT);

    // No pickup — the only kart in range is already holding.
    expect(count).toBe(0);
    expect(h.karts[0].state.item).toBe("mushroom"); // unchanged
  });
});
