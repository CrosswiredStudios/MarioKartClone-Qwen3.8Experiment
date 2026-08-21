# Debugging Guide

> How to inspect live game state, run probe scripts, and map symptoms to root causes. For test-running details see [`TESTING.md`](./TESTING.md); for verified engine API facts see [`BABYLON-V9.md`](./BABYLON-V9.md) and [`HAVOK.md`](./HAVOK.md).

## 1. Debug handles (exposed on `window`)

Both handles are declared and wired in `src/main.ts`. Read them with `page.evaluate(...)` in Playwright or the browser devtools console.

### `window.__game` (always present)

| Member | Returns |
|---|---|
| `state` | Current game-screen id (`"MainMenu"`, `"CharacterSelect"`, … `"Results"`) |
| `navigate(screen)` | e2e-only escape hatch — force a state transition (production navigation always goes through the UI) |
| `snapshot()` | `{ state, raceConfig, drive? }` — `drive` has `kartPos`, `speed`, `surface`, `driftCharge` |
| `standings()` | `[{ id, name, rank, lap, t }]` |
| `karts()` | `[{ id, pos:{x,y,z}, speed, lap, item, charging }]` |
| `racePhase()` | RaceController phase: `"countdown" \| "racing" \| "finished" \| "none"` |
| `shells()` | Live shell-projectile count (0 when no race active) |

### `window.__game` debug-only members (present only when `debugAllowed`)

`debugAllowed = import.meta.env.DEV || URL has ?debug`. In preview/prod builds you **must** load `http://localhost:4173/?debug`.

| Member | Purpose |
|---|---|
| `aiDrivePlayer()` | Let the AI drive the player kart (full-race e2e) |
| `setItem(item)` | Force the player's held item (e2e / playtest) |
| `bumps()` | Count of `kart:bumped` events since load |
| `probeCollision()` | Spawn two dynamic spheres head-on; tap the world-level collision observable. Returns `{ count(), dispose() }` |
| `hfProbe()` | 2×2 heightfield with one tall cell + four spheres; `read()` returns each sphere's Y (heightfield layout experiments) |
| `physRayDown(x, z)` | Raycast straight down in the LIVE physics world; returns hit Y or null |
| `fieldHeightAt(x, z)` | Raw `HeightField.heightAt` ground truth (NaN pre-race) |

### `window.__sw` (dev-only scene handle)

| Member | Purpose |
|---|---|
| `cam()` | Active camera position + fov |
| `skids()` | Skid-marks mesh vertex/index counts (grows during drift, decays ~1.4 s after release) |
| `karts()` | Count of `*-body` meshes |
| `sceneInfo()` | Total mesh count, body names, `track-root` / `skid-marks` presence |
| `road()` | Deep dump of the `track-road` mesh: visibility, material, bbox, fog |
| `pick(nx, ny)` | Screen-space pick → front-most mesh hit (sets a temp full-screen Viewport internally) |
| `quality()` | `{ preset, budget, scalingLevel, stored }` from QualityManager |
| `dbg(fn)` | **Raw scene access** — `window.__sw.dbg(scene => …)` for any one-off probe (used by `lighting-pbr.spec.ts`) |

## 2. Probe scripts (`scripts/`)

Standalone Playwright-based scripts that drive a headless Chromium against the **preview server** (`npx vite preview --port 4173`), NOT the dev server (dev serves HTML for the Havok `.wasm` — see [`HAVOK.md`](./HAVOK.md)).

| Script | Purpose |
|---|---|
| `smoke-physics.mjs` | Load page, check `window.__game`, filter console errors for `/havok\|wasm\|physics/` |
| `smoke-race-physics.mjs` | Menu → selections (Enter) → AI race via `?debug` + `aiDrivePlayer`; asserts `physicsTerrain` + ≥4 `-kartbody` nodes; samples `karts()` over 6 s, requires avg travel > 5 m/s |
| `smoke-bump-event.mjs` | Force a kart↔kart collision (magnet technique, §4) and verify `kart:bumped` fires end-to-end |
| `probe-collision-events.mjs` | Two-sphere world-level collision-observable probe |
| `probe-kart-collision.mjs` | Kart-specific collision diagnostics |
| `probe-terrain.mjs` / `probe-race-terrain.mjs` | Compare rendered/physical surface vs `field.heightAt` ground truth |
| `probe-hf-baseline.mjs` / `probe-hf-dev.mjs` / `probe-hf-layout.mjs` | Heightfield buffer→world mapping experiments |
| `probe-fall.mjs` / `probe-sphere-drop.mjs` | Gravity/airborne model checks |
| `probe-trees.mjs` / `probe-render-blank.mjs` / `probe-render-blank2.mjs` | Prop/rendering diagnostics |

## 3. Environment constraints (this machine)

- **Screenshots fail** — `screenshot_page` returns 400 "Invalid 'messages' in payload". Verify via `read_page` DOM snapshots + `page.evaluate` against the debug handles. Never build a verification loop around screenshots.
- **The integrated-browser tab is rAF-throttled when backgrounded** — `requestAnimationFrame` does not fire, so the fixed-timestep loop freezes (countdown stuck at "3") even after `bringToFront()`/click. You cannot drive a live race in the integrated browser. Use Playwright's own headless Chromium (`npx playwright test` or the probe scripts) — it runs unthrottled with WebGL2.
- **Repeated `page.reload()` exhausts the WebGL2 context pool** — fresh loads show "needs WebGL2" even though a probe canvas gets webgl2 fine moments later. Wait ~3 s for the pool to drain, then reload once.
- **The hidden `#webgl2-error` h1 is ALWAYS in the DOM** — don't use its text as a boot-failure signal; check for the Start button (`data-testid="screen-main-menu"`) instead.
- **Playwright snippet context has no bare `setTimeout`** — use `await page.waitForTimeout(ms)`.

## 4. Forcing a Havok collision (proven technique)

Native collision events work, but karts never physically touch during normal AI racing (they spread along the track), and kart↔terrain pairs are silent by design (only kart bodies have `setCollisionCallbackEnabled(true)`). To force a kart↔kart collision:

- `node.position.set()` does **NOT** move a dynamic body — the plugin syncs **body→node** each step, overwriting node teleports within one frame.
- A one-shot `setLinearVelocity` is overwhelmed in ~1 s: `KartBody.apply()` re-applies drive impulse every fixed step (racing speed accumulates to ~38 m/s).
- **What works: a per-frame magnet** — a 16 ms `setInterval` that re-asserts opposing ±10 m/s velocities toward each other until contact. Closed 35 m → 2.9 m in ~800 ms; observed `COLLISION_STARTED` impulse 422.6 N·s (threshold is `TUNING.physicsWorld.bumpImpulseThreshold` = 40).

## 5. Symptom → cause table

| Symptom | Cause / fix |
|---|---|
| "X is not a function" in e2e while unit tests pass | Stale `dist/` — `npm run build` then rerun (see [`TESTING.md`](./TESTING.md) §3) |
| "expected magic word 00 61 73 6d" (or `3c 21 64 6f`) | Dev server served HTML for the Havok `.wasm` (SPA fallback). Test against `vite preview`, not `vite` dev |
| "ReferenceError: HK is not defined" at runtime (build succeeds) | `HavokPlugin` ctor arg order — the loaded instance is the **second** arg: `new HavokPlugin(true, hk)` |
| Gray/washed-out sky | `emissiveColor` set on the skybox material — it is additive in v9. Leave it black (see [`BABYLON-V9.md`](./BABYLON-V9.md)) |
| Road renders as hairline strips | Hand-written vertex buffers don't render in this build — use `MeshBuilder.CreateRibbon` |
| Lit texture invisible (unlit still shows) | `DynamicTexture` transparent until `tex.update()` is called after drawing |
| Road texture shows only a sliver near start/finish | `DynamicTexture` defaults to CLAMP addressing — set `WRAP_ADDRESSMODE` before `uScale > 1` |
| Karts frozen at speed 0, no exception | Pre-physics state passed as the base to a transform that returns a new state — always pass the post-physics `next` |
| Race ends in ~35 s with AI DNFs | Bullet-bill knockback fake laps — `trackLaps` must discard steps where `crossed.length > 1` |
| Race freezes permanently after GO | An exception escaped `onUpdate` out of the rAF callback and the loop never re-armed. `FixedTimestepLoop.advance()` now try/catches (logs first 3 errors) — read the console |
| Countdown zoom already done when world appears | A per-frame clock advanced during the loading screen — gate it on `isWorldReady` |
| "No camera defined" on `scene.render()` | No active camera — main.ts parks a placeholder UniversalCamera until a scene sets one |
| E2E DOM matches old code | Leftover preview process on :4173 silently reused — kill it, rebuild, rerun |
| Menu button click times out ("detached from DOM") | Buttons are rebuilt every frame — click via direct DOM dispatch in one `evaluate` (see [`TESTING.md`](./TESTING.md) §5) |
