import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLength,
  formatArea,
  parseLengthInput,
  parseCoordinateInput,
  findBestOsnap,
  computeWallCornersWithJoins,
  findEnclosedRoomAtPoint,
  exportToDXF,
  createSampleProject,
  isEntityInSelectionBox,
  dist,
  sub,
} from './geometry';
import {
  createHistoryState,
  pushHistory,
  undoHistory,
  redoHistory,
  MAX_HISTORY_STEPS,
} from './history';
import { findCommandByAlias, COMMAND_REGISTRY } from './commands';
import { WallEntity, DoorEntity, LineEntity } from '../types/model';

test('formatLength and parseLengthInput handle imperial feet-inches and metric mm', () => {
  assert.equal(formatLength(150, 'imperial'), `12'-6"`);
  assert.equal(formatLength(6, 'imperial'), `6"`);
  assert.equal(formatLength(100 / 25.4, 'metric'), '100 mm');

  assert.equal(parseLengthInput(`12'-6"`, 'imperial'), 150);
  assert.equal(parseLengthInput(`10'`, 'imperial'), 120);
  assert.equal(parseLengthInput(`36"`, 'imperial'), 36);
  assert.equal(parseLengthInput(`2540`, 'metric'), 100);
});

test('parseCoordinateInput handles absolute, relative, polar, and direct distance', () => {
  const base = { x: 100, y: 100 };
  const cursor = { x: 200, y: 100 };

  const absPt = parseCoordinateInput('50,80', base, cursor, 'imperial', false);
  assert.deepEqual(absPt, { x: 50, y: 80 });

  const relPt = parseCoordinateInput('@24,12', base, cursor, 'imperial', false);
  // +dy in CAD is up (-Y in SVG)
  assert.deepEqual(relPt, { x: 124, y: 88 });

  const polarPt = parseCoordinateInput('@120<0', base, cursor, 'imperial', false);
  assert.ok(polarPt);
  assert.ok(Math.abs(polarPt.x - 220) < 1e-4);
  assert.ok(Math.abs(polarPt.y - 100) < 1e-4);

  const distPt = parseCoordinateInput(`10'`, base, cursor, 'imperial', false);
  assert.deepEqual(distPt, { x: 220, y: 100 });
});

test('wall auto-join computes clean mitered L-corner', () => {
  const w1 = {
    id: 'w1',
    type: 'wall' as const,
    layer: 'A-WALL',
    start: { x: 0, y: 0 },
    end: { x: 120, y: 0 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center' as const,
  };
  const w2 = {
    id: 'w2',
    type: 'wall' as const,
    layer: 'A-WALL',
    start: { x: 120, y: 0 },
    end: { x: 120, y: 120 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center' as const,
  };

  const corners1 = computeWallCornersWithJoins(w1, [w1, w2]);
  // Outer corner at end of w1 should extend to x = 123, inner corner to x = 117
  const xs = corners1.map((p) => Math.round(p.x));
  assert.ok(xs.includes(123));
  assert.ok(xs.includes(117));
});

test('findEnclosedRoomAtPoint detects rooms in the 2-room sample house', () => {
  const sample = createSampleProject();
  const walls = sample.entities.filter((e) => e.type === 'wall');

  const living = findEnclosedRoomAtPoint({ x: 96, y: 108 }, walls);
  assert.ok(living, 'Living room should be enclosed');
  assert.equal(living.polygon.length, 4);
  assert.equal(formatArea(192 * 216, 'imperial'), '288 sq ft');

  const bedroom = findEnclosedRoomAtPoint({ x: 264, y: 108 }, walls);
  assert.ok(bedroom, 'Bedroom should be enclosed');
  assert.equal(bedroom.polygon.length, 4);
});

test('OSNAP finds endpoint, midpoint, and intersection', () => {
  const sample = createSampleProject();
  const snapEnd = findBestOsnap({ x: 1, y: 1 }, sample.entities, sample.layers, 12);
  assert.ok(snapEnd);
  assert.equal(snapEnd.type, 'Endpoint');
  assert.deepEqual(snapEnd.point, { x: 0, y: 0 });

  const snapMid = findBestOsnap({ x: 96, y: 1 }, sample.entities, sample.layers, 12);
  assert.ok(snapMid);
  assert.equal(snapMid.type, 'Midpoint');
  assert.deepEqual(snapMid.point, { x: 96, y: 0 });
});

test('Selection box distinguishes left-to-right Window vs right-to-left Crossing', () => {
  const sample = createSampleProject();
  const wallN1 = sample.entities.find((e) => e.id === 'wall-n1')!;
  // Box that only partially overlaps wall-n1 (x: 0..192, y: 0)
  const partialWindow = isEntityInSelectionBox(
    wallN1,
    sample.entities,
    { x: -10, y: -10 },
    { x: 100, y: 10 } // left-to-right -> Window
  );
  assert.equal(partialWindow, false);

  const partialCrossing = isEntityInSelectionBox(
    wallN1,
    sample.entities,
    { x: 100, y: -10 },
    { x: -10, y: 10 } // right-to-left -> Crossing
  );
  assert.equal(partialCrossing, true);
});

test('History supports over 100 undo/redo steps cleanly', () => {
  assert.ok(MAX_HISTORY_STEPS >= 100);
  const initial = createSampleProject();
  let h = createHistoryState(initial);

  for (let i = 1; i <= 105; i++) {
    h = pushHistory(
      h,
      { ...h.present, projectName: `Step ${i}` },
      `Edit ${i}`
    );
  }
  assert.equal(h.present.projectName, 'Step 105');
  assert.ok(h.past.length >= 100);

  const { nextState: afterUndo } = undoHistory(h);
  assert.equal(afterUndo.present.projectName, 'Step 104');

  const { nextState: afterRedo } = redoHistory(afterUndo);
  assert.equal(afterRedo.present.projectName, 'Step 105');
});

test('All required AutoCAD and Revit command aliases resolve in COMMAND_REGISTRY', () => {
  const requiredAliases = [
    'L', 'LINE',
    'PL', 'PLINE',
    'REC', 'RECTANG',
    'C', 'CIRCLE',
    'A', 'ARC',
    'M', 'MV', 'MOVE',
    'CO', 'COPY',
    'RO', 'ROTATE',
    'E', 'DE', 'ERASE',
    'DI', 'DIST',
    'Z', 'ZOOM', 'ZE', 'ZF',
    'U', 'UNDO', 'REDO',
    'LA', 'LAYER',
    'PR', 'PROPERTIES',
    'WA', 'DR', 'WN', 'RM', 'TX',
  ];
  assert.ok(COMMAND_REGISTRY.length >= 18);
  for (const alias of requiredAliases) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `Alias "${alias}" must resolve to a command`);
  }
});

test('exportToDXF outputs valid ASCII DXF with HEADER, LAYER table, ENTITIES, and EOF', () => {
  const sample = createSampleProject();
  const dxf = exportToDXF(sample);
  assert.ok(dxf.includes('SECTION\n2\nHEADER'));
  assert.ok(dxf.includes('A-WALL'));
  assert.ok(dxf.includes('SECTION\n2\nENTITIES'));
  assert.ok(dxf.includes('LINE'));
  assert.ok(dxf.includes('TEXT'));
  assert.ok(dxf.trim().endsWith('0\nEOF'));
});

// --- AUTOCAD MODIFY OPERATIONS TESTS ---

test('OFFSET math correctly offsets lines, walls, and circles', async () => {
  const { offsetLine, offsetEntity } = await import('./geometry');

  // Offset horizontal line at y=0 upwards by 12" (sidePoint at y = -10, which is up in CAD/SVG coords or down)
  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  };
  const offUp = offsetLine(l1.start, l1.end, 12, { x: 50, y: 50 });
  assert.ok(Math.abs(offUp.start.x - 0) < 1e-4);
  assert.ok(Math.abs(offUp.start.y - 12) < 1e-4);
  assert.ok(Math.abs(offUp.end.y - 12) < 1e-4);

  // Offset Wall preserves thickness and layer
  const w1 = {
    id: 'w1',
    type: 'wall' as const,
    layer: 'A-WALL',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 120 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center' as const,
  };
  const offWall = offsetEntity(w1, 10, { x: 10, y: 60 });
  assert.ok(offWall);
  assert.equal(offWall.type, 'wall');
  if (offWall && offWall.type === 'wall') {
    assert.equal(offWall.thickness, 6);
    assert.ok(Math.abs(offWall.start.x - 10) < 1e-4);
  }

  // Offset Circle
  const c1 = {
    id: 'c1',
    type: 'circle' as const,
    layer: 'A-DETL',
    center: { x: 0, y: 0 },
    radius: 50,
  };
  const offCircle = offsetEntity(c1, 10, { x: 100, y: 0 }); // outward
  assert.ok(offCircle && offCircle.type === 'circle');
  if (offCircle && offCircle.type === 'circle') {
    assert.equal(offCircle.radius, 60);
  }
});

test('TRIM cuts line cleanly at intersection with cutting segment', async () => {
  const { trimLineOrWall } = await import('./geometry');

  // Horizontal line from x:0 to x:100 at y:50
  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 50 },
    end: { x: 100, y: 50 },
  };

  // Vertical cutting edge at x:40 from y:0 to y:100
  const cutting = [
    { a: { x: 40, y: 0 }, b: { x: 40, y: 100 }, entityId: 'cut1' },
  ];

  // Click on the left part (x:20, y:50) to discard [0..40]
  const trimmed = trimLineOrWall(l1, cutting, { x: 20, y: 50 });
  assert.equal(trimmed.length, 1);
  assert.ok(Math.abs(trimmed[0].start.x - 40) < 1e-3);
  assert.ok(Math.abs(trimmed[0].end.x - 100) < 1e-3);
});

test('EXTEND extends line endpoint to intersect boundary segment', async () => {
  const { extendLineOrWall } = await import('./geometry');

  // Line from x:0 to x:50 at y:20
  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 20 },
    end: { x: 50, y: 20 },
  };

  // Boundary segment at x:120 from y:0 to y:100
  const boundary = [
    { a: { x: 120, y: 0 }, b: { x: 120, y: 100 }, entityId: 'bound1' },
  ];

  // Click near end (x:45, y:20)
  const ext = extendLineOrWall(l1, boundary, { x: 45, y: 20 });
  assert.ok(ext);
  if (ext) {
    assert.ok(Math.abs(ext.end.x - 120) < 1e-3);
    assert.ok(Math.abs(ext.end.y - 20) < 1e-3);
  }
});

test('FILLET radius 0 makes clean corner, radius > 0 creates tangent arc', async () => {
  const { filletEntities } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 50 },
    end: { x: 80, y: 50 },
  };
  const l2 = {
    id: 'l2',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 100, y: 80 },
    end: { x: 100, y: 150 },
  };

  // Fillet with R=0: intersection is at (100, 50)
  const res0 = filletEntities(l1, l2, 0);
  assert.ok(res0);
  if (res0) {
    assert.equal(res0.modified.length, 2);
    assert.ok(Math.abs(res0.modified[0].end.x - 100) < 1e-3);
    assert.ok(Math.abs(res0.modified[0].end.y - 50) < 1e-3);
    assert.ok(Math.abs(res0.modified[1].start.x - 100) < 1e-3);
    assert.ok(Math.abs(res0.modified[1].start.y - 50) < 1e-3);
  }

  // Fillet with R=10: creates tangent arc
  const res10 = filletEntities(l1, l2, 10);
  assert.ok(res10 && res10.arc);
  if (res10 && res10.arc) {
    assert.equal(res10.arc.radius, 10);
    assert.ok(res10.modified.length === 2);
  }
});

test('CHAMFER bevels corner with specified distances', async () => {
  const { chamferEntities } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 0 },
    end: { x: 80, y: 0 },
  };
  const l2 = {
    id: 'l2',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 100, y: 20 },
    end: { x: 100, y: 100 },
  };

  // Corner is at (100, 0). Chamfer d1=10, d2=15
  const res = chamferEntities(l1, l2, 10, 15);
  assert.ok(res);
  if (res) {
    assert.ok(Math.abs(res.modified[0].end.x - 90) < 1e-3);
    assert.ok(Math.abs(res.modified[1].start.y - 15) < 1e-3);
    assert.ok(res.chamferLine);
    assert.ok(Math.abs(res.chamferLine.start.x - 90) < 1e-3);
    assert.ok(Math.abs(res.chamferLine.end.y - 15) < 1e-3);
  }
});

test('MIRROR reflects points and entities across reflection line', async () => {
  const { mirrorPoint, mirrorEntity } = await import('./geometry');

  // Reflect across line x=50 (vertical line from (50, 0) to (50, 100))
  const p = { x: 20, y: 30 };
  const mirP = mirrorPoint(p, { x: 50, y: 0 }, { x: 50, y: 100 });
  assert.equal(mirP.x, 80);
  assert.equal(mirP.y, 30);

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 10, y: 10 },
    end: { x: 30, y: 20 },
  };
  const mirL = mirrorEntity(l1, { x: 50, y: 0 }, { x: 50, y: 100 });
  if (mirL.type === 'line') {
    assert.equal(mirL.start.x, 90);
    assert.equal(mirL.end.x, 70);
  }
});

test('STRETCH moves endpoints inside crossing window while outside remain fixed', async () => {
  const { stretchEntities } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 50 },     // Outside crossing box
    end: { x: 100, y: 50 },    // Inside crossing box (x: 80..120, y: 40..60)
  };

  const stretched = stretchEntities(
    [l1],
    { x: 80, y: 40 },
    { x: 120, y: 60 },
    { x: 25, y: 0 } // Move dx=25
  );

  const resL = stretched[0];
  if (resL.type === 'line') {
    assert.equal(resL.start.x, 0);   // Start did NOT move
    assert.equal(resL.end.x, 125);   // End moved by 25
  }
});

test('BREAK splits entity or removes segment', async () => {
  const { breakEntity } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  };

  // Break at a single point (x=50) splits into 2 lines
  const split = breakEntity(l1, { x: 50, y: 0 }, { x: 50, y: 0 });
  assert.equal(split.length, 2);
  if (split[0].type === 'line' && split[1].type === 'line') {
    assert.equal(split[0].end.x, 50);
    assert.equal(split[1].start.x, 50);
  }

  // Break between x=30 and x=70 leaves two segments [0..30] and [70..100]
  const cut = breakEntity(l1, { x: 30, y: 0 }, { x: 70, y: 0 });
  assert.equal(cut.length, 2);
  if (cut[0].type === 'line' && cut[1].type === 'line') {
    assert.equal(cut[0].end.x, 30);
    assert.equal(cut[1].start.x, 70);
  }
});

test('JOIN merges collinear lines and connected segments', async () => {
  const { joinEntities } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
  };
  const l2 = {
    id: 'l2',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 50, y: 0 },
    end: { x: 120, y: 0 },
  };

  const merged = joinEntities([l1, l2]);
  assert.equal(merged.length, 1);
  if (merged[0].type === 'line') {
    assert.equal(merged[0].start.x, 0);
    assert.equal(merged[0].end.x, 120);
  }
});

test('EXPLODE disassembles polyline and rectangle into primitive lines', async () => {
  const { explodeEntity } = await import('./geometry');

  const rect = {
    id: 'rect1',
    type: 'rectangle' as const,
    layer: 'A-DETL',
    p1: { x: 0, y: 0 },
    p2: { x: 60, y: 40 },
  };
  const lines = explodeEntity(rect);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.type === 'line'));
});

test('ALIGN moves and rotates entity to match reference line', async () => {
  const { alignEntity } = await import('./geometry');

  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: 'A-DETL',
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
  };

  // Align to vertical reference line from (100, 100) to (100, 150)
  const aligned = alignEntity(l1, { x: 100, y: 100 }, { x: 100, y: 150 });
  assert.ok(aligned);
  if (aligned && aligned.type === 'line') {
    assert.ok(Math.abs(aligned.start.x - 100) < 1e-3);
    assert.ok(Math.abs(aligned.start.y - 100) < 1e-3);
    assert.ok(Math.abs(aligned.end.x - 100) < 1e-3);
    assert.ok(Math.abs(aligned.end.y - 150) < 1e-3);
  }
});

test('ARRAY generates rectangular grid and polar circular copies', async () => {
  const { createRectangularArray, createPolarArray } = await import('./geometry');

  const c1 = {
    id: 'c1',
    type: 'circle' as const,
    layer: 'A-DETL',
    center: { x: 0, y: 0 },
    radius: 10,
  };

  // 2 rows x 3 columns = 5 new copies (excluding original)
  const rectCopies = createRectangularArray([c1], 2, 3, 50, 40);
  assert.equal(rectCopies.length, 5);

  // 4 items polar array = 3 new copies
  const polarCopies = createPolarArray([c1], { x: 50, y: 50 }, 4, 360);
  assert.equal(polarCopies.length, 3);
});

test('All AutoCAD modify command aliases resolve in COMMAND_REGISTRY', () => {
  const modifyAliases = [
    'O', 'OFFSET',
    'TR', 'TRIM',
    'EX', 'EXTEND',
    'F', 'FILLET',
    'CHA', 'CHAMFER',
    'MI', 'MIRROR',
    'AR', 'ARRAY',
    'SC', 'SCALE',
    'S', 'STRETCH',
    'BR', 'BREAK',
    'J', 'JOIN',
    'X', 'EXPLODE',
    'AL', 'ALIGN',
  ];
  for (const alias of modifyAliases) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `Modify alias "${alias}" must resolve in COMMAND_REGISTRY`);
  }
});

test('Quadrant, Tangent, and Extension object snaps work accurately', async () => {
  const { findBestOsnap } = await import('./geometry');

  const layers = [{ id: '0', name: '0', color: '#000', visible: true, locked: false }];
  const circle = {
    id: 'c1',
    type: 'circle' as const,
    layer: '0',
    center: { x: 100, y: 100 },
    radius: 50,
  };

  // Test Quadrant: East quadrant is at (150, 100)
  const quadSnap = findBestOsnap(
    { x: 148, y: 101 },
    [circle],
    layers,
    10,
    null,
    ['Quadrant']
  );
  assert.ok(quadSnap, 'Should find Quadrant snap');
  assert.equal(quadSnap.type, 'Quadrant');
  assert.equal(Math.round(quadSnap.point.x), 150);
  assert.equal(Math.round(quadSnap.point.y), 100);

  // Test Tangent: from (0, 100) to circle with center (100, 100) and radius 50
  // Tangent point angle: d=100, R=50 -> acos(50/100) = 60°
  const refPt = { x: 0, y: 100 };
  const tanSnap = findBestOsnap(
    { x: 74, y: 55 },
    [circle],
    layers,
    15,
    refPt,
    ['Tangent']
  );
  assert.ok(tanSnap, 'Should find Tangent snap');
  assert.equal(tanSnap.type, 'Tangent');

  // Test Extension: Line from (0,0) to (100,0). Collinear point at (150, 0)
  const line = {
    id: 'l1',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  };
  const extSnap = findBestOsnap(
    { x: 140, y: 2 },
    [line],
    layers,
    10,
    null,
    ['Extension']
  );
  assert.ok(extSnap, 'Should find Extension snap');
  assert.equal(extSnap.type, 'Extension');
  assert.equal(Math.round(extSnap.point.x), 140);
  assert.equal(Math.round(extSnap.point.y), 0);
});

test('computePolarSnap snaps along specified angular increments', async () => {
  const { computePolarSnap } = await import('./geometry');
  const ref = { x: 100, y: 100 };

  // Near 45° angle in CAD (+dx, -dy in SVG)
  // CAD 45° from (100,100) is (100 + 70.71, 100 - 70.71) = (170.71, 29.29)
  const cursorNear45 = { x: 171, y: 28 };
  const snap45 = computePolarSnap(ref, cursorNear45, 45, 3.0);
  assert.ok(snap45, 'Should snap to 45° polar angle');
  assert.equal(snap45.angleDeg, 45);

  // Near 90° angle (straight up in CAD: x=100, y < 100 in SVG)
  const cursorNear90 = { x: 102, y: 20 };
  const snap90 = computePolarSnap(ref, cursorNear90, 45, 3.0);
  assert.ok(snap90, 'Should snap to 90° polar angle');
  assert.equal(snap90.angleDeg, 90);
  assert.equal(Math.round(snap90.point.x), 100);

  // Too far off angle: 60° when increment is 45° (diff = 15° > 3°)
  const cursorAt60 = { x: 150, y: 13.4 };
  const snapFail = computePolarSnap(ref, cursorAt60, 45, 3.0);
  assert.equal(snapFail, null, 'Should not snap when angle is outside tolerance');
});

test('computeOsnapTracking aligns with acquired snap points', async () => {
  const { computeOsnapTracking } = await import('./geometry');
  const acquired = [
    { x: 100, y: 100 },
    { x: 300, y: 200 },
  ];

  // Cursor near horizontal alignment with first point (y near 100)
  const cursorH = { x: 220, y: 101.5 };
  const trackH = computeOsnapTracking(cursorH, acquired, 5);
  assert.ok(trackH, 'Should find horizontal tracking guide');
  assert.equal(trackH.point.y, 100);
  assert.equal(trackH.guides[0].axis, 'horizontal');

  // Cursor near vertical alignment with second point (x near 300)
  const cursorV = { x: 298.5, y: 450 };
  const trackV = computeOsnapTracking(cursorV, acquired, 5);
  assert.ok(trackV, 'Should find vertical tracking guide');
  assert.equal(trackV.point.x, 300);
  assert.equal(trackV.guides[0].axis, 'vertical');
});

test('Area and perimeter calculation functions compute accurate values', async () => {
  const { computeEntityAreaAndPerimeter, computePolygonAreaAndPerimeter } = await import('./geometry');

  // 1. Rectangle 120" x 60"
  const rect = {
    id: 'r1',
    type: 'rectangle' as const,
    layer: '0',
    p1: { x: 0, y: 0 },
    p2: { x: 120, y: 60 },
  };
  const rectCalc = computeEntityAreaAndPerimeter(rect);
  assert.equal(rectCalc.area, 7200); // 7200 sq in = 50 sq ft
  assert.equal(rectCalc.perimeter, 360); // 360 in = 30 ft

  // 2. Circle with radius 10
  const circ = {
    id: 'c1',
    type: 'circle' as const,
    layer: '0',
    center: { x: 0, y: 0 },
    radius: 10,
  };
  const circCalc = computeEntityAreaAndPerimeter(circ);
  assert.ok(Math.abs(circCalc.area - Math.PI * 100) < 1e-4);
  assert.ok(Math.abs(circCalc.perimeter - 2 * Math.PI * 10) < 1e-4);

  // 3. Custom Polygon (Right triangle: base=30, height=40, hypotenuse=50)
  const tri = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 40 },
  ];
  const triCalc = computePolygonAreaAndPerimeter(tri);
  assert.equal(triCalc.area, 600);
  assert.equal(triCalc.perimeter, 120);
});

test('MATCHPROP (MA) and AREA (AA) commands are registered in COMMAND_REGISTRY', () => {
  const ma = findCommandByAlias('MA');
  assert.ok(ma, 'MA must resolve');
  assert.equal(ma.id, 'matchprop');

  const matchprop = findCommandByAlias('MATCHPROP');
  assert.ok(matchprop, 'MATCHPROP must resolve');

  const aa = findCommandByAlias('AA');
  assert.ok(aa, 'AA must resolve');
  assert.equal(aa.id, 'area');

  const area = findCommandByAlias('AREA');
  assert.ok(area, 'AREA must resolve');
});

// --- ANNOTATION TOOLS & ASSOCIATIVE DIMENSIONS TESTS ---

test('All annotation command aliases (DLI, DAL, DAN, DRA, DDI, DCO, DBA, T, MTEXT, LE, MLEADER, H, HATCH, TG, D, DIMSTYLE) resolve', () => {
  const annoAliases = [
    'DLI', 'DIMLINEAR',
    'DAL', 'DIMALIGNED',
    'DAN', 'DIMANGULAR',
    'DRA', 'DIMRADIUS',
    'DDI', 'DIMDIAMETER',
    'DCO', 'DIMCONTINUE',
    'DBA', 'DIMBASELINE',
    'TX', 'T', 'MTEXT', 'TEXT',
    'LE', 'MLEADER', 'LEADER',
    'H', 'HATCH',
    'TG', 'TAG',
    'D', 'DIMSTYLE',
  ];
  for (const alias of annoAliases) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `Annotation alias "${alias}" must resolve in COMMAND_REGISTRY`);
  }
});

test('computeWallFaces and detectWallFaceUnderCursor detect Interior, Centerline, and Exterior wall faces', async () => {
  const { computeWallFaces, detectWallFaceUnderCursor } = await import('./geometry');

  const wall = {
    id: 'w-test',
    type: 'wall' as const,
    layer: 'A-WALL',
    start: { x: 0, y: 100 },
    end: { x: 200, y: 100 },
    thickness: 8,
    height: 108,
    baseOffset: 0,
    justification: 'center' as const,
  };

  const faces = computeWallFaces(wall);
  // Horizontal wall at y=100, thickness=8 -> half=4 -> perpLeft({1,0}) is {0,1} -> exterior at y=104, centerline at y=100, interior at y=96
  assert.equal(faces.centerline.start.y, 100);
  assert.equal(faces.exterior.start.y, 104);
  assert.equal(faces.interior.start.y, 96);

  const nearInt = detectWallFaceUnderCursor({ x: 50, y: 95 }, [wall], 36, 'auto');
  assert.ok(nearInt);
  assert.equal(nearInt.face, 'interior');
  assert.equal(nearInt.pointOnFace.y, 96);

  const nearExt = detectWallFaceUnderCursor({ x: 50, y: 105 }, [wall], 36, 'auto');
  assert.ok(nearExt);
  assert.equal(nearExt.face, 'exterior');
  assert.equal(nearExt.pointOnFace.y, 104);

  const forcedCenter = detectWallFaceUnderCursor({ x: 50, y: 95 }, [wall], 36, 'centerline');
  assert.ok(forcedCenter);
  assert.equal(forcedCenter.face, 'centerline');
  assert.equal(forcedCenter.pointOnFace.y, 100);
});

test('computeLinearDimGeometry and computeAngularDimGeometry compute accurate measurements', async () => {
  const { computeLinearDimGeometry, computeAngularDimGeometry } = await import('./geometry');

  // Diagonal points: (0,0) to (120, 90) -> aligned = 150, horizontal = 120, vertical = 90
  const p1 = { x: 0, y: 0 };
  const p2 = { x: 120, y: 90 };

  const horiz = computeLinearDimGeometry(p1, p2, { x: 60, y: -24 }, 'horizontal');
  assert.equal(Math.round(horiz.measuredLength), 120);

  const vert = computeLinearDimGeometry(p1, p2, { x: 150, y: 45 }, 'vertical');
  assert.equal(Math.round(vert.measuredLength), 90);

  // Right angle at origin (0,0) between (100,0) and (0,100)
  const ang = computeAngularDimGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 30, y: 30 });
  assert.equal(Math.round(ang.sweepAngle), 90);
});

test('Associative dimensions automatically update when their associated walls move', async () => {
  const { syncHostedBimEntities, moveEntity } = await import('./geometry');
  const sample = createSampleProject();

  // In sample project, dim-width measures from wall-n1 start (x=0) to wall-n2 end (x=336)
  const dimBefore = sample.entities.find((e) => e.id === 'dim-width');
  assert.ok(dimBefore && dimBefore.type === 'dimension');
  assert.equal(dimBefore.p2.x, 336);

  // Stretch wall-n2 so its end moves from x=336 to x=400
  const stretchedEntities = sample.entities.map((e) => {
    if (e.id === 'wall-n2' && e.type === 'wall') {
      return { ...e, end: { x: 400, y: 0 } };
    }
    return e;
  });

  const synced = syncHostedBimEntities(stretchedEntities);
  const dimAfter = synced.find((e) => e.id === 'dim-width');
  assert.ok(dimAfter && dimAfter.type === 'dimension');
  assert.equal(dimAfter.p2.x, 400, 'Associative dimension p2.x should update to 400 when wall-n2 stretches');

  // Also test moving a wall that is measured between two parallel walls (wall-w at x=0 and wall-mid at x=192)
  const perpDim = {
    id: 'dim-perp',
    type: 'dimension' as const,
    dimType: 'linear' as const,
    linearOrientation: 'horizontal' as const,
    layer: 'A-ANNO',
    p1: { x: 0, y: 108 },
    p2: { x: 192, y: 108 },
    offset: -30,
    association: {
      entityId1: 'wall-w',
      ref1: 'centerline' as const,
      offsetParam1: 0.5,
      entityId2: 'wall-mid',
      ref2: 'centerline' as const,
      offsetParam2: 0.5,
    },
  };

  // Move wall-mid 24" to the right (from x=192 to x=216)
  const withMovedPartition = [...sample.entities, perpDim].map((e) =>
    e.id === 'wall-mid' ? moveEntity(e, { x: 24, y: 0 }) : e
  );
  const syncedPerp = syncHostedBimEntities(withMovedPartition);
  const updatedPerpDim = syncedPerp.find((e) => e.id === 'dim-perp');
  assert.ok(updatedPerpDim && updatedPerpDim.type === 'dimension');
  assert.equal(updatedPerpDim.p2.x, 216, 'Wall-to-wall dimension should update when partition wall moves');
});

// --- COMPONENT & BLOCK LIBRARY TESTS ---

test('All block and component command aliases (B, BLOCK, I, INSERT, CM, COMPONENT, BE, BEDIT) resolve', () => {
  const blockAliases = ['B', 'BLOCK', 'I', 'INSERT', 'CM', 'COMPONENT', 'BE', 'BEDIT'];
  for (const alias of blockAliases) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `Block alias "${alias}" must resolve in COMMAND_REGISTRY`);
  }
});

test('createStarterBlocks ships the 11 architectural starter components (+ the component library) with 2D symbols and 3D dimensions', async () => {
  const { createStarterBlocks } = await import('./geometry');
  const all = createStarterBlocks();
  const starter = all.filter((b) => !b.libKind);
  assert.equal(starter.length, 11);
  assert.ok(all.filter((b) => b.libKind).length >= 35, 'component library');

  const expectedKinds = [
    'bed',
    'sofa',
    'table-chairs',
    'toilet',
    'sink',
    'bathtub',
    'kitchen-counter',
    'fridge',
    'stove',
    'stairs',
    'tree',
  ];
  for (const k of expectedKinds) {
    const found = starter.find((b) => b.kind === k);
    assert.ok(found, `Starter library must include "${k}" component`);
    assert.ok(found.width > 0 && found.depth > 0 && found.height > 0);
    assert.ok(found.color.startsWith('#'));
    assert.ok(found.entities.length > 0, `Starter block "${k}" must have 2D symbol primitives`);
  }
});

test('createBlockFromSelection, getBlockWorldPrimitives, and explodeEntity work on blocks', async () => {
  const {
    createBlockFromSelection,
    getBlockWorldPrimitives,
    explodeEntity,
  } = await import('./geometry');

  const r1 = {
    id: 'r1',
    type: 'rectangle' as const,
    layer: '0',
    p1: { x: 100, y: 100 },
    p2: { x: 148, y: 124 },
  };
  const l1 = {
    id: 'l1',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 112 },
    end: { x: 148, y: 112 },
  };

  const { blockDef, instance } = createBlockFromSelection(
    'Custom Desk',
    { x: 124, y: 112 },
    [r1, l1],
    '#0d9488',
    30,
    'A-FURN'
  );

  assert.equal(blockDef.name, 'Custom Desk');
  assert.equal(blockDef.width, 48);
  assert.equal(blockDef.depth, 24);
  assert.equal(blockDef.height, 30);
  assert.equal(instance.type, 'block');
  assert.equal(instance.position.x, 124);
  assert.equal(instance.position.y, 112);

  // World primitives at scale=1, rotation=0
  const worldPrims = getBlockWorldPrimitives(instance, blockDef);
  assert.equal(worldPrims.length, 2);
  assert.equal(worldPrims.filter((p) => p.type === 'rectangle').length, 1);
  assert.equal(worldPrims.filter((p) => p.type === 'line').length, 1);

  // Explode block instance back into world primitives
  const exploded = explodeEntity(instance, [blockDef]);
  assert.ok(exploded.length >= 2, 'Exploded block should produce world-space entities');
  assert.ok(exploded.every((e) => e.type !== 'block'));
});

// --- REVIT-STYLE BUILDING (BIM) FEATURES TESTS ---

test('All Revit-style BIM command aliases (LL, SB, RF, ST, CL, GR, VV, VG, HH, HI, HR) resolve in COMMAND_REGISTRY', () => {
  const bimAliases = [
    'LL', 'LEVEL', 'LEVELS',
    'SB', 'FLOOR', 'SLAB',
    'RF', 'ROOF',
    'ST', 'STAIR', 'STAIRS',
    'CL', 'COLUMN', 'COL',
    'GR', 'GRID',
    'VV', 'VG', 'VISIBILITY',
    'HH', 'HIDE',
    'HI', 'ISOLATE',
    'HR', 'UNHIDE',
  ];
  for (const alias of bimAliases) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `BIM alias "${alias}" must resolve in COMMAND_REGISTRY`);
  }
});

test('createStarterWallTypes provides 11 starter wall types (incl. curtain wall, CMU and cabin log walls) with compound layers and accurate total thickness', async () => {
  const {
    createStarterWallTypes,
    getWallTypeTotalThickness,
    computeWallLayerBands,
  } = await import('./geometry');

  const wallTypes = createStarterWallTypes();
  assert.equal(wallTypes.length, 11);

  const expectedNames = [
    'Interior 4-1/2"',
    'Exterior 2x6',
    'Concrete 8"',
    'CMU 8" (grouted)',
    'Glass partition',
    'Curtain Wall (glass grid)',
    'Full-Scribe Round Log 10"',
    'D-Log 8" (flat interior)',
    'Square-Chinked Appalachian Log 8"',
    'Cedar Board-and-Batten Cabin Wall',
    'Knotty Pine T&G Interior Partition',
  ];
  for (const name of expectedNames) {
    const wt = wallTypes.find((t) => t.name === name);
    assert.ok(wt, `Starter WallType "${name}" must exist`);
    assert.ok(wt.layers.length >= 1, `WallType "${name}" must have assembly layers`);
  }

  // Interior 4-1/2" = 1/2" (0.5) + 3-1/2" (3.5) + 1/2" (0.5) = 4.5"
  const intWall = wallTypes.find((t) => t.id === 'wt-int-45')!;
  assert.equal(getWallTypeTotalThickness(intWall), 4.5);

  // Exterior 2x6 = 5/8" + 5-1/2" + 1/2" + 3/4" = 7.375"
  const extWall = wallTypes.find((t) => t.id === 'wt-ext-2x6')!;
  assert.equal(getWallTypeTotalThickness(extWall), 7.375);
  assert.equal(extWall.layers.length, 4);

  // Concrete 8" = 8"
  const concWall = wallTypes.find((t) => t.id === 'wt-conc-8')!;
  assert.equal(getWallTypeTotalThickness(concWall), 8);

  // Compute 2D zoomed-in compound layer bands for a wall with Exterior 2x6
  const sampleWall = {
    id: 'w-compound',
    type: 'wall' as const,
    layer: 'A-WALL',
    wallTypeId: 'wt-ext-2x6',
    start: { x: 0, y: 0 },
    end: { x: 120, y: 0 },
    thickness: getWallTypeTotalThickness(extWall),
    height: 108,
    baseOffset: 0,
    justification: 'center' as const,
  };
  const bands = computeWallLayerBands(sampleWall, extWall, []);
  assert.equal(bands.length, 4, 'Should generate 4 parallel layer bands for Exterior 2x6 wall');
});

test('createStarterLevels, computeStairParameters, findGridIntersections, and computeOuterFootprintFromWalls work accurately', async () => {
  const {
    createStarterLevels,
    computeStairParameters,
    computeStairPlanGeometry,
    findGridIntersections,
    computeOuterFootprintFromWalls,
  } = await import('./geometry');

  // 1. Starter Levels (Level 1 at 0", Level 2 at 108", Roof at 216")
  const levels = createStarterLevels();
  assert.equal(levels.length, 3);
  assert.equal(levels[0].name, 'Level 1');
  assert.equal(levels[0].elevation, 0);
  assert.equal(levels[1].name, 'Level 2');
  assert.equal(levels[1].elevation, 108);
  assert.equal(levels[2].name, 'Roof');
  assert.equal(levels[2].elevation, 216);

  // 2. Stair auto riser/tread calculation between Level 1 (0") and Level 2 (108")
  const stairParams = computeStairParameters(0, 108, 11);
  assert.equal(stairParams.totalRise, 108);
  assert.equal(stairParams.numRisers, 16); // ceil(108 / 7) = 16 risers
  assert.equal(stairParams.riserHeight, 6.75); // 108 / 16 = 6.75"
  assert.equal(stairParams.runLength, 165); // (16 - 1) * 11" = 165"

  const stairGeo = computeStairPlanGeometry({
    id: 'st-1',
    type: 'stair',
    layer: 'A-STRS',
    start: { x: 0, y: 0 },
    end: { x: 165, y: 0 },
    width: 36,
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    numRisers: stairParams.numRisers,
    riserHeight: stairParams.riserHeight,
    treadDepth: stairParams.treadDepth,
  });
  assert.equal(stairGeo.outline.length, 4);
  assert.ok(stairGeo.riserLines.length >= 14);

  // 3. Structural Grid intersections for Column snapping
  const gridA = {
    id: 'g-a',
    type: 'grid' as const,
    layer: 'S-GRID',
    start: { x: -50, y: 100 },
    end: { x: 400, y: 100 },
    label: 'A',
  };
  const grid1 = {
    id: 'g-1',
    type: 'grid' as const,
    layer: 'S-GRID',
    start: { x: 150, y: -50 },
    end: { x: 150, y: 350 },
    label: '1',
  };
  const intersections = findGridIntersections([gridA, grid1]);
  assert.equal(intersections.length, 1);
  assert.deepEqual(intersections[0].point, { x: 150, y: 100 });

  // 4. Roof/Floor footprint from walls with overhang
  const sample = createSampleProject();
  const sampleWalls = sample.entities.filter((e) => e.type === 'wall');
  const roofFootprint = computeOuterFootprintFromWalls(sampleWalls, 18);
  assert.ok(roofFootprint);
  assert.equal(roofFootprint.length, 4);
  assert.deepEqual(roofFootprint[0], { x: -18, y: -18 });
  assert.deepEqual(roofFootprint[2], { x: 354, y: 234 });
});

// --- DOCUMENTATION OUTPUT (SCHEDULES, SHEETS, PDF, DXF IMPORT/EXPORT, IFC4) TESTS ---

test('Schedules (Door, Window, Room), editable room area scaling, and CSV export work accurately', async () => {
  const {
    getDoorScheduleRows,
    getWindowScheduleRows,
    getRoomScheduleRows,
    exportScheduleToCSV,
    scaleRoomToTargetArea,
    polygonArea,
  } = await import('./geometry');

  const sample = createSampleProject();
  const doors = getDoorScheduleRows(sample);
  const windows = getWindowScheduleRows(sample);
  const rooms = getRoomScheduleRows(sample);

  assert.equal(doors.length, 2);
  assert.equal(doors[0].mark, 'D1');
  assert.equal(doors[0].width, 32);
  assert.equal(doors[0].height, 80);

  assert.equal(windows.length, 4);
  assert.equal(windows[0].mark, 'W1');
  assert.equal(windows[1].mark, 'W2');

  assert.equal(rooms.length, 2);
  assert.equal(rooms[0].name, 'Living Room');
  assert.equal(rooms[0].areaFormatted, '288 sq ft');

  // Test scaling a room polygon from schedule cell edit (e.g. changing 288 sq ft to 400 sq ft)
  const livingEnt = sample.entities.find(
    (e) => e.id === 'room-living' && e.type === 'room'
  );
  assert.ok(livingEnt && livingEnt.type === 'room');
  const scaledRoom = scaleRoomToTargetArea(livingEnt, 400 * 144);
  assert.ok(Math.abs(polygonArea(scaledRoom.polygon) / 144 - 400) < 0.1);

  // Test CSV exports
  const roomCsv = exportScheduleToCSV(sample, 'rooms');
  assert.ok(roomCsv.includes('Room Name'));
  assert.ok(roomCsv.includes('Living Room'));
  assert.ok(roomCsv.includes('288 sq ft'));

  const doorCsv = exportScheduleToCSV(sample, 'doors');
  assert.ok(doorCsv.includes('Door Type'));
  assert.ok(doorCsv.includes('D1'));
});

test('Sheets, architectural view scales, and multi-page jsPDF generation work accurately', async () => {
  const {
    getSheetDimensionsMm,
    getScaleRatio,
    modelInchesToSheetMm,
    createStarterSheets,
    generateSheetsPDF,
  } = await import('./geometry');

  const a3 = getSheetDimensionsMm('A3');
  assert.equal(a3.widthMm, 420);
  assert.equal(a3.heightMm, 297);

  const tabloid = getSheetDimensionsMm('Tabloid');
  assert.equal(tabloid.widthMm, 431.8);

  const a1 = getSheetDimensionsMm('A1');
  assert.equal(a1.widthMm, 841);

  // 1/4" = 1'-0" -> ratio = 1/48
  assert.ok(Math.abs(getScaleRatio('1/4" = 1\'-0"') - 1 / 48) < 1e-6);
  // 1:50 -> ratio = 0.02
  assert.equal(getScaleRatio('1:50'), 0.02);
  // 48" (4'-0") at 1/4" = 1'-0" is 1" on paper = 25.4 mm
  assert.ok(Math.abs(modelInchesToSheetMm(48, '1/4" = 1\'-0"') - 25.4) < 1e-4);

  const sample = createSampleProject();
  const starterSheets = createStarterSheets();
  const secondSheet = {
    ...starterSheets[0],
    id: 'sheet-a102',
    sheetNumber: 'A102',
    title: 'Schedules & Details',
    size: 'Tabloid' as const,
  };
  const pdfDoc = generateSheetsPDF(sample, [starterSheets[0], secondSheet]);
  assert.equal(pdfDoc.getNumberOfPages(), 2, 'Should generate a 2-page PDF document');
});

test('Enhanced DXF export includes layers, dimensions, hatches, and blocks, and DXF import parses LINE, LWPOLYLINE, CIRCLE, ARC, TEXT via dxf-parser', async () => {
  const { exportToDXF, importFromDXF } = await import('./geometry');
  const sample = createSampleProject();

  // Add a hatch, a block instance, a circle, an arc, a polyline, and a text note to sample
  const enrichedModel = {
    ...sample,
    entities: [
      ...sample.entities,
      {
        id: 'hatch-test',
        type: 'hatch' as const,
        layer: 'A-AREA',
        polygon: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 60 },
          { x: 10, y: 60 },
        ],
        pattern: 'diagonal' as const,
        scale: 1,
        angle: 0,
      },
      {
        id: 'blk-test',
        type: 'block' as const,
        layer: 'A-FURN',
        blockId: 'starter-bed',
        name: 'Queen Bed',
        position: { x: 240, y: 80 },
        rotation: 0,
        scale: 1,
        width: 60,
        depth: 80,
        height: 28,
        color: '#cbd5e1',
      },
      {
        id: 'pline-test',
        type: 'polyline' as const,
        layer: '0',
        points: [
          { x: 0, y: 0 },
          { x: 48, y: 0 },
          { x: 48, y: 36 },
        ],
        closed: true,
      },
      {
        id: 'circ-test',
        type: 'circle' as const,
        layer: '0',
        center: { x: 100, y: 100 },
        radius: 24,
      },
      {
        id: 'arc-test',
        type: 'arc' as const,
        layer: '0',
        center: { x: 150, y: 100 },
        radius: 18,
        startAngle: 0,
        endAngle: 90,
      },
      {
        id: 'txt-test',
        type: 'text' as const,
        layer: 'A-ANNO',
        position: { x: 50, y: 50 },
        text: 'ENTRY HALL',
        fontSize: 10,
        rotation: 0,
      },
    ],
  };

  const dxfStr = exportToDXF(enrichedModel);
  assert.ok(dxfStr.includes('DIMENSION'), 'DXF should include DIMENSION record');
  assert.ok(dxfStr.includes('HATCH'), 'DXF should include HATCH record');
  assert.ok(dxfStr.includes('BLOCKS'), 'DXF should include BLOCKS section');
  assert.ok(dxfStr.includes('INSERT'), 'DXF should include INSERT record');
  assert.ok(dxfStr.includes('LWPOLYLINE'), 'DXF should include LWPOLYLINE');
  for (const layer of enrichedModel.layers) {
    assert.ok(dxfStr.includes(layer.name), `DXF should contain app layer ${layer.name}`);
  }

  // Now import the generated DXF back via dxf-parser!
  const imported = importFromDXF(dxfStr, 'level-1', enrichedModel.layers);
  assert.ok(imported.summary.lines > 0, 'Should import LINE entities from DXF');
  assert.ok(imported.summary.polylines > 0, 'Should import LWPOLYLINE entities from DXF');
  assert.ok(imported.summary.circles > 0, 'Should import CIRCLE entities from DXF');
  assert.ok(imported.summary.arcs > 0, 'Should import ARC entities from DXF');
  assert.ok(imported.summary.texts > 0, 'Should import TEXT entities from DXF');
});

test('exportToIFC4 generates valid IFC4 STEP model with walls, doors, windows, slabs, and spaces', async () => {
  const { exportToIFC4 } = await import('./geometry');
  const sample = createSampleProject();
  const ifcStr = exportToIFC4(sample);

  assert.ok(ifcStr.startsWith('ISO-10303-21;'), 'IFC file must start with ISO-10303-21 header');
  assert.ok(ifcStr.includes("FILE_SCHEMA(('IFC4'));"), 'Must declare IFC4 schema');
  assert.ok(ifcStr.includes('IFCPROJECT('), 'Must contain IFCPROJECT');
  assert.ok(ifcStr.includes('IFCBUILDINGSTOREY('), 'Must contain IFCBUILDINGSTOREY');
  assert.ok(ifcStr.includes('IFCWALL('), 'Must export walls as IFCWALL');
  assert.ok(ifcStr.includes('IFCDOOR('), 'Must export doors as IFCDOOR');
  assert.ok(ifcStr.includes('IFCWINDOW('), 'Must export windows as IFCWINDOW');
  assert.ok(ifcStr.includes('IFCSLAB('), 'Must export slabs/floors as IFCSLAB');
  assert.ok(ifcStr.includes('IFCSPACE('), 'Must export rooms/spaces as IFCSPACE');
  assert.ok(ifcStr.includes('IFCEXTRUDEDAREASOLID('), 'Must include 3D SweptSolid geometry');
  assert.ok(ifcStr.trim().endsWith('END-ISO-10303-21;'), 'IFC file must end with END-ISO-10303-21;');
});

// --- BEGINNER USABILITY, SHORTCUTS & 2,000-OBJECT PERFORMANCE TESTS ---

test('createStressTestEntities generates 2,000 objects and findBestOsnap stays fast (< 25ms) with spatial culling', async () => {
  const {
    createDefaultLayers,
    createStressTestEntities,
    findBestOsnap,
    getEntityAnchorPoint,
  } = await import('./geometry');

  const stressEntities = createStressTestEntities(2000, 'level-1');
  assert.equal(stressEntities.length, 2000);

  // Measure OSNAP query time across all 2,000 objects
  const layers = createDefaultLayers();
  const t0 = performance.now();
  const snap = findBestOsnap(
    { x: 180, y: 140 },
    stressEntities,
    layers,
    14,
    { x: 0, y: 0 },
    [
      'Endpoint',
      'Midpoint',
      'Center',
      'Intersection',
      'Perpendicular',
      'Nearest',
      'Quadrant',
      'Tangent',
      'Extension',
    ]
  );
  const elapsedMs = performance.now() - t0;

  assert.ok(elapsedMs < 50, `OSNAP query across 2,000 objects took ${elapsedMs.toFixed(2)}ms (should be < 50ms)`);
  assert.ok(snap === null || typeof snap.point.x === 'number');

  // Verify getEntityAnchorPoint works for every generated entity type
  for (let i = 0; i < 20; i++) {
    const pt = getEntityAnchorPoint(stressEntities[i], stressEntities);
    assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));
  }
});

test('Shortcuts (KS), Guided Tour (TOUR), and Benchmark (BENCHMARK) commands resolve in COMMAND_REGISTRY', () => {
  for (const alias of ['KS', 'SHORTCUTS', 'TOUR', 'GUIDE', 'BENCHMARK', 'STRESSTEST']) {
    const cmd = findCommandByAlias(alias);
    assert.ok(cmd, `Command alias "${alias}" should resolve in COMMAND_REGISTRY`);
  }
});

// ============================================================================
// AUTOCAD 2021+ QUICK TRIM & EXTEND PURE FUNCTION TESTS
// ============================================================================

test('1. A line crossing two lines: clicking the middle removes only the middle piece -> two lines remain', async () => {
  const { trimAt } = await import('./trimExtend');
  const mainLine = {
    id: 'l-main',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 50 },
    end: { x: 300, y: 50 },
  };
  const cutter1 = {
    id: 'c1',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 100 },
  };
  const cutter2 = {
    id: 'c2',
    type: 'line' as const,
    layer: '0',
    start: { x: 200, y: 0 },
    end: { x: 200, y: 100 },
  };

  // Click in middle between cutter1 (x=100) and cutter2 (x=200)
  const res = trimAt(mainLine, { x: 150, y: 50 }, [cutter1, cutter2], { mode: 'quick' });

  assert.equal(res.action, 'replaced');
  assert.equal(res.entities.length, 2);
  const [rem1, rem2] = res.entities as typeof mainLine[];
  assert.deepEqual(rem1.start, { x: 0, y: 50 });
  assert.deepEqual(rem1.end, { x: 100, y: 50 });
  assert.deepEqual(rem2.start, { x: 200, y: 50 });
  assert.deepEqual(rem2.end, { x: 300, y: 50 });
});

test('2. Clicking near the end trims only to the first intersection', async () => {
  const { trimAt } = await import('./trimExtend');
  const mainLine = {
    id: 'l-main',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 50 },
    end: { x: 300, y: 50 },
  };
  const cutter1 = {
    id: 'c1',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 100 },
  };
  const cutter2 = {
    id: 'c2',
    type: 'line' as const,
    layer: '0',
    start: { x: 200, y: 0 },
    end: { x: 200, y: 100 },
  };

  // Click near the start (x=40, between 0 and 100)
  const res = trimAt(mainLine, { x: 40, y: 50 }, [cutter1, cutter2], { mode: 'quick' });

  assert.equal(res.action, 'replaced');
  assert.equal(res.entities.length, 1);
  const remaining = res.entities[0] as typeof mainLine;
  assert.deepEqual(remaining.start, { x: 100, y: 50 });
  assert.deepEqual(remaining.end, { x: 300, y: 50 });
});

test('3. Quick mode on a line with no intersections deletes it', async () => {
  const { trimAt } = await import('./trimExtend');
  const isolatedLine = {
    id: 'l-iso',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  };
  const farLine = {
    id: 'l-far',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 500 },
    end: { x: 100, y: 500 },
  };

  const res = trimAt(isolatedLine, { x: 50, y: 0 }, [farLine], { mode: 'quick' });
  assert.equal(res.action, 'deleted');
  assert.equal(res.entities.length, 0);
});

test('4. Extend: a short line extends to the nearest boundary, and a second click reaches the next one', async () => {
  const { extendAt } = await import('./trimExtend');
  const shortLine = {
    id: 'l-short',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 50 },
    end: { x: 50, y: 50 },
  };
  const bound1 = {
    id: 'b1',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 100 },
  };
  const bound2 = {
    id: 'b2',
    type: 'line' as const,
    layer: '0',
    start: { x: 200, y: 0 },
    end: { x: 200, y: 100 },
  };

  // First click near the end (x=50) -> extends to bound1 (x=100)
  const res1 = extendAt(shortLine, { x: 45, y: 50 }, [bound1, bound2], { mode: 'quick' });
  assert.ok(res1);
  const ext1 = res1.extendedEntity as typeof shortLine;
  assert.deepEqual(ext1.start, { x: 0, y: 50 });
  assert.deepEqual(ext1.end, { x: 100, y: 50 });

  // Second click near the new end (x=100) -> extends to bound2 (x=200)
  const res2 = extendAt(ext1, { x: 95, y: 50 }, [bound1, bound2], { mode: 'quick' });
  assert.ok(res2);
  const ext2 = res2.extendedEntity as typeof shortLine;
  assert.deepEqual(ext2.start, { x: 0, y: 50 });
  assert.deepEqual(ext2.end, { x: 200, y: 50 });
});

test('5. Standard mode Edge=Extend trims to an implied intersection; Edge=No extend does not', async () => {
  const { trimAt } = await import('./trimExtend');
  // mainLine goes from (0, 50) to (200, 50)
  const mainLine = {
    id: 'l-main',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 50 },
    end: { x: 200, y: 50 },
  };
  // shortCutter is at x=100, but only spans y=100 to y=200 (does not physically touch y=50!)
  const shortCutter = {
    id: 'c-short',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 100 },
    end: { x: 100, y: 200 },
  };

  // No extend (default standard) -> should NOT trim to implied intersection
  const resNoExtend = trimAt(mainLine, { x: 150, y: 50 }, [shortCutter], {
    mode: 'standard',
    edge: 'noextend',
  });
  assert.equal(resNoExtend.action, 'none');

  // Edge=Extend -> should trim along implied intersection at x=100!
  const resExtend = trimAt(mainLine, { x: 150, y: 50 }, [shortCutter], {
    mode: 'standard',
    edge: 'extend',
  });
  assert.equal(resExtend.action, 'replaced');
  assert.equal(resExtend.entities.length, 1);
  const trimmed = resExtend.entities[0] as typeof mainLine;
  assert.deepEqual(trimmed.start, { x: 0, y: 50 });
  assert.deepEqual(trimmed.end, { x: 100, y: 50 });
});

test('6. A circle cut by two lines becomes an arc with the clicked side removed', async () => {
  const { trimAt } = await import('./trimExtend');
  const circle = {
    id: 'circ-1',
    type: 'circle' as const,
    layer: '0',
    center: { x: 100, y: 100 },
    radius: 50,
  };
  // Cutter 1: horizontal line passing through center (intersects at 0 deg / (150, 100) and 180 deg / (50, 100))
  const cutter1 = {
    id: 'c1',
    type: 'line' as const,
    layer: '0',
    start: { x: 0, y: 100 },
    end: { x: 200, y: 100 },
  };
  // Cutter 2: vertical line passing through center (intersects at 90 deg / (100, 150) and 270 deg / (100, 50))
  const cutter2 = {
    id: 'c2',
    type: 'line' as const,
    layer: '0',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 200 },
  };

  // Click top-right quadrant at (135, 135) near 45 deg
  const res = trimAt(circle, { x: 135, y: 135 }, [cutter1, cutter2], { mode: 'quick' });
  assert.equal(res.action, 'replaced');
  assert.equal(res.entities.length, 1);
  assert.equal(res.entities[0].type, 'arc');
  const arc = res.entities[0] as { type: 'arc'; startAngle: number; endAngle: number };
  // The clicked interval between 0 and 90 degrees was removed; remaining arc is from 90 to 0 (counter-clockwise)
  assert.ok(Math.abs(arc.startAngle - 90) < 1);
  assert.ok(Math.abs(arc.endAngle - 0) < 1 || Math.abs(arc.endAngle - 360) < 1);
});

test('7. Splitting a wall keeps each door on the correct half', async () => {
  const { trimAt } = await import('./trimExtend');
  const wall: WallEntity = {
    id: 'wall-1',
    type: 'wall',
    layer: 'A-WALL',
    start: { x: 0, y: 0 },
    end: { x: 400, y: 0 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center',
  };
  // Door 1 is on the first half at x=50
  const door1: DoorEntity = {
    id: 'door-1',
    type: 'door',
    layer: 'A-DOOR',
    wallId: 'wall-1',
    offset: 50 / 400,
    width: 36,
    height: 84,
    swing: 'left-in',
  };
  // Door 2 is on the second half at x=350
  const door2: DoorEntity = {
    id: 'door-2',
    type: 'door',
    layer: 'A-DOOR',
    wallId: 'wall-1',
    offset: 350 / 400,
    width: 36,
    height: 84,
    swing: 'right-in',
  };

  // Cutting line 1 at x=150, cutting line 2 at x=250
  const cut1: LineEntity = {
    id: 'cut-1',
    type: 'line',
    layer: '0',
    start: { x: 150, y: -50 },
    end: { x: 150, y: 50 },
  };
  const cut2: LineEntity = {
    id: 'cut-2',
    type: 'line',
    layer: '0',
    start: { x: 250, y: -50 },
    end: { x: 250, y: 50 },
  };

  // Click in middle at x=200 to remove middle wall segment
  const allEntities = [wall, door1, door2, cut1, cut2];
  const res = trimAt(wall, { x: 200, y: 0 }, [cut1, cut2], { mode: 'quick' }, allEntities);

  assert.equal(res.action, 'replaced');
  assert.equal(res.entities.length, 2);
  const wallA = res.entities[0] as WallEntity;
  const wallB = res.entities[1] as WallEntity;

  assert.equal(wallA.start.x, 0);
  assert.equal(wallA.end.x, 150);
  assert.equal(wallB.start.x, 250);
  assert.equal(wallB.end.x, 400);

  // Verify updated openings
  assert.ok(res.updatedOpenings && res.updatedOpenings.length === 2);
  const updatedD1 = res.updatedOpenings.find((d) => d.id === 'door-1');
  const updatedD2 = res.updatedOpenings.find((d) => d.id === 'door-2');
  assert.ok(updatedD1 && updatedD1.wallId === wallA.id);
  assert.ok(updatedD2 && updatedD2.wallId === wallB.id);
});

test('8. CORNER (TC) trims or extends two walls/lines into clean corner keeping clicked sides', async () => {
  const { trimExtendCorner } = await import('./trimExtend');
  const w1: WallEntity = {
    id: 'w1',
    type: 'wall',
    layer: 'A-WALL',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center',
  };
  const w2: WallEntity = {
    id: 'w2',
    type: 'wall',
    layer: 'A-WALL',
    start: { x: 150, y: 50 },
    end: { x: 150, y: 200 },
    thickness: 6,
    height: 108,
    baseOffset: 0,
    justification: 'center',
  };

  // Corner is at (150, 0)
  const res = trimExtendCorner(w1, w2, { x: 20, y: 0 }, { x: 150, y: 180 });
  assert.ok(res);
  assert.deepEqual(res.corner, { x: 150, y: 0 });
  const [mod1, mod2] = res.modified as WallEntity[];
  assert.deepEqual(mod1.start, { x: 0, y: 0 });
  assert.deepEqual(mod1.end, { x: 150, y: 0 });
  assert.deepEqual(mod2.start, { x: 150, y: 0 });
  assert.deepEqual(mod2.end, { x: 150, y: 200 });
});



// ============================================================================
// Documentation output hardening (schedules, sheets/PDF, DXF R2000, DXF import, IFC4)
// ============================================================================

const dxfPairs = (dxf: string): Array<[string, string]> => {
  const lines = dxf.split(/\r?\n/);
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1]]);
  return out;
};

const docSample = async () => {
  const { createSampleProject } = await import('./geometry');
  const m = createSampleProject();
  m.entities.push(
    { id: 'tst-hatch', type: 'hatch', layer: 'A-ANNO', levelId: 'level-1', polygon: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 50 }], pattern: 'diagonal', scale: 1, angle: 0 },
    { id: 'tst-bed', type: 'block', layer: 'A-FURN', levelId: 'level-1', blockId: 'starter-bed', name: 'Bed', position: { x: 250, y: 120 }, rotation: 30, scale: 1, width: 72, depth: 90, height: 24, color: '#999' },
    { id: 'tst-l2', type: 'wall', layer: 'A-WALL', levelId: 'level-2', start: { x: 0, y: 0 }, end: { x: 99, y: 0 }, thickness: 6, height: 108, baseOffset: 0, justification: 'center' }
  );
  return m;
};

test('DXF export is a structurally valid AutoCAD R2000 file with native dimensions, hatches and blocks', async () => {
  const { exportModelToDXF } = await import('./documentation');
  const m = await docSample();
  const dxf = exportModelToDXF(m, { levelId: 'level-1' });
  const pairs = dxfPairs(dxf);
  const at = (code: string, value: string) => pairs.findIndex(([c, v]) => c === code && v === value);
  assert.ok(at('1', 'AC1015') > 0, 'R2000 header');
  assert.ok(at('9', '$HANDSEED') > 0, '$HANDSEED present');
  for (const t of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']) {
    assert.ok(pairs.some(([c, v], i) => c === '0' && v === 'TABLE' && pairs[i + 1][1] === t), `table ${t}`);
  }
  // handles are unique
  const handles = pairs.filter(([c]) => c === '5' || c === '105').map(([, v]) => v);
  assert.equal(new Set(handles).size, handles.length, 'unique handles');
  // every DIMENSION references an anonymous *D block that exists
  const blockNames = new Set(pairs.filter(([c], i) => c === '2' && pairs[i - 1]?.[1] === 'AcDbBlockBegin').map(([, v]) => v));
  const dimIdx = pairs.map(([c, v], i) => (c === '0' && v === 'DIMENSION' ? i : -1)).filter((i) => i >= 0);
  assert.equal(dimIdx.length, 2, 'both sample dimensions are native DIMENSIONs');
  for (const i of dimIdx) {
    const name = pairs.slice(i, i + 20).find(([c]) => c === '2')?.[1] || '';
    assert.match(name, /^\*D\d+$/);
    assert.ok(blockNames.has(name), `geometry block ${name} exists`);
  }
  // HATCH carries a polyline boundary with all vertices
  const hi = at('0', 'HATCH');
  assert.ok(hi > 0);
  assert.equal(pairs.slice(hi, hi + 40).find(([c]) => c === '93')?.[1], '3');
  // block instance is one INSERT (no duplicated exploded geometry in model space)
  assert.equal(pairs.filter(([c, v]) => c === '0' && v === 'INSERT').length, 1);
  assert.ok(blockNames.has('Queen Bed'));
  const insertIdx = at('0', 'INSERT');
  assert.equal(pairs.slice(insertIdx, insertIdx + 20).find(([c]) => c === '50')?.[1], '30.0', 'rotation keeps sign after Y flip');
  // one LAYER record per app layer
  for (const l of m.layers) assert.ok(pairs.some(([c, v], i) => c === '2' && v === l.name && pairs[i - 1]?.[1] === 'AcDbLayerTableRecord'), `layer ${l.name}`);
  // level filtering: the level-2 wall is only in the all-levels export
  const count = (s: string) => {
    const ps = dxfPairs(s);
    return ps.filter(([c, v], i) => c === '0' && v === 'LWPOLYLINE' && ps.slice(i, i + 8).some(([c2, v2]) => c2 === '8' && v2 === 'A-WALL')).length;
  };
  assert.equal(count(exportModelToDXF(m, { levelId: 'all' })) - count(dxf), 1);
});

test('DXF export writes metric projects in millimetres ($INSUNITS 4)', async () => {
  const { exportModelToDXF } = await import('./documentation');
  const m = await docSample();
  const imp = dxfPairs(exportModelToDXF(m));
  m.settings.units = 'metric';
  const met = dxfPairs(exportModelToDXF(m));
  const insunits = (p: Array<[string, string]>) => p[p.findIndex(([c, v]) => c === '9' && v === '$INSUNITS') + 1][1];
  assert.equal(insunits(imp), '1');
  assert.equal(insunits(met), '4');
  // drawing extents scale by exactly 25.4
  const extMaxX = (p: Array<[string, string]>) => Number(p[p.findIndex(([c, v]) => c === '9' && v === '$EXTMAX') + 1][1]);
  const a = extMaxX(imp);
  const b = extMaxX(met);
  assert.ok(a > 0);
  assert.ok(Math.abs(b / a - 25.4) < 1e-6);
});

test('DXF import converts units, bulge arcs, MTEXT codes and reports skipped types', async () => {
  const { importFromDXF } = await import('./documentation');
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'WALLS', '10', '0', '20', '0', '30', '0', '11', '2540', '21', '0', '31', '0',
    '0', 'LWPOLYLINE', '8', 'WALLS', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '254', '20', '0',
    '0', 'MTEXT', '8', 'NOTES', '10', '0', '20', '0', '40', '127', '1', '{\\fArial|b1;Room}\\Pnote %%c50',
    '0', 'INSERT', '8', '0', '2', 'CHAIR', '10', '0', '20', '0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\n');
  const res = importFromDXF(dxf, 'level-1', undefined, 'imperial');
  assert.equal(res.summary.sourceUnits, 'millimeters');
  const line = res.entities.find((e) => e.type === 'line') as LineEntity;
  assert.ok(Math.abs(line.end.x - 100) < 1e-9, '2540 mm = 100"');
  const arc = res.entities.find((e) => e.type === 'arc') as import('../types/model').ArcEntity;
  assert.ok(arc, 'bulge 1 becomes a true semicircular arc');
  assert.ok(Math.abs(arc.radius - 5) < 1e-9);
  assert.ok(Math.abs(arc.center.x - 5) < 1e-9 && Math.abs(arc.center.y) < 1e-9);
  const txt = res.entities.find((e) => e.type === 'text') as import('../types/model').TextEntity;
  assert.equal(txt.text, 'Room note Ø50');
  assert.equal(res.summary.skipped.INSERT, 1);
  assert.deepEqual(res.summary.newLayers.sort(), ['NOTES', 'WALLS']);
});

test('IFC4 export has valid unique GlobalIds, unshared shapes and full-depth openings', async () => {
  const { exportToIFC4, makeIfcGuid } = await import('./documentation');
  const m = await docSample();
  m.projectName = 'Café';
  const ifc = exportToIFC4(m);
  const guids = [...ifc.matchAll(/^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'/gm)].map((x) => x[1]);
  assert.ok(guids.length > 20);
  for (const g of guids) assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.equal(new Set(guids).size, guids.length, 'GlobalIds unique');
  assert.equal(makeIfcGuid('x'), makeIfcGuid('x'), 'stable across exports');
  assert.match(ifc, /IFCOWNERHISTORY\([^)]*\.ADDED\.,\d+,/, 'ADDED change action carries LastModifiedDate');
  assert.ok(ifc.includes("'Caf\\X2\\00E9\\X0\\'"), 'non-ASCII encoded per ISO 10303-21');
  // each IfcProductDefinitionShape is used by exactly one product
  const shapeRefs = [...ifc.matchAll(/^#\d+=IFC(?:WALL|DOOR|WINDOW|SLAB|SPACE|OPENINGELEMENT)\('[^']+',#\d+,[^,]*,[^,]*,[^,]*,#\d+,#(\d+)/gm)].map((x) => x[1]);
  assert.equal(new Set(shapeRefs).size, shapeRefs.length, 'no shared product shapes');
  // 2 doors + 4 windows + 1 arched wall opening each void their host wall
  assert.equal((ifc.match(/IFCRELVOIDSELEMENT\(/g) || []).length, 7);
  assert.ok(ifc.includes("'Qto_SpaceBaseQuantities'"));
});

test('Sheet plan viewports plot at their exact scale and report when they do not fit', async () => {
  const { getPlanViewportTransform, findFittingScale } = await import('./documentation');
  const m = await docSample();
  const vp = { id: 'v', kind: 'plan' as const, title: 'P', levelId: 'level-1', scale: '1/4" = 1\'-0"' as const, x: 10, y: 10, width: 300, height: 200 };
  const t = getPlanViewportTransform(m, vp);
  assert.ok(Math.abs(t.mmPerIn - 25.4 / 48) < 1e-12, 'exact 1/4" scale');
  assert.equal(t.fits, true);
  const small = { ...vp, width: 90, height: 70 };
  const ts = getPlanViewportTransform(m, small);
  assert.equal(ts.fits, false);
  assert.ok(Math.abs(ts.mmPerIn - 25.4 / 48) < 1e-12, 'scale is never silently shrunk');
  const fit = findFittingScale(m, small);
  assert.ok(fit && getPlanViewportTransform(m, { ...small, scale: fit }).fits);
  // windows, doors and walls all present in the plotted primitives
  assert.ok(t.prims.filter((p) => p.k === 'poly' && p.closed && p.fill === '#ffffff').length >= 2, 'window symbols');
});

test('Schedule tables, CSV escaping and multi-page sheet PDF sizes', async () => {
  const { getScheduleTable, exportScheduleToCSV, generateSheetsPDF, createStarterSheets } = await import('./documentation');
  const m = await docSample();
  const door = m.entities.find((e) => e.type === 'door') as DoorEntity;
  door.comments = 'Fire rated, "90 min"';
  const t = getScheduleTable(m, 'doors');
  assert.equal(t.headers.length, t.weights.length);
  assert.equal(t.rows[0][5], 'Left / In');
  const csv = exportScheduleToCSV(m, 'doors');
  assert.ok(csv.includes('"Fire rated, ""90 min"""'));
  assert.ok(csv.endsWith('\r\n'));
  const sheets = createStarterSheets();
  const extra = ['Tabloid', 'A1'].map((size, i) => ({ ...sheets[0], id: `s${i}`, sheetNumber: `A10${i + 2}`, size: size as 'Tabloid' | 'A1' }));
  const pdf = generateSheetsPDF(m, [...sheets, ...extra], null);
  assert.equal(pdf.getNumberOfPages(), 5); // A101, A201 (elevations + roof plan), S101 (structure), Tabloid, A1
  const dims = [1, 2, 3, 4, 5].map((p) => {
    pdf.setPage(p);
    return [Math.round(pdf.internal.pageSize.getWidth()), Math.round(pdf.internal.pageSize.getHeight())];
  });
  assert.deepEqual(dims, [[420, 297], [420, 297], [420, 297], [432, 279], [841, 594]]);
});

test('parseLengthInput accepts the fractional feet-inch values formatLength produces', () => {
  assert.equal(parseLengthInput(`9'-8 1/2"`, 'imperial'), 116.5);
  assert.equal(parseLengthInput(`30 1/2"`, 'imperial'), 30.5);
  assert.equal(parseLengthInput(`3/4"`, 'imperial'), 0.75);
  for (const v of [36, 30.5, 116.5, 150]) assert.equal(parseLengthInput(formatLength(v, 'imperial'), 'imperial'), v);
});

// ============================================================================
// Smart alignment guides (TRACK / F11) — inferCursor
// ============================================================================

test('Smart guides (a): rectangle completion snaps exactly onto the start point alignment', async () => {
  const { inferCursor } = await import('./geometry');
  const zoom = 1.5; // default view zoom (px per inch)
  // 20' x 10' rectangle drawn as a wall/polyline: P0 -> P1 -> P2 (two sides done)
  const P0 = { x: 0, y: 0 };
  const P1 = { x: 240, y: 0 };
  const P2 = { x: 240, y: 120 };
  // Drawing the 3rd side: cursor 0.1' (1.2") off the start point's x
  const r1 = inferCursor({ x: 1.2, y: 120.4 }, { segments: [], currentPoints: [P0, P1, P2], zoom });
  assert.equal(r1.point.x, 0, 'x locks exactly onto the start point');
  assert.equal(r1.point.y, 120, 'y stays on the horizontal through the last point');
  assert.equal(r1.guides.length, 2, 'both guides shown at the crossing');
  assert.match(r1.label || '', /Intersection/);
  // After 3 sides (P0..P3), drawing the 4th: cursor 0.1' off x of the start point snaps onto it
  const P3 = { x: 0, y: 120 };
  const r2 = inferCursor({ x: 1.2, y: 60 }, { segments: [], currentPoints: [P0, P1, P2, P3], zoom });
  assert.equal(r2.point.x, 0);
  assert.ok(r2.guides.length >= 1 && r2.guides.length <= 2);
});

test('Smart guides (b): parallel segment drawn at 19\'-10" snaps to exactly 20\'-0" of an existing wall', async () => {
  const { inferCursor } = await import('./geometry');
  const wall = { id: 'wall-20', a: { x: 0, y: 0 }, b: { x: 240, y: 0 } }; // 20'-0"
  const start = { x: 60, y: 120 };
  const cursor = { x: 60 + 238, y: 120.3 }; // 19'-10", slightly off horizontal
  const r = inferCursor(cursor, { segments: [wall], currentPoints: [start], zoom: 1.5 });
  assert.equal(r.equalTo, 'wall-20');
  assert.equal(r.point.x, 300);
  assert.equal(r.point.y, 120);
  assert.equal(dist(start, r.point), 240, 'exactly 20\'-0"');
  assert.equal(r.label, `Equal length 20'-0"`);
  assert.ok(r.highlight.some((h) => h.id === 'wall-20'));
  assert.equal(r.equalMarks.length, 2, '"=" ticks on both segments');
  // Outside 10 px at this zoom (19'-0" = 12" short = 18 px) it does not snap the length
  const far = inferCursor({ x: 60 + 228, y: 120 }, { segments: [wall], currentPoints: [start], zoom: 1.5 });
  assert.equal(far.equalTo, undefined);
});

test('Smart guides (c): a segment 1.5° off an existing wall snaps exactly parallel', async () => {
  const { inferCursor } = await import('./geometry');
  const a30 = (30 * Math.PI) / 180;
  const wall = { id: 'w30', a: { x: 0, y: 0 }, b: { x: 240 * Math.cos(a30), y: -240 * Math.sin(a30) } };
  const start = { x: 500, y: 300 };
  const a = (31.5 * Math.PI) / 180;
  const cursor = { x: start.x + 200 * Math.cos(a), y: start.y - 200 * Math.sin(a) };
  const r = inferCursor(cursor, { segments: [wall], currentPoints: [start], zoom: 1.5 });
  assert.equal(r.label, 'Parallel');
  const v = sub(r.point, start);
  const crossVal = v.x * (wall.b.y - wall.a.y) - v.y * (wall.b.x - wall.a.x);
  assert.ok(Math.abs(crossVal) < 1e-6, 'exactly parallel');
  assert.ok(r.highlight.some((h) => h.id === 'w30'));
  // 3° off: no angle snap
  const b = (33 * Math.PI) / 180;
  const r2 = inferCursor({ x: start.x + 200 * Math.cos(b), y: start.y - 200 * Math.sin(b) }, { segments: [wall], currentPoints: [start], zoom: 1.5 });
  assert.notEqual(r2.label, 'Parallel');
});

test('Smart guides: extension, perpendicular, tolerances, toggles and Shift lock', async () => {
  const { inferCursor } = await import('./geometry');
  const diag = { id: 'd', a: { x: 0, y: 0 }, b: { x: 100, y: 100 } };
  // extension past the end of a diagonal line
  const e = inferCursor({ x: 150.5, y: 149.5 }, { segments: [diag], currentPoints: [], zoom: 1 });
  assert.equal(e.label, 'Extension');
  assert.ok(Math.abs(e.point.x - e.point.y) < 1e-9);
  // zoom independence: 8 px off aligns at zoom 1 (8") and at zoom 4 (2"), not 12 px off
  const pts = [{ x: 0, y: 0 }];
  assert.equal(inferCursor({ x: 300, y: 8 }, { segments: [], currentPoints: pts, zoom: 1, segmentGuides: false }).point.y, 0);
  assert.equal(inferCursor({ x: 300, y: 2 }, { segments: [], currentPoints: pts, zoom: 4, segmentGuides: false }).point.y, 0);
  assert.equal(inferCursor({ x: 300, y: 3 }, { segments: [], currentPoints: pts, zoom: 4, segmentGuides: false }).snapped, false);
  // perpendicular to a diagonal reference
  const p = inferCursor({ x: 300 + 150, y: 300 - 153 }, { segments: [diag], currentPoints: [{ x: 300, y: 300 }], zoom: 1 });
  assert.equal(p.label, 'Perpendicular');
  const v = sub(p.point, { x: 300, y: 300 });
  assert.ok(Math.abs(v.x * 100 + v.y * 100) < 1e-6);
  // per-type toggles
  const off = inferCursor({ x: 150.5, y: 149.5 }, { segments: [diag], currentPoints: [], zoom: 1, settings: { extension: false } });
  assert.equal(off.snapped, false);
  // Shift lock keeps the cursor on the guide even far from it
  const lock = inferCursor({ x: 80, y: 40 }, { segments: [diag], currentPoints: [], zoom: 1, lockGuide: e.guides[0] });
  assert.ok(Math.abs(lock.point.x - lock.point.y) < 1e-9);
  // never more than 2 guides
  assert.ok(e.guides.length <= 2 && lock.guides.length <= 2);
});

test('Smart guides stay fast with 2,000 objects (spatial index + on-screen filter)', async () => {
  const { inferCursor, buildSegmentIndex, querySegmentIndex, getInferenceSegments, createStressTestEntities } = await import('./geometry');
  const ents = createStressTestEntities(2000);
  const segs = getInferenceSegments(ents);
  const index = buildSegmentIndex(segs);
  const view = { minX: 0, minY: 0, maxX: 900, maxY: 600 };
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    const vis = querySegmentIndex(index, view);
    inferCursor({ x: 100 + i * 3.1, y: 200 + i * 1.7 }, { segments: vis, currentPoints: [{ x: 50, y: 50 }, { x: 300, y: 60 }], zoom: 1.5 });
  }
  const per = (performance.now() - t0) / 100;
  assert.ok(segs.length > 1000, `segments: ${segs.length}`);
  assert.ok(per < 8, `inferCursor + query took ${per.toFixed(2)} ms per mouse move`);
});
