/**
 * Phase 5, Step 1 — item data + spawn table rules.
 * All 8 ids defined; tables non-empty for ranks 1–4; strength monotonicity via
 * STRENGTH_ORDER (nested supersets); bulletBill only in rank 4's table.
 */

import { describe, it, expect } from "vitest";
import { ITEM_DEFS, SPAWN_TABLES, STRENGTH_ORDER } from "../../src/data/items.js";
import type { ItemId } from "../../src/entities/KartPhysics.js";

const ALL_IDS: readonly ItemId[] = [
  "mushroom",
  "greenShell",
  "redShell",
  "blueShell",
  "banana",
  "star",
  "lightning",
  "bulletBill",
];

describe("ITEM_DEFS", () => {
  it("defines all 8 item ids from the overview", () => {
    for (const id of ALL_IDS) {
      expect(ITEM_DEFS[id], `missing def for ${id}`).toBeDefined();
      expect(ITEM_DEFS[id].id).toBe(id);
    }
  });

  it("every def has a non-empty name, description and iconColor", () => {
    for (const id of ALL_IDS) {
      const def = ITEM_DEFS[id];
      expect(def.name.length > 0, `${id} name`).toBe(true);
      expect(def.description.length > 0, `${id} description`).toBe(true);
      expect(/^#[0-9a-fA-F]{6}$/.test(def.iconColor), `${id} iconColor ${def.iconColor}`).toBe(true);
    }
  });

  it("STRENGTH_ORDER lists exactly the 8 ids", () => {
    expect([...STRENGTH_ORDER].sort()).toEqual([...ALL_IDS].sort());
  });
});

describe("SPAWN_TABLES", () => {
  const RANKS = [1, 2, 3, 4] as const;

  it("every rank has a non-empty table of valid ids", () => {
    for (const r of RANKS) {
      const table = SPAWN_TABLES[r];
      expect(table.length > 0, `rank ${r} empty`).toBe(true);
      for (const id of table) {
        expect(ALL_IDS, `${id} not a valid ItemId in rank ${r}`).toContain(id);
      }
    }
  });

  it("banana appears in every table (classic behavior)", () => {
    for (const r of RANKS) {
      expect(SPAWN_TABLES[r]).toContain("banana");
    }
  });

  it("monotonicity: rank r's table is a subset of rank s' table for r < s", () => {
    // Worse ranks (higher number) are supersets — the rear of the pack has
    // everything the front does plus more. So every id in SPAWN_TABLES[r] must
    // also appear in SPAWN_TABLES[s] when r < s.
    for (let r = 1 as const; r <= 4; r++) {
      for (let s = (r + 1) as 2 | 3 | 4; s <= 4; s = (s + 1) as 2 | 3 | 4) {
        const higher = new Set(SPAWN_TABLES[s]);
        for (const id of SPAWN_TABLES[r]) {
          expect(higher.has(id), `rank ${r} has ${id} missing from rank ${s}`).toBe(true);
        }
      }
    }
  });

  it("max strength never decreases as rank worsens", () => {
    const maxStrength = (table: readonly ItemId[]): number =>
      Math.max(...table.map((id) => STRENGTH_ORDER.indexOf(id)));
    for (let r = 1 as const; r < 4; r++) {
      expect(maxStrength(SPAWN_TABLES[r]), `rank ${r}`).toBeLessThanOrEqual(
        maxStrength(SPAWN_TABLES[(r + 1) as 2 | 3 | 4]),
      );
    }
  });

  it("bulletBill appears only in rank 4's table", () => {
    for (const r of RANKS) {
      if (r === 4) expect(SPAWN_TABLES[r]).toContain("bulletBill");
      else expect(SPAWN_TABLES[r], `rank ${r} should not have bulletBill`).not.toContain("bulletBill");
    }
  });
});
