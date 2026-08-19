// Focused test: does the kart fall below the track surface? Sample player Y vs terrain
// height at (x,z) over time, plus camera FOV. One run, quick verdict.
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

for (let i = 0; i < 8; i++) {
  const row = await page.evaluate(() => {
    const karts = window.__game.karts();
    const p = karts.find((k) => k.id === "player") ?? karts[0];
    // Terrain height at the player's XZ via the track field (same sampler physics uses).
    const h = window.__sw.dbg((sc) => {
      const road = sc.getMeshByName("track-road");
      return null; // placeholder — use bounding box Y range instead
    });
    return { t: i, x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(1), fov: window.__sw.cam().fov };
  });
  console.log(JSON.stringify(row));
  await page.waitForTimeout(500);
}
browser.close();
