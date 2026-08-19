// Phase 1 blocker probe (plan step 1): reach a physics-enabled race, then spawn two
// fresh dynamic spheres head-on via window.__game.probeCollision() and watch the
// WORLD-level collision observable. Independent of karts entirely:
//   - count > 0 → native events work in this pairing; our KART setup has the bug.
//   - count = 0 → engine/WASM-level failure confirmed → A/B @babylonjs/havok@1.3.13.
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

const fail = (why) => {
  console.log(`FAIL: ${why}`);
  const phys = errors.filter((e) => /havok|wasm|physics/i.test(e));
  console.log("PHYSICS-RELATED ERRORS:", phys.length ? JSON.stringify(phys.slice(0, 10), null, 2) : "none");
  browser.close();
  process.exit(1);
};

await page.waitForSelector('[data-testid="screen-main-menu"]', { timeout: 20_000 }).catch(() => fail("main menu never appeared"));
if (!(await clickLabel("Start"))) fail("Start button not found");
for (const [testId, name] of [["character-select", "CharacterSelect"], ["vehicle-select", "VehicleSelect"], ["map-select", "MapSelect"]]) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 }).catch(() => fail(`${name} never appeared`));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 25_000 }).catch(() => fail("never reached Racing"));

// Spawn the two head-on spheres (physics world is live during a race).
const spawned = await page.evaluate(() => {
  if (!window.__game.probeCollision) return "probe handle missing";
  window.__probe = window.__game.probeCollision();
  return "spawned";
});
if (spawned !== "spawned") fail(spawned);

// Let them cross and collide (~1.2 s to meet, extra margin for event drain).
await page.waitForTimeout(3000);
const count = await page.evaluate(() => window.__probe.count());
await page.evaluate(() => { window.__probe.dispose(); delete window.__probe; });

console.log(`PROBE RESULT: world-level collision events observed = ${count}`);
if (count > 0) {
  console.log("PASS: native Havok collision events DO fire in this pairing → the bug is in our kart setup, not the WASM.");
} else {
  console.log("ZERO EVENTS: engine/WASM-level failure confirmed for core 9.21.2 + havok 1.3.14 → A/B @babylonjs/havok@1.3.13 (plan step 2).");
}
const phys = errors.filter((e) => /havok|wasm|physics/i.test(e));
if (phys.length) console.log("PHYSICS-RELATED ERRORS:", JSON.stringify(phys.slice(0, 5), null, 2));
browser.close();
