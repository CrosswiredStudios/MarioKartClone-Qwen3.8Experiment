/**
 * ScreenShake — camera-shake envelope for the chase camera (07-phase-5 Step 10).
 *
 * Envelope: on `trigger(severity)` record amplitude A (from TUNING.shake) and reset a
 * local clock; per frame, offset = A · e^(−decayPerSec·t) · sin(2π·freqHz·t), applied
 * along a fixed axis chosen at trigger time. The axis is derived deterministically from
 * an internal event counter (golden-ratio spacing) — NOT Math.random() — so the render
 * layer stays reproducible and this file needs no RNG injection.
 *
 * Newer events REPLACE older ones (no stacking): a boost during a hit does not double
 * the amplitude; it simply restarts the envelope at the boost's (smaller) A. This is a
 * deliberate simplicity choice — one shake at a time reads cleaner than summed shakes.
 *
 * Subscriptions: `kart:hit` → "hit", `kart:boosted` → "boost" (any tier), and
 * `item:used` with item === "lightning" → "lightning". Only the PLAYER's own events
 * shake the camera — an AI kart being hit elsewhere on track is not in view.
 *
 * This file MAY be imported by render code but deliberately imports NO Babylon so its
 * envelope math is unit-testable headlessly (tests/unit/screenShake.test.ts). The scene
 * adds `offset(dt)` to the chase camera's position each frame.
 */

import type { EventBus, GameEvents } from "../core/EventBus.js";
import { TUNING } from "../data/tuning.js";

export type ShakeSeverity = "hit" | "boost" | "lightning" | "bump";

/** Amplitude (meters) for a severity, straight from the tuning table. */
function amplitudeFor(severity: ShakeSeverity): number {
  const s = TUNING.shake;
  switch (severity) {
    case "hit":
      return s.hitMeters;
    case "boost":
      return s.boostMeters;
    case "lightning":
      return s.lightningMeters;
    case "bump":
      return s.bumpMeters;
  }
}

/**
 * Pure envelope value: A · e^(−decayPerSec·t) · sin(2π·freqHz·t). Negative t clamps to
 * the t=0 value (which is exactly 0, since sin(0)=0). Exported for headless testing.
 */
export function shakeOffset(
  amplitude: number,
  t: number,
  decayPerSec: number,
  freqHz: number,
): number {
  const tc = Math.max(0, t);
  return amplitude * Math.exp(-decayPerSec * tc) * Math.sin(2 * Math.PI * freqHz * tc);
}

/** Deterministic per-trigger axis angle (radians), well-spaced via the golden ratio. */
function axisAngleFor(counter: number): number {
  const GOLDEN = 2.39996; // 2π · (1 − 1/φ) — consecutive counters land far apart on [0,2π)
  return (counter * GOLDEN) % (Math.PI * 2);
}

export class ScreenShake {
  private active = false;
  private amplitude = 0;
  private clock = 0; // seconds since the most recent trigger
  private axisAngle = 0;
  private counter = 0;
  private unsubs: Array<() => void> = [];

  /** Subscribe to the shake-driving events. Call once on scene enter. */
  attach(bus: EventBus<GameEvents>): void {
    this.detach(); // idempotent — never stack listeners across re-entries
    this.unsubs.push(
      bus.on("kart:hit", (p) => {
        if (p.kartId === "player") this.trigger("hit");
      }),
      bus.on("kart:boosted", (p) => {
        if (p.kartId === "player") this.trigger("boost");
      }),
      bus.on("item:used", (p) => {
        // Lightning shakes hardest; only when the PLAYER casts it.
        if (p.kartId === "player" && p.item === "lightning") this.trigger("lightning");
      }),
      bus.on("kart:bumped", (p) => {
        // Emitter already filters to player-involved bumps + per-pair cooldown.
        if (p.kartId === "player") this.trigger("bump");
      }),
    );
  }

  /** Remove all event subscriptions and clear any in-flight shake. */
  detach(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.active = false;
  }

  /** Start a new shake: record amplitude, reset the clock, pick a fresh axis. */
  trigger(severity: ShakeSeverity): void {
    this.amplitude = amplitudeFor(severity);
    this.clock = 0;
    this.axisAngle = axisAngleFor(this.counter++);
    this.active = true;
  }

  /** True while any shake envelope is still above a negligible floor. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Advance the clock by `dt` and return the current XZ offset (meters) along the fixed
   * trigger axis. Y stays 0 — the shake is a horizontal jolt, not a vertical bounce.
   */
  offset(dt: number): { x: number; z: number } {
    if (!this.active) return { x: 0, z: 0 };
    this.clock += Math.max(0, dt);
    const mag = shakeOffset(this.amplitude, this.clock, TUNING.shake.decayPerSec, TUNING.shake.freqHz);
    // Stop tracking once the envelope is negligible (avoids a forever-"active" flag).
    if (this.clock > 2 && Math.abs(mag) < 0.001 * this.amplitude) {
      this.active = false;
      return { x: 0, z: 0 };
    }
    const c = Math.cos(this.axisAngle);
    const s = Math.sin(this.axisAngle);
    return { x: mag * c, z: mag * s };
  }
}
