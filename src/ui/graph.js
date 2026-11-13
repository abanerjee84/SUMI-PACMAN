/* ============================================================
   GAKI — the reward curve, drawn like a record of the run:
   episodes as pale dots, the moving average as a brush line.
   ============================================================ */

export class RewardGraph {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.episodes = []; // raw episode rewards
    this.avg = []; // moving average
    this.window = opts.window || 50;
    this.maxPoints = opts.maxPoints || 400;
    this.pad = { l: 10, r: 10, t: 10, b: 14 };
  }

  add(reward) {
    this.episodes.push(reward);
    const n = this.episodes.length;
    const from = Math.max(0, n - this.window);
    let s = 0;
    for (let i = from; i < n; i++) s += this.episodes[i];
    this.avg.push(s / (n - from));
    if (this.episodes.length > this.maxPoints) {
      // keep resolution at the end of the run by thinning the start
      const drop = Math.ceil(this.maxPoints * 0.15);
      this.episodes.splice(0, drop);
      this.avg.splice(0, drop);
    }
    this.draw();
    return this.avg[this.avg.length - 1];
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 260;
    const h = this.canvas.clientHeight || 120;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.draw();
    }
  }

  draw() {
    this.resize();
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = W / (this.canvas.clientWidth || W);
    g.clearRect(0, 0, W, H);

    const n = this.episodes.length;
    if (!n) return;

    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.avg) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (const v of this.episodes) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1) {
      hi = lo + 1;
    }
    const padL = this.pad.l * dpr;
    const padR = this.pad.r * dpr;
    const padT = this.pad.t * dpr;
    const padB = this.pad.b * dpr;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const X = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    // zero line
    if (lo < 0 && hi > 0) {
      g.strokeStyle = "rgba(60,52,44,0.28)";
      g.lineWidth = 1 * dpr;
      g.setLineDash([3 * dpr, 4 * dpr]);
      g.beginPath();
      g.moveTo(padL, Y(0));
      g.lineTo(W - padR, Y(0));
      g.stroke();
      g.setLineDash([]);
    }

    // episodes as pale ink dots
    for (let i = 0; i < n; i++) {
      const v = this.episodes[i];
      const neg = v < 0;
      g.fillStyle = neg ? "rgba(150,52,42,0.30)" : "rgba(40,34,28,0.22)";
      g.beginPath();
      g.arc(X(i), Y(v), 1.5 * dpr, 0, Math.PI * 2);
      g.fill();
    }

    // the moving average as a brush stroke
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = "rgba(26,21,17,0.28)";
    g.lineWidth = 5 * dpr;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = X(i);
      const y = Y(this.avg[i]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = "rgba(24,19,15,0.9)";
    g.lineWidth = 1.8 * dpr;
    g.stroke();

    // the current value, marked
    const lx = X(n - 1);
    const ly = Y(this.avg[n - 1]);
    g.fillStyle = "#a8322a";
    g.beginPath();
    g.arc(lx, ly, 3.2 * dpr, 0, Math.PI * 2);
    g.fill();

    g.font = `${10 * dpr}px "Zen Kaku Gothic New", sans-serif`;
    g.fillStyle = "rgba(60,52,44,0.75)";
    g.fillText(hi.toFixed(0), padL, padT + 9 * dpr);
    g.fillText(lo.toFixed(0), padL, H - padB - 2 * dpr);
  }
}
