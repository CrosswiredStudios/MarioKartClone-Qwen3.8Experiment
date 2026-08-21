/**
 * Phase 3 free-drive scene (05-phase-3-track-system.md, Task 5).
 *
 * Given a TrackDefinition + RaceConfig: builds the track world, applies theme
 * fog/sky colors, spawns the player kart at t=0 plus 3 parked AI karts on the
 * grid, and steps the player's physics each fixed logic step. AI is static this
 * phase (IAiStrategy lands in Phase 4). Task 6 adds the KartRenderer visuals, the
 * speed-dependent ChaseCamera, and fading SkidMarks while drifting.
 *
 * This file MAY import Babylon (render layer). All simulation math stays in the
 * pure modules (TrackSpline, KartPhysics, DriftController, LapTracker).
 */

import type { Camera, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { RaceConfig } from "../core/RaceConfig.js";
import type { GameContext, IGameScreen, IDrivableScreen, DriveSnapshot } from "../core/GameStateMachine.js";
import { CHARACTER_ROSTER } from "../data/characters.js";
import { VEHICLE_ROSTER, combinedStats, steerEaseRateFor } from "../data/vehicles.js";
import type { VehicleType } from "../entities/vehicleModels.js";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../data/tracks/index.js";
import { TUNING } from "../data/tuning.js";
import { createKart, type KartEntity } from "../entities/KartEntity.js";
import { KartBody } from "../entities/KartBody.js";
import { PlayerController } from "../entities/PlayerController.js";
import { stepKart, type DriveInput, type SurfaceKind } from "../entities/KartPhysics.js";
import { updateDrift } from "../entities/DriftController.js";
import { KartRenderer } from "../entities/KartRenderer.js";
import { PropBuilder } from "../tracks/PropBuilder.js";
import { TrackBuilder } from "../tracks/TrackBuilder.js";
import type { HeightField } from "../tracks/TrackElevation.js";
import { TrackSpline } from "../tracks/TrackSpline.js";
import { ChaseCamera } from "./ChaseCamera.js";
import { SkidMarks } from "./SkidMarks.js";

/** Grid slots: [lateralOffset (m), longitudinal offset behind the line (m)]. */
const GRID_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [-2.5, 0], // slot 1 — player
  [2.5, -4], // slot 2
  [-2.5, -8], // slot 3
  [2.5, -12], // slot 4
];

export class FreeDriveScene implements IGameScreen, IDrivableScreen {
  readonly id = "Racing" as const;

  constructor(
    private readonly ctx: GameContext,
    private readonly raceConfig: RaceConfig,
  ) {}

  private track: TrackBuilder | null = null;
  /** Phase 6 — themed roadside props (density-scaled, torch lights at High). */
  private props: PropBuilder | null = null;
  private spline: TrackSpline | null = null;
  private player: KartEntity | null = null;
  /** Physics rewrite — the player's rigid body (null in headless / no-physics mode). */
  private playerBody: KartBody | null = null;
  private controller: PlayerController | null = null;
  private chaseCam: ChaseCamera | null = null;
  private playerRenderer: KartRenderer | null = null;
  private aiRenderers: KartRenderer[] = [];
  private skids: SkidMarks | null = null;
  private lastSurface: SurfaceKind = "road";
  private lastHintT: number | undefined;
  private lastInput: DriveInput | null = null; // cached from update() for onFrame render
  private clock = 0; // running seconds (fixed-step) — drives skid fade timestamps
  private leaving = false; // guard against re-emitting ui:navigate while held
  // Prior active camera, restored on exit so the menu/parked view is unaffected.
  // (Fog/clear-color restore moved to RenderPipelineSetup.exitMap() in Phase 6.)
  private prevActiveCamera: Camera | null = null;

  enter(_ctx: GameContext): void {
    const scene = this.ctx.scene as Scene;
    const def = this.raceConfig.mapId === LAGOON_TRACK.id ? LAGOON_TRACK : MEADOWS_TRACK;

    // Phase 6: the render pipeline owns skybox + lights + fog + post stack (opaque
    // handle on the context, null in headless tests → skipped). Idempotent per theme.
    this.ctx.renderPipeline?.applyTheme(def.theme);

    this.prevActiveCamera = (scene.activeCamera as Camera | null) ?? null;

    // Track world. widthOverrides must reach the spline so on-road detection
    // uses the narrowed half-width inside override spans (lagoon bridge).
    this.spline = new TrackSpline(def.controlPoints, def.roadWidth, TUNING.physics.onRoadMargin, undefined, def.widthOverrides);
    this.track = new TrackBuilder(scene, this.spline, def);
    this.track.build();

    // Physics rewrite — static terrain heightfield body (null physics world → skipped).
    this.ctx.physicsWorld?.buildTerrain(this.track.field);

    // Phase 6: themed props (density-scaled; torch lights at High). Parented under
    // track-root so the shadow-caster sweep sees them; null probe (headless) → skipped.
    if (this.ctx.qualityProbe) {
      this.props = new PropBuilder(scene, this.spline, def, this.track.field, this.ctx.qualityProbe, this.track.root);
      this.props.build();
    }

    // Karts: player in slot 1, the other three roster characters parked behind.
    const stats = combinedStats(this.raceConfig.characterId, this.raceConfig.vehicleId);
    const profile = {
      topSpeedStat: stats.topSpeed,
      accelStat: stats.accel,
      steerEaseRate: steerEaseRateFor(VEHICLE_ROSTER.find((v) => v.id === this.raceConfig.vehicleId)?.type ?? "kart"),
    };
    const me = CHARACTER_ROSTER.find((c) => c.id === this.raceConfig.characterId) ?? CHARACTER_ROSTER[0];

    this.player = createKart({
      id: "player",
      name: me.name,
      isPlayer: true,
      color: me.color,
      pos: gridPos(this.track.field, this.spline, GRID_SLOTS[0]),
      heading: gridHeading(this.spline, 0),
      profile,
    });

    // Physics rewrite — rigid body for the player kart (null physics world → kinematic).
    if (this.ctx.physicsWorld) {
      this.playerBody = new KartBody(scene, this.player, this.track.field);
      this.player.drive = this.playerBody;
    }

    // Player kart visual — vehicle type from the race config (parked AI karts
    // default to the neutral kart; they're static this phase).
    const playerVehicleType: VehicleType = VEHICLE_ROSTER.find((v) => v.id === this.raceConfig.vehicleId)?.type ?? "kart";
    this.playerRenderer = new KartRenderer(scene, me.color, "player-kart", playerVehicleType);

    // Parked AI karts + their visuals (static this phase; IAiStrategy lands in Phase 4).
    const others = CHARACTER_ROSTER.filter((c) => c.id !== this.raceConfig.characterId).slice(0, 3);
    for (let i = 0; i < others.length; i++) {
      const aiState = createKart({
        id: `ai-${i}`,
        name: others[i].name,
        isPlayer: false,
        color: others[i].color,
        pos: gridPos(this.track.field, this.spline, GRID_SLOTS[i + 1]),
        heading: gridHeading(this.spline, i + 1),
      });
      const r = new KartRenderer(scene, others[i].color, `ai-kart-${i}`);
      // Park them on the grid (static — no per-frame update this phase).
      r.update(aiState.state, { throttle: 0, steer: 0, drifting: false, useItem: false, itemHeld: false }, 0);
      this.aiRenderers.push(r);
    }

    // Phase 6: point the shadow generator at the freshly-built track + prop meshes AND
    // the kart roots (no-op when shadows are off). Runs on every enter so pause/resume
    // re-points it.
    const kartRoots = [this.playerRenderer.root, ...this.aiRenderers.map((r) => r.root)];
    this.ctx.renderPipeline?.refreshShadowCasters(kartRoots);

    // Skid marks + chase camera (Task 6). No attachControl — mouse must not fight the kart.
    this.skids = new SkidMarks(scene);
    const spawn = gridPos(this.track.field, this.spline, GRID_SLOTS[0]);
    this.chaseCam = new ChaseCamera(
      scene,
      // Initial camera height is relative to the spawn terrain Y (ChaseCamera.update adds kartPos.y).
      new Vector3(spawn.x - Math.sin(gridHeading(this.spline, 0)) * TUNING.camera.distMin, spawn.y + TUNING.camera.heightMin, spawn.z - Math.cos(gridHeading(this.spline, 0)) * TUNING.camera.distMin),
    );

    this.controller = new PlayerController(this.ctx.input);
  }

  update(dt: number): void {
    const player = this.player;
    const spline = this.spline;
    if (!player || !spline || !this.controller) return;

    // Esc returns to MapSelect (free-drive sub-mode). Guarded so a held key can't
    // re-emit across the exit boundary.
    if (!this.leaving && this.ctx.input.button("pause")) {
      this.leaving = true;
      this.ctx.eventBus.emit("ui:navigate", { to: "MapSelect" });
      return;
    }

    const input = this.controller!.read();
    this.lastInput = input; // cached so onFrame can drive cosmetic render from it
    this.clock += dt;

    // Surface detection via the spline's closest point (hinted for O(log n)).
    const cp = spline.closestPoint({ x: player.state.pos.x, z: player.state.pos.z }, this.lastHintT);
    this.lastHintT = cp.t;
    const surface: SurfaceKind = cp.onRoad ? "road" : "offRoad"; // oilSlick lands in Phase 5
    this.lastSurface = surface;

    // Drift charge (pure) — persist the wrapper on the kart.
    const drift = updateDrift(player.state.driftCharge, input, dt);
    player.state.driftCharge = drift.charge;
    if (drift.releasedBoost) {
      const boostSpeed = drift.releasedBoost === "super" ? TUNING.drift.superBoostSpeed : TUNING.drift.miniBoostSpeed;
      player.state.statusEffects.push({ kind: "boost", speed: boostSpeed, remaining: TUNING.drift.boostDuration });
    }

    // Physics step (pure) — terrain glues the kart to the surface + slope model.
    const field = this.track?.field;
    if (!field) return;

    // Physics rewrite — body owns position/vertical when attached: sync() reads its real
    // state in first, and the brain runs WITHOUT terrain (Havok replaces glue/slope).
    player.drive?.sync(player);
    // Air control: no steering/throttle while the tires are off the ground.
    const airborne =
      player.state.pos.y > field.heightAt(player.state.pos.x, player.state.pos.z) + TUNING.terrain.airborneEpsilon;
    const next = stepKart(player.state, input, surface, dt, 1, 1, player.drive ? undefined : field, airborne);
    player.state = next;
    player.drive?.apply(next, dt);
  }

  /** Called once per render frame by GameApp for camera/render updates. */
  onFrame(dt: number): void {
    const player = this.player;
    if (!player || !this.chaseCam) return;
    const s = player.state;
    const input = this.lastInput ?? { throttle: 0, steer: 0, drifting: false, useItem: false, itemHeld: false };

    // Drive the player kart visual from pure state (+ cosmetic steer/pitch + slope tilt).
    const terrain = this.track?.field;
    this.playerRenderer?.update(s, input, dt, terrain ?? undefined);

    // Skid marks: rear-wheel centerline world position while drifting.
    if (this.skids) {
      const h = s.heading;
      const sinH = Math.sin(h), cosH = Math.cos(h);
      // Rear axle is ~0.7 m behind the kart origin along -forward; left normal = (-cos, 0, sin).
      const field = this.track?.field;
      if (!field) return;
      const rearX = s.pos.x - sinH * 0.7;
      const rearZ = s.pos.z - cosH * 0.7;
      // Marks follow the terrain: sample the heightfield at the rear axle.
      const rearY = field.heightAt(rearX, rearZ);
      this.skids.update(rearX, rearY, rearZ, input.drifting && Math.abs(input.steer) > 0.3, this.clock);
    }

    // Chase camera: speed-dependent framing with exponential smoothing. Feed the
    // renderer's smoothed Y so the look-target doesn't shimmer with surface jitter.
    const camY = this.playerRenderer ? this.playerRenderer.renderedY : s.pos.y;
    this.chaseCam.update(new Vector3(s.pos.x, camY, s.pos.z), s.heading, s.speedRatio, dt);
  }

  driveSnapshot(): DriveSnapshot {
    const s = this.player?.state;
    return {
      kartPos: s ? { x: s.pos.x, y: s.pos.y, z: s.pos.z } : { x: 0, y: 0, z: 0 },
      speed: s?.speed ?? 0,
      surface: this.lastSurface,
      driftCharge: s?.driftCharge.tier ?? "none",
    };
  }

  exit(): void {
    this.leaving = false;
    const scene = this.ctx.scene as Scene;
    // Dispose the render objects we created (by reference).
    this.chaseCam?.dispose();
    this.playerRenderer?.dispose();
    for (const r of this.aiRenderers) r.dispose();
    this.skids?.dispose();
    this.chaseCam = null;
    this.playerRenderer = null;
    this.aiRenderers = [];
    this.skids = null;
    // Phase 6: the pipeline owns fog/clear-color restore (skybox stays as backdrop).
    this.ctx.renderPipeline?.exitMap();
    // We always installed the chase camera, so restore the parked one unconditionally.
    if (this.prevActiveCamera) scene.activeCamera = this.prevActiveCamera;
    // Props BEFORE track: TransformNode.dispose(true) does not recurse into children,
    // so prop instances/sources must be torn down explicitly first.
    // Physics rewrite — dispose the player's rigid body + static terrain (order: bodies
    // before the engine still lives; clearTerrain just drops the heightfield body).
    if (this.player) this.player.drive = null;
    this.playerBody?.dispose();
    this.playerBody = null;
    this.ctx.physicsWorld?.clearTerrain();

    this.props?.dispose();
    this.track?.dispose();
    this.props = null;
    this.player = null;
    this.spline = null;
  }
}

/** World position for a grid slot: lateral + longitudinal offsets from t=0, glued to the terrain. */
function gridPos(terrain: HeightField, spline: TrackSpline, [lateral, longitudinal]: readonly [number, number]): { x: number; y: number; z: number } {
  const p = spline.pointAt(0);
  const tan = spline.tangentAt(0);
  const nx = -tan.z; // left normal
  const nz = tan.x;
  // longitudinal is a "behind the line" offset (negative = further back), so it
  // scales the tangent directly: negative -> behind, zero -> on the line.
  const x = p.x + nx * lateral + tan.x * longitudinal;
  const z = p.z + nz * lateral + tan.z * longitudinal;
  return { x, y: terrain.heightAt(x, z), z };
}

/** Heading (radians) facing along the track at t=0. */
function gridHeading(spline: TrackSpline, _slot: number): number {
  const tan = spline.tangentAt(0);
  return Math.atan2(tan.x, tan.z);
}
