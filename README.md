# Turbo Turtle Rally

A polished, single-player kart racer for the browser, built with **Babylon.js v9** and **Havok** physics. Pick a character, vehicle and map, then race **3 laps** against **3 AI opponents** using the full classic item set — boosts, shells, bananas, star, lightning and bullet bill. Two themed maps (a rolling grassland loop and a volcanic canyon circuit with cliff drops), drift with charged mini/super turbo, speed-reactive synthesized engine audio, particle VFX, screen shake, post-processing, and a podium + confetti + fanfare finish. **All audio and VFX are synthesized in code — no asset files required** (only two skybox cubemaps).

## Requirements

- A modern browser with **WebGL2** (Chrome/Edge/Firefox/Safari, roughly "last 2 years"). A friendly overlay is shown if WebGL2 is missing.
- **Keyboard required** — no gamepad or touch support by design.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Other scripts:

```bash
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/ on port 4173
npm test           # Vitest unit tests (pure logic, headless)
npm run test:e2e   # Playwright (spins up the preview server automatically)
npm run lint       # ESLint
```

## Controls

| Input | Action |
|---|---|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A`/`D`, `←`/`→` | Steer left/right |
| `Space` (hold while turning) | Drift — charge escalates white → blue; release for **mini** or **super** turbo boost |
| `E` / `Enter` | Use item |
| `Esc` | Pause menu (resume / settings / quit to menu) |

## Tests

- **Unit** (`npm test`) — Vitest in a node environment, no WebGL. Covers spline math, lap tracking, the drift state machine, kart physics (incl. gravity/airborne), a **headless full 3-lap race simulation**, item targeting, spawn tables, audio scheduler math, and more.
- **E2E** (`npm run test:e2e`) — Playwright on the preview server: menu smoke, selection navigation, and a scripted full 3-lap race to the results screen. Assertions go through the DOM + the `window.__game` debug handle — **never screenshots**.

See [`docs/TESTING.md`](./docs/TESTING.md) for the canonical gate sequence and the hard rules (build before e2e, stale-server gotchas), and [`docs/DEBUGGING.md`](./docs/DEBUGGING.md) for the debug handles and symptom→cause table.

## Project structure

```
src/
  main.ts            # bootstrap: WebGL2 check, engine, scene, GameApp wiring; window.__game handle
  core/              # GameApp, GameStateMachine, EventBus, FixedTimestepLoop, RaceConfig, Rng, SettingsStore
  input/             # IInputSource + KeyboardInput
  data/              # pure data: characters, vehicles, items, tuning, tracks/
  entities/          # KartEntity, KartPhysics, KartBody (Havok), DriftController, AI strategies, renderers
  tracks/            # TrackSpline, TrackBuilder, TrackElevation, LapTracker, PropBuilder
  items/             # IItemEffect + all 8 items, ShellProjectile, ItemBoxSpawner
  race/              # RaceController, StandingsCalculator
  scene/             # RaceScene, FreeDriveScene, PhysicsWorld, ChaseCamera, SkidMarks
  rendering/         # RenderPipelineSetup, QualityManager, materials
  ui/                # DOM screens: menu, selection, HUD, pause, settings, results
  audio/             # AudioManager, MusicSequencer (chiptune), SfxPlayer (synthesized)
  vfx/               # ParticleFactory, ScreenShake
tests/
  unit/              # Vitest — pure logic only
  e2e/               # Playwright — browser flow tests
scripts/             # headless probe/smoke scripts (Playwright-based)
docs/
  plans/             # phase-by-phase plan (00-overview … 09-phase-7-final-qa)
  TESTING.md         # gate sequence, unit/e2e conventions
  DEBUGGING.md       # debug handles, probe scripts, symptom→cause table
  BABYLON-V9.md      # verified Babylon.js v9 API facts
  HAVOK.md           # verified Havok physics facts
  tuning-table.md    # every TUNING value with rationale
```

The architecture's golden rule — **all game logic is plain TypeScript with zero Babylon imports** — is what makes the headless tests possible. Details in [`docs/plans/01-architecture.md`](./docs/plans/01-architecture.md).

## IP disclaimer

All characters, vehicles, maps and items are original pun-based creations. This project contains **no Nintendo intellectual property**. A release-time grep gate enforces this (see [`docs/plans/00-overview.md`](./docs/plans/00-overview.md) §2).

## Known limitations

- No multiplayer/netcode.
- No gamepad or touch controls.
- No external 3D asset pipeline — everything is procedural (two skybox cubemaps are the only image assets).
- No vertical/looping track sections.
- Performance targets are defined for integrated GPUs at 1080p (High ≥ 50 FPS, Low ≥ 60 FPS).

