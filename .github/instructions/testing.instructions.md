---
description: "Use when writing or modifying tests (Vitest unit, Playwright e2e) or probe/smoke scripts. Covers the build-before-e2e rule, no-screenshots rule, timeout gotchas, and headless harness patterns."
name: "Testing Rules"
applyTo: ["tests/**", "scripts/**"]
---

# Testing Rules

**Full guide: [`docs/TESTING.md`](../../docs/TESTING.md).** The rules that bite most often:

## Hard rules

- **`npm run build` BEFORE `npm run test:e2e`** — `vite preview` serves the last `dist/` build, not live source. Stale-bundle symptom: a just-added handle/property missing at runtime while unit tests pass. A leftover `:4173` listener is silently reused (`reuseExistingServer: !CI`) — kill it if e2e DOM matches old code:
  `Get-NetTCPConnection -LocalPort 4173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`
- **NEVER assert via screenshots** — they fail in this environment (400). Assert via DOM + `page.evaluate(window.__game…)` / `window.__sw.dbg(fn)`.
- **Menu/defeat-panel buttons are rebuilt every frame** — Playwright `.click()` times out with "detached from the DOM". Click via direct DOM dispatch in one `evaluate`:
  `[...document.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === 'LABEL').click()`
- **Playwright v1.62 removed the `test(title, body, timeoutMs)` overload** (silently ignored — e2e specs aren't type-checked). Use `test.setTimeout(ms)` as the first statement in the test body.
- **Full 3-lap race wall time:** Meadows ≈ 30–60 s, Lagoon ≈ 75–90 s. Set timeouts accordingly.
- **Dev-only behavior must be gated** behind `debugAllowed = import.meta.env.DEV || URL has ?debug` — `import.meta.env.DEV` is `false` in the preview build. E2e specs that need debug handles navigate to `/?debug`.
- **Assert transient overlays are REMOVED**, not just that state changed (e.g. `expect(page.getByTestId("countdown-stub")).toHaveCount(0)` after Racing).

## Unit test conventions

- Node environment, **no WebGL** — pure logic only. Reuse `tests/unit/race-fixture.ts` for race-level tests.
- Inject fake `IInputSource` implementations; pass explicit RNG seeds.
- Babylon geometry tests: `NullEngine` + `Scene`; stub `globalThis.OffscreenCanvas` at module load BEFORE importing anything that builds a `DynamicTexture` (exact stub in `docs/TESTING.md` §4).

## Probe scripts (`scripts/`)

- Playwright-based, headless Chromium, run against `npx vite preview --port 4173` (NOT dev — dev serves HTML for the Havok `.wasm`).
- To force a kart↔kart collision: per-frame magnet (16 ms `setInterval` re-asserting opposing ±10 m/s until contact) — node teleports and one-shot velocities don't work (see `docs/DEBUGGING.md` §4).
