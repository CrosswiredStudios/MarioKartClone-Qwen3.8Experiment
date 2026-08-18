# Phase 4 — Race Loop & AI

> **Execution guide (forward-looking).** This phase is NOT yet implemented. It depends on Phases 1–3 being complete: `EventBus` / `GameStateMachine` / `FixedTimestepLoop` / input abstraction (P1), roster data + selection screens + immutable `RaceConfig` (P2), and `TrackSpline` / `KartPhysics` / drift / chase camera / lap tracking / `QualityManager` (P3). Source of truth: [`00-overview.md`](./00-overview.md) and [`01-architecture.md`](./01-architecture.md). If this doc needs to change architecture, update `01-architecture.md` in the same commit.

## Goal

Turn the Phase 3 free-drive prototype into a complete race: **countdown → 3 laps vs 3 AI opponents → results screen**, with live standings, full HUD (position, lap times, item slot, speedometer, minimap), Esc-pause with persisted settings, and a deterministic headless simulation that proves a whole race runs to completion. Exit gate = the P4 row in [`00-overview.md`](./00-overview.md) §7: *headless full-race simulation unit test green; e2e: complete flow via scripted keys reaches results.*

Out of scope for this phase (do NOT build): item boxes/weapons (Phase 5), particles/post-processing/podium animation/full music composition (Phase 6). The HUD item slot exists but always shows "?" — Phase 5 fills it. MusicSequencer themes are **stubbed** as simple looping oscillator patterns; full chiptune composition lands in Phase 6 behind the same `playTheme()` interface.

## Files to create / modify

| Path | Purpose |
|---|---|
| `src/race/RaceController.ts` | Owns race lifecycle inside Countdown→Racing: builds karts from `RaceConfig`, grid placement, countdown, per-step orchestration (input → AI → physics → drift → laps), standings timer, finish + AI timeout logic. Emits all `race:*` events. |
| `src/race/StandingsCalculator.ts` | Pure `computeStandings(karts, spline)` — rank by (lap desc, checkpointIdx desc, t desc), ties broken by kart id. |
| `src/entities/WaypointAiStrategy.ts` | `IAiStrategy` implementation: waypoint following + throttle scaling; also exports the pure `rubberBandMultiplier()` helper used by `RaceController`. |
| `src/ui/Hud.ts` | DOM overlay shown during Racing: position, lap counter, current/best lap time, item slot (canvas icons), SVG speedometer, minimap canvas. Exports pure `formatTimeMs()`. |
| `src/ui/PauseMenu.ts` | Esc-during-Racing overlay: Resume / Settings / Quit to Menu; ducks music to 30%. |
| `src/ui/SettingsPanel.ts` | Sliders + quality preset buttons wired live to `AudioManager` buses and `QualityManager.apply()`. |
| `src/ui/SettingsStore.ts` | localStorage-backed settings persistence (key `"ttr.settings"`), validated on read, defaults fallback. Unit-tested. |
| `src/ui/ResultsScreen.ts` | Final standings table + player per-lap times; Race Again / Main Menu buttons; Phase 6 podium extension point. |
| `src/data/tuning.ts` *(modify)* | Add the `race` block (see Interfaces). No raw gameplay constants anywhere else. |
| `src/entities/KartEntity.ts` *(modify)* | Add readonly `topSpeedScale` and mutable `accelScale` fields (AI skill + rubber-band hooks; see Step 2/3). |
| `src/entities/KartPhysics.ts` *(modify)* | Multiply stat-derived maxSpeed by `topSpeedScale` and accel by `accelScale` inside `stepKart`. Two-line change, covered by existing physics tests. |
| `src/core/GameApp.ts` *(modify)* | Skip dispatch while `machine.currentId === "Paused"`; route `race:finished` → Results screen; construct/tear down `RaceController` on Countdown enter / quit. |
| `src/main.ts` *(modify)* | Extend `window.__game` with `state`, `standings()`, `karts()` and the debug-only `aiDrivePlayer()` hook (see Step 12). |
| `tests/unit/standings.test.ts` | StandingsCalculator ordering + tie-break tests. |
| `tests/unit/waypointAi.test.ts` | Headless AI-follows-spline test against the real Meadows spline. |
| `tests/unit/headlessRace.test.ts` | **The key test**: full 3-lap headless race + determinism (see Step 4). |
| `tests/unit/format-time.test.ts` | `formatTimeMs` edge cases. |
| `tests/unit/settingsStore.test.ts` | Load/save/validate/fallback tests for SettingsStore. |
| `tests/e2e/full-race.spec.ts` | Menu → selects → countdown → AI-driven 3 laps → results table assertions (see Step 13). |

## Interfaces & signatures

Adapted from [`01-architecture.md`](./01-architecture.md) §4/§5. Plain records only — no Babylon types in logic files.

```ts
// ── entities/KartPhysics.ts (from Phase 3, unchanged contract) ─────────────
type SurfaceKind = "road" | "offRoad" | "oilSlick";

interface DriveInput {
  readonly throttle: number;   // -1..1 (negative = brake/reverse)
  readonly steer: number;      // -1..1
  readonly drifting: boolean;  // Space held while turning
  readonly useItem: boolean;   // edge-triggered, consumed by RaceController (Phase 5 uses it)
}

interface KartState {
  pos: Vec3; heading: number; speed: number;        // meters, radians, m/s (signed)
  lap: number; checkpointIdx: number;               // 0-based; lap is 1-based current lap
  item: ItemId | null;                              // always null in Phase 4
  statusEffects: StatusEffect[];                    // empty in Phase 4 (Phase 5 fills it)
  driftCharge: DriftChargeState;
  speedRatio: number;                               // 0..1 normalized top speed
}

function stepKart(state: KartState, input: DriveInput, surface: SurfaceKind, dt: number): KartState;

// ── Phase 4 additions to entities/KartEntity.ts ─────────────────────────────
class KartEntity {
  readonly id: KartId;              // "player" for the human kart, else the AI characterId
  readonly name: string;            // display name from CHARACTER_ROSTER
  state: KartState;                 // mutable ONLY inside RaceController.update(dt)
  readonly topSpeedScale: number;   // player = 1.0; AI = seeded skill factor in [1−v, 1+v]
  accelScale: number;               // rubber-band multiplier, rewritten by RaceController each step (default 1)
}

// ── tracks/TrackSpline.ts + tracks/LapTracker.ts (Phase 3, unchanged contract) ─
class TrackSpline {
  constructor(controlPoints: Vec2[], samplesPerSegment: number);
  readonly length: number;                       // total arc length, meters
  pointAt(t: number): Vec3;                      // t in 0..1 along loop
  tangentAt(t: number): Vec2;                    // unit tangent
  closestPoint(p: Vec2): { t: number; distance: number; onRoad: boolean };
}

interface LapState { lap: number; lastCheckpointIdx: number }
function onCheckpoint(state: LapState, checkpointIdx: number, totalCheckpoints: number):
  { state: LapState; lapCompleted?: boolean; raceFinished?: boolean };

// ── entities/IAiStrategy.ts (DIP — from architecture §4) ────────────────────
interface RaceView { readonly standings: ReadonlyArray<{ id: KartId; lap: number; progress: number }> }
interface IAiStrategy { decide(kart: KartEntity, view: RaceView, dt: number): DriveInput }

// ── race/StandingsCalculator.ts (pure) ──────────────────────────────────────
function computeStandings(
  karts: ReadonlyArray<KartEntity>,
  spline: TrackSpline,
): Array<{ id: KartId; rank: number }>;   // rank 1 = leader

// ── race/RaceController.ts (new) ────────────────────────────────────────────
interface AiRacerDef { readonly characterId: CharacterId; readonly vehicleId: VehicleId }

interface RaceOptions {
  config: RaceConfig;                 // immutable { characterId, vehicleId, mapId } from Phase 2
  track: TrackDefinition;             // loaded by id from src/data/tracks/
  spline: TrackSpline;                // built from track.controlPoints (Phase 3 constructor)
  bus: EventBus<GameEvents>;
  rng: Rng;                           // createRng(seed) — architecture §9, NEVER Math.random()
  input?: IInputSource;               // required when renderEnabled !== false
  aiFactory?: (def: AiRacerDef) => IAiStrategy;   // default: WaypointAiStrategy w/ skill factor from rng
  renderEnabled?: boolean;            // false → headless: no HUD/audio/renderer side effects
}

class RaceController {
  constructor(opts: RaceOptions);
  readonly phase: "countdown" | "racing" | "finished";
  /** One fixed logic step (dt = 1/60). Called by GameApp, or manually in headless tests. */
  update(dt: number): void;
  standings(): Array<{ id: KartId; name: string; rank: number; lap: number; t: number }>;
  karts(): ReadonlyArray<KartEntity>;
}

// ── ui/SettingsStore.ts (new) ───────────────────────────────────────────────
interface Settings {
  quality: "low" | "medium" | "high";
  masterVolume: number;   // 0..1
  musicVolume: number;    // 0..1
  sfxVolume: number;      // 0..1
  muted: boolean;
}
const DEFAULT_SETTINGS: Settings;   // { quality:"medium", masterVolume:0.8, musicVolume:0.7, sfxVolume:0.9, muted:false }

class SettingsStore {
  load(): Settings;                 // reads "ttr.settings" JSON; validates shape; defaults on any error
  save(s: Settings): void;          // JSON.stringify to "ttr.settings"
}

// ── ui/Hud.ts (new) ─────────────────────────────────────────────────────────
export function formatTimeMs(ms: number): string;   // pure, exported for tests → "mm:ss.mmm"

class Hud {
  constructor(bus: EventBus<GameEvents>, getRace: () => RaceController | null);
  show(): void; hide(): void;       // shown while machine state is Racing/Paused
}

// ── ui/ResultsScreen.ts (new) ───────────────────────────────────────────────
interface FinalStanding { readonly id: KartId; readonly name: string; readonly rank: number; readonly totalMs: number | null }  // null = DNF/timed out

/** Phase 6 extension point — podium animation + confetti + fanfare attach here. No-op until Phase 6 assigns it. */
export type PodiumHook = (standings: FinalStanding[]) => void;

// ── window.__game (extended in main.ts) ─────────────────────────────────────
interface GameDebugHandle {
  state: string;                                   // current GameStateMachine id, kept fresh each frame
  standings(): Array<{ id: string; name: string; rank: number; lap: number; t: number }>;
  karts(): Array<{ id: string; pos: Vec3; speed: number; lap: number; item: ItemId | null }>;
  aiDrivePlayer?(): void;                          // DEBUG ONLY — see Step 12
}

// ── TUNING additions (src/data/tuning.ts) ───────────────────────────────────
race: {
  countdownSeconds: 3,        // 3-2-1-GO at 1 s intervals
  checkpointsPerLap: 8,       // checkpointIdx = floor(t * 8) % 8
  standingsIntervalSec: 1,    // standings recomputed once per second, not every frame (see Step 4)
  aiFinishTimeoutSec: 10,     // grace period after the player finishes before AI are timed out
}
```

**Event catalog used this phase** (full table in [`01-architecture.md`](./01-architecture.md) §5): `race:countdownTick {remaining}`, `race:start {}`, `race:lapCompleted {kartId, lap, timeMs}`, `race:finished {standings, times}`, plus existing `ui:navigate`. Phase 4 emits no item/kart events yet — those are wired in Phase 5.

**AI vehicle mapping (fixed table, defined here):** the player's three AI opponents are always the other roster characters, each on a fixed vehicle:

| AI character | Vehicle |
|---|---|
| `louie` | `zippy` |
| `pearl` | `basher` |
| `terry` | `quadzilla` |

The player's own vehicle comes from `RaceConfig.vehicleId`. This table lives as a const in `RaceController.ts` (it is content, not tuning — no gameplay numbers).

## Step-by-step tasks

Each step ends green: `npm run lint`, `npx tsc --noEmit`, `npm test` all pass before starting the next.

### Step 1 — StandingsCalculator + tests

Create `src/race/StandingsCalculator.ts`. Pure function, no imports beyond types and `TrackSpline`:

```ts
export function computeStandings(karts: ReadonlyArray<KartEntity>, spline: TrackSpline) {
  const rows = karts.map((k) => ({ id: k.id, t: spline.closestPoint(k.state.pos).t }));
  rows.sort((a, b) => {
    const ka = kartById(a.id), kb = kartById(b.id);           // helper closure over `karts`
    if (ka.state.lap !== kb.state.lap) return kb.state.lap - ka.state.lap;          // lap desc
    if (ka.state.checkpointIdx !== kb.state.checkpointIdx)
      return kb.state.checkpointIdx - ka.state.checkpointIdx;                       // checkpoint desc
    if (a.t !== b.t) return b.t - a.t;                                              // spline t desc
    return a.id < b.id ? -1 : 1;                                                    // tie → kart id asc (determinism)
  });
  return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
}
```

Why this ordering: `lap` and `checkpointIdx` are coarse progress that never regresses within a lap; `t` refines it. Kart-id tie-break makes output identical across runs for identical inputs (architecture §9 determinism).

Write `tests/unit/standings.test.ts`: leader/mid/trailer ordering on the real Meadows spline; same-lap different-checkpoint case; same-checkpoint different-t case; exact-tie broken by id; 4-kart full permutation sanity. **Done when:** tests green.

### Step 2 — WaypointAiStrategy (headless-testable) + KartEntity scales

Add `topSpeedScale` / `accelScale` to `KartEntity` and the two multiplications in `stepKart` (maxSpeed × `topSpeedScale`, accel × `accelScale`). Player karts get `topSpeedScale = 1`.

Create `src/entities/WaypointAiStrategy.ts`:

```ts
export class WaypointAiStrategy implements IAiStrategy {
  constructor(private readonly spline: TrackSpline) {}

  decide(kart: KartEntity, _view: RaceView, _dt: number): DriveInput {
    const ownT = this.spline.closestPoint(kart.state.pos).t;
    // Lookahead in meters grows with speed so the target stays ahead at high velocity.
    const lookAheadM = TUNING.ai.waypointLookahead * (0.5 + kart.state.speedRatio);
    const targetT = (ownT + lookAheadM / this.spline.length) % 1;
    const w = this.spline.pointAt(targetT);

    // Signed angle error to the waypoint, normalized to (-π, π].
    const desired = Math.atan2(w.x - kart.state.pos.x, w.z - kart.state.pos.z);
    const err = normalizeAngle(desired - kart.state.heading);   // helper: ((a + π) % 2π + 2π) % 2π − π

    const steer = clamp(err, -1, 1);                            // clamped signed angle error
    // Full throttle on track; past 0.5 rad of error, scale down proportionally to a floor of 0.25.
    const throttle = Math.abs(err) <= 0.5 ? 1 : Math.max(0.25, 1 - (Math.abs(err) - 0.5));
    return { throttle, steer, drifting: false, useItem: false }; // AI never handbrakes or drifts in Phase 4
  }
}

/** Pure rubber-band helper (used by RaceController, not the strategy). */
export function rubberBandMultiplier(gapMeters: number): number {
  // gapMeters > 0 → AI behind player. Linear ±TUNING.ai.rubberBandFactor per 50 m, capped at ±25%.
  return clamp(1 + (TUNING.ai.rubberBandFactor * gapMeters) / 50, 0.75, 1.25);
}
```

**Skill factor:** when `RaceController` builds an AI kart it draws one value per racer from the seeded RNG: `skill = 1 + rng.range(-TUNING.ai.speedVariance, TUNING.ai.speedVariance)` (i.e. `[0.92, 1.08]`) and stores it as that entity's `topSpeedScale`. This is why the scale lives on the entity rather than in the strategy: physics owns speed caps, the strategy only produces `DriveInput` (ISP — architecture §3).

**Rubber-banding formula (exact):** each step, for AI kart *a* with player *p*:
`gapMeters = progressM(p) − progressM(a)` where `progressM(k) = (k.state.lap − 1) * spline.length + t(k) * spline.length`. Then `a.accelScale = rubberBandMultiplier(gapMeters)`.

Why this keeps races close but winnable: the multiplier is linear and small (6% per 50 m at `rubberBandFactor = 0.06`), so a kart 100 m behind gets +12% accel — enough to close a gap over ~30 s, not enough to overtake instantly; the ±25% cap means even a huge gap never produces teleport-y acceleration. A kart *ahead* of the player gets a symmetric penalty (down to −25%), so an early lead erodes slowly instead of being uncatchable. Because it scales with *distance*, not rank, two AI karts bunched together behind the player get identical treatment — no artificial pack-splitting.

Write `tests/unit/waypointAi.test.ts` (headless, real Meadows spline): place a kart on the road at t=0, run 60 s of `decide()` + `stepKart()` in a loop; assert (a) distance from spline centerline stays < `roadWidth / 2` every step (never leaves the road), (b) total progress after 60 s > 1.5 laps at base speed, (c) `rubberBandMultiplier(0) === 1`, `rubberBandMultiplier(±∞)` clamps to exactly 0.75/1.25, and is monotonic in the gap. **Done when:** tests green.

### Step 3 — RaceController: construction, grid, countdown (no HUD yet)

Create `src/race/RaceController.ts`. Constructor responsibilities:

1. Build 4 `KartEntity`s from `RaceConfig`: player kart (`id: "player"`, config's character + vehicle stats via the Phase 2 stat-combination helper) and one AI per other roster character using the fixed vehicle table above, each with its seeded skill factor as `topSpeedScale`.
2. **Grid placement — reuse the Phase 3 grid offsets** (the same slot table used for free-drive start positions; see [`05-phase-3-track-system.md`](./05-phase-3-track-system.md)): 4 slots staggered behind the start/finish line along the spline with alternating lateral offset. Slot order is `[player, ai1, ai2, ai3]` → slots 0..3. All karts face `spline.tangentAt(slotT)`.
3. Start in phase `"countdown"` with a local timer at 0.

Countdown behavior (inside `update(dt)` while `phase === "countdown"`): advance the local timer; emit exactly one tick per integer second boundary — `race:countdownTick {remaining: 3}` at t=0, `{2}` at t=1, `{1}` at t=2 — and at t=`TUNING.race.countdownSeconds` emit `race:start {}`, switch phase to `"racing"`, and (only when `renderEnabled`) call `musicSequencer.playTheme("race")`. Karts are **frozen** during countdown: no `stepKart` calls, inputs ignored. The SfxPlayer beep on each tick is a HUD/audio-side subscription to `race:countdownTick` (Phase 1's skeleton already has the beep one-shot) — RaceController never touches audio directly when headless.

Music stubs: extend Phase 1's `MusicSequencer.playTheme(name)` with two trivial looping oscillator patterns (e.g., menu = alternating two-note square loop; race = four-note loop at a faster tempo). Mark both with a comment `// STUB — full composition lands in Phase 6`. The interface (`playTheme("menu" | "race")`, `stop()`) must already be final so Phase 6 swaps patterns only.

Wire in `GameApp`: on transition into `Countdown` construct the controller (seed = f(characterId, vehicleId, mapId) per architecture §9 — implement as a small pure hash of the three ids); dispatch its `update(dt)` from the active-screen update; on `ui:navigate` to MainMenu dispose it.

Verify this step **without HUD**: run `npm run dev`, start a race, and watch the console — add temporary `console.debug` lines (removed in Step 10) or use the existing `window.__game.state` to confirm: state is `Countdown` for ~3 s with three ticks logged, then `Racing`. **Done when:** manual check passes + lint/tsc/tests green.

### Step 4 — Full per-step loop + headless race test (the big one)

Extend `RaceController.update(dt)` for the `"racing"` phase. Exact order per fixed step:

1. **Player input** → `playerController.read()` produces a `DriveInput` (Phase 3's `PlayerController`; in headless mode this is a fake `IInputSource` or the AI-drive hook from Step 12).
2. **AI input** → for each AI kart: `aiStrategy.decide(kart, view, dt)`.
3. **Rubber-band** → recompute each AI's `accelScale` via `rubberBandMultiplier(gapMeters)` (formula in Step 2). Player's `accelScale` stays 1.
4. **Physics** → for every kart: `surface = classifySurface(kart)` then `kart.state = stepKart(kart.state, input, surface, dt)`. `classifySurface`: `cp = spline.closestPoint(pos)`; if a track oil-slick hazard (Lagoon data from Phase 3) covers the position → `"oilSlick"`, else `cp.onRoad ? "road" : "offRoad"`.
5. **Drift** → `updateDrift(...)` per kart; on release, apply the mini/super boost exactly as Phase 3 does in free drive (same code path — extract it if needed so both call sites share it).
6. **Lap tracking** → `checkpointIdx = floor(t * TUNING.race.checkpointsPerLap) % checkpointsPerLap`; feed `onCheckpoint(...)`; on `lapCompleted` compute `timeMs` from the controller's sim clock (delta since previous lap event for that kart), store it in a per-kart lap-time array, and emit `race:lapCompleted {kartId, lap, timeMs}`.
7. **Standings — recompute once per second, NOT every frame.** Accumulate `standingsTimer += dt`; when ≥ `TUNING.race.standingsIntervalSec`, subtract the interval and run `computeStandings`. Why not per-frame: (a) the only consumers are the HUD rank text and Phase 5's item tables — both fine at 1 Hz; (b) two karts within centimeters swap `t` ordering frame-to-frame under float noise, so per-frame ranks flicker visibly in the HUD; (c) a fixed 60-step interval keeps the headless simulation trivially deterministic.
8. **Finish condition** → when the *player* completes lap 3: record player total time, set `aiGraceDeadline = simTime + TUNING.race.aiFinishTimeoutSec`, keep stepping AI karts (they can still finish and get real times). When every kart has finished OR the deadline passes, build final standings — finishers ordered by finish time ascending first, then timed-out karts ordered by `(lap desc, checkpointIdx desc, t desc)` among themselves with `totalMs: null` — set phase `"finished"` and emit `race:finished {standings, times}`.

**THE KEY TEST — `tests/unit/headlessRace.test.ts`.** Construct the controller headlessly via the constructor flag **`renderEnabled: false`** (no scene, no renderer, no HUD, no audio; a scripted/fake `IInputSource` or AI-drive for the player kart), seed the RNG explicitly, and drive the fixed-timestep loop manually:

```ts
function runRace(seed: number) {
  const bus = new EventBus<GameEvents>();
  const ctrl = new RaceController({ config, track, spline, bus, rng: createRng(seed), renderEnabled: false });
  let finished: GameEvents["race:finished"] | null = null;
  bus.on("race:finished", (p) => { finished = p; });
  const dt = 1 / 60;
  for (let i = 0; i < 5 * 60 * 60 && !finished; i++) ctrl.update(dt);   // ≤ 5 min sim time
  return { finished, ctrl, simSeconds: /* steps taken */ / 60 };
}

it("completes a full race in a sane window", () => {
  const { finished, ctrl } = runRace(1234);
  expect(finished).not.toBeNull();
  expect(simSeconds).toBeGreaterThanOrEqual(29);    // bounds tuned after the first real run — see note
  expect(simSeconds).toBeLessThan(36);
  const ranks = finished!.standings.map((s) => s.rank).sort((a, b) => a - b);
  expect(ranks).toEqual([1, 2, 3, 4]);              // exactly 4 unique ranks
  const player = ctrl.karts().find((k) => k.id === "player")!;
  expect(playerLapTimes.get("player")).toHaveLength(3);   // player completed exactly 3 laps
  for (const times of allPlayerAndAiLapTimes.values())
    for (const t of times) { expect(t).toBeGreaterThan(5_000); expect(t).toBeLessThan(30_000); }
  for (const k of ctrl.karts())                       // no NaN anywhere in final positions
    expect([k.state.pos.x, k.state.pos.y, k.state.pos.z].every(Number.isFinite)).toBe(true);
});

it("is deterministic: same seed → identical standings and lap times", () => {
  const a = runRace(42), b = runRace(42);
  expect(a.finished!.standings.map((s) => s.id)).toEqual(b.finished!.standings.map((s) => s.id));
  for (const kartId of allIds)
    expect(lapTimesOf(a, kartId)).toEqual(lapTimesOf(b, kartId));   // ±0 ms — fixed timestep, no float drift tolerance needed
});
```

> **Tuning note:** the initial guess was `[90 s, 300 s]` (assumed Meadows lap ≈ 60–120 s at base speed × 3 laps). The first real run measured ~32 s for a full 3-lap race — Meadows is only ~222 m, so a lap takes ~8–10 s at base speed. Bounds are now `[29 s, 36 s]` (~[min observed − 10%, max observed + 10%]) and per-lap times `(5 s, 30 s)`. The point of the window is catching regressions (AI stuck on a wall → race never finishes; physics 2× too fast → implausibly short), not pinning exact times — determinism is covered by the second test instead.

**Done when:** both tests green and stable across repeated runs.

### Step 5 — HUD part 1: position + lap counter

Create `src/ui/Hud.ts`. Root `<div data-testid="hud">` (hidden unless state is Racing/Paused), absolutely positioned over the canvas, pointer-events none except on interactive children. This step adds only:

- Top-left: `<span data-testid="hud-position">P{rank}/4</span>` and `<span data-testid="hud-lap">LAP {n}/3</span>`.
- Hud subscribes to `race:start` (reset lap display) and reads `getRace().standings()` + player kart each render frame for the rank/lap text. Rank comes from the 1 Hz standings snapshot — never recompute in the HUD (SRP: HUD renders, controller computes).

Verify with a quick e2e addition to an existing spec or a scratch Playwright run: start a race via dev server, assert `#hud-position` matches `/^P[1-4]\/4$/` and `#hud-lap` reads `LAP 1/3`. **Done when:** assertion passes.

### Step 6 — HUD part 2: lap times

Export pure `formatTimeMs(ms): string` → `"mm:ss.mmm"` (e.g. `95_234 → "01:35.234"`, `59_999 → "00:59.999"`). Add top-right `<span data-testid="hud-current-time">` (sim time since race start minus last lap boundary, live each frame) and `<span data-testid="hud-best-time">` (best of the player's completed laps; `"--:--.---"` until first lap). Best-lap updates on `race:lapCompleted`.

Write `tests/unit/format-time.test.ts`: zero, sub-second, minute rollover, millisecond padding (`"00:00.005"`), large values. **Done when:** unit tests green + e2e sees a ticking current time (poll twice 1 s apart, second value > first).

### Step 7 — HUD part 3: item slot with canvas icons

Bottom-left `<div data-testid="hud-item-slot">` containing a 48×48 `<canvas>`. Phase 4 always draws the empty state: centered `"?"` glyph. Implement `drawItemIcon(ctx2d, itemId | null)` now with the full per-item drawing spec (Phase 5 only flips the input from `null` to real ids — no HUD changes needed then):

| Item id | Drawing (48×48 canvas) |
|---|---|
| `mushroom` | Red circle cap (r=14, top-center) + white rounded-rect stem below; two white dots on cap |
| `greenShell` | Green filled circle (r=15) with darker green rim arc and a small dark slit rectangle |
| `redShell` | Same shape as greenShell in red/dark-red |
| `blueShell` | Same shape in blue + yellow zigzag polyline across the shell |
| `banana` | Yellow crescent: two overlapping arcs (outer r=16, inner offset circle) filled by path difference |
| `star` | 5-point star polygon (outer r=17, inner r=7), gold fill, darker outline |
| `lightning` | Thick yellow zigzag polyline (4 segments) with white core stroke |
| `bulletBill` | Black circle (r=16) + one large white eye circle offset upper-right + small pupil dot |

Verify: e2e asserts the slot shows "?" during a race; icon rendering for all 8 ids is a manual visual check in dev (draw them via a temporary debug URL param if convenient — remove after). **Done when:** e2e green.

### Step 8 — HUD part 4: speedometer

Bottom-right: an SVG gauge, `<svg data-testid="hud-speedo" viewBox="0 0 120 70">` with a static arc path (240° sweep) and a needle `<line>` whose `transform=rotate(angle 60 60)` is set each frame from the player's `speedRatio`: `angle = -120 + speedRatio * 240` degrees. Beside it, `<span data-testid="hud-speed-value">{speed.toFixed(1)} m/s</span>` (signed — negative shows reverse). No per-frame DOM churn beyond `setAttribute` on the needle and textContent on the span.

Verify: e2e — hold W via keyboard events for 3 s, assert `#hud-speed-value` parses to a number > 5; release keys, value decays toward 0 within 5 s. **Done when:** green.

### Step 9 — HUD part 5: minimap

Center-top `<canvas data-testid="hud-minimap" width="160" height="160">`. On `show()`: sample the spline at ~200 points, compute the XZ bounding box, fit into the canvas with 12 px padding (uniform scale), and render the road **once** as a thick closed polyline (`lineWidth = max(3, roadWidth * scale)`, theme color from `track.theme`) into an offscreen base canvas. Each frame: `drawImage(base)` then one dot per kart — AI karts filled circles in their character color (4 px), player = white ring (stroke circle, 5 px). This is the only HUD element allowed to touch track geometry; it stays a pure 2D projection (no Babylon).

Verify: e2e — minimap canvas exists and is non-blank (read a few pixels via `page.evaluate` on the 2d context), and during racing the player ring's pixel position changes over time. **Done when:** green.

### Step 10 — PauseMenu + SettingsStore + SettingsPanel

**PauseMenu.ts:** Esc during Racing → `ui:navigate {to: "Paused"}` (transition table already exists from Phase 1). Overlay with three buttons (`data-testid="pause-resume" | "pause-settings" | "pause-quit"`): Resume → back to Racing; Settings → shows the settings panel as a sub-overlay of pause; Quit to Menu → MainMenu (GameApp disposes the RaceController).

**Exact pause mechanism:** the game loop keeps running (rendering continues, HUD stays visible but frozen) — `GameApp.update` begins with:

```ts
update(dt: number): void {
  if (this.machine.currentId === "Paused") return;   // logic frozen; render loop untouched
  this.activeScreen?.update(dt);                      // → RaceController.update(dt) while Racing
}
```

So `RaceController.update` is simply never dispatched while paused — no separate pause flag inside the controller, no timer drift to unwind (the fixed-timestep accumulator is also gated by the same check). On entering Paused: `audioManager.setBusVolume("music", settings.musicVolume * 0.3)`; on leaving: restore `settings.musicVolume`.

**SettingsStore.ts:** per the signature above. `load()` wraps `JSON.parse` in try/catch AND validates shape (quality ∈ {"low","medium","high"}, volumes are finite numbers clamped to 0..1, muted is boolean) — any failure returns a fresh copy of `DEFAULT_SETTINGS` and logs a warning (no silent catch). `save()` writes JSON.

**SettingsPanel.ts:** quality preset buttons (Low/Medium/High → `qualityManager.apply(preset)` live), three range sliders (master/music/SFX 0..100 → `audioManager` buses live), mute checkbox. Every change: update local state, `store.save(next)`, apply to the live systems immediately — no "Apply" button.

Write `tests/unit/settingsStore.test.ts`: defaults when key absent; round-trip save/load; corrupted JSON → defaults; valid JSON with one bad field (e.g. `quality: "ultra"`) → defaults; volume clamping. **Done when:** tests green + manual: Esc mid-race shows menu, Resume continues the same race (lap counter unchanged), Quit returns to MainMenu.

### Step 11 — ResultsScreen

On `race:finished` (subscribed in GameApp): navigate to Results and render:

- Standings table (`data-testid="results-table"`), one row per kart: rank badge `P1`..`P4`, name, total time via `formatTimeMs` or `"DNF"` when `totalMs === null`.
- Player's per-lap times list; the best lap gets class `best` (highlighted) — `data-testid="results-player-laps"`.
- Buttons: **Race Again** (`data-testid="results-race-again"`) → CharacterSelect with the *same vehicle and map preselected* (pass the previous `RaceConfig` through the machine context; selection screens already support initial values from Phase 2) and **Main Menu** (`data-testid="results-main-menu"`).
- **Phase 6 extension point**, clearly marked in code:

```ts
// ── PHASE 6 HOOK ────────────────────────────────────────────────────────────
// Podium animation + confetti particles + fanfare attach here. Phase 6 assigns
// this callback (wired to ParticleFactory + MusicSequencer.fanfare()); until
// then it is null and the screen renders the static table only. Do not build
// podium visuals in this phase.
onPodiumReady: PodiumHook | null = null;
```

**Done when:** manual — finish a race (AI-drive hook from Step 12 or by hand) and see correct standings + lap times; both buttons navigate correctly with preselection intact.

### Step 12 — `window.__game` extension + debug AI-drive hook

Extend the handle in `main.ts`:

```ts
const debugAllowed = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");
window.__game = {
  state,                                   // refreshed from machine.currentId each frame
  standings: () => race?.standings() ?? [],
  karts: () => (race?.karts() ?? []).map((k) => ({ id: k.id, pos: k.state.pos, speed: k.state.speed, lap: k.state.lap, item: k.state.item })),
  ...(debugAllowed ? { aiDrivePlayer: () => playerController.enableAiDrive() } : {}),
};
```

**AI-drive hook (how the e2e completes a race):** `KeyboardInput`/`PlayerController` check `localStorage.getItem("ttr.debugAIDrive") === "1"` at construction — but *only* when `debugAllowed`. When active, `PlayerController` delegates the player kart's `DriveInput` to a `WaypointAiStrategy` instance (same class as the AI opponents) instead of reading keys. The e2e enables it via `page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"))`.

**Production safety:** in a production build Vite statically replaces `import.meta.env.DEV` with `false`, so `debugAllowed` is `false` unless the URL carries `?debug=1`; without it, `aiDrivePlayer` is never attached and the localStorage flag is never read (the check sits inside the dead branch and is eliminated by minification). Document this in the README during Phase 7.

**Done when:** `npm run build` succeeds; loading the built app on `preview` shows no `aiDrivePlayer` property and the localStorage flag has no effect; dev mode with the flag set drives the player kart autonomously.

### Step 13 — Full-flow e2e: `tests/e2e/full-race.spec.ts`

```ts
test("menu → selects → countdown → full 3-lap race → results", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
  await page.goto("/");

  // Menu buttons are rebuilt every frame — click via direct DOM dispatch in one evaluate,
  // never Playwright .click() (detached-element timeouts). Same pattern as the Phase 1 smoke test.
  const clickLabel = (label: string) =>
    page.evaluate((l) => {
      const el = [...document.querySelectorAll(".menu-item")].find((e) => e.textContent?.trim() === l);
      if (!el) throw new Error(`menu item not found: ${l}`);
      el.click();
    }, label);

  await clickLabel("Start");                 // → CharacterSelect
  await clickLabel("Marvin");                // → VehicleSelect
  await clickLabel("The Basher");            // → MapSelect
  await clickLabel("Greenhollow Meadows");     // → Countdown (RaceConfig assembled)

  await expect.poll(() => page.evaluate(() => window.__game.state), { timeout: 30_000 }).toBe("Racing");

  // AI-drive hook steers the player; just wait for the race to finish (≤ 5 min).
  await expect.poll(() => page.evaluate(() => window.__game.state), { timeout: 5 * 60_000 }).toBe("Results");

  const rows = await page.locator('[data-testid="results-table"] tr').allTextContents();
  expect(rows.length).toBe(4);
  for (const i of [1, 2, 3, 4]) expect(rows[i - 1]).toContain(`P${i}`);
  expect(rows.join(" ")).toContain("Marvin");   // player name present in the table
});
```

**Done when:** this spec passes reliably (run it 5×; flakiness here is a bug to fix, not a retry to add).

## Acceptance criteria

All of [`00-overview.md`](./00-overview.md) §8 Definition of Done, plus the P4 exit gate (§7 row):

1. `tests/unit/headlessRace.test.ts` green — full race finishes within the documented sim-time window (~32 s observed for Meadows), 4 unique ranks, player exactly 3 laps, all lap times in (5 s, 30 s), no NaN positions; determinism test passes with identical standings order and ±0 ms lap times.
2. `tests/e2e/full-race.spec.ts` green — complete flow via scripted keys/AI-drive reaches the results screen showing P1..P4 rows including the player name.
3. Manual checklist (dev server):
   - [ ] Pause mid-race with Esc, resume — race continues seamlessly (lap/time counters intact), music ducks while paused.
   - [ ] Change quality + volumes in Settings, reload page (F5) — settings persist from localStorage.
   - [ ] Results screen reachable by **human driving** at least once (no AI-drive flag): drive 3 laps manually and confirm the results table renders with your lap times and best-lap highlight.
4. Countdown plays three beeps + GO, music switches menu→race stub theme on GO; HUD shows live position/lap/times/speed/minimap throughout.

## Test list

| File | Covers |
|---|---|
| `tests/unit/standings.test.ts` | Ordering by lap/checkpoint/t, id tie-break, 4-kart permutations (Step 1) |
| `tests/unit/waypointAi.test.ts` | AI stays on road over 60 s headless sim; progress rate sane; rubber-band clamp + monotonicity (Step 2) |
| `tests/unit/headlessRace.test.ts` | **Key test:** full-race window, ranks, lap counts/times, NaN check; determinism ±0 ms (Step 4) |
| `tests/unit/format-time.test.ts` | `formatTimeMs` padding/rollover edge cases (Step 6) |
| `tests/unit/settingsStore.test.ts` | Defaults, round-trip, corrupt JSON, bad field, clamping (Step 10) |
| `tests/e2e/full-race.spec.ts` | Complete menu→results flow with AI-drive hook; results table assertions (Step 13) |

Existing Phase 1–3 tests must remain green throughout (especially the `KartPhysics` suite after the Step 2 scale changes).
