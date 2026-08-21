/**
 * Lava Lagoon Loop — canyon circuit with one hairpin (NW), a chicane (NE) and
 * dramatic elevation: long climbs to a ridge, then cliff drops into the lagoon floor.
 * Phase 4.1: re-authored ~3× longer (≈690 m/lap). Theme/id/props/hazards unchanged.
 */
import { validateTrackDefinition, type PropKind, type PropSpawn, type TrackDefinition } from "./shared.js";

// helper keeps the catalog compact; pure data, deterministic
const p = (kind: PropKind, t: number, lateralOffset: number, scale?: number): PropSpawn => ({
  kind,
  t,
  lateralOffset,
  ...(scale !== undefined ? { scale } : {}),
});

export const LAGOON_PROPS: PropSpawn[] = [
  // rocks (18) — scattered well off the 4.5 m half-road-width
  p("rock", 0.01, 9), p("rock", 0.05, -11), p("rock", 0.09, 13), p("rock", 0.14, -8),
  p("rock", 0.18, 10), p("rock", 0.22, -9), p("rock", 0.26, 15), p("rock", 0.33, -12),
  p("rock", 0.4, 9), p("rock", 0.44, -14), p("rock", 0.47, 8), p("rock", 0.55, 16),
  p("rock", 0.6, -10), p("rock", 0.7, 12), p("rock", 0.75, -15), p("rock", 0.83, 9),
  p("rock", 0.9, -11), p("rock", 0.96, 14),
  // geysers (6) — mid-field hazards/landmarks
  p("geyser", 0.12, -10), p("geyser", 0.3, 12), p("geyser", 0.48, -11),
  p("geyser", 0.63, 10), p("geyser", 0.8, -12), p("geyser", 0.95, 9),
  // torches (12) — roadside lighting, closest to the road edge
  p("torch", 0.03, 6), p("torch", 0.1, -6), p("torch", 0.17, 6), p("torch", 0.24, -6),
  p("torch", 0.31, 6), p("torch", 0.38, -6), p("torch", 0.45, 6), p("torch", 0.52, -6),
  p("torch", 0.59, 6), p("torch", 0.66, -6), p("torch", 0.73, 6), p("torch", 0.8, -6),
  // crystals (9) — far-field sparkle accents
  p("crystal", 0.07, 14), p("crystal", 0.2, -15), p("crystal", 0.35, 13), p("crystal", 0.5, -14),
  p("crystal", 0.68, 15), p("crystal", 0.78, -13), p("crystal", 0.88, 14), p("crystal", 0.93, -12),
  p("crystal", 0.98, 13),
]; // 45 entries total

export const LAGOON_TRACK: TrackDefinition = {
  id: "lagoon",
  name: "Lava Lagoon Loop",
  laps: 3,
  roadWidth: 9,
  controlPoints: [
    { x: 0, z: -62 }, // start/finish on the south straight (lagoon floor)
    { x: 24, z: -58 },
    { x: 44, z: -46 },
    { x: 58, z: -28 },
    { x: 64, z: -8 }, // long west-side climb begins
    { x: 60, z: 10 }, // chicane entry (NE)
    { x: 48, z: 16 }, // chicane apex left
    { x: 56, z: 26 }, // chicane exit right
    { x: 50, z: 40 },
    { x: 34, z: 50 }, // ridge crest (highest point)
    { x: 14, z: 54 },
    { x: -6, z: 52 },
    { x: -24, z: 56 }, // hairpin entry (NW) — cliff edge
    { x: -38, z: 46 }, // hairpin apex over the rim
    { x: -30, z: 34 }, // hairpin exit — direction reverses here
    { x: -52, z: 30 }, // cliff drop begins (steep descent)
    { x: -70, z: 18 },
    { x: -76, z: -2 }, // lagoon floor again
    { x: -64, z: -22 },
    { x: -38, z: -34 },
  ],
  elevation: {
    // Canyon drama (hard track): long climbs to a +14 m ridge, cliff drops to an
    // -8 m lagoon floor. Steep gradients exercise the mild slope speed model.
    points: [
      { t: 0.0, y: 0 },
      { t: 0.06, y: 2.5 },
      { t: 0.14, y: 7 }, // west-side climb
      { t: 0.22, y: 11 },
      { t: 0.3, y: 14 }, // ridge crest
      { t: 0.38, y: 12.5 },
      { t: 0.46, y: 9 },
      { t: 0.54, y: 3 }, // cliff drop into the lagoon floor
      { t: 0.62, y: -8 }, // lowest point (hairpin rim)
      { t: 0.7, y: -6 },
      { t: 0.78, y: -1 }, // climb back out of the canyon
      { t: 0.86, y: 3.5 },
      { t: 0.94, y: 1 },
    ],
    noiseAmplitudeMin: 2,
    noiseAmplitudeMax: 5, // big off-road swings — canyon rim feel
    noiseFrequency: 0.09,
    seed: 77341,
  },
  theme: {
    groundColor: "#2b2028",
    accentColor: "#ff5a1f", // dark rock + orange-red lava accents
    skyTop: "#2a1440",
    skyBottom: "#ff7a3c", // deep purple -> orange
    skybox: "textures/skybox_lagoon", // Space starfield cubemap (Babylon playground library)
    fogColor: "#3a1e2e",
    fogDensity: 0.006, // denser than meadows
    sunIntensity: 0.55,
    ambientIntensity: 0.4, // dimmer, moodier rig
    // Low cool sun near the horizon — long dramatic shadows matching the
    // starfield skybox and the canyon's moody atmosphere.
    sunDirection: [0.8, -0.45, 0.2],
  },
  itemBoxClusters: [{ t: 0.1 }, { t: 0.35 }, { t: 0.6 }, { t: 0.85 }],
  hazards: [
    { kind: "oilSlick", t: 0.3, lateralOffset: -2.0, size: 3.0 },
    { kind: "oilSlick", t: 0.7, lateralOffset: 2.5, size: 3.0 },
  ],
  propCatalog: LAGOON_PROPS,
  // Phase 6 — the cliff-drop span (t≈0.48–0.52) is a narrow bridge over the void:
  // road narrows from the base 9 m to 6 m; TrackBuilder renders taller barriers and
  // a dark void plane beside it, and the spline's on-road test uses the narrowed width.
  widthOverrides: [{ tStart: 0.48, tEnd: 0.52, widthOverride: 6 }],
};

// Fail fast in dev and tests if the data is ever tampered with.
validateTrackDefinition(LAGOON_TRACK);
