/**
 * Item data — pure content for Phase 5 (07-phase-5-items-weapons-hazards.md, Step 1).
 *
 * All 8 items from 00-overview.md §3 with display names, one-line descriptions
 * (future tooltip; harmless now) and an iconColor matching the HUD icon drawing.
 * Spawn tables are rank-keyed nested supersets: each worse rank adds stronger
 * items so the rear of the pack always has access to everything the front does
 * plus more. The spawner picks uniformly via the seeded race RNG — no per-item
 * weights in Phase 5 (weighting is a Phase 7 tuning-table concern).
 */

import type { ItemId } from "../entities/KartPhysics.js";

export interface ItemDef {
  readonly id: ItemId;
  readonly name: string;
  readonly description: string;
  readonly iconColor: string;
}

/** All 8 items (00-overview.md §3). */
export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  mushroom: {
    id: "mushroom",
    name: "Zoom Shroom",
    description: "A burst of speed for a short time.",
    iconColor: "#e03c3c",
  },
  greenShell: {
    id: "greenShell",
    name: "Green Shell",
    description: "Flies straight and bounces off walls and karts.",
    iconColor: "#3fbf3f",
  },
  redShell: {
    id: "redShell",
    name: "Red Shell",
    description: "Homes in on the nearest kart ahead of you.",
    iconColor: "#e03c3c",
  },
  blueShell: {
    id: "blueShell",
    name: "Blue Shell",
    description: "Storms straight at whoever is leading the race.",
    iconColor: "#3c6ee0",
  },
  banana: {
    id: "banana",
    name: "Banana Peel",
    description: "Drops behind you; anyone who touches it spins out.",
    iconColor: "#ffd93b",
  },
  star: {
    id: "star",
    name: "Star",
    description: "Invincibility and a sustained speed boost.",
    iconColor: "#ffd93b",
  },
  lightning: {
    id: "lightning",
    name: "Lightning Bolt",
    description: "Shrinks every other racer, slowing them down.",
    iconColor: "#ffe14d",
  },
  bulletBill: {
    id: "bulletBill",
    name: "Bullet Bill",
    description: "Transforms you into a fast, straight-flying bullet.",
    iconColor: "#1a1a2e",
  },
};

/**
 * Rank (1 = leader … 4 = last) → uniform spawn table. Nested supersets — each
 * worse rank adds stronger items on top of the previous rank's table.
 */
export const SPAWN_TABLES: Readonly<Record<1 | 2 | 3 | 4, readonly ItemId[]>> = {
  1: ["banana", "mushroom"],
  2: ["banana", "mushroom", "greenShell"],
  3: ["banana", "mushroom", "greenShell", "redShell", "star"],
  4: ["banana", "mushroom", "greenShell", "redShell", "blueShell", "lightning", "star", "bulletBill"],
};

/** Total strength order (weakest → strongest) used by the monotonicity unit test. */
export const STRENGTH_ORDER: readonly ItemId[] = [
  "banana",
  "mushroom",
  "greenShell",
  "redShell",
  "blueShell",
  "lightning",
  "star",
  "bulletBill",
];
