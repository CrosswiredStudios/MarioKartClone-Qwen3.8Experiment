/**
 * ALL gameplay magic numbers live here. No other file may contain a raw
 * gameplay constant (01-architecture.md §6). Phase 3 adds the `camera`
 * section to this same file — do not scatter camera constants elsewhere.
 */
export const TUNING = {
  physics: {
    maxSpeedBase: 30,
    accelBase: 12,
    brakeForce: 25,
    reverseMax: -8,
    steerRateBase: 2.4,
    offRoadDrag: 0.92,
    onRoadMargin: 0.5, // meters of grace beyond roadWidth/2 before "offRoad" (Phase 3)
    dragCoef: 0.6, // terminal-speed drag coefficient per second (Phase 3)
  },
  drift: { charge1Time: 0.6, charge2Time: 1.4, miniBoostSpeed: 38, superBoostSpeed: 46, boostDuration: 0.8 },
  // Chase camera (Phase 3 Task 6). dist/height/fov lerp with speedRatio; smoothing is the
  // exponential-follow rate (higher = snappier). See KartRenderer / FreeDriveScene.
  camera: {
    distMin: 5,
    distMax: 7,
    heightMin: 2.2,
    heightMax: 3,
    fovMin: 0.8,
    fovMax: 1.0,
    smoothing: 6,
    // Phase 7 in-scene countdown: the wide grid framing before the zoom into chase.
    countdownWideFov: 1.25, // fov of the wide view (eases down to fovMin at GO)
    countdownMinDist: 30, // m — floor on the wide-view distance behind the player
  },
  // Items & weapons (Phase 5). Every gameplay constant for the item system lives here.
  items: {
    shroomBoost: 40, // m/s forced while a shroom boost is active
    starDuration: 6, // s of invincibility + sustained boost
    lightningShrink: 5, // s that opponents stay shrunk
    bananaSkid: 1.0, // s of spin from picking up a banana
    shellBounceMax: 3, // green-shell bounce limit (wall + kart bounces)
    shroomDurationSec: 1.5,
    shellLaunchOffsetM: 1.2, // shell spawns this far behind kart center (along -forward) on release
    greenSpeedFactor: 2.0, // × owner current speed at fire
    redSpeedFactor: 1.6, // × owner maxSpeed
    blueSpeedFactor: 2.2, // × TUNING.physics.maxSpeedBase
    redRangeM: 30, // homing acquisition range (nearest kart ahead by t)
    shellHomingRate: 6.0, // rad/s — how fast red/blue velocity rotates toward target (snappy; ~7 m turn radius at 44 m/s)
    redExpiresSec: 5,
    blueExpiresSec: 8,
    shellHitRadiusM: 0.8,
    ownerImmunitySec: 1.0, // owner immune to own shell for first 1 s after spawn
    hitSlowFactor: 0.3, // "hit" status: effective maxSpeed × this
    hitDurationSec: 0.5,
    bananaDropOffsetM: 1.5, // placed at owner pos − forward × this
    bananaLifetimeSec: 30,
    boxRespawnSec: 5,
    pickupRadiusM: 1.2,
    skidSpinRate: 4, // rad/s — heading += rate * dt * sign(speed) while skidding
    oilSkidSec: 0.8,
    shrinkMaxSpeedFactor: 0.75,
    shrinkSteerFactor: 0.8,
    bulletBillSpeed: 45, // m/s forced
    bulletBillDurationSec: 3, // or until first kart hit
    bulletBillKnockback: -12, // victim speed (m/s) on a bullet-bill hit
  },
  // Camera shake envelope (Phase 5). Amplitudes in meters; decay/freq shape the sine.
  shake: { hitMeters: 0.25, boostMeters: 0.1, lightningMeters: 0.35, decayPerSec: 4, freqHz: 9 },
  ai: { rubberBandFactor: 0.06, speedVariance: 0.08, waypointLookahead: 12 },
  // Race loop (Phase 4). countdownSeconds = 3-2-1-GO at 1 s intervals; standings are
  // recomputed once per second (not per frame) to avoid float-noise rank flicker.
  race: {
    countdownSeconds: 3,
    checkpointsPerLap: 8,
    standingsIntervalSec: 1,
    aiFinishTimeoutSec: 10,
    // Perfect start (Phase 7): gas pressed within this window after GO grants a boost.
    perfectStartWindowSec: 0.3,
    startBoostSpeed: 40, // m/s forced while the start boost is active
    startBoostDurationSec: 1.2,
  },
  // Finish-out spectator view (Phase 7): after the player crosses the line on the last
  // lap, the camera eases to a high chase framing and follows the AI-driven player kart
  // while the rest of the field finishes out.
  finishOut: {
    camDist: 28, // m behind the kart (vs ~5–7 for normal chase)
    camHeight: 16, // m above the kart
    fov: 1.15,
    camEaseSec: 1.5, // seconds to ease from the current framing into the wide view
  },
  // Themed terrain (Phase 4.1). The pure heightfield (TrackElevation) and the render
  // layer both read from here — no raw numbers elsewhere.
  terrain: {
    // Road ribbon sits this far above the heightfield so it never z-fights or gets
    // poked through by a rounded-up ground vertex (the heightmap is 8-bit quantized;
    // even with tight-range encoding that's ~5 cm on Lagoon, so 0.2 clears it).
    roadYOffset: 0.2,
    // Simple gravity for airborne karts (cliff drops): vertical accel in m/s².
    gravity: 22,
    // A kart is "airborne" when it sits more than this above the surface — a
    // small tolerance so grounded karts don't flicker into air on noise jitter.
    airborneEpsilon: 0.15,
    /** Heightmap grid resolution per side (square grid over the track bounds + margin). */
    gridResolution: 96,
    /** Extra world-space margin around the control-point extent for the ground field. */
    boundMargin: 24,
    /** Lateral distance from centerline where off-road noise is fully faded out (m). */
    corridorHalfWidth: 8,
    /** Distance over which the noise fades from 0 → full amplitude beyond the corridor (m). */
    corridorMargin: 10,
    /** Mild slope speed model: fraction of top-speed lost per unit uphill gradient
     *  (dy/dx along heading), clamped to ±slopeClamp. Downhill adds symmetrically. */
    slopeFactor: 0.12,
    slopeClamp: 0.35,
    /** Half-distance (m) of the central-difference gradient sample along heading. */
    slopeSampleDist: 1,
  },
  quality: {
    low: { shadowMapSize: 0, ssao: false, bloom: false, particleBudget: 0.35, pixelRatioCap: 1, propDensity: 0.4 },
    medium: { shadowMapSize: 1024, ssao: true, bloom: true, particleBudget: 0.7, pixelRatioCap: 1.5, propDensity: 0.7 },
    high: { shadowMapSize: 2048, ssao: true, bloom: true, particleBudget: 1.0, pixelRatioCap: Infinity, propDensity: 1.0 },
  },
  // VFX (Phase 6). Every visual magic number lives here — never in the render layer.
  vfx: {
    boostDurationSec: 0.8, // boost-flame emitter lifetime (matches drift.boostDuration)
    boostEmitRatePerSec: 140, // × quality budget() at High
    shellExplosionLifetimeSec: 0.5,
    shellFlashDecayMs: 150, // point-light intensity 3 → 0
    starSparkleRadiusM: 0.8, // orbit radius around the starred kart
    lightningFlashMs: 120, // full-screen white overlay pulse duration
    confettiLifetimeSec: 3,
    skidMinSpeed: 6, // m/s — dust only while off-road AND faster than this
    boostFlameRearOffsetM: 0.6, // emitter offset behind kart center (local -Z)
    shellFlashPeakIntensity: 3, // explosion point-light intensity at t=0 (decays to 0)
    lightningShrinkScale: 0.6, // mesh scale factor while a "shrink" effect is active (visual only)
    starParticleLifeSec: 1.2, // individual sparkle lifetime; the system persists while starred
    starSparkleEmitRatePerSec: 30, // × quality budget() at High
    skidDustEmitRatePerSec: 40, // × quality budget() at High
    shellExplosionBurstCount: 60, // particles in the radial burst (× budget)
    confettiBurstCount: 120, // particles per podium burst (× budget)
    bridgeBarrierExtraHeightM: 0.4, // barriers on widthOverride spans are taller
    bridgeVoidDropM: 3, // cliff void plane sits this far below road level
  },
  // Audio (Phase 6). Synthesized catalog — no asset files.
  audio: {
    enginePitchMinHz: 80, // idle
    enginePitchMaxHz: 240, // top speed; curve = min + (max−min)·ratio^1.5
    engineLfoDepthPct: 3, // ±% frequency wobble for mechanical feel
    musicCrossfadeMs: 300, // theme switch ramp
    schedulerTickMs: 25, // lookahead timer period
    schedulerLookaheadSec: 0.1, // notes are scheduled this far ahead of the playhead
  },
} as const;

export type QualityPreset = keyof typeof TUNING.quality; // "low" | "medium" | "high"
