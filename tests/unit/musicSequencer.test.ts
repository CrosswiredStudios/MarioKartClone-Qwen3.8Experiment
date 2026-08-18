import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  loopDurationSec,
  midiToFreq,
  MusicSequencer,
  themeBpm,
  themeNotes,
  type MusicChannel,
  type ThemeId,
} from "../../src/audio/MusicSequencer.js";
import type { AudioManager } from "../../src/audio/AudioManager.js";

const LOOPING_THEMES: ThemeId[] = ["menu", "meadowsRace", "lagoonRace"];
const ALL_THEMES: ThemeId[] = [...LOOPING_THEMES, "fanfare"];
const CHANNELS: MusicChannel[] = ["lead", "bass", "noise-hat"];

describe("buildSchedule (scheduler math)", () => {
  it("returns notes sorted by absolute time for every theme", () => {
    for (const theme of ALL_THEMES) {
      const bpm = themeBpm(theme);
      const schedule = buildSchedule(themeNotes(theme), bpm, 10.0);
      expect(schedule.length).toBeGreaterThan(0);
      for (let i = 1; i < schedule.length; i++) {
        expect(schedule[i].at).toBeGreaterThanOrEqual(schedule[i - 1].at);
      }
    }
  });

  it("places each note at startAt + timeInBeats × (60/bpm) within ±1 ms", () => {
    for (const theme of ALL_THEMES) {
      const bpm = themeBpm(theme);
      const startAt = 10.0;
      const schedule = buildSchedule(themeNotes(theme), bpm, startAt);
      // Index the raw notes by (timeInBeats, channel, midiNote) so each scheduled
      // event can be matched back to its source note.
      for (const ev of schedule) {
        const expected = startAt + ev.note.timeInBeats * (60 / bpm);
        expect(ev.at).toBeCloseTo(expected, 3); // ±1 ms
      }
    }
  });

  it("loopDurationSec equals bars × beatsPerBar × (60/bpm) — regression for the ÷bpm bug", () => {
    // menu: 8 bars × 4 beats × 0.5 s/beat = 16 s (the old formula gave 32/120 ≈ 0.27 s).
    expect(loopDurationSec("menu")).toBeCloseTo(16, 6);
    expect(loopDurationSec("meadowsRace")).toBeCloseTo((8 * 4) * (60 / 140), 6);
    expect(loopDurationSec("lagoonRace")).toBeCloseTo((8 * 4) * (60 / 150), 6);
    expect(loopDurationSec("fanfare")).toBeCloseTo((4 * 4) * (60 / 132), 6);
  });

  it("midiToFreq maps A4 to 440 Hz and is monotonic", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    for (let m = 0; m < 127; m++) {
      expect(midiToFreq(m + 1)).toBeGreaterThan(midiToFreq(m));
    }
  });
});

describe("channel coverage", () => {
  it("every channel appears at least once per loop in all themes", () => {
    for (const theme of ALL_THEMES) {
      const notes = themeNotes(theme);
      for (const ch of CHANNELS) {
        expect(notes.some((n) => n.channel === ch), `${theme} missing channel ${ch}`).toBe(true);
      }
    }
  });

  it("lead and bass carry real pitches; hats are off-beat only", () => {
    for (const theme of ALL_THEMES) {
      const notes = themeNotes(theme);
      for (const n of notes) {
        if (n.channel === "noise-hat") {
          // Hats land on the "&" — never on a downbeat.
          expect(n.timeInBeats % 1).toBeCloseTo(0.5, 6);
        } else {
          expect(n.midiNote).toBeGreaterThan(20);
          expect(n.midiNote).toBeLessThan(108);
        }
      }
    }
  });
});

describe("loop wrap", () => {
  it("consecutive passes are seamless: no overlap, gap bounded by one beat", () => {
    for (const theme of LOOPING_THEMES) {
      const bpm = themeBpm(theme);
      const dur = loopDurationSec(theme);
      const passA = buildSchedule(themeNotes(theme), bpm, 0);
      const passB = buildSchedule(themeNotes(theme), bpm, dur);
      expect(passA.length).toBeGreaterThan(0);
      const lastA = passA[passA.length - 1].at;
      const firstB = passB[0].at;
      // Pass B's beat-0 note lands exactly one loop after pass A starts.
      expect(firstB).toBeCloseTo(dur, 6);
      // No overlap: the next pass never starts before the previous pass ends…
      expect(firstB - lastA).toBeGreaterThanOrEqual(-1e-9);
      // …and the rest between passes is at most one beat (no dead air / stutter).
      expect(firstB - lastA).toBeLessThanOrEqual(60 / bpm + 1e-9);
    }
  });

  it("simultaneous notes (lead+bass on downbeats) are stably ordered, never out of order", () => {
    for (const theme of ALL_THEMES) {
      const a = buildSchedule(themeNotes(theme), themeBpm(theme), 0);
      const b = buildSchedule(themeNotes(theme), themeBpm(theme), 0);
      // Non-decreasing times…
      for (let i = 1; i < a.length; i++) {
        expect(a[i].at).toBeGreaterThanOrEqual(a[i - 1].at);
      }
      // …and ties keep a deterministic order across repeated builds (stable sort).
      expect(a.map((e) => e.note.channel)).toEqual(b.map((e) => e.note.channel));
    }
  });

  it("two consecutive passes tile the timeline without overlap or reordering", () => {
    const theme: ThemeId = "menu";
    const bpm = themeBpm(theme);
    const dur = loopDurationSec(theme);
    const combined = [
      ...buildSchedule(themeNotes(theme), bpm, 0),
      ...buildSchedule(themeNotes(theme), bpm, dur),
    ].sort((a, b) => a.at - b.at);
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i].at).toBeGreaterThanOrEqual(combined[i - 1].at);
    }
    // Pass B's first note sits exactly one loop after pass A's first note.
    const bFirst = combined.find((e) => e.at >= dur)!;
    expect(bFirst.at).toBeCloseTo(dur, 6);
  });
});

describe("MusicSequencer default clock (unlocked AudioContext)", () => {
  /** Minimal fake of the WebAudio surface createVoice/tick touch — no real context. */
  function fakeUnlockedAudio(): AudioManager & { audioContext: unknown } {
    const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    const node = () => ({ gain: { ...param }, connect() { return this; }, disconnect() {} });
    return {
      audioContext: { currentTime: 5.0, destination: {}, createGain: node },
      musicDestination: null,
    } as unknown as AudioManager & { audioContext: unknown };
  }

  it("playTheme does not throw when the context is unlocked (default clock reads it)", () => {
    // Regression: the default clock getter used `this` inside an object literal,
    // where `this` is the CLOCK — so `.audio.audioContext` threw a TypeError that
    // escaped the fixed-timestep loop and froze the whole game after countdown.
    const seq = new MusicSequencer(fakeUnlockedAudio());
    expect(() => seq.playTheme("menu")).not.toThrow();
    expect(seq.playingTheme).toBe("menu");
  });

  it("stopAll cleans up a playing voice without throwing", () => {
    const seq = new MusicSequencer(fakeUnlockedAudio());
    seq.playTheme("meadowsRace");
    expect(() => seq.stopAll()).not.toThrow();
    expect(seq.playingTheme).toBeNull();
  });

  it("playTheme is still a no-op before unlock (null context)", () => {
    const locked = {} as unknown as AudioManager; // audioContext getter → undefined
    const seq = new MusicSequencer(locked);
    expect(() => seq.playTheme("menu")).not.toThrow();
    expect(seq.playingTheme).toBeNull();
  });
});
