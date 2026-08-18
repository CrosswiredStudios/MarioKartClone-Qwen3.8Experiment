import type { GameScreenId } from "./GameStateMachine.js";

/** Full event catalog — one entry per row of 01-architecture.md §5. */
export interface GameEvents {
  "race:countdownTick": { remaining: 3 | 2 | 1 };
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` is the intentional no-payload type for this event
  "race:start": {};
  "race:lapCompleted": { kartId: string; lap: number; timeMs: number };
  "race:finished": { standings: Array<{ id: string; rank: number }>; times: Record<string, number> };
  "item:pickedUp": { kartId: string; item: string };
  "item:used": { kartId: string; item: string };
  "kart:hit": { kartId: string; byKartId?: string; shellKind?: "green" | "red" | "blue" };
  "kart:boosted": { kartId: string; tier: "mini" | "super" | "shroom" };
  "kart:skid": { kartId: string; cause: "banana" | "oilSlick" };
  "ui:navigate": { to: GameScreenId };
}

export type GameEventName = keyof GameEvents;

type Listener<T> = (payload: T) => void;

/**
 * Typed pub/sub. One channel per event name; discrete events only.
 * The constraint is `object` (not Record<string, unknown>) so that mapped
 * interfaces like GameEvents — which have no index signature — can be used.
 */
export class EventBus<T extends object> {
  private readonly channels = new Map<keyof T & string, Set<Listener<never>>>();

  on<K extends keyof T & string>(name: K, listener: Listener<T[K]>): () => void {
    let set = this.channels.get(name);
    if (!set) {
      set = new Set();
      this.channels.set(name, set);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure at the Map boundary only
    (set as any).add(listener);
    return () => this.off(name, listener);
  }

  off<K extends keyof T & string>(name: K, listener: Listener<T[K]>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    (this.channels.get(name) as any)?.delete(listener);
  }

  emit<K extends keyof T & string>(name: K, payload: T[K]): void {
    const set = this.channels.get(name);
    if (!set) return; // zero listeners is a no-op, never throws
    for (const listener of [...set]) (listener as Listener<T[K]>)(payload);
  }
}
