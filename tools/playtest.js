// End-to-end check: plays yards in headless Chromium with real mouse drags along a beam
// solution, then confirms the win screen and that the move count equals par.
// usage: node tools/playtest.js http://localhost:8000/ 54-73
'use strict';
// End-to-end check of endless mode: plays generated yards in headless Chromium with real mouse
// drags along a solver solution, checks the win screen, level-ups and the wait for the next yard.
// usage: python3 -m http.server 8765 & node tools/playtest.js http://localhost:8765/ <startCleared> <yards>
const { chromium } = require('playwright');
const { beamSolve } = require('../engine.js');
const { replay } = require('./verify.js');

const URL = process.argv[2], START = +(process.argv[3] || 0), COUNT = +(process.argv[4] || 6);
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(([c, first]) => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.clear(); localStorage.setItem('bp-cleared', String(c)); } }, [START]);
  await page.goto(URL);
  let fails = 0;
  for (let k = 0; k < COUNT; k++) {
    const t0 = Date.now();
    await page.waitForFunction(() => typeof L !== 'undefined' && L && !yard.hidden, null, { timeout: 180000 });
    const wait = Date.now() - t0;
    await page.waitForTimeout(150);
    const L = await page.evaluate(() => L);
    const label = await page.evaluate(() => document.querySelector('#lvname').firstChild.textContent);
    const sol = beamSolve(L, { width: 2000, maxDepth: 16 });
    const getBlocks = () => page.evaluate(() => blocks.map(b => ({ ...b })));
    const box = await page.locator('#board').boundingBox();
    const cell = await page.evaluate(() => cell);
    const drag = async (b, dirs) => {
      let px = box.x + (b.x + 0.5) * cell, py = box.y + (b.y + 0.5) * cell;
      await page.mouse.move(px, py); await page.mouse.down();
      for (const d of dirs) { px += DV[d][0] * cell; py += DV[d][1] * cell; await page.mouse.move(px, py, { steps: 3 }); }
      await page.mouse.up(); await page.waitForTimeout(120);
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
          await drag(b, dirs); await page.waitForTimeout(320);
          if (!(await getBlocks())[b.id].gone) throw new Error(`crate ${b.id} did not exit`);
          any = true; break;
        }
      }
    };
    let why;
    try {
      if (!sol) throw new Error('test solver found no solution');
      const rp = replay(L, sol.path);
      if (!rp.ok) throw new Error('independent replay failed: ' + rp.why);
      const bs0 = await getBlocks(), lk = bs0.find(b => locked(bs0, b));
      if (lk) { // a padlocked crate must refuse to move
        const d = ['up', 'down', 'left', 'right'].find(d => route(L, bs0.map(o => ({ ...o, key: undefined })), { ...lk, key: undefined }, lk.x + DV[d][0], lk.y + DV[d][1]));
        if (d) { await drag(lk, [d]); const a = (await getBlocks())[lk.id]; if (a.x !== lk.x || a.y !== lk.y) throw new Error('padlocked crate moved'); }
      }
      await exitAll();
      for (const [i, x, y] of sol.path) {
        const bs = await getBlocks(), dirs = route(L, bs, bs[i], x, y);
        if (!dirs) throw new Error(`no route for crate ${i}`);
        await drag(bs[i], dirs);
        await exitAll();
      }
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => ({ won, moves, cleared, h2: document.querySelector('.win h2')?.textContent }));
      if (!st.won) throw new Error('not won');
      if (st.moves > L.par) throw new Error(`moves ${st.moves} > par ${L.par}`);
      why = `ok ${st.moves} moves (par ${L.par}${st.moves < L.par ? ', beaten' : ''}) · "${st.h2}" · waited ${wait}ms`;
      if (errs.length) throw new Error(errs.join('; '));
      await page.click('#go');
    } catch (e) { why = 'FAIL ' + e.message; fails++; }
    console.log(`${label} ${L.w}x${L.h} ${L.blocks.length} crates: ${why}`);
    if (why.startsWith('FAIL')) break;
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
