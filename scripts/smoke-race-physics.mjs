// Deeper smoke: drive an AI race into the Racing state and verify karts MOVE under
// Havok (body → sync → brain → apply pipeline). Run against `npx vite preview --port 4173`.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

// AI-drive the player + debug handle in a prod build.
await page.addInitScript(() => localStorage.setItem("ttr.debugAIDrive", "1"));
await page.goto(url + "?debug", { waitUntil: "load" });

/** Menu/selection buttons are rebuilt every frame → click via direct DOM dispatch. */
const clickLabel = (label) =>
  page.evaluate((lbl) => {
    const el = [...document.querySelectorAll("button, .menu-item")]
      .find((e) => e.textContent.trim() === lbl);
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

// ── Menu → Start ────────────────────────────────────────────────
await page.waitForSelector('[data-testid="screen-main-menu"]', { timeout: 20_000 }).catch(() => fail("main menu never appeared"));
if (!(await clickLabel("Start"))) fail("Start button not found");

// ── Selections: Enter confirms the default on each screen ───────
for (const [testId, name] of [["character-select", "CharacterSelect"], ["vehicle-select", "VehicleSelect"], ["map-select", "MapSelect"]]) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 }).catch(() => fail(`${name} never appeared`));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}

// ── Countdown → Racing ──────────────────────────────────────────
await page.waitForFunction(() => window.__game.state === "Countdown", null, { timeout: 15_000 }).catch(() => fail("never reached Countdown"));
await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 20_000 }).catch(() => fail("never reached Racing"));

// ── Scene sanity: terrain body + kart bodies exist ──────────────
const sceneInfo = await page.evaluate(() => ({
  terrain: !!window.__sw?.dbg((s) => s.getTransformNodeByName("physicsTerrain")),
  kartBodies: window.__sw?.dbg((s) => s.transformNodes.filter((n) => n.name.endsWith("-kartbody")).length) ?? -1,
}));
console.log("SCENE:", JSON.stringify(sceneInfo));

// ── Sample kart positions over ~6 s; they must move ─────────────
const sample = () => page.evaluate(() => window.__game.karts().map((k) => ({ id: k.id, x: k.pos.x, z: k.pos.z, speed: k.speed })));

await page.waitForTimeout(2000); // let the field get rolling
let prev = await sample();
const travels = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  const cur = await sample();
  for (const c of cur) {
    const p = prev.find((k) => k.id === c.id);
    if (p) travels.push(Math.hypot(c.x - p.x, c.z - p.z));
  }
  prev = cur;
}

// Keep racing for a while longer so the player has time to bump an AI kart.
for (let i = 0; i < 24; i++) await page.waitForTimeout(1000);
const bumps = await page.evaluate(() => window.__game.bumps?.() ?? -1);

console.log("KARTS:", JSON.stringify(prev.map((k) => ({ id: k.id, speed: +k.speed.toFixed(1), x: +k.pos?.x ?? k.x }))));
const avgTravel = travels.reduce((a, b) => a + b, 0) / Math.max(1, travels.length);
console.log(`AVG TRAVEL PER SECOND: ${avgTravel.toFixed(2)} m (expect ~15-30)`);
console.log(`PLAYER BUMPS: ${bumps} (informational — AI field may not contact the player)`);

if (!sceneInfo.terrain) fail("physicsTerrain node missing");
if (sceneInfo.kartBodies < 4) fail(`expected ≥4 kart bodies, got ${sceneInfo.kartBodies}`);
if (avgTravel < 5) fail("karts barely moved — physics drive not working");

const phys = errors.filter((e) => /havok|wasm|physics|capsule|mass/i.test(e));
console.log("PHYSICS-RELATED ERRORS:", phys.length ? JSON.stringify(phys.slice(0, 10), null, 2) : "none");
if (errors.length && !phys.length) console.log("(other errors):", errors.slice(0, 5));

await browser.close();
console.log("PASS: karts moving under Havok");
process.exit(0);
