/**
 * Maps raw input into a DriveInput for one logic step (05-phase-3-track-system.md).
 * Pure read — no state of its own; safe to call once per fixed step.
 */

import type { IInputSource } from "../input/IInputSource.js";
import type { DriveInput } from "./KartPhysics.js";

export class PlayerController {
  constructor(private readonly input: IInputSource) {}

  /** Called once per logic step; returns the DriveInput for this frame. */
  read(): DriveInput {
    const throttle = this.input.axis("throttle");
    const steer = this.input.axis("steer");
    return Object.freeze({
      throttle,
      steer,
      // Space held while actually turning (a straight-line "drift" does nothing).
      drifting: this.input.button("drift") && Math.abs(steer) > 0,
      useItem: this.input.justPressed("item"),
    });
  }
}
