// Layout experiment: 2x2 heightfield, data [10,0,0,0], node at origin. Four spheres drop
// from y=14 at (±3, ±3). The one that lands on top (~y=9) reveals the buffer→world map.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url + "?debug", { waitUntil: "load" });

// No race needed — physics is enabled at boot. Just wait for the handle.
await page.waitForFunction(() => typeof window.__game.hfProbe === "function", null, { timeout: 20_000 })
  .catch(() => { console.log("FAIL: hfProbe not available"); browser.close(); process.exit(1); });

const p = await page.evaluate(() => window.__game.hfProbe());
for (let i = 0; i < 8; i++) {
  const row = await page.evaluate(() => window.__game.hfProbe_read?.() ?? null);
  // read via the stored handle isn't exposed on window — re-evaluate through dbg instead.
  void row;
  const ys = await page.evaluate((idx) => {
    const names = ["hf-probe-a", "hf-probe-b", "hf-probe-c", "hf-probe-d"];
    return window.__sw.dbg((sc) => names.map((n) => {
      const t = sc.getTransformNodeByName(n);
      return t ? +t.position.y.toFixed(2) : null;
    }));
  }, i);
  console.log(`t=${i * 0.5}s`, JSON.stringify(ys), "spots: a=(-3,-3) b=(3,-3) c=(-3,3) d=(3,3)");
  await page.waitForTimeout(500);
}
browser.close();
