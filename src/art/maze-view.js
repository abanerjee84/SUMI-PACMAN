/* ============================================================
   GAKI — the maze painted as brush strokes.  Every wall edge
   facing a corridor becomes a stroke that tapers at both ends,
   born in a diagonal sweep, dissolving into speckles at the
   end of a round.
   ============================================================ */

import * as THREE from "three";
import { W, H, WALL, FLOOR, idx } from "../game/maze.js";

export function tileX(x) {
  return x - (W - 1) / 2;
}
export function tileY(y) {
  return -(y - (H - 1) / 2);
}

const INK_V = /* glsl */ `
attribute float aOrder;
attribute float aLocal;
attribute float aAlpha;
attribute float aWash;
attribute float aSide;
attribute float aHalf;
attribute vec2 aAxis;
attribute float aRepeat;
varying vec2 vUv;
varying float vAlpha;
varying float vWash;
varying float vOrder;
varying float vLocal;
varying vec2 vPos;
void main() {
  // full width through the run, pinched only at the very ends where a brush
  // lifts off the paper
  float e = clamp(min(aLocal, 1.0 - aLocal), 0.0, 1.0);
  float taper = mix(0.66, 1.0, smoothstep(0.0, 0.26, e));
  vec2 perp = vec2(-aAxis.y, aAxis.x);
  vec2 p = position.xy + perp * aSide * aHalf * taper;
  p += aAxis * (sin(aLocal * 6.0 + aOrder * 11.0) * 0.015);
  vUv = vec2(aLocal * aRepeat + aOrder * 0.37, 0.5 + aSide * 0.46);
  vAlpha = aAlpha;
  vWash = aWash;
  vOrder = aOrder;
  vLocal = aLocal;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, p.y, 0.0, 1.0);
}
`;

const INK_F = /* glsl */ `
uniform sampler2D uInk;
uniform float uReveal;
uniform float uDissolve;
uniform vec3 uInkColor;
uniform vec3 uWashColor;
varying vec2 vUv;
varying float vAlpha;
varying float vWash;
varying float vOrder;
varying float vLocal;
varying vec2 vPos;
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 t = texture2D(uInk, vUv);
  float paint = clamp((uReveal * 1.25 - vOrder) * 3.2, 0.0, 1.0);
  float edge = smoothstep(paint + 0.06, paint - 0.06, vLocal);
  // the stroke breaks into scattered speckles, not shredded strips
  float n = hash2(floor(vPos * 5.0) + vec2(vOrder * 7.0, vOrder * 3.0));
  float dis = 1.0 - smoothstep(n - 0.12, n + 0.12, uDissolve);
  float a = t.a * vAlpha * edge * dis;
  if (a < 0.004) discard;
  vec3 col = mix(uWashColor, uInkColor, vWash);
  gl_FragColor = vec4(col, a);
}
`;

/**
 * Wall edges -> strokes.  A stroke runs along the side of a wall tile that
 * faces a corridor, so a one-tile wall gets the classic double line and a
 * solid block gets an outline.
 */
function collectStrokes(grid) {
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[idx(x, y)] === FLOOR;
  const horizontal = new Map();
  const vertical = new Map();
  const addRun = (map, key, a, b) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    const last = list[list.length - 1];
    if (last && b === last[1] + 1) last[1] = b;
    else list.push([a, b]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[idx(x, y)] !== WALL) continue;
      if (isFloor(x, y + 1)) addRun(horizontal, `h${y}b`, x, x);
      if (isFloor(x, y - 1)) addRun(horizontal, `h${y}t`, x, x);
      if (isFloor(x + 1, y)) addRun(vertical, `v${x}r`, y, y);
      if (isFloor(x - 1, y)) addRun(vertical, `v${x}l`, y, y);
    }
  }
  return { horizontal, vertical };
}

function hashRun(key, i) {
  let h = 0;
  for (let k = 0; k < key.length; k++) h = (h * 31 + key.charCodeAt(k)) | 0;
  return (h ^ (i * 977)) >>> 0;
}

function hash(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function decodeH(key) {
  const m = /^h(\d+)([bt])$/.exec(key);
  const y = Number(m[1]);
  return { y, off: m[2] === "b" ? 0.34 : -0.34 };
}

function decodeV(key) {
  const m = /^v(\d+)([lr])$/.exec(key);
  const x = Number(m[1]);
  return { x, off: m[2] === "r" ? 0.34 : -0.34 };
}

function strokeOrder(axis, key, from, to) {
  const a = axis === "h" ? decodeH(key) : decodeV(key);
  const cx = axis === "h" ? (from + to) / 2 : a.x;
  const cy = axis === "h" ? a.y : (from + to) / 2;
  const t = (cx + cy) / (W + H);
  return Math.min(1, Math.max(0, t * 0.82 + hash(hashRun(key, from)) * 0.18));
}

export class MazeView {
  constructor(inkTex, opts = {}) {
    this.group = new THREE.Group();
    this.mesh = null;
    this.uniforms = {
      uInk: { value: inkTex },
      uReveal: { value: 0 },
      uDissolve: { value: 0 },
      uInkColor: { value: new THREE.Color(opts.inkColor || "#100c09") },
      uWashColor: { value: new THREE.Color(opts.washColor || "#3b342b") },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: INK_V,
      fragmentShader: INK_F,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }

  build(maze) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const { horizontal, vertical } = collectStrokes(maze.grid);
    const pos = [];
    const side = [];
    const half = [];
    const axis = [];
    const local = [];
    const order = [];
    const alpha = [];
    const wash = [];
    const repeat = [];
    const index = [];

    const emit = (axisDir, p0, p1, ord, halfW, a, isWash, rep, segs) => {
      const ax = axisDir === "h" ? [1, 0] : [0, 1];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy) || 1;
      // each segment overlaps its neighbour so the transparent rasteriser
      // cannot leave a hairline of bare paper at the shared edge
      const ov = Math.min(0.06 / len, 0.45 / segs);
      for (let i = 0; i < segs; i++) {
        const tl = Math.max(0, i / segs - ov);
        const tr = Math.min(1, (i + 1) / segs + ov);
        const base = pos.length / 3;
        for (const t of [tl, tr]) {
          const x = p0[0] + dx * t;
          const y = p0[1] + dy * t;
          pos.push(x, y, 0, x, y, 0);
          side.push(-1, 1);
          half.push(halfW, halfW);
          local.push(t, t);
          for (let k = 0; k < 2; k++) {
            axis.push(ax[0], ax[1]);
            order.push(ord);
            alpha.push(a);
            wash.push(isWash ? 1 : 0);
            repeat.push(rep);
          }
        }
        index.push(base, base + 1, base + 3, base, base + 3, base + 2);
      }
    };

    const emitStroke = (kind, key, from, to, seed) => {
      const len = to - from + 1;
      const jitter = (hash(seed) - 0.5) * 0.05;
      const halfW = 0.125 + hash(seed + 3) * 0.055;
      const ord = strokeOrder(kind, key, from, to);
      // the grain repeats about every three tiles, never per tile
      const rep = Math.max(0.55, len / 2.6 + hash(seed + 11) * 0.3);
      const segs = Math.min(26, Math.max(3, Math.round(len * 3)));
      let p0;
      let p1;
      if (kind === "h") {
        const { y, off } = decodeH(key);
        const cy = tileY(y) + off + jitter;
        p0 = [tileX(from) - 0.4, cy];
        p1 = [tileX(to) + 0.4, cy];
      } else {
        const { x, off } = decodeV(key);
        const cx = tileX(x) + off + jitter;
        p0 = [cx, tileY(to) - 0.4];
        p1 = [cx, tileY(from) + 0.4];
      }
      emit(kind, p0, p1, ord, halfW, 1.0, true, rep, segs);
      emit(kind, p0, p1, ord - 0.06, halfW * 1.7, 0.05, false, rep * 0.6, Math.max(2, Math.round(segs / 2)));
    };

    for (const [key, runs] of horizontal) for (let i = 0; i < runs.length; i++) emitStroke("h", key, runs[i][0], runs[i][1], hashRun(key, i));
    for (const [key, runs] of vertical) for (let i = 0; i < runs.length; i++) emitStroke("v", key, runs[i][0], runs[i][1], hashRun(key, i));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    geo.setAttribute("aHalf", new THREE.Float32BufferAttribute(half, 1));
    geo.setAttribute("aAxis", new THREE.Float32BufferAttribute(axis, 2));
    geo.setAttribute("aLocal", new THREE.Float32BufferAttribute(local, 1));
    geo.setAttribute("aOrder", new THREE.Float32BufferAttribute(order, 1));
    geo.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alpha, 1));
    geo.setAttribute("aWash", new THREE.Float32BufferAttribute(wash, 1));
    geo.setAttribute("aRepeat", new THREE.Float32BufferAttribute(repeat, 1));
    geo.setIndex(index);
    geo.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    return this;
  }

  setReveal(v) {
    this.uniforms.uReveal.value = v;
    return this;
  }

  setDissolve(v) {
    this.uniforms.uDissolve.value = v;
    return this;
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------- pellets: small ink dots ---------------- */

const FOOD_V = /* glsl */ `
attribute float aAlive;
attribute float aOrder;
varying float vAlive;
varying float vOrder;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlive = aAlive;
  vOrder = aOrder;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FOOD_F = /* glsl */ `
uniform sampler2D uDot;
uniform float uReveal;
uniform float uDissolve;
uniform float uTime;
uniform vec3 uColor;
varying float vAlive;
varying float vOrder;
varying vec2 vUv;
float hash(float n) { return fract(sin(n * 91.3) * 27193.11); }
void main() {
  vec4 t = texture2D(uDot, vUv);
  float born = clamp((uReveal * 1.25 - vOrder) * 4.5, 0.0, 1.0);
  float pulse = 0.86 + 0.14 * sin(uTime * 2.4 + vOrder * 40.0);
  float n = hash(vOrder * 33.0);
  float dis = 1.0 - smoothstep(n - 0.12, n + 0.12, uDissolve);
  float a = t.a * born * pulse * vAlive * dis;
  if (a < 0.005) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class FoodView {
  constructor(dotTex) {
    this.group = new THREE.Group();
    this.uniforms = {
      uDot: { value: dotTex },
      uReveal: { value: 0 },
      uDissolve: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#1a1410") },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FOOD_V,
      fragmentShader: FOOD_F,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = null;
    this.aliveAttr = null;
    this.slot = new Map();
    this.fading = [];
  }

  build(maze) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.slot.clear();
    this.fading = [];
    const pos = [];
    const uv = [];
    const alive = [];
    const order = [];
    const index = [];
    const R = 0.13;
    let quad = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (maze.pellets[i] !== 1) continue;
        const cx = tileX(x);
        const cy = tileY(y);
        const base = quad * 4;
        pos.push(cx - R, cy - R, 0, cx + R, cy - R, 0, cx + R, cy + R, 0, cx - R, cy + R, 0);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        const ord = ((x + y) / (W + H)) * 0.82 + Math.random() * 0.18;
        for (let k = 0; k < 4; k++) {
          alive.push(1);
          order.push(ord);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.slot.set(i, base);
        quad++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("aAlive", new THREE.Float32BufferAttribute(alive, 1));
    geo.setAttribute("aOrder", new THREE.Float32BufferAttribute(order, 1));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    this.aliveAttr = geo.getAttribute("aAlive");
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    return this;
  }

  markEaten(tile) {
    const base = this.slot.get(tile);
    if (base === undefined) return;
    this.fading.push({ base, t: 0 });
    this.slot.delete(tile);
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    if (this.fading.length) {
      const arr = this.aliveAttr.array;
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const f = this.fading[i];
        f.t += dt * 5.5;
        const v = Math.max(0, 1 - f.t);
        for (let k = 0; k < 4; k++) arr[f.base + k] = v;
        if (f.t >= 1) this.fading.splice(i, 1);
      }
      this.aliveAttr.needsUpdate = true;
    }
    return this;
  }

  setReveal(v) {
    this.uniforms.uReveal.value = v;
    return this;
  }

  setDissolve(v) {
    this.uniforms.uDissolve.value = v;
    return this;
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------- the lit ink: enso rings ---------------- */

export class PowerView {
  constructor(ensoTex) {
    this.group = new THREE.Group();
    this.meshes = [];
    this.dying = [];
    this.revealScale = 0;
    this.material = new THREE.MeshBasicMaterial({
      map: ensoTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      color: new THREE.Color("#14100c"),
    });
  }

  build(maze) {
    for (const m of this.meshes) this.group.remove(m);
    this.meshes = [];
    this.dying = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (maze.pellets[i] !== 2) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75), this.material);
        m.position.set(tileX(x), tileY(y), 0);
        m.renderOrder = 1;
        m.userData.tile = i;
        m.userData.spin = Math.random() * Math.PI * 2;
        this.meshes.push(m);
        this.group.add(m);
      }
    }
    return this;
  }

  markEaten(tile) {
    const m = this.meshes.find((k) => k.userData.tile === tile);
    if (!m) return;
    this.dying.push({ m, t: 0 });
  }

  update(dt, time) {
    for (const m of this.meshes) {
      if (m.userData.dead) continue;
      m.rotation.z = m.userData.spin + time * 0.5;
      const s = 1 + 0.1 * Math.sin(time * 2.2 + m.userData.spin);
      m.scale.setScalar(s * this.revealScale);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt * 2.6;
      d.m.scale.setScalar(Math.max(0.001, (1 + d.t * 1.8) * this.revealScale));
      d.m.visible = d.t < 1;
      if (d.t >= 1) {
        d.m.userData.dead = true;
        d.m.visible = false;
        this.dying.splice(i, 1);
      }
    }
    return this;
  }

  setReveal(v) {
    this.revealScale = Math.min(1, Math.max(0, v * 1.6));
    this.material.opacity = Math.min(1, v * 1.4);
    return this;
  }

  setDissolve(v) {
    this.material.opacity = Math.max(0, 1 - v) * 0.92;
    return this;
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}
