import type { TrackTheme } from "../data/tracks/shared.js";
import type { IInputSource } from "../input/IInputSource.js";
import type { RaceConfig } from "./RaceConfig.js";
import type { EventBus, GameEvents } from "./EventBus.js";

/**
 * Phase 6 — opaque render-pipeline handle (08-phase-6-vfx-audio-polish.md T1/T2).
 * The concrete class lives in src/rendering/RenderPipelineSetup.ts (Babylon); this
 * structural interface keeps core Babylon-free. Set by main.ts via GameApp; null in
 * headless tests, where scenes guard with `?.`.
 */
export interface IRenderPipeline {
  /** Apply a map theme: skybox + lights + fog + post stack. Idempotent per theme object. */
  applyTheme(theme: TrackTheme): void;
  /** Re-apply the post stack + shadow resolution after a live quality change. */
  onQualityChanged(): void;
  /** Restore menu fog/clear color when leaving a map scene (skybox stays as backdrop). */
  exitMap(): void;
  /**
   * Re-register shadow casters after track/kart meshes are (re)built — pause rebuilds
   * them. `extraRoots` are the kart roots (karts aren't under track-root); typed as a
   * minimal structural shape so core stays Babylon-free.
   */
  refreshShadowCasters(extraRoots?: ReadonlyArray<{ getChildMeshes(): unknown[] }>): void;
  /** Full teardown: dispose skybox/lights/shadows/post and restore pristine scene state. */
  dispose(): void;
}

/**
 * Phase 6 — per-kart plain-data view handed to the particle factory each frame
 * (08-phase-6-vfx-audio-polish.md T3–T7). Kept in core so the opaque IParticleVfx
 * interface stays Babylon-free. The scene computes `offRoad` from its spline and the
 * two effect flags by polling `state.statusEffects`; the factory never touches KartEntity.
 */
export interface KartVfxView {
  id: string;
  pos: { x: number; y: number; z: number };
  /** Radians, 0 = +Z forward (matches KartState.heading). */
  heading: number;
  /** Signed m/s — used to gate skid dust above TUNING.vfx.skidMinSpeed. */
  speed: number;
  /** True when the kart is off the road ribbon (grass) — scene computes via spline. */
  offRoad: boolean;
  /** True while a "star" statusEffect is active → drives the orbiting-sparkle system. */
  starred: boolean;
  /** True while a "shrink" statusEffect is active → scales that kart's mesh down (visual only). */
  shrunk: boolean;
}

/**
 * Phase 6 — opaque particle-VFX handle (08-phase-6-vfx-audio-polish.md T3–T7). The concrete
 * class lives in src/vfx/ParticleFactory.ts (Babylon); this structural interface keeps core
 * Babylon-free. Set by main.ts via GameApp; null in headless tests, where scenes guard with `?.`.
 */
/**
 * Phase 6 — opaque quality-preset probe (render-layer QualityManager implements it).
 * Map scenes use this to construct the PropBuilder (density + torch lights) without
 * importing the concrete class, keeping core Babylon-free.
 */
export interface IQualityProbe {
  /** Active preset id: "low" | "medium" | "high". */
  readonly current: string;
  /** Prop-density fraction for the active preset (0..1). */
  propDensity(): number;
  /** Particle-budget multiplier for the active preset (0..1). */
  budget(): number;
  /**
   * Live preset-change listener slot (single consumer at a time — only one map scene
   * is active, and it disposes its PropBuilder on exit before another can claim it).
   * The PropBuilder uses this to re-place props + torch lights on live quality changes.
   */
  onPresetChanged: ((preset: string) => void) | null;
}

export interface IParticleVfx {
  /** Subscribe to VFX-driving bus events (kart:boosted / kart:hit / item:used). Idempotent. */
  attach(bus: EventBus<GameEvents>): void;
  /**
   * Per-frame tick: sync kart-following emitters, drive continuous systems (star sparkle /
   * skid dust / lightning shrink) from the polled snapshots, and dispose expired one-shots.
   */
  update(dt: number, karts: ReadonlyArray<KartVfxView>): void;
  /** Phase 6 (T16): multi-color confetti burst at a world position (podium). Self-disposes. */
  confetti(pos: { x: number; y: number; z: number }): void;
  /** Tear down every live system + the lightning overlay (scene exit / quit-to-menu). */
  disposeAll(): void;
}

export const GAME_SCREEN_IDS = [
  "MainMenu",
  "CharacterSelect",
  "VehicleSelect",
  "MapSelect",
  "Countdown",
  "Racing",
  "Paused",
  "Results",
] as const;

export type GameScreenId = (typeof GAME_SCREEN_IDS)[number];

/** Selections accumulated across the three select screens before RaceConfig is assembled. */
export interface PendingSelection {
  characterId?: string;
  vehicleId?: string;
  /** Phase 4 Step 11: set by Results "Race Again" so MapSelect re-highlights the same track. */
  mapId?: string;
}

/** Context handed to every screen. `raceConfig` is filled at MapSelect confirm (Phase 2). */
export interface GameContext {
  /** Babylon Engine — kept opaque so this file stays Babylon-free. */
  readonly engine: unknown;
  /** Babylon Scene — kept opaque so this file stays Babylon-free. */
  readonly scene: unknown;
  readonly eventBus: EventBus<GameEvents>;
  raceConfig: RaceConfig | null;
  pendingSelection: PendingSelection;
  /**
   * The app's input source (Phase 3). Set by GameApp before any screen enters.
   * Kept on the context so screens never reach into GameApp internals; typed via
   * a structural import to keep this file free of concrete input implementations.
   */
  input: IInputSource;
  /**
   * Phase 3 free-drive sub-mode (05-phase-3-track-system.md): when true, the
   * Countdown screen is a short "FREE DRIVE" interstitial and Esc returns to
   * MapSelect instead of advancing. Set by main.ts before boot; read by screens.
   */
  freeDriveMode: boolean;
  /**
   * Phase 6 — opaque render-pipeline handle (see IRenderPipeline above). Set by
   * main.ts via GameApp.setRenderPipeline(); null in headless tests. Map scenes call
   * applyTheme() on enter and exitMap() on exit so fog/clear restore correctly.
   */
  renderPipeline: IRenderPipeline | null;
  /**
   * Phase 6 — opaque particle-VFX handle (see IParticleVfx above). Set by main.ts via
   * GameApp.setParticleVfx(); null in headless tests. Map scenes call attach() on enter,
   * update(dt, karts) each frame, and disposeAll() on exit so no systems leak across races.
   */
  particleVfx: IParticleVfx | null;
  /**
   * Phase 6 — opaque quality probe (see IQualityProbe above). Set by main.ts via
   * GameApp.setQualityProbe(); null in headless tests. Map scenes pass it to the PropBuilder.
   */
  qualityProbe: IQualityProbe | null;
}

export interface IGameScreen {
  readonly id: GameScreenId;
  enter(ctx: GameContext): void;
  exit(): void;
  /** Called each fixed logic step while active. */
  update?(dt: number): void;
  /**
   * Phase 6 (T16) — optional opt-out of exit() on a specific transition. A screen that
   * keeps its world alive across the transition (Racing → Results, so the podium sequence
   * can animate over the live race world) returns true for that target; the machine then
   * skips exit() and the screen owns its own teardown later (endPodium / unregister).
   */
  keepWorldOnExit?(to: GameScreenId): boolean;
}

/**
 * Optional capability implemented by drivable screens (Phase 3 free-drive).
 * Pure — no Babylon types — so GameApp can surface a live snapshot for manual
 * verification / e2e without importing the render layer. Detected via duck-typing
 * (`"driveSnapshot" in screen`), keeping GameApp headless-testable.
 */
export interface IDrivableScreen {
  driveSnapshot(): DriveSnapshot;
}

/** Live free-drive state, exposed through window.__game.snapshot().drive. */
export interface DriveSnapshot {
  kartPos: { x: number; y: number; z: number };
  speed: number; // m/s (signed)
  surface: "road" | "offRoad" | "oilSlick";
  driftCharge: string; // "none" | "charging1" | "charging2"
}

/** Transition table — mirrors the mermaid diagram in 01-architecture.md §8. */
export const TRANSITIONS: Record<GameScreenId, readonly GameScreenId[]> = {
  MainMenu: ["CharacterSelect"],
  CharacterSelect: ["VehicleSelect", "MainMenu"],
  VehicleSelect: ["MapSelect", "CharacterSelect"],
  MapSelect: ["Countdown", "VehicleSelect"],
  Countdown: ["Racing"],
  // Phase 3 free-drive adds Racing -> MapSelect (Esc exits back to map select).
  Racing: ["Paused", "Results", "MapSelect"],
  Paused: ["Racing", "MainMenu"],
  Results: ["CharacterSelect", "MainMenu"],
};

/**
 * Screen state machine. The constructor does NOT auto-enter the initial
 * screen — call {@link activateInitial} once all screens are registered so
 * tests can drive registration manually.
 */
export class GameStateMachine {
  private _currentId: GameScreenId;
  private _activated = false;
  private readonly screens = new Map<GameScreenId, IGameScreen>();

  constructor(
    initial: GameScreenId,
    private readonly eventBus: EventBus<GameEvents>,
    private readonly ctx: GameContext,
  ) {
    this._currentId = initial;
  }

  get currentId(): GameScreenId {
    return this._currentId;
  }

  /** The screen currently entered (null before {@link activateInitial}). */
  get activeScreen(): IGameScreen | null {
    return this.screens.get(this._currentId) ?? null;
  }

  /** One screen per id; throws on duplicate or unknown ids. */
  register(screen: IGameScreen): void {
    if (!GAME_SCREEN_IDS.includes(screen.id)) {
      throw new Error(`Unknown screen id: ${screen.id}`);
    }
    if (this.screens.has(screen.id)) {
      throw new Error(`Duplicate screen registration for: ${screen.id}`);
    }
    this.screens.set(screen.id, screen);
  }

  /** True if a screen is already registered for this id. */
  has(id: GameScreenId): boolean {
    return this.screens.has(id);
  }

  /**
   * Remove a registered screen (no exit() — the caller owns lifecycle). Used to
   * replace per-race screens like "Racing", which bind to a specific controller.
   */
  unregister(id: GameScreenId): void {
    this.screens.delete(id);
  }
  /** Pure guard — never mutates. */
  canTransition(to: GameScreenId): boolean {
    return TRANSITIONS[this._currentId].includes(to);
  }

  /** Throws if !canTransition(to); calls exit()/enter(); emits "ui:navigate". */
  transition(to: GameScreenId): void {
    if (!this.canTransition(to)) {
      throw new Error(`Illegal transition ${this._currentId} -> ${to}`);
    }
    const from = this.screens.get(this._currentId);
    if (!from) {
      throw new Error(`No screen registered for current state: ${this._currentId}`);
    }
    // Phase 6 (T16): a screen may opt out of exit() for a specific transition so its
    // world stays alive (Racing → Results keeps the race world up for the podium).
    if (!from.keepWorldOnExit?.(to)) from.exit();
    this._currentId = to;
    const next = this.screens.get(to);
    if (!next) {
      throw new Error(`No screen registered for target state: ${to}`);
    }
    next.enter(this.ctx);
    // AFTER enter, so listeners observe the already-updated currentId.
    this.eventBus.emit("ui:navigate", { to });
  }

  /** Enters the initial screen exactly once (idempotent). */
  activateInitial(): void {
    if (this._activated) return; // already activated
    const initial = this.screens.get(this._currentId);
    if (!initial) {
      throw new Error(`No screen registered for initial state: ${this._currentId}`);
    }
    initial.enter(this.ctx);
    this._activated = true;
  }
}
