// BoxPuzzle yard engine: random yard generator + beam-search solver.
// Runs as a Web Worker in the game (message {tier, id} -> progress... -> {type:'yard'}),
// and as a Node module for tests (require('./engine.js')).
'use strict';
(function () {
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDE_DIR = { top: 'up', bottom: 'down', left: 'left', right: 'right' };
const COLORS = ['r', 'b', 'y', 'g', 'p', 't'];

// Difficulty ladder: one tier per 5 cleared yards; the last tier repeats.
// fill = crate cells, extra = target moves beyond one per crate (par - crates).
const TIERS = [
  { w: 5, h: 5, colors: 3, fill: 11, walls: [0, 1], rails: [0, 0], keys: [0, 0], extra: [1, 3], minCrates: 4 },
  { w: 6, h: 6, colors: 4, fill: 17, walls: [0, 1], rails: [0, 1], keys: [0, 0], extra: [2, 4], minCrates: 7 },
  { w: 6, h: 6, colors: 5, fill: 21, walls: [1, 2], rails: [1, 2], keys: [0, 1], extra: [3, 5], minCrates: 8 },
  { w: 7, h: 7, colors: 5, fill: 27, walls: [1, 2], rails: [1, 3], keys: [1, 2], extra: [3, 6], minCrates: 10 },
  { w: 7, h: 7, colors: 6, fill: 31, walls: [1, 2], rails: [2, 3], keys: [2, 3], extra: [4, 7], minCrates: 12 },
  { w: 8, h: 8, colors: 6, fill: 38, walls: [1, 3], rails: [2, 4], keys: [2, 3], extra: [5, 8], minCrates: 14 },
  { w: 8, h: 8, colors: 6, fill: 41, walls: [1, 3], rails: [2, 5], keys: [2, 4], extra: [6, 11], minCrates: 15 },
];
const SIZES = [[1, 1], [1, 2], [2, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 1], [1, 2], [2, 2], [1, 3], [3, 1]];

function allowed(b) {
  return b.lock === 'h' ? ['left', 'right'] : b.lock === 'v' ? ['up', 'down'] : ['up', 'down', 'left', 'right'];
}
function exitAt(L, b, x, y) {
  for (const dir of allowed(b)) for (const e of L.exits) {
    if (e.color !== b.c || SIDE_DIR[e.side] !== dir) continue;
    if (dir === 'up' && y === 0 && x >= e.s && x + b.w <= e.s + e.len) return true;
    if (dir === 'down' && y + b.h === L.h && x >= e.s && x + b.w <= e.s + e.len) return true;
    if (dir === 'left' && x === 0 && y >= e.s && y + b.h <= e.s + e.len) return true;
    if (dir === 'right' && x + b.w === L.w && y >= e.s && y + b.h <= e.s + e.len) return true;
  }
  return false;
}

// ---------- solver ----------
// One move = one drag (any path through free cells). Exits are applied as soon as possible
// (never worse: it only frees space and opens padlocks), so the search runs over non-exit
// moves; par = crates + non-exit moves. Beam search: best found, not a proven minimum
// (it reproduced every known optimum on the original 53 hand-checked yards).
function beamSolve(L, opts) {
  opts = opts || {};
  const width = opts.width || 400, maxDepth = opts.maxDepth || 14, deadline = opts.deadline || Infinity;
  const W = L.w, H = L.h, B = L.blocks, n = B.length, N = W * H;
  const wall = new Uint8Array(N);
  for (const [x, y] of L.walls || []) wall[y * W + x] = 1;
  const exitTab = B.map(b => {
    const t = new Uint8Array(N);
    for (let y = 0; y + b.h <= H; y++) for (let x = 0; x + b.w <= W; x++) if (exitAt(L, b, x, y)) t[y * W + x] = 1;
    return t;
  });
  const sig = B.map(b => [b.c, b.w, b.h, b.lock || '', b.key || ''].join());
  const groups = [...new Set(sig)].map(g => sig.flatMap((t, i) => t === g ? [i] : []));
  const order = groups.flat(), gEnd = [];
  { let k = 0; for (const g of groups) { k += g.length; gEnd.push(k); } }
  const codes = new Array(n);
  const enc = s => { // identical crates are interchangeable: sort positions within each group
    let k = 0;
    for (let g = 0; g < gEnd.length; g++) {
      const a = k;
      for (; k < gEnd[g]; k++) codes[k] = s[order[k]] + 1;
      if (gEnd[g] - a > 1) { const part = codes.slice(a, gEnd[g]).sort((x, y) => x - y); for (let m = 0; m < part.length; m++) codes[a + m] = part[m]; }
    }
    return String.fromCharCode.apply(null, codes);
  };
  // per crate: footprint cells of each position, and neighbour positions (-1 = off-yard or wall)
  const area = B.map(b => b.w * b.h);
  const foot = B.map(b => {
    const f = new Int16Array(N * b.w * b.h).fill(-1);
    for (let y = 0; y + b.h <= H; y++) for (let x = 0; x + b.w <= W; x++) {
      let k = (y * W + x) * b.w * b.h;
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) f[k++] = (y + dy) * W + x + dx;
    }
    return f;
  });
  const nbr = B.map((b, i) => {
    const ds = allowed(b).map(d => DIRS[d]), t = new Int16Array(N * 4).fill(-1);
    for (let y = 0; y + b.h <= H; y++) for (let x = 0; x + b.w <= W; x++) ds.forEach(([dx, dy], k) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx + b.w > W || ny + b.h > H) return;
      const np = ny * W + nx;
      for (let m = 0; m < area[i]; m++) if (wall[foot[i][np * area[i] + m]]) return;
      t[(y * W + x) * 4 + k] = np;
    });
    return t;
  });
  const occ = new Int16Array(N);
  const seenBuf = new Uint8Array(N), dist = new Int16Array(N), dq = new Int16Array(4 * N), q = new Int16Array(N);

  function fill(s) {
    occ.fill(0);
    for (let i = 0; i < n; i++) if (s[i] >= 0) mark(i, s[i], i + 1);
  }
  function mark(i, p, v) {
    const f = foot[i], a = area[i], o = p * a;
    for (let m = 0; m < a; m++) occ[f[o + m]] = v;
  }
  function free(i, p) {
    const f = foot[i], a = area[i], o = p * a;
    for (let m = 0; m < a; m++) if (occ[f[o + m]]) return false;
    return true;
  }
  const keyIdx = B.map(b => b.key ? B.flatMap((o, j) => o.c === b.key ? [j] : []) : null);
  function unlocked(s, i) {
    const ks = keyIdx[i];
    if (!ks) return true;
    for (const j of ks) if (s[j] >= 0) return false;
    return true;
  }
  // flood the positions crate i can drag to; stops early when it can reach its gate
  function reach(s, i, collect) {
    const p0 = s[i];
    if (exitTab[i][p0]) return { exit: true };
    mark(i, p0, 0);
    seenBuf.fill(0); seenBuf[p0] = 1;
    const nb = nbr[i], ex = exitTab[i], out = collect ? [] : null;
    let qn = 0, exit = false;
    q[qn++] = p0;
    while (qn && !exit) {
      const p = q[--qn];
      for (let k = 0; k < 4; k++) {
        const np = nb[p * 4 + k];
        if (np < 0 || seenBuf[np] || !free(i, np)) continue;
        if (ex[np]) { exit = true; break; }
        seenBuf[np] = 1; q[qn++] = np; if (collect) out.push(np);
      }
    }
    mark(i, p0, i + 1);
    return { exit, pos: out };
  }
  function cascade(s) {
    fill(s);
    for (let any = true; any;) {
      any = false;
      for (let i = 0; i < n; i++) {
        if (s[i] < 0 || !unlocked(s, i)) continue;
        if (reach(s, i, false).exit) { mark(i, s[i], 0); s[i] = -1; any = true; }
      }
    }
  }
  // heuristic: per crate, fewest crates in the way of its gate (0-1 BFS), +2 while padlocked
  function score(s) {
    fill(s);
    let rem = 0, cost = 0;
    for (let i = 0; i < n; i++) {
      if (s[i] < 0) continue;
      rem++;
      if (!unlocked(s, i)) cost += 2;
      const nb = nbr[i], ex = exitTab[i], f = foot[i], a = area[i], me = i + 1;
      dist.fill(999);
      let head = 2 * N, tail = 2 * N, best = 99;
      dq[tail++] = s[i]; dist[s[i]] = 0;
      while (head < tail) {
        const p = dq[head++], d = dist[p];
        if (d >= best) continue;
        if (ex[p]) { best = d; continue; }
        for (let k = 0; k < 4; k++) {
          const np = nb[p * 4 + k];
          if (np < 0) continue;
          let c = 0;
          for (let m = 0, o = np * a; m < a; m++) { const v = occ[f[o + m]]; if (v && v !== me) { c = 1; break; } }
          const nd = d + c;
          if (nd < dist[np]) { dist[np] = nd; if (c) dq[tail++] = np; else dq[--head] = np; }
        }
      }
      cost += best;
    }
    return rem * 100 + cost;
  }

  const s0 = B.map(b => b.y * W + b.x);
  cascade(s0);
  if (s0.every(p => p < 0)) return { par: n, extra: 0, path: [] };
  const seen = new Set([enc(s0)]);
  let layer = [{ s: s0, path: [] }];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scored = [];
    for (const { s, path } of layer) {
      fill(s);
      for (let i = 0; i < n; i++) {
        if (s[i] < 0 || !unlocked(s, i)) continue;
        const r = reach(s, i, true);
        for (const p of r.pos) {
          const t = s.slice(); t[i] = p;
          const k0 = enc(t);
          if (seen.has(k0)) continue;
          seen.add(k0);
          cascade(t);
          const p2 = path.concat([[i, p % W, (p / W) | 0]]);
          if (t.every(q => q < 0)) return { par: n + depth, extra: depth, path: p2 };
          const k1 = enc(t);
          if (k1 !== k0) { if (seen.has(k1)) { fill(s); continue; } seen.add(k1); }
          scored.push({ s: t, path: p2, sc: score(t) });
          fill(s);
        }
        if (Date.now() > deadline) return null;
      }
    }
    scored.sort((a, b) => a.sc - b.sc);
    layer = scored.slice(0, width);
    if (!layer.length) return null;
  }
  return null;
}

// ---------- generator ----------
function rng(seed) {
  return function () { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0; let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function candidate(T, rnd) {
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const W = T.w, H = T.h;
  const colors = shuffle(COLORS.slice()).slice(0, T.colors);
  const target = T.fill + ri(-2, 2), nWalls = ri(T.walls[0], T.walls[1]), nRails = ri(T.rails[0], T.rails[1]), nKeys = ri(T.keys[0], T.keys[1]);
  const grid = new Uint8Array(W * H), walls = [];
  while (walls.length < nWalls) {
    const x = ri(1, W - 2), y = ri(1, H - 2);
    if (!grid[y * W + x]) { grid[y * W + x] = 1; walls.push([x, y]); }
  }
  const sizes = W <= 5 ? SIZES.filter(([w, h]) => w * h <= 3 && w < 3 && h < 3) : SIZES;
  const blocks = [];
  let filled = 0;
  for (let tries = 0; filled < target && tries < 2000; tries++) {
    const [w, h] = pick(sizes), x = ri(0, W - w), y = ri(0, H - h);
    let ok = true;
    for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w; dx++) if (grid[(y + dy) * W + x + dx]) { ok = false; break; }
    if (!ok) continue;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) grid[(y + dy) * W + x + dx] = 1;
    filled += w * h;
    blocks.push({ c: colors[blocks.length % colors.length], x, y, w, h });
  }
  if (filled < target - 2 || blocks.length < T.minCrates) return null;
  shuffle(blocks);
  for (const b of blocks.slice(0, nRails)) b.lock = b.w > b.h ? 'h' : b.h > b.w ? 'v' : pick(['h', 'v']);
  for (const b of blocks.slice(nRails, nRails + nKeys)) b.key = pick(colors.filter(c => c !== b.c));

  // gates: one per color, as wide as its largest crate along that edge, never overlapping
  const used = { top: [], bottom: [], left: [], right: [] }, exits = [];
  for (const c of shuffle(colors.slice())) {
    const mine = blocks.filter(b => b.c === c);
    const axes = new Set(mine.filter(b => b.lock).map(b => b.lock));
    if (axes.size > 1) return null;
    const sides = axes.has('h') ? ['left', 'right'] : axes.has('v') ? ['top', 'bottom'] : ['top', 'bottom', 'left', 'right'];
    let placed = false;
    for (const side of shuffle(sides.slice())) {
      const horiz = side === 'top' || side === 'bottom', span = horiz ? W : H;
      const len = Math.max(...mine.map(b => horiz ? b.w : b.h));
      const fixed = mine.filter(b => b.lock).map(b => horiz ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
      const starts = [];
      for (let s = 0; s + len <= span; s++) {
        if (used[side].some(([a, z]) => s < z && a < s + len)) continue;
        if (fixed.some(([a, z]) => a < s || z > s + len)) continue;
        starts.push(s);
      }
      if (!starts.length) continue;
      const s = pick(starts);
      used[side].push([s, s + len]); exits.push({ side, s, len, color: c });
      placed = true; break;
    }
    if (!placed) return null;
  }
  const L = { w: W, h: H, walls, exits, blocks };
  if (blocks.some(b => exitAt(L, b, b.x, b.y))) return null;
  // padlock chains must not loop
  const dep = {};
  for (const b of blocks) if (b.key) (dep[b.c] = dep[b.c] || new Set()).add(b.key);
  const loops = (c, path) => path.includes(c) || [...(dep[c] || [])].some(k => loops(k, path.concat(c)));
  if (colors.some(c => loops(c, []))) return null;
  // with only the walls in the yard, every crate must be able to reach its gate
  for (const b of blocks) {
    const seen = new Set([b.x + ',' + b.y]), q = [[b.x, b.y]];
    let ok = false;
    while (q.length && !ok) {
      const [x, y] = q.pop();
      if (exitAt(L, b, x, y)) { ok = true; break; }
      for (const d of allowed(b)) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx + b.w > W || ny + b.h > H || seen.has(nx + ',' + ny)) continue;
        if (walls.some(([wx, wy]) => wx >= nx && wx < nx + b.w && wy >= ny && wy < ny + b.h)) continue;
        seen.add(nx + ',' + ny); q.push([nx, ny]);
      }
    }
    if (!ok) return null;
  }
  return L;
}

// Build one solvable yard for a tier. Keeps trying until a yard lands in the tier's
// extra-moves band; after budgetMs it settles for the closest solvable yard found.
function generate(tierIndex, opts) {
  opts = opts || {};
  const T = TIERS[Math.min(tierIndex, TIERS.length - 1)];
  const budget = opts.budgetMs || 12000, hardStop = opts.hardStopMs || 60000;
  const onProgress = opts.onProgress || (() => {});
  const seed = opts.seed != null ? opts.seed : (Math.random() * 2 ** 31) | 0;
  const rnd = rng(seed);
  const t0 = Date.now();
  let best = null, tried = 0, solvable = 0;
  const closeness = e => e < T.extra[0] ? T.extra[0] - e : e > T.extra[1] ? e - T.extra[1] : 0;
  for (;;) {
    const L = candidate(T, rnd);
    if (!L) continue;
    tried++;
    onProgress({ tried, solvable, elapsed: Date.now() - t0, budget });
    const maxDepth = T.extra[1] + 3, deadline = t0 + hardStop;
    // cheap narrow search first: weeds out unsolvable yards (the expensive case) fast
    const quick = beamSolve(L, { width: 50, maxDepth, deadline });
    // a wider search can only lower par, so a yard already too easy is not worth refining
    const worth = quick && !(best && best.c === 0) && !(quick.extra < T.extra[0] && best && best.r.extra >= quick.extra);
    let r = quick;
    if (worth) {
      const full = beamSolve(L, { width: T.w >= 8 ? 200 : 300, maxDepth, deadline });
      if (full && full.par < r.par) r = full;
    }
    if (worth && r) {
      solvable++;
      // padlocks must change the solution, otherwise they are decoration
      let padsMatter = true;
      if (L.blocks.some(b => b.key)) {
        const free = beamSolve({ ...L, blocks: L.blocks.map(({ key, ...b }) => b) }, { width: 50, maxDepth, deadline });
        padsMatter = !free || free.par < r.par;
      }
      const c = closeness(r.extra) + (padsMatter ? 0 : 2);
      if (!best || c < best.c || (c === best.c && r.extra > best.r.extra)) best = { L, r, c };
      if (c === 0) break;
    }
    const el = Date.now() - t0;
    if ((best && el > budget) || el > hardStop) break;
  }
  if (!best) return null;
  const L = best.L;
  // tighten par on the chosen yard with a much wider search (only ever lowers it)
  const fine = beamSolve(L, { width: T.w >= 8 ? 1000 : 1500, maxDepth: T.extra[1] + 3, deadline: Date.now() + 8000 });
  if (fine && fine.par < best.r.par) best.r = fine;
  L.par = best.r.par;
  L.tier = Math.min(tierIndex, TIERS.length - 1);
  return { yard: L, solution: best.r.path, tried, solvable, ms: Date.now() - t0 };
}

const api = { TIERS, generate, beamSolve, exitAt, allowed };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.BoxEngine = api; // page: tier info + no-worker fallback
else if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  self.onmessage = e => {
    const { id, tier } = e.data;
    let last = 0;
    const res = generate(tier, {
      onProgress: p => { const now = Date.now(); if (now - last > 150) { last = now; self.postMessage({ type: 'progress', id, ...p }); } },
    });
    self.postMessage({ type: 'yard', id, yard: res && res.yard, tried: res && res.tried, ms: res && res.ms });
  };
}
})();
