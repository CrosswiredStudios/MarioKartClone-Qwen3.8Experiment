/**
 * Phase 4 race render scene (06-phase-4-race-loop-and-ai.md, Step 3).
 *
 * A thin RENDER-LAYER screen for the "Racing" id. All simulation math lives in the
 * RaceController (pure, headless-testable); this scene only:
 *   - builds the track world + theme fog/lights (reusing Phase 3's TrackBuilder),
 *   - spawns one KartRenderer per kart and drives each from its live KartState,
 *   - follows the player with the ChaseCamera.
 * It NEVER steps physics — it reads `race.karts()[i].state` every frame, which the
 * controller mutates on the fixed logic clock (GameApp.update). This is the key
 * difference from Phase 3's FreeDriveScene, which stepped its own single player kart.
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import type { Camera ,
  Scene} from "@babylonjs/core";
import {
  Color3,
  MeshBuilder,
  PointLight,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  type Mesh,
} from "@babylonjs/core";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../data/tracks/index.js";
import { TUNING } from "../data/tuning.js";
import type { KartEntity } from "../entities/KartEntity.js";
import type { DriveInput } from "../entities/KartPhysics.js";
import { KartBody } from "../entities/KartBody.js";
import { KartRenderer } from "../entities/KartRenderer.js";
import { PropBuilder } from "../tracks/PropBuilder.js";
import { TrackBuilder } from "../tracks/TrackBuilder.js";
import { TrackSpline } from "../tracks/TrackSpline.js";
import { AI_VEHICLE_TABLE, type RaceController } from "../race/RaceController.js";
import { VEHICLE_ROSTER } from "../data/vehicles.js";
import type { VehicleType } from "../entities/vehicleModels.js";
import { ScreenShake } from "../vfx/ScreenShake.js";
import { ChaseCamera } from "./ChaseCamera.js";
import { ChargeIndicator } from "./ChargeIndicator.js";
import { ShellRenderer } from "./ShellRenderer.js";
import { countdownZoomEase, finishOutEase } from "./cameraEasing.js";

/** Spin rate (rad/s) for the item-box visuals. */
const ITEM_BOX_SPIN = 1.6;

/** Neutral input for cosmetic render (no steer/pitch) — motion comes purely from state. */
const NO_INPUT: DriveInput = Object.freeze({ throttle: 0, steer: 0, drifting: false, useItem: false, itemHeld: false });

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Component-wise Vector3 lerp into `out` (avoids per-frame allocations). */
function lerpVec(out: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number): void {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
}

/**
 * Phase 7 — camera framing mode for the race scene:
 *   - "countdown": wide grid view easing into the chase framing over the 3 s count (in-scene countdown).
 *   - "chase":     normal speed-dependent chase follow (+ shake).
 *   - "finishOut": high wide chase following the AI-driven player kart while the field finishes out.
 */
type RaceCamMode = "countdown" | "chase" | "finishOut";

// ── Phase 6 podium sequence (T16) ────────────────────────────────────────────
/** Podium box heights in meters for 1st / 2nd / 3rd. */
const PODIUM_HEIGHTS = [1.2, 0.9, 0.7] as const;
/** Box footprint (m). */
const PODIUM_BOX_W = 2.4;
const PODIUM_BOX_D = 2.4;
/** Seconds for the drive-up parade before karts step onto their boxes. */
const PODIUM_DRIVE_SEC = 1.6;
/** Seconds for the easeOutBack step-up bounce onto a box. */
const PODIUM_STEP_SEC = 0.4;
/** Seconds after the step-up begins before confetti + fanfare fire (lands mid-bounce). */
const PODIUM_TRIGGER_AT = PODIUM_DRIVE_SEC + 0.25;

/** easeOutCubic — smooth deceleration for the drive-up. */
function easeOutCubic(x: number): number {
  const c = 1 - x;
  return 1 - c * c * c;
}

/** easeOutBack — overshoots past 1 then settles, giving the step-up its bounce. */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** One kart's podium choreography (render-only — no simulation math). */
interface PodiumKart {
  renderer: KartRenderer;
  /** Drive start = the kart's real finish position (world XZ + smoothed Y). */
  fromX: number;
  fromZ: number;
  fromY: number;
  /** Drive end / step ground-start = stop point just short of its box. */
  startX: number;
  startZ: number;
  startY: number;
  /** Step end = on top of the podium box (kart rests here). */
  endX: number;
  endZ: number;
  endY: number;
  /** Heading to face while resting on the podium. */
  heading: number;
}

/** A spawned podium box mesh. */
interface PodiumBox {
  mesh: Mesh;
  topY: number;
}

export class RaceScene implements IGameScreen {
  readonly id = "Racing" as const;

  constructor(
    private readonly ctx: GameContext,
    private readonly race: RaceController,
  ) {}

  private track: TrackBuilder | null = null;
  /** Phase 6 — themed roadside props (density-scaled, torch lights at High). */
  private props: PropBuilder | null = null;
  private spline: TrackSpline | null = null;
  private renderers = new Map<string, KartRenderer>();
  /** Physics rewrite — one rigid body per kart (null physics world → empty map). */
  private bodies = new Map<string, KartBody>();
  private chaseCam: ChaseCamera | null = null;

  // ── Phase 7 camera modes (in-scene countdown + finish-out wide view) ─────────
  /** True while enter() has built the world — makes re-entry (Countdown → Racing) a no-op. */
  private entered = false;
  /** Current framing mode; initialized from race state on each real enter(). */
  private camMode: RaceCamMode = "countdown";
  /** Countdown wide-view camera position + look target, computed once per enter. */
  private readonly widePos = new Vector3();
  private readonly wideTarget = new Vector3();
  /** Seconds since the scene entered in countdown mode (drives the zoom ease). */
  private countdownClock = 0;
  /** Finish-out blend: camera pos/fov at the moment the player finished. */
  private finishFromPos: Vector3 | null = null;
  private finishFromFov: number = TUNING.camera.fovMin;
  /** Seconds since race:playerFinished (drives the wide-view ease). */
  private finishClock = 0;
  /** Exponential follower for the moving high-chase target in finish-out mode. */
  private finishSmoothed: Vector3 | null = null;

  // ── Phase 5 render VFX (Step 10) ────────────────────────────────────────
  /** Camera-shake envelope, driven by kart:hit / kart:boosted / item:used(lightning). */
  private readonly shake = new ScreenShake();
  /** Unsubscribers for per-kart hit-flash listeners — cleared on exit. */
  private unsubs: Array<() => void> = [];
  /** Spinning item-box visuals, one per spawner anchor (render-only; logic owns state). */
  private itemBoxMeshes: TransformNode[] = [];
  /** Phase 6 — glossy oil-slick discs at hazard placements (lagoon only; render mirrors logic). */
  private oilSlickMeshes: Mesh[] = [];
  /** Shared material for all slick discs (one dispose on exit). */
  private oilSlickMat: StandardMaterial | null = null;
  /** Phase 5.1 — shell projectile mesh pool (render mirrors logic-owned shells). */
  private shellRenderer: ShellRenderer | null = null;
  /** Phase 5.1 — "item loaded on kart" billboard while the player charges. */
  private chargeIndicator: ChargeIndicator | null = null;

  // ── Phase 6 podium sequence (T16) — render-only, driven from onFrame ───────
  /** True while the podium choreography is running (drive-up → step-up → settle). */
  private podiumActive = false;
  /** Elapsed seconds since beginPodium() started the sequence. */
  private podiumClock = 0;
  /** Confetti + fanfare fired exactly once at PODIUM_TRIGGER_AT. */
  private podiumTriggered = false;
  /** The top-3 karts' choreography, in rank order (index 0 = 1st place). */
  private podiumKarts: PodiumKart[] = [];
  /** Spawned podium boxes (gold/silver/bronze), disposed on exit. */
  private podiumBoxes: PodiumBox[] = [];
  /** P1 spotlight — only when the player won; disposed on exit. */
  private podiumSpotlight: PointLight | null = null;
  /** Dedicated podium camera framing the boxes; restored to chase cam on exit. */
  private podiumCamera: UniversalCamera | null = null;
  /** Fanfare trigger, fired once at PODIUM_TRIGGER_AT alongside the confetti burst. */
  private podiumFanfare: (() => void) | null = null;

  // Prior active camera, restored on exit so the menu/parked view is unaffected.
  // (Fog/clear-color restore moved to RenderPipelineSetup.exitMap() in Phase 6.)
  private prevActiveCamera: Camera | null = null;

  enter(_ctx: GameContext): void {
    // Phase 7 (in-scene countdown): the scene is registered at Countdown enter and
    // re-entered when the machine transitions Countdown → Racing. The world is built
    // exactly once; re-entry only refreshes fog + shadow casters.
    if (this.entered) {
      const def = this.race.config.mapId === LAGOON_TRACK.id ? LAGOON_TRACK : MEADOWS_TRACK;
      this.ctx.renderPipeline?.applyTheme(def.theme);
      this.ctx.renderPipeline?.refreshShadowCasters([...this.renderers.values()].map((r) => r.root));
      return;
    }
    this.entered = true;

    const scene = this.ctx.scene as Scene;
    const def = this.race.config.mapId === LAGOON_TRACK.id ? LAGOON_TRACK : MEADOWS_TRACK;

    // Phase 6: the render pipeline owns skybox + lights + fog + post stack. It's an
    // opaque handle on the context (null in headless tests → skipped). Idempotent per
    // theme object, so pause/resume re-entry only refreshes fog without rebuilding.
    this.ctx.renderPipeline?.applyTheme(def.theme);

    this.prevActiveCamera = (scene.activeCamera as Camera | null) ?? null;

    // Track world (same builder as free-drive). widthOverrides must reach the
    // spline so on-road detection uses the narrowed half-width inside spans.
    this.spline = new TrackSpline(def.controlPoints, def.roadWidth, TUNING.physics.onRoadMargin, undefined, def.widthOverrides);
    this.track = new TrackBuilder(scene, this.spline, def);
    this.track.build();

    // Physics rewrite — static terrain heightfield body (null physics world → skipped).
    this.ctx.physicsWorld?.buildTerrain(this.track.field);

    // Phase 6: themed props (trees/mushrooms/rocks/torches/…). Parented under track-root so
    // the shadow-caster sweep sees them; null quality probe (headless) → skipped.
    if (this.ctx.qualityProbe) {
      this.props = new PropBuilder(scene, this.spline, def, this.track.field, this.ctx.qualityProbe, this.track.root);
      this.props.build();
    }

    // One renderer per kart, driven from the controller's live state each frame.
    // Vehicle type: the player's comes from the race config; AI karts (id ===
    // characterId) come from the fixed AI vehicle table.
    const kartRoots: TransformNode[] = [];
    for (const k of this.race.karts()) {
      const vehicleId = k.isPlayer ? this.race.config.vehicleId : (AI_VEHICLE_TABLE[k.id] ?? "basher");
      const vehicleType: VehicleType = VEHICLE_ROSTER.find((v) => v.id === vehicleId)?.type ?? "kart";
      const r = new KartRenderer(scene, k.color, `${k.id}-kart`, vehicleType);
      kartRoots.push(r.root);
      this.renderers.set(k.id, r);

      // Physics rewrite — rigid body per kart (null physics world → kinematic fallback).
      if (this.ctx.physicsWorld) {
        const b = new KartBody(scene, k);
        k.drive = b;
        this.bodies.set(k.id, b);
        // Bump feedback is player-centric: only the player's body reports bumps.
        if (k.id === "player") {
          b.onBump = (otherKartId, impulse) =>
            this.ctx.eventBus.emit("kart:bumped", { kartId: k.id, otherKartId, impulse });
        }
      }
    }

    // Phase 6: point the shadow generator at the freshly-built track + prop meshes AND
    // the kart roots (pause/resume rebuilds them, so this runs on every enter — no-op
    // when shadows are off).
    this.ctx.renderPipeline?.refreshShadowCasters(kartRoots);

    // Phase 5.1 — shell projectiles + charge indicator (render-only mirrors).
    this.shellRenderer = new ShellRenderer(scene);
    this.chargeIndicator = new ChargeIndicator(scene);

    // Phase 5 Step 10 — VFX wiring (render layer only; the controller emits the events).
    // Hit flash: each renderer flashes its own body white on kart:hit for that kart.
    for (const k of this.race.karts()) {
      const r = this.renderers.get(k.id)!;
      this.unsubs.push(
        this.ctx.eventBus.on("kart:hit", (p) => {
          if (p.kartId === k.id) r.triggerHitFlash();
        }),
      );
    }
    // Camera shake on the player's own hit/boost/lightning events.
    this.shake.attach(this.ctx.eventBus);

    // Phase 6 — particle VFX: subscribe to kart:boosted / kart:hit / item:used(lightning).
    // Idempotent (re-attach detaches first), so pause/resume re-entry is safe.
    this.ctx.particleVfx?.attach(this.ctx.eventBus);

    // Spinning item-box visuals at each spawner anchor. The LOGIC owns box state; we
    // only mirror it: a box is visible while available (respawnAt === 0) and hidden on
    // its respawn cooldown. Y sits just above the road ribbon.
    const field = this.track.field;
    for (const box of this.race.itemBoxes()) {
      const node = new TransformNode(`itembox-${box.id}`, scene);
      node.position.set(box.pos.x, field.heightAt(box.pos.x, box.pos.z) + TUNING.terrain.roadYOffset + 0.55, box.pos.z);
      const cube = MeshBuilder.CreateBox(`itembox-cube-${box.id}`, { size: 0.7 }, scene);
      cube.parent = node;
      const mat = new StandardMaterial(`itembox-mat-${box.id}`, scene);
      mat.diffuseColor.set(1, 0.85, 0.2);
      mat.emissiveColor.set(0.35, 0.28, 0.05);
      cube.material = mat;
      this.itemBoxMeshes.push(node);
    }

    // Phase 6 (T15): oil slicks render as dark glossy discs at the SAME world positions the
    // logic uses (pointAt(t) + left-normal × lateralOffset), so a rendered slick is exactly
    // where gameplay triggers the skid. Sits just above the road ribbon to avoid z-fighting.
    const slickMat = new StandardMaterial("oil-slick-mat", scene);
    slickMat.diffuseColor.set(0.03, 0.03, 0.05); // near-black
    slickMat.specularColor.set(0.9, 0.9, 1.0); // high specular → glossy wet sheen
    slickMat.emissiveColor.set(0.04, 0.03, 0.08); // faint purple sheen (oil rainbow hint)
    this.oilSlickMat = slickMat;
    for (const h of def.hazards) {
      if (h.kind !== "oilSlick") continue;
      const p = this.spline.pointAt(h.t);
      const tan = this.spline.tangentAt(h.t);
      const nx = -tan.z; // left normal
      const nz = tan.x;
      const x = p.x + nx * h.lateralOffset;
      const z = p.z + nz * h.lateralOffset;
      const disc = MeshBuilder.CreateCylinder(`oil-slick-${h.t}`, { height: 0.02, diameter: h.size }, scene);
      disc.position.set(x, field.heightAt(x, z) + TUNING.terrain.roadYOffset + 0.015, z);
      disc.material = slickMat;
      this.oilSlickMeshes.push(disc);
    }

    // Chase camera on the player kart's spawn position + heading.
    const player = this.playerKart();
    if (player) {
      const s = player.state;
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      this.chaseCam = new ChaseCamera(
        scene,
        // Initial camera height is relative to the spawn terrain Y (ChaseCamera.update adds kartPos.y).
        new Vector3(
          s.pos.x - fx * TUNING.camera.distMin,
          s.pos.y + TUNING.camera.heightMin,
          s.pos.z - fz * TUNING.camera.distMin,
        ),
      );
    }

    // Phase 7 — camera mode subscriptions (per-enter, cleared on exit).
    this.unsubs.push(
      this.ctx.eventBus.on("race:start", () => {
        if (this.camMode === "countdown") {
          // Hand off to chase: seed the smoothed position at the current wide-view
          // camera pos so the follow eases in from on-screen instead of jumping.
          const camPos = this.chaseCam ? this.chaseCam.camera.position.clone() : null;
          if (this.chaseCam && camPos) this.chaseCam.snapTo(camPos);
          this.camMode = "chase";
        }
      }),
      this.ctx.eventBus.on("race:playerFinished", () => {
        if (this.camMode !== "finishOut") {
          // Capture the current framing as the blend start point.
          const camPos = this.chaseCam ? this.chaseCam.camera.position.clone() : null;
          this.finishFromPos = camPos ?? new Vector3();
          this.finishFromFov = this.chaseCam?.camera.fov ?? TUNING.camera.fovMin;
          this.finishClock = 0;
          this.finishSmoothed = null;
          this.camMode = "finishOut";
        }
      }),
    );

    // Phase 7 — initialize the camera mode from live race state (a re-built scene for a
    // new race always starts in countdown; the wide framing is computed below).
    if (this.race.phase === "countdown") {
      this.camMode = "countdown";
      this.countdownClock = 0;
      this.computeCountdownWideFraming();
    } else {
      // Defensive: scene entered mid-race (should not happen in the normal flow).
      this.camMode = this.race.isPlayerFinished ? "finishOut" : "chase";
      if (this.camMode === "finishOut") {
        const camPos = this.chaseCam?.camera.position.clone() ?? new Vector3();
        this.finishFromPos = camPos;
        this.finishFromFov = this.chaseCam?.camera.fov ?? TUNING.camera.fovMin;
        this.finishClock = 0;
      }
    }
  }

  /**
   * Phase 7 — compute the wide grid framing for the in-scene countdown: a camera far
   * enough back (and up) to see all four karts on the grid, behind the player's heading.
   */
  private computeCountdownWideFraming(): void {
    const player = this.playerKart();
    if (!player || !this.track) return;
    const s = player.state;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);

    // Bounding box of all karts (XZ + Y).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of this.race.karts()) {
      const p = k.state.pos;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const cy = (minY + maxY) / 2;

    // Distance needed to frame the grid at the wide fov: cover half-diagonal + margin.
    const halfDiag = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    const fov = TUNING.camera.countdownWideFov;
    const distForGrid = (halfDiag + 4) / Math.tan(fov / 2);
    const dist = Math.max(TUNING.camera.countdownMinDist, distForGrid);

    this.widePos.set(s.pos.x - fx * dist, cy + dist * 0.55, s.pos.z - fz * dist);
    this.wideTarget.set(cx, cy + 0.8, cz);
  }

  /** No physics here — the controller steps on the logic clock. (Esc→pause lands in Step 10.) */
  update(_dt: number): void {
    // Intentionally empty; see header.
  }

  /** Called once per render frame by GameApp for camera/render updates. */
  onFrame(dt: number): void {
    this.tick(dt);
  }

  /**
   * Phase 7 — one full scene frame (renderers + mode-driven camera + particle VFX).
   * Public so GameApp can drive it explicitly during the finish-out phase, when the
   * active screen is Results and onFrame no longer runs for this scene.
   */
  tick(dt: number): void {
    const terrain = this.track?.field;
    for (const k of this.race.karts()) {
      const r = this.renderers.get(k.id);
      if (r) r.update(k.state, NO_INPUT, dt, terrain ?? undefined);
    }

    // Phase 5.1 — mirror live shells + the player's charge indicator.
    this.shellRenderer?.update(this.race.shells());
    this.chargeIndicator?.update(this.race.karts(), dt);

    // Phase 7 — mode-driven camera.
    const player = this.playerKart();
    if (player && this.chaseCam) {
      const s = player.state;
      // Feed the renderer's smoothed Y so the look-target doesn't shimmer with jitter.
      const camY = this.renderers.get(player.id)?.renderedY ?? s.pos.y;
      const kartPos = new Vector3(s.pos.x, camY, s.pos.z);

      if (this.camMode === "countdown") {
        // Wide grid view easing into the chase framing over the 3 s count.
        this.countdownClock += dt;
        const e = countdownZoomEase(this.countdownClock / TUNING.race.countdownSeconds);
        const c = TUNING.camera;
        const dist = lerp(c.distMin, c.distMax, s.speedRatio);
        const height = lerp(c.heightMin, c.heightMax, s.speedRatio);
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        // Chase framing at the current (pre-start ≈ 0) speed — the zoom lands here.
        const chaseX = kartPos.x - fx * dist;
        const chaseY = kartPos.y + height;
        const chaseZ = kartPos.z - fz * dist;
        lerpVec(this.chaseCam.camera.position, this.widePos, { x: chaseX, y: chaseY, z: chaseZ }, e);
        // Look target blends from the grid center to just above the player.
        this.chaseCam.camera.setTarget(
          new Vector3(
            lerp(this.wideTarget.x, kartPos.x, e),
            lerp(this.wideTarget.y, kartPos.y + 0.8, e),
            lerp(this.wideTarget.z, kartPos.z, e),
          ),
        );
        this.chaseCam.camera.fov = lerp(c.countdownWideFov, c.fovMin, e);
      } else if (this.camMode === "chase") {
        this.chaseCam.update(kartPos, s.heading, s.speedRatio, dt);
        // Phase 5 Step 10 — camera shake: add the decaying-sine XZ offset in world space.
        const off = this.shake.offset(dt);
        if (off.x !== 0 || off.z !== 0) {
          this.chaseCam.camera.position.x += off.x;
          this.chaseCam.camera.position.z += off.z;
        }
      } else {
        // finishOut — high wide chase following the AI-driven player kart while the
        // field finishes out. Ease from the captured chase framing, then exponential
        // follow of the moving target (frame-rate independent). No shake in this mode.
        const f = TUNING.finishOut;
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        const targetX = kartPos.x - fx * f.camDist;
        const targetY = kartPos.y + f.camHeight;
        const targetZ = kartPos.z - fz * f.camDist;

        this.finishClock += dt;
        if (this.finishFromPos && this.finishClock < f.camEaseSec) {
          const e = finishOutEase(this.finishClock / f.camEaseSec);
          lerpVec(this.chaseCam.camera.position, this.finishFromPos, { x: targetX, y: targetY, z: targetZ }, e);
        } else {
          if (!this.finishSmoothed) this.finishSmoothed = this.chaseCam.camera.position.clone();
          const k = 1 - Math.exp(-TUNING.camera.smoothing * dt);
          lerpVec(this.finishSmoothed, this.finishSmoothed, { x: targetX, y: targetY, z: targetZ }, k);
          this.chaseCam.camera.position.copyFrom(this.finishSmoothed);
        }
        // FOV eases from the captured value to the wide finish-out fov over the same window.
        const fe = finishOutEase(Math.min(1, this.finishClock / f.camEaseSec));
        this.chaseCam.camera.fov = lerp(this.finishFromFov, f.fov, fe);
        // Look a bit ahead of the kart so the track ahead stays in frame.
        this.chaseCam.camera.setTarget(new Vector3(kartPos.x + fx * 6, kartPos.y + 0.8, kartPos.z + fz * 6));
      }
    }

    // Item-box visuals: spin while available, hide on the respawn cooldown. The logic
    // layer owns box state (item/respawnAt); we only mirror it for presentation.
    const boxes = this.race.itemBoxes();
    for (let i = 0; i < this.itemBoxMeshes.length && i < boxes.length; i++) {
      const node = this.itemBoxMeshes[i];
      const box = boxes[i];
      node.setEnabled(box.respawnAt === 0); // available → visible, cooldown → hidden
      if (node.isEnabled()) node.rotation.y += ITEM_BOX_SPIN * dt;    }

    // Phase 6 — particle VFX tick: hand the factory a plain-data snapshot per kart. The
    // scene computes offRoad from its spline and polls statusEffects for star/shrink so
    // the factory never touches KartEntity (08-phase-6 T5/T7). Null in headless tests.
    if (this.ctx.particleVfx && this.spline) {
      const views = this.race.karts().map((k) => {
        const s = k.state;
        return {
          id: k.id,
          pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
          heading: s.heading,
          speed: s.speed,
          offRoad: !this.spline!.closestPoint({ x: s.pos.x, z: s.pos.z }).onRoad,
          starred: s.statusEffects.some((e) => e.kind === "star"),
          shrunk: s.statusEffects.some((e) => e.kind === "shrink"),
        };
      });
      this.ctx.particleVfx.update(dt, views);
    }
  }

  exit(): void {
    const scene = this.ctx.scene as Scene;
    // Physics rewrite — detach + dispose every kart body, then drop the terrain.
    for (const k of this.race.karts()) k.drive = null;
    for (const b of this.bodies.values()) b.dispose();
    this.bodies.clear();
    this.ctx.physicsWorld?.clearTerrain();

    for (const r of this.renderers.values()) r.dispose();
    this.renderers.clear();
    // Phase 5 Step 10 — tear down VFX: detach shake listeners, drop hit-flash subs,
    // and dispose the item-box visuals.
    this.shake.detach();
    for (const off of this.unsubs) off();
    this.unsubs = [];
    for (const node of this.itemBoxMeshes) node.dispose(true);
    this.itemBoxMeshes = [];
    // Phase 6 — oil-slick discs + their shared material.
    for (const disc of this.oilSlickMeshes) disc.dispose();
    this.oilSlickMeshes = [];
    this.oilSlickMat?.dispose(false);
    this.oilSlickMat = null;
    // Phase 5.1 — shell pool + charge indicator.
    this.shellRenderer?.dispose();
    this.shellRenderer = null;
    this.chargeIndicator?.dispose();
    this.chargeIndicator = null;
    // Phase 6 — particle VFX teardown: dispose every live system, restore any shrunk kart
    // meshes, remove the lightning overlay. No systems leak across races.
    this.ctx.particleVfx?.disposeAll();
    // Phase 6: the pipeline owns fog/clear-color restore (skybox stays as backdrop).
    this.ctx.renderPipeline?.exitMap();
    this.chaseCam?.dispose();
    // Props BEFORE track: TransformNode.dispose(true) does not recurse into children, so
    // the prop instances/sources must be torn down explicitly first.
    this.props?.dispose();
    this.track?.dispose();
    this.props = null;
    this.chaseCam = null;
    this.track = null;
    this.spline = null;
    // Phase 7 — reset camera-mode state so a re-entered scene (next race) starts clean.
    this.entered = false;
    this.camMode = "countdown";
    this.countdownClock = 0;
    this.finishFromPos = null;
    this.finishFromFov = TUNING.camera.fovMin;
    this.finishClock = 0;
    this.finishSmoothed = null;
    if (this.prevActiveCamera) scene.activeCamera = this.prevActiveCamera;
  }

  /**
   * Phase 6 (T16): keep the race world alive across Racing → Results so the podium
   * sequence can animate over it. GameApp calls beginPodium() right before that
   * transition and endPodium() when leaving Results (race again / main menu).
   */
  keepWorldOnExit(to: string): boolean {
    return to === "Results";
  }

  /**
   * Phase 6 (T16) — start the podium sequence. Spawns the three boxes at the
   * finish line, choreographs the top-3 karts (drive-up → easeOutBack step-up),
   * and swaps in a dedicated framing camera. Confetti + fanfare fire once, mid-bounce.
   */
  beginPodium(standings: ReadonlyArray<{ id: string; rank: number }>, playFanfare: () => void): void {
    if (this.podiumActive || !this.track) return; // plays exactly once per race
    const scene = this.ctx.scene as Scene;

    // Anchor the podium at the finish line (t=0), oriented along the track tangent.
    const p0 = this.spline!.pointAt(0);
    const tan = this.spline!.tangentAt(0);
    const fx = Math.sin(Math.atan2(tan.x, tan.z)); // forward unit XZ
    const fz = Math.cos(Math.atan2(tan.x, tan.z));
    const rx = -fz; // right unit XZ (perpendicular)
    const rz = fx;
    const groundY = this.track.field.heightAt(p0.x, p0.z) + TUNING.terrain.roadYOffset;

    // Box layout: 1st center, 2nd left, 3rd right (standard podium).
    const slotX = [0, -PODIUM_BOX_W - 0.2, PODIUM_BOX_W + 0.2]; // by rank index 0/1/2
    this.podiumBoxes = [];
    for (let i = 0; i < 3; i++) {
      const h = PODIUM_HEIGHTS[i];
      const bx = p0.x + rx * slotX[i];
      const bz = p0.z + rz * slotX[i];
      const by = this.track.field.heightAt(bx, bz) + TUNING.terrain.roadYOffset;
      const mesh = MeshBuilder.CreateBox(`podium-box-${i}`, { width: PODIUM_BOX_W, height: h, depth: PODIUM_BOX_D }, scene);
      mesh.position.set(bx, by + h / 2, bz);
      const mat = new StandardMaterial(`podium-mat-${i}`, scene);
      // Gold / silver / bronze.
      if (i === 0) {
        mat.diffuseColor.set(0.85, 0.68, 0.2);
        mat.emissiveColor.set(0.18, 0.13, 0.03);
      } else if (i === 1) {
        mat.diffuseColor.set(0.72, 0.72, 0.75);
        mat.emissiveColor.set(0.1, 0.1, 0.11);
      } else {
        mat.diffuseColor.set(0.62, 0.4, 0.24);
        mat.emissiveColor.set(0.1, 0.05, 0.03);
      }
      mesh.material = mat;
      this.podiumBoxes.push({ mesh, topY: by + h });
    }

    // Choreograph the top-3 karts (rank order → box index). Each drives in a straight
    // from its real finish position to a stop point just short of its box (toward the
    // camera), then hops up onto the box with an easeOutBack bounce.
    const headingToPodium = Math.atan2(fx, fz); // face along the track forward while resting
    this.podiumKarts = [];
    for (const s of standings.slice(0, 3)) {
      const r = this.renderers.get(s.id);
      if (!r) continue;
      const boxIdx = s.rank - 1;
      const box = this.podiumBoxes[boxIdx];
      const bx = p0.x + rx * slotX[boxIdx];
      const bz = p0.z + rz * slotX[boxIdx];
      // Stop point: 2 m behind the box toward the camera (karts approach from that side).
      const stopX = bx - fx * 2.0;
      const stopZ = bz - fz * 2.0;
      this.podiumKarts.push({
        renderer: r,
        // Drive start = the kart's actual finish position (where it crossed the line).
        fromX: r.root.position.x,
        fromZ: r.root.position.z,
        fromY: r.renderedY,
        // Drive end / step ground-start = just short of the box.
        startX: stopX,
        startZ: stopZ,
        startY: this.track.field.heightAt(stopX, stopZ) + TUNING.terrain.roadYOffset,
        // Step end = on top of the box.
        endX: bx,
        endZ: bz,
        endY: box.topY,
        heading: headingToPodium,
      });
    }

    // P1 spotlight — only when the player won (warm point light above their kart).
    const winner = standings[0];
    if (winner && this.race.karts().some((k) => k.id === winner.id && k.isPlayer)) {
      const box = this.podiumBoxes[0];
      const bx = p0.x + rx * slotX[0];
      const bz = p0.z + rz * slotX[0];
      const light = new PointLight("podium-spotlight", new Vector3(bx, box.topY + 4, bz), scene);
      light.diffuse = new Color3(1, 0.85, 0.5);
      light.intensity = 0.9;
      light.range = 12;
      this.podiumSpotlight = light;
    }

    // Dedicated framing camera: on the approach side (behind the boxes along -forward),
    // elevated, looking at the podium center so we see karts drive up + hop onto their box.
    const camX = p0.x - fx * 9;
    const camZ = p0.z - fz * 9;
    const camY = groundY + 4.5;
    this.podiumCamera = new UniversalCamera("podium-camera", new Vector3(camX, camY, camZ), scene);
    this.podiumCamera.setTarget(new Vector3(p0.x, groundY + 1.2, p0.z));
    this.podiumCamera.fov = 0.9;
    scene.activeCamera = this.podiumCamera;

    // Store the fanfare trigger — it fires once at PODIUM_TRIGGER_AT (podiumTick), landing
    // with the confetti mid step-up bounce, not immediately on entry.
    this.podiumFanfare = playFanfare;
    this.podiumClock = 0;
    this.podiumTriggered = false;
    this.podiumActive = true;
  }

  /**
   * Phase 6 (T16) — per-frame podium choreography, driven by GameApp while in Results
   * (the race world is kept alive via keepWorldOnExit). Also ticks the particle factory
   * so the confetti one-shot self-disposes.
   */
  podiumTick(dt: number): void {
    if (!this.podiumActive) return;
    this.podiumClock += dt;

    // Confetti + fanfare fire exactly once, mid step-up bounce.
    if (!this.podiumTriggered && this.podiumClock >= PODIUM_TRIGGER_AT) {
      this.podiumTriggered = true;
      const box0 = this.podiumBoxes[0];
      if (box0) {
        this.ctx.particleVfx?.confetti({ x: box0.mesh.position.x, y: box0.topY + 1.5, z: box0.mesh.position.z });
      }
      this.podiumFanfare?.();
    }

    for (const pk of this.podiumKarts) {
      const t = this.podiumClock;
      if (t < PODIUM_DRIVE_SEC) {
        // Drive-up: ease in a straight line from the finish position to the stop point,
        // staying on the road surface. Faces along the travel direction.
        const e = easeOutCubic(t / PODIUM_DRIVE_SEC);
        const x = pk.fromX + (pk.startX - pk.fromX) * e;
        const z = pk.fromZ + (pk.startZ - pk.fromZ) * e;
        pk.renderer.root.position.set(x, this.terrainYAt(x, z), z);
        pk.renderer.root.rotation.y = Math.atan2(pk.startX - pk.fromX, pk.startZ - pk.fromZ);
      } else {
        // Step-up: hop from the stop point onto the box top. Y uses easeOutBack (the
        // visible bounce — overshoots then settles); XZ eases in so it lands centered.
        const raw = Math.min(1, (t - PODIUM_DRIVE_SEC) / PODIUM_STEP_SEC);
        const yE = easeOutBack(raw);
        const xzE = Math.min(1, raw); // clamp so the kart doesn't slide past box center
        const x = pk.startX + (pk.endX - pk.startX) * xzE;
        const z = pk.startZ + (pk.endZ - pk.startZ) * xzE;
        const y = pk.startY + (pk.endY - pk.startY) * yE;
        pk.renderer.root.position.set(x, y, z);
        pk.renderer.root.rotation.y = pk.heading;
      }
    }

    // Keep the particle factory clock advancing so confetti expires + self-disposes.
    this.ctx.particleVfx?.update(dt, []);
  }

  /** Terrain height (road level) at a world XZ — podium karts rest on the road surface. */
  private terrainYAt(x: number, z: number): number {
    return this.track ? this.track.field.heightAt(x, z) + TUNING.terrain.roadYOffset : 0;
  }

  /** Debug (window.__game.fieldHeightAt) — raw field ground truth at a world XZ. */
  debugFieldHeightAt(x: number, z: number): number {
    return this.track ? this.track.field.heightAt(x, z) : NaN;
  }

  /**
   * Phase 6 (T16) — tear down the podium sequence (boxes, spotlight, camera). Called by
   * GameApp when leaving Results ("race again" / main menu) so no meshes/lights leak.
   */
  endPodium(): void {
    if (!this.podiumActive && this.podiumBoxes.length === 0 && !this.podiumCamera) return;
    for (const b of this.podiumBoxes) {
      (b.mesh.material as StandardMaterial | null)?.dispose(false);
      b.mesh.dispose();
    }
    this.podiumBoxes = [];
    this.podiumSpotlight?.dispose();
    this.podiumSpotlight = null;
    if (this.podiumCamera) {
      const scene = this.ctx.scene as Scene;
      if (scene.activeCamera === this.podiumCamera && this.prevActiveCamera) {
        scene.activeCamera = this.prevActiveCamera;
      }
      this.podiumCamera.dispose();
      this.podiumCamera = null;
    }
    this.podiumKarts = [];
    this.podiumActive = false;
    this.podiumClock = 0;
    this.podiumTriggered = false;
  }

  private playerKart(): KartEntity | undefined {
    return this.race.karts().find((k) => k.isPlayer);
  }
}
