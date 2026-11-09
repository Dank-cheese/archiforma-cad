import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateStairRisers,
  splitRisersAcrossRuns,
  getRunEdgeGeometry,
  snapSecondRunWithAutoLanding,
  createStairFromTemplate,
  insertLandingAtRiser,
  rebalanceStairLandingSplit,
  resizeStairLanding,
  computeStairPlanGeometry,
  computeStairHeadroomAndOpening,
  syncStairFloorOpenings,
  applyStairGripMove,
  STAIR_TEMPLATES,
} from './stairs';
import { createHistoryState, pushHistory, undoHistory, redoHistory } from './history';
import type { ArchEntity, ArchModel, FloorEntity, LevelDefinition, Point, StairEntity } from '../types/model';

const levels: LevelDefinition[] = [
  { id: 'level-1', name: 'Level 1', elevation: 0, floorToFloorHeight: 120 },
  { id: 'level-2', name: 'Level 2', elevation: 120, floorToFloorHeight: 120 },
];

const pointInPolygon = (pt: Point, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    // Check if point lies on boundary segment
    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 1e-9) {
      const t = Math.max(0, Math.min(1, ((pt.x - xi) * dx + (pt.y - yi) * dy) / lenSq));
      const projX = xi + t * dx;
      const projY = yi + t * dy;
      if (Math.hypot(pt.x - projX, pt.y - projY) < 1e-2) {
        return true;
      }
    }
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

test('1. Riser calculation & multi-run split for 10\'-0" (120") floor-to-floor height', () => {
  // 120" floor-to-floor with max riser 7.5" -> 16 risers @ 7.5"
  const calc16 = calculateStairRisers(120, 7.5, 10, 2);
  assert.equal(calc16.numRisers, 16);
  assert.equal(calc16.riserHeight, 7.5);
  assert.deepEqual(calc16.runRiserCounts, [8, 8]);

  // 120" floor-to-floor with max riser 7.06" -> 17 risers @ ~7.0588"
  const calc17 = calculateStairRisers(120, 7.06, 10, 2);
  assert.equal(calc17.numRisers, 17);
  assert.ok(Math.abs(calc17.riserHeight - 120 / 17) < 1e-6);
  assert.deepEqual(calc17.runRiserCounts, [8, 9]);

  // Split 17 risers across Run 1 + Landing + Run 2
  const split2 = splitRisersAcrossRuns(17, 2);
  assert.deepEqual(split2, [8, 9]);
  assert.equal(split2[0] + split2[1], 17);

  // Split 17 risers across 2 runs with custom split at riser 10
  const splitCustom = splitRisersAcrossRuns(17, 2, 10);
  assert.deepEqual(splitCustom, [10, 7]);

  // Split 17 risers across 3 runs (2 landings)
  const split3 = splitRisersAcrossRuns(17, 3);
  assert.equal(split3.length, 3);
  assert.equal(split3[0] + split3[1] + split3[2], 17);
});

test('2. Automatic L-landing and U-landing polygon connects exit edge of Run 1 to entry edge of Run 2 with zero gaps and accurate elevation', () => {
  // Test L-Stair (Left turn) via template
  const lStair = createStairFromTemplate({
    shape: 'l-left',
    origin: { x: 100, y: 200 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 17,
    treadDepth: 11,
    width: 42,
    splitRiser: 8,
  });

  assert.equal(lStair.runs?.length, 2);
  assert.equal(lStair.landings?.length, 1);

  const run1 = lStair.runs![0];
  const run2 = lStair.runs![1];
  const landing = lStair.landings![0];

  // Total risers across Run 1 + Run 2 == 17, equal riserHeight
  assert.equal(run1.numRisers + run2.numRisers, 17);
  assert.equal(run1.numRisers, 8);
  assert.equal(run2.numRisers, 9);

  // Accurate landing elevationOffset = 8 * (120 / 17)
  const expectedElevation = 8 * (120 / 17);
  assert.ok(Math.abs(landing.elevationOffset - expectedElevation) < 1e-4);
  assert.ok(Math.abs(run2.baseElevationOffset - expectedElevation) < 1e-4);

  // Verify Run 1 exit edge and Run 2 entry edge touch the landing polygon with zero gaps
  const g1 = getRunEdgeGeometry(run1);
  const g2 = getRunEdgeGeometry(run2);
  assert.ok(pointInPolygon(g1.exitLeft, landing.polygon), 'Run 1 exitLeft on L-landing boundary');
  assert.ok(pointInPolygon(g1.exitRight, landing.polygon), 'Run 1 exitRight on L-landing boundary');
  assert.ok(pointInPolygon(g2.entryLeft, landing.polygon), 'Run 2 entryLeft on L-landing boundary');
  assert.ok(pointInPolygon(g2.entryRight, landing.polygon), 'Run 2 entryRight on L-landing boundary');

  // Test U-Switchback Stair
  const uStair = createStairFromTemplate({
    shape: 'u-switchback',
    origin: { x: 100, y: 200 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 16,
    treadDepth: 11,
    width: 42,
    wellGap: 8,
    splitRiser: 8,
  });

  assert.equal(uStair.runs?.length, 2);
  assert.equal(uStair.landings?.length, 1);
  const uRun1 = uStair.runs![0];
  const uRun2 = uStair.runs![1];
  const uLanding = uStair.landings![0];

  assert.ok(Math.abs(uLanding.elevationOffset - 60) < 1e-4);
  const ug1 = getRunEdgeGeometry(uRun1);
  const ug2 = getRunEdgeGeometry(uRun2);
  assert.ok(pointInPolygon(ug1.exitLeft, uLanding.polygon), 'U-Run 1 exitLeft on U-landing boundary');
  assert.ok(pointInPolygon(ug1.exitRight, uLanding.polygon), 'U-Run 1 exitRight on U-landing boundary');
  assert.ok(pointInPolygon(ug2.entryLeft, uLanding.polygon), 'U-Run 2 entryLeft on U-landing boundary');
  assert.ok(pointInPolygon(ug2.entryRight, uLanding.polygon), 'U-Run 2 entryRight on U-landing boundary');

  // Test Interactive Multi-Run snapSecondRunWithAutoLanding (90° right turn)
  const snapped = snapSecondRunWithAutoLanding(
    uRun1,
    { x: uRun1.end.x + 21, y: uRun1.end.y + 30 },
    { x: uRun1.end.x + 21, y: uRun1.end.y + 120 },
    8,
    7.5
  );
  const sg2 = getRunEdgeGeometry(snapped.run2);
  assert.ok(pointInPolygon(ug1.exitLeft, snapped.landing.polygon));
  assert.ok(pointInPolygon(sg2.entryRight, snapped.landing.polygon));
});

test('3. Rebalancing landing riser split and inserting/resizing landing updates Run 1 & Run 2 while keeping total risers intact', () => {
  const stair = createStairFromTemplate({
    shape: 'l-right',
    origin: { x: 0, y: 0 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 17,
    treadDepth: 11,
    width: 42,
    splitRiser: 8,
  });

  // Change landing split to Riser 11 of 17
  const rebalanced = rebalanceStairLandingSplit(stair, levels, 11);
  assert.equal(rebalanced.numRisers, 17);
  assert.equal(rebalanced.runs![0].numRisers, 11);
  assert.equal(rebalanced.runs![1].numRisers, 6);
  assert.equal(rebalanced.runs![0].numRisers + rebalanced.runs![1].numRisers, 17);
  assert.ok(Math.abs(rebalanced.landings![0].elevationOffset - 11 * (120 / 17)) < 1e-3);

  // Split a straight stair using insertLandingAtRiser
  const straight = createStairFromTemplate({
    shape: 'straight',
    origin: { x: 0, y: 0 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 16,
  });
  assert.equal(straight.runs?.length, 1);
  assert.equal(straight.landings?.length, 0);

  const splitStraight = insertLandingAtRiser(straight, levels, 7, 'straight-landing');
  assert.equal(splitStraight.runs?.length, 2);
  assert.equal(splitStraight.landings?.length, 1);
  assert.equal(splitStraight.runs![0].numRisers, 7);
  assert.equal(splitStraight.runs![1].numRisers, 9);

  // Resize landing depth & width
  const resized = resizeStairLanding(splitStraight, levels, 0, { depth: 60, width: 54 });
  assert.equal(resized.landings![0].depth, 60);
  assert.equal(resized.landings![0].width, 54);
});

test('4. Headroom & stairwell opening polygon covers both runs and the landing footprint', () => {
  const stair = createStairFromTemplate({
    shape: 'u-switchback',
    origin: { x: 100, y: 100 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 17,
    treadDepth: 11,
    width: 42,
    wellGap: 6,
    cutFloorAbove: true,
  });

  const headroom = computeStairHeadroomAndOpening(stair, levels, 8);
  assert.equal(headroom.passesCode, true);
  assert.ok(headroom.minHeadroomInches >= 80, 'Headroom meets 6\'-8" (80") code minimum');
  assert.ok(headroom.openingPolygon.length >= 4);

  // Check that every corner of Run 1, Run 2, and Landing is inside openingPolygon
  for (const run of stair.runs!) {
    const g = getRunEdgeGeometry(run);
    for (const corner of g.outline) {
      assert.ok(
        pointInPolygon(corner, headroom.openingPolygon),
        `Run ${run.id} corner (${corner.x.toFixed(1)}, ${corner.y.toFixed(1)}) is covered by stairwell opening`
      );
    }
  }
  for (const corner of stair.landings![0].polygon) {
    assert.ok(
      pointInPolygon(corner, headroom.openingPolygon),
      `Landing corner (${corner.x.toFixed(1)}, ${corner.y.toFixed(1)}) is covered by stairwell opening`
    );
  }

  // Verify syncStairFloorOpenings cuts the opening into an upper floor slab
  const upperSlab: FloorEntity = {
    id: 'floor-level-2',
    type: 'floor',
    layer: 'A-FLOR',
    levelId: 'level-2',
    thickness: 8,
    material: 'concrete',
    polygon: [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
      { x: 0, y: 500 },
    ],
  };

  const synced = syncStairFloorOpenings([upperSlab, stair], levels);
  const updatedSlab = synced.find((e) => e.id === 'floor-level-2') as FloorEntity;
  assert.equal(updatedSlab.openings?.length, 1);
  assert.ok(updatedSlab.openings![0].length >= 4);
});

test('5. All 9 templates generate valid 2D architectural plan geometry with cut-break, riser numbers, and continuous walk-line', () => {
  for (const tpl of STAIR_TEMPLATES) {
    const stair = createStairFromTemplate({
      shape: tpl.id,
      origin: { x: 100, y: 100 },
      baseLevelId: 'level-1',
      topLevelId: 'level-2',
      baseElevation: 0,
      topElevation: 120,
      desiredRisers: 16,
      treadDepth: 11,
      width: 42,
    });
    const plan = computeStairPlanGeometry(stair, { levels, viewedFromTopLevel: false });
    assert.equal(plan.riserLabels.length, 16, `Template ${tpl.id} has 16 numbered risers`);
    assert.ok(plan.walkPath.length >= 2, `Template ${tpl.id} has continuous walk line`);
    assert.ok(plan.cutBreakLine !== null, `Template ${tpl.id} has 4'-0" cut-break line on base level`);
  }
});

test('6. Undo / Redo works across Stair creation, Landing split rebalancing, Grip editing, and Floor opening sync', () => {
  const upperSlab: FloorEntity = {
    id: 'floor-level-2',
    type: 'floor',
    layer: 'A-FLOR',
    levelId: 'level-2',
    thickness: 8,
    material: 'concrete',
    polygon: [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 600 },
      { x: 0, y: 600 },
    ],
  };

  const baseModel: ArchModel = {
    projectName: 'Stair Undo Test',
    activeLayer: 'A-WALL',
    activeLevelId: 'level-1',
    levels,
    layers: [{ id: 'A-WALL', name: 'Walls', color: '#333333', visible: true, locked: false }],
    entities: [upperSlab],
    settings: {
      units: 'imperial',
      gridVisible: true,
      gridSize: 12,
      snapEnabled: true,
      snapSize: 6,
      orthoEnabled: false,
      osnapEnabled: true,
      enabledOsnaps: ['Endpoint', 'Midpoint', 'Intersection'],
      polarTracking: true,
      polarIncrement: 45,
      osnapTracking: true,
      dynamicInput: true,
      revitStyleDI: true,
      dimStyle: {
        textHeight: 8,
        arrowType: 'tick',
        precision: 1,
        baselineSpacing: 18,
        extensionOvershoot: 4,
        preferFace: 'auto',
      },
    },
  };

  let history = createHistoryState(baseModel);
  assert.equal(history.present.entities.length, 1);

  // Step 1: Place U-Switchback Stair with Landing (auto-cuts Level 2 floor opening)
  const stair1 = createStairFromTemplate({
    id: 'stair-u-1',
    shape: 'u-switchback',
    origin: { x: 120, y: 200 },
    baseLevelId: 'level-1',
    topLevelId: 'level-2',
    baseElevation: 0,
    topElevation: 120,
    desiredRisers: 16,
    splitRiser: 8,
    width: 42,
    treadDepth: 11,
    wellGap: 6,
    cutFloorAbove: true,
  });
  const modelAfterPlace: ArchModel = {
    ...history.present,
    entities: syncStairFloorOpenings([...history.present.entities, stair1], levels),
  };
  history = pushHistory(history, modelAfterPlace, 'Place U-Switchback Stair');

  assert.equal(history.present.entities.length, 2);
  const slabAfterPlace = history.present.entities.find((e: ArchEntity) => e.id === 'floor-level-2') as FloorEntity;
  assert.equal(slabAfterPlace.openings?.length, 1, 'Upper slab has stairwell opening after placing stair');

  // Step 2: Rebalance Landing Split from Riser 8 -> Riser 6
  const rebalanced = rebalanceStairLandingSplit(stair1, levels, 6);
  const modelAfterRebalance: ArchModel = {
    ...history.present,
    entities: syncStairFloorOpenings(
      history.present.entities.map((e: ArchEntity) => (e.id === stair1.id ? rebalanced : e)),
      levels
    ),
  };
  history = pushHistory(history, modelAfterRebalance, 'Rebalance Landing Split');
  const stairInPresent = history.present.entities.find((e: ArchEntity) => e.id === 'stair-u-1') as StairEntity;
  assert.equal(stairInPresent.runs![0].numRisers, 6);
  assert.equal(stairInPresent.runs![1].numRisers, 10);

  // Step 3: Drag Landing Depth grip
  const gripMoved = applyStairGripMove(rebalanced, 'landing-0-depth', { x: 300, y: 200 }, levels);
  const modelAfterGrip: ArchModel = {
    ...history.present,
    entities: syncStairFloorOpenings(
      history.present.entities.map((e: ArchEntity) => (e.id === stair1.id ? gripMoved : e)),
      levels
    ),
  };
  history = pushHistory(history, modelAfterGrip, 'Edit Stair Grip');

  // Undo Step 3 (back to rebalanced split 6/10)
  const u1 = undoHistory(history);
  assert.equal(u1.undoneLabel, 'Edit Stair Grip');
  history = u1.nextState;
  const sAfterUndo1 = history.present.entities.find((e: ArchEntity) => e.id === 'stair-u-1') as StairEntity;
  assert.equal(sAfterUndo1.landings![0].depth, 42);
  assert.equal(sAfterUndo1.runs![0].numRisers, 6);

  // Undo Step 2 (back to initial split 8/8)
  const u2 = undoHistory(history);
  assert.equal(u2.undoneLabel, 'Rebalance Landing Split');
  history = u2.nextState;
  const sAfterUndo2 = history.present.entities.find((e: ArchEntity) => e.id === 'stair-u-1') as StairEntity;
  assert.equal(sAfterUndo2.runs![0].numRisers, 8);
  assert.equal(sAfterUndo2.runs![1].numRisers, 8);

  // Undo Step 1 (stair removed and upper floor opening restored to 0 openings)
  const u3 = undoHistory(history);
  assert.equal(u3.undoneLabel, 'Place U-Switchback Stair');
  history = u3.nextState;
  assert.equal(history.present.entities.length, 1);
  const slabAfterFullUndo = history.present.entities.find((e: ArchEntity) => e.id === 'floor-level-2') as FloorEntity;
  assert.equal(slabAfterFullUndo.openings ?? undefined, undefined);

  // Redo Step 1 & Step 2
  const r1 = redoHistory(history);
  history = r1.nextState;
  assert.equal(history.present.entities.length, 2);
  const r2 = redoHistory(history);
  history = r2.nextState;
  const sAfterRedo2 = history.present.entities.find((e: ArchEntity) => e.id === 'stair-u-1') as StairEntity;
  assert.equal(sAfterRedo2.runs![0].numRisers, 6);
  assert.equal(sAfterRedo2.runs![1].numRisers, 10);
});
