# Smart alignment guides (TRACK / F11)

Replaces the old OTRACK system (one system: `computeOsnapTracking` now runs on the same alignment core).

- **Engine:** `inferCursor(cursor, { segments, currentPoints, zoom, settings, segmentGuides?, lockGuide?, units? })`
  in `src/engine/geometry.ts`. It's a pure function, with no React.
  It returns `{ point, guides (≤2), label, equalTo, highlight, equalMarks, snapped }`.
- **Guides:** alignment (H/V with any endpoint or midpoint, including the current command's
  points), intersection of two guides, extension past line/wall ends, parallel or perpendicular
  (±2°), and equal length (≤10 px at the current zoom). Equal length prefers the parallel
  segment, then the one drawn two steps ago, then the nearest.
- **Priority:** object snaps > guide intersection > equal length + parallel > single
  alignment/extension > parallel/perpendicular > POLAR/ORTHO/grid snap.
- **Commands:** LINE, PLINE, WALL, RECTANG (alignment, extension and crossings), and the base
  and destination points of MOVE/COPY. Parallel, perpendicular and equal length apply to
  segment commands (L, PL, WA, floor/roof sketch, M/CO displacement).
- **Performance:** `buildSegmentIndex` + `querySegmentIndex` (uniform grid) feed only on-screen
  segments. With 2,000 objects one mouse move takes a fraction of a millisecond (tested < 8 ms).
- **Controls:** F11 or the TRACK button (status bar). Right-click TRACK for the per-type
  checkboxes (`settings.smartGuides`). Shift locks onto the current guide, and Alt hides guides
  while held. Typed lengths and `@dx,dy` bypass guides.
- **Tests:** see "Smart guides" in `src/engine/engine.test.ts` (rectangle completion, equal length,
  parallel, extension/perpendicular/tolerances/lock, 2,000-object performance).
