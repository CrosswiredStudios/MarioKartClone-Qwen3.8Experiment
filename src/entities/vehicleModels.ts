/**
 * vehicleModels — procedural per-type vehicle builders (kart / bike / ATV).
 *
 * Replaces KartRenderer's single box-and-cylinders kart with three visually
 * distinct stylized low-poly models, all built from Babylon primitives (no
 * asset files — consistent with the project's procedural-only convention).
 *
 * Coordinate convention (matches KartRenderer): z+ is forward, x+ is right,
 * y+ is up. The returned `chassis` TransformNode is the pitch unit (body +
 * seat + lights + exhaust); the returned `wheels` carry the two-level pivot
 * per wheel (yaw node steers the front pair, spin node rolls about the axle)
 * that KartRenderer.update() drives each frame.
 *
 * MeshBuilder requires a Scene as the parent arg — every mesh is created in
 * the scene then reparented (same pattern as the original KartRenderer).
 *
 * This file MAY import Babylon (render layer). No simulation math here.
 */

import { Color3, MeshBuilder, TransformNode, type PBRMaterial, type Scene } from "@babylonjs/core";
import {
  createMatteMaterial,
  createMetalMaterial,
  createPaintMaterial,
  createRubberMaterial,
} from "../rendering/materials.js";
import type { VehicleDef } from "../data/vehicles.js";

export type VehicleType = VehicleDef["type"];

/** One wheel's animation pivots: `yaw` (front-pair steering) wraps `spin` (rolling). */
export interface WheelNodes {
  readonly yaw: TransformNode;
  readonly spin: TransformNode;
}

export interface VehicleModel {
  /** Pitch unit — KartRenderer sets chassis.rotation.x for throttle/brake pitch. */
  readonly chassis: TransformNode;
  /** Body PBR material — hit-flash and star flicker drive emissiveColor. */
  readonly bodyMat: PBRMaterial;
  /** Four wheels in fixed order: front-left, front-right, rear-left, rear-right. */
  readonly wheels: WheelNodes[];
  /** Exhaust anchor (chassis-local) — the flame cone is parented here. */
  readonly exhaustAnchor: TransformNode;
}

/** Wheel layout in kart-local space (z+ forward) — MUST match KartRenderer.TIRES
 * so the tire-based slope sampling stays correct. Front pair = positive z. */
const WHEEL_POS: ReadonlyArray<{ x: number; z: number; front: boolean }> = [
  { x: -0.85, z: 0.7, front: true }, // front-left
  { x: 0.85, z: 0.7, front: true }, // front-right
  { x: -0.85, z: -0.7, front: false }, // rear-left
  { x: 0.85, z: -0.7, front: false }, // rear-right
];

/** Per-type wheel visuals: tire radius (diameter = 2r) and tire width. */
const WHEEL_SPECS: Record<VehicleType, { front: { r: number; w: number }; rear: { r: number; w: number } }> = {
  kart: { front: { r: 0.35, w: 0.26 }, rear: { r: 0.35, w: 0.3 } },
  bike: { front: { r: 0.3, w: 0.16 }, rear: { r: 0.35, w: 0.24 } },
  atv: { front: { r: 0.42, w: 0.4 }, rear: { r: 0.42, w: 0.4 } },
};

/**
 * Per-vehicle PBR materials (shared across that vehicle's meshes). All are
 * assigned to meshes under the vehicle root, so KartRenderer's
 * `root.dispose(true)` disposes them with it.
 */
interface SharedMats {
  tire: PBRMaterial;
  rim: PBRMaterial;
  dark: PBRMaterial;
  headlight: PBRMaterial;
  taillight: PBRMaterial;
}

function makeSharedMats(scene: Scene, name: string): SharedMats {
  const tire = createRubberMaterial(scene, `${name}-tiremat`);
  const rim = createMetalMaterial(scene, `${name}-rimmat`);
  const dark = createMatteMaterial(scene, `${name}-darkmat`, new Color3(0.15, 0.15, 0.2));
  // Lights stay emissive — PBR's emissiveColor is additive on top of the lit
  // surface, so they still glow while picking up IBL on their unlit parts.
  const headlight = createMatteMaterial(scene, `${name}-headlightmat`, new Color3(0.9, 0.9, 0.85), {
    roughness: 0.4,
    emissive: new Color3(0.85, 0.85, 0.7),
  });
  const taillight = createMatteMaterial(scene, `${name}-taillightmat`, new Color3(0.5, 0.08, 0.05), {
    roughness: 0.4,
    emissive: new Color3(0.9, 0.12, 0.08),
  });
  return { tire, rim, dark, headlight, taillight };
}

/**
 * Build one wheel: torus tire + cylinder rim + small hub, inside the two-level
 * pivot. Cylinder axis is Y by default; tipping z by 90° puts the axle along X
 * (a rolling wheel). The torus lies in the XY plane by default (hole along Z),
 * so the same tip rolls it about X.
 */
function buildWheel(
  scene: Scene,
  name: string,
  idx: number,
  pos: { x: number; z: number; front: boolean },
  spec: { r: number; w: number },
  mats: SharedMats,
): WheelNodes {
  const yaw = new TransformNode(`${name}-wyaw-${idx}`);
  yaw.position.set(pos.x, spec.r, pos.z);
  const spin = new TransformNode(`${name}-wspin-${idx}`);
  spin.parent = yaw;

  const tire = MeshBuilder.CreateTorus(`${name}-wheel-${idx}`, { diameter: spec.r * 2, thickness: spec.w, tessellation: 16 }, scene);
  tire.parent = spin;
  tire.rotation.z = Math.PI / 2;
  tire.material = mats.tire;

  const rim = MeshBuilder.CreateCylinder(`${name}-rim-${idx}`, { diameter: spec.r * 1.1, height: spec.w * 0.55 }, scene);
  rim.parent = spin;
  rim.rotation.z = Math.PI / 2;
  rim.material = mats.rim;

  const hub = MeshBuilder.CreateCylinder(`${name}-hub-${idx}`, { diameter: spec.r * 0.4, height: spec.w * 0.7 }, scene);
  hub.parent = spin;
  hub.rotation.z = Math.PI / 2;
  hub.material = mats.dark;

  return { yaw, spin };
}

/** Emissive headlight strip (front) + taillight strip (rear), parented to chassis. */
function buildLightStrips(scene: Scene, name: string, chassis: TransformNode, mats: SharedMats, width: number): void {
  const head = MeshBuilder.CreateBox(`${name}-headlights`, { width, height: 0.09, depth: 0.06 }, scene);
  head.parent = chassis;
  head.position.set(0, 0.52, 1.06);
  head.material = mats.headlight;

  const tail = MeshBuilder.CreateBox(`${name}-taillights`, { width, height: 0.09, depth: 0.06 }, scene);
  tail.parent = chassis;
  tail.position.set(0, 0.52, -1.08);
  tail.material = mats.taillight;
}

/** Exhaust pipe (chassis-local) + the anchor node the flame cone parents to. */
function buildExhaust(scene: Scene, name: string, chassis: TransformNode, mats: SharedMats, x: number): TransformNode {
  const pipe = MeshBuilder.CreateCylinder(`${name}-exhaust`, { diameter: 0.12, height: 0.3 }, scene);
  pipe.parent = chassis;
  pipe.position.set(x, 0.34, -1.05);
  pipe.rotation.x = Math.PI / 2; // axis along Z (points rearward)
  pipe.material = mats.dark;

  const anchor = new TransformNode(`${name}-exhaust-anchor`);
  anchor.parent = chassis;
  anchor.position.set(x, 0.34, -1.2);
  return anchor;
}

// ── Kart ────────────────────────────────────────────────────────────────────

function buildKart(scene: Scene, name: string, color: [number, number, number], mats: SharedMats): VehicleModel {
  const chassis = new TransformNode(`${name}-chassis`);

  // Glossy paint with clearcoat — KartRenderer still drives bodyMat.emissiveColor
  // for hit-flash / star flicker (PBR emissive is additive, so that keeps working).
  const bodyMat = createPaintMaterial(scene, `${name}-bodymat`, color);

  const body = MeshBuilder.CreateBox(`${name}-body`, { width: 1.4, height: 0.5, depth: 2.2 }, scene);
  body.parent = chassis;
  body.position.y = 0.6;
  body.material = bodyMat;

  // Tapered nose: a scaled box in front of the main body.
  const nose = MeshBuilder.CreateBox(`${name}-nose`, { width: 1.0, height: 0.34, depth: 0.5 }, scene);
  nose.parent = chassis;
  nose.position.set(0, 0.5, 1.25);
  nose.scaling.set(1, 1, 0.7);
  nose.material = bodyMat;

  // Front bumper bar.
  const bumper = MeshBuilder.CreateBox(`${name}-bumper`, { width: 1.5, height: 0.14, depth: 0.12 }, scene);
  bumper.parent = chassis;
  bumper.position.set(0, 0.38, 1.42);
  bumper.material = mats.dark;

  // Side pods (intake bulges).
  for (const side of [-1, 1]) {
    const pod = MeshBuilder.CreateBox(`${name}-pod-${side > 0 ? "r" : "l"}`, { width: 0.22, height: 0.3, depth: 1.1 }, scene);
    pod.parent = chassis;
    pod.position.set(side * 0.78, 0.55, 0.1);
    pod.material = bodyMat;
  }

  // Seat + backrest.
  const seat = MeshBuilder.CreateBox(`${name}-seat`, { width: 0.8, height: 0.35, depth: 0.9 }, scene);
  seat.parent = chassis;
  seat.position.set(0, 0.95, -0.25);
  seat.material = mats.dark;
  const backrest = MeshBuilder.CreateBox(`${name}-backrest`, { width: 0.8, height: 0.5, depth: 0.14 }, scene);
  backrest.parent = chassis;
  backrest.position.set(0, 1.25, -0.62);
  backrest.material = mats.dark;

  // Roll hoop behind the seat.
  const hoop = MeshBuilder.CreateTorus(`${name}-hoop`, { diameter: 0.9, thickness: 0.07, tessellation: 16 }, scene);
  hoop.parent = chassis;
  hoop.position.set(0, 1.0, -0.62);
  hoop.material = mats.dark;

  buildLightStrips(scene, name, chassis, mats, 1.1);
  const exhaustAnchor = buildExhaust(scene, name, chassis, mats, 0.35);

  const wheels = WHEEL_POS.map((pos, i) =>
    buildWheel(scene, name, i, pos, WHEEL_SPECS.kart[pos.front ? "front" : "rear"], mats),
  );
  return { chassis, bodyMat, wheels, exhaustAnchor };
}

// ── Bike ────────────────────────────────────────────────────────────────────

function buildBike(scene: Scene, name: string, color: [number, number, number], mats: SharedMats): VehicleModel {
  const chassis = new TransformNode(`${name}-chassis`);

  const bodyMat = createPaintMaterial(scene, `${name}-bodymat`, color);

  // Slim frame spine.
  const frame = MeshBuilder.CreateBox(`${name}-frame`, { width: 0.3, height: 0.22, depth: 1.7 }, scene);
  frame.parent = chassis;
  frame.position.set(0, 0.62, 0.1);
  frame.material = bodyMat;

  // Fuel tank.
  const tank = MeshBuilder.CreateBox(`${name}-tank`, { width: 0.5, height: 0.3, depth: 0.7 }, scene);
  tank.parent = chassis;
  tank.position.set(0, 0.85, 0.35);
  tank.material = bodyMat;

  // Handlebar + grips.
  const bar = MeshBuilder.CreateCylinder(`${name}-handlebar`, { diameter: 0.06, height: 0.7 }, scene);
  bar.parent = chassis;
  bar.position.set(0, 1.05, 0.75);
  bar.rotation.z = Math.PI / 2; // axis along X
  bar.material = mats.dark;
  for (const side of [-1, 1]) {
    const grip = MeshBuilder.CreateCylinder(`${name}-grip-${side > 0 ? "r" : "l"}`, { diameter: 0.09, height: 0.16 }, scene);
    grip.parent = chassis;
    grip.position.set(side * 0.34, 1.05, 0.75);
    grip.rotation.z = Math.PI / 2;
    grip.material = mats.dark;
  }

  // Front fork: two thin cylinders from the bar down to the front axle.
  for (const side of [-1, 1]) {
    const fork = MeshBuilder.CreateCylinder(`${name}-fork-${side > 0 ? "r" : "l"}`, { diameter: 0.05, height: 0.85 }, scene);
    fork.parent = chassis;
    fork.position.set(side * 0.12, 0.62, 0.72);
    fork.rotation.x = 0.12; // slight rake
    fork.material = mats.rim;
  }

  // Slim seat.
  const seat = MeshBuilder.CreateBox(`${name}-seat`, { width: 0.34, height: 0.16, depth: 0.6 }, scene);
  seat.parent = chassis;
  seat.position.set(0, 0.95, -0.45);
  seat.material = mats.dark;

  buildLightStrips(scene, name, chassis, mats, 0.5);
  const exhaustAnchor = buildExhaust(scene, name, chassis, mats, 0.25);

  const wheels = WHEEL_POS.map((pos, i) =>
    buildWheel(scene, name, i, pos, WHEEL_SPECS.bike[pos.front ? "front" : "rear"], mats),
  );
  return { chassis, bodyMat, wheels, exhaustAnchor };
}

// ── ATV ─────────────────────────────────────────────────────────────────────

function buildAtv(scene: Scene, name: string, color: [number, number, number], mats: SharedMats): VehicleModel {
  const chassis = new TransformNode(`${name}-chassis`);

  const bodyMat = createPaintMaterial(scene, `${name}-bodymat`, color);

  // Wide boxy body.
  const body = MeshBuilder.CreateBox(`${name}-body`, { width: 1.7, height: 0.55, depth: 2.3 }, scene);
  body.parent = chassis;
  body.position.y = 0.65;
  body.material = bodyMat;

  // Front bumper bar.
  const bumper = MeshBuilder.CreateBox(`${name}-bumper`, { width: 1.8, height: 0.16, depth: 0.14 }, scene);
  bumper.parent = chassis;
  bumper.position.set(0, 0.42, 1.2);
  bumper.material = mats.dark;

  // Roll cage: four posts + a crossbar.
  const posts: ReadonlyArray<{ x: number; z: number }> = [
    { x: -0.7, z: 0.75 },
    { x: 0.7, z: 0.75 },
    { x: -0.7, z: -0.75 },
    { x: 0.7, z: -0.75 },
  ];
  posts.forEach((p, i) => {
    const post = MeshBuilder.CreateCylinder(`${name}-cage-${i}`, { diameter: 0.07, height: 0.85 }, scene);
    post.parent = chassis;
    post.position.set(p.x, 1.25, p.z);
    post.material = mats.dark;
  });
  const crossbar = MeshBuilder.CreateCylinder(`${name}-cage-cross`, { diameter: 0.07, height: 1.4 }, scene);
  crossbar.parent = chassis;
  crossbar.position.set(0, 1.66, 0);
  crossbar.rotation.z = Math.PI / 2; // axis along X
  crossbar.material = mats.dark;

  // Flat seat.
  const seat = MeshBuilder.CreateBox(`${name}-seat`, { width: 0.9, height: 0.2, depth: 0.8 }, scene);
  seat.parent = chassis;
  seat.position.set(0, 1.0, -0.2);
  seat.material = mats.dark;

  buildLightStrips(scene, name, chassis, mats, 1.3);
  const exhaustAnchor = buildExhaust(scene, name, chassis, mats, 0.5);

  const wheels = WHEEL_POS.map((pos, i) =>
    buildWheel(scene, name, i, pos, WHEEL_SPECS.atv[pos.front ? "front" : "rear"], mats),
  );
  return { chassis, bodyMat, wheels, exhaustAnchor };
}

/**
 * Build the full vehicle model for a type. The caller (KartRenderer) parents
 * `chassis` and each wheel `yaw` node under its tilt node, then drives the
 * pivots from state each frame.
 */
export function buildVehicleModel(
  scene: Scene,
  type: VehicleType,
  color: [number, number, number],
  name: string,
): VehicleModel {
  const mats = makeSharedMats(scene, name);
  switch (type) {
    case "bike":
      return buildBike(scene, name, color, mats);
    case "atv":
      return buildAtv(scene, name, color, mats);
    case "kart":
    default:
      return buildKart(scene, name, color, mats);
  }
}
