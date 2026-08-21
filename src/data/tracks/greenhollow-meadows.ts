/**
 * Greenhollow Meadows — wide beginner circuit with S-bends and a long back straight.
 * Phase 4.1: re-authored ~3× longer (≈650 m/lap) with gentle rolling-hill elevation.
 * Data only (no mesh code); TrackBuilder + TrackElevation consume this.
 */
import { createRng } from "../../core/Rng.js";
import { validateTrackDefinition, type PropKind, type PropSpawn, type TrackDefinition } from "./shared.js";

// helper keeps the catalog compact; pure data, deterministic
const p = (kind: PropKind, t: number, lateralOffset: number, scale?: number): PropSpawn => ({
  kind,
  t,
  lateralOffset,
  ...(scale !== undefined ? { scale } : {}),
});

/**
 * Deterministic dense forest for Greenhollow Meadows (replaces the old 26 hand-placed trees).
 * Two bands, both well outside the 6 m half-road-width (the clearance test needs ≥ 6.5 m):
 *   near tree line — ~9–14 m lateral on BOTH sides at tight t-spacing → a dense forest edge
 *   far background ring — ~18–32 m lateral, larger scale → depth behind the near line
 * Seeded (mulberry32 via createRng) so the layout is identical every launch/build. Each entry
 * carries its own scale + rotationY; PropBuilder picks a distinct tree variant per entry.
 */
function meadowTrees(): PropSpawn[] {
  const rng = createRng(0x5eed); // fixed seed — deterministic catalog
  const out: PropSpawn[] = [];

  // Near tree line on both sides, tight spacing for a dense edge (skip ~1 in 7 → natural gaps).
  const nearStep = 0.025;
  for (let t = 0.012; t < 1; t += nearStep) {
    for (const side of [1, -1]) {
      if (rng.next() < 0.15) continue;
      out.push({
        kind: "tree",
        t,
        lateralOffset: side * rng.range(9, 14),
        scale: rng.range(0.85, 1.35),
        rotationY: rng.range(0, Math.PI * 2),
      });
    }
  }

  // Far background ring — sparser but bigger, for depth behind the near line.
  const farStep = 0.04;
  for (let t = 0.03; t < 1; t += farStep) {
    for (const side of [1, -1]) {
      if (rng.next() < 0.35) continue;
      out.push({
        kind: "tree",
        t,
        lateralOffset: side * rng.range(18, 32),
        scale: rng.range(1.1, 1.7),
        rotationY: rng.range(0, Math.PI * 2),
      });
    }
  }

  return out;
}

export const MEADOWS_PROPS: PropSpawn[] = [
  // trees — dense seeded forest (near tree line + far background ring); see meadowTrees()
  ...meadowTrees(),
  // mushrooms (26)
  p("mushroom", 0.03, 8, 1.2), p("mushroom", 0.07, -9), p("mushroom", 0.1, 8.5, 1.4),
  p("mushroom", 0.135, -8), p("mushroom", 0.17, 9, 1.1), p("mushroom", 0.21, -8.5),
  p("mushroom", 0.25, 8, 1.3), p("mushroom", 0.29, -9), p("mushroom", 0.33, 8.5),
  p("mushroom", 0.37, -8, 1.2), p("mushroom", 0.41, 9), p("mushroom", 0.45, -8.5, 1.4),
  p("mushroom", 0.49, 8), p("mushroom", 0.53, -9, 1.2), p("mushroom", 0.57, 8.5, 1.3),
  p("mushroom", 0.61, -8), p("mushroom", 0.65, 9, 1.1), p("mushroom", 0.69, -8.5),
  p("mushroom", 0.73, 8, 1.4), p("mushroom", 0.77, -9), p("mushroom", 0.81, 8.5, 1.2),
  p("mushroom", 0.85, -8), p("mushroom", 0.89, 9, 1.3), p("mushroom", 0.93, -8.5),
  p("mushroom", 0.97, 8, 1.2),
  // signs (8) — roadside markers near the road edge
  p("sign", 0.0, 7.5), p("sign", 0.14, -7.5), p("sign", 0.28, 7.5), p("sign", 0.42, -7.5),
  p("sign", 0.56, 7.5), p("sign", 0.7, -7.5), p("sign", 0.84, 7.5), p("sign", 0.96, -7.5),
  // flowers (24) — roadside garnish
  p("flower", 0.02, 8), p("flower", 0.06, -8), p("flower", 0.1, 8), p("flower", 0.14, -8),
  p("flower", 0.18, 8), p("flower", 0.22, -8), p("flower", 0.26, 8), p("flower", 0.3, -8),
  p("flower", 0.34, 8), p("flower", 0.38, -8), p("flower", 0.42, 8), p("flower", 0.46, -8),
  p("flower", 0.5, 8), p("flower", 0.54, -8), p("flower", 0.58, 8), p("flower", 0.62, -8),
  p("flower", 0.66, 8), p("flower", 0.7, -8), p("flower", 0.74, 8), p("flower", 0.78, -8),
  p("flower", 0.82, 8), p("flower", 0.86, -8), p("flower", 0.9, 8), p("flower", 0.94, -8),
]; // dense generated tree forest + 58 mushrooms/signs/flowers

export const MEADOWS_TRACK: TrackDefinition = {
  id: "meadows",
  name: "Greenhollow Meadows",
  laps: 3,
  roadWidth: 12,
  controlPoints: [
    { x: 75, z: 0 }, // start/finish on the east straight
    { x: 68, z: 24 }, // S-bend 1: tuck in
    { x: 50, z: 42 },
    { x: 24, z: 50 },
    { x: -4, z: 47 },
    { x: -30, z: 52 }, // S-bend 1: bulge out (north side)
    { x: -56, z: 44 },
    { x: -72, z: 28 },
    { x: -76, z: 6 },
    { x: -68, z: -14 }, // S-bend 2: tuck in
    { x: -50, z: -30 },
    { x: -26, z: -38 },
    { x: 0, z: -34 },
    { x: 24, z: -40 }, // S-bend 2: bulge out (south side)
    { x: 48, z: -34 },
    { x: 66, z: -18 },
  ],
  elevation: {
    // Gentle rolling hills (easy track): ±~3 m undulation along the centerline.
    points: [
      { t: 0.0, y: 0 },
      { t: 0.08, y: 1.6 },
      { t: 0.17, y: -1.2 },
      { t: 0.27, y: 2.4 },
      { t: 0.38, y: 0.4 },
      { t: 0.48, y: -2.0 },
      { t: 0.58, y: 1.8 },
      { t: 0.68, y: -0.8 },
      { t: 0.78, y: 2.8 },
      { t: 0.88, y: 0.6 },
      { t: 0.95, y: -1.4 },
    ],
    noiseAmplitudeMin: 0.5, // subtle off-road undulation (easy level)
    noiseAmplitudeMax: 1.2,
    noiseFrequency: 0.06, // broad, gentle hills
    seed: 20260816,
  },
  theme: {
    groundColor: "#3fa34d",
    accentColor: "#e8c547",
    skyTop: "#aee3ff",
    skyBottom: "#fdf6c9", // light blue -> pale yellow
    skybox: "textures/skybox_meadows", // TropicalSunnyDay cubemap (Babylon playground library)
    fogColor: "#eaf6ff",
    fogDensity: 0.002, // very light
    sunIntensity: 1.0,
    ambientIntensity: 0.55,
    // High warm sun — close to the old shared angle but slightly raked so
    // shadows stretch a touch for depth.
    sunDirection: [-0.45, -1, 0.35],
  },
  itemBoxClusters: [{ t: 0.15 }, { t: 0.45 }, { t: 0.75 }],
  hazards: [], // meadows has no hazards
  propCatalog: MEADOWS_PROPS,
};

// Fail fast in dev and tests if the data is ever tampered with.
validateTrackDefinition(MEADOWS_TRACK);
