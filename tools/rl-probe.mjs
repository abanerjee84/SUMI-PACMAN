/* Training probe: train, then compare the trained policy against a random one.
   node tools/rl-probe.mjs [envs] [secondsPerEnv]
*/
const N = Number(process.argv[2] || 8);
const budget = Number(process.argv[3] || 600) * N;
const reportEvery = Number(process.argv[4] || 60);

const { Sim, STATE_SIZE } = await import("../src/game/sim.js");
const { PPO } = await import("../src/rl/ppo.js");

const ppo = new PPO({
  stateSize: STATE_SIZE,
  actions: 4,
  buffer: 1024,
  epochs: 8,
  minibatch: 32,
  lr: 5e-4,
  entropyCoef: Number(process.env.ENT ?? 0.03),
  entropyDecay: Number(process.env.ENT_DECAY ?? 0.995),
  epochs: Number(process.env.EPOCHS ?? 4),
  lr: Number(process.env.LR ?? 2.5e-4),
  klStop: Number(process.env.KL ?? 0.02),
});

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

const rnd = () => (Math.random() * 2147483647) | 0;
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
let last = 0;
let updates = 0;
while (t < budget) {
  for (const e of envs) {
    e.advance(0.05);
    t += 0.05;
    if (e.done) {
      eps.push({ r: e.reward, time: e.time, pel: e.pelletsEaten, gh: e.ghostsEaten, pow: e.powerWindows });
      e.reset(rnd());
    }
  }
  while (ppo.updating) {
    const s = ppo.trainMinibatches(32);
    if (s) updates++;
  }
  if (eps.length >= last + reportEvery) {
    last = eps.length;
    const st = ppo.stats;
    console.log(
      `ep ${eps.length} env-s ${t.toFixed(0)} | rew50 ${mean(eps, (x) => x.r, 50).toFixed(0)} rew10 ${mean(eps, (x) => x.r, 10).toFixed(0)} | pel50 ${mean(eps, (x) => x.pel, 50).toFixed(1)} | life ${mean(eps, (x) => x.time, 50).toFixed(1)} | gh ${mean(eps, (x) => x.gh, 50).toFixed(2)} | upd ${updates} ent ${st.entropy.toFixed(3)} kl ${st.kl.toFixed(4)} exp ${(st.explained * 100).toFixed(0)}% v ${st.valueLoss.toFixed(2)}`
    );
  }
}

function evaluate(label, chooser, episodes = 12) {
  const e = new Sim(rnd(), { chooseAction: (sim, s, mask) => chooser(s, mask) });
  e.envId = 99;
  const out = [];
  for (let k = 0; k < episodes; k++) {
    let j = 0;
    while (!e.done && j < 12000) {
      e.advance(0.05);
      j++;
    }
    out.push({ r: e.reward, time: e.time, pel: e.pelletsEaten, gh: e.ghostsEaten });
    e.reset(rnd());
  }
  console.log(
    `${label}: reward ${mean(out, (x) => x.r, episodes).toFixed(0)} | pellets ${mean(out, (x) => x.pel, episodes).toFixed(1)} | life ${mean(out, (x) => x.time, episodes).toFixed(1)} | ghosts ${mean(out, (x) => x.gh, episodes).toFixed(2)} | best ${Math.max(...out.map((x) => x.r)).toFixed(0)}`
  );
  return out;
}

console.log(`\ntrained on ${eps.length} episodes, ${updates} updates`);
evaluate("greedy ", (s, m) => ppo.best(s, m));
evaluate("stochastic", (s, m) => ppo.act(s, m));
evaluate("random ", () => ({ a: (Math.random() * 4) | 0 }));
evaluate("stay   ", (s, m) => {
  for (let a = 0; a < 4; a++) if (m & (1 << a)) return { a };
  return { a: 0 };
});
// a hand-written rule that reads the same state: chase the food field, dodge the
// hunters.  It is a ceiling check on what this state can express.
function scripted(sim, s, m) {
  const foodDir = -1;
  // features layout: 0..3 open, 4..7 dir, 8..11 food dir one-hot, 12 food dist
  let best = -1;
  for (let d = 0; d < 4; d++) if (s[8 + d] > 0.5) best = d;
  const danger = [s[38], s[39], s[40], s[41]];
  let pick = best >= 0 && m & (1 << best) ? best : -1;
  if (pick >= 0 && danger[pick] < 0.25) {
    let alt = -1;
    let bd = danger[pick];
    for (let d = 0; d < 4; d++)
      if (m & (1 << d) && danger[d] > bd + 0.2) {
        bd = danger[d];
        alt = d;
      }
    if (alt >= 0) pick = alt;
  }
  if (pick < 0) for (let d = 0; d < 4; d++) if (m & (1 << d)) { pick = d; break; }
  return { a: pick };
}
// the chooser signature is (state, mask); grab the sim through a closure set by the sim hook
let lastSim = null;
const e2 = new Sim(rnd(), { chooseAction: (sim, s, m) => { lastSim = sim; return scripted(sim, s, m); } });
{
  e2.envId = 98;
  const out = [];
  for (let k = 0; k < 12; k++) {
    let j = 0;
    while (!e2.done && j < 12000) { e2.advance(0.05); j++; }
    out.push({ r: e2.reward, time: e2.time, pel: e2.pelletsEaten, gh: e2.ghostsEaten });
    e2.reset(rnd());
  }
  console.log(
    `scripted: reward ${mean(out, (x) => x.r, out.length).toFixed(0)} | pellets ${mean(out, (x) => x.pel, out.length).toFixed(1)} | life ${mean(out, (x) => x.time, out.length).toFixed(1)} | ghosts ${mean(out, (x) => x.gh, out.length).toFixed(2)}`
  );
}
