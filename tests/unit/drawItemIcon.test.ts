/**
 * drawItemIcon (06-phase-4 Step 7) — headless smoke test.
 *
 * A real CanvasRenderingContext2D isn't available in Node, so we use a Proxy mock:
 * every property read returns a no-op function and every write is accepted. This
 * exercises every per-item drawing branch (path construction, fills, strokes) and
 * fails if any branch throws or references an undefined helper. Pixel-level visual
 * correctness is a manual dev check per the plan.
 */

import { describe, expect, it } from "vitest";
import { drawItemIcon } from "../../src/ui/Hud.js";
import type { ItemId } from "../../src/entities/KartPhysics.js";

const ALL_IDS: ReadonlyArray<ItemId | null> = [
  null,
  "mushroom",
  "greenShell",
  "redShell",
  "blueShell",
  "banana",
  "star",
  "lightning",
  "bulletBill",
];

/** Proxy mock: any method call is a no-op; property sets (fillStyle etc.) are accepted. */
function mockCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (typeof prop === "string") calls.push(prop);
      return () => undefined;
    },
    set() {
      return true;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Proxy target must be an object
  const ctx = new Proxy({}, handler) as any;
  return { ctx, calls };
}

describe("drawItemIcon", () => {
  it.each(ALL_IDS.map((id) => [String(id), id] as const))(
    "renders %s without throwing and clears the canvas first",
    (_label, id) => {
      const { ctx, calls } = mockCtx();
      expect(() => drawItemIcon(ctx, id)).not.toThrow();
      // The very first operation must clear the 48×48 surface.
      expect(calls[0]).toBe("clearRect");
    },
  );

  it("draws a text glyph for the empty (null) state", () => {
    const { ctx, calls } = mockCtx();
    drawItemIcon(ctx, null);
    expect(calls).toContain("fillText");
  });

  it("does not use fillText for real items (pure vector drawing)", () => {
    for (const id of ALL_IDS) {
      if (id === null) continue;
      const { ctx, calls } = mockCtx();
      drawItemIcon(ctx, id);
      expect(calls).not.toContain("fillText");
    }
  });

  it("draws a star polygon with 10 vertices (5 outer + 5 inner)", () => {
    const lineTo: number[] = [];
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === "lineTo") return (_x: number, _y: number) => lineTo.push(1);
        return () => undefined;
      },
      set() {
        return true;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Proxy target must be an object
    const ctx = new Proxy({}, handler) as any;
    drawItemIcon(ctx, "star");
    expect(lineTo.length).toBe(9); // moveTo for vertex 0 + lineTo × 9
  });
});
