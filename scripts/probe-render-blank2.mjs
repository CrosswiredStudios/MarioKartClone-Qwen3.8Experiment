// Probe 2: what does the camera actually SEE? Pick from screen center, check fog,
// road mesh bbox vs kart position, and whether meshes have valid world matrices.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

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
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const road = window.__sw.road();
  const pickC = window.__sw.pick(0.5, 0.5);
  const pickTl = window.__sw.pick(0.1, 0.2);
  const pickBr = window.__sw.pick(0.9, 0.8);
  const karts = window.__game.karts();
  const player = karts.find((k) => k.id === "player") ?? karts[0];
  return window.__sw.dbg((sc) => {
    // Sample a few track meshes: visibility, world matrix sanity, bounding boxes.
    const samples = [];
    for (const m of sc.meshes.slice(0, 40)) {
      if (!m.name.includes("track") && !m.name.includes("road")) continue;
      const bb = m.getBoundingInfo().boundingBox;
      samples.push({
        name: m.name, visible: m.isVisible, alpha: m.alpha,
        min: [bb.minimumWorld.x.toFixed(1), bb.minimumWorld.y.toFixed(2), bb.minimumWorld.z.toFixed(1)],
        max: [bb.maximumWorld.x.toFixed(1), bb.maximumWorld.y.toFixed(2), bb.maximumWorld.z.toFixed(1)],
      });
    }
    return {
      fogMode: sc.fogMode, fogDensity: sc.fogDensity,
      fogColor: [sc.fogColor.r, sc.fogColor.g, sc.fogColor.b],
      road, pickC, pickTl, pickBr, playerPos: player.pos, samples,
    };
  });
});

console.log(JSON.stringify(info, null, 2));
console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 8)) : "none");
browser.close();
