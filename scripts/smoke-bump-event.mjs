// Bump-event smoke: drive an AI race, then force the PLAYER's physics body into a
// head-on collision with the nearest AI kart (teleport both nodes 4 m apart along
// their axis + opposing 15 m/s velocities — proven technique from probe-kart-collision.mjs).
// Havok resolves the contact with a large impulse → KartBody's collision observable
// fires → onBump → "kart:bumped" on EventBus → window.__game.bumps() must increment.
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
  const phys = errors.filter((e) => /havok|wasm|physics|capsule|mass/i.test(e));
  console.log("PHYSICS-RELATED ERRORS:", phys.length ? JSON.stringify(phys.slice(0, 10), null, 2) : "none");
  if (errors.length && !phys.length) console.log("(other errors):", errors.slice(0, 5));
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

const before = await page.evaluate(() => window.__game.bumps?.() ?? -1);
if (before < 0) fail("window.__game.bumps handle missing");

// Tap the WORLD-level observable so we can distinguish "collision never happened"
// from "collision happened but the player's per-body onBump path is broken".
await page.evaluate(() => {
  const s = window.__sw.dbg((sc) => sc);
  const plugin = s.getPhysicsEngine()?.getPhysicsPlugin?.();
  if (!plugin?.onCollisionObservable) return;
  window.__kartEvents = [];
  plugin.onCollisionObservable.add((e) => {
    const a = e.collider?.transformNode?.name ?? "";
    const b = e.collidedAgainst?.transformNode?.name ?? "";
    if (a.endsWith("-kartbody") || b.endsWith("-kartbody")) {
      window.__kartEvents.push({ type: e.type, a, b, imp: +(+e.impulse).toFixed(1) });
    }
  });
});

// Force the player into the nearest AI kart. Facts established by telemetry:
//   - node.position.set() does NOT move a dynamic body (plugin syncs body→node each step);
//   - one-shot setLinearVelocity is overwhelmed within ~1 s because KartBody.apply()
//     re-applies drive impulse every fixed step (~38 m/s racing speed).
// So run a PER-FRAME MAGNET: every 16 ms (faster than the fixed physics step) re-assert
// opposing ±10 m/s velocities toward each other. The karts close at ~20 m/s combined and
// contact registers before drive can pull them apart again.
const forced = await page.evaluate((beforeBumps) => {
  const s = window.__sw.dbg((sc) => sc);
  const player = s.getTransformNodeByName("player-kartbody");
  if (!player?.physicsBody) return "missing player body";
  const aiNodes = s.transformNodes.filter((n) => n.name.endsWith("-kartbody") && !n.name.startsWith("player"));
  if (aiNodes.length === 0) return "no AI kart bodies";
  let best = null, bestD = Infinity;
  for (const ai of aiNodes) {
    const d = Math.hypot(ai.position.x - player.position.x, ai.position.z - player.position.z);
    if (d < bestD) { bestD = d; best = ai; }
  }
  const V3 = player.position.constructor; // Vector3 class via the node's position
  window.__magnetLog = [];
  let i = 0;
  const timer = setInterval(() => {
    if (window.__game.bumps() > beforeBumps) { clearInterval(timer); return; }
    const dx = best.position.x - player.position.x;
    const dz = best.position.z - player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    player.physicsBody.setLinearVelocity(new V3(ux * 10, 0, uz * 10));
    best.physicsBody.setLinearVelocity(new V3(-ux * 10, 0, -uz * 10));
    if (i % 25 === 0) window.__magnetLog.push({ ms: i * 16, distM: +d.toFixed(1), bumps: window.__game.bumps() });
    if (++i >= 500) clearInterval(timer); // ~8 s safety cap
  }, 16);
  return `magnet player vs ${best.name} (were ${bestD.toFixed(1)} m apart)`;
}, before);
console.log("FORCE:", forced);
if (!String(forced).startsWith("magnet")) fail(`force-contact failed: ${forced}`);

// Wait for Havok to resolve the contact and KartBody's observable → kart:bumped.
const fired = await page.waitForFunction((b) => window.__game.bumps() > b, before, { timeout: 8000 })
  .then(() => true).catch(() => false);

const magnetLog = await page.evaluate(() => window.__magnetLog ?? []);
if (magnetLog.length) {
  console.log("MAGNET LOG (ms | dist m | bumps):\n" + magnetLog.map((r) => `  ${String(r.ms).padStart(4)} | ${String(r.distM).padEnd(6)} | ${r.bumps}`).join("\n"));
}

const after = await page.evaluate(() => window.__game.bumps());
const worldEvents = await page.evaluate(() => (window.__kartEvents ?? []).slice(-10));
console.log(`BUMPS before=${before} after=${after}`);
console.log("WORLD-LEVEL kart↔kart events:", JSON.stringify(worldEvents, null, 2));

if (!fired) {
  const phys = errors.filter((e) => /havok|wasm|physics/i.test(e));
  console.log(`FAIL: kart:bumped never fired (bumps stayed at ${before})`);
  if (worldEvents.length > 0) {
    console.log("DIAGNOSIS: world-level events DID fire → the player's per-body onBump path is broken, not the collision.");
  } else {
    console.log("DIAGNOSIS: no world-level kart↔kart events either → see telemetry above for where the bodies went.");
  }
  console.log("PHYSICS-RELATED ERRORS:", phys.length ? JSON.stringify(phys.slice(0, 5), null, 2) : "none");
  browser.close();
  process.exit(1);
}
console.log("PASS: kart:bumped fires end-to-end (Havok collision event → onBump → EventBus)");
browser.close();
