import "../styles/countdown.css";
import { AudioManager } from "../audio/AudioManager.js";
import { MusicSequencer } from "../audio/MusicSequencer.js";
import { SfxPlayer } from "../audio/SfxPlayer.js";
import { KeyboardInput } from "../input/KeyboardInput.js";
import { CharacterSelect } from "../ui/CharacterSelect.js";
import { MapSelect } from "../ui/MapSelect.js";
import { MenuScreen } from "../ui/MenuScreen.js";
import { VehicleSelect } from "../ui/VehicleSelect.js";
import { Hud } from "../ui/Hud.js";
import { PauseMenu } from "../ui/PauseMenu.js";
import { ResultsScreen } from "../ui/ResultsScreen.js";
import { SettingsStore } from "./SettingsStore.js";
import type { QualityPreset } from "../data/tuning.js";
import { StubScreen } from "../ui/StubScreen.js";
import { FreeDriveScene } from "../scene/FreeDriveScene.js";
import { RaceScene } from "../scene/RaceScene.js";
import { LAGOON_TRACK, MEADOWS_TRACK } from "../data/tracks/index.js";
import { TrackSpline } from "../tracks/TrackSpline.js";
import { TUNING } from "../data/tuning.js";
import { RaceController } from "../race/RaceController.js";
import type { ItemId } from "../entities/KartPhysics.js";
import { createRng, raceSeed } from "./Rng.js";
import { EventBus, type GameEvents } from "./EventBus.js";
import {
  GAME_SCREEN_IDS,
  GameStateMachine,
  type DriveSnapshot,
  type GameContext,
  type GameScreenId,
  type IDrivableScreen,
  type IGameScreen,
  type IParticleVfx,
  type IQualityProbe,
  type IRenderPipeline,
} from "./GameStateMachine.js";
import { FixedTimestepLoop } from "./FixedTimestepLoop.js";
import type { RaceConfig } from "./RaceConfig.js";

/** Seconds the free-drive interstitial shows before dropping into the track. */
const FREE_DRIVE_COUNTDOWN_SECONDS = 1.5;

/**
 * Phase 3 free-drive countdown (05-phase-3-track-system.md, Task 5).
 * Shows the assembled raceConfig + a "FREE DRIVE" label for ~1.5 s, then advances
 * to Racing (the FreeDriveScene). The real 3-2-1-GO countdown lands in Phase 4.
 */
class FreeDriveCountdown implements IGameScreen {
  readonly id = "Countdown" as const;
  private el: HTMLDivElement | null = null;
  private timer = 0;

  constructor(private readonly ctx: GameContext) {}

  enter(_ctx: GameContext): void {
    this.timer = 0;
    const cfg = this.ctx.raceConfig;
    const div = document.createElement("div");
    div.className = "stub-screen";
    div.dataset.testid = "countdown-stub";
    // Keep the Phase 2 text shape (e2e asserts on it) and add the free-drive label.
    div.textContent = cfg
      ? `raceConfig: ${cfg.characterId} / ${cfg.vehicleId} / ${cfg.mapId}`
      : "raceConfig: (missing)";
    const label = document.createElement("div");
    label.className = "countdown-label";
    label.dataset.testid = "free-drive-label";
    label.textContent = "FREE DRIVE — Esc to exit";
    div.appendChild(label);
    document.body.appendChild(div);
    this.el = div;
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer >= FREE_DRIVE_COUNTDOWN_SECONDS) {
      this.ctx.eventBus.emit("ui:navigate", { to: "Racing" });
    }
  }

  exit(): void {
    this.el?.remove();
    this.el = null;
  }
}

/**
 * Phase 7 — thin "Countdown" screen that delegates to the shared RaceScene so the
 * in-scene countdown renders over the LIVE track world (all four cars visible on the
 * grid, wide framing easing into chase). The real scene is registered under "Racing";
 * this adapter keeps it entered across the Countdown → Racing transition without
 * rebuilding the world (RaceScene.enter() is idempotent).
 */
class RaceCountdownAdapter implements IGameScreen {
  readonly id = "Countdown" as const;

  /** The scene is built at Countdown enter (post-boot, needs the controller) — hence a getter. */
  constructor(private readonly getScene: () => RaceScene | null) {}

  enter(ctx: GameContext): void {
    this.getScene()?.enter(ctx);
  }

  exit(): void {
    // No-op — the world stays alive for the Racing re-entry (keepWorldOnExit pattern).
  }

  /** Keep the race world across Countdown → Racing so RaceScene isn't torn down + rebuilt. */
  keepWorldOnExit(to: string): boolean {
    return to === "Racing";
  }

  update(dt: number): void {
    this.getScene()?.update(dt);
  }

  onFrame(dt: number): void {
    this.getScene()?.onFrame(dt);
  }
}

/**
 * Phase 7 race countdown overlay (replaces the old full-screen interstitial).
 *
 * A traffic-light start sequence driven by the RaceController's `race:countdownTick`
 * events, rendered as a DOM overlay ON TOP of the live race scene (the cars are
 * visible on the grid behind it). As the count goes 3 → 2 → 1 the red, amber and
 * green lamps light up in turn (with a big matching number), then on `race:start`
 * all three go bright green and a "GO!" flashes before handing off to Racing.
 * The countdown timing itself lives in the RaceController (single source of truth);
 * this overlay is purely presentational. Owned by GameApp like the HUD — NOT a
 * state-machine screen, because the active screen during Countdown is now the
 * RaceCountdownAdapter over the live world.
 */
class CountdownOverlay {
  private el: HTMLDivElement | null = null;
  private numEl: HTMLDivElement | null = null;
  private lights: Record<"red" | "amber" | "green", HTMLElement> | null = null;
  /** Delayed hand-off to Racing after the GO flash — cleared on hide. */
  private goTimerId: number | null = null;
  /** Unsubscribers for the race:* listeners added in show() — cleared on hide. */
  private unsubs: Array<() => void> = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly sfx: SfxPlayer,
  ) {}

  /** Build the overlay DOM + subscribe to countdown events (idempotent per show). */
  show(): void {
    // Subscribe per-enter and unsubscribe on exit so re-entries don't stack listeners.
    this.unsubs.push(
      this.ctx.eventBus.on("race:countdownTick", ({ remaining }) => {
        if (this.numEl) {
          this.numEl.textContent = String(remaining);
          this.numEl.dataset.count = String(remaining); // recolors the number to match
        }
        // 3 → red, 2 → amber, 1 → green: light the next lamp as we count down.
        const lit = remaining === 3 ? "red" : remaining === 2 ? "amber" : "green";
        if (this.lights) this.lights[lit].classList.add("on");
        this.sfx.countdownBeep(false); // single tick beep for 3 / 2 / 1
      }),
      this.ctx.eventBus.on("race:start", () => {
        // All lamps green + a brief "GO!" flash, then hand off to the race scene.
        if (this.lights) {
          for (const key of Object.keys(this.lights) as Array<keyof typeof this.lights>) {
            this.lights[key].classList.add("on");
          }
        }
        if (this.numEl) this.numEl.textContent = "GO!";
        this.el?.classList.add("go");
        // Phase 6: GO sound = triple rising beep + horn; engine hum starts now and
        // runs until the results screen stops it.
        this.sfx.countdownBeep(true);
        this.sfx.startEngineLoop();
        // Let the green/GO flash register for a beat before leaving.
        this.goTimerId = window.setTimeout(() => {
          this.ctx.eventBus.emit("ui:navigate", { to: "Racing" });
        }, 650);
      }),
    );

    const cfg = this.ctx.raceConfig;
    const div = document.createElement("div");
    div.className = "stub-screen countdown-screen";
    div.dataset.testid = "countdown-stub";

    // Traffic-light housing: three lamps (red / amber / green), all off at first.
    const lightsEl = document.createElement("div");
    lightsEl.className = "countdown-lights";
    const builtLights: Record<"red" | "amber" | "green", HTMLElement> = {
      red: null as unknown as HTMLElement,
      amber: null as unknown as HTMLElement,
      green: null as unknown as HTMLElement,
    };
    for (const color of ["red", "amber", "green"] as const) {
      const lamp = document.createElement("span");
      lamp.className = `countdown-light ${color}`;
      lightsEl.appendChild(lamp);
      builtLights[color] = lamp;
    }
    this.lights = builtLights;

    // Big number (3 / 2 / 1 → GO!).
    const num = document.createElement("div");
    num.className = "countdown-number";
    num.dataset.testid = "countdown-number";
    num.textContent = String(TUNING.race.countdownSeconds);
    num.dataset.count = String(TUNING.race.countdownSeconds); // red at the start
    this.numEl = num;

    // Keep the Phase 2 config text (e2e asserts on it) as its own child so the
    // parent's textContent still contains it.
    const cfgLine = document.createElement("div");
    cfgLine.className = "countdown-config";
    cfgLine.textContent = cfg
      ? `raceConfig: ${cfg.characterId} / ${cfg.vehicleId} / ${cfg.mapId}`
      : "raceConfig: (missing)";

    div.append(lightsEl, num, cfgLine);
    document.body.appendChild(div);
    this.el = div;
  }

  /** Tear down the overlay DOM + listeners (idempotent). */
  hide(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    if (this.goTimerId !== null) {
      clearTimeout(this.goTimerId);
      this.goTimerId = null;
    }
    this.el?.remove();
    this.el = null;
    this.numEl = null;
    this.lights = null;
  }
}

/**
 * Application root: owns the event bus, audio, input, screen state machine and
 * the fixed-timestep logic loop. Babylon objects are carried opaquely so this
 * file stays importable in Node (headless tests).
 */
export class GameApp {
  readonly eventBus = new EventBus<GameEvents>();
  readonly audio = new AudioManager();
  readonly sfx = new SfxPlayer(this.audio);
  /** Phase 4 music stub (menu/race themes). No-ops until the AudioContext unlocks. */
  readonly music = new MusicSequencer(this.audio);
  readonly input = new KeyboardInput();
  readonly machine: GameStateMachine;

  private readonly ctx: GameContext;
  private loop: FixedTimestepLoop | null = null;
  /** Phase 4 race controller — constructed on Countdown enter, disposed on quit. */
  private race: RaceController | null = null;
  /**
   * Phase 6 (T16) — the live race render scene. Held here so GameApp can drive the podium
   * sequence (beginPodium / podiumTick / endPodium + exit) across the Racing → Results
   * transition, where keepWorldOnExit skips the normal exit() teardown. Null otherwise.
   */
  private raceScene: RaceScene | null = null;
  /** Phase 7 — live results screen ref (race mode only) so update() can drive tickLive(). */
  private resultsScreen: ResultsScreen | null = null;
  /** In-race HUD overlay (visible during Racing + Paused). Owned here, not a screen. */
  private readonly hud: Hud;
  /** Phase 7 — traffic-light countdown overlay shown over the live race scene. */
  private readonly countdownOverlay: CountdownOverlay;
  /** Persisted player settings (Phase 4 Step 10). */
  private readonly settingsStore = new SettingsStore();
  /**
   * Quality preset applier + reader — injected by main.ts (wired to the render-layer
   * QualityManager) so this file stays Babylon-free. Null until wired; the SettingsPanel
   * no-ops quality changes and shows no highlight when they're absent.
   */
  private qualityApplier: ((preset: QualityPreset) => void) | null = null;
  private qualityReader: (() => QualityPreset | null) | null = null;
  /**
   * Step 12 production safety — true only in dev mode or when the URL carries `?debug`.
   * Gates the `ttr.debugAIDrive` localStorage read so that, in a plain production build,
   * the flag is never consulted (Vite also strips the dead branch at minify time).
   */
  private readonly debugAllowed: boolean;

  /** Wire the render-layer QualityManager into the settings panel (called by main.ts). */
  setQualityApplier(applier: (preset: QualityPreset) => void, reader?: () => QualityPreset | null): void {
    this.qualityApplier = applier;
    if (reader) this.qualityReader = reader;
  }

  /**
   * Phase 6 — wire the render-layer RenderPipelineSetup into the context (called by
   * main.ts). Kept opaque so core stays Babylon-free; map scenes read ctx.renderPipeline.
   */
  setRenderPipeline(pipeline: IRenderPipeline): void {
    this.ctx.renderPipeline = pipeline;
  }

  /**
   * Phase 6 — wire the render-layer ParticleFactory into the context (called by main.ts).
   * Kept opaque so core stays Babylon-free; map scenes read ctx.particleVfx.
   */
  setParticleVfx(vfx: IParticleVfx): void {
    this.ctx.particleVfx = vfx;
  }

  /**
   * Phase 6 — wire the render-layer QualityManager into the context (called by main.ts).
   * Kept opaque so core stays Babylon-free; map scenes read ctx.qualityProbe for props.
   */
  setQualityProbe(probe: IQualityProbe): void {
    this.ctx.qualityProbe = probe;
  }

  /** Step 12 debug hook — enables AI driving of the player kart (e2e / manual testing). */
  aiDrivePlayer(): void {
    this.race?.enableAiDrive();
  }

  /**
   * Phase 5.1 debug hook — force the player's held item (e2e / manual playtest).
   * main.ts only exposes this when debugAllowed. No-op when no race is active.
   */
  debugSetPlayerItem(item: string): void {
    this.race?.debugSetPlayerItem(item as ItemId);
  }

  /**
   * Phase 5.1 — the PLAYER's live shell count for window.__game (0 when no race is
   * active). Counts only the player's shells so the e2e charge test isn't perturbed
   * by AI-fired shells. (The full world mirror is race.shells().)
   */
  shellCount(): number {
    if (!this.race) return 0;
    return this.race.shells().filter((s) => s.ownerId === "player").length;
  }

  /** Live standings for window.__game (empty array when no race is active). */
  raceStandings(): Array<{ id: string; name: string; rank: number; lap: number; t: number }> {
    return this.race ? this.race.standings() : [];
  }

  /** Phase 7 — current race phase for window.__game ("countdown" | "racing" | "finished"). */
  racePhase(): string {
    return this.race?.phase ?? "none";
  }

  /** Per-kart summary for window.__game (empty array when no race is active). */
  raceKartSummary(): Array<{ id: string; pos: { x: number; y: number; z: number }; speed: number; lap: number; item: unknown; charging: unknown }> {
    return this.race ? this.race.karts().map((k) => ({ id: k.id, pos: k.state.pos, speed: k.state.speed, lap: k.state.lap, item: k.state.item, charging: k.state.charging })) : [];
  }

  constructor(engine: unknown, scene: unknown, freeDriveMode = false, debugAllowed = false) {
    this.debugAllowed = debugAllowed;
    this.ctx = {
      engine,
      scene,
      eventBus: this.eventBus,
      raceConfig: null,
      pendingSelection: {},
      input: this.input,
      freeDriveMode,
      renderPipeline: null, // set by main.ts via setRenderPipeline() post-construction
      particleVfx: null, // set by main.ts via setParticleVfx() post-construction
      qualityProbe: null, // set by main.ts via setQualityProbe() post-construction
    };
    this.machine = new GameStateMachine("MainMenu", this.eventBus, this.ctx);
    // HUD reads the live controller through a getter so it always sees the current race.
    this.hud = new Hud(() => this.race);
    this.countdownOverlay = new CountdownOverlay(this.ctx, this.sfx);
  }

  /** Create screens -> register with the machine -> enter initial -> start loop. */
  boot(): void {
    const menu = new MenuScreen(this.audio, this.sfx, this.music);
    this.machine.register(menu);
    // Phase 2: real selection screens replace their stubs as they land.
    this.machine.register(new CharacterSelect());
    this.machine.register(new VehicleSelect());
    this.machine.register(new MapSelect());

    // Countdown: free-drive shows the short "FREE DRIVE" label; race mode (Phase 7)
    // delegates to the live RaceScene so the 3-2-1-GO plays OVER the track world with
    // all four cars visible on the grid (the traffic-light overlay is DOM, owned here).
    if (this.ctx.freeDriveMode) {
      this.machine.register(new FreeDriveCountdown(this.ctx));
    } else {
      this.machine.register(new RaceCountdownAdapter(() => this.raceScene));
    }

    // Phase 4 Step 10: real pause overlay replaces its stub (race mode only — free-drive
    // has no race to pause). Registered before the stub loop so it wins.
    if (!this.ctx.freeDriveMode) {
      this.machine.register(
        new PauseMenu(
          this.audio,
          this.sfx,
          this.settingsStore,
          (p) => this.qualityApplier?.(p),
          () => this.qualityReader?.() ?? null,
        ),
      );
      // Phase 4 Step 11: real results screen replaces its stub (race mode only — free-drive
      // has no race to finish). Reads final standings through a getter to the controller.
      const results = new ResultsScreen(() => this.race);
      this.resultsScreen = results; // Phase 7: driven by update() during the live finish-out.
      this.machine.register(results);
    }

    for (const id of GAME_SCREEN_IDS) {
      if (this.machine.has(id)) continue;
      // Racing is registered lazily in BOTH modes (needs the raceConfig, which only
      // exists after MapSelect confirm — post-boot). Skip it here so this stub doesn't
      // shadow the real scene.
      if (id === "Racing") continue;
      this.machine.register(new StubScreen(id));
    }

    // Central navigation: screens emit "ui:navigate" as a REQUEST; the machine
    // re-emits it as a NOTIFICATION after transitioning. Both share one channel
    // (01-architecture.md §5), so this handler must be idempotent — ignore when we
    // are already at the target (the notification case) to avoid spurious warnings.
    this.eventBus.on("ui:navigate", ({ to }) => {
      if (this.machine.currentId === to) return; // already there (post-transition notify)
      if (!this.machine.canTransition(to)) {
        console.warn(`[GameApp] Ignoring illegal navigation to "${to}".`);
        return;
      }
      // Lazy scene registration (free-drive only): build once we have a raceConfig. Race
      // mode builds its scene at Countdown enter below, so the in-scene countdown renders.
      if (to === "Racing" && !this.machine.has("Racing") && this.ctx.raceConfig) {
        if (this.ctx.freeDriveMode) {
          this.machine.register(new FreeDriveScene(this.ctx, this.ctx.raceConfig));
        }
      }
      // Race mode: build the controller + render scene when we enter Countdown (MapSelect
      // confirm has already set ctx.raceConfig). The scene must exist before the first
      // countdown tick fires so the cars are visible on the grid behind the overlay.
      if (!this.ctx.freeDriveMode && to === "Countdown" && this.ctx.raceConfig) {
        this.buildRace(this.ctx.raceConfig); // idempotent — also unregisters any old Racing screen
        const rs = new RaceScene(this.ctx, this.race!);
        this.raceScene = rs; // Phase 6 (T16): held for podium driving + teardown.
        this.machine.register(rs);
        this.countdownOverlay.show();
      }
      // Leaving Countdown (anywhere, including the GO → Racing hand-off) hides the
      // overlay. hide() is idempotent and show() re-subscribes on the next race's enter.
      if (!this.ctx.freeDriveMode && this.machine.currentId === "Countdown") {
        this.countdownOverlay.hide();
      }
      // Step 12: auto-enable AI drive when the localStorage flag is set. Gated on
      // debugAllowed (dev mode or ?debug) so a plain production build never reads the
      // flag — without it this whole block is dead code, eliminated at minify time.
      if (!this.ctx.freeDriveMode && to === "Countdown" && this.race && this.debugAllowed) {
        try {
          if (localStorage.getItem("ttr.debugAIDrive") === "1") this.race.enableAiDrive();
        } catch { /* SSR / non-browser — ignore */ }
      }
      // Phase 6 (T16): leaving Results tears down the race world that was kept alive for
      // the podium — exit() was skipped on Racing → Results, so we run it here. Placed
      // BEFORE teardownRace so renderPipeline.exitMap() precedes pipeline.dispose(),
      // matching the pre-podium ordering. Guarded + idempotent (no-op if already torn down).
      if (!this.ctx.freeDriveMode && this.machine.currentId === "Results" && to !== "Results") {
        // Phase 7: the engine hum runs through the finish-out and ends here.
        this.sfx.stopEngineLoop();
        this.raceScene?.endPodium();
        this.raceScene?.exit();
      }
      // Quitting to MainMenu tears down any live race (controller + music).
      if (to === "MainMenu") {
        this.teardownRace();
      }
      // HUD is visible during Racing and Paused (frozen) in race mode; hidden elsewhere.
      if (!this.ctx.freeDriveMode && (to === "Racing" || to === "Paused")) {
        this.hud.show();
      } else {
        this.hud.hide();
      }
      this.machine.transition(to);
    });

    // Phase 7 (finish-out): the moment the PLAYER crosses the line on the last lap, route
    // to Results immediately — the overlay shows live rankings while the AI-driven player
    // keeps racing and the field finishes out. The transition table allows Racing → Results.
    this.eventBus.on("race:playerFinished", () => {
      if (this.ctx.freeDriveMode) return;
      // The player is done — fade the engine hum out so it doesn't carry onto the
      // scoreboard. stopEngineLoop is idempotent, so the race:finished backstop below
      // and the Results-exit call are safe no-ops after this.
      this.sfx.stopEngineLoop(0.6);
      if (this.machine.currentId === "Racing" && this.machine.canTransition("Results")) {
        this.machine.transition("Results");
      }
    });

    // Race mode: when the controller finishes the race (all karts done or grace deadline),
    // start the podium over the live world. In Phase 7 we're usually ALREADY in Results by
    // then (player finished first); beginPodium is idempotent and safe from either state.
    this.eventBus.on("race:finished", () => {
      if (this.ctx.freeDriveMode) return;
      const standings = this.race?.finalStandings() ?? [];
      // Backstop: if the player never crossed (DNF / grace deadline), race:playerFinished
      // didn't fire — fade the hum out here instead. No-op if already stopped.
      this.sfx.stopEngineLoop(0.6);
      // Phase 6 (T16): the podium animates over the live race world; the fanfare fires
      // mid step-up bounce, not here.
      this.raceScene?.beginPodium(standings, () => this.music.playTheme("fanfare"));
      if (this.machine.currentId === "Racing" && this.machine.canTransition("Results")) {
        this.machine.transition("Results");
      } else if (this.machine.currentId === "Results") {
        // Phase 7: we're already in Results from the live finish-out — swap the live
        // table for the final one (drops Skip, shows DNFs + total times).
        this.resultsScreen?.finalize();
      }
    });

    // Phase 6 — SFX subscriptions (single owner, Babylon-free). Only the PLAYER's own
    // actions and hits-on-the-player make noise; AI karts are silent.
    const isPlayer = (kartId: string): boolean => this.race?.karts().some((k) => k.id === kartId && k.isPlayer) ?? false;

    this.eventBus.on("item:pickedUp", ({ kartId }) => {
      if (isPlayer(kartId)) this.sfx.itemPickup();
    });

    this.eventBus.on("item:used", ({ kartId, item }) => {
      if (!isPlayer(kartId)) return;
      switch (item) {
        case "mushroom": // shroom boost is also emitted as kart:boosted tier=shroom below
          break;
        case "greenShell":
        case "redShell":
        case "blueShell":
          this.sfx.shellFire(item === "greenShell" ? "green" : item === "redShell" ? "red" : "blue");
          break;
        case "banana":
          // The peel drop is quiet — the skid sound plays when someone hits it.
          break;
        case "star":
          this.sfx.starActivate();
          break;
        case "lightning":
          this.sfx.lightningZap();
          break;
      }
    });

    this.eventBus.on("kart:boosted", ({ kartId, tier }) => {
      if (!isPlayer(kartId)) return;
      if (tier === "shroom") this.sfx.shroomBoost();
      else if (tier === "start") this.sfx.startBoost(); // Phase 7 perfect-start boost
      else this.sfx.driftWhoosh(); // mini / super drift turbo
    });

    this.eventBus.on("kart:hit", ({ kartId }) => {
      if (!isPlayer(kartId)) return;
      this.sfx.shellHit();
    });

    this.eventBus.on("kart:skid", ({ kartId, cause }) => {
      if (cause === "banana" && isPlayer(kartId)) this.sfx.bananaSkid();
      // Oil slicks are silent (on-road surface change, no slip sound in the catalog).
    });

    this.machine.activateInitial();

    this.input.attach();
    this.loop = new FixedTimestepLoop(
      (dt) => this.update(dt),
      () => {
        // Render hook — Phase 3 wires scene.render interpolation here.
      },
    );
    this.loop.start();
  }

  /** One fixed logic step: update the active screen, then clear input edges. */
  update(dt: number): void {
    const id = this.machine.currentId;

    // Phase 4 Step 10 — Esc toggles pause (race mode only). Handled here so the input edge
    // is consumed exactly once and there's a single owner for the toggle. Pausing freezes all
    // logic below; resuming returns to Racing. The render loop keeps running independently, so
    // the last frame simply stays on screen while paused.
    if (!this.ctx.freeDriveMode && this.input.justPressed("pause")) {
      if (id === "Racing" && this.machine.canTransition("Paused")) {
        this.eventBus.emit("ui:navigate", { to: "Paused" });
        this.input.endLogicStep(); // consume the edge so it doesn't re-fire next frame
        return;
      }
      if (id === "Paused" && this.machine.canTransition("Racing")) {
        this.eventBus.emit("ui:navigate", { to: "Racing" });
        this.input.endLogicStep();
        return;
      }
    }

    // While Paused, ALL logic is frozen — no race stepping, no HUD refresh, no screen updates.
    if (id === "Paused") return;

    // Phase 4 (race mode only): step the race controller while in Countdown or Racing.
    // It owns all simulation math and emits race:* events; the screens are presentational.
    // Not stepped while Paused (Step 10 adds that guard explicitly — here it's implicit
    // because "Paused" is neither of the two ids).
    // Phase 7: also stepped during the finish-out — we're in Results but the field is
    // still racing after the player crossed (phase !== "finished").
    if (!this.ctx.freeDriveMode && this.race) {
      const stepping = id === "Countdown" || id === "Racing" || (id === "Results" && this.race.phase !== "finished");
      if (stepping) this.race.update(dt);
    }
    // Refresh HUD text each logic step while racing (frozen automatically when Paused,
    // because update() early-returns for that state in Step 10).
    if (!this.ctx.freeDriveMode && id === "Racing") {
      this.hud.update(dt);
      // Phase 6: retune the engine hum to the player kart's speed + throttle each step.
      const player = this.race?.karts().find((k) => k.isPlayer);
      if (player) {
        const throttle = Math.max(0, this.input.axis("throttle")); // 0..1 forward input
        this.sfx.updateEngineLoop(player.state.speedRatio, throttle);
        // Star shimmer has no expiry bus event — stop it the moment the effect is gone.
        if (!player.state.statusEffects.some((e) => e.kind === "star")) {
          this.sfx.stopStarLoop();
        }
      }
    }
    const screen = this.machine.activeScreen;
    screen?.update?.(dt);
    // Per-frame render updates (camera follow) run on the same clock for now.
    if (screen && "onFrame" in screen) {
      (screen as unknown as { onFrame(dt: number): void }).onFrame(dt);
    }
    // Phase 6 (T16) / Phase 7: while in Results, drive the kept-alive race world
    // explicitly — RaceScene.onFrame no longer runs because the active screen is
    // ResultsScreen. During the finish-out (field still racing) we tick the live scene
    // frame + refresh the results table; once fully finished we run the podium.
    if (!this.ctx.freeDriveMode && id === "Results" && this.race) {
      if (this.race.phase !== "finished") {
        this.raceScene?.tick(dt);
        this.resultsScreen?.tickLive();
      } else {
        this.raceScene?.podiumTick(dt);
      }
    }
    this.input.endLogicStep();
  }

  /** Build the race controller from a confirmed RaceConfig (race mode, Countdown enter). */
  private buildRace(cfg: RaceConfig): void {
    this.teardownRace(); // idempotent — safe to call on re-entry (e.g. Race Again)
    const track = cfg.mapId === LAGOON_TRACK.id ? LAGOON_TRACK : MEADOWS_TRACK;
    // Phase 6: widthOverrides (bridge spans) must reach the spline so on-road
    // detection uses the narrowed half-width inside override spans.
    const spline = new TrackSpline(track.controlPoints, track.roadWidth, TUNING.physics.onRoadMargin, undefined, track.widthOverrides);
    // Determinism: seed is a pure hash of the three ids (architecture §9) — never Math.random().
    const rng = createRng(raceSeed(cfg.characterId, cfg.vehicleId, cfg.mapId));
    this.race = new RaceController({
      config: cfg,
      track,
      spline,
      bus: this.eventBus,
      rng,
      input: this.input, // real keyboard → PlayerController (human drives the player kart)
      renderEnabled: true,
    });
    // Music theme switch on GO — injected so the controller stays decoupled from audio.
    this.race.musicHook = (theme) => this.music.playTheme(theme);
  }

  /** Tear down a live race (controller + music). Called when quitting to MainMenu. */
  private teardownRace(): void {
    if (!this.race) return;
    this.race.musicHook = null;
    this.race = null;
    // Drop the per-race "Racing" screen so the NEXT race registers a fresh scene bound
    // to the new controller. Without this, the second race re-enters the old RaceScene
    // (bound to the finished first controller): HUD updates but the world/camera are frozen.
    if (this.machine.has("Racing")) {
      this.machine.unregister("Racing");
    }
    this.music.stopAll(); // stop the looping race theme so it doesn't bleed into the menu
    // Phase 6: full pipeline teardown on quit-to-menu — skybox/lights/post are rebuilt
    // fresh (firstApply) when the next map scene enters. Feeds P7 disposal tests.
    this.ctx.renderPipeline?.dispose();
  }

  snapshot(): { state: GameScreenId; raceConfig: RaceConfig | null; drive?: DriveSnapshot } {
    const screen = this.machine.activeScreen;
    const drive = screen && "driveSnapshot" in screen ? (screen as IDrivableScreen).driveSnapshot() : undefined;
    return { state: this.machine.currentId, raceConfig: this.ctx.raceConfig, ...(drive ? { drive } : {}) };
  }

  /** Stops the logic loop (used by tests / quit-to-menu in Phase 4). */
  dispose(): void {
    this.loop?.stop();
    this.loop = null;
    this.input.detach();
  }
}
