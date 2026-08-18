/**
 * QualityManager — Low/Medium/High render presets + one-shot auto-detect
 * (05-phase-3-track-system.md Task 7, per 01-architecture.md §10).
 *
 * Responsibilities:
 * - `apply(preset)`: engine pixel-ratio cap via hardwareScalingLevel, and the
 *   shadow/SSAO/bloom settings for the current preset. Phase 3 has no shadow
 *   generators or image-processing stack yet (Phase 6), so those values are
 *   STORED here as queryable state — `shadowMapSize` / `ssaoEnabled` /
 *   `bloomEnabled` — and the render pipeline reads them when it lands.
 * - `budget()`: particle-budget multiplier; ALL VFX (Phase 5/6) queries this.
 * - `autoDetect(onDone?)`: measures 60 frames at High via onBeforeRenderObservable
 *   + performance.now(); if average FPS < 50, steps down ONE preset and stops
 *   (one step per launch — never cascades to Low in a single run).
 * - Persistence: localStorage key "ttr.quality". A stored choice OVERRIDES
 *   auto-detect. Phase 4's SettingsPanel calls the same apply() API.
 *
 * This file MAY import Babylon (render layer) — but only as types, so the class
 * is unit-testable in Node with plain mock objects.
 */

import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core";
import { TUNING, type QualityPreset } from "../data/tuning.js";

/** localStorage key for the persisted quality choice (01-architecture.md §10). */
const STORAGE_KEY = "ttr.quality";
/** Frames measured during auto-detect. */
const DETECT_FRAMES = 60;
/** Average FPS below which we step down one preset. */
const MIN_FPS = 50;

/** Preset order, weakest first — used to step down exactly one level. */
const PRESET_ORDER: readonly QualityPreset[] = ["low", "medium", "high"];

function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === "string" && (PRESET_ORDER as readonly string[]).includes(value);
}

export class QualityManager {
  private currentPreset: QualityPreset = "high";
  /** Shadow map size for the active preset; Phase 6's shadow generators read this. */
  private _shadowMapSize: number = TUNING.quality.high.shadowMapSize;
  private _ssaoEnabled: boolean = TUNING.quality.high.ssao;
  private _bloomEnabled: boolean = TUNING.quality.high.bloom;

  /** Auto-detect in progress (guards against re-entry / apply() races). */
  private detecting = false;
  // Structural type — this build's Observer<T> exposes remove(defer?) but not a
  // public dispose(). We only need deferred removal.
  private detectObserver: { remove(defer?: boolean): void } | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly scene: Scene,
  ) {}

  /** Active preset. */
  get current(): QualityPreset {
    return this.currentPreset;
  }

  /** Shadow map size for the active preset (0 = shadows off). Phase 6 reads this. */
  get shadowMapSize(): number {
    return this._shadowMapSize;
  }

  /** SSAO flag for the active preset. Phase 6's image-processing stack reads this. */
  get ssaoEnabled(): boolean {
    return this._ssaoEnabled;
  }

  /** Bloom flag for the active preset. Phase 6's image-processing stack reads this. */
  get bloomEnabled(): boolean {
    return this._bloomEnabled;
  }

  /** Particle-budget multiplier — ALL VFX (Phase 5/6) queries this. */
  budget(): number {
    return TUNING.quality[this.currentPreset].particleBudget;
  }

  /** Prop-density fraction for the active preset (0..1). Phase 6's PropBuilder scales catalogs by this. */
  propDensity(): number {
    return TUNING.quality[this.currentPreset].propDensity;
  }

  /**
   * Optional callback fired when apply() actually CHANGES the preset.
   * Phase 6's PropBuilder uses it to re-place props + torch lights in place.
   * Param is `string` (not QualityPreset) so this class structurally satisfies
   * core's IQualityProbe without a circular import.
   */
  onPresetChanged: ((preset: string) => void) | null = null;

  /**
   * Apply a preset: pixel-ratio cap via hardwareScalingLevel + store the
   * shadow/SSAO/bloom settings for the render pipeline. Persists to localStorage
   * (only when the preset actually changes, so boot-time re-apply is a no-op).
   */
  apply(preset: QualityPreset): void {
    if (!isQualityPreset(preset)) return;
    // A manual/explicit choice cancels any in-flight auto-detect.
    this.stopDetecting();

    const changed = preset !== this.currentPreset;
    const cfg = TUNING.quality[preset];
    this.currentPreset = preset;
    this._shadowMapSize = cfg.shadowMapSize;
    this._ssaoEnabled = cfg.ssao;
    this._bloomEnabled = cfg.bloom;
    // Babylon's hardware scaling level shrinks the render buffer by 1/level —
    // exactly our pixel-ratio cap (Infinity = native device ratio).
    this.engine.setHardwareScalingLevel(cfg.pixelRatioCap);

    if (changed) {
      this.persist(preset);
      this.onPresetChanged?.(preset);
    }
  }

  /**
   * Read the stored choice. Returns null when absent or invalid so callers can
   * fall back to auto-detect. Public for Phase 4's SettingsPanel.
   */
  readStored(): QualityPreset | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return isQualityPreset(raw) ? raw : null;
    } catch {
      // Storage unavailable (private mode / non-browser test env).
      return null;
    }
  }

  /**
   * One-shot auto-detect: measure DETECT_FRAMES at High via the scene's
   * onBeforeRenderObservable, then step down ONE preset if average FPS < MIN_FPS.
   * A stored choice overrides this entirely (callers should check readStored()
   * first; we also re-check here as a guard). The detected result is NOT persisted —
   * each launch re-measures so a machine that slows down can step down again
   * (one step per launch, never cascading to Low in one run).
   */
  autoDetect(onDone?: (preset: QualityPreset) => void): void {
    if (this.detecting) return;
    // Stored choice wins — never override an explicit user setting.
    const stored = this.readStored();
    if (stored) {
      this.apply(stored);
      onDone?.(stored);
      return;
    }

    this.currentPreset = "high";
    this.detecting = true;
    let frameCount = 0;
    let lastTime: number | null = null;
    const deltas: number[] = [];

    this.detectObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.detecting) return;
      const now = performance.now();
      if (lastTime !== null) deltas.push(now - lastTime);
      lastTime = now;
      frameCount += 1;

      if (frameCount >= DETECT_FRAMES) {
        // Deferred removal — safe to call from inside notifyObservers' iteration.
        this.stopDetecting();
        // Average FPS from the inter-frame deltas (60 frames → 59 samples).
        const avgDeltaMs = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
        const avgFps = avgDeltaMs > 0 ? 1000 / avgDeltaMs : Infinity;

        let result: QualityPreset = "high";
        if (avgFps < MIN_FPS) {
          // Step down exactly ONE preset and stop — one step per launch.
          const idx = PRESET_ORDER.indexOf("high");
          result = PRESET_ORDER[Math.max(0, idx - 1)];
          this.apply(result);
        }
        onDone?.(result);
      }
    });
  }

  /** Tear down the auto-detect observer (idempotent). Deferred so it's safe to
   * call from inside the observable's own notification loop. */
  private stopDetecting(): void {
    if (this.detectObserver) {
      this.detectObserver.remove(true);
      this.detectObserver = null;
    }
    this.detecting = false;
  }

  private persist(preset: QualityPreset): void {
    try {
      localStorage.setItem(STORAGE_KEY, preset);
    } catch {
      // Non-fatal — quality just won't survive a reload.
    }
  }
}
