# BoxPuzzle: handoff

## Game
Sliding-crate puzzle (single HTML file, vanilla JS, no build). Colored crates in a fenced grid
must leave through the gate of their own color. Crates move only horizontally/vertically,
dragged cell by cell until blocked.

## Rules agreed so far
- A crate exits automatically when it sits fully inside the opening of its own color's gate
  and touches that fence edge. Any overhang = no exit.
- Each gate is exactly as wide as the largest crate of its color, measured along the gate
  (top/bottom gates = crate width, side gates = crate height). Smaller crates of that color
  fit with slack. Gates never overlap; a color without crates has no gate.
- Crates on rails: field "lock":"v" or "h", can only slide along that axis (from yard 5 on),
  shown with arrows at the ends.
- Padlocked crates: field "key":"<color>" (from yard 54 on). A padlocked crate cannot move or exit
  until every crate of the key color has left. Shown hatched with a padlock badge in the key color
  (with that color's glyph); the badge drops away when it opens. Padlock chains never loop.
- 6 colors (r, b, y, g, p, t=teal), each with a shape glyph for colorblind play.
- Walls = hazard-striped blocked cells.
- One drag = one move. Undo, restart, move counter, best per yard.
- Progress in localStorage, prefix "crate2-".

## Endless mode (only mode)
- No fixed yards. engine.js generates every yard on the device (Web Workers, up to 3 in parallel,
  first solvable yard wins) and solves it before it is shown, so every yard is solvable.
- Level = 1 + cleared/5. Each level is a tier in engine.js TIERS (lot size, colors, crate cells,
  walls, rails, padlocks, target "extra" = par minus crates). Last tier repeats forever.
  L1 5x5 · L2-3 6x6 · L4-5 7x7 with padlocks · L6-7+ 8x8, 15-22 crates, extra 5-11.
- The next yard is built in the background while the current one is played (stored as bp-next).
  If it is not ready when Next/New is pressed, a progress card shows layouts tried / solvable.
- Generation: random layout -> cheap narrow beam (rejects unsolvable fast) -> wider beam for par ->
  padlocks must raise par (else they are decoration) -> keep trying until the tier's extra band is
  hit (or settle for the closest after ~12 s) -> final wide beam tightens par.
- Par = best found by beam search, not a proven minimum. Spot check: 0 of 12 yards could be beaten
  by a 4000-wide search; on the old 53 hand-checked yards the beam reproduced every optimum.
- Generation time on a 4-core server: 5x5-6x6 instant, 7x7 0.1-3 s, 8x8 3-11 s (phones slower).
- "New" skips to a fresh yard of the same level (no progress). Undo, restart, move counter.
- Progress in localStorage, prefix "bp-": cleared, yard (current), next (pre-built).

## History of fixes
1. Overlapping gates hid one color (green exited through blue): fixed, gates never overlap.
2. Auto-exit when precisely over the matching gate.
3. Gate size limited to the largest crate of its color.
4. "Complexity too low": replaced runtime generator with offline-solved fixed levels,
   rails, sixth color, par.
5. 20 large padlock yards (8x8), then replaced all fixed yards with endless on-device generation
   with a stronger generator + solver and a 5-yards-per-level difficulty ladder.

## Open next step (pick one)
- Move limit = par (lose if exceeded)
- Hint button (engine already returns a solution path)
- Shareable seeds (generate() accepts a seed)

## Tools (tools/, Node, not loaded by the game)
- calibrate.js: generation time and difficulty per tier (`node tools/calibrate.js <tier> [runs]`).
- verify.js: replays a solution with the game's own movement rules.
- playtest.js: plays endless yards in headless Chromium with real drags, checks par, level-ups and
  the wait for the next yard (`python3 -m http.server 8765` then
  `node tools/playtest.js http://localhost:8765/ <startCleared> <yards>`).
