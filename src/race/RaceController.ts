/**
 * RaceController — owns the full race lifecycle inside Countdown→Racing (Phase 4).
 *
 * Pure logic + event emission; NO Babylon imports, so it runs headless in unit tests.
 * The render layer (HUD, karts, camera) subscribes to `race:*` events and reads
 * {@link standings}/{@link karts} — the controller never touches DOM or audio directly
 * except the optional music theme when `renderEnabled`.
 *
 * Per-step order while racing (06-phase-4-race-loop-and-ai.md, Step 4):
 *   input → AI decide → rubber-band → physics → drift → lap tracking → standings(1 Hz) → finish.
 */

import { TUNING } from "../data/tuning.js";
import { CHARACTER_ROSTER } from "../data/characters.js";
import { combinedStats } from "../data/vehicles.js";
import type { RaceConfig } from "../core/RaceConfig.js";
import type { Rng } from "../core/Rng.js";
import type { EventBus, GameEvents } from "../core/EventBus.js";
import type { IInputSource } from "../input/IInputSource.js";
import type { TrackDefinition } from "../data/tracks/shared.js";
import type { TrackSpline } from "../tracks/TrackSpline.js";
import { createKart, type KartEntity } from "../entities/KartEntity.js";
import { stepKart, type DriveInput, type ItemId, type SurfaceKind } from "../entities/KartPhysics.js";
import { makeHeightField, type HeightField } from "../tracks/TrackElevation.js";
import { updateDrift } from "../entities/DriftController.js";
import { onCheckpoint } from "../tracks/LapTracker.js";
import { computeStandings } from "./StandingsCalculator.js";
import { rubberBandMultiplier, WaypointAiStrategy } from "../entities/WaypointAiStrategy.js";
import type { IAiStrategy } from "../entities/IAiStrategy.js";
import { PlayerController } from "../entities/PlayerController.js";
import { getItemEffect, type RaceContext } from "../items/IItemEffect.js";
import { makeShell, stepShell, type ShellState } from "../items/ShellProjectile.js";
import { ItemBoxSpawner, type ItemBox } from "../items/ItemBoxSpawner.js";

/** Fixed AI vehicle table (06-phase-4 Step 2). Content, not tuning. */
const AI_VEHICLE_TABLE: Readonly<Record<string, string>> = {
  louie: "zippy",
  pearl: "basher",
  terry: "quadzilla",
  // marvin is the balanced all-rounder; when he's an opponent (player picked someone else)
  // he rides the neutral kart. The plan lists only the three non-martin characters because
  // marvin is usually the player — this default keeps the field complete for any pick.
  marvin: "basher",
};

/**
 * Grid slots [lateralOffset, longitudinal-behind] for the RACE (Phase 4).
 *
 * AS-BUILT DEVIATION from the Phase 3 free-drive grid: every slot is shifted ~1 m
 * further BEHIND the line so that ALL karts — including the player in slot 0 — spawn
 * just behind the start/finish line. The LapTracker's sentinel design (lastCheckpointIdx
 * = -1) requires a kart to CROSS cp0 (the line) as its first real checkpoint; a kart
 * spawned exactly ON the line leaves it without crossing, so its checkpoint sequence only
 * re-aligns after an extra full loop — i.e. it would count "lap 1" one physical lap late.
 * Shifting slot 0 to -1 m (t≈0.996) makes the player cross cp0 immediately like the AIs,
 * so all four karts count laps identically from the start.
 */
const GRID_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [-2.5, -1], // slot 1 — player (just behind the line)
  [2.5, -5],
  [-2.5, -9],
  [2.5, -13],
];

/**
 * Items the player can hold-to-charge (green/red shell, banana): the item "loads"
 * on the kart's rear while the button is held and fires on release. The blue shell
 * is NOT chargeable — it targets the leader from anywhere, so there's no aiming
 * value in holding it; it fires on the press edge like the other instant items.
 */
function isChargeableItem(item: ItemId): boolean {
  return item === "greenShell" || item === "redShell" || item === "banana";
}

export interface AiRacerDef {
  readonly characterId: string;
  readonly vehicleId: string;
}

export interface RaceOptions {
  config: RaceConfig;
  track: TrackDefinition;
  spline: TrackSpline;
  bus: EventBus<GameEvents>;
  rng: Rng; // createRng(seed) — NEVER Math.random() (architecture §9)
  input?: IInputSource; // required when renderEnabled !== false and not headless-AI-driven
  aiFactory?: (def: AiRacerDef) => IAiStrategy;
  /** false → headless: no HUD/audio/renderer side effects. */
  renderEnabled?: boolean;
}

export interface FinalStanding {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
  readonly totalMs: number | null; // null = DNF / timed out before finishing lap 3
}

interface KartRuntime {
  lastT: number; // closestPoint t at end of previous step (for crossing detection)
  lapClock: number; // sim time of the kart's most recent lap boundary (or race start)
  finished: boolean;
}

export type RacePhase = "countdown" | "racing" | "finished";

export class RaceController {
  /** The frozen race config this controller was built from (render layer reads mapId). */
  readonly config: RaceConfig;
  private readonly track: TrackDefinition;
  private readonly splineRef: TrackSpline;
  private readonly bus: EventBus<GameEvents>;
  private readonly renderEnabled: boolean;

  private readonly racers: KartEntity[] = [];
  private readonly player: KartEntity;
  private readonly runtime = new Map<string, KartRuntime>();
  private readonly aiStrategies = new Map<string, IAiStrategy>();
  private readonly oilSlicks: ReadonlyArray<{ x: number; z: number; radius: number }>;
  /** Seeded RNG — shared with the item spawner; used for shell-hit heading kicks. */
  private readonly rng: Rng;

  // ── Phase 5 item state (all mutated only inside update) ────────────────────────
  /** Live shells in the world. Stepped each frame in spawn order (determinism). */
  private readonly shellStates: ShellState[] = [];
  /** Dropped bananas: { pos, expiresAt }. Picked up on proximity; expire after 30 s. */
  private readonly bananas: Array<{ x: number; z: number; expiresAt: number }> = [];
  /** Item box spawner (one box per cluster anchor). */
  private readonly itemSpawner: ItemBoxSpawner;

  /** Player input source (null in headless mode → player is AI-driven for determinism). */
  private readonly playerController: PlayerController | null;
  private readonly playerAi: WaypointAiStrategy | null;

  // ── Step 12 debug hook: runtime switch to waypoint-AI driving of the player kart. ──
  /** When set, the player kart's DriveInput comes from this strategy instead of keyboard. */
  private aiDriveStrategy: WaypointAiStrategy | null = null;

  // ── mutable race state ────────────────────────────────────────────────
  private _phase: RacePhase = "countdown";
  private simTime = 0; // running seconds (all phases)
  private countdownTimer = 0;
  private nextTickRemaining = TUNING.race.countdownSeconds as number; // 3 → emits {3},{2},{1}
  private tickBoundary = 0;
  private raceStartTime = 0; // simTime when phase became "racing"
  private standingsTimer = 0;
  private standingsSnapshot: ReadonlyArray<{ id: string; rank: number }> = [];
  private aiGraceDeadline: number | null = null;

  /** Total time (ms) for each kart that completed lap 3. */
  private readonly finishedTotalMs = new Map<string, number>();
  /** The player's per-lap times in ms (HUD best-lap + Results screen). */
  private readonly playerLaps: number[] = [];
  private finalStandingsResult: FinalStanding[] | null = null;

  // ── Phase 7 finish-out state ────────────────────────────────────────────────
  /** True once the player crossed the line on the last lap (spectator mode armed). */
  private playerFinished = false;
  /**
   * Waypoint driver for the player kart after they finish. Created lazily so a
   * render-mode race (which has no headless `playerAi`) gets one only when needed.
   * Plain strategy, NO RNG — determinism is preserved.
   */
  private spectatorAi: WaypointAiStrategy | null = null;
  /** One-shot guard for the perfect-start boost award. */
  private startBoostAwarded = false;

  /** Pure heightfield — single source of truth for kart Y + the slope model. */
  readonly terrain: HeightField;

  constructor(opts: RaceOptions) {
    this.config = opts.config;
    this.track = opts.track;
    this.splineRef = opts.spline;
    this.bus = opts.bus;
    this.rng = opts.rng;
    this.renderEnabled = opts.renderEnabled ?? true;
    this.terrain = makeHeightField(opts.spline, opts.track);

    // Precompute static oil-slick world positions (Lagoon hazards).
    this.oilSlicks = opts.track.hazards
      .filter((h) => h.kind === "oilSlick")
      .map((h) => {
        const c = hazardWorldPos(opts.spline, h.t, h.lateralOffset);
        return { x: c.x, z: c.z, radius: h.size };
      });

    // Phase 5 — item box spawner (one rotating box per cluster anchor).
    this.itemSpawner = new ItemBoxSpawner(opts.track, opts.spline, this.bus, opts.rng);

    // ── build the 4 karts: player + 3 AI (other roster characters) ────────
    const cfg = opts.config;
    const me = CHARACTER_ROSTER.find((c) => c.id === cfg.characterId) ?? CHARACTER_ROSTER[0];
    const myStats = combinedStats(cfg.characterId, cfg.vehicleId);

    this.player = createKart({
      id: "player",
      name: me.name,
      isPlayer: true,
      color: me.color,
      pos: gridPos(this.terrain, opts.spline, GRID_SLOTS[0]),
      heading: gridHeading(opts.spline),
      profile: { topSpeedStat: myStats.topSpeed, accelStat: myStats.accel },
    });
    this.racers.push(this.player);

    const others = CHARACTER_ROSTER.filter((c) => c.id !== cfg.characterId).slice(0, 3);
    for (let i = 0; i < others.length; i++) {
      const ch = others[i];
      const vehicleId = AI_VEHICLE_TABLE[ch.id] ?? "basher";
      const stats = combinedStats(ch.id, vehicleId);
      // Seeded skill factor → topSpeedScale (determinism: same seed → same field).
      const skill = 1 + opts.rng.range(-TUNING.ai.speedVariance, TUNING.ai.speedVariance);
      const kart = createKart({
        id: ch.id, // AI karts are keyed by their characterId (architecture §4)
        name: ch.name,
        isPlayer: false,
        color: ch.color,
        pos: gridPos(this.terrain, opts.spline, GRID_SLOTS[i + 1]),
        heading: gridHeading(opts.spline),
        profile: { topSpeedStat: stats.topSpeed, accelStat: stats.accel },
        topSpeedScale: skill,
      });
      this.racers.push(kart);

      const def: AiRacerDef = { characterId: ch.id, vehicleId };
      this.aiStrategies.set(ch.id, opts.aiFactory ? opts.aiFactory(def) : new WaypointAiStrategy(opts.spline));
    }

    // Player input: real controller when an IInputSource is provided; otherwise the
    // player kart is driven by the same waypoint strategy as the AI (headless determinism).
    this.playerController = opts.input ? new PlayerController(opts.input) : null;
    this.playerAi = this.playerController ? null : new WaypointAiStrategy(opts.spline);

    // Initialize per-kart runtime: lastT from spawn, lapClock set at race start.
    for (const k of this.racers) {
      const t0 = opts.spline.closestPoint({ x: k.state.pos.x, z: k.state.pos.z }).t;
      this.runtime.set(k.id, { lastT: t0, lapClock: 0, finished: false });
    }

    // Initial standings snapshot so the HUD has something before the first 1 Hz tick.
    this.standingsSnapshot = computeStandings(this.racers, opts.spline);
  }

  get phase(): RacePhase {
    return this._phase;
  }

  /** Phase 7 (finish-out): true once the player has crossed the line on the last lap. */
  get isPlayerFinished(): boolean {
    return this.playerFinished;
  }

  /** Total laps for the current track (HUD "LAP n/total", Results). */
  get totalLaps(): number {
    return this.track.laps;
  }

  /** The track's spline — read-only geometry source for the HUD minimap (Step 9). */
  get spline(): TrackSpline {
    return this.splineRef;
  }

  /** The track definition (theme colors, roadWidth) for the HUD minimap (Step 9). */
  get trackDef(): TrackDefinition {
    return this.track;
  }

  /** The player's completed lap times in ms, in completion order (HUD best-lap + Results). */
  playerLapTimes(): ReadonlyArray<number> {
    return [...this.playerLaps];
  }

  /** Elapsed time of the player's CURRENT lap in ms (since last boundary / race start). */
  playerCurrentLapMs(): number {
    const rt = this.runtime.get("player");
    if (!rt) return 0;
    return Math.max(0, Math.round((this.simTime - rt.lapClock) * 1000));
  }

  /** One fixed logic step (dt = 1/60). Called by GameApp or manually in headless tests. */
  update(dt: number): void {
    if (this._phase === "finished") return; // race over — no further stepping
    this.simTime += dt;

    if (this._phase === "countdown") {
      this.updateCountdown(dt);
      return;
    }
    this.updateRacing(dt);
  }

  /** Live standings enriched with name/lap/t for the HUD and debug handle. */
  standings(): Array<{ id: string; name: string; rank: number; lap: number; t: number }> {
    const byId = new Map(this.racers.map((k) => [k.id, k]));
    return this.standingsSnapshot.map((row) => {
      const k = byId.get(row.id)!;
      const t = this.splineRef.closestPoint({ x: k.state.pos.x, z: k.state.pos.z }).t;
      return { id: row.id, name: k.name, rank: row.rank, lap: k.state.lap + 1, t };
    });
  }

  /** All four kart entities (render layer reads positions from here). */
  karts(): ReadonlyArray<KartEntity> {
    return this.racers;
  }

  /** Item boxes for the render layer (spinning box visuals at cluster anchors). */
  itemBoxes(): ReadonlyArray<ItemBox> {
    return this.itemSpawner.boxes();
  }

  /** Live shells in the world (render layer mirrors positions; logic owns state). */
  shells(): ReadonlyArray<ShellState> {
    return this.shellStates;
  }

  /**
   * Debug hook (e2e / manual playtest): force the player's held item. main.ts only
   * exposes this when debugAllowed. Clears any in-flight charge so the new item
   * starts uncharged.
   */
  debugSetPlayerItem(item: ItemId): void {
    this.player.state.item = item;
    this.player.state.charging = null;
  }

  /** Final standings with total times (null = DNF). Populated once the race finishes. */
  finalStandings(): FinalStanding[] | null {
    return this.finalStandingsResult;
  }

  /** Phase 7 (finish-out): the kart's total time in ms if it has finished, else null. */
  finishTimeMs(id: string): number | null {
    return this.finishedTotalMs.get(id) ?? null;
  }

  /**
   * Step 12 debug hook: switch the player kart to waypoint-AI driving.
   * Called by window.__game.aiDrivePlayer() (e2e) or auto-enabled when
   * localStorage "ttr.debugAIDrive" === "1" at race build time.
   */
  enableAiDrive(): void {
    if (!this.aiDriveStrategy) {
      this.aiDriveStrategy = new WaypointAiStrategy(this.splineRef);
    }
  }

  /**
   * Phase 7 (finish-out): the player clicked Skip on the live results overlay.
   * Immediately finalizes the race — karts that haven't crossed the line become DNFs
   * (`totalMs: null`) and `race:finished` fires right away, jumping to the podium.
   * No-op unless we're mid-finish-out (racing phase AND player already finished).
   */
  skipFinishOut(): void {
    if (this._phase !== "racing" || !this.playerFinished) return;
    this.finalizeStandings();
  }

  // ── countdown phase ───────────────────────────────────────────────────
  private updateCountdown(dt: number): void {
    this.countdownTimer += dt;
    while (this.nextTickRemaining > 0 && this.countdownTimer >= this.tickBoundary) {
      const remaining = this.nextTickRemaining as 3 | 2 | 1;
      this.bus.emit("race:countdownTick", { remaining });
      this.nextTickRemaining--;
      this.tickBoundary += 1;
    }
    if (this.countdownTimer >= TUNING.race.countdownSeconds) {
      this._phase = "racing";
      this.raceStartTime = this.simTime;
      for (const k of this.racers) this.runtime.get(k.id)!.lapClock = this.raceStartTime;
      this.bus.emit("race:start", {});
      if (this.renderEnabled) this.playRaceTheme();
    }
  }

  // ── racing phase: the exact per-step order from Step 4 ────────────────
  private updateRacing(dt: number): void {
    const view = { standings: this.racers.map((k) => ({ id: k.id, lap: k.state.lap, progress: 0 })) };

    // (1)+(2) Inputs: player then each AI.
    const inputs = new Map<string, DriveInput>();
    // Phase 7 (finish-out): once the player has finished they are driven by a plain
    // waypoint strategy so the field keeps racing while the spectator view plays out.
    if (this.playerFinished) {
      this.spectatorAi ??= new WaypointAiStrategy(this.splineRef);
      inputs.set("player", this.spectatorAi.decide(this.player, view, dt));
    } else {
      // Step 12: when aiDriveStrategy is active it takes priority over keyboard input.
      const playerInput = this.aiDriveStrategy
        ? this.aiDriveStrategy.decide(this.player, view, dt)
        : (this.playerController ? this.playerController.read() : this.playerAi!.decide(this.player, view, dt));
      inputs.set("player", playerInput);
    }

    // Phase 7 — perfect start: gas pressed within the window after GO grants a one-shot
    // boost. Checked on the input already computed for THIS step (held-key reads are
    // level-triggered, so holding W through GO works). Awarded before physics so the
    // very first racing step already runs at boost speed.
    if (!this.startBoostAwarded && this.simTime - this.raceStartTime < TUNING.race.perfectStartWindowSec) {
      const pInput = inputs.get("player")!;
      if (pInput.throttle > 0) {
        this.startBoostAwarded = true;
        this.player.state.statusEffects.push({
          kind: "boost",
          speed: TUNING.race.startBoostSpeed,
          remaining: TUNING.race.startBoostDurationSec,
        });
        this.bus.emit("kart:boosted", { kartId: "player", tier: "start" });
      }
    }
    for (const k of this.racers) {
      if (k.isPlayer) continue;
      inputs.set(k.id, this.aiStrategies.get(k.id)!.decide(k, view, dt));
    }

    // (3) Rubber-band: recompute each AI's accelScale from its gap to the player.
    const playerProgress = this.progressM(this.player);
    for (const k of this.racers) {
      if (k.isPlayer) continue;
      const gap = playerProgress - this.progressM(k); // >0 → AI behind player
      k.accelScale = rubberBandMultiplier(gap);
    }

    // (4)+(5)+(6) Physics + drift + lap tracking, per kart.
    for (const k of this.racers) {
      const input = inputs.get(k.id)!;
      const rt = this.runtime.get(k.id)!;

      // Surface from the CURRENT position (pre-step).
      const surface = this.classifySurface({ x: k.state.pos.x, z: k.state.pos.z });

      // Physics step (pure) with the kart's skill + rubber-band scales + terrain
      // (surface-glued Y and the mild slope speed model).
      let next = stepKart(k.state, input, surface, dt, k.topSpeedScale, k.accelScale, this.terrain);

      // Drift charge; on release grant the mini/super boost (same path as free-drive).
      const drift = updateDrift(next.driftCharge, input, dt);
      if (drift.releasedBoost) {
        const boostSpeed = drift.releasedBoost === "super" ? TUNING.drift.superBoostSpeed : TUNING.drift.miniBoostSpeed;
        next = {
          ...next,
          statusEffects: [...next.statusEffects, { kind: "boost", speed: boostSpeed, remaining: TUNING.drift.boostDuration }],
        };
        // Phase 6 (render-only): emit the same event shroom boosts use so VFX/SFX can
        // react to drift turbo. Purely observational — no physics/RNG impact, so the
        // headless determinism gate is unaffected.
        this.bus.emit("kart:boosted", { kartId: k.id, tier: drift.releasedBoost });
      }
      next = { ...next, driftCharge: drift.charge };

      // Lap tracking from the NEW position (builds on top of `next`, preserving physics).
      const cpPost = this.splineRef.closestPoint({ x: next.pos.x, z: next.pos.z });
      next = this.trackLaps(k, rt, next, rt.lastT, cpPost.t);

      k.state = next;
      rt.lastT = cpPost.t;

      // Phase 5 — oil slick: grant a skid on FIRST contact per patch (per-patch guard).
      if (surface === "oilSlick") {
        const patchId = this.oilPatchIndexAt({ x: k.state.pos.x, z: k.state.pos.z });
        if (patchId !== -1 && k.lastOilPatchId !== patchId) {
          k.lastOilPatchId = patchId;
          k.state.statusEffects.push({ kind: "skid", remaining: TUNING.items.oilSkidSec });
          this.bus.emit("kart:skid", { kartId: k.id, cause: "oilSlick" });
        }
      }
    }

    // (6) Phase 5 item pipeline — use items → step shells → bullet hits → bananas → boxes.
    this.updateItems(dt, inputs);

    // (7) Standings — recompute once per second, not every frame.
    this.standingsTimer += dt;
    if (this.standingsTimer >= TUNING.race.standingsIntervalSec) {
      this.standingsTimer -= TUNING.race.standingsIntervalSec;
      this.standingsSnapshot = computeStandings(this.racers, this.splineRef);
    }

    // (8) Finish condition.
    this.checkFinish();
  }

  /** Feed crossed checkpoints to the LapTracker and record lap times / finish. */
  private trackLaps(kart: KartEntity, rt: KartRuntime, base: typeof kart.state, prevT: number, newT: number): typeof kart.state {
    let state = base; // build on top of the post-physics state (preserves speed/pos)
    const totalCp = TUNING.race.checkpointsPerLap;
    const crossed = checkpointsCrossed(prevT, newT, totalCp);
    if (crossed.length > 1) {
      // Anomalous step: a kart covers at most ~0.75 m per fixed 1/60 s step while
      // checkpoints are ~80 m apart, so crossing more than one checkpoint in a single
      // step is physically impossible. It happens when a bullet-bill knockback (negative
      // speed) drags a kart BACKWARD across the start line: closestPoint().t then jumps
      // 0.02 → 0.98, which checkpointsCrossed misreads as forward coverage of cp1..cp7 —
      // priming a spurious lap on the next real line crossing. Discard such steps; the
      // kart's genuine crossings are counted on subsequent normal steps.
      return state;
    }
    for (const cpIdx of crossed) {
      const res = onCheckpoint(
        { lap: state.lap, lastCheckpointIdx: state.checkpointIdx },
        cpIdx,
        totalCp,
        this.track.laps,
      );
      state = { ...state, lap: res.state.lap, checkpointIdx: res.state.lastCheckpointIdx };

      if (res.lapCompleted) {
        const timeMs = Math.round((this.simTime - rt.lapClock) * 1000);
        rt.lapClock = this.simTime;
        if (kart.isPlayer) this.playerLaps.push(timeMs); // HUD best-lap + Results screen
        this.bus.emit("race:lapCompleted", { kartId: kart.id, lap: res.state.lap, timeMs });
      }

      if (res.raceFinished && !rt.finished) {
        rt.finished = true;
        const totalMs = Math.round((this.simTime - this.raceStartTime) * 1000);
        this.finishedTotalMs.set(kart.id, totalMs);
        // The player finishing arms the AI grace deadline.
        if (kart.isPlayer && this.aiGraceDeadline === null) {
          this.aiGraceDeadline = this.simTime + TUNING.race.aiFinishTimeoutSec;
        }
        // Phase 7 (finish-out): the race does NOT end here — it keeps simulating until
        // every kart finishes or the grace deadline passes. This event routes Racing →
        // Results (live overlay) and switches the camera to the wide spectator view.
        if (kart.isPlayer && !this.playerFinished) {
          this.playerFinished = true;
          this.bus.emit("race:playerFinished", {});
        }
      }
    }
    return state;
  }

  /** Finalize when all karts finished or the AI grace deadline passes. */
  private checkFinish(): void {
    const allFinished = this.finishedTotalMs.size === this.racers.length;
    const deadlinePassed = this.aiGraceDeadline !== null && this.simTime >= this.aiGraceDeadline;
    if (!allFinished && !deadlinePassed) return;
    this.finalizeStandings();
  }

  /**
   * Phase 7 (finish-out): build the final standings and emit `race:finished`.
   * Called by {@link checkFinish} (natural end) or {@link skipFinishOut} (player
   * skipped the spectator view). Unfinished karts are DNFs with `totalMs: null`.
   */
  private finalizeStandings(): void {
    // Finishers by total time asc first, then DNF karts by (lap desc, cp desc, t desc), id asc.
    const finishers = this.racers.filter((k) => this.finishedTotalMs.has(k.id));
    const dnfs = this.racers.filter((k) => !this.finishedTotalMs.has(k.id));

    finishers.sort((a, b) => (this.finishedTotalMs.get(a.id)! - this.finishedTotalMs.get(b.id)!));
    dnfs.sort((a, b) => {
      if (a.state.lap !== b.state.lap) return b.state.lap - a.state.lap;
      if (a.state.checkpointIdx !== b.state.checkpointIdx) return b.state.checkpointIdx - a.state.checkpointIdx;
      const ta = this.splineRef.closestPoint({ x: a.state.pos.x, z: a.state.pos.z }).t;
      const tb = this.splineRef.closestPoint({ x: b.state.pos.x, z: b.state.pos.z }).t;
      if (ta !== tb) return tb - ta;
      return a.id < b.id ? -1 : 1;
    });

    const ordered = [...finishers, ...dnfs];
    this.finalStandingsResult = ordered.map((k, i) => ({
      id: k.id,
      name: k.name,
      rank: i + 1,
      totalMs: this.finishedTotalMs.get(k.id) ?? null,
    }));

    const times: Record<string, number> = {};
    for (const [id, ms] of this.finishedTotalMs) times[id] = ms;

    this._phase = "finished";
    this.bus.emit("race:finished", {
      standings: ordered.map((k, i) => ({ id: k.id, rank: i + 1 })),
      times,
    });
  }

  // ── Phase 5 item pipeline (07-phase-5 Step 9) ────────────────────────────────
  /**
   * Runs after physics/drift/lap tracking, before the 1 Hz standings recompute.
   * Order: use items → step shells → bullet-bill rams → banana pickups → box spawner.
   * All mutation happens here (the one legal place) and all randomness via this.rng.
   */
  private updateItems(dt: number, inputs: Map<string, DriveInput>): void {
    const it = TUNING.items;
    const standings = this.standingsSnapshot; // rank 1 first (≤1 s stale — fine for targeting)

    // (a) Use items.
    //   - Chargeable items (green/red shell, banana): the PLAYER holds the item
    //     button to "load" the item on the kart's rear (state.charging); it fires
    //     on release. Blue shell + the rest fire on the press edge.
    //   - AI karts always fire immediately (no charge) — keeps headless
    //     determinism and AI behavior unchanged.
    for (const k of this.racers) {
      if (k.state.item === null) {
        k.state.charging = null; // no item → clear any stale charge
        continue;
      }
      const item = k.state.item;
      const input = inputs.get(k.id)!;

      if (k.isPlayer && isChargeableItem(item)) {
        if (input.itemHeld) {
          k.state.charging = item; // start or continue charging
        } else if (k.state.charging === item) {
          this.fireItem(k, item); // release → launch
          k.state.charging = null;
        }
        continue;
      }

      // Non-chargeable (player, press edge) or AI (immediate).
      const wantsUse = k.isPlayer ? input.useItem : true; // AI: use immediately when holding
      if (!wantsUse) continue;
      this.fireItem(k, item);
    }

    // (b) Step shells in spawn order (deterministic). Apply hit outcomes per result.
    const finishedIds = new Set<string>();
    for (const k of this.racers) if (this.runtime.get(k.id)!.finished) finishedIds.add(k.id);

    if (this.shellStates.length > 0) {
      const survivors: ShellState[] = [];
      for (const shell of this.shellStates) {
        const res = stepShell(shell, this.racers, this.splineRef, dt, { simTime: this.simTime, finishedIds, standings });
        if (res.hit !== undefined) this.applyShellHit(res.hit, shell.ownerId, shell.kind);
        if (!res.removed) survivors.push(res.shell);
      }
      this.shellStates.length = 0;
      this.shellStates.push(...survivors);
    }

    // (c) Bullet-bill rams: a bullet within hit radius knocks the victim back.
    for (const owner of this.racers) {
      if (!this.hasStatus(owner, "bulletBill")) continue;
      for (const other of this.racers) {
        if (other.id === owner.id) continue;
        const dx = other.state.pos.x - owner.state.pos.x;
        const dz = other.state.pos.z - owner.state.pos.z;
        if (dx * dx + dz * dz > it.shellHitRadiusM * it.shellHitRadiusM) continue;

        this.applyBulletHit(other, owner.id);
        this.removeStatus(owner, "bulletBill"); // impact ends the transform immediately
        break; // one victim per bullet per step
      }
    }

    // (d) Banana pickups: first non-bullet kart in range consumes it. Starred → no skid.
    if (this.bananas.length > 0) {
      const survivors: typeof this.bananas = [];
      for (const b of this.bananas) {
        if (this.simTime >= b.expiresAt) continue; // expired — drop silently
        let consumed = false;
        for (const k of this.racers) {
          const dx = k.state.pos.x - b.x;
          const dz = k.state.pos.z - b.z;
          if (dx * dx + dz * dz > it.shellHitRadiusM * it.shellHitRadiusM) continue;
          if (this.hasStatus(k, "bulletBill")) continue; // immune — passes through
          consumed = true;
          if (!this.hasStatus(k, "star")) {
            k.state.statusEffects.push({ kind: "skid", remaining: it.bananaSkid });
            this.bus.emit("kart:skid", { kartId: k.id, cause: "banana" });
          }
          break; // one kart consumes the banana
        }
        if (!consumed) survivors.push(b);
      }
      this.bananas.length = 0;
      this.bananas.push(...survivors);
    }

    // (e) Item box spawner — respawn timers + rank-based pickup rolls.
    this.itemSpawner.update(this.racers, standings, this.simTime, dt);
  }

  /**
   * Consume the kart's current item: apply its effect, clear the slot, emit
   * item:used (+ kart:boosted for shroom). Shared by the press-edge path, the
   * charge-release path, and the AI immediate path.
   */
  private fireItem(k: KartEntity, item: ItemId): void {
    const it = TUNING.items;
    const ctx: RaceContext = {
      owner: k,
      allKarts: this.racersSortedByStandings(),
      spawnProjectile: (p) => {
        if ("kind" in p) this.shellStates.push(makeShell(p, this.simTime)); // BulletBillInit → no world object
      },
      placeBanana: (pos) => this.bananas.push({ x: pos.x, z: pos.z, expiresAt: this.simTime + it.bananaLifetimeSec }),
    };

    const results = getItemEffect(item).apply(ctx);
    k.state.item = null; // consumed on use
    this.bus.emit("item:used", { kartId: k.id, item });
    for (const r of results) {
      if (r.kind === "boost") this.bus.emit("kart:boosted", { kartId: k.id, tier: "shroom" });
    }
  }

  /** Shell struck a kart: starred target deflects (shooter takes the hit), else victim is hit. */
  private applyShellHit(targetId: string, shooterId: string, kind: "green" | "red" | "blue"): void {
    const target = this.racers.find((k) => k.id === targetId);
    if (!target) return;

    // Star invincibility deflects the shell back at its owner.
    if (this.hasStatus(target, "star")) {
      const shooter = this.racers.find((k) => k.id === shooterId);
      if (shooter && !this.hasStatus(shooter, "bulletBill") && !this.hasStatus(shooter, "star")) {
        this.applyHitEffect(shooter, undefined, kind);
      }
      return; // green keeps bouncing (stepShell reflected it); red/blue already consumed
    }

    this.applyHitEffect(target, shooterId, kind);
  }

  /** Apply a shell hit: slow the victim, seeded heading kick, "hit" status, emit kart:hit. */
  private applyHitEffect(victim: KartEntity, byKartId: string | undefined, shellKind?: "green" | "red" | "blue"): void {
    const it = TUNING.items;
    if (this.hasStatus(victim, "bulletBill")) return; // bullets are immune to shells
    victim.state.speed *= it.hitSlowFactor;
    victim.state.heading += this.rng.range(-0.35, 0.35); // seeded kick, applied once at grant
    victim.state.statusEffects.push({ kind: "hit", remaining: it.hitDurationSec });
    this.bus.emit("kart:hit", { kartId: victim.id, byKartId, shellKind });
  }

  /** Bullet-bill impact: hard reverse knockback + hit status. Bullets are NOT immune to bullets. */
  private applyBulletHit(victim: KartEntity, byKartId: string): void {
    const it = TUNING.items;
    if (this.hasStatus(victim, "star")) return; // star invincibility absorbs the ram
    victim.state.speed = it.bulletBillKnockback; // -12 m/s → reverse
    victim.state.statusEffects.push({ kind: "hit", remaining: it.hitDurationSec });
    this.bus.emit("kart:hit", { kartId: victim.id, byKartId });
  }

  /** True if the kart currently has a status effect of `kind`. */
  private hasStatus(kart: KartEntity, kind: "star" | "bulletBill"): boolean {
    return kart.state.statusEffects.some((e) => e.kind === kind);
  }

  /** Remove all status effects of `kind` from the kart (in place). */
  private removeStatus(kart: KartEntity, kind: "star" | "bulletBill"): void {
    kart.state.statusEffects = kart.state.statusEffects.filter((e) => e.kind !== kind);
  }

  /** All karts ordered by current standings snapshot (rank 1 first). */
  private racersSortedByStandings(): KartEntity[] {
    const byId = new Map(this.racers.map((k) => [k.id, k]));
    return this.standingsSnapshot
      .map((row) => byId.get(row.id))
      .filter((k): k is KartEntity => k !== undefined);
  }

  /** Index of the oil-slick patch containing `pos`, or -1 if none (per-patch skid guard). */
  private oilPatchIndexAt(pos: { x: number; z: number }): number {
    for (let i = 0; i < this.oilSlicks.length; i++) {
      const s = this.oilSlicks[i];
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return i;
    }
    return -1;
  }

  // ── helpers ───────────────────────────────────────────────────────────
  /** progressM(k) = (lap − 1)*L + t*L — a monotonic arc-length measure for gaps. */
  private progressM(kart: KartEntity): number {
    const t = this.splineRef.closestPoint({ x: kart.state.pos.x, z: kart.state.pos.z }).t;
    return (kart.state.lap - 1) * this.splineRef.length + t * this.splineRef.length;
  }

  private classifySurface(pos: { x: number; z: number }): SurfaceKind {
    for (const s of this.oilSlicks) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return "oilSlick";
    }
    // Fall back to the spline's onRoad test for road vs off-road.
    return this.splineRef.closestPoint(pos).onRoad ? "road" : "offRoad";
  }

  private playRaceTheme(): void {
    // MusicSequencer is created by GameApp and injected via a lightweight hook so the
    // controller stays decoupled from audio construction. No-op if not wired (headless).
    // Phase 6: per-map theme — meadows → "meadowsRace", lagoon → "lagoonRace".
    const theme = this.track.id === "lagoon" ? "lagoonRace" : "meadowsRace";
    this.musicHook?.(theme);
  }

  /** Optional music hook set by GameApp (render layer only). */
  musicHook: ((theme: "menu" | "meadowsRace" | "lagoonRace" | "fanfare") => void) | null = null;
}

/** World position of a hazard/anchor at spline t with a lateral offset (left normal). */
function hazardWorldPos(spline: TrackSpline, t: number, lateralOffset: number): { x: number; z: number } {
  const p = spline.pointAt(t);
  const tan = spline.tangentAt(t);
  const nx = -tan.z; // left normal
  const nz = tan.x;
  return { x: p.x + nx * lateralOffset, z: p.z + nz * lateralOffset };
}

/** Grid slot world position (lateral + longitudinal-behind offsets from t=0), glued to the terrain. */
function gridPos(terrain: HeightField, spline: TrackSpline, [lateral, longitudinal]: readonly [number, number]): { x: number; y: number; z: number } {
  const p = spline.pointAt(0);
  const tan = spline.tangentAt(0);
  const nx = -tan.z;
  const nz = tan.x;
  const x = p.x + nx * lateral + tan.x * longitudinal;
  const z = p.z + nz * lateral + tan.z * longitudinal;
  return { x, y: terrain.heightAt(x, z), z };
}

/** Heading (radians) facing along the track at t=0. */
function gridHeading(spline: TrackSpline): number {
  const tan = spline.tangentAt(0);
  return Math.atan2(tan.x, tan.z);
}

/**
 * Checkpoint indices crossed moving forward from prevT to newT (both in [0,1)),
 * returned in temporal crossing order. Handles the t=1→0 wraparound at the line.
 */
function checkpointsCrossed(prevT: number, newT: number, total: number): number[] {
  const EPS = 1e-9;
  if (newT >= prevT) {
    const res: number[] = [];
    for (let i = 0; i < total; i++) {
      const ti = i / total;
      if (ti > prevT + EPS && ti <= newT + EPS) res.push(i);
    }
    return res;
  }
  // Wraparound: crossed the line. Collect (prevT,1] then [0,newT], in that order.
  const tail: number[] = []; // t_i > prevT (higher indices near the end of the lap)
  const head: number[] = []; // t_i <= newT (lower indices just after the line)
  for (let i = 0; i < total; i++) {
    const ti = i / total;
    if (ti > prevT + EPS) tail.push(i);
    else if (ti <= newT + EPS) head.push(i);
  }
  return [...tail, ...head];
}
