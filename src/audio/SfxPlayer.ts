import { TUNING } from "../data/tuning.js";
import type { ShellKind } from "../items/ShellProjectile.js";
import type { AudioManager } from "./AudioManager.js";

/**
 * Synthesized SFX catalog (Phase 6, no asset files). Every sound is a small
 * oscillator / noise source + gain envelope routed to the sfx bus. Every method
 * silently no-ops when audio has not been unlocked yet — so unit/e2e runs never
 * throw. Continuous voices (engine loop, star shimmer) are started/stopped as a
 * pair and cleaned up in {@link dispose}.
 */

/**
 * Pure mapping for the engine hum: speedRatio 0→1 maps to ~80 Hz → ~240 Hz with a
 * gentle power curve so low speeds feel heavy. Monotonic non-decreasing — exported
 * for unit tests (T17).
 */
export function enginePitchFor(speedRatio: number): number {
  const r = Math.min(1, Math.max(0, speedRatio));
  return TUNING.audio.enginePitchMinHz + (TUNING.audio.enginePitchMaxHz - TUNING.audio.enginePitchMinHz) * Math.pow(r, 1.5);
}

interface ContinuousVoice {
  readonly osc: OscillatorNode;
  readonly lfo?: OscillatorNode;
  /** Gain node driving the LFO into osc.frequency (engine wobble depth). */
  readonly lfoGain?: GainNode;
  readonly gain: GainNode;
}

export class SfxPlayer {
  /** Live continuous voices (engine loop / star shimmer) so they can be stopped. */
  private engine: ContinuousVoice | null = null;
  private star: ContinuousVoice | null = null;

  constructor(private readonly audio: AudioManager) {}

  // ---------------------------------------------------------------------------
  // UI + countdown
  // ---------------------------------------------------------------------------

  uiClick(): void {
    this.blip("square", 880, 0.06, 0.3);
  }

  /** Countdown tick beep; `final=true` plays the triple-beep + GO horn. */
  countdownBeep(final: boolean): void {
    if (!this.dest()) return;
    if (final) {
      // Three quick rising beeps, then the horn — the classic "3-2-1-GO" payoff.
      this.blip("sine", 440, 0.12, 0.25);
      this.blipAt("sine", 554, 0.12, 0.25, 0.13);
      this.blipAt("sine", 659, 0.18, 0.28, 0.26);
      this.goHorn();
    } else {
      this.blip("sine", 440, 0.15, 0.25);
    }
  }

  private goHorn(): void {
    this.blip("sawtooth", 660, 0.5, 0.3);
  }

  // ---------------------------------------------------------------------------
  // Items + weapons
  // ---------------------------------------------------------------------------

  /** Rising arpeggio (C5 E5 G5 C6) — the "got an item" chime. */
  itemPickup(): void {
    const notes = [72, 76, 79, 84];
    notes.forEach((n, i) => this.blipAt("square", midi(n), 0.12, 0.22, i * 0.05));
  }

  /** Whoosh — a band-passed noise sweep rising in frequency (shroom boost). */
  shroomBoost(): void {
    const d = this.dest();
    if (!d) return;
    const { ctx, out } = d;
    const t0 = ctx.currentTime;
    const dur = 0.45;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t0);
    bp.frequency.exponentialRampToValueAtTime(6000, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(gain).connect(out);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** Short, quiet whoosh for drift mini/super turbo (vs the louder shroomBoost). */
  driftWhoosh(): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const dur = 0.25;
    const src = d.ctx.createBufferSource();
    src.buffer = this.noise(d.ctx, dur);
    const bp = d.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t0);
    bp.frequency.exponentialRampToValueAtTime(4500, t0 + dur);
    const gain = d.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(gain).connect(d.out);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** Shell launch — a short punchy blip; pitch rises with shell tier. */
  shellFire(kind: ShellKind): void {
    const freq = kind === "green" ? 320 : kind === "red" ? 440 : 580;
    this.blip("square", freq, 0.14, 0.3);
    // A tiny noise snap on top sells the "pop".
    const d = this.dest();
    if (d) {
      const t0 = d.ctx.currentTime;
      const src = d.ctx.createBufferSource();
      src.buffer = this.noise(d.ctx, 0.06);
      const g = d.ctx.createGain();
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      src.connect(g).connect(d.out);
      src.start(t0);
    }
  }

  /** Shell ricochet off a wall — quick low thud. */
  shellBounce(): void {
    this.blip("triangle", 180, 0.09, 0.25);
  }

  /** Shell impact — noise burst + falling sine (the "thunk"). */
  shellHit(): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const src = d.ctx.createBufferSource();
    src.buffer = this.noise(d.ctx, 0.18);
    const lp = d.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = d.ctx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    src.connect(lp).connect(g).connect(d.out);
    src.start(t0);
    this.blip("sine", 120, 0.16, 0.4);
  }

  /** Banana slip — a descending wobble (the "skrrt"). */
  bananaSkid(): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const dur = 0.35;
    const osc = d.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(700, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    // Fast vibrato for the wobble.
    const lfo = d.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 24;
    const lfoGain = d.ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = d.ctx.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(d.out);
    lfo.start(t0);
    osc.start(t0);
    lfo.stop(t0 + dur);
    osc.stop(t0 + dur);
  }

  /** Star power-up — start a shimmering high arpeggio loop (stop with stopStarLoop). */
  starActivate(): void {
    this.stopStarLoop(); // idempotent — replace any existing shimmer
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const osc = d.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = midi(96); // C7 — bright
    // Shimmer: a fast tremolo on the gain + a slow frequency wobble.
    const lfo = d.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 18;
    const lfoGain = d.ctx.createGain();
    lfoGain.gain.value = 0.5; // tremolo depth (gain oscillates 0..1)
    const gain = d.ctx.createGain();
    gain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(gain.gain);
    osc.connect(gain).connect(d.out);
    lfo.start(t0);
    osc.start(t0);
    this.star = { osc, lfo, gain };
  }

  /** Stop the star shimmer loop (no-op if not active). */
  stopStarLoop(): void {
    const v = this.star;
    this.star = null;
    if (!v) return;
    try {
      v.osc.stop();
      v.lfo?.stop();
      v.gain.disconnect();
      v.lfo?.disconnect();
    } catch { /* already stopped */ }
  }

  /** Lightning — a white-noise crack + low sine thump. */
  lightningZap(): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const src = d.ctx.createBufferSource();
    src.buffer = this.noise(d.ctx, 0.25);
    const hp = d.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const g = d.ctx.createGain();
    g.gain.setValueAtTime(0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    src.connect(hp).connect(g).connect(d.out);
    src.start(t0);
    this.blip("sine", 70, 0.3, 0.5); // low thump
  }

  /** Bullet Bill launch — a descending growl (the "vroom"). */
  bulletBillLaunch(): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const dur = 0.5;
    const osc = d.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const g = d.ctx.createGain();
    g.gain.setValueAtTime(0.35, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(d.out);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  // ---------------------------------------------------------------------------
  // Engine loop (continuous) — driven per-frame from the player kart state.
  // ---------------------------------------------------------------------------

  /** Start the continuous engine hum on race:start. */
  startEngineLoop(): void {
    this.stopEngineLoop(); // idempotent
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime;
    const osc = d.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = enginePitchFor(0);
    // Mechanical wobble (±TUNING.audio.engineLfoDepthPct %).
    const lfo = d.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 11;
    const lfoGain = d.ctx.createGain();
    lfoGain.gain.value = enginePitchFor(0) * (TUNING.audio.engineLfoDepthPct / 100);
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = d.ctx.createGain();
    gain.gain.value = 0.0; // ramped up in updateEngineLoop
    osc.connect(gain).connect(d.out);
    lfo.start(t0);
    osc.start(t0);
    this.engine = { osc, lfo, lfoGain, gain };
  }

  /** Per-frame: retune the engine hum to the player's speed + throttle. */
  updateEngineLoop(speedRatio: number, throttle: number): void {
    const v = this.engine;
    if (!v) return;
    const ctx = this.audio.audioContext;
    if (!ctx) return;
    const now = ctx.currentTime;
    const pitch = enginePitchFor(speedRatio);
    // Smooth the frequency change to avoid zipper noise.
    v.osc.frequency.setTargetAtTime(pitch, now, 0.05);
    if (v.lfo && v.lfoGain) {
      v.lfoGain.gain.setTargetAtTime(pitch * (TUNING.audio.engineLfoDepthPct / 100), now, 0.05);
    }
    // Louder under throttle; a floor so idle still hums.
    const target = 0.08 + 0.22 * Math.min(1, Math.max(0, throttle));
    v.gain.gain.setTargetAtTime(target, now, 0.05);
  }

  /** Stop the engine loop (results screen / quit). */
  stopEngineLoop(): void {
    const v = this.engine;
    this.engine = null;
    if (!v) return;
    try {
      v.osc.stop();
      v.lfo?.stop();
      v.gain.disconnect();
      v.lfo?.disconnect();
    } catch { /* already stopped */ }
  }

  /** Stop every continuous voice (quit-to-menu / dispose). */
  dispose(): void {
    this.stopEngineLoop();
    this.stopStarLoop();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private dest(): { ctx: AudioContext; out: AudioNode } | null {
    const ctx = this.audio.audioContext;
    if (!ctx || !this.audio.isUnlocked) return null;
    return { ctx, out: this.audio.sfxDestination ?? ctx.destination };
  }

  /** Oscillator + linear gain envelope (peak -> 0) starting now. */
  private blip(type: OscillatorType, freqHz: number, duration: number, peakGain: number): void {
    const d = this.dest();
    if (!d) return;
    this.blipAt(type, freqHz, duration, peakGain, 0);
  }

  /** Like {@link blip} but scheduled `delay` seconds from now. */
  private blipAt(type: OscillatorType, freqHz: number, duration: number, peakGain: number, delay: number): void {
    const d = this.dest();
    if (!d) return;
    const t0 = d.ctx.currentTime + delay;
    const osc = d.ctx.createOscillator();
    const gain = d.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(peakGain, t0);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(d.out);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  /** A short white-noise buffer (created per call — cheap at these lengths). */
  private noise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}

/** MIDI note number → frequency in Hz. */
function midi(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
