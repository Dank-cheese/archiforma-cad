import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEntity, ArchModel, ColumnEntity, FloorEntity, FootingEntity, WallEntity } from '../types/model';
import { createSampleProject } from './geometry';
import {
  axisValueFromRay,
  belowGradeBadge,
  belowGradeChecks,
  dragSectionBoxFace,
  faceCenter,
  formatElevation,
  groundAppearance,
  insideSectionBox,
  isBelowGrade,
  orbitPolarLimits,
  resolveUnderlay,
  sectionBoxAround,
  sectionBoxPlanes,
  stepVertical,
  supportMismatches,
  supportPolygons,
  surfaceReadout,
  underlayEntities,
  verticalPan,
  worldPerPixel,
  BELOW_GRADE_GROUND_OPACITY,
  DEFAULT_GROUND_STATE,
  GRID3D_STEP,
} from './view';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);

const levels = [
  { id: 'level-1', name: 'Level 1', elevation: 0 },
  { id: 'level-2', name: 'Level 2', elevation: 108 },
];
const model = (entities: ArchEntity[]): Pick<ArchModel, 'levels' | 'entities' | 'settings'> =>
  ({ levels, entities, settings: { units: 'imperial' } } as unknown as Pick<ArchModel, 'levels' | 'entities' | 'settings'>);

const col = (id: string, x: number, y: number, o: Partial<ColumnEntity> = {}): ColumnEntity =>
  ({ id, type: 'column', layer: 'S-COLS', levelId: 'level-1', position: { x, y }, rotation: 0, shape: 'rectangular', width: 12, depth: 12, height: 108, structuralMaterialId: 'conc-4000', ...o } as ColumnEntity);
const pad = (id: string, x: number, y: number, o: Partial<FootingEntity> = {}): FootingEntity =>
  ({ id, type: 'footing', kind: 'isolated', layer: 'S-FNDN', levelId: 'level-1', position: { x, y }, rotation: 0, length: 36, width: 36, thickness: 12, topOffset: -6, ...o } as FootingEntity);
const wall = (id: string, a: [number, number], b: [number, number], o: Partial<WallEntity> = {}): WallEntity =>
  ({ id, type: 'wall', layer: 'A-WALL', levelId: 'level-1', start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 8, height: 108, baseOffset: 0, justification: 'center', ...o } as WallEntity);

test('below grade: detection, ground fade to 15 %, grid fades, everything back above ground', () => {
  assert.equal(isBelowGrade(-54), true);
  assert.equal(isBelowGrade(60), false);
  assert.equal(isBelowGrade(-0.1), false); // tolerance at grade: no flicker
  const under = groundAppearance(-54, DEFAULT_GROUND_STATE, false);
  assert.equal(under.below, true);
  near(under.opacity, BELOW_GRADE_GROUND_OPACITY);
  assert.equal(under.doubleSided, true);
  assert.ok(under.gridOpacity < 1);
  const above = groundAppearance(200, DEFAULT_GROUND_STATE, false);
  assert.deepEqual([above.below, above.opacity, above.gridOpacity, above.doubleSided], [false, 1, 1, false]);
  // user slider wins above grade; a lower setting is kept below grade; Hide ground hides it
  near(groundAppearance(200, { ...DEFAULT_GROUND_STATE, opacity: 0.6 }, false).opacity, 0.6);
  near(groundAppearance(-30, { ...DEFAULT_GROUND_STATE, opacity: 0.05 }, false).opacity, 0.05);
  assert.equal(groundAppearance(200, { ...DEFAULT_GROUND_STATE, hidden: true }, false).visible, false);
  // modelled foundations: translucent by default
  near(groundAppearance(200, DEFAULT_GROUND_STATE, true).opacity, 0.35);
  assert.equal(belowGradeBadge(-54, 'imperial'), `Below grade -4'-6"`);
});

test('navigation: orbit can go under the building, vertical pan and PageUp/PageDown steps', () => {
  const { min, max } = orbitPolarLimits();
  assert.ok(min > 0 && max > Math.PI / 2 + 1, 'polar angle reaches past the horizon');
  const eye = { x: 0, y: 100, z: 300 };
  const tgt = { x: 0, y: 40, z: 0 };
  const per = worldPerPixel(300, 42, 800);
  near(per, (2 * 300 * Math.tan((21 * Math.PI) / 180)) / 800);
  const moved = verticalPan(eye, tgt, 100, per); // drag down 100 px → view goes down
  near(moved.eye.y, 100 - 100 * per);
  near(moved.target.y, 40 - 100 * per);
  assert.equal(moved.eye.x, eye.x);
  const down = stepVertical(eye, { x: 0, y: 0, z: 0 }, -1);
  assert.equal(down.eye.y, 100 - GRID3D_STEP);
  assert.equal(down.target.y, -GRID3D_STEP); // the orbit target may go below elevation 0
});

test('elevation labels: signed feet-inches and hover readout', () => {
  assert.equal(formatElevation(-4, 'imperial'), `-0'-4"`);
  assert.equal(formatElevation(-42, 'imperial'), `-3'-6"`);
  assert.equal(formatElevation(0, 'imperial'), `±0'-0"`);
  assert.equal(formatElevation(108, 'imperial'), `9'-0"`);
  const ftg = pad('f', 0, 0);
  assert.equal(surfaceReadout(ftg, 1, -42, 'imperial'), `Top of footing  -3'-6"`);
  const slab = { id: 's', type: 'floor', foundation: false, structural: false } as FloorEntity;
  assert.equal(surfaceReadout(slab, -1, -4, 'imperial'), `Bottom of slab  -0'-4"`);
  assert.equal(surfaceReadout(col('c', 0, 0), 0, 30, 'imperial'), `Column face  2'-6"`);
  assert.equal(surfaceReadout(pad('pc', 0, 0, { kind: 'pilecap' }), -1, -200, 'imperial', 'pile'), `Bottom of pile  -16'-8"`);
});

test('section box: six inward clipping planes; top face dragged down slices the building', () => {
  const box = sectionBoxAround({ x: 0, y: -24, z: 0 }, { x: 336, y: 216, z: 216 }, 12);
  const planes = sectionBoxPlanes(box);
  assert.equal(planes.length, 6);
  const keep = (p: { x: number; y: number; z: number }) => planes.every((pl) => pl.normal.x * p.x + pl.normal.y * p.y + pl.normal.z * p.z + pl.constant >= 0);
  assert.equal(keep({ x: 100, y: 0, z: 100 }), true);
  assert.equal(keep({ x: 100, y: 300, z: 100 }), false);
  assert.equal(keep({ x: -20, y: 0, z: 100 }), false);
  // slice at elevation 2'-0": everything above is cut away, foundations stay
  const cut = dragSectionBoxFace(box, 'ymax', 24);
  assert.equal(cut.max.y, 24);
  assert.equal(insideSectionBox({ x: 100, y: 60, z: 100 }, cut), false);
  assert.equal(insideSectionBox({ x: 100, y: -20, z: 100 }, cut), true);
  // a face never crosses the opposite face
  const squashed = dragSectionBoxFace(cut, 'ymax', -500);
  assert.ok(squashed.max.y > squashed.min.y);
  const raised = dragSectionBoxFace(box, 'ymin', 1000);
  assert.ok(raised.min.y < raised.max.y);
  assert.equal(faceCenter(box, 'ymax').y, box.max.y);
  near(faceCenter(box, 'xmin').z, (box.min.z + box.max.z) / 2);
  // handle drag: a ray passing x = 50 picks that coordinate on the x axis
  const v = axisValueFromRay({ x: 0, y: 0, z: 0 }, 'x', { x: 50, y: 100, z: 10 }, { x: 0, y: -1, z: 0 });
  near(v!, 50);
});

test('checks: footing under every column, base gap / overlap, bearing walls, slabs, floating elements', () => {
  // a correct column on a footing (base at the footing top)
  assert.deepEqual(belowGradeChecks(model([col('c1', 0, 0, { baseOffset: -6 }), pad('f1', 0, 0)])), []);
  // no footing
  const a = belowGradeChecks(model([col('c1', 0, 0)]));
  assert.deepEqual(a.map((i) => i.kind), ['no-footing']);
  // 6" gap: base at grade, footing top 6" below
  const g = belowGradeChecks(model([col('c1', 0, 0), pad('f1', 0, 0)]));
  assert.deepEqual(g.map((i) => i.kind), ['base-gap']);
  assert.match(g[0].message, /6"/);
  near(g[0].at.z, -3);
  // overlap: column goes 4" into the footing
  assert.deepEqual(belowGradeChecks(model([col('c1', 0, 0, { baseOffset: -10 }), pad('f1', 0, 0)])).map((i) => i.kind), ['base-overlap']);
  // bearing wall without a wall footing; with one it is fine; a non-structural wall is not checked
  assert.deepEqual(belowGradeChecks(model([wall('w1', [0, 0], [240, 0], { structural: true })])).map((i) => i.kind), ['wall-no-footing']);
  const wf = { ...pad('wf', 0, 0), kind: 'wall', wallId: 'w1', width: 20 } as FootingEntity;
  assert.deepEqual(belowGradeChecks(model([wall('w1', [0, 0], [240, 0], { structural: true }), wf])), []);
  assert.deepEqual(belowGradeChecks(model([wall('w1', [0, 0], [240, 0])])), []);
  // an upper-level wall over nothing is floating; over a wall below it is supported
  const up = wall('w2', [0, 0], [240, 0], { levelId: 'level-2' });
  assert.deepEqual(belowGradeChecks(model([up])).map((i) => i.kind), ['floating']);
  assert.deepEqual(belowGradeChecks(model([up, wall('w1', [0, 0], [240, 0])])), []);
  // a level-2 slab with nothing under it; carried by walls below it is fine
  const sl = { id: 's2', type: 'floor', layer: 'A-FLOR', levelId: 'level-2', polygon: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 0, y: 180 }], thickness: 8, material: 'concrete', structural: true } as FloorEntity;
  assert.deepEqual(belowGradeChecks(model([sl])).map((i) => i.kind), ['slab-unsupported']);
  assert.deepEqual(belowGradeChecks(model([sl, wall('w1', [0, 0], [240, 0]), wall('w3', [0, 180], [240, 180])])), []);
  // an upper column standing on a beam is supported; one in mid-air is floating
  const upCol = col('c2', 600, 600, { levelId: 'level-2' });
  assert.deepEqual(belowGradeChecks(model([upCol])).map((i) => i.kind), ['floating']);
  // the sample project is clean
  assert.deepEqual(belowGradeChecks(createSampleProject()), []);
});

test('underlay: level below / foundation / any level, and mismatch where bearing elements have nothing below', () => {
  assert.deepEqual(resolveUnderlay('below', levels, 'level-2'), { kind: 'level', levelId: 'level-1', name: 'Level 1' });
  assert.deepEqual(resolveUnderlay('below', levels, 'level-1'), { kind: 'none' });
  assert.equal(resolveUnderlay('foundation', levels, 'level-2').kind, 'foundation');
  assert.deepEqual(resolveUnderlay('level:level-2', levels, 'level-1'), { kind: 'level', levelId: 'level-2', name: 'Level 2' });
  assert.deepEqual(resolveUnderlay('none', levels, 'level-2'), { kind: 'none' });

  const below = [wall('w1', [0, 0], [240, 0]), col('c1', 400, 0)];
  const ents = [...below, { id: 't', type: 'text', levelId: 'level-1' } as unknown as ArchEntity];
  const u = underlayEntities(ents, resolveUnderlay('below', levels, 'level-2'));
  assert.deepEqual(u.map((e) => e.id), ['w1', 'c1']); // annotation left out
  const sup = supportPolygons(u, ents);
  // structural wall above runs past the wall below → the unsupported run is reported
  const above = wall('w2', [0, 0], [360, 0], { levelId: 'level-2', structural: true });
  const mm = supportMismatches([above], sup);
  assert.equal(mm.length, 1);
  const [a, b] = mm[0].segments[0];
  assert.ok(a.x > 230 && a.x < 250 && b.x === 360, `run ${a.x}→${b.x}`);
  // a column above the column below is fine; one over nothing is flagged
  assert.deepEqual(supportMismatches([col('c2', 400, 0, { levelId: 'level-2' })], sup), []);
  assert.equal(supportMismatches([col('c3', 100, 100, { levelId: 'level-2' })], sup)[0].kind, 'column');
  // non-structural walls are not checked
  assert.deepEqual(supportMismatches([wall('w4', [0, 50], [300, 50], { levelId: 'level-2' })], sup), []);
  // foundation underlay: footings + foundation slab + structural walls on the lowest level
  const fnd = underlayEntities([pad('f1', 0, 0), wall('w1', [0, 0], [10, 0]), wall('w5', [0, 0], [10, 0], { structural: true })], resolveUnderlay('foundation', levels, 'level-1'));
  assert.deepEqual(fnd.map((e) => e.id), ['f1', 'w5']);
});
