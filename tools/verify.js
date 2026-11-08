// Independent replay check: plays a beam solution with the game's own rules
// (copied from index.html: allowed/exitFits/fits/occSet) and confirms every crate leaves.
'use strict';
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDE_DIR = { top: 'up', bottom: 'down', left: 'left', right: 'right' };
function allowed(b) { return b.lock === 'h' ? ['left', 'right'] : b.lock === 'v' ? ['up', 'down'] : ['up', 'down', 'left', 'right']; }
function exitFits(L, b, x, y, dir) {
  if (!allowed(b).includes(dir)) return false;
  return L.exits.some(e => {
    if (e.color !== b.c || SIDE_DIR[e.side] !== dir) return false;
    if (dir === 'up') return y === 0 && x >= e.s && x + b.w <= e.s + e.len;
    if (dir === 'down') return y + b.h === L.h && x >= e.s && x + b.w <= e.s + e.len;
    if (dir === 'left') return x === 0 && y >= e.s && y + b.h <= e.s + e.len;
    return x + b.w === L.w && y >= e.s && y + b.h <= e.s + e.len;
  });
}
function occSet(L, blocks, skip) {
  const g = new Set((L.walls || []).map(([x, y]) => x + ',' + y));
  for (const o of blocks) { if (o === skip || o.gone) continue; for (let dx = 0; dx < o.w; dx++) for (let dy = 0; dy < o.h; dy++) g.add((o.x + dx) + ',' + (o.y + dy)); }
  return g;
}
function fits(L, g, b, x, y) { if (x < 0 || y < 0 || x + b.w > L.w || y + b.h > L.h) return false; for (let dx = 0; dx < b.w; dx++) for (let dy = 0; dy < b.h; dy++) if (g.has((x + dx) + ',' + (y + dy))) return false; return true; }
function isLocked(blocks, b) { return !!b.key && blocks.some(o => !o.gone && o.c === b.key); }
const atExit = (L, b) => allowed(b).some(d => exitFits(L, b, b.x, b.y, d));

// BFS path for crate b to (tx,ty) or to any exit (tx=null); returns true if reachable
function canReach(L, blocks, b, tx, ty) {
  const g = occSet(L, blocks, b), seen = new Set([b.x + ',' + b.y]), q = [[b.x, b.y]];
  if (tx == null && atExit(L, b)) return true;
  while (q.length) {
    const [x, y] = q.shift();
    for (const d of allowed(b)) {
      const nx = x + DV[d][0], ny = y + DV[d][1];
      if (!fits(L, g, b, nx, ny) || seen.has(nx + ',' + ny)) continue;
      const exitHere = atExit(L, { ...b, x: nx, y: ny });
      if (tx == null && exitHere) return true;
      if (exitHere) continue; // the game would pull it out here
      if (nx === tx && ny === ty) return true;
      seen.add(nx + ',' + ny); q.push([nx, ny]);
    }
  }
  return false;
}

function replay(L, path) {
  const blocks = L.blocks.map(b => ({ ...b, gone: false }));
  let moves = 0;
  const exitAll = () => {
    for (let any = true; any;) {
      any = false;
      for (const b of blocks) if (!b.gone && !isLocked(blocks, b) && canReach(L, blocks, b, null)) { b.gone = true; moves++; any = true; }
    }
  };
  exitAll();
  for (const [i, x, y] of path) {
    const b = blocks[i];
    if (b.gone) return { ok: false, why: `crate ${i} already gone` };
    if (isLocked(blocks, b)) return { ok: false, why: `crate ${i} padlocked` };
    if (!canReach(L, blocks, b, x, y)) return { ok: false, why: `crate ${i} cannot reach ${x},${y}` };
    b.x = x; b.y = y; moves++;
    exitAll();
  }
  return { ok: blocks.every(b => b.gone), moves };
}
module.exports = { replay };
