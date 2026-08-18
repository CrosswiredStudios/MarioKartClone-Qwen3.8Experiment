# Phase 5 — Items, Weapons & Hazards

> **Execution guide (forward-looking).** This phase is NOT yet implemented. It depends on Phase 4 being complete: `RaceController` (countdown → racing → finished), `WaypointAiStrategy` AI opponents as live targets, the HUD item slot (currently always "?"), and the headless race harness from [`06-phase-4-race-loop-and-ai.md`](./06-phase-4-race-loop-and-ai.md). Source of truth: [`00-overview.md`](./00-overview.md) and [`01-architecture.md`](./01-architecture.md). If this doc needs to change architecture, update `01-architecture.md` in the same commit.

## Goal

Give the race its classic depth: **item boxes with position-based spawn tables, all 8 items implemented behind `IItemEffect`, shell projectile physics (bounces + homing), banana/oil-slick skids, and screen-shake wiring** — so that a Phase 4 race now has pickups, attacks, hazards and camera feedback. Exit gate = the P5 row in [`00-overview.md`](./00-overview.md) §7: *per-item unit tests + targeting integration tests green; manual: trigger every item.*

Out of scope (do NOT build): particle systems for items (`ParticleFactory` is Phase 6 — this phase only emits the events and does minimal mesh-level feedback), full music/SFX polish (Phase 6), Lagoon oil-slick *visuals* beyond what Phase 3's track data already places.

## Files to create / modify

| Path | Purpose |
|---|---|
| `src/data/items.ts` | `ITEM_DEFS` for all 8 items + `SPAWN_TABLES` (rank-keyed, pure data) + `STRENGTH_ORDER`. Unit-tested. |
| `src/items/IItemEffect.ts` | `RaceContext`, `EffectResult`, `IItemEffect` interface exactly per [`01-architecture.md`](./01-architecture.md) §4, plus the `getItemEffect(id)` factory map (OCP: new item = new class + one registry line). |
| `src/items/ItemEffects.ts` | One class per item: `ZoomShroom`, `GreenPeaShell`, `RedChiliShell`, `BlueStormShell`, `SlickBanana`, `SparkleStar`, `ZapLightning`, `BulletBill`. Rules in the table below. |
| `src/items/ShellProjectile.ts` | `ShellState` + pure `stepShell()` (straight travel, wall bounce with reflection math, homing steer for red/blue, kart collision, expiry). |
| `src/items/ItemBoxSpawner.ts` | Box entities at track cluster anchors: spawn from rank table via seeded RNG, pickup radius check, 5 s respawn timer, one-kart-per-cycle rule. Emits `item:pickedUp`. |
| `src/vfx/ScreenShake.ts` | Camera shake envelope (decaying sine), amplitude by severity; subscribes to `kart:hit` / `kart:boosted` / `item:used(lightning)`. Render-layer only — no logic imports. |
| `src/data/tuning.ts` *(modify)* | Extend the `items` block with every new gameplay constant (full list in Interfaces). No raw numbers anywhere else. |
| `src/entities/KartEntity.ts` *(modify)* | Full `StatusEffect` union + `lastOilPatchId: number \| null` field (oil re-trigger guard, see Step 3). |
| `src/entities/KartPhysics.ts` *(modify)* | Status-effect integration in `stepKart`: skid spin replaces steering, hit slow-down, shrink caps, boost/star speed overrides, bulletBill lock. Pure — fully unit-tested. |
| `src/race/RaceController.ts` *(modify)* | Owns shell list + banana list; per-step: item use (`useItem` edge → factory → apply), `stepShell` for each shell, hit application + `kart:hit`, banana pickup → skid + `kart:skid`, star collision rules, bulletBill transform/revert, blue-shell retarget on leader finish. Emits `item:used`. |
| `src/ui/Hud.ts` *(modify)* | Item slot now reads the player's real `kart.item` and calls the existing `drawItemIcon()` (Phase 4 already drew all 8 icons + "?"). Subscribes to `item:pickedUp`/`item:used` for a brief slot flash. |
| `src/entities/KartRenderer.ts` *(modify)* | Hit-flash hook: on `kart:hit`, set kart material emissive to white and decay over ~0.3 s (simple mesh-level feedback; particles come in Phase 6). |
| `tests/unit/items-data.test.ts` | Item defs + spawn table rules (Step 1). |
| `tests/unit/shellPhysics.test.ts` | Pure shell step: travel, wall bounce reflection, homing convergence, expiry (Step 4/5). |
| `tests/unit/itemEffects.test.ts` | One describe per item against a controlled `makeRaceFixture()`; includes skid physics integration and star invincibility rules (Steps 2–8). |
| `tests/unit/spawner.test.ts` | Pickup radius, respawn timer, one-kart-per-cycle (Step 9). |

## Interfaces & signatures

Adapted from [`01-architecture.md`](./01-architecture.md) §4/§5. Plain records only — no Babylon types in logic files.

```ts
// ── data/items.ts (pure data) ───────────────────────────────────────────────
type ItemId = "mushroom" | "greenShell" | "redShell" | "blueShell"
            | "banana" | "star" | "lightning" | "bulletBill";

interface ItemDef { readonly id: ItemId; readonly name: string; readonly description: string; readonly iconColor: string }
export const ITEM_DEFS: Record<ItemId, ItemDef>;          // all 8 ids from 00-overview.md §3

/** Rank (1 = leader … 4 = last) → weighted-uniform spawn table. */
export const SPAWN_TABLES: Readonly<Record<1 | 2 | 3 | 4, readonly ItemId[]>>;

/** Total strength order used by the monotonicity unit test (weakest → strongest). */
export const STRENGTH_ORDER: readonly ItemId[] =
  ["banana", "mushroom", "greenShell", "redShell", "blueShell", "lightning", "star", "bulletBill"];

// ── items/IItemEffect.ts (OCP extension point — per architecture §4) ────────
interface RaceContext {
  readonly owner: KartEntity;
  readonly allKarts: ReadonlyArray<KartEntity>;   // includes owner, sorted by standings (rank 1 first)
  readonly spawnProjectile: (p: ShellProjectileInit | BulletBillInit) => void;
  readonly placeBanana: (pos: Vec3) => void;
}
interface EffectResult { readonly kind: string; readonly targetId?: string }
interface IItemEffect { apply(ctx: RaceContext): EffectResult[] }

export function getItemEffect(id: ItemId): IItemEffect;   // factory map; throws on unknown id

// ── items/ShellProjectile.ts (pure step) ────────────────────────────────────
type ShellKind = "green" | "red" | "blue";
interface ShellState {
  pos: Vec3; vel: Vec3; kind: ShellKind; ownerId: KartId;
  bounces: number;        // wall + kart bounces (green only counts toward the limit)
  expiresAt: number;      // sim-time seconds; Infinity for green (bounded by bounce limit instead)
}
interface ShellProjectileInit { readonly kind: ShellKind; readonly owner: KartEntity }
interface BulletBillInit { readonly owner: KartEntity }

function stepShell(shell: ShellState, karts: ReadonlyArray<KartEntity>, spline: TrackSpline, dt: number):
  { shell: ShellState; hit?: KartId };   // pure — returns new state; `hit` set when a kart was struck this step

// ── items/ItemBoxSpawner.ts ─────────────────────────────────────────────────
interface ItemBox { readonly id: number; pos: Vec3; item: ItemId | null; respawnAt: number }   // sim-time seconds

class ItemBoxSpawner {
  constructor(track: TrackDefinition, spline: TrackSpline, bus: EventBus<GameEvents>, rng: Rng);
  boxes(): ReadonlyArray<ItemBox>;
  /** One fixed step: respawn timers + pickup checks. Emits item:pickedUp; sets kart.item directly (legal inside RaceController.update). */
  update(karts: ReadonlyArray<KartEntity>, standings: Array<{ id: KartId; rank: number }>, simTime: number, dt: number): void;
}

// ── entities/KartEntity.ts — StatusEffect union (completed this phase) ──────
type StatusEffect =
  | { kind: "boost"; speed: number; remaining: number }   // shroom / drift turbo: force speed while active
  | { kind: "star"; remaining: number }                   // invincible + sustained boost
  | { kind: "shrink"; remaining: number }                 // lightning: maxSpeed ×0.75, steerRate ×0.8
  | { kind: "skid"; remaining: number }                   // banana/oil: spin replaces steering, throttle ignored
  | { kind: "hit"; remaining: number }                    // shell impact: speed ×0.3 + heading kick (kick applied once at grant)
  | { kind: "bulletBill"; remaining: number };            // transform: forced 45 m/s straight

// KartEntity gains: lastOilPatchId: number | null   // guards oil-slick re-trigger per patch

// ── vfx/ScreenShake.ts (render layer) ───────────────────────────────────────
type ShakeSeverity = "hit" | "boost" | "lightning";    // amplitudes 0.25 / 0.1 / 0.35 m (TUNING.shake)

class ScreenShake {
  constructor(bus: EventBus<GameEvents>);               // subscribes to kart:hit, kart:boosted, item:used(lightning)
  trigger(severity: ShakeSeverity): void;               // also called directly by tests
  /** Per-frame camera offset (meters), decaying sine envelope. Newer/stronger events win (no stacking). */
  update(dt: number): { x: number; z: number };
}

// ── TUNING additions (src/data/tuning.ts) — every new gameplay constant ─────
items: {
  // existing (Phase 0 table): shroomBoost: 40, starDuration: 6, lightningShrink: 5, bananaSkid: 1.0, shellBounceMax: 3
  shroomDurationSec: 1.5,
  greenSpeedFactor: 2.0,        // × owner current speed at fire
  redSpeedFactor: 1.6,          // × owner maxSpeed
  blueSpeedFactor: 2.2,         // × TUNING.physics.maxSpeedBase
  redRangeM: 30,                // homing acquisition range (nearest kart ahead by t)
  shellHomingRate: 3.0,         // rad/s — how fast red/blue velocity rotates toward target
  redExpiresSec: 5, blueExpiresSec: 8,
  shellHitRadiusM: 0.8, ownerImmunitySec: 1.0,          // owner immune to own shell for first 1 s after spawn
  hitSlowFactor: 0.3, hitDurationSec: 0.5,              // "hit" status effect
  bananaDropOffsetM: 1.5,       // placed at owner pos − forward × 1.5 m
  bananaLifetimeSec: 30,
  boxRespawnSec: 5, pickupRadiusM: 1.2,
  skidSpinRate: 4,              // rad/s — heading += rate * dt * sign(speed) while skidding
  oilSkidSec: 0.8,
  shrinkMaxSpeedFactor: 0.75, shrinkSteerFactor: 0.8,
  bulletBillSpeed: 45,          // m/s forced
  bulletBillDurationSec: 3,     // or until first kart hit
}
shake: { hitMeters: 0.25, boostMeters: 0.1, lightningMeters: 0.35, decayPerSec: 4, freqHz: 9 }
```

**Item rules (exact):**

| Item | Class | Exact behavior |
|---|---|---|
| `mushroom` | `ZoomShroom` | Grants owner status `{ kind:"boost", speed: TUNING.items.shroomBoost, remaining: 1.5 }`. While active, `stepKart` forces `speed = max(speed, boost.speed)` and ignores throttle for acceleration (brake still works). Emits nothing itself — RaceController emits `kart:boosted {tier:"shroom"}` when it sees the effect result. |
| `greenShell` | `GreenPeaShell` | `spawnProjectile({kind:"green", owner})`: velocity = owner forward × `2× owner current speed`. Travels straight; bounces off barriers (spline edge distance > `roadWidth/2`) up to `shellBounceMax` times, reflecting about the edge normal; hits the **first** kart within 0.8 m (owner immune for first 1 s). On kart hit: target gets `"hit"` status + `kart:hit` emitted, and — classic rule — the green shell **bounces off the hit kart and continues**: reflect velocity about the *target's forward axis*, increment bounce count, keep flying until the bounce limit is reached (then removed). It does NOT respawn as a new shell. |
| `redShell` | `RedChiliShell` | Homing: each step steers toward the **nearest kart ahead on track** (by t-progress) within 30 m; speed held at `1.6× owner maxSpeed`; no bounce limit but expires after 5 s. If it loses its target (kart finishes or > range with no other in range), it flies straight until expiry. Consumed on hit (no kart-bounce). |
| `blueShell` | `BlueStormShell` | Targets the **current rank-1 kart regardless of distance**; speed `2.2× TUNING.physics.maxSpeedBase`; expires after 8 s; consumed on hit. **Retarget rule:** if its target finishes before being hit, it retargets to the new leader (rank 1 among non-finished karts); if no karts remain unfinished, it flies straight until expiry. |
| `banana` | `SlickBanana` | `placeBanana(owner.pos − forward × 1.5 m)`. Persists until hit or 30 s expiry. Any kart (including owner after the 1 s immunity window — keep it simple: *no* owner immunity for bananas, document this deviation) whose center comes within 0.8 m picks it up: kart gets `"skid"` status for `bananaSkid` s + `kart:skid {cause:"banana"}`; banana removed. |
| `star` | `SparkleStar` | Grants owner `{ kind:"star", remaining: TUNING.items.starDuration }`. While starred: invincible — collisions with karts or shells **bounce the OTHER kart** (the other kart gets `"hit"` status + is pushed back along its own −forward) and the star is **not consumed by hits**; it only ends when `remaining` reaches 0. Starred kart also gets a sustained boost (`speed = max(speed, shroomBoost × 0.9)` while active). |
| `lightning` | `ZapLightning` | Every opponent (all karts except owner) gets `{ kind:"shrink", remaining: TUNING.items.lightningShrink }`: while active, that kart's effective maxSpeed ×0.75 and steerRate ×0.8 inside `stepKart`. Owner unaffected. RaceController emits `item:used` with the item id — ScreenShake keys off that for the lightning severity. |
| `bulletBill` | `BulletBill` | Owner transforms: `{ kind:"bulletBill", remaining: 3 }` — speed forced to 45 m/s, steering locked straight (steer input ignored), heading frozen at fire time. Ends early on first kart hit: that kart gets a strong backward impulse (`speed = −12 m/s` via TUNING) + `"hit"` status; owner reverts to normal driving. While bullet-billing the owner is **invulnerable to shells and bananas but NOT to other bullets** (a second bulletBill hitting it still applies its hit rules). |

## Step-by-step tasks

Each step ends green: `npm run lint`, `npx tsc --noEmit`, `npm test` all pass before starting the next. The Phase 4 headless race test must keep passing throughout — items are additive and a no-item race is still valid.

### Step 1 — Item data + spawn tables + tests

Create `src/data/items.ts`. `ITEM_DEFS`: all 8 ids from [`00-overview.md`](./00-overview.md) §3 with display names, one-line descriptions (used by a future tooltip; harmless now), and an `iconColor` hex matching the Phase 4 HUD icon drawing.

**Spawn tables (exact data):** for a 4-kart race, keyed by rank (1 = leader). Tables are nested supersets — each worse rank adds stronger items, so rear of pack always has access to everything the front does plus more:

| Rank | Table (`ItemId[]`, uniform weights) |
|---|---|
| 1 (leader) | `[banana, mushroom]` |
| 2 | `[banana, mushroom, greenShell]` |
| 3 | `[banana, mushroom, greenShell, redShell, star]` |
| 4 (last) | `[banana, mushroom, greenShell, redShell, blueShell, lightning, star, bulletBill]`

**Design decisions (documented):**
- **All 8 items CAN spawn.** The earlier "star/lightning/bulletBill reserved for special cases" idea was rejected in favor of simple, testable data — every item is reachable from a box.
- **`bulletBill` only at rank 4** to avoid instant cheese: the leader can never pull out a bullet bill, and only last place (where it's most useful) sees one.
- `banana` appears in every table (classic behavior — even the leader drops slicks; it's also the weakest item).
- The spawner picks **uniformly** from the table via the seeded race RNG (`rng.int(table.length)`); no per-item weights in Phase 5 (weighting is a Phase 7 tuning-table concern).

Write `tests/unit/items-data.test.ts`: all 8 ids defined with non-empty name/description/iconColor; every rank 1–4 has a non-empty table; **monotonicity** — for ranks r < s, `SPAWN_TABLES[r]` is a subset of `SPAWN_TABLES[s]`, and the max strength (per `STRENGTH_ORDER`) never decreases as rank worsens; `bulletBill` appears only in rank 4's table. **Done when:** tests green.

**Shared test fixture (used by Steps 2–9):** define once at the top of `tests/unit/itemEffects.test.ts` and export it for reuse:

```ts
/** 4 karts on the real Meadows spline at known t-positions, standings rank 1..4 = leader..last. */
export function makeRaceFixture(seed = 7) {
  const track = greenhollowMeadows;                     // src/data/tracks/greenhollow-meadows.ts
  const spline = new TrackSpline(track.controlPoints, 64);
  const rng = createRng(seed);
  const tPositions: Record<string, number> = { leader: 0.50, mid1: 0.35, mid2: 0.20, last: 0.05 };
  const karts = (Object.keys(tPositions) as Array<keyof typeof tPositions>).map((id, i) =>
    makeKartEntity({ id, name: id, t: tPositions[id], spline, stats: baseStats, topSpeedScale: 1 }));
  // karts[0] = rank-1 leader … karts[3] = rank-4 last; pos/heading set from spline.pointAt/tangentAt(t)
  const bus = new EventBus<GameEvents>();
  const projectiles: Array<ShellProjectileInit | BulletBillInit> = [];
  const bananas: Vec3[] = [];
  const ctx: RaceContext = {
    owner: karts[3],                                    // default owner = last place; override per test
    allKarts: karts,                                    // already sorted by standings (rank 1 first)
    spawnProjectile: (p) => projectiles.push(p),
    placeBanana: (pos) => bananas.push(pos),
  };
  return { track, spline, rng, karts, bus, ctx, projectiles, bananas };
}
```

Targeting tests assert against this fixture's known t-positions — e.g. a red shell fired by `last` must pick `mid2` (nearest ahead within 30 m), never `leader`.

### Step 2 — IItemEffect + factory + ZoomShroom end-to-end

Create `src/items/IItemEffect.ts` with the interface exactly as architecture §4 (above) and the factory:

```ts
const REGISTRY = new Map<ItemId, () => IItemEffect>([
  ["mushroom", () => new ZoomShroom()], /* …one line per item as they land… */
]);
export function getItemEffect(id: ItemId): IItemEffect {
  const make = REGISTRY.get(id);
  if (!make) throw new Error(`No effect registered for item "${id}"`);
  return make();
}
```

**Mutation contract (documented):** `apply(ctx)` is called synchronously inside `RaceController.update(dt)` — the one place entity mutation is legal (architecture §7). Effects therefore may directly mutate `statusEffects` on karts in `ctx.allKarts`; world objects (shells, bananas) go through `ctx.spawnProjectile` / `ctx.placeBanana`. The returned `EffectResult[]` (`kind` ∈ `"boost" | "projectile" | "bananaPlaced" | "starred" | "shrunkAll" | "bulletBill"`, optional `targetId`) is what RaceController uses to emit events — effects never touch the bus directly.

Implement `ZoomShroom`. Wire the **use flow** into `RaceController.update` (racing phase, after input read): if player or any AI has `state.item !== null` and its `DriveInput.useItem` edge is true → build `ctx` (`allKarts` sorted by the current standings snapshot), call `getItemEffect(item).apply(ctx)`, clear `kart.state.item = null`, emit `item:used {kartId, item}`, and translate results into events (e.g. `"boost"` → `kart:boosted`). AI karts use items automatically when they hold one (their `DriveInput.useItem` is set by a trivial rule in the controller — always true if holding; Phase 4's `WaypointAiStrategy` doesn't know about items, keep it that way).

**End-to-end verification:** extend the headless harness with a test: place player kart at a box position (or just set `kart.item = "mushroom"` directly), fire useItem for one step, assert the boost status exists with `speed === TUNING.items.shroomBoost` and decays to gone after 1.5 s of steps, and that speed actually exceeded base maxSpeed during the window. **Done when:** test green.

### Step 3 — SlickBanana + skid physics integration

Extend `KartPhysics.stepKart` with status-effect handling (pure, all constants from TUNING):
- `"skid"`: steering is replaced by a fixed spin — `heading += TUNING.items.skidSpinRate * dt * Math.sign(state.speed || 1)`; throttle and steer inputs are ignored (kart coasts at current speed with normal drag). Decrement `remaining`.
- `"hit"`: effective maxSpeed ×`hitSlowFactor`; decrement. The random heading kick is applied **once** when the status is granted (by RaceController, using the race RNG — not inside pure physics), so `stepKart` stays deterministic per input.
- `"shrink"`, `"boost"`, `"star"`, `"bulletBill"`: implement in Steps 6–8 as their items land; leave clearly-marked switch cases now only if you prefer one pass — otherwise add each with its item step.

Oil slicks (Lagoon hazard data from Phase 3): when `surface === "oilSlick"`, grant a 0.8 s `"skid"` **on first contact per patch** and emit `kart:skid {cause:"oilSlick"}`. Re-trigger guard: each hazard placement gets a stable numeric id (its index in `track.hazards`); `KartEntity.lastOilPatchId` records the last patch that triggered — a kart sitting on the same patch does not re-skid every frame, but leaving and returning to it (or hitting a different patch) triggers again. Document this: per-patch memory is intentional so oil patches are avoidable hazards, not continuous fields.

Banana world objects in `RaceController`: list of `{ pos, expiresAt }`; each step, any kart within 0.8 m picks one up → `"skid"` for `TUNING.items.bananaSkid` s + `kart:skid {cause:"banana"}`; expire after 30 s.

Write tests in `tests/unit/itemEffects.test.ts` (SlickBanana describe): `apply()` places a banana at exactly `owner.pos − forward × 1.5 m`; stepKart with active skid spins heading at the expected rate and ignores throttle/steer; oil-slick first-contact grants skid once per patch id, second contact on same patch does not, different patch does. **Done when:** tests green.

### Step 4 — GreenPeaShell: `stepShell` + bounce math (pure geometry)

Create `src/items/ShellProjectile.ts`. `stepShell(shell, karts, spline, dt)` is pure and handles all three kinds; this step implements the shared core + green behavior:

1. Integrate: `pos += vel * dt`.
2. **Wall bounce:** `cp = spline.closestPoint(pos.xz)`; if `cp.distance > roadWidth / 2` (barrier), reflect velocity about the edge normal `n` (unit vector from centerline point toward shell position):

```ts
// Reflection formula — v' = v − 2(v·n)n. Preserves |v| exactly (up to float error).
const dot = vel.x * n.x + vel.z * n.z;
vel = { x: vel.x - 2 * dot * n.x, y: 0, z: vel.z - 2 * dot * n.z };
// Also push the shell back inside the road so it can't tunnel out next step.
pos = centerlinePoint + n * (roadWidth / 2 - 0.1);
shell.bounces += 1;
if (shell.kind === "green" && shell.bounces > TUNING.items.shellBounceMax) → remove (return expired state);
```

3. **Kart collision:** first kart with `dist(shell.pos, kart.pos) < TUNING.items.shellHitRadiusM`, skipping the owner while `simTime − spawnTime < ownerImmunitySec` (store `spawnAt` on the init→state conversion). On hit: return `{ shell, hit: kartId }`. RaceController (not stepShell) applies the `"hit"` status + heading kick and emits `kart:hit {kartId, byKartId: ownerId, shellKind}`. For **green** shells only: reflect velocity about the *target's forward axis* `f` with the same formula (`v' = v − 2(v·f)f`), increment bounces, continue until bounce limit. Red/blue are consumed (removed) on hit.

Write `tests/unit/shellPhysics.test.ts`: straight travel — after N steps, distance ≈ `|v| * dt * N` within ±2%; wall bounce — construct a shell aimed at the road edge on the real Meadows spline, assert post-bounce velocity satisfies `|v'| === |v|` within 1e-6 and direction is mirrored about n (dot-product check), and `bounces` incremented; green shell removed exactly after the 4th bounce (`shellBounceMax = 3`). **Done when:** tests green.

### Step 5 — RedChiliShell + BlueStormShell homing targeting

Extend `stepShell` with homing for red/blue: each step, find the target (red: nearest kart ahead by t-progress within `TUNING.items.redRangeM`, excluding owner; blue: rank-1 kart among non-finished, any distance — pass current standings via a small optional param or recompute from karts+spline inside the pure function), then rotate velocity toward it with a bounded turn rate:

```ts
// Homing steer — rotate vel toward target by at most shellHomingRate * dt radians.
const desired = normalize(target.pos − shell.pos);                 // XZ plane
const err = signedAngle(velDir, desired);                          // (−π, π]
const turn = clamp(err, −TUNING.items.shellHomingRate * dt, TUNING.items.shellHomingRate * dt);
vel = rotateAboutY(vel, turn) with |vel| held at the kind's speed;  // red: 1.6× owner maxSpeed (fixed at fire), blue: 2.2× maxSpeedBase
```

Expiry: red after 5 s, blue after 8 s (`expiresAt` checked each step). Blue retarget on leader finish falls out naturally if the target lookup runs every step against non-finished karts — document that no special-case code is needed beyond "finished karts are excluded from targeting".

Write tests (shellPhysics.test.ts, homing describe) using a **fake kart array on the real Meadows spline**: place 4 karts at known t-positions; red shell fired by the rearmost kart must reduce its angle to the *nearest ahead* kart monotonically every step (assert `|err|` strictly decreases for K consecutive steps until hit); blue shell fired by last place targets the leader even when a nearer kart exists mid-pack (assert it hits the leader, not the neighbor). **Done when:** tests green.

### Step 6 — SparkleStar invincibility rules

Implement `SparkleStar` (status grant + sustained boost in physics) and the collision rules in RaceController: while a kart is starred, shell hits and banana pickups targeting it are **deflected** — the attacker's projectile/banana source gets the `"hit"` treatment instead (for shells: the *shooter* takes the bounce-back; for bananas: nothing happens to the star, banana is consumed), karts colliding with a starred kart get pushed back along their own −forward + `"hit"`, and the star's `remaining` is untouched by any of these — only time expires it.

Tests (itemEffects.test.ts, SparkleStar describe): apply() grants star with exact duration; starred kart hit by green shell → shooter gets "hit", star remaining unchanged after the hit step; star expires at exactly `starDuration` s ± 1 step. **Done when:** tests green.

### Step 7 — ZapLightning shrink

Implement `ZapLightning`: every opponent gets `{ kind:"shrink", remaining: TUNING.items.lightningShrink }`; in `stepKart`, active shrink multiplies effective maxSpeed by 0.75 and steerRate by 0.8 (both from TUNING). Owner immune.

Tests (itemEffects.test.ts, ZapLightning describe): apply() shrinks exactly the 3 non-owner karts in the fixture; a shrunken kart's terminal speed on full throttle is ≈ 0.75× its unshrunken value (measure over 10 s of steps within ±2%); shrink wears off at `lightningShrink` s. **Done when:** tests green.

### Step 8 — BulletBill transform

Implement `BulletBill`: owner gets `{ kind:"bulletBill", remaining: TUNING.items.bulletBillDurationSec }`; in `stepKart`, active bulletBill forces `speed = 45 m/s`, ignores steer (heading frozen). In RaceController per step: a bullet-billing kart hitting any other kart within 0.8 m → that kart gets backward impulse (`speed = −12`) + `"hit"` status, owner's effect ends immediately (revert to normal driving at the hit point), `kart:hit` emitted with `byKartId`. Invulnerability matrix while bullet-billing: immune to shells and bananas; **not** immune to another bulletBill.

Tests (itemEffects.test.ts, BulletBill describe): apply() grants the transform; forced speed holds at 45 m/s over steps regardless of throttle; steering input does not change heading; hitting a kart ends the effect early and applies the impulse to the victim; a second bulletBill still hits the first one. **Done when:** tests green.

### Step 9 — ItemBoxSpawner: respawn + pickup rules

Create `src/items/ItemBoxSpawner.ts`. One box per cluster anchor in `track.itemBoxClusters` (position = `spline.pointAt(cluster.t)` offset laterally by `cluster.lateralOffset ?? 0`). **Decision (documented):** each anchor holds ONE rotating box, not a 3-stack — lean scope; the rotation is visual-only (KartRenderer spins it). Rules:
- Box with no item spawns one when taken: pick from `SPAWN_TABLES[rank of nearest kart]`… simpler and deterministic: **the table used is that of the rank of the kart who takes it** (position-based at pickup time, classic behavior), drawn uniformly via the seeded race RNG.
- Pickup radius 1.2 m; a kart can only pick up if `kart.state.item === null`; **one kart per box per spawn cycle** — once taken, the box is empty until `respawnAt = simTime + TUNING.items.boxRespawnSec` (5 s), then it re-rolls for the next taker.
- On pickup: set `kart.state.item`, emit `item:pickedUp {kartId, item}`.

Wire into `RaceController.update` (racing phase): `spawner.update(karts, standingsSnapshot, simTime, dt)` — pass the 1 Hz standings snapshot from Phase 4 so rank lookups are stable and cheap. HUD item slot now shows the real held icon (Phase 4's `drawItemIcon` already handles all ids).

**Full per-step item pipeline in `RaceController.update` (exact order, after Phase 4's physics/drift/lap block):**

1. **Use items** — for each kart with `state.item !== null` and a `useItem` edge: build `ctx`, `getItemEffect(item).apply(ctx)`, clear the item, emit `item:used`, translate results into events (`kart:boosted`, etc.).
2. **Step shells** — for each live shell: `stepShell(shell, karts, spline, dt)`; on `hit` apply the `"hit"` status + RNG heading kick to the target (or deflection rules per Step 6/8), emit `kart:hit`, remove or continue the shell per its kind.
3. **BulletBill collisions** — for each bullet-billing kart, check 0.8 m hits against other karts; apply impulse/revert rules (Step 8).
4. **Banana pickups + expiry** — proximity check per banana (Step 3); drop expired ones.
5. **ItemBoxSpawner.update** — respawn timers + new pickups (this step's code).
6. **Status-effect decay** happens inside `stepKart` itself, so no separate pass is needed; the controller only *grants* effects and reacts to their results.

Ordering matters for determinism: shells are stepped in spawn order, karts iterated in fixed entity-array order (never sorted per step), and all randomness flows through the single seeded race RNG — this keeps Phase 4's ±0 ms determinism guarantee intact with items enabled.

Write `tests/unit/spawner.test.ts`: kart within radius picks up → item set + event emitted with matching id; box empty until the 5 s respawn timer elapses (no second pickup at t+0.1, allowed after t+5.01); two karts overlapping an emptying box — only one gets the item in that cycle; a kart already holding an item cannot pick up again. **Done when:** tests green.

### Step 10 — ScreenShake + event wiring + hit flash

Create `src/vfx/ScreenShake.ts` (render layer — Babylon imports allowed here). Envelope: on `trigger(severity)`, record amplitude A (from `TUNING.shake`: hit 0.25 m, boost 0.1 m, lightning 0.35 m) and reset the local clock; per frame, offset = `A * e^(−decayPerSec · t) * sin(2π · freqHz · t)` applied to camera X/Z (random fixed axis per trigger from the race RNG — pass in or derive from event id). Newer events replace older ones (no stacking — a boost during a hit doesn't double amplitude; document this as a deliberate simplicity choice). Subscriptions: `kart:hit` → "hit", `kart:boosted` → "boost" (any tier), `item:used` with `item === "lightning"` → "lightning". The chase camera (Phase 3) adds the offset in its per-frame update.

KartRenderer hit-flash hook: subscribe to `kart:hit`, set the kart body material's emissive to white, decay to black over ~0.3 s in the render loop. This is the *only* item VFX this phase ships — everything else (flames, explosions, sparkle) waits for Phase 6's `ParticleFactory`, which will subscribe to the same events already being emitted.

Verify: unit-test the envelope math headlessly (offset at t=0 is 0, peaks near A/√2 within the first period, decays below 1% of A by ~2 s); manual — trigger a hit in dev and confirm visible shake + flash. **Done when:** tests green + manual check.

### Step 11 — Manual "trigger every item" checklist

In `npm run dev` (use Phase 4's AI-drive hook for the player if needed, or drive manually), complete this checklist on Greenhollow Meadows:

- [ ] Pick up a box at each rank position; confirm the spawned item is always legal for that rank per the tables.
- [ ] `mushroom`: visible speed spike ~1.5 s, then back to normal.
- [ ] `greenShell`: flies straight, bounces off road edge (watch it reflect), hits a kart → victim slows + flash; shell continues after bouncing off the kart and dies after its 3rd bounce.
- [ ] `redShell`: curves toward the nearest kart ahead; expires mid-air if no target in range.
- [ ] `blueShell` (drive to last place first): homes across the whole track to the leader; if you let the leader finish, it retargets the new leader.
- [ ] `banana`: drops behind you; next kart over it spins ~1 s uncontrollably.
- [ ] `star`: ~6 s of invincibility + boost; a shell hitting you bounces *them*; star survives hits and ends on time.
- [ ] `lightning`: all 3 opponents visibly shrink/slow for ~5 s; screen shakes harder than a normal hit.
- [ ] `bulletBill` (last place): transform to straight-line bullet at high speed; hitting a kart knocks it backward and reverts you; shells/bananas pass through you while transformed.
- [ ] Oil slicks on Lagoon: first contact per patch skids 0.8 s, sitting on the same patch doesn't re-trigger.

**Done when:** every box checked with no crashes and behavior matching the rules table above.

## Acceptance criteria

All of [`00-overview.md`](./00-overview.md) §8 Definition of Done, plus the P5 exit gate (§7 row):

1. All Phase 5 unit tests green: `items-data.test.ts`, `shellPhysics.test.ts`, `itemEffects.test.ts` (one describe per item), `spawner.test.ts` — including targeting integration assertions (red → nearest ahead, blue → leader) and the pure bounce-math checks (`|v'| === |v|` within 1e-6).
2. Phase 4's headless full-race test still green with items enabled in the simulation (items must not break determinism — same seed ⇒ identical item spawns, hits and final standings; add a seeded assertion to `headlessRace.test.ts` if cheap: two runs produce identical `item:pickedUp` sequences).
3. Manual "trigger every item" checklist (Step 11) fully passed on Meadows (oil-slick line verified on Lagoon data).
4. HUD item slot shows the real held-item icon and clears on use; screen shake fires on hit/boost/lightning with the documented amplitudes.

## Test list

| File | Covers |
|---|---|
| `tests/unit/items-data.test.ts` | All 8 ids defined (name/description/iconColor non-empty); tables non-empty for ranks 1–4; strength monotonicity via `STRENGTH_ORDER`; `bulletBill` only in rank 4 table (Step 1) |
| `tests/unit/shellPhysics.test.ts` | Straight travel distance ≈ speed·dt over N steps ±2%; wall bounce reflects correctly with \|v\| preserved ±1e-6 and bounce count increments; green shell removed after bounce limit; homing shell reduces angle to target monotonically each step until hit; red targets nearest-ahead, blue targets leader on a fake 4-kart array at known t-positions over the real spline; expiry removes red (5 s) / blue (8 s) shells (Steps 4–5) |
| `tests/unit/itemEffects.test.ts` | One describe per item against `makeRaceFixture()` — a helper in this file building 4 karts at known t-positions on the Meadows spline with controlled standings, asserting: ZoomShroom boost window; SlickBanana placement offset + skid spin physics + oil first-contact-per-patch; GreenPeaShell kart-bounce continuation; RedChili/BlueStorm targeting picks the RIGHT kart; SparkleStar invincibility (shooter takes the hit, star survives) and time expiry; ZapLightning shrinks exactly the 3 opponents with correct speed cap; BulletBill forced speed / frozen heading / early end on hit / bullet-vs-bullet rule (Steps 2–8) |
| `tests/unit/spawner.test.ts` | Pickup within radius sets item + emits `item:pickedUp`; box empty until respawn timer elapses; two karts can't take the same spawn cycle; no double-pickup while already holding an item (Step 9) |

Existing Phase 1–4 tests must remain green throughout — especially `KartPhysics` (status-effect integration) and the headless race determinism test.
