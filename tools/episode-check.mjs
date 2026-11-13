import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");
const browser = await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox","--disable-gpu","--window-size=1600,900"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8802/?hero=0.05&envs=8", { waitUntil: "networkidle2" });
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = await page.evaluate(() => ({
    ep: window.__gaki.run.episodes,
    train: window.__gaki.run.trainEpisodes,
    liveTime: window.__gaki.visible.time.toFixed(1),
    alive: window.__gaki.visible.pacman.alive,
    phase: window.__gaki.run.phase,
    hudEp: document.getElementById("episode-count").textContent,
    hudMean: document.getElementById("reward-value").textContent,
  }));
  console.log(`t${i * 3 + 3}s visible episode ${s.ep} (hud ${s.hudEp}) mean ${s.hudMean} · live ${s.liveTime}s alive ${s.alive} ${s.phase} · offscreen episodes ${s.train}`);
}
console.log("errors:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
