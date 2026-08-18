/**
 * SettingsStore (06-phase-4 Step 10) — persistence + validation.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../../src/core/SettingsStore.js";

const KEY = "ttr.settings";

// Node has no localStorage — install a minimal in-memory stub (access is lazy inside
// the store's methods, so defining this after import is safe).
function makeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stubbing a browser global
  (globalThis as any).localStorage = makeLocalStorage();
});

describe("SettingsStore", () => {
  const store = new SettingsStore();

  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when the key is absent", () => {
    expect(store.load()).toEqual({ ...DEFAULT_SETTINGS });
  });

  it("round-trips save/load for a full settings object", () => {
    const next = { quality: "high" as const, masterVolume: 0.5, musicVolume: 0.25, sfxVolume: 1, muted: true };
    store.save(next);
    expect(store.load()).toEqual(next);
  });

  it("returns defaults for corrupted JSON", () => {
    localStorage.setItem(KEY, "{ not valid json !!!");
    expect(store.load()).toEqual({ ...DEFAULT_SETTINGS });
  });

  it("returns defaults when a field has an invalid value (quality: 'ultra')", () => {
    localStorage.setItem(KEY, JSON.stringify({ quality: "ultra", masterVolume: 0.5 }));
    expect(store.load()).toEqual({ ...DEFAULT_SETTINGS });
  });

  it("clamps out-of-range volumes into [0,1] but keeps valid fields", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ quality: "low", masterVolume: 5, musicVolume: -3, sfxVolume: 0.4, muted: false }),
    );
    const s = store.load();
    expect(s.quality).toBe("low");
    expect(s.masterVolume).toBe(1); // clamped down from 5
    expect(s.musicVolume).toBe(0); // clamped up from -3
    expect(s.sfxVolume).toBe(0.4); // unchanged
  });

  it("treats non-finite volumes as the default for that field", () => {
    localStorage.setItem(KEY, JSON.stringify({ quality: "medium", masterVolume: Number.NaN }));
    const s = store.load();
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
  });

  it("clear() removes the stored blob so load falls back to defaults", () => {
    store.save({ ...DEFAULT_SETTINGS, muted: true });
    expect(store.load().muted).toBe(true);
    store.clear();
    expect(store.load()).toEqual({ ...DEFAULT_SETTINGS });
  });
});
