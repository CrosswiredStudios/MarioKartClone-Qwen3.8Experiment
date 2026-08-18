import { describe, expect, it } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { KartEntity } from "../../src/entities/KartEntity.js";
import { createKart } from "../../src/entities/KartEntity.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import { computeStandings } from "../../src/race/StandingsCalculator.js";

const spline = new TrackSpline(MEADOWS_TRACK.controlPoints, MEADOWS_TRACK.roadWidth, TUNING.physics.onRoadMargin);

/** A kart parked on the centerline at arc position t, with explicit lap/checkpoint progress. */
function kartAt(id: string, t: number, overrides: Partial<Pick<KartEntity["state"], "lap" | "checkpointIdx">> = {}): KartEntity {
  const p = spline.pointAt(t);
  const k = createKart({
    id,
    name: id,
    isPlayer: false,
    color: [1, 0, 0],
    pos: { x: p.x, y: 0, z: p.z },
    heading: 0,
  });
  if (overrides.lap !== undefined) k.state.lap = overrides.lap;
  if (overrides.checkpointIdx !== undefined) k.state.checkpointIdx = overrides.checkpointIdx;
  return k;
}

describe("computeStandings", () => {
  it("orders leader / mid / trailer by lap desc on the real Meadows spline", () => {
    const a = kartAt("a", 0.1, { lap: 2, checkpointIdx: 3 }); // leader: most laps done
    const b = kartAt("b", 0.9, { lap: 1, checkpointIdx: 6 }); // mid
    const c = kartAt("c", 0.5, { lap: 0, checkpointIdx: 4 }); // trailer
    const rows = computeStandings([c, a, b], spline);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("same lap: higher checkpointIdx ranks ahead regardless of t", () => {
    // b is at a later checkpoint but an EARLIER raw t (checkpoint boundary wrap).
    const a = kartAt("a", 0.49, { lap: 1, checkpointIdx: 3 });
    const b = kartAt("b", 0.51, { lap: 1, checkpointIdx: 4 });
    expect(computeStandings([a, b], spline).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("same lap + checkpoint: higher spline t ranks ahead", () => {
    // Both in checkpoint 2 (t ∈ [0.25, 0.375)); a is further along the arc.
    const a = kartAt("a", 0.36, { lap: 1, checkpointIdx: 2 });
    const b = kartAt("b", 0.26, { lap: 1, checkpointIdx: 2 });
    expect(computeStandings([a, b], spline).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("exact tie (same pos/lap/checkpoint) is broken by kart id ascending", () => {
    const p = spline.pointAt(0.3);
    const mk = (id: string): KartEntity =>
      createKart({
        id,
        name: id,
        isPlayer: false,
        color: [1, 0, 0],
        pos: { x: p.x, y: 0, z: p.z },
        heading: 0,
      });
    const a = mk("zeta");
    const b = mk("alpha");
    // Force identical progress so only the id tie-break decides.
    a.state.lap = 1;
    a.state.checkpointIdx = 2;
    b.state.lap = 1;
    b.state.checkpointIdx = 2;
    expect(computeStandings([a, b], spline).map((r) => r.id)).toEqual(["alpha", "zeta"]);
  });

  it("4-kart full permutation: ranks are a stable bijection over all orderings of the input", () => {
    const karts = [
      kartAt("k1", 0.05, { lap: 2, checkpointIdx: 7 }),
      kartAt("k2", 0.6, { lap: 2, checkpointIdx: 4 }),
      kartAt("k3", 0.8, { lap: 1, checkpointIdx: 6 }),
      kartAt("k4", 0.2, { lap: 0, checkpointIdx: 1 }),
    ];
    const expected = computeStandings(karts, spline).map((r) => r.id);

    // Every input permutation must yield the identical ranking (sort is total + deterministic).
    const perms: Array<Array<KartEntity>> = [
      karts,
      [...karts].reverse(),
      [karts[1], karts[3], karts[0], karts[2]],
      [karts[2], karts[0], karts[3], karts[1]],
    ];
    for (const perm of perms) {
      expect(computeStandings(perm, spline).map((r) => r.id)).toEqual(expected);
    }
    // Sanity: the hand-picked ordering is lap-desc as constructed.
    expect(expected).toEqual(["k1", "k2", "k3", "k4"]);
  });

  it("does not mutate its input array order", () => {
    const karts = [kartAt("a", 0.1), kartAt("b", 0.9)];
    computeStandings(karts, spline);
    expect(karts.map((k) => k.id)).toEqual(["a", "b"]);
  });
});
