---
description: "Add a new race item end-to-end: effect, data, tuning, tests, VFX/SFX wiring"
agent: "agent"
argument-hint: "Item name and effect description"
---

Add a new race item end-to-end, following the project's OCP extension points. The item to add: **$ARGUMENTS**

Work through this checklist in order. Do not skip steps.

1. **Data** — add the `ItemId` and an `ITEM_DEFS` entry in `src/data/items.ts`, and add it to the spawn table (rank-based distribution).
2. **Effect** — implement `IItemEffect` in `src/items/ItemEffects.ts` and register it in the effect factory map. Do NOT edit the spawner or race controller — registration is the only wiring needed (OCP).
3. **Tuning** — add any new gameplay constants to `src/data/tuning.ts` (items section) AND add a matching row to `docs/tuning-table.md` in the same change. No raw magic numbers in the effect code.
4. **Unit test** — add a test following the pattern in `tests/unit/itemEffects.test.ts` (headless, seeded RNG, no WebGL).
5. **Event** — emit `item:used` on the `EventBus` when the item activates (renderers/VFX subscribe to this).
6. **VFX + SFX + HUD** — add a particle effect in `src/vfx/ParticleFactory.ts` (query `QualityManager.budget()`, never hardcode counts), a synthesized SFX in `src/audio/SfxPlayer.ts`, and a HUD icon in `drawItemIcon`.
7. **IP-safe name** — the name must be an original pun, not Nintendo IP. Check `docs/plans/00-overview.md` §2 for the banned-name list. The name must not break the IP grep gate.
8. **Gate** — run the full quality gate: `npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build` → `npm run test:e2e`. Fix any failures.

Report which checklist steps you completed and the final gate result.
