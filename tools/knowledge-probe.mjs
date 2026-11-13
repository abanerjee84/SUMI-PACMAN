/* Does the learned policy know which hunters are food and which are danger?
   Train, then walk every control tick of evaluation episodes and ask what the
   chosen action did to the shortest-path distance to the nearest edible hunter
   and to the nearest hunter that can kill you.

   node tools/knowledge-probe.mjs [envs] [secondsPerEnv]
*/
const N = Number(process.argv[2] || 12);
const budget = Number(process.argv[3] || 500) * N;

const { Sim, STATE_SIZE } = await import("../src/game/sim.js");
const { PPO } = await import("../src/rl/ppo.js");
const { W, H, idx, DIRS, bfs, TUNNEL_Y } = await import("../src/game/maze.js");
const { MODE, tileOf } = await import("../src/game/ghost-brain.js");

const ppo = new PPO({
  stateSize: STATE_SIZE,
  actions: 4,
  buffer: 1024,
  epochs: 4,
  minibatch: 32,
  lr: 2.5e-4,
  entropyCoef: 0.03,
  entropyDecay: Number(process.env.ENT_DECAY ?? 0.995),
  klStop: 0.02,
  gamma: Number(process.env.GAMMA ?? 0.99),
});

const rnd = () => (Math.random() * 2147483647) | 0;

const hooks = (id) => ({
  chooseAction: (sim, s, mask) => ppo.act(s, mask),
  valueFn: (s2) => {
    ppo.net.forward(s2);
    return ppo.net.cache.value;
  },
  onControl: (t) => {
    if (ppo.store(t.sim.envId ?? id, t.s, t.a, t.mask, t.r, t.logp, t.value, t.valueNext, t.done)) ppo.beginUpdate();
  },
});

const envs = [];
for (let i = 0; i < N; i++) {
  const e = new Sim(rnd(), hooks(i));
  e.envId = i;
  envs.push(e);
}

const mean = (arr, f, n) => {
  const from = Math.max(0, arr.length - n);
  let s = 0;
  for (let i = from; i < arr.length; i++) s += f(arr[i]);
  return s / (arr.length - from);
};

const eps = [];
let t = 0;
let updates = 0;
while (t < budget) {
  for (const e of envs) {
    e.advance(0.05);
    t += 0.05;
    if (e.done) {
      eps.push({ r: e.reward, time: e.time, pel: e.pelletsEaten, gh: e.ghostsEaten });
      e.reset(rnd());
    }
  }
  while (ppo.updating) {
    if (ppo.trainMinibatches(32)) updates++;
  }
}
console.log(`trained: ${eps.length} episodes, ${updates} updates, rew50 ${mean(eps, (x) => x.r, 50).toFixed(0)}, ghosts50 ${mean(eps, (x) => x.gh, 50).toFixed(2)}`);

/* ---------------- the probe ---------------- */

const distE = new Float32Array(W * H);
const distD = new Float32Array(W * H);

function nextTile(grid, x, y, d) {
  let nx = x + DIRS[d].x;
  const ny = y + DIRS[d].y;
  if (y === TUNNEL_Y) nx = ((nx % W) + W) % W;
  else if (nx < 0 || nx >= W) return -1;
  if (ny < 0 || ny >= H) return -1;
  const j = idx(nx, ny);
  return grid[j] === 1 ? -1 : j;
}

function analyse(label, chooser, episodes = 30) {
  const gridOf = (sim) => sim.maze.grid;
  let ticks = 0;
  const eat = { approach: 0, away: 0, still: 0, ticks: 0 };
  const flee = { away: 0, toward: 0, still: 0, ticks: 0 };
  const power = { ticks: 0, ateGhost: 0, windows: 0, ateInWindow: 0 };
  let deaths = 0;
  let deathsClose = 0; // died although a legal move existed that raised the danger distance
  let deathsEscapable = 0;
  let ghostEaten = 0;
  let life = 0;
  let pellets = 0;
  let reward = 0;

  // do the analysis inside the chooser, where the sim is in hand
  const wrapped = new Sim(rnd(), {
    chooseAction(s2, s, mask) {
      const grid = gridOf(s2);
      const t = tileOf(s2.pacman);
      const me = idx(t.x, t.y);
      const edible = [];
      const danger = [];
      for (const g of s2.ghosts) {
        const gt = tileOf(g);
        if (g.mode === MODE.FRIGHTENED && s2.power > 0) edible.push(idx(gt.x, gt.y));
        else if (g.mode !== MODE.EATEN && g.mode !== MODE.HOME && g.released) danger.push(idx(gt.x, gt.y));
      }
      const picked = chooser(s2, s, mask);
      const a = typeof picked === "number" ? picked : picked.a;
      const j = nextTile(grid, t.x, t.y, a);
      if (j < 0) return a;

      if (edible.length) {
        bfs(grid, edible, distE);
        const d0 = distE[me];
        const d1 = distE[j];
        if (d0 >= 0 && d0 <= 6 && d1 >= 0) {
          eat.ticks++;
          if (d1 < d0) eat.approach++;
          else if (d1 > d0) eat.away++;
          else eat.still++;
        }
      }
      if (danger.length) {
        bfs(grid, danger, distD);
        const d0 = distD[me];
        const d1 = distD[j];
        if (d0 >= 0 && d0 <= 4 && d1 >= 0) {
          flee.ticks++;
          if (d1 > d0) flee.away++;
          else if (d1 < d0) flee.toward++;
          else flee.still++;
          if (d1 <= 1) {
            let escapable = false;
            for (let d = 0; d < 4; d++) {
              const jj = nextTile(grid, t.x, t.y, d);
              if (jj >= 0 && distD[jj] > d0) escapable = true;
            }
            if (escapable) deathsEscapable++;
          }
        }
      }
      return a;
    },
  });
  wrapped.envId = 100;

  const target = wrapped;
  for (const which of [target]) {
    for (let k = 0; k < episodes; k++) {
      let j = 0;
      const before = which.ghostsEaten;
      while (!which.done && j < 12000) {
        which.advance(0.05);
        j++;
      }
      life += which.time;
      ghostEaten += which.ghostsEaten - before;
      pellets += which.pelletsEaten;
      reward += which.reward;
      if (which.done && !which.won) {
        deaths++;
        // was the hunter already next to it at the last decision?
        const g = tileOf(which.pacman);
        let close = false;
        for (const gh of which.ghosts) {
          if (gh.mode === MODE.EATEN || gh.mode === MODE.HOME) continue;
          if (which.power > 0 && gh.mode === MODE.FRIGHTENED) continue;
          const gt = tileOf(gh);
          if (Math.abs(gt.x - g.x) + Math.abs(gt.y - g.y) <= 3) close = true;
        }
        if (close) deathsClose++;
      }
      which.reset(rnd());
    }
  }
  const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) + "%" : "n/a");
  console.log(`\n${label}`);
  console.log(`  reward ${reward.toFixed(0)} | pellets ${(pellets / episodes).toFixed(1)} | life ${(life / episodes).toFixed(1)}s | ghosts eaten ${(ghostEaten / episodes).toFixed(2)} | deaths ${deaths}`);
  console.log(`  edible window: ${eat.ticks} ticks with a frightened hunter within 6 · moved closer ${pct(eat.approach, eat.ticks)}, moved away ${pct(eat.away, eat.ticks)}, sideways ${pct(eat.still, eat.ticks)}`);
  console.log(`  threat window: ${flee.ticks} ticks with a killer within 4 · moved away ${pct(flee.away, flee.ticks)}, moved into it ${pct(flee.toward, flee.ticks)}, sideways ${pct(flee.still, flee.ticks)}`);
  console.log(`  deaths with a hunter already within 3 tiles: ${deathsClose} of ${deaths}; of the danger ticks where a killer was one step away, an escape existed ${pct(deathsEscapable, flee.ticks)}`);
  console.log(`  lit ink: ${(power.ticks / episodes).toFixed(0)} ticks per episode, ${power.windows.toFixed(0)} windows per episode, ghosts eaten inside them ${(power.ateInWindow / episodes).toFixed(2)}`);
  return { eat, flee, ghostEaten: ghostEaten / episodes, deaths, deathsClose };
}

analyse("learned (greedy)", (sim, s, m) => ppo.best(s, m), 60);
analyse("random", () => (Math.random() * 4) | 0);
