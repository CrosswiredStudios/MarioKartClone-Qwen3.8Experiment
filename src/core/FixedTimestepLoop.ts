/**
 * Fixed-timestep update loop.
 *
 * All game logic runs at a deterministic `step` interval (default 1/60 s)
 * regardless of the display refresh rate, using an accumulator so that slow
 * frames catch up with multiple steps and fast frames interpolate cleanly.
 * Rendering happens once per animation frame via `onRender`.
 */

export interface FixedTimestepLoopOptions {
  /** Logic step duration in seconds. Default: 1/60. */
  readonly step?: number;
  /** Maximum accumulated time (seconds) to avoid the "spiral of death". Default: 0.25. */
  readonly maxAccumulator?: number;
}

export class FixedTimestepLoop {
  private readonly _step: number;
  private readonly _maxAccumulator: number;
  private _accumulator = 0;
  private _lastTime: number | null = null;
  private _running = false;
  private _rafId: number | null = null;

  constructor(
    private readonly onUpdate: (dt: number) => void,
    private readonly onRender: (alpha: number) => void,
    options: FixedTimestepLoopOptions = {},
  ) {
    this._step = options.step ?? 1 / 60;
    this._maxAccumulator = options.maxAccumulator ?? 0.25;
  }

  get step(): number {
    return this._step;
  }

  get isRunning(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._lastTime = null;
    const tick = (timeMs: number): void => {
      if (!this._running) return;
      this._frame(timeMs / 1000);
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Advances the simulation by `elapsedSeconds` of wall-clock time. Exposed for tests. */
  advance(elapsedSeconds: number): void {
    if (this._lastTime === null) {
      this._lastTime = elapsedSeconds;
      return;
    }
    let frameTime = elapsedSeconds - this._lastTime;
    this._lastTime = elapsedSeconds;
    if (frameTime < 0) frameTime = 0;
    if (frameTime > this._maxAccumulator) frameTime = this._maxAccumulator;

    this._accumulator += frameTime;
    while (this._accumulator >= this._step) {
      try {
        this.onUpdate(this._step);
      } catch (err) {
        // Contain logic errors: an exception escaping onUpdate would propagate out of
        // the rAF callback and prevent re-arming — permanently freezing the game
        // (this is how a MusicSequencer TypeError once killed the whole race). Log
        // loudly but keep stepping so one bad frame can't end the session.
        this._errorsLogged += 1;
        if (this._errorsLogged <= 3) {
          console.error(`[FixedTimestepLoop] onUpdate threw — contained, loop continues (#${this._errorsLogged})`, err);
        } else if (this._errorsLogged === 4) {
          console.warn("[FixedTimestepLoop] further onUpdate errors suppressed to avoid spam.");
        }
      }
      this._accumulator -= this._step;
    }
    this.onRender(this._accumulator / this._step);
  }

  /** Count of contained onUpdate errors (log-spam guard). */
  private _errorsLogged = 0;

  private _frame(timeSeconds: number): void {
    this.advance(timeSeconds);
  }
}
