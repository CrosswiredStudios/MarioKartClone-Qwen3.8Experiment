/**
 * AI strategy contract (01-architecture.md §4 — DIP). Pure, no Babylon.
 *
 * A strategy turns one kart's current state + the race view into a DriveInput for
 * this step. It NEVER mutates the kart or touches physics directly — it only
 * produces input, which RaceController feeds to stepKart (ISP: physics owns speed
 * caps and integration; the strategy owns "what would I press?").
 */

import type { KartEntity } from "./KartEntity.js";
import type { DriveInput } from "./KartPhysics.js";

/** Coarse per-kart progress snapshot handed to every strategy each step. */
export interface RaceView {
  readonly standings: ReadonlyArray<{ id: string; lap: number; progress: number }>;
}

export interface IAiStrategy {
  /** Produce this kart's DriveInput for one fixed step. Pure — no side effects. */
  decide(kart: KartEntity, view: RaceView, dt: number): DriveInput;
}
