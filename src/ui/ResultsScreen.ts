/**
 * ResultsScreen — end-of-race standings (06-phase-4 Step 11).
 *
 * Entered when the RaceController emits "race:finished" (GameApp routes Racing → Results).
 * Renders a final standings table (rank badge, name, total time or DNF), the player's
 * per-lap times with the best lap highlighted, and two actions:
 *   - Race Again  → CharacterSelect with the previous vehicle + map preselected.
 *   - Main Menu   → MainMenu (GameApp tears down the race on that transition).
 *
 * The screen is presentational — it reads final data through an injected getter to the
 * RaceController so this file stays Babylon-free and headless-testable. Content is rebuilt
 * fresh on every enter() because each race produces different standings.
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

export class ResultsScreen implements IGameScreen {
  readonly id = "Results" as const;

  // ── PHASE 6 HOOK ────────────────────────────────────────────────────────────
  onPodiumReady: PodiumHook | null = null;

  private root: HTMLDivElement | null = null;

  constructor(private readonly getRace: () => RaceController | null) {}

  enter(ctx: GameContext): void {
    // Rebuild fresh each time — a new race means new standings/lap times.
    this.root?.remove();
    this.root = null;

    const race = this.getRace();
    const standings: FinalStanding[] = race?.finalStandings() ?? [];
    const lapTimes: ReadonlyArray<number> = race?.playerLapTimes() ?? [];

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
      const row = document.createElement("div");
      row.className = "results-row";

      const badge = document.createElement("span");
      badge.className = "rank-badge";
      badge.textContent = `P${s.rank}`;

      const nameEl = document.createElement("span");
      nameEl.className = "results-name";
      nameEl.textContent = s.name;

      const timeEl = document.createElement("span");
      timeEl.className = "results-time";
      timeEl.textContent = s.totalMs === null ? "DNF" : formatTimeMs(s.totalMs);

      row.append(badge, nameEl, timeEl);
      table.appendChild(row);
    }
    root.appendChild(table);

    // ── Player per-lap times (best lap highlighted) ────────────────────
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
    root.appendChild(lapsList);

    // ── Actions ────────────────────────────────────────────────────────
    const buttons = document.createElement("div");
    buttons.className = "menu-buttons";

    const raceAgain = this.makeButton("Race Again", "results-race-again", () => {
      // Preselect the previous vehicle + map so a quick re-run keeps the setup. The
      // player can still change character (we route through CharacterSelect).
      const cfg = ctx.raceConfig;
      if (cfg) {
        ctx.pendingSelection.characterId = cfg.characterId;
        ctx.pendingSelection.vehicleId = cfg.vehicleId;
        ctx.pendingSelection.mapId = cfg.mapId;
      }
      ctx.eventBus.emit("ui:navigate", { to: "CharacterSelect" });
    });

    const mainMenu = this.makeButton("Main Menu", "results-main-menu", () => {
      ctx.eventBus.emit("ui:navigate", { to: "MainMenu" });
    });

    buttons.append(raceAgain, mainMenu);
    root.appendChild(buttons);

    document.body.appendChild(root);
    this.root = root;

    // Phase 6 will drive the podium animation from here once onPodiumReady is assigned.
    if (this.onPodiumReady) this.onPodiumReady(standings);
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
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
