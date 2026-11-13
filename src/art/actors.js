/* ============================================================
   GAKI — the actors: a brushed Pac-Man wedge, four painted
   hunters, and ink that throws itself when something dies.
   ============================================================ */

import * as THREE from "three";
import { tileX, tileY } from "./maze-view.js";

const SEG = 26;

const WEDGE_V = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WEDGE_F = /* glsl */ `
uniform sampler2D uInk;
uniform vec3 uColor;
uniform vec3 uLitColor;
uniform float uLit;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uInk, vUv);
  float a = t.a * uAlpha;
  if (a < 0.01) discard;
  vec3 c = mix(uColor, uLitColor, uLit);
  gl_FragColor = vec4(c, a);
}
`;

export class PacView {
  constructor(inkTex) {
    const count = SEG + 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    const idx = [];
    for (let i = 0; i < SEG - 1; i++) idx.push(0, i + 1, i + 2);
    geo.setIndex(idx);
    this.geo = geo;
    this.uniforms = {
      uInk: { value: inkTex },
      uColor: { value: new THREE.Color("#1c1712") },
      uLitColor: { value: new THREE.Color("#a8322a") },
      uLit: { value: 0 },
      uAlpha: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WEDGE_V,
      fragmentShader: WEDGE_F,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 6;
    this.radius = 0.62;
  }

  update(pac, dt, time, opts = {}) {
    const mouth = opts.mouth ?? 0.55;
    const half = mouth * 0.5;
    const pos = this.geo.attributes.position.array;
    const uv = this.geo.attributes.uv.array;
    const R = this.radius;
    pos[0] = 0;
    pos[1] = 0;
    pos[2] = 0;
    uv[0] = 0.5;
    uv[1] = 0.5;
    const a0 = half;
    const a1 = Math.PI * 2 - half;
    for (let i = 0; i < SEG; i++) {
      const t = i / (SEG - 1);
      const a = a0 + (a1 - a0) * t;
      // ragged ink rim
      const rr = R * (1 + 0.045 * Math.sin(a * 5 + time * 3) + 0.03 * Math.sin(a * 11));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      pos[(i + 1) * 3] = x;
      pos[(i + 1) * 3 + 1] = y;
      pos[(i + 1) * 3 + 2] = 0;
      uv[(i + 1) * 2] = x / (R * 2) + 0.5;
      uv[(i + 1) * 2 + 1] = y / (R * 2) + 0.5;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.mesh.position.set(tileX(pac.fx), tileY(pac.fy), 0);
    this.mesh.rotation.z = dirAngle(pac.dir);
    this.uniforms.uLit.value = opts.lit ?? 0;
    this.uniforms.uAlpha.value = opts.alpha ?? 1;
    const s = opts.scale ?? 1;
    this.mesh.scale.setScalar(s);
    return this;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

function dirAngle(dir) {
  switch (dir) {
    case 0:
      return 0;
    case 1:
      return Math.PI;
    case 2:
      return -Math.PI / 2;
    case 3:
      return Math.PI / 2;
    default:
      return 0;
  }
}

/* ---------------- the hunters ---------------- */

const GHOST_V = /* glsl */ `
uniform float uTime;
uniform float uWob;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x += sin(p.y * 5.0 + uTime * 3.4) * 0.055 * uWob;
  p.y += cos(p.x * 4.0 + uTime * 2.6) * 0.035 * uWob;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const GHOST_F = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uTintMix;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float flicker = 0.86 + 0.14 * sin(uTime * 9.0);
  float a = t.a * uAlpha * mix(1.0, flicker, uTintMix);
  if (a < 0.02) discard;
  vec3 c = mix(t.rgb, uTint, uTintMix);
  gl_FragColor = vec4(c, a);
}
`;

export class GhostView {
  constructor(texture, eyeTex, color) {
    this.uniforms = {
      uMap: { value: texture },
      uTint: { value: new THREE.Color("#2f3a68") },
      uTintMix: { value: 0 },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uWob: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GHOST_V,
      fragmentShader: GHOST_F,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 1.16), this.material);
    this.mesh.renderOrder = 5;
    this.eyeMaterial = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true, depthWrite: false, depthTest: false });
    this.eyeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), this.eyeMaterial);
    this.eyeMesh.renderOrder = 7;
    this.eyeMesh.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.add(this.eyeMesh);
    this.tint = new THREE.Color(color);
  }

  update(g, time, opts = {}) {
    this.uniforms.uTime.value = time;
    this.uniforms.uTintMix.value = opts.fright ? 0.66 : 0;
    this.uniforms.uAlpha.value = opts.alpha ?? 1;
    this.uniforms.uWob.value = opts.wob ?? 1;
    this.group.position.set(tileX(g.fx), tileY(g.fy), 0);
    const s = opts.scale ?? 1;
    this.mesh.scale.setScalar(s);
    this.eyeMesh.scale.setScalar(s * (opts.eyes ? 1 : 0.8));
    this.mesh.visible = !opts.eyes;
    this.eyeMesh.visible = !!opts.eyes;
    // eyes glance toward the hungry ghost
    const dx = opts.lookX - g.fx;
    const dy = opts.lookY - g.fy;
    const d = Math.hypot(dx, dy) || 1;
    this.eyeMesh.position.set((dx / d) * 0.07, (dy / d) * 0.07 + 0.16, 0);
    return this;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.eyeMesh.geometry.dispose();
    this.eyeMaterial.dispose();
  }
}

/* ---------------- ink that throws itself ---------------- */

const BLOT_V = /* glsl */ `
attribute float aSize;
attribute float aLife;
uniform float uScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale * (0.35 + 0.65 * aLife);
  gl_Position = projectionMatrix * mv;
}
`;

const BLOT_F = /* glsl */ `
uniform sampler2D uBlot;
uniform vec3 uColor;
varying float vLife;
void main() {
  vec2 p = gl_PointCoord;
  p.y = 1.0 - p.y;
  vec4 t = texture2D(uBlot, p);
  float a = t.a * vLife;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class InkBurst {
  constructor(blotTex, max = 420) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 2);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.decay = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.uniforms = {
      uBlot: { value: blotTex },
      uColor: { value: new THREE.Color("#1b1613") },
      uScale: { value: 26 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BLOT_V,
      fragmentShader: BLOT_F,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.renderOrder = 8;
    this.points.frustumCulled = false;
    this.color = new THREE.Color("#1b1613");
  }

  spawn(x, y, opts = {}) {
    const n = opts.count ?? 14;
    const spread = opts.spread ?? 3.4;
    const size = opts.size ?? 14;
    const life = opts.life ?? 1;
    this.color.set(opts.color || "#1b1613");
    this.material.uniforms.uColor.value.copy(this.color);
    let made = 0;
    for (let i = 0; i < this.max && made < n; i++) {
      if (this.life[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.35 + Math.random() * 0.65) * spread;
      this.pos[i * 3] = tileX(x);
      this.pos[i * 3 + 1] = tileY(y);
      this.pos[i * 3 + 2] = 0;
      this.vel[i * 2] = Math.cos(a) * sp;
      this.vel[i * 2 + 1] = Math.sin(a) * sp;
      this.life[i] = life * (0.55 + Math.random() * 0.45);
      this.decay[i] = 1 / (0.35 + Math.random() * 0.5);
      this.size[i] = size * (0.4 + Math.random() * 1.1);
      made++;
    }
    this.count = Math.max(this.count, countAlive(this.life));
    return this;
  }

  update(dt, scale) {
    this.material.uniforms.uScale.value = scale;
    let any = false;
    let last = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] = Math.max(0, this.life[i] - dt * this.decay[i]);
      this.pos[i * 3] += this.vel[i * 2] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1] * dt;
      this.vel[i * 2] *= 0.94;
      this.vel[i * 2 + 1] *= 0.94;
      last = i + 1;
    }
    this.geo.setDrawRange(0, any ? last : 0);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    return this;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

function countAlive(life) {
  let n = 0;
  for (let i = 0; i < life.length; i++) if (life[i] > 0) n++;
  return n;
}
