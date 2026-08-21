/**
 * materials — shared PBR material presets for the map scene (lighting pass).
 *
 * Centralizes physically-based tuning so every surface gets consistent,
 * realistic lighting: glossy car paint with clearcoat, bare metal rims, matte
 * rubber tires, rough asphalt, dry grass/rock, and emissive accents. Each call
 * returns a FRESH material instance — callers own disposal (materials are
 * parented to the scene that created them).
 *
 * Why per-instance instead of shared: several effects drive material state at
 * runtime (kart hit-flash / star flicker write bodyMat.emissiveColor), and
 * track/prop materials must be disposed with their owning root. Sharing would
 * couple lifetimes across scenes.
 *
 * IBL note: these materials get image-based lighting automatically from
 * scene.environmentTexture (set by RenderPipelineSetup) — no per-material env
 * wiring needed here.
 */

import { PBRMaterial, type Color3, type Scene } from "@babylonjs/core";

/** Glossy car paint: semi-metallic base + a clearcoat layer for the lacquer highlight. */
export function createPaintMaterial(scene: Scene, name: string, color: [number, number, number]): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor.set(color[0], color[1], color[2]);
  mat.metallic = 0.7;
  mat.roughness = 0.25;
  // Clearcoat: the polyurethane lacquer over automotive paint — a second, very
  // smooth specular layer on top of the base coat (intensity 0..1).
  mat.clearCoat.isEnabled = true;
  mat.clearCoat.intensity = 0.8;
  mat.clearCoat.roughness = 0.1;
  return mat;
}

/** Bare metal (rims, forks): full metallic, lightly rough so it picks up IBL + sun streaks. */
export function createMetalMaterial(scene: Scene, name: string, color?: Color3): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  if (color) mat.albedoColor.copyFrom(color);
  else mat.albedoColor.set(0.75, 0.76, 0.8);
  mat.metallic = 1;
  mat.roughness = 0.3;
  return mat;
}

/** Matte rubber (tires): non-metallic, near-max roughness — no specular highlights. */
export function createRubberMaterial(scene: Scene, name: string, color?: Color3): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  if (color) mat.albedoColor.copyFrom(color);
  else mat.albedoColor.set(0.1, 0.1, 0.12);
  mat.metallic = 0;
  mat.roughness = 0.95;
  return mat;
}

/** Asphalt road: non-metallic, rough — the sun specular streaks come from IBL + low-rough patches. */
export function createAsphaltMaterial(scene: Scene, name: string): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.metallic = 0.05;
  mat.roughness = 0.8;
  return mat;
}

/** Dry grass / dirt terrain: fully matte, non-metallic. */
export function createGrassMaterial(scene: Scene, name: string): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.metallic = 0;
  mat.roughness = 0.95;
  return mat;
}

/** Generic matte surface (props, trim, rock) with an optional emissive accent. */
export function createMatteMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  options?: { readonly roughness?: number; readonly emissive?: Color3 },
): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor.copyFrom(color);
  mat.metallic = 0;
  mat.roughness = options?.roughness ?? 0.9;
  if (options?.emissive) mat.emissiveColor.copyFrom(options.emissive);
  return mat;
}

/**
 * Wet oil slick: low roughness + a dark blue-purple albedo gives the glossy
 * "wet" sheen via sun/IBL reflections — replacing the old StandardMaterial
 * specular+emissive hack with physically-based response.
 */
export function createOilSlickMaterial(scene: Scene, name: string): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor.set(0.03, 0.03, 0.06); // near-black with a cool cast (oil rainbow hint)
  mat.metallic = 0.4;
  mat.roughness = 0.12;
  return mat;
}
