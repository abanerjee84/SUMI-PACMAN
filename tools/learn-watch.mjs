/* Watch the browser learner over time: one page, sampled HUD stats. */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");

const url = process.argv[2] || "http://127.0.0.1:8802/?envs=8";
const samples = Number(process.argv[3] || 6);
const every = Number(process.argv[4] || 30) * 1000;

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,900"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 120));
});
await page.goto(url, { waitUntil: "networkidle2" });

for (let i = 0; i < samples; i++) {
  await new Promise((r) => setTimeout(r, every));
  const s = await page.evaluate(() => {
    const g = window.__gaki;
    const st = g?.ppo?.stats || {};
    return {
      mean: document.getElementById("reward-value")?.textContent,
      best: document.getElementById("reward-best")?.textContent,
      episodes: document.getElementById("episode-count")?.textContent,
      updates: st.updates,
      entropy: st.entropy?.toFixed?.(3),
      explained: st.explained?.toFixed?.(2),
      vloss: st.valueLoss?.toFixed?.(2),
      kl: st.kl?.toFixed?.(3),
      clip: st.clipFrac?.toFixed?.(2),
      buffer: g?.ppo?.count,
      learners: g?.learners?.length,
      phase: g?.run?.phase,
      pacAlive: g?.visible?.pacman?.alive,
    };
  });
  console.log(
    `t=${((i + 1) * every / 1000).toFixed(0)}s mean ${s.mean} best ${s.best} eps ${s.episodes} ` +
      `updates ${s.updates} entropy ${s.entropy} explained ${s.explained} vloss ${s.vloss} ` +
      `kl ${s.kl} clip ${s.clip} buffer ${s.buffer} envs ${s.learners} phase ${s.phase}`
  );
}
console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
