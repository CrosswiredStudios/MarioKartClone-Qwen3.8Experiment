/**
 * PauseMenu — the Paused-state overlay (06-phase-4 Step 10).
 *
 * Esc during Racing navigates here (transition table from Phase 1). The game loop keeps
 * running but GameApp.update() early-returns while Paused, so the race is frozen in place.
 * Three actions: Resume → back to Racing; Settings → toggles the settings sub-overlay;
 * Quit to Menu → MainMenu (GameApp disposes the RaceController on that transition).
 */

import type { AudioManager } from "../audio/AudioManager.js";
import type { SfxPlayer } from "../audio/SfxPlayer.js";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import type { SettingsStore } from "../core/SettingsStore.js";
import type { QualityPreset } from "../data/tuning.js";
import { SettingsPanel } from "./SettingsPanel.js";
import "../styles/settings.css";

export class PauseMenu implements IGameScreen {
  readonly id = "Paused" as const;
  private overlay: HTMLDivElement | null = null;
  private panel: SettingsPanel | null = null;

  constructor(
    private readonly audio: AudioManager,
    private readonly sfx: SfxPlayer,
    private readonly store: SettingsStore,
    /** Apply a quality preset to the live render pipeline (wired by GameApp → QualityManager). */
    private readonly onQualityChange: (preset: QualityPreset) => void,
    /** Current active quality preset (for panel highlighting); null = unknown. */
    private readonly getQuality: () => QualityPreset | null,
  ) {}

  enter(ctx: GameContext): void {
    if (!this.overlay) this.build(ctx);

    // Duck the music bus while paused; restore on resume/quit (GameApp also restores on
    // leaving Paused — see its navigation handler). We duck here so it happens even if the
    // user pauses before any race theme is playing.
    const s = this.store.load();
    this.audio.setVolume("music", s.musicVolume * 0.3);

    if (this.overlay) this.overlay.style.display = "";
  }

  exit(): void {
    // Restore the music bus to its full volume when leaving pause.
    const s = this.store.load();
    this.audio.setVolume("music", s.musicVolume);
    // Dispose the settings panel (removes its DOM element) so re-entering pause rebuilds a
    // fresh one — otherwise each cycle stacks another hidden overlay in document.body.
    this.panel?.dispose();
    this.panel = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  private build(ctx: GameContext): void {
    const overlay = document.createElement("div");
    overlay.className = "pause-overlay";
    overlay.dataset.testid = "screen-paused";

    const title = document.createElement("h2");
    title.textContent = "Paused";

    const buttons = document.createElement("div");
    buttons.className = "menu-buttons";

    const resume = this.makeButton("Resume", "pause-resume", () => {
      this.sfx.uiClick();
      ctx.eventBus.emit("ui:navigate", { to: "Racing" });
    });
    // Settings toggles the sub-overlay: click once to open, again to close (the panel has no
    // dedicated close button — it's a child of pause, so returning here is how you leave it).
    const settings = this.makeButton("Settings", "pause-settings", () => {
      this.sfx.uiClick();
      if (!this.panel) return;
      const open = this.panel.overlayVisible();
      if (open) this.panel.hide();
      else this.panel.show();
    });
    const quit = this.makeButton("Quit to Menu", "pause-quit", () => {
      this.sfx.uiClick();
      ctx.eventBus.emit("ui:navigate", { to: "MainMenu" });
    });

    buttons.append(resume, settings, quit);
    overlay.append(title, buttons);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Esc/Enter-to-resume is handled centrally by GameApp (input.justPressed("pause")) so
    // the pause toggle has a single owner and can't double-fire. This screen only renders.

    // The settings sub-overlay is a child of pause, not a screen.
    this.panel = new SettingsPanel(this.store, this.audio, this.onQualityChange, this.getQuality);
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
