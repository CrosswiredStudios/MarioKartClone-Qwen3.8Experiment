import { Engine, Scene, UniversalCamera, Vector3, Viewport } from "@babylonjs/core";
import { GameApp } from "./core/GameApp.js";
import { QualityManager } from "./rendering/QualityManager.js";
import { RenderPipelineSetup } from "./rendering/RenderPipelineSetup.js";
import { ParticleFactory } from "./vfx/ParticleFactory.js";

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
    };
  }
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
    ? { aiDrivePlayer: () => app.aiDrivePlayer(), setItem: (item: string) => app.debugSetPlayerItem(item) }
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
