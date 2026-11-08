// Random yard generator for the large padlock yards.
// usage: node gen.js <seed> <seconds> <out.jsonl> [w] [h]
// Writes every solver-verified candidate (exact par within the state limit) as one JSON line.
'use strict';
const fs = require('fs');
const { exitAt, allowed } = require('./solver.js');
const { beamSolve } = require('./beam.js');

let seed = +process.argv[2] || 1;
const rnd = () => { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0; let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SECS = +process.argv[3] || 60, OUT = process.argv[4] || 'out.jsonl';
const W = +process.argv[5] || 8, H = +process.argv[6] || 8;
const SIZES = [[1, 1], [1, 2], [2, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 1], [1, 2], [2, 2], [1, 3], [3, 1]];
const FILL = +process.env.FILL || 42;
const COLORS = ['r', 'b', 'y', 'g', 'p', 't'];

function candidate() {
  const target = FILL + ri(-2, 2), nWalls = ri(1, 3), nRails = ri(2, 5), nKeys = ri(2, 4);
  const colors = shuffle(COLORS.slice()).slice(0, ri(5, 6));
  const grid = new Uint8Array(W * H);
  const walls = [];
  while (walls.length < nWalls) {
    const x = ri(1, W - 2), y = ri(1, H - 2);
    if (!grid[y * W + x]) { grid[y * W + x] = 1; walls.push([x, y]); }
  }
  const blocks = [];
  let filled = 0;
  for (let tries = 0; filled < target && tries < 2000; tries++) {
    const [w, h] = pick(SIZES), x = ri(0, W - w), y = ri(0, H - h);
    let ok = true;
    for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w; dx++) if (grid[(y + dy) * W + x + dx]) { ok = false; break; }
    if (!ok) continue;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) grid[(y + dy) * W + x + dx] = 1;
    filled += w * h;
    blocks.push({ c: colors[blocks.length % colors.length], x, y, w, h });
  }
  if (filled < target || blocks.length < 14) return null;
  shuffle(blocks);
  // rails: a long crate rides along its long axis, a square/single one either way
  for (const b of blocks.slice(0, nRails)) b.lock = b.w > b.h ? 'h' : b.h > b.w ? 'v' : pick(['h', 'v']);
  // padlocks on other crates, keyed to a different color
  for (const b of blocks.slice(nRails, nRails + nKeys)) b.key = pick(colors.filter(c => c !== b.c));

  // gates: one per color, as wide as the color's largest crate along that edge
  const used = { top: [], bottom: [], left: [], right: [] };
  const exits = [];
  for (const c of shuffle(colors.slice())) {
    const mine = blocks.filter(b => b.c === c);
    const axes = new Set(mine.filter(b => b.lock).map(b => b.lock));
    if (axes.size > 1) return null;
    const sides = axes.has('h') ? ['left', 'right'] : axes.has('v') ? ['top', 'bottom'] : ['top', 'bottom', 'left', 'right'];
    let placed = false;
    for (const side of shuffle(sides.slice())) {
      const horiz = side === 'top' || side === 'bottom', span = horiz ? W : H;
      const len = Math.max(...mine.map(b => horiz ? b.w : b.h));
      // rail crates are fixed across the rail: the gate must cover their fixed span
      const fixed = mine.filter(b => b.lock).map(b => horiz ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
      const starts = [];
      for (let s = 0; s + len <= span; s++) {
        if (used[side].some(([a, z]) => s < z && a < s + len)) continue;
        if (fixed.some(([a, z]) => a < s || z > s + len)) continue;
        starts.push(s);
      }
      if (!starts.length) continue;
      const s = pick(starts);
      used[side].push([s, s + len]);
      exits.push({ side, s, len, color: c });
      placed = true; break;
    }
    if (!placed) return null;
  }
  const L = { w: W, h: H, walls, exits, blocks };
  // nobody may already sit in an exit at the start
  if (blocks.some(b => exitAt(L, b, b.x, b.y))) return null;
  // padlock chains must not loop (red waits for blue while blue waits for red)
  const dep = {};
  for (const b of blocks) if (b.key) (dep[b.c] = dep[b.c] || new Set()).add(b.key);
  const loops = (c, path) => path.includes(c) || [...(dep[c] || [])].some(k => loops(k, path.concat(c)));
  if (colors.some(c => loops(c, []))) return null;
  // with only the walls in the yard, every crate must be able to reach its gate
  const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  for (const b of blocks) {
    const seen = new Set([b.x + ',' + b.y]), q = [[b.x, b.y]];
    let ok = false;
    while (q.length && !ok) {
      const [x, y] = q.pop();
      if (exitAt(L, b, x, y)) { ok = true; break; }
      for (const d of allowed(b)) {
        const nx = x + D[d][0], ny = y + D[d][1];
        if (nx < 0 || ny < 0 || nx + b.w > W || ny + b.h > H || seen.has(nx + ',' + ny)) continue;
        if (walls.some(([wx, wy]) => wx >= nx && wx < nx + b.w && wy >= ny && wy < ny + b.h)) continue;
        seen.add(nx + ',' + ny); q.push([nx, ny]);
      }
    }
    if (!ok) return null;
  }
  return L;
}

const end = Date.now() + SECS * 1000;
let tried = 0, solved = 0;
while (Date.now() < end) {
  const L = candidate();
  if (!L) continue;
  tried++;
  const r = beamSolve(L, { width: 500, maxDepth: 12 });
  if (!r) continue;
  L.par = r.par;
  solved++;
  fs.appendFileSync(OUT, JSON.stringify({ extra: r.extra, L }) + '\n');
}
console.error(`seed done: tried ${tried}, solved ${solved}`);
