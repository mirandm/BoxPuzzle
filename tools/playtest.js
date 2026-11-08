// End-to-end check: plays yards in headless Chromium with real mouse drags along a beam
// solution, then confirms the win screen and that the move count equals par.
// usage: node tools/playtest.js http://localhost:8000/ 54-73
'use strict';
const { chromium } = require('playwright');
const { beamSolve } = require('./beam.js');

const URL = process.argv[2], [from, to] = (process.argv[3] || '54-73').split('-').map(Number);
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDE_DIR = { top: 'up', bottom: 'down', left: 'left', right: 'right' };
const allowed = b => b.lock === 'h' ? ['left', 'right'] : b.lock === 'v' ? ['up', 'down'] : ['up', 'down', 'left', 'right'];
const locked = (bs, b) => !!b.key && bs.some(o => !o.gone && o.c === b.key);
function exitDir(L, b, x, y) {
  for (const d of allowed(b)) for (const e of L.exits) {
    if (e.color !== b.c || SIDE_DIR[e.side] !== d) continue;
    if (d === 'up' && y === 0 && x >= e.s && x + b.w <= e.s + e.len) return d;
    if (d === 'down' && y + b.h === L.h && x >= e.s && x + b.w <= e.s + e.len) return d;
    if (d === 'left' && x === 0 && y >= e.s && y + b.h <= e.s + e.len) return d;
    if (d === 'right' && x + b.w === L.w && y >= e.s && y + b.h <= e.s + e.len) return d;
  }
  return null;
}
// list of directions taking crate b to (tx,ty), or to any exit position when tx is null
function route(L, bs, b, tx, ty) {
  const occ = new Set((L.walls || []).map(([x, y]) => x + ',' + y));
  for (const o of bs) if (o !== b && !o.gone) for (let dx = 0; dx < o.w; dx++) for (let dy = 0; dy < o.h; dy++) occ.add((o.x + dx) + ',' + (o.y + dy));
  const fits = (x, y) => { if (x < 0 || y < 0 || x + b.w > L.w || y + b.h > L.h) return false; for (let dx = 0; dx < b.w; dx++) for (let dy = 0; dy < b.h; dy++) if (occ.has((x + dx) + ',' + (y + dy))) return false; return true; };
  const prev = new Map([[b.x + ',' + b.y, null]]), q = [[b.x, b.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const d of allowed(b)) {
      const nx = x + DV[d][0], ny = y + DV[d][1], k = nx + ',' + ny;
      if (!fits(nx, ny) || prev.has(k)) continue;
      prev.set(k, [x + ',' + y, d]);
      const ex = exitDir(L, b, nx, ny);
      if ((tx == null && ex) || (nx === tx && ny === ty)) {
        const dirs = []; let c = k;
        while (prev.get(c)) { const [p, dd] = prev.get(c); dirs.unshift(dd); c = p; }
        return dirs;
      }
      if (!ex) q.push([nx, ny]);
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  for (let n = from; n <= to; n++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(n => { localStorage.setItem('crate2-unlocked', '99'); localStorage.setItem('crate2-level', String(n)); }, n);
    await page.goto(URL);
    await page.waitForTimeout(300);
    const L = await page.evaluate(() => L);
    const sol = beamSolve(L, { width: 3000, maxDepth: 14 });
    const getBlocks = () => page.evaluate(() => blocks.map(b => ({ ...b })));
    const box = await page.locator('#board').boundingBox();
    const cell = await page.evaluate(() => cell);
    const drag = async (b, dirs) => {
      let px = box.x + (b.x + 0.5) * cell, py = box.y + (b.y + 0.5) * cell;
      await page.mouse.move(px, py); await page.mouse.down();
      for (const d of dirs) {
        px += DV[d][0] * cell; py += DV[d][1] * cell;
        await page.mouse.move(px, py, { steps: 3 });
      }
      await page.mouse.up();
      await page.waitForTimeout(140);
    };
    const exitAll = async () => {
      for (let any = true; any;) {
        any = false;
        const bs = await getBlocks();
        for (const b of bs) {
          if (b.gone || locked(bs, b)) continue;
          const at = exitDir(L, b, b.x, b.y);
          const dirs = at ? [at] : route(L, bs, b, null);
          if (!dirs) continue;
          await drag(b, dirs); await page.waitForTimeout(330);
          if (!(await getBlocks())[b.id].gone) throw new Error(`crate ${b.id} did not exit`);
          any = true; break;
        }
      }
    };
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('N', n) });
    let why = '';
    try {
      // a padlocked crate must refuse to move
      const bs0 = await getBlocks();
      const lockedOne = bs0.find(b => locked(bs0, b));
      if (lockedOne) {
        const ok = ['up', 'down', 'left', 'right'].find(d => route(L, bs0.map(o => ({ ...o, key: undefined })), { ...lockedOne, key: undefined }, lockedOne.x + DV[d][0], lockedOne.y + DV[d][1]));
        if (ok) {
          await drag(lockedOne, [ok]);
          const after = (await getBlocks())[lockedOne.id];
          if (after.x !== lockedOne.x || after.y !== lockedOne.y) throw new Error('padlocked crate moved');
          if (await page.evaluate(() => moves) !== 0) throw new Error('padlocked drag counted a move');
        }
      }
      await exitAll();
      for (const [i, x, y] of sol.path) {
        const bs = await getBlocks();
        const dirs = route(L, bs, bs[i], x, y);
        if (!dirs) throw new Error(`no route for crate ${i} to ${x},${y}`);
        await drag(bs[i], dirs);
        const b = (await getBlocks())[i];
        if (b.x !== x || b.y !== y) throw new Error(`crate ${i} ended at ${b.x},${b.y} not ${x},${y}`);
        await exitAll();
      }
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => ({ won, moves, win: !!document.querySelector('.win') }));
      if (!st.won || !st.win) throw new Error('not won');
      if (st.moves !== L.par) throw new Error(`moves ${st.moves} != par ${L.par}`);
      if (errs.length) throw new Error(errs.join('; '));
      why = `ok, ${st.moves} moves = par`;
    } catch (e) { why = 'FAIL ' + e.message; fails++; }
    console.log(`yard ${n}: ${why}`);
    await page.close();
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
