/* ============================================================
   GAKI — a small hand-rolled MLP: two tanh hidden layers, a
   categorical policy head and a value head, with Adam.  Written
   with plain typed arrays so it runs identically in the browser
   and in node tests.
   ============================================================ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Net {
  /** @param sizes [input, hidden1, hidden2] @param actions policy size */
  constructor(sizes, actions, seed = 20240) {
    this.sizes = sizes;
    this.actions = actions;
    const [s0, s1, s2] = sizes;
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.W1 = new Float32Array(s0 * s1);
    this.b1 = new Float32Array(s1);
    this.W2 = new Float32Array(s1 * s2);
    this.b2 = new Float32Array(s2);
    this.Wp = new Float32Array(s2 * actions);
    this.bp = new Float32Array(actions);
    this.Wv = new Float32Array(s2);
    this.bv = 0;
    this.n = this.W1.length + this.b1.length + this.W2.length + this.b2.length + this.Wp.length + this.bp.length + s2 + 1;
    this.g = { W1: new Float32Array(this.W1.length), b1: new Float32Array(s1), W2: new Float32Array(this.W2.length), b2: new Float32Array(s2), Wp: new Float32Array(this.Wp.length), bp: new Float32Array(actions), Wv: new Float32Array(s2), bv: 0 };
    this.m = { W1: new Float32Array(this.W1.length), b1: new Float32Array(s1), W2: new Float32Array(this.W2.length), b2: new Float32Array(s2), Wp: new Float32Array(this.Wp.length), bp: new Float32Array(actions), Wv: new Float32Array(s2), bv: 0 };
    this.v = { W1: new Float32Array(this.W1.length), b1: new Float32Array(s1), W2: new Float32Array(this.W2.length), b2: new Float32Array(s2), Wp: new Float32Array(this.Wp.length), bp: new Float32Array(actions), Wv: new Float32Array(s2), bv: 0 };
    this.t = 0;
    this.init(seed);
    this.cache = { a1: new Float32Array(s1), a2: new Float32Array(s2), logits: new Float32Array(actions), d1: new Float32Array(s1), d2: new Float32Array(s2) };
  }

  init(seed) {
    const rnd = mulberry32(seed);
    const gauss = () => {
      // Box-Muller
      let u = 0;
      let v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const fill = (arr, fanIn, fanOut) => {
      const s = Math.sqrt(2 / (fanIn + fanOut));
      for (let i = 0; i < arr.length; i++) arr[i] = gauss() * s;
    };
    fill(this.W1, this.s0, this.s1);
    fill(this.W2, this.s1, this.s2);
    fill(this.Wp, this.s2, this.actions);
    fill(this.Wv, this.s2, 1);
    this.b1.fill(0);
    this.b2.fill(0);
    this.bp.fill(0);
    this.bv = 0;
    for (const k of Object.keys(this.g)) this.g[k].fill?.(0);
    for (const k of Object.keys(this.m)) this.m[k].fill?.(0);
    for (const k of Object.keys(this.v)) this.v[k].fill?.(0);
    this.t = 0;
    return this;
  }

  /** Forward one sample; activations are kept in this.cache for the backward pass. */
  forward(x) {
    const { s1, s2, actions } = this;
    const c = this.cache;
    for (let j = 0; j < s1; j++) {
      let s = this.b1[j];
      const base = j * this.s0;
      for (let i = 0; i < this.s0; i++) s += x[i] * this.W1[base + i];
      c.a1[j] = Math.tanh(s);
    }
    for (let j = 0; j < s2; j++) {
      let s = this.b2[j];
      const base = j * s1;
      for (let i = 0; i < s1; i++) s += c.a1[i] * this.W2[base + i];
      c.a2[j] = Math.tanh(s);
    }
    for (let j = 0; j < actions; j++) {
      let s = this.bp[j];
      const base = j * s2;
      for (let i = 0; i < s2; i++) s += c.a2[i] * this.Wp[base + i];
      c.logits[j] = s;
    }
    let v = this.bv;
    for (let i = 0; i < s2; i++) v += c.a2[i] * this.Wv[i];
    c.value = v;
    return c;
  }

  /** Softmax over the legal directions only. Returns logZ and probabilities. */
  softmax(mask, out = this.probBuf || (this.probBuf = new Float32Array(this.actions))) {
    const a = this.cache.logits;
    let max = -Infinity;
    for (let i = 0; i < this.actions; i++) if (mask & (1 << i) && a[i] > max) max = a[i];
    let z = 0;
    for (let i = 0; i < this.actions; i++) {
      if (!(mask & (1 << i))) {
        out[i] = 0;
        continue;
      }
      const e = Math.exp(a[i] - max);
      z += e;
      out[i] = e;
    }
    const lz = Math.log(z) + max;
    for (let i = 0; i < this.actions; i++) out[i] /= z;
    this.logZ = lz;
    this.logMax = max;
    return out;
  }

  logProb(mask, action) {
    this.softmax(mask);
    return this.cache.logits[action] - this.logZ;
  }

  entropy(mask) {
    const p = this.softmax(mask);
    let h = 0;
    for (let i = 0; i < this.actions; i++) if (p[i] > 0) h -= p[i] * Math.log(p[i]);
    return h;
  }

  /** One sample of backprop. dLogits / dValue are the policy-gradient terms. */
  backward(x, dLogits, dValue) {
    const { s0, s1, s2, actions } = this;
    const c = this.cache;
    const g = this.g;

    for (let j = 0; j < actions; j++) {
      const dj = dLogits[j];
      const base = j * s2;
      for (let i = 0; i < s2; i++) g.Wp[base + i] += dj * c.a2[i];
      g.bp[j] += dj;
    }
    // gradient flowing out of the value head and the policy head into a2
    for (let i = 0; i < s2; i++) {
      let d = dValue * this.Wv[i];
      for (let j = 0; j < actions; j++) d += dLogits[j] * this.Wp[j * s2 + i];
      c.d2[i] = d * (1 - c.a2[i] * c.a2[i]);
    }
    for (let i = 0; i < s2; i++) g.Wv[i] += dValue * c.a2[i];
    g.bv += dValue;

    for (let j = 0; j < s2; j++) {
      const dj = c.d2[j];
      const base = j * s1;
      for (let i = 0; i < s1; i++) g.W2[base + i] += dj * c.a1[i];
      g.b2[j] += dj;
    }
    for (let i = 0; i < s1; i++) {
      let d = 0;
      for (let j = 0; j < s2; j++) d += c.d2[j] * this.W2[j * s1 + i];
      c.d1[i] = d * (1 - c.a1[i] * c.a1[i]);
    }
    for (let j = 0; j < s1; j++) {
      const dj = c.d1[j];
      const base = j * s0;
      for (let i = 0; i < s0; i++) g.W1[base + i] += dj * x[i];
      g.b1[j] += dj;
    }
  }

  /** Adam; call once per update after gradients have accumulated. */
  adam(lr, beta1 = 0.9, beta2 = 0.999, eps = 1e-5) {
    this.t++;
    const c1 = 1 - Math.pow(beta1, this.t);
    const c2 = 1 - Math.pow(beta2, this.t);
    const step = (W, g, m, v) => {
      for (let i = 0; i < W.length; i++) {
        const gi = g[i];
        m[i] = beta1 * m[i] + (1 - beta1) * gi;
        v[i] = beta2 * v[i] + (1 - beta2) * gi * gi;
        W[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + eps);
        g[i] = 0;
      }
    };
    step(this.W1, this.g.W1, this.m.W1, this.v.W1);
    step(this.b1, this.g.b1, this.m.b1, this.v.b1);
    step(this.W2, this.g.W2, this.m.W2, this.v.W2);
    step(this.b2, this.g.b2, this.m.b2, this.v.b2);
    step(this.Wp, this.g.Wp, this.m.Wp, this.v.Wp);
    step(this.bp, this.g.bp, this.m.bp, this.v.bp);
    step(this.Wv, this.g.Wv, this.m.Wv, this.v.Wv);
    this.bv -= (lr * (this.g.bv / c1)) / (Math.sqrt(this.g.bv * this.g.bv / c2) + eps);
    this.g.bv = 0;
    return this;
  }

  zeroGrad() {
    for (const k of ["W1", "b1", "W2", "b2", "Wp", "bp", "Wv"]) this.g[k].fill(0);
    this.g.bv = 0;
    return this;
  }

  snapshot() {
    const out = new Float32Array(this.n);
    let o = 0;
    const put = (arr) => {
      out.set(arr, o);
      o += arr.length;
    };
    put(this.W1);
    put(this.b1);
    put(this.W2);
    put(this.b2);
    put(this.Wp);
    put(this.bp);
    put(this.Wv);
    out[o++] = this.bv;
    return out;
  }

  paramCount() {
    return this.n;
  }
}
