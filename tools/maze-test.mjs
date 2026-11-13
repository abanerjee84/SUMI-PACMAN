/* Headless maze invariant check: node tools/maze-test.mjs */
import { generateMaze, mulberry32, ascii, bfs, idx, W, H, FLOOR } from "../src/game/maze.js";

let minP = 1e9, maxP = 0, bad = 0, minReach = 1e9;
const rng = mulberry32(1234);
for (let n = 0; n < 400; n++) {
  const m = generateMaze(rng);
  const d = new Int16Array(W * H);
  bfs(m.grid, [m.spawn], d);
  let reach = 0, pellets = 0, powers = 0, houseOk = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (m.grid[i] === FLOOR) {
        if (d[i] >= 0) reach++;
        else bad++;
      }
      if (m.pellets[i] === 1) pellets++;
      if (m.pellets[i] === 2) powers++;
    }
  }
  for (const t of m.houseTiles) if (d[idx(t.x, t.y)] >= 0) houseOk++;
  if (houseOk < 4) console.log("house unreachable in", m.houseTiles, "seed iter", n);
  if (d[idx(m.houseExit.x, m.houseExit.y)] < 0) console.log("house exit unreachable, iter", n);
  if (powers !== 4) console.log("power pellets =", powers, "iter", n);
  minP = Math.min(minP, pellets);
  maxP = Math.max(maxP, pellets);
  minReach = Math.min(minReach, reach);
}
console.log(`pellets min=${minP} max=${maxP}  floor-reachable-from-spawn min=${minReach}  unreachable floor tiles=${bad}`);
const m = generateMaze(mulberry32(7));
console.log(ascii(m));
console.log("spawn", m.spawn, "exit", m.houseExit, "house", m.houseTiles.map((t) => `${t.x},${t.y}`).join(" "));
