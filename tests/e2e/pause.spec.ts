import { expect, test } from "@playwright/test";

/**
 * Pause regression e2e — menu → selections → countdown → Racing → Esc.
 *
 * Guards the pause wedge: RaceScene.exit() once called .dispose() on a Babylon
 * Observer (which has no such method), throwing mid-teardown and aborting the
 * state transition before the pause menu could show — leaving the game stuck at
 * "Racing" with a destroyed world and no way back. This spec asserts the full
 * pause lifecycle: overlay appears, world is frozen, settings toggles, resume
 * restores Racing, and quit-from-pause lands on the main menu — with zero
 * console/page errors throughout.
 *
 * Uses the `ttr.debugAIDrive` localStorage flag so the player kart is driven by
 * the waypoint-AI strategy (no keyboard input needed for driving).
 */

// Generous: rAF is throttled when the Playwright tab isn't focused (repo memory), so the
// 8s SIM-time world-ready force-timeout can take well over a minute in wall-clock. The
// pause assertions themselves are fast; the margin is for reaching Racing.
const PAUSE_TIMEOUT_MS = 180_000;

test.describe("Pause menu lifecycle", () => {
  test("Esc pauses with frozen world; resume, settings, and quit all work", async ({ page }) => {
    test.setTimeout(PAUSE_TIMEOUT_MS);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });

    // AI drive + ?debug so the player kart drives itself and debug handles exist.
    await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
    await page.goto("/?debug");

    // ── Menu → Start → Marvin → Basher → Meadows (defaults) ────────────────
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("character-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── Wait for Racing (countdown 3-2-1-GO ≈ 3 s) ────────────────────────
    // Long timeout: world-ready is gated on the first rendered frame + textures, and rAF
    // throttling in an unfocused tab stretches that well past real time.
    await page.waitForFunction(
      () => window.__game.state === "Racing",
      null,
      { timeout: 120_000 },
    );

    // ── Pause with Esc ─────────────────────────────────────────────────────
    const posBefore = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return player ? { ...player.pos } : null;
    });
    expect(posBefore, `Player kart missing before pause. errors=${JSON.stringify(errors)}`).not.toBeNull();

    await page.keyboard.press("Escape");

    // The pause overlay must appear and the state machine must actually be Paused —
    // pre-fix, exit() threw mid-teardown and currentId stayed "Racing" forever.
    await expect(page.getByTestId("screen-paused")).toBeVisible();
    const pausedState = await page.evaluate(() => window.__game.state);
    expect(pausedState).toBe("Paused");

    // HUD stays visible while paused (frozen behind the dim overlay).
    const hudVisibleWhilePaused = await page.evaluate(() => !!document.querySelector(".hud"));
    expect(hudVisibleWhilePaused, `HUD missing while paused. errors=${JSON.stringify(errors)}`).toBe(true);

    // ── World is frozen: position captured AFTER the pause engaged must not move ──
    // (posBefore was taken pre-Escape; the kart legitimately advances a few frames before
    // the pause edge is processed on the next logic step, so we re-baseline here.)
    const posFrozenA = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return player ? { ...player.pos } : null;
    });
    expect(posFrozenA, `Player kart missing while paused. errors=${JSON.stringify(errors)}`).not.toBeNull();
    await page.waitForTimeout(1_000);
    const posFrozenB = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return player ? { ...player.pos } : null;
    });
    expect(posFrozenB, `Player kart missing while paused. errors=${JSON.stringify(errors)}`).not.toBeNull();
    // Frozen: no logic steps run while Paused, so the sim position is bit-identical.
    expect(posFrozenB!.x).toBeCloseTo(posFrozenA!.x, 6);
    expect(posFrozenB!.y).toBeCloseTo(posFrozenA!.y, 6);
    expect(posFrozenB!.z).toBeCloseTo(posFrozenA!.z, 6);

    // ── Settings sub-overlay opens and closes ──────────────────────────────
    // The settings overlay is full-screen (z-31) above the pause menu (z-30), so it
    // covers the "Settings" toggle — closing goes through the panel's Back button.
    await page.getByTestId("pause-settings").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await page.getByTestId("settings-back").click();
    // hide() keeps the element in the DOM with display:none — assert hidden, not removed.
    await expect(page.getByTestId("settings-panel")).toBeHidden();

    // ── Resume: back to Racing, overlay gone, world unfrozen ───────────────
    await page.getByTestId("pause-resume").click();
    const resumedState = await page.evaluate(() => window.__game.state);
    expect(resumedState).toBe("Racing");
    await expect(page.getByTestId("screen-paused")).toHaveCount(0);

    // The kart keeps driving after resume (AI drive) — position moves again.
    await page.waitForFunction(
      () => {
        const player = window.__game.karts().find((k) => k.id === "player");
        if (!player) return false;
        return (
          Math.abs(player.pos.x - posBefore!.x) > 0.5 ||
          Math.abs(player.pos.z - posBefore!.z) > 0.5
        );
      },
      null,
      { timeout: 60_000, polling: 250 }, // rAF throttling can slow the kart's wall-clock progress
    );

    // ── Pause again (cycle must stay clean), then quit to menu ─────────────
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("screen-paused")).toBeVisible();
    await page.getByTestId("pause-quit").click();

    const quitState = await page.evaluate(() => window.__game.state);
    expect(quitState).toBe("MainMenu");
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    // The pause overlay must not linger after quitting.
    await expect(page.getByTestId("screen-paused")).toHaveCount(0);

    // No page errors throughout the entire flow — pre-fix, every Esc produced a
    // contained "dispose is not a function" TypeError in the console.
    expect(errors).toEqual([]);
  });
});
