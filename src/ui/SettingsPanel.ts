/**
 * SettingsPanel — the settings sub-overlay shown inside Pause (06-phase-4 Step 10).
 *
 * Not an IGameScreen: it is a child of the Paused screen, toggled by its "Settings"
 * button. Every control applies LIVE (no Apply button): quality presets go through an
 * injected callback (so this file stays Babylon-free), volumes/mute hit the AudioManager
 * buses directly, and each change persists via SettingsStore.save().
 */

import type { QualityPreset } from "../data/tuning.js";
import type { AudioManager } from "../audio/AudioManager.js";
import type { SettingsStore} from "../core/SettingsStore.js";
import { type Settings } from "../core/SettingsStore.js";
import "../styles/settings.css";

const QUALITY_ORDER: readonly QualityPreset[] = ["low", "medium", "high"];

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;
  private qualityButtons = new Map<QualityPreset, HTMLButtonElement>();
  private masterSlider: HTMLInputElement | null = null;
  private musicSlider: HTMLInputElement | null = null;
  private sfxSlider: HTMLInputElement | null = null;
  private muteBox: HTMLInputElement | null = null;

  constructor(
    private readonly store: SettingsStore,
    private readonly audio: AudioManager,
    /** Apply a quality preset to the live render pipeline (wired by GameApp → QualityManager). */
    private readonly onQualityChange: (preset: QualityPreset) => void,
    /** Current active preset (for highlighting); null = unknown. */
    private readonly getQuality: () => QualityPreset | null,
  ) {}

  /** Build (once) and show the panel, seeding controls from stored settings. */
  show(): void {
    if (!this.overlay) this.build();
    const s = this.store.load();
    this.syncControls(s);
    if (this.overlay) this.overlay.style.display = "";
  }

  hide(): void {
    if (this.overlay) this.overlay.style.display = "none";
  }

  /** True when the panel is built and currently visible (used by pause to toggle it). */
  overlayVisible(): boolean {
    return !!this.overlay && this.overlay.style.display !== "none";
  }

  /** Remove the panel's DOM element entirely. Called by PauseMenu on exit so a fresh
   *  panel is rebuilt each time you re-enter settings (avoids stacked duplicate overlays). */
  dispose(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.qualityButtons.clear();
    this.masterSlider = null;
    this.musicSlider = null;
    this.sfxSlider = null;
    this.muteBox = null;
  }

  private build(): void {
    const overlay = document.createElement("div");
    overlay.className = "settings-overlay";
    overlay.dataset.testid = "settings-panel";

    const title = document.createElement("h2");
    title.textContent = "Settings";

    // ── Quality presets ────────────────────────────────────────────────
    const qualityRow = document.createElement("div");
    qualityRow.className = "settings-row";
    const qualityLabel = document.createElement("span");
    qualityLabel.className = "settings-label";
    qualityLabel.textContent = "Quality";

    for (const preset of QUALITY_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-quality-btn";
      btn.dataset.testid = `quality-${preset}`;
      btn.textContent = preset[0].toUpperCase() + preset.slice(1);
      btn.addEventListener("click", () => this.changeQuality(preset));
      qualityRow.appendChild(btn);
      this.qualityButtons.set(preset, btn);
    }
    qualityRow.prepend(qualityLabel);

    // ── Volume sliders ─────────────────────────────────────────────────
    const master = this.makeSlider("Master", "settings-master-vol", (v) => this.applyVolume("master", v));
    const music = this.makeSlider("Music", "settings-music-vol", (v) => this.applyVolume("music", v));
    const sfx = this.makeSlider("SFX", "settings-sfx-vol", (v) => this.applyVolume("sfx", v));

    // ── Mute checkbox ──────────────────────────────────────────────────
    const muteRow = document.createElement("div");
    muteRow.className = "settings-row";
    const muteLabel = document.createElement("span");
    muteLabel.className = "settings-label";
    muteLabel.textContent = "Mute all";
    const muteBox = document.createElement("input");
    muteBox.type = "checkbox";
    muteBox.dataset.testid = "settings-mute";
    muteBox.addEventListener("change", () => this.changeMute(muteBox.checked));
    muteRow.append(muteLabel, muteBox);

    overlay.append(title, qualityRow, master.row, music.row, sfx.row, muteRow);
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.masterSlider = master.slider;
    this.musicSlider = music.slider;
    this.sfxSlider = sfx.slider;
    this.muteBox = muteBox;
  }

  private makeSlider(label: string, testId: string, onInput: (v01: number) => void): { row: HTMLDivElement; slider: HTMLInputElement } {
    const row = document.createElement("div");
    row.className = "settings-row";
    const span = document.createElement("span");
    span.className = "settings-label";
    span.textContent = label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.dataset.testid = testId;
    slider.addEventListener("input", () => onInput(Number(slider.value) / 100));
    row.append(span, slider);
    return { row, slider };
  }

  /** Reflect a Settings object into the controls (used on show). */
  private syncControls(s: Settings): void {
    if (this.masterSlider) this.masterSlider.value = String(Math.round(s.masterVolume * 100));
    if (this.musicSlider) this.musicSlider.value = String(Math.round(s.musicVolume * 100));
    if (this.sfxSlider) this.sfxSlider.value = String(Math.round(s.sfxVolume * 100));
    if (this.muteBox) this.muteBox.checked = s.muted;

    const active = this.getQuality();
    for (const [preset, btn] of this.qualityButtons) {
      btn.classList.toggle("active", preset === active);
    }
  }

  /** Read the current control values into a Settings object. */
  private readControls(): Settings {
    return {
      quality: this.getQuality() ?? "medium",
      masterVolume: this.masterSlider ? Number(this.masterSlider.value) / 100 : 0,
      musicVolume: this.musicSlider ? Number(this.musicSlider.value) / 100 : 0,
      sfxVolume: this.sfxSlider ? Number(this.sfxSlider.value) / 100 : 0,
      muted: this.muteBox?.checked ?? false,
    };
  }

  private changeQuality(preset: QualityPreset): void {
    this.onQualityChange(preset); // live-apply to the render pipeline first
    for (const [p, btn] of this.qualityButtons) btn.classList.toggle("active", p === preset);
    const next = this.readControls();
    next.quality = preset;
    this.store.save(next);
  }

  private changeMute(muted: boolean): void {
    // AudioManager forces master gain to 0 while muted and back to the last set value on
    // unmute, so we only flip the flag here. Volume values are persisted as-is so a later
    // session restores them.
    this.audio.mute(muted);
    const next = this.readControls();
    next.muted = muted;
    this.store.save(next);
  }

  /** Apply a slider change live + persist. Called from each slider's input handler. */
  private applyVolume(bus: "master" | "music" | "sfx", v01: number): void {
    this.audio.setVolume(bus, v01);
    const next = this.readControls();
    if (bus === "master") next.masterVolume = v01;
    else if (bus === "music") next.musicVolume = v01;
    else next.sfxVolume = v01;
    this.store.save(next);
  }
}
