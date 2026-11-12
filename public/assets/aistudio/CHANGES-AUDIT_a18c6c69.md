# Audit fixes (console, commands, undo/redo)

## Bugs fixed
1. **TRIM (TR) / EXTEND (EX) crashed the app** — `intersections()` in `src/engine/trimExtend.ts` recursed forever when a line, wall, polyline or rectangle was tested against an object with no segments (room, door, text, dimension, block…). "Select all cutting edges" includes those, so TRIM/EXTEND crashed on almost every real drawing. Now returns no intersection for those pairs. Regression test added (`engine.test.ts`).
2. **Clicks swallowed by the Dynamic Input box (F12)** — the length/angle box trails the cursor 18 px down-right; moving toward a point down-right ran into it and the click was lost (ARC never finished; walls, lines, dimensions could miss points). Quick clicks on the box now go to the drawing; resting on it ~0.45 s still edits its fields (`Canvas2D.tsx`).
3. **ROOM (RM) did nothing on click** — the canvas had no click branch for the Room tool; rooms could only be made by typing coordinates. Added the branch. Clicking inside an existing room now selects it and says so instead of stacking a duplicate (`Canvas2D.tsx`, `App.tsx`).
4. **Shift+click multi-select blocked by the Quick Properties popup** — the popup opened over neighbouring objects (and was hard-capped at x ≤ 620 px / y ≤ 420 px, landing on top of the cursor on wide screens). It now measures the drawing area, flips left when there is no room on the right, and lets clicks through while Shift is held. This fixes JOIN (J), JOIN GEOMETRY (JG), UNJOIN (UJ), SWITCH JOIN (SWJ), ATTACH COLUMN TOP (ATB) and any Shift-selection (`OnboardingAndOverlays.tsx`).
5. **STAIR (ST): Enter threw the stair away** — Enter in the command line repeated the ST command and discarded the drafted runs. Enter now finishes the stair (same as Finish Stair), like it finishes walls and polylines (`Canvas2D.tsx`, `App.tsx`).
6. **LEADER (LE): note text was rejected** — after the landing click, typed text gave "Unknown command". The command line now asks for the note text (Enter applies it, Esc keeps "DETAIL NOTE") (`App.tsx`, `Canvas2D.tsx`).

## Clearer messages (no behaviour removed)
- DOOR / WINDOW / OPENING on a curtain wall: explains that curtain walls take doors/windows as panels instead of "hover a wall".
- FOUNDATION SLAB clicked inside an existing slab (or not inside walls): says it started a boundary sketch instead of doing so silently.

## Verified
- TypeScript: 0 errors. Browser console: no app errors across every view, modal, mode and command (only the sandbox's blocked Google Fonts request and headless-GPU warnings).
- All 120 registry commands exercised in a real browser with a scripted harness (see the table in the reply).
- Undo/Redo of the block features (new, edit, place, duplicate, delete with placed copies, import) via Ctrl+Z/Ctrl+Y, U/REDO and the toolbar button: 14/14 exact restores.
- 171 unit tests pass; `npm run build` and `npm run build:html` succeed.
