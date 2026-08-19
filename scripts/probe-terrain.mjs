// Focused test: drop a dynamic sphere at the player's spawn XZ. Where does it land?
// If it lands near y≈0 → terrain body works, kart bodies are misconfigured.
// If it falls forever → heightfield body itself is broken (data/units).
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

// Drop a sphere at the player's XZ, y = +10 above wherever they are. Sample its Y over time.
const result = await page.evaluate(async () => {
  const sc = window.__sw.dbg((s) => s);
  const karts = window.__game.karts();
  const p = (karts.find((k) => k.id === "player") ?? karts[0]).pos;

  // Grab the real Babylon classes from an existing body's module scope via scene internals:
  // easiest is to reuse what main.ts already imported — but we can't. Instead, build via
  // the physics engine's plugin API on a fresh TransformNode using globals exposed by dbg?
  // Fallback: read the terrain node + player body node positions and infer from kart fall rate.
  const terrain = sc.getTransformNodeByName("physicsTerrain");
  return {
    playerPos: { x: p.x, y: p.y, z: p.z },
    terrainNode: terrain ? [terrain.position.x.toFixed(2), terrain.position.y.toFixed(2), terrain.position.z.toFixed(2)] : "MISSING",
  };
});
console.log("setup:", JSON.stringify(result));

// Sample player Y over 4 s — fall rate tells us gravity is acting; landing (or not) tells us about the heightfield.
for (let i = 0; i < 8; i++) {
  const row = await page.evaluate(() => {
    const karts = window.__game.karts();
    const p = karts.find((k) => k.id === "player") ?? karts[0];
    return { y: +p.pos.y.toFixed(2), speed: +p.speed.toFixed(1) };
  });
  console.log(`t=${i * 0.5}s`, JSON.stringify(row));
  await page.waitForTimeout(500);
}
browser.close();
