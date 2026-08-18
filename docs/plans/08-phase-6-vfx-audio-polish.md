# Phase 6 — Graphics, VFX, Audio & Second Map

> **Execution guide for Phase 6.** Forward-looking: nothing in this phase is implemented yet. Depends on Phases 1–5 being complete (full race with all items works headlessly and in-browser; `QualityManager` presets exist from P3; the `RenderPipelineSetup` interface contract was defined in P3 but **not implemented** — that implementation is task T1 here). Source of truth: [`00-overview.md`](./00-overview.md) §7 (P6 row) and [`01-architecture.md`](./01-architecture.md) §2, §5, §10.

## Goal

Make the game *look and sound* like a finished product without changing any gameplay rules: implement the P3 render-pipeline contract (procedural skybox, per-map lighting rig, fog, quality-gated post stack), build every particle VFX system wired to existing bus events, replace Phase 4's stub music loops with real step-sequenced chiptune themes, complete the synthesized SFX catalog including a speed-reactive engine loop, populate both maps from their `propCatalog` data (P2) using instanced meshes, verify **Lava Lagoon Loop** end-to-end (oil slicks + narrow bridge via a new per-segment `widthOverride`), and fill in the P4 podium hook with animation, confetti and fanfare. Exit gate: [`00-overview.md`](./00-overview.md) §7 P6 row — manual playtest checklist passed on **both maps at each quality preset**, plus the unit tests in [Test list](#test-list).

**Hard rules for this phase:**
- No gameplay logic changes. The lightning speed penalty, star invincibility etc. already live in P5 logic; everything here is *visual/audio only*. If a VFX needs a number (duration, intensity), it goes in `src/data/tuning.ts` under a new `vfx`/`audio` section — never hardcoded.
- Every particle count / emit rate multiplies by `QualityManager.budget()` (see [`01-architecture.md`](./01-architecture.md) §10). Never hardcode counts.
- Pure logic files stay Babylon-free (`src/vfx`, `src/rendering` are allowed folders per the convention in [`01-architecture.md`](./01-architecture.md) §7; audio modules use WebAudio only, no Babylon imports).

## Files to create / modify (table: path | purpose)

| Path | Purpose |
|---|---|
| `src/rendering/RenderPipelineSetup.ts` | **Create.** Implements the P3 contract: procedural gradient skybox, per-map lighting rig + accent lights, EXP2 fog, quality-gated post stack (bloom / SSAO / color grade / FXAA), preset-dependent shadow generator. Exposes idempotent `applyTheme(track.theme)`. |
| `src/vfx/ParticleFactory.ts` | **Create.** All particle systems: boost flames, shell explosion, star sparkle, lightning flash overlay + shrink tween, confetti, skid dust. create/update/dispose lifecycle driven by bus events. |
| `src/audio/MusicSequencer.ts` | **Modify (replace P4 stub loops).** Lookahead note scheduler + three data-defined chiptune themes (menu / meadows race / lagoon race) + 300 ms crossfade on theme switch + results fanfare. |
| `src/audio/SfxPlayer.ts` | **Modify (complete catalog).** All one-shot synthesized SFX + continuous speed-reactive engine loop; pure helper `enginePitchFor(speedRatio)` extracted for unit testing. |
| `src/tracks/PropBuilder.ts` | **Create.** Reads `track.propCatalog`, builds one `InstancedMesh` per prop kind placed via `spline.placeAlongSpline(t, lateralOffset)`; density scaled by preset prop-density %. |
| `src/data/tuning.ts` | **Modify.** Add `vfx: { ... }` and `audio: { enginePitchMin/Max, musicBpm..., crossfadeMs }` sections. All new magic numbers live here. |
| `src/data/tracks/greenhollow-meadows.ts` | **Modify.** Optional per-segment `widthOverride` entries (meadows: none needed — uniform width; add empty array or omit). Verify prop lateral offsets respect road half-width. |
| `src/data/tracks/lava-lagoon-loop.ts` | **Modify.** Add bridge segment `{ tStart: ~0.48, tEnd: ~0.52, widthOverride: 6 }` (base `roadWidth` is 10 m). Verify oil-slick hazard placements and prop offsets. |
| `src/tracks/TrackSpline.ts` / `src/tracks/TrackBuilder.ts` | **Modify.** Support per-segment `widthOverride`: spline exposes `halfWidthAt(t)`; ribbon mesh varies width across the bridge span; barriers on the bridge are taller with no off-road (cliff void plane below). |
| `src/ui/ResultsScreen.ts` | **Modify.** Fill P4's `onPodiumReady(standings)` hook: podium boxes, kart drive-up tween + bounce step-up, confetti burst, fanfare trigger, P1 spotlight. |
| `src/main.ts` / scene wiring | **Modify.** Instantiate `RenderPipelineSetup`, `ParticleFactory`, real `MusicSequencer`/`SfxPlayer`; call `applyTheme(track.theme)` when entering a map scene; extend `window.__game` with `fpsHistory()` (used by P7, added here since the render loop is final). |
| `tests/unit/musicSequencer.test.ts` | **Create.** Scheduler math + loop-wrap tests. |
| `tests/unit/sfxPlayer.test.ts` | **Create.** `enginePitchFor` monotonicity/mapping tests. |
| `tests/unit/propBuilder-data.test.ts` | **Create.** Catalog coverage + road-clearance data tests for both maps. |

## Interfaces & signatures (full TS code blocks; reference the P3-defined contract from 01-architecture.md §10)

The P3 contract ([`01-architecture.md`](./01-architecture.md) §2 folder layout, `rendering/RenderPipelineSetup.ts`: "procedural gradient skybox, per-map lighting rig + fog, bloom + SSAO + color grading"; preset table in §10) is implemented as:

```ts
// src/rendering/RenderPipelineSetup.ts
import type { TrackTheme } from "../data/tracks/types.js"; // theme: skyGradient [top,bottom] hex, fogColor, fogDensity, sun/hemi colors + direction, accentLights[]

export interface RenderPipelineDeps {
  scene: Scene;                       // @babylonjs/core — allowed folder
  qualityManager: QualityManager;     // P3: preset table from 01-architecture.md §10
}

/** Implements the Phase 3 render-pipeline contract. */
export class RenderPipelineSetup {
  constructor(deps: RenderPipelineDeps);

  /**
   * (a) Procedural gradient skybox — large inverted sphere (diameter ~2000, sideBack)
   *     with a DynamicTexture vertical gradient painted from theme.skyGradient.
   * (b) Per-map lighting rig — hemispheric + directional sun (theme colors/direction),
   *     shadow generator on the directional light at preset-dependent resolution
   *     (off / 1024 / 2048 per §10), plus 2–4 accent point lights from theme.accentLights
   *     (e.g. lagoon: orange lava glow under the bridge).
   * (c) Fog — scene.fogMode = FOGMODE_EXP2, theme fog color + density.
   * (d) Post stack via DefaultRenderingPipeline gated by preset:
   *       bloom  intensity ~0.35, threshold ~0.8  → on Medium/High only (§10 "Bloom / color grade")
   *       SSAO                                   → on Medium (half res) / High only
   *       ImageProcessingConfiguration           → contrast 1.05, saturation 1.2 (stylized cartoon look), Medium/High
   *       FXAA                                   → Low preset only (cheap AA stand-in)
   * (e) Idempotent: calling twice with the same theme is a no-op; calling with a new
   *     theme disposes old skybox/light/post objects and rebuilds. Called when entering
   *     a map scene (Countdown enter).
   */
  applyTheme(theme: TrackTheme): void;

  /** Re-apply current theme's post stack + shadow resolution after a live quality change. */
  onQualityChanged(preset: QualityPreset): void;

  dispose(): void; // called on quit-to-menu (feeds P7 disposal tests)
}
```

```ts
// src/vfx/ParticleFactory.ts — every system reads QualityManager.budget() for emitRate/capacity
export type VfxSystemId = "boostFlames" | "shellExplosion" | "starSparkle" | "lightningFlash" | "confetti" | "skidDust";

export class ParticleFactory {
  constructor(scene: Scene, qualityManager: QualityManager, bus: EventBus<GameEvents>);

  // One-shot systems (self-disposing after their lifetime):
  boostFlames(kartId: KartId, tier: "mini" | "super" | "shroom"): void;   // cone emitter at kart rear, 0.8 s
  shellExplosion(pos: Vec3): void;                                        // radial burst + brief point-light flash
  confetti(pos: Vec3): void;                                              // results podium bursts

  // Continuous systems (create/update/dispose lifecycle tied to effect begin/end):
  starSparkle(kartId: KartId): void;        // orbiting sparkles, emitter parented to kart mesh
  stopStarSparkle(kartId: KartId): void;
  skidDust(kartId: KartId): void;           // small brown puffs while off-road at speed (per-frame gate)
  stopSkidDust(kartId: KartId): void;

  /** Full-screen white overlay div opacity pulse (~120 ms) + all-karts scale tween to 0.6 and back
   *  over the shrink duration. MESH SCALING ONLY — no physics change (the speed penalty is P5 logic). */
  lightningFlash(): void;

  /** Subscribes internally: item:used, kart:boosted, kart:hit, race:finished, kart:skid. */
  attach(bus: EventBus<GameEvents>): void;
  disposeAll(): void; // disposes every live system + overlay (quit-to-menu / race end)
}
```

```ts
// src/audio/MusicSequencer.ts — replaces P4 stub loops
export type MusicChannel = "lead" | "bass" | "noise-hat";   // square / sawtooth / filtered noise
export interface NoteEvent { timeInBeats: number; midiNote: number; durationBeats: number; channel: MusicChannel }
export type ThemeId = "menu" | "meadowsRace" | "lagoonRace" | "fanfare";

/** Injectable clock for unit tests (production passes audioContext). */
export interface AudioClock { readonly currentTime: number; setInterval(fn: () => void, ms: number): unknown; clearInterval(h?: unknown): void }

export class MusicSequencer {
  constructor(audioManager: AudioManager, clock?: AudioClock); // default: real AudioContext wrapper
  playTheme(id: ThemeId): void;          // crossfades out current (300 ms) while fading in new
  stopAll(): void;
}

// Pure, exported for tests — computes the absolute-time schedule for one loop pass:
export function buildSchedule(theme: readonly NoteEvent[], bpm: number, startAtSeconds: number): Array<{ at: number; note: NoteEvent }> { ... }
```

```ts
// src/audio/SfxPlayer.ts — complete synthesized catalog (no asset files)
/** Pure mapping, extracted for unit tests: speedRatio 0→1 maps to ~80 Hz → ~240 Hz. */
export function enginePitchFor(speedRatio: number): number; // monotonic non-decreasing

export class SfxPlayer {
  constructor(audioManager: AudioManager);
  uiClick(): void;
  countdownBeep(final: boolean): void;   // ×3 beeps + goHorn (final=true)
  itemPickup(): void;                    // rising arpeggio
  shroomBoost(): void;                   // whoosh = filtered noise sweep
  shellFire(kind: ShellKind): void; shellBounce(): void; shellHit(): void;
  bananaSkid(): void;                    // descending pitch wobble (slip)
  starActivate(): void; stopStarLoop(): void;   // shimmering high arpeggio loop while starred
  lightningZap(): void;                  // white-noise crack + low sine thump
  bulletBillLaunch(): void;
  startEngineLoop(): void;               // race:start — continuous sawtooth, freq = enginePitchFor(speedRatio)
  updateEngineLoop(speedRatio: number, throttle: number): void;  // per-frame from player kart state
  stopEngineLoop(): void;                // results screen
}
```

```ts
// src/tracks/PropBuilder.ts — instanced meshes per kind, density from preset table (§10)
export type PropKind = "tree" | "mushroom" | "sign" | "flower" | "rock" | "geyser" | "torch" | "crystal";

export class PropBuilder {
  constructor(scene: Scene, spline: TrackSpline, qualityManager: QualityManager);
  /** Builds one InstancedMesh per kind present in track.propCatalog (scaled by preset prop-density %).
   *  Each instance placed via placeAlongSpline(t, lateralOffset) with catalog scale/rotationY. */
  build(track: TrackDefinition): void;
  dispose(): void; // removes all instanced meshes + geyser plumes / torch lights
}
```

Track data extension (additive — existing fields untouched):

```ts
// src/data/tracks/types.ts — added to TrackDefinition
interface WidthOverride { tStart: number; tEnd: number; widthOverride: number } // meters, full width
interface TrackDefinition { /* ...existing P2/P3 fields... */ widthOverrides?: WidthOverride[] }
```

Theme shape consumed by `applyTheme` (already present in track data since P2 — this is the contract the renderer reads):

```ts
// src/data/tracks/types.ts (existing, shown for reference)
interface TrackTheme {
  skyGradient: [string, string];        // hex top → bottom, e.g. meadows ["#7ec8ff", "#eaf9d0"]
  fogColor: string; fogDensity: number; // EXP2 density, ~0.004–0.012 range
  sun: { color: string; direction: Vec3; intensity: number };
  hemispheric: { skyColor: string; groundColor: string; intensity: number };
  accentLights: Array<{ position: Vec3; color: string; intensity: number; range: number }>;
}
```

Event → VFX/audio wiring map (single source of truth for T3–T11 subscriptions — all events already exist in the P5 catalog, [`01-architecture.md`](./01-architecture.md) §5):

| Bus event | ParticleFactory | SfxPlayer | Other |
|---|---|---|---|
| `kart:boosted` `{ tier }` | `boostFlames(kartId, tier)` (mini/super from drift; `"shroom"` when item=Zoom Shroom) | mini/super → short whoosh; shroom → `shroomBoost()` | ScreenShake (P5, unchanged) |
| `item:used` `{ item }` | star → start `starSparkle`; lightning → `lightningFlash()`; bulletBill → transform visual only | per-item one-shots (`shellFire`, `starActivate`, `lightningZap`, `bulletBillLaunch`) | — |
| `kart:hit` `{ shellKind? }` | `shellExplosion(pos)` at impact point | `shellHit()` / hit thud by kind | KartRenderer flash (P5) |
| `kart:skid` `{ cause }` | start/stop `skidDust` gate (off-road only; oil slick = no dust, it's on road) | `bananaSkid()` wobble | — |
| `race:start` | — | `startEngineLoop()`, go horn | MusicSequencer crossfade to map theme |
| `race:finished` `{ standings }` | `confetti(podiumPos)` (via ResultsScreen hook) | `stopEngineLoop()` | MusicSequencer fanfare, podium tween |

Star/lightning **end** of effect is not a bus event — the factory polls `kart.statusEffects` each frame in its update tick and starts/stops continuous systems (`starSparkle`, shrink-scale tween completion) when entries expire. This keeps P5's logic untouched.

## Step-by-step tasks (numbered; each small and independently verifiable)

**T1 — Skybox + lighting + fog for meadows.** Implement `RenderPipelineSetup.applyTheme` parts (a), (b), (c) only. Gradient skybox: inverted sphere (`side: BACKSIDE`, `disableLighting`) with a 2×512 `DynamicTexture` painted as vertical gradient from `theme.skyGradient[0]` (top) → `[1]` (bottom). Lighting rig: hemispheric light (ground color = theme ground tint, intensity ~0.6) + directional sun at theme direction; shadow generator attached to the sun with resolution from preset (`off/1024/2048`, §10); accent point lights from `theme.accentLights` (meadows: 2 soft warm points near item-box clusters). Fog: `scene.fogMode = FOGMODE_EXP2`. Wire `applyTheme(meadows.theme)` on Countdown enter. Gradient paint sketch:

```ts
const ctx = dynTex.getContext(); // 2×512 canvas
const grad = ctx.createLinearGradient(0, 0, 0, 512);
grad.addColorStop(0, theme.skyGradient[0]);   // top of sphere → top color
grad.addColorStop(1, theme.skyGradient[1]);
ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 512);
dynTex.update();
sphere.material = new StandardMaterial("sky", scene); // unlit: disableLighting on the material
sphere.material.diffuseTexture = dynTex;
sphere.material.specularColor = new Color3(0, 0, 0);
```

*Verify:* load meadows at High — sky gradient matches palette, shadows visible, fog fades distant props; reload the scene (quit → re-enter) and confirm no duplicate lights (`scene.lights.length` stable).

**T2 — Post stack behind QualityManager.** Add part (d): `DefaultRenderingPipeline` with bloom (intensity 0.35, threshold 0.8), SSAO, image processing (contrast 1.05, saturation 1.2) enabled per preset; FXAA post-process on Low only. Implement `onQualityChanged(preset)` that rebuilds the pipeline in place. *Verify:* at **Low** — no bloom/SSAO/FXAA-off check: confirm `pipeline.bloomEffect.isEnabled === false`, SSAO off, FXAA present, and the scene still looks acceptable (flat but clean). At High — boost flames visibly glow. Change quality live from settings mid-race; no restart needed, no crash.

**T3 — ParticleFactory skeleton + boostFlames.** Create the class with `attach(bus)` subscribing to `kart:boosted`. Cone emitter parented at kart rear (offset −0.6 m along heading), lifetime 0.8 s (`tuning.vfx.boostDuration`), emitRate/capacity × `qualityManager.budget()`. Colors by tier: mini = white sparks, super = blue-white, shroom = orange. *Verify:* free-drive meadows, drift-charge and release — flames appear at the correct color per tier; Low preset shows visibly fewer particles than High (check `system.particleCount` via `window.__game`).

**T4 — shellExplosion + kart:hit wiring.** Radial burst (`emitter.emitRate` spike then dispose after ~0.5 s) plus a point light at the hit position with intensity tween 3→0 over 150 ms. Subscribe to `kart:hit`. *Verify:* in a race, get hit by an AI shell — flash + burst at impact; no lingering lights (`scene.lights.length` returns to baseline after 1 s).

**T5 — starSparkle (continuous system).** Emitter parented to the starred kart's mesh so it follows it; small orbiting sparkle pattern via `updateFunction` (orbit around parent origin, radius ~0.8 m); start on star effect begin (`item:used` with item=star), stop + dispose on effect end — the factory polls each kart's `statusEffects` every frame and starts/stops when a `{ kind: "star" }` entry appears/expires (no new bus event needed). Orbit sketch:

```ts
system.updateFunction = (p) => {
  const age = p.age / system.minLife;                 // 0..1 over particle life
  const a = p.initialAngle + age * Math.PI * 2;       // one full orbit per lifetime
  p.position.x = Math.cos(a) * RADIUS;
p.position.z = Math.sin(a) * RADIUS;
  p.position.y = 0.5 + Math.sin(age * Math.PI) * 0.3; // slight arc up/down
};
```

*Verify:* take a star — sparkles orbit the kart for exactly ~6 s then vanish; no orphaned particle systems (`engine.getParticlesCount()` back to baseline).

**T6 — lightningFlash.** Full-screen white overlay: a fixed-position `div` (added by factory, pointer-events none) with opacity pulse 1→0 over 120 ms. Simultaneously tween **every kart mesh's scale** to 0.6 and back over the shrink duration (`tuning.items.lightningShrink`). Document in code comment: *mesh scaling only — the top-speed/handling penalty is P5 logic; this is purely visual.* *Verify:* use lightning on a race with AI — all karts visibly shrink for ~5 s, screen flashes once, physics unaffected (kart speeds unchanged by the tween).

**T7 — confetti + skidDust.** `confetti(pos)`: multi-color burst, gravity on, self-dispose after 3 s. `skidDust(kartId)`: small brown puffs at rear wheels while the kart is off-road **and** |speed| > threshold (`tuning.vfx.skidMinSpeed`); per-frame gate in factory update (start/stop as condition toggles). *Verify:* drive on grass at speed — dust follows; stop or return to road — dust stops within a frame.

**T8 — MusicSequencer: scheduler + menu theme.** Implement the lookahead scheduling pattern and `buildSchedule`; define the menu theme as data (~120 BPM, major key, 8-bar loop). The robust standard pattern (document it in the file header):

```ts
// Lookahead scheduler: a setInterval at 25 ms schedules notes up to 100 ms ahead of
// audioContext.currentTime. Never schedule "now" from a timer — WebAudio timing is only
// sample-accurate when you give the context a future timestamp, and a coarse timer alone
// drifts/jitters. The interval just *fills* the queue; the AudioContext clock plays it.
private tick = () => {
  while (this.nextNoteTime < this.clock.currentTime + LOOKAHEAD_S) { // LOOKAHEAD_S = 0.1
    const ev = this.scheduleQueue.shift();
    if (!ev) break;
    this.playNote(ev.note, ev.at);   // osc.start(at), osc.stop(at + dur) — absolute times
    this.nextNoteTime += this.beatSeconds(ev.note.durationBeats);
  }
};
```

Channels: `lead` = square oscillator, `bass` = sawtooth (one octave down, lower gain), `noise-hat` = short filtered white-noise buffer on off-beats. Volume from AudioManager's music bus. *Verify:* menu plays a bouncy loop; in devtools AudioContext, scheduled oscillators have future start times; no audible click at the 8-bar wrap (loop seamlessness — listen-test).

**T9 — Race themes + crossfade.** Define meadows race theme (~140 BPM, energetic major) and lagoon race theme (~150 BPM, minor key with more dissonance — use a few semitone clashes in the lead line; keep it pleasant). On `race:start`, crossfade menu → map's race theme over 300 ms (ramp old gainNode down while ramping new up, both scheduled against `currentTime`). *Verify:* start a race on each map — switch is seamless (no gap/click), correct theme per map; pause/quit stops music cleanly.

**T10 — SfxPlayer full catalog.** Implement every one-shot in the interface above (all synthesized: oscillators + noise buffers through the sfx bus). `starActivate` = short looping arpeggio pattern started/stopped on star effect begin/end. *Verify with this checklist, mapping each event → sound:* countdown beeps ×3 + go horn at GO; item pickup arpeggio on box grab; shroom whoosh; shell fire/bounce/hit distinct from each other; banana slip wobble when skidding; star shimmer loops for 6 s then stops; lightning crack+thump; bullet bill launch zip. Every sound respects sfx bus volume + mute (test at 0% and muted).

**T11 — Engine loop.** Continuous sawtooth oscillator started at `race:start`, stopped at results. Per frame: `updateEngineLoop(playerKart.speedRatio, throttle)` → frequency = `enginePitchFor(speedRatio)` (~80 Hz idle → ~240 Hz top speed; implement as a smooth curve, e.g. `80 + 160 * ratio^1.5`, plus ±3% LFO wobble via a second oscillator modulating frequency), gain follows throttle (near-silent at 0). Extract `enginePitchFor` as an exported pure function. *Verify:* hold W from stop — pitch rises smoothly with speed; release — falls; no click on start/stop (5 ms gain ramps).

**T12 — PropBuilder for meadows.** Implement per-kind builders: tree = cone + cylinder trunk; mushroom = cylinder stem + sphere cap, red with white dots via vertex colors (or two-material); sign = box on pole; flower = small icosahedron. One `InstancedMesh` **per kind** (merge the multi-part kinds into a single geometry per instance where possible — e.g. tree trunk+canopy as one merged buffer — to keep draw calls low). Density: take floor(catalogCount × preset prop-density %) instances, sampled deterministically via the seeded RNG so Low/Medium/High show consistent subsets. *Verify:* meadows at High shows full catalog; at Low ~40%; `engine.getDrawCalls()` stays well under budget (check in perf viewer); no props intersect the road (visual + T17 data test).

**T13 — Lagoon prop kinds.** rock = flattened dodecahedron, dark material; geyser = cylinder base + particle plume reusing `ParticleFactory` (continuous system, budget-scaled); torch = pole + emissive flame sphere + point light **only at High preset**, else emissive-only (re-evaluate on quality change); crystal = emissive octahedron. *Verify:* lagoon at High — torches cast warm pools of light; drop to Medium — lights gone, flames still glow via emissive; geyser plumes respect budget multiplier.

**T14 — `widthOverride` in spline + builder.** Add optional per-segment width encoding: `TrackDefinition.widthOverrides?: { tStart, tEnd, widthOverride }[]`. `TrackSpline.halfWidthAt(t)` returns base half-width or the override when `t ∈ [tStart, tEnd]` (smooth 0.5 m ease at span edges so the ribbon doesn't kink). `TrackBuilder` samples width per ribbon segment; on overridden spans: barriers taller (+0.4 m) and **no off-road surface** — a dark void plane sits below road level beside the bridge (cliff visual); `closestPoint().onRoad` uses the narrowed half-width so driving "off" the bridge edge is impossible (barriers + cliff). Update data files: lagoon gets `{ tStart: 0.48, tEnd: 0.52, widthOverride: 6 }` (base roadWidth 10 m); meadows needs none. *Verify:* unit-test `halfWidthAt` at span edges; drive the bridge — road visibly narrows to 6 m, barriers taller, void below visible, no grass on either side.

**T15 — Lagoon end-to-end verification.** Oil slick patches render as dark glossy discs (low roughness, slight emissive sheen) at `hazards` placements; surface detection already works from P3/P5 — confirm visually that driving over a rendered slick triggers the skid. Full lap of lagoon: theme lighting (orange accent glow under bridge), fog density, props, bridge all correct. *Verify:* complete 3 laps on lagoon at High with zero visual/logic mismatches between rendered hazards and gameplay hits.

**T16 — Podium + confetti + fanfare.** Fill P4's `onPodiumReady(standings)` hook: spawn 3 boxes (heights 1.2 / 0.9 / 0.7 m for 1st/2nd/3rd) center-frame; top-3 karts drive via simple tween along a straight from finish line to podium x-positions, then step up onto their box with bounce easing (`easeOutBack` on y over ~0.4 s). On trigger: `ParticleFactory.confetti(podiumPos)` bursts + `MusicSequencer.playTheme("fanfare")` (short 4-bar major-key jingle defined as data in T8's format). If the player is P1, add a spotlight point light above their kart. *Verify:* finish a race — podium sequence plays exactly once, karts land on correct boxes by rank, fanfare audible, confetti self-disposes; "race again" from results leaves no leftover meshes/lights.

**T17 — Unit tests + final full playtest.** Write the three test files in [Test list](#test-list). Then run the manual matrix below on **both maps at each quality preset**; fix anything found and re-run until every cell is checked. *Verify:* `npm test` green, matrix complete with no empty cells.

## Acceptance criteria

1. [`00-overview.md`](./00-overview.md) §7 P6 exit gate: manual playtest checklist (table below) passed on both maps at each quality preset — **no empty cells**.
2. All unit tests in [Test list](#test-list) green; `npm run lint` and `npx tsc --noEmit` clean ([`00-overview.md`](./00-overview.md) §8).
3. Theme switch at race start is seamless (no gap/click); engine pitch tracks speed; settings quality change applies live without restart.
4. No gameplay logic changed: headless full-race unit test from P4 still passes with identical results for the same seed.
5. `RenderPipelineSetup.applyTheme` proven idempotent (entering a map scene twice creates no duplicate lights/skybox/post objects).

## Test list

**Automated (Vitest, headless):**
- `tests/unit/musicSequencer.test.ts`
  - *Scheduler math:* given a fake clock and the menu theme at its BPM with `startAtSeconds = 10.0`, `buildSchedule` returns notes sorted by absolute time; each note's `at` equals `startAt + timeInBeats × (60/bpm)` within ±1 ms.
  - *Channel coverage:* every channel (`lead`, `bass`, `noise-hat`) appears at least once per loop in all three themes (guards against a silently-empty track section).
  - *Loop wrap:* simulating the scheduler across two consecutive passes, the gap between the last scheduled note of pass N and the first of pass N+1 is ≤ 50 ms (no audible silence at the seam) and no two notes are scheduled at the same instant out of order.
- `tests/unit/sfxPlayer.test.ts`
  - `enginePitchFor` is monotonic non-decreasing across a dense sweep of [0, 1] (e.g., 200 samples).
  - Endpoints: `enginePitchFor(0)` ≈ 80 Hz and `enginePitchFor(1)` ≈ 240 Hz within ±5%.
  - Clamping: inputs < 0 and > 1 map to the 0 / 1 endpoints respectively (no extrapolation).
- `tests/unit/propBuilder-data.test.ts`
  - *Coverage:* for each of the two track data files, every distinct `kind` in `propCatalog` has a registered builder function (import the registry from `PropBuilder`; this test is pure data + registry lookup — no scene needed).
  - *Road clearance:* for every entry `{ t, lateralOffset }`, assert `|lateralOffset| ≥ halfWidthAt(t) + 0.5 m` margin using `TrackSpline.halfWidthAt` (so props never sit on the road, including lagoon's narrowed bridge span where the effective width is 6 m).

**Manual playtest checklist** — each cell: ☐ VFX present? ☐ Audio correct? ☐ No perf hitch?

| Event | meadows-low | meadows-high | lagoon-low | lagoon-high |
|---|---|---|---|---|
| Zoom Shroom (boost flames, orange) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Green Pea Shell (fire/bounce/hit + explosion) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Red Chili Shell (homing trail + hit) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Blue Storm Shell (leader-targeting + hit) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Slick Banana (drop + skid wobble sound) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Sparkle Star (sparkles 6 s + shimmer loop) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Zap Lightning (flash + all-kart shrink) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Bullet Bill (launch zip + plow-through) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Drift mini turbo (white flames) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Drift super turbo (blue-white flames) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Off-road at speed (skid dust + drag feel unchanged) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Oil slick (glossy disc + skid, lagoon only — n/a on meadows: mark "n/a") | n/a | n/a | ☐☐☐ | ☐☐☐ |
| Countdown (3 beeps + go horn) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |
| Finish → podium (drive-up, bounce, confetti, fanfare, P1 spotlight if won) | ☐☐☐ | ☐☐☐ | ☐☐☐ | ☐☐☐ |

**Cross-cutting checks (once per map/preset combo):** theme switch at race start seamless; engine pitch tracks speed up/down; live quality change applies without restart; skybox/fog/lighting match the map's `theme` palette.
