/**
 * Music sequencer — Phase 6 rewrite (T8/T9). Replaces the P4 stub loops with a
 * lookahead scheduler and four data-defined chiptune themes:
 *   - "menu"        ~120 bpm, C major, bouncy 8-bar loop
 *   - "meadowsRace" ~140 bpm, energetic major, driving eighths, 8 bars
 *   - "lagoonRace"  ~150 bpm, A minor with tritone dissonance (E vs Bb), 8 bars
 *   - "fanfare"     short one-shot jingle for the results podium
 *
 * Architecture:
 *   - THEMES is pure data; `buildSchedule(notes, bpm, startAtSeconds)` returns a
 *     sorted absolute-time event list — both are exported and unit-tested without
 *     any AudioContext (T17).
 *   - The scheduler runs on the clock's setInterval tick (25 ms, TUNING.audio.schedulerTickMs)
 *     and schedules notes up to 0.1 s ahead of the playhead (schedulerLookaheadSec).
 *   - `playTheme` crossfades over TUNING.audio.musicCrossfadeMs: the outgoing voice's
 *     gain ramps to 0 while the incoming one ramps from 0.
 *   - Headless-safe: if the AudioContext is not unlocked, playTheme/stopAll are no-ops.
 */

import { TUNING } from "../data/tuning.js";
import type { AudioManager } from "./AudioManager.js";

export type ThemeId = "menu" | "meadowsRace" | "lagoonRace" | "fanfare";

/** The three synthesized channels (T8). */
export type MusicChannel = "lead" | "bass" | "noise-hat";

export interface NoteEvent {
  readonly timeInBeats: number; // absolute beat position within the loop
  readonly midiNote: number; // MIDI note number (C4 = 60)
  readonly durationBeats: number;
  readonly channel: MusicChannel;
}

/** Injectable clock for unit tests (production passes an AudioContext wrapper). */
export interface AudioClock {
  readonly currentTime: number; // seconds, monotonically increasing
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h?: unknown): void;
}

interface ThemeDef {
  readonly bpm: number;
  readonly bars: number;
  /** One-shot themes (fanfare) do not loop. */
  readonly oneShot?: boolean;
  readonly notes: NoteEvent[]; // unsorted is fine — buildSchedule sorts
}

const BEATS_PER_BAR = 4;

/** MIDI note number → frequency in Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Theme data (T9). Pure data — no AudioContext. All loops are 8 bars except the
// one-shot fanfare (4 bars). MIDI refs: C3=48 G2=43 A1=33 E2=40 Bb1=34 F2=41.
// ---------------------------------------------------------------------------

/** Eighth-note lead run across `bars` bars, cycling through `pattern`. */
function eighths(bars: number, pattern: number[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let b = 0; b < bars * BEATS_PER_BAR; b += 0.5) {
    out.push({ timeInBeats: b, midiNote: pattern[(b / 0.5) % pattern.length], durationBeats: 0.4, channel: "lead" });
  }
  return out;
}

/** Quarter-note bass on beats 1 & 3 of each bar (root/fifth alternation). */
function quarters(bars: number, notes: number[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let b = 0; b < bars * BEATS_PER_BAR; b += 2) {
    out.push({ timeInBeats: b, midiNote: notes[(b / 2) % notes.length], durationBeats: 1.5, channel: "bass" });
  }
  return out;
}

/** Off-beat noise hats (the "&" of each beat). */
function hats(bars: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let b = 0.5; b < bars * BEATS_PER_BAR; b += 1) {
    out.push({ timeInBeats: b, midiNote: 96, durationBeats: 0.1, channel: "noise-hat" }); // note ignored for noise
  }
  return out;
}

const THEMES: Record<ThemeId, ThemeDef> = {
  menu: {
    bpm: 120,
    bars: 8,
    notes: [
      ...eighths(8, [60, 64, 67, 72, 67, 64, 62, 65]), // C E G C' G E D F — bouncy major
      ...quarters(8, [36, 43, 41, 47]), // C2 G2 F2 Bb2 root/fifth pulse
      ...hats(8),
    ],
  },
  meadowsRace: {
    bpm: 140,
    bars: 8,
    notes: [
      ...eighths(8, [60, 67, 72, 67, 60, 67, 72, 76]), // C G C' G C G C' E' — driving major
      ...quarters(8, [36, 43, 41, 47]),
      ...hats(8),
    ],
  },
  lagoonRace: {
    bpm: 150,
    bars: 8,
    notes: [
      // A minor with tritone dissonance: E (64) against Bb (58/70) on alternating bars.
      ...eighths(8, [57, 64, 69, 64, 58, 64, 70, 64]), // A E A' E | Bb E Bb' E — the tritone bite
      ...quarters(8, [33, 40, 34, 41]), // A1 E2 Bb1 F2
      ...hats(8),
    ],
  },
  fanfare: {
    bpm: 132,
    bars: 4,
    oneShot: true,
    notes: [
      // Classic rising-falling jingle in C major.
      ...eighths(4, [60, 64, 67, 72, 76, 72, 67, 64]),
      ...quarters(4, [36, 48, 41, 53]), // C3 G3 F3 Bb3 — wide root jumps
      ...hats(4),
    ],
  },
};

/** Loop duration in seconds for a theme (fanfare = its one-shot length). */
export function loopDurationSec(theme: ThemeId): number {
  const def = THEMES[theme];
  return (def.bars * BEATS_PER_BAR) * (60 / def.bpm);
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — T17)
// ---------------------------------------------------------------------------

/**
 * Compute the absolute-time schedule for one loop pass. `startAtSeconds` is the
 * clock time of beat 0; each event's `at` is its absolute play time in seconds.
 * The result is sorted by `at`. Pure — no AudioContext needed.
 */
export function buildSchedule(
  theme: readonly NoteEvent[],
  bpm: number,
  startAtSeconds: number,
): Array<{ at: number; note: NoteEvent }> {
  const secPerBeat = 60 / bpm;
  return [...theme]
    .map((note) => ({ at: startAtSeconds + note.timeInBeats * secPerBeat, note }))
    .sort((a, b) => a.at - b.at);
}

/** The raw (unsorted) note list for a theme — exported so tests can inspect coverage. */
export function themeNotes(theme: ThemeId): readonly NoteEvent[] {
  return THEMES[theme].notes;
}

/** BPM of a theme. */
export function themeBpm(theme: ThemeId): number {
  return THEMES[theme].bpm;
}

interface Voice {
  theme: ThemeId;
  gain: GainNode;
  channelGains: Record<MusicChannel, GainNode>;
  nextEventIdx: number;
  loopStartAt: number; // clock time of the current loop's beat-0
  loopDurSec: number;
  oneShot: boolean;
  schedule: Array<{ at: number; note: NoteEvent }>;
}

const CHANNEL_GAINS: Record<MusicChannel, number> = { lead: 0.16, bass: 0.22, "noise-hat": 0.08 };

export class MusicSequencer {
  private activeVoice: Voice | null = null;
  private fadingOut: { voice: Voice; doneAt: number } | null = null;
  private timerHandle: unknown = null;
  private readonly clock: AudioClock;

  constructor(
    private readonly audio: AudioManager,
    /** Optional injected clock for tests. Defaults to the AudioContext when unlocked. */
    clock?: AudioClock,
  ) {
    // Capture in a closure — inside an object-literal getter `this` is the CLOCK
    // object, not the sequencer (the old `(this as MusicSequencer).audio` cast
    // threw a TypeError that escaped the game loop and froze the race).
    const audioRef = this.audio;
    this.clock =
      clock ?? {
        get currentTime() {
          return audioRef.audioContext?.currentTime ?? 0;
        },
        setInterval: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearInterval: (h?: unknown) => clearTimeout(h as ReturnType<typeof setTimeout> | undefined),
      };
  }

  /** Currently playing theme (null if stopped or mid-crossfade-out). */
  get playingTheme(): ThemeId | null {
    return this.activeVoice?.theme ?? null;
  }

  /** Start a theme, crossfading out the current one over TUNING.audio.musicCrossfadeMs. */
  playTheme(id: ThemeId): void {
    const ctx = this.audio.audioContext;
    if (!ctx) return; // headless / not unlocked — no-op
    if (this.activeVoice?.theme === id && !this.fadingOut) return; // already playing

    // Crossfade out the current voice.
    if (this.activeVoice) {
      const old = this.activeVoice;
      this.activeVoice = null;
      this.fadeOut(old);
    }

    this.activeVoice = this.createVoice(id, ctx, this.clock.currentTime);
    this.ensureTimer();
  }

  /** Stop everything immediately (no crossfade). */
  stopAll(): void {
    if (this.fadingOut) {
      this.killVoice(this.fadingOut.voice);
      this.fadingOut = null;
    }
    if (this.activeVoice) {
      this.killVoice(this.activeVoice);
      this.activeVoice = null;
    }
    this.stopTimer();
  }

  // -------------------------------------------------------------------------

  private createVoice(theme: ThemeId, ctx: AudioContext, atTime: number): Voice {
    const def = THEMES[theme];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, atTime);
    gain.connect(this.audio.musicDestination ?? ctx.destination);

    const channelGains = {} as Record<MusicChannel, GainNode>;
    for (const ch of ["lead", "bass", "noise-hat"] as MusicChannel[]) {
      const g = ctx.createGain();
      g.gain.value = CHANNEL_GAINS[ch];
      g.connect(gain);
      channelGains[ch] = g;
    }

    // Fade in over the crossfade window.
    gain.gain.linearRampToValueAtTime(1, atTime + TUNING.audio.musicCrossfadeMs / 1000);

    const loopDurSec = loopDurationSec(theme);
    return {
      theme,
      gain,
      channelGains,
      nextEventIdx: 0,
      loopStartAt: atTime + 0.12, // small offset so first notes are never "already past"
      loopDurSec,
      oneShot: !!def.oneShot,
      schedule: buildSchedule(def.notes, def.bpm, atTime + 0.12),
    };
  }

  private fadeOut(voice: Voice): void {
    const now = this.clock.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + TUNING.audio.musicCrossfadeMs / 1000);
    this.fadingOut = { voice, doneAt: now + TUNING.audio.musicCrossfadeMs / 1000 };
  }

  private killVoice(voice: Voice): void {
    try {
      voice.gain.disconnect();
      for (const g of Object.values(voice.channelGains)) g.disconnect();
    } catch { /* already disconnected */ }
  }

  private ensureTimer(): void {
    if (this.timerHandle !== null) return;
    const tick = () => {
      this.tick();
      // Re-arm unless the one-shot finished and cleared activeVoice.
      if (this.activeVoice || this.fadingOut) {
        this.timerHandle = this.clock.setInterval(tick, TUNING.audio.schedulerTickMs);
      } else {
        this.timerHandle = null;
      }
    };
    this.timerHandle = this.clock.setInterval(tick, TUNING.audio.schedulerTickMs);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) {
      this.clock.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /** One scheduler tick: advance loops, schedule notes within the lookahead. */
  private tick(): void {
    const now = this.clock.currentTime;

    // Clean up finished crossfades.
    if (this.fadingOut && now >= this.fadingOut.doneAt) {
      this.killVoice(this.fadingOut.voice);
      this.fadingOut = null;
    }

    const voice = this.activeVoice;
    if (!voice) return;

    // Advance loop(s): for looping themes, roll forward whenever the current
    // loop has ended. The gap between loops is 0 (seamless).
    while (now >= voice.loopStartAt + voice.loopDurSec) {
      if (voice.oneShot) {
        this.activeVoice = null;
        return; // one-shot themes stop after their single pass
      }
      voice.loopStartAt += voice.loopDurSec;
      voice.nextEventIdx = 0;
    }

    const lookaheadEnd = now + TUNING.audio.schedulerLookaheadSec;

    while (voice.nextEventIdx < voice.schedule.length) {
      const ev = voice.schedule[voice.nextEventIdx];
      if (ev.at > lookaheadEnd) break;
      if (ev.at >= now - 0.02) { // small tolerance for slightly-past notes
        this.scheduleNote(voice, ev.note, Math.max(ev.at, now));
      }
      voice.nextEventIdx++;
    }
  }

  private scheduleNote(voice: Voice, note: NoteEvent, atTime: number): void {
    const ctx = this.audio.audioContext!;
    const bpm = THEMES[voice.theme].bpm;
    const durSec = Math.max(0.03, (note.durationBeats * 60) / bpm);

    if (note.channel === "noise-hat") {
      this.playNoiseHat(ctx, voice.channelGains["noise-hat"], atTime, durSec);
      return;
    }

    const osc = ctx.createOscillator();
    osc.type = note.channel === "lead" ? "square" : "sawtooth";
    osc.frequency.value = midiToFreq(note.midiNote);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, atTime);
    env.gain.linearRampToValueAtTime(1, atTime + 0.01); // fast attack
    env.gain.exponentialRampToValueAtTime(0.0001, atTime + durSec);

    osc.connect(env).connect(voice.channelGains[note.channel]);
    osc.start(atTime);
    osc.stop(atTime + durSec + 0.05);
  }

  private playNoiseHat(ctx: AudioContext, dest: GainNode, atTime: number, durSec: number): void {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 6000;
    filter.Q.value = 1.5;

    const env = ctx.createGain();
    env.gain.setValueAtTime(1, atTime);
    env.gain.exponentialRampToValueAtTime(0.0001, atTime + durSec);

    src.connect(filter).connect(env).connect(dest);
    src.start(atTime);
  }
}
