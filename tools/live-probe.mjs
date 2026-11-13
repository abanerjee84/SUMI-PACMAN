/* Live-state probe: what the render loop actually holds right now. */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");

const url = process.argv[2] || "http://127.0.0.1:8802/?hero=0.2&reveal=0.5&envs=2";
const wait = Number(process.argv[3] || 4000);

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,900"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, wait));

const info = await page.evaluate(() => {
  const g = window.__gaki;
  if (!g) return { err: "no __gaki hook" };
  const mv = g.views.maze;
  const geo = mv.mesh && mv.mesh.geometry;
  const ink = mv.material.uniforms.uInk.value;
  return {
    phase: g.run.phase,
    reveal: g.run.reveal,
    dissolve: g.run.dissolve,
    uReveal: mv.uniforms.uReveal.value,
    uDissolve: mv.uniforms.uDissolve.value,
    meshVisible: mv.mesh ? mv.mesh.visible : null,
    verts: geo ? geo.attributes.position.count : 0,
    tris: geo && geo.index ? geo.index.count / 3 : 0,
    boundingSphere: geo ? JSON.stringify(geo.boundingSphere) : null,
    groupVisible: mv.group.visible,
    groupScale: JSON.stringify(mv.group.scale.toArray()),
    groupParent: mv.group.parent ? mv.group.parent.type : "none",
    materialVisible: mv.material.visible,
    inkTexture: ink ? String(ink.image?.width) + "x" + String(ink.image?.height) : null,
    inkVersion: ink ? ink.version : null,
    renderCalls: g.renderer ? g.renderer.info.render.calls : null,
    trianglesDrawn: g.renderer ? g.renderer.info.render.triangles : null,
    simTime: g.visible.time ? g.visible.time.toFixed(2) : null,
    pelletsLeft: g.visible.pelletsLeft,
    ppoUpdating: g.ppo.updating,
    ppoEpoch: g.ppo.epoch,
    ppoCursor: g.ppo.cursor,
    ppoOrderLen: g.ppo.order ? g.ppo.order.length : 0,
    ppoCurN: g.ppo.cur.n,
    ppoOldN: g.ppo.old.n,
    ppoBuffer: g.ppo.bufferSize,
    ppoUpdates: g.ppo.stats.updates,
    storeCalls: g.run.storeCalls,
    learners: g.learners.map((e) => ({ seen: e.seen, done: e.done, t: e.time ? e.time.toFixed(1) : null, ep: e.episodes })).slice(0, 8),
    pac: {
      fx: g.visible.pacman.fx.toFixed(2),
      fy: g.visible.pacman.fy.toFixed(2),
      alive: g.visible.pacman.alive,
    },
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
