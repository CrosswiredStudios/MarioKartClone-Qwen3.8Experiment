/**
 * Shared building blocks for the three selection screens (Phase 2).
 * Pure DOM helpers — no Babylon imports. Each screen builds its own cards and
 * supplies confirm/back callbacks; this module owns the shell, stat bars and
 * arrow-key/click navigation so the pattern is implemented exactly once.
 */

export interface ShellOptions {
  /** data-testid for the root .select-screen element (e.g. "character-select"). */
  screenTestid: string;
  title: string;
  subtitle?: string;
  confirmTestId: string; // e.g. "char-confirm"
  backTestId: string; // e.g. "char-back"
}

export interface Shell {
  root: HTMLDivElement;
  grid: HTMLDivElement;
  confirmBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
}

/** Build the .select-screen shell (title, card grid, footer with Confirm/Back). */
export function buildSelectionShell(opts: ShellOptions): Shell {
  const root = document.createElement("div");
  root.className = "select-screen";
  root.dataset.testid = opts.screenTestid;

  const title = document.createElement("h1");
  title.className = "select-title";
  title.textContent = opts.title;
  root.appendChild(title);

  if (opts.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "select-subtitle";
    subtitle.textContent = opts.subtitle;
    root.appendChild(subtitle);
  }

  const grid = document.createElement("div");
  grid.className = "card-grid";
  root.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "select-footer";

  const backBtn = makeButton(opts.backTestId, "Back", "secondary");
  const confirmBtn = makeButton(opts.confirmTestId, "Confirm", "");
  const hint = document.createElement("span");
  hint.className = "select-hint";
  hint.textContent = "\u2190\u2191\u2192\u2193 move \u00b7 Enter confirm \u00b7 Esc back";

  footer.append(backBtn, confirmBtn, hint);
  root.appendChild(footer);

  return { root, grid, confirmBtn, backBtn };
}

function makeButton(testid: string, label: string, variant: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `select-btn${variant ? ` ${variant}` : ""}`;
  button.dataset.testid = testid;
  button.textContent = label;
  return button;
}

/** Build a 5-segment stat bar row. Segments 1..value get the "filled" class. */
export function buildStatBar(axis: string, value: number, testidPrefix = "stat"): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "stat-row";

  const label = document.createElement("span");
  label.className = "stat-label";
  label.textContent = axis;

  const bar = document.createElement("div");
  bar.className = "stat-bar";
  bar.dataset.testid = `${testidPrefix}-stat-${axis}`;
  for (let i = 0; i < 5; i++) {
    const seg = document.createElement("span");
    seg.className = "stat-seg";
    seg.style.setProperty("--i", String(i));
    if (i < value) seg.classList.add("filled");
    bar.appendChild(seg);
  }

  row.append(label, bar);
  return row;
}

/**
 * Owns the selected-card cursor over a fixed grid. Left/Right move \u00b11 with wrap;
 * Up/Down move \u00b1columns clamped (no wrap). The selected card gets ".selected"
 * and DOM focus so the keyboard focus ring + screen readers track it.
 */
export class CardGridController {
  private selectedIdx = 0;

  constructor(
    private readonly cards: HTMLElement[],
    private readonly columns: number,
    private readonly onSelect?: (idx: number) => void,
  ) {
    if (cards.length === 0) throw new Error("CardGridController needs at least one card");
    this.applySelection();
  }

  get selectedIndex(): number {
    return this.selectedIdx;
  }

  /** Select by absolute index (clamped). */
  select(idx: number): void {
    const clamped = Math.max(0, Math.min(this.cards.length - 1, idx));
    if (clamped !== this.selectedIdx) this.selectedIdx = clamped;
    this.applySelection();
  }

  move(dir: "left" | "right" | "up" | "down"): void {
    const n = this.cards.length;
    let next = this.selectedIdx;
    if (dir === "left") next = (this.selectedIdx - 1 + n) % n;
    else if (dir === "right") next = (this.selectedIdx + 1) % n;
    else if (dir === "up") next = Math.max(0, this.selectedIdx - this.columns);
    else if (dir === "down") next = Math.min(n - 1, this.selectedIdx + this.columns);
    this.select(next);
  }

  private applySelection(): void {
    this.cards.forEach((card, i) => {
      const selected = i === this.selectedIdx;
      card.classList.toggle("selected", selected);
      if (selected) card.focus();
    });
    this.onSelect?.(this.selectedIdx);
  }
}
