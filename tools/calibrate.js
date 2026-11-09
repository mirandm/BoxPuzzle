// Measures generation time and difficulty per tier: node tools/calibrate.js <tier> [runs]
const { generate, TIERS } = require('../engine.js');
const t = +process.argv[2], runs = +process.argv[3] || 4;
for (let i = 0; i < runs; i++) {
  const r = generate(t, { seed: 1000 * t + i });
  const L = r.yard;
  console.log(`tier ${t} ${L.w}x${L.h} crates ${L.blocks.length} par ${L.par} extra ${L.par - L.blocks.length} (target ${TIERS[t].extra}) rails ${L.blocks.filter(b => b.lock).length} pads ${L.blocks.filter(b => b.key).length} | ${r.ms}ms tried ${r.tried} solvable ${r.solvable}`);
}
