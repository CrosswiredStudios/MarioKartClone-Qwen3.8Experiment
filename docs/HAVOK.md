# Havok Physics Facts (verified against `@babylonjs/core` ^9.21.2 + `@babylonjs/havok` 1.3.14)

> Every fact below was verified against the installed build (`.d.ts` + runtime probes). The plan docs predate the physics rewrite; this file is the source of truth for the Havok integration. Update it in the same commit as any physics-related change.

## Architecture (hybrid brain/body model)

- `src/scene/PhysicsWorld.ts` — owns the plugin lifecycle + the static terrain HEIGHTFIELD body. Render-adjacent (imports Babylon). Exposes an opaque `IPhysicsWorld` handle in `core/GameStateMachine.ts`, injected via `GameApp.setPhysicsWorld()` after `await init()`; wired in `main.ts` top-level await.
- `src/entities/KartBody.ts` — one kart's rigid **capsule** body ("muscle"). Implements `IKartDrive`. Render-adjacent. Invisible `TransformNode` anchor named `${k.id}-kartbody`; node Y = surface + `centerHeightM`; spawn quat `FromEulerAngles(0, heading, 0)` (heading 0 = +Z).
- `src/entities/kartDriveMath.ts` — **pure/Babylon-free** drive math: `driveImpulse` (clamped to `maxDriveAccelMps2·m·dt`), `targetYawRate`, `forwardVec`. Unit-testable.
- **Wiring** (per-kart loop in `RaceController`): `k.drive?.sync(k)` → `stepKart(terrain = k.drive ? undefined : this.terrain)` → `k.state = next` → `k.drive?.apply(next, dt)`. Hit paths push real impulses (`scaleSpeed`/`kickYaw`/`setSpeed`) because direct state writes get clobbered by the next `sync()`.
- `RaceScene`/`FreeDriveScene` create bodies on enter (after `track.build` + `buildTerrain`), dispose + `clearTerrain` on exit. **`drive === null` → legacy kinematic integration** — this is what keeps headless unit tests (no physics) unchanged.
- All constants live in `TUNING.physicsWorld` (see [`tuning-table.md`](./tuning-table.md)).

## WASM loading under Vite

- WASM loads natively: the ESM bundle resolves `HavokPhysics.wasm` via `new URL(..., import.meta.url)`. No `public/` copy or `?url` needed. Prod build emits `dist/assets/HavokPhysics-*.wasm` (~2 MB).
- **DEV MODE GOTCHA:** the dev server serves `index.html` (SPA fallback) for the `.wasm` → "expected magic word … found 3c 21 64 6f" (`<!do`). Only affects `vite` dev, NOT preview/prod. **Smoke-test against `npx vite preview --port 4173`, not dev.**
- `vite.config.ts` has `optimizeDeps.exclude: ["@babylonjs/havok"]` — **load-bearing.** Without it, Vite's dep optimizer rewrites the `new URL(...)` to a non-existent `.vite/deps/HavokPhysics.wasm`.

## Plugin & engine API

- **`HavokPlugin` ctor GOTCHA:** signature is `(useDeltaForWorldStep?: boolean, hpInjection?, parameters?)`. The loaded Havok instance is the **SECOND** arg: `new HavokPlugin(true, hk)`. Passing it first → falls back to the bare `HK` global default → "ReferenceError: HK is not defined" at runtime (build succeeds!).
- Import surface: `HavokPlugin` is NOT in the v2 index — deep import `@babylonjs/core/Physics/v2/Plugins/havokPlugin.js`. Everything else from bare `@babylonjs/core`.
- Concrete engine class is exported as `PhysicsEngineV2`; `scene.getPhysicsEngine()` returns `IPhysicsEngine | null`.
- **Scene auto-steps physics each render frame**, gated by the public `scene.physicsEnabled` (`Scene._animate` → `_advancePhysicsEngineStep`). Freeze while Paused = set `scene.physicsEnabled = false` (via `PhysicsWorld.setFrozen`). **Never call `_step` manually.**
- No body-level collision groups in this build; default masks → all bodies collide (kart↔kart bumping works out of the box). `filterMembershipMask`/`filterCollideMask` on the shape exist if selective filtering is ever needed.
- `PhysicsBody` ctor: `(transformNode, motionType, startsAsleep, scene)`. `PhysicsShape` ctor: `({ type, parameters }, scene)`; assign via `body.shape =`.
- **`PhysicsBody.dispose()` does NOT dispose its transform node** — dispose the node separately. No `wakeUp`/`sleep` API on the body (only the `startAsleep` ctor param); bodies start awake.
- **The plugin writes body transforms back to nodes each step** → `TransformNode` position/quaternion is Havok-updated automatically; read it in `sync()`. Conversely, **`node.position.set()` does NOT move a dynamic body** — the body→node sync overwrites node teleports within one frame. There is no `setPosition()` on the body — velocity/impulse only.
- Velocity methods: `setLinearVelocity(v)` / `getLinearVelocity()` — **NOT** `setVelocity`.
- `applyImpulse`/`applyForce` LOCATION IS **WORLD SPACE** (`_bVecToV3WithOffset`). `applyForce` = impulse × timestep. Passing `node.position` (zero Y component for pure translation through CoM) is correct.
- `setMassProperties` MERGES partial fields with computed mass props → `{ ...body.computeMassProperties(), mass }` is safe.
- CAPSULE shape params: `pointA: Vector3, pointB: Vector3, radius: number`. The `PhysicsShapeCapsule` helper class exists in `physicsShape.d.ts` but is **NOT index-exported** → use generic `new PhysicsShape({ type: PhysicsShapeType.CAPSULE, parameters }, scene)`.

## HEIGHTFIELD (terrain)

- Fully implemented (initShape case 7). The direct-data path needs **ALL** of: `numHeightFieldSamplesX/Z`, `heightFieldSizeX/Z`, `heightFieldData` (Float32Array) — else it throws.
- BJS buffer is row-major, **x-fastest**: `index = z * samplesX + x`; the plugin flips internally.
- Shape local origin is at corner (0,0) → anchor the static `TransformNode` at `(bounds.minX, 0, bounds.minZ)` and store **ABSOLUTE world Y** in the data so local y=0 == world y=0.
- The pure `HeightField` (`src/tracks/TrackElevation.ts`) is the single source of truth: the render layer (`TrackBuilder.field`) and game logic (`RaceController.terrain`) sample the SAME field, so kart Y, slope model, skid marks, road ribbon and barriers all agree.

## Collision events

- **Collision callbacks are OFF by default in v2.** Per-body path: `body.setCollisionCallbackEnabled(true)` then `body.getCollisionObservable()` — this is what `KartBody` uses and it works.
- World-level tap for diagnostics: `scene.getPhysicsEngine().getPhysicsPlugin().onCollisionObservable` (public on the v2 engine).
- Kart↔terrain pairs are silent by design — only kart bodies have callbacks enabled.
- Karts **never physically touch** during normal AI racing (they spread along the track) — "zero collision events" in a normal race is expected, not a bug. To force one, use the per-frame magnet technique (see [`DEBUGGING.md`](./DEBUGGING.md) §4).

## Drive model details (hybrid)

- **Timing:** `sync()` at the START of the fixed step (body→state); the brain runs with `terrain = undefined` when driven; `apply()` right after `k.state = next`. The plugin has synced node transforms since the last physics step.
- **Snapped-authority rule:** bulletBill/boost/star get the FULL impulse `(next.speed − curFwd)·m` (the brain snaps speed); everything else is clamped via `driveImpulse` to `maxDriveAccelMps2·m·dt` so bumps matter for normal driving (the engine takes ~0.3–1 s to recover after a shove — the arcade "shoved" feel).
- **Yaw:** `setAngularVelocity(new Vector3(0, yawRate, 0))` each apply — X/Z zeroed kills bump-induced roll/pitch. `kickYaw` adds Δ/dt on top of `_lastAppliedYaw` (**NOT** an `atan2` diff — ±π wrap hazard).
- `state.pos.y = node Y − centerHeightM` (surface-height renderer convention); `speed = dot(vel, fwd)` (can go negative after a backward shove; the brain clamps to `reverseMax`).
- Uphill: while climbing, `KartBody` scales drive authority by `(1 + uphillPowerFactor × clampedGradient)` so the engine fights gravity harder on climbs.

## Smoke tests

- `scripts/smoke-physics.mjs` — headless Chromium (Playwright), loads the page, checks `window.__game`, filters console errors for `/havok|wasm|physics/`. Run vs the preview server.
- `scripts/smoke-race-physics.mjs` — drives menu→selections (Enter)→AI race (`?debug` + `aiDrivePlayer`), asserts the `physicsTerrain` node + ≥4 `-kartbody` nodes exist, samples `window.__game.karts()` over 6 s and requires avg travel > 5 m/s. Menu buttons are rebuilt every frame → click via direct DOM dispatch in one `evaluate`.
- `scripts/smoke-bump-event.mjs` — magnet technique + world-level tap; verifies `kart:bumped` fires end-to-end.
