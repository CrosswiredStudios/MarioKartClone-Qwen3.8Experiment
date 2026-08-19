// Live-race terrain check: during a real race, compare the PHYSICS surface
// (physRayDown) against field.heightAt ground truth at the player's position +
// a fixed grid. If they match everywhere → terrain body is correct in-race and
// the kart bodies are the problem. If they diverge → the race scene builds the
// heightfield differently than the baseline.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
await page.goto(url + "?debug", { waitUntil: "load" });

const clickLabel = (label) =>
  page.evaluate((lbl) => {
    const el = [...document.querySelectorAll("button, .menu-item")].find((e) => e.textContent.trim() === lbl);
    if (!el) return false;
    el.click();
    return true;
  }, label);

const fail = (why) => { console.log(`FAIL: ${why}`); browser.close(); process.exit(1); };

await page.waitForSelector('[data-testid="screen-main-menu"]', { timeout: 20_000 }).catch(() => fail("main menu never appeared"));
if (!(await clickLabel("Start"))) fail("Start button not found");
for (const [testId] of [["character-select"], ["vehicle-select"], ["map-select"]]) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 }).catch(() => fail(`${testId} never appeared`));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 25_000 }).catch(() => fail("never reached Racing"));

// Sample at t≈1s and t≈3.5s (kart has moved) — player pos + a 6×6 grid over the bounds.
for (const label of ["t=1s", "t=3.5s"]) {
  await page.waitForTimeout(label === "t=1s" ? 1000 : 2500);
  const report = await page.evaluate(() => {
    const g = window.__game;
    const karts = g.karts();
    const p = (karts.find((k) => k.id === "player") ?? karts[0]).pos;
    // Bounds from a few ground-truth probes: sample a coarse grid around the track.
    const xs = [-100, -50, 0, 50, 90];
    const zs = [-80, -40, 0, 40, 80];
    const rows = [];
    let maxErr = 0;
    for (const x of xs) {
      for (const z of zs) {
        const truth = g.fieldHeightAt(x, z);
        if (!Number.isFinite(truth)) return "fieldHeightAt unavailable (no race scene?)";
        const hit = g.physRayDown(x, z);
        if (hit === null) continue; // outside field coverage — fine
        const err = Math.abs(hit - truth);
        maxErr = Math.max(maxErr, err);
        rows.push({ x, z, truth: +truth.toFixed(2), hit: +hit.toFixed(2), err: +err.toFixed(2) });
      }
    }
    // Worst offenders only.
    const worst = rows.sort((a, b) => b.err - a.err).slice(0, 6);
    return { playerY: +p.y.toFixed(2), maxErr: +maxErr.toFixed(3), samples: rows.length, worst };
  });
  console.log(label, JSON.stringify(report));
}
browser.close();
