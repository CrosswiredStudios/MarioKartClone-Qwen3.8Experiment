/**
 * QualityManager unit tests (05-phase-3-track-system.md Task 7).
 *
 * The class takes Babylon Engine/Scene as TYPES only, so we drive it with plain
 * mock objects: a fake engine recording hardwareScalingLevel and a fake scene
 * whose onBeforeRenderObservable we can notify manually.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityManager } from "../../src/rendering/QualityManager.js";
import { TUNING } from "../../src/data/tuning.js";

/** Minimal observable: add() returns a handle with remove(defer?); notify() fires all. */
class MockObservable {
  private callbacks: Array<() => void> = [];
  add(cb: () => void): { remove(defer?: boolean): void } {
    this.callbacks.push(cb);
    return {
      remove: (_defer?: boolean) => {
        const i = this.callbacks.indexOf(cb);
        if (i >= 0) this.callbacks.splice(i, 1);
      },
    };
  }
  notify(): void {
    for (const cb of [...this.callbacks]) cb();
  }
}

interface Mocks {
  /** Records the last setHardwareScalingLevel() call. */
  engine: { scalingLevel: number; setHardwareScalingLevel(level: number): void };
  scene: { onBeforeRenderObservable: MockObservable };
  qm: QualityManager;
}

function makeMocks(): Mocks {
  const engine = { scalingLevel: 1, setHardwareScalingLevel(level: number) { this.scalingLevel = level; } };
  const scene = { onBeforeRenderObservable: new MockObservable() };
  return { engine, scene, qm: new QualityManager(engine as never, scene as never) };
}

/** In-memory localStorage stub (Node env has none). */
function makeStorage(initial?: Record<string, string>): Storage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QualityManager.apply", () => {
  it("(a) low preset sets hardwareScalingLevel to its pixelRatioCap and budget()", () => {
    const m = makeMocks();
    m.qm.apply("low");
    expect(m.engine.scalingLevel).toBe(TUNING.quality.low.pixelRatioCap); // 1
    expect(m.qm.current).toBe("low");
    expect(m.qm.budget()).toBeCloseTo(0.35);
  });

  it("(b) medium preset sets scaling level + persists to localStorage", () => {
    const m = makeMocks();
    m.qm.apply("medium");
    expect(m.engine.scalingLevel).toBe(TUNING.quality.medium.pixelRatioCap); // 1.5
    expect(localStorage.getItem("ttr.quality")).toBe("medium");
  });

  it("(c) high preset leaves scaling level at native (Infinity cap)", () => {
    const m = makeMocks();
    m.qm.apply("high");
    expect(m.engine.scalingLevel).toBe(Infinity);
    expect(m.qm.budget()).toBeCloseTo(1.0);
  });

  it("(d) invalid preset is ignored (no state change, no persist)", () => {
    const m = makeMocks();
    m.qm.apply("ultra" as never);
    expect(m.qm.current).toBe("high"); // default
    expect(localStorage.getItem("ttr.quality")).toBeNull();
  });

  it("(e) shadow/SSAO/bloom flags track the active preset", () => {
    const m = makeMocks();
    m.qm.apply("low");
    expect(m.qm.shadowMapSize).toBe(0);
    expect(m.qm.ssaoEnabled).toBe(false);
    expect(m.qm.bloomEnabled).toBe(false);
    m.qm.apply("high");
    expect(m.qm.shadowMapSize).toBe(2048);
    expect(m.qm.ssaoEnabled).toBe(true);
    expect(m.qm.bloomEnabled).toBe(true);
  });
});

describe("QualityManager.readStored", () => {
  it("(f) returns null when nothing is stored and the invalid value", () => {
    const m = makeMocks();
    expect(m.qm.readStored()).toBeNull();
    localStorage.setItem("ttr.quality", "ultra");
    expect(m.qm.readStored()).toBeNull();
  });

  it("(g) returns a valid stored preset", () => {
    const m = makeMocks();
    localStorage.setItem("ttr.quality", "low");
    expect(m.qm.readStored()).toBe("low");
  });
});

describe("QualityManager.autoDetect", () => {
  /** Fire `frames` observable notifications with ~1000/fps ms between them. */
  function runFrames(scene: Mocks["scene"], frames: number, fps: number): void {
    const step = 1000 / fps;
    let t = 0;
    vi.stubGlobal("performance", { now: () => (t += step) });
    for (let i = 0; i < frames; i++) scene.onBeforeRenderObservable.notify();
  }

  it("(h) avg FPS >= 50 stays at high and calls onDone('high')", async () => {
    const m = makeMocks();
    const done = vi.fn();
    m.qm.autoDetect(done);
    runFrames(m.scene, 60, 60); // ~16.7ms/frame → 60 FPS
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("high");
    expect(m.qm.current).toBe("high");
    // Detection result is NOT persisted — next launch re-measures.
    expect(localStorage.getItem("ttr.quality")).toBeNull();
  });

  it("(i) avg FPS < 50 steps down exactly one preset (high → medium)", async () => {
    const m = makeMocks();
    const done = vi.fn();
    m.qm.autoDetect(done);
    runFrames(m.scene, 60, 30); // ~33ms/frame → 30 FPS
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("medium");
    expect(m.qm.current).toBe("medium");
    expect(m.engine.scalingLevel).toBe(TUNING.quality.medium.pixelRatioCap);
  });

  it("(j) a stored choice overrides auto-detect (no measurement, onDone(stored))", async () => {
    const m = makeMocks();
    localStorage.setItem("ttr.quality", "low");
    const done = vi.fn();
    m.qm.autoDetect(done);
    // No frames rendered at all — stored path returns synchronously.
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("low");
    expect(m.qm.current).toBe("low");
  });

  it("(k) re-entrant autoDetect is ignored while detecting", () => {
    const m = makeMocks();
    const done1 = vi.fn();
    const done2 = vi.fn();
    m.qm.autoDetect(done1);
    m.qm.autoDetect(done2); // second call must be a no-op
    runFrames(m.scene, 60, 60);
    expect(done1).toHaveBeenCalledTimes(1);
    expect(done2).not.toHaveBeenCalled();
  });

  it("(l) apply() cancels an in-flight auto-detect", () => {
    const m = makeMocks();
    const done = vi.fn();
    m.qm.autoDetect(done);
    m.qm.apply("low"); // user picks a preset mid-measurement
    runFrames(m.scene, 60, 30); // further frames must not fire the callback
    expect(done).not.toHaveBeenCalled();
    expect(m.qm.current).toBe("low");
  });
});
