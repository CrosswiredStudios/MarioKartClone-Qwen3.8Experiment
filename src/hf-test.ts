/**
 * ISOLATED Havok heightfield baseline (debug-only page, hf-test.html).
 *
 * Purpose: prove/disprove the terrain body in a scene with ZERO race-scene variables.
 * Reuses the exact RaceScene code path — TrackSpline → TrackBuilder(field) →
 * PhysicsWorld.buildTerrain(track.field) — then raycasts straight down on a 9×9
 * grid and fits all 8 candidate buffer→world mappings (mirror/transpose
 * compositions) against field.heightAt(x, z) ground truth. The mapping with ~0
 * mean error is the one Havok actually implements; buildTerrain's fill must be
 * adjusted so that "identity" wins. One dynamic sphere is also dropped to
 * sanity-check contact.
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeType,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { LAGOON_TRACK } from "./data/tracks/index.js";
import { TUNING } from "./data/tuning.js";
import { TrackSpline } from "./tracks/TrackSpline.js";
import { TrackBuilder } from "./tracks/TrackBuilder.js";
import { PhysicsWorld } from "./scene/PhysicsWorld.js";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const readout = document.getElementById("readout") as HTMLDivElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.5, 0.7, 1.0, 1); // sky blue — anything else means no render at all

// ── Track (visual + heightfield source) — identical to RaceScene's construction ──
const def = LAGOON_TRACK;
const spline = new TrackSpline(def.controlPoints, def.roadWidth, TUNING.physics.onRoadMargin, undefined, def.widthOverrides);
const track = new TrackBuilder(scene, spline, def); // field built here, as in RaceScene
track.build();

// ── Physics: same init + buildTerrain as the real game ────────────────────────
const physicsWorld = new PhysicsWorld(scene);
await physicsWorld.init();
physicsWorld.buildTerrain(track.field);

// ── Lights (no render pipeline here — keep it dumb) ───────────────────────────
new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.7;
const dir = new DirectionalLight("dir", new Vector3(-0.4, -1, 0.3), scene);
dir.position.set(50, 80, -50);

// ── One dynamic sphere to sanity-check contact (rolls — not used for the fit) ─
const { minX, maxX, minZ, maxZ } = track.field.bounds;
const spanX = maxX - minX;
const spanZ = maxZ - minZ;
const p0 = spline.pointAt(0);
const sphereNode = new TransformNode("probe-sphere", scene);
sphereNode.position.set(p0.x, track.field.heightAt(p0.x, p0.z) + 12, p0.z);
new PhysicsBody(sphereNode, PhysicsMotionType.DYNAMIC, false, scene).shape = new PhysicsShape(
  { type: PhysicsShapeType.SPHERE, parameters: { radius: 0.8 } },
  scene,
);
const sphereVis = MeshBuilder.CreateSphere("probe-sphere-vis", { diameter: 1.6, segments: 8 }, scene);
const smat = new StandardMaterial("probe-sphere-mat", scene);
smat.diffuseColor = new Color3(1, 0.2, 0.2);
smat.emissiveColor = new Color3(0.5, 0.1, 0.1);
sphereVis.material = smat;

// ── Camera: free orbit around the field center ────────────────────────────────
const cam = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 90, new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2), scene);
cam.attachControl(canvas, true);

// ── The 8 candidate mappings: world point p → field point q whose height the
//    physical surface shows at p. u/v are normalized coords; transpose swaps them.
// ───────────────────────────────────────────────────────────────────────────────
type MapFn = (x: number, z: number) => [number, number];
const candidates: Array<[string, MapFn]> = [];
for (let t = 0; t < 2; t++) {
  for (let fx = 0; fx < 2; fx++) {
    for (let fz = 0; fz < 2; fz++) {
      const name = [t ? "T" : "", fx ? "mX" : "", fz ? "mZ" : ""].join("") || "identity";
      candidates.push([name, (x, z) => {
        let u = (x - minX) / spanX;
        let v = (z - minZ) / spanZ;
        if (t) [u, v] = [v, u]; // transpose normalized coords
        if (fx) u = 1 - u;
        if (fz) v = 1 - v;
        return [minX + u * spanX, minZ + v * spanZ];
      }]);
    }
  }
}

// ── Raycast grid: 9×9 straight-down rays across the bounds ────────────────────
const GRID = 9;
interface Sample { x: number; z: number; hitY: number | null }
let samples: Sample[] = [];
function runRaycasts(): void {
  samples = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = minX + (spanX * i) / (GRID - 1);
      const z = minZ + (spanZ * j) / (GRID - 1);
      const hit = physicsWorld.raycast({ x, y: 60, z }, { x, y: -80, z });
      samples.push({ x, z, hitY: hit ? hit.point.y : null });
    }
  }
}

let reportDone = false;
function buildReport(): string {
  const hits = samples.filter((s) => s.hitY !== null);
  if (hits.length === 0) return "RAYCASTS: 0/81 hits — heightfield not raycastable?";
  const rows = candidates.map(([name, fn]) => {
    let err = 0;
    for (const s of hits) {
      const [qx, qz] = fn(s.x, s.z);
      err += Math.abs(track.field.heightAt(qx, qz) - (s.hitY as number));
    }
    return [name, err / hits.length] as const;
  }).sort((a, b) => a[1] - b[1]);
  const lines = rows.map(([n, e], i) => `${i === 0 ? "★" : " "} ${n.padEnd(6)} mean|Δ|=${e.toFixed(3)}`);
  // Per-point detail for the winner.
  const [wName, wFn] = candidates.find((c) => c[0] === rows[0][0])!;
  const detail = hits.slice(0, 12).map((s) => {
    const [qx, qz] = (wFn as MapFn)(s.x, s.z);
    return `  (${s.x.toFixed(0)},${s.z.toFixed(0)}) hit=${(s.hitY as number).toFixed(2)} truth=${track.field.heightAt(qx, qz).toFixed(2)}`;
  });
  return `RAYCASTS: ${hits.length}/81 hits\n` + lines.join("\n") + `\nwinner=${wName}\n` + detail.join("\n");
}

engine.runRenderLoop(() => {
  scene.render();
});
window.addEventListener("resize", () => engine.resize());

// Raycasts need the physics world stepped at least once; wait a beat, then report.
setTimeout(runRaycasts, 1500);
setInterval(() => {
  if (!reportDone && samples.length > 0) {
    readout.textContent = buildReport() + `\nsphere: y=${sphereNode.position.y.toFixed(2)} (dropped at ${track.field.heightAt(p0.x, p0.z).toFixed(2)})`;
    reportDone = true;
  } else if (!reportDone) {
    readout.textContent = "waiting for physics…";
  }
}, 500);
