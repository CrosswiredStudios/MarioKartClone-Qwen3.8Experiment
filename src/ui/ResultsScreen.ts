/**
 * ResultsScreen — end-of-race standings (06-phase-4 Step 11, Phase 7 finish-out).
 *
 * Two phases:
 *   - LIVE (Phase 7): entered the moment the PLAYER crosses the line while the field is
 *     still racing. Renders a live standings table refreshed every logic step — finished
 *     karts show their total time, unfished ones "—" — plus a Skip button that fast-
 *     forwards the remaining karts to DNF (race.skipFinishOut()). The AI-driven player
 *     keeps racing behind this overlay in a wide camera view.
 *   - FINAL: once `race:finished` fires (all karts done, grace deadline, or Skip),
 *     finalize() re-renders the final table (rank badge, name, total time or DNF) and
 *     removes the Skip button; the podium sequence plays over the live world.
 *
 * Both phases also show the player's per-lap times with the best lap highlighted, and
 * two actions: Race Again → CharacterSelect (previous vehicle + map preselected),
 * Main Menu → MainMenu (GameApp tears down the race on that transition).
 *
 * The screen is presentational — it reads data through an injected getter to the
 * RaceController so this file stays Babylon-free and headless-testable. Content is
 * rebuilt fresh on every enter() because each race produces different standings.
 */

import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import type { FinalStanding, RaceController } from "../race/RaceController.js";

import { formatTimeMs } from "./Hud.js";
import "../styles/results.css";

/**
 * ── PHASE 6 HOOK ────────────────────────────────────────────────────────────
 * Podium animation + confetti particles + fanfare attach here. Phase 6 assigns
 * this callback (wired to ParticleFactory + MusicSequencer.fanfare()); until
 * then it is null and the screen renders the static table only. Do not build
 * podium visuals in this phase.
 */
export type PodiumHook = (standings: FinalStanding[]) => void;

/** One live row's mutable cells, keyed by kart id for O(1) per-step refresh. */
interface LiveRow {
  timeEl: HTMLSpanElement;
}

export class ResultsScreen implements IGameScreen {
  readonly id = "Results" as const;

  // ── PHASE 6 HOOK ────────────────────────────────────────────────────────────
  onPodiumReady: PodiumHook | null = null;

  private root: HTMLDivElement | null = null;
  /** True while the live finish-out table is showing (before race:finished). */
  private live = false;
  /** Live-mode time cells by kart id — updated in place each logic step. */
  private liveRows = new Map<string, LiveRow>();
  /** Last GameContext seen in enter()/finalize() — used to rebuild the final table. */
  private lastCtx: GameContext | null = null;

  constructor(private readonly getRace: () => RaceController | null) {}

  enter(ctx: GameContext): void {
    // Rebuild fresh each time — a new race means new standings/lap times.
    this.root?.remove();
    this.root = null;
    this.liveRows.clear();

    const race = this.getRace();

    // Phase 7: entered mid-finish-out (player crossed, field still racing) → live table.
    if (race && race.phase !== "finished") {
      this.buildLive(ctx, race);
    } else {
      this.live = false;
      this.buildFinal(ctx, race?.finalStandings() ?? [], race?.playerLapTimes() ?? []);
    }

    document.body.appendChild(this.root!);
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.liveRows.clear();
    this.live = false;
  }

  /**
   * Phase 7 — refresh the live table (called by GameApp each logic step while the
   * field is still racing). Finished karts show their total time; unfished "—".
   */
  tickLive(): void {
    if (!this.live) return;
    const race = this.getRace();
    if (!race || race.phase === "finished") return;
    for (const s of race.standings()) {
      const row = this.liveRows.get(s.id);
      if (!row) continue;
      const ms = race.finishTimeMs(s.id);
      row.timeEl.textContent = ms === null ? "—" : formatTimeMs(ms);
    }
  }

  /**
   * Phase 7 — called by GameApp when `race:finished` fires while we're already in
   * Results (the normal finish-out path). Re-renders the final table and drops Skip.
   */
  finalize(): void {
    if (!this.live) return; // already final (e.g. entered after race:finished)
    const ctx = this.lastCtx!;
    const race = this.getRace();
    this.root?.remove();
    this.root = null;
    this.liveRows.clear();
    this.live = false;
    this.buildFinal(ctx, race?.finalStandings() ?? [], race?.playerLapTimes() ?? []);
    document.body.appendChild(this.root!);
  }

  // ── LIVE finish-out layout (Phase 7) ───────────────────────────────────────

  private buildLive(ctx: GameContext, race: RaceController): void {
    this.lastCtx = ctx;
    this.live = true;

    const root = document.createElement("div");
    root.className = "results-overlay";
    root.dataset.testid = "screen-results";

    const title = document.createElement("h2");
    title.textContent = "Finish!";
    root.appendChild(title);

    const sub = document.createElement("p");
    sub.className = "results-subtitle";
    sub.textContent = "The field is still racing — watch them finish out, or skip ahead.";
    root.appendChild(sub);

    // Live standings table (rank order from the controller's live snapshot).
    const table = document.createElement("div");
    table.className = "results-table";
    table.dataset.testid = "results-table";
    for (const s of race.standings()) {
      const row = this.makeRow(s.rank, s.name);
      const ms = race.finishTimeMs(s.id);
      row.timeEl.textContent = ms === null ? "—" : formatTimeMs(ms);
      table.appendChild(row.root);
      this.liveRows.set(s.id, { timeEl: row.timeEl });
    }
    root.appendChild(table);

    // Player lap times (the player has finished all laps by definition here).
    root.appendChild(this.makeLapTimes(race.playerLapTimes()));

    // Actions — Skip + the usual two.
    const buttons = document.createElement("div");
    buttons.className = "menu-buttons";
    const skip = this.makeButton("Skip", "results-skip", () => {
      race.skipFinishOut(); // finalizes immediately; race:finished → finalize() re-renders
    });
    buttons.append(
      skip,
      this.makeButton("Race Again", "results-race-again", () => this.raceAgain(ctx)),
      this.makeButton("Main Menu", "results-main-menu", () => {
        ctx.eventBus.emit("ui:navigate", { to: "MainMenu" });
      }),
    );
    root.appendChild(buttons);

    this.root = root;
  }

  // ── FINAL layout (Phase 4 Step 11) ─────────────────────────────────────────

  private buildFinal(ctx: GameContext, standings: FinalStanding[], lapTimes: ReadonlyArray<number>): void {
    this.lastCtx = ctx;

    const root = document.createElement("div");
    root.className = "results-overlay";
    root.dataset.testid = "screen-results";

    const title = document.createElement("h2");
    title.textContent = "Race Complete";
    root.appendChild(title);

    // ── Standings table ────────────────────────────────────────────────
    const table = document.createElement("div");
    table.className = "results-table";
    table.dataset.testid = "results-table";
    for (const s of standings) {
      const row = this.makeRow(s.rank, s.name);
      row.timeEl.textContent = s.totalMs === null ? "DNF" : formatTimeMs(s.totalMs);
      table.appendChild(row.root);
    }
    root.appendChild(table);

    // ── Player per-lap times (best lap highlighted) ────────────────────
    root.appendChild(this.makeLapTimes(lapTimes));

    // ── Actions ────────────────────────────────────────────────────────
    const buttons = document.createElement("div");
    buttons.className = "menu-buttons";
    buttons.append(
      this.makeButton("Race Again", "results-race-again", () => this.raceAgain(ctx)),
      this.makeButton("Main Menu", "results-main-menu", () => {
        ctx.eventBus.emit("ui:navigate", { to: "MainMenu" });
      }),
    );
    root.appendChild(buttons);

    this.root = root;

    // Phase 6 will drive the podium animation from here once onPodiumReady is assigned.
    if (this.onPodiumReady) this.onPodiumReady(standings);
  }

  /** Preselect the previous vehicle + map so a quick re-run keeps the setup. */
  private raceAgain(ctx: GameContext): void {
    const cfg = ctx.raceConfig;
    if (cfg) {
      ctx.pendingSelection.characterId = cfg.characterId;
      ctx.pendingSelection.vehicleId = cfg.vehicleId;
      ctx.pendingSelection.mapId = cfg.mapId;
    }
    ctx.eventBus.emit("ui:navigate", { to: "CharacterSelect" });
  }

  // ── Shared builders ────────────────────────────────────────────────────────

  private makeRow(rank: number, name: string): { root: HTMLDivElement; timeEl: HTMLSpanElement } {
    const row = document.createElement("div");
    row.className = "results-row";

    const badge = document.createElement("span");
    badge.className = "rank-badge";
    badge.textContent = `P${rank}`;

    const nameEl = document.createElement("span");
    nameEl.className = "results-name";
    nameEl.textContent = name;

    const timeEl = document.createElement("span");
    timeEl.className = "results-time";

    row.append(badge, nameEl, timeEl);
    return { root: row, timeEl };
  }

  private makeLapTimes(lapTimes: ReadonlyArray<number>): HTMLDivElement {
    const best = lapTimes.length > 0 ? Math.min(...lapTimes) : null;
    const lapsList = document.createElement("div");
    lapsList.className = "results-player-laps";
    lapsList.dataset.testid = "results-player-laps";
    lapTimes.forEach((ms, i) => {
      const item = document.createElement("span");
      item.className = "lap-time" + (best !== null && ms === best ? " best" : "");
      item.textContent = `Lap ${i + 1}: ${formatTimeMs(ms)}`;
      lapsList.appendChild(item);
    });
    return lapsList;
  }

  private makeButton(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.dataset.testid = testId;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }
}
