/**
 * Phase 5, Step 2 — IItemEffect factory + all eight effect classes.
 * Each item is applied to a real race fixture and its observable outcome asserted:
 * status effects pushed, projectiles spawned, bananas placed, opponents shrunk.
 */

import { describe, it, expect } from "vitest";
import { TUNING } from "../../src/data/tuning.js";
import type { Vec3 } from "../../src/core/Vec.js";
import { getItemEffect, type RaceContext } from "../../src/items/IItemEffect.js";
import type { ShellProjectileInit, BulletBillInit } from "../../src/items/ShellProjectile.js";
import { makeRaceFixture } from "./race-fixture.js";

/** Build a RaceContext that records spawned projectiles and placed bananas. */
function ctxFor(fixture: ReturnType<typeof makeRaceFixture>, owner = fixture.owner): RaceContext & {
  projectiles: Array<ShellProjectileInit | BulletBillInit>;
  bananas: Vec3[];
} {
  const projectiles: Array<ShellProjectileInit | BulletBillInit> = [];
  const bananas: Vec3[] = [];
  return {
    owner,
    allKarts: fixture.karts, // already ordered leader → last (rank 1 → 4)
    spawnProjectile: (p) => projectiles.push(p),
    placeBanana: (pos) => bananas.push(pos),
    projectiles,
    bananas,
  };
}

describe("getItemEffect factory", () => {
  it("returns a fresh instance for every registered id and throws on unknown", () => {
    const ids = ["mushroom", "greenShell", "redShell", "blueShell", "banana", "star", "lightning", "bulletBill"] as const;
    for (const id of ids) {
      expect(getItemEffect(id)).toBeDefined();
    }
    // Two calls give distinct instances (no shared mutable state).
    expect(getItemEffect("mushroom")).not.toBe(getItemEffect("mushroom"));
    expect(() => getItemEffect("tripleShrooms" as never)).toThrow(/No effect registered/);
  });
});

describe("ZoomShroom (mushroom)", () => {
  it("pushes a boost status at shroomBoost speed for shroomDurationSec", () => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect("mushroom").apply(ctx);

    expect(results).toEqual([{ kind: "boost" }]);
    const effs = fx.owner.state.statusEffects;
    expect(effs).toHaveLength(1);
    expect(effs[0]).toMatchObject({ kind: "boost", speed: TUNING.items.shroomBoost, remaining: TUNING.items.shroomDurationSec });
  });
});

describe("shell effects (green/red/blue)", () => {
  it.each([
    ["greenShell", "green"],
    ["redShell", "red"],
    ["blueShell", "blue"],
  ] as const)("%s spawns a %s shell projectile and reports 'projectile'", (id, kind) => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect(id).apply(ctx);

    expect(results).toEqual([{ kind: "projectile" }]);
    expect(ctx.projectiles).toHaveLength(1);
    expect("kind" in ctx.projectiles[0] && (ctx.projectiles[0] as ShellProjectileInit).kind).toBe(kind);
  });
});

describe("SlickBanana (banana)", () => {
  it("places a banana behind the owner along its forward axis", () => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect("banana").apply(ctx);

    expect(results).toEqual([{ kind: "bananaPlaced" }]);
    expect(ctx.bananas).toHaveLength(1);

    // The drop point is offset BEHIND the owner by bananaDropOffsetM along forward.
    const o = fx.owner.state;
    const b = ctx.bananas[0];
    const dx = b.x - (o.pos.x - Math.sin(o.heading) * TUNING.items.bananaDropOffsetM);
    const dz = b.z - (o.pos.z - Math.cos(o.heading) * TUNING.items.bananaDropOffsetM);
    expect(Math.hypot(dx, dz)).toBeLessThan(1e-9);
  });
});

describe("SparkleStar (star)", () => {
  it("pushes a star status for starDuration on the owner only", () => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect("star").apply(ctx);

    expect(results).toEqual([{ kind: "starred" }]);
    expect(fx.owner.state.statusEffects).toEqual([{ kind: "star", remaining: TUNING.items.starDuration }]);
    // No other kart is affected.
    for (const k of fx.karts) if (k.id !== fx.owner.id) expect(k.state.statusEffects).toHaveLength(0);
  });
});

describe("ZapLightning (lightning)", () => {
  it("shrinks every opponent but not the owner", () => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect("lightning").apply(ctx);

    expect(results).toEqual([{ kind: "shrunkAll" }]);
    // Owner untouched.
    expect(fx.owner.state.statusEffects).toHaveLength(0);
    // All three opponents shrunk for lightningShrink seconds.
    let shrunk = 0;
    for (const k of fx.karts) {
      if (k.id === fx.owner.id) continue;
      if (k.state.statusEffects.some((e) => e.kind === "shrink" && e.remaining === TUNING.items.lightningShrink)) shrunk++;
    }
    expect(shrunk).toBe(3);
  });
});

describe("BulletBill (bulletBill)", () => {
  it("transforms the owner into a bullet for bulletBillDurationSec", () => {
    const fx = makeRaceFixture();
    const ctx = ctxFor(fx);
    const results = getItemEffect("bulletBill").apply(ctx);

    expect(results).toEqual([{ kind: "bulletBill" }]);
    expect(fx.owner.state.statusEffects).toEqual([
      { kind: "bulletBill", remaining: TUNING.items.bulletBillDurationSec },
    ]);
  });
});
