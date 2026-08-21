/**
 * Headless geometry guard for the multi-variant meadow trees.
 *
 * The data specs (propBuilder-data / tracks-data) only check the registry seam — they never
 * construct meshes. This test builds a REAL PropBuilder on the Meadows track under a NullEngine
 * and asserts: every tree variant source mesh is built, carries a vertex-color buffer (foliage +
 * bark mottling), and that dense placement actually produced many instanced trees at High density.
 */
import { describe, expect, it } from "vitest";
import { NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { MEADOWS_TRACK } from "../../src/data/tracks/index.js";
import { TUNING } from "../../src/data/tuning.js";
import type { IQualityProbe } from "../../src/core/GameStateMachine.js";
import { PropBuilder } from "../../src/tracks/PropBuilder.js";
import { TrackSpline } from "../../src/tracks/TrackSpline.js";
import type { HeightField } from "../../src/tracks/TrackElevation.js";

const TREE_VARIANTS = 3; // must match PropBuilder's constant

/**
 * PropBuilder's ctor always builds a geyser-plume DynamicTexture, which needs an OffscreenCanvas
 * that Node's NullEngine env lacks. Stub just the 2D canvas surface (dot-sprite drawing only — it
 * never touches mesh/geometry code) so we can construct the REAL PropBuilder and exercise the tree path.
 */
function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;
  const makeCtx = () => ({
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    fillStyle: null as unknown,
  });
  class OffscreenCanvas {
    width = 0;
    height = 0;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return makeCtx();
    }
    transferToImageBitmap() {
      return {};
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = OffscreenCanvas;
}
installOffscreenCanvasStub();

function flatField(): HeightField {
  return {
    heightAt: () => 0,
    bounds: { minX: -120, maxX: 120, minZ: -80, maxZ: 80 },
    minH: 0,
    maxH: 0,
  };
}

function highQuality(): IQualityProbe {
  return {
    current: "high",
    propDensity: () => 1.0,
    budget: () => 1.0,
    onPresetChanged: null,
  };
}

describe("meadow tree variants (headless NullEngine)", () => {
  it("builds every variant source with vertex colors and places a dense forest", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spline = new TrackSpline(
      MEADOWS_TRACK.controlPoints,
      MEADOWS_TRACK.roadWidth,
      TUNING.physics.onRoadMargin,
      undefined,
      MEADOWS_TRACK.widthOverrides,
    );

    const builder = new PropBuilder(scene, spline, MEADOWS_TRACK, flatField(), highQuality());
    builder.build();

    // Reach the private source cache to inspect the built variant meshes.
    const sources = (builder as unknown as { sources: Map<string, MeshLike> }).sources;

    for (let v = 0; v < TREE_VARIANTS; v++) {
      const mesh = sources.get(`tree:${v}`);
      expect(mesh, `tree variant ${v} source was not built`).toBeTruthy();
      // Every part of a tree is mottled → the merged geometry must carry a color buffer.
      const colors = (mesh as unknown as { getVerticesData(k: string): Float32Array | null }).getVerticesData(
        VertexBuffer.ColorKind,
      );
      expect(colors, `tree variant ${v} has no vertex-color buffer`).toBeTruthy();
    }

    // Dense placement: the catalog now holds far more trees than the old 26, and at High density
    // (propDensity 1.0) every tree entry becomes an instance. Count placed tree instances.
    const instances = (builder as unknown as { instances: Array<{ name: string }> }).instances;
    const treeInstances = instances.filter((m) => m.name.startsWith("prop-tree-"));
    expect(treeInstances.length).toBeGreaterThan(100);

    builder.dispose();
    scene.dispose();
    engine.dispose();
  });
});

/** Minimal structural type so the test doesn't import Mesh just to read a buffer. */
interface MeshLike {
  getVerticesData(kind: string): Float32Array | null;
}
