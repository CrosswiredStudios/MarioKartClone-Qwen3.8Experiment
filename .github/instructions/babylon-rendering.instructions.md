---
description: "Use when writing or modifying Babylon.js rendering code: scenes, render pipeline, quality manager, particles, VFX, HUD, or main.ts bootstrap. Covers verified v9 API facts and the runtime-only rendering killers."
name: "Babylon Rendering Rules"
applyTo: ["src/scene/**", "src/rendering/**", "src/vfx/**", "src/ui/Hud.ts", "src/main.ts"]
---

# Babylon Rendering Rules

**First read [`docs/BABYLON-V9.md`](../../docs/BABYLON-V9.md)** — the plan docs assume older v4/v5 APIs; that file is the verified source of truth for the installed `@babylonjs/core` ^9.21.2.

## The top-5 runtime-only killers (build + tsc pass, runtime breaks)

1. **Never set `emissiveColor` on the skybox material** — it is additive in v9 and washes the sky out to gray/white. Leave it black; the cubemap is the sole color source.
2. **`DynamicTexture` is transparent until `tex.update()`** is called after drawing. A lit material sampling an un-updated DynamicTexture renders nothing.
3. **Hand-written vertex buffers render as hairline strips** — use `MeshBuilder.CreateRibbon` for ribbon geometry (road, skids). UVs: u = along path, v = across.
4. **Vertex color MUST be RGBA (4 floats/vertex)** — a 3-float RGB buffer throws `RangeError` the moment the mesh goes through `Mesh.MergeMeshes`.
5. **`transformFromQuaternion` was renamed** → `applyRotationQuaternionInPlace(q)`. The old name throws only at runtime.

Also: `DynamicTexture` defaults to CLAMP addressing — set `WRAP_ADDRESSMODE` before `uScale > 1` or the texture shows only a sliver. `Color3.White()` is a factory method. `Mesh.BACKSIDE = 1`. `scene.fogColor` is Color3, `scene.clearColor` is Color4.

## Performance & lifecycle rules

- **Repeated world objects (barriers, props, shells, bananas, item boxes) MUST use `InstancedMesh`** — one Mesh per instance is a review blocker.
- **Every long-lived subsystem implements `dispose()`** and is called on quit-to-menu. Disposal audit: after quit, `scene.lights.length`, `engine.getParticlesCount()`, `scene.meshes.length` must return to the menu baseline.
- **All VFX/particle code queries `QualityManager.budget()`** — never hardcode particle counts.
- **Per-frame clocks that must align with the visible countdown gate on `isWorldReady`** — a clock that advances during the loading screen desyncs (the countdown-zoom bug).
- **`keepWorldOnExit(to)`** — `IGameScreen` hook; `RaceScene` returns true only for `"Results"` so the podium keeps the world alive. GameApp skips `from.exit()` when true.
- Hardware scaling is a method pair: `engine.setHardwareScalingLevel(level)` / `getHardwareScalingLevel()` — not a property.
- `Observer` has no public `dispose()` — use `observer.remove(true)` for deferred removal from inside a notification loop.
- `scene.activeCamera` is `Nullable<Camera>` — narrow before passing `[cam]` to pipeline ctors.
