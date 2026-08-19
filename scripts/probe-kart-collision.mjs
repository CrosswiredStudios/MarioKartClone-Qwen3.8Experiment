// Phase 1 follow-up probe: native events fire for fresh spheres (probe-collision-events.mjs),
// so now force two KART bodies head-on and watch the world-level observable for events
// involving "-kartbody" names. If these fire → kart↔kart event path works end-to-end;
// the original "zero events" was simply that karts never touched during normal racing.
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

// Tap the world-level observable for kart↔kart events BEFORE forcing the collision.
const tapped = await page.evaluate(() => {
  const s = window.__sw.dbg((sc) => sc);
  const plugin = s.getPhysicsEngine()?.getPhysicsPlugin?.();
  if (!plugin?.onCollisionObservable) return "no world observable";
  window.__kartEvents = [];
  plugin.onCollisionObservable.add((e) => {
    const a = e.collider?.transformNode?.name ?? "";
    const b = e.collidedAgainst?.transformNode?.name ?? "";
    if (a.endsWith("-kartbody") || b.endsWith("-kartbody")) {
      window.__kartEvents.push({ type: e.type, a, b, imp: +(+e.impulse).toFixed(1) });
    }
  });
  return "tapped";
});
if (tapped !== "tapped") fail(tapped);

// Force the two CLOSEST karts head-on: teleport nodes 4 m apart along their axis and
// give them opposing 15 m/s velocities. The plugin syncs node→body each step, so this
// sticks on the next physics step.
const forced = await page.evaluate(() => {
  const s = window.__sw.dbg((sc) => sc);
  const nodes = s.transformNodes.filter((n) => n.name.endsWith("-kartbody"));
  if (nodes.length < 2) return "need >=2 kart bodies";
  let bestA = null, bestB = null, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].position.x - nodes[j].position.x, nodes[i].position.z - nodes[j].position.z);
      if (d < bestD) { bestD = d; bestA = nodes[i]; bestB = nodes[j]; }
    }
  }
  const dx = bestB.position.x - bestA.position.x;
  const dz = bestB.position.z - bestA.position.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const mx = (bestA.position.x + bestB.position.x) / 2;
  const mz = (bestA.position.z + bestB.position.z) / 2;
  const y = Math.max(bestA.position.y, bestB.position.y);
  // A on the -u side moving toward B (+u), B mirrored.
  bestA.position.set(mx - ux * 2, y, mz - uz * 2);
  bestB.position.set(mx + ux * 2, y, mz + uz * 2);
  const va = new (bestA.position.constructor)(ux * 15, 0, uz * 15);
  const vb = new (bestB.position.constructor)(-ux * 15, 0, -uz * 15);
  bestA.physicsBody.setLinearVelocity(va);
  bestB.physicsBody.setLinearVelocity(vb);
  return `forced ${bestA.name} vs ${bestB.name} (were ${bestD.toFixed(1)} m apart)`;
});
console.log("FORCE:", forced);

await page.waitForTimeout(3000);
const events = await page.evaluate(() => (window.__kartEvents ?? []).slice(-20));
const count = await page.evaluate(() => (window.__kartEvents ?? []).length);
console.log(`KART↔KART world-level events: ${count}`);
if (count > 0) console.log("SAMPLE:", JSON.stringify(events.slice(0, 5), null, 2));

if (count === 0) {
  const phys = errors.filter((e) => /havok|wasm|physics/i.test(e));
  console.log(`FAIL: no kart↔kart events despite forced head-on contact`);
  console.log("PHYSICS-RELATED ERRORS:", phys.length ? JSON.stringify(phys.slice(0, 5), null, 2) : "none");
  browser.close();
  process.exit(1);
}
console.log("PASS: kart↔kart collision events fire end-to-end → original 'zero events' was karts never touching in normal racing.");
browser.close();
