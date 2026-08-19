/**
 * KartRenderer — builds a stylized low-poly vehicle (kart / bike / ATV, see
 * vehicleModels.ts) and drives it each frame from pure physics state
 * (05-phase-3-track-system.md, Task 6).
 *
 * Wheels use a two-level pivot per wheel — an outer yaw node (front pair steers)
 * wrapping an inner spin node (rolls about the axle) — so steering and rolling
 * never fight over one Euler. The vehicle type comes from RaceConfig.vehicleId
 * (plumbed by the scenes); all three types share the same wheel layout so the
 * tire-based slope sampling below stays identical.
 *
 * AS-BUILT DEVIATION (documented): the doc's prose signature is `update(state)` but
 * it also requires "steer input" for front-wheel yaw and throttle-based body pitch,
 * neither of which lives on KartState. So update takes `(state, input, dt)`. This is
 * additive — the renderer still reads all motion from pure state; input only feeds
 * cosmetic steer/pitch.
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import { MeshBuilder, StandardMaterial, TransformNode, type Mesh, type PBRMaterial, type Scene } from "@babylonjs/core";
import type { DriveInput, KartState, TerrainSampler } from "./KartPhysics.js";
import { buildVehicleModel, type VehicleType } from "./vehicleModels.js";

/** Wheel radius in meters — matches the 0.7-diameter cylinders below. */
const WHEEL_RADIUS = 0.35;
/** Body pitch targets (radians): nose-down under throttle, nose-up braking. */
const PITCH_THROTTLE = -0.06;
const PITCH_BRAKE = 0.04;
/** How fast body pitch eases toward its target (per second). */
const PITCH_LERP_RATE = 8;
/** Max front-wheel yaw (radians) at full steer. */
const FRONT_YAW_MAX = 0.45;
/** How fast the front wheels ease toward their steer target (per second). Snappier
 * than pitch so steering feels responsive but not teleporty. */
const YAW_LERP_RATE = 12;
/** Front-to-rear tire spacing (m) — used to derive slope pitch from tire heights. */
const WHEELBASE = 1.4;
/** Left-to-right tire spacing (m) — used to derive slope roll from tire heights. */
const TRACK_WIDTH = 1.7;
/** Vertical position smoothing rate (per second): kills surface-sample jitter while
 * converging on the true height, so karts don't shimmer on bumpy terrain. */
const Y_SMOOTH_RATE = 14;
/** How fast the kart eases its slope tilt toward the tire-derived target (per second). */
const SLOPE_LERP_RATE = 10;
/** Hit-flash duration (s): body emissive decays white → black after a shell/bullet hit. */
const HIT_FLASH_SEC = 0.3;
/** Tire sample points in kart-local space (z+ forward, x+ right) — matches wheel layout. */
const TIRES: ReadonlyArray<{ x: number; z: number }> = [
  { x: -0.85, z: 0.7 }, // front-left
  { x: 0.85, z: 0.7 }, // front-right
  { x: -0.85, z: -0.7 }, // rear-left
  { x: 0.85, z: -0.7 }, // rear-right
];

export class KartRenderer {
  /** World-space root — position/rotation are set from KartState each frame. */
  readonly root: TransformNode;

  private readonly chassis: TransformNode; // pitches with throttle
  private readonly bodyMat: PBRMaterial;
  private readonly wheelYawNodes: TransformNode[] = [];
  private readonly wheelSpinNodes: TransformNode[] = [];
  private pitch = 0;
  private frontYaw = 0;
  private starOn = false;
  private starClock = 0;
  /** Throttle-driven exhaust flame (cone at the exhaust anchor). */
  private readonly exhaustFlame: Mesh;
  private readonly exhaustMat: StandardMaterial;
  private exhaustClock = 0;
  /** Hit-flash remaining seconds (Phase 5): body emissive white → black over HIT_FLASH_SEC. */
  private hitFlashRemaining = 0;
  /** Slope orientation (pitch/roll from tire heights) between root and body/wheels. */
  private readonly tilt: TransformNode;
  /** Smoothed vertical position — kills surface-sample jitter while staying correct. */
  private renderY = 0;
  private yInit = false;
  private slopePitch = 0;
  private slopeRoll = 0;

  constructor(scene: Scene, color: [number, number, number], name = "kart", vehicleType: VehicleType = "kart") {
    this.root = new TransformNode(`${name}-root`, scene);

    // Tilt node carries the slope orientation (pitch/roll from tire heights). It sits
    // between root (position+yaw) and everything else so the WHOLE kart — body AND
    // wheels — aligns with the terrain instead of floating flat on hills.
    this.tilt = new TransformNode(`${name}-tilt`);
    this.tilt.parent = this.root;

    // Per-type model (kart / bike / ATV) — chassis is the pitch unit, wheels carry
    // the two-level yaw/spin pivots driven in update().
    const model = buildVehicleModel(scene, vehicleType, color, name);
    this.chassis = model.chassis;
    this.chassis.parent = this.tilt;
    this.bodyMat = model.bodyMat;
    for (const w of model.wheels) {
      w.yaw.parent = this.tilt;
      this.wheelYawNodes.push(w.yaw);
      this.wheelSpinNodes.push(w.spin);
    }

    // Throttle-driven exhaust flame: a small cone at the exhaust anchor, pointing
    // rearward (−z). Scale/visibility are driven in update() from input.throttle.
    // (Boost-event flames are owned by ParticleFactory — this is the idle flame.)
    this.exhaustMat = new StandardMaterial(`${name}-exhaustmat`, scene);
    this.exhaustMat.diffuseColor.set(1, 0.55, 0.1);
    this.exhaustMat.emissiveColor.set(1, 0.5, 0.05);
    this.exhaustMat.disableLighting = true;
    // No CreateCone in this Babylon version — a cylinder with diameterTop=0 IS a cone.
    this.exhaustFlame = MeshBuilder.CreateCylinder(`${name}-exhaustflame`, { diameterTop: 0, diameterBottom: 0.16, height: 0.45, tessellation: 8 }, scene);
    this.exhaustFlame.parent = model.exhaustAnchor;
    this.exhaustFlame.rotation.x = -Math.PI / 2; // cone tip (default +y) points rearward (−z)
    this.exhaustFlame.position.z = -0.22; // extend the flame out behind the anchor
    this.exhaustFlame.material = this.exhaustMat;
    this.exhaustFlame.isVisible = false;
  }

  /**
   * Drive the kart from pure state. `input` feeds only cosmetic steer (front-wheel
   * yaw) and body pitch — all position/heading/speed come from `state`.
   */
  update(state: KartState, input: DriveInput, dt: number, terrain?: TerrainSampler): void {
    const p = state.pos;

    // Smooth vertical position to kill surface-sample jitter (X/Z stay exact — they're
    // continuous from integration). Converges on the true height so it stays correct.
    if (!this.yInit) { this.renderY = p.y; this.yInit = true; }
    else this.renderY += (p.y - this.renderY) * Math.min(1, dt * Y_SMOOTH_RATE);
    this.root.position.set(p.x, this.renderY, p.z);
    this.root.rotation.y = state.heading;

    // Tire-based slope orientation: sample the terrain under each tire and tilt the
    // whole kart to match — nose follows climbs/drops, body leans into banked corners.
    let targetPitch = 0;
    let targetRoll = 0;
    if (terrain) {
      const h = state.heading;
      const sinH = Math.sin(h);
      const cosH = Math.cos(h);
      // right_world=(cosH,-sinH), forward_world=(sinH,cosH) → local→world XZ.
      const wx = (lx: number, lz: number): number => p.x + lx * cosH + lz * sinH;
      const wz = (lx: number, lz: number): number => p.z - lx * sinH + lz * cosH;
      const hFL = terrain.heightAt(wx(TIRES[0].x, TIRES[0].z), wz(TIRES[0].x, TIRES[0].z));
      const hFR = terrain.heightAt(wx(TIRES[1].x, TIRES[1].z), wz(TIRES[1].x, TIRES[1].z));
      const hRL = terrain.heightAt(wx(TIRES[2].x, TIRES[2].z), wz(TIRES[2].x, TIRES[2].z));
      const hRR = terrain.heightAt(wx(TIRES[3].x, TIRES[3].z), wz(TIRES[3].x, TIRES[3].z));
      const hFront = (hFL + hFR) / 2;
      const hRear = (hRL + hRR) / 2;
      const hLeft = (hFL + hRL) / 2;
      const hRight = (hFR + hRR) / 2;
      targetPitch = Math.atan2(hRear - hFront, WHEELBASE); // <0 → nose up when front is higher
      targetRoll = Math.atan2(hRight - hLeft, TRACK_WIDTH); // >0 → right side up when right is higher
    }
    this.slopePitch += (targetPitch - this.slopePitch) * Math.min(1, dt * SLOPE_LERP_RATE);
    this.slopeRoll += (targetRoll - this.slopeRoll) * Math.min(1, dt * SLOPE_LERP_RATE);
    this.tilt.rotation.x = this.slopePitch;
    this.tilt.rotation.z = this.slopeRoll;

    // Wheel roll about the axle (spin node), scaled by real speed.
    const spinDelta = (state.speed * dt) / WHEEL_RADIUS;
    for (const s of this.wheelSpinNodes) s.rotation.x += spinDelta;

    // Front pair yaws with steer for feel (rear stays straight), eased so the
    // wheels turn gradually rather than snapping to the target.
    const targetFrontYaw = input.steer * FRONT_YAW_MAX;
    this.frontYaw += (targetFrontYaw - this.frontYaw) * Math.min(1, dt * YAW_LERP_RATE);
    this.wheelYawNodes[0].rotation.y = this.frontYaw;
    this.wheelYawNodes[1].rotation.y = this.frontYaw;

    // Body pitch: nose-down under throttle, nose-up braking, eased toward target.
    let bodyTargetPitch = 0;
    if (input.throttle > 0.5) bodyTargetPitch = PITCH_THROTTLE;
    else if (input.throttle < -0.1) bodyTargetPitch = PITCH_BRAKE;
    this.pitch += (bodyTargetPitch - this.pitch) * Math.min(1, dt * PITCH_LERP_RATE);
    this.chassis.rotation.x = this.pitch;

    // Exhaust flame: visible while accelerating, length flickers with a fast sine.
    // A star boost (shroom) makes it longer and hotter.
    const accelerating = input.throttle > 0.5;
    this.exhaustFlame.isVisible = accelerating;
    if (accelerating) {
      this.exhaustClock += dt;
      const flicker = 0.8 + 0.25 * Math.sin(this.exhaustClock * 30);
      const boostScale = this.starOn ? 1.8 : 1;
      this.exhaustFlame.scaling.set(1, flicker * boostScale, 1);
      this.exhaustMat.emissiveColor.set(1, this.starOn ? 0.75 : 0.5, this.starOn ? 0.3 : 0.05);
    }

    // Emissive: hit-flash (Phase 5) takes priority over the star flicker placeholder.
    if (this.hitFlashRemaining > 0) {
      this.hitFlashRemaining = Math.max(0, this.hitFlashRemaining - dt);
      const f = this.hitFlashRemaining / HIT_FLASH_SEC; // 1 → 0 linear decay
      this.bodyMat.emissiveColor.set(f, f, f);
    } else if (this.starOn) {
      this.starClock += dt;
      const f = 0.5 + 0.5 * Math.sin(this.starClock * 24);
      this.bodyMat.emissiveColor.set(0.9 * f, 0.8 * f, 0.1 * f);
    } else if (this.bodyMat.emissiveColor.r !== 0 || this.bodyMat.emissiveColor.g !== 0) {
      this.bodyMat.emissiveColor.set(0, 0, 0);
    }
  }

  /** Phase 5 hit-flash hook: flash the body white and decay over ~0.3 s in update(). */
  triggerHitFlash(): void {
    this.hitFlashRemaining = HIT_FLASH_SEC;
  }

  /** Current smoothed vertical position — scenes feed this to the chase camera so its
   * look-target doesn't shimmer with raw surface-sample jitter. */
  get renderedY(): number {
    return this.renderY;
  }

  /** Toggle the star emissive flicker on the body material (Phase 6 replaces with VFX). */
  setStarFlicker(on: boolean): void {
    this.starOn = on;
    if (!on) this.bodyMat.emissiveColor.set(0, 0, 0);
  }

  dispose(): void {
    this.root.dispose(true);
  }
}
