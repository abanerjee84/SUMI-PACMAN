import { generateMaze, mulberry32, ascii, bfs, idx, W, H, FLOOR } from "../src/game/maze.js";

function stats(m) {
  const d = new Int16Array(W * H);
  bfs(m.grid, [m.spawn], d);
  let pellets = 0, powers = 0, floor = 0, unreach = 0, houseOk = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (m.grid[i] === FLOOR) { floor++; if (d[i] < 0) unreach++; }
    if (m.pellets[i] === 1) pellets++;
    if (m.pellets[i] === 2) powers++;
  }
  for (const t of m.houseTiles) if (d[idx(t.x, t.y)] >= 0) houseOk++;
  return { pellets, powers, floor, unreach, houseOk, exit: d[idx(m.houseExit.x, m.houseExit.y)] };
}

const badSeeds = [];
for (let s = 0; s < 600; s++) {
  const m = generateMaze(mulberry32(s));
  const st = stats(m);
  if (st.houseOk < 4 || st.pellets < 60 || st.powers < 4) badSeeds.push([s, st]);
}
console.log("bad:", badSeeds.length, "of 600");
for (const [s, st] of badSeeds.slice(0, 6)) console.log(s, JSON.stringify(st));
if (badSeeds.length) {
  const s = badSeeds[0][0];
  console.log(`\n--- seed ${s} ---`);
  console.log(ascii(generateMaze(mulberry32(s))));
}
