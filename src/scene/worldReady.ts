/**
 * Pure world-readiness predicate for the race loading screen (used by RaceScene).
 * Kept in its own module so it's unit-testable without importing the Babylon render layer.
 */

/** Minimal structural view of a Babylon texture for readiness polling. */
export interface WorldReadyTexture {
  isReady(): boolean;
  readonly loadingError: boolean;
}

/**
 * The race world is ready once at least one frame has rendered (the first-frame shader
 * compile is the other hitch besides texture downloads) AND every async texture created
 * during the build is either ready or failed (a failed texture renders with a fallback —
 * it must not block the countdown). `elapsedSec > timeoutSec` force-readies as a last
 * resort so a stuck load can never hang the game.
 */
export function computeWorldReady(
  pending: ReadonlyArray<WorldReadyTexture>,
  frameRendered: boolean,
  elapsedSec: number,
  timeoutSec: number,
): boolean {
  if (elapsedSec > timeoutSec) return true;
  if (!frameRendered) return false;
  return pending.every((t) => t.isReady() || t.loadingError);
}
