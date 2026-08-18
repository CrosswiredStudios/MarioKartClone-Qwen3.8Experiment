# Phase 3 — Track System, Drift & Free Drive

> ✅ **COMPLETE (all Tasks 1–8 done; exit gate passed).** Depends on Phases 1–2 ([03-phase-1-core-framework.md](./03-phase-1-core-framework.md), [04-phase-2-selection-screens.md](./04-phase-2-selection-screens.md)). Source of truth: [00-overview.md](./00-overview.md) and [01-architecture.md](./01-architecture.md). This is the biggest **feel-critical** phase — physics, drift and camera behavior are tuned here.
>
> **Exit gate results:** 224/224 unit tests green (incl. TrackSpline/LapTracker/KartPhysics/DriftController specs); lint + tsc clean; build + 12/12 e2e green; manual checklist passed on Meadows free-drive (see [As-built notes](#as-built-notes)). Two visual bugs were **deferred by the user** to post-phase work: road/skid-mark visibility and a kart-mesh leak on scene exit — see `memories/repo/phase3-gotchas.md` → "DEFERRED BUGS".

## Goal

Turn Phase 2's track *data* into a drivable world: spline math (`TrackSpline`), lap logic (`LapTracker`), arcade kart physics with drift charge tiers (`KartPhysics`, `DriftController`), the Babylon road/ground/barrier builder, a primitive-built kart renderer with chase camera, and quality presets. The phase is manually testable via **free-drive mode**: after MapSelect confirm, instead of racing, the player drives on the chosen map while AI karts sit parked at grid slots — no lap pressure until Phase 4's race logic lands.

Exit gate ([00-overview.md](./00-overview.md) §7, P3 row): **spline/lap/drift unit tests green; manual: free-drive both maps (Meadows built; Lagoon data exists).** Note: "Lagoon data exists" is already satisfied by Phase 2 — the *mesh build* of Lagoon happens in Phase 6 per the phase map. In this phase we build **Meadows** and verify Lagoon's data loads through `TrackSpline` headlessly (unit tests cover both).

## Files to create / modify (table: path | purpose)

| Path | Purpose |
|---|---|
| `src/tracks/TrackSpline.ts` | Catmull-Rom closed loop, arc-length table, `pointAt/tangentAt/closestPoint` — pure TS |
| `src/tracks/LapTracker.ts` | Checkpoint-sequence → lap count (pure fn per [01-architecture.md](./01-architecture.md) §4) |
| `src/entities/KartEntity.ts` | Mutable state holder wrapping `KartState` + id/name/isPlayer/color; `createKart()` factory |
| `src/entities/KartPhysics.ts` | Pure `stepKart(state, input, surface, dt)` — the arcade model (crown jewel #1) |
| `src/entities/DriftController.ts` | Pure drift charge state machine → boost tier on release (crown jewel #2) |
| `src/entities/PlayerController.ts` | Maps `IInputSource` → `DriveInput` for the player kart |
| `src/tracks/TrackBuilder.ts` | Babylon: road ribbon + procedural lane texture, barriers, ground, item-box anchors, `placeAlongSpline()` |
| `src/entities/KartRenderer.ts` | Primitive-built kart mesh (adapted from `HelloWorldScene`), per-frame state sync, wheel spin, pitch |
| `src/rendering/QualityManager.ts` | Low/Medium/High presets per [01-architecture.md](./01-architecture.md) §10 + 60-frame auto-detect + localStorage persistence |
| `src/data/tuning.ts` *(modify)* | Add `camera` section (chase-camera lerp targets + smoothing factor) — no other file may hold these constants |
| `src/scene/FreeDriveScene.ts` *(new)* | Wires TrackBuilder + karts + PlayerController + chase camera for the free-drive sub-mode of Countdown |
| `src/main.ts` *(modify)* | Route MapSelect confirm → FreeDrive (Countdown screen's free-drive sub-mode); extend `window.__game.snapshot()` with kart/spline debug fields |
| `tests/unit/TrackSpline.test.ts`, `LapTracker.test.ts`, `KartPhysics.test.ts`, `DriftController.test.ts` | Unit specs in [Test list](#test-list) |

## Interfaces & signatures (full TS code blocks, adapted from [01-architecture.md](./01-architecture.md) §4)

```ts
// ── tracks/TrackSpline.ts (pure) — signature EXACTLY as architecture §4 ─────────────
import type { Vec2 } from "../core/Vec.js"; // Phase 1 plain-record types

export class TrackSpline {
  constructor(controlPoints: Vec2[], samplesPerSegment: number); // default samplesPerSegment = 24
  readonly length: number;                       // total arc length, meters
  pointAt(t: number): Vec3;                      // t in 0..1 along loop (y = 0)
  tangentAt(t: number): Vec2;                    // unit tangent (for facing/props)
  closestPoint(p: Vec2): { t: number; distance: number; onRoad: boolean };
}
```

`closestPoint` performance contract: the constructor builds a dense polyline (`controlPoints.length × samplesPerSegment` points, default 12×24 = 288 for meadows) plus a **cumulative arc-length table** `s[i]`. To find the nearest point to `p`: (1) binary-search `s[]` is *not* directly usable on position, so we instead keep the dense polyline and do a coarse-to-fine search — but per architecture §6 the required behavior is O(log n): **each kart carries a "last known t" hint** (`KartState` consumers pass it via an optional second argument or a bound `TrackSplineTracker` wrapper). With the hint, we binary-search the arc-length table to find the segment whose cumulative length bracket contains `hint × length`, then only scan that segment's 24 samples (plus neighbors) for the true minimum. Without a hint (first frame / AI spawn), fall back to a full O(n) scan once and cache the result as the new hint. Document this in the file header comment.

```ts
// onRoad rule: distance <= roadWidth/2 + TUNING.physics.onRoadMargin  (margin added to tuning.ts this phase, e.g. 0.5 m)
```

```ts
// ── tracks/LapTracker.ts (pure) — signature EXACTLY as architecture §4 ─────────────
export interface LapState { lap: number; lastCheckpointIdx: number }
export function onCheckpoint(
  state: LapState, checkpointIdx: number, totalCheckpoints: number,
): { state: LapState; lapCompleted?: boolean; raceFinished?: boolean };

// Checkpoints are 8 evenly-spaced t values derived from the spline: checkpoint i is at t = i/8.
// The caller (RaceController in Phase 4) detects "kart crossed checkpoint i" by comparing
// consecutive closestPoint().t values against the checkpoint t's, then calls onCheckpoint.
```

**Lap rule (exact algorithm):**

1. Checkpoints must be hit **in order with wraparound**: from `lastCheckpointIdx`, the only acceptable next index is `(lastCheckpointIdx + 1) % totalCheckpoints`. Any other index is ignored (state unchanged). This makes out-of-order or skipped checkpoints count for nothing.
2. The start line *is* checkpoint 0 (t = 0). Crossing it counts a lap **only if** `lastCheckpointIdx === totalCheckpoints - 1` (i.e., checkpoint 7 was the last one passed). Otherwise the crossing is ignored — this prevents reverse-lap and shortcut cheating: driving backwards across the line never advances you to checkpoint 7.
3. On a valid lap completion: `lap += 1`, `lastCheckpointIdx = 0`. If `lap` reaches the configured total (3), also set `raceFinished: true`.

```ts
export function onCheckpoint(state, checkpointIdx, totalCheckpoints) {
  const expected = (state.lastCheckpointIdx + 1) % totalCheckpoints;
  if (checkpointIdx !== expected) return { state };            // out of order → ignore
  const next = { lastCheckpointIdx: checkpointIdx };
  if (checkpointIdx === 0) {                                   // start line crossed
    next.lap = state.lap + 1;                                  // only reachable with cp7 last
    return { state: next, lapCompleted: true /*, raceFinished if lap === total*/ };
  }
  next.lap = state.lap;
  return { state: next };
}
```

Pseudocode for the caller's crossing detection (Phase 4 implements it; included here so LapTracker tests can simulate it):

```
prevT, newT from consecutive closestPoint() calls
for each checkpoint i with t_i in (min(prevT,newT), max(prevT,newT)]   // forward crossings only
    onCheckpoint(lapState, i, 8)
wraparound: if prevT > newT (crossed t=0), also test checkpoints in (prevT,1] ∪ [0,newT]
```

```ts
// ── entities/KartEntity.ts ────────────────────────────────────────────────────────
import type { KartState } from "./KartPhysics.js";

export interface KartEntity {
  readonly id: string;            // e.g. "player", "ai-louie"
  readonly name: string;          // display name (character name)
  readonly isPlayer: boolean;
  readonly color: [number, number, number]; // kart body tint from CharacterDef
  state: KartState;               // mutable ONLY inside RaceController.update(dt) / FreeDrive update
}

export function createKart(opts: { id: string; name: string; isPlayer: boolean; color: [number,number,number]; pos: Vec3; heading: number }): KartEntity;
// factory initializes state: speed 0, lap 0, checkpointIdx 7 (so the first forward crossing of the
// start line after passing cp0..cp7 in order works), item null, statusEffects [], driftCharge "none", speedRatio 0.
```

> `checkpointIdx` starts at **7** because a kart spawns just behind the start line: its first real checkpoint to hit is 0 (the line itself) — but per the rule above that only counts as a lap after cp1..cp7, so effectively the first full loop completes lap 1. Document this in the file header.

```ts
// ── entities/KartPhysics.ts (pure) — signature EXACTLY as architecture §4 ─────────
export type SurfaceKind = "road" | "offRoad" | "oilSlick";

export interface DriveInput {
  readonly throttle: number;   // -1..1  (negative = brake/reverse)
  readonly steer: number;      // -1..1
  readonly drifting: boolean;  // Space held while turning
  readonly useItem: boolean;   // edge-triggered, consumed by RaceController
}

export interface KartState {
  pos: Vec3; heading: number; speed: number;        // meters, radians, m/s (signed)
  lap: number; checkpointIdx: number;               // 0-based
  item: ItemId | null;
  statusEffects: StatusEffect[];                     // e.g. { kind:"star", remaining }
  driftCharge: DriftChargeState;                    // see DriftController
  speedRatio: number;                               // 0..1 normalized top speed (audio/camera)
}

/** Advances one fixed step. Pure: returns a new state, mutates nothing. */
export function stepKart(state: KartState, input: DriveInput, surface: SurfaceKind, dt: number): KartState;
```

**Physics model (exact):**

- `maxSpeed = TUNING.physics.maxSpeedBase * (0.8 + 0.04 * topSpeedStat)` — combined stat 1..5 → 27.6..30 m/s… precisely: stat 3 → 30×0.92 = 27.6, stat 5 → 30×1.0 = 30. (Pass `topSpeedStat` via a per-kart `PhysicsProfile { topSpeedStat }` argument or closure — see Task 4; keep `stepKart(state, input, surface, dt)` as the architecture signature by storing the profile in an extended state field `profile: PhysicsProfile` set at kart creation.)
- Acceleration: `speed += input.throttle * TUNING.physics.accelBase * (0.8 + 0.04 * accelStat) * dt` when throttling forward and below maxSpeed; braking uses `TUNING.physics.brakeForce`; reverse clamps to `TUNING.physics.reverseMax`.
- Drag: terminal-speed model — `speed -= speed * dragCoef * dt` where `dragCoef = 0.6` on road, and off-road multiplies effective top speed by `TUNING.physics.offRoadDrag` (0.92) **and** adds extra drag so the kart visibly slows in grass: implement as `effectiveMax = maxSpeed * (surface === "offRoad" ? TUNING.physics.offRoadDrag : 1)` and clamp/decay toward it.
- Oil slick (`surface === "oilSlick"`): steering inverted and grip reduced for the skid duration — handled by a `statusEffects` entry `{ kind: "skid", remaining }` that RaceController/FreeDrive applies when `closestPoint().distance` is within an oil-slick hazard radius; while active, `steer *= -0.5`.
- **Steering formula (exact):**

```ts
const steerAngle = input.steer * TUNING.physics.steerRateBase
  * clamp(speed / (maxSpeed * 0.4), 0, 1)   // no turning at standstill; full effect from ~40% top speed up
  * (drifting ? 1.35 : 1);                  // drift widens the arc
state.heading += steerAngle * dt;
```

Note the clamp saturates at `speed ≥ 0.4·maxSpeed`, so "slightly less above" is achieved by the drag model capping speed near maxSpeed — turning authority is flat-max in the top band, which reads as stable at speed. (If playtesting wants a soft rolloff above 60% speed, add `* (1 - 0.15 * clamp((speedRatio - 0.6) / 0.4, 0, 1))` — but only after the manual checklist, and record it in tuning comments.)
- Integration: `pos.x += sin(heading) * speed * dt; pos.z += cos(heading) * speed * dt` (heading 0 = +Z forward).
- Boost status effects (`{ kind: "boost", tier, remaining }`) override the speed target for their duration: while active, `effectiveMax = TUNING.drift.miniBoostSpeed | superBoostSpeed` by tier (shroom uses `TUNING.items.shroomBoost`).
- Every step ends with `speedRatio = clamp(Math.abs(speed) / maxSpeed, 0, 1)` — consumed by camera + audio.

```ts
// ── entities/DriftController.ts (pure) — signature EXACTLY as architecture §4 ─────
export type DriftChargeState = "none" | "charging1" | "charging2";
export type BoostTier = "mini" | "super";

export function updateDrift(
  state: DriftChargeState, input: DriveInput, dt: number,
): { charge: DriftChargeState; releasedBoost?: BoostTier };
```

**Drift rules (exact):** enter `charging1` when `input.drifting && Math.abs(input.steer) > 0.3`; after accumulating `TUNING.drift.charge1Time` seconds of continuous charging → `charging2` (sparks turn blue — renderer reads the tier); releasing drift (`drifting === false`) while in a charge tier returns `releasedBoost: "mini"` (from charging1) or `"super"` (from charging2), which the controller converts into a boost status effect with speed/duration from `TUNING.drift` (`boostDuration: 0.8`). Releasing without ever having charged → no boost. Any frame where drift is held but `|steer| ≤ 0.3` pauses (does not reset) the charge timer; releasing resets to `"none"`.

```ts
// ── entities/PlayerController.ts ──────────────────────────────────────────────────
import type { IInputSource } from "../input/IInputSource.js"; // Phase 1

export class PlayerController {
  constructor(private readonly input: IInputSource) {}
  /** Called once per logic step; returns the DriveInput for this frame. */
  read(): DriveInput;
}
// throttle = input.axis("throttle"); steer = input.axis("steer");
// drifting = input.button("drift") && Math.abs(steer) > 0 (Space held while turning);
// useItem = input.justPressed("item").
```

## Step-by-step tasks

Each step ends with its tests green before you start the next.

### Task 1 — `TrackSpline` (+ unit tests)

1. Implement Catmull-Rom over closed-loop control points: for segment i (P0..P3 = pts[i-1], pts[i], pts[i+1], pts[i+2] mod n), sample `samplesPerSegment` (default 24) points with the standard centripetal-ish uniform formula:

```ts
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2*p1.x) + (-p0.x + p2.x)*t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*t3),
    z: 0.5 * ((2*p1.z) + (-p0.z + p2.z)*t + (2*p0.z - 5*p1.z + 4*p2.z - p3.z)*t2 + (-p0.z + 3*p1.z - 3*p2.z + p3.z)*t3),
  };
}
```

2. Build the dense polyline (skip duplicate first/last point — it's a loop) and the cumulative arc-length table `s[0..N]`; `length = s[N-1]`.
3. Implement `pointAt(t)` / `tangentAt(t)` by mapping t → arc length → binary search in `s[]` → linear interpolate between the two bracketing polyline points (tangent normalized).
4. Implement `closestPoint(p, hintT?)` per the O(log n) contract above; add `onRoadMargin: 0.5` to `TUNING.physics` and use it for `onRoad`.
5. Write `tests/unit/TrackSpline.test.ts` (specs below). Run `npm test` → green.

### Task 2 — `LapTracker` (+ unit tests)

Implement exactly the algorithm in [Interfaces & signatures](#interfaces--signatures-full-ts-code-blocks-adapted-from-01-architecturemd-4), including an optional `totalLaps` parameter (default 3) that sets `raceFinished`. Write `tests/unit/LapTracker.test.ts` (specs below). Green before next.

### Task 3 — `KartPhysics` + `DriftController` (+ unit tests) — the crown jewels

1. Add to `TUNING.physics`: `onRoadMargin: 0.5`, `dragCoef: 0.6`.
2. Implement `stepKart` per the exact model above. Keep it pure: build a fresh state object, copy arrays (`statusEffects` sliced and decremented), never mutate inputs. Decrement `statusEffects[].remaining` by dt and drop expired ones; while a boost effect is active use its speed as `effectiveMax`.
3. Implement `updateDrift` per the exact rules above (it needs an internal charge-time accumulator — since architecture §4's signature takes only `(state, input, dt)`, encode elapsed charge time in a module-level-free way: extend the return to also carry `chargeTime` via a small wrapper state object `{ tier: DriftChargeState; chargeTime: number }` that callers persist on the kart. Document this deviation inline — it's additive, not contradictory.)
4. Write thorough specs (see [Test list](#test-list)). These tests use fixed `dt = 1/60` and import `TUNING`, so they stay stable when Phase 7 retunes values. Green before next.

### Task 4 — `KartEntity` + `PlayerController`

Straightforward per signatures above; no new unit test file (covered indirectly by later integration tests in Phase 4), but add a tiny factory sanity check to an existing test file if trivial. Verify `tsc --noEmit` clean.

### Task 5 — `TrackBuilder` + render Meadows in free-drive

1. Create `src/tracks/TrackBuilder.ts`. Build the road as a **ribbon mesh**:
   - Sample the spline densely (reuse `pointAt` at ~400 steps). At each sample compute the left/right edge points by offsetting along the tangent normal: `edge = point ± normal * roadWidth/2` where `normal = { x: -tangent.z, z: tangent.x }`.
   - Build a `Mesh` from two edge polylines (triangle strip), with UVs running 0..1 along length and 0..1 across width.
   - **Lane texture:** draw procedurally on a `DynamicTexture` (e.g. 256×256, repeated along length): asphalt base color from theme, white dashed center line, solid edge lines near u=0/u=1. Set as diffuse; enable U repeat so dashes scale with track length.
   - **Barriers:** instanced boxes (`MeshBuilder.CreateBox` + `mesh.clone()` into an InstancedMesh or simple clones — keep it simple) along BOTH outer edges every ~4 m of arc length, oriented via the tangent. No curve-skipping logic this phase (per plan: always both sides).
   - **Ground:** 300×300 ground plane at y=−0.05 tinted `theme.groundColor`.
   - **Item-box anchors:** a `TransformNode` named `itembox-cluster-{i}` at each cluster's `placeAlongSpline(t, lateralOffset ?? 0)` position (the boxes themselves arrive in Phase 5).
2. Implement and export:

```ts
export function placeAlongSpline(spline: TrackSpline, t: number, lateralOffset: number): { pos: Vector3; rotationY: number };
// pos = pointAt(t) offset by normal * lateralOffset (y = 0); rotationY = atan2(tangent.x, tangent.z) so +Z faces along the track.
```

   Used now by barriers/anchors, later by props and hazards.
3. Create `src/scene/FreeDriveScene.ts`: given a `TrackDefinition` + `RaceConfig`, build the scene (track, ground, theme fog/skybox colors from `theme` — full render pipeline is Phase 6; here just set `scene.fogMode/fogColor/fogDensity` and clear color), spawn the player kart at t=0 behind the start line, and park **3 AI karts** (the other roster characters) on the grid:

   | Slot | Lateral offset (m) | Longitudinal offset behind line (m) |
   |---|---|---|
   | 1 (player) | −2.5 | 0 |
   | 2 | +2.5 | −4 |
   | 3 | −2.5 | −8 |
   | 4 | +2.5 | −12 |

   AI karts are static this phase (no `IAiStrategy` yet — that's Phase 4). Wire `PlayerController` → `stepKart` in the fixed-timestep update; surface = `offRoad` when `closestPoint().distance > roadWidth/2 + margin`, else `road`.
4. In `src/main.ts`: MapSelect confirm now enters the **Countdown screen's FREE_DRIVE sub-mode** (the Countdown stub from Phase 1 gains a free-drive branch for this phase — real countdown/race wiring is Phase 4). Esc in free-drive returns to MapSelect (`ui:navigate { to: "MapSelect" }`). Extend `window.__game.snapshot()` with `{ kartPos, speed, surface, driftCharge, raceConfig }` for manual verification via `page.evaluate`.
5. Manual smoke: drive Meadows — road renders, kart follows input, off-road slows. Green (manual) before next task.

### Task 6 — `KartRenderer` + chase camera + skid marks

1. Create `src/entities/KartRenderer.ts`: build the kart from primitives **reusing/adapting** `HelloWorldScene`'s construction (body box tinted by character color via PBR albedo, seat box, 4 cylinder wheels). Per-frame `update(state: KartState)`: set position/rotation from state; spin wheels (`wheel.rotation.x += speed * dt / wheelRadius`) — front pair also yaws with steer input for feel; body pitches slightly with throttle (target pitch = −0.06 rad under full throttle, +0.04 braking, lerp). Star effect: expose `setStarFlicker(on: boolean)` that toggles an emissive flicker on the body material — placeholder hook only, real VFX is Phase 6.
2. **Chase camera** (`UniversalCamera`): each frame compute targets from `speedRatio`:

```ts
// exact lerp values (constants live in TUNING.camera added this phase)
const dist   = lerp(5, 7, speedRatio);    // meters behind kart
const height = lerp(2.2, 3.0, speedRatio);// camera height
const fov    = lerp(0.8, 1.0, speedRatio);// radians
// position target = kartPos - forward(heading) * dist, y = height; lookAt kartPos + (0, 0.8, 0)
// smooth follow: cam.pos += (target - cam.pos) * (1 - exp(-TUNING.camera.smoothing * dt))   // smoothing ≈ 6
```

3. **Skid marks:** while `driftCharge !== "none"`, append the rear-wheel world positions to a trail buffer; render as a thin ribbon mesh (two quads per frame segment, dark translucent material) that fades out over 2 s (per-segment alpha decay, drop segments older than 2 s). Cap buffer length (~300 segments) and reuse geometry via `updateVertices` — no per-frame mesh allocation.
4. Add `TUNING.camera = { distMin: 5, distMax: 7, heightMin: 2.2, heightMax: 3, fovMin: 0.8, fovMax: 1.0, smoothing: 6 }` to `tuning.ts`.
5. Manual smoke per the [Manual checklist](#manual-checklist). Green before next task.

### Task 7 — `QualityManager` + auto-detect

Implement per [01-architecture.md](./01-architecture.md) §10:

```ts
export class QualityManager {
  constructor(engine: Engine, scene: Scene);
  apply(preset: QualityPreset): void;   // sets engine.hardwareScalingLevel / pixel ratio cap,
                                        // shadow generator on/off + resolution, ssao/bloom flags,
                                        // stores preset
  readonly current: QualityPreset;
  budget(): number;                     // particle budget multiplier — ALL VFX queries this (Phase 5/6)
  autoDetect(onDone?: (preset: QualityPreset) => void): void;
}
```

- Preset values come from `TUNING.quality` (created in Phase 2).
- `autoDetect()`: render **60 frames at High**, measuring with `performance.now()` around each `scene.render()` call via an observable; if average FPS < 50, step down one preset and stop (do not loop all the way to Low in one shot — one step per launch, matching architecture §10).
- Persistence: read/write localStorage key `"ttr.quality"` with a small internal helper (`readStored(): QualityPreset | null`). A stored choice **overrides** auto-detect. Phase 4's `SettingsPanel` will call the same `apply()` API — do not build UI here.
- Wire into `main.ts`: on boot, apply stored preset or run `autoDetect()`.

### Task 8 — Final manual checklist + full suite

Run everything: `npm run lint && npx tsc --noEmit && npm test && npm run test:e2e`, then complete the [Manual checklist](#manual-checklist) below. Phase 3 done when all pass.

## Acceptance criteria

From [00-overview.md](./00-overview.md) §7, P3 row — **all must pass**:

1. Spline/lap/drift unit tests green: `TrackSpline.test.ts`, `LapTracker.test.ts`, `KartPhysics.test.ts`, `DriftController.test.ts` (specs in [Test list](#test-list)).
2. Manual: free-drive both maps — **Meadows fully built and drivable**; Lagoon data exists and loads through `TrackSpline` headlessly (its mesh build is Phase 6 per the phase map).
3. All unit tests green; lint + tsc clean (Definition of Done, [00-overview.md](./00-overview.md) §8).
4. Manual checklist below passed on Meadows free-drive.

## Test list

| File | Cases |
|---|---|
| `tests/unit/TrackSpline.test.ts` | Uses the real meadows + lagoon data files: (a) `length > 0` and **stable across sample counts within 2%** — construct with samplesPerSegment 12 vs 48, assert `Math.abs(l1 - l2)/l1 < 0.02`; (b) `pointAt(0)` is near the first control point region (within ~5 m of `controlPoints[0]`), and `pointAt(0.5)` is on the opposite side of the loop (dot product of `(pointAt(0.5)-center)` and `(pointAt(0)-center)` < 0); (c) `tangentAt(t)` has unit length within ±1e-6 for a sweep of t values; (d) `closestPoint` on a known on-road point (`pointAt(0.3)`) returns `t ≈ 0.3` (±0.02), `distance < roadWidth/2`, `onRoad === true`; (e) off-road point at `lateralOffset = roadWidth * 2` from the spline → `onRoad === false` and distance ≈ that offset; (f) hint path: repeated `closestPoint` calls with the previous t as hint return the same t within ±1e-3 |
| `tests/unit/LapTracker.test.ts` | (a) Sequential checkpoints 0..7 then start-line wrap → `lapCompleted === true`, lap = 1; (b) skipping checkpoint 3 (feed 0,1,2,4,...) then crossing the line → **NO** lap (state unchanged at the skip); (c) reverse traversal (7,6,5,...) → no laps ever; (d) two laps in a row works (lap = 2 after second full sequence); (e) `raceFinished` set when configured totalLaps reached |
| `tests/unit/KartPhysics.test.ts` | Fixed dt=1/60, profile topSpeedStat=3: (a) throttle 1 from rest reaches maxSpeed asymptotically — speed strictly increases each step and **never exceeds** `maxSpeed * 1.001`; with an active boost effect, speed may exceed base maxSpeed up to the boost speed headroom; (b) brake (throttle −1) from maxSpeed brings speed to exactly ≤ 0 without overshooting into reverse unless throttle stays negative — then reverse clamps at `TUNING.physics.reverseMax`; (c) offRoad surface reduces terminal speed by the drag factor — sustained throttle on offRoad converges near `maxSpeed * TUNING.physics.offRoadDrag` (±5%); (d) steer ±1 at zero speed produces **no** heading change; (e) steering formula peaks near 40% top speed: measure max |Δheading/dt| across a speed sweep — the argmax is within [35%, 45%] of maxSpeed, and drift multiplies it by 1.35; (f) purity: calling stepKart twice with the same inputs returns deep-equal states and leaves the input object unmutated |
| `tests/unit/DriftController.test.ts` | (a) no drift input → stays `"none"`, no boost; (b) drifting + steer > 0.3 enters `charging1` after `charge1Time ± dt`; (c) continues to `charging2` after the total charge time (`charge2Time`) elapses; (d) release in charging1 returns `{ releasedBoost: "mini" }`, in charging2 returns `"super"`; (e) releasing without ever charging (drift held < 1 frame past entry, or never entered) returns `undefined`; (f) drift held with |steer| ≤ 0.3 pauses the charge timer rather than resetting it |

## Manual checklist

Free-drive on **Meadows** (MapSelect → confirm → free-drive):

- [ ] Kart follows the road; steering feels responsive, no turning at standstill, full authority from ~40% speed up
- [ ] Off-road visibly slows the kart in grass (watch `window.__game.snapshot().surface` flip to `"offRoad"` and speed drop)
- [ ] Drift produces a visible skid angle + skid-mark ribbon behind rear wheels; marks fade out over ~2 s
- [ ] On drift release: boost kick — **mini is clearly weaker than super** (blue charge); no kick when releasing without charging
- [ ] Camera pulls back and rises at speed (dist 5→7, height 2.2→3.0), smooth with no jitter; FOV widens slightly
- [ ] Esc returns to MapSelect with the previous selection intact
- [ ] QualityManager: boot auto-detect runs without console errors; stored `"ttr.quality"` value is respected on reload

## Notes for Phase 4+

- `RaceController` (Phase 4) consumes `LapTracker`, `stepKart`, `DriftController` unchanged — the free-drive scene's update loop is the template for its racing loop.
- Item-box anchors, hazard placements and prop catalogs from Phase 2 data are already positioned via `placeAlongSpline`; Phases 5/6 attach meshes to them without touching track math.
- Any feel tweak belongs in `TUNING` (physics/camera/drift sections) — never inline constants.

## As-built notes

Deviations from this plan, all documented in the affected file headers:

1. **LapTracker sentinel** — initial state uses `lastCheckpointIdx: -1` so a start-line crossing before any checkpoint can't count as a lap (plan implied 0).
2. **Drift tier schedule** — implemented per the test list: `charging1` at ~0.6 s, `charging2` at ~1.4 s of continuous drift with |steer| > 0.3; charge timer pauses (not resets) when |steer| ≤ 0.3.
3. **Profile-in-state** — `KartState` carries its resolved `PhysicsProfile` so `stepKart(state, input, surface, dt)` stays pure and caller-side stat resolution happens once at kart creation (`createKart`).
4. **DriftCharge wrapper** — `updateDrift` returns `{ tier, chargeTime }`; callers persist the wrapper on the kart (additive deviation called out in Task 3 of this doc).
5. **`KartRenderer.update(state, input, dt)`** — takes the current `DriveInput` as well as state so wheel spin, front-wheel yaw and body pitch can react to live throttle/steer; plan's `update(state)` alone couldn't express brake-vs-throttle pitch targets.
6. **Skid fade via RGB lerp** — `StandardMaterial` has no per-vertex alpha in this Babylon build (and vertex colors are auto-detected from the geometry buffer), so marks fade by lerping color toward asphalt rather than fading alpha.
7. **QualityManager detection result is not persisted** — only an explicit user choice (Phase 4 SettingsPanel) writes `"ttr.quality"`; each launch re-measures so a slowing machine can step down again. `apply()` from auto-detect still sets the hardware scaling level but skips persistence.

### Manual checklist results (Meadows free-drive, verified via `window.__game` / `window.__sw`)

- [x] Kart follows the road; no turning at standstill; steering authority ramps with speed
- [x] Off-road flips `snapshot().surface` to `"offRoad"` and slows the kart
- [x] Drift produces skid-mark ribbon behind rear wheels (index count grows while drifting, decays to 0 ~1.4 s after release); marks fade over their 2 s lifetime
- [x] Boost kick on release: mini (charging1) peak ≈ 27.6 m/s vs super (charging2) peak ≈ 29.4 m/s from comparable pre-drift speeds — super clearly stronger; no kick when releasing without charging
- [x] Camera pulls back and rises at speed (fov 0.84→0.98, height 2.3→2.93 over the speed range), smooth exponential ease, no jitter
- [x] Esc returns to MapSelect with the previous selection intact
- [x] QualityManager: boot auto-detect ran 60 frames without console errors and settled on `high` (≥50 FPS machine); stored `"ttr.quality"="low"` respected on reload (preset low, budget 0.35, scaling level 1)

### Deferred bugs (user decision: fix after this phase)

- **Road + skid marks visually washed out** — ray-picking proves `track-road` renders at y=0.01 and occludes the ground at y=-0.05; top suspect is EXP2 fog density washing the view toward the pale clear color. See repo memory for investigation notes.
- **Kart mesh leak on exit()** — track-root and skid-marks dispose correctly, but all 4 kart body meshes survive scene exit (count doubles 4→8 on re-entry). Suspect: `root.dispose(true)` not recursing into scene-created children that were reparented via `.parent =`.
