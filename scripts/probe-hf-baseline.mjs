// Headless probe for hf-test.html: wait ~6 s for spheres to settle, then read the page's own readout.
import { chromium } from "@playwright/test";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
await page.goto(url + "hf-test.html", { waitUntil: "load" });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => document.getElementById("readout").textContent));
browser.close();
