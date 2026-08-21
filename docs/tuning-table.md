# Tuning Table

> **Rule: any change to `src/data/tuning.ts` MUST update this table in the same commit.** Every gameplay magic number lives in `TUNING` (01-architecture.md §6) — no other file may contain a raw gameplay constant. This table documents each value with a one-line rationale and the "feel" target it serves, so balancing (Phase 7 T4) is a single-file exercise and AI-assisted tuning changes are safe.

Row format: `| Key | Value | Rationale | Feel target |`

## physics — base kart kinematics (kinematic `stepKart` curves)

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `physics.maxSpeedBase` | 30 | baseline m/s; character topSpeed stat scales ±20% | "fast but readable" — a full lap ≈ 45–60 s at base speed |
| `physics.accelBase` | 12 | baseline acceleration m/s²; character accel stat scales it | 0→top in ~2.5 s at base stats |
| `physics.brakeForce` | 25 | braking is ~2× accel — stopping must feel decisive | full stop from top speed in ~1.2 s |
| `physics.reverseMax` | −8 | reverse is a recovery tool, not a weapon | back up slowly enough to reposition, never to escape |
| `physics.steerRateBase` | 2.4 | peak yaw rate rad/s; handling stat scales it | a full 180° in ~1.3 s at top handling |
| `physics.steerEase4w` | 10 | per-second exponential approach rate for 4-wheel smoothed steer (~63% in 0.1 s, ~95% in 0.3 s); bikes use 0 (instant) | karts/ATVs build turns gradually instead of snapping; bikes twitch instantly |
| `physics.offRoadDrag` | 0.92 | per-step speed multiplier off-road | grass costs ~8%/step — a real penalty, not a wall |
| `physics.onRoadMargin` | 0.5 | meters of grace beyond `roadWidth/2` before "offRoad" | hugging the edge doesn't instantly count as off-road |
| `physics.dragCoef` | 0.6 | terminal-speed drag coefficient per second | speed asymptotes to max instead of overshooting |

## physicsWorld — Havok rigid-body world (physics rewrite)

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `physicsWorld.gravityY` | −14 | scene-level Havok gravity; heavier than real 9.81 | boosted/airborne karts fall back fast instead of floating down slowly |
| `physicsWorld.timestepSec` | 1/60 | fixed plugin step; Scene auto-steps each render frame | deterministic, matches the logic timestep |
| `physicsWorld.kartMassKg` | 120 | per-kart rigid body mass | bumping momentum scales with this; 120 kg reads as "heavy kart" |
| `physicsWorld.kartRestitution` | 0.35 | bounciness of kart↔kart and kart↔terrain contacts | a small pop on impact, no pinball |
| `physicsWorld.kartFriction` | 0.6 | contact friction | driving grip comes from the drive force, not this |
| `physicsWorld.linearDamping` | 0.1 | velocity bleed per second | off-road roll-outs don't coast forever |
| `physicsWorld.angularDamping` | 0.4 | yaw/pitch/roll bleed per second | settles bumps without killing steer response |
| `physicsWorld.lateralGripRate` | 12 | sideways slip scrubbed at this rate (1/s) | high = tires lock to heading (kart feel); low = boat drift |
| `physicsWorld.maxDriveAccelMps2` | 40 | drive authority cap; normal accel (12) and braking (25) fit inside | after a bump steals velocity the engine takes ~0.3–1 s to recover (arcade "shoved" feel); boost jumps chase fast |
| `physicsWorld.uphillPowerFactor` | 0.5 | drive authority ×(1 + factor × clampedGradient) while climbing | +17.5% authority at the steepest clamped slope — less momentum loss uphill |
| `physicsWorld.capsuleRadiusM` | 0.55 | kart collision capsule radius | bumping distance ≈ kart visual width |
| `physicsWorld.capsuleHalfLengthM` | 0.9 | pointA→pointB half-extent (total ≈ radius·2 + halfLength·2) | capsule covers the kart's long axis |
| `physicsWorld.centerHeightM` | 0.6 | body pivot height above terrain at rest | matches the rendered chassis height |
| `physicsWorld.suspRayLengthM` | 1.2 | virtual suspension ray length (render raycasts) | max wheel travel before "off the ground" |
| `physicsWorld.suspRestHeightM` | 0.55 | target wheel travel for render smoothing | wheels settle at the visual rest height |
| `physicsWorld.bumpImpulseThreshold` | 40 | kg·m/s above which a hit registers | grazing passes are silent; real hits shake + SFX |
| `physicsWorld.bumpCooldownSec` | 0.5 | per-pair cooldown | no event spam while two karts are in contact |

## drift — charge tiers & turbo

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `drift.charge1Time` | 0.6 | mini turbo reachable in under a second of drifting | reward quick commitment, not just holding Space |
| `drift.charge2Time` | 1.4 | super turbo requires sustained drift | ~1.4 s feels earned but not punishing |
| `drift.miniBoostSpeed` | 38 | forced speed on mini release | a clear but short pop above base top speed |
| `drift.superBoostSpeed` | 46 | forced speed on super release | ~20% stronger than mini — commitment pays off |
| `drift.boostDuration` | 0.8 | seconds of forced speed after release | long enough to gain ground on a straight, short enough to stay tense |

## camera — chase camera

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `camera.distMin` | 5 | closest chase distance at low speed | intimate at low speed |
| `camera.distMax` | 7 | farthest chase distance at top speed | pullback reads speed |
| `camera.heightMin` | 2.2 | lowest camera height | just above the kart |
| `camera.heightMax` | 3 | highest camera height | keeps the horizon visible at speed |
| `camera.fovMin` | 0.8 | fov at low speed | normal framing |
| `camera.fovMax` | 1.0 | fov at top speed | slight wide-angle rush |
| `camera.smoothing` | 6 | exponential-follow rate (higher = snappier) | camera follows without lagging or jittering |
| `camera.countdownWideFov` | 1.25 | fov of the wide grid framing before the zoom | the whole grid is visible at "3" |
| `camera.countdownMinDist` | 30 | m — floor on wide-view distance behind the player | wide enough to see the field, not so far the kart is a pixel |

## items — weapons & power-ups

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `items.shroomBoost` | 40 | m/s forced while a shroom boost is active | a strong, obvious burst |
| `items.shroomDurationSec` | 1.5 | shroom boost length | ~1.5 s of sustained boost |
| `items.starDuration` | 6 | s of invincibility + sustained boost | long enough to string 2–3 hits, short enough to stay tense |
| `items.lightningShrink` | 5 | s opponents stay shrunk | a real comeback window, not a race-ender |
| `items.bananaSkid` | 1.0 | s of spin from picking up a banana | disorienting but recoverable |
| `items.shellBounceMax` | 3 | green-shell bounce limit (wall + kart bounces) | green shells are chaotic but eventually die |
| `items.shellLaunchOffsetM` | 1.2 | shell spawns this far behind kart center on release | the shell visibly leaves the kart |
| `items.greenSpeedFactor` | 2.0 | × owner current speed at fire | fast when you're fast |
| `items.redSpeedFactor` | 1.6 | × owner maxSpeed | steady, predictable speed |
| `items.blueSpeedFactor` | 2.2 | × `physics.maxSpeedBase` | the leader's threat is the fastest thing on track |
| `items.redRangeM` | 30 | homing acquisition range (nearest kart ahead by t) | red shells lock on nearby, not across the map |
| `items.shellHomingRate` | 6.0 | rad/s — how fast red/blue velocity rotates toward target | snappy homing (~7 m turn radius at 44 m/s); doc 07 said 3.0 but that was too lazy to hit at kart speeds |
| `items.redExpiresSec` | 5 | red shell lifetime | a window to dodge, not a permanent threat |
| `items.blueExpiresSec` | 8 | blue shell lifetime | the leader has time to react |
| `items.shellHitRadiusM` | 0.8 | hit detection radius | forgiving enough to feel fair at speed |
| `items.ownerImmunitySec` | 1.0 | owner immune to own shell for first 1 s | no instant self-hits on release |
| `items.hitSlowFactor` | 0.3 | "hit" status: effective maxSpeed × this | a hit costs real speed |
| `items.hitDurationSec` | 0.5 | hit-slow length | a stumble, not a shutdown |
| `items.bananaDropOffsetM` | 1.5 | placed at owner pos − forward × this | clearly behind the dropper |
| `items.bananaLifetimeSec` | 30 | banana persistence | lingers long enough to be a trap |
| `items.boxRespawnSec` | 5 | item-box respawn timer | boxes come back before the next pass |
| `items.pickupRadiusM` | 1.2 | box pickup radius | forgiving pickup at speed |
| `items.skidSpinRate` | 4 | rad/s — heading += rate·dt·sign(speed) while skidding | a full spin in ~1.5 s |
| `items.oilSkidSec` | 0.8 | oil-slick skid length | shorter than a banana — a hazard, not a trap |
| `items.shrinkMaxSpeedFactor` | 0.75 | shrunk karts' top-speed multiplier | visibly slower |
| `items.shrinkSteerFactor` | 0.8 | shrunk karts' steer multiplier | wobbly when small |
| `items.bulletBillSpeed` | 45 | m/s forced | the fastest thing in the game |
| `items.bulletBillDurationSec` | 3 | or until first kart hit | a committed, short dash |
| `items.bulletBillKnockback` | −12 | victim speed (m/s) on a bullet-bill hit | sends the victim backwards hard (note: `trackLaps` guards the resulting start-line crossing) |

## shake — camera shake envelope

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `shake.hitMeters` | 0.25 | shell-hit amplitude | a solid jolt |
| `shake.boostMeters` | 0.1 | boost amplitude | a subtle kick, not nausea |
| `shake.lightningMeters` | 0.35 | lightning amplitude | the biggest shake — a major event |
| `shake.bumpMeters` | 0.15 | kart↔kart rigid-body bump | softer than a shell hit |
| `shake.decayPerSec` | 4 | amplitude decay rate | shakes die within ~0.5 s |
| `shake.freqHz` | 9 | sine frequency | a fast rattle, not a slow sway |

## ai — opponents

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `ai.rubberBandFactor` | 0.06 | speed adjustment toward the player's progress | races stay close but winnable; the escape valve for balancing (nudge up to compress win rates toward 25%) |
| `ai.speedVariance` | 0.08 | per-racer speed spread | the field isn't a pack of clones |
| `ai.waypointLookahead` | 12 | m ahead on the spline the AI aims at | smooth cornering, no oscillation |

## race — race loop

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `race.countdownSeconds` | 3 | 3-2-1-GO at 1 s intervals | classic pacing |
| `race.worldReadyTimeoutSec` | 8 | force the world "ready" even if a texture never reports `isReady()` | a stuck load can't hang the countdown |
| `race.checkpointsPerLap` | 8 | checkpoint sequence per lap | anti-cheat lap validation + standings granularity |
| `race.standingsIntervalSec` | 1 | standings recomputed once per second | no float-noise rank flicker |
| `race.aiFinishTimeoutSec` | 10 | grace period after the player finishes before DNFing stragglers | finish-out feels natural, not infinite |
| `race.perfectStartWindowSec` | 0.3 | accelerate must be PRESSED within this window before GO | a tight, skill-based reward |
| `race.startBoostSpeed` | 40 | m/s forced while the start boost is active | matches the shroom — a real head start |
| `race.startBoostDurationSec` | 1.2 | start-boost length | enough to gain a car-length, not a lap |

## finishOut — post-finish spectator view

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `finishOut.camDist` | 28 | m behind the kart (vs ~5–7 normal chase) | a wide, cinematic follow |
| `finishOut.camHeight` | 16 | m above the kart | high enough to see the field |
| `finishOut.fov` | 1.15 | wide fov | the whole finish area is visible |
| `finishOut.camEaseSec` | 1.5 | seconds to ease from current framing into the wide view | a smooth handoff, not a cut |

## terrain — themed terrain & elevation

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `terrain.roadYOffset` | 0.35 | road ribbon sits this far above the heightfield | clears 8-bit quantization + coarse-grid crest overshoot (~0.3 m worst case on Lagoon) — no z-fight, no ground poking through |
| `terrain.shoulderFlareM` | 1.2 | road-slab side walls flare OUTWARD this far beyond road half-width | hides the shoulder seam |
| `terrain.buryDepthM` | 0.45 | how far BELOW local terrain the slab's bottom edge is buried | must exceed the heightmap's ~5 cm quantization so it always tucks under the ground mesh |
| `terrain.gravity` | 22 | vertical accel for airborne karts (cliff drops) | karts launch off drops and fall back at a game-y pace |
| `terrain.airborneEpsilon` | 0.15 | a kart is "airborne" when more than this above the surface | small tolerance so grounded karts don't flicker into air on noise jitter |
| `terrain.gridResolution` | 96 | heightmap grid resolution per side | smooth enough for the visual ground, cheap to build |
| `terrain.boundMargin` | 24 | extra world-space margin around the control-point extent | the ground extends well past the track |
| `terrain.corridorHalfWidth` | 8 | lateral distance from centerline where off-road noise is fully faded out | the road corridor is flat; noise builds up off-road |
| `terrain.corridorMargin` | 10 | distance over which the noise fades 0 → full amplitude beyond the corridor | a gradual transition, not a cliff at the road edge |
| `terrain.slopeFactor` | 0.06 | fraction of top-speed lost per unit uphill gradient | mild slope speed model — hills matter but don't dominate |
| `terrain.slopeClamp` | 0.35 | gradient clamp (±) | prevents extreme slopes from zeroing speed |
| `terrain.slopeSampleDist` | 1 | half-distance (m) of the central-difference gradient sample along heading | stable gradient estimate |

## quality — presets (mirrors 01-architecture.md §10)

| Preset | shadowMapSize | ssao | bloom | particleBudget | pixelRatioCap | propDensity |
|---|---|---|---|---|---|---|
| `low` | 0 (off) | off | off | 0.35 | 1 | 0.4 |
| `medium` | 1024 | on (half res) | on | 0.7 | 1.5 | 0.7 |
| `high` | 2048 | on | on | 1.0 | Infinity (device) | 1.0 |

Auto-detect: a short burst of rendered frames at High on first launch; if average FPS < 50, step down one preset. Persisted choice overrides auto-detect (`SettingsStore`). All VFX/particle code queries `QualityManager.budget()` — never hardcodes counts.

## vfx — particles & visual effects

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `vfx.boostDurationSec` | 0.8 | boost-flame emitter lifetime (matches `drift.boostDuration`) | flames last exactly as long as the boost |
| `vfx.boostEmitRatePerSec` | 140 | × quality `budget()` at High | a dense, readable flame trail |
| `vfx.shellExplosionLifetimeSec` | 0.5 | explosion particle lifetime | a quick pop |
| `vfx.shellFlashDecayMs` | 150 | point-light intensity 3 → 0 | a fast flash |
| `vfx.shellFlashPeakIntensity` | 3 | explosion point-light intensity at t=0 | bright enough to read at speed |
| `vfx.shellExplosionBurstCount` | 60 | particles in the radial burst (× budget) | a satisfying burst |
| `vfx.starSparkleRadiusM` | 0.8 | orbit radius around the starred kart | sparkles hug the kart |
| `vfx.starParticleLifeSec` | 1.2 | individual sparkle lifetime; system persists while starred | continuous shimmer |
| `vfx.starSparkleEmitRatePerSec` | 30 | × quality `budget()` at High | a steady sparkle field |
| `vfx.lightningFlashMs` | 120 | full-screen white overlay pulse duration | a sharp flash, not a fade |
| `vfx.lightningShrinkScale` | 0.6 | mesh scale factor while "shrink" is active (visual only) | clearly smaller |
| `vfx.confettiLifetimeSec` | 3 | podium confetti particle lifetime | a long celebration |
| `vfx.confettiBurstCount` | 120 | particles per podium burst (× budget) | a generous shower |
| `vfx.skidMinSpeed` | 6 | m/s — dust only while off-road AND faster than this | no dust when crawling |
| `vfx.skidDustEmitRatePerSec` | 40 | × quality `budget()` at High | a visible dust trail |
| `vfx.boostFlameRearOffsetM` | 0.6 | emitter offset behind kart center (local −Z) | flames come from the back |
| `vfx.bridgeVoidDropM` | 3 | cliff void plane sits this far below road level | the void reads as a real drop |

## audio — synthesized catalog

| Key | Value | Rationale | Feel target |
|---|---|---|---|
| `audio.enginePitchMinHz` | 80 | idle engine pitch | a low idle rumble |
| `audio.enginePitchMaxHz` | 240 | top-speed pitch; curve = min + (max−min)·ratio^1.5 | a rising whine that reads speed |
| `audio.engineLfoDepthPct` | 3 | ±% frequency wobble | mechanical feel, not a pure tone |
| `audio.musicCrossfadeMs` | 300 | theme-switch ramp | a smooth menu→race transition |
| `audio.schedulerTickMs` | 25 | lookahead timer period | tight enough for low-latency scheduling |
| `audio.schedulerLookaheadSec` | 0.1 | notes scheduled this far ahead of the playhead | no audio dropouts under load |
