/**
 * ChargeIndicator — render-layer "item loaded on the kart" billboard (Phase 5.1).
 *
 * While the player holds the item button with a chargeable item (green/red shell,
 * banana), a small icon plane hovers at the kart's rear so the player can see the
 * item is attached and will launch on release. Render-only: it reads
 * `kart.state.charging` (owned by the RaceController) and reuses the HUD's
 * `drawItemIcon` for the icon art.
 *
 * The icon is drawn into a private offscreen HTMLCanvasElement (a real 2D context,
 * so `drawItemIcon` type-checks) and blitted into a DynamicTexture — Babylon v9's
 * `DynamicTexture.getContext()` returns an `ICanvasRenderingContext`, which is not
 * a `CanvasRenderingContext2D` and can't be passed to `drawItemIcon` directly.
 */

import { DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";
import { TUNING } from "../data/tuning.js";
import type { KartEntity } from "../entities/KartEntity.js";
import type { ItemId } from "../entities/KartPhysics.js";
import { drawItemIcon } from "../ui/Hud.js";

/** Icon plane size in meters. */
const PLANE_SIZE = 0.7;
/** Height above the kart's ground Y where the icon hovers. */
const HOVER_HEIGHT = 1.1;
/** Icon canvas size (matches drawItemIcon's 64px design space). */
const ICON_SIZE = 64;
/** Mesh.billboardMode value for Y-axis billboarding (BILLBOARDMODE_Y). */
const BILLBOARD_Y = 2;

export class ChargeIndicator {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  /** Offscreen canvas holding the icon art (real 2D context for drawItemIcon). */
  private readonly iconCanvas: HTMLCanvasElement;
  private readonly iconCtx: CanvasRenderingContext2D;
  /** Last item painted into the texture — repaint only on change. */
  private lastDrawn: ItemId | null = null;

  constructor(scene: Scene) {
    this.iconCanvas = document.createElement("canvas");
    this.iconCanvas.width = ICON_SIZE;
    this.iconCanvas.height = ICON_SIZE;
    const ctx = this.iconCanvas.getContext("2d");
    if (!ctx) throw new Error("ChargeIndicator: 2D canvas context unavailable");
    this.iconCtx = ctx;

    this.texture = new DynamicTexture("charge-indicator-tex", { width: ICON_SIZE, height: ICON_SIZE }, scene, false);
    this.material = new StandardMaterial("charge-indicator-mat", scene);
    this.material.diffuseTexture = this.texture;
    this.material.disableLighting = true;
    this.material.backFaceCulling = false; // visible from any side (billboard Y still faces the camera)
    this.mesh = MeshBuilder.CreatePlane("charge-indicator", { size: PLANE_SIZE }, scene);
    this.mesh.material = this.material;
    this.mesh.billboardMode = BILLBOARD_Y;
    this.mesh.setEnabled(false);
  }

  /** Show the charging item's icon at the player kart's rear; hide otherwise. */
  update(karts: ReadonlyArray<KartEntity>, _dt: number): void {
    const player = karts.find((k) => k.isPlayer);
    const charging = player?.state.charging ?? null;
    if (!player || charging === null) {
      if (this.mesh.isEnabled()) this.mesh.setEnabled(false);
      this.lastDrawn = null;
      return;
    }

    // Repaint the icon only when the charging item changes, then blit into the texture.
    if (charging !== this.lastDrawn) {
      drawItemIcon(this.iconCtx, charging);
      const tctx = this.texture.getContext();
      tctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      tctx.drawImage(this.iconCanvas, 0, 0, ICON_SIZE, ICON_SIZE);
      this.texture.update();
      this.lastDrawn = charging;
    }

    // Hover at the kart's rear (the same offset the shell launches from), above the body.
    const s = player.state;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const off = TUNING.items.shellLaunchOffsetM;
    this.mesh.position.set(s.pos.x - fx * off, s.pos.y + HOVER_HEIGHT, s.pos.z - fz * off);
    if (!this.mesh.isEnabled()) this.mesh.setEnabled(true);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
