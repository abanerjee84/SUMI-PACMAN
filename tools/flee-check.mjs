/* Sanity check on the threat metric: a policy that always flees should score
   ~100% "moved away". */
const { Sim, STATE_SIZE } = await import("../src/game/sim.js");
const { W, H, idx, DIRS, bfs, TUNNEL_Y, FLOOR } = await import("../src/game/maze.js");
const { MODE, tileOf } = await import("../src/game/ghost-brain.js");
const distD = new Int16Array(W * H);
function nextTile(grid, x, y, d) {
  let nx = x + DIRS[d].x;
  const ny = y + DIRS[d].y;
  if (y === TUNNEL_Y) nx = ((nx % W) + W) % W;
  else if (nx < 0 || nx >= W) return -1;
  if (ny < 0 || ny >= H) return -1;
  const j = idx(nx, ny);
  return grid[j] !== FLOOR ? -1 : j;
}
let away = 0, into = 0, still = 0, ticks = 0, deaths = 0, pel = 0, time = 0;
const rnd = () => (Math.random() * 2147483647) | 0;
const sim = new Sim(rnd(), {
  chooseAction(s2, s, mask) {
    const grid = s2.maze.grid;
    const t = tileOf(s2.pacman);
    const me = idx(t.x, t.y);
    const danger = [];
    for (const g of s2.ghosts) {
      if (g.mode === MODE.EATEN || g.mode === MODE.HOME || !g.released) continue;
      if (s2.power > 0 && g.mode === MODE.FRIGHTENED) continue;
      const gt = tileOf(g);
      danger.push(idx(gt.x, gt.y));
    }
    if (!danger.length) return (Math.random() * 4) | 0;
    bfs(grid, danger, distD);
    let best = -1, bv = -1;
    for (let d = 0; d < 4; d++) {
      const j = nextTile(grid, t.x, t.y, d);
      if (j < 0 || !(mask & (1 << d))) continue;
      const v = distD[j] < 0 ? -1 : distD[j];
      if (v > bv) { bv = v; best = d; }
    }
    const a = best < 0 ? 0 : best;
    const j = nextTile(grid, t.x, t.y, a);
    if (j >= 0 && distD[me] >= 0 && distD[me] <= 4 && distD[j] >= 0) {
      ticks++;
      if (distD[j] > distD[me]) away++;
      else if (distD[j] < distD[me]) into++;
      else still++;
    }
    return a;
  },
});
sim.envId = 7;
for (let k = 0; k < 30; k++) {
  let j = 0;
  while (!sim.done && j < 12000) { sim.advance(0.05); j++; }
  pel += sim.pelletsEaten; time += sim.time; if (!sim.won) deaths++;
  sim.reset(rnd());
}
console.log(`pure-flee: threat ticks ${ticks} · away ${(100*away/ticks).toFixed(0)}% · into ${(100*into/ticks).toFixed(0)}% · still ${(100*still/ticks).toFixed(0)}%`);
console.log(`survived ${(time/30).toFixed(1)}s avg, pellets ${(pel/30).toFixed(1)}, deaths ${deaths}/30`);
