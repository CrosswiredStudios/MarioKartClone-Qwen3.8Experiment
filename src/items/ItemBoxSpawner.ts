/**
 * Item box spawner — pure logic, no Babylon (07-phase-5 Step 9).
 *
 * One rotating box per cluster anchor in `track.itemBoxClusters`. A box with no item
 * spawns one when taken: the table used is that of the RANK OF THE KART WHO TAKES IT
 * (position-based at pickup time, classic behavior), drawn uniformly via the seeded
 * race RNG. Pickup radius 1.2 m; a kart can only pick up if it holds no item; once
 * taken the box is empty until `respawnAt = simTime + boxRespawnSec`, then re-rolls.
 *
 * Emits `item:pickedUp` and sets `kart.state.item` directly — legal because this runs
 * inside RaceController.update(dt).
 */

import type { Vec3 } from "../core/Vec.js";
import type { Rng } from "../core/Rng.js";
import type { EventBus, GameEvents } from "../core/EventBus.js";
import type { TrackDefinition } from "../data/tracks/shared.js";
import type { TrackSpline } from "../tracks/TrackSpline.js";
import { SPAWN_TABLES } from "../data/items.js";
import { TUNING } from "../data/tuning.js";
import type { KartEntity } from "../entities/KartEntity.js";
import type { ItemId } from "../entities/KartPhysics.js";

export interface ItemBox {
  readonly id: number;
  pos: Vec3; // y = 0 (render layer lifts it)
  item: ItemId | null;
  respawnAt: number; // sim-time seconds when an empty box re-rolls
}

/** Lateral offset of a cluster anchor, computed once from the spline. */
function anchorPos(spline: TrackSpline, t: number, lateralOffset: number): Vec3 {
  const p = spline.pointAt(t);
  const tan = spline.tangentAt(t);
  // Left normal (rotate tangent +90° about Y).
  const nx = -tan.z;
  const nz = tan.x;
  return { x: p.x + nx * lateralOffset, y: 0, z: p.z + nz * lateralOffset };
}

export class ItemBoxSpawner {
  private readonly _boxes: ItemBox[] = [];

  constructor(
    track: TrackDefinition,
    spline: TrackSpline,
    // bus/rng are stored but the spawner only uses them in update(); kept as params
    // to match the documented signature and keep construction side-effect free.
    private readonly _bus: EventBus<GameEvents>,
    private readonly _rng: Rng,
  ) {
    track.itemBoxClusters.forEach((cluster, i) => {
      this._boxes.push({
        id: i,
        pos: anchorPos(spline, cluster.t, cluster.lateralOffset ?? 0),
        item: null,
        respawnAt: 0, // spawn immediately available at race start
      });
    });
  }

  /** All boxes (render layer reads positions + whether an item is present). */
  boxes(): ReadonlyArray<ItemBox> {
    return this._boxes;
  }

  /**
   * One fixed step: respawn timers + pickup checks. Emits `item:pickedUp` and sets
   * `kart.state.item`. Karts are iterated in the given (fixed entity-array) order so
   * the one-kart-per-cycle rule is deterministic — the first eligible kart wins.
   *
   * Availability model: a box is "available" while `respawnAt === 0` (or once its
   * cooldown elapses). The item itself is rolled LAZILY at pickup from the taker's
   * rank table, so before a pickup there is no concrete item value — `box.item` only
   * records what was last given (informational for the render layer).
   */
  update(
    karts: ReadonlyArray<KartEntity>,
    standings: ReadonlyArray<{ id: string; rank: number }>,
    simTime: number,
    _dt: number,
  ): void {
    const it = TUNING.items;

    // Cooldown expiry first (independent of pickups this step).
    for (const box of this._boxes) {
      if (box.respawnAt > 0 && simTime >= box.respawnAt) {
        box.respawnAt = 0; // ready to roll again on next pickup
        box.item = null; // re-rolls for the next taker
      }
    }

    const rankOf = new Map(standings.map((s) => [s.id, s.rank]));

    for (const box of this._boxes) {
      if (box.respawnAt > 0) continue; // still on cooldown — empty

      // First eligible kart in fixed order wins the cycle.
      for (const k of karts) {
        if (k.state.item !== null) continue; // already holding — can't pick up again
        const dx = k.state.pos.x - box.pos.x;
        const dz = k.state.pos.z - box.pos.z;
        if (dx * dx + dz * dz > it.pickupRadiusM * it.pickupRadiusM) continue;

        const rank = (rankOf.get(k.id) ?? 4) as 1 | 2 | 3 | 4;
        const table = SPAWN_TABLES[rank];
        const item = table[this._rng.int(table.length)];
        box.item = item; // informational — what this cycle gave out
        k.state.item = item;
        this._bus.emit("item:pickedUp", { kartId: k.id, item });

        // One kart per cycle: the box is now empty until it respawns.
        box.respawnAt = simTime + it.boxRespawnSec;
        break;
      }
    }
  }
}
