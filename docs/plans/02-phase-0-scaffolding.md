# Phase 0 — Scaffolding & Plan Docs

> **Status: COMPLETE (implemented 2026-08-15)**
> This document is a *retrospective execution guide*: it records exactly what was built in the current workspace so that any junior developer can reproduce or verify every step. All gates listed below were green at completion time.

## Goal & Exit Gate

**Goal:** Stand up the Vite + TypeScript project, all tooling (lint/format/unit/e2e), the folder skeleton from [`01-architecture.md`](./01-architecture.md) §2, a Babylon.js hello-world scene proving the render pipeline works in-browser, and author all 10 plan documents.

**Exit gate (all must pass):**

| Gate | Command | Expected result at completion |
|---|---|---|
| Lint | `npm run lint` | Clean — 0 errors, 0 warnings |
| Type check | `npx tsc --noEmit` | Exits 0 (TSC OK) |
| Unit tests | `npm test` | **6 passed** (`FixedTimestepLoop`) |
| Build | `npm run build` | `tsc --noEmit && vite build` succeeds, emits `dist/` |
| E2E smoke | `npm run test:e2e` | **1 passed** (Playwright Chromium vs preview server) |
| Docs | — | All 10 plan docs exist in `docs/plans/` (`00-overview.md`, `01-architecture.md`, `02`–`09`) |

Per [`00-overview.md`](./00-overview.md) §7, the P0 row of the phase map is satisfied by exactly this gate set.

### Resulting folder skeleton

```
<repo-root>/
  eslint.config.js
  index.html
  package.json            (+ package-lock.json committed)
  playwright.config.ts
  README.md
  tsconfig.json
  vite.config.ts
  .gitignore
  .prettierrc.json
  .prettierignore
  docs/plans/             # all 10 plan documents (00–09)
  src/
    main.ts               # bootstrap: WebGL2 check, engine, scene, window.__game
    core/FixedTimestepLoop.ts
    scene/HelloWorldScene.ts
  tests/
    unit/FixedTimestepLoop.test.ts
    e2e/smoke.spec.ts
```

This is the Phase 0 subset of the full layout in [`01-architecture.md`](./01-architecture.md) §2 — every later phase only *adds* folders (`input/`, `data/`, `entities/`, …), never restructures these files.

## Files Created (exact list, matching the real workspace)

### Tooling & config (repo root)

| File | Purpose / key contents |
|---|---|
| `package.json` | `"type": "module"`, name `turbo-turtle-rally`. Deps: `@babylonjs/core ^9.21.2`. DevDeps: `vite ^6.3.5`, `typescript ~5.8.3`, `vitest ^3.1.0`, `@playwright/test ^1.52.0`, `eslint ^9.30.0` + `@eslint/js ^9.30.0`, `typescript-eslint ^8.35.0`, `prettier ^3.6.0`, `@types/node`. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `test:watch`, `test:e2e` (`playwright test`), `lint` (`eslint .`), `format` |
| `tsconfig.json` | `strict: true`, target/lib `ES2022` + DOM, `moduleResolution: "bundler"`, `noEmit: true`, plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`. Includes `src` and `tests/unit`; excludes `node_modules`, `dist` |
| `vite.config.ts` | Dev server port **5173** with `strictPort: true`; preview port **4173** with `strictPort: true`; build target `es2022` + sourcemaps; Vitest config (`environment: "node"`, include `tests/unit/**/*.test.ts`) via `/// <reference types="vitest/config" />` |
| `playwright.config.ts` | `testDir: "tests/e2e"`, 60 s timeout, `retries: 1`, `baseURL: http://localhost:4173`, headless; `webServer` runs `npm run preview` on the same URL with `reuseExistingServer: !process.env.CI` |
| `eslint.config.js` | ESLint 9 **flat config**: ignores for build/test artifacts, `eslint.configs.recommended`, `tseslint.configs.recommended`, then project rules — `@typescript-eslint/no-explicit-any: "error"` and `@typescript-eslint/consistent-type-imports: ["warn", { prefer: "type-imports" }]` |
| `.prettierrc.json` | `{ semi: true, singleQuote: false, trailingComma: "all", printWidth: 100, tabWidth: 2 }` |
| `.prettierignore` | `dist`, `node_modules`, `coverage`, `playwright-report`, `test-results`, `package-lock.json` |
| `.gitignore` | `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.local`, `.DS_Store`, `npm-debug.log*` |

### App entry & scene

| File | Purpose / key contents |
|---|---|
| `index.html` | `<canvas id="game-canvas">` plus a hidden `#webgl2-error` overlay (`role="alert"`) with friendly "needs WebGL2" copy; inline CSS resets margins, hides overflow, dark background. Loads `/src/main.ts` as an ES module |
| `src/main.ts` | Bootstrap: (1) **WebGL2 capability check** — probes a throwaway canvas for a `webgl2` context; on failure shows the `#webgl2-error` overlay and throws; (2) creates `Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false })` — `stencil: true` is needed later by post-processing/SSAO, and `adaptToDeviceRatio: false` because **QualityManager (Phase 3) owns pixel-ratio decisions**; (3) creates the `Scene`, calls `createHelloWorldScene(scene)`; (4) runs `engine.runRenderLoop(() => scene.render())`; (5) resizes engine on window resize; (6) exposes a `window.__game` debug handle (`{ engine, scene }`) for Playwright `page.evaluate` assertions |
| `src/scene/HelloWorldScene.ts` | Stylized low-poly kart from primitives: box body with **PBR red** material (`albedoColor 0.85/0.15/0.15`, metallic 0.2, roughness 0.4), a seat box parented to the body, **4 cylinder wheels parented to the body**, a ground disc (radius 14) with standard green material, hemispheric + directional lights, `ArcRotateCamera` with radius limits 4–20 and attached controls, and an idle spin (`kart.rotation.y += 0.01`) via `scene.onBeforeRenderObservable`. Clear color is `new Color4(0.1, 0.12, 0.2, 1)` |
| `src/core/FixedTimestepLoop.ts` | Accumulator loop: constructor takes `(onUpdate(dt), onRender(alpha), options?)`; `step` default **1/60 s**, `maxAccumulator` default **0.25 s** (spiral-of-death guard); negative frame times clamped to 0; `advance(elapsedSeconds)` is public and exposed for tests; `start()`/`stop()` drive the loop via `requestAnimationFrame`/`cancelAnimationFrame`; first call only establishes a time baseline |

### Tests & docs

| File | Purpose / key contents |
|---|---|
| `tests/unit/FixedTimestepLoop.test.ts` | 6 Vitest tests (see Test list below) |
| `tests/e2e/smoke.spec.ts` | Playwright smoke: canvas visible + non-zero size, `#webgl2-error` **not** visible, `window.__game !== undefined`, and no `pageerror` events after a 1 s wait |
| `docs/plans/00-overview.md` … `09-phase-7-final-qa.md` | All 10 plan documents (this file is `02`) |

### Exact config contents (for reproduction)

<details>
<summary><code>tsconfig.json</code></summary>

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "useDefineForClassFields": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests/unit"],
  "exclude": ["node_modules", "dist"]
}
```

</details>

<details>
<summary><code>vite.config.ts</code></summary>

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

</details>

<details>
<summary><code>playwright.config.ts</code></summary>

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

</details>

<details>
<summary><code>eslint.config.js</code></summary>

```js
// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],
    },
  }
);
```

</details>

<details>
<summary><code>.prettierrc.json</code> / <code>.prettierignore</code></summary>

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

```
dist
node_modules
coverage
playwright-report
test-results
package-lock.json
```

</details>

## Step-by-step tasks (as executed)

Each step ended with the workspace in a green state before moving on.

### Task 1 — Initialize project & install dependencies

```powershell
npm init -y            # then hand-edit package.json to "type": "module" + scripts above
npm install @babylonjs/core@^9.21.2
npm install -D vite@^6.3.5 typescript@~5.8.3 vitest@^3.1.0 @playwright/test@^1.52.0 `
  eslint@^9.30.0 @eslint/js@^9.30.0 typescript-eslint@^8.35.0 prettier@^3.6.0 @types/node
```

### Task 2 — Author config files

Create, in order: `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore` (contents as tabulated above). Verify immediately with `npx tsc --noEmit` (clean on an empty-ish tree) and `npm run lint`.

### Task 3 — Author the app entry + hello-world scene

Create `index.html`, `src/main.ts`, `src/scene/HelloWorldScene.ts`. Watch the gotchas in the next section — all four were hit during this task. Verify with `npm run dev` and a manual browser check of the spinning kart on port 5173.

### Task 4 — Implement FixedTimestepLoop + unit tests

Create `src/core/FixedTimestepLoop.ts` and `tests/unit/FixedTimestepLoop.test.ts`. Run:

```powershell
npm test        # → Test Files 1 passed (1); Tests 6 passed (6)
```

### Task 5 — Install Playwright browser & write smoke test

```powershell
npx playwright install chromium
```

Create `tests/e2e/smoke.spec.ts`. Run:

```powershell
npm run build     # → tsc clean, vite emits dist/
npm run test:e2e  # → 1 passed (Playwright auto-starts the preview server on 4173)
```

### Task 6 — Author all plan docs

Write `docs/plans/00-overview.md` through `09-phase-7-final-qa.md`. Confirm 10 files exist.

### Final verification sweep (expected output)

Run these in exactly this order from the repo root:

```powershell
npm run lint        # → no output, exit code 0 (clean)
npx tsc --noEmit    # → no output, exit code 0 (TSC OK)
npm test            # → see below
npm run build       # → tsc clean, then vite emits dist/ with sourcemaps
npm run test:e2e    # → 1 passed under "Phase 0 smoke"
```

Expected `npm test` output:

```
 RUN  v3.x.x ...

 ✓ tests/unit/FixedTimestepLoop.test.ts (6 tests) xxms
   ✓ FixedTimestepLoop > does nothing before the first frame establishes a baseline
   ✓ FixedTimestepLoop > runs exactly one update per step of elapsed time
   ✓ FixedTimestepLoop > catches up with multiple updates after a slow frame
   ✓ FixedTimestepLoop > renders once per advance with the interpolation alpha
   ✓ FixedTimestepLoop > clamps huge frame times to maxAccumulator (spiral-of-death guard)
   ✓ FixedTimestepLoop > treats negative frame times as zero

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Expected `npm run test:e2e` output (Playwright starts the preview server itself):

```
Running 1 test using 1 worker

  ✓  1 [chromium] › tests/e2e/smoke.spec.ts: Phase 0 smoke › boots and exposes the game handle (xx ms)

  1 passed
```

Expected `npm run build` tail:

```
vite v6.x.x building for production...
✓ xx modules transformed.
dist/index.html                  x.xx kB
dist/assets/index-xxxx.js     xxx.xx kB │ gzip: xx.xx kB
✓ built in x.xxs
```

## Gotchas learned (documented so they are not re-learned)

1. **Babylon v9 `scene.clearColor` requires `Color4`, not `Color3`.** Passing a `Color3` fails type-checking in v9 — use `new Color4(r, g, b, 1)`.
2. **Value vs type-only imports for `Scene`.** In `src/main.ts` the `Scene` is *constructed*, so it must be a value import: `import { Engine, Scene } from "@babylonjs/core"`. In `src/scene/HelloWorldScene.ts` it only appears as a parameter type, so use `import type { Scene } from "@babylonjs/core"` — the ESLint `consistent-type-imports` rule (warn) enforces this split.
3. **Relative imports need the `.js` extension** even though the source files are `.ts` (ESM + Vite convention, per [`01-architecture.md`](./01-architecture.md) §7): e.g. `import { createHelloWorldScene } from "./scene/HelloWorldScene.js"`.
4. **ESLint 9 uses flat config only** — there is no `.eslintrc`; the project ships a single `eslint.config.js` built with `tseslint.config(...)`, and `npm run lint` must be `eslint .` (no `--ext`).

## Acceptance criteria

- [x] `npm run lint` → 0 errors, 0 warnings
- [x] `npx tsc --noEmit` → clean
- [x] `npm test` → all unit tests pass (6/6)
- [x] `npm run build` → production bundle in `dist/`
- [x] `npm run test:e2e` → smoke test passes against the preview server
- [x] All 10 plan documents exist under `docs/plans/`
- [x] No TODO/FIXME without an issue reference; conventions from [`01-architecture.md`](./01-architecture.md) §7 followed

## Test list

### `tests/unit/FixedTimestepLoop.test.ts` (Vitest, 6 tests)

| # | `it(...)` name | What it proves |
|---|---|---|
| 1 | "does nothing before the first frame establishes a baseline" | First `advance(0)` only records the clock; zero updates |
| 2 | "runs exactly one update per step of elapsed time" | +1/60 s → exactly 1 update with `dt ≈ 1/60` |
| 3 | "catches up with multiple updates after a slow frame" | +3/60 s in one frame → 3 sequential updates |
| 4 | "renders once per advance with the interpolation alpha" | Render fires once per frame regardless of update count; leftover accumulator becomes alpha |
| 5 | "clamps huge frame times to maxAccumulator (spiral-of-death guard)" | A 5 s gap yields ≤ 15 updates (0.25 s / (1/60) s) and > 0 |
| 6 | "treats negative frame times as zero" | Clock going backwards produces no extra updates |

### `tests/e2e/smoke.spec.ts` (Playwright, 1 test)

- **"boots and exposes the game handle"** — asserts: `#game-canvas` visible with non-zero width/height; `#webgl2-error` not visible; `window.__game !== undefined`; zero uncaught page errors after a 1 s render-loop soak.
