import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleProject } from './geometry';
import { exportModelToDXF, hiddenLineVectors } from './dxfExport';
import {
  balconyPlan,
  clipPolygonY,
  computeElevation,
  curtainCells,
  elevationMarkerPositions,
  hitTestElevation,
  paintWallBand,
  splitWallFace,
  viewBasis,
  wallExteriorSide,
  wallFinishBands,
  wallProfile,
} from './facade';
import type { RoofEntity, WallEntity } from '../types/model';

const sample = () => createSampleProject();
const wallById = (m: ReturnType<typeof sample>, id: string) => m.entities.find((e) => e.id === id) as WallEntity;

test('sample project ships a hip roof with 1\'-6" overhang, stone base + lap siding and a curtain wall', () => {
  const m = sample();
  const roof = m.entities.find((e) => e.type === 'roof') as RoofEntity;
  assert.equal(roof.roofStyle, 'hip');
  assert.equal(roof.overhang, 18);
  const w = wallById(m, 'wall-e');
  assert.deepEqual(wallFinishBands(w, 108).map((b) => b.finish), ['stone', 'lap-siding']);
  assert.ok(wallById(m, 'wall-n2').curtain);
});

test('exterior side is the side facing away from the building', () => {
  const m = sample();
  const walls = m.entities.filter((e): e is WallEntity => e.type === 'wall');
  // north wall runs +x at y = 0; the building is at +y (south, SVG y-down) so the exterior is at −y = the right side
  assert.equal(wallExteriorSide(wallById(m, 'wall-n1'), walls), 'right');
  assert.equal(wallExteriorSide(wallById(m, 'wall-e'), walls), 'right');
});

test('paint and split face: bands keep their finish and split at the clicked height', () => {
  const m = sample();
  let w = wallById(m, 'wall-e');
  w = splitWallFace(w, 84, 108); // stone 0-36, siding 36-84, siding 84-108
  let bands = wallFinishBands(w, 108);
  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map((b) => [b.z0, b.z1]), [[0, 36], [36, 84], [84, 108]]);
  w = paintWallBand(w, 1, 'brick');
  w = paintWallBand(w, null, 'board-batten');
  bands = wallFinishBands(w, 108);
  assert.deepEqual(bands.map((b) => b.finish), ['stone', 'brick', 'board-batten']);
});

test('elevation views: four directions, painter-sorted prims, hit regions for walls and curtain cells', () => {
  const m = sample();
  for (const dir of ['north', 'south', 'east', 'west'] as const) {
    const d = computeElevation(m, dir, { mmPerIn: 25.4 / 48 });
    assert.ok(d.prims.length > 20, `${dir} has linework`);
    assert.ok(d.bounds.maxX > d.bounds.minX);
    // level 2 annotation present
    assert.ok(d.prims.some((p) => p.k === 'text' && p.text === 'Level 2'));
  }
  const north = computeElevation(m, 'north', { mmPerIn: 0.5 });
  const cells = north.hits.filter((h) => h.target.kind === 'cw-cell');
  const cw = wallById(m, 'wall-n2');
  const grid = curtainCells(cw, 144, 108);
  assert.equal(cells.length, (grid.cols.length - 1) * (grid.rows.length - 1));
  // a stone band hit near the ground on the north face of wall-n1 (u = −x, so x = 96 → u = −96)
  const hit = hitTestElevation(north, { x: -96, y: -12 });
  assert.ok(hit && hit.target.kind === 'wall' && hit.target.exterior && hit.target.band === 0);
  // u axis: viewer's right is west when looking south from the north
  assert.equal(viewBasis('north').u({ x: 10, y: 0 }), -10);
});

test('roof-attached gable wall rises to the roof; balcony plan projects outward; markers on four sides', () => {
  const m = sample();
  const roof = m.entities.find((e) => e.type === 'roof') as RoofEntity;
  const gable: RoofEntity = { ...roof, roofStyle: 'gable' };
  m.entities = m.entities.map((e) => (e.id === roof.id ? gable : e.id === 'wall-e' ? { ...(e as WallEntity), attachedRoofId: roof.id } : e));
  const prof = wallProfile(m, wallById(m, 'wall-e'));
  assert.ok(prof.attached);
  const peak = Math.max(...prof.top.map((t) => t.z));
  assert.ok(peak > 150, `gable wall peaks at ${peak.toFixed(1)}"`);
  const walls = m.entities.filter((e): e is WallEntity => e.type === 'wall');
  const bp = balconyPlan(wallById(m, 'wall-s1'), { id: 'b', type: 'balcony', layer: '0', wallId: 'wall-s1', offset: 0.5, width: 96, depth: 48, elevationOffset: 108, slabThickness: 6, railingHeight: 42, railingStyle: 'glass' }, walls);
  assert.ok(Math.max(...bp.slab.map((p) => p.y)) > 216 + 40, 'balcony projects south (outside)');
  const marks = elevationMarkerPositions(m, 'level-1');
  assert.deepEqual(marks.map((k) => k.dir), ['north', 'south', 'east', 'west']);
  assert.equal(clipPolygonY([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 2, 5).length, 4);
});

test('DXF export can include the four elevations as hidden-line 2D linework', () => {
  const m = createSampleProject();
  const plain = exportModelToDXF(m);
  const withElev = exportModelToDXF(m, { includeElevations: true });
  assert.ok(!plain.includes('A-ELEV'));
  for (const name of ['SOUTH ELEVATION', 'NORTH ELEVATION', 'EAST ELEVATION', 'WEST ELEVATION']) assert.ok(withElev.includes(name), name);
  assert.ok(withElev.includes('A-ELEV-HATC'));
  // hidden-line removal: a stroke behind a later opaque fill is dropped
  const v = hiddenLineVectors([
    { k: 'poly', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, stroke: '#000', w: 0.3 },
    { k: 'poly', pts: [{ x: 2, y: -1 }, { x: 4, y: -1 }, { x: 4, y: 1 }, { x: 2, y: 1 }], closed: true, fill: '#fff', w: 0 },
  ] as never);
  const lines = v.filter((x) => x.kind === 'line') as Array<{ pts: Array<{ x: number }> }>;
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].pts[1].x - 2) < 1e-6 && Math.abs(lines[1].pts[0].x - 4) < 1e-6);
});
