import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEntity, DoorEntity, WallEntity } from '../types/model';
import {
  healCollinearWalls,
  joinHubs,
  mergeOutlines,
  setCornerJoin,
  signedArea,
  wallEndCut,
  wallPlanPieces,
  crossingCuts,
} from './wallJoins';
import { computeWallPlanPolygons } from './geometry';

const wall = (id: string, x0: number, y0: number, x1: number, y1: number, t = 8, extra: Partial<WallEntity> = {}): WallEntity => ({
  id,
  type: 'wall',
  layer: 'A-WALL',
  wallTypeId: 'wt-ext-2x6',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
  thickness: t,
  height: 108,
  baseOffset: 0,
  justification: 'center',
  ...extra,
});
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const area = (p: { x: number; y: number }[]) => Math.abs(signedArea(p));
const pieces = (walls: WallEntity[]) => walls.flatMap((w) => wallPlanPieces(w, walls, []));

test('two L-joined walls produce a single closed 6-vertex polygon with no overlap', () => {
  const walls = [wall('a', 0, 0, 120, 0), wall('b', 120, 0, 120, 96)];
  const ps = pieces(walls);
  assert.equal(ps.length, 2);
  const loops = mergeOutlines(ps);
  assert.equal(loops.length, 1, 'one continuous contour');
  assert.equal(loops[0].length, 6, 'L footprint has 6 vertices');
  // no overlap: the union area equals the sum of the piece areas
  near(area(loops[0]), ps.reduce((s, p) => s + area(p), 0), 1e-6);
  // the outline goes round the outer corner at (124, -4)
  assert.ok(loops[0].some((p) => Math.abs(p.x - 124) < 1e-6 && Math.abs(p.y + 4) < 1e-6));
  // same result whichever way the walls are drawn
  const rev = [wall('a', 120, 0, 0, 0), wall('b', 120, 96, 120, 0)];
  const l2 = mergeOutlines(pieces(rev));
  assert.equal(l2.length, 1);
  assert.equal(l2[0].length, 6);
});

test('BUTT and SQUARE-OFF corners still merge into one 6-vertex outline; Disallow keeps a seam', () => {
  const base = [wall('a', 0, 0, 120, 0), wall('b', 120, 0, 120, 96)] as ArchEntity[];
  for (const style of ['butt', 'squareoff'] as const) {
    const ents = setCornerJoin(base, [{ wallId: 'a', end: 'end' }, { wallId: 'b', end: 'start' }], { style }, 'a') as WallEntity[];
    const ps = pieces(ents);
    const loops = mergeOutlines(ps);
    assert.equal(loops.length, 1, style);
    assert.equal(loops[0].length, 6, style);
    near(area(loops[0]), ps.reduce((s, p) => s + area(p), 0), 1e-6);
    // the primary wall 'a' runs through to b's far face (x = 124)
    near(Math.max(...ps[0].map((p) => p.x)), 124);
  }
  const dis = setCornerJoin(base, [{ wallId: 'a', end: 'end' }, { wallId: 'b', end: 'start' }], { disallow: true }) as WallEntity[];
  assert.equal(wallEndCut(dis[0], 'end', dis).kind, 'disallowed');
});

test('a T-junction trims the stem wall cleanly at the main wall\'s near face', () => {
  const main = wall('main', 0, 0, 240, 0, 8);
  const stem = wall('stem', 120, 0, 120, 120, 6); // starts on main's centre line, goes +y
  const cut = wallEndCut(stem, 'start', [main, stem]);
  assert.equal(cut.kind, 'tee');
  // main's near face toward the stem is y = +4 (half of 8"); the stem stops exactly there
  near(cut.left.y, 4);
  near(cut.right.y, 4);
  near(Math.abs(cut.left.x - cut.right.x), 6);
  // the main wall is untouched
  const mc = wallEndCut(main, 'start', [main, stem]);
  near(mc.left.x, 0);
  // stem drawn the other way (ending on the main) works too, from the far side
  const stem2 = wall('stem2', 120, -120, 120, 0, 6);
  const c2 = wallEndCut(stem2, 'end', [main, stem2]);
  near(c2.left.y, -4);
  near(c2.right.y, -4);
  // together they form one contour without a seam
  const loops = mergeOutlines(pieces([main, stem]));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 8);
});

test('three walls at one point: the collinear pair runs through, the third is trimmed; star joins get a hub', () => {
  const a = wall('a', 0, 0, 120, 0);
  const b = wall('b', 120, 0, 240, 0);
  const c = wall('c', 120, 0, 120, 96, 6);
  const walls = [a, b, c];
  assert.equal(wallEndCut(a, 'end', walls).kind, 'through');
  const cc = wallEndCut(c, 'start', walls);
  assert.equal(cc.kind, 'tee');
  near(cc.left.y, 4);
  const loops = mergeOutlines(pieces(walls));
  assert.equal(loops.length, 1);
  assert.equal(joinHubs(walls).length, 0);
  // Y-junction (no straight pair) → star join with a centre hub that closes the gap
  const y = [wall('p', 0, 0, 100, 0), wall('q', 0, 0, -50, 86.6), wall('r', 0, 0, -50, -86.6)];
  const hubs = joinHubs(y);
  assert.equal(hubs.length, 1);
  const all = [...pieces(y), ...hubs.map((h) => h.poly)];
  const yl = mergeOutlines(all);
  assert.equal(yl.length, 1);
  near(area(yl[0]), all.reduce((s, p) => s + area(p), 0), 1e-4);
});

test('X-crossing: the thinner wall is split at the main wall faces', () => {
  const main = wall('main', 0, 0, 240, 0, 8);
  const sec = wall('sec', 120, -60, 120, 60, 6);
  const x = crossingCuts(sec, [main, sec]);
  assert.equal(x.length, 1);
  near(x[0].s0, 56);
  near(x[0].s1, 64);
  const ps = pieces([main, sec]);
  assert.equal(ps.length, 3);
  const loops = mergeOutlines(ps);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 12, 'plus-shaped outline');
});

test('two collinear walls of the same type merge into one wall and keep hosted door positions', () => {
  const a = wall('a', 0, 0, 120, 0);
  const b = wall('b', 120, 0, 240, 0);
  const d: DoorEntity = { id: 'd', type: 'door', layer: 'A-DOOR', wallId: 'b', offset: 0.5, width: 36, height: 80, swing: 'left-in' };
  const d2: DoorEntity = { ...d, id: 'd2', wallId: 'a', offset: 0.25 };
  const out = healCollinearWalls([a, b, d, d2]);
  const walls = out.filter((e): e is WallEntity => e.type === 'wall');
  assert.equal(walls.length, 1);
  assert.equal(walls[0].id, 'a');
  near(walls[0].end.x, 240);
  const dd = out.find((e) => e.id === 'd') as DoorEntity;
  assert.equal(dd.wallId, 'a');
  near(dd.offset * 240, 180, 1e-6); // same world position x = 180
  near((out.find((e) => e.id === 'd2') as DoorEntity).offset * 240, 30, 1e-6);
  // drawn head-to-head (b reversed) also heals
  const br = wall('b', 240, 0, 120, 0);
  const out2 = healCollinearWalls([a, br, { ...d, offset: 0.5 }]);
  assert.equal(out2.filter((e) => e.type === 'wall').length, 1);
  near((out2.find((e) => e.id === 'd') as DoorEntity).offset * 240, 180, 1e-6);
  // different types, a T at the joint, or Disallow Join → no healing
  assert.equal(healCollinearWalls([a, { ...b, wallTypeId: 'wt-int-45' }]).filter((e) => e.type === 'wall').length, 2);
  assert.equal(healCollinearWalls([a, b, wall('c', 120, 0, 120, 96)]).filter((e) => e.type === 'wall').length, 3);
  assert.equal(healCollinearWalls([{ ...a, joins: { end: { disallow: true } } }, b]).filter((e) => e.type === 'wall').length, 2);
});

test('plan polygons use the joins (shared corner edge, no overlap) and still cut openings', () => {
  const walls = [wall('a', 0, 0, 120, 0), wall('b', 120, 0, 120, 96)];
  const d: DoorEntity = { id: 'd', type: 'door', layer: 'A-DOOR', wallId: 'a', offset: 0.5, width: 36, height: 80, swing: 'left-in' };
  const pa = computeWallPlanPolygons(walls[0], walls, [d]);
  assert.equal(pa.length, 2);
  const pb = computeWallPlanPolygons(walls[1], walls, [d]);
  const loops = mergeOutlines([...pa, ...pb]);
  assert.equal(loops.length, 2, 'door gap leaves two separate solids');
});
