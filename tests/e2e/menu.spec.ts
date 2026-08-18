import { expect, test } from "@playwright/test";

/**
 * Phase 1: the app boots into the main menu; Start advances to the
 * CharacterSelect stub (state machine + DOM overlay working end-to-end).
 */
test.describe("Phase 1 main menu", () => {
  test("boots into the main menu with title and buttons", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    await expect(page.locator('[data-testid="screen-main-menu"]')).toBeVisible();
    await expect(page.locator(".menu-title")).toHaveText("Turbo Turtle Rally");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Quit" })).toBeVisible();

    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("MainMenu");

    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("Start advances to the CharacterSelect screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".menu-title")).toHaveText("Turbo Turtle Rally");
    await page.getByRole("button", { name: "Start" }).click();
    // Phase 2: the real character grid replaces the Phase 1 stub (same navigation).
    await expect(page.getByTestId("character-select")).toBeVisible();
    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("CharacterSelect");
  });

  test("Enter key also starts (keyboard path)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="screen-main-menu"]')).toBeVisible();
    await page.keyboard.press("Enter");
    // Phase 2: the real character grid replaces the Phase 1 stub (same navigation).
    await expect(page.getByTestId("character-select")).toBeVisible();
    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("CharacterSelect");
  });

  test("window.__game.navigate escape hatch drives the machine", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    const state = await page.evaluate(() => window.__game.navigate("VehicleSelect"));
    expect(state).toBeUndefined(); // navigate returns void
    const current = await page.evaluate(() => window.__game.state);
    expect(current).toBe("VehicleSelect");
  });
});
