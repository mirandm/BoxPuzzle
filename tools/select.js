// Pick the new yards from a generated pool, tighten par with a wide beam, replay-verify.
// usage: node select.js score pool.jsonl shard nShards scored.jsonl   (parallel scoring)
//        node select.js pick scored.jsonl out.json
'use strict';
const fs = require('fs');
const { beamSolve } = require('./beam.js');
const { replay } = require('./verify.js');

const readJsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
if (process.argv[2] === 'score') {
const [, , , poolFile, shard, nShards, outFile] = process.argv;
const pool = readJsonl(poolFile).filter((x, i) => x.extra >= 3 && i % +nShards === +shard);
for (const { L } of pool) {
  const r = beamSolve(L, { width: 3000, maxDepth: 14 });
  if (!r) continue;
  const v = replay(L, r.path);
  if (!v.ok || v.moves !== r.par) { console.error('replay failed', v); continue; }
  const free = beamSolve({ ...L, blocks: L.blocks.map(({ key, ...b }) => b) }, { width: 1500, maxDepth: 14 });
  // a yard where something can leave straight away is a weaker opener
  fs.appendFileSync(outFile, JSON.stringify({ L: { ...L, par: r.par }, extra: r.extra, keyGain: free ? r.par - free.par : 99, crates: L.blocks.length }) + '\n');
}
process.exit(0);
}
const scored = readJsonl(process.argv[3]);
console.error('scored', scored.length);

// tutorial for padlocks: easiest yard with exactly 2 padlocks that matter
const pickOne = f => { const i = scored.findIndex(f); return i < 0 ? null : scored.splice(i, 1)[0]; };
scored.sort((a, b) => a.extra - b.extra || a.crates - b.crates);
const intro = pickOne(x => x.extra >= 3 && x.keyGain >= 1 && x.L.blocks.filter(b => b.key).length === 2 && x.crates <= 16);

// the rest: padlocks must matter, ramp by extra moves
const rest = scored.filter(x => x.keyGain >= 1 && x.extra >= 5)
  .sort((a, b) => a.extra - b.extra || a.crates - b.crates);
const N = 19;
let chosen = rest;
if (rest.length > N) { // spread evenly, always keep the hardest
  chosen = [];
  for (let k = 0; k < N; k++) chosen.push(rest[Math.round(k * (rest.length - 1) / (N - 1))]);
}
const out = [intro, ...chosen].filter(Boolean).map(x => x.L);
for (const x of [intro, ...chosen].filter(Boolean)) console.error(`par ${x.L.par}\textra ${x.extra}\tkeyGain ${x.keyGain}\tcrates ${x.crates}\tpadlocks ${x.L.blocks.filter(b => b.key).length}\trails ${x.L.blocks.filter(b => b.lock).length}`);
fs.writeFileSync(process.argv[4], JSON.stringify(out));
