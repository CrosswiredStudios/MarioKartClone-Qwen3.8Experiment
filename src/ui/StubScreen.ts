import type { GameContext, GameScreenId, IGameScreen } from "../core/GameStateMachine.js";

/** "CharacterSelect" -> "character-select", "MainMenu" -> "main-menu". */
function toKebab(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Phase 1 placeholder screen. Renders a labelled div so e2e tests can assert
 * navigation; replaced by real screens in Phases 2–4 (same data-testids).
 */
export class StubScreen implements IGameScreen {
  readonly id: GameScreenId;
  private el: HTMLDivElement | null = null;

  constructor(id: GameScreenId) {
    this.id = id;
  }

  enter(_ctx: GameContext): void {
    console.log(`[screen] enter ${this.id}`);
    const div = document.createElement("div");
    div.className = "stub-screen";
    div.dataset.testid = `screen-${toKebab(this.id)}`;
    div.textContent = this.id;
    document.body.appendChild(div);
    this.el = div;
  }

  exit(): void {
    this.el?.remove();
    this.el = null;
  }
}
