# Crate Escape: handoff

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
- 6 colors (r, b, y, g, p, t=teal), each with a shape glyph for colorblind play.
- Walls = hazard-striped blocked cells.
- One drag = one move. Undo, restart, move counter, best per yard.
- Progress in localStorage, prefix "crate2-".

## Levels
- 53 fixed yards in a LEVELS array (JSON: name, w, h, walls, exits{side,s,len,color},
  blocks{c,x,y,w,h,lock?}, par). Generated and solver-checked offline, not at runtime.
- Yards 1-2 hand-made tutorials, then 6x6 and 7x7 with 8 to 14 crates.
- Most yards have no crate that can exit at the start.
- Par = solver's minimum moves (one drag = one move); best turns gold at par.
- Known limit: difficulty plateaus from about yard 20 (4 to 5 extra moves beyond one per crate).

## History of fixes
1. Overlapping gates hid one color (green exited through blue): fixed, gates never overlap.
2. Auto-exit when precisely over the matching gate.
3. Gate size limited to the largest crate of its color.
4. "Complexity too low": replaced runtime generator with offline-solved fixed levels,
   rails, sixth color, par.

## Open next step (pick one)
- Bigger 8x8 yards
- Locked crates that open only after another color has left
- Move limit = par (lose if exceeded)

## Working approach
Keep a solver script (BFS over crate positions, exit = removal) to verify every level
is solvable and compute par before shipping levels. (Solver not yet in this repo.)
