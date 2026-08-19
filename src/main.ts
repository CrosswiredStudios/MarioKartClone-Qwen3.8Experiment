import {
  Engine,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeType,
  Scene,
  TransformNode,
  UniversalCamera,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { GameApp } from "./core/GameApp.js";
import { QualityManager } from "./rendering/QualityManager.js";
import { RenderPipelineSetup } from "./rendering/RenderPipelineSetup.js";
import { ParticleFactory } from "./vfx/ParticleFactory.js";
import { PhysicsWorld } from "./scene/PhysicsWorld.js";

/**
 * Phase 1 bootstrap: engine + scene + GameApp (menu-driven state machine).
 * HelloWorldScene stays importable for Phase 3 — KartRenderer reuses its kart mesh code.
 */

function assertWebGL2Supported(): boolean {
  const probe = document.createElement("canvas");
  return probe.getContext("webgl2") !== null;
}

if (!assertWebGL2Supported()) {
  const errorEl = document.getElementById("webgl2-error");
  if (errorEl) errorEl.style.display = "flex";
  throw new Error("WebGL2 is not supported in this browser.");
}

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

const engine = new Engine(canvas, true, {
  stencil: true,
  adaptToDeviceRatio: false, // QualityManager (Phase 3) owns pixel ratio decisions.
});

const scene = new Scene(engine);
scene.autoClear = true;

// Parked placeholder camera so scene.render() has a valid activeCamera in Phase 1/2.
// The menu is DOM-only, so the canvas just shows the clear color behind it.
// Phase 3 replaces this with the chase camera (see docs/plans/05-phase-3-track-system.md).
const parkedCamera = new UniversalCamera(
  "parkedCamera",
  new Vector3(0, 2, -6),
  scene,
);
parkedCamera.setTarget(new Vector3(0, 1, 0));

// Phase 4 Step 12 — production safety: in a production build Vite statically replaces
// import.meta.env.DEV with `false`, so without "?debug" on the URL this is `false` and the
// debug-only branches below (aiDrivePlayer handle + the ttr.debugAIDrive localStorage read)
// are dead code, eliminated by minification. Documented in the README during Phase 7.
const debugAllowed = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");

// Phase 4: RACE mode — Countdown runs the real 3-2-1-GO interstitial and Racing runs
// the RaceController + RaceScene (06-phase-4-race-loop-and-ai.md). Free-drive was the
// Phase 3 prototype; it's now superseded by the full race loop.
const app = new GameApp(engine, scene, false, debugAllowed);
app.boot();

// Quality preset: a stored choice overrides auto-detect; otherwise measure 60
// frames at High and step down one preset if average FPS < 50 (Task 7).
const quality = new QualityManager(engine, scene);

// Phase 6: the render pipeline owns skybox + lights + fog + post stack. Created once
// here (app-level) and injected into GameContext as an opaque handle so core stays
// Babylon-free. Map scenes call applyTheme() on enter / exitMap() on exit.
const pipeline = new RenderPipelineSetup(scene, quality);
app.setRenderPipeline(pipeline);

// Phase 6: the particle factory owns all VFX systems (boost flames, shell explosions,
// star sparkles, skid dust, confetti, lightning flash). Created once here and injected as
// an opaque handle; map scenes call attach() on enter / update(dt, karts) per frame /
// disposeAll() on exit.
const particleVfx = new ParticleFactory(scene, quality);
app.setParticleVfx(particleVfx);

// Phase 6: the quality probe lets map scenes construct the PropBuilder (density +
// torch lights) without importing QualityManager — core stays Babylon-free.
app.setQualityProbe(quality);

// Physics rewrite: the Havok world owns plugin lifecycle + the static terrain body.
// init() loads the WASM natively under Vite and enables physics on the scene; the
// Scene auto-steps it every render frame thereafter. Awaited here (top-level) so any
// race scene can build its terrain heightfield before karts spawn — the 3 s countdown
// hides the load, which is a few hundred KB served locally by Vite.
const physicsWorld = new PhysicsWorld(scene);
await physicsWorld.init();
app.setPhysicsWorld(physicsWorld);

// Phase 4 Step 10: wire the render-layer QualityManager into the settings panel so
// quality changes apply live. The reader lets the panel highlight the active preset.
// Phase 6: a live change also re-applies the post stack + shadow resolution in place.
app.setQualityApplier(
  (preset) => {
    quality.apply(preset);
    pipeline.onQualityChanged();
  },
  () => quality.current,
);

quality.autoDetect();

// Phase 1: the menu is DOM-only, so the canvas just shows the clear color.
// Phase 3 moves rendering into the loop's alpha hook.
engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => engine.resize());

// Debug/e2e handle (see docs/plans/01-architecture.md §Testability).
declare global {
  interface Window {
    __game: {
      state: string;
      navigate(screen: string): void;
      snapshot(): {
        state: string;
        raceConfig: { characterId: string; vehicleId: string; mapId: string } | null;
        drive?: {
          kartPos: { x: number; y: number; z: number };
          speed: number;
          surface: "road" | "offRoad" | "oilSlick";
          driftCharge: string;
        };
      };
      standings(): Array<{ id: string; name: string; rank: number; lap: number; t: number }>;
      karts(): Array<{ id: string; pos: { x: number; y: number; z: number }; speed: number; lap: number; item: unknown; charging: unknown }>;
      /** Phase 7 — race controller phase ("countdown" | "racing" | "finished" | "none"). */
      racePhase(): string;
      /** Phase 5.1 — live shell projectile count (0 when no race is active). */
      shells(): number;
      /** Present only when debugAllowed (dev mode or ?debug URL param). */
      aiDrivePlayer?(): void;
      /** Present only when debugAllowed — force the player's held item (e2e / playtest). */
      setItem?(item: string): void;
      /** Present only when debugAllowed — count of kart:bumped events since load. */
      bumps?(): number;
      /**
       * Present only when debugAllowed (Phase 1 blocker probe) — spawns two dynamic
       * spheres aimed head-on and watches the WORLD-level collision observable.
       * Returns { count(), dispose() }; count() = raw native events observed so far.
       */
      probeCollision?(): { count(): number; dispose(): void };
      /**
       * Present only when debugAllowed (heightfield layout experiment) — 2×2 field with
       * one tall cell + four spheres at (±3, ±3). read() returns each sphere's Y.
       */
      hfProbe?(): { read(): Array<number | null>; dispose(): void };
      /**
       * Present only when debugAllowed — raycast straight down in the LIVE physics world.
       * Returns the hit Y (or null) so probes can compare the physical surface against
       * field.heightAt ground truth during a real race.
       */
      physRayDown?(x: number, z: number): number | null;
      /** Present only when debugAllowed — raw field.heightAt ground truth (NaN pre-race). */
      fieldHeightAt?(x: number, z: number): number;
    };
  }
}

// Debug-only bump counter (physics rewrite) — proves the collision-event path fires.
let bumpCount = 0;
if (debugAllowed) app.eventBus.on("kart:bumped", () => { bumpCount++; });

/**
 * Debug-only heightfield layout experiment: builds a 2×2 field with ONE tall cell
 * (data [10, 0, 0, 0]) at the origin and drops four spheres at (±3, ±3). Which sphere
 * lands on top pins down both the buffer→world mapping AND the anchor convention.
 */
function makeHeightfieldProbe() {
  const data = new Float32Array([10, 0, 0, 0]);
  const node = new TransformNode("hf-probe", scene);
  node.position.set(0, 0, 0);
  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, true, scene);
  body.shape = new PhysicsShape(
    {
      type: PhysicsShapeType.HEIGHTFIELD,
      parameters: {
        numHeightFieldSamplesX: 2,
        numHeightFieldSamplesZ: 2,
        heightFieldSizeX: 10,
        heightFieldSizeZ: 10,
        heightFieldData: data,
      },
    },
    scene,
  );
  const spots: Array<[string, number, number]> = [
    ["hf-probe-a", -3, -3],
    ["hf-probe-b", 3, -3],
    ["hf-probe-c", -3, 3],
    ["hf-probe-d", 3, 3],
  ];
  const spheres = spots.map(([name, x, z]) => {
    const n = new TransformNode(name, scene);
    n.position.set(x, 14, z);
    const b = new PhysicsBody(n, PhysicsMotionType.DYNAMIC, false, scene);
    b.shape = new PhysicsShape({ type: PhysicsShapeType.SPHERE, parameters: { radius: 1 } }, scene);
    return n;
  });
  return {
    read() {
      return spots.map(([name]) => {
        const n = scene.getTransformNodeByName(name);
        return n ? +n.position.y.toFixed(2) : null;
      });
    },
    dispose() {
      body.dispose();
      node.dispose();
      for (const s of spheres) {
        // PhysicsBody is attached to the node; disposing the node disposes the body.
        s.dispose();
      }
    },
  };
}

/**
 * Phase 1 blocker probe: two fresh dynamic spheres, head-on at ±20 m/s, callbacks
 * enabled on BOTH bodies, world-level observable tapped. If native Havok events work
 * AT ALL in this pairing, this fires within a second or two — independent of karts.
 */
function makeProbeCollision() {
  const engine = scene.getPhysicsEngine();
  if (!engine) throw new Error("physics not enabled");
  const plugin = engine.getPhysicsPlugin();
  let events = 0;
  const obs = (plugin as unknown as { onCollisionObservable: { add(cb: () => void): { remove(): void } } }).onCollisionObservable.add(
    () => { events++; },
  );
  const mk = (name: string, x: number, vx: number) => {
    const node = new TransformNode(name, scene);
    node.position.set(x, 5, 0);
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape = new PhysicsShape({ type: PhysicsShapeType.SPHERE, parameters: { radius: 1 } }, scene);
    body.setMassProperties({ ...body.computeMassProperties(), mass: 50 });
    body.setCollisionCallbackEnabled(true);
    body.setLinearVelocity(new Vector3(vx, 0, 0));
    return { node, body };
  };
  const a = mk("probe-sphere-a", -6, 20);
  const b = mk("probe-sphere-b", 6, -20);
  return {
    count: () => events,
    dispose() {
      obs.remove();
      a.body.dispose();
      b.body.dispose();
      a.node.dispose();
      b.node.dispose();
    },
  };
}

window.__game = {
  get state() {
    return app.snapshot().state;
  },
  // e2e-only escape hatch — production navigation always goes through the UI.
  navigate: (screen) => app.machine.transition(screen as never),
  snapshot: () => app.snapshot(),
  standings: () => app.raceStandings(),
  karts: () => app.raceKartSummary(),
  racePhase: () => app.racePhase(),
  shells: () => app.shellCount(),
  ...(debugAllowed
    ? {
        aiDrivePlayer: () => app.aiDrivePlayer(),
        setItem: (item: string) => app.debugSetPlayerItem(item),
        bumps: () => bumpCount,
        probeCollision: makeProbeCollision,
        hfProbe: makeHeightfieldProbe,
        physRayDown: (x: number, z: number) => {
          const hit = physicsWorld.raycast({ x, y: 60, z }, { x, y: -80, z });
          return hit ? +hit.point.y.toFixed(3) : null;
        },
        fieldHeightAt: (x: number, z: number) => app.fieldHeightAt(x, z),
      }
    : {}),
};

// Debug handle for browser playtests (screenshots are unavailable in this env):
// exposes the live scene so page.evaluate can read camera pos + skid geometry.
declare global {
  interface Window {
    __sw?: {
      cam(): { x: number; y: number; z: number; fov: number };
      skids(): { verts: number; indices: number };
      karts(): number;
      sceneInfo(): { totalMeshes: number; bodyNames: string[]; trackRoot: boolean; skidMesh: boolean };
      pick(nx: number, ny: number): { hit: string | null; dist?: number; point?: { x: number; y: number; z: number } | null } | null;
      quality(): { preset: string; budget: number; scalingLevel: number; stored: string | null };
      road(): Record<string, unknown> | null;
      dbg(fn: (scene: Scene) => unknown): unknown;
    };
  }
}
window.__sw = {
  cam() {
    const c = scene.activeCamera as unknown as { position: { x: number; y: number; z: number }; fov?: number };
    return { x: c.position.x, y: c.position.y, z: c.position.z, fov: c.fov ?? -1 };
  },
  skids() {
    const m = scene.getMeshByName("skid-marks") as unknown as { getTotalVertices(): number; getIndices(): number[] | null } | null;
    if (!m) return { verts: 0, indices: 0 };
    return { verts: m.getTotalVertices(), indices: (m.getIndices() ?? []).length };
  },
  karts() {
    return scene.meshes.filter((mm) => mm.name.includes("-body")).length;
  },
  quality() {
    return {
      preset: quality.current,
      budget: quality.budget(),
      scalingLevel: engine.getHardwareScalingLevel(),
      stored: quality.readStored(),
    };
  },
  sceneInfo() {
    const bodies = scene.meshes.filter((m) => m.name.includes("-body")).map((m) => m.name);
    return {
      totalMeshes: scene.meshes.length,
      bodyNames: bodies,
      trackRoot: !!scene.getTransformNodeByName("track-root"),
      skidMesh: !!scene.getMeshByName("skid-marks"),
    };
  },
  road() {
    const m = scene.getMeshByName("track-road") as unknown as {
      name: string; isVisible: boolean; isPickable: boolean; alpha: number;
      backFaceCulling: boolean; renderListId: number; infiniteDistance: boolean;
      getTotalVertices(): number; getIndices(): number[] | null;
      getVerticesData(kind: string): unknown;
      isWorldMatrixFrozen: boolean; parent?: { name: string };
      getBoundingInfo(): { boundingBox: { minimumWorld: Vector3; maximumWorld: Vector3 } };
      material?: {
        name: string; opacity: number; diffuseTexture?: { name: string };
        diffuseColor?: { r: number; g: number; b: number };
        disableLighting?: boolean; emissiveColor?: { r: number; g: number; b: number };
      } | null;
    } | null;
    if (!m) return null;
    const bb = m.getBoundingInfo().boundingBox;
    return {
      name: m.name, isVisible: m.isVisible, isPickable: m.isPickable, alpha: m.alpha,
      backFaceCulling: m.backFaceCulling, renderListId: m.renderListId,
      infiniteDistance: m.infiniteDistance, frozen: m.isWorldMatrixFrozen,
      parent: m.parent?.name ?? null,
      verts: m.getTotalVertices(), indices: (m.getIndices() ?? []).length,
      hasPosition: !!m.getVerticesData("position"), posLen: (m.getVerticesData("position") as number[] | null)?.length ?? 0,
      bboxMin: [bb.minimumWorld.x.toFixed(1), bb.minimumWorld.y.toFixed(3), bb.minimumWorld.z.toFixed(1)],
      bboxMax: [bb.maximumWorld.x.toFixed(1), bb.maximumWorld.y.toFixed(3), bb.maximumWorld.z.toFixed(1)],
      material: m.material ? {
        name: m.material.name, opacity: m.material.opacity,
        hasDiffuseTexture: !!m.material.diffuseTexture, texName: m.material.diffuseTexture?.name ?? null,
        diffuseColor: m.material.diffuseColor ? [m.material.diffuseColor.r, m.material.diffuseColor.g, m.material.diffuseColor.b] : null,
        disableLighting: m.material.disableLighting ?? false,
      } : null,
      sceneFog: { mode: scene.fogMode, density: scene.fogDensity, color: [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b] },
    };
  },
  dbg(fn) {
    return fn(scene);
  },
  pick(nx: number, ny: number) {
    // nx,ny in [0,1] screen space (top-left origin). Returns the front-most mesh hit.
    const cam = scene.activeCamera as unknown as { viewport?: Viewport } | null;
    if (!cam) return null;
    const eng = scene.getEngine();
    const rw = eng.getRenderWidth();
    const rh = eng.getRenderHeight();
    // createPickingRay needs a viewport; this camera has none, so set a full-screen one.
    const prevViewport = cam.viewport ?? null;
    if (!cam.viewport) cam.viewport = new Viewport(0, 0, rw, rh);
    try {
      const ray = scene.createPickingRay(nx * rw, ny * rh, null, cam as never);
      const info = scene.pickWithRay(ray);
      if (!info || !info.pickedMesh) return { hit: null };
      const p = info.pickedPoint;
      return {
        hit: info.pickedMesh.name,
        dist: +info.distance.toFixed(2),
        point: p ? { x: +p.x.toFixed(2), y: +p.y.toFixed(3), z: +p.z.toFixed(2) } : null,
      };
    } finally {
      if (!prevViewport) (cam as unknown as { viewport: Viewport | null }).viewport = null;
    }
  },
};
