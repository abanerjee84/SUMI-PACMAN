/* Headless PPO check: does the hungry ghost actually learn?
   node tools/train-node.mjs [envs] [simSeconds]
*/
import { Sim } from "../src/game/sim.js";
import { PPO } from "../src/rl/ppo.js";
import fs from "fs";

const N = Number(process.argv[2] || 8);
const simSeconds = Number(process.argv[3] || 240) * N; // per-env budget
const STEP = 0.05;

const ppo = new PPO({ stateSize: 52, actions: 4, buffer: 1024, epochs: 4, minibatch: 32, lr: 3e-4, entropyCoef: 0.009 });

function hooks(id) {
  return {
    chooseAction(sim, s, mask) {
      return ppo.act(s, mask);
    },
    valueFn(s2) {
      ppo.net.forward(s2);
      return ppo.net.cache.value;
    },
    onControl(t) {
      if (ppo.store(t.sim.envId ?? id, t.s, t.a, t.mask, t.r, t.logp, t.value, t.valueNext, t.done)) ppo.beginUpdate();
    },
  };
}

const rnd = () => (Math.random() * 2147483647) | 0;
const envs = [];
for (let i = 0; i < N; i++) {
  const e = new Sim(rnd(), hooks(i));
  e.envId = i;
  envs.push(e);
}

const episodes = [];
const times = [];
let simTime = 0;
let wall = Date.now();
let updates = 0;

function mean(arr, n) {
  if (!arr.length) return 0;
  const from = Math.max(0, arr.length - n);
  let s = 0;
  for (let i = from; i < arr.length; i++) s += arr[i];
  return s / (arr.length - from);
}

function finish(e) {
  episodes.push(e.reward);
  times.push(e.time);
  e.reset(rnd());
}

let lastReport = 0;
while (simTime < simSeconds) {
  for (const e of envs) {
    e.advance(STEP);
    simTime += STEP;
    if (e.done) finish(e);
  }
  while (ppo.updating) {
    const s = ppo.trainMinibatches(16);
    if (s) updates++;
  }
  if (episodes.length > 0 && episodes.length >= lastReport + 40) {
    lastReport = episodes.length;
    const st = ppo.stats;
    console.log(
      `ep ${episodes.length} sim ${simTime.toFixed(0)}s | mean50 ${mean(episodes, 50).toFixed(1)} | mean5 ${mean(episodes, 5).toFixed(1)} | best ${Math.max(...episodes).toFixed(0)} | life ${mean(times, 40).toFixed(1)}s | upd ${updates} | pi ${st.policyLoss.toFixed(3)} v ${st.valueLoss.toFixed(2)} ent ${st.entropy.toFixed(3)} kl ${st.kl.toFixed(4)} exp ${(st.explained * 100).toFixed(0)}%`
    );
  }
}

const wallSec = (Date.now() - wall) / 1000;
console.log(`\n${episodes.length} episodes in ${simTime.toFixed(0)} sim-seconds, ${wallSec.toFixed(1)}s wall, ${updates} updates`);
console.log(`first10 mean ${mean(episodes.slice(0, 10), 10).toFixed(1)} · last50 mean ${mean(episodes, 50).toFixed(1)} · best ${Math.max(...episodes).toFixed(0)}`);
fs.writeFileSync("shots/train-curve.json", JSON.stringify({ episodes, times }, null, 1));
console.log("curve -> shots/train-curve.json");
