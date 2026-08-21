import { describe, expect, it } from "vitest";
import { computeWorldReady, type WorldReadyTexture } from "../../src/scene/worldReady.js";

function tex(ready: boolean, error = false): WorldReadyTexture {
  return { isReady: () => ready, loadingError: error };
}

describe("computeWorldReady (race loading screen)", () => {
  it("is ready with no pending textures once a frame has rendered", () => {
    expect(computeWorldReady([], true, 0, 8)).toBe(true);
  });

  it("is not ready before the first frame renders", () => {
    expect(computeWorldReady([], false, 0, 8)).toBe(false);
  });

  it("is not ready while a texture is still loading", () => {
    expect(computeWorldReady([tex(false)], true, 0, 8)).toBe(false);
  });

  it("is ready once all pending textures are ready", () => {
    expect(computeWorldReady([tex(true), tex(true)], true, 0, 8)).toBe(true);
  });

  it("treats a failed texture as done (fallback render, must not block)", () => {
    expect(computeWorldReady([tex(false, true)], true, 0, 8)).toBe(true);
  });

  it("force-readies past the timeout even with a stuck texture", () => {
    expect(computeWorldReady([tex(false)], false, 8.001, 8)).toBe(true);
  });

  it("does not force-ready exactly at the timeout", () => {
    expect(computeWorldReady([tex(false)], false, 8, 8)).toBe(false);
  });
});
