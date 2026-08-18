/**
 * Shared headless race fixture for Phase 5 item tests.
 *
 * Builds a real Meadows spline + four karts parked at fixed track fractions so
 * effects can be exercised deterministically without running a full race. The
 * owner defaults to the LAST kart (rank 4) — the classic "worst position" case.
 */

import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { EventBus, type GameEvents } from "../../src/core/EventBus.js";
import { createRng, type Rng } from "../../src/core/Rng.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { createKart, type KartEntity } from "../../src/entities/KartEntity.js";

/** Fixed track fractions (t) for the four karts, leader → last. */
export const FIXTURE_T = [0.5, 0.35, 0.2, 0.05] as const;
const IDS = ["leader", "mid1", "mid2", "last"] as const;

export interface RaceFixture {
  spline: TrackSpline;
  bus: EventBus<GameEvents>;
  rng: Rng;
  /** karts[0]=leader … karts[3]=last. */
  karts: KartEntity[];
  owner: KartEntity; // default = last (rank 4)
}

/** Build the fixture. `ownerIndex` selects which kart is the item's owner (default 3). */
export function makeRaceFixture(seed = 7, ownerIndex = 3): RaceFixture {
  const spline = new TrackSpline(
    MEADOWS_TRACK.controlPoints,
    MEADOWS_TRACK.roadWidth,
    TUNING.physics.onRoadMargin,
  );
  const bus = new EventBus<GameEvents>();
  const rng = createRng(seed);

  const karts: KartEntity[] = IDS.map((id, i) => {
    const t = FIXTURE_T[i];
    const p = spline.pointAt(t);
    const tan = spline.tangentAt(t);
    return createKart({
      id,
      name: id,
      isPlayer: false,
      color: [1, 0.5, 0.2],
      pos: { x: p.x, y: 0, z: p.z },
      heading: Math.atan2(tan.x, tan.z), // heading 0 = +Z forward
      profile: { topSpeedStat: 3, accelStat: 3 },
    });
  });

  return { spline, bus, rng, karts, owner: karts[ownerIndex] };
}
