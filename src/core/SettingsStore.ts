/**
 * SettingsStore — persisted player settings (06-phase-4 Step 10).
 *
 * Pure logic: no DOM, no Babylon. Reads/writes a single JSON blob in localStorage
 * under the key "ttr.settings". `load()` validates shape and clamps values; any
 * failure returns a fresh copy of DEFAULT_SETTINGS (never throws to callers).
 */

import type { QualityPreset } from "../data/tuning.js";

export interface Settings {
  quality: QualityPreset;
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  muted: boolean;
}

const STORAGE_KEY = "ttr.settings";

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  quality: "medium" as QualityPreset,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  muted: false,
});

const VALID_QUALITIES: ReadonlySet<string> = new Set(["low", "medium", "high"]);

/** Clamp a number to [0, 1]; non-finite values default to the given fallback. */
function clampVol(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/**
 * Parse and validate a raw JSON string into Settings. Returns null when the input
 * is not valid JSON or has an invalid shape — callers should fall back to defaults.
 */
function parseAndValidate(raw: string): Settings | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;

  const o = obj as Record<string, unknown>;

  // quality must be one of the three valid presets.
  if (typeof o.quality !== "string" || !VALID_QUALITIES.has(o.quality)) return null;

  return {
    quality: o.quality as QualityPreset,
    masterVolume: clampVol(o.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: clampVol(o.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVol(o.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    muted: typeof o.muted === "boolean" ? o.muted : DEFAULT_SETTINGS.muted,
  };
}

export class SettingsStore {
  /** Load settings from localStorage. Returns defaults on any failure (missing key, corrupt JSON, bad shape). */
  load(): Settings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = parseAndValidate(raw);
      if (!parsed) {
        console.warn("[SettingsStore] Invalid stored settings — using defaults.");
        return { ...DEFAULT_SETTINGS };
      }
      return parsed;
    } catch {
      // localStorage unavailable (private mode / non-browser).
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** Persist settings to localStorage. No-op if storage is unavailable. */
  save(settings: Settings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or unavailable — silently ignore (settings just won't persist).
    }
  }

  /** Remove the stored settings (reset to defaults on next load). */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No-op.
    }
  }
}
