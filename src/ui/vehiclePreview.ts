/**
 * vehiclePreview — 2D canvas side-view silhouettes for the vehicle-select cards.
 *
 * A cheap stand-in for a 3D render in the menu: each card gets a ~160×90 canvas
 * painted with a stylized side profile of its vehicle type (kart / bike / ATV),
 * body tinted by an accent color. Pure DOM/canvas — no Babylon imports, so it
 * stays testable headless and keeps the menu screens render-engine-free.
 */

import type { VehicleType } from "../entities/vehicleModels.js";

/** Canvas logical size (CSS scales it to fit the card). */
export const PREVIEW_W = 160;
export const PREVIEW_H = 90;

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#14161c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "#8b93a5";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "#2a2e3a";
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawKart(ctx: CanvasRenderingContext2D, accent: string): void {
  const groundY = 70;
  // Body (low slab) + nose taper.
  ctx.fillStyle = accent;
  roundRect(ctx, 35, 48, 90, 16, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(125, 50);
  ctx.lineTo(140, 56);
  ctx.lineTo(140, 62);
  ctx.lineTo(125, 64);
  ctx.closePath();
  ctx.fill();
  // Seat + backrest.
  ctx.fillStyle = "#232838";
  roundRect(ctx, 52, 38, 30, 12, 4);
  ctx.fill();
  roundRect(ctx, 46, 26, 8, 16, 3);
  ctx.fill();
  // Roll hoop.
  ctx.strokeStyle = "#232838";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(50, 34, 12, Math.PI * 0.9, Math.PI * 1.9);
  ctx.stroke();
  // Headlight / taillight dots.
  ctx.fillStyle = "#fff6c8";
  ctx.fillRect(137, 55, 4, 4);
  ctx.fillStyle = "#ff5a4d";
  ctx.fillRect(34, 52, 4, 4);
  // Wheels (side view: two visible).
  wheel(ctx, 58, groundY - 10, 13);
  wheel(ctx, 112, groundY - 10, 13);
}

function drawBike(ctx: CanvasRenderingContext2D, accent: string): void {
  const groundY = 70;
  // Frame spine (slim) + tank.
  ctx.fillStyle = accent;
  roundRect(ctx, 45, 46, 70, 10, 5);
  ctx.fill();
  roundRect(ctx, 62, 38, 26, 12, 5);
  ctx.fill();
  // Handlebar.
  ctx.strokeStyle = "#232838";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(108, 46);
  ctx.lineTo(116, 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(108, 30);
  ctx.lineTo(124, 30);
  ctx.stroke();
  // Seat.
  ctx.fillStyle = "#232838";
  roundRect(ctx, 46, 40, 22, 7, 3);
  ctx.fill();
  // Headlight / taillight dots.
  ctx.fillStyle = "#fff6c8";
  ctx.fillRect(112, 44, 4, 4);
  ctx.fillStyle = "#ff5a4d";
  ctx.fillRect(43, 47, 4, 4);
  // Wheels: smaller front, wider rear.
  wheel(ctx, 108, groundY - 9, 12);
  wheel(ctx, 56, groundY - 10, 14);
}

function drawAtv(ctx: CanvasRenderingContext2D, accent: string): void {
  const groundY = 70;
  // Wide boxy body.
  ctx.fillStyle = accent;
  roundRect(ctx, 30, 46, 100, 18, 5);
  ctx.fill();
  // Front bumper.
  ctx.fillStyle = "#232838";
  ctx.fillRect(128, 52, 6, 10);
  // Roll cage (side profile: two posts + crossbar).
  ctx.strokeStyle = "#232838";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(52, 46);
  ctx.lineTo(52, 24);
  ctx.lineTo(92, 24);
  ctx.lineTo(92, 46);
  ctx.stroke();
  // Seat.
  ctx.fillStyle = "#232838";
  roundRect(ctx, 56, 40, 30, 7, 3);
  ctx.fill();
  // Headlight / taillight dots.
  ctx.fillStyle = "#fff6c8";
  ctx.fillRect(126, 50, 4, 4);
  ctx.fillStyle = "#ff5a4d";
  ctx.fillRect(29, 50, 4, 4);
  // Chunky wheels.
  wheel(ctx, 54, groundY - 13, 16);
  wheel(ctx, 108, groundY - 13, 16);
}

/** Paint the side-view silhouette for a vehicle type onto `canvas`. */
export function drawVehiclePreview(canvas: HTMLCanvasElement, type: VehicleType, accent: [number, number, number]): void {
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Backdrop: subtle vertical gradient + ground line.
  const grad = ctx.createLinearGradient(0, 0, 0, PREVIEW_H);
  grad.addColorStop(0, "#1b2334");
  grad.addColorStop(1, "#10151f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, 74);
  ctx.lineTo(PREVIEW_W - 8, 74);
  ctx.stroke();

  const accentColor = rgb(accent);
  switch (type) {
    case "bike":
      drawBike(ctx, accentColor);
      break;
    case "atv":
      drawAtv(ctx, accentColor);
      break;
    case "kart":
    default:
      drawKart(ctx, accentColor);
      break;
  }
}
