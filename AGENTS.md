# AGENTS.md — AI Agent Guidelines

> Always-on rules for AI coding agents working in this repo. Keep this file short and current; deep detail lives in the linked docs. If a rule here conflicts with `docs/plans/01-architecture.md`, the architecture doc wins — then fix this file in the same commit.

## Project

**Turbo Turtle Rally** — a single-player browser kart racer. Babylon.js v9 (`@babylonjs/core` ^9.21) + Havok physics, TypeScript strict, Vite 6, Vitest (unit) + Playwright (e2e). 3 laps vs 3 AI, 2 themed maps, full 8-item set. All audio/VFX synthesized in code.

## Golden rule: logic is decoupled from rendering

**All game logic modules are plain TypeScript with ZERO Babylon imports.** They operate on plain `{x,y,z}` records (not `Vector3`) and pure functions. Rendering subscribes to the typed `EventBus` for discrete events and reads entity state each frame.

- Babylon imports are allowed ONLY in: `src/scene/`, `src/rendering/`, `src/vfx/`, `src/ui/Hud.ts` (minimap), `src/main.ts`, and the render-adjacent entity files `KartRenderer.ts`, `KartBody.ts`, `vehicleModels.ts`.
- This is what makes unit tests run headlessly in Node (no WebGL) and enables the headless full-race simulation.
- Full architecture, interfaces, event catalog, SOLID mapping: [`docs/plans/01-architecture.md`](./docs/plans/01-architecture.md).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | `tsc --noEmit` + `vite build` → `dist/` |
| `npm run preview` | Serve the last `dist/` build (port 4173) — **NOT live source** |
| `npm test` | Vitest unit tests (node env, no WebGL) |
| `npm run test:e2e` | Playwright against the preview server |
| `npm run lint` | ESLint 9 flat config |

**Canonical gate (run in order, stop at first failure):** `npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build` → `npm run test:e2e`.

**Two hard rules:**
1. **`npm run build` BEFORE `npm run test:e2e`** — preview serves `dist/`, so e2e tests a stale bundle otherwise.
2. **Verify browser behavior via `page.evaluate(window.__game…)` / DOM — NEVER screenshots** (unavailable in this environment).

Details: [`docs/TESTING.md`](./docs/TESTING.md).

## Conventions

- **TypeScript strict**; `no-explicit-any` is an ESLint **error**; prefer `import type { X }` for type-only imports.
- **Relative imports use the `.js` extension** (ESM + Vite): `import { stepKart } from "./KartPhysics.js"`.
- **ALL gameplay magic numbers live in `src/data/tuning.ts`** — no raw gameplay constants anywhere else. **Any change to `tuning.ts` must update [`docs/tuning-table.md`](./docs/tuning-table.md) in the same commit.**
- **All randomness goes through `createRng(seed)`** from `src/core/Rng.ts` — never `Math.random()` — so headless tests are reproducible.
- **Fixed timestep:** logic always receives `dt = 1/60` via `FixedTimestepLoop`; renderers may interpolate but never advance logic.
- **Pure step functions return new state objects**; entities are mutable only inside `RaceController.update(dt)`. When feeding post-physics state through a transform, pass the **post-physics** `next` as the base — never the pre-physics `kart.state`.
- **Repeated world objects (barriers, props, shells, bananas, item boxes) MUST use `InstancedMesh`** — one Mesh per instance is a review blocker.
- **Every long-lived subsystem implements `dispose()`**; quit-to-menu must return mesh/light/particle counts to the menu baseline.
- **Extension points (OCP):** new item = implement `IItemEffect` + register in the factory (no spawner/race edits); new AI = implement `IAiStrategy`; new track = add a data file in `src/data/tracks/`, zero system changes.
- **Errors:** logic modules throw `Error` with descriptive messages; UI catches at the boundary. No silent `catch {}`.
- **Naming:** PascalCase classes/types, camelCase functions/vars, UPPER_SNAKE constants in `tuning.ts`. Files named after their primary export.

## IP safety (hard rule)

**Zero Nintendo intellectual property.** All characters, vehicles, maps and items are original pun-based knockoffs. The release gate runs:

```
grep -rinE "mario|luigi|peach|bowser|yoshi|wario|waluigi|koopa|donkey kong" src docs index.html
```

and must return **only the two documented meta-hits** (the banned-name reference list in `docs/plans/00-overview.md` §2 and the quoted command in `docs/plans/09-phase-7-final-qa.md`). **Never add allowlist entries — fix hits at the source.** `toad` is deliberately NOT banned (common English word). The map `meadows` displays as "Greenhollow Meadows". Full decision record: [`docs/plans/00-overview.md`](./docs/plans/00-overview.md) §2.

## Environment gotchas (short list)

- **Screenshots fail** in this environment (400) — verify via `page.evaluate` + DOM.
- **The integrated-browser tab is rAF-throttled when backgrounded** — can't drive a live race there; use Playwright headless Chromium.
- **Dev server serves HTML for the Havok `.wasm`** — smoke-test physics against `vite preview`, not `vite` dev.
- **Stale `dist/` / leftover `:4173` listener** are the #1 e2e false-failure source.

Full symptom→cause table: [`docs/DEBUGGING.md`](./docs/DEBUGGING.md).

## Doc map

| Doc | Covers |
|---|---|
| [`docs/plans/00-overview.md`](./docs/plans/00-overview.md) | Vision, rosters, items, tech stack, phase map, Definition of Done |
| [`docs/plans/01-architecture.md`](./docs/plans/01-architecture.md) | Folder layout, interfaces, event catalog, conventions, determinism rules |
| [`docs/plans/02`–`09`](./docs/plans/) | Phase-by-phase execution guides with exit gates |
| [`docs/TESTING.md`](./docs/TESTING.md) | Gate sequence, unit/e2e conventions, perf protocol |
| [`docs/DEBUGGING.md`](./docs/DEBUGGING.md) | `window.__game`/`__sw` handles, probe scripts, symptom→cause table |
| [`docs/BABYLON-V9.md`](./docs/BABYLON-V9.md) | Verified Babylon.js v9.21 API facts (plan docs assume older APIs — this wins) |
| [`docs/HAVOK.md`](./docs/HAVOK.md) | Verified Havok physics facts + hybrid drive model |
| [`docs/tuning-table.md`](./docs/tuning-table.md) | Every `TUNING` value with rationale + feel target |
| [`.github/instructions/`](./.github/instructions/) | File-scoped rules auto-attached per folder (pure logic, rendering, physics, testing, UI, IP) |

## Definition of Done (per change)

1. `npm run lint` → 0 errors, 0 warnings
2. `npx tsc --noEmit` → clean
3. `npm test` → all unit tests pass
4. `npm run build` + `npm run test:e2e` → green (when browser behavior is touched)
5. No new TODO/FIXME without an issue reference
6. Conventions above followed; `tuning-table.md` updated if `tuning.ts` changed; IP gate still clean
