/**
 * Item effect extension point (01-architecture.md §4, Phase 5 Step 2).
 *
 * Each item is a class implementing {@link IItemEffect}. The factory
 * {@link getItemEffect} maps an id to a fresh instance — adding a new item means
 * writing one class plus one registry line (OCP). Effects are applied synchronously
 * inside RaceController.update(dt) — the one place entity mutation is legal.
 *
 * Mutation contract: `apply(ctx)` may directly mutate `statusEffects` on karts in
 * `ctx.allKarts`; world objects (shells, bananas) go through `ctx.spawnProjectile` /
 * `ctx.placeBanana`. The returned {@link EffectResult}s are what the controller uses
 * to emit events — effects never touch the bus directly.
 */

import type { Vec3 } from "../core/Vec.js";
import type { KartEntity } from "../entities/KartEntity.js";
import type { ItemId } from "../entities/KartPhysics.js";
import type { BulletBillInit, ShellProjectileInit } from "./ShellProjectile.js";

/** Everything an effect needs to know about the race at apply-time. */
export interface RaceContext {
  readonly owner: KartEntity;
  /** All karts including owner, sorted by standings (rank 1 first). */
  readonly allKarts: ReadonlyArray<KartEntity>;
  /** Spawn a shell or bullet-bill projectile into the world. */
  readonly spawnProjectile: (p: ShellProjectileInit | BulletBillInit) => void;
  /** Place a banana at a world position. */
  readonly placeBanana: (pos: Vec3) => void;
}

/** What an effect did — the controller translates these into bus events. */
export interface EffectResult {
  readonly kind: "boost" | "projectile" | "bananaPlaced" | "starred" | "shrunkAll" | "bulletBill";
  readonly targetId?: string;
}

/** One item's behavior. `apply` is pure-with-respect-to-the-bus (no event emission). */
export interface IItemEffect {
  apply(ctx: RaceContext): EffectResult[];
}

// ── concrete effects (one class per item) ────────────────────────────────────────

import { TUNING } from "../data/tuning.js";

/** mushroom — a burst of speed for shroomDurationSec. */
export class ZoomShroom implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.owner.state.statusEffects.push({
      kind: "boost",
      speed: TUNING.items.shroomBoost,
      remaining: TUNING.items.shroomDurationSec,
    });
    return [{ kind: "boost" }];
  }
}

/** greenShell — straight-flying shell that bounces off walls and karts. */
export class GreenPeaShell implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.spawnProjectile({ kind: "green", owner: ctx.owner });
    return [{ kind: "projectile" }];
  }
}

/** redShell — homes to the nearest kart ahead. */
export class RedChiliShell implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.spawnProjectile({ kind: "red", owner: ctx.owner });
    return [{ kind: "projectile" }];
  }
}

/** blueShell — storms at the current leader. */
export class BlueStormShell implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.spawnProjectile({ kind: "blue", owner: ctx.owner });
    return [{ kind: "projectile" }];
  }
}

/** banana — drops behind the owner; anyone touching it spins out. */
export class SlickBanana implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    const o = ctx.owner.state;
    const fx = Math.sin(o.heading);
    const fz = Math.cos(o.heading);
    const off = TUNING.items.bananaDropOffsetM;
    ctx.placeBanana({ x: o.pos.x - fx * off, y: o.pos.y, z: o.pos.z - fz * off });
    return [{ kind: "bananaPlaced" }];
  }
}

/** star — invincibility + sustained boost for starDuration. */
export class SparkleStar implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.owner.state.statusEffects.push({ kind: "star", remaining: TUNING.items.starDuration });
    return [{ kind: "starred" }];
  }
}

/** lightning — shrinks every opponent for lightningShrink seconds. */
export class ZapLightning implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    for (const k of ctx.allKarts) {
      if (k.id === ctx.owner.id) continue; // owner immune
      k.state.statusEffects.push({ kind: "shrink", remaining: TUNING.items.lightningShrink });
    }
    return [{ kind: "shrunkAll" }];
  }
}

/** bulletBill — the owner transforms into a fast straight-flying bullet. */
export class BulletBill implements IItemEffect {
  apply(ctx: RaceContext): EffectResult[] {
    ctx.owner.state.statusEffects.push({
      kind: "bulletBill",
      remaining: TUNING.items.bulletBillDurationSec,
    });
    return [{ kind: "bulletBill" }];
  }
}

// ── factory (OCP registry) ────────────────────────────────────────────────────────

const REGISTRY = new Map<ItemId, () => IItemEffect>([
  ["mushroom", () => new ZoomShroom()],
  ["greenShell", () => new GreenPeaShell()],
  ["redShell", () => new RedChiliShell()],
  ["blueShell", () => new BlueStormShell()],
  ["banana", () => new SlickBanana()],
  ["star", () => new SparkleStar()],
  ["lightning", () => new ZapLightning()],
  ["bulletBill", () => new BulletBill()],
]);

/** Build a fresh effect for an item id. Throws on unknown ids (defensive). */
export function getItemEffect(id: ItemId): IItemEffect {
  const make = REGISTRY.get(id);
  if (!make) throw new Error(`No effect registered for item "${id}"`);
  return make();
}
