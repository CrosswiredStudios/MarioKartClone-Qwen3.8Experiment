// One-off smoke check: load the app headless and confirm Havok physics boots.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:5199/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(url, { waitUntil: "load" });
// Give the top-level await physicsWorld.init() + first frames time to settle.
await page.waitForTimeout(4000);

const state = await page.evaluate(() => ({
  hasGame: typeof window.__game !== "undefined",
  screen: window.__game?.state ?? null,
}));

console.log("STATE:", JSON.stringify(state));
const physicsErrors = errors.filter((e) =>
  /havok|wasm|physics|enablePhysics/i.test(e),
);
console.log("PHYSICS-RELATED ERRORS:", physicsErrors.length ? JSON.stringify(physicsErrors, null, 2) : "none");
if (errors.length && !physicsErrors.length) {
  console.log("(other console errors present but not physics-related):", errors.slice(0, 5));
}

await browser.close();
process.exit(state.hasGame && state.screen ? 0 : 1);
