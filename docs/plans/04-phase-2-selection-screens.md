# Phase 2 — Selection Screens

> **STATUS: COMPLETE** (all exit gates green — see "As-built deviations" at the bottom of this doc). Depends on Phase 1's `EventBus` / `GameStateMachine` / `GameApp` / input abstraction / audio skeleton ([03-phase-1-core-framework.md](./03-phase-1-core-framework.md)). Source of truth: [00-overview.md](./00-overview.md) and [01-architecture.md](./01-architecture.md).

## Goal

Let the player pick a **character → vehicle → map** through three DOM-based selection screens, backed by validated pure-data rosters. On final confirm, assemble an immutable `RaceConfig` into the shared game context and navigate to the (Phase 1 stub) `Countdown` screen. Also land in this phase:

- All roster/track **data modules** with validation (`src/data/characters.ts`, `vehicles.ts`, `tracks/*`) — pure TS, zero Babylon imports.
- The complete `TUNING` table (`src/data/tuning.ts`) so later phases import it instead of defining magic numbers locally (per [01-architecture.md](./01-architecture.md) §6).
- Shared selection-screen CSS with keyboard focus rings and `data-testid` attributes on every interactive element.

Exit gate ([00-overview.md](./00-overview.md) §7, P2 row): **data-validation & config-assembly unit tests green; e2e: navigate all 3 selects.**

## Files to create / modify (table: path | purpose)

| Path | Purpose |
|---|---|
| `src/data/characters.ts` | `CharacterDef`, `CHARACTER_ROSTER` (4 chars), `validateCharacterRoster()` — pure data, no Babylon |
| `src/data/vehicles.ts` | `VehicleDef`, `VEHICLE_ROSTER` (3 vehicles), `combinedStats()`, `validateVehicleRoster()` — pure data |
| `src/data/tuning.ts` | Full `TUNING` const (physics/drift/items/ai/quality) per [01-architecture.md](./01-architecture.md) §6 + §10; every later phase imports from here |
| `src/core/RaceConfig.ts` | Immutable `{ characterId, vehicleId, mapId }` + `createRaceConfig()` with roster validation |
| `src/data/tracks/greenhollow-meadows.ts` | `TrackDefinition` for `meadows`, display name "Greenhollow Meadows" (data only — no mesh code yet; IP-safe naming per [09-phase-7-final-qa.md](./09-phase-7-final-qa.md) gate decision) |
| `src/data/tracks/lava-lagoon-loop.ts` | `TrackDefinition` for `lagoon` (data only — no mesh code yet) |
| `src/ui/CharacterSelect.ts` | DOM grid of 4 cards, arrow-key + click nav, animated stat bars, confirm → VehicleSelect |
| `src/ui/VehicleSelect.ts` | 3 vehicle cards with modifier badges + combined stat bars; confirm → MapSelect |
| `src/ui/MapSelect.ts` | 2 map preview cards (palette swatch strip + name + difficulty); confirm assembles `RaceConfig` → Countdown |
| `src/styles/selection.css` | Card grid, hover/selected states, stat bar segments, keyboard focus ring |
| `src/main.ts` *(modify)* | Register the three screens in `GameApp`; extend `window.__game.snapshot()` to include `raceConfig` |
| `tests/unit/characters.test.ts` | Roster shape + validation tests |
| `tests/unit/vehicles.test.ts` | Vehicle roster + 12 combinedStats clamp cases |
| `tests/unit/raceConfig.test.ts` | Config assembly, rejection, immutability |
| `tests/unit/tuning.test.ts` | All TUNING values finite; stat ranges hold |
| `tests/unit/tracks-data.test.ts` | Both track definitions structurally valid |
| `tests/e2e/selection.spec.ts` | Full 3-screen walk + Back navigation |

## Interfaces & signatures (full TS code blocks, adapted from [01-architecture.md](./01-architecture.md) §4)

All logic types use plain records — **not** Babylon vectors:

```ts
// src/data/characters.ts
export interface CharacterDef {
  readonly id: string;
  readonly name: string;
  // punSource is an internal comment only — it must NEVER be rendered in the UI (IP safety, overview §2)
  readonly stats: Readonly<{ accel: number; topSpeed: number; handling: number; offRoad: number }>; // each 1–5
  readonly color: [number, number, number]; // RGB 0..1, kart body tint
}

export const CHARACTER_ROSTER: readonly CharacterDef[]; // exactly marvin / louie / pearl / terry

/** Throws Error on duplicate ids or any stat outside 1..5. Returns the roster when valid. */
export function validateCharacterRoster(roster: ReadonlyArray<CharacterDef>): readonly CharacterDef[];
```

Stat vectors (from [00-overview.md](./00-overview.md) §3 — do not deviate):

| id | accel | topSpeed | handling | offRoad | color (body tint) |
|---|---|---|---|---|---|
| `marvin` | 3 | 3 | 3 | 3 | `[0.85, 0.16, 0.16]` red |
| `louie` | 4 | 2 | 4 | 5 | `[0.16, 0.72, 0.25]` green |
| `pearl` | 2 | 5 | 2 | 3 | `[0.98, 0.62, 0.82]` pink |
| `terry` | 1 | 4 | 2 | 4 | `[0.35, 0.22, 0.75]` purple |

```ts
// src/data/vehicles.ts
export interface VehicleDef {
  readonly id: string;
  readonly name: string;
  readonly type: "kart" | "bike" | "atv";
  // modifiers added to character stats, clamped to 1..5 by combinedStats(); each in -1..+1
  readonly modifiers: Readonly<{ accel: number; topSpeed: number; handling: number; offRoad: number }>;
}

export const VEHICLE_ROSTER: readonly VehicleDef[]; // exactly basher / zippy / quadzilla

/** character stats + vehicle modifiers, each axis clamped to [1, 5]. Throws if an id is unknown. */
export function combinedStats(characterId: string, vehicleId: string): { accel: number; topSpeed: number; handling: number; offRoad: number };

/** Throws on duplicate ids or any modifier outside -1..+1. */
export function validateVehicleRoster(roster: ReadonlyArray<VehicleDef>): readonly VehicleDef[];
```

Modifier table (from [00-overview.md](./00-overview.md) §3): `basher` = all 0; `zippy` = accel +1, topSpeed −1, handling +1, offRoad 0; `quadzilla` = accel −1, topSpeed +1, handling −1, offRoad +1.

```ts
// src/core/RaceConfig.ts
export interface RaceConfig {
  readonly characterId: string;
  readonly vehicleId: string;
  readonly mapId: string;
}

/** Validates all three ids against the rosters (throws Error otherwise), then Object.freeze()s and returns. */
export function createRaceConfig(characterId: string, vehicleId: string, mapId: string): RaceConfig;
```

Track data shape — implements [00-overview.md](./00-overview.md) §6 `TrackDefinition`:

```ts
// src/data/tracks/shared.ts (new small file for the shared types used by both track files)
import type { Vec2 } from "../core/Vec.js"; // Phase 1 location of the plain-record Vec2/Vec3 types

export interface TrackTheme {
  readonly groundColor: string;   // hex, e.g. "#3fa34d"
  readonly accentColor: string;   // hex — props/lava accents
  readonly skyTop: string;        // hex gradient top
  readonly skyBottom: string;     // hex gradient bottom
  readonly fogColor: string;      // hex
  readonly fogDensity: number;    // per-meter exponential density
  readonly sunIntensity: number;  // directional light intensity
  readonly ambientIntensity: number;
}

export interface ItemBoxCluster { readonly t: number; readonly lateralOffset?: number }
export interface HazardPlacement { readonly kind: "oilSlick"; readonly t: number; readonly lateralOffset: number; readonly size: number }
export type PropKind = "tree" | "mushroom" | "sign" | "flower" | "rock" | "geyser" | "torch" | "crystal";
export interface PropSpawn { readonly kind: PropKind; readonly t: number; readonly lateralOffset: number; readonly scale?: number; readonly rotationY?: number }

export interface TrackDefinition {
  readonly id: string;
  readonly name: string;
  readonly laps: number;                 // always 3 in this project
  readonly roadWidth: number;            // meters
  readonly controlPoints: Vec2[];        // Catmull-Rom loop, XZ plane (y=0)
  readonly theme: TrackTheme;
  readonly itemBoxClusters: ItemBoxCluster[];
  readonly hazards: HazardPlacement[];
  readonly propCatalog: PropSpawn[];
}

/** Throws on structural problems: <8 control points, t outside [0,1), non-finite numbers, laps !== 3. */
export function validateTrackDefinition(track: TrackDefinition): void;
```

Screen contract (from [01-architecture.md](./01-architecture.md) §8 — each screen implements `IGameScreen`):

```ts
// Each of CharacterSelect / VehicleSelect / MapSelect is a class implementing IGameScreen.
// enter(ctx: GameContext) builds the DOM into ctx.uiRoot; exit() tears it down and removes key listeners.
// Navigation is done ONLY by emitting { to } on the "ui:navigate" event channel (architecture §5).
```

## Step-by-step tasks

Each step ends with its tests green before you start the next one.

### Task 1 — `src/data/characters.ts` + `src/data/vehicles.ts` (+ unit tests)

1. Create `src/data/characters.ts`. Define `CharacterDef`, then `CHARACTER_ROSTER` with exactly the four characters and stat vectors from the table above. Add a short internal comment per character noting its pun archetype (e.g. `// balanced all-rounder, red-cap plumber pun`) — **never** render this in UI.
2. Implement `validateCharacterRoster(roster)`: throw `Error("duplicate character id: " + id)` on duplicate ids; throw `Error("character <id> stat <axis> out of range 1..5")` for any non-integer or out-of-range stat. Call it at module load (`validateCharacterRoster(CHARACTER_ROSTER)`) so a bad roster fails fast in dev and tests.
3. Create `src/data/vehicles.ts` the same way: `VEHICLE_ROSTER` with `basher` / `zippy` / `quadzilla`, `validateVehicleRoster()` (duplicate ids, modifier outside −1..+1), module-load validation.
4. Implement `combinedStats(characterId, vehicleId)`:

```ts
export function combinedStats(characterId: string, vehicleId: string): CombinedStats {
  const c = CHARACTER_ROSTER.find((x) => x.id === characterId);
  const v = VEHICLE_ROSTER.find((x) => x.id === vehicleId);
  if (!c || !v) throw new Error(`unknown id in combinedStats: ${characterId}/${vehicleId}`);
  const clamp = (n: number) => Math.min(5, Math.max(1, n));
  return {
    accel: clamp(c.stats.accel + v.modifiers.accel),
    topSpeed: clamp(c.stats.topSpeed + v.modifiers.topSpeed),
    handling: clamp(c.stats.handling + v.modifiers.handling),
    offRoad: clamp(c.stats.offRoad + v.modifiers.offRoad),
  };
}
```

5. Write `tests/unit/characters.test.ts` and `tests/unit/vehicles.test.ts` (specs in [Test list](#test-list)). Run `npm test` → green.

### Task 2 — `src/data/tuning.ts` (+ unit test)

Create the file **now** with the full table from [01-architecture.md](./01-architecture.md) §6, filling in the `quality` section per §10:

```ts
// src/data/tuning.ts — ALL gameplay magic numbers live here. No other file may contain a raw gameplay constant.
export const TUNING = {
  physics: { maxSpeedBase: 30, accelBase: 12, brakeForce: 25, reverseMax: -8, steerRateBase: 2.4, offRoadDrag: 0.92 },
  drift:   { charge1Time: 0.6, charge2Time: 1.4, miniBoostSpeed: 38, superBoostSpeed: 46, boostDuration: 0.8 },
  items:   { shroomBoost: 40, starDuration: 6, lightningShrink: 5, bananaSkid: 1.0, shellBounceMax: 3 },
  ai:      { rubberBandFactor: 0.06, speedVariance: 0.08, waypointLookahead: 12 },
  quality: {
    low:    { shadowMapSize: 0, ssao: false, bloom: false, particleBudget: 0.35, pixelRatioCap: 1,   propDensity: 0.4 },
    medium: { shadowMapSize: 1024, ssao: true,  bloom: true,  particleBudget: 0.7,  pixelRatioCap: 1.5, propDensity: 0.7 },
    high:   { shadowMapSize: 2048, ssao: true,  bloom: true,  particleBudget: 1.0,  pixelRatioCap: Infinity, propDensity: 1.0 },
  },
} as const;

export type QualityPreset = keyof typeof TUNING.quality; // "low" | "medium" | "high"
```

> Phase 3 will add a `camera` section to this same file (chase-camera smoothing). Do not scatter camera constants elsewhere.

Write `tests/unit/tuning.test.ts`: recursively walk `TUNING`, assert every **numeric** leaf is finite — with one documented exception: `quality.high.pixelRatioCap` is `Infinity` (unbounded on high preset), and the `ssao`/`bloom` leaves are boolean feature flags, not numbers; assert stat-relevant ranges hold (`offRoadDrag < 1 && > 0`, `charge1Time < charge2Time`, `miniBoostSpeed < superBoostSpeed`, quality presets ordered low ≤ medium ≤ high for each numeric field). Run `npm test` → green.

### Task 3 — `src/core/RaceConfig.ts` (+ unit test)

```ts
import { CHARACTER_ROSTER } from "../data/characters.js";
import { VEHICLE_ROSTER } from "../data/vehicles.js";
import { MEADOWS_TRACK, LAGOON_TRACK } from "../data/tracks/index.js"; // created in Task 4; see note below

export interface RaceConfig { readonly characterId: string; readonly vehicleId: string; readonly mapId: string }

const MAP_IDS = new Set([MEADOWS_TRACK.id, LAGOON_TRACK.id]);

export function createRaceConfig(characterId: string, vehicleId: string, mapId: string): RaceConfig {
  if (!CHARACTER_ROSTER.some((c) => c.id === characterId)) throw new Error(`unknown characterId: ${characterId}`);
  if (!VEHICLE_ROSTER.some((v) => v.id === vehicleId)) throw new Error(`unknown vehicleId: ${vehicleId}`);
  if (!MAP_IDS.has(mapId)) throw new Error(`unknown mapId: ${mapId}`);
  return Object.freeze({ characterId, vehicleId, mapId });
}
```

> Ordering note: `RaceConfig` imports the track ids. If you prefer not to depend on Task 4 yet, create a one-line `src/data/tracks/index.ts` barrel in this task that re-exports both track files once they exist — or simply do Tasks 3 and 4 back-to-back; both land before any screen work.

Write `tests/unit/raceConfig.test.ts` (specs below). Run `npm test` → green.

### Task 4 — Track data files (+ unit tests)

Create `src/data/tracks/greenhollow-meadows.ts` and `src/data/tracks/lava-lagoon-loop.ts`, each default-exporting a `TrackDefinition`. (File named for the display name — IP-safe per [09-phase-7-final-qa.md](./09-phase-7-final-qa.md) gate decision.) Use the shared types from `src/data/tracks/shared.ts` (Task 1's file, or split it out now). Full data below — copy verbatim; these are the real control points.

**Meadows** (`roadWidth: 12`, wide beginner oval with two gentle S-bends, spanning ≈ ±40 m X / ±29 m Z):

```ts
export const MEADOWS_TRACK: TrackDefinition = {
  id: "meadows",
  name: "Greenhollow Meadows",
  laps: 3,
  roadWidth: 12,
  controlPoints: [
    { x: 40, z: 0 },   // start/finish on the east straight
    { x: 35, z: 14 },  // S-bend 1: tuck in
    { x: 24, z: 26 },
    { x: 8, z: 29 },
    { x: -8, z: 27 },
    { x: -24, z: 29 }, // S-bend 1: bulge out (north side)
    { x: -35, z: 16 },
    { x: -40, z: 0 },
    { x: -34, z: -13 },// S-bend 2: tuck in
    { x: -22, z: -26 },
    { x: -6, z: -28 },
    { x: 10, z: -27 }, // S-bend 2: bulge out (south side)
  ],
  theme: {
    groundColor: "#3fa34d", accentColor: "#e8c547",
    skyTop: "#aee3ff", skyBottom: "#fdf6c9",   // light blue → pale yellow
    fogColor: "#eaf6ff", fogDensity: 0.002,    // very light
    sunIntensity: 1.0, ambientIntensity: 0.55,
  },
  itemBoxClusters: [ { t: 0.15 }, { t: 0.45 }, { t: 0.75 } ],
  hazards: [], // meadows has no hazards
  propCatalog: MEADOWS_PROPS,
};

// helper keeps the catalog compact; pure data, deterministic
const p = (kind: PropKind, t: number, lateralOffset: number, scale?: number): PropSpawn =>
  ({ kind, t, lateralOffset, ...(scale !== undefined ? { scale } : {}) });

export const MEADOWS_PROPS: PropSpawn[] = [
  // trees (13) — well outside the 6 m half-road-width
  p("tree", 0.02, 9),   p("tree", 0.07, -12), p("tree", 0.13, 10),  p("tree", 0.20, -9),
  p("tree", 0.26, 14),  p("tree", 0.33, -11), p("tree", 0.40, 9),   p("tree", 0.50, -13),
  p("tree", 0.58, 10),  p("tree", 0.66, -9),  p("tree", 0.74, 12),  p("tree", 0.82, -10),
  p("tree", 0.90, 9),
  // mushrooms (13)
  p("mushroom", 0.04, 8, 1.2),   p("mushroom", 0.10, -9),           p("mushroom", 0.17, 8.5, 1.4),
  p("mushroom", 0.24, -8),       p("mushroom", 0.31, 9, 1.1),       p("mushroom", 0.38, -8.5),
  p("mushroom", 0.46, 8, 1.3),   p("mushroom", 0.54, -9),           p("mushroom", 0.62, 8.5),
  p("mushroom", 0.70, -8, 1.2),  p("mushroom", 0.78, 9),            p("mushroom", 0.86, -8.5, 1.4),
  p("mushroom", 0.94, 8),
  // signs (4) — roadside markers near the road edge
  p("sign", 0.0, 7.5), p("sign", 0.25, -7.5), p("sign", 0.5, 7.5), p("sign", 0.75, -7.5),
  // flowers (12) — roadside garnish
  p("flower", 0.06, 8),   p("flower", 0.12, -8),  p("flower", 0.19, 8),   p("flower", 0.28, -8),
  p("flower", 0.36, 8),   p("flower", 0.44, -8),  p("flower", 0.52, 8),   p("flower", 0.60, -8),
  p("flower", 0.68, 8),   p("flower", 0.76, -8),  p("flower", 0.84, 8),   p("flower", 0.92, -8),
]; // 42 entries total
```

**Lagoon** (`roadWidth: 9`, tighter circuit with one hairpin (NW) and one chicane (NE), spanning ≈ ±35 m):

```ts
export const LAGOON_TRACK: TrackDefinition = {
  id: "lagoon",
  name: "Lava Lagoon Loop",
  laps: 3,
  roadWidth: 9,
  controlPoints: [
    { x: 0, z: -30 },   // start/finish on the south straight
    { x: 14, z: -28 },
    { x: 26, z: -20 },
    { x: 32, z: -8 },
    { x: 30, z: 4 },    // chicane entry (NE)
    { x: 22, z: 8 },    // chicane apex left
    { x: 28, z: 14 },   // chicane exit right
    { x: 24, z: 24 },
    { x: 12, z: 29 },
    { x: 0, z: 31 },
    { x: -12, z: 28 },
    { x: -22, z: 30 },  // hairpin entry (NW)
    { x: -30, z: 22 },  // hairpin apex
    { x: -26, z: 14 },  // hairpin exit — direction reverses here
    { x: -32, z: 2 },
    { x: -30, z: -12 },
  ],
  theme: {
    groundColor: "#2b2028", accentColor: "#ff5a1f",   // dark rock + orange-red lava accents
    skyTop: "#2a1440", skyBottom: "#ff7a3c",          // deep purple → orange
    fogColor: "#3a1e2e", fogDensity: 0.006,           // denser than meadows
    sunIntensity: 0.55, ambientIntensity: 0.4,        // dimmer, moodier rig
  },
  itemBoxClusters: [ { t: 0.1 }, { t: 0.35 }, { t: 0.6 }, { t: 0.85 } ],
  hazards: [
    { kind: "oilSlick", t: 0.3, lateralOffset: -2.0, size: 3.0 },
    { kind: "oilSlick", t: 0.7, lateralOffset: 2.5, size: 3.0 },
  ],
  propCatalog: LAGOON_PROPS,
};

export const LAGOON_PROPS: PropSpawn[] = [
  // rocks (18) — scattered well off the 4.5 m half-road-width
  p("rock", 0.01, 9),    p("rock", 0.05, -11),  p("rock", 0.09, 13),   p("rock", 0.14, -8),
  p("rock", 0.18, 10),   p("rock", 0.22, -9),   p("rock", 0.26, 15),   p("rock", 0.33, -12),
  p("rock", 0.40, 9),    p("rock", 0.44, -14),  p("rock", 0.47, 8),    p("rock", 0.55, 16),
  p("rock", 0.60, -10),  p("rock", 0.70, 12),   p("rock", 0.75, -15),  p("rock", 0.83, 9),
  p("rock", 0.90, -11),  p("rock", 0.96, 14),
  // geysers (6) — mid-field hazards/landmarks
  p("geyser", 0.12, -10), p("geyser", 0.30, 12),  p("geyser", 0.48, -11),
  p("geyser", 0.63, 10),  p("geyser", 0.80, -12), p("geyser", 0.95, 9),
  // torches (12) — roadside lighting, closest to the road edge
  p("torch", 0.03, 6),   p("torch", 0.10, -6),  p("torch", 0.17, 6),   p("torch", 0.24, -6),
  p("torch", 0.31, 6),   p("torch", 0.38, -6),  p("torch", 0.45, 6),   p("torch", 0.52, -6),
  p("torch", 0.59, 6),   p("torch", 0.66, -6),  p("torch", 0.73, 6),   p("torch", 0.80, -6),
  // crystals (9) — far-field sparkle accents
  p("crystal", 0.07, 14),  p("crystal", 0.20, -15), p("crystal", 0.35, 13),  p("crystal", 0.50, -14),
  p("crystal", 0.68, 15),  p("crystal", 0.78, -13), p("crystal", 0.88, 14),  p("crystal", 0.93, -12),
  p("crystal", 0.98, 13),
]; // 45 entries total
```

Also create `src/data/tracks/index.ts` re-exporting both tracks (used by `RaceConfig`). Write `tests/unit/tracks-data.test.ts` (specs below). Run `npm test` → green.

### Task 5 — `src/styles/selection.css`

Create the stylesheet with: `.select-screen` layout (title, card grid, footer hint bar); `.card` base + `:hover` lift; `.card.selected` glow/border; `.stat-bar` as a flex row of 5 `.stat-seg` segments (filled vs empty classes per axis value); `.badge-pos` / `.badge-neg` for vehicle modifier deltas (+1 green, −1 red); `.swatch-strip` for map palette swatches; and a visible keyboard focus ring:

```css
.card:focus-visible { outline: 3px solid #ffd23f; outline-offset: 2px; }
```

Import it from `src/main.ts` alongside existing styles. Every interactive element gets a `data-testid` (listed per screen below) so Playwright never needs text matching.

### Task 6 — `CharacterSelect` with stub confirm (+ e2e)

1. Create `src/ui/CharacterSelect.ts` implementing `IGameScreen`:
   - `enter(ctx)`: build `<div class="select-screen" data-testid="character-select">` containing a title, a `.card-grid` of 4 cards — one per roster entry, each with `data-testid="char-card-{id}"`, the character name (never the pun source), and a stat-bar block.
   - **Stat bars:** for each axis render `<div class="stat-bar" data-testid="char-stat-{axis}">` with 5 `.stat-seg` children; segments `1..stats[axis]` get class `filled`. On selection change, animate: add class `animating` and let CSS transition the segment fill (stagger via `transition-delay: calc(var(--i) * 60ms)`).
   - **Navigation:** arrow keys move a `selectedIdx` cursor in row-major order over the grid (Left/Right ±1 with wrap, Up/Down ±2 clamped); clicking a card selects it. The selected card gets `.selected` and receives DOM focus (for the focus ring + screen readers).
   - **Confirm:** Enter key or click on `<button data-testid="char-confirm">Confirm</button>` → emit `ui:navigate { to: "VehicleSelect" }` with the chosen id stashed in `ctx.pendingSelection = { characterId }`.
   - **Back:** Esc (or a Back button, `data-testid="char-back"`) → emit `ui:navigate { to: "MainMenu" }` per the state machine ([01-architecture.md](./01-architecture.md) §8).
2. For this step only, register a **stub** `VehicleSelect` screen in `GameApp`: a div with `data-testid="vehicle-select-stub"` and text showing the pending character id (read from `ctx.pendingSelection`). This keeps the navigation chain testable before the real screen exists.
3. Write the first half of `tests/e2e/selection.spec.ts`: menu → click Start → assert 4 cards visible → press ArrowRight twice + Enter → assert stub shows `characterId: "pearl"` (marvin→louie→pearl). Run `npm run test:e2e` → green.

### Task 7 — Real `VehicleSelect` (+ e2e)

1. Replace the stub with `src/ui/VehicleSelect.ts`:
   - Read `ctx.pendingSelection.characterId`; compute `combinedStats(characterId, vehicleId)` per card.
   - Render 3 cards (`data-testid="veh-card-{id}"`) each showing: name, type label (Kart/Bike/ATV), four modifier badges (`+1` / `−1`, hidden when 0; `data-testid="veh-mod-{axis}"`), and the **combined** stat bars for the selected character (same `.stat-bar` markup as Task 6).
   - Same arrow/click navigation pattern; Confirm → stash `vehicleId` in `ctx.pendingSelection`, emit `ui:navigate { to: "MapSelect" }`; Back → `{ to: "CharacterSelect" }`.
2. Extend the e2e spec: continue from pearl (or restart with marvin) → confirm a vehicle → assert MapSelect stub visible with both pending ids. Green before next task.

### Task 8 — `MapSelect` + RaceConfig assembly into GameContext (+ final e2e)

1. Create `src/ui/MapSelect.ts`:
   - Render 2 cards (`data-testid="map-card-{id}"`) from the track data files: a `.swatch-strip` of 4 swatches (ground, accent, skyTop, skyBottom — inline `background-color` styles), the map name, and a difficulty label ("Beginner" / "Intermediate").
   - Confirm → assemble and store the config, then navigate:

```ts
const cfg = createRaceConfig(
  ctx.pendingSelection.characterId,
  ctx.pendingSelection.vehicleId,
  track.id,
);
ctx.raceConfig = cfg; // GameContext field added in this phase (typed RaceConfig | null)
this.events.emit("ui:navigate", { to: "Countdown" });
```

   - Back → `{ to: "VehicleSelect" }`.
2. In `src/main.ts`, extend the existing `window.__game` handle so `snapshot()` includes `raceConfig: ctx.raceConfig ?? null` (Playwright asserts on it via `page.evaluate`).
3. Final e2e walk in `tests/e2e/selection.spec.ts`:

```ts
// menu → Start → marvin → confirm → zippy → confirm → meadows → confirm → countdown stub visible
await page.getByTestId("menu-start").click();
for (const [testid, key] of [["char-card-marvin", "Enter"], ["veh-card-zippy", "Enter"], ["map-card-meadows", "Enter"]] as const) {
  await page.getByTestId(testid).click();
  await page.keyboard.press(key);
}
await expect(page.getByTestId("countdown-stub")).toBeVisible(); // Phase 1 stub screen
const cfg = await page.evaluate(() => window.__game.snapshot().raceConfig);
expect(cfg).toEqual({ characterId: "marvin", vehicleId: "zippy", mapId: "meadows" });

// Back navigation one level: from MapSelect, Esc returns to VehicleSelect with selection preserved
await page.getByTestId("map-back").click();
await expect(page.getByTestId("vehicle-select")).toBeVisible();
```

4. Run the full suite: `npm run lint && npx tsc --noEmit && npm test && npm run test:e2e` → all green. Phase 2 done.

## Acceptance criteria

From [00-overview.md](./00-overview.md) §7, P2 row — **all must pass**:

1. Data-validation unit tests green: `characters.test.ts`, `vehicles.test.ts`, `tracks-data.test.ts` (roster shape, stat ranges, validation throws on tampered copies).
2. Config-assembly unit test green: `raceConfig.test.ts` (valid accepted; unknown id rejected; immutability verified).
3. E2E: navigate all 3 selects — full walk menu → character → vehicle → map → Countdown stub with a valid `raceConfig` in the snapshot, plus Back navigation one level.
4. **Manual check:** all three selects are fully navigable with **keyboard AND mouse** (arrow keys + Enter/Esc; click cards + Confirm/Back buttons), stat bars animate on selection, focus ring visible when tabbing/arrowing.
5. Definition of Done ([00-overview.md](./00-overview.md) §8): lint 0 errors/warnings, `tsc --noEmit` clean, no new TODO/FIXME, no Babylon imports in any `src/data/**` or `src/core/RaceConfig.ts` file.

## Test list

| File | Cases |
|---|---|
| `tests/unit/characters.test.ts` | Roster has exactly 4 entries with unique ids `{marvin, louie, pearl, terry}`; every stat is an integer in 1..5 and matches the overview table (assert marvin = 3/3/3/3, louie = 4/2/4/5, pearl = 2/5/2/3, terry = 1/4/2/4); each `color` is a 3-tuple of numbers in 0..1; `validateCharacterRoster` throws on a tampered copy with a duplicate id and on a tampered copy with `stats.accel = 6`; returns the roster unchanged when valid |
| `tests/unit/vehicles.test.ts` | Roster has exactly 3 entries `{basher, zippy, quadzilla}` with correct types (`kart`/`bike`/`atv`) and modifier values from the overview table; all modifiers in −1..+1; **combinedStats clamps to 1–5 for every character×vehicle pair — 12 cases via nested loop** over both rosters, asserting each axis ∈ [1,5] (spot-assert: terry+basher accel = 1 stays 1 after −0; louie+zippy topSpeed = 2−1 → clamped to 1; pearl+quadzilla topSpeed = 5+1 → clamped to 5); unknown id throws |
| `tests/unit/raceConfig.test.ts` | Valid config accepted and fields round-trip; each of the three ids rejected individually with a descriptive error when unknown (`"nope"` character, `"hovercraft"` vehicle, `"moonbase"` map); immutability: returned object is frozen — assignment throws in strict mode (`expect(() => { cfg.characterId = "x" }).toThrow()` under `Object.isFrozen` check) and `Object.isFrozen(cfg)` is true |
| `tests/unit/tuning.test.ts` | Recursive walk: every leaf of `TUNING` is a finite number; `offRoadDrag ∈ (0,1)`; `charge1Time < charge2Time`; `miniBoostSpeed < superBoostSpeed`; quality presets monotonic low ≤ medium ≤ high for shadowMapSize/particleBudget/propDensity |
| `tests/unit/tracks-data.test.ts` | For **both** tracks: `controlPoints.length ≥ 8`; all points finite; every cluster/hazard/prop has `t ∈ [0,1)` and finite `lateralOffset`; prop kinds are from the allowed set per map (meadows ⊆ {tree, mushroom, sign, flower}; lagoon ⊆ {rock, geyser, torch, crystal}); `laps === 3`; `roadWidth > 0`; meadows has 0 hazards and exactly 3 clusters; lagoon has exactly 2 oil-slick hazards and 4 clusters; `validateTrackDefinition` throws on a tampered copy (e.g. one control point removed below 8, or a prop with `t: 1.5`) |
| `tests/e2e/selection.spec.ts` | **Full walk:** menu → Start → select marvin → confirm → select zippy → confirm → select meadows → confirm → Countdown stub visible AND `window.__game.snapshot().raceConfig` equals `{marvin, zippy, meadows}`; **Back navigation one level:** from MapSelect, Back returns to VehicleSelect with the vehicle selection still highlighted; keyboard-only variant: complete character + vehicle selection using only ArrowRight/Enter keys |

## As-built deviations (Phase 2 completion notes)

All exit gates green at completion: lint ✓ · `tsc --noEmit` ✓ · **174 unit tests / 9 files** ✓ · build ✓ · **12 e2e tests** ✓. No Babylon imports in `src/data/**` or `src/core/RaceConfig.ts`.

1. **Shared helper module added:** the three screens share `src/ui/selectionHelpers.ts` (`buildSelectionShell`, `buildStatBar`, `CardGridController`) instead of each screen re-implementing shell/stat-bar/cursor code — DRY without a framework. Not in the original file table; behavior matches spec exactly.
2. **Countdown stub is bespoke, not the generic StubScreen:** doc's e2e expects testid `countdown-stub`, but the Phase 1 `StubScreen` produces `screen-countdown`. A small `CountdownStub` class (in `GameApp.ts`) renders `data-testid="countdown-stub"` plus the assembled raceConfig text so e2e can assert on it in-DOM as well.
3. **Menu buttons gained testids:** `menu-start` / `menu-quit` added to `MenuScreen` (doc's final-walk snippet uses `getByTestId("menu-start")`; Phase 1 menu.spec used role-based locators and was updated accordingly).
4. **Doc e2e snippet flaw corrected:** the plan's "Back navigation one level" step runs *after* confirming meadows, i.e. from Countdown — but `Countdown` only transitions to `Racing`, so no Back button exists there. The back-nav assertion lives in its own dedicated test (MapSelect → Esc/Back → VehicleSelect with zippy still highlighted); the full-walk test ends at the countdown + raceConfig assertions.
5. **`tuning.test.ts` leaf walk:** "every leaf is a finite number" implemented as *numeric* leaves finite, with documented exceptions — booleans (`ssao`, `bloom`) are allowed and `pixelRatioCap: Infinity` on the high preset is skipped by path (this doc's test-list line was corrected to match).
6. **Grid layout classes:** `.card-grid.grid-1` (3 columns) added for VehicleSelect/MapSelect single-row layouts; Up/Down are clamped no-ops there, Left/Right wrap — matches `CardGridController` semantics.
7. **VehicleSelect subtitle** shows the selected character's *display name* (e.g. "Pearl"), never an id or pun source (IP safety).
8. **Map difficulty labels** ("Beginner"/"Intermediate") are presentation metadata in `MapSelect.ts`, deliberately kept out of the pure track data layer.
