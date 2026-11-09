import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchModel, BeamEntity, ColumnEntity, FloorEntity, FootingEntity, RebarEntity, AreaReinforcementEntity, WallEntity, ArchEntity } from '../types/model';
import {
  barCountForSpacing,
  beamAxis,
  beamSystemJoists,
  clippedBars,
  columnZRange,
  computeAreaReinfBars,
  computeLintels,
  computeRebarBars,
  cutBackAtColumnFace,
  joinedOutlineSegments,
  layoutPositions,
  rebarScheduleRows,
  REBAR_PRESETS,
  slabPieces,
  splitByJoint,
  structuralWarnings,
  suggestLintel,
  analyticalModel,
  profileOutline,
  STEEL_PROFILES,
  pairKey,
  areaReinfLabel,
} from './structure';
import { createSampleProject } from './geometry';

const base = (entities: ArchEntity[], extra: Partial<ArchModel> = {}): ArchModel =>
  ({
    projectName: 't',
    layers: [],
    activeLayer: '0',
    entities,
    levels: [
      { id: 'level-1', name: 'Level 1', elevation: 0 },
      { id: 'level-2', name: 'Level 2', elevation: 120 },
    ],
    settings: { units: 'imperial' },
    ...extra,
  }) as unknown as ArchModel;

const col = (id: string, x: number, y: number, extra: Partial<ColumnEntity> = {}): ColumnEntity => ({
  id, type: 'column', layer: 'S-COLS', levelId: 'level-1', position: { x, y }, rotation: 0, shape: 'rectangular', width: 16, depth: 16, height: 120, ...extra,
});

const beam = (id: string, a: [number, number], b: [number, number], extra: Partial<BeamEntity> = {}): BeamEntity => ({
  id, type: 'beam', usage: 'beam', layer: 'S-BEAM', levelId: 'level-2', start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] },
  structuralMaterialId: 'conc-4000', width: 12, depth: 24, topOffset: 0, startOffset: 0, endOffset: 0, rotation: 0, justification: 'top', ...extra,
});

test('rebar count from spacing: spacing never exceeds the maximum', () => {
  assert.equal(barCountForSpacing(120, 12), 11); // exactly 10 spaces of 12"
  assert.equal(barCountForSpacing(100, 12), 10); // 9 spaces of 11.1"
  assert.equal(barCountForSpacing(0, 12), 1);
  const pos = layoutPositions(100, 'maxSpacing', undefined, 12);
  assert.equal(pos.length, 10);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] - pos[i - 1] <= 12 + 1e-9);
  assert.deepEqual(layoutPositions(30, 'count', 4), [0, 10, 20, 30]);
  assert.deepEqual(layoutPositions(30, 'single'), [15]);
  const cs = layoutPositions(60, 'countSpacing', 3, 6);
  assert.deepEqual(cs, [24, 30, 36]); // 3 bars @ 6" centred
});

test('rebar clipped by cover: bars stay inside the host minus cover', () => {
  // 120" x 60" slab region, 1" cover -> bars along x are 118" long, spread over 58"
  const rect = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }];
  const segs = clippedBars(rect, [], { x: 1, y: 0 }, 1, (span) => layoutPositions(span, 'maxSpacing', undefined, 12));
  assert.equal(segs.length, barCountForSpacing(58, 12));
  for (const [a, b] of segs) {
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 118) < 1e-6);
    assert.ok(a.y >= 1 - 1e-9 && a.y <= 59 + 1e-9);
  }
  // an opening (dilated by cover) interrupts the bars that cross it
  const hole = [{ x: 50, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 40 }, { x: 50, y: 40 }];
  const cut = clippedBars(rect, [hole], { x: 1, y: 0 }, 1, (span) => layoutPositions(span, 'maxSpacing', undefined, 12));
  assert.ok(cut.length > segs.length);
  for (const [a, b] of cut) {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    assert.ok(!(m.x > 49 && m.x < 71 && m.y > 19 && m.y < 41), 'no bar runs through the opening');
  }
});

test('footing rebar follows the host: resizing the footing updates length and count', () => {
  const f: FootingEntity = { id: 'f1', type: 'footing', kind: 'isolated', layer: 'S-FNDN', levelId: 'level-1', position: { x: 0, y: 0 }, rotation: 0, length: 60, width: 60, thickness: 12, topOffset: -12 };
  const ar: AreaReinforcementEntity = { id: 'ar1', type: 'areareinf', layer: 'S-REBAR', hostId: 'f1', barSize: '#5', spacing: 10, topX: false, topY: false, bottomX: true, bottomY: true };
  const m = base([f, ar]);
  const bars = computeAreaReinfBars(m, ar);
  // 3" cover each side: 54" bars, spread over 54" at <= 10" -> 7 per direction
  assert.equal(bars.length, 14);
  for (const b of bars) {
    assert.ok(Math.abs(b.length - 54) < 1e-6);
    assert.ok(b.pts.every((p) => Math.abs(p.x) <= 27 + 1e-6 && Math.abs(p.y) <= 27 + 1e-6));
    assert.ok(b.pts.every((p) => p.z >= -24 + 3 - 1e-9 && p.z <= -12 - 3 + 1e-9), 'inside the footing thickness minus cover');
  }
  const bigger = base([{ ...f, length: 96 }, ar]);
  const bars2 = computeAreaReinfBars(bigger, ar);
  assert.ok(bars2.length > bars.length);
  assert.ok(bars2.some((b) => Math.abs(b.length - 90) < 1e-6));
  assert.equal(areaReinfLabel(ar), '#5 @ 10" EW BOT');
});

test('beam cut back at the column face', () => {
  const poly = [{ x: -8, y: -8 }, { x: 8, y: -8 }, { x: 8, y: 8 }, { x: -8, y: 8 }];
  const p = cutBackAtColumnFace({ x: 0, y: 0 }, { x: 240, y: 0 }, poly)!;
  assert.ok(Math.abs(p.x - 8) < 1e-9 && Math.abs(p.y) < 1e-9);
  assert.equal(cutBackAtColumnFace({ x: 20, y: 0 }, { x: 240, y: 0 }, poly), null);
  // whole beam between two 16" columns 240" apart -> 224" clear span
  const m = base([col('c1', 0, 0), col('c2', 240, 0, { levelId: 'level-2' }), beam('b1', [0, 0], [240, 0])]);
  // the beam is on level 2: only the level-2 column cuts it (the level-1 column is below)
  const ax0 = beamAxis(m, m.entities[2] as BeamEntity);
  assert.ok(Math.abs(ax0.start.x) < 1e-9 && Math.abs(ax0.end.x - 232) < 1e-9);
  const m2 = base([col('c1', 0, 0, { levelId: 'level-2' }), col('c2', 240, 0, { levelId: 'level-2' }), beam('b1', [0, 0], [240, 0])]);
  const ax = beamAxis(m2, m2.entities[2] as BeamEntity);
  assert.ok(Math.abs(ax.start.x - 8) < 1e-9 && Math.abs(ax.end.x - 232) < 1e-9);
  assert.equal(ax.startColumnId, 'c1');
  // UNJOIN (UJ) keeps the beam running to the column centre
  const m3 = base(m2.entities, { structureJoins: { unjoined: [pairKey('b1', 'c1')], switched: [] } });
  assert.ok(Math.abs(beamAxis(m3, m3.entities[2] as BeamEntity).start.x) < 1e-9);
});

test('beam rebar preset stays inside the beam minus cover and follows the cut-back length', () => {
  const m = base([col('c1', 0, 0, { levelId: 'level-2' }), col('c2', 240, 0, { levelId: 'level-2' }), beam('b1', [0, 0], [240, 0])]);
  const sets = REBAR_PRESETS.find((p) => p.id === 'beam')!.make(m, 'b1', 'level-2') as RebarEntity[];
  m.entities.push(...sets);
  const [bottom, top, stirrups] = sets.map((s) => computeRebarBars(m, s));
  assert.equal(bottom.length, 4);
  assert.equal(top.length, 2);
  // stirrups @ 6" max over 224 - 2*1.5 = 221" -> ceil(221/6)+1 = 38
  assert.equal(stirrups.length, 38);
  for (const b of [...bottom, ...top, ...stirrups]) {
    for (const p of b.pts) {
      assert.ok(p.x >= 8 + 1.5 - 1e-6 && p.x <= 232 - 1.5 + 1e-6, 'within beam length minus cover');
      assert.ok(Math.abs(p.y) <= 6 - 1.5 + 1e-6, 'within width minus side cover');
      assert.ok(p.z >= 96 + 1.5 - 1e-6 && p.z <= 120 - 1.5 + 1e-6, 'within depth minus cover');
    }
  }
  const rows = rebarScheduleRows(m);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].count, 4);
  assert.ok(rows.every((r) => r.weightLb > 0));
});

test('column preset: 8 vertical bars + ties; column height follows its top level', () => {
  const c = col('c1', 0, 0, { topLevelId: 'level-2', topOffset: 0 });
  const m = base([c]);
  assert.deepEqual(columnZRange(m, c), { z0: 0, z1: 120 });
  const sets = REBAR_PRESETS.find((p) => p.id === 'column')!.make(m, 'c1', 'level-1') as RebarEntity[];
  m.entities.push(...sets);
  const v = computeRebarBars(m, sets[0]);
  assert.equal(v.length, 8);
  for (const b of v) assert.ok(Math.abs(b.length - (120 - 3)) < 1e-6);
  const ties = computeRebarBars(m, sets[1]);
  assert.equal(ties.length, barCountForSpacing(117, 12));
});

test('clean joins: overlapping concrete outlines drop the interior edges', () => {
  const A = { id: 'a', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
  const B = { id: 'b', pts: [{ x: 5, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 8 }, { x: 5, y: 8 }] };
  const joined = joinedOutlineSegments([A, B], () => true);
  const len = joined.reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0);
  // union perimeter: A (40) minus its right edge inside B (6) + B (25+25+6+6) minus top/bottom inside A (5+5) and its left edge (6)
  assert.ok(Math.abs(len - (40 - 6 + 62 - 10 - 6)) < 1e-6, String(len));
  const apart = joinedOutlineSegments([A, B], () => false);
  assert.ok(apart.reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0) > len);
});

test('expansion joint splits the slab with a gap', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const parts = splitByJoint(sq, { x: 50, y: -10 }, { x: 50, y: 110 }, 1);
  assert.equal(parts.length, 2);
  const xs = parts.map((p) => [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x))]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(xs, [[0, 49.5], [50.5, 100]]);
  const fl: FloorEntity = { id: 's', type: 'floor', layer: 'S', polygon: sq, thickness: 6, material: 'concrete' };
  assert.equal(slabPieces(fl, [fl, { id: 'j', type: 'sjoint', layer: 'S', kind: 'expansion', hostId: 's', start: { x: 50, y: -10 }, end: { x: 50, y: 110 }, gap: 1 }]).length, 2);
  assert.equal(slabPieces(fl, [fl, { id: 'j', type: 'sjoint', layer: 'S', kind: 'control', hostId: 's', start: { x: 50, y: -10 }, end: { x: 50, y: 110 }, gap: 0 }]).length, 1);
});

test('lintels are auto-sized from the opening width and can be overridden', () => {
  assert.equal(suggestLintel(36, 'wood').label, '2-2x6');
  assert.equal(suggestLintel(72, 'wood').label, '2-2x10');
  assert.equal(suggestLintel(72, 'masonry').depth, 16);
  const w: WallEntity = { id: 'w', type: 'wall', layer: 'A-WALL', start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, thickness: 8, height: 120, baseOffset: 0, justification: 'center', wallTypeId: 'wt-conc-8' };
  const ents: ArchEntity[] = [w, { id: 'd', type: 'door', layer: 'A-DOOR', wallId: 'w', offset: 0.5, width: 36, height: 84, swing: 'left-in' }, { id: 'win', type: 'window', layer: 'A-GLAZ', wallId: 'w', offset: 0.2, width: 60, height: 48, sillHeight: 36, lintel: { label: 'W8x18', depth: 8 } }];
  const ls = computeLintels(ents, w);
  assert.equal(ls.length, 2);
  const door = ls.find((l) => l.openingId === 'd')!;
  assert.equal(door.zBot, 84);
  assert.equal(door.depth, 8);
  assert.ok(door.s0 < 100 - 18 && door.s1 > 100 + 18);
  assert.equal(ls.find((l) => l.openingId === 'win')!.label, 'W8x18');
});

test('joists fill a bay at the spacing, and simple warnings are reported', () => {
  const joists = beamSystemJoists({ id: 'bs', type: 'beamsystem', layer: 'S', boundary: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 240 }, { x: 0, y: 240 }], spacing: 16, angle: 90, structuralMaterialId: 'spf2', profileId: '2x10', width: 1.5, depth: 9.25, topOffset: 0 });
  assert.equal(joists.length, 9); // 16, 32, ... 144
  for (const [a, b] of joists) assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 240) < 1e-6);
  // a 30 ft W8x10 beam with nothing under one end, a column with no footing
  const m = base([col('c1', 0, 0), beam('b1', [0, 0], [360, 0], { structuralMaterialId: 'a992', profileId: 'W8x10', levelId: 'level-1' })]);
  const w = structuralWarnings(m);
  assert.ok(w.some((x) => x.id === 'nofdn-c1'));
  assert.ok(w.some((x) => x.id === 'ld-b1'));
  assert.ok(w.some((x) => x.id === 'nosup-b1-end'));
  assert.ok(!w.some((x) => x.id === 'nosup-b1-start'));
  const an = analyticalModel(m);
  assert.equal(an.members.length, 2);
  assert.ok(an.nodes.length >= 1);
});

test('steel profiles have closed outlines; sample project has a valid structural model', () => {
  const w = profileOutline(STEEL_PROFILES.find((p) => p.id === 'W14x48')!);
  assert.equal(w.outer.length, 12);
  const s = createSampleProject();
  const fts = s.entities.filter((e) => e.type === 'footing');
  const cols = s.entities.filter((e) => e.type === 'column');
  assert.ok(fts.length >= cols.length && cols.length >= 4, 'every sample column has a footing');
  assert.ok(s.entities.some((e) => e.type === 'beam' && e.structuralMaterialId === 'a992'));
  const cb = s.entities.find((e): e is BeamEntity => e.type === 'beam' && e.structuralMaterialId.startsWith('conc'))!;
  assert.ok(cb);
  const rbs = s.entities.filter((e): e is RebarEntity => e.type === 'rebar' && e.hostId === cb.id);
  assert.ok(rbs.length >= 3 && rbs.every((r) => computeRebarBars(s, r).length > 0));
  assert.ok(s.entities.some((e) => e.type === 'areareinf'));
  assert.ok(!structuralWarnings(s).some((x) => x.id.startsWith('nofdn')));
});
