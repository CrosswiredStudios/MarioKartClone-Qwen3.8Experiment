/**
 * Pure easing helpers for RaceScene's camera mode transitions (Phase 7).
 * No Babylon imports so they are unit-testable headlessly.
 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Ease-in cubic — slow start, fast end (the countdown zoom "launches" into chase). */
export function countdownZoomEase(x: number): number {
  const t = clamp01(x);
  return t * t * t;
}

/** Ease-in-out cubic — smooth pull-back for the finish-out wide view. */
export function finishOutEase(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
