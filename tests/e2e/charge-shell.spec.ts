import { expect, test } from "@playwright/test";

/**
 * Phase 5.1 e2e — hold-to-charge shell mechanic, driven through the real UI + keyboard.
 *
 * Flow: menu → selections → countdown → Racing. Then force a green shell onto the
 * player (window.__game.setItem, debug-only), hold the item key (E) and verify the
 * shell is "loaded" (charging set, no shell fired); release and verify the shell
 * launches (player shell count 0 → 1, charging cleared).
 *
 * The player is HUMAN-driven here (no ttr.debugAIDrive) so the keyboard charge path
 * is exercised. `/?debug` makes `setItem` available. `shells()` counts only the
 * PLAYER's shells, so AI-fired shells can't perturb the assertions.
 */

const RACING_TIMEOUT_MS = 20_000;

test.describe("Phase 5.1 hold-to-charge shell (e2e)", () => {
  test("hold E loads the shell on the kart; release launches it", async ({ page }) => {
    test.setTimeout(RACING_TIMEOUT_MS + 30_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });

    // Human-driven player (do NOT set ttr.debugAIDrive) + ?debug for setItem.
    await page.goto("/?debug");

    // ── Menu → Start ────────────────────────────────────────────────────────
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // ── Selections: accept the defaults (Marvin / Basher / Meadows) ─────────
    await expect(page.getByTestId("character-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── Wait for Racing (countdown 3-2-1-GO ≈ 3 s) ──────────────────────────
    await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: RACING_TIMEOUT_MS });

    // setItem must be present (debugAllowed via ?debug).
    const hasSetItem = await page.evaluate(() => typeof window.__game.setItem === "function");
    expect(hasSetItem, `setItem handle missing (debugAllowed false?). errors=${JSON.stringify(errors)}`).toBe(true);

    // ── Force a green shell onto the player ─────────────────────────────────
    await page.evaluate(() => window.__game.setItem("greenShell"));

    // Baseline: no player shells yet, not charging.
    const baseline = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return { shells: window.__game.shells(), charging: player?.charging ?? null, item: player?.item ?? null };
    });
    expect(baseline.item).toBe("greenShell");
    expect(baseline.shells).toBe(0);
    expect(baseline.charging).toBe(null);

    // ── HOLD the item key (E) → the shell loads on the kart's rear ──────────
    await page.keyboard.down("e");
    await page.waitForTimeout(500);

    const held = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return { shells: window.__game.shells(), charging: player?.charging ?? null, item: player?.item ?? null };
    });
    expect(held.charging, `shell should be loaded while holding. errors=${JSON.stringify(errors)}`).toBe("greenShell");
    expect(held.item).toBe("greenShell"); // retained while charging
    expect(held.shells, `no shell should fire while holding. errors=${JSON.stringify(errors)}`).toBe(0);

    // ── RELEASE the item key → the shell launches forward ───────────────────
    await page.keyboard.up("e");
    await page.waitForTimeout(250);

    const released = await page.evaluate(() => {
      const player = window.__game.karts().find((k) => k.id === "player");
      return { shells: window.__game.shells(), charging: player?.charging ?? null, item: player?.item ?? null };
    });
    expect(released.charging, `charge should clear on release. errors=${JSON.stringify(errors)}`).toBe(null);
    expect(released.item, `item should be consumed on release. errors=${JSON.stringify(errors)}`).not.toBe("greenShell");
    expect(released.shells, `a shell should launch on release. errors=${JSON.stringify(errors)}`).toBe(1);

    // No page errors during the whole flow.
    expect(errors, `page errors: ${JSON.stringify(errors)}`).toEqual([]);
  });
});
