/**
 * WebAudio graph owner. The AudioContext is created lazily on the first user
 * gesture (browser autoplay policy) — see {@link unlock}. All buses route to a
 * single master gain so mute/volume changes apply in one place.
 */
export class AudioManager {
  private ctx: AudioContext | null = null; // created lazily — autoplay policy
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private muted = false;

  /** Must be called from a user gesture (click/keydown). Idempotent. */
  unlock(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.applyGains();
  }

  get isUnlocked(): boolean {
    return this.ctx !== null;
  }

  /** The underlying context, or null before {@link unlock}. */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** SFX routing point — null until {@link unlock}, so players can no-op safely. */
  get sfxDestination(): AudioNode | null {
    return this.ctx ? this.sfxBus : null;
  }

  /** Music routing point (used by the Phase 6 MusicSequencer). */
  get musicDestination(): AudioNode | null {
    return this.ctx ? this.musicBus : null;
  }

  setVolume(bus: "master" | "music" | "sfx", v01: number): void {
    const clamped = Math.min(1, Math.max(0, v01));
    if (!this.ctx) return; // store nothing — gains are created in unlock()
    this.gainFor(bus).gain.value = bus === "master" && this.muted ? 0 : clamped;
  }

  mute(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.applyGains();
  }

  private gainFor(bus: "master" | "music" | "sfx"): GainNode {
    return bus === "master" ? this.master : bus === "music" ? this.musicBus : this.sfxBus;
  }

  /** Master gain is forced to 0 while muted, regardless of its volume setting. */
  private applyGains(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
  }
}
