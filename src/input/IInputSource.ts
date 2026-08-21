/**
 * Input abstraction (DIP). The game logic only ever sees this interface;
 * `KeyboardInput` is the production implementation and tests can supply fakes.
 */
export interface IInputSource {
  /** -1..1 for both axes. */
  axis(name: "throttle" | "steer"): number;
  /** Held state (item/pause also true on the press frame). */
  button(name: "drift" | "item" | "pause"): boolean;
  /**
   * Level-triggered held state: true while the key is physically down, regardless
   * of the edge flag. Used for the hold-to-charge item mechanic (the edge flag
   * alone can't distinguish "holding" from "just pressed").
   */
  buttonHeld(name: "item"): boolean;
  /**
   * Edge-triggered, cleared each logic step by {@link endLogicStep}.
   * "throttle" fires on a fresh accelerate keydown (W/ArrowUp) — used for the
   * perfect-start press check (holding does NOT count).
   */
  justPressed(name: "item" | "pause" | "throttle"): boolean;
}
