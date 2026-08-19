// Diagnose the blank race screen: after GO, compare where the LOGIC thinks the player is
// (state.pos), where the RENDERER mesh actually is (player-kart-root node), and where the
// CAMERA is. Also check for per-frame exceptions and whether renderer nodes move at all.
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
  browser.close();
  process.exit(1);
};

await page.waitForSelector('[data-testid="screen-main-menu"]', { timeout: 20_000 }).catch(() => fail("main menu never appeared"));
if (!(await clickLabel("Start"))) fail("Start button not found");
for (const [testId] of [["character-select"], ["vehicle-select"], ["map-select"]]) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 }).catch(() => fail(`${testId} never appeared`));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 25_000 }).catch(() => fail("never reached Racing"));

// Sample at two times ~3 s apart to see what moves.
const snap = () =>
  page.evaluate(() => {
    const s = window.__sw.dbg((sc) => sc);
    const cam = window.__sw.cam();
    const karts = window.__game.karts?.() ?? [];
    const player = karts.find((k) => k.id === "player") ?? karts[0];
    const root = s.getTransformNodeByName("player-kart-root");
    const body = s.getTransformNodeByName("player-kartbody");
    const trackRoot = s.getTransformNodeByName("track-root");
    return {
      cam,
      logicPos: player ? { x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2) } : null,
      rendererRoot: root ? [root.position.x.toFixed(2), root.position.y.toFixed(2), root.position.z.toFixed(2)] : "MISSING",
      bodyNode: body ? [body.position.x.toFixed(2), body.position.y.toFixed(2), body.position.z.toFixed(2)] : "MISSING",
      trackRootVisible: trackRoot ? { visible: trackRoot.isVisible, childCount: trackRoot.getChildMeshes().length } : "MISSING",
      clearColor: [s.clearColor.r, s.clearColor.g, s.clearColor.b],
    };
  });

const t0 = await snap();
await page.waitForTimeout(3000);
const t1 = await snap();
console.log("T0:", JSON.stringify(t0, null, 2));
console.log("T1 (+3s):", JSON.stringify(t1, null, 2));

// Camera-to-kart distance: if huge → camera is framing empty space.
if (t1.logicPos && t1.rendererRoot !== "MISSING") {
  const d = Math.hypot(
    t1.cam.x - Number(t1.rendererRoot[0]),
    t1.cam.y - Number(t1.rendererRoot[1]),
    t1.cam.z - Number(t1.rendererRoot[2]),
  );
  console.log(`CAM→RENDERER distance: ${d.toFixed(1)} m`);
}

console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 8), null, 2) : "none");
browser.close();
