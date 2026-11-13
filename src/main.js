/* ============================================================
   GAKI 餓鬼 — a sumi-e Pac-Man that learns.
   One visible episode, several offscreen learners, one PPO
   policy shared between them, painted every frame.
   ============================================================ */

import * as THREE from "three";
import { W, H, idx } from "./game/maze.js";
import { Sim, PAC_SPEED, STATE_SIZE } from "./game/sim.js";
import { MODE, PERSONAS } from "./game/ghost-brain.js";
import { PPO } from "./rl/ppo.js";
import { MazeView, FoodView, PowerView } from "./art/maze-view.js";
import { PacView, GhostView, InkBurst } from "./art/actors.js";
import {
  inkStrokeTexture,
  inkDotTexture,
  inkDiscTexture,
  ensoTexture,
  blotTexture,
  eyeTexture,
  paperTexture,
  watermarkTexture,
  hunterTextures,
  heroImage,
} from "./art/textures.js";
import { RewardGraph } from "./ui/graph.js";

const params = new URLSearchParams(window.location.search);
const TRAIN_ENVS = params.has("envs") ? Number(params.get("envs")) : 8;
const TRAIN_SPEED = params.has("speed") ? Number(params.get("speed")) : 5; // sim seconds per real second, offscreen
const SIM_BUDGET_MS = 7; // wall-clock cap on offscreen stepping per frame
let HERO_SECONDS = params.has("hero") ? Number(params.get("hero")) : 10;
const REVEAL_SECONDS = params.has("reveal") ? Number(params.get("reveal")) : 1.5;
const DEATH_SECONDS = params.has("death") ? Number(params.get("death")) : 1.7;
const VIS_SPEED = params.has("play") ? Number(params.get("play")) : 1;

const dom = {
  stage: document.getElementById("stage"),
  hud: document.getElementById("hud"),
  hero: document.getElementById("hero"),
  heroInk: document.getElementById("hero-ink"),
  heroSeconds: document.getElementById("hero-seconds"),
  banner: document.getElementById("banner"),
  bannerKanji: document.querySelector("#banner .kanji"),
  bannerSub: document.querySelector("#banner .sub"),
  reward: document.getElementById("reward-value"),
  last: document.getElementById("reward-last"),
  best: document.getElementById("reward-best"),
  episodes: document.getElementById("episode-count"),
  bar: document.getElementById("bar-fill"),
  graph: document.getElementById("graph"),
  status: document.getElementById("status-list"),
  ppo: document.getElementById("ppo-list"),
};

const renderer = new THREE.WebGLRenderer({ canvas: dom.stage, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0xf2ead9, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.z = 10;

let pxPerTile = 40;
let halfW = 20;
let halfH = 12;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, true);
  const usableW = w * (w > 1100 ? 0.58 : 0.92);
  const usableH = h * (w > 1100 ? 0.78 : 0.72);
  pxPerTile = Math.min(usableW / W, usableH / H);
  halfW = w / (2 * pxPerTile);
  halfH = h / (2 * pxPerTile);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  if (views.paper) {
    views.paper.scale.set(2 * halfW, 2 * halfH, 1);
    // one unstretched sheet of paper across the viewport: no tiling seams
    if (views.paper.material.map) views.paper.material.map.repeat.set(1, 1);
  }
  if (views.watermark) views.watermark.scale.set(H * 1.15, H * 1.15, 1);
  if (graph) graph.draw();
}
window.addEventListener("resize", resize);

const views = {};
let graph = null;
let ppo = null;
let visible = null;
const learners = [];

const run = {
  phase: "hero",
  t: 0,
  time: 0,
  paused: false,
  manual: false,
  manualTimer: 0,
  episodes: 0,
  trainEpisodes: 0,
  rewards: [],
  ema: 0,
  best: -Infinity,
  last: 0,
  deathInfo: null,
  reveal: 0,
  dissolve: 0,
};

const rndSeed = () => (Math.random() * 2147483647) | 0;

// The episode on screen only ends when this Pac-Man dies (or eats every dot),
// so the headline numbers track that lineage.
function recordEpisode(sim) {
  const r = sim.reward;
  run.rewards.push(r);
  if (run.rewards.length > 60) run.rewards.splice(0, run.rewards.length - 60);
  run.episodes++;
  run.last = r;
  if (r > run.best) run.best = r;
  const n = Math.min(10, run.rewards.length);
  let s = 0;
  for (let i = run.rewards.length - n; i < run.rewards.length; i++) s += run.rewards[i];
  run.ema = s / n;
  if (graph) graph.add(r);
  return r;
}

// Offscreen learners die constantly; they feed the curve, never the headline.
function recordTraining(sim) {
  run.trainEpisodes++;
  if (graph) graph.add(sim.reward);
}

/* ---------------- the shared policy ---------------- */

function hooks(envId) {
  return {
    chooseAction(sim, s, mask) {
      if (envId === 0 && run.manual) return { a: sim.pacman.nextDir, logp: 0, value: 0 };
      // the episode on screen shows what the policy believes once it has
      // learned something; before that it wanders so the ink looks alive
      if (envId === 0 && ppo.stats.updates >= 20) {
        // An argmax policy with no memory flip-flops on near ties, so keep the
        // current heading unless another way is clearly better.
        const out = ppo.best(s, mask);
        const d = sim.pacman.dir;
        if (mask & (1 << d) && out.probs[d] >= out.probs[out.a] - 0.05) {
          return { ...out, a: d, logp: ppo.net.logProb(mask, d) };
        }
        return out;
      }
      return ppo.act(s, mask);
    },
    valueFn(s2) {
      ppo.net.forward(s2);
      return ppo.net.cache.value;
    },
    onControl(t) {
      if (envId === 0 && run.manual) return;
      run.storeCalls = (run.storeCalls || 0) + 1;
      if (ppo.store(t.sim.envId ?? envId, t.s, t.a, t.mask, t.r, t.logp, t.value, t.valueNext, t.done)) {
        if (ppo.updating) ppo.trainMinibatches(64); // finish the update in flight, then swap buffers
        if (!ppo.updating) ppo.beginUpdate();
      }
    },
  };
}

/* ---------------- ink assets ---------------- */

async function buildAssets() {
  const ink = inkStrokeTexture();
  const dot = inkDotTexture();
  const enso = ensoTexture();
  const blot = blotTexture();
  const disc = inkDiscTexture();
  const eyes = eyeTexture();
  const mark = watermarkTexture();
  const hunters = await hunterTextures("assets/images/ghosts.png", PERSONAS.map((p) => p.color));
  const paper = await paperTexture("assets/images/paper.png");
  const hero = await heroImage("assets/images/title.png");

  if (paper) {
    views.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: paper, color: new THREE.Color("#fffaf0"), transparent: true, opacity: 0.5 })
    );
    views.paper.position.z = -3;
  } else {
    views.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#eae2d1") })
    );
    views.paper.position.z = -3;
  }
  scene.add(views.paper);

  views.watermark = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: mark, transparent: true, depthWrite: false, depthTest: false, opacity: 0.16 })
  );
  views.watermark.position.set(0, 0.4, -2);
  scene.add(views.watermark);

  views.maze = new MazeView(ink);
  views.food = new FoodView(dot);
  views.power = new PowerView(enso);
  views.burst = new InkBurst(blot);
  scene.add(views.maze.group);
  scene.add(views.food.group);
  scene.add(views.power.group);
  scene.add(views.burst.points);

  views.pac = new PacView(disc);
  scene.add(views.pac.mesh);

  views.ghosts = PERSONAS.map((p, i) => {
    const col = new THREE.Color().setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace);
    const gv = new GhostView(hunters[i], eyes, col);
    scene.add(gv.group);
    return gv;
  });

  return hero;
}

/* ---------------- episode lifecycle ---------------- */

function mazeTotals(maze) {
  let dots = 0;
  let powers = 0;
  for (let i = 0; i < maze.pellets.length; i++) {
    if (maze.pellets[i] === 1) dots++;
    else if (maze.pellets[i] === 2) powers++;
  }
  return { dots, powers, total: dots + powers };
}

function startEpisode(seed) {
  visible.reset(seed);
  run.totals = mazeTotals(visible.maze);
  views.maze.build(visible.maze);
  views.food.build(visible.maze);
  views.power.build(visible.maze);
  views.maze.setReveal(0);
  views.food.setReveal(0);
  views.power.setReveal(0);
  views.maze.setDissolve(0);
  views.food.setDissolve(0);
  run.phase = "reveal";
  run.t = 0;
  run.reveal = 0;
  run.dissolve = 0;
  banner("墨", `maze ${seed & 0xffff} · episode ${run.episodes}`);
}

function enterDeath() {
  run.phase = "death";
  run.t = 0;
  const ev = run.deathInfo;
  const p = visible.pacman;
  if (visible.won) {
    views.burst.spawn(p.fx, p.fy, { count: 34, spread: 5.2, size: 1.0, color: "#1b1613" });
    banner("満腹", `all ink eaten · ${visible.ghostsEaten} hunters swallowed`);
  } else {
    const who = PERSONAS[visible.caughtBy] || PERSONAS[0];
    // the last bite: a big red throw with a dark core where he was
    const blood = who.key === "aka" ? "#a3231b" : "#8d2a22";
    views.burst.spawn(p.fx, p.fy, { count: 22, spread: 2.6, size: 0.9, life: 1.6, color: "#1b1613" });
    views.burst.spawn(p.fx, p.fy, { count: 26, spread: 5.4, size: 1.4, life: 1.2, color: blood });
    views.burst.spawn(p.fx, p.fy, { count: 64, spread: 9.0, size: 2.4, life: 1.4, color: blood });
    banner("捕まった", `${who.name} ${who.romaji} took the last bite · reward ${visible.reward.toFixed(0)}`);
  }
  recordEpisode(visible);
}

function consumeEvents() {
  for (const e of visible.events) {
    if (e.type === "pellet") {
      views.food.markEaten(idx(e.x, e.y));
      views.burst.spawn(e.x, e.y, { count: 3, spread: 0.9, size: 0.16, life: 0.5 });
    } else if (e.type === "power") {
      views.power.markEaten(idx(e.x, e.y));
      views.burst.spawn(e.x, e.y, { count: 20, spread: 4.0, size: 0.8, life: 1.0, color: "#1b1613" });
      views.burst.spawn(e.x, e.y, { count: 8, spread: 2.2, size: 0.5, life: 0.8, color: "#241d17" });
    } else if (e.type === "ghost") {
      views.burst.spawn(e.x, e.y, { count: 26, spread: 4.6, size: 0.95, color: "#23324d" });
      banner("食った", `${PERSONAS[e.persona].name} swallowed · +${e.points}`);
    } else if (e.type === "death") {
      run.deathInfo = e;
    } else if (e.type === "power-end") {
      banner("墨が戻る", "the lit ink fades");
    }
  }
  visible.events.length = 0;
  if (visible.done && run.phase === "play") enterDeath();
}

let bannerToken = 0;
function banner(kanji, sub) {
  if (!dom.banner) return;
  dom.bannerKanji.textContent = kanji;
  dom.bannerSub.textContent = sub;
  dom.banner.classList.remove("show");
  void dom.banner.offsetWidth;
  dom.banner.classList.add("show");
  bannerToken++;
}

/* ---------------- hero ---------------- */

let heroArt = null;
function drawHeroInk(p) {
  const c = dom.heroInk;
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cx = w * 0.5;
  const cy = h * 0.52;
  const ease = 1 - Math.pow(1 - Math.min(1, p * 1.15), 3);
  const R = Math.max(w, h) * 0.62 * ease;
  if (R < 2) return;

  g.save();
  g.beginPath();
  const lobes = 34;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const n = 1 + 0.16 * Math.sin(a * 3 + 1.1) + 0.1 * Math.sin(a * 7 + 2.3) + 0.05 * Math.sin(a * 13);
    const r = R * n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.78;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.clip();
  if (heroArt) {
    const iw = heroArt.width;
    const ih = heroArt.height;
    const fit = Math.min((w * 0.86) / iw, (h * 0.8) / ih);
    g.globalAlpha = 0.92;
    g.drawImage(heroArt, cx - (iw * fit) / 2, cy - (ih * fit) / 2, iw * fit, ih * fit);
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "rgba(24,19,15,0.85)";
    g.fillRect(0, 0, w, h);
  }
  g.restore();

  // spatter that ran ahead of the bleed
  g.fillStyle = "rgba(24,19,15,0.5)";
  for (let i = 0; i < 40; i++) {
    const a = i * 2.399;
    const d = R * (0.9 + ((i * 37 % 11) / 11) * 0.5);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.7;
    const r = 1 + ((i * 53) % 7) * 0.8;
    g.globalAlpha = 0.28 * ease;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function endHero() {
  dom.hero.classList.add("fade");
  dom.hud.classList.add("live");
  startEpisode(rndSeed());
}

/* ---------------- keyboard ---------------- */

window.addEventListener("keydown", (ev) => {
  const k = ev.key;
  if (k === " ") {
    run.paused = !run.paused;
    if (run.paused) banner("待つ", "the ink waits");
    ev.preventDefault();
    return;
  }
  if (k === "r" || k === "R") {
    if (run.phase === "play" || run.phase === "death") {
      if (!visible.done) recordEpisode(visible);
      startEpisode(rndSeed());
    }
    return;
  }
  if (k === "a" || k === "A") {
    run.manual = false;
    banner("餓鬼が戻る", "the policy takes the wheel");
    return;
  }
  if (k === "t" || k === "T") {
    trainSpeedIndex = (trainSpeedIndex + 1) % TRAIN_SPEEDS.length;
    trainSpeed = TRAIN_SPEEDS[trainSpeedIndex];
    banner(`×${trainSpeed}`, "offscreen learners");
    return;
  }
  const dirs = { ArrowRight: 0, ArrowLeft: 1, ArrowDown: 2, ArrowUp: 3, d: 0, a: undefined, s: 2, w: 3 };
  const d = dirs[k];
  if (d !== undefined && d !== null) {
    run.manual = true;
    run.manualTimer = 0;
    visible.drive(d);
    ev.preventDefault();
  }
});

const TRAIN_SPEEDS = [1, 5, 12, 24];
let trainSpeedIndex = 1;
let trainSpeed = TRAIN_SPEEDS[trainSpeedIndex];

/* ---------------- the frame ---------------- */

let lastT = performance.now();

function tick(now) {
  const dtReal = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!run.paused) {
    run.time += dtReal;
    if (run.phase === "hero") {
      run.t += dtReal;
      drawHeroInk(run.t / HERO_SECONDS);
      const left = Math.max(0, Math.ceil(HERO_SECONDS - run.t));
      if (dom.heroSeconds) dom.heroSeconds.textContent = String(left);
      if (run.t >= HERO_SECONDS) endHero();
    } else if (run.phase === "reveal") {
      run.t += dtReal;
      run.reveal = Math.min(1, run.t / REVEAL_SECONDS);
      views.maze.setReveal(run.reveal);
      views.food.setReveal(run.reveal);
      views.power.setReveal(run.reveal);
      if (run.reveal >= 1) run.phase = "play";
    } else if (run.phase === "play") {
      visible.advance(dtReal * VIS_SPEED);
      consumeEvents();
      if (run.manual) {
        run.manualTimer += dtReal;
        if (run.manualTimer > 6) {
          run.manual = false;
          banner("餓鬼が戻る", "back to the policy");
        }
      }
    } else if (run.phase === "death") {
      run.t += dtReal;
      const p = Math.min(1, run.t / DEATH_SECONDS);
      run.dissolve = ease(p);
      views.maze.setDissolve(run.dissolve);
      views.food.setDissolve(run.dissolve);
      views.power.setDissolve(run.dissolve);
      if (p >= 1) startEpisode(rndSeed());
    }

    stepLearners(dtReal);
    if (ppo && ppo.updating) ppo.trainMinibatches(2);
    // a full buffer with no update in flight would otherwise sit there forever
    if (ppo && !ppo.updating && ppo.fillRatio() >= 1) ppo.beginUpdate();
  }
  drawActors(dtReal);
  window.__gaki = { views, run, visible, ppo, pxPerTile, renderer, scene, learners };
  views.burst.update(dtReal, pxPerTile * 0.9);
  views.food.update(dtReal, run.time);
  views.power.update(dtReal, run.time);
  hud();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

function stepLearners(dtReal) {
  const t0 = performance.now();
  const step = dtReal * trainSpeed;
  for (const e of learners) {
    if (performance.now() - t0 > SIM_BUDGET_MS) break;
    e.seen = (e.seen || 0) + 1;
    if (e.done) {
      recordTraining(e);
      e.reset(rndSeed());
      continue;
    }
    e.advance(step);
  }
}

function drawActors(dt) {
  const t = run.time;
  const p = visible.pacman;
  const dying = run.phase === "death";
  const mouth = p.alive ? 0.16 + 0.66 * Math.abs(Math.sin(p.chomp)) : Math.min(1, run.t / DEATH_SECONDS) * 2.2;
  views.pac.update(p, dt, t, {
    mouth: dying ? Math.min(2.6, mouth + run.t * 1.6) : mouth,
    lit: visible.power > 0 ? 0.55 + 0.35 * Math.sin(t * 8) : 0,
    alpha: dying ? Math.max(0, 1 - run.t / DEATH_SECONDS) : run.phase === "reveal" ? Math.min(1, run.reveal * 1.4) : 1,
    scale: dying ? 1 + run.t * 0.5 : 1,
  });
  views.pac.mesh.visible = p.alive || dying;

  for (let i = 0; i < views.ghosts.length; i++) {
    const g = visible.ghosts[i];
    const eaten = g.mode === MODE.EATEN;
    const fright = g.mode === MODE.FRIGHTENED;
    views.ghosts[i].update(g, t, {
      fright,
      eyes: eaten,
      alpha: run.phase === "reveal" ? Math.min(0.9, run.reveal * 1.3) : dying ? Math.max(0.25, 1 - run.t * 0.5) : g.released ? 1 : 0.72,
      wob: fright ? 1.7 : 1,
      scale: eaten ? 0.66 : fright ? 0.9 + 0.06 * Math.sin(t * 11) : 1,
      lookX: p.fx,
      lookY: p.fy,
    });
    if (g.trail && g.trail.length > 6 && !eaten) {
      views.burst.spawn(g.fx, g.fy, { count: 1, spread: 0.3, size: 0.35, life: 0.5, color: fright ? "#2c3550" : "#201914" });
    }
  }
}

/* ---------------- HUD ---------------- */

const modeName = (m) =>
  m === MODE.HOME ? "home" : m === MODE.CHASE ? "chase" : m === MODE.SCATTER ? "scatter" : m === MODE.FRIGHTENED ? "frightened" : "eaten";

function hud() {
  dom.reward.textContent = run.episodes ? run.ema.toFixed(1) : "0.0";
  dom.last.textContent = run.last.toFixed(0);
  dom.best.textContent = Number.isFinite(run.best) ? run.best.toFixed(0) : "—";
  dom.episodes.textContent = String(run.episodes);
  const total = run.totals ? run.totals.total : 1;
  const eaten = visible ? total - visible.pelletsLeft : 0;
  dom.bar.style.width = `${Math.round((eaten / Math.max(1, total)) * 100)}%`;

  const rows = [];
  rows.push(["局 episode", `${run.episodes}`]);
  rows.push(["時間 time", visible ? visible.time.toFixed(1) + "s" : "—"]);
  rows.push(["残り ink", visible ? `${visible.pelletsLeft} left` : "—"]);
  rows.push(["力 lit ink", visible && visible.power > 0 ? `${visible.power.toFixed(1)}s · ${visible.ghostsPerWindow} eaten` : "off"]);
  rows.push(["状態 phase", run.phase + (run.manual ? " · driving" : "") + (run.paused ? " · paused" : "")]);
  rows.push(["幽霊 hunters", visible ? visible.ghosts.map((g) => `${PERSONAS[g.persona].name}:${modeName(g.mode)}`).join(" ") : "—"]);
  rows.push(["学習 learners", `${learners.length + 1} envs · ×${trainSpeed}`]);
  rows.push(["学習 episodes", `${run.trainEpisodes} offscreen`]);
  dom.status.innerHTML = rows.map(([k, v]) => `<li><i>${k}</i><b>${v}</b></li>`).join("");

  const s = ppo ? ppo.stats : {};
  const ppoRows = [
    ["updates", String(s.updates || 0)],
    ["policy loss", (s.policyLoss || 0).toFixed(3)],
    ["value loss", (s.valueLoss || 0).toFixed(2)],
    ["entropy", (s.entropy || 0).toFixed(3)],
    ["KL", (s.kl || 0).toFixed(4)],
    ["clip", ((s.clipFrac || 0) * 100).toFixed(1) + "%"],
    ["explained", ((s.explained || 0) * 100).toFixed(0) + "%"],
    ["buffer", `${ppo ? ppo.ptr : 0}/${ppo ? ppo.bufferSize : 0}`],
    ["params", ppo ? ppo.net.paramCount().toLocaleString() : "—"],
    ["state", `${STATE_SIZE} features`],
  ];
  dom.ppo.innerHTML = ppoRows.map(([k, v]) => `<li><i>${k}</i><b>${v}</b></li>`).join("");
}

/* ---------------- boot ---------------- */

async function boot() {
  heroArt = await buildAssets();
  graph = new RewardGraph(dom.graph);
  ppo = new PPO({
    stateSize: STATE_SIZE,
    actions: 4,
    buffer: 1024,
    epochs: 8,
    minibatch: 32,
    lr: 5e-4,
    entropyCoef: 0.03,
    entropyDecay: 0.996,
    entropyFloor: 0.004,
    klStop: 0.02,
    rewardScale: 0.1,
  });

  visible = new Sim(rndSeed(), hooks(0));
  visible.envId = 0;
  run.totals = mazeTotals(visible.maze);
  views.maze.build(visible.maze);
  views.food.build(visible.maze);
  views.power.build(visible.maze);
  views.maze.setReveal(0);
  views.food.setReveal(0);
  views.power.setReveal(0);

  for (let i = 0; i < TRAIN_ENVS; i++) {
    const e = new Sim(rndSeed(), hooks(i + 1));
    e.envId = i + 1;
    learners.push(e);
  }

  resize();
  requestAnimationFrame(tick);
}

boot().catch((err) => {
  console.error(err);
  banner("エラー", String(err && err.message ? err.message : err));
});
