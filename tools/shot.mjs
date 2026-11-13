/* Screenshot the running page without touching the user's browser. */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");

const url = process.argv[2] || "http://127.0.0.1:8802/";
const waitMs = Number(process.argv[3] || 2500);
const outDir = path.resolve("shots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,900"],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ""}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, waitMs));

// optionally wait for a particular phase (play | reveal | death | hero)
const wantPhase = process.argv[6];
if (wantPhase) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const txt = await page.evaluate(() => document.getElementById("status-list")?.innerText || "");
    if (txt.includes(`phase\n${wantPhase}`) || txt.includes(`phase ${wantPhase}`)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const name = process.argv[4] || `shot-${Date.now()}`;
const file = path.join(outDir, `${name}.png`);
const clip = process.argv[5]
  ? process.argv[5] === "pac"
    ? await page.evaluate(() => {
        const g = window.__gaki;
        const p = g.visible.pacman;
        const cx = window.innerWidth / 2 + (p.fx - (25 - 1) / 2) * g.pxPerTile;
        const cy = window.innerHeight / 2 + (p.fy - (17 - 1) / 2) * g.pxPerTile;
        const w = 340;
        const h = 220;
        return {
          x: Math.max(0, Math.min(window.innerWidth - w, cx - w / 2)),
          y: Math.max(0, Math.min(window.innerHeight - h, cy - h / 2)),
          width: w,
          height: h,
        };
      })
    : (() => {
        const [x, y, width, height] = process.argv[5].split(",").map(Number);
        return { x, y, width, height };
      })()
  : undefined;
await page.screenshot({ path: file, fullPage: false, clip });
if (clip) await page.screenshot({ path: path.join(outDir, `${name}-full.png`), fullPage: false });

const probe = await page.evaluate(() => {
  const canvas = document.getElementById("stage");
  const hud = document.getElementById("hud");
  const hero = document.getElementById("hero");
  return {
    canvas: canvas ? `${canvas.width}x${canvas.height}` : "none",
    hudLive: hud ? hud.classList.contains("live") : null,
    maze: window.__gaki
      ? {
          phase: window.__gaki.run.phase,
          uReveal: window.__gaki.views.maze.uniforms.uReveal.value,
          uDissolve: window.__gaki.views.maze.uniforms.uDissolve.value,
          verts: window.__gaki.views.maze.mesh?.geometry.attributes.position.count ?? 0,
          calls: window.__gaki.renderer.info.render.calls,
          tris: window.__gaki.renderer.info.render.triangles,
        }
      : null,
    heroFade: hero ? hero.classList.contains("fade") : null,
    reward: document.getElementById("reward-value")?.textContent,
    episodes: document.getElementById("episode-count")?.textContent,
    status: document.getElementById("status-list")?.innerText?.slice(0, 220),
    ppo: document.getElementById("ppo-list")?.innerText?.slice(0, 220),
  };
});

console.log("saved", file);
console.log(JSON.stringify(probe, null, 2));
console.log("--- console ---");
console.log(logs.slice(0, 40).join("\n") || "(clean)");

await browser.close();
