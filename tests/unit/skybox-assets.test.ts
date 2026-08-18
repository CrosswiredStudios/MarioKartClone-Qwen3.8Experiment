/**
 * Skybox asset integrity — every track's theme.skybox base path must resolve to six
 * real, non-empty face JPGs under public/ (`{base}_{px,nx,py,ny,pz,nz}.jpg`). Catches
 * missing/misnamed cubemap files that a type check can't see (CubeTexture only fails
 * at runtime load).
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../../src/data/tracks/index.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;

for (const track of [MEADOWS_TRACK, LAGOON_TRACK]) {
  describe(`skybox assets for ${track.id}`, () => {
    it("theme.skybox is a well-formed base path", () => {
      expect(track.theme.skybox).toMatch(/^textures\/[a-z0-9_-]+$/);
    });

    it.each(FACES)("%s face exists and is non-empty", (face) => {
      const file = path.join(PUBLIC_DIR, track.theme.skybox + `_${face}.jpg`);
      expect(existsSync(file), `${file} not found`).toBe(true);
      expect(statSync(file).size, `${file} is empty`).toBeGreaterThan(0);
    });
  });
}
