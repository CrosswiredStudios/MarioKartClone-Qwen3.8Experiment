import type { IInputSource } from "./IInputSource.js";

/** Minimal event-target shape so the class never references `window` at construction time. */
export interface EventTargetLike {
  addEventListener(type: string, fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: string, fn: (e: KeyboardEvent) => void): void;
}

/**
 * WASD + arrows -> throttle/steer axes (-1..1); Space = drift (held);
 * E/Enter = item and Escape = pause as edge-triggered flags cleared each
 * logic step. Key mapping per 00-overview.md §5.
 */
export class KeyboardInput implements IInputSource {
  private readonly held = new Set<string>(); // e.code values currently down
  private justItem = false;
  private justPause = false;
  private justThrottle = false;

  constructor(private readonly target: EventTargetLike = globalThis.window) {}

  attach(): void {
    this.target.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!this.held.has(e.code)) {
        // Ignore OS key-repeat: only the first keydown of a hold counts.
        this.held.add(e.code);
        if (e.code === "KeyE" || e.code === "Enter") this.justItem = true;
        if (e.code === "Escape") this.justPause = true;
        if (e.code === "KeyW" || e.code === "ArrowUp") this.justThrottle = true;
      }
    });
    this.target.addEventListener("keyup", (e: KeyboardEvent) => {
      this.held.delete(e.code);
    });
  }

  detach(): void {
    // No-op safe: the target holds no reference to us beyond its own listener list.
  }

  axis(name: "throttle" | "steer"): number {
    if (name === "throttle") {
      const up = this.held.has("KeyW") || this.held.has("ArrowUp");
      const down = this.held.has("KeyS") || this.held.has("ArrowDown");
      return (up ? 1 : 0) - (down ? 1 : 0);
    }
    // Steer: left is negative, right is positive.
    const left = this.held.has("KeyA") || this.held.has("ArrowLeft");
    const right = this.held.has("KeyD") || this.held.has("ArrowRight");
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  button(name: "drift" | "item" | "pause"): boolean {
    if (name === "drift") return this.held.has("Space");
    return name === "item" ? this.justItem || this.held.has("KeyE") : this.justPause || this.held.has("Escape");
  }

  /** Level-triggered: true while the item key is physically down (hold-to-charge). */
  buttonHeld(_name: "item"): boolean {
    return this.held.has("KeyE") || this.held.has("Enter");
  }

  justPressed(name: "item" | "pause" | "throttle"): boolean {
    // Cleared by endLogicStep(), NOT here — a step may query twice.
    if (name === "item") return this.justItem;
    if (name === "pause") return this.justPause;
    return this.justThrottle;
  }

  /** Clears all justPressed flags — called once per fixed step by GameApp. */
  endLogicStep(): void {
    this.justItem = false;
    this.justPause = false;
    this.justThrottle = false;
  }
}
