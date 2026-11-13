/* ============================================================
   GAKI — ghost brains.  Four hunters with different temperaments:
   they path with BFS over the maze graph, keep formation while
   spreading out, flee when the ink is lit, and one of them cuts
   off the player's escape room instead of chasing his tail.
   ============================================================ */

import { W, H, idx, FLOOR, openMask, bfs, reachableWithin, DIRS, inHouse, HOUSE, TUNNEL_Y } from "./maze.js";

export const MODE = { HOME: 0, CHASE: 1, SCATTER: 2, FRIGHTENED: 3, EATEN: 4 };

export const PERSONAS = [
  {
    key: "aka",
    name: "赤",
    romaji: "aka",
    role: "chase",
    color: [0.66, 0.17, 0.13],
    corner: { x: 1, y: 1 },
    tie: [0, 1, 2, 3],
  },
  {
    key: "ai",
    name: "藍",
    romaji: "ai",
    role: "mirror",
    color: [0.16, 0.29, 0.42],
    corner: { x: W - 2, y: 1 },
    tie: [1, 0, 3, 2],
  },
  {
    key: "ki",
    name: "黃",
    romaji: "ki",
    role: "ahead",
    color: [0.55, 0.40, 0.14],
    corner: { x: 1, y: H - 2 },
    tie: [3, 2, 1, 0],
  },
  {
    key: "midori",
    name: "緑",
    romaji: "midori",
    role: "cut",
    color: [0.26, 0.40, 0.28],
    corner: { x: W - 2, y: H - 2 },
    tie: [2, 3, 0, 1],
  },
];

const REVERSE = [1, 0, 3, 2];

const scratch = {
  field: new Int16Array(W * H),
  ghostField: new Int16Array(W * H),
  blocked: new Uint8Array(W * H),
};

export function tileOf(e) {
  return { x: ((Math.round(e.fx) % W) + W) % W, y: Math.round(e.fy) };
}

/** Neighbour tiles of a tile, with tunnel wrap. */
export function tilesAround(x, y) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    let nx = x + DIRS[d].x;
    const ny = y + DIRS[d].y;
    if (y === TUNNEL_Y) nx = (nx + W) % W;
    else if (nx < 0 || nx >= W) continue;
    if (ny < 0 || ny >= H) continue;
    out.push({ x: nx, y: ny, d });
  }
  return out;
}

/** Cached BFS field for a target tile. Fields are shared between hunters. */
export class FieldCache {
  constructor(cap = 24) {
    this.cap = cap;
    this.map = new Map();
    this.order = [];
    this.hits = 0;
    this.misses = 0;
  }
  get(target, grid) {
    const key = idx(target.x, target.y);
    const hit = this.map.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const f = new Int16Array(W * H);
    bfs(grid, [target], f);
    if (this.order.length >= this.cap) {
      const old = this.order.shift();
      this.map.delete(old);
    }
    this.map.set(key, f);
    this.order.push(key);
    return f;
  }
  clear() {
    this.map.clear();
    this.order.length = 0;
  }
}

/** Where a hunter wants to be this moment. */
export function targetTile(g, st) {
  const p = tileOf(st.pacman);
  if (g.mode === MODE.EATEN) return st.maze.houseExit;

  if (g.mode === MODE.SCATTER) return PERSONAS[g.persona].corner;

  if (g.mode === MODE.FRIGHTENED) return p; // flee: maximise distance to the player

  const role = PERSONAS[g.persona].role;
  if (role === "chase") return p;
  if (role === "mirror") {
    const cx = st.maze.W >> 1;
    const cy = st.maze.H >> 1;
    return {
      x: ((2 * cx - p.x) % st.maze.W + st.maze.W) % st.maze.W,
      y: Math.max(1, Math.min(st.maze.H - 2, 2 * cy - p.y)),
    };
  }
  if (role === "ahead") {
    const d = DIRS[st.pacman.dir];
    return {
      x: ((p.x + d.x * 4) % st.maze.W + st.maze.W) % st.maze.W,
      y: Math.max(1, Math.min(st.maze.H - 2, p.y + d.y * 4)),
    };
  }
  return p; // "cut" handles itself inside chooseDir
}

/** The tile a hunter came from, tunnel wrap included. */
function backTile(g, t, maze) {
  const d = REVERSE[g.dir];
  let x = t.x + DIRS[d].x;
  const y = t.y + DIRS[d].y;
  if (t.y === maze.tunnelY) x = ((x % W) + W) % W;
  return { x, y };
}

/** Snap a wanted tile onto the nearest walkable one (scatter corners are often walls). */
function nearestFloor(grid, x, y) {
  if (grid[idx(x, y)] === FLOOR) return { x, y };
  for (let r = 1; r < W + H; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const dx = r - Math.abs(dy);
      for (const sx of [-dx, dx]) {
        const px = x + sx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (grid[idx(px, py)] === FLOOR) return { x: px, y: py };
      }
    }
  }
  return { x, y };
}

/**
 * Would walking on only take the hunter further from its prey?  Then it turns
 * around instead of pacing a two-tile corridor forever — this is the
 * difference between hunting and orbiting.
 */
function reverseIsBetter(g, st, field, pfield, t, bestScore) {
  if (g.allowReverse || g.mode === MODE.EATEN) return false;
  const b = backTile(g, t, st.maze);
  if (b.x < 0 || b.y < 0 || b.x >= W || b.y >= H) return false;
  if (gridOf(st)[idx(b.x, b.y)] !== FLOOR) return false;
  if (inHouse(b.x, b.y) && !inHouse(t.x, t.y)) return false;
  const bv = field[idx(b.x, b.y)];
  if (bv < 0) return false;
  const here = field[idx(t.x, t.y)];
  if (here >= 0 && bv >= here) return false;
  const close = pfield[idx(b.x, b.y)];
  return bv + (close < 0 ? 999 : close) * 0.12 < bestScore - 0.4;
}

function gridOf(st) {
  return st.maze.grid;
}

/**
 * Decide a hunter's direction when it reaches a tile centre.
 * `st` = { maze, pacman, ghosts, power, rng }
 */
export function chooseDir(g, st, fields) {
  const grid = st.maze.grid;
  const t = tileOf(g);
  const mask = openMask(grid, t.x, t.y);
  const persona = PERSONAS[g.persona];

  // trapped in the house: shuffle around, then leave through the shaft
  if (g.mode === MODE.HOME) return houseDir(g, st);

  const cands = [];
  const loose = [];
  const back = REVERSE[g.dir];
  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    if (d === back && !g.allowReverse) continue;
    const nx = t.x + DIRS[d].x;
    const ny = t.y + DIRS[d].y;
    const wx = st.maze.tunnelY === t.y ? ((nx % W) + W) % W : nx;
    if (grid[idx(wx, ny)] !== FLOOR) continue;
    loose.push({ d, x: wx, y: ny });
    // living hunters never walk back into the pen
    if (g.mode !== MODE.EATEN && inHouse(wx, ny) && !inHouse(t.x, t.y)) continue;
    // hunters do not dive into the tunnels unless the prey is in there — but a
    // tunnel is better than a dead end, so this filter is only applied when
    // there is something else to do
    if (g.mode !== MODE.EATEN && ny === st.maze.tunnelY && tileOf(st.pacman).y !== st.maze.tunnelY) {
      if (!g.tunnelOk) continue;
    }
    cands.push({ d, x: wx, y: ny });
  }
  const moves = cands.length ? cands : loose;
  if (!moves.length) {
    g.allowReverse = true;
    return back;
  }

  if (g.mode === MODE.FRIGHTENED) {
    // Running is not just putting distance in one step: back into a corner and
    // you are eaten next tick. Flee towards open paper, away from the player,
    // and never into a dead end.
    const pf = fields.get(tileOf(st.pacman), grid);
    let best = moves[0];
    let bestScore = -Infinity;
    for (const c of moves) {
      const away = pf[idx(c.x, c.y)];
      const exits = popcountOf(openMask(grid, c.x, c.y));
      for (let i = 0; i < W * H; i++) scratch.blocked[i] = 0;
      scratch.blocked[idx(c.x, c.y)] = 1;
      const room = reachableWithin(grid, c, 5, scratch.blocked);
      const score =
        (away < 0 ? -999 : away) * 1.6 + room * 1.4 + (exits === 1 ? -30 : 0) + (c.y === st.maze.tunnelY ? 4 : 0) +
        (g.rng ? g.rng() : Math.random()) * 2.2;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best.d;
  }

  // ---- the cutter: pick the tile that shrinks the player's room to run ----
  if (persona.role === "cut" && g.mode === MODE.CHASE) {
    const p = tileOf(st.pacman);
    const field = fields.get(p, grid);
    let best = moves[0];
    let bestScore = Infinity;
    for (const c of moves) {
      for (let i = 0; i < W * H; i++) scratch.blocked[i] = 0;
      scratch.blocked[idx(c.x, c.y)] = 1;
      for (const o of st.ghosts) {
        if (o === g || o.mode === MODE.EATEN) continue;
        const ot = tileOf(o);
        scratch.blocked[idx(ot.x, ot.y)] = 1;
      }
      const room = reachableWithin(grid, p, 6, scratch.blocked);
      const closeness = field[idx(c.x, c.y)];
      const crowd = crowdPenalty(g, st, c);
      const score = room * 3 + (closeness < 0 ? 999 : closeness) * 0.35 + crowd - (closeness >= 0 && closeness <= 1 ? 7 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (reverseIsBetter(g, st, field, field, t, bestScore)) return back;
    return best.d;
  }

  // ---- ordinary hunt: close the ring around where the player is going ----
  const p = tileOf(st.pacman);
  const pf = fields.get(p, grid);
  const mine = pf[idx(t.x, t.y)];
  const want = interceptTarget(g, st, grid, mine);
  const target = nearestFloor(grid, want.x, want.y);
  const field = fields.get(target, grid);
  const pfield = pf;
  let best = moves[0];
  let bestScore = Infinity;
  for (const c of moves) {
    const v = field[idx(c.x, c.y)];
    let score = v < 0 ? 9999 : v;
    if (g.mode === MODE.EATEN) score *= 1.5;
    else {
      // pull towards the player on ties, keep the pack spread, add temperament
      const close = pfield[idx(c.x, c.y)];
      score += (close < 0 ? 999 : close) * 0.12;
      // one tile from the player: commit to the bite instead of circling
      if (close >= 0 && close <= 1) score -= 7;
      score += crowdPenalty(g, st, c);
      score += roomPenalty(g, st, grid, c);
      score += junctionRisk(grid, c, pfield);
      score += (g.rng ? g.rng() : Math.random()) * g.jitter;
    }
    // deterministic personality order so hunters do not clone each other
    score += persona.tie[c.d] * 0.06;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (reverseIsBetter(g, st, field, pfield, t, bestScore)) return back;
  return best.d;
}

/**
 * Where this hunter should aim. A hunter chasing the player's current tile is
 * always one step behind, so it aims at a point on a ring around the tile the
 * player is travelling towards; each personality takes a different arc, so the
 * pack closes from several sides and the arcs drift as the hunt runs.
 */
function interceptTarget(g, st, grid, distToPlayer) {
  const p = tileOf(st.pacman);
  if (g.mode === MODE.SCATTER) return PERSONAS[g.persona].corner;
  if (g.mode === MODE.EATEN) return st.maze.houseExit;

  const pd = DIRS[st.pacman.dir];
  const heading = Math.atan2(pd.y, pd.x);
  const offset = (g.persona * Math.PI) / 2 + Math.sin(st.time * 0.7 + g.persona) * 0.5;
  const radius = Math.max(2, Math.min(6, distToPlayer * 0.5));
  const ahead = predictTile(st, grid, distToPlayer > 6 ? 5 : 3);
  // close enough to bite: aim at him, not at a ring that keeps you at arm's length
  if (distToPlayer <= 4) return ahead;
  const ring = ringTile(grid, ahead, heading + Math.PI + offset, radius);
  return { x: Math.round((ring.x + ahead.x) / 2), y: Math.round((ring.y + ahead.y) / 2) };
}

/** Follow the player's own line until it hits a wall — where he will be. */
function predictTile(st, grid, depth) {
  const p = tileOf(st.pacman);
  const d = DIRS[st.pacman.dir];
  let x = p.x;
  let y = p.y;
  for (let i = 0; i < depth; i++) {
    let nx = x + d.x;
    const ny = y + d.y;
    if (st.maze.tunnelY === ny) nx = ((nx % W) + W) % W;
    else if (nx < 0 || nx >= W) break;
    if (ny < 0 || ny >= H || grid[idx(nx, ny)] !== FLOOR) break;
    x = nx;
    y = ny;
  }
  return { x, y };
}

/** The nearest walkable tile on a given bearing and radius from a centre. */
function ringTile(grid, centre, angle, radius) {
  return nearestFloor(grid, Math.round(centre.x + Math.cos(angle) * radius), Math.round(centre.y + Math.sin(angle) * radius));
}

/**
 * Cutting the player's room: blocking the candidate tile shrinks how much
 * paper he can still run on. Small weight for everyone, the cutter leans on it.
 */
function roomPenalty(g, st, grid, c) {
  if (g.mode !== MODE.CHASE && g.mode !== MODE.SCATTER) return 0;
  const p = tileOf(st.pacman);
  for (let i = 0; i < W * H; i++) scratch.blocked[i] = 0;
  scratch.blocked[idx(c.x, c.y)] = 1;
  for (const o of st.ghosts) {
    if (o === g || o.mode === MODE.EATEN || o.mode === MODE.HOME) continue;
    const ot = tileOf(o);
    scratch.blocked[idx(ot.x, ot.y)] = 1;
  }
  return reachableWithin(grid, p, 6, scratch.blocked) * 0.5;
}

/**
 * Parking on a junction the player can reach in a few tiles lets him slip past
 * you and keeps his options open — step off it unless it is the way you meant
 * to go anyway.
 */
function junctionRisk(grid, c, pacField) {
  const exits = popcountOf(openMask(grid, c.x, c.y));
  if (exits < 3) return 0;
  const v = pacField[idx(c.x, c.y)];
  if (v < 0 || v > 4) return 0;
  return (exits - 2) * (2.4 - v * 0.4);
}

function popcountOf(m) {
  let n = 0;
  for (let d = 0; d < 4; d++) if (m & (1 << d)) n++;
  return n;
}

/** Small penalty for two hunters stacking on the same tile / corridor. */
function crowdPenalty(g, st, c) {
  let pen = 0;
  for (const o of st.ghosts) {
    if (o === g || o.mode === MODE.EATEN) continue;
    const ot = tileOf(o);
    const d = Math.abs(ot.x - c.x) + Math.abs(ot.y - c.y);
    if (d === 0) pen += 14;
    else if (d <= 2) pen += 3.2;
    else if (d <= 4) pen += 0.6;
  }
  // also stop both ends of a corridor being blocked by the same hunter pair
  if (st.maze.tunnelY === c.y) pen += 0.4;
  return pen;
}

/** Motion inside the pen: bob, then line up under the shaft and climb out. */
function houseDir(g, st) {
  const t = tileOf(g);
  const house = st.maze.house;
  const exit = st.maze.houseExit;
  if (t.y === exit.y && t.x === exit.x) return 3; // step out upwards
  if (t.y > exit.y && t.x !== house.cx && Math.abs(t.x - house.cx) <= house.hw) {
    return t.x < house.cx ? 0 : 1; // slide towards the shaft column
  }
  // bob up and down inside the pen
  if (g.dir === 2) return 3;
  if (g.dir === 3) return 2;
  return g.dir === 2 ? 3 : 2;
}

/** Speed for a hunter this instant. */
export function ghostSpeed(g, st, base) {
  if (g.mode === MODE.EATEN) return base * 2.2;
  if (g.mode === MODE.HOME) return base * 0.55;
  if (g.mode === MODE.FRIGHTENED) return base * 0.52;
  if (g.mode === MODE.SCATTER) return base * 0.94;
  return base * 0.95;
}

/** Is a hunter edible right now? */
export function isEdible(g, st) {
  return st.power > 0 && g.mode === MODE.FRIGHTENED;
}

export function houseInteriorBlocked(maze) {
  const b = scratch.blocked;
  b.fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inHouse(x, y)) b[idx(x, y)] = 1;
  return b;
}

export { HOUSE };
