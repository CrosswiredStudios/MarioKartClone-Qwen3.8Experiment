/**
 * Map select — 2-card grid built from the pure track data files (no Babylon).
 * Confirm assembles the RaceConfig via createRaceConfig(), stores it on the
 * GameContext, then navigates to Countdown. Navigation is done ONLY by emitting
 * "ui:navigate" (architecture §5).
 */
import { LAGOON_TRACK, MEADOWS_TRACK } from "../data/tracks/index.js";
import type { TrackDefinition } from "../data/tracks/shared.js";
import { createRaceConfig } from "../core/RaceConfig.js";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import { buildSelectionShell, CardGridController } from "./selectionHelpers.js";
import "../styles/selection.css";

const MAPS: readonly TrackDefinition[] = [MEADOWS_TRACK, LAGOON_TRACK];
// Difficulty is presentation metadata (not part of the pure data layer).
const DIFFICULTY: Record<string, string> = { meadows: "Beginner", lagoon: "Intermediate" };
const SWATCH_KEYS = ["groundColor", "accentColor", "skyTop", "skyBottom"] as const;

export class MapSelect implements IGameScreen {
  readonly id = "MapSelect" as const;
  private root: HTMLDivElement | null = null;
  private controller: CardGridController | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  enter(ctx: GameContext): void {
    if (this.root) return; // build the DOM once, cache on the instance

    const shell = buildSelectionShell({
      screenTestid: "map-select",
      title: "Choose Your Track",
      subtitle: `${MAPS.length} tracks available`,
      confirmTestId: "map-confirm",
      backTestId: "map-back",
    });

    const cards: HTMLElement[] = [];
    MAPS.forEach((track, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.testid = `map-card-${track.id}`;
      card.tabIndex = 0;

      // Theme swatch strip: ground / accent / skyTop / skyBottom.
      const strip = document.createElement("div");
      strip.className = "swatch-strip";
      for (const key of SWATCH_KEYS) {
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.backgroundColor = track.theme[key];
        strip.appendChild(swatch);
      }

      const name = document.createElement("h2");
      name.className = "card-name";
      name.textContent = track.name;

      const difficulty = document.createElement("span");
      difficulty.className = "card-type";
      difficulty.dataset.testid = `map-difficulty-${track.id}`;
      difficulty.textContent = DIFFICULTY[track.id] ?? "Unknown";

      card.append(strip, name, difficulty);
      shell.grid.appendChild(card);
      cards.push(card);

      // Mouse path: clicking a card selects it (keyboard path is handled below).
      card.addEventListener("click", () => this.controller?.select(idx));
    });
    // 2 columns in one row so Up/Down are no-ops and Left/Right wrap.
    shell.grid.classList.add("grid-1");

    // Preselect the previously chosen map when re-entering from Results "Race Again"
    // (ctx.pendingSelection.mapId is set there); otherwise default to the first track.
    const initialMapIdx = Math.max(0, MAPS.findIndex((m) => m.id === ctx.pendingSelection.mapId));
    this.controller = new CardGridController(cards, 2);
    this.controller.select(initialMapIdx);

    shell.confirmBtn.addEventListener("click", () => this.confirm(ctx));
    shell.backBtn.addEventListener("click", () => this.back(ctx));

    const onKeyDown = (e: KeyboardEvent): void => {
      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          this.controller?.move("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          this.controller?.move("right");
          break;
        case "Enter":
          // preventDefault also suppresses native button activation, so confirm fires once.
          e.preventDefault();
          this.confirm(ctx);
          break;
        case "Escape":
          e.preventDefault();
          this.back(ctx);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    this.onKeyDown = onKeyDown;

    document.body.appendChild(shell.root);
    this.root = shell.root;
  }

  private confirm(ctx: GameContext): void {
    const idx = this.controller?.selectedIndex ?? 0;
    const track = MAPS[idx];
    // createRaceConfig throws on unknown ids — the rosters are validated at module load,
    // so a throw here means a wiring bug and should be loud.
    const cfg = createRaceConfig(
      ctx.pendingSelection.characterId ?? "",
      ctx.pendingSelection.vehicleId ?? "",
      track.id,
    );
    ctx.raceConfig = cfg;
    ctx.eventBus.emit("ui:navigate", { to: "Countdown" });
  }

  private back(ctx: GameContext): void {
    ctx.eventBus.emit("ui:navigate", { to: "VehicleSelect" });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.controller = null;
    if (this.onKeyDown) {
      window.removeEventListener("keydown", this.onKeyDown);
      this.onKeyDown = null;
    }
  }
}
