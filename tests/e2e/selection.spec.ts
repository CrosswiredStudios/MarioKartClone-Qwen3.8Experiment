import { expect, test } from "@playwright/test";

/**
 * Phase 2: full walk through character -> vehicle -> map selection.
 * Task 6 covers menu -> CharacterSelect; Task 7 extends to VehicleSelect;
 * Task 8 completes the chain with MapSelect + RaceConfig assembly.
 */
test.describe("Phase 2 selection screens", () => {
  test("menu -> Start shows the 4-card character grid; ArrowRight x2 + Enter confirms pearl", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // CharacterSelect grid with all 4 roster cards.
    await expect(page.getByTestId("character-select")).toBeVisible();
    for (const id of ["marvin", "louie", "pearl", "terry"]) {
      await expect(page.getByTestId(`char-card-${id}`)).toBeVisible();
    }

    // Keyboard: marvin (default) -> ArrowRight x2 lands on pearl; Enter confirms.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("char-card-pearl")).toHaveClass(/selected/);
    await page.keyboard.press("Enter");

    // Real VehicleSelect: 3 cards, subtitle names the pending character.
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    for (const id of ["basher", "zippy", "quadzilla"]) {
      await expect(page.getByTestId(`veh-card-${id}`)).toBeVisible();
    }
    await expect(page.locator(".select-subtitle")).toContainText("Pearl");

    // Confirm the default vehicle (basher) -> real MapSelect with both track cards.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();
    for (const id of ["meadows", "lagoon"]) {
      await expect(page.getByTestId(`map-card-${id}`)).toBeVisible();
    }

    // Confirm the default map (meadows) -> Countdown stub shows the assembled raceConfig.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("countdown-stub")).toContainText("raceConfig: pearl / basher / meadows");
    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("Countdown");

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test("clicking a card selects it and Confirm navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("character-select")).toBeVisible();

    // Mouse path: click terry, then the Confirm button.
    await page.getByTestId("char-card-terry").click();
    await expect(page.getByTestId("char-card-terry")).toHaveClass(/selected/);
    await page.getByTestId("char-confirm").click();

    // Vehicle screen: modifier badges only render for non-zero modifiers.
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await expect(page.locator("[data-testid='veh-card-zippy'] [data-testid='veh-mod-accel']")).toHaveText("accel +1");
    // basher has all-zero modifiers -> no badges rendered.
    await expect(page.locator("[data-testid='veh-card-basher'] [data-testid^='veh-mod-']")).toHaveCount(0);

    // Click zippy, confirm -> MapSelect; confirm meadows -> Countdown stub.
    await page.getByTestId("veh-card-zippy").click();
    await expect(page.getByTestId("veh-card-zippy")).toHaveClass(/selected/);
    await page.getByTestId("veh-confirm").click();
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.getByTestId("map-confirm").click();
    await expect(page.getByTestId("countdown-stub")).toContainText("raceConfig: terry / zippy / meadows");
  });

  test("Back from VehicleSelect returns to CharacterSelect with selection preserved", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("character-select")).toBeVisible();

    // Pick louie, advance to vehicles, then Back.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("character-select")).toBeVisible();
    // Selection restored from ctx.pendingSelection.
    await expect(page.getByTestId("char-card-louie")).toHaveClass(/selected/);
  });

  test("Back from MapSelect returns to VehicleSelect with the vehicle selection preserved", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    // marvin (default) -> zippy -> meadows.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();

    // Back one level: vehicle selection (zippy) is still highlighted.
    await page.getByTestId("map-back").click();
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await expect(page.getByTestId("veh-card-zippy")).toHaveClass(/selected/);
  });

  test("full walk: menu-start -> marvin -> zippy -> meadows assembles the raceConfig", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    // menu -> Start -> marvin -> confirm -> zippy -> confirm -> meadows -> confirm -> countdown stub visible.
    await page.getByTestId("menu-start").click();
    for (const [testid, key] of [
      ["char-card-marvin", "Enter"],
      ["veh-card-zippy", "Enter"],
      ["map-card-meadows", "Enter"],
    ] as const) {
      await page.getByTestId(testid).click();
      await page.keyboard.press(key);
    }
    await expect(page.getByTestId("countdown-stub")).toBeVisible(); // Phase 2 stub screen
    const cfg = await page.evaluate(() => window.__game.snapshot().raceConfig);
    expect(cfg).toEqual({ characterId: "marvin", vehicleId: "zippy", mapId: "meadows" });

    // (Back navigation one level is covered by its own test above — from Countdown
    // there is no Back button, the machine only allows Countdown -> Race.)

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test("keyboard-only: character + vehicle selection using only ArrowRight/Enter", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    // Character: marvin (default) -> ArrowRight x2 = pearl; Enter confirms.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    // Vehicle: basher (default) -> ArrowRight = zippy; Enter confirms.
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    // Map: meadows is the default first card; Enter assembles the config.
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("Enter");

    const cfg = await page.evaluate(() => window.__game.snapshot().raceConfig);
    expect(cfg).toEqual({ characterId: "pearl", vehicleId: "zippy", mapId: "meadows" });
  });

  test("Back from CharacterSelect returns to the main menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("character-select")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    const state = await page.evaluate(() => window.__game.state);
    expect(state).toBe("MainMenu");
  });
});
