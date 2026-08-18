/**
 * ChaseCamera — a UniversalCamera that follows a kart with speed-dependent framing
 * (05-phase-3-track-system.md, Task 6). All constants come from TUNING.camera.
 *
 * Each frame it computes dist/height/fov as lerps of `speedRatio`, places the camera
 * behind the kart along its heading at that height, and eases toward the target with
 * an exponential follow (frame-rate independent via 1 - exp(-smoothing*dt)).
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import { UniversalCamera, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { TUNING } from "../data/tuning.js";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class ChaseCamera {
  readonly camera: UniversalCamera;
  private readonly pos = new Vector3(); // smoothed position we ease toward the target
  private initialized = false;

  constructor(scene: Scene, initialPos: Vector3) {
    this.camera = new UniversalCamera("chase-camera", initialPos.clone(), scene);
    this.pos.copyFrom(initialPos);
    scene.activeCamera = this.camera;
  }

  /** Ease the camera toward a framing of the kart at `kartPos` facing `heading`. */
  update(kartPos: Vector3, heading: number, speedRatio: number, dt: number): void {
    const c = TUNING.camera;
    const dist = lerp(c.distMin, c.distMax, speedRatio);
    const height = lerp(c.heightMin, c.heightMax, speedRatio);
    const fov = lerp(c.fovMin, c.fovMax, speedRatio);

    // forward(heading) in XZ: heading 0 = +Z → (sin h, 0, cos h). Camera sits behind.
    // Height is RELATIVE to the kart's terrain Y so the framing holds on hills/cliffs.
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const targetX = kartPos.x - fx * dist;
    const targetY = kartPos.y + height;
    const targetZ = kartPos.z - fz * dist;

    if (!this.initialized) {
      this.pos.set(targetX, targetY, targetZ);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-c.smoothing * dt);
      this.pos.x += (targetX - this.pos.x) * k;
      this.pos.y += (targetY - this.pos.y) * k;
      this.pos.z += (targetZ - this.pos.z) * k;
    }

    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(new Vector3(kartPos.x, kartPos.y + 0.8, kartPos.z));
    this.camera.fov = fov;
  }

  dispose(): void {
    this.camera.dispose();
  }
}
