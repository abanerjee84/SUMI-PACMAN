/* ============================================================
   GAKI — procedural maze.  Pure data, no rendering, so it can be
   tested headless in node and reused by every parallel env.
   ============================================================ */

export const CW = 12; // maze cells horizontally
export const CH = 8; // maze cells vertically
export const W = CW * 2 + 1; // tiles 25
export const H = CH * 2 + 1; // tiles 17

export const WALL = 1;
export const FLOOR = 0;

export const HOUSE = {
  cx: W >> 1, // 12 (even column, the shaft down the middle)
  cy: H >> 1, // 8
  hw: 3, // interior half width  -> x 9..15
  hh: 1, // interior half height -> y 7..9
};

export const TUNNEL_Y = HOUSE.cy + 3; // wrap corridor row (11)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (x, y) => y * W + x;
export { idx };
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

/** Neighbour tiles with horizontal wrap on the tunnel row. */
export function neighbours(x, y) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
    const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
    let wx = nx;
    if (y === TUNNEL_Y) wx = (nx + W) % W;
    else if (nx < 0 || nx >= W) continue;
    out.push({ x: wx, y: ny, dir: d });
  }
  return out;
}

export const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** dir 0..3 = right, left, down, up */
export function openMask(grid, x, y) {
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d].x;
    const ny = y + DIRS[d].y;
    if (y === TUNNEL_Y) {
      const wx = (nx + W) % W;
      if (grid[idx(wx, ny)] === FLOOR) m |= 1 << d;
    } else if (inBounds(nx, ny) && grid[idx(nx, ny)] === FLOOR) m |= 1 << d;
  }
  return m;
}

export function wrapX(x) {
  if (x < 0) return x + W;
  if (x >= W) return x - W;
  return x;
}

function isHouseInterior(x, y) {
  return Math.abs(x - HOUSE.cx) <= HOUSE.hw && Math.abs(y - HOUSE.cy) <= HOUSE.hh;
}

export function inHouse(x, y) {
  return isHouseInterior(x, y);
}

/* ------------------------------------------------------------ */

export function generateMaze(rng = Math.random) {
  const grid = new Uint8Array(W * H).fill(WALL);

  // ---- perfect maze: iterative recursive backtracking ----
  const visited = new Uint8Array(CW * CH);
  const stack = [];
  let cx = Math.floor(rng() * CW);
  let cy = Math.floor(rng() * CH);
  visited[cy * CW + cx] = 1;
  grid[idx(cx * 2 + 1, cy * 2 + 1)] = FLOOR;
  stack.push([cx, cy]);

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const cand = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d].x;
      const ny = y + DIRS[d].y;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
      if (visited[ny * CW + nx]) continue;
      cand.push({ nx, ny, d });
    }
    if (!cand.length) {
      stack.pop();
      continue;
    }
    // slight bias towards the last direction -> longer brush-like corridors
    const last = stack.length > 1 ? stack[stack.length - 2] : null;
    cand.sort((a, b) => {
      const sa = last && a.x === last.x && a.y === last.y ? -1 : 0;
      const sb = last && b.x === last.x && b.y === last.y ? -1 : 0;
      return sa - sb || rng() - 0.5;
    });
    const pick = cand[0];
    visited[pick.ny * CW + pick.nx] = 1;
    grid[idx(pick.nx * 2 + 1, pick.ny * 2 + 1)] = FLOOR;
    grid[idx(x * 2 + 1 + DIRS[pick.d].x, y * 2 + 1 + DIRS[pick.d].y)] = FLOOR;
    stack.push([pick.nx, pick.ny]);
  }

  // ---- braiding: knock holes so the maze has loops (pac-man needs loops) ----
  const cellNeigh = (x, y) => {
    const out = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d].x;
      const ny = y + DIRS[d].y;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
      out.push({ nx, ny, d });
    }
    return out;
  };

  const degree = (x, y) => cellNeigh(x, y).filter((n) => grid[idx(n.nx * 2 + 1, n.ny * 2 + 1)] === FLOOR && grid[idx(x * 2 + 1 + DIRS[n.d].x, y * 2 + 1 + DIRS[n.d].y)] === FLOOR).length;

  // remove most dead ends (they are wasted paper)
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (degree(x, y) <= 1 && rng() < 0.82) {
        const n = cellNeigh(x, y).filter((q) => !(grid[idx(q.nx * 2 + 1, q.ny * 2 + 1)] === FLOOR && grid[idx(x * 2 + 1 + DIRS[q.d].x, y * 2 + 1 + DIRS[q.d].y)] === FLOOR));
        if (!n.length) continue;
        const q = n[Math.floor(rng() * n.length)];
        grid[idx(x * 2 + 1 + DIRS[q.d].x, y * 2 + 1 + DIRS[q.d].y)] = FLOOR;
      }
    }
  }

  // extra random loops
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d].x;
        const ny = y + DIRS[d].y;
        if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
        const wx = idx(x * 2 + 1 + DIRS[d].x, y * 2 + 1 + DIRS[d].y);
        if (grid[wx] === WALL && rng() < 0.16) grid[wx] = FLOOR;
      }
    }
  }

  // ---- ghost house ----
  const { cx: hx, cy: hy, hw, hh } = HOUSE;
  for (let y = hy - hh - 1; y <= hy + hh + 1; y++) {
    for (let x = hx - hw - 1; x <= hx + hw + 1; x++) {
      grid[idx(x, y)] = WALL;
    }
  }
  for (let y = hy - hh; y <= hy + hh; y++) {
    for (let x = hx - hw; x <= hx + hw; x++) grid[idx(x, y)] = FLOOR;
  }
  // exit shaft straight up out of the house
  for (let y = hy - hh - 1; y >= hy - hh - 4; y--) grid[idx(hx, y)] = FLOOR;

  // ---- wrap tunnel ----
  for (let x = 0; x < W; x++) grid[idx(x, TUNNEL_Y)] = FLOOR;
  // guarantee at least two real connections into the maze body
  let links = 0;
  for (let x = 1; x < W - 1; x++) {
    if (grid[idx(x, TUNNEL_Y - 1)] === FLOOR || grid[idx(x, TUNNEL_Y + 1)] === FLOOR) links++;
  }
  const want = Math.floor(W * 0.18);
  const xs = [];
  for (let x = 2; x < W - 2; x++) xs.push(x);
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  for (let i = 0; links < want && i < xs.length; i++) {
    const x = xs[i];
    if (x === hx && Math.abs(TUNNEL_Y - hy) <= hh + 2) continue;
    grid[idx(x, TUNNEL_Y - 1)] = FLOOR;
    if (rng() < 0.5) grid[idx(x, TUNNEL_Y + 1)] = FLOOR;
    links++;
  }

  // keep the boundary sane (only the tunnel row may touch the edges)
  for (let y = 0; y < H; y++) {
    if (y !== TUNNEL_Y) {
      grid[idx(0, y)] = WALL;
      grid[idx(W - 1, y)] = WALL;
    }
  }
  for (let x = 0; x < W; x++) {
    grid[idx(x, 0)] = WALL;
    grid[idx(x, H - 1)] = WALL;
  }

  // ---- connectivity: keep the largest component, wall off stray pockets ----
  let lab = labelComponents(grid);
  let big = lab.big;
  if (globalThis.__MAZE_DEBUG__) console.log("DBG components", lab.sizes, "big", big);

  // the ghost house must live inside the playable component
  const houseTile = { x: HOUSE.cx, y: HOUSE.cy };
  if (lab.comp[idx(houseTile.x, houseTile.y)] !== big) {
    let target = null;
    let bestD = Infinity;
    for (let i = 0; i < W * H; i++) {
      if (lab.comp[i] !== big) continue;
      const x = i % W;
      const y = (i - x) / W;
      const d = (x - houseTile.x) ** 2 + (y - houseTile.y) ** 2;
      if (d < bestD) {
        bestD = d;
        target = { x, y };
      }
    }
    if (target) carvePath(grid, houseTile, target);
    lab = labelComponents(grid);
    big = lab.big;
    if (globalThis.__MAZE_DEBUG__) console.log("DBG after link", lab.sizes, "big", big);
  }

  for (let i = 0; i < W * H; i++) if (grid[i] === FLOOR && lab.comp[i] !== big) grid[i] = WALL;

  // ---- spawn tile ----
  const spawn = findFloorNear(grid, HOUSE.cx, H - 3, rng);
  const houseTiles = [
    { x: HOUSE.cx - 2, y: HOUSE.cy },
    { x: HOUSE.cx, y: HOUSE.cy - 1 },
    { x: HOUSE.cx + 2, y: HOUSE.cy },
    { x: HOUSE.cx, y: HOUSE.cy + 1 },
  ];

  // ---- pellets ----
  const pellets = new Uint8Array(W * H);
  const reach = new Int16Array(W * H).fill(-1);
  bfs(grid, [spawn], reach);

  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (grid[i] !== FLOOR) continue;
      if (isHouseInterior(x, y)) continue;
      if (reach[i] < 0) continue; // unreachable pocket -> no pellet
      pellets[i] = 1;
      count++;
    }
  }

  // ---- power pellets: one per quadrant, near a junction, reachable in a
  // handful of bites. The four far corners put them out of reach of a policy
  // that dies after ~30 dots, so the lit-ink branch never gets sampled.
  const anchors = [];
  for (const ax of [-1, 1]) for (const ay of [-1, 1]) anchors.push({ x: spawn.x + ax * 7, y: spawn.y + ay * 5 });
  for (const c of anchors) {
    let best = -1;
    let bestScore = Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (pellets[i] !== 1) continue;
        const d = Math.hypot(x - c.x, y - c.y);
        const open = popcount(openMask(grid, x, y));
        const score = d - open * 1.4;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    if (best >= 0) pellets[best] = 2;
  }

  let powers = 0;
  for (let i = 0; i < W * H; i++) if (pellets[i] === 2) powers++;

  return {
    grid,
    pellets,
    W,
    H,
    spawn,
    houseTiles,
    houseExit: { x: HOUSE.cx, y: HOUSE.cy - HOUSE.hh - 4 },
    tunnelY: TUNNEL_Y,
    house: HOUSE,
    pelletCount: count - powers,
    powerCount: powers,
  };
}

/** Label floor-tile components (tunnel wrap included). */
function labelComponents(grid) {
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const queue = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (grid[i] !== FLOOR || comp[i] !== -1) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      comp[i] = id;
      queue[tail++] = i;
      let n = 0;
      while (head < tail) {
        const j = queue[head++];
        n++;
        const bx = j % W;
        const by = (j - bx) / W;
        for (const nb of neighbours(bx, by)) {
          const k = idx(nb.x, nb.y);
          if (grid[k] !== FLOOR || comp[k] !== -1) continue;
          comp[k] = id;
          queue[tail++] = k;
        }
      }
      sizes.push(n);
    }
  }
  let big = 0;
  for (let c = 0; c < sizes.length; c++) if (sizes[c] > sizes[big]) big = c;
  return { comp, sizes, big };
}

/** Carve a cheap corridor between two tiles: floor costs 0, wall costs 1 (SPFA). */
function carvePath(grid, a, b) {
  const n = W * H;
  const cost = new Int32Array(n).fill(1e9);
  const prev = new Int32Array(n).fill(-1);
  const inq = new Uint8Array(n);
  const si = idx(a.x, a.y);
  const q = [si];
  cost[si] = 0;
  inq[si] = 1;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    inq[i] = 0;
    const x = i % W;
    const y = (i - x) / W;
    for (let k = 0; k < 4; k++) {
      let nx = x + DIRS[k].x;
      let ny = y + DIRS[k].y;
      if (y === TUNNEL_Y) nx = (nx + W) % W;
      else {
        if (nx <= 0 || nx >= W - 1) continue;
        if (ny <= 0 || ny >= H - 1) continue;
      }
      if (ny <= 0 || ny >= H - 1) continue;
      if (nx <= 0 || nx >= W - 1) continue;
      const j = idx(nx, ny);
      const c = cost[i] + (grid[j] === FLOOR ? 0 : 1);
      if (c < cost[j]) {
        cost[j] = c;
        prev[j] = i;
        if (!inq[j]) {
          inq[j] = 1;
          q.push(j);
        }
      }
    }
  }
  let cur = idx(b.x, b.y);
  if (cur !== si && cost[cur] === 1e9) return false;
  while (cur !== si && cur !== -1) {
    grid[cur] = FLOOR;
    cur = prev[cur];
  }
  return true;
}

function popcount(m) {
  let c = 0;
  for (let d = 0; d < 4; d++) if (m & (1 << d)) c++;
  return c;
}

function findFloorNear(grid, x, y, rng) {
  let best = null;
  let bestD = Infinity;
  for (let yy = 1; yy < H - 1; yy++) {
    for (let xx = 1; xx < W - 1; xx++) {
      if (grid[idx(xx, yy)] !== FLOOR) continue;
      if (isHouseInterior(xx, yy)) continue;
      const open = popcount(openMask(grid, xx, yy));
      if (open < 2) continue;
      const d = (xx - x) ** 2 + (yy - y) ** 2 + (open === 2 ? 0 : -8);
      if (d < bestD) {
        bestD = d;
        best = { x: xx, y: yy };
      }
    }
  }
  return best || { x: 1, y: 1 };
}

/** Multi-source BFS over walkable tiles. dist is Int16Array, -1 = unreachable.
 *  Sources may be tile indices or {x,y} objects. */
export function bfs(grid, sources, dist, blocked) {
  dist.fill(-1);
  const q = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    const isIdx = typeof s === 'number';
    const sx = isIdx ? s % W : s.x;
    const sy = isIdx ? Math.floor(s / W) : s.y;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const i = idx(sx, sy);
    if (grid[i] !== FLOOR) continue;
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    q[tail++] = i;
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i - x) / W;
    const d = dist[i];
    for (let k = 0; k < 4; k++) {
      let nx = x + DIRS[k].x;
      const ny = y + DIRS[k].y;
      if (y === TUNNEL_Y) nx = (nx + W) % W;
      else if (nx < 0 || nx >= W) continue;
      if (ny < 0 || ny >= H) continue;
      const j = idx(nx, ny);
      if (grid[j] !== FLOOR) continue;
      if (blocked && blocked[j]) continue;
      if (dist[j] !== -1) continue;
      dist[j] = d + 1;
      q[tail++] = j;
    }
  }
  return dist;
}

/** Number of tiles reachable from `start` within `depth` steps (escape room). */
export function reachableWithin(grid, start, depth, blocked) {
  const seen = new Int16Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const si = idx(start.x, start.y);
  if (grid[si] !== FLOOR) return 0;
  if (blocked && blocked[si]) return 0;
  seen[si] = 0;
  q[tail++] = si;
  let n = 0;
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i - x) / W;
    const d = seen[i];
    n++;
    if (d >= depth) continue;
    for (let k = 0; k < 4; k++) {
      let nx = x + DIRS[k].x;
      const ny = y + DIRS[k].y;
      if (y === TUNNEL_Y) nx = (nx + W) % W;
      else if (nx < 0 || nx >= W) continue;
      if (ny < 0 || ny >= H) continue;
      const j = idx(nx, ny);
      if (grid[j] !== FLOOR) continue;
      if (blocked && blocked[j]) continue;
      if (seen[j] !== -1) continue;
      seen[j] = d + 1;
      q[tail++] = j;
    }
  }
  return n;
}

export function ascii(m) {
  const rows = [];
  for (let y = 0; y < m.H; y++) {
    let s = "";
    for (let x = 0; x < m.W; x++) {
      const i = idx(x, y);
      s += m.grid[i] === WALL ? "#" : m.pellets[i] === 2 ? "o" : m.pellets[i] === 1 ? "." : " ";
    }
    rows.push(s);
  }
  return rows.join("\n");
}
