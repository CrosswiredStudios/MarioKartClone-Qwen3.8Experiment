---
description: "Use when writing or modifying Havok physics code: PhysicsWorld, KartBody, kartDriveMath, KartPhysics, collision events, heightfield terrain, or the hybrid brain/body drive model."
name: "Havok Physics Rules"
applyTo: ["src/scene/PhysicsWorld.ts", "src/entities/KartBody.ts", "src/entities/kartDriveMath.ts", "src/entities/KartPhysics.ts"]
---

# Havok Physics Rules

**First read [`docs/HAVOK.md`](../../docs/HAVOK.md)** — every fact there was verified against the installed `@babylonjs/core` ^9.21.2 + `@babylonjs/havok` 1.3.14.

## The top-3 gotchas

1. **`HavokPlugin` ctor arg order:** `(useDeltaForWorldStep?, hk, parameters?)` — the loaded Havok instance is the **SECOND** arg: `new HavokPlugin(true, hk)`. Wrong order → "ReferenceError: HK is not defined" at runtime (build succeeds).
2. **Dev server serves HTML for the `.wasm`** → "expected magic word" crash. Test physics against `npx vite preview --port 4173`, NOT `vite` dev. `vite.config.ts` `optimizeDeps.exclude: ["@babylonjs/havok"]` is load-bearing — don't remove it.
3. **The plugin syncs body→node each step** — `node.position.set()` does NOT move a dynamic body (teleports are overwritten within a frame). There is no `setPosition()`; velocity/impulse only (`setLinearVelocity`, NOT `setVelocity`).

## Hybrid brain/body drive model

- Per-kart loop: `k.drive?.sync(k)` (body→state) → `stepKart(terrain = k.drive ? undefined : this.terrain)` → `k.state = next` → `k.drive?.apply(next, dt)`.
- **Snapped-authority rule:** bulletBill/boost/star get the FULL impulse `(next.speed − curFwd)·m`; everything else is clamped to `maxDriveAccelMps2·m·dt` so bumps matter for normal driving.
- **Yaw:** `setAngularVelocity(new Vector3(0, yawRate, 0))` each apply (X/Z zeroed kills bump-induced roll/pitch). `kickYaw` adds Δ/dt on `_lastAppliedYaw` — NOT an `atan2` diff (±π wrap hazard).
- `state.pos.y = node Y − centerHeightM`; `speed = dot(vel, fwd)` (can go negative; brain clamps to `reverseMax`).
- **`drive === null` → legacy kinematic integration.** Headless unit tests run without physics — keep that path working.
- Hit paths push real impulses (`scaleSpeed`/`kickYaw`/`setSpeed`) — direct state writes get clobbered by the next `sync()`.
- `applyImpulse`/`applyForce` location is **WORLD SPACE**. `setMassProperties` merges partial fields → `{ ...body.computeMassProperties(), mass }` is safe.
- `PhysicsBody.dispose()` does NOT dispose its transform node — dispose the node separately.
- Collision callbacks are OFF by default: `body.setCollisionCallbackEnabled(true)` + `body.getCollisionObservable()`. Kart↔terrain pairs are silent by design.
- Freeze while Paused = `scene.physicsEnabled = false` (via `PhysicsWorld.setFrozen`) — never call `_step` manually.
- All constants live in `TUNING.physicsWorld` — no raw numbers in these files.
