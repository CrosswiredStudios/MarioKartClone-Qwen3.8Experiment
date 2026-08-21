---
description: "Use when writing or modifying DOM UI screens, HUD, CSS styles, or the ui:navigate event flow. Covers the idempotent navigation rule, data-testid conventions, and screen lifecycle."
name: "UI / DOM Rules"
applyTo: ["src/ui/**", "src/styles/**"]
---

# UI / DOM Rules

UI is **DOM overlays, not Babylon GUI** — every screen is a `position: fixed` div with a `data-testid` root.

## Navigation (the rule that bites)

- **`ui:navigate` is both a request AND a notification** — `GameApp`'s central handler must be idempotent: first line `if (this.machine.currentId === to) return;`. Without it, a screen that emits `ui:navigate` in its own `enter()` loops forever.
- Screens **build their DOM once in `enter()`** and **tear it down in `exit()`** (remove the root node + all event listeners). No screen may leave DOM behind.
- `keepWorldOnExit(to)` is an `IGameScreen` hook — `RaceScene` returns true only for `"Results"` so the podium keeps the world alive; GameApp skips `from.exit()` when true.

## Conventions

- **`data-testid` values are the e2e contract** — never rename one without updating the specs. Current set: `screen-main-menu`, `character-select`, `vehicle-select`, `map-select`, `countdown-stub`, `screen-results`, `results-skip`, `results-race-again`, `screen-paused`, `pause-settings`, `settings-panel`, `settings-back`, `char-card-{id}`, `char-confirm`, `veh-card-{id}`, `veh-confirm`, `map-confirm`, `loading-screen`.
- **Buttons rebuilt every frame** (menu, defeat panel) — e2e must click via direct DOM dispatch in one `page.evaluate`, not Playwright `.click()` (detached-element timeout).
- **HUD text updates only on value change** — cache the last rendered value; don't rewrite `textContent` every frame.
- **Z-index layering:** loading screen 20 > HUD 20 > countdown 10. New overlays must respect this.
- **Transient overlays (countdown, "GO!", pause) must be REMOVED from the DOM when done** — e2e asserts `toHaveCount(0)`, not just state change.
- CSS lives in `src/styles/*.css`, one file per screen family; import it from the screen module.
