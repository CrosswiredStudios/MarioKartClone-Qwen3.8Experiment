import { describe, expect, it } from "vitest";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import type { PropKind, TrackDefinition } from "../../src/data/tracks/shared.js";
import { validateTrackDefinition } from "../../src/data/tracks/shared.js";

const MEADOWS_PROP_KINDS: ReadonlySet<PropKind> = new Set(["tree", "mushroom", "sign", "flower"]);
const LAGOON_PROP_KINDS: ReadonlySet<PropKind> = new Set(["rock", "geyser", "torch", "crystal"]);

function structuralChecks(track: TrackDefinition, allowedKinds: ReadonlySet<PropKind>): void {
  expect(track.controlPoints.length).toBeGreaterThanOrEqual(8);
  for (const p of track.controlPoints) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  }
  for (const cluster of track.itemBoxClusters) {
    expect(cluster.t).toBeGreaterThanOrEqual(0);
    expect(cluster.t).toBeLessThan(1);
    if (cluster.lateralOffset !== undefined) expect(Number.isFinite(cluster.lateralOffset)).toBe(true);
  }
  for (const hazard of track.hazards) {
    expect(hazard.t).toBeGreaterThanOrEqual(0);
    expect(hazard.t).toBeLessThan(1);
    expect(Number.isFinite(hazard.lateralOffset)).toBe(true);
  }
  for (const prop of track.propCatalog) {
    expect(prop.t).toBeGreaterThanOrEqual(0);
    expect(prop.t).toBeLessThan(1);
    expect(Number.isFinite(prop.lateralOffset)).toBe(true);
    expect(allowedKinds.has(prop.kind)).toBe(true);
  }
  expect(track.laps).toBe(3);
  expect(track.roadWidth).toBeGreaterThan(0);
}

describe("MEADOWS_TRACK (Greenhollow Meadows)", () => {
  it("is structurally valid with meadows-only prop kinds", () => {
    structuralChecks(MEADOWS_TRACK, MEADOWS_PROP_KINDS);
  });

  it("has 0 hazards and exactly 3 item box clusters", () => {
    expect(MEADOWS_TRACK.hazards).toHaveLength(0);
    expect(MEADOWS_TRACK.itemBoxClusters).toHaveLength(3);
  });

  it("passes validateTrackDefinition", () => {
    expect(() => validateTrackDefinition(MEADOWS_TRACK)).not.toThrow();
  });
});

describe("LAGOON_TRACK (Lava Lagoon Loop)", () => {
  it("is structurally valid with lagoon-only prop kinds", () => {
    structuralChecks(LAGOON_TRACK, LAGOON_PROP_KINDS);
  });

  it("has exactly 2 oil-slick hazards and 4 item box clusters", () => {
    expect(LAGOON_TRACK.hazards).toHaveLength(2);
    for (const hazard of LAGOON_TRACK.hazards) expect(hazard.kind).toBe("oilSlick");
    expect(LAGOON_TRACK.itemBoxClusters).toHaveLength(4);
  });

  it("passes validateTrackDefinition", () => {
    expect(() => validateTrackDefinition(LAGOON_TRACK)).not.toThrow();
  });
});

describe("validateTrackDefinition (tampered copies)", () => {
  it("throws when control points drop below 8", () => {
    const track: TrackDefinition = { ...MEADOWS_TRACK, controlPoints: MEADOWS_TRACK.controlPoints.slice(0, 7) };
    expect(() => validateTrackDefinition(track)).toThrow(/at least 8 control points/);
  });

  it("throws on a prop with t outside [0,1)", () => {
    const props = MEADOWS_TRACK.propCatalog.map((p, i) => (i === 0 ? { ...p, t: 1.5 } : p));
    const track: TrackDefinition = { ...MEADOWS_TRACK, propCatalog: props };
    expect(() => validateTrackDefinition(track)).toThrow(/prop t out of \[0,1\)/);
  });

  it("throws when laps is not 3", () => {
    const track: TrackDefinition = { ...MEADOWS_TRACK, laps: 5 };
    expect(() => validateTrackDefinition(track)).toThrow(/laps must be 3/);
  });

  it("accepts a valid downward sunDirection on both tracks", () => {
    for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
      const [x, y, z] = track.theme.sunDirection;
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
      expect(y).toBeLessThan(0); // sun above the horizon
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0);
    }
  });

  it("throws when sunDirection.y is >= 0 (sun below/at horizon)", () => {
    const track: TrackDefinition = { ...MEADOWS_TRACK, theme: { ...MEADOWS_TRACK.theme, sunDirection: [0.4, 1, 0.3] } };
    expect(() => validateTrackDefinition(track)).toThrow(/sunDirection\.y must be < 0/);
  });

  it("accepts a straight-down sunDirection and rejects [0,0,0]", () => {
    // Straight down is a legitimate (if flat) light angle.
    const straight: TrackDefinition = { ...MEADOWS_TRACK, theme: { ...MEADOWS_TRACK.theme, sunDirection: [0, -1, 0] } };
    expect(() => validateTrackDefinition(straight)).not.toThrow();

    // The all-zero vector is rejected (its y=0 trips the "above horizon" check).
    const zeroed: TrackDefinition = { ...MEADOWS_TRACK, theme: { ...MEADOWS_TRACK.theme, sunDirection: [0, 0, 0] } };
    expect(() => validateTrackDefinition(zeroed)).toThrow();
  });

  it("throws when sunDirection has a non-finite component", () => {
    const track: TrackDefinition = { ...MEADOWS_TRACK, theme: { ...MEADOWS_TRACK.theme, sunDirection: [0.4, -1, NaN] } };
    expect(() => validateTrackDefinition(track)).toThrow(/sunDirection must be \[x, y, z\] finite numbers/);
  });
});
