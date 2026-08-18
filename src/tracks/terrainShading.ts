/**
 * terrainShading — pure per-vertex color helpers for the ground mesh
 * (graphics-quality pass). No Babylon imports → unit-testable in Node.
 *
 * The ground mesh is a single flat-colored StandardMaterial; baking per-vertex
 * colors (height tint + slope→rock blend + seeded jitter) is the single biggest
 * "high quality" win for the terrain: it reads as a real landscape instead of a
 * painted plane, at zero runtime cost (colors are baked once at track build).
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite smoothstep — 0 below edge0, 1 above edge1, C1 in between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function hexToRgb01(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Desaturate toward luminance gray (amount 0..1), then darken (darken 0..1). */
export function desaturate(base: Rgb, amount: number, darken: number): Rgb {
  const lum = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b;
  const k = 1 - darken;
  return {
    r: (base.r * (1 - amount) + lum * amount) * k,
    g: (base.g * (1 - amount) + lum * amount) * k,
    b: (base.b * (1 - amount) + lum * amount) * k,
  };
}

/** Theme-adaptive rock color: desaturated + darkened ground color. */
export function rockColorFromBase(base: Rgb): Rgb {
  return desaturate(base, 0.6, 0.15);
}

/**
 * Deterministic per-vertex jitter in [0,1) from world XZ — the classic shader
 * hash. Same (x,z) → same value, so the bake is reproducible across builds.
 */
export function hash01(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Albedo for one ground vertex.
 * @param base    theme ground color (0..1)
 * @param rock    rock color (use {@link rockColorFromBase})
 * @param heightT normalized height 0..1 (lowlands → darker/damp, highlands → lighter)
 * @param normalY world normal Y (1 = flat, 0 = vertical) — steep blends to rock
 * @param x       world X (feeds the jitter hash)
 * @param z       world Z (feeds the jitter hash)
 */
export function groundVertexColor(
  base: Rgb,
  rock: Rgb,
  heightT: number,
  normalY: number,
  x: number,
  z: number,
): Rgb {
  const h = clamp01(heightT);
  // Height tint: lowlands ~22% darker, highlands ~18% lighter.
  const scale = 0.78 + 0.4 * h;
  const tinted: Rgb = { r: base.r * scale, g: base.g * scale, b: base.b * scale };
  // Steep slopes read as exposed rock.
  const slopeT = clamp01((1 - normalY) / 0.55);
  const rockBlend = smoothstep(0.25, 0.9, slopeT);
  const mixed = mixRgb(tinted, rock, rockBlend);
  // Seeded jitter (±5%) breaks up banding.
  const j = 0.95 + 0.1 * hash01(x, z);
  return { r: mixed.r * j, g: mixed.g * j, b: mixed.b * j };
}
