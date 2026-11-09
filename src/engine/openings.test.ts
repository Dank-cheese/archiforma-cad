import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEntity, DoorEntity, WallEntity, WindowEntity, WallOpeningEntity } from '../types/model';
import {
  applyTempDimValue,
  asLike,
  checkOpeningFit,
  copySelectionHosted,
  depthAcross,
  dragOpening,
  elevOpeningsOf,
  equalSpacingOffsets,
  layerBandsWithReturns,
  moveSelectionHosted,
  openingPlanSymbol,
  openingsOverlap,
  openingWarnings,
  planCutGaps,
  reanchorHostedOpenings,
  snapAlongWall,
  temporaryDimensions,
  wallElevationShape,
  wallFrame,
  wallPoint,
} from './openings';
import { moveEntity, rotateEntity, computeWallPlanPolygons } from './geometry';

const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<WallEntity> = {}): WallEntity => ({
  id,
  type: 'wall',
  layer: 'A-WALL',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
  thickness: 8,
  height: 108,
  baseOffset: 0,
  justification: 'center',
  ...extra,
});
const win = (id: string, wallId: string, offset: number, width = 36, extra: Partial<WindowEntity> = {}): WindowEntity => ({
  id,
  type: 'window',
  layer: 'A-GLAZ',
  wallId,
  offset,
  width,
  height: 48,
  sillHeight: 36,
  ...extra,
});
const door = (id: string, wallId: string, offset: number, width = 36): DoorEntity => ({
  id,
  type: 'door',
  layer: 'A-DOOR',
  wallId,
  offset,
  width,
  height: 80,
  swing: 'left-in',
});
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const centre = (es: ArchEntity[], id: string) => {
  const o = es.find((e) => e.id === id) as WindowEntity;
  const w = es.find((e) => e.id === o.wallId) as WallEntity;
  return wallPoint(wallFrame(w), o.offset * wallFrame(w).length);
};

test('opening keeps its relative position when the wall is MOVED or ROTATED', () => {
  const w = wall('w1', 0, 0, 240, 0);
  const o = win('o1', 'w1', 0.25);
  const before = [w, o] as ArchEntity[];
  // move the wall only (the window is hosted and rides along)
  const moved = reanchorHostedOpenings(before, before.map((e) => (e.id === 'w1' ? moveEntity(e, { x: 50, y: 30 }) : e)));
  const c = centre(moved, 'o1');
  near(c.x, 60 + 50);
  near(c.y, 30);
  near((moved[1] as WindowEntity).offset, 0.25);
  // rotate 90° about the origin: still a quarter of the way along
  const rot = reanchorHostedOpenings(before, before.map((e) => (e.id === 'w1' ? rotateEntity(e, { x: 0, y: 0 }, 90) : e)));
  near((rot[1] as WindowEntity).offset, 0.25);
  const r = centre(rot, 'o1');
  near(Math.hypot(r.x, r.y), 60, 1e-6);
});

test('opening keeps its distance from the fixed end when the wall is STRETCHED', () => {
  const w = wall('w1', 0, 0, 240, 0);
  const o = win('o1', 'w1', 0.25); // 60" from the start
  const before = [w, o] as ArchEntity[];
  // drag the END: the opening stays 60" from the start
  const longer = reanchorHostedOpenings(before, [{ ...w, end: { x: 480, y: 0 } }, o]);
  near((longer[1] as WindowEntity).offset * 480, 60);
  // drag the START: the opening stays 180" from the end
  const fromStart = reanchorHostedOpenings(before, [{ ...w, start: { x: -120, y: 0 } }, o]);
  near((1 - (fromStart[1] as WindowEntity).offset) * 360, 180);
  // shrink so far the window no longer fits: it is kept (never deleted) and flagged
  const tiny = reanchorHostedOpenings(before, [{ ...w, end: { x: 40, y: 0 } }, o]);
  assert.equal(tiny.length, 2);
  const warn = openingWarnings(tiny);
  assert.ok(warn.some((x) => x.id === 'o1' && (x.issue === 'past-end' || x.issue === 'too-short')));
});

test('opening on a split wall is re-hosted onto the piece that contains it', () => {
  const w = wall('w1', 0, 0, 240, 0);
  const o = win('o1', 'w1', 0.75); // at x = 180
  const after = reanchorHostedOpenings([w, o], [wall('wa', 0, 0, 120, 0), wall('wb', 120, 0, 240, 0), o]);
  const moved = after.find((e) => e.id === 'o1') as WindowEntity;
  assert.equal(moved.wallId, 'wb');
  near(moved.offset, 0.5);
});

test('overlap detection between two openings on the same wall', () => {
  const L = 240;
  const a = asLike(win('a', 'w', 0.3, 36)); // 54..90
  const b = asLike(win('b', 'w', 0.4, 36)); // 78..114 → overlaps
  const c = asLike(win('c', 'w', 0.6, 36)); // 126..162 → clear
  assert.equal(openingsOverlap(a, b, L), true);
  assert.equal(openingsOverlap(a, c, L), false);
  // a high window above a door does not collide (different height ranges)
  const d = asLike(door('d', 'w', 0.3));
  const high = asLike(win('h', 'w', 0.3, 36, { sillHeight: 84, height: 12 }));
  assert.equal(openingsOverlap(d, high, L), false);
  const fit = checkOpeningFit(wall('w', 0, 0, 240, 0), b, [a, c]);
  assert.equal(fit.ok, false);
  assert.deepEqual(fit.overlapIds, ['a']);
  assert.equal(checkOpeningFit(wall('w', 0, 0, 240, 0), { ...b, offset: 0.98 }, []).issues[0], 'past-end');
});

test('3D wall shape has the correct number of holes for N openings', () => {
  const w = wall('w1', 0, 0, 480, 0);
  for (const n of [0, 1, 3, 5]) {
    const wins = Array.from({ length: n }, (_, i) => win(`o${i}`, 'w1', (i + 1) / (n + 1), 36));
    const shape = wallElevationShape(480, [{ s: 0, z: 108 }, { s: 480, z: 108 }], () => 108, elevOpeningsOf(w, wins));
    assert.equal(shape.holes.length, n, `${n} windows → ${n} holes`);
    assert.equal(shape.notches.length, 0);
  }
  // doors notch the outline instead, arched wall openings are holes with a curved head
  const mixed = [
    door('d1', 'w1', 0.2),
    win('o1', 'w1', 0.5),
    { id: 'wo1', type: 'wallopening', layer: 'A-WALL', wallId: 'w1', offset: 0.8, width: 40, height: 60, sillHeight: 30, shape: 'arch' } as WallOpeningEntity,
  ];
  const s = wallElevationShape(480, [{ s: 0, z: 108 }, { s: 480, z: 108 }], () => 108, elevOpeningsOf(w, mixed));
  assert.equal(s.holes.length + s.notches.length, 3);
  assert.equal(s.notches.length, 1);
  assert.ok(s.holes.some((h) => h.length > 10), 'arched hole is sampled');
  // overlapping openings are cut once (the second is flagged in plan instead)
  const ov = wallElevationShape(480, [{ s: 0, z: 108 }, { s: 480, z: 108 }], () => 108, elevOpeningsOf(w, [win('a', 'w1', 0.5), win('b', 'w1', 0.52)]));
  assert.equal(ov.holes.length, 1);
});

test('plan cut: walls break at doors AND windows with closed jambs', () => {
  const w = wall('w1', 0, 0, 240, 0);
  const polys = computeWallPlanPolygons(w, [w], [door('d', 'w1', 0.25), win('o', 'w1', 0.7)]);
  assert.equal(polys.length, 3);
  assert.equal(planCutGaps(w, [win('a', 'w1', 0.5, 40), win('b', 'w1', 0.55, 40)]).length, 1, 'overlapping gaps merge');
});

test('snapping: wall Center and EQ between neighbours', () => {
  const L = 240;
  assert.deepEqual(snapAlongWall(L, 117, 36, [], 6).kind, 'center');
  const others = [asLike(win('a', 'w', 0.25, 36))]; // 42..78
  const eq = snapAlongWall(L, 160, 36, others, 6, { center: false });
  assert.equal(eq.kind, 'eq');
  near(eq.s, (78 + 240) / 2);
  assert.equal(snapAlongWall(L, 30, 36, [], 6).kind, null);
  const spaced = equalSpacingOffsets(240, [
    { id: 'a', offset: 0.1, width: 30 },
    { id: 'b', offset: 0.2, width: 30 },
    { id: 'c', offset: 0.9, width: 30 },
  ]);
  near(spaced.get('a')! * 240, 37.5 + 15);
  near((spaced.get('c')! - spaced.get('b')!) * 240, (spaced.get('b')! - spaced.get('a')!) * 240);
});

test('temporary dimensions measure to wall ends, neighbours and grids, and typing a value moves the opening', () => {
  const w = wall('w1', 0, 0, 240, 0);
  const grid = { id: 'g', type: 'grid', layer: 'S-GRID', start: { x: 100, y: -50 }, end: { x: 100, y: 50 }, label: '1' } as const;
  const dims = temporaryDimensions(w, 150, 36, [asLike(win('a', 'w1', 0.2, 24))], [grid as never], 20);
  const left = dims.find((d) => d.key === 'left')!;
  const right = dims.find((d) => d.key === 'right')!;
  const g = dims.find((d) => d.kind === 'grid')!;
  assert.equal(left.kind, 'opening');
  near(left.value, 132 - 60);
  near(right.value, 240 - 168);
  near(g.value, 50);
  near(applyTempDimValue(left, 24, 36, 150), 60 + 24 + 18);
  near(applyTempDimValue(right, 12, 36, 150), 240 - 12 - 18);
  near(applyTempDimValue(g, 30, 36, 150), 130);
});

test('drag slides along the host, clamps at the ends and re-hosts onto another wall', () => {
  const a = wall('a', 0, 0, 240, 0);
  const b = wall('b', 240, 0, 240, 240);
  const o = win('o', 'a', 0.5, 36);
  const slid = dragOpening(o, { x: 60, y: 5 }, [a, b]);
  assert.equal(slid.wallId, 'a');
  near(slid.offset, 0.25);
  const clamped = dragOpening(o, { x: 500, y: 0 }, [a, b]);
  assert.equal(clamped.wallId, 'a');
  assert.ok(clamped.offset * 240 + 18 <= 240);
  const rehosted = dragOpening(o, { x: 243, y: 120 }, [a, b]);
  assert.equal(rehosted.wallId, 'b');
  near(rehosted.offset, 0.5, 0.02);
});

test('move / copy keep openings hosted', () => {
  const a = wall('a', 0, 0, 240, 0);
  const o = win('o', 'a', 0.5, 36);
  const ents = [a, o] as ArchEntity[];
  // moving only the window slides it along its wall
  const m = moveSelectionHosted(ents, ['o'], { x: 24, y: 40 }, moveEntity);
  near((m[1] as WindowEntity).offset, (120 + 24) / 240);
  // moving wall + window together keeps the offset
  const both = moveSelectionHosted(ents, ['a', 'o'], { x: 24, y: 40 }, moveEntity);
  near((both[1] as WindowEntity).offset, 0.5);
  // copying the window along its wall makes a hosted copy
  let n = 0;
  const copies = copySelectionHosted(ents, ['o'], { x: 60, y: 0 }, moveEntity, (e) => `${e.id}-c${n++}`);
  assert.equal(copies.length, 1);
  assert.equal((copies[0] as WindowEntity).wallId, 'a');
  near((copies[0] as WindowEntity).offset, 0.75);
  // copying the wall brings its openings, hosted on the new wall
  const wc = copySelectionHosted(ents, ['a'], { x: 0, y: 120 }, moveEntity, (e) => `${e.id}-c${n++}`);
  assert.equal(wc.length, 2);
  assert.equal((wc[1] as WindowEntity).wallId, wc[0].id);
});

test('depth position and plan symbol', () => {
  near(depthAcross('center', 8, 3.5, 1), 0);
  near(depthAcross('exterior', 8, 3.5, 1), 2.25);
  near(depthAcross('exterior', 8, 3.5, -1), -2.25);
  near(depthAcross('interior', 8, 3.5, 1), -2.25);
  near(depthAcross(10, 8, 3.5, 1), 2.25); // clamped into the wall
  const w = wall('w1', 0, 0, 240, 0);
  const sym = openingPlanSymbol(win('o', 'w1', 0.5, 36, { depthPosition: 'exterior' }), w, 1);
  // the glass line sits toward the exterior (left normal of +x is +y in plan with +Y down? perpLeft(1,0) = (0,1))
  const glass = sym.lines[0];
  assert.ok(glass[0].y > 0);
  const flipped = openingPlanSymbol(win('o', 'w1', 0.5, 36, { depthPosition: 'exterior', flipFacing: true }), w, 1);
  assert.ok(flipped.lines[0][0].y < 0);
});

test('finish layers return into the opening', () => {
  const w = wall('w1', 0, 0, 240, 0, { thickness: 8 });
  const layers = [
    { id: 'f1', name: 'Siding', function: 'finish1' as const, thickness: 1, color: '#a', hi: 4, lo: 3 },
    { id: 'c', name: 'Stud', function: 'structure' as const, thickness: 6, color: '#b', hi: 3, lo: -3 },
    { id: 'f2', name: 'Gyp', function: 'finish2' as const, thickness: 1, color: '#c', hi: -3, lo: -4 },
  ];
  const bands = layerBandsWithReturns(w, layers, [{ s0: 100, s1: 140 }], () => 0);
  // core: two solid pieces, each notched (more than 4 vertices)
  assert.equal(bands[1].polygons.length, 2);
  assert.ok(bands[1].polygons.every((p) => p.length > 4));
  // each face finish: 2 main pieces + 2 returns
  assert.equal(bands[0].polygons.length, 4);
  assert.equal(bands[2].polygons.length, 4);
});
