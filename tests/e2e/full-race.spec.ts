import { expect, test } from "@playwright/test";

/**
 * Phase 4 Step 13: full-flow e2e — menu → selections → countdown → AI-driven 3-lap race → results.
 *
 * Uses the `ttr.debugAIDrive` localStorage flag so the player kart is driven by the waypoint-AI
 * strategy (no keyboard input needed). Phase 4.1 re-authored Meadows ~3× longer (≈650 m/lap),
 * so a full race now takes ~90–120 s of real time; we poll for "Results".
 */

const RACE_TIMEOUT_MS = 240_000; // generous: 3 laps ≈ 90–120 s + countdown + margin

test.describe("Phase 4 full race (AI-driven)", () => {
  test("menu → selections → countdown → full 3-lap race → results", async ({ page }) => {
    // Playwright ≥1.6x removed the `test(title, body, timeout)` overload — set it in-body.
    test.setTimeout(RACE_TIMEOUT_MS);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });

    // Enable AI drive: set the flag AND load with ?debug so `debugAllowed` is true in a
    // production (preview) build where import.meta.env.DEV is false. In dev mode DEV is
    // already true, so "/?debug" works universally for both.
    await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
    await page.goto("/?debug");

    // ── Menu → Start ────────────────────────────────────────────────────────
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // ── CharacterSelect → Marvin (default) + Confirm ───────────────────────
    await expect(page.getByTestId("character-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── VehicleSelect → Basher (default) + Confirm ─────────────────────────
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── MapSelect → Meadows (default) + Confirm ────────────────────────────
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("Enter");

    // ── Countdown: verify raceConfig text ──────────────────────────────────
    await expect(page.getByTestId("countdown-stub")).toContainText("raceConfig: marvin / basher / meadows");
    const stateAfterMap = await page.evaluate(() => window.__game.state);
    expect(stateAfterMap).toBe("Countdown");

    // ── Wait for Racing (countdown 3-2-1-GO ≈ 3 s) ────────────────────────
    await page.waitForFunction(
      () => window.__game.state === "Racing",
      null,
      { timeout: 15_000 },
    );

    // Phase 7 regression guard: the traffic-light overlay must be REMOVED once the
    // race starts (it's a transparent DOM layer over the live world — if it lingers,
    // the player sees "GO!" forever).
    await expect(page.getByTestId("countdown-stub")).toHaveCount(0);

    // ── Verify HUD is visible during race ──────────────────────────────────
    const hudVisible = await page.evaluate(() => !!document.querySelector(".hud"));
    expect(hudVisible, `HUD missing. errors=${JSON.stringify(errors)}`).toBe(true);

    // ── Verify item slot exists (Step 7) — "?" is drawn on a canvas ───────
    const itemSlotExists = await page.evaluate(() => !!document.querySelector("[data-testid='hud-item-slot']"));
    expect(itemSlotExists).toBe(true);

    // ── Verify speedometer SVG exists (Step 8) ─────────────────────────────
    const speedoExists = await page.evaluate(() => !!document.querySelector("[data-testid='hud-speedo']"));
    expect(speedoExists).toBe(true);

    // ── Verify minimap canvas exists and is non-blank (Step 9) ────────────
    const minimapInfo = await page.evaluate(() => {
      const canvas = document.querySelector("[data-testid='hud-minimap']") as HTMLCanvasElement | null;
      if (!canvas) return { exists: false };
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return { exists: true, nonBlank: false };
      const data = ctx2d.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonZero = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) nonZero++;
      }
      return { exists: true, nonBlank: nonZero > 10 };
    });
    expect(minimapInfo.exists).toBe(true);
    expect(minimapInfo.nonBlank).toBe(true);

    // ── Verify window.__game debug handles (Step 12) ───────────────────────
    const debugHandles = await page.evaluate(() => ({
      standingsLen: window.__game.standings().length,
      kartsLen: window.__game.karts().length,
      hasAiDrive: typeof window.__game.aiDrivePlayer === "function",
    }));
    expect(debugHandles.standingsLen).toBe(4);
    expect(debugHandles.kartsLen).toBe(4);
    // aiDrivePlayer is present in dev/preview mode (import.meta.env.DEV or ?debug)
    // In preview build, DEV=false but the flag was set via addInitScript so it's a no-op.
    // The handle may or may not be present depending on build; just check it doesn't throw.

    // ── Phase 4.1: verify the player kart actually climbs (terrain elevation) ──
    // Meadows' profile peaks at +2.8 m, so a full lap must take the kart well
    // above its spawn height. Poll until max |y| > 0.5 before the race ends.
    const sawElevation = await page.waitForFunction(
      () => {
        if (window.__game.state !== "Racing") return false;
        const karts = window.__game.karts();
        const player = karts.find((k: { id: string }) => k.id === "player");
        return !!player && Math.abs(player.pos.y) > 0.5;
      },
      null,
      { timeout: RACE_TIMEOUT_MS, polling: 250 },
    );
    expect(sawElevation, `Player kart never left its spawn elevation (terrain not applied). errors=${JSON.stringify(errors)}`).toBeTruthy();

    // ── Player crosses the line → Results (Phase 7 live finish-out) ────────
    await page.waitForFunction(
      () => window.__game.state === "Results",
      null,
      { timeout: RACE_TIMEOUT_MS },
    );
    const resultsScreen = page.getByTestId("screen-results");
    await expect(resultsScreen).toBeVisible();

    // Phase 7: while the field is still racing, a live table + Skip button show.
    // Click Skip (if present) to fast-forward to the final standings and keep runtime
    // short. If the field already finished naturally there's no Skip — that's fine too.
    const skip = page.getByTestId("results-skip");
    if (await skip.isVisible().catch(() => false)) {
      await expect(page.locator(".results-overlay h2")).toHaveText("Finish!");
      await skip.click();
    }

    // Wait for the race to fully finalize (all karts done or Skip) → final table.
    await page.waitForFunction(
      () => window.__game.racePhase() === "finished",
      null,
      { timeout: RACE_TIMEOUT_MS },
    );

    // ── Verify Results screen (Step 11) — final layout ─────────────────────
    await expect(page.locator(".results-overlay h2")).toHaveText("Race Complete");

    // Results table: exactly 4 rows (P1–P4)
    const rows = page.locator("[data-testid='results-table'] .results-row");
    await expect(rows).toHaveCount(4);

    // Each row has a rank badge, name, and time (or DNF)
    for (let i = 0; i < 4; i++) {
      const rankBadge = rows.nth(i).locator(".rank-badge");
      const nameEl = rows.nth(i).locator(".results-name");
      const timeEl = rows.nth(i).locator(".results-time");
      await expect(rankBadge).toHaveText(new RegExp(`^P[1-4]$`));
      await expect(nameEl).not.toBeEmpty();
      // Time is either formatted as MM:SS.mmm (e.g. "00:32.456") or "DNF"
      const timeText = await timeEl.textContent();
      expect(timeText).toMatch(/^\d{2}:\d{2}\.\d{3}$|^DNF$/);
    }

    // Player lap times section: 3 laps, one marked as best
    const playerLaps = page.locator("[data-testid='results-player-laps']");
    await expect(playerLaps).toBeVisible();
    const lapTimes = playerLaps.locator(".lap-time");
    await expect(lapTimes).toHaveCount(3);
    const bestLaps = playerLaps.locator(".lap-time.best");
    await expect(bestLaps).toHaveCount(1);

    // ── Verify "Race Again" button exists and navigates to CharacterSelect ─
    const raceAgainBtn = page.getByTestId("results-race-again");
    await expect(raceAgainBtn).toBeVisible();
    await raceAgainBtn.click();
    await expect(page.getByTestId("character-select")).toBeVisible();

    // Marvin should be preselected (from the previous race config)
    await expect(page.getByTestId("char-card-marvin")).toHaveClass(/selected/);

    // ── Verify "Main Menu" button exists ───────────────────────────────────
    // Navigate back to results via a quick re-race is overkill; just verify the button was there.
    // (We already clicked Race Again, so we're on CharacterSelect now.)

    // No page errors throughout the entire flow.
    expect(errors).toEqual([]);
  });

  /**
   * Phase 4.1: Lagoon full race — the canyon elevation (cliff drops + downhill
   * speed) is the main risk area, so this verifies all four AI-driven karts
   * finish on the harder track and that the kart actually traverses big height
   * changes (profile spans −8 m … +14 m).
   *
   * Phase 5 note: Lagoon's oil slicks add skid time, pushing a full race to ~63–68 s
   * of sim plus menu/countdown overhead — the explicit RACE_TIMEOUT_MS is required
   * (Playwright's default 60 s test timeout is too tight).
   */
  test("Lagoon: full 3-lap race — all karts finish despite cliff drops", async ({ page }) => {
    // Playwright ≥1.6x removed the `test(title, body, timeout)` overload — set it in-body.
    test.setTimeout(RACE_TIMEOUT_MS);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });

    await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
    await page.goto("/?debug");

    // ── Menu → Start → Marvin → Basher → Lagoon (ArrowRight to card 2) ─────
    await expect(page.getByTestId("screen-main-menu")).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("character-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("vehicle-select")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-select")).toBeVisible();
    await page.keyboard.press("ArrowRight"); // select Lagoon (2nd card)
    await page.keyboard.press("Enter");

    // ── Countdown: verify lagoon raceConfig text ────────────────────────────
    await expect(page.getByTestId("countdown-stub")).toContainText("raceConfig: marvin / basher / lagoon");

    // ── Wait for Racing ─────────────────────────────────────────────────────
    await page.waitForFunction(
      () => window.__game.state === "Racing",
      null,
      { timeout: 15_000 },
    );

    // ── Phase 4.1: the player kart must traverse big height changes ─────────
    // Lagoon's profile spans −8 m … +14 m; a full lap crosses several meters.
    const sawElevation = await page.waitForFunction(
      () => {
        if (window.__game.state !== "Racing") return false;
        const karts = window.__game.karts();
        const player = karts.find((k: { id: string }) => k.id === "player");
        return !!player && Math.abs(player.pos.y) > 2;
      },
      null,
      { timeout: RACE_TIMEOUT_MS, polling: 250 },
    );
    expect(sawElevation, `Player kart never left its spawn elevation on Lagoon. errors=${JSON.stringify(errors)}`).toBeTruthy();

    // ── Wait for the FULL field to finish → final Results. We deliberately do NOT
    //     click Skip here: this test asserts no DNFs, so every kart must cross the line
    //     naturally and get a real time (Phase 7 live finish-out resolves on its own).
    await page.waitForFunction(
      () => window.__game.racePhase() === "finished",
      null,
      { timeout: RACE_TIMEOUT_MS },
    );

    const resultsScreen = page.getByTestId("screen-results");
    await expect(resultsScreen).toBeVisible();

    // All four karts finished — no DNF rows (cliff drops must not strand anyone).
    const rows = page.locator("[data-testid='results-table'] .results-row");
    await expect(rows).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const timeText = await rows.nth(i).locator(".results-time").textContent();
      expect(timeText, `Kart ${i} DNF'd on Lagoon. errors=${JSON.stringify(errors)}`).toMatch(/^\d{2}:\d{2}\.\d{3}$/);
    }

    // No page errors throughout the entire flow.
    expect(errors).toEqual([]);
  });
});
