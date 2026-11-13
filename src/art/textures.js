/* ============================================================
   GAKI — ink textures.  Brush strokes, dots, blots and the
   four hunters, cut out of the painted sprite sheet.
   ============================================================ */

import * as THREE from "three";

export const SUMI = "#14100d";
export const PAPER = "#e8e0cf";
export const SHU = "#a8322a";

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Periodic value noise so textures tile without a seam. */
function periodic(x, period, seed, harmonics = 5) {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  for (let k = 1; k <= harmonics; k++) {
    const f = (k * 2 * Math.PI) / period;
    v += amp * Math.sin(f * x + seed * k * 1.7 + k * 0.9);
    norm += amp;
    amp *= 0.62;
  }
  return (v / norm) * 0.5 + 0.5;
}

function hash(i, seed = 1) {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ---------------- brush stroke ---------------- */

export function inkStrokeTexture() {
  const W = 512;
  const H = 64;
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);

  // one continuous line of ink: the width breathes a little, the ink
  // stays dark, and only the bristles break it up
  for (let x = 0; x < W; x++) {
    const wide = periodic(x, W, 1.4, 3) * 0.05 + periodic(x, W, 5.3, 5) * 0.03;
    const half = H * 0.5 * (0.9 + wide);
    const alpha = 0.84 + 0.09 * periodic(x, W, 3.6, 4) + 0.06 * periodic(x, W, 12.1, 3);
    g.fillStyle = `rgba(16,13,10,${alpha.toFixed(3)})`;
    g.fillRect(x, H / 2 - half, 1, half * 2);
    // a soft halo where the brush soaked the paper
    g.fillStyle = `rgba(24,20,17,${(alpha * 0.16).toFixed(3)})`;
    g.fillRect(x, H / 2 - half - 1.5, 1, 1.5);
    g.fillRect(x, H / 2 + half, 1, 1.5);
  }

  // dry brush: long streaks along the stroke, not across it
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 34; i++) {
    const y = H / 2 + (hash(i, 2) - 0.5) * H * 0.82;
    const len = 60 + hash(i, 5) * 300;
    const x0 = hash(i, 7) * W;
    const a = 0.1 + hash(i, 11) * 0.28;
    g.strokeStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    g.lineWidth = 0.8 + hash(i, 13) * 2;
    g.beginPath();
    g.moveTo(x0, y);
    for (let t = 0; t <= 1; t += 0.08) {
      g.lineTo(x0 + len * t, y + Math.sin(t * 5 + i) * 1.2);
    }
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";

  // a few speckles spitting off the brush
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 17) * W;
    const y = H / 2 + (hash(i, 19) - 0.5) * H * 1.25;
    const r = 0.4 + hash(i, 23) * 1.1;
    g.fillStyle = `rgba(18,14,11,${(0.08 + hash(i, 29) * 0.26).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------- food ---------------- */

export function inkDotTexture() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  g.fillStyle = SUMI;
  g.beginPath();
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const r = S * 0.28 * (1 + 0.13 * Math.sin(a * 3 + 1.2) + 0.08 * Math.sin(a * 7));
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.fill();
  g.fillStyle = "rgba(20,16,13,0.28)";
  g.beginPath();
  g.arc(0, 0, S * 0.36, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** An enso ring: the lit ink. Painted with a dry brush and left open. */
export function ensoTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  const R = S * 0.36;
  for (let i = 0; i < 150; i++) {
    const t = i / 150;
    const a = -0.55 + t * (Math.PI * 2 - 0.9);
    const w = S * 0.055 * (0.55 + 0.6 * periodic(a * 40, Math.PI * 2, 4.4, 4));
    const alpha = 0.55 + 0.4 * periodic(a * 30, Math.PI * 2, 2.2, 3);
    g.strokeStyle = `rgba(24,19,15,${alpha.toFixed(3)})`;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, 0, R, a, a + 0.05);
    g.stroke();
  }
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 30; i++) {
    const a = hash(i, 3) * Math.PI * 2;
    const rr = R + (hash(i, 8) - 0.5) * S * 0.09;
    g.fillStyle = `rgba(0,0,0,${(0.1 + hash(i, 12) * 0.4).toFixed(3)})`;
    g.beginPath();
    g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1 + hash(i, 14) * 4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- the hungry ghost itself ---------------- */

/** A filled ink disc with a ragged rim: the body of the hungry ghost. */
export function inkDiscTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  g.fillStyle = SUMI;
  g.beginPath();
  for (let i = 0; i <= 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const r = S * 0.46 * (1 + 0.035 * Math.sin(a * 3) + 0.025 * Math.sin(a * 7 + 1.4) + 0.02 * Math.sin(a * 13 + 2));
    g[i === 0 ? "moveTo" : "lineTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();

  // paper showing through where the bristles ran dry
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 64; i++) {
    const a = hash(i, 71) * Math.PI * 2;
    const r = hash(i, 73) * S * 0.42;
    g.strokeStyle = `rgba(0,0,0,${(0.1 + hash(i, 79) * 0.34).toFixed(3)})`;
    g.lineWidth = 1 + hash(i, 83) * 3;
    g.beginPath();
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    g.lineTo(Math.cos(a) * r + 8 + hash(i, 89) * 26, Math.sin(a) * r + (hash(i, 91) - 0.5) * 5);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";

  // ink pooling along the rim
  for (let i = 0; i < 44; i++) {
    const a = hash(i, 97) * Math.PI * 2;
    const r = S * 0.43;
    g.fillStyle = `rgba(30,24,19,${(0.25 + hash(i, 103) * 0.4).toFixed(3)})`;
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, 1 + hash(i, 101) * 3.4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- splatter ---------------- */

export function blotTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  g.fillStyle = SUMI;
  g.beginPath();
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = S * 0.22 * (1 + 0.35 * Math.sin(a * 3 + 0.7) + 0.2 * Math.sin(a * 5 + 2));
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.fill();
  for (let i = 0; i < 26; i++) {
    const a = hash(i, 31) * Math.PI * 2;
    const d = S * (0.22 + hash(i, 37) * 0.28);
    const r = 1 + hash(i, 41) * 4.5;
    g.fillStyle = `rgba(20,16,13,${(0.25 + hash(i, 43) * 0.6).toFixed(3)})`;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- eyes for a hunter that has been eaten ---------------- */

export function eyeTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  const drawEye = (cx) => {
    g.fillStyle = "rgba(232,226,212,0.92)";
    g.beginPath();
    g.ellipse(cx, S * 0.5, S * 0.19, S * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = SUMI;
    g.lineWidth = S * 0.045;
    g.beginPath();
    g.ellipse(cx, S * 0.5, S * 0.19, S * 0.22, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = SUMI;
    g.beginPath();
    g.arc(cx, S * 0.53, S * 0.075, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = SHU;
    g.beginPath();
    g.arc(cx, S * 0.5, S * 0.028, 0, Math.PI * 2);
    g.fill();
  };
  drawEye(S * 0.33);
  drawEye(S * 0.67);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- the painted hunters ---------------- */

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("cannot load " + url));
    img.src = url;
  });
}

/**
 * Turn a strip of the painted sheet into a sprite with honest alpha:
 * the paper around the creature is flood-filled away from the borders,
 * the enclosed body stays painted, ink edges become opaque.
 */
function cutInkSprite(img, sx, sw, sh, outSize, rgb) {
  const S = outSize;
  const ink = rgb || [0.55, 0.2, 0.16];
  const c = makeCanvas(S, S);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, sx, 0, sw, sh, 0, 0, S, S);
  const img2 = g.getImageData(0, 0, S, S);
  const d = img2.data;
  const luma = (i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  const sat = (i) => {
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    return (mx - mn) / 255;
  };

  // flood fill the background (near-white, touching the border)
  const bg = new Uint8Array(S * S);
  const stack = [];
  const isPaper = (p) => luma(p * 4) > 0.885 && sat(p * 4) < 0.12;
  for (let x = 0; x < S; x++) {
    for (const p of [x, (S - 1) * S + x]) if (isPaper(p) && !bg[p]) {
      bg[p] = 1;
      stack.push(p);
    }
    for (const p of [x * S, x * S + S - 1]) if (isPaper(p) && !bg[p]) {
      bg[p] = 1;
      stack.push(p);
    }
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % S;
    const y = (p - x) / S;
    const around = [
      x > 0 ? p - 1 : -1,
      x < S - 1 ? p + 1 : -1,
      y > 0 ? p - S : -1,
      y < S - 1 ? p + S : -1,
    ];
    for (const q of around) {
      if (q < 0 || bg[q]) continue;
      if (!isPaper(q)) continue;
      bg[q] = 1;
      stack.push(q);
    }
  }

  // trim to the creature's bounding box so all four hunters share a scale
  let minX = S;
  let maxX = 0;
  let minY = S;
  let maxY = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = y * S + x;
      if (bg[p]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) {
    minX = 0;
    maxX = S - 1;
    minY = 0;
    maxY = S - 1;
  }

  for (let p = 0; p < S * S; p++) {
    const i = p * 4;
    if (bg[p]) {
      d[i + 3] = 0;
      continue;
    }
    const l = luma(i);
    // the body carries the hunter's own ink; dark outlines stay dark, and
    // enclosed pale pixels (the eyes) keep their light so the face survives
    if (l > 0.9) {
      d[i] = 246;
      d[i + 1] = 240;
      d[i + 2] = 226;
      d[i + 3] = 235;
      continue;
    }
    const k = 0.34 + 0.66 * Math.min(1, l * 1.35);
    d[i] = Math.round(Math.min(255, ink[0] * 255 * k + 8));
    d[i + 1] = Math.round(Math.min(255, ink[1] * 255 * k + 8));
    d[i + 2] = Math.round(Math.min(255, ink[2] * 255 * k + 8));
    d[i + 3] = Math.round(Math.min(255, (0.82 + (1 - l) * 0.18) * 255));
  }
  g.putImageData(img2, 0, 0);

  // normalise: crop to the creature and fit it into the sprite
  const cw = Math.max(1, maxX - minX);
  const ch = Math.max(1, maxY - minY);
  const fit = S * 0.94 / Math.max(cw, ch);
  const out = makeCanvas(S, S);
  const og = out.getContext("2d");
  const w = cw * fit;
  const h = ch * fit;
  og.drawImage(c, minX, minY, cw, ch, (S - w) / 2, (S - h) / 2 + S * 0.02, w, h);

  // eyes: two pale dabs of the brush, pupils pointed at the prey
  const eyeY = (S - h) / 2 + S * 0.02 + h * 0.3;
  const eyeR = Math.max(4, S * 0.062);
  for (const sx of [-1, 1]) {
    const ex = S / 2 + sx * h * 0.16;
    og.fillStyle = "rgba(247,242,230,0.95)";
    og.beginPath();
    og.ellipse(ex, eyeY, eyeR, eyeR * 1.25, 0, 0, Math.PI * 2);
    og.fill();
    og.fillStyle = `rgb(${Math.round(ink[0] * 90)},${Math.round(ink[1] * 90)},${Math.round(ink[2] * 90)})`;
    og.beginPath();
    og.ellipse(ex + sx * eyeR * 0.12, eyeY + eyeR * 0.1, eyeR * 0.45, eyeR * 0.6, 0, 0, Math.PI * 2);
    og.fill();
  }

  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export async function hunterTextures(url, colors) {
  try {
    const img = await loadImage(url);
    const sw = img.width / 4;
    return [0, 1, 2, 3].map((i) =>
      cutInkSprite(img, Math.round(i * sw), Math.round(sw), img.height, 256, colors && colors[i])
    );
  } catch (e) {
    // painted sheet missing: fall back to a plain ink ghost so the game still runs
    return [0, 1, 2, 3].map(() => new THREE.CanvasTexture(fallbackGhostCanvas()));
  }
}

function fallbackGhostCanvas() {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.fillStyle = SUMI;
  g.beginPath();
  g.moveTo(60, 200);
  g.lineTo(60, 110);
  g.quadraticCurveTo(128, 30, 196, 110);
  g.lineTo(196, 200);
  g.quadraticCurveTo(160, 180, 128, 205);
  g.quadraticCurveTo(96, 180, 60, 200);
  g.fill();
  return c;
}

export async function paperTexture(url) {
  try {
    const img = await loadImage(url);
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  } catch (e) {
    return null;
  }
}

export async function heroImage(url) {
  try {
    return await loadImage(url);
  } catch (e) {
    return null;
  }
}

/** Faint ink watermark painted behind the maze. */
export function watermarkTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  g.strokeStyle = "rgba(20,16,13,0.14)";
  g.lineWidth = 26;
  g.beginPath();
  g.arc(0, 0, S * 0.38, 0.4, Math.PI * 2 - 0.2);
  g.stroke();
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 220; i++) {
    const a = hash(i, 51) * Math.PI * 2;
    const r = S * 0.38 + (hash(i, 53) - 0.5) * 30;
    g.fillStyle = `rgba(0,0,0,${(0.06 + hash(i, 59) * 0.35).toFixed(3)})`;
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + hash(i, 61) * 9, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
