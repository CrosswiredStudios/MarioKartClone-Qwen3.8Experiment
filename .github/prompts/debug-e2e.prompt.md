---
description: "Diagnose a failing or flaky Playwright e2e test (stale dist, throttling, console errors)"
agent: "agent"
argument-hint: "Spec file or failure message"
---

Diagnose a failing or flaky Playwright e2e test. Target: **$ARGUMENTS**

Work through this decision tree in order. Stop at the first confirmed cause and report it.

1. **Stale `dist/`?** — `vite preview` serves the last `dist/` build, NOT live source. If the failure is "a just-added handle/property is missing at runtime" while unit tests pass, the bundle is stale. Fix: `npm run build`, then re-run.
2. **Stale `:4173` listener?** — a leftover preview server is silently reused (`reuseExistingServer: !CI`), so e2e tests old code. Kill it:
   `Get-NetTCPConnection -LocalPort 4173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`
   then re-run.
3. **Throttling / wall-time?** — the integrated-browser tab is rAF-throttled when backgrounded (countdown stuck, no state change). Playwright headless Chromium is NOT throttled — make sure the test runs under `npx playwright test`, not the integrated browser. Also check the timeout: a full 3-lap race takes ~30–90 s wall time; use `test.setTimeout(ms)` (the `test(title, body, timeoutMs)` overload was removed in Playwright v1.62 and is silently ignored).
4. **Console errors?** — capture `page.on("console")` and `page.on("pageerror")` output. A runtime `ReferenceError`/`TypeError` (e.g. a renamed Babylon API) usually shows up here even when the build and tsc pass.
5. **DOM assertion / detached element?** — menu and defeat-panel buttons are rebuilt every frame, so Playwright `.click()` times out with "element was detached from the DOM". Click via direct DOM dispatch in one `page.evaluate`:
   `[...document.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === 'LABEL').click()`
   Also: assert transient overlays are REMOVED (`toHaveCount(0)`), not just that state changed.

Verification rules:

- **Verify via `page.evaluate(window.__game…)` / `window.__sw.dbg(fn)` and DOM snapshots — NEVER screenshots** (they fail in this environment with a 400).
- Dev-only handles are gated behind `?debug` — make sure the spec navigates to `/?debug` if it needs them.
- For physics-related failures, test against `vite preview`, not `vite` dev (dev serves HTML for the Havok `.wasm`).

Report the confirmed root cause, the evidence, and the fix (or the next diagnostic step if the cause is not yet confirmed).
