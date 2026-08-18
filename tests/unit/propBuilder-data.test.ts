import { describe, expect, it } from "vitest";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { TrackDefinition } from "../../src/data/tracks/shared.js";
import { TUNING } from "../../src/data/tuning.js";
import { hasPropBuilder, SUPPORTED_PROP_KINDS } from "../../src/tracks/propKinds.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";

const TRACKS: TrackDefinition[] = [MEADOWS_TRACK, LAGOON_TRACK];

/** Spline with widthOverrides wired in (bridges narrow the road). */
function splineFor(track: TrackDefinition): TrackSpline {
  return new TrackSpline(
    track.controlPoints,
    track.roadWidth,
    TUNING.physics.onRoadMargin,
    undefined,
    track.widthOverrides,
  );
}

describe("prop builder coverage", () => {
  it("every distinct kind in each track's propCatalog has a registered builder", () => {
    for (const track of TRACKS) {
      const kinds = new Set(track.propCatalog.map((p) => p.kind));
      expect(kinds.size).toBeGreaterThan(0);
      for (const kind of kinds) {
        expect(hasPropBuilder(kind), `${track.id} uses prop kind "${kind}" with no builder`).toBe(true);
      }
    }
  });

  it("the registry covers exactly the PropKind union (no dead entries)", () => {
    // Every supported kind is a valid PropKind, and every PropKind has a builder.
    const allKinds = [
      "tree",
      "mushroom",
      "sign",
      "flower",
      "rock",
      "geyser",
      "torch",
      "crystal",
    ] as const;
    for (const k of SUPPORTED_PROP_KINDS) {
      expect(allKinds).toContain(k);
    }
    expect(SUPPORTED_PROP_KINDS.length).toBe(allKinds.length);
  });

  it("every prop catalog entry is well-formed (t in [0,1), finite lateral)", () => {
    for (const track of TRACKS) {
      for (const p of track.propCatalog) {
        expect(p.t).toBeGreaterThanOrEqual(0);
        expect(p.t).toBeLessThan(1);
        expect(Number.isFinite(p.lateralOffset)).toBe(true);
        if (p.scale !== undefined) expect(p.scale).toBeGreaterThan(0);
      }
    }
  });
});

describe("prop road clearance", () => {
  it("every prop sits at least halfWidthAt(t) + 0.5 m off the centerline", () => {
    for (const track of TRACKS) {
      const spline = splineFor(track);
      let minClearance = Infinity;
      for (const p of track.propCatalog) {
        const halfWidth = spline.halfWidthAt(p.t);
        const clearance = Math.abs(p.lateralOffset) - halfWidth;
        expect(clearance, `${track.id} prop ${p.kind}@t=${p.t}`).toBeGreaterThanOrEqual(0.5 - 1e-6);
        minClearance = Math.min(minClearance, clearance);
      }
    }
  });

  it("the lagoon bridge span narrows the road (effective half-width < base)", () => {
    const spline = splineFor(LAGOON_TRACK);
    const baseHalf = LAGOON_TRACK.roadWidth / 2; // 4.5 m
    // Mid-span: full override width of 6 m → half 3 m, well under the base 4.5 m.
    expect(spline.halfWidthAt(0.5)).toBeLessThan(baseHalf);
    expect(spline.halfWidthAt(0.5)).toBeCloseTo(3, 3);
    // Outside the span: back to base width.
    expect(spline.halfWidthAt(0.1)).toBeCloseTo(baseHalf, 6);
  });

  it("props near the lagoon bridge respect the narrowed half-width", () => {
    const spline = splineFor(LAGOON_TRACK);
    for (const p of LAGOON_TRACK.propCatalog) {
      if (p.t < 0.45 || p.t > 0.55) continue; // only props in/near the span
      expect(Math.abs(p.lateralOffset)).toBeGreaterThanOrEqual(spline.halfWidthAt(p.t) + 0.5 - 1e-6);
    }
  });
});
