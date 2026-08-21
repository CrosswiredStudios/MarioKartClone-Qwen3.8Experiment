---
description: "Use when writing or modifying pure game logic: kart physics, race controller, items, AI, tracks, spline math, lap tracking, drift, or any data module. Covers the zero-Babylon-import rule, pure-step state rules, and known logic bug patterns."
name: "Pure Logic Rules"
applyTo: ["src/core/**", "src/entities/**", "src/race/**", "src/items/**", "src/tracks/**", "src/data/**", "src/input/**"]
---

# Pure Logic Rules

These folders are the **logic layer**: plain TypeScript, **zero `@babylonjs/core` imports** (the only render-adjacent exceptions are `src/entities/KartRenderer.ts`, `src/entities/KartBody.ts`, `src/entities/vehicleModels.ts`). If you need Babylon here, the design is wrong — move it to the render layer.

## State & purity

- Pure step functions (`stepKart`, `stepShell`, `updateDrift`, …) **return new state objects** and mutate nothing.
- **Pre-physics base bug:** when feeding post-physics state through a transform that returns a NEW state, always pass the **post-physics `next`** as the base — not `kart.state`. Passing pre-physics silently discards all physics each step → karts frozen at speed 0 with no exception.
- All randomness via `createRng(seed)` from `src/core/Rng.ts` — never `Math.random()`.
- Logic always receives the fixed `dt = 1/60`.
- **No raw gameplay constants** — every magic number goes in `src/data/tuning.ts` (and `docs/tuning-table.md` in the same commit).

## Known logic gotchas

- **LapTracker sentinel:** a kart MUST spawn just BEHIND the start line so it CROSSES cp0 as its first real checkpoint. Spawning exactly on the line leaves the lap count one full loop late. `RaceController` grid slots are all shifted ~1 m behind for this reason.
- **Bullet-bill fake laps:** bullet-bill knockback (−12 m/s) steps the kart backwards across the start line, making `closestPoint().t` jump 0.02→0.98, which misreads as forward checkpoint coverage → fake lap. `trackLaps` in `RaceController` discards any step where `crossed.length > 1` (physically impossible at fixed timestep). Keep that guard.
- **`RaceController.racers`** is the entity field name (NOT `karts`) to avoid colliding with the public `karts()` method.
- **`ui:navigate` is both a request AND a notification** — `GameApp`'s central handler must be idempotent: first line `if (this.machine.currentId === to) return;`.
- **Terrain:** the pure `HeightField` (`src/tracks/TrackElevation.ts`) is the single source of truth for surface height — render and logic sample the SAME field. `heightAt` does a fresh full-scan `closestPoint` per call (no shared hint cache — that was a bug: interleaved callers made it lock onto the wrong segment on curves).
- **Airborne model:** `KartState.vy` (0 grounded); airborne when `pos.y > groundY + TUNING.terrain.airborneEpsilon`; horizontal momentum is preserved while airborne.

## Extension points (OCP)

- New item = implement `IItemEffect` + register in the factory map — no edits to spawner or race code.
- New AI behavior = implement `IAiStrategy`.
- New track = add a data file in `src/data/tracks/` — zero system changes.
