// Beam search solver for yards too large for exact BFS.
// Exits are applied greedily (never worse), so the search runs over non-exit moves only;
// par = crates + non-exit moves. Returns the best solution found (an upper bound on the optimum).
'use strict';
const { allowed, exitAt } = require('./solver.js');
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function beamSolve(L, opts = {}) {
  const width = opts.width || 2000, maxDepth = opts.maxDepth || 25;
  const W = L.w, H = L.h, B = L.blocks, n = B.length, N = W * H;
  const wall = new Uint8Array(N);
  for (const [x, y] of L.walls || []) wall[y * W + x] = 1;
  const exitTab = B.map(b => {
    const t = new Uint8Array(N);
    for (let y = 0; y + b.h <= H; y++) for (let x = 0; x + b.w <= W; x++) if (exitAt(L, b, x, y)) t[y * W + x] = 1;
    return t;
  });
  const dirs = B.map(b => allowed(b).map(d => DIRS[d]));
  const sig = B.map(b => [b.c, b.w, b.h, b.lock || '', b.key || ''].join());
  const groups = [...new Set(sig)].map(g => sig.flatMap((t, i) => t === g ? [i] : []));
  const enc = s => String.fromCharCode(...groups.flatMap(g => g.map(i => s[i] + 1).sort((a, b) => a - b)));
  const occ = new Int16Array(N); // crate index + 1, or -1 for wall, 0 free

  function fill(s) {
    for (let i = 0; i < N; i++) occ[i] = wall[i] ? -1 : 0;
    for (let i = 0; i < n; i++) if (s[i] >= 0) mark(i, s[i], i + 1);
  }
  function mark(i, p, v) {
    const b = B[i], x = p % W, y = (p / W) | 0;
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) occ[(y + dy) * W + x + dx] = v;
  }
  function inside(i, x, y) { const b = B[i]; return x >= 0 && y >= 0 && x + b.w <= W && y + b.h <= H; }
  function free(i, x, y) {
    if (!inside(i, x, y)) return false;
    const b = B[i];
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) if (occ[(y + dy) * W + x + dx]) return false;
    return true;
  }
  function unlocked(s, i) {
    const k = B[i].key;
    if (!k) return true;
    for (let j = 0; j < n; j++) if (s[j] >= 0 && B[j].c === k) return false;
    return true;
  }
  function reach(s, i, collect) {
    const p0 = s[i];
    if (exitTab[i][p0]) return { exit: true };
    mark(i, p0, 0);
    const seen = new Uint8Array(N); seen[p0] = 1;
    const q = [p0], out = [];
    let exit = false;
    while (q.length && !exit) {
      const p = q.pop(), x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of dirs[i]) {
        const nx = x + dx, ny = y + dy, np = ny * W + nx;
        if (!free(i, nx, ny) || seen[np]) continue;
        if (exitTab[i][np]) { exit = true; break; }
        seen[np] = 1; q.push(np); if (collect) out.push(np);
      }
    }
    mark(i, p0, i + 1);
    return { exit, pos: out };
  }
  // apply all possible exits; returns count of exits
  function cascade(s) {
    fill(s);
    let any = true, cnt = 0;
    while (any) {
      any = false;
      for (let i = 0; i < n; i++) {
        if (s[i] < 0 || !unlocked(s, i)) continue;
        if (reach(s, i, false).exit) { mark(i, s[i], 0); s[i] = -1; cnt++; any = true; }
      }
    }
    return cnt;
  }
  // heuristic: per crate, fewest other crates it must get past to reach its gate (0-1 BFS),
  // plus a penalty while its padlock is shut
  function score(s) {
    fill(s);
    let rem = 0, cost = 0;
    for (let i = 0; i < n; i++) {
      if (s[i] < 0) continue;
      rem++;
      if (!unlocked(s, i)) cost += 2;
      const dist = new Int16Array(N).fill(999);
      const dq = [s[i]]; dist[s[i]] = 0;
      let best = 99;
      for (let h = 0; h < dq.length; h++) {
        const p = dq[h], x = p % W, y = (p / W) | 0, d = dist[p];
        if (d >= best) continue;
        if (exitTab[i][p]) { best = d; continue; }
        for (const [dx, dy] of dirs[i]) {
          const nx = x + dx, ny = y + dy;
          if (!inside(i, nx, ny)) continue;
          const b = B[i];
          let c = 0, wl = false;
          for (let ey = 0; ey < b.h; ey++) for (let ex = 0; ex < b.w; ex++) {
            const o = occ[(ny + ey) * W + nx + ex];
            if (o === -1) wl = true; else if (o && o !== i + 1) c = 1;
          }
          if (wl) continue;
          const np = ny * W + nx, nd = d + c;
          if (nd < dist[np]) { dist[np] = nd; dq.push(np); }
        }
      }
      cost += best;
    }
    return rem * 100 + cost;
  }

  const start = B.map(b => b.y * W + b.x);
  if (B.some((b, i) => exitTab[i][start[i]] && false)) return null;
  const s0 = start.slice(); cascade(s0);
  const seen = new Set([enc(s0)]);
  let layer = [{ s: s0, path: [] }];
  if (s0.every(p => p < 0)) return { par: n, extra: 0, path: [] };
  for (let depth = 1; depth <= maxDepth; depth++) {
    const kids = [];
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
          kids.push({ t, mv: [i, p % W, (p / W) | 0], path });
        }
        fill(s);
      }
    }
    const scored = [];
    for (const k of kids) {
      cascade(k.t);
      const path = k.path.concat([k.mv]);
      if (k.t.every(p => p < 0)) return { par: n + depth, extra: depth, path };
      const key = enc(k.t);
      if (key !== enc(k.t)) continue;
      seen.add(key);
      scored.push({ s: k.t, path, sc: score(k.t) + Math.random() * 0.5 });
    }
    scored.sort((a, b) => a.sc - b.sc);
    layer = scored.slice(0, width);
    if (!layer.length) return null;
  }
  return null;
}

module.exports = { beamSolve };

if (require.main === module) {
  const levels = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  const width = +process.argv[3] || 2000;
  let ok = 0, tot = 0;
  levels.forEach((L, i) => {
    const t = Date.now(), r = beamSolve(L, { width });
    ok += r && r.par === L.par; tot++;
    console.log(`${i + 1}\tpar ${L.par}\tbeam ${r && r.par}\t${Date.now() - t}ms`);
  });
  console.log(`${ok}/${tot} exact`);
}
