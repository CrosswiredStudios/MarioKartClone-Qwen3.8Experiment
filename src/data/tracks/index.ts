/** Barrel for track data — used by RaceConfig and (Phase 3) the TrackBuilder. */
export { MEADOWS_TRACK, MEADOWS_PROPS } from "./greenhollow-meadows.js";
export { LAGOON_TRACK, LAGOON_PROPS } from "./lava-lagoon-loop.js";
export type {
  HazardPlacement,
  ItemBoxCluster,
  PropKind,
  PropSpawn,
  TrackDefinition,
  TrackTheme,
} from "./shared.js";
export { validateTrackDefinition } from "./shared.js";
