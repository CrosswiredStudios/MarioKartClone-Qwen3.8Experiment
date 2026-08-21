import { expect, test } from "@playwright/test";

/**
 * Lighting pass (PBR + IBL) — headless WebGL verification.
 *
 * Drives menu → selections → countdown → Racing, then inspects the LIVE scene via
 * window.__sw.dbg to confirm the upgrade actually took effect:
 *   1. scene.environmentTexture is set (IBL wired from the skybox cubemap).
 *   2. road / ground / kart-body materials are PBRMaterial instances with sane values.
 *   3. no page/console errors surface while the PBR shaders compile + render.
 *
 * We stop at "Racing" (≈3 s after map select) — that is when RaceScene builds all
 * the PBR surfaces, so a full 3-lap race is unnecessary for this check.
 */

const RACE_TIMEOUT_MS = 60_000;

interface LightingProbe {
  envTextureSet: boolean;
  envTextureName: string | null;
  road: { isPbr: boolean; metallic: number; roughness: number } | null;
  ground: { isPbr: boolean; metallic: number; roughness: number } | null;
  kartBody: { isPbr: boolean; clearCoatEnabled: boolean; metallic: number; roughness: number } | null;
  sunDirection: [number, number, number] | null;
}

test.describe("Lighting pass (PBR + IBL)", () => {
  test("IBL is wired and road/ground/kart use PBR materials in a live race", async ({ page }) => {
    test.setTimeout(RACE_TIMEOUT_MS);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });

    await page.goto("/?debug");

    // ── Menu → Start ────────────────────────────────────────────────────────
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // ── CharacterSelect / VehicleSelect / MapSelect (defaults) + Confirm ───
    await expect(page.getByTestId("character-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── Wait for Racing (countdown 3-2-1-GO ≈ 3 s) ─────────────────────────
    await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 15_000 });

    // Give the render loop a couple of frames so PBR shaders compile + IBL binds.
    await page.waitForTimeout(800);

    const probe = await page.evaluate<LightingProbe>(() => {
      const scene = (window as unknown as { __sw: { dbg(fn: (s: never) => unknown): unknown } }).__sw.dbg((s) => s);
      // `scene` is the live Babylon Scene; read it defensively.
      const sc = scene as unknown as {
        environmentTexture?: { name?: string } | null;
        getMeshByName(name: string): { material?: unknown } | null;
        meshes: Array<{ name: string; material?: unknown }>;
        lights?: Array<{ name: string; direction?: { x: number; y: number; z: number } }>;
      };

      const isPbr = (m: unknown): boolean => !!m && (m as { getClassName?: () => string }).getClassName?.() === "PBRMaterial";
      const pbrVals = (m: unknown) => {
        const mm = m as { metallic?: number; roughness?: number; clearCoat?: { isEnabled?: boolean } };
        return {
          isPbr: isPbr(m),
          metallic: typeof mm.metallic === "number" ? +mm.metallic.toFixed(3) : -1,
          roughness: typeof mm.roughness === "number" ? +mm.roughness.toFixed(3) : -1,
          clearCoatEnabled: !!mm.clearCoat?.isEnabled,
        };
      };

      const road = sc.getMeshByName("track-road");
      const ground = sc.getMeshByName("track-ground");
      // Kart body meshes are named `<name>-body` (see vehicleModels / sceneInfo).
      const kartBodyMesh = sc.meshes.find((m) => m.name.endsWith("-body"));

      const sun = sc.lights?.find((l) => l.name === "map-sun") ?? null;

      return {
        envTextureSet: !!sc.environmentTexture,
        envTextureName: sc.environmentTexture?.name ?? null,
        road: road?.material ? pbrVals(road.material) : null,
        ground: ground?.material ? pbrVals(ground.material) : null,
        kartBody: kartBodyMesh?.material ? pbrVals(kartBodyMesh.material) : null,
        sunDirection: sun?.direction ? [sun.direction.x, sun.direction.y, sun.direction.z] : null,
      };
    });

    // ── IBL wired from the skybox cubemap ───────────────────────────────────
    expect(probe.envTextureSet, `IBL not set. errors=${JSON.stringify(errors)}`).toBe(true);

    // ── Road is PBR asphalt (low metallic, rough) ───────────────────────────
    expect(probe.road?.isPbr, "road material is not PBR").toBe(true);
    expect(probe.road!.metallic).toBeLessThan(0.3);
    expect(probe.road!.roughness).toBeGreaterThan(0.5);

    // ── Ground is PBR grass (non-metallic, very rough) ──────────────────────
    expect(probe.ground?.isPbr, "ground material is not PBR").toBe(true);
    expect(probe.ground!.metallic).toBeLessThan(0.1);
    expect(probe.ground!.roughness).toBeGreaterThan(0.8);

    // ── Kart body is PBR paint with clearcoat enabled ───────────────────────
    expect(probe.kartBody?.isPbr, "kart body material is not PBR").toBe(true);
    expect(probe.kartBody!.clearCoatEnabled, "kart body clearcoat should be enabled").toBe(true);

    // ── Sun direction points downward (per-track theme.sunDirection) ────────
    expect(probe.sunDirection, "map-sun light not found").not.toBeNull();
    expect(probe.sunDirection![1], "sun must point downward (y < 0)").toBeLessThan(0);

    // ── No uncaught errors / shader compile failures while PBR rendered ─────
    expect(errors, `page/console errors during PBR race: ${JSON.stringify(errors)}`).toEqual([]);
  });
});
