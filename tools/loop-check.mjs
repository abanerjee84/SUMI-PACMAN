/* Does the agent keep moving, or does it pace in circles?
   Trains a policy, then counts reversals, short-window revisits and the gap
   between pellets for the greedy policy and a random one. */
const { Sim, STATE_SIZE } = await import("../src/game/sim.js");
const { W, H, idx } = await import("../src/game/maze.js");
const { PPO } = await import("../src/rl/ppo.js");
const { tileOf } = await import("../src/game/ghost-brain.js");

const N = Number(process.argv[2] || 12);
const budget = Number(process.argv[3] || 600) * N;
const ppo = new PPO({
  stateSize: STATE_SIZE,
  actions: 4,
  buffer: 1024,
  epochs: 8,
  minibatch: 32,
  lr: 4e-4,
  entropyCoef: 0.03,
  entropyDecay: 0.995,
  klStop: 0.02,
  rewardScale: 0.1,
});

const envs = [];
for (let i = 0; i < N; i++) {
  const sim = new Sim((Math.random() * 2147483647) | 0, {
    chooseAction(s2, s, mask) {
      const out = ppo.act(s, mask);
      return out;
    },
    valueFn(s2) {
      ppo.net.forward(s2);
      return ppo.net.cache.value;
    },
    onControl(t) {
      if (ppo.store(t.sim.envId, t.s, t.a, t.mask, t.r, t.logp, t.value, t.valueNext, t.done)) ppo.beginUpdate();
    },
  });
  sim.envId = i;
  envs.push(sim);
}
let spent = 0;
while (spent < budget) {
  for (const sim of envs) {
    if (spent >= budget) break;
    const dt = 0.05;
    spent += dt;
    sim.advance(dt);
    if (sim.done) {
      sim.reset((Math.random() * 2147483647) | 0);
    }
  }
  if (ppo.updating) ppo.trainMinibatches(2);
}
console.log(`trained ${ppo.stats.updates} updates on ${ppo.stats.episodes} episodes`);

function measure(label, chooser, episodes = 40) {
  const sim = new Sim((Math.random() * 2147483647) | 0, { chooseAction: chooser });
  let ticks = 0, reversals = 0, revisits = 0, sinceFood = 0, staleTicks = 0, twice = 0, life = 0, pel = 0;
  for (let e = 0; e < episodes; e++) {
    const seen = new Map();
    const recent = [];
    let j = 0;
    let lastFoodTick = 0;
    while (!sim.done && j < 12000) {
      const before = sim.pelletsEaten;
      sim.advance(0.1);
      j++;
      ticks++;
      const t = tileOf(sim.pacman);
      const now = idx(t.x, t.y);
      if (sim.pacman.dir === sim.pendingDir) reversals++;
      recent.push(now);
      if (recent.length > 8) recent.shift();
      let rep = 0;
      for (let k = 0; k < recent.length - 1; k++) if (recent[k] === now) rep++;
      revisits += rep;
      seen.set(now, (seen.get(now) || 0) + 1);
      if (sim.pelletsEaten > before) {
        sinceFood += j - lastFoodTick;
        lastFoodTick = j;
      } else if (j - lastFoodTick > 14) staleTicks++;
    }
    for (const v of seen.values()) if (v > 1) twice++;
    life += sim.time;
    pel += sim.pelletsEaten;
    sim.reset((Math.random() * 2147483647) | 0);
  }
  console.log(
    `${label}: life ${life.toFixed(0)}s | pellets ${pel.toFixed(0)} | reversals ${((reversals / ticks) * 100).toFixed(1)}%` +
      ` | revisits-in-8 ${revisits} (${(revisits / episodes).toFixed(1)} per episode) | idle>14 ticks ${((100 * staleTicks) / ticks).toFixed(0)}%` +
      ` | tiles visited twice ${(twice / episodes).toFixed(1)}`
  );
}

// pendingDir is not exposed; wrap to record the direction before the tick
function wrap(chooser) {
  return (sim, s, mask) => {
    sim.pendingDir = sim.pacman.dir;
    return chooser(sim, s, mask);
  };
}
measure("learned greedy", wrap((sim, s, mask) => ppo.best(s, mask)));
measure("learned policy", wrap((sim, s, mask) => ppo.act(s, mask)));
measure("random      ", wrap(() => (Math.random() * 4) | 0));
measure("pure chase  ", wrap((sim) => {
  // always step towards the nearest pellet: the greedy-food baseline
  const grid = sim.maze.grid;
  const t = tileOf(sim.pacman);
  let best = -1, bd = 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[idx(x, y)] !== 0) continue;
    const d = Math.abs(x - t.x) + Math.abs(y - t.y);
    if (d < bd) { bd = d; best = (x > t.x ? 0 : x < t.x ? 1 : y > t.y ? 3 : 2); }
  }
  return best;
}));
