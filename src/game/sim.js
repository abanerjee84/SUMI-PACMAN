/* ============================================================
   GAKI — the simulation.  Fixed-step movement on the tile graph,
   pellet eating, hunter collisions, the pen, power ink, and the
   state / action / reward contract the PPO agent learns from.
   ============================================================ */

import { generateMaze, mulberry32, W, H, idx, FLOOR, DIRS, openMask, bfs, inHouse, TUNNEL_Y } from "./maze.js";
import { MODE, PERSONAS, chooseDir, ghostSpeed, tileOf, FieldCache } from "./ghost-brain.js";

// debug switches used by the headless probes; absent in the browser
const ENV = (k, d) => (typeof process !== "undefined" && process.env[k] !== undefined ? Number(process.env[k]) : d);

export const PAC_SPEED = 9.0;
export const GHOST_BASE = ENV("GAKI_GHOST_BASE", 8.45);
export const CONTROL_DT = 0.1; // the agent thinks ten times a second
export const SIM_DT = 1 / 160;

const FLUSH = 0.02; // a hair past the tile centre when parked against a wall
const CORNER_TOL = 0.42; // turning a corner early, the way arcade pacman does
const FOOD_SHAPE = ENV("GAKI_FOOD_SHAPE", 0.9); // potential-based nudge towards the nearest dot
const DANGER_SHAPE = ENV("GAKI_DANGER_SHAPE", 0.45); // potential-based nudge away from a living hunter
const EDIBLE_SHAPE = ENV("GAKI_EDIBLE_SHAPE", 0.9); // potential-based nudge onto a frightened hunter
const GHOST_FROZEN = ENV("GAKI_GHOST_FROZEN", 0);
const NO_SHAPING = ENV("GAKI_NO_SHAPING", 0);
const PELLET_R = 0.46;
const GHOST_R = 0.5;

export const REWARD = {
  pellet: ENV("GAKI_R_PELLET", 10),
  power: ENV("GAKI_R_POWER", 30),
  ghost: ENV("GAKI_R_GHOST", 150),
  death: ENV("GAKI_R_DEATH", -60),
  win: ENV("GAKI_R_WIN", 300),
  step: ENV("GAKI_R_STEP", 0),
  novel: ENV("GAKI_R_NOVEL", 2),
  revisit: ENV("GAKI_R_REVISIT", -0.05),
  forward: ENV("GAKI_R_FORWARD", 0.5),
  backstep: ENV("GAKI_R_BACKSTEP", -0.4),
  loop: ENV("GAKI_R_LOOP", -0.6),
  stale: ENV("GAKI_R_STALE", -0.1),
};
const STALE_AFTER = ENV("GAKI_STALE_AFTER", 10); // ticks unfed before patience starts biting

export const STATE_SIZE = 67;

const PHASES = [
  { mode: MODE.SCATTER, t: 4 },
  { mode: MODE.CHASE, t: 22 },
  { mode: MODE.SCATTER, t: 4 },
  { mode: MODE.CHASE, t: 22 },
  { mode: MODE.SCATTER, t: 5 },
  { mode: MODE.CHASE, t: 1e9 },
];

const RELEASE_AT = [0, 6, 14, 24]; // pellet counts
const RELEASE_TIMEOUT = [0.6, 3.5, 8, 14]; // seconds
const POWER_BASE = 6.5;

const mod = (a, n) => ((a % n) + n) % n;

export class Sim {
  constructor(seed = 1, hooks = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.fields = new FieldCache(28);
    this.chooseAction = hooks.chooseAction || null;
    this.onControl = hooks.onControl || null;
    this.valueFn = hooks.valueFn || null;
    this.reset(seed);
  }

  reset(seed) {
    if (seed !== undefined) {
      this.seed = seed;
      this.rng = mulberry32(seed);
    }
    this.fields.clear();
    this.maze = generateMaze(this.rng);
    this.pellets = this.maze.pellets.slice();
    this.pelletsLeft = 0;
    for (let i = 0; i < W * H; i++) if (this.pellets[i]) this.pelletsLeft++;

    const s = this.maze.spawn;
    const mask = openMask(this.maze.grid, s.x, s.y);
    const startDir = mask & 2 ? 1 : mask & 1 ? 0 : mask & 8 ? 3 : 2;
    this.pacman = { fx: s.x, fy: s.y, dir: startDir, nextDir: startDir, alive: true, wob: 0, chomp: 0 };

    this.ghosts = PERSONAS.map((p, i) => {
      const t = this.maze.houseTiles[i];
      return {
        persona: i,
        fx: t.x,
        fy: t.y,
        dir: 3,
        mode: MODE.HOME,
        home: { x: t.x, y: t.y },
        released: false,
        releaseTime: RELEASE_TIMEOUT[i],
        jitter: 0.18 + i * 0.07,
        allowReverse: false,
        tunnelOk: false,
        rng: this.rng,
        trail: [],
      };
    });

    this.phase = 0;
    this.phaseTimer = PHASES[0].t;
    this.ticksSinceFood = 0;
    this.pelletsAtTick = 0;
    this.recentReverse = 0;
    this.visited = new Uint8Array(W * H);
    this.recentTiles = new Int16Array(12).fill(-1);
    this.recentAt = 0;
    this.newTiles = 0;
    this.lastTile = -1;
    this.ticksSinceGhost = 0;
    this.ghostsAtTick = 0;
    this.power = 0;
    this.powerTotal = POWER_BASE;
    this.powerWindows = 0;
    this.ghostsPerWindow = 0;
    this.pelletsEaten = 0;
    this.ghostsEaten = 0;
    this.time = 0;
    this.reward = 0;
    this.intervalReward = 0;
    this.done = false;
    this.won = false;
    this.caughtBy = -1;
    this.events = [{ type: "episode", seed: this.seed, maze: this.maze }];
    this.acc = 0;
    this.controlAcc = 0;
    this.pending = null;
    this.bfsPac = new Int16Array(W * H);
    this.bfsFood = new Int16Array(W * H);
    this.bfsGhost = new Int16Array(W * H);
    this.bfsPrey = new Int16Array(W * H);
    this.liveBuf = [];
    this.preyBuf = [];
    this.foodDist = 30;
    this.dangerDist = 30;
    this.edibleDist = 30;
    this.state = new Float32Array(STATE_SIZE);
    this.prevState = new Float32Array(STATE_SIZE);
    return this;
  }

  /* ---------------- movement ---------------- */

  advance(dt) {
    this.acc += dt;
    let guard = 0;
    while (this.acc >= SIM_DT && guard++ < 4000) {
      if (!this.pending && !this.done) this.beginControl();
      this.substep(SIM_DT);
      this.acc -= SIM_DT;
      this.time += SIM_DT;
      this.controlAcc += SIM_DT;
      if (this.pending && (this.controlAcc >= CONTROL_DT - 1e-6 || this.done)) this.endControl();
    }
  }

  beginControl() {
    // how long since the last bite: standing around starving should read as urgent
    this.recentReverse = Math.max(this.pacman.dir === [1, 0, 3, 2][this.pacman.dir] ? 0 : this.recentReverse * 0.7, this.pending && this.pending.a === [1, 0, 3, 2][this.pacman.dir] ? 1 : 0);
    if (this.pelletsEaten !== this.pelletsAtTick) {
      this.ticksSinceFood = 0;
      this.pelletsAtTick = this.pelletsEaten;
    } else this.ticksSinceFood++;
    if (this.ghostsEaten !== this.ghostsAtTick) {
      this.ticksSinceGhost = 0;
      this.ghostsAtTick = this.ghostsEaten;
    } else this.ticksSinceGhost++;
    const st = this.features(this.prevState);
    const foodBefore = this.foodDist;
    const dangerBefore = this.dangerDist;
    const edibleBefore = this.edibleDist;
    const mask = this.legalMask();
    const out = this.chooseAction ? this.chooseAction(this, st, mask) : this.pacman.nextDir;
    const a = typeof out === "number" ? out : out.a;
    this.pacman.nextDir = a;
    this.pending = {
      s: st,
      foodBefore,
      dangerBefore,
      edibleBefore,
      a,
      dir: this.pacman.dir,
      tile: idx(tileOf(this.pacman).x, tileOf(this.pacman).y),
      mask,
      logp: out && typeof out === "object" ? out.logp || 0 : 0,
      value: out && typeof out === "object" ? out.value || 0 : 0,
    };
    this.intervalReward = 0;
    this.controlAcc = 0;
  }

  endControl() {
    const s2 = this.features(this.state);
    // potential-based shaping: it points at the nearest ink dot and at the
    // nearest hunter without changing what a good policy wants to do. When a
    // killer is two tiles away the dot stops mattering — panic overrides greed.
    const panic = this.dangerDist <= 2 ? 1 : 0;
    const shape = NO_SHAPING ? 0 : clamp(
      (panic ? 0 : FOOD_SHAPE * (this.pending.foodBefore - 0.99 * this.foodDist)) +
        DANGER_SHAPE * (0.99 * this.dangerDist - this.pending.dangerBefore) +
        (panic ? 0 : EDIBLE_SHAPE * (this.pending.edibleBefore - 0.99 * this.edibleDist)),
      -1.2,
      1.2
    );
    // travel: cover ground in one direction pays a little, undoing your own
    // step pays less, pacing the same tiles back and forth costs, and starving
    // for too long costs more the longer it goes on
    const now = idx(tileOf(this.pacman).x, tileOf(this.pacman).y);
    let move = 0;
    if (now !== this.pending.tile && this.pending.a === this.pending.dir) move += REWARD.forward;
    if (this.pending.a === [1, 0, 3, 2][this.pending.dir]) move += REWARD.backstep;
    let repeats = 0;
    for (let n = 1; n <= 8; n++) {
      const j = (this.recentAt - n + 12) % 12;
      if (this.recentTiles[j] === now) repeats++;
    }
    if (repeats) move += REWARD.loop * repeats;
    if (this.ticksSinceFood > STALE_AFTER) move += REWARD.stale * Math.min(10, this.ticksSinceFood - STALE_AFTER);
    this.recentTiles[this.recentAt % 12] = now;
    this.recentAt++;

    const r = this.intervalReward + REWARD.step + shape + move;
    const vNext = this.valueFn ? this.valueFn(s2) : 0;
    const done = !this.pacman.alive || this.won;
    const t = {
      s: this.pending.s,
      a: this.pending.a,
      mask: this.pending.mask,
      logp: this.pending.logp,
      value: this.pending.value,
      valueNext: vNext,
      r,
      s2,
      done,
      sim: this,
    };
    this.pending = null;
    if (this.onControl) this.onControl(t);
    if (!done) this.prevState.set(s2);
  }

  addReward(v) {
    this.reward += v;
    this.intervalReward += v;
  }

  substep(dt) {
    const grid = this.maze.grid;

    // --- pacman: buffered turns, early cornering ---
    const p = this.pacman;
    if (p.alive) {
      const pt = tileOf(p);
      const m = openMask(grid, pt.x, pt.y);
      if (p.nextDir !== p.dir && m & (1 << p.nextDir)) {
        const d = DIRS[p.dir];
        const proj = p.fx * d.x + p.fy * d.y;
        const back = [1, 0, 3, 2][p.dir];
        const reverseAllowed = p.nextDir === back;
        if (reverseAllowed || Math.abs(proj - Math.round(proj)) <= CORNER_TOL) p.dir = p.nextDir;
      }
      const speed = PAC_SPEED * (this.power > 0 ? 0.95 : 1);
      travel(p, speed * dt, grid, null, dt);
      p.chomp += dt * 9;
      p.wob = Math.sin(p.chomp) * 0.5;

      // pellets
      const t = tileOf(p);
      const i = idx(t.x, t.y);
      if (this.lastTile !== i) {
        this.lastTile = i;
        if (!this.visited[i]) {
          this.visited[i] = 1;
          this.newTiles++;
          this.addReward(REWARD.novel);
        } else this.addReward(REWARD.revisit);
      }
      if (this.pellets[i]) {
        const dx = p.fx - t.x;
        const dy = p.fy - t.y;
        if (dx * dx + dy * dy <= PELLET_R * PELLET_R) {
          const kind = this.pellets[i];
          this.pellets[i] = 0;
          this.pelletsLeft--;
          this.pelletsEaten++;
          if (kind === 2) {
            this.addReward(REWARD.power);
            this.powerWindows++;
            this.ghostsPerWindow = 0;
            this.powerTotal = Math.max(1.6, POWER_BASE * Math.pow(0.84, this.powerWindows - 1));
            this.power = this.powerTotal;
            for (const g of this.ghosts) {
              if (g.mode === MODE.EATEN || g.mode === MODE.HOME) continue;
              g.mode = MODE.FRIGHTENED;
              g.allowReverse = true;
            }
            this.events.push({ type: "power", x: t.x, y: t.y, dur: this.power });
          } else {
            this.addReward(REWARD.pellet);
            this.events.push({ type: "pellet", x: t.x, y: t.y });
          }
          if (this.pelletsLeft <= 0) {
            this.won = true;
            this.done = true;
            this.addReward(REWARD.win);
            this.events.push({ type: "win", x: p.fx, y: p.fy });
          }
        }
      }
    }

    const pt0 = tileOf(p);
    const inTunnel = pt0.y === this.maze.tunnelY;
    for (const g of this.ghosts) g.tunnelOk = inTunnel;

    // --- hunters ---
    const st = {
      maze: this.maze,
      pacman: p,
      ghosts: this.ghosts,
      power: this.power,
      rng: this.rng,
    };
    for (const g of this.ghosts) {
      if (g.mode === MODE.EATEN) {
        const d = Math.hypot(g.fx - g.home.x, g.fy - g.home.y);
        if (d < 0.35 || (Math.abs(g.fx - g.home.x) < 0.3 && Math.abs(g.fy - g.home.y) < 0.3)) {
          g.mode = MODE.HOME;
          g.fx = g.home.x;
          g.fy = g.home.y;
          g.dir = 3;
          g.released = false;
          g.releaseTime = this.time + 2.4;
        }
      } else if (!g.released) {
        if (this.pelletsEaten >= RELEASE_AT[g.persona] || this.time >= g.releaseTime) {
          g.released = true;
          g.mode = PHASES[this.phase].mode;
          if (this.power > 0) g.mode = MODE.FRIGHTENED;
        }
      }
      const spd = ghostSpeed(g, st, GHOST_BASE);
      travel(g, spd * dt, grid, (e) => {
        e.allowReverse = g.mode === MODE.FRIGHTENED || g.mode === MODE.EATEN;
        e.dir = chooseDir(g, st, this.fields);
        e.allowReverse = false;
      }, dt);
    }

    // --- collisions ---
    if (p.alive) {
      for (const g of this.ghosts) {
        if (g.mode === MODE.EATEN || g.mode === MODE.HOME) continue;
        const dx = wrappedDelta(g.fx, p.fx, W);
        const dy = g.fy - p.fy;
        if (dx * dx + dy * dy <= GHOST_R * GHOST_R) {
          if (this.power > 0 && g.mode === MODE.FRIGHTENED) {
            g.mode = MODE.EATEN;
            g.allowReverse = true;
            const pts = REWARD.ghost * Math.pow(2, Math.min(3, this.ghostsPerWindow));
            this.ghostsPerWindow++;
            this.ghostsEaten++;
            this.addReward(pts);
            this.events.push({ type: "ghost", x: g.fx, y: g.fy, persona: g.persona, points: pts });
          } else {
            p.alive = false;
            this.done = true;
            this.caughtBy = g.persona;
            this.addReward(REWARD.death);
            this.events.push({ type: "death", x: p.fx, y: p.fy, persona: g.persona });
          }
          break;
        }
      }
    }

    // --- timers ---
    if (this.power > 0) {
      this.power -= dt;
      if (this.power <= 0) {
        this.power = 0;
        for (const g of this.ghosts) {
          if (g.mode === MODE.FRIGHTENED) g.mode = g.released ? PHASES[this.phase].mode : MODE.HOME;
        }
        this.events.push({ type: "power-end" });
      }
    } else if (!this.done) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0 && this.phase < PHASES.length - 1) {
        this.phase++;
        this.phaseTimer = PHASES[this.phase].t;
        for (const g of this.ghosts) if (g.released && g.mode !== MODE.EATEN) g.mode = PHASES[this.phase].mode;
      }
    }
  }

  /* ---------------- agent contract ---------------- */

  legalMask() {
    const t = tileOf(this.pacman);
    return openMask(this.maze.grid, t.x, t.y);
  }

  /** Normalised, maze-relative feature vector. Everything is measured from
   *  the agent's own body, so a fresh random maze is not a new language. */
  features(out = this.state) {
    const grid = this.maze.grid;
    const p = this.pacman;
    const t = tileOf(p);
    const i = idx(t.x, t.y);
    let k = 0;

    // 1. where I can go
    const mask = openMask(grid, t.x, t.y);
    for (let d = 0; d < 4; d++) out[k++] = mask & (1 << d) ? 1 : 0;

    // 2. where I am going, and whether I am about to undo my last move
    for (let d = 0; d < 4; d++) out[k++] = p.dir === d ? 1 : 0;
    out[k++] = p.nextDir === [1, 0, 3, 2][p.dir] ? 1 : 0;
    out[k++] = this.recentReverse;

    // 3. the food field: shortest-path direction to the nearest pellet
    bfs(grid, foodSources(this.pellets), this.bfsFood);    let bestDir = -1;
    let bestV = 1e9;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      let nx = t.x + DIRS[d].x;
      const ny = t.y + DIRS[d].y;
      if (t.y === TUNNEL_Y) nx = mod(nx, W);
      else if (nx < 0 || nx >= W) continue;
      const j = idx(nx, ny);
      if (grid[j] !== FLOOR) continue;
      const v = this.bfsFood[j];
      if (v >= 0 && v < bestV) {
        bestV = v;
        bestDir = d;
      }
    }
    for (let d = 0; d < 4; d++) out[k++] = bestDir === d ? 1 : 0;
    out[k++] = Math.min(1, this.bfsFood[i] < 0 ? 1 : this.bfsFood[i] / 16);
    this.foodDist = this.bfsFood[i] < 0 ? 30 : this.bfsFood[i];

    // 4. food I can see, tile by tile, plus "standing on one"
    out[k++] = this.pellets[i] ? 1 : 0;
    for (let d = 0; d < 4; d++) {
      let seen = 0;
      for (let n = 1; n <= 2; n++) {
        let nx = t.x + DIRS[d].x * n;
        const ny = t.y + DIRS[d].y * n;
        if (t.y === TUNNEL_Y) nx = mod(nx, W);
        else if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
        const j = idx(nx, ny);
        if (grid[j] !== FLOOR) break;
        if (this.pellets[j]) seen = Math.max(seen, this.pellets[j] === 2 ? 1 : 0.75);
      }
      out[k++] = seen;
    }

    // 5. the four hunters, always in personality order
    for (const g of this.ghosts) {
      const dx = wrappedDelta(g.fx, p.fx, W);
      const dy = g.fy - p.fy;
      const dist = Math.hypot(dx, dy);
      out[k++] = clamp(dx / 10, -1, 1);
      out[k++] = clamp(dy / 10, -1, 1);
      out[k++] = Math.min(1, dist / 12);
      out[k++] = g.mode === MODE.FRIGHTENED ? 1 : 0;
      out[k++] = g.mode === MODE.EATEN ? 1 : 0;
      out[k++] = g.mode === MODE.HOME ? 1 : 0;
    }

    // 6. danger: how soon a living hunter can touch me, per direction
    const live = this.liveBuf;
    live.length = 0;
    for (const g of this.ghosts) {
      if (g.mode === MODE.EATEN || g.mode === MODE.HOME) continue;
      if (this.power > 0 && g.mode === MODE.FRIGHTENED) continue;
      live.push(idx(tileOf(g).x, tileOf(g).y));
    }
    bfs(grid, live, this.bfsGhost);
    let nearest = 1e9;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) {
        out[k++] = 0;
        continue;
      }
      let nx = t.x + DIRS[d].x;
      const ny = t.y + DIRS[d].y;
      if (t.y === TUNNEL_Y) nx = mod(nx, W);
      else if (nx < 0 || nx >= W) {
        out[k++] = 0;
        continue;
      }
      const j = idx(nx, ny);
      const v = this.bfsGhost[j];
      nearest = Math.min(nearest, v < 0 ? 1e9 : v);
      out[k++] = v < 0 ? 0.9 : Math.min(1, v / 12);
    }
    out[k++] = nearest <= 1 ? 1 : 0;
    out[k++] = nearest <= 2 ? 1 : 0;
    out[k++] = nearest <= 4 ? 1 : 0;
    this.dangerDist = nearest >= 1e8 ? 30 : nearest;
    out[k++] = this.ghosts.some((g) => g.mode === MODE.FRIGHTENED && this.power > 0) ? 1 : 0;

    // 6b. prey: how soon a frightened hunter can be bitten, per direction.
    // Without this the lit-ink branch is a single flag and the policy has no
    // gradient telling it which way a swallowed-looking hunter actually is.
    const prey = this.preyBuf;
    prey.length = 0;
    for (const g of this.ghosts) {
      if (this.power > 0 && g.mode === MODE.FRIGHTENED) prey.push(idx(tileOf(g).x, tileOf(g).y));
    }
    let preyNearest = 1e9;
    if (prey.length) {
      bfs(grid, prey, this.bfsPrey);
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) {
          out[k++] = 0;
          continue;
        }
        let nx = t.x + DIRS[d].x;
        const ny = t.y + DIRS[d].y;
        if (t.y === TUNNEL_Y) nx = mod(nx, W);
        else if (nx < 0 || nx >= W) {
          out[k++] = 0;
          continue;
        }
        const j = idx(nx, ny);
        const v = this.bfsPrey[j];
        preyNearest = Math.min(preyNearest, v < 0 ? 1e9 : v);
        out[k++] = v < 0 ? 0.9 : Math.min(1, v / 12);
      }
      out[k++] = Math.min(1, this.bfsPrey[i] < 0 ? 1 : this.bfsPrey[i] / 12);
    } else {
      for (let d = 0; d < 4; d++) out[k++] = 0.9;
      out[k++] = 1;
    }
    this.edibleDist = preyNearest >= 1e8 ? 30 : preyNearest;

    // 7. lit ink
    out[k++] = this.power > 0 ? 1 : 0;
    out[k++] = this.power / this.powerTotal;

    // 8. how much of the maze is still on the paper
    out[k++] = this.pelletsLeft / Math.max(1, this.maze.pelletCount + this.maze.powerCount);
    out[k++] = Math.min(1, this.pelletsEaten / 20);

    // 9. geometry around me
    out[k++] = popcount(mask) / 4;
    out[k++] = t.y === this.maze.tunnelY ? 1 : 0;
    out[k++] = inHouse(t.x, t.y) ? 1 : 0;

    // 10. patience: how long the mouth has gone unfed
    out[k++] = Math.min(1, this.ticksSinceFood / 10);
    out[k++] = this.visited[i] ? 0 : 1;
    out[k++] = Math.min(1, this.ticksSinceGhost / 20);

    if (k !== STATE_SIZE) throw new Error(`state is ${k} wide, expected ${STATE_SIZE}`);
    return out;
  }

  /** Force an action from outside (keyboard play). */
  drive(dir) {
    if (dir >= 0) this.pacman.nextDir = dir;
  }
}

/* ---------------- helpers ---------------- */

function popcount(m) {
  let c = 0;
  for (let d = 0; d < 4; d++) if (m & (1 << d)) c++;
  return c;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function wrappedDelta(a, b, period) {
  let d = a - b;
  if (d > period / 2) d -= period;
  if (d < -period / 2) d += period;
  return d;
}

const foodBuf = [];
function foodSources(pellets) {
  foodBuf.length = 0;
  for (let i = 0; i < W * H; i++) if (pellets[i]) foodBuf.push(i);
  return foodBuf;
}

/** Move an entity along its direction, `dist` tiles, stopping flush against
 *  walls, landing exactly on tile centres and reporting each one. */
export function travel(e, dist, grid, onCentre, dt) {
  let remaining = dist;
  let guard = 0;
  const settle = 1 - Math.exp(-12 * dt);
  while (remaining > 1e-7 && guard++ < 48) {
    const d = DIRS[e.dir];
    const proj = e.fx * d.x + e.fy * d.y;
    const nextC = Math.floor(proj + 1e-7) + 1;
    // proj runs forward along the direction, so a negative axis flips the tile back
    const ax = d.x ? nextC * d.x : Math.round(e.fx);
    const ay = d.y ? nextC * d.y : Math.round(e.fy);
    const openAhead = ax >= 0 && ax < W && ay >= 0 && ay < H && grid[idx(ax, ay)] === FLOOR;
    // with a wall ahead the body parks on the tile centre, which is also where
    // a hunter is allowed to think again
    const limit = openAhead ? nextC : Math.round(proj) + FLUSH;
    const allow = Math.min(remaining, Math.max(0, limit - proj));
    if (allow <= 1e-7) break;
    e.fx += d.x * allow;
    e.fy += d.y * allow;
    remaining -= allow;

    // an early corner leaves a sideways offset; the ink settles back into the stroke
    const perp = d.x ? "fy" : "fx";
    e[perp] += (Math.round(e[perp]) - e[perp]) * settle;

    const now = e.fx * d.x + e.fy * d.y;
    if (Math.abs(now - limit) < 1e-6 && onCentre) onCentre(e);
    if (!openAhead) break;
  }
}
