// BoxPuzzle solver: BFS over crate positions. One move = one drag: a crate slides
// along any path of free cells (rails restrict the axis). Reaching a position fully
// inside its own color's gate opening and touching that edge removes the crate.
// Padlocked crates (field "key": color) cannot move until every crate of that color
// has left the yard.
'use strict';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDE_DIR = { top: 'up', bottom: 'down', left: 'left', right: 'right' };

function allowed(b) {
  return b.lock === 'h' ? ['left', 'right'] : b.lock === 'v' ? ['up', 'down'] : ['up', 'down', 'left', 'right'];
}

function exitAt(L, b, x, y) {
  for (const dir of allowed(b)) {
    for (const e of L.exits) {
      if (e.color !== b.c || SIDE_DIR[e.side] !== dir) continue;
      if (dir === 'up' && y === 0 && x >= e.s && x + b.w <= e.s + e.len) return true;
      if (dir === 'down' && y + b.h === L.h && x >= e.s && x + b.w <= e.s + e.len) return true;
      if (dir === 'left' && x === 0 && y >= e.s && y + b.h <= e.s + e.len) return true;
      if (dir === 'right' && x + b.w === L.w && y >= e.s && y + b.h <= e.s + e.len) return true;
    }
  }
  return false;
}

// Returns {par, states} or {par:null} when unsolvable / over the state limit.
// With wantPath, also returns the move list.
function solve(L, opts = {}) {
  const limit = opts.limit || 3e6;
  const W = L.w, H = L.h, B = L.blocks, n = B.length;
  const wall = new Uint8Array(W * H);
  for (const [x, y] of L.walls || []) wall[y * W + x] = 1;
  const exitTab = B.map(b => {
    const t = new Uint8Array(W * H);
    for (let y = 0; y + b.h <= H; y++) for (let x = 0; x + b.w <= W; x++) if (exitAt(L, b, x, y)) t[y * W + x] = 1;
    return t;
  });
  const dirs = B.map(b => allowed(b).map(d => DIRS[d]));
  // Identical crates (same color, size, rail, padlock) are interchangeable: sort their
  // positions so permutations of them count as one state.
  const sig = B.map(b => [b.c, b.w, b.h, b.lock || '', b.key || ''].join());
  const groups = [...new Set(sig)].map(g => sig.flatMap((t, i) => t === g ? [i] : []));
  const enc = opts.wantPath ? (s => String.fromCharCode(...s.map(p => p + 1)))
    : (s => String.fromCharCode(...groups.flatMap(g => g.map(i => s[i] + 1).sort((a, b) => a - b))));
  const start = B.map(b => b.y * W + b.x);
  const occ = new Int8Array(W * H);

  function fill(s) {
    occ.fill(0);
    for (let i = 0; i < W * H; i++) if (wall[i]) occ[i] = 1;
    for (let i = 0; i < n; i++) if (s[i] >= 0) mark(i, s[i], 1);
  }
  function mark(i, p, v) {
    const b = B[i], x = p % W, y = (p / W) | 0;
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) occ[(y + dy) * W + x + dx] += v;
  }
  function free(i, x, y) {
    const b = B[i];
    if (x < 0 || y < 0 || x + b.w > W || y + b.h > H) return false;
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) if (occ[(y + dy) * W + x + dx]) return false;
    return true;
  }
  function unlocked(s, i) {
    const k = B[i].key;
    if (!k) return true;
    for (let j = 0; j < n; j++) if (s[j] >= 0 && B[j].c === k) return false;
    return true;
  }
  // reachable positions of crate i: {exit:bool, pos:[...]}
  function reach(s, i) {
    const p0 = s[i];
    if (exitTab[i][p0]) return { exit: true };
    mark(i, p0, -1);
    const seen = new Set([p0]), q = [p0], out = [];
    let exit = false;
    while (q.length && !exit) {
      const p = q.pop(), x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of dirs[i]) {
        const nx = x + dx, ny = y + dy, np = ny * W + nx;
        if (!free(i, nx, ny) || seen.has(np)) continue;
        if (exitTab[i][np]) { exit = true; break; }
        seen.add(np); q.push(np); out.push(np);
      }
    }
    mark(i, p0, 1);
    return { exit, pos: out };
  }

  const seen = new Map([[enc(start), null]]);
  let frontier = [start], depth = 0, states = 1;
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      if (s.every(p => p < 0)) {
        const res = { par: depth, states };
        if (opts.wantPath) {
          const path = []; let k = enc(s);
          while (seen.get(k)) { const [pk, mv] = seen.get(k); path.unshift(mv); k = pk; }
          res.path = path;
        }
        return res;
      }
      fill(s);
      const key = enc(s);
      const succ = [];
      let forced = null;
      for (let i = 0; i < n && !forced; i++) {
        if (s[i] < 0 || !unlocked(s, i)) continue;
        const r = reach(s, i);
        if (r.exit) { const t = s.slice(); t[i] = -1; forced = [t, [i, 'exit']]; break; }
        for (const p of r.pos) { const t = s.slice(); t[i] = p; succ.push([t, [i, p % W, (p / W) | 0]]); }
      }
      // Exiting a crate as soon as it can is never worse (it only frees space and unlocks padlocks).
      for (const [t, mv] of forced ? [forced] : succ) {
        const k = enc(t);
        if (seen.has(k)) continue;
        seen.set(k, opts.wantPath ? [key, mv] : 1);
        next.push(t);
        if (++states > limit) return { par: null, states, overflow: true };
      }
    }
    frontier = next; depth++;
  }
  return { par: null, states };
}

module.exports = { solve, allowed, exitAt };

if (require.main === module) {
  const levels = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  let ok = 0;
  levels.forEach((L, i) => {
    const t = Date.now(), r = solve(L);
    const match = r.par === L.par;
    ok += match;
    console.log(`${i + 1}\tpar ${L.par}\tsolver ${r.par}\tstates ${r.states}\t${Date.now() - t}ms${match ? '' : '\tMISMATCH'}`);
  });
  console.log(`${ok}/${levels.length} match`);
}
