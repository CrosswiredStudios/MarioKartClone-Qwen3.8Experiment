// Decisive test: probeCollision() drops two default-filter dynamic spheres at (±6, y=5, 0)
// on the track. Poll their Y for ~3 s. Bounded near 0 → heightfield works (kart filter issue).
// Falling forever → heightfield body itself is broken.
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

const probe = await page.evaluate(() => {
  const p = window.__game.probeCollision();
  return !!p;
});
if (!probe) fail("probeCollision not available");

for (let i = 0; i < 12; i++) {
  const row = await page.evaluate(() => {
    const a = window.__sw.dbg((sc) => sc.getTransformNodeByName("probe-sphere-a"));
    const b = window.__sw.dbg((sc) => sc.getTransformNodeByName("probe-sphere-b"));
    return {
      a: a ? [+a.position.x.toFixed(1), +a.position.y.toFixed(2), +a.position.z.toFixed(1)] : "gone",
      b: b ? [+b.position.x.toFixed(1), +b.position.y.toFixed(2), +b.position.z.toFixed(1)] : "gone",
    };
  });
  console.log(`t=${(i * 0.5).toFixed(1)}s`, JSON.stringify(row));
  await page.waitForTimeout(500);
}
browser.close();
