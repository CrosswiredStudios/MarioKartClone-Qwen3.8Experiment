import { describe, expect, it, vi } from "vitest";
import { FixedTimestepLoop } from "../../src/core/FixedTimestepLoop.js";

describe("FixedTimestepLoop", () => {
  const makeLoop = (step = 1 / 60) => {
    let updates = 0;
    let lastDt = 0;
    let renders = 0;
    const loop = new FixedTimestepLoop(
      (dt) => {
        updates += 1;
        lastDt = dt;
      },
      () => {
        renders += 1;
      },
      { step },
    );
    return { loop, state: () => ({ updates, lastDt, renders }) };
  };

  it("does nothing before the first frame establishes a baseline", () => {
    const { loop, state } = makeLoop();
    loop.advance(0);
    expect(state().updates).toBe(0);
  });

  it("runs exactly one update per step of elapsed time", () => {
    const { loop, state } = makeLoop(1 / 60);
    loop.advance(0); // baseline at t=0
    loop.advance(1 / 60); // +1 step
    expect(state().updates).toBe(1);
    expect(state().lastDt).toBeCloseTo(1 / 60, 12);
  });

  it("catches up with multiple updates after a slow frame", () => {
    const { loop, state } = makeLoop(1 / 60);
    loop.advance(0);
    loop.advance(3 / 60); // 3 steps worth of time in one frame
    expect(state().updates).toBe(3);
  });

  it("renders once per advance with the interpolation alpha", () => {
    const { loop, state } = makeLoop(1 / 60);
    loop.advance(0);
    loop.advance((1.5 * 1) / 60); // one full step + half a step remaining
    expect(state().renders).toBe(1);
    expect(state().updates).toBe(1);
  });

  it("clamps huge frame times to maxAccumulator (spiral-of-death guard)", () => {
    const { loop, state } = makeLoop(1 / 60);
    loop.advance(0);
    loop.advance(5.0); // tab was backgrounded for 5 seconds
    // 0.25s max accumulator / (1/60) step = at most 15 updates
    expect(state().updates).toBeLessThanOrEqual(15);
    expect(state().updates).toBeGreaterThan(0);
  });

  it("treats negative frame times as zero", () => {
    const { loop, state } = makeLoop();
    loop.advance(0); // baseline
    loop.advance(1.0); // ~60 updates
    const updatesAfterForward = state().updates;
    expect(updatesAfterForward).toBeGreaterThan(0);
    loop.advance(0.9); // clock went backwards -> clamped to 0, no new updates
    expect(state().updates).toBe(updatesAfterForward);
  });

  it("contains an onUpdate throw and keeps stepping (no permanent freeze)", () => {
    let throws = true;
    let updates = 0;
    const loop = new FixedTimestepLoop(
      () => {
        if (throws) throw new Error("boom");
        updates += 1;
      },
      () => {},
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      loop.advance(0); // baseline (absolute timestamps)
      loop.advance(3 / 60); // first step throws — must not propagate
      expect(spy).toHaveBeenCalled();
      throws = false;
      loop.advance(5 / 60); // +2 steps of absolute time → loop is still alive
      expect(updates).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
