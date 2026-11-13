import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");
const browser = await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox","--disable-gpu","--window-size=1600,900"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8802/?hero=0.05&reveal=1&envs=1", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 5000));
const clip = await page.evaluate(() => {
  const g = window.__gaki;
  const b = g.views.burst;
  // the three sizes the game uses, laid out in one row
  b.spawn(6, 8, { count: 3, spread: 0.9, size: 0.16, life: 6 });            // food
  b.spawn(12, 8, { count: 20, spread: 4.0, size: 0.8, life: 6, color: "#1b1613" });   // power
  b.spawn(12, 8, { count: 8, spread: 2.2, size: 0.5, life: 6, color: "#241d17" });
  b.spawn(19, 8, { count: 22, spread: 2.6, size: 0.9, life: 6, color: "#1b1613" });
  b.spawn(19, 8, { count: 26, spread: 5.4, size: 1.4, life: 6, color: "#8d2a22" });
  b.spawn(19, 8, { count: 64, spread: 9.0, size: 2.4, life: 6, color: "#8d2a22" });
  const px = g.pxPerTile, cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  return { x: cx + (6 - 12) * px - 60, y: cy + (8 - 8) * px - 120, width: (19 - 6) * px + 220, height: 300 };
});
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: "shots/splat-check.png", clip });
await browser.close();
console.log("ok");
