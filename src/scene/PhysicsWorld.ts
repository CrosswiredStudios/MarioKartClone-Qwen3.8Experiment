import {
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeType,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
// The concrete v2 engine class is re-exported from the bare index under this name.
import type { Scene } from "@babylonjs/core/scene.js";
import type { PhysicsEngine as PhysicsEngineV2 } from "@babylonjs/core/Physics/v2/physicsEngine.js";
// Deep import: HavokPlugin is NOT re-exported from the v2 index in this build.
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import HK from "@babylonjs/havok";

import { TUNING } from "../data/tuning.js";
import type { HeightField } from "../tracks/TrackElevation.js";

/**
 * PhysicsWorld — owns the Havok plugin lifecycle and the static terrain body.
 *
 * Render-adjacent (MAY import Babylon). Core stays Babylon-free: main.ts creates
 * this once, awaits init(), and hands scenes a narrow opaque handle via GameApp
 * (same pattern as IRenderPipeline / IParticleVfx).
 *
 * Design notes (verified against the installed @babylonjs/havok 1.3.x build):
 * - WASM loads natively under Vite: the ESM bundle resolves HavokPhysics.wasm via
 *   `new URL(..., import.meta.url)` — no public/ copy or ?url fallback needed.
 * - The Scene auto-steps physics every render frame while `scene.physicsEnabled`
 *   is true (Scene._animate → _advancePhysicsEngineStep). We therefore never call
 *   `_step` ourselves; freezing the sim = toggling that flag (done by GameApp
 *   while Paused).
 * - Terrain is ONE static HEIGHTFIELD body. This Havok build fully implements
 *   heightfield shapes with direct Float32Array data, so the physical surface can
 *   match the rendered ground exactly — no convex-hull compound approximation.
 *   The shape's local origin sits at its (0,0) corner; we anchor a static
 *   TransformNode at (bounds.minX, 0, bounds.minZ) and store ABSOLUTE world Y
 *   values in heightFieldData so local y=0 aligns with world y=0.
 */
export class PhysicsWorld {
  private _scene: unknown; // Babylon Scene — kept opaque here too for testability
  private _terrainNode: TransformNode | null = null;
  private _terrainBody: PhysicsBody | null = null;
  private _ready = false;

  constructor(scene: unknown) {
    this._scene = scene;
  }

  get ready(): boolean {
    return this._ready;
  }

  /**
   * Load the Havok WASM and enable physics on the scene. Idempotent — safe to
   * call again after dispose(). Must be awaited before any body is created.
   */
  async init(): Promise<void> {
    if (this._ready) return;
    const scene = this._scene as Scene;
    const hk = await HK();
    // Ctor is (useDeltaForWorldStep?, hpInjection?, parameters?) — the loaded Havok
    // instance is the SECOND arg. Passing it first falls back to a bare `HK` global
    // default that doesn't exist in an ESM bundle ("ReferenceError: HK is not defined").
    const plugin = new HavokPlugin(true, hk);
    const ok = scene.enablePhysics(
      new Vector3(0, TUNING.physicsWorld.gravityY, 0),
      plugin,
    );
    if (!ok) throw new Error("PhysicsWorld: scene.enablePhysics failed");
    // Fixed 1/60 step; the Scene's per-frame auto-step drives it.
    const engine = scene.getPhysicsEngine();
    if (engine) {
      engine.setTimeStep(TUNING.physicsWorld.timestepSec);
    }
    this._ready = true;
  }

  /** The live physics engine (for raycasts / queries). Null until init(). */
  getEngine(): PhysicsEngineV2 | null {
    return (this._scene as Scene).getPhysicsEngine() as PhysicsEngineV2 | null;
  }

  /** Freeze/thaw the whole sim. GameApp toggles this while Paused. */
  setFrozen(frozen: boolean): void {
    const scene = this._scene as Scene;
    if (this._ready) scene.physicsEnabled = !frozen;
  }

  /**
   * Raycast against the physics world (suspension, ground probes). Pure-data in/out
   * so core never touches Babylon Vector3. Returns null on a miss.
   */
  raycast(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null {
    const engine = this.getEngine();
    if (!engine) return null;
    const result = engine.raycast(
      new Vector3(from.x, from.y, from.z),
      new Vector3(to.x, to.y, to.z),
    );
    if (!result || !result.hasHit) return null;
    return {
      point: { x: result.hitPointWorld.x, y: result.hitPointWorld.y, z: result.hitPointWorld.z },
      normal: { x: result.hitNormalWorld.x, y: result.hitNormalWorld.y, z: result.hitNormalWorld.z },
    };
  }

  /**
   * Build the static terrain heightfield body from a pure HeightField.
   * Replaces any previous terrain (call clearTerrain() first in practice).
   */
  buildTerrain(field: HeightField): void {
    if (!this._ready) throw new Error("PhysicsWorld.buildTerrain before init()");
    this.clearTerrain();

    const scene = this._scene as Scene;
    const res = TUNING.terrain.gridResolution; // 96×96 sample grid over the bounds
    const { minX, maxX, minZ, maxZ } = field.bounds;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    // Buffer layout — derived EMPIRICALLY via the isolated hf-test.html baseline
    // (9×9 straight-down raycast grid fit against field.heightAt ground truth): this
    // Havok build TRANSPOSES the heightfield relative to its node (shape X-axis indexes
    // along world Z and vice versa) on top of the plugin's own read-loop remap
    // (bjsBufferIndex = (samplesX-1-x)*samplesZ + z). Pre-compensating for BOTH, the
    // field sample at grid (ix, iz) must be stored at data[(res-1-iz)*res + ix] — i.e.
    // Z flipped, X fastest. With this layout the "identity" mapping wins the fit
    // (mean|Δ| ≈ 0.15 m vs ~5 m for every other candidate), so the physical surface
    // matches field.heightAt(x,z) everywhere and karts rest on it instead of falling.
    const data = new Float32Array(res * res);
    for (let ix = 0; ix < res; ix++) {
      const x = minX + (spanX * ix) / (res - 1);
      for (let iz = 0; iz < res; iz++) {
        const z = minZ + (spanZ * iz) / (res - 1);
        data[(res - 1 - iz) * res + ix] = field.heightAt(x, z); // ABSOLUTE world Y
      }
    }

    // Anchor at the field's CENTER: the WASM heightfield is centered on the body origin
    // (verified empirically — corner-anchoring left the whole track outside the field's
    // covered area and every kart fell through). Local (0,0,0) == world center.
    const node = new TransformNode("physicsTerrain", scene);
    node.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, true, scene);
    body.shape = new PhysicsShape(
      {
        type: PhysicsShapeType.HEIGHTFIELD,
        parameters: {
          numHeightFieldSamplesX: res,
          numHeightFieldSamplesZ: res,
          heightFieldSizeX: spanX,
          heightFieldSizeZ: spanZ,
          heightFieldData: data,
        },
      },
      scene,
    );

    this._terrainNode = node;
    this._terrainBody = body;
  }

  /** Dispose the terrain body + anchor (per-race teardown). */
  clearTerrain(): void {
    if (this._terrainBody) {
      this._terrainBody.dispose();
      this._terrainBody = null;
    }
    if (this._terrainNode) {
      this._terrainNode.dispose();
      this._terrainNode = null;
    }
  }

  /** Full teardown: terrain + physics engine. */
  dispose(): void {
    this.clearTerrain();
    const scene = this._scene as Scene;
    if (this._ready) {
      scene.disablePhysicsEngine();
      this._ready = false;
    }
  }
}
