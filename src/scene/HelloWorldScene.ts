import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/**
 * Phase 0 placeholder scene: a stylized low-poly kart built from primitives,
 * orbiting under an arc-rotate camera. Replaced by the real game scenes in
 * later phases; kept as the visual smoke test for the render pipeline.
 */
export function createHelloWorldScene(scene: Scene): void {
  scene.clearColor = new Color4(0.1, 0.12, 0.2, 1);

  const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.5;
  hemiLight.groundColor = new Color3(0.2, 0.15, 0.1);

  const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
  sun.intensity = 0.9;

  // Ground disc
  const ground = MeshBuilder.CreateDisc("ground", { radius: 14, tessellation: 48 }, scene);
  ground.rotation.x = Math.PI / 2;
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.25, 0.55, 0.3);
  ground.material = groundMat;

  // Kart body (chunky low-poly)
  const kart = MeshBuilder.CreateBox("kartBody", { width: 1.4, height: 0.5, depth: 2.2 }, scene);
  kart.position.y = 0.6;
  const bodyMat = new PBRMaterial("bodyMat", scene);
  bodyMat.albedoColor = new Color3(0.85, 0.15, 0.15);
  bodyMat.metallic = 0.2;
  bodyMat.roughness = 0.4;
  kart.material = bodyMat;

  const seat = MeshBuilder.CreateBox("seat", { width: 0.8, height: 0.35, depth: 0.9 }, scene);
  seat.position.y = 1.0;
  seat.parent = kart;
  const seatMat = new StandardMaterial("seatMat", scene);
  seatMat.diffuseColor = new Color3(0.15, 0.15, 0.2);
  seat.material = seatMat;

  // Wheels
  const wheelPositions: Array<[number, number]> = [
    [-0.85, -0.7],
    [0.85, -0.7],
    [-0.85, 0.7],
    [0.85, 0.7],
  ];
  const wheelMat = new StandardMaterial("wheelMat", scene);
  wheelMat.diffuseColor = new Color3(0.1, 0.1, 0.12);
  for (const [x, z] of wheelPositions) {
    const wheel = MeshBuilder.CreateCylinder(`wheel_${x}_${z}`, { diameter: 0.7, height: 0.3 }, scene);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    wheel.parent = kart;
    wheel.material = wheelMat;
  }

  const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.6, 8, Vector3.Zero(), scene);
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 20;

  // Slow idle spin so the smoke test has visible motion.
  scene.onBeforeRenderObservable.add(() => {
    kart.rotation.y += 0.01;
  });
}
