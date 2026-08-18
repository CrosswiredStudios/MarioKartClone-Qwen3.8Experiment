/**
 * Input abstraction (DIP). The game logic only ever sees this interface;
 * `KeyboardInput` is the production implementation and tests can supply fakes.
 */
export interface IInputSource {
  /** -1..1 for both axes. */
  axis(name: "throttle" | "steer"): number;
  /** Held state (item/pause also true on the press frame). */
  button(name: "drift" | "item" | "pause"): boolean;
  /** Edge-triggered, cleared each logic step by {@link endLogicStep}. */
  justPressed(name: "item" | "pause"): boolean;
}
