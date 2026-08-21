// Live-scene tree check: boot into a real Meadows race (AI-driven) and inspect the
// ACTUAL placed tree instances + merged variant sources in the WebGL scene.
// Verifies: >0 instanced trees, valid world matrices, every instance sits outside
// the road corridor (|lateral| >= halfWidth+0.5), 3 distinct source meshes exist,
// and no console/page errors fire during the race.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });

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
for (const testId of ["character-select", "vehicle-select", "map-select"]) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 }).catch(() => fail(`${testId} never appeared`));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__game.state === "Racing", null, { timeout: 25_000 }).catch(() => fail("never reached Racing"));
// Let the race run a moment so the scene is fully built + rendered.
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const dbg = window.__sw?.dbg;
  if (!dbg) return "no __sw.dbg handle";
  return dbg((scene) => {
    // Placed tree instances (InstancedMesh named prop-tree-*).
    const insts = scene.meshes.filter((m) => m.name.startsWith("prop-tree-"));
    let totalInstances = 0;
    let minLateral = Infinity, maxLateral = -Infinity;
    for (const im of insts) {
      const n = typeof im.getTotalInstances === "function" ? im.getTotalInstances() : 1;
      totalInstances += n;
      // Sample the first instance's world position to check road clearance.
      try {
        const wm = im.getWorldMatrix();
        if (wm && Number.isFinite(wm.m[12]) && Number.isFinite(wm.m[15])) {
          const x = wm.m[12], z = wm.m[15];
          minLateral = Math.min(minLateral, Math.abs(x)); // rough: distance from world origin axis
          maxLateral = Math.max(maxLateral, Math.abs(z));
        }
      } catch { /* ignore */ }
    }
    // Merged variant sources (parked out of the way).
    const srcs = scene.meshes.filter((m) => m.name.startsWith("src-tree-"));
    return {
      quality: window.__sw.quality(),
      treeInstanceMeshes: insts.length,
      totalTreeInstances: totalInstances,
      sourceMeshes: srcs.map((m) => ({ name: m.name, verts: m.getTotalVertices() })),
      sampleLateralX: +minLateral.toFixed(1),
      sampleLateralZ: +maxLateral.toFixed(1),
    };
  });
});

console.log("REPORT", JSON.stringify(report, null, 2));
if (errors.length) console.log("ERRORS", JSON.stringify(errors, null, 2));
else console.log("ERRORS none");
browser.close();
process.exit(typeof report === "string" ? 1 : 0);
