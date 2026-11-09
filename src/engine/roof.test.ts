import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRoofGeometry,
  computeStraightSkeleton,
  defaultEdgeSlopes,
  dormerGeometry,
  formatSlope,
  normalizeFootprint,
  parseSlopeInput,
  rise12ToDegrees,
  signedArea,
  skylightOutline,
  wallTopProfile,
  RoofGeometry,
  P3,
} from './roof';

const ft = (v: number) => v * 12;
const DEG4_12 = rise12ToDegrees(4);

const RECT = [
  { x: 0, y: 0 },
  { x: ft(20), y: 0 },
  { x: ft(20), y: ft(10) },
  { x: 0, y: ft(10) },
];
// L: 30' x 20' with a 15' x 10' notch removed from the top-right
const L_SHAPE = [
  { x: 0, y: 0 },
  { x: ft(15), y: 0 },
  { x: ft(15), y: ft(10) },
  { x: ft(30), y: ft(10) },
  { x: ft(30), y: ft(20) },
  { x: 0, y: ft(20) },
];
// T: 36' wide top bar (12' deep) + 12' wide stem 18' long
const T_SHAPE = [
  { x: 0, y: 0 },
  { x: ft(36), y: 0 },
  { x: ft(36), y: ft(12) },
  { x: ft(24), y: ft(12) },
  { x: ft(24), y: ft(30) },
  { x: ft(12), y: ft(30) },
  { x: ft(12), y: ft(12) },
  { x: 0, y: ft(12) },
];
// U: 36' x 30' with a 12' x 18' courtyard open to the south
const U_SHAPE = [
  { x: 0, y: 0 },
  { x: ft(36), y: 0 },
  { x: ft(36), y: ft(30) },
  { x: ft(24), y: ft(30) },
  { x: ft(24), y: ft(12) },
  { x: ft(12), y: ft(12) },
  { x: ft(12), y: ft(30) },
  { x: 0, y: ft(30) },
];

const planeError = (pts: P3[]): number => {
  if (pts.length < 4) return 0;
  // plane through the first three non-collinear points
  for (let i = 2; i < pts.length; i++) {
    const a = pts[0], b = pts[1], c = pts[i];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-6) continue;
    return Math.max(...pts.map((p) => Math.abs((nx * (p.x - a.x) + ny * (p.y - a.y) + nz * (p.z - a.z)) / L)));
  }
  return 0;
};

const planArea = (pts: Array<{ x: number; y: number }>) => Math.abs(signedArea(pts));

const checkRoof = (g: RoofGeometry, label: string) => {
  const sloped = g.faces.filter((f) => f.kind !== 'gable');
  for (const f of sloped) assert.ok(planeError(f.pts) < 1e-6, `${label}: face ${f.edge} is planar`);
  const covered = sloped.reduce((a, f) => a + planArea(f.pts), 0);
  assert.ok(Math.abs(covered - planArea(g.outline)) < 1e-3 * planArea(g.outline), `${label}: faces tile the outline (${covered.toFixed(1)} vs ${planArea(g.outline).toFixed(1)})`);
  // every face is bounded below by the eave height and above by the ridge
  for (const f of g.faces) for (const p of f.pts) assert.ok(p.z >= g.eaveZ - 1e-6 && p.z <= g.ridgeZ + 1e-6);
};
const count = (g: RoofGeometry, k: string) => g.lines.filter((l) => l.kind === k).length;
const lineLen = (l: { a: P3; b: P3 }) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);

test('straight skeleton of a rectangle: 4 hips meeting a centred ridge', () => {
  const sk = computeStraightSkeleton(RECT);
  assert.equal(sk.faces.length, 4);
  const maxT = Math.max(...sk.nodes.map((n) => n.t));
  assert.ok(Math.abs(maxT - ft(5)) < 1e-6, 'peak at half the short side');
  // two triangle faces (short ends) and two trapezoids
  assert.deepEqual(sk.faces.map((f) => f.length).sort(), [3, 3, 4, 4]);
});

test('hip roof on a rectangle: ridge = length − width, 4 hips, no valleys', () => {
  const g = computeRoofGeometry({ polygon: RECT, style: 'hip', slopeDeg: DEG4_12, overhang: 0, thickness: 8, baseZ: 108 });
  checkRoof(g, 'rect hip');
  assert.equal(count(g, 'ridge'), 1);
  assert.equal(count(g, 'hip'), 4);
  assert.equal(count(g, 'valley'), 0);
  assert.ok(Math.abs(lineLen(g.lines.find((l) => l.kind === 'ridge')!) - ft(10)) < 1e-6);
  assert.ok(Math.abs(g.ridgeZ - (108 + ft(5) * (4 / 12))) < 1e-6, 'ridge height = 108 + 5\' × 4/12');
});

test('gable roof on a rectangle: gable ends on the short sides, full-length ridge incl. overhang', () => {
  const flags = defaultEdgeSlopes(RECT, 'gable');
  assert.deepEqual(flags, [true, false, true, false]);
  const g = computeRoofGeometry({ polygon: RECT, style: 'gable', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 108 });
  checkRoof(g, 'rect gable');
  const ridge = g.lines.find((l) => l.kind === 'ridge')!;
  assert.ok(Math.abs(lineLen(ridge) - (ft(20) + 36)) < 1e-6, 'ridge runs to both rake overhangs');
  assert.equal(count(g, 'hip'), 0);
  assert.ok(count(g, 'rake') >= 4);
  // eave drops below the plate by overhang × slope
  assert.ok(Math.abs(g.eaveZ - (108 - 18 * (4 / 12))) < 1e-6);
});

test('hip roof on an L-shape: one valley, planar faces that tile the footprint', () => {
  const g = computeRoofGeometry({ polygon: L_SHAPE, style: 'hip', slopeDeg: DEG4_12, overhang: 0, thickness: 8, baseZ: 0 });
  checkRoof(g, 'L hip');
  assert.equal(count(g, 'valley'), 1);
  assert.equal(g.faces.length, 6);
  // the valley starts at the reflex corner (15', 10') at eave height
  const v = g.lines.find((l) => l.kind === 'valley')!;
  const ends = [v.a, v.b];
  assert.ok(ends.some((p) => Math.abs(p.x - ft(15)) < 1e-6 && Math.abs(p.y - ft(10)) < 1e-6 && Math.abs(p.z) < 1e-6));
});

test('gable roof on an L-shape: both wing ends are gables, ridges meet at the valley', () => {
  const flags = defaultEdgeSlopes(L_SHAPE, 'gable');
  assert.equal(flags.filter((f) => !f).length, 2, 'two gable ends');
  const g = computeRoofGeometry({ polygon: L_SHAPE, style: 'gable', slopeDeg: DEG4_12, overhang: 12, thickness: 8, baseZ: 0 });
  checkRoof(g, 'L gable');
  assert.equal(count(g, 'valley'), 1);
  assert.ok(count(g, 'ridge') >= 2);
});

test('hip roof on a T-shape: two valleys, faces planar and tiling', () => {
  const g = computeRoofGeometry({ polygon: T_SHAPE, style: 'hip', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 0 });
  checkRoof(g, 'T hip');
  assert.equal(count(g, 'valley'), 2);
  assert.equal(g.faces.length, 8);
});

test('gable roof on a T-shape and hip/gable on a U-shape', () => {
  const tg = computeRoofGeometry({ polygon: T_SHAPE, style: 'gable', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 0 });
  checkRoof(tg, 'T gable');
  assert.equal(count(tg, 'valley'), 2);
  const uh = computeRoofGeometry({ polygon: U_SHAPE, style: 'hip', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 0 });
  checkRoof(uh, 'U hip');
  assert.equal(count(uh, 'valley'), 2);
  const ug = computeRoofGeometry({ polygon: U_SHAPE, style: 'gable', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 0 });
  checkRoof(ug, 'U gable');
});

test('footprints in either winding order give the same roof', () => {
  const a = computeRoofGeometry({ polygon: L_SHAPE, style: 'hip', slopeDeg: 30, overhang: 0, thickness: 8, baseZ: 0 });
  const b = computeRoofGeometry({ polygon: [...L_SHAPE].reverse(), style: 'hip', slopeDeg: 30, overhang: 0, thickness: 8, baseZ: 0 });
  assert.ok(Math.abs(a.ridgeZ - b.ridgeZ) < 1e-6);
  assert.equal(a.faces.length, b.faces.length);
  const n = normalizeFootprint([...RECT].reverse(), [false, true, false, true]);
  assert.ok(signedArea(n.polygon) > 0);
  assert.equal(n.flags.filter(Boolean).length, 2);
});

test('shed, flat and mansard roofs', () => {
  const shed = computeRoofGeometry({ polygon: RECT, style: 'shed', slopeDeg: DEG4_12, overhang: 0, thickness: 8, baseZ: 100 });
  assert.equal(shed.faces.length, 1);
  assert.ok(Math.abs(shed.ridgeZ - (100 + ft(10) * (4 / 12))) < 1e-6, 'rises across the full depth');
  const flat = computeRoofGeometry({ polygon: L_SHAPE, style: 'flat', slopeDeg: 0, overhang: 12, thickness: 10, baseZ: 120 });
  assert.equal(flat.ridgeZ, 120);
  assert.equal(flat.topAt({ x: 10, y: ft(15) }), 130);
  const mansard = computeRoofGeometry({ polygon: RECT, style: 'mansard', slopeDeg: 10, overhang: 0, thickness: 8, baseZ: 0, mansardLowerSlopeDeg: 70, mansardBreakInset: 24 });
  assert.ok(mansard.faces.some((f) => f.kind === 'mansard-lower') && mansard.faces.some((f) => f.kind === 'mansard-upper'));
  assert.ok(count(mansard, 'break') >= 4);
  for (const f of mansard.faces) assert.ok(planeError(f.pts) < 1e-6);
});

test('wall attach: a gable-end wall follows the roof underside to a peak', () => {
  const g = computeRoofGeometry({ polygon: RECT, style: 'gable', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 108 });
  // east gable wall runs along x = 20' from y = 0 to y = 10'
  const prof = wallTopProfile({ start: { x: ft(20), y: 0 }, end: { x: ft(20), y: ft(10) } }, g, 108);
  const peak = Math.max(...prof.map((p) => p.z));
  assert.ok(Math.abs(prof[0].z - 108) < 1e-6 && Math.abs(prof[prof.length - 1].z - 108) < 1e-6, 'ends at plate height');
  assert.ok(Math.abs(peak - (108 + ft(5) * (4 / 12))) < 1e-6, 'peak meets the ridge underside');
  assert.ok(prof.some((p) => Math.abs(p.s - ft(5)) < 1e-6), 'breakpoint exactly under the ridge');
});

test('slope notation, skylight and dormer helpers', () => {
  assert.equal(formatSlope(DEG4_12), '4:12');
  assert.ok(Math.abs(parseSlopeInput('4:12')! - DEG4_12) < 1e-9);
  assert.ok(Math.abs(parseSlopeInput('6/12')! - rise12ToDegrees(6)) < 1e-9);
  assert.equal(parseSlopeInput('30°'), 30);
  assert.equal(parseSlopeInput('abc'), null);
  const g = computeRoofGeometry({ polygon: RECT, style: 'gable', slopeDeg: DEG4_12, overhang: 18, thickness: 8, baseZ: 108 });
  const sky = skylightOutline(g, { position: { x: ft(6), y: ft(2.5) }, width: 24, length: 48 });
  assert.ok(sky.face, 'skylight sits on a face');
  assert.equal(sky.plan.length, 4);
  const dm = dormerGeometry(g, { position: { x: ft(10), y: ft(1.5) }, width: 60, height: 36 });
  assert.ok(dm && dm.walls.length === 3 && dm.roofPlanes.length === 2);
  assert.ok(dm!.ridgeZ > 108);
});

test('robustness: plus, H, Z, stepped, chamfered, irregular and skewed footprints (hip, gable, mansard)', () => {
  const shapes: Record<string, Array<[number, number]>> = {
    plus: [[10, 0], [20, 0], [20, 10], [30, 10], [30, 20], [20, 20], [20, 30], [10, 30], [10, 20], [0, 20], [0, 10], [10, 10]],
    H: [[0, 0], [10, 0], [10, 12], [20, 12], [20, 0], [30, 0], [30, 30], [20, 30], [20, 18], [10, 18], [10, 30], [0, 30]],
    Z: [[0, 0], [20, 0], [20, 10], [30, 10], [30, 25], [10, 25], [10, 15], [0, 15]],
    stepped: [[0, 0], [40, 0], [40, 10], [30, 10], [30, 20], [20, 20], [20, 30], [0, 30]],
    chamfer: [[0, 0], [30, 0], [30, 12], [22, 20], [0, 20]],
    quad: [[0, 0], [40, 3], [35, 25], [2, 20]],
    penta: [[0, 10], [10, 0], [20, 10], [16, 22], [4, 22]],
    skewL: [[0, 0], [20, 0], [20, 8], [40, 20], [34, 28], [0, 20]],
  };
  for (const [name, pts] of Object.entries(shapes)) {
    for (const style of ['hip', 'gable', 'mansard'] as const) {
      const g = computeRoofGeometry({ polygon: pts.map(([x, y]) => ({ x: ft(x), y: ft(y) })), style, slopeDeg: 25, overhang: 12, thickness: 8, baseZ: 0 });
      checkRoof(g, `${name} ${style}`);
    }
  }
});
