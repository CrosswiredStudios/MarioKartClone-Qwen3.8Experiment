import { expect, test } from "@playwright/test";

/**
 * Phase 0 smoke test: the app boots, WebGL2 is available in the headless
 * browser, and the Babylon scene renders without throwing.
 */
test.describe("Phase 0 smoke", () => {
  test("boots and exposes the game handle", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // Canvas is present and sized.
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toBeVisible();
    const size = await canvas.evaluate((el) => ({
      w: el.width,
      h: el.height,
    }));
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);

    // WebGL2 error overlay must NOT be visible.
    await expect(page.locator("#webgl2-error")).not.toBeVisible();

    // The debug handle is wired up (see src/main.ts).
    const hasHandle = await page.evaluate(() => window.__game !== undefined);
    expect(hasHandle).toBe(true);

    // Give the render loop a moment, then assert no uncaught errors.
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
