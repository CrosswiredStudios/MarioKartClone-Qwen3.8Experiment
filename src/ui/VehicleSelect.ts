/**
 * Vehicle select — 3-card grid showing a side-view preview and the COMBINED stat
 * bars for the currently selected character. Navigation is done ONLY by emitting
 * "ui:navigate" (architecture §5); the chosen id is stashed in ctx.pendingSelection
 * as the selection changes so Back-and-return restores it.
 */
import { CHARACTER_ROSTER } from "../data/characters.js";
import { VEHICLE_ROSTER, combinedStats } from "../data/vehicles.js";
import type { GameContext, IGameScreen } from "../core/GameStateMachine.js";
import { buildSelectionShell, buildStatBar, CardGridController } from "./selectionHelpers.js";
import { drawVehiclePreview } from "./vehiclePreview.js";
import "../styles/selection.css";

const MODIFIER_AXES = ["accel", "topSpeed", "handling", "offRoad"] as const;
const TYPE_LABELS: Record<string, string> = { kart: "Kart", bike: "Bike", atv: "ATV" };
/** Fixed preview accent per vehicle type (the card is about the VEHICLE, not the character). */
const PREVIEW_ACCENTS: Record<string, [number, number, number]> = {
  kart: [0.89, 0.27, 0.27], // red
  bike: [0.27, 0.56, 0.89], // blue
  atv: [0.3, 0.69, 0.31], // green
};

export class VehicleSelect implements IGameScreen {
  readonly id = "VehicleSelect" as const;
  private root: HTMLDivElement | null = null;
  private controller: CardGridController | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  enter(ctx: GameContext): void {
    if (this.root) return; // build the DOM once, cache on the instance

    // The character is always chosen before this screen (machine transition order),
    // but fall back to the first roster entry defensively.
    const character = CHARACTER_ROSTER.find((c) => c.id === ctx.pendingSelection.characterId) ?? CHARACTER_ROSTER[0];
    const shell = buildSelectionShell({
      screenTestid: "vehicle-select",
      title: "Choose Your Ride",
      subtitle: `Combined stats for ${character.name}`,
      confirmTestId: "veh-confirm",
      backTestId: "veh-back",
    });

    const cards: HTMLElement[] = [];
    VEHICLE_ROSTER.forEach((vehicle, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.testid = `veh-card-${vehicle.id}`;
      card.tabIndex = 0;

      const name = document.createElement("h2");
      name.className = "card-name";
      name.textContent = vehicle.name;

      const typeLabel = document.createElement("span");
      typeLabel.className = "card-type";
      typeLabel.textContent = TYPE_LABELS[vehicle.type] ?? vehicle.type;

      // Side-view preview of the vehicle (2D canvas silhouette, tinted per type).
      const preview = document.createElement("canvas");
      preview.className = "card-preview";
      preview.dataset.testid = `veh-preview-${vehicle.id}`;
      drawVehiclePreview(preview, vehicle.type, PREVIEW_ACCENTS[vehicle.type] ?? [0.8, 0.8, 0.85]);

      // Combined stat bars for the selected character (same markup as Task 6).
      const combined = combinedStats(character.id, vehicle.id);
      const stats = document.createElement("div");
      stats.className = "stat-block";
      for (const axis of MODIFIER_AXES) {
        stats.appendChild(buildStatBar(axis, combined[axis], "veh"));
      }

      card.append(preview, name, typeLabel, stats);
      shell.grid.appendChild(card);
      cards.push(card);

      // Mouse path: clicking a card selects it (keyboard path is handled below).
      card.addEventListener("click", () => this.controller?.select(idx));
    });
    // 3 columns in one row so Up/Down are no-ops and Left/Right wrap.
    shell.grid.classList.add("grid-1");

    const initialIdx = Math.max(0, VEHICLE_ROSTER.findIndex((v) => v.id === ctx.pendingSelection.vehicleId));
    this.controller = new CardGridController(cards, 3, (idx) => {
      ctx.pendingSelection.vehicleId = VEHICLE_ROSTER[idx].id;
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
    ctx.eventBus.emit("ui:navigate", { to: "MapSelect" });
  }

  private back(ctx: GameContext): void {
    ctx.eventBus.emit("ui:navigate", { to: "CharacterSelect" });
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
