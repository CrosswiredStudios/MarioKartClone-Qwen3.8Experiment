# Testing Guide

> How to run, write, and debug tests for Turbo Turtle Rally. This is the canonical reference for the "is my change done?" gate. For *why* the architecture is testable (headless simulation, seeded RNG, fixed timestep), see [`plans/01-architecture.md`](./plans/01-architecture.md) §9.

## 1. Commands

| Command | What it does | Port |
|---|---|---|
| `npm run dev` | Vite dev server (live source) | 5173 |
| `npm run build` | `tsc --noEmit` + `vite build` → `dist/` | — |
| `npm run preview` | Serve the **last `dist/` build** (NOT live source) | 4173 |
| `npm test` | Vitest unit tests (node env, no WebGL) | — |
| `npm run test:e2e` | Playwright (Chromium) against the preview server | 4173 |
| `npm run lint` | ESLint 9 flat config | — |

## 2. The canonical gate sequence

Run these **in order**; stop at the first failure. This is what "done" means for any change.

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:e2e
```

PowerShell notes: chain with `;` (never `&&`); trim long output with `2>&1 | Select-Object -Last 40`. A full build takes ~60–90 s.

## 3. HARD RULE: build before e2e

`vite preview` serves the **last `dist/` build, not live source.** Playwright's `webServer` runs `npm run preview` with `reuseExistingServer: !CI`, so after editing any `src/**` file you **MUST `npm run build`** before running e2e — otherwise tests run against a stale bundle and fail in confusing ways (a just-added handle/property missing at runtime, HUD elements absent) *while unit tests pass*.

Symptom that the bundle is stale: a debug log or property you just added doesn't appear at runtime. Verify `dist/index.html`'s timestamp if results look "suspiciously green."

A **leftover preview process on :4173 is silently reused.** If e2e fails with DOM that matches OLD code (removed elements still present, new ones absent), kill the listener first, then rebuild + rerun:

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
```

## 4. Unit tests (Vitest)

- **Pure logic only.** Tests run in a **node environment** (`vite.config.ts` → `test.environment: "node"`) with **no WebGL and no browser**. This is only possible because all game logic is Babylon-free (see the golden rule in [`AGENTS.md`](../AGENTS.md)).
- **Headless race harness.** `tests/unit/race-fixture.ts` builds a `RaceController` with no renderer (entities + physics + AI only). `tests/unit/headlessRace.test.ts` runs a full 3-lap race headlessly and asserts it finishes in a sane time window with a valid standings order. Reuse this fixture for any new race-level behavior.
- **Fake inputs.** Inject an `IInputSource` implementation that scripts key sequences — the same code path runs as in-game keyboard input.
- **Seeded RNG.** Pass explicit seeds; never rely on `Math.random()`. A given character/vehicle/map combo is reproducible.
- **Babylon under vitest (rare, for geometry/merge tests).** `NullEngine` + `new Scene(engine)` works for real geometry. **`DynamicTexture` needs `OffscreenCanvas`, which Node lacks** — stub it at module load *before* importing anything that builds a `DynamicTexture`:

  ```ts
  (globalThis as any).OffscreenCanvas = class {
    getContext() {
      return {
        clearRect() {}, fillRect() {}, drawImage() {},
        getImageData: (x: number, y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      };
    }
  };
  ```

  `PropBuilder`'s ctor always builds a geyser `DynamicTexture`, so this stub is required to construct it headless. Read private state via `(obj as unknown as { sources: Map<string, Mesh> }).sources` rather than reaching into Babylon internals.

## 5. E2E tests (Playwright)

- **Assert via DOM + `page.evaluate(window.__game…)` — NEVER screenshots.** Screenshots are unavailable in this environment (image-analysis requests are rejected with a 400). Read live game state through the debug handles documented in [`DEBUGGING.md`](./DEBUGGING.md).
- **Menu/defeat-panel buttons are REBUILT EVERY FRAME**, so Playwright's `.click()` (ref or `getByText`) times out with "element was detached from the DOM." Click via direct DOM dispatch inside a single `evaluate`:

  ```js
  await page.evaluate(() => {
    [...document.querySelectorAll('.menu-item')]
      .find((e) => e.textContent.trim() === 'LABEL')
      .click();
  });
  ```

- **Playwright v1.62 removed the `test(title, body, timeoutMs)` third-arg overload** — it is silently ignored (no TS error, because e2e specs are not type-checked: `tsconfig.json` only includes `src` + `tests/unit`). Use `test.setTimeout(ms)` as the **first statement** in the test body instead.
- **Full 3-lap AI-driven race wall time:** Meadows ≈ 30–60 s; Lagoon ≈ 75–90 s (63–68 s sim + menu/countdown). Set per-test timeouts accordingly (e.g. `test.setTimeout(120_000)`).
- **`?debug` gating.** `import.meta.env.DEV` is statically replaced with `false` in the preview build. Any dev-only behavior (the `ttr.debugAIDrive` flag, `window.__game.aiDrivePlayer`, etc.) must be gated behind `debugAllowed = import.meta.env.DEV || URL has ?debug` so it is dead code without `?debug`. The full-race spec navigates to `/?debug` so the flag works in both dev and preview.
- **Overlay-removal assertions.** For any transient overlay (countdown, loading screen), assert it is REMOVED, not just that the underlying state changed — e.g. `expect(page.getByTestId("countdown-stub")).toHaveCount(0)` right after `state === "Racing"`. (A past bug shipped where the countdown overlay stayed painted over the race.)
- **Flakiness under load.** A few UI-only timeouts under heavy load are system slowness, not a regression — re-run the failed spec to confirm before investigating.

## 6. Performance measurement protocol

Used for the Phase 7 perf pass and any perf regression check (see [`plans/09-phase-7-final-qa.md`](./plans/09-phase-7-final-qa.md) T2):

1. Start a race on **lagoon** at the preset under test.
2. Wait **10 s** for warm-up (shader compilation).
3. Drive a full lap with all VFX active (boost, star, shells — trigger at least one of each).
4. Read `window.__game.fpsHistory()` min/average over the final ~10 s and `engine.getDrawCalls()`.
5. Repeat twice; record the **worse** run. Do this on both maps for High, and once per map for Low.

Gates: **High ≥ 50 FPS and < 200 draw calls** (all VFX active); **Low ≥ 60 FPS**, on reference integrated-GPU hardware at 1080p.
