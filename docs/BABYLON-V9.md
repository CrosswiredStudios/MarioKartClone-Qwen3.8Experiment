# Babylon.js v9 API Facts (verified against installed `@babylonjs/core` ^9.21.2)

> The plan docs (`docs/plans/`) were written assuming older v4/v5 APIs. **This file is the source of truth for what actually works in the installed build** — every fact below was verified against the installed `.d.ts` files and/or runtime probes. When the plan docs and this file disagree, this file wins. Update this file in the same commit as any Babylon upgrade.

## Post-processing / rendering pipeline

- **NO `FXAA` class export.** FXAA is built into `DefaultRenderingPipeline` via `pipeline.fxaaEnabled = true/false`.
- `DefaultRenderingPipeline` ctor: `(name?, hdr?, scene?, cameras?, automaticBuild?)`. Props: `bloomEnabled`, `bloomWeight` (= intensity), `bloomThreshold`, `fxaaEnabled`, `imageProcessingEnabled`. There are **NO** `bloomEffect`/`ssaoEffect` objects and **NO SSAO** in this pipeline.
- **SSAO is a SEPARATE pipeline:** `new SSAORenderingPipeline(name, scene, ratio, cameras?)` where `ratio` is a number (0.5 = half-res) or `{ ssaoRatio, combineRatio }`. Props: `totalStrength` / `radius` / `area` / `fallOff` / `base`.
- **Image processing / color grade lives on the SCENE:** `scene.imageProcessingConfiguration.contrast = 1.05`. v9 has `contrast` but **NO `saturation` accessor** (deviation from plan).
- Both pipeline classes export from the bare `"@babylonjs/core"` root.

## Side orientation & constants

- `Mesh.BACKSIDE = 1`, `Mesh.FRONTSIDE = 0` (NOT `Scene.BACKSIDE`).
- `Texture.SKYBOX_MODE = 5` in v9 (NOT the old docs' 1024) — verified at runtime.
- `Color3.White` is a **FACTORY METHOD** in v9 → call `Color3.White()` (not a static instance).

## Skybox / CubeTexture

- `CubeTexture(basePath, scene)` appends `_px/_nx/_py/_ny/_pz/_nz.jpg` **directly** to `basePath` — no subdirectory support; files must be flat in `public/textures/`.
- Skybox pattern used in this project: inverted sphere (`MeshBuilder.CreateSphere`, `BACKSIDE`) + `infiniteDistance = true` + `applyFog = false`; material uses `reflectionTexture` (not `diffuseTexture`) with `SKYBOX_MODE`, `disableLighting = true`.
- **CRITICAL: do NOT set `emissiveColor` on the skybox material.** In v9's standard fragment shader, `finalDiffuse = clamp(diffuseBase*diffuseColor + emissiveColor + vAmbientColor, 0, 1)` and the final color is `finalDiffuse*baseAmbientColor + reflectionColor.rgb`. With `disableLighting`, `diffuseBase` stays 0, so a white emissive makes `finalDiffuse = (1,1,1)` and ADDS pure white on top of the cubemap → washed-out gray/white sky. Leave emissive at default (black); the cubemap is the sole color source. (This bug shipped and was caught by a user seeing a gray sky.)
- Assets: `public/textures/skybox_meadows_*.jpg` and `skybox_lagoon_*.jpg`, wired via `TrackTheme.skybox`; guarded by `tests/unit/skybox-assets.test.ts`.
- **IBL:** `scene.environmentTexture = skyboxCubeTexture` (set in `RenderPipelineSetup.buildSkybox`) lights ALL PBR materials in one assignment. Clear it BEFORE disposing the cubemap in `disposeEnvironment`. A plain LDR `CubeTexture` is fine (no `RGBDCubeTexture` in this build).

## Shadows

- **NO `scene.shadowGenerators` array in v9.** `ShadowGenerator` self-registers via its light.
- Ctor: `new ShadowGenerator(mapSize, light)`. Methods: `addShadowCaster(mesh)`, `dispose()`. Props: `usePercentageCloserFiltering = true`, `blurKernel = 8`. Find existing: `light.getShadowGenerators()`.
- `addShadowCaster` accepts **ONLY `AbstractMesh`** (NOT `TransformNode`). To shadow a vehicle root, loop `root.getChildMeshes()` and add each mesh.

## Mesh builders & vertex data

- **NO `MeshBuilder.CreateCone` in this version.** A cone = `CreateCylinder({ diameterTop: 0, diameterBottom, height, tessellation })`.
- Textures: the boolean `anisotropicFiltering` was REMOVED — use `texture.anisotropicFilteringLevel = N` (8 ≈ old max/true).
- `Mesh.setVerticesData` takes **STRING kind keys** (`"position"` / `"normal"` / `"uv"`), not numeric codes, in this version's types.
- **Hand-written vertex buffers render as hairline strips in this build** (`new Mesh` + `setVerticesData` + `setIndices`, or `VertexData.applyToMesh`) — even with provably-correct geometry. **FIX: use `MeshBuilder.CreateRibbon(name, { pathArray: [left[], right[]] }, scene)`.** CreateRibbon UVs: `u` = distance ALONG each path (the loop), `v` = ACROSS the paths (road width) — so repeat along `tex.uScale`, leave `v` unscaled.
- **`DynamicTexture` is transparent until you call `tex.update()`** after drawing to its canvas. A lit `StandardMaterial` sampling an un-updated `DynamicTexture` renders NOTHING (unlit/emissive still shows).
- **`DynamicTexture` defaults to CLAMP addressing.** Setting `uScale > 1` without also setting `WRAP_ADDRESSMODE` clamps everything past u=1 to the last pixel column instead of tiling. Always set both for repeating procedural textures (file-based `Texture` needed explicit wrap too).
- **Vertex color MUST be RGBA (4 floats/vertex).** The color attribute is 4-wide; `mesh.setVerticesData(VertexBuffer.ColorKind, arr)` with a 3-float RGB buffer is harmless on a single-part mesh but throws `RangeError: Invalid typed array length` the moment that part goes through `Mesh.MergeMeshes` (it extracts at stride 4). Always write alpha=1.
- `mesh.useVertexColors` defaults to `true`; `StandardMaterial` enables the VERTEXCOLOR define when `mesh.isVerticesDataPresent(VertexBuffer.ColorKind)`. Just `setVerticesData(VertexBuffer.ColorKind, …)` — no `material.useVertexColors = true` needed.
- Merged source mesh naming: `MergeMeshes([...], true, false, true)` (multiMultiMaterials) names the result `<firstPartName>_merged`.
- `CreateGroundFromHeightMap(name, { data: RGBA Uint8Array, width, height }, { width, height, subdivisions, minHeight, maxHeight, colorFilter })` is **SYNCHRONOUS** with a raw buffer. Encode R=G=B=`round(255·clamp((h−minH)/(maxH−minH)))`, A=255, `colorFilter: new Color3(1/3,1/3,1/3)` → exact heights. Buffer row 0 = +z (maxZ) side; mesh centered at its `position` → set `ground.position.x/z` to bounds center. Use a TIGHT min/max (two-pass over sampled vertices), not the field's headroom-padded minH/maxH, or 8-bit quantization error grows.

## Camera & scene typing

- `scene.activeCamera` is typed `Nullable<Camera>` — narrow to non-null before passing `[cam]` to pipeline ctors.
- `scene.fogColor` is **Color3**; `scene.clearColor` is **Color4**. Don't assume both are Color4.
- **No `scene.getByName()` in this build's types** — keep references to created lights/camera and dispose by ref.
- Create root `TransformNode` WITH the scene (`new TransformNode(name, scene)`); do NOT set `.parent = scene`.
- `DynamicTexture.getContext()` returns `ICanvasRenderingContext` (`fillStyle: string | ICanvasGradient`) — a minimal structural ctx type with `fillStyle: string | object` accepts it.
- `createPickingRay(x, y, world, camera)` — pass `null` for `world`; the camera needs a `Viewport` (set a temp full-screen one if it has none).
- `Observer<T>` exposes typed `remove(defer?: boolean)` but **NO public `dispose()`** — use `observer.remove(true)` for safe deferred removal from inside the notification loop.

## Vector3 (v9 renames)

- `set()` DOES chain (`: this`).
- `transformFromQuaternion(q)` was **RENAMED** → use `applyRotationQuaternionInPlace(q)`. The old name throws "is not a function" **only at runtime** (build + tsc pass — the method exists on some other class). The real d.ts lives in `Maths/math.vector.pure.d.ts` (`math.vector.d.ts` is a re-export shim — grepping it finds nothing).

## Particles (legacy API still present)

- Ctor: `new ParticleSystem(name, capacity, scene)` (ThinParticleSystem base ctor `(name, capacity, sceneOrEngine)`).
- Legacy accessors ALL exist on BaseParticleSystem/ThinParticleSystem: `emitter` (typed `AbstractMesh | Vector3` — a `TransformNode` will NOT type-check; use a world-space `Vector3` + sync per frame), `minEmitBox`/`maxEmitBox`, `emitRate`, `manualEmitCount`, `minLifeTime`/`maxLifeTime`, `color1`/`color2` (Color4), `gravity` (Vector3), `direction1`/`direction2` (get/set accessors), `updateFunction: (particles: Particle[]) => void`.
- **NO legacy `angleMin`/`angleMax`/`maxEmitPower` direct props** — those live on emitter objects (`createPointEmitter(direction1, direction2)` etc.). Use `direction1`/`direction2` + `minEmitBox`/`maxEmitBox` for spread.
- Blend modes are static constants: `ParticleSystem.BLENDMODE_ADD`, `_STANDARD`, `_MULTIPLY`.
- Lifecycle: `.start(delay?)`, `.stop()`, `.dispose(disposeTexture?)`.
- `Particle` fields (for `updateFunction`): `position: Vector3`, `age: number`, `lifeTime: number`, `size: number`. **NO custom/index-signature props** — use a `WeakMap<Particle, T>` for per-particle state.
- `addColorGradient(gradient: number, color1: Color4, color2?: Color4)` exists for multi-color (confetti).

## PBR materials & lighting

- **Standard→PBR makes the same light look ~3× dimmer** → `SUN_INTENSITY_SCALE = 3`, `AMBIENT_INTENSITY_SCALE = 0.35` in `RenderPipelineSetup` (adjust there, not at call sites).
- **NO `specularColor` on `PBRMaterial`** (oil-slick sheen = `roughness 0.12` + `metallic 0.4` + dark cool albedo).
- Clearcoat is a plugin config: `mat.clearCoat.isEnabled / .intensity / .roughness`.
- The VERTEXCOLOR define exists → baked vertex-color mottling survives a Standard→PBR swap.
- `EmissiveColor` is still additive (kart hit-flash works unchanged).
- Material factories live in `src/rendering/materials.ts` — **fresh instance per call; callers own disposal**. Intentionally `StandardMaterial`: skybox sphere, bridge voids, podium mats (hemi light covers them).

## Engine / hardware scaling

- Hardware scaling is a **METHOD pair**: `engine.setHardwareScalingLevel(level)` / `engine.getHardwareScalingLevel()` — NOT a public property (`_hardwareScalingLevel` is private only). `QualityManager` uses the methods.

## Headless testing in Node (vitest, env=node)

- `NullEngine` + `new Scene(engine)` works for real geometry/merge tests.
- **`DynamicTexture` needs `OffscreenCanvas`, which Node lacks** → stub it at module load BEFORE importing anything that builds a `DynamicTexture` (exact stub in [`TESTING.md`](./TESTING.md) §4). `PropBuilder`'s ctor always builds a geyser `DynamicTexture`, so the stub is required to construct it headless.
- Read private state in tests via `(obj as unknown as { sources: Map<string, Mesh> }).sources` rather than reaching into Babylon internals.
