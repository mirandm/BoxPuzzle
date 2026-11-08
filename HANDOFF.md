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

## Levels
- 73 fixed yards in a LEVELS array (JSON: name, w, h, walls, exits{side,s,len,color},
  blocks{c,x,y,w,h,lock?,key?}, par). Generated and solver-checked offline, not at runtime.
- Yards 1-2 hand-made tutorials, then 6x6 and 7x7 with 8 to 14 crates.
- Most yards have no crate that can exit at the start.
- Par = solver's minimum moves (one drag = one move); best turns gold at par.
- Yards 54-73: 8x8 lots, 15 to 22 crates, 2 to 4 padlocks, 2 to 5 rails, 5 to 11 extra moves
  beyond one per crate (yards 1-53 plateau at 3 to 5). Yard 54 "Padlocks" introduces the mechanic.
  Each new yard needs more moves with its padlocks than without them.
- Par for yards 54-73 is the best found by beam search, not a proven minimum (exact BFS does not
  scale to 8x8). On yards 1-53 the beam search reproduces every known optimal par.

## History of fixes
1. Overlapping gates hid one color (green exited through blue): fixed, gates never overlap.
2. Auto-exit when precisely over the matching gate.
3. Gate size limited to the largest crate of its color.
4. "Complexity too low": replaced runtime generator with offline-solved fixed levels,
   rails, sixth color, par.

## Open next step (pick one)
- Move limit = par (lose if exceeded)
- More padlock yards / 9x9 lots (generator takes w h arguments)

## Tools (tools/, Node, not shipped to players)
- solver.js: exact BFS (one drag = one move, exits applied greedily). Fine up to small yards.
- beam.js: beam search over non-exit moves; used for par on large yards.
- verify.js: replays a solution with the game's own movement rules.
- gen.js: random 8x8 yard generator (`node tools/gen.js <seed> <seconds> out.jsonl`, env FILL = crate cells).
- select.js: wide-beam par, replay check, padlock-matters filter, picks a difficulty ramp.
- playtest.js: plays yards in headless Chromium with real drags and checks moves == par
  (`python3 -m http.server 8765` then `node tools/playtest.js http://localhost:8765/ 54-73`).
