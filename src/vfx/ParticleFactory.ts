/**
 * ParticleFactory — all Phase 6 particle VFX (08-phase-6-vfx-audio-polish.md T3–T7).
 *
 * Systems:
 *   - boostFlames(kartId, tier)  cone at the kart rear, ~0.8 s, color by tier
 *   - shellExplosion(pos)        radial burst + point-light flash (peak → 0 over 150 ms)
 *   - confetti(pos)              multi-color gravity burst for the podium, self-disposes in 3 s
 *   - starSparkle / skidDust     continuous per-kart systems driven from KartVfxView flags
 *   - lightningFlash()           full-screen white overlay pulse + all-kart mesh shrink
 *
 * Architecture notes:
 *   - Implements the opaque IParticleVfx interface (core/GameStateMachine.ts) so core stays
 *     Babylon-free. main.ts constructs it and injects via GameApp.setParticleVfx().
 *   - v9 types `emitter` as `AbstractMesh | Vector3`, so kart-following systems use a
 *     WORLD-SPACE Vector3 emitter that update() re-syncs from the KartVfxView each frame —
 *     they are never parented to kart TransformNodes.
 *   - `Particle` has no custom/index-signature props, so per-particle state (the star-orbit
 *     phase angle) lives in a WeakMap<Particle, number>. Phases come from a golden-ratio
 *     counter (deterministic — no Math.random in the render layer).
 *   - Every magic number comes from TUNING.vfx; emit rates and burst counts are scaled by
 *     quality.budget() at creation time.
 *   - MESH SCALING ONLY for lightning: the top-speed/handling penalty is P5 logic — this is
 *     purely visual (08-phase-6 T6).
 */

import type {
  Scene} from "@babylonjs/core";
import {
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Particle,
} from "@babylonjs/core";
import type { EventBus, GameEvents } from "../core/EventBus.js";
import type { KartVfxView } from "../core/GameStateMachine.js";
import { TUNING } from "../data/tuning.js";
import type { QualityManager } from "../rendering/QualityManager.js";

/** One-shot effect: a particle system (plus optional light/sphere) that disposes at `expiresAt`. */
interface OneShot {
  readonly sys: ParticleSystem;
  /** Factory-clock seconds after which this entry is disposed. */
  expiresAt: number;
  /** When set, the emitter follows that kart's view each frame (boost flames). */
  followKartId?: string;
  flashLight?: PointLight;
  /** Shared start time for the light decay + sphere expansion tween. */
  startTime?: number;
  sphere?: { node: Mesh; mat: StandardMaterial; scaleTo: number };
}

/** Continuous per-kart system (star sparkle / skid dust), started/stopped from update(). */
interface ContinuousSystem {
  readonly sys: ParticleSystem;
  /** World-space emitter, re-synced each frame while active. */
  readonly emitterPos: Vector3;
}

export class ParticleFactory {
  private oneShots: OneShot[] = [];
  private starSystems = new Map<string, ContinuousSystem>();
  private dustSystems = new Map<string, ContinuousSystem>();
  /** Kart ids whose root mesh is currently scaled down by lightning (restored on end/dispose). */
  private shrunkKartIds = new Set<string>();

  private clock = 0;
  private unsubs: Array<() => void> = [];
  /** Deterministic star-orbit phase source (golden-ratio spacing, like ScreenShake's axis). */
  private starPhaseCounter = 0;

  // Lightning overlay state.
  private flashDiv: HTMLDivElement | null = null;
  private flashStartClock = -1;

  /** Latest per-kart view snapshot, refreshed every update() — used by event handlers. */
  private readonly lastViews = new Map<string, KartVfxView>();

  /** Shared soft-dot texture for all systems (radial white → transparent). App-lifetime:
   *  disposeAll() tears down systems but NOT this, since the factory outlives individual races. */
  private readonly dotTexture: DynamicTexture;

  constructor(
    private readonly scene: Scene,
    private readonly quality: QualityManager,
  ) {
    this.dotTexture = ParticleFactory.makeDotTexture(scene);
  }

  // ── IParticleVfx ────────────────────────────────────────────────────────

  /** Subscribe to VFX-driving bus events. Idempotent — re-attach detaches first. */
  attach(bus: EventBus<GameEvents>): void {
    this.detach();
    this.unsubs.push(
      bus.on("kart:boosted", (p) => {
        const view = this.viewFor(p.kartId);
        if (view) this.boostFlames(view, p.tier);
      }),
      bus.on("kart:hit", (p) => {
        const view = this.viewFor(p.kartId);
        if (view) this.shellExplosion(new Vector3(view.pos.x, view.pos.y, view.pos.z));
      }),
      bus.on("item:used", (p) => {
        // Star sparkle is driven by the per-frame `starred` poll in update() (the effect's END
        // is not a bus event — 08-phase-6 T5). Lightning flashes immediately on use.
        if (p.item === "lightning") this.lightningFlash();
      }),
    );
  }

  /** Detach bus subscriptions (kept separate so attach() can be idempotent). */
  private detach(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
  }

  /** Per-frame tick: sync emitters, drive continuous systems, expire one-shots, run the flash. */
  update(dt: number, karts: ReadonlyArray<KartVfxView>): void {
    this.clock += dt;
    for (const v of karts) this.lastViews.set(v.id, v);

    // One-shots: sync follow-emitters, decay flash lights / expand glow spheres, expire.
    for (let i = this.oneShots.length - 1; i >= 0; i--) {
      const os = this.oneShots[i];
      if (os.followKartId) {
        const view = this.lastViews.get(os.followKartId);
        if (view && os.sys.emitter instanceof Vector3) ParticleFactory.rearOffset(view, os.sys.emitter);
      }
      if (os.flashLight && os.startTime !== undefined) {
        const tMs = (this.clock - os.startTime) * 1000;
        os.flashLight.intensity = Math.max(
          0,
          TUNING.vfx.shellFlashPeakIntensity * (1 - tMs / TUNING.vfx.shellFlashDecayMs),
        );
      }
      if (os.sphere && os.startTime !== undefined) {
        const t01 = Math.min(1, (this.clock - os.startTime) / TUNING.vfx.shellExplosionLifetimeSec);
        os.sphere.node.scaling.setAll(0.5 + (os.sphere.scaleTo - 0.5) * t01);
        os.sphere.mat.alpha = 0.85 * (1 - t01);
      }
      if (this.clock >= os.expiresAt) {
        this.disposeOneShot(os);
        this.oneShots.splice(i, 1);
      }
    }

    // Star sparkle: start/stop per kart from the polled `starred` flag.
    for (const v of karts) {
      const existing = this.starSystems.get(v.id);
      if (v.starred && !existing) {
        this.startStarSparkle(v);
      } else if (!v.starred && existing) {
        this.stopContinuous(this.starSystems, v.id);
      } else if (existing) {
        existing.emitterPos.set(v.pos.x, v.pos.y + 0.4, v.pos.z);
      }
    }

    // Skid dust: start/stop per kart from offRoad && |speed| > skidMinSpeed.
    for (const v of karts) {
      const existing = this.dustSystems.get(v.id);
      const shouldDust = v.offRoad && Math.abs(v.speed) > TUNING.vfx.skidMinSpeed;
      if (shouldDust && !existing) {
        this.startSkidDust(v);
      } else if (!shouldDust && existing) {
        this.stopContinuous(this.dustSystems, v.id);
      } else if (existing) {
        ParticleFactory.rearOffset(v, existing.emitterPos);
      }
    }

    // Lightning shrink: scale every kart root while its `shrunk` flag is set; restore otherwise.
    for (const v of karts) {
      const root = this.scene.getTransformNodeByName(`${v.id}-kart-root`);
      if (!root) continue;
      if (v.shrunk) {
        root.scaling.setAll(TUNING.vfx.lightningShrinkScale);
        this.shrunkKartIds.add(v.id);
      } else if (this.shrunkKartIds.has(v.id)) {
        root.scaling.setAll(1);
        this.shrunkKartIds.delete(v.id);
      }
    }

    // Lightning overlay fade.
    if (this.flashDiv && this.flashStartClock >= 0) {
      const t = this.clock - this.flashStartClock;
      const durSec = TUNING.vfx.lightningFlashMs / 1000;
      if (t >= durSec) {
        this.removeFlashDiv();
      } else {
        this.flashDiv.style.opacity = String(1 - t / durSec);
      }
    }
  }

  /** Tear down every live system + the overlay. Called on scene exit / quit-to-menu. */
  disposeAll(): void {
    for (const os of this.oneShots) this.disposeOneShot(os);
    this.oneShots = [];
    for (const id of [...this.starSystems.keys()]) this.stopContinuous(this.starSystems, id);
    for (const id of [...this.dustSystems.keys()]) this.stopContinuous(this.dustSystems, id);
    // Restore any kart meshes still scaled down.
    for (const id of this.shrunkKartIds) {
      const root = this.scene.getTransformNodeByName(`${id}-kart-root`);
      if (root) root.scaling.setAll(1);
    }
    this.shrunkKartIds.clear();
    this.removeFlashDiv();
    this.detach();
  }

  // ── T3 — boostFlames ────────────────────────────────────────────────────

  /** Cone emitter at the kart rear, ~0.8 s, color by tier (mini/super/shroom/start). */
  boostFlames(view: KartVfxView, tier: "mini" | "super" | "shroom" | "start"): void {
    const budget = this.quality.budget();
    const rate = Math.max(1, Math.round(TUNING.vfx.boostEmitRatePerSec * budget));
    const sys = new ParticleSystem(`boost-${view.id}`, rate, this.scene);

    const emitterPos = new Vector3();
    ParticleFactory.rearOffset(view, emitterPos);
    sys.emitter = emitterPos;

    // Cone pointing backward (opposite heading) with a slight upward tilt.
    const back = new Vector3(-Math.sin(view.heading), 0.35, -Math.cos(view.heading));
    sys.direction1 = back.scale(0.8);
    sys.direction2 = back.scale(1.2);
    sys.minEmitPower = 2;
    sys.maxEmitPower = 4;
    const box = 0.1;
    sys.minEmitBox = new Vector3(-box, -box, -box);
    sys.maxEmitBox = new Vector3(box, box, box);

    sys.minLifeTime = 0.25;
    sys.maxLifeTime = 0.45;
    sys.minSize = 0.12;
    sys.maxSize = 0.3;
    sys.blendMode = ParticleSystem.BLENDMODE_ADD;
    sys.particleTexture = this.dotTexture;

    const [c1, c2] = boostColors(tier);
    sys.color1 = c1;
    sys.color2 = c2;
    sys.addColorGradient(0, c1);
    sys.addColorGradient(1, new Color4(c1.r * 0.6, c1.g * 0.6, c1.b * 0.6, 0));

    sys.start();
    this.oneShots.push({
      sys,
      expiresAt: this.clock + TUNING.vfx.boostDurationSec,
      followKartId: view.id,
    });
  }

  // ── T4 — shellExplosion ─────────────────────────────────────────────────

  /** Radial burst at the impact point + a brief point-light flash (peak → 0 over 150 ms). */
  shellExplosion(pos: Vector3): void {
    const budget = this.quality.budget();
    const count = Math.max(4, Math.round(TUNING.vfx.shellExplosionBurstCount * budget));
    const sys = new ParticleSystem(`shell-${this.clock.toFixed(2)}`, count, this.scene);
    sys.emitter = pos.clone();

    // Radial burst: emit everything at once in all directions.
    sys.manualEmitCount = count;
    sys.emitRate = 0;
    const dir = new Vector3(1, 1, 1);
    sys.direction1 = dir.scale(-1);
    sys.direction2 = dir.clone();
    sys.minEmitPower = 3;
    sys.maxEmitPower = 6;
    const box = 0.15;
    sys.minEmitBox = new Vector3(-box, -box, -box);
    sys.maxEmitBox = new Vector3(box, box, box);

    sys.minLifeTime = 0.3;
    sys.maxLifeTime = TUNING.vfx.shellExplosionLifetimeSec;
    sys.minSize = 0.15;
    sys.maxSize = 0.4;
    sys.blendMode = ParticleSystem.BLENDMODE_ADD;
    sys.particleTexture = this.dotTexture;

    const hot = new Color4(1, 0.85, 0.3, 1);
    sys.color1 = hot;
    sys.color2 = new Color4(1, 0.5, 0.1, 1);
    sys.addColorGradient(0, hot);
    sys.addColorGradient(1, new Color4(0.8, 0.3, 0.05, 0));

    // Point-light flash: peak intensity → 0 over shellFlashDecayMs (decayed in update()).
    const light = new PointLight(`shellflash-${this.clock.toFixed(2)}`, pos.clone(), this.scene);
    light.intensity = TUNING.vfx.shellFlashPeakIntensity;
    light.range = 12;

    // Expanding glow sphere for a readable pop (render-only, disposed with the one-shot).
    const mat = new StandardMaterial(`shellflashmat-${this.clock.toFixed(2)}`, this.scene);
    mat.emissiveColor.set(1, 0.7, 0.25);
    mat.disableLighting = true;
    mat.alpha = 0.85;
    const node = MeshBuilder.CreateSphere(`shellsphere-${this.clock.toFixed(2)}`, { diameter: 0.5, segments: 8 }, this.scene);
    node.position.copyFrom(pos);
    node.material = mat;

    sys.start();
    this.oneShots.push({
      sys,
      expiresAt: this.clock + TUNING.vfx.shellExplosionLifetimeSec,
      flashLight: light,
      startTime: this.clock,
      sphere: { node, mat, scaleTo: 1.6 },
    });
  }

  // ── T7 — confetti ───────────────────────────────────────────────────────

  /** Multi-color gravity burst for the podium; self-disposes after confettiLifetimeSec. */
  confetti(pos: Vector3): void {
    const budget = this.quality.budget();
    const count = Math.max(8, Math.round(TUNING.vfx.confettiBurstCount * budget));
    const sys = new ParticleSystem(`confetti-${this.clock.toFixed(2)}`, count, this.scene);
    sys.emitter = pos.clone();

    sys.manualEmitCount = count;
    sys.emitRate = 0;
    const dir = new Vector3(1, 1.5, 1);
    sys.direction1 = dir.scale(-1);
    sys.direction2 = dir.clone();
    sys.minEmitPower = 4;
    sys.maxEmitPower = 7;
    const box = 0.3;
    sys.minEmitBox = new Vector3(-box, -box, -box);
    sys.maxEmitBox = new Vector3(box, box, box);

    sys.minLifeTime = 2;
    sys.maxLifeTime = TUNING.vfx.confettiLifetimeSec;
    sys.minSize = 0.06;
    sys.maxSize = 0.14;
    sys.gravity = new Vector3(0, -9.8, 0);
    sys.blendMode = ParticleSystem.BLENDMODE_STANDARD; // paper, not glow
    sys.particleTexture = this.dotTexture;

    // Multi-color via a gradient across the particle's life (red→yellow→green→blue→pink).
    const stops: Array<[number, Color4]> = [
      [0.0, new Color4(1, 0.2, 0.25, 1)],
      [0.25, new Color4(1, 0.85, 0.2, 1)],
      [0.5, new Color4(0.3, 0.9, 0.35, 1)],
      [0.75, new Color4(0.3, 0.5, 1, 1)],
      [1.0, new Color4(1, 0.4, 0.85, 1)],
    ];
    for (const [g, c] of stops) sys.addColorGradient(g, c);

    sys.start();
    this.oneShots.push({ sys, expiresAt: this.clock + TUNING.vfx.confettiLifetimeSec });
  }

  // ── T5 — starSparkle (continuous) ───────────────────────────────────────

  private startStarSparkle(view: KartVfxView): void {
    const budget = this.quality.budget();
    const rate = Math.max(1, Math.round(TUNING.vfx.starSparkleEmitRatePerSec * budget));
    const sys = new ParticleSystem(`star-${view.id}`, rate, this.scene);

    const emitterPos = new Vector3(view.pos.x, view.pos.y + 0.4, view.pos.z);
    sys.emitter = emitterPos;

    // Emission is irrelevant to position (updateFunction overrides it) but must be valid.
    sys.direction1 = new Vector3(0, 1, 0);
    sys.direction2 = new Vector3(0, 1, 0);
    sys.minEmitPower = 0;
    sys.maxEmitPower = 0;
    const box = 0.05;
    sys.minEmitBox = new Vector3(-box, -box, -box);
    sys.maxEmitBox = new Vector3(box, box, box);

    sys.minLifeTime = TUNING.vfx.starParticleLifeSec;
    sys.maxLifeTime = TUNING.vfx.starParticleLifeSec;
    sys.minSize = 0.05;
    sys.maxSize = 0.12;
    sys.blendMode = ParticleSystem.BLENDMODE_ADD;
    sys.particleTexture = this.dotTexture;

    const gold = new Color4(1, 0.95, 0.5, 1);
    sys.color1 = gold;
    sys.color2 = new Color4(1, 0.8, 0.3, 1);
    sys.addColorGradient(0, gold);
    sys.addColorGradient(1, new Color4(1, 0.9, 0.4, 0));

    // Orbit: one full revolution per lifetime around the kart center (world space).
    const radius = TUNING.vfx.starSparkleRadiusM;
    const phase = new WeakMap<Particle, number>();
    sys.updateFunction = (particles) => {
      for (const p of particles) {
        let a = phase.get(p);
        if (a === undefined) {
          // Golden-ratio spacing — deterministic, well-spread orbit phases.
          a = (this.starPhaseCounter++ * 2.39996) % (Math.PI * 2);
          phase.set(p, a);
        }
        const age01 = Math.min(1, p.age / sys.maxLifeTime);
        const angle = a + age01 * Math.PI * 2;
        p.position.x = emitterPos.x + Math.cos(angle) * radius;
        p.position.z = emitterPos.z + Math.sin(angle) * radius;
        p.position.y = emitterPos.y + 0.5 + Math.sin(age01 * Math.PI) * 0.3;
      }
    };

    sys.start();
    this.starSystems.set(view.id, { sys, emitterPos });
  }

  // ── T7 — skidDust (continuous) ──────────────────────────────────────────

  private startSkidDust(view: KartVfxView): void {
    const budget = this.quality.budget();
    const rate = Math.max(1, Math.round(TUNING.vfx.skidDustEmitRatePerSec * budget));
    const sys = new ParticleSystem(`dust-${view.id}`, rate, this.scene);

    const emitterPos = new Vector3();
    ParticleFactory.rearOffset(view, emitterPos);
    sys.emitter = emitterPos;

    // Small puffs drifting up/back from the rear axle.
    sys.direction1 = new Vector3(-0.5, 1, -0.5);
    sys.direction2 = new Vector3(0.5, 2, 0.5);
    sys.minEmitPower = 0.5;
    sys.maxEmitPower = 1.5;
    const boxX = 0.4; // lateral spread across the rear axle
    const boxY = 0.1;
    const boxZ = 0.2;
    sys.minEmitBox = new Vector3(-boxX, -boxY, -boxZ);
    sys.maxEmitBox = new Vector3(boxX, boxY, boxZ);

    sys.minLifeTime = 0.3;
    sys.maxLifeTime = 0.6;
    sys.minSize = 0.15;
    sys.maxSize = 0.35;
    sys.blendMode = ParticleSystem.BLENDMODE_STANDARD; // dusty, not glow
    sys.particleTexture = this.dotTexture;

    const brown = new Color4(0.55, 0.42, 0.28, 1);
    sys.color1 = brown;
    sys.color2 = new Color4(0.45, 0.34, 0.22, 1);
    sys.addColorGradient(0, brown);
    sys.addColorGradient(1, new Color4(0.5, 0.4, 0.28, 0));

    sys.start();
    this.dustSystems.set(view.id, { sys, emitterPos });
  }

  // ── T6 — lightningFlash ─────────────────────────────────────────────────

  /** Full-screen white overlay pulse (120 ms). Kart shrink is driven per-frame from `shrunk`. */
  lightningFlash(): void {
    if (!this.flashDiv) {
      const div = document.createElement("div");
      div.style.position = "fixed";
      div.style.inset = "0";
      div.style.background = "#ffffff";
      div.style.pointerEvents = "none";
      div.style.zIndex = "9999";
      div.style.opacity = "1";
      document.body.appendChild(div);
      this.flashDiv = div;
    } else {
      this.flashDiv.style.display = "block";
      this.flashDiv.style.opacity = "1";
    }
    this.flashStartClock = this.clock;
  }

  private removeFlashDiv(): void {
    if (this.flashDiv) {
      this.flashDiv.remove();
      this.flashDiv = null;
    }
    this.flashStartClock = -1;
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * Best-effort view for a kart id: the last polled snapshot, or (before the first update)
   * a fallback read from the kart's root TransformNode so early events still get VFX.
   */
  private viewFor(kartId: string): KartVfxView | null {
    const cached = this.lastViews.get(kartId);
    if (cached) return cached;
    const root = this.scene.getTransformNodeByName(`${kartId}-kart-root`);
    if (!root) return null;
    return {
      id: kartId,
      pos: { x: root.position.x, y: root.position.y, z: root.position.z },
      heading: root.rotation.y,
      speed: 0,
      offRoad: false,
      starred: false,
      shrunk: false,
    };
  }

  /** World-space position `boostFlameRearOffsetM` behind the kart center along its heading. */
  private static rearOffset(view: KartVfxView, out: Vector3): void {
    const fx = Math.sin(view.heading);
    const fz = Math.cos(view.heading);
    const off = TUNING.vfx.boostFlameRearOffsetM;
    out.set(view.pos.x - fx * off, view.pos.y + 0.25, view.pos.z - fz * off);
  }

  private stopContinuous(map: Map<string, ContinuousSystem>, kartId: string): void {
    const cs = map.get(kartId);
    if (cs) {
      // disposeTexture=false — the dot texture is shared across all systems.
      cs.sys.dispose(false);
      map.delete(kartId);
    }
  }

  private disposeOneShot(os: OneShot): void {
    // disposeTexture=false — the dot texture is shared across all systems.
    os.sys.dispose(false);
    if (os.flashLight) os.flashLight.dispose();
    if (os.sphere) {
      os.sphere.node.dispose();
      os.sphere.mat.dispose(false); // keep the shared dot texture alive
    }
  }

  /** Soft radial dot texture shared by every system. */
  private static makeDotTexture(scene: Scene): DynamicTexture {
    const size = 64;
    const tex = new DynamicTexture("vfx-dot", { width: size, height: size }, scene, false);
    const ctx = tex.getContext();
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    tex.update();
    return tex;
  }
}

/** Tier → (start color, end color) for boost flames. */
function boostColors(tier: "mini" | "super" | "shroom" | "start"): [Color4, Color4] {
  switch (tier) {
    case "mini": // white sparks
      return [new Color4(1, 1, 1, 1), new Color4(0.9, 0.95, 1, 1)];
    case "super": // blue-white
      return [new Color4(0.6, 0.8, 1, 1), new Color4(0.3, 0.5, 1, 1)];
    case "shroom": // orange
      return [new Color4(1, 0.6, 0.2, 1), new Color4(1, 0.35, 0.1, 1)];
    case "start": // white-gold (perfect start boost)
      return [new Color4(1, 0.95, 0.7, 1), new Color4(1, 0.8, 0.3, 1)];
  }
}
