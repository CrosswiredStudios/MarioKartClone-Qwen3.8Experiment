// Capture console errors + pageerrors on the DEV server (5173) hf-test page.
import { chromium } from "@playwright/test";

const url = process.env.DEV_URL ?? "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log(`CONSOLE[${m.type()}]:`, m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
page.on("requestfinished", async (r) => {
  if (r.url().includes(".wasm") || r.url().includes("havok")) {
    const resp = await r.response();
    console.log(`REQ: ${r.url()} → ${resp ? resp.status() : "?"} ${resp?.headers()["content-type"] ?? ""}`);
  }
});
await page.goto(url + "hf-test.html", { waitUntil: "load" });
await page.waitForTimeout(8000);
console.log("READOUT:", await page.evaluate(() => document.getElementById("readout").textContent));
browser.close();
