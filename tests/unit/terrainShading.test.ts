/**
 * terrainShading — pure per-vertex color helpers (graphics-quality pass).
 * Determinism + range + blend behavior; no Babylon, no scene.
 */
import { describe, expect, it } from "vitest";
import {
  clamp01,
  desaturate,
  groundVertexColor,
  hash01,
  hexToRgb01,
  mixRgb,
  rockColorFromBase,
  smoothstep,
  type Rgb,
} from "../../src/tracks/terrainShading.js";

const GRASS: Rgb = { r: 0.25, g: 0.64, b: 0.3 };
const ROCK: Rgb = rockColorFromBase(GRASS);

describe("terrainShading primitives", () => {
  it("clamp01 clamps to [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
  });

  it("smoothstep is 0 below edge0, 1 above edge1, monotone in between", () => {
    expect(smoothstep(0.25, 0.9, 0.2)).toBe(0);
    expect(smoothstep(0.25, 0.9, 1.0)).toBe(1);
    const a = smoothstep(0.25, 0.9, 0.5);
    const b = smoothstep(0.25, 0.9, 0.7);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it("mixRgb interpolates and hits endpoints exactly", () => {
    expect(mixRgb(GRASS, ROCK, 0)).toEqual(GRASS);
    expect(mixRgb(GRASS, ROCK, 1)).toEqual(ROCK);
    const mid = mixRgb(GRASS, ROCK, 0.5);
    expect(mid.r).toBeCloseTo((GRASS.r + ROCK.r) / 2, 10);
  });

  it("hexToRgb01 parses #rrggbb", () => {
    expect(hexToRgb01("#ff8000")).toEqual({ r: 1, g: 0.5019607843137255, b: 0 });
    expect(hexToRgb01("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("desaturate(0) is identity; desaturate(1) is luminance gray", () => {
    expect(desaturate(GRASS, 0, 0)).toEqual(GRASS);
    const gray = desaturate(GRASS, 1, 0);
    expect(gray.r).toBeCloseTo(gray.g, 10);
    expect(gray.g).toBeCloseTo(gray.b, 10);
  });

  it("rockColorFromBase is darker + less saturated than the base", () => {
    const baseLum = 0.299 * GRASS.r + 0.587 * GRASS.g + 0.114 * GRASS.b;
    const rockLum = 0.299 * ROCK.r + 0.587 * ROCK.g + 0.114 * ROCK.b;
    expect(rockLum).toBeLessThan(baseLum);
    const baseSat = Math.max(GRASS.r, GRASS.g, GRASS.b) - Math.min(GRASS.r, GRASS.g, GRASS.b);
    const rockSat = Math.max(ROCK.r, ROCK.g, ROCK.b) - Math.min(ROCK.r, ROCK.g, ROCK.b);
    expect(rockSat).toBeLessThan(baseSat);
  });

  it("hash01 is deterministic and in [0,1)", () => {
    for (const [x, z] of [[1.5, -3.2], [0, 0], [123.456, 789.012]] as const) {
      const a = hash01(x, z);
      const b = hash01(x, z);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    // Different positions give different values (no constant output).
    expect(hash01(1, 1)).not.toBe(hash01(2, 2));
  });
});

describe("groundVertexColor", () => {
  it("flat lowland is darker than flat highland", () => {
    const low = groundVertexColor(GRASS, ROCK, 0.0, 1, 10, 10);
    const high = groundVertexColor(GRASS, ROCK, 1.0, 1, 10, 10);
    const lum = (c: Rgb) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    expect(lum(high)).toBeGreaterThan(lum(low));
  });

  it("steep slope blends toward rock (less green than flat grass)", () => {
    const flat = groundVertexColor(GRASS, ROCK, 0.5, 1, 10, 10);
    const steep = groundVertexColor(GRASS, ROCK, 0.5, 0, 10, 10);
    // Rock is desaturated: the green channel drops relative to red vs flat grass.
    expect(steep.g - steep.r).toBeLessThan(flat.g - flat.r);
  });

  it("all channels stay in [0,1]", () => {
    for (const h of [0, 0.5, 1]) {
      for (const ny of [0, 0.3, 1]) {
        const c = groundVertexColor(GRASS, ROCK, h, ny, 42.5, -17.25);
        for (const v of [c.r, c.g, c.b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is deterministic for the same inputs", () => {
    const a = groundVertexColor(GRASS, ROCK, 0.3, 0.8, 5, 6);
    const b = groundVertexColor(GRASS, ROCK, 0.3, 0.8, 5, 6);
    expect(a).toEqual(b);
  });
});
