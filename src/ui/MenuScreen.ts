import type { AudioManager } from "../audio/AudioManager.js";
import type { MusicSequencer } from "../audio/MusicSequencer.js";
import type { SfxPlayer } from "../audio/SfxPlayer.js";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import "../styles/menu.css";

/** Main menu: title + Start / Quit. Enter or clicking Start begins a race setup. */
export class MenuScreen implements IGameScreen {
  readonly id = "MainMenu" as const;
  private overlay: HTMLDivElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly audio: AudioManager,
    private readonly sfx: SfxPlayer,
    /** Phase 6 — menu music. playTheme is a no-op until the AudioContext unlocks. */
    private readonly music?: MusicSequencer,
  ) {}

  enter(ctx: GameContext): void {
    if (this.overlay) return; // build the DOM once, cache on the instance
    const overlay = document.createElement("div");
    overlay.className = "menu-overlay";
    overlay.dataset.testid = "screen-main-menu";

    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "Turbo Turtle Rally";

    const buttons = document.createElement("div");
    buttons.className = "menu-buttons";

    const start = this.makeButton("Start", "menu-start", () => {
      this.audio.unlock();
      this.sfx.uiClick();
      ctx.eventBus.emit("ui:navigate", { to: "CharacterSelect" });
    });
    const quit = this.makeButton("Quit", "menu-quit", () => {
      this.audio.unlock();
      this.sfx.uiClick();
      // Phase 4 wires quit-to-close; no-op for now.
    });

    buttons.append(start, quit);
    overlay.append(title, buttons);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === "Enter") start.click();
    };
    window.addEventListener("keydown", onKeyDown);
    this.onKeyDown = onKeyDown;

    // Phase 6 — arm the one-shot gesture handler that starts menu music.
    this.armMenuMusic();
  }

  exit(): void {
    this.overlay?.remove();
    this.overlay = null;
    if (this.onKeyDown) {
      window.removeEventListener("keydown", this.onKeyDown);
      this.onKeyDown = null;
    }
    if (this.onFirstGesture) {
      window.removeEventListener("pointerdown", this.onFirstGesture);
      window.removeEventListener("keydown", this.onFirstGesture);
      this.onFirstGesture = null;
    }
  }

  /**
   * Phase 6 — start menu music on the first user gesture (browser autoplay policy
   * requires a gesture before audio can play). One-shot: removed after it fires.
   */
  private onFirstGesture: (() => void) | null = null;

  private armMenuMusic(): void {
    const music = this.music; // capture — the closure outlives the narrowing
    if (!music || this.onFirstGesture) return;
    const start = (): void => {
      this.audio.unlock();
      music.playTheme("menu");
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      this.onFirstGesture = null;
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    this.onFirstGesture = start;
  }

  private makeButton(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.dataset.testid = testId;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
}
