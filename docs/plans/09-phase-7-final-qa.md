# Phase 7 — Final QA & Polish

> **Execution guide for Phase 7 (final phase).** Forward-looking: nothing here is implemented yet. Depends on **everything** — Phases 0–6 complete, including the full P6 exit gate ([`08-phase-6-vfx-audio-polish.md`](./08-phase-6-vfx-audio-polish.md)). Source of truth: [`00-overview.md`](./00-overview.md) §7 (P7 row), §2 (IP safety), §Verification; [`01-architecture.md`](./01-architecture.md) §6, §9, §10.

## Goal

Ship a game that is fast on the reference hardware, balanced and fun across all four characters, free of edge-case bugs, and documented — then prove it with an evidence-backed release checklist. Concretely: (1) performance pass to hit the FPS/draw-call gates at High **and** Low; (2) author `docs/tuning-table.md` and run structured balancing sessions so every character wins 20–35% of player-vs-AI races; (3) rewrite `README.md`; (4) a 90-minute structured bug bash with fixes verified by the full suite; (5) execute the final release checklist, pasting real command outputs into `docs/release-evidence.md`. Exit gate: [`00-overview.md`](./00-overview.md) §7 P7 row — perf gates met, IP grep gate clean, full test suite green, cold-load polish gate passed.

## Files to create / modify (table: path | purpose)

| Path | Purpose |
|---|---|
| `src/main.ts` | **Modify.** Expose FPS sampler on the debug handle: `window.__game.fpsHistory(): number[]` (ring buffer of per-frame FPS, last 600 frames). Also add optional `?debug=1` stats overlay hook (win-rate collection for balancing). |
| `src/race/RaceController.ts` (+ every controller/renderer/spawner) | **Modify.** Ensure an explicit `dispose()` exists on RaceController and is called on quit-to-menu; audit that KartRenderer, TrackBuilder output, PropBuilder, ParticleFactory, RenderPipelineSetup, MusicSequencer/SfxPlayer nodes all dispose. Document the disposal contract in code comments. |
| `src/rendering/RenderPipelineSetup.ts`, `src/vfx/ParticleFactory.ts`, `src/tracks/PropBuilder.ts`, `src/ui/Hud.ts` | **Modify (perf pass only).** Apply optimization playbook items: instancing audit, particle dispose on race end, DynamicTexture lane-striping created once per track, HUD DOM text updates throttled to value-changes. No behavior changes. |
| `docs/tuning-table.md` | **Create.** Every TUNING value with a one-line rationale + the "feel" target it serves. Authored this phase; kept in sync whenever `src/data/tuning.ts` changes (rule: no tuning change lands without updating the table). |
| `README.md` | **Rewrite.** Title, pitch, requirements, quick start, controls, tests, structure, IP disclaimer, known limitations. |
| `docs/release-evidence.md` | **Create.** Real command outputs from the final release checklist run (lint, tsc, unit, e2e, grep gate, perf numbers). |
| `src/data/tracks/greenhollow-meadows.ts`, `src/data/tracks/lava-lagoon-loop.ts` | **Verify.** IP-safe naming already applied in Phase 2 (map id `meadows` displays as **"Greenhollow Meadows"**; file is `greenhollow-meadows.ts`). See [IP grep gate decision](#ip-grep-gate-decision-explicit). No further rename needed. |
| `tests/unit/disposal.test.ts` | **Create.** Headless race ×5 sequential; assert tracked entity/projector counts return to baseline (no growth). |
| `src/data/tuning.ts` | **Modify (balancing only).** Adjust values per balancing sessions — never code. Every change logged in `docs/tuning-table.md`. |

## Interfaces & signatures

```ts
// src/main.ts — FPS sampler (ring buffer, zero allocation after warm-up)
declare global {
  interface Window {
    __game: {
      /* ...existing P4/P6 handles: state, standings(), karts()... */
      /** Per-frame FPS for the last ~10 s (600 frames). Sampled in the render loop. */
      fpsHistory(): number[];
      /** ?debug=1 only: per-character win/loss tally across finished races this session. */
      stats?: { winsByCharacter: Record<string, number>; races: number };
    };
  }
}

// Full sampler implementation (lives in src/main.ts render-loop wiring):
const FPS_RING_SIZE = 600;                       // ~10 s at 60 FPS
const fpsRing = new Float32Array(FPS_RING_SIZE);
let fpsIdx = 0, fpsCount = 0;
let lastFrameT = performance.now();

function sampleFps(now: number): void {
  const dtMs = now - lastFrameT;
  lastFrameT = now;
  if (dtMs > 0 && dtMs < 500) {                  // ignore tab-switch / debugger gaps
    fpsRing[fpsIdx] = 1000 / dtMs;
    fpsIdx = (fpsIdx + 1) % FPS_RING_SIZE;
    fpsCount = Math.min(fpsCount + 1, FPS_RING_SIZE);
  }
}
window.__game.fpsHistory = () => {
  const out: number[] = [];
  for (let i = 0; i < fpsCount; i++) {
    out.push(fpsRing[(fpsIdx - fpsCount + i + FPS_RING_SIZE * 2) % FPS_RING_SIZE]);
  }
  return out;                                    // oldest → newest
};
// In the render loop: sampleFps(performance.now()); scene.render();
// Devtools helper for the perf pass:
//   const h = window.__game.fpsHistory(); Math.min(...h), (h.reduce((a,b)=>a+b,0)/h.length)
```

// Disposal contract — every long-lived subsystem implements:
interface IDisposable { dispose(): void }
// RaceController.dispose() must, in order: stop engine loop subscription → dispose entities'
// renderers (KartRenderer) → ItemBoxSpawner → ShellProjectile pool → PropBuilder →
// ParticleFactory.disposeAll() → RenderPipelineSetup.dispose() → SfxPlayer.stopEngineLoop()
// + MusicSequencer.stopAll(). Called on Paused→MainMenu ("quit to menu") and Results→MainMenu.
```

## Step-by-step tasks (numbered; each small and independently verifiable)

**T1 — FPS sampler + baseline measurement.** Add `fpsHistory()` ring buffer to the render loop in `src/main.ts`. Measure baselines on reference hardware (integrated GPU, 1080p): full race with all VFX active at **High**, then at **Low**; record average/min FPS and `engine.getDrawCalls()`. Write numbers into a scratch section of `docs/release-evidence.md` ("Baseline"). *Verify:* `window.__game.fpsHistory()` returns plausible values in devtools; baseline recorded.

**T2 — Optimization pass (re-measure after each item).** Work the playbook strictly in priority order; after **each** item, re-run a full race at High and record FPS/draw calls:
1. **Instancing audit.** Verify barriers, props, shells, bananas all use `InstancedMesh` — never one `Mesh` per instance. Fix any stragglers (e.g., P6 prop kinds that were built as individual meshes). *Check:* draw-call count drops or holds; no visual change.
2. **Particle leak check.** Dispose particle systems on race end (`ParticleFactory.disposeAll()` in the disposal chain). Run 5 races back-to-back via quit-to-menu between them; assert `engine.getParticlesCount()` returns to baseline ±10% after each. *Check:* count flat across 5 cycles (this is also what T8's unit test automates headlessly).
3. **DynamicTexture lane-striping once per track.** The road center-line/lane stripe texture must be created once in `TrackBuilder` and reused — not re-uploaded or recreated per frame. *Check:* no per-frame GPU upload (devtools performance: no recurring `texImage2D` on the stripe texture).
4. **HUD DOM throttling.** Text nodes (position, lap, times) update only when the value changes; needle rotation and minimap canvas may update every frame (transform/canvas ops are cheap). *Check:* devtools shows no layout thrash from HUD at 60 FPS.
5. **Shadow map discipline.** Exactly one shadow-casting directional light (the sun); no extra casters. **Decision: props DO cast shadows on High** — verify the budget allows it in T1's re-measurement; if High misses the gate with prop casting, flip props to receive-only at High and document that in `docs/tuning-table.md`'s quality section. Medium keeps 1024 res per [`01-architecture.md`](./01-architecture.md) §10.
6. **Last resort: spline sample count.** If still over budget, reduce the ribbon mesh's spline sample density (visual check first — no visible faceting on curves). Log the chosen value in `docs/tuning-table.md`.

*Verify:* after the pass, High ≥ 50 FPS and < 200 draw calls with all VFX active; Low ≥ 60 FPS same hardware ([`00-overview.md`](./00-overview.md) §7 P7 row). Numbers recorded in `docs/release-evidence.md`.

**Measurement protocol (same procedure for baseline and every re-measure):** start a race on lagoon at the preset under test; wait 10 s for warm-up (shader compilation); drive a full lap with all VFX active (boost, star, shells — trigger at least one of each); read `fpsHistory()` min/average over the final ~10 s and `engine.getDrawCalls()`. Repeat twice; record the worse run. Do this on both maps for High, and once per map for Low.

**Expected draw-call budget (High, lagoon, all VFX active)** — use as a sanity check while auditing; if a category is far over its estimate, that's where the fix belongs:

| Category | Est. calls | Notes |
|---|---|---|
| Road ribbon + ground + void plane | ~4 | one mesh each (ribbon may be 1–2 with bridge span) |
| Barriers (instanced) | 1–2 | single InstancedMesh per side if materials match |
| Props, all kinds (instanced) | ≤ 8 | one call per kind present in catalog |
| Karts ×4 (merged body + wheels) | ~8–16 | keep each kart ≤ 2–4 calls via merged geometry |
| Item boxes (instanced) + shells + bananas | ~3 | all instanced |
| Skybox + fog-affected extras | ~2 | — |
| Particle systems active simultaneously | ~5–10 | worst case: boost + sparkle + geyser plumes + confetti |
| Post stack (bloom/SSAO/FXAA passes) | ~6–10 | full-screen passes count as draw calls too |
| **Total** | **~40–70** | comfortable margin under the 200 gate; if measured > 150, audit before optimizing blindly |

**T3 — Author `docs/tuning-table.md`.** Walk `src/data/tuning.ts` top to bottom; for every value write: the number, a one-line rationale, and the "feel" target it serves (e.g., `drift.charge2Time: 1.4` — "super turbo requires commitment; ~1.4 s of sustained drift feels earned but not punishing"). Include the quality preset table (mirroring [`01-architecture.md`](./01-architecture.md) §10) and any P6 `vfx`/`audio` sections. Row format:

```markdown
| Key | Value | Rationale | Feel target |
|---|---|---|---|
| physics.maxSpeedBase | 30 | baseline m/s; character topSpeed stat scales ±20% | "fast but readable" — a full lap ≈ 45–60 s at base speed |
| drift.charge1Time | 0.6 | mini turbo reachable in under a second of drifting | reward quick commitment, not just holding Space |
| items.starDuration | 6 | long enough to string 2–3 hits, short enough to stay tense | invincibility feels powerful but never safe |
```

*Verify:* every key in `tuning.ts` has a row; no orphan values. Add a header rule: *any future change to `src/data/tuning.ts` must update this table in the same commit.*

**T4 — Balancing sessions.** Protocol: **10 race sessions per map**, player driving each of the 4 characters (rotate order to avoid track-learning bias), AI on the other three. Record win rate per character. **Target: each character wins 20–35% of races as player vs AI** (a flat 25% is ideal; outside 20–35% means a stat vector or vehicle modifier is off). Collection method: enable `?debug=1`, which renders a stats overlay and tallies into `window.__game.stats` (`winsByCharacter`, `races`) — read it via devtools after each session, or log to console at race end. Adjust **only** `src/data/tuning.ts` values (stat scaling factors, AI rubber-band, boost magnitudes) — never code; update `docs/tuning-table.md` in the same commit as every tuning change. Re-run affected sessions until all four characters are inside 20–35% on both maps.

Win-rate record template (fill during sessions, final version goes to `docs/release-evidence.md`):

```markdown
| Character | meadows wins/10 | meadows % | lagoon wins/10 | lagoon % | In 20–35%? |
|---|---|---|---|---|---|
| marvin | — | — | — | — | ☐ |
| louie  | — | — | — | — | ☐ |
| pearl  | — | — | — | — | ☐ |
| terry  | — | — | — | — | ☐ |
```

Tuning levers, in order of preference (least invasive first): per-character stat scaling factors → vehicle modifier magnitudes → `ai.rubberBandFactor` / `speedVariance` → item boost magnitudes. If a character is *always* last regardless of player skill, suspect the AI rubber-band rather than the stats.

*Verify:* final win-rate table (both maps × 4 characters) recorded in `docs/release-evidence.md`, all cells within target band.

**T5 — Bug bash (90-minute structured session).** One focused pass through the checklist below; log every finding in a scratch list with severity, fix each, and re-run the full unit + e2e suite after fixes land. Suggested timebox: 10 min per edge case, first two (pause variants) share one block. Edge cases to hunt, with how to verify each:
- Pause **during countdown** / **mid-boost** / **while bullet-billing** — resume must not skip physics or double-fire the boost. *Verify:* `window.__game.state` round-trips Racing→Paused→Racing; after a mid-boost pause of 5 s, the kart's speed is unchanged on resume (no free speed decay, no re-triggered flame burst longer than the original remaining duration).
- Quit-to-menu mid-race, then start a new race — full resource disposal check. *Verify:* run the [disposal audit checklist](#bug-bash-log-template) below; second race starts with clean counts and no leftover engine-loop audio.
- Rapid item-use spam (hold/tap `E` at 20 Hz) — no queued duplicate effects, no NaN state. *Verify:* use a shell while mashing E; after the effect resolves, `karts()` snapshot shows finite positions/speeds and exactly one projectile was spawned per held item.
- Drifting into a barrier at max speed — clean stop, no tunneling through the barrier, camera doesn't clip. *Verify:* kart ends up on the road side of the barrier (check position vs. `closestPoint().onRoad`), camera stays behind the kart, no screen shake lasting > 0.5 s.
- Star + lightning simultaneously on the player — star must win (no shrink applied to starred kart; verify P5 logic handles it). *Verify:* with a scripted setup or lucky item drop, confirm the player's mesh scale stays 1.0 while AI karts shrink, and top speed is unaffected for the player.
- Blue shell hitting a **starred** player — star wins: shell bounces off, no hit event. *Verify:* `kart:hit` not emitted for the starred kart; shell despawns or re-targets per P5 rules.
- Tab backgrounded 30 s then refocus — `FixedTimestepLoop` accumulator clamp must prevent physics explosion (kart hasn't teleported; no spiral-of-death catch-up burst). *Verify:* record kart position before backgrounding; after refocus, displacement is consistent with ~0 logic time (clamped), and FPS recovers within a second without a multi-second stutter.
- Resize window mid-race — canvas + HUD reflow cleanly, minimap correct, no stretched skybox. *Verify:* resize 1920×1080 → 800×600 → back; HUD elements don't overlap, minimap aspect preserved, skybox gradient unwarped.
- Reload mid-race — lands cleanly in MainMenu with no stale audio or `window.__game` errors. *Verify:* console clean on load; `__game.state === "MainMenu"`; starting a fresh race works normally.

*Verify:* findings list complete (each row: found/not-found), all real bugs fixed, suite green after fixes. Log template:

```markdown
| # | Edge case | Found? | Severity (blocker/major/minor) | Fix commit | Re-verified |
|---|---|---|---|---|---|
| 1 | pause during countdown | ☐ | — | — | ☐ |
| 2 | pause mid-boost | ☐ | — | — | ☐ |
| 3 | pause while bullet-billing | ☐ | — | — | ☐ |
| 4 | quit-to-menu → new race (disposal) | ☐ | — | — | ☐ |
| 5 | rapid item-use spam | ☐ | — | — | ☐ |
| 6 | drift into barrier at max speed | ☐ | — | — | ☐ |
| 7 | star + lightning on player (star wins) | ☐ | — | — | ☐ |
| 8 | blue shell vs starred player (bounces) | ☐ | — | — | ☐ |
| 9 | tab backgrounded 30 s → refocus (accumulator clamp) | ☐ | — | — | ☐ |
| 10 | resize window mid-race | ☐ | — | — | ☐ |
| 11 | reload mid-race → clean MainMenu | ☐ | — | — | ☐ |
```

Disposal audit checklist (used by edge case #4 and by T8): after quit-to-menu, confirm in devtools — `scene.lights.length`, `engine.getParticlesCount()`, `scene.meshes.length` all back to the menu baseline; no WebAudio nodes still running (`audioContext` destination silent); `window.__game.state === "MainMenu"`. Any subsystem that fails this audit gets an explicit `dispose()` added to the chain documented in [Interfaces & signatures](#interfaces--signatures).

**T6 — README rewrite.** Sections, in order:

1. **Title + pitch** — "Turbo Turtle Rally" (working title per [`00-overview.md`](./00-overview.md)); one paragraph: single-player kart racer for the browser, 3 laps vs 3 AI, full item set, two themed maps, all audio/VFX synthesized in code.
2. **Requirements** — modern browser with WebGL2; Chrome/Edge/Firefox/Safari roughly "last 2 years"; keyboard required (no gamepad/mobile support by design).
3. **Quick start** — `npm install` → `npm run dev` → open http://localhost:5173; note the friendly overlay shown if WebGL2 is missing.
4. **Controls** — table copied verbatim from [`00-overview.md`](./00-overview.md) §5 (W/↑, S/↓, A/D + arrows, Space drift with mini/super charge, E/Enter item, Esc pause).
5. **Tests** — `npm test` (Vitest unit: pure logic — spline math, lap tracking, drift state machine, headless full-race simulation, item targeting, spawn tables, scheduler math, disposal); `npm run test:e2e` (Playwright on the preview server: menu smoke, selection navigation, scripted full 3-lap race to results; assertions via DOM + `window.__game`, never screenshots).
6. **Project structure** — short tree overview linking into [`docs/plans/`](./00-overview.md) for the phase-by-phase plan and [`01-architecture.md`](./01-architecture.md) for interfaces/conventions.
7. **IP disclaimer** — "All characters, vehicles, maps and items are original pun-based creations. This project contains no Nintendo intellectual property."
8. **Known limitations** — no multiplayer/netcode, no gamepad or touch controls, no external 3D assets (everything procedural), no vertical/looping track sections; performance targets defined for integrated GPUs at 1080p.

*Verify:* a fresh clone follows the README to a running game with zero guesswork (do this walkthrough literally on a clean `git clone` + `npm install`).

**T7 — IP grep gate.** Run the gate command from the release checklist; naming was already made IP-safe in Phase 2 (see decision below), so this should return **zero hits with no allowlist**. If any hit appears, fix the offending string at its source and re-run. *Verify:* gate output pasted into `docs/release-evidence.md`.

**T8 — Disposal unit test.** Write `tests/unit/disposal.test.ts`: construct a headless race (P4's headless harness), run to completion, dispose via `RaceController.dispose()`, repeat ×5 sequentially; assert tracked counts (entities, projectiles, and any registered render-side projectors) return to baseline after each cycle — no growing allocation. If `dispose()` is missing or incomplete on any controller/renderer/spawner, add it first (documented in the disposal contract above). *Verify:* test green; also re-confirm T2's browser-side 5-race particle check still holds.

**T9 — Final release checklist execution.** Run every box in [Release checklist](#release-checklist-final-gate-all-must-be-checked) top to bottom, pasting real command outputs into `docs/release-evidence.md`. E2e suite is unchanged from P4/P5 but re-run as the final gate (smoke + selection + full-race). Skeleton for `docs/release-evidence.md`:

```markdown
# Release Evidence — <date>
## Environment  <!-- OS, browser + version, GPU model, resolution -->
## Lint / Typecheck   <!-- paste npm run lint + npx tsc --noEmit output tails -->
## Unit tests         <!-- paste vitest summary line (X passed) -->
## E2E                <!-- paste playwright summary (smoke/selection/full-race) -->
## IP grep gate       <!-- full command + "0 hits" confirmation, allowlist note -->
## Performance        <!-- High: avg/min FPS, draw calls; Low: same; 5-race particle counts -->
## Cold-load          <!-- time to playable menu, long-task list from devtools -->
## Balancing          <!-- final win-rate table from T4 -->
## Bug bash           <!-- findings table from T5 -->
```

*Verify:* every box checked with evidence; no box skipped.

## IP grep gate decision (explicit)

The release gate runs:

```
grep -rinE "mario|luigi|peach|bowser|yoshi|wario|waluigi|koopa|donkey kong" src docs index.html
```

and must return **only the two documented meta-hits, with no allowlist**: (1) the banned-name reference list in [`00-overview.md`](./00-overview.md) §2 and (2) this grep command quoted in this doc. Any other hit is a failure — fix it at its source.

Two naming decisions were made up front (Phase 0/2) so this gate needs zero exceptions:
1. **`toad` is NOT in the grep pattern.** "Toad" and "toadstool" are common English words (a toadstool is a mushroom cap), not Nintendo-specific terms — banning them would false-positive on ordinary prose. The pattern targets actual Nintendo character/creature names only.
2. **The map id `meadows` displays as "Greenhollow Meadows"** and its data file is named `src/data/tracks/greenhollow-meadows.ts`. An earlier draft used the display name "Toadstool Meadows"; it was renamed during planning because an automated IP gate that needs a standing exception is a gate that will rot. The id `meadows` itself never changes (it is not rendered to users except in debug output).

If a future change introduces a grep hit, fix the string at its source — do **not** add allowlist entries.

## Acceptance criteria

1. Every box in [Release checklist](#release-checklist-final-gate-all-must-be-checked) checked with evidence.
2. `docs/release-evidence.md` contains **real command outputs** (not paraphrases): lint, tsc, unit, e2e, grep gate, perf numbers at High and Low, balancing win-rate table.
3. Perf gates met: High ≥ 50 FPS integrated GPU @1080p all VFX active with draw calls < 200; Low ≥ 60 FPS same hardware ([`00-overview.md`](./00-overview.md) §7 P7 row).
4. Cold-load polish gate from [`00-overview.md`](./00-overview.md) §Verification item 6 passed (first paint → playable menu within the documented budget, no long main-thread stalls).
5. All four characters win 20–35% of player-vs-AI races on both maps; `docs/tuning-table.md` covers every value in `src/data/tuning.ts`.
6. [`00-overview.md`](./00-overview.md) §8 Definition of Done holds for this phase: lint clean, tsc clean, all unit tests pass, the phase-specific checklist (release checklist above) completed, no new TODO/FIXME without an issue reference, conventions in [`01-architecture.md`](./01-architecture.md) §7 followed — including the two new convention lines added by T2.

## Release checklist (final gate, all must be checked)

- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npm test` all green
- [ ] `npm run test:e2e` all green (smoke + selection + full-race)
- [ ] IP grep gate: command above returns only the two documented meta-hits (banned-name list in `00-overview.md` §2 + this quoted command), no allowlist; map displays as "Greenhollow Meadows" in data + docs
- [ ] Perf gates met at High **AND** Low on reference hardware (numbers recorded)
- [ ] Cold-load polish gate from [`00-overview.md`](./00-overview.md) §Verification item 6 passed
- [ ] README complete (all sections, fresh-clone test done)
- [ ] No console warnings in devtools during a full playthrough (menu → race → results → menu, both maps)

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| High preset misses 50 FPS on reference integrated GPU even after the full playbook | Medium | Playbook item 6 (spline sample reduction) is pre-approved; worst case, document a "High requires discrete GPU" note in README known-limitations and re-baseline the gate at Medium — but only with explicit sign-off, since [`00-overview.md`](./00-overview.md) §7 defines High as the gate. |
| Balancing can't get all 4 characters into 20–35% without breaking another | Medium | The AI rubber-band is the escape valve: a small `rubberBandFactor` increase compresses win rates toward 25% for everyone; log any such global nudge in `docs/tuning-table.md` with rationale. |
| Disposal audit finds a subsystem that can't be cleanly disposed (e.g., shared DynamicTexture) | Low | Shared per-track resources get reference-counted or are keyed by track id and reused across races — document the chosen approach where implemented; the unit test only asserts *counts*, so either approach passes. |
| IP grep gate gets an ad-hoc allowlist later (gate rot) | Low | The [decision section](#ip-grep-gate-decision-explicit) forbids allowlist entries; any new hit must be fixed at its source. `toad` is deliberately excluded from the pattern as a common English word — documented there so nobody "fixes" it back in. |
| Bug bash finds a blocker late (e.g., physics explosion on refocus) | Low | The accumulator clamp is P0 code already unit-tested; if it fails here, fix `FixedTimestepLoop`, re-run its unit tests plus the headless race test before continuing — do not paper over with a render-side reset. |

## Keeping the perf gains (regression prevention)

The optimization pass in T2 is a one-time event; the gates must keep holding for any later change. Cheap guardrails, all done this phase:

1. **Record the final numbers** (per preset, per map: avg/min FPS + draw calls) in `docs/release-evidence.md` — that table *is* the regression baseline.
2. **Instancing rule into convention:** add a line to [`01-architecture.md`](./01-architecture.md) §7 conventions (same commit as T2's last fix): "Repeated world objects (barriers, props, shells, bananas, item boxes) must use `InstancedMesh`; one Mesh per instance is a review blocker."
3. **Disposal rule into convention:** same commit — "Every object created for a race must be reachable from `RaceController.dispose()`; the 5-race particle-count check in T2/T8 is the acceptance test for this."
4. **No new per-frame allocations in HUD/render hot paths** — value-change-gated DOM writes (T2 item 4) become the standing pattern for any future HUD element.

These are doc + review-level guardrails, not CI gates: the project has no GPU in its test environment, so FPS can only be measured on real hardware. The e2e suite still runs on every change and would catch a disposal regression indirectly (leaked audio/meshes breaking later races), which is why T8's unit test matters even though it's headless.

## Cold-load polish gate (detail)

[`00-overview.md`](./00-overview.md) §Verification item 6 is the final cold-load gate; this phase executes it with a fixed procedure so the evidence is reproducible:

1. Hard-reload with devtools open and the Network panel throttled to "Slow 4G" (simulates a weak connection for the JS bundle).
2. Record: time from navigation start to first paint of the menu title; time until the Start button is clickable; total transferred bytes.
3. In the Performance panel, record any long task > 200 ms during load and name its source (bundle parse vs. scene construction vs. shader compile).
4. **Pass criteria:** menu interactive within a few seconds on reference hardware with no single long task > 500 ms; if shader compilation causes a hitch at first map entry, pre-compile the heaviest materials during the countdown screen (a legitimate P7 optimization — log it in `docs/release-evidence.md`).

## Test list

**Automated:**
- `tests/unit/disposal.test.ts` — headless race ×5 sequentially; after each `RaceController.dispose()`, tracked entity/projector counts return to baseline (no growing allocation). Requires the explicit `dispose()` chain documented above — add it if missing.
- Existing e2e suite **unchanged**, re-run as final gate: smoke, selection navigation, full scripted 3-lap race to results ([`01-architecture.md`](./01-architecture.md) §9 rule 4 — assertions via DOM + `window.__game`, never screenshots).

**Manual (this phase):**
- Perf measurement runs per T2 (5-race particle-leak cycle at High and Low; draw-call counts with all VFX active, using the [measurement protocol](#step-by-step-tasks-numbered-each-small-and-independently-verifiable)).
- Balancing sessions per T4 (10 races/map/character rotation, win-rate table recorded).
- 90-minute bug bash per T5 (all eleven edge cases hunted with their verification steps, findings logged in the template).
- Fresh-clone README walkthrough per T6.
- Cold-load gate run per [Cold-load polish gate](#cold-load-polish-gate-detail) procedure.
- Full playthrough with devtools console open — zero warnings, both maps.
