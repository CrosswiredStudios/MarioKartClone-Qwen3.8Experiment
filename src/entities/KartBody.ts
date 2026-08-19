/**
 * KartBody — one kart's rigid body in the Havok world (physics rewrite). Render-adjacent:
 * MAY import Babylon. The controller stays core/Babylon-free via IKartDrive (KartEntity.ts).
 *
 * HYBRID DRIVE MODEL (user-confirmed): stepKart remains the pure "brain" — it encodes every
 * TUNING curve and status effect and emits a target speed/heading each fixed step. This class
 * is the "muscle": it chases those targets on a real capsule body with BOUNDED authority, so
 * kart↔kart bumps perturb position/velocity for a visible moment (arcade "shoved" feel)
 * instead of being cancelled in one frame:
 *   - forward speed: clamped drive impulse along the heading axis (≤ maxDriveAccelMps2·m·dt);
 *     lateral velocity from impacts is NOT corrected — contact friction + linear damping scrub it.
 *   - yaw: direct angular-velocity write each step (X/Z zeroed → stable yaw-only rotation).
 *   - vertical: fully owned by Havok (gravity + terrain heightfield) — the brain runs with
 *     terrain=undefined so its slope/vertical glue stays out of the way.
 *
 * The body's TransformNode is an INVISIBLE anchor — KartRenderer keeps drawing from k.state,
 * which sync() refreshes from the node every fixed step (the plugin writes node transforms
 * back each physics step). No render coupling.
 */

import {
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsEventType,
  Quaternion,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { IPhysicsCollisionEvent } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core/scene.js";

import { TUNING } from "../data/tuning.js";
import type { KartEntity } from "./KartEntity.js";
import type { KartState } from "./KartPhysics.js";
import { driveImpulse, forwardVec, targetYawRate } from "./kartDriveMath.js";

export class KartBody {
  private readonly _body: PhysicsBody;
  private readonly _node: TransformNode;
  /** Heading read during the last sync() — the brain's pre-step reference for yaw rate. */
  private _syncedHeading = 0;
  /** Yaw rate written by the last apply() — kickYaw adds on top of it (no ±π wrap math). */
  private _lastAppliedYaw = 0;
  private _disposed = false;
  private readonly _tmpV3 = new Vector3();

  // ── Bump detection (kart↔kart collision events → shake/SFX) ────────────────
  /** Set by the scene (player body only): fires when this kart bumps another KART. */
  onBump: ((otherKartId: string, impulse: number) => void) | null = null;
  private _collisionObs: { remove(): void } | null = null;
  /** Logic-step clock advanced in apply() — the cooldown reference (frozen while paused). */
  private _bumpClock = 0;
  /** Last bump time per other-kart id (per-pair cooldown avoids event spam on grinding contact). */
  private readonly _lastBumpAt = new Map<string, number>();

  /** Node-name suffix identifying a kart body (vs. the terrain heightfield / props). */
  static readonly KARTBODY_SUFFIX = "-kartbody";

  constructor(scene: Scene, k: KartEntity) {
    const pw = TUNING.physicsWorld;

    // Invisible anchor at the spawn point. The capsule axis runs along local Z (the kart's
    // long axis) so head-on bumps read correctly; node Y sits centerHeightM above the
    // surface so the capsule starts just clear of the terrain (no initial penetration).
    this._node = new TransformNode(`${k.id}-kartbody`, scene);
    const p = k.state.pos;
    this._node.position.set(p.x, p.y + pw.centerHeightM, p.z);
    // Spawn yaw: heading 0 = +Z forward (same convention as KartRenderer's rotation.y).
    this._node.rotationQuaternion = Quaternion.FromEulerAngles(0, k.state.heading, 0);

    const body = new PhysicsBody(this._node, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape = new PhysicsShape(
      {
        type: PhysicsShapeType.CAPSULE,
        parameters: {
          pointA: new Vector3(0, 0, -pw.capsuleHalfLengthM),
          pointB: new Vector3(0, 0, pw.capsuleHalfLengthM),
          radius: pw.capsuleRadiusM,
        },
      },
      scene,
    );
    // Contact response for kart↔kart and kart↔terrain. Driving grip comes from the drive
    // impulse, not this friction value (which mostly scrubs lateral slide after bumps).
    body.shape.material = { friction: pw.kartFriction, restitution: pw.kartRestitution };

    const computed = body.computeMassProperties();
    body.setMassProperties({ ...computed, mass: pw.kartMassKg });
    body.setLinearDamping(pw.linearDamping);
    body.setAngularDamping(pw.angularDamping);

    this._body = body;
    this._syncedHeading = k.state.heading;

    // Bump detection: collision callbacks are OFF by default in v2 — enable, then watch.
    // The scene sets onBump only on the PLAYER's body (AI-vs-AI bumps need no feedback).
    body.setCollisionCallbackEnabled(true);
    this._collisionObs = body.getCollisionObservable().add((e: IPhysicsCollisionEvent) => {
      if (!this.onBump || e.type !== PhysicsEventType.COLLISION_STARTED) return;
      const otherName = e.collidedAgainst.transformNode.name;
      // Only kart↔kart counts — terrain/prop contacts are normal driving, not bumps.
      if (!otherName.endsWith(KartBody.KARTBODY_SUFFIX)) return;
      this._onCollision(e, otherName);
    });
  }

  /** Threshold + per-pair cooldown gate for a collision event (logic-step clock). */
  private _onCollision(e: IPhysicsCollisionEvent, otherNodeName: string): void {
    const pw = TUNING.physicsWorld;
    if (e.impulse < pw.bumpImpulseThreshold) return;
    const otherId = otherNodeName.slice(0, -KartBody.KARTBODY_SUFFIX.length);
    const last = this._lastBumpAt.get(otherId) ?? -Infinity;
    if (this._bumpClock - last < pw.bumpCooldownSec) return;
    this._lastBumpAt.set(otherId, this._bumpClock);
    this.onBump?.(otherId, e.impulse);
  }

  /** World-space forward unit vector from the node's current orientation. */
  private _worldForward(out: Vector3): Vector3 {
    // v9 API: transformFromQuaternion was renamed applyRotationQuaternionInPlace.
    const q = this._node.rotationQuaternion;
    if (q) return out.set(0, 0, 1).applyRotationQuaternionInPlace(q);
    // Fallback before the first plugin write-back: node still has spawn rotation.
    const h = this._syncedHeading;
    return out.set(Math.sin(h), 0, Math.cos(h));
  }

  /** Body → state BEFORE the brain step (IKartDrive.sync). */
  sync(k: KartEntity): void {
    if (this._disposed) return;
    const pw = TUNING.physicsWorld;
    const pos = this._node.position;
    const fwd = this._worldForward(this._tmpV3);
    const vel = this._body.getLinearVelocity();

    // state.pos.y is the SURFACE height (renderer convention): capsule center minus the
    // rest offset. At rest that equals terrain height exactly; mid-air it tracks the body.
    // Vec3 fields are readonly — replace the whole record (stepKart does the same).
    k.state.pos = { x: pos.x, y: pos.y - pw.centerHeightM, z: pos.z };
    k.state.vy = vel.y;
    // Forward speed can go negative if a bump shoves us backward — the brain clamps to
    // reverseMax, which is exactly the behavior we want.
    k.state.speed = vel.x * fwd.x + vel.z * fwd.z;
    this._syncedHeading = Math.atan2(fwd.x, fwd.z);
    k.state.heading = this._syncedHeading;
  }

  /** Brain target → body AFTER `k.state = next` (IKartDrive.apply). */
  apply(next: KartState, dt: number): void {
    if (this._disposed) return;
    this._bumpClock += dt; // logic-step clock for the per-pair bump cooldown
    const pw = TUNING.physicsWorld;
    const fwd = forwardVec(next.heading);

    // Current forward speed straight from the body (post-sync reality).
    const vel = this._body.getLinearVelocity();
    const curFwd = vel.x * fwd.x + vel.z * fwd.z;

    // Tire grip: scrub sideways slip so the body locks to its heading instead of
    // coasting on old momentum while turning (boat drift). Exponential decay at
    // lateralGripRate — bump-induced slide still shows for a few frames, then grips.
    const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
    const latMag2 = Math.max(0, speedSq - curFwd * curFwd); // |v − fwd·curFwd|² (XZ slip)
    if (latMag2 > 1e-6) {
      const keep = Math.exp(-pw.lateralGripRate * dt);
      // Lateral part only: lat = v − fwd·curFwd. Impulse Δv = (keep−1)·lat leaves the
      // forward component untouched and decays sideways slip exponentially.
      const latX = vel.x - fwd.x * curFwd;
      const latZ = vel.z - fwd.z * curFwd;
      this._body.applyImpulse(
        new Vector3((keep - 1) * pw.kartMassKg * latX, 0, (keep - 1) * pw.kartMassKg * latZ),
        this._node.position,
      );
    }

    // Boost/star/bulletBill: the brain SNAPS speed to its target this step (no accel
    // ramp), so the body gets full impulse authority too — items stay instantly punchy.
    // Everything else chases with bounded engine authority (bumps matter).
    const snapped = next.statusEffects.some((e) => e.kind === "bulletBill" || e.kind === "boost" || e.kind === "star");
    const impulseMag = snapped ? (next.speed - curFwd) * pw.kartMassKg : driveImpulse(curFwd, next.speed, pw.kartMassKg, dt);

    // Impulse through the center of mass → pure translation, no torque. World-space
    // location per the plugin's applyImpulse contract.
    if (impulseMag !== 0) {
      this._body.applyImpulse(
        new Vector3(fwd.x * impulseMag, 0, fwd.z * impulseMag),
        this._node.position,
      );
    }

    // Direct yaw authority: exactly the brain's Δheading/dt, X/Z zeroed so bump-induced
    // roll/pitch angular velocity is killed each step (stable arcade rotation).
    const yawRate = targetYawRate(this._syncedHeading, next.heading, dt);
    this._lastAppliedYaw = yawRate;
    this._body.setAngularVelocity(new Vector3(0, yawRate, 0));
  }

  /** Scale forward speed in place — e.g. shell hit ×hitSlowFactor (IKartDrive.scaleSpeed). */
  scaleSpeed(factor: number): void {
    if (this._disposed) return;
    const fwd = this._worldForward(this._tmpV3);
    const vel = this._body.getLinearVelocity();
    const curFwd = vel.x * fwd.x + vel.z * fwd.z;
    const impulseMag = (curFwd * factor - curFwd) * TUNING.physicsWorld.kartMassKg;
    if (impulseMag !== 0) {
      this._body.applyImpulse(
        new Vector3(fwd.x * impulseMag, 0, fwd.z * impulseMag),
        this._node.position,
      );
    }
  }

  /** Set forward speed directly — e.g. bullet-bill knockback (IKartDrive.setSpeed). */
  setSpeed(speed: number): void {
    if (this._disposed) return;
    const fwd = this._worldForward(this._tmpV3);
    const vel = this._body.getLinearVelocity();
    const curFwd = vel.x * fwd.x + vel.z * fwd.z;
    const impulseMag = (speed - curFwd) * TUNING.physicsWorld.kartMassKg;
    if (impulseMag !== 0) {
      this._body.applyImpulse(
        new Vector3(fwd.x * impulseMag, 0, fwd.z * impulseMag),
        this._node.position,
      );
    }
  }

  /**
   * One-frame yaw nudge (IKartDrive.kickYaw) — e.g. a shell hit's seeded heading kick.
   * Must be called AFTER apply() in the same step: it overwrites this step's angular
   * velocity with an extra Δheading/dt, and the next sync() reads the kicked heading back
   * into state (where the brain then continues from).
   */
  kickYaw(deltaRad: number, dt: number): void {
    if (this._disposed || dt <= 0) return;
    // Add on top of this step's applied yaw rate — no atan2 diff (±π wrap hazard).
    this._body.setAngularVelocity(new Vector3(0, this._lastAppliedYaw + deltaRad / dt, 0));
  }

  /** The body's world position (for collision-event bookkeeping). */
  get position(): Vector3 {
    return this._node.position;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Unsubscribe BEFORE disposing the body (dispose() also disables collision callbacks).
    this._collisionObs?.remove();
    this._collisionObs = null;
    this.onBump = null;
    // PhysicsBody.dispose() does NOT dispose its transform node — do both.
    this._body.dispose();
    this._node.dispose();
  }
}
