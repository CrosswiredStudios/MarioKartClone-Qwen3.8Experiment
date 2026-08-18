# Turbo Turtle Rally — Project Overview

> **Phase 0 reference document.** This is the single source of truth for *what* we are building, *why*, and *in what order*. Architecture details live in [`01-architecture.md`](./01-architecture.md); each phase has its own execution guide (`02`–`09`).

## 1. Vision

A polished, single-player kart racer for the browser built with **Babylon.js v9**. The player picks a character, vehicle and map, then races **3 laps** against **3 AI opponents** on a stylized cartoon track, using the full classic item set (boosts, shells, bananas, star, lightning, bullet bill). The game must *feel* like a finished product: drift with charged mini/super turbo, speed-reactive engine audio, particle VFX, screen shake, post-processing, themed lighting per map, and presentation polish (countdown beeps, results podium + confetti + fanfare).

**Non-goals:** multiplayer/netcode, gamepad support, mobile/touch controls, external 3D asset pipelines, vertical/looping track sections.

## 2. IP Safety (hard rule)

This project uses **zero Nintendo intellectual property**. All characters, vehicles, maps and items are original pun-based knockoffs. The following strings must never appear in `src/`, `docs/`, or any asset name:

```
(names quoted below for reference only — this list is the single expected grep hit in docs)
mario | luigi | peach | bowser | yoshi | wario | waluigi | koopa | donkey kong | kart (as "Mario Kart") | star koopa | shell (as "shy guy")

Note: `toad`/`toadstool` are deliberately NOT banned — they are common English words, not Nintendo-specific terms. The game title and map names were chosen to avoid them anyway (see [09-phase-7-final-qa.md](./09-phase-7-final-qa.md) IP gate decision).
```

> Note: generic words like "kart", "shell" and "banana" are fine — only the *Nintendo-specific* names/combos are banned. The Phase 7 release checklist runs an automated grep gate for this list.

## 3. Rosters & Content (Lean scope)

### Characters (4)
Each character has a stat vector `1–5` per axis: **accel**, **topSpeed**, **handling**, **offRoad**.

| id | Name | Pun source | Archetype | accel | topSpeed | handling | offRoad |
|---|---|---|---|---|---|---|---|
| `marvin` | Marvin | red-cap plumber | Balanced all-rounder | 3 | 3 | 3 | 3 |
| `louie` | Louie | tall green plumber | Light, best off-road | 4 | 2 | 4 | 5 |
| `pearl` | Pearl | pink princess | Fast top speed, fragile handling | 2 | 5 | 2 | 3 |
| `terry` | Terry the Terrapin | spiky-shell turtle king | Heavy: slow accel, high top speed + durability | 1 | 4 | 2 | 4 |

### Vehicles (3)
Stat **modifiers** added to character stats (clamped 1–5).

| id | Name | Type | accel | topSpeed | handling | offRoad |
|---|---|---|---|---|---|---|
| `basher` | The Basher | Kart | +0 | +0 | +0 | +0 |
| `zippy` | Zippy Cycle | Bike | +1 | −1 | +1 | 0 |
| `quadzilla` | Quadzilla | ATV/Quad | −1 | +1 | −1 | +1 |

### Maps (2)
Defined as **data** (Catmull-Rom control points, road width, theme palette, item-box clusters, hazard placements, prop catalog). See §6 Track Data Format.

| id | Name | Theme | Difficulty | Notes |
|---|---|---|---|---|
| `meadows` | Greenhollow Meadows | Grassland loop | Beginner | Wide road, gentle curves, 3 item-box clusters, grass off-road slowdown |
| `lagoon` | Lava Lagoon Loop | Volcanic circuit | Intermediate | Tighter corners, oil-slick patches, narrow bridge with barriers, 4 item-box clusters |

### AI opponents (3)
The player picks 1 of the 4 characters; **the other 3 race as AI** on their own vehicle/map-appropriate loadouts. AI = waypoint following along the track spline + per-racer speed variance + gentle rubber-banding so races stay close but winnable.

### Items (full classic set)
| id | Name | Effect | Targeting rule |
|---|---|---|---|
| `mushroom` | Zoom Shroom | Instant speed boost (~1.5 s) | Self |
| `greenShell` | Green Pea Shell | Projectile, bounces off walls (max 3), hits first kart ahead | First kart ahead on track |
| `redShell` | Red Chili Shell | Homing projectile, locks to nearest kart ahead | Nearest kart ahead within range |
| `blueShell` | Blue Storm Shell | Fast homing shell that targets the **current race leader** | Race leader (any distance) |
| `banana` | Slick Banana | Drops behind user; next kart over it skids (uncontrollable spin, ~1 s) | Next kart to drive over it |
| `star` | Sparkle Star | Invincibility + sustained boost (~6 s); collisions bounce others instead of self | Self |
| `lightning` | Zap Lightning | Shrinks all other karts for ~5 s (reduced top speed & handling) | All opponents |
| `bulletBill` | Bullet Bill | User transforms into a fast bullet that plows through the kart ahead | First kart in path |

**Item box spawn rules (position-based):** rear of pack gets stronger items. Tables are pure data in `src/data/items.ts`, keyed by race position rank, and unit-tested.

## 4. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Engine | **Babylon.js `@babylonjs/core` ^9.21.2** | Tree-shaken imports only; WebGL2 required (capability check + friendly overlay) |
| Build | **Vite 6 + TypeScript strict** | ES modules, `.js` extension on relative imports |
| Unit tests | **Vitest** | Pure logic modules tested headlessly (no WebGL needed) |
| E2E tests | **Playwright** (Chromium) | Menu smoke test; full 3-lap race via scripted keyboard input. Verify via DOM + `window.__game` evaluate — **not screenshots** |
| Lint/format | ESLint 9 flat config + Prettier | `no-explicit-any: error`, type-only imports enforced |
| Physics | **Custom arcade kinematics** (no physics plugin) | Deterministic, unit-testable; fixed 1/60 s timestep |
| Audio | WebAudio synthesis (`MusicSequencer` chiptune + `SfxPlayer`) | No asset files required; CC0 file player can be swapped in behind the same interface later |
| UI/HUD | Plain DOM/CSS overlays (not Babylon GUI) | Junior-friendly, directly assertable by Playwright |

### npm scripts
```
npm run dev        # Vite dev server (port 5173)
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/ on port 4173
npm test           # vitest run (unit)
npm run test:e2e   # playwright test (spins up preview server automatically)
npm run lint       # eslint .
```

## 5. Controls Scheme

| Input | Action |
|---|---|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A`/`D`, `←`/`→` | Steer left/right |
| `Space` (hold while turning) | Drift — charge escalates white → blue; release for **mini** or **super** turbo boost |
| `E` / `Enter` | Use item |
| `Esc` | Pause menu (resume / settings / quit to menu) |

## 6. Track Data Format

Tracks are pure data (`src/data/tracks/*.ts`) consumed by `TrackSpline` (math) and `TrackBuilder` (meshes). Sketch:

```ts
interface TrackDefinition {
  id: string;
  name: string;
  laps: number;                 // always 3 in this project
  roadWidth: number;            // meters
  controlPoints: Vec2[];        // Catmull-Rom loop, XZ plane (y=0)
  theme: TrackTheme;            // palette + skybox gradient + fog color/density + lighting rig params
  itemBoxClusters: ItemBoxCluster[];   // { t: number; lateralOffset?: number } — positions along spline
  hazards: HazardPlacement[];          // e.g. oil slicks: { t, lateralOffset, size }
  propCatalog: PropSpawn[];            // { kind, t, lateralOffset, scale?, rotationY? }
}
```

`TrackSpline` samples the Catmull-Rom loop into a dense arc-length table so that `closestPoint(p)` returns `{ t (0..1), distance, onRoad }` in O(log n) — this single call powers lap progress, off-road detection, standings and AI.

## 7. Phase Map & Dependency Graph

```
P0 scaffold ──> P1 core framework ──> P2 selection screens ──> P3 track system ──> P4 race loop + AI
                                                                                          │
                                              P5 items/weapons/hazards <──────────────────┘
                                                     │
                                              P6 graphics/VFX/audio polish ──> P7 final QA
```

| Phase | Doc | One-line goal | Exit gate (all must pass) |
|---|---|---|---|
| **P0** Scaffolding & plan docs | `02-phase-0-scaffolding.md` | Vite+TS project, tooling, folder skeleton, Babylon hello-world scene, all plan docs authored | lint + tsc + unit + e2e smoke green; 10 docs exist |
| **P1** Core framework | `03-phase-1-core-framework.md` | EventBus, GameStateMachine, FixedTimestepLoop, input abstraction, main menu UI, audio skeleton | state-machine unit tests green; Playwright: Start button advances to next screen stub |
| **P2** Selection screens | `04-phase-2-selection-screens.md` | Roster data + validation, character/vehicle/map select, RaceConfig assembly | data-validation & config-assembly unit tests green; e2e: navigate all 3 selects |
| **P3** Track system, drift & free drive | `05-phase-3-track-system.md` | Spline math, track builder, chase camera, arcade physics + drift charge tiers + skid marks, lap tracking, QualityManager presets | spline/lap/drift unit tests green; manual: free-drive both maps (Meadows built; Lagoon data exists) |
| **P4** Race loop & AI | `06-phase-4-race-loop-and-ai.md` | Countdown → 3 laps vs 3 AI, standings, full HUD, pause/settings, results screen | headless full-race simulation unit test green; e2e: complete flow via scripted keys reaches results |
| **P5** Items, weapons & hazards | `07-phase-5-items-weapons-hazards.md` | Item boxes + spawn tables, all 8 items, shell projectiles, screen shake wiring | per-item unit tests + targeting integration tests green; manual: trigger every item |
| **P6** Graphics, VFX, audio & second map | `08-phase-6-vfx-audio-polish.md` | Full render pipeline (skybox/lighting/fog/post), particles, engine audio loop, prop population, Lagoon build, podium+confetti+fanfare | manual playtest checklist per item/hazard on both maps at each quality preset |
| **P7** Final QA & polish | `09-phase-7-final-qa.md` | Perf pass at all presets, tuning table, README, bug bash, release checklist | perf gates met; IP grep gate clean; full test suite green; cold-load polish gate passed |

**Rules:** P0→P1→P2→P3→P4 strictly sequential. P5 needs P4 (AI karts as targets). P6 after P5 (VFX attach to item events), though music themes can start early since they're independent. P7 last. **A phase is not done until its exit gate passes** — do not move on with failing tests.

## 8. Definition of Done (per phase)

1. `npm run lint` → 0 errors, 0 warnings
2. `npx tsc --noEmit` → clean
3. `npm test` → all unit tests pass
4. Phase-specific e2e/manual checklist from the phase doc completed
5. No new TODO/FIXME without an issue reference
6. Code follows conventions in [`01-architecture.md`](./01-architecture.md) §7
