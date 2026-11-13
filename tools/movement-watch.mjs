/* Watch the Pac-Man on screen: does it travel, or does it twitch?
   Samples its floating position from the live page and counts reversals,
   tiles covered and how long the visible episode runs. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");

const url = process.argv[2] || "http://127.0.0.1:8802/?hero=0.05&envs=8";
const seconds = Number(process.argv[3] || 60);
const warm = Number(process.argv[4] || 0);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--window-size=1440,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle2" });
if (warm > 0) await new Promise((r) => setTimeout(r, warm * 1000));

const samples = await page.evaluate(async (sec) => {
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < sec * 1000) {
    const g = window.__gaki;
    const p = g && g.visible && g.visible.pacman;
    if (p) out.push({ t: performance.now(), x: p.fx, y: p.fy, dir: p.dir, alive: g.visible.pacman.alive, ep: g.run.episodes, upd: g.ppo.stats.updates });
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}, seconds);

let reversals = 0, flips = 0, travelled = 0, samplesN = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  if (b.ep !== a.ep || b.upd !== a.upd) continue; // skip episode boundaries
  const dx = b.x - a.x, dy = b.y - a.y;
  travelled += Math.hypot(dx, dy);
  samplesN++;
  const vx = Math.sign(dx), vy = Math.sign(dy);
  const DIRS = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  if (vx || vy) {
    const moved = Math.abs(dx) > Math.abs(dy) ? (vx > 0 ? 0 : 1) : (vy > 0 ? 3 : 2);
    if (a.dir >= 0 && moved === [1, 0, 3, 2][a.dir]) reversals++;
    if (moved !== a.dir) flips++;
  }
}
const last = samples[samples.length - 1];
console.log(
  `samples ${samples.length} | travelled ${travelled.toFixed(1)} tiles (${(travelled / Math.max(1, samplesN) / 1.08).toFixed(2)} tiles/s)` +
  ` | reversals ${((reversals / Math.max(1, samplesN)) * 100).toFixed(1)}% | heading changes ${((flips / Math.max(1, samplesN)) * 100).toFixed(1)}%` +
  ` | updates ${last.upd} | visible episodes ${last.ep}`
);
console.log("errors:", errors.length ? errors.slice(0, 3).join(" | ") : "none");
await browser.close();
