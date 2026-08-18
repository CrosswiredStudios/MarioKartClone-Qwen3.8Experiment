/**
 * Pure registry of prop kinds that have a mesh builder (Phase 6).
 *
 * Babylon-free on purpose: PropBuilder's `buildSource` switch is the render-side
 * implementation, and this list is its single source of truth for "which kinds can
 * actually be built". The unit test (propBuilder-data) checks every distinct kind in
 * each track's propCatalog against it — so a new kind added to data but not to the
 * builder switch fails fast instead of silently rendering nothing.
 */
import type { PropKind } from "../data/tracks/shared.js";

/** Every PropKind that has a registered source-mesh builder in PropBuilder. */
export const SUPPORTED_PROP_KINDS: readonly PropKind[] = [
  "tree",
  "mushroom",
  "sign",
  "flower",
  "rock",
  "geyser",
  "torch",
  "crystal",
];

/** True when a source-mesh builder exists for `kind`. */
export function hasPropBuilder(kind: PropKind): boolean {
  return SUPPORTED_PROP_KINDS.includes(kind);
}
