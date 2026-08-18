# Phase 1 â€” Core Framework

> **Status: COMPLETE (implemented 2026-08-15).** All gates green at completion: lint clean, `tsc --noEmit` clean, 124 unit tests passing (FixedTimestepLoop 6 + EventBus 6 + GameStateMachine 103 + KeyboardInput 9), production build OK, Playwright e2e 5/5 (smoke 1 + menu 4). See [As-built deviations & gotchas](#as-built-deviations--gotchas-recorded-at-completion) for the four places where implementation diverged from this guide.

## Goal

Build the non-rendering skeleton of the game: a typed **EventBus**, a **GameStateMachine** with the full screen catalog and transition table from [`01-architecture.md`](./01-architecture.md) Â§8, a **GameApp** that owns the `FixedTimestepLoop` (from Phase 0) and dispatches updates to the active screen, an **input abstraction** (`IInputSource` + `KeyboardInput`) testable with a fake event target, a real DOM **main menu** ("Turbo Turtle Rally" title + Start/Quit), and an **audio skeleton** (`AudioManager` + synthesized `SfxPlayer`). By the end of this phase the app boots into the main menu, and pressing/clicking **Start** transitions to a CharacterSelect stub â€” verified by unit tests and Playwright.

Out of scope (later phases): real selection screens (P2), track/physics/AI (P3â€“P4), items (P5), music sequencer & engine audio loop (P6). `HelloWorldScene` stays importable but is no longer the boot path â€” Phase 3 will reuse its kart-mesh code in `KartRenderer`.

## Files to create / modify (table: path | purpose)

| Path | Purpose |
|---|---|
| `src/core/EventBus.ts` | Typed pub/sub. `class EventBus<T extends Record<string, unknown>>` with `on/off/emit` typed by event name â†’ payload map; exports the full `GameEvents` catalog from [`01-architecture.md`](./01-architecture.md) Â§5 |
| `src/core/GameStateMachine.ts` | Screen ids (8 states per `01` Â§8 mermaid), `IGameScreen` interface, transition table as a const map, `canTransition()` guard, emits `ui:navigate` on every successful transition; holds the `GameContext` (`engine`, `scene`, `eventBus`, `raceConfig` slot) |
| `src/core/GameApp.ts` | Owns `FixedTimestepLoop` + `GameStateMachine` + `AudioManager`; boot sequence (create screens â†’ register with machine â†’ start loop); `update(dt)` dispatches to active screen; exposes `snapshot()` for `window.__game` |
| `src/input/IInputSource.ts` | DIP interface: `axis()`, `button()`, `justPressed()` (from `01` Â§4) |
| `src/input/KeyboardInput.ts` | WASD + arrows â†’ throttle/steer axes âˆ’1..1; Space = drift button; E/Enter = item, Esc = pause as **edge-triggered** flags cleared each logic step; attach/detach on any event target (window in prod, fake object in tests) |
| `src/ui/MenuScreen.ts` | DOM overlay: title "Turbo Turtle Rally", Start + Quit buttons; Enter starts; emits `ui:navigate` â†’ CharacterSelect; calls `audioManager.unlock()` on first click/keydown |
| `src/audio/AudioManager.ts` | WebAudio `AudioContext` created **lazily on first user gesture** (autoplay policy); master gain + music/sfx buses; `setVolume`/`mute` API; `unlock()` entry point |
| `src/audio/SfxPlayer.ts` | Skeleton of synthesized one-shot SFX: `uiClick`, `countdownBeep`, `goHorn`; each a small oscillator + gain-envelope function; `play(name)` API |
| `src/styles/menu.css` | Styling for the menu overlay (title, buttons, layout) |
| `src/main.ts` *(modify)* | Replace direct `createHelloWorldScene(scene)` call with `new GameApp(engine, scene).boot()`; keep the WebGL2 check and engine options unchanged; re-point `window.__game` at the new handle shape (see Task 8) |
| `tests/unit/EventBus.test.ts` *(create)* | EventBus unit tests (see Test list) |
| `tests/unit/GameStateMachine.test.ts` *(create)* | Transition-table + enter/exit unit tests |
| `tests/unit/KeyboardInput.test.ts` *(create)* | Input mapping with a fake event target |
| `tests/e2e/menu.spec.ts` *(create)* | Playwright: menu visible, Start click â†’ CharacterSelect stub visible |

## Interfaces & signatures

Adapted from [`01-architecture.md`](./01-architecture.md) Â§4/Â§5. All logic files below are **pure TypeScript with zero Babylon imports** (the only Babylon-typed object is the `engine`/`scene` pair carried opaquely in `GameContext`).

```ts
// â”€â”€ src/core/EventBus.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Full event catalog â€” one entry per row of 01-architecture.md Â§5. */
export interface GameEvents {
  "race:countdownTick": { remaining: 3 | 2 | 1 };
  "race:start": {};
  "race:lapCompleted": { kartId: string; lap: number; timeMs: number };
  "race:finished": { standings: Array<{ id: string; rank: number }>; times: Record<string, number> };
  "item:pickedUp": { kartId: string; item: string };
  "item:used": { kartId: string; item: string };
  "kart:hit": { kartId: string; byKartId?: string; shellKind?: "green" | "red" | "blue" };
  "kart:boosted": { kartId: string; tier: "mini" | "super" | "shroom" };
  "kart:skid": { kartId: string; cause: "banana" | "oilSlick" };
  "ui:navigate": { to: GameScreenId };
}

export type GameEventName = keyof GameEvents;

type Listener<T> = (payload: T) => void;

/** Typed pub/sub. One channel per event name; discrete events only. */
export class EventBus<T extends Record<string, unknown>> {
  on<K extends keyof T & string>(name: K, listener: Listener<T[K]>): () => void; // returns unsubscribe fn
  off<K extends keyof T & string>(name: K, listener: Listener<T[K]>): void;
  emit<K extends keyof T & string>(name: K, payload: T[K]): void;
}
```

`GameScreenId` is defined in `GameStateMachine.ts` and imported here as a **type-only** import (`import type { GameScreenId } from "./GameStateMachine.js"`).

```ts
// â”€â”€ src/core/GameStateMachine.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const GAME_SCREEN_IDS = [
  "MainMenu", "CharacterSelect", "VehicleSelect", "MapSelect",
  "Countdown", "Racing", "Paused", "Results",
] as const;
export type GameScreenId = (typeof GAME_SCREEN_IDS)[number];

/** Context handed to every screen. `raceConfig` is a slot filled in Phase 2. */
export interface GameContext {
  readonly engine: unknown;   // Babylon Engine â€” kept opaque so this file stays Babylon-free
  readonly scene: unknown;    // Babylon Scene
  readonly eventBus: EventBus<GameEvents>;
  raceConfig: RaceConfig | null;   // set by MapSelect in Phase 2 (type from core/RaceConfig.ts, added then)
}

export interface IGameScreen {
  readonly id: GameScreenId;
  enter(ctx: GameContext): void;
  exit(): void;
  update?(dt: number): void;   // called each fixed logic step while active
}

/** Transition table â€” mirrors the mermaid diagram in 01-architecture.md Â§8 exactly. */
export const TRANSITIONS: Record<GameScreenId, readonly GameScreenId[]> = {
  MainMenu:        ["CharacterSelect"],
  CharacterSelect: ["VehicleSelect", "MainMenu"],
  VehicleSelect:   ["MapSelect", "CharacterSelect"],
  MapSelect:       ["Countdown", "VehicleSelect"],
  Countdown:       ["Racing"],
  Racing:          ["Paused", "Results"],
  Paused:          ["Racing", "MainMenu"],
  Results:         ["CharacterSelect", "MainMenu"],
};

export class GameStateMachine {
  constructor(initial: GameScreenId, private readonly eventBus: EventBus<GameEvents>);
  get currentId(): GameScreenId;
  register(screen: IGameScreen): void;          // one screen per id; throws on duplicate/unknown
  canTransition(to: GameScreenId): boolean;     // pure guard â€” never mutates
  transition(to: GameScreenId): void;           // throws Error if !canTransition(to); calls exit()/enter(); emits "ui:navigate"
}
```

> `RaceConfig` does not exist yet in Phase 1. To keep this file compiling, declare a minimal placeholder **in the same file** for now: `export interface RaceConfig { readonly characterId: string; readonly vehicleId: string; readonly mapId: string }`, and move it to `src/core/RaceConfig.ts` in Phase 2 (per `01` Â§2 layout).

```ts
// â”€â”€ src/input/IInputSource.ts + KeyboardInput.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface IInputSource {
  axis(name: "throttle" | "steer"): number;      // -1..1
  button(name: "drift" | "item" | "pause"): boolean;
  justPressed(name: "item" | "pause"): boolean;  // edge-triggered, cleared each logic step
}

export class KeyboardInput implements IInputSource {
  constructor(target?: EventTarget);   // defaults to window in the browser
  attach(): void;                      // addEventListener keydown/keyup on target
  detach(): void;                      // remove them (idempotent)
  axis(name: "throttle" | "steer"): number;
  button(name: "drift" | "item" | "pause"): boolean;
  justPressed(name: "item" | "pause"): boolean;
  endLogicStep(): void;                // clears all justPressed flags â€” called once per fixed step by GameApp
}
```

Key mapping (from [`00-overview.md`](./00-overview.md) Â§5): `W`/`ArrowUp` throttle +1, `S`/`ArrowDown` âˆ’1; `A`/`ArrowLeft` steer âˆ’1, `D`/`ArrowRight` +1; `Space` drift (held); `E`/`Enter` item (edge); `Escape` pause (edge).

```ts
// â”€â”€ src/core/GameApp.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export class GameApp {
  constructor(engine: unknown, scene: unknown);   // Babylon objects kept opaque here too
  boot(): void;        // create eventBus â†’ audioManager â†’ input â†’ screens â†’ machine.register(each)
                       // â†’ machine.transition to initial (MainMenu) â†’ loop.start()
  update(dt: number): void;      // activeScreen.update?.(dt); then input.endLogicStep()
  snapshot(): { state: GameScreenId };   // for window.__game
}
```

## Step-by-step tasks

Order matters: every task ends with `npm run lint`, `npx tsc --noEmit` and `npm test` green before the next begins.

### Task 1 â€” EventBus + unit tests (green)

Create `src/core/EventBus.ts`. Implementation sketch for the non-obvious parts:

```ts
export class EventBus<T extends Record<string, unknown>> {
  private readonly channels = new Map<keyof T & string, Set<Listener<T[keyof T]>>>();

  on<K extends keyof T & string>(name: K, listener: Listener<T[K]>): () => void {
    let set = this.channels.get(name);
    if (!set) { set = new Set(); this.channels.set(name, set); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure at the Map boundary only
    (set as any).add(listener);
    return () => this.off(name, listener);
  }

  off<K extends keyof T & string>(name: K, listener: Listener<T[K]>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    (this.channels.get(name) as any)?.delete(listener);
  }

  emit<K extends keyof T & string>(name: K, payload: T[K]): void {
    const set = this.channels.get(name);
    if (!set) return;                       // zero listeners is a no-op, never throws
    for (const listener of [...set]) (listener as Listener<T[K]>)(payload);
  }
}
```

> The `any` casts are confined to the two Map-boundary lines with disable comments; `no-explicit-any: error` stays satisfied. Copy this pattern verbatim â€” do not "clean it up" into untyped code.

Write `tests/unit/EventBus.test.ts` (names in Test list). Run `npm test`. **Gate: 4 new tests pass.**

### Task 2 â€” GameStateMachine + stub screens + unit tests (green)

Create `src/core/GameStateMachine.ts` exactly per the signatures above. Transition logic sketch:

```ts
transition(to: GameScreenId): void {
  if (!this.canTransition(to)) {
    throw new Error(`Illegal transition ${this.currentId} -> ${to}`);
  }
  const from = this.screens.get(this.currentId)!;
  from.exit();
  this.currentId = to;
  const next = this.screens.get(to)!;
  next.enter(this.ctx);
  this.eventBus.emit("ui:navigate", { to });   // AFTER enter, so listeners see the new state
}
```

Create **stub screens** in `src/ui/StubScreen.ts` (one small factory used for all non-menu screens in this phase): each stub's `enter()` logs `console.log("[screen] enter <id>")`, creates a `<div data-testid="screen-<kebab-id>">` appended to `document.body` with the screen name as text; `exit()` removes that div. Kebab ids: `character-select`, `vehicle-select`, `map-select`, `countdown`, `racing`, `paused`, `results`. (Phase 2 replaces CharacterSelect/VehicleSelect/MapSelect stubs with real screens â€” keep the same `data-testid` values.)

Write `tests/unit/GameStateMachine.test.ts` using a fake screen factory (`{ id, enter: vi.fn(), exit: vi.fn() }`) and a real `EventBus<GameEvents>`. **Gate: all transition tests pass.** Note these unit tests run in Node (Vitest `environment: "node"`) â€” the machine itself must not touch `document`; only stub screens do.

### Task 3 â€” IInputSource + KeyboardInput + unit test with fake event target (green)

Create `src/input/IInputSource.ts` and `src/input/KeyboardInput.ts`. Non-obvious parts:

```ts
// Fake-friendly constructor: tests pass a plain object implementing addEventListener/removeEventListener.
export class KeyboardInput implements IInputSource {
  private readonly held = new Set<string>();          // e.code values currently down
  private justItem = false;
  private justPause = false;

  constructor(private readonly target: EventTargetLike = globalThis.window) {}

  attach(): void {
    this.target.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!this.held.has(e.code)) {                   // ignore OS key-repeat
        this.held.add(e.code);
        if (e.code === "KeyE" || e.code === "Enter") this.justItem = true;
        if (e.code === "Escape") this.justPause = true;
      }
    });
    this.target.addEventListener("keyup", (e: KeyboardEvent) => this.held.delete(e.code));
  }

  axis(name: "throttle" | "steer"): number {
    if (name === "throttle") {
      const up = this.held.has("KeyW") || this.held.has("ArrowUp");
      const down = this.held.has("KeyS") || this.held.has("ArrowDown");
      return (up ? 1 : 0) - (down ? 1 : 0);
    }
    // Steer: left is negative, right is positive.
    const left = this.held.has("KeyA") || this.held.has("ArrowLeft");
    const right = this.held.has("KeyD") || this.held.has("ArrowRight");
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  button(name: "drift" | "item" | "pause"): boolean {
    if (name === "drift") return this.held.has("Space");
    return name === "item" ? this.justItem || this.held.has("KeyE") : this.justPause || this.held.has("Escape");
  }

  justPressed(name: "item" | "pause"): boolean {
    const v = name === "item" ? this.justItem : this.justPause;
    return v;   // cleared by endLogicStep(), NOT here â€” a step may query twice
  }

  endLogicStep(): void { this.justItem = false; this.justPause = false; }
}
```

`EventTargetLike` is a tiny local interface `{ addEventListener(type: string, fn: (e: KeyboardEvent) => void): void; removeEventListener(...): void }` so the class never references `window` at construction time. In `tests/unit/KeyboardInput.test.ts`, build a **fake event target**: an object with `listeners: Record<string, Array<(e)=>void>>` and dispatch helpers that call them â€” no DOM needed. **Gate: input tests pass.**

### Task 4 â€” MenuScreen + menu.css (green)

Create `src/styles/menu.css`:

```css
.menu-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  background: radial-gradient(circle at 50% 40%, #2b2f4a 0%, #1a1c2c 70%);
  color: #fff;
  font-family: "Segoe UI", system-ui, sans-serif;
  z-index: 10;
}
.menu-title {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: 2px;
  margin: 0;
  text-shadow: 0 4px 0 #0e0f1a, 0 8px 24px rgba(0, 0, 0, 0.6);
}
.menu-buttons { display: flex; flex-direction: column; gap: 16px; }
.menu-item {
  min-width: 240px;
  padding: 14px 32px;
  font-size: 20px;
  font-weight: 600;
  color: #fff;
  background: #e8542f;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 4px 0 #a33317;
}
.menu-item:hover { filter: brightness(1.1); }
.menu-item:active { transform: translateY(2px); box-shadow: 0 2px 0 #a33317; }
```

Create `src/ui/MenuScreen.ts` implementing `IGameScreen`:

- `enter(ctx)`: build the overlay DOM **once** (cache on the instance): `<div class="menu-overlay" data-testid="screen-main-menu">`, `<h1 class="menu-title">Turbo Turtle Rally</h1>`, buttons with classes `.menu-item` and labels "Start"/"Quit". Start click â†’ `ctx.eventBus.emit("ui:navigate", { to: "CharacterSelect" })`; Quit click â†’ `sfx.play("uiClick")` + no-op (Phase 4 wires quit-to-close). Both handlers also call `this.audio.unlock()` first.
- Keyboard: in `enter`, add a `keydown` listener on `window` â€” Enter triggers the same Start path; remove it in `exit()`.
- `exit()`: remove overlay from DOM + remove keydown listener.
- The screen needs audio access: pass an optional second constructor arg `audio?: AudioManager` (GameApp injects it). Keep the class Babylon-free.

Import the stylesheet with a side-effect import at top of `MenuScreen.ts`: `import "../styles/menu.css";` (Vite handles CSS imports; no config change needed). **Gate: lint + tsc green** (no unit test for DOM in this task â€” covered by e2e in Task 8).

### Task 5 â€” AudioManager + SfxPlayer skeleton (green)

Create `src/audio/AudioManager.ts`:

```ts
export class AudioManager {
  private ctx: AudioContext | null = null;      // created lazily â€” autoplay policy
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private muted = false;

  /** Must be called from a user gesture (click/keydown). Idempotent. */
  unlock(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
  }

  get sfxDestination(): AudioNode | null { return this.ctx ? this.sfxBus : null; }
  setVolume(bus: "master" | "music" | "sfx", v01: number): void { /* clamp 0..1, set gain */ }
  mute(muted: boolean): void { this.muted = muted; if (this.ctx) this.master.gain.value = muted ? 0 : 1; }
}
```

Create `src/audio/SfxPlayer.ts` â€” each SFX is a small oscillator + gain-envelope function, all routed to `audioManager.sfxDestination` and **silently skipped when not unlocked** (so unit/e2e runs never throw):

- `uiClick`: square wave 880 Hz, 60 ms, gain envelope 0.3 â†’ 0 (linear ramp).
- `countdownBeep`: sine 440 Hz, 150 ms, 0.25 â†’ 0.
- `goHorn`: sawtooth 660 Hz, 500 ms, 0.3 â†’ 0.

```ts
export type SfxName = "uiClick" | "countdownBeep" | "goHorn";
export class SfxPlayer {
  constructor(private readonly audio: AudioManager) {}
  play(name: SfxName): void { /* switch on name; if (!this.audio.sfxDestination) return; ... */ }
}
```

No unit test file for audio in this phase (WebAudio is not available in Node Vitest); the e2e run exercises `unlock()` + `uiClick` through the Start click. **Gate: lint + tsc green.**

### Task 6 â€” GameApp (green)

Create `src/core/GameApp.ts`:

- Constructor stores engine/scene, creates `EventBus<GameEvents>`, `AudioManager`, `SfxPlayer`, `KeyboardInput`.
- `boot()`: build screens â€” `new MenuScreen(this.audio)` plus one stub per remaining id (`CharacterSelect` â€¦ `Results`) â€” register all 8 with the machine (initial state `"MainMenu"`), then `machine.transition("MainMenu")` is implicit via constructor initial + explicit first `enter`; simplest correct form: construct machine with initial `"MainMenu"`, call `this.machine.screensEnterInitial(ctx)` â€” i.e. have the machine's constructor NOT auto-enter, and let `boot()` call a public `activateInitial()`. Keep it to one clearly-named method so tests can drive it manually.
- Create the loop: `new FixedTimestepLoop((dt) => this.update(dt), (alpha) => { /* render hook â€” Phase 3 wires scene.render interpolation here */ })` and `loop.start()`.
- `update(dt)`: `this.machine.activeScreen?.update?.(dt); this.input.endLogicStep();`
- `snapshot(): { state: GameScreenId }` â†’ `{ state: this.machine.currentId }`.

Add a tiny unit test file is **not** required for GameApp in this phase (it needs DOM + rAF; the e2e covers it). **Gate: lint + tsc green.**

### Task 7 â€” Wire main.ts to GameApp (green)

Modify `src/main.ts` precisely as follows â€” keep everything else (WebGL2 check, canvas lookup, engine options, resize handler) byte-identical:

1. Change the import block from
   ```ts
   import { Engine, Scene } from "@babylonjs/core";
   import { createHelloWorldScene } from "./scene/HelloWorldScene.js";
   ```
   to
   ```ts
   import { Engine, Scene } from "@babylonjs/core";
   import { GameApp } from "./core/GameApp.js";
   // HelloWorldScene stays importable for Phase 3 (KartRenderer reuses its kart mesh code).
   ```
2. Replace `createHelloWorldScene(scene);` with:
   ```ts
   const app = new GameApp(engine, scene);
   app.boot();
   ```
3. Keep the render loop (`engine.runRenderLoop(() => scene.render())`) â€” in Phase 1 the menu is DOM-only so the canvas just shows the clear color; Phase 3 moves rendering into the loop's alpha hook. Add a **parked placeholder `UniversalCamera`** (position `(0,2,-6)`, target `(0,1,0)`, no controls) because Babylon throws `"No camera defined"` on `scene.render()` without an active camera â€” Phase 0's `HelloWorldScene` used to provide one. Phase 3 replaces it with the chase camera.
4. Replace the `window.__game` assignment (and its `declare global` type) with:
   ```ts
   declare global {
     interface Window {
       __game: { state: string; navigate(screen: string): void; snapshot(): { state: string } };
     }
   }
   window.__game = {
     get state() { return app.snapshot().state; },
     navigate: (screen) => app.machine.transition(screen as never), // e2e-only escape hatch
     snapshot: () => app.snapshot(),
   };
   ```
   (`app.machine` must be a public readonly property of `GameApp` for this.)

**Gate: `npm run build` succeeds; manual check on port 5173 shows the menu over an empty canvas.**

### Task 8 â€” Playwright menu e2e (green)

Create `tests/e2e/menu.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("Phase 1 main menu", () => {
  test("Start advances to the CharacterSelect stub", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".menu-title")).toHaveText("Turbo Turtle Rally");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator('[data-testid="screen-character-select"]')).toBeVisible();
    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("CharacterSelect");
  });
});
```

Run `npm run test:e2e` â€” **both** specs (Phase 0 smoke + this one) must pass. The Phase 0 smoke test still passes unchanged because the canvas and `window.__game` remain present.

## Acceptance criteria

All gates from [`00-overview.md`](./00-overview.md) Â§7, P1 row, plus:

- [ ] `npm run lint` â†’ 0 errors, 0 warnings
- [ ] `npx tsc --noEmit` â†’ clean
- [ ] `npm test` â†’ all unit tests pass (Phase 0's 6 + new EventBus/GameStateMachine/KeyboardInput suites)
- [ ] State-machine unit tests green: every valid transition succeeds, every invalid one rejected by `canTransition()` and throws on forced `transition()`
- [ ] **Playwright: Start button advances to CharacterSelect stub** (`tests/e2e/menu.spec.ts` passes; Phase 0 smoke still passes)
- [ ] No new TODO/FIXME without an issue reference; no Babylon imports in any file under `src/core/`, `src/input/`, `src/audio/`; `HelloWorldScene.ts` remains importable and unmodified

## Test list

### `tests/unit/EventBus.test.ts` (Vitest)

- `describe("EventBus")`
  - `it("emit reaches subscriber with the exact payload")`
  - `it("off removes a subscriber so it is not called again")`
  - `it("multiple subscribers all receive the event, in registration order")`
  - `it("no throw when emitting with zero listeners")`

### `tests/unit/GameStateMachine.test.ts` (Vitest)

- `describe("GameStateMachine transitions")`
  - `it.each` over **every** `[from, to]` pair listed in `TRANSITIONS` â†’ `"transition ${from} -> ${to} succeeds"` (asserts `currentId === to`)
  - `it.each` over a table of **invalid** pairs (e.g. `MainMenu â†’ Racing`, `Countdown â†’ Paused`, `Racing â†’ MainMenu`, `Results â†’ MapSelect`, self-transitions) â†’ `"canTransition rejects ${from} -> ${to}"` and `"transition throws on forced ${from} -> ${to}"`
- `describe("GameStateMachine enter/exit")`
  - `it("calls exit() on the old screen and enter(ctx) on the new one, in that order")` (fake screens with `vi.fn()` spies; assert call order via `spy.mock.invocationCallOrder`)
  - `it("emits ui:navigate with { to } after a successful transition")`

### `tests/unit/KeyboardInput.test.ts` (Vitest, fake event target)

- `describe("KeyboardInput")`
  - `it("keydown W sets throttle axis to 1; keyup returns it to 0")`
  - `it("A/D set steer axis to -1/+1 respectively (arrows too)")`
  - `it("E justPressed is true for exactly one logic step, then false after endLogicStep()")`
  - `it("Escape pause edge: justPressed('pause') true once, cleared by endLogicStep(); holding Escape keeps button('pause') true")`

### `tests/e2e/menu.spec.ts` (Playwright)

- `describe("Phase 1 main menu")`
  - `it("Start advances to the CharacterSelect stub")` â€” goto `/`, title "Turbo Turtle Rally" visible, click Start â†’ `[data-testid="screen-character-select"]` visible and `window.__game.state === "CharacterSelect"`



## As-built deviations & gotchas (recorded at completion)

Four places where the implementation diverged from this guide â€” each was a real bug or omission caught by tests/e2e, and the guide text above has been corrected to match:

1. **`EventBus<T extends object>`** (was ``T extends Record<string, unknown>``). The concrete `GameEvents` interface has no index signature, so it fails the `Record<string, unknown>` constraint under strict TS. `object` is sufficient for `keyof T & string`.
2. **Steer axis mapping in the `KeyboardInput.axis()` sketch was inverted** â€” it mapped A/Left to +1. The test spec (A -> -1, D -> +1) is correct; left steer must be negative. Implementation and this guide now agree: `(right ? 1 : 0) - (left ? 1 : 0)`.
3. **`activateInitial()` idempotency** â€” the first implementation checked `screens.has(currentId)` to detect "already activated", but that is always true after registration, so the initial screen was never entered. Fixed with a dedicated `_activated` flag. (Caught by unit tests: enter/exit order + idempotency.)
4. **Two browser-only gaps not covered by this guide:**
   - Babylon throws `"No camera defined"` on `scene.render()` without an active camera â€” Phase 0's `HelloWorldScene` used to provide one, so main.ts now creates a parked placeholder `UniversalCamera` (position `(0,2,-6)`, target `(0,1,0)`). Replaced by the chase camera in Phase 3.
   - Screens emit `"ui:navigate"` but nothing performs the transition unless **GameApp subscribes** to it and calls `machine.transition(to)` (with a `canTransition` guard + console.warn on illegal targets). That subscriber lives in `boot()`. Without it, Start/Enter silently do nothing â€” unit tests cannot catch this because they drive `transition()` directly; only the Playwright menu spec caught it.

