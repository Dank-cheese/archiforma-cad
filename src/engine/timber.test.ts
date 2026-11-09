import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BeamEntity, ColumnEntity, RoofEntity, TrussEntity } from '../types/model';
import { kneeBracesFor, roofTimberFraming, trussMembers, trussSpanThrough, tailCutShift, DEFAULT_ROOF_FRAMING } from './timber';
import { profileById, profileOutline, WOOD_PROFILES, STRUCTURAL_MATERIALS } from './structure';

const levels = [{ id: 'level-1', name: 'Level 1', elevation: 0 }];
const truss = (style: TrussEntity['style']): TrussEntity => ({
  id: 't',
  type: 'truss',
  layer: 'S-BEAM',
  start: { x: 0, y: 0 },
  end: { x: 288, y: 0 },
  style,
  pitch: (Math.atan(8 / 12) * 180) / Math.PI,
  memberWidth: 6,
  memberDepth: 8,
  bearingZ: 108,
  overhang: 18,
  structuralMaterialId: 'doug-fir',
});

test('cabin timber catalog: hewn timbers, round logs, glulams and species', () => {
  for (const id of ['HT-6x8', 'HT-8x8', 'HT-8x10', 'HT-8x12', 'HT-10x12', 'HT-12x12', 'LOG-8', 'LOG-10', 'LOG-12', 'LOG-14', 'GLB-3.125x12', 'GLB-5.125x15', 'GLB-6.75x18']) {
    assert.ok(profileById(id), id);
  }
  assert.equal(profileById('LOG-12')!.kind, 'round');
  assert.ok(profileOutline(profileById('HT-8x12')!).outer.length === 8, 'hewn timbers have chamfered edges');
  for (const m of ['doug-fir', 'wrc', 'white-pine', 'barn-oak']) assert.ok(STRUCTURAL_MATERIALS.some((x) => x.id === m), m);
  assert.ok(WOOD_PROFILES.filter((p) => p.group === 'Heavy timber').length === 6);
});

test('parametric trusses: members per style, ridge at the pitch rise', () => {
  const rise = 144 * (8 / 12);
  for (const [style, n] of [['kingpost', 6], ['queenpost', 8], ['scissor', 5]] as const) {
    const m = trussMembers({ levels }, truss(style));
    assert.equal(m.length, n, style);
    const top = Math.max(...m.flatMap((x) => [x.a.z, x.b.z]));
    assert.ok(Math.abs(top - (108 + rise)) < 1e-6, `${style} ridge height`);
  }
  const hb = trussMembers({ levels }, truss('hammerbeam'));
  assert.ok(hb.filter((x) => x.role === 'hammer').length === 2);
  assert.ok(hb.filter((x) => x.role === 'brace').length >= 30, 'curved braces are sampled');
  // one click inside a 20' x 14' room spans the short (14') direction
  const span = trussSpanThrough({ x: 120, y: 80 }, [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 168 }, { x: 0, y: 168 }]);
  assert.ok(span);
  assert.ok(Math.abs(Math.hypot(span!.end.x - span!.start.x, span!.end.y - span!.start.y) - 168) < 1e-6);
});

test('timber roof framing: ridge beam under the ridge, purlins canted, rafters with tails', () => {
  const roof: RoofEntity = {
    id: 'r',
    type: 'roof',
    layer: 'A-ROOF',
    levelId: 'level-1',
    roofVersion: 2,
    polygon: [{ x: 0, y: 0 }, { x: 288, y: 0 }, { x: 288, y: 192 }, { x: 0, y: 192 }],
    roofStyle: 'gable',
    slope: (Math.atan(8 / 12) * 180) / Math.PI,
    overhang: 12,
    thickness: 8,
    baseOffset: 108,
  } as RoofEntity;
  const m = roofTimberFraming({ levels }, roof, DEFAULT_ROOF_FRAMING, (id) => profileById(id));
  const ridge = m.filter((b) => b.usage === 'ridge');
  const purlins = m.filter((b) => b.usage === 'purlin');
  const rafters = m.filter((b) => b.usage === 'rafter');
  assert.ok(ridge.length >= 1, 'ridge beam');
  assert.ok(purlins.length >= 2, 'purlins');
  assert.ok(rafters.length >= 10, 'rafters');
  assert.ok(purlins.every((p) => Math.abs(Math.abs(p.rotation) - roof.slope) < 1e-6), 'purlins canted to the pitch');
  assert.ok(rafters.every((r) => (r.zStart ?? 0) > (r.zEnd ?? 0) && r.tailCut === 'plumb'), 'rafters slope down to a plumb-cut tail');
  // the ridge beam's top sits at the roof underside at the ridge
  assert.ok(ridge[0].topOffset > 108);
});

test('knee braces: 45° from post to beam on each side; tail cuts', () => {
  const col: ColumnEntity = { id: 'c', type: 'column', layer: 'S-COLS', position: { x: 120, y: 0 }, width: 8, depth: 8, shape: 'rectangular', rotation: 0 } as ColumnEntity;
  const beam = { id: 'b', type: 'beam' } as BeamEntity;
  const kb = kneeBracesFor(col, [{ beam, a: { x: 0, y: 0 }, b: { x: 240, y: 0 }, soffitZ: 96 }], 0, { leg: 30, curved: true, profileId: '6x6-brace', materialId: 'doug-fir' });
  assert.equal(kb.length, 2);
  for (const k of kb) {
    const run = Math.hypot(k.end.x - k.start.x, k.end.y - k.start.y);
    assert.ok(Math.abs(run - 30) < 1e-6 && Math.abs((k.zEnd! - k.zStart!) - 30) < 1e-6, '45° brace');
    assert.equal(k.curved, true);
  }
  // beam ending at the post: only one brace (no beam on the other side)
  assert.equal(kneeBracesFor(col, [{ beam, a: { x: 0, y: 0 }, b: { x: 124, y: 0 }, soffitZ: 96 }], 0, { leg: 30, curved: false, profileId: '6x6-brace', materialId: 'doug-fir' }).length, 1);
  assert.equal(tailCutShift('square', 3, 8, 0.5), 0);
  assert.ok(tailCutShift('plumb', 4, 8, Math.PI / 6) > 0, 'plumb cut: top of the tail reaches further out');
});
