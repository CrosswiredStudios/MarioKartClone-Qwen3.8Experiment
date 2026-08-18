/**
 * HUD — the in-race DOM overlay (06-phase-4-race-loop-and-ai.md, Steps 5–9).
 *
 * A top-level overlay owned by GameApp (NOT a state-machine screen): it is visible
 * during both Racing and Paused (frozen while paused), so it can't be tied to the
 * single "Racing" id. It renders only — all simulation math lives in the RaceController.
 * Rank comes from the controller's 1 Hz standings snapshot; the HUD never recomputes
 * standings itself (SRP: controller computes, HUD renders).
 *
 * Step 5 adds position + lap counter. Steps 6–9 add times, item slot, speedometer and
 * minimap into the same root — each element is built in show() so a fresh race gets a
 * clean DOM.
 */

import type { ItemId } from "../entities/KartPhysics.js";
import type { RaceController } from "../race/RaceController.js";
import "../styles/hud.css";

/**
 * Format a duration in milliseconds as "mm:ss.mmm" (06-phase-4 Step 6).
 * Pure — no DOM. Examples: 95_234 → "01:35.234", 59_999 → "00:59.999", 0 → "00:00.000".
 * Minutes may exceed two digits for very long races (pad to a MINIMUM of two).
 */
export function formatTimeMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return String(n);
}

/**
 * Draw an item icon into a 48×48 canvas (06-phase-4 Step 7). Pure — no DOM beyond the
 * passed context. Phase 4 always passes `null` (empty slot → centered "?"); Phase 5
 * flips the input to real ids with zero HUD changes.
 *
 */
export function drawItemIcon(ctx: CanvasRenderingContext2D, itemId: ItemId | null): void {
  const S = 48; // canvas size
  ctx.clearRect(0, 0, S, S);

  if (itemId === null) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", S / 2, S / 2 + 1);
    return;
  }

  switch (itemId) {
    case "mushroom":
      drawMushroom(ctx, 24, 20, 14); // cap center + radius
      break;
    case "greenShell":
      drawShell(ctx, "#3fbf3f", "#1e7a1e");
      break;
    case "redShell":
      drawShell(ctx, "#e03c3c", "#8a1414");
      break;
    case "blueShell": {
      drawShell(ctx, "#3c6ee0", "#152f8a");
      // yellow zigzag across the shell
      ctx.strokeStyle = "#ffd93b";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "miter";
      ctx.beginPath();
      ctx.moveTo(14, 26);
      ctx.lineTo(20, 20);
      ctx.lineTo(26, 26);
      ctx.lineTo(32, 20);
      ctx.lineTo(38, 26);
      ctx.stroke();
      break;
    }
    case "banana": {
      // Crescent: outer arc minus an offset inner circle.
      ctx.fillStyle = "#ffd93b";
      ctx.beginPath();
      ctx.arc(24, 26, 16, Math.PI * 0.85, Math.PI * 2.15);
      ctx.arc(27, 20, 13, Math.PI * 2.05, Math.PI * 0.95, true);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "star": {
      drawStar(ctx, 24, 25, 17, 7, "#ffd93b", "#c79a00");
      break;
    }
    case "lightning": {
      // Thick yellow zigzag (4 segments) with a white core stroke.
      const bolt: ReadonlyArray<readonly [number, number]> = [
        [28, 6],
        [16, 26],
        [25, 26],
        [19, 42],
        [33, 20],
        [24, 20],
      ];
      strokePolyline(ctx, bolt, "#ffd93b", 7);
      strokePolyline(ctx, bolt, "#ffffff", 2.5);
      break;
    }
    case "bulletBill": {
      // Bullet Bill: a dark oval with angry eyes.
      ctx.fillStyle = "#1a1a2e";
      ctx.beginPath();
      ctx.ellipse(24, 24, 16, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(18, 21, 4, 0, Math.PI * 2);
      ctx.arc(30, 21, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e03c3c";
      ctx.beginPath();
      ctx.arc(18, 21, 2, 0, Math.PI * 2);
      ctx.arc(30, 21, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Red-capped mushroom: cap circle + white stem below + two white dots on the cap. */
function drawMushroom(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Stem (white rounded rect) below the cap.
  const stemW = r * 0.9;
  const stemH = r * 0.85;
  ctx.fillStyle = "#fff6e8";
  roundRect(ctx, cx - stemW / 2, cy + r * 0.35, stemW, stemH, stemW * 0.4);
  ctx.fill();
  // Cap (red circle).
  ctx.fillStyle = "#e03c3c";
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  // Two white dots on the cap.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx - r * 0.45, cy - r * 0.35, r * 0.18, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.45, cy - r * 0.35, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

/** Shell: filled circle with a darker rim arc and a small dark slit rectangle. */
function drawShell(ctx: CanvasRenderingContext2D, fill: string, rim: string): void {
  const cx = 24;
  const cy = 25;
  const r = 15;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI * 2); // dome (upper half)
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - r, cy, r * 2, 4); // flat base band
  // Darker rim arc along the top.
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  // Small dark slit rectangle on the base band.
  ctx.fillStyle = rim;
  roundRect(ctx, cx - 4, cy + 1, 8, 3, 1.5);
  ctx.fill();
}

/** 5-point star polygon: outer/inner radii, gold fill, darker outline. */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  fill: string,
  outline: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<readonly [number, number]>,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Needle angle (degrees) for the speedometer gauge (06-phase-4 Step 8). Pure.
 * Maps a normalized speed ratio (clamped to 0..1) onto a 240° sweep: 0 → −120°,
 * 1 → +120°. The needle is drawn pointing straight up at angle 0, so this value is
 * used directly as `rotate(angle 60 60)` in the SVG.
 */
export function speedoAngle(speedRatio: number): number {
  // NaN-safe clamp (a NaN ratio must never leak into an SVG transform).
  const r = Number.isFinite(speedRatio) ? Math.min(1, Math.max(0, speedRatio)) : 0;
  return -120 + r * 240;
}

export class Hud {
  private readonly getRace: () => RaceController | null;

  private root: HTMLDivElement | null = null;
  private positionEl: HTMLSpanElement | null = null;
  private lapEl: HTMLSpanElement | null = null;
  /** Step 6: current-lap timer + best completed lap. */
  private currentTimeEl: HTMLSpanElement | null = null;
  private bestTimeEl: HTMLSpanElement | null = null;
  /** Step 7: item slot canvas (48×48). Phase 4 always draws the empty "?" state. */
  private itemCanvas: HTMLCanvasElement | null = null;
  /** The slot container — carries the brief pickup/use flash class (Phase 5 Step 10). */
  private itemSlotEl: HTMLDivElement | null = null;
  /** Last itemId painted into the slot — repaint only on change (no per-frame canvas churn). */
  private lastItemDrawn: ItemId | null | undefined = undefined; // undefined = not yet drawn
  /** Step 8: SVG speedometer needle + numeric readout. */
  private speedoNeedle: SVGLineElement | null = null;
  private speedValueEl: HTMLSpanElement | null = null;
  /** Step 9: minimap canvas + offscreen base (road drawn once). */
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapBase: HTMLCanvasElement | null = null;

  constructor(getRace: () => RaceController | null) {
    this.getRace = getRace;
  }

  /** Build (once) and show the overlay. Called by GameApp on entering Racing/Paused. */
  show(): void {
    if (!this.root) {
      const root = document.createElement("div");
      root.className = "hud";
      root.dataset.testid = "hud";

      // Top-left: position + lap counter (Step 5).
      const topLeft = document.createElement("div");
      topLeft.className = "hud-top-left";

      const position = document.createElement("span");
      position.className = "hud-position";
      position.dataset.testid = "hud-position";
      position.textContent = "P1/4";

      const lap = document.createElement("span");
      lap.className = "hud-lap";
      lap.dataset.testid = "hud-lap";
      lap.textContent = "LAP 1/3";

      topLeft.append(position, lap);
      root.appendChild(topLeft);

      // Top-right: current-lap timer + best completed lap (Step 6).
      const topRight = document.createElement("div");
      topRight.className = "hud-top-right";

      const currentTime = document.createElement("span");
      currentTime.className = "hud-current-time";
      currentTime.dataset.testid = "hud-current-time";
      currentTime.textContent = formatTimeMs(0);

      const bestTime = document.createElement("span");
      bestTime.className = "hud-best-time";
      bestTime.dataset.testid = "hud-best-time";
      bestTime.textContent = "--:--.---"; // no completed lap yet

      topRight.append(currentTime, bestTime);
      root.appendChild(topRight);

      // Bottom-left: item slot (Step 7). Phase 4 has no items — always the "?" state.
      const itemSlot = document.createElement("div");
      itemSlot.className = "hud-item-slot";
      itemSlot.dataset.testid = "hud-item-slot";

      const itemCanvas = document.createElement("canvas");
      itemCanvas.width = 48;
      itemCanvas.height = 48;
      itemSlot.appendChild(itemCanvas);
      root.appendChild(itemSlot);
      this.itemCanvas = itemCanvas;
      this.itemSlotEl = itemSlot;

      // Bottom-right: SVG speedometer (Step 8). Static arc + needle rotated per frame.
      const bottomRight = document.createElement("div");
      bottomRight.className = "hud-bottom-right";

      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.dataset.testid = "hud-speedo";
      svg.setAttribute("viewBox", "0 0 120 70");
      svg.setAttribute("width", "150");
      svg.setAttribute("height", "88");

      // Static gauge arc: 240° sweep centered at (60,60). The needle points straight up
      // at angle 0 and sweeps −120°..+120°, so the arc endpoints sit 30° BELOW horizontal —
      // with only 10 viewBox units below the pivot, radius is capped: 60 + r·sin(30°) +
      // strokeWidth/2 ≤ 70 → r = 16 (stroke 4). Endpoints land at y=68, top of arc at y=44.
      const cx = 60;
      const cy = 60;
      const rArc = 16;
      // Screen coords: angle measured clockwise from up → standard math angle = θ − 90°.
      const a0 = ((-120 - 90) * Math.PI) / 180;
      const a1 = ((120 - 90) * Math.PI) / 180;
      const x0 = cx + rArc * Math.cos(a0);
      const y0 = cy + rArc * Math.sin(a0);
      const x1 = cx + rArc * Math.cos(a1);
      const y1 = cy + rArc * Math.sin(a1);
      const arcPath = document.createElementNS(NS, "path");
      // large-arc=1 (240° > 180°), sweep=1 (clockwise through the top)
      arcPath.setAttribute("d", `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rArc} ${rArc} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
      arcPath.setAttribute("fill", "none");
      arcPath.setAttribute("stroke", "rgba(255,255,255,0.35)");
      arcPath.setAttribute("stroke-width", "4");
      arcPath.setAttribute("stroke-linecap", "round");

      // Needle: drawn pointing straight up from center; rotated via transform each frame.
      const needle = document.createElementNS(NS, "line");
      needle.setAttribute("x1", String(cx));
      needle.setAttribute("y1", String(cy));
      needle.setAttribute("x2", String(cx));
      needle.setAttribute("y2", String(cy - rArc + 3));
      needle.setAttribute("stroke", "#ff5252");
      needle.setAttribute("stroke-width", "3");
      needle.setAttribute("stroke-linecap", "round");
      needle.setAttribute("transform", `rotate(${speedoAngle(0)} ${cx} ${cy})`);

      // Hub cap at the pivot.
      const hub = document.createElementNS(NS, "circle");
      hub.setAttribute("cx", String(cx));
      hub.setAttribute("cy", String(cy));
      hub.setAttribute("r", "3.5");
      hub.setAttribute("fill", "#ff5252");

      svg.append(arcPath, needle, hub);

      const speedValue = document.createElement("span");
      speedValue.className = "hud-speed-value";
      speedValue.dataset.testid = "hud-speed-value";
      speedValue.textContent = "0.0 m/s";

      bottomRight.append(svg, speedValue);
      root.appendChild(bottomRight);
      this.speedoNeedle = needle;
      this.speedValueEl = speedValue;

      // Center-top: minimap canvas (Step 9). Road is drawn once to an offscreen base.
      const minimapCanvas = document.createElement("canvas");
      minimapCanvas.dataset.testid = "hud-minimap";
      minimapCanvas.width = 160;
      minimapCanvas.height = 160;
      minimapCanvas.className = "hud-minimap";
      root.appendChild(minimapCanvas);
      this.minimapCanvas = minimapCanvas;

      document.body.appendChild(root);
      this.root = root;
      this.positionEl = position;
      this.lapEl = lap;
      this.currentTimeEl = currentTime;
      this.bestTimeEl = bestTime;
    }
    this.root.style.display = "";
    // Paint immediately so the first frame isn't stale.
    this.refresh();
  }

  /** Hide the overlay (menu / results). DOM is kept for reuse on the next race. */
  hide(): void {
    if (this.root) this.root.style.display = "none";
    // Drop the baked road base so a different track's geometry is rebuilt on re-show.
    this.minimapBase = null;
  }

  /** Refresh all HUD text from the controller's live state. Called each logic step while Racing. */
  update(_dt: number): void {
    this.refresh();
  }

  private refresh(): void {
    const race = this.getRace();
    if (!race || !this.positionEl || !this.lapEl) return;

    // Rank + lap both come from the controller's standings snapshot (1 Hz). The player
    // row carries its current rank and 1-based lap. Never recompute here.
    const player = race.standings().find((row) => row.id === "player");
    if (!player) return;

    this.positionEl.textContent = `P${player.rank}/4`;
    this.lapEl.textContent = `LAP ${Math.min(player.lap, race.totalLaps)}/${race.totalLaps}`;

    // Step 6: live current-lap timer + best completed lap.
    if (this.currentTimeEl) {
      this.currentTimeEl.textContent = formatTimeMs(race.playerCurrentLapMs());
    }
    if (this.bestTimeEl) {
      const laps = race.playerLapTimes();
      this.bestTimeEl.textContent = laps.length ? formatTimeMs(Math.min(...laps)) : "--:--.---";
    }

    // Step 7: item slot. Phase 4 has no items — the player's state.item is always null,
    // so this paints the "?" empty state. Phase 5 flips it to real ids; no HUD change needed.
    const playerKart = race.karts().find((k) => k.isPlayer);
    if (!playerKart) return;

    const item: ItemId | null = playerKart.state.item;
    if (this.itemCanvas && item !== this.lastItemDrawn) {
      const ctx = this.itemCanvas.getContext("2d");
      if (ctx) drawItemIcon(ctx, item);
      // Phase 5 Step 10 — flash the slot on a pickup (null→item) or use (item→null).
      if ((this.lastItemDrawn ?? null) !== item && this.itemSlotEl) {
        this.flashItemSlot();
      }
      this.lastItemDrawn = item;
    }

    // Step 8: speedometer. Needle angle from the normalized ratio; value is signed m/s
    // so reversing reads negative. Only setAttribute + textContent — no DOM churn.
    if (this.speedoNeedle) {
      this.speedoNeedle.setAttribute(
        "transform",
        `rotate(${speedoAngle(playerKart.state.speedRatio).toFixed(2)} 60 60)`,
      );
    }
    if (this.speedValueEl) {
      this.speedValueEl.textContent = `${playerKart.state.speed.toFixed(1)} m/s`;
    }

    // Step 9: minimap. Road is baked once into an offscreen base; each frame we blit the
    // base then stamp one dot per kart (AI = character color, player = white ring).
    if (this.minimapCanvas) this.drawMinimap(race);
  }

  /**
   * Phase 5 Step 10 — brief highlight on the item slot when an item is picked up or used.
   * Re-triggers a CSS animation by removing/re-adding the class (with a reflow in between)
   * so consecutive pickups flash again rather than being swallowed as "already present".
   */
  private flashItemSlot(): void {
    const el = this.itemSlotEl;
    if (!el) return;
    el.classList.remove("hud-item-slot-flash");
    // Force a reflow so the class removal is committed before re-adding — otherwise the
    // browser coalesces remove+add and the animation never restarts.
    void el.offsetWidth;
    el.classList.add("hud-item-slot-flash");
  }

  /** World→canvas projection for the minimap, recomputed once when the base is built. */
  private mmScale = 1;
  private mmOriginX = 0; // world x that maps to canvas center
  private mmOriginZ = 0; // world z that maps to canvas center

  /** Build (once) the offscreen road base + projection from the track spline. */
  private buildMinimapBase(race: RaceController): void {
    const size = 160;
    const pad = 12;
    const N = 200; // spline samples

    // Sample the closed loop and find its XZ bounding box.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = race.spline.pointAt(i / N);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const worldW = Math.max(1e-3, maxX - minX);
    const worldH = Math.max(1e-3, maxZ - minZ);
    // Uniform scale that fits the box into (size − 2·pad), preserving aspect.
    this.mmScale = Math.min((size - pad * 2) / worldW, (size - pad * 2) / worldH);
    this.mmOriginX = (minX + maxX) / 2;
    this.mmOriginZ = (minZ + maxZ) / 2;

    const base = document.createElement("canvas");
    base.width = size;
    base.height = size;
    const bctx = base.getContext("2d");
    if (!bctx) return;

    // Subtle backing plate so the map reads against any background.
    bctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    roundRect(bctx, 1, 1, size - 2, size - 2, 12);
    bctx.fill();

    // Road: one thick closed polyline in the track's ground color.
    const roadColor = race.trackDef.theme.groundColor;
    bctx.strokeStyle = roadColor;
    bctx.lineWidth = Math.max(3, race.trackDef.roadWidth * this.mmScale);
    bctx.lineJoin = "round";
    bctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = race.spline.pointAt((i % N) / N);
      const [sx, sy] = this.project(p.x, p.z);
      if (i === 0) bctx.moveTo(sx, sy);
      else bctx.lineTo(sx, sy);
    }
    bctx.closePath();
    bctx.stroke();

    // Start/finish marker: a short white tick across the road at t=0.
    const s = race.spline.pointAt(0);
    const tan = race.spline.tangentAt(0);
    const [sx, sy] = this.project(s.x, s.z);
    bctx.strokeStyle = "#ffffff";
    bctx.lineWidth = 2;
    bctx.beginPath();
    // Perpendicular to the tangent (swap x/z) for a cross-tick.
    bctx.moveTo(sx - tan.z * 6, sy + tan.x * 6);
    bctx.lineTo(sx + tan.z * 6, sy - tan.x * 6);
    bctx.stroke();

    this.minimapBase = base;
  }

  /** Project a world XZ point into minimap canvas pixels (centered on the track bbox). */
  private project(wx: number, wz: number): [number, number] {
    const size = 160;
    return [
      size / 2 + (wx - this.mmOriginX) * this.mmScale,
      size / 2 + (wz - this.mmOriginZ) * this.mmScale,
    ];
  }

  /** Blit the road base then stamp one dot per kart. Called every frame while Racing. */
  private drawMinimap(race: RaceController): void {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!this.minimapBase) this.buildMinimapBase(race);
    if (this.minimapBase) ctx.drawImage(this.minimapBase, 0, 0);

    for (const k of race.karts()) {
      const [sx, sy] = this.project(k.state.pos.x, k.state.pos.z);
      if (k.isPlayer) {
        // Player: white ring.
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // AI: filled dot in the character color (rgb 0..1 → CSS).
        const [r, g, b] = k.color;
        ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
