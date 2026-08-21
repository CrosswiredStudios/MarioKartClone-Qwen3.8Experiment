/**
 * RenderPipelineSetup — Phase 6 implementation of the P3 render-pipeline contract
 * (08-phase-6-vfx-audio-polish.md T1/T2; 01-architecture.md §10).
 *
 * Owns everything "environment" about a map scene:
 *   (a) cube-texture skybox — inverted sphere painted by a per-track 6-face CubeTexture
 *       (assets under public/textures/skybox-*, see TrackTheme.skybox),
 *   (b) per-map lighting rig — hemispheric + directional sun + accent point lights,
 *       plus a preset-dependent shadow generator on the sun,
 *   (c) EXP2 fog from the theme,
 *   (d) quality-gated post stack:
 *         bloom weight 0.35 / threshold 0.8 → Medium/High only (§10 "Bloom / color grade")
 *         SSAO (separate pipeline)          → Medium (half-res ratio 0.5) / High (full res)
 *         image processing contrast 1.05    → Medium/High (stylized cartoon look)
 *         FXAA                              → Low only (cheap AA stand-in)
 *
 * Babylon v9 API notes (the plan doc assumed the older v4/v5 surface):
 *   - FXAA is a built-in of DefaultRenderingPipeline (`fxaaEnabled`), not a separate class.
 *   - Bloom is configured via `bloomWeight`/`bloomThreshold`, not a `bloomEffect` object.
 *   - SSAO is its own pipeline (SSAORenderingPipeline) — the default pipeline has no SSAO.
 *   - Image processing lives on `scene.imageProcessingConfiguration`; v9 exposes `contrast`
 *     but NOT `saturation`, so only contrast 1.05 is applied (deviation from plan, noted in P6 memory).
 *   - There is no `scene.shadowGenerators` array — a ShadowGenerator self-registers through
 *     its light; we track our own instance for disposal.
 *
 * Lifecycle: created ONCE in main.ts (app-level), injected into GameContext as an opaque
 * structural type so core stays Babylon-free. Scenes call applyTheme() on enter and
 * exitMap() on exit; teardownRace calls dispose().
 *
 * Idempotency contract (P6 acceptance #5): applyTheme(theme) with the SAME theme object
 * is a no-op for heavy objects (skybox/lights/post); a different theme disposes them and
 * rebuilds. Fog/clear are always refreshed so pause/resume re-entry restores map fog.
 * Entering a map scene twice therefore never duplicates lights or post objects.
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import {
  Color3,
  CubeTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  SSAORenderingPipeline,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type TransformNode,
} from "@babylonjs/core";
import type { TrackTheme } from "../data/tracks/shared.js";
import type { QualityManager } from "./QualityManager.js";

/** Skybox sphere radius (m) — far beyond any camera travel; infiniteDistance keeps it fixed. */
const SKYBOX_RADIUS = 2000;
/**
 * PBR light-intensity recalibration: StandardMaterial and PBRMaterial interpret the same
 * DirectionalLight intensity very differently (PBR is physically based, so a sun of 1.0
 * looks ~3× dimmer on PBR surfaces). These scales convert the theme's artist-tuned values
 * (tuned against the old Standard rig) into PBR-appropriate ones. Adjust here, not at call sites.
 */
const SUN_INTENSITY_SCALE = 3;
const AMBIENT_INTENSITY_SCALE = 0.35;
/** Accent point-light range (m) — a soft local glow, not scene-wide illumination. */
const ACCENT_LIGHT_RANGE = 40;

export class RenderPipelineSetup {
  private skybox: ReturnType<typeof MeshBuilder.CreateSphere> | null = null;
  private skyMat: StandardMaterial | null = null;
  private skyTex: CubeTexture | null = null;
  private hemi: HemisphericLight | null = null;
  private sun: DirectionalLight | null = null;
  private accentLights: PointLight[] = [];
  private shadowGen: ShadowGenerator | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAORenderingPipeline | null = null;

  /** The theme currently applied (reference identity is the idempotency key). */
  private currentTheme: TrackTheme | null = null;
  /** Scene fog state captured before the FIRST applyTheme — restored by exitMap()/dispose(). */
  private prevFogMode: number | null = null;
  private prevFogColor: Color3 | null = null;
  private prevFogDensity: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly qualityManager: QualityManager,
  ) {}

  /**
   * Apply a map theme. Heavy objects (skybox/lights/post) are built on first use or when
   * the theme object changes; fog/clear are ALWAYS refreshed so pause/resume re-entry
   * restores the map's atmosphere without rebuilding anything expensive.
   */
  applyTheme(theme: TrackTheme): void {
    const firstApply = this.currentTheme === null;
    const changed = !firstApply && this.currentTheme !== theme;

    if (changed) this.disposeEnvironment(); // new map — rebuild skybox/lights/post

    if (firstApply) {
      // Capture the pristine scene state once so exitMap()/dispose() can restore it.
      this.prevFogMode = this.scene.fogMode;
      this.prevFogColor = this.scene.fogColor.clone();
      this.prevFogDensity = this.scene.fogDensity;
    }

    if (firstApply || changed) {
      this.currentTheme = theme;
      this.buildSkybox(theme);
      this.buildLights(theme);
      this.rebuildPostStack();
    }
    // Fog/clear are ALWAYS refreshed: exitMap() resets them on pause, so a same-theme
    // re-entry (resume) must restore the map's fog without rebuilding heavy objects.
    this.applyFog(theme);
  }

  /** Re-apply the post stack + shadow resolution after a live quality change. */
  onQualityChanged(): void {
    if (!this.currentTheme) return; // parked — nothing to refresh
    this.rebuildPostStack();
  }

  /** Restore menu fog/clear color when leaving a map scene (skybox stays as backdrop). */
  exitMap(): void {
    if (this.prevFogMode !== null) this.scene.fogMode = this.prevFogMode;
    if (this.prevFogColor) this.scene.fogColor.copyFrom(this.prevFogColor);
    if (this.prevFogDensity !== null) this.scene.fogDensity = this.prevFogDensity;
  }

  /**
   * Re-register shadow casters from the current track-root children plus any extra
   * roots (kart roots — karts are NOT under track-root). Called by scenes after
   * (re)building the track + karts — pause/resume rebuilds those meshes, so a fresh
   * enter() must re-point the generator at the new mesh instances. No-op when shadows
   * are off (Low preset) or no theme is applied yet.
   */
  refreshShadowCasters(extraRoots?: TransformNode[]): void {
    if (!this.shadowGen) return;
    const root = this.scene.getTransformNodeByName("track-root");
    if (!root) return;
    for (const child of root.getChildMeshes()) {
      this.shadowGen.addShadowCaster(child);
      child.receiveShadows = true;
    }
    // Extra roots (karts): addShadowCaster only accepts AbstractMesh in this
    // Babylon version, so register each child mesh individually.
    for (const extra of extraRoots ?? []) {
      for (const m of extra.getChildMeshes()) {
        this.shadowGen.addShadowCaster(m);
        m.receiveShadows = true;
      }
    }
  }

  /** Full teardown (quit-to-menu): dispose everything and restore pristine scene state. */
  dispose(): void {
    this.disposeEnvironment();
    this.currentTheme = null;
    if (this.prevFogMode !== null) this.scene.fogMode = this.prevFogMode;
    if (this.prevFogColor) this.scene.fogColor.copyFrom(this.prevFogColor);
    if (this.prevFogDensity !== null) this.scene.fogDensity = this.prevFogDensity;
  }

  // ── (a) Skybox ────────────────────────────────────────────────────────────

  private buildSkybox(theme: TrackTheme): void {
    const scene = this.scene;
    const sphere = MeshBuilder.CreateSphere(
      "sky-sphere",
      { diameter: SKYBOX_RADIUS, sideOrientation: Mesh.BACKSIDE },
      scene,
    );
    sphere.infiniteDistance = true; // stays centered on the camera — no parallax drift
    sphere.applyFog = false;

    // Per-track 6-face cubemap. CubeTexture appends _px/_nx/_py/_ny/_pz/_nz.jpg to the base
    // path, so theme.skybox is extension-less (validated in shared.ts). SKYBOX_MODE paints
    // the faces directly on the cube instead of simulating a reflection.
    const tex = new CubeTexture(theme.skybox, scene);
    tex.coordinatesMode = Texture.SKYBOX_MODE;

    // IBL: expose the sky cubemap as the scene environment texture. PBR materials fall back
    // to scene.environmentTexture when they have no reflectionTexture of their own, so this
    // single assignment lights every PBR surface in the scene (karts, road, ground, props).
    // The skybox sphere itself is unaffected — it uses StandardMaterial + disableLighting.
    scene.environmentTexture = tex;

    const mat = new StandardMaterial("sky-mat", scene);
    mat.reflectionTexture = tex; // skyboxes use reflectionTexture even though it's not a reflection
    // NO emissiveColor: with disableLighting, diffuseBase stays 0, so the final color is
    // just reflectionColor.rgb (the cubemap). Setting emissive to white would ADD (1,1,1)
    // on top of the sky and blow it out to gray/white.
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    sphere.material = mat;

    this.skybox = sphere;
    this.skyMat = mat;
    this.skyTex = tex;
  }

  // ── (b) Lighting rig + shadows ────────────────────────────────────────────

  private buildLights(theme: TrackTheme): void {
    const scene = this.scene;

    // Hemisphere ambient tinted by the ground color for a grounded bounce feel.
    // Intensity is scaled down for PBR (see AMBIENT_INTENSITY_SCALE) — with IBL now
    // contributing ambient energy, a full-strength hemi would over-brighten shadows.
    this.hemi = new HemisphericLight("map-ambient", new Vector3(0, 1, 0), scene);
    this.hemi.intensity = theme.ambientIntensity * AMBIENT_INTENSITY_SCALE;
    this.hemi.groundColor = hexToColor3(theme.groundColor).scale(0.6);

    // Directional sun — per-track direction from the theme (points FROM the sun TOWARD
    // the scene, y < 0), normalized; intensity scaled up for PBR (see SUN_INTENSITY_SCALE).
    const [sx, sy, sz] = theme.sunDirection;
    this.sun = new DirectionalLight("map-sun", new Vector3(sx, sy, sz).normalize(), scene);
    this.sun.intensity = theme.sunIntensity * SUN_INTENSITY_SCALE;

    // Accent point lights derived from the theme's accent color — a soft local glow.
    // The real TrackTheme has no per-light positions (the plan doc's accentLights[]
    // field doesn't exist in our data), so we place two symmetric points around the
    // track centroid at a fixed radius.
    const center = this.trackCenter();
    const radius = this.trackRadius();
    for (const angle of [Math.PI / 2, -Math.PI / 2]) {
      const light = new PointLight(
        `map-accent-${angle > 0 ? "a" : "b"}`,
        new Vector3(center.x + Math.cos(angle) * radius, 4, center.z + Math.sin(angle) * radius),
        scene,
      );
      light.diffuse = hexToColor3(theme.accentColor);
      light.intensity = 0.5;
      light.range = ACCENT_LIGHT_RANGE;
      this.accentLights.push(light);
    }

    this.rebuildShadows();
  }

  /** Shadow generator on the sun at preset resolution (off / 1024 / 2048, §10). */
  private rebuildShadows(): void {
    if (!this.sun) return;
    // v9: no scene.shadowGenerators array — dispose our tracked instance directly.
    // The generator self-registers through the light; disposing it detaches it.
    this.shadowGen?.dispose();
    this.shadowGen = null;

    const size = this.qualityManager.shadowMapSize;
    if (size === 0) return; // Low preset — shadows off

    const gen = new ShadowGenerator(size, this.sun);
    gen.usePercentageCloserFiltering = true;
    // Larger blur kernel than the Standard-material era: PBR surfaces show shadow-edge
    // aliasing more strongly under specular highlights.
    gen.blurKernel = 16;
    this.shadowGen = gen;
    // Casters are registered by the active scene via refreshShadowCasters() AFTER it
    // builds its track + karts (applyTheme runs before the track exists on first entry).
  }

  // ── (c) Fog ───────────────────────────────────────────────────────────────

  private applyFog(theme: TrackTheme): void {
    const scene = this.scene;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = hexToColor3(theme.fogColor);
    scene.fogDensity = theme.fogDensity;
    const bottom = hexToColor3(theme.skyBottom);
    scene.clearColor.set(bottom.r, bottom.g, bottom.b, 1);
  }

  // ── (d) Post stack ────────────────────────────────────────────────────────

  private rebuildPostStack(): void {
    const scene = this.scene;
    const preset = this.qualityManager.current;
    const bloomOn = this.qualityManager.bloomEnabled;
    const ssaoOn = this.qualityManager.ssaoEnabled;

    // Dispose the previous pipelines before building new ones.
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    }

    // v9 types activeCamera as Nullable<Camera> — narrow to a non-null Camera[] for the ctor.
    const activeCam = scene.activeCamera;
    const cameras = activeCam ? [activeCam] : undefined;

    // Default pipeline: bloom + FXAA + image processing.
    const pipeline = new DefaultRenderingPipeline("map-pipeline", true, scene, cameras);
    pipeline.bloomEnabled = bloomOn;
    if (bloomOn) {
      pipeline.bloomWeight = 0.35;
      pipeline.bloomThreshold = 0.8;
    }
    // FXAA only on Low — the pixel-ratio cap of 1 makes aliasing more visible there,
    // and it's a cheap stand-in for MSAA which we don't use.
    pipeline.fxaaEnabled = preset === "low";

    // Image processing (color grade) on Medium/High: contrast 1.05 for the stylized
    // cartoon look + a soft vignette to focus the eye on the track. v9 has no
    // `saturation` accessor, so only contrast is applied.
    if (preset !== "low") {
      const ip = scene.imageProcessingConfiguration;
      ip.contrast = 1.05;
      ip.vignetteEnabled = true;
      ip.vignetteWeight = 0.35; // subtle — darkens corners, keeps the center clean
      ip.vignetteColor.set(0, 0, 0, 1);
      pipeline.imageProcessingEnabled = true;
    } else {
      pipeline.imageProcessingEnabled = false;
    }

    this.pipeline = pipeline;

    // SSAO is a separate pipeline in v9: half-res (ratio 0.5) on Medium, full res on High.
    if (ssaoOn) {
      const ratio = preset === "medium" ? 0.5 : 1.0;
      this.ssao = new SSAORenderingPipeline("map-ssao", scene, ratio, cameras);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Centroid of the track's bounding box (approximate scene center). */
  private trackCenter(): Vector3 {
    const bb = this.trackBounds();
    if (!bb) return new Vector3(0, 0, 0);
    return new Vector3((bb.minX + bb.maxX) / 2, 0, (bb.minZ + bb.maxZ) / 2);
  }

  /** Approximate track radius from the bounding box. */
  private trackRadius(): number {
    const bb = this.trackBounds();
    if (!bb) return 50;
    return Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ) / 2;
  }

  /** Bounding box of the track-root children (null when no track is built yet). */
  private trackBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    const root = this.scene.getTransformNodeByName("track-root");
    if (!root) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const child of root.getChildMeshes()) {
      const box = child.getBoundingInfo().boundingBox;
      if (box.minimumWorld.x < minX) minX = box.minimumWorld.x;
      if (box.maximumWorld.x > maxX) maxX = box.maximumWorld.x;
      if (box.minimumWorld.z < minZ) minZ = box.minimumWorld.z;
      if (box.maximumWorld.z > maxZ) maxZ = box.maximumWorld.z;
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Dispose skybox + lights + shadows + post stack (keeps prevFog* for restore). */
  private disposeEnvironment(): void {
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    }
    if (this.shadowGen) {
      this.shadowGen.dispose();
      this.shadowGen = null;
    }
    for (const light of this.accentLights) light.dispose();
    this.accentLights = [];
    this.sun?.dispose();
    this.hemi?.dispose();
    // Clear the IBL reference BEFORE disposing the cubemap so no PBR material is left
    // pointing at a disposed texture (would throw on next render).
    if (this.scene.environmentTexture === this.skyTex) {
      this.scene.environmentTexture = null;
    }
    this.skyTex?.dispose();
    this.skyMat?.dispose();
    this.skybox?.dispose();
    this.sun = null;
    this.hemi = null;
    this.skyTex = null;
    this.skyMat = null;
    this.skybox = null;
  }
}

function hexToColor3(hex: string): Color3 {
  const n = parseInt(hex.slice(1), 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
