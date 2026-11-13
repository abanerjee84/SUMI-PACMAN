/* ============================================================
   GAKI — PPO: clipped surrogate objective, GAE(λ) advantages,
   Adam, a categorical policy over the four legal directions.
   Rollouts are double-buffered so collection never stops while
   the update is spread across frames.
   ============================================================ */

import { Net } from "./net.js";

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBuffer(B, S) {
  return {
    states: new Float32Array(B * S),
    actions: new Uint8Array(B),
    masks: new Uint8Array(B),
    logp: new Float32Array(B),
    values: new Float32Array(B),
    valuesNext: new Float32Array(B),
    rewards: new Float32Array(B),
    dones: new Uint8Array(B),
    envIds: new Int32Array(B),
    returns: new Float32Array(B),
    adv: new Float32Array(B),
    n: 0,
  };
}

export class PPO {
  constructor(opts = {}) {
    this.stateSize = opts.stateSize || 60;
    this.actions = opts.actions || 4;
    this.gamma = opts.gamma ?? 0.99;
    this.lambda = opts.lambda ?? 0.95;
    this.clip = opts.clip ?? 0.2;
    this.epochs = opts.epochs ?? 8;
    this.minibatch = opts.minibatch ?? 32;
    this.lr = opts.lr ?? 5e-4;
    this.valueCoef = opts.valueCoef ?? 0.5;
    this.entropyCoef = opts.entropyCoef ?? 0.009;
    this.entropyFloor = opts.entropyFloor ?? 0.002;
    this.entropyDecay = opts.entropyDecay ?? 1;
    this.klStop = opts.klStop ?? 0.02;
    this.bufferSize = opts.buffer ?? 1024;
    // arcade scores are big; the critic learns better on a smaller scale
    this.rewardScale = opts.rewardScale ?? 0.1;

    this.net = new Net([this.stateSize, opts.hidden0 || 96, opts.hidden1 || 48], this.actions, opts.seed ?? 7331);
    this.rng = rng32(opts.agentSeed ?? 991);

    this.cur = makeBuffer(this.bufferSize, this.stateSize);
    this.old = makeBuffer(this.bufferSize, this.stateSize);
    this.ptr = 0;

    this.order = [];
    this.cursor = 0;
    this.epoch = 0;
    this.updating = false;
    this.stats = { policyLoss: 0, valueLoss: 0, entropy: 0, kl: 0, clipFrac: 0, explained: 0, updates: 0, samples: 0, advVar: 0 };
    this.dLogits = new Float32Array(this.actions);
    this.xbuf = new Float32Array(this.stateSize);
    this.acc = { policy: 0, value: 0, entropy: 0, kl: 0, clip: 0, n: 0 };
  }

  /* ---------------- acting ---------------- */

  act(state, mask) {
    this.net.forward(state);
    const p = this.net.softmax(mask);
    let r = this.rng();
    let a = 0;
    for (let i = 0; i < this.actions; i++) {
      if (r < p[i]) {
        a = i;
        break;
      }
      r -= p[i];
    }
    if (!(mask & (1 << a))) {
      for (let i = 0; i < this.actions; i++) {
        if (mask & (1 << i)) {
          a = i;
          break;
        }
      }
    }
    return { a, logp: this.net.logProb(mask, a), value: this.net.cache.value, probs: Array.from(p) };
  }

  /** The argmax action: how the visible ghost behaves once it knows things. */
  best(state, mask) {
    this.net.forward(state);
    const p = this.net.softmax(mask);
    let a = -1;
    let bv = -1;
    for (let i = 0; i < this.actions; i++) {
      if (mask & (1 << i) && p[i] > bv) {
        bv = p[i];
        a = i;
      }
    }
    return { a: a < 0 ? 0 : a, logp: this.net.logProb(mask, a < 0 ? 0 : a), value: this.net.cache.value, probs: Array.from(p) };
  }

  /* ---------------- collecting ---------------- */

  store(envId, s, a, mask, r, logp, value, valueNext, done) {
    const b = this.cur;
    const i = b.n;
    // a full buffer is a real signal: the caller must swap it, or collection
    // stalls with a full buffer and no update ever coming
    if (i >= this.bufferSize) return true;
    b.states.set(s.subarray(0, this.stateSize), i * this.stateSize);
    b.actions[i] = a;
    b.masks[i] = mask;
    b.logp[i] = logp;
    b.values[i] = value;
    b.valuesNext[i] = valueNext;
    b.rewards[i] = r * this.rewardScale;
    b.dones[i] = done ? 1 : 0;
    b.envIds[i] = envId;
    b.n++;
    this.ptr = b.n;
    return b.n >= this.bufferSize;
  }

  fillRatio() {
    return this.cur.n / this.bufferSize;
  }

  /* ---------------- advantage estimation ---------------- */

  computeReturns(buf) {
    const n = buf.n;
    const byEnv = new Map();
    for (let i = 0; i < n; i++) {
      const e = buf.envIds[i];
      let list = byEnv.get(e);
      if (!list) byEnv.set(e, (list = []));
      list.push(i);
    }
    const g = this.gamma;
    const l = this.lambda;
    for (const list of byEnv.values()) {
      let adv = 0;
      for (let k = list.length - 1; k >= 0; k--) {
        const i = list[k];
        const alive = buf.dones[i] ? 0 : 1;
        const delta = buf.rewards[i] + g * buf.valuesNext[i] * alive - buf.values[i];
        adv = delta + g * l * alive * adv;
        buf.adv[i] = adv;
        buf.returns[i] = adv + buf.values[i];
      }
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += buf.adv[i];
    mean /= Math.max(1, n);
    let varc = 0;
    for (let i = 0; i < n; i++) {
      const d = buf.adv[i] - mean;
      varc += d * d;
    }
    varc /= Math.max(1, n);
    const inv = 1 / Math.sqrt(varc + 1e-6);
    for (let i = 0; i < n; i++) buf.adv[i] = (buf.adv[i] - mean) * inv;
    this.stats.advVar = varc;

    let dVar = 0;
    let rVar = 0;
    let rMean = 0;
    for (let i = 0; i < n; i++) rMean += buf.returns[i];
    rMean /= Math.max(1, n);
    for (let i = 0; i < n; i++) {
      dVar += (buf.returns[i] - buf.values[i]) ** 2;
      rVar += (buf.returns[i] - rMean) ** 2;
    }
    dVar /= Math.max(1, n);
    rVar /= Math.max(1, n);
    this.stats.explained = rVar > 1e-8 ? 1 - dVar / rVar : 0;
    return this;
  }

  beginUpdate() {
    if (this.updating) return this; // an update is already in flight; keep collecting
    const buf = this.cur;
    this.computeReturns(buf);
    this.order = Array.from({ length: buf.n }, (_, i) => i);
    this.shuffle();
    this.epoch = 0;
    this.cursor = 0;
    this.updating = true;
    this.acc = { policy: 0, value: 0, entropy: 0, kl: 0, clip: 0, n: 0 };
    // collection carries on into the other buffer
    this.cur = this.old;
    this.old = buf;
    this.cur.n = 0;
    this.ptr = 0;
    return this;
  }

  shuffle() {
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = this.order[i];
      this.order[i] = this.order[j];
      this.order[j] = t;
    }
  }

  /** Run `count` minibatches; call it a couple of times per frame. */
  trainMinibatches(count = 2) {
    if (!this.updating) return null;
    for (let c = 0; c < count; c++) {
      if (this.cursor >= this.order.length) {
        this.cursor = 0;
        this.epoch++;
        if (this.epoch >= this.epochs) return this.finishUpdate();
        if (this.acc.n && this.acc.kl / this.acc.n > this.klStop) return this.finishUpdate();
        this.shuffle();
      }
      const end = Math.min(this.order.length, this.cursor + this.minibatch);
      this.runMinibatch(this.old, this.order.slice(this.cursor, end));
      this.cursor = end;
    }
    return null;
  }

  runMinibatch(buf, idx) {
    const net = this.net;
    const A = this.actions;
    const dL = this.dLogits;
    net.zeroGrad();
    let pol = 0;
    let val = 0;
    let ent = 0;
    let kl = 0;
    let clipped = 0;
    for (const i of idx) {
      const s = buf.states.subarray(i * this.stateSize, i * this.stateSize + this.stateSize);
      const c = net.forward(s);
      const p = net.softmax(buf.masks[i]);
      const a = buf.actions[i];
      const logpNew = c.logits[a] - net.logZ;
      const ratio = Math.exp(logpNew - buf.logp[i]);
      const adv = buf.adv[i];
      const unclipped = ratio * adv;
      const clippedV = Math.max(1 - this.clip, Math.min(1 + this.clip, ratio)) * adv;
      const useUnclipped = unclipped <= clippedV;
      pol += -Math.min(unclipped, clippedV);
      val += 0.5 * (c.value - buf.returns[i]) ** 2;
      kl += ratio - 1 - logpNew + buf.logp[i];
      if (!useUnclipped) clipped++;

      let h = 0;
      let elp = 0;
      for (let k = 0; k < A; k++) {
        if (p[k] > 0) {
          const lp = Math.log(p[k]);
          h -= p[k] * lp;
          elp += p[k] * lp;
        }
      }
      ent += h;

      for (let k = 0; k < A; k++) {
        let g = 0;
        // the loss is -objective, so this is the negative of ∂(ratio·A)/∂logit
        if (useUnclipped) g -= adv * ratio * ((k === a ? 1 : 0) - p[k]);
        // loss carries -entropyCoef * H, so its gradient is +coef * p(log p - E[log p])
        if (p[k] > 0) g += this.entropyCoef * p[k] * (Math.log(p[k]) - elp);
        dL[k] = g;
      }
      net.backward(s, dL, (c.value - buf.returns[i]) * this.valueCoef);
    }
    const n = Math.max(1, idx.length);
    net.adam(this.lr);
    this.acc.policy += pol / n;
    this.acc.value += val / n;
    this.acc.entropy += ent / n;
    this.acc.kl += kl / n;
    this.acc.clip += clipped / n;
    this.acc.n++;
  }

  finishUpdate() {
    this.entropyCoef = Math.max(this.entropyFloor, this.entropyCoef * this.entropyDecay);
    const n = Math.max(1, this.acc.n);
    this.stats.policyLoss = this.acc.policy / n;
    this.stats.valueLoss = this.acc.value / n;
    this.stats.entropy = this.acc.entropy / n;
    this.stats.kl = this.acc.kl / n;
    this.stats.clipFrac = this.acc.clip / n;
    this.stats.updates++;
    this.stats.samples = this.old.n;
    this.updating = false;
    return this.stats;
  }
}
