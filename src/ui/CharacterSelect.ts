/**
 * Character select — 4-card grid, arrow-key + click navigation, stat bars.
 * Navigation is done ONLY by emitting "ui:navigate" (architecture §5); the
 * chosen id is stashed in ctx.pendingSelection as the selection changes so a
 * Back-and-return restores the highlighted card.
 */
import { CHARACTER_ROSTER } from "../data/characters.js";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import { buildSelectionShell, buildStatBar, CardGridController } from "./selectionHelpers.js";
import "../styles/selection.css";

const STAT_AXES = ["accel", "topSpeed", "handling", "offRoad"] as const;

export class CharacterSelect implements IGameScreen {
  readonly id = "CharacterSelect" as const;
  private root: HTMLDivElement | null = null;
  private controller: CardGridController | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  enter(ctx: GameContext): void {
    if (this.root) return; // build the DOM once, cache on the instance

    const shell = buildSelectionShell({
      screenTestid: "character-select",
      title: "Choose Your Racer",
      subtitle: `${CHARACTER_ROSTER.length} racers available`,
      confirmTestId: "char-confirm",
      backTestId: "char-back",
    });

    const cards: HTMLElement[] = [];
    for (const character of CHARACTER_ROSTER) {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.testid = `char-card-${character.id}`;
      card.tabIndex = 0; // focusable so the keyboard focus ring tracks selection

      const name = document.createElement("h2");
      name.className = "card-name";
      name.textContent = character.name; // never the pun source (IP safety, overview §2)

      const stats = document.createElement("div");
      stats.className = "stat-block";
      for (const axis of STAT_AXES) {
        stats.appendChild(buildStatBar(axis, character.stats[axis], "char"));
      }

      card.append(name, stats);
      shell.grid.appendChild(card);
      cards.push(card);

      // Mouse path: clicking a card selects it (keyboard path is handled below).
      const idx = CHARACTER_ROSTER.indexOf(character);
      card.addEventListener("click", () => this.controller?.select(idx));
    }
    // 2x2 grid so Up/Down move by two (row-major cursor).
    shell.grid.classList.add("grid-2");

    const initialIdx = Math.max(0, CHARACTER_ROSTER.findIndex((c) => c.id === ctx.pendingSelection.characterId));
    this.controller = new CardGridController(cards, 2, (idx) => {
      ctx.pendingSelection.characterId = CHARACTER_ROSTER[idx].id;
    });
    this.controller.select(initialIdx);

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
        case "ArrowUp":
          e.preventDefault();
          this.controller?.move("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          this.controller?.move("down");
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
    ctx.eventBus.emit("ui:navigate", { to: "VehicleSelect" });
  }

  private back(ctx: GameContext): void {
    ctx.eventBus.emit("ui:navigate", { to: "MainMenu" });
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
