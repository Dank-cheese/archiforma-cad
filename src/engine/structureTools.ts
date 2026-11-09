/**
 * Structural tool interactions: turns plan clicks (and selections) into structural elements.
 * Pure functions over the model — the UI applies the returned entity list with undo/redo.
 */
import type {
  ArchEntity,
  ArchModel,
  AreaReinforcementEntity,
  BeamEntity,
  BeamJustification,
  BeamSystemEntity,
  ColumnEntity,
  ConnectionEntity,
  FloorEntity,
  FootingEntity,
  GridEntity,
  LoadEntity,
  LoadKind,
  Point,
  RebarEntity,
  RebarLayoutRule,
  RebarPlacement,
  RebarShape,
  SectionEntity,
  SteelConnectionKind,
  StructuralJointEntity,
  StructuralJointKind,
  ToolId,
  WallEntity,
} from '../types/model';
import {
  barFor,
  columnZRange,
  beamAxis,
  beamVertical,
  levelElevationOf,
  profileById,
  beamPlanOutline,
  beamSection,
  columnFootprint,
  columnMaterialId,
  defaultConcreteId,
  defaultJoistAngle,
  footingPlanOutline,
  isConcrete,
  LOAD_UNITS,
  materialById,
  pairKey,
  rebarHostOf,
  REBAR_PRESETS,
  suggestFootingForColumn,
} from './structure';
import { findEnclosedRoomAtPoint, formatLength } from './geometry';
import { DEFAULT_KNEE, DEFAULT_ROOF_FRAMING, kneeBracesFor, roofTimberFraming, trussSpanThrough, TRUSS_STYLES, type KneeBraceOptions, type RoofFramingOptions } from './timber';
import type { RoofEntity, TailCut, TrussEntity, TrussStyle } from '../types/model';
import { getRoofGeometry, pointInPolygon } from './roof';

export const STRUCTURE_TOOLS: ToolId[] = ['footing', 'wallfooting', 'foundationslab', 'pilecap', 'beam', 'beamsystem', 'brace', 'rebar', 'areareinf', 'connection', 'sjoint', 'load', 'section', 'truss', 'kneebrace', 'roofframing'];
export const isStructureTool = (t: ToolId) => STRUCTURE_TOOLS.includes(t);

export interface StructToolState {
  footing: { length: number; width: number; thickness: number; topOffset: number; auto: boolean };
  wallFooting: { width: number; thickness: number; offset: number; topOffset: number };
  slab: { thickness: number; thickenedEdge: boolean; edgeWidth: number; edgeDepth: number; vaporBarrier: boolean };
  pile: { count: number; diameter: number; length: number };
  beam: { materialId: string; profileId: string; width: number; depth: number; topOffset: number; justification: BeamJustification };
  beamSystem: { spacing: number; profileId: string; materialId: string; angle: 'auto' | number };
  brace: { profileId: string; materialId: string; zStart: number; zEnd: number };
  rebar: { barSize: string; shape: RebarShape; placement: RebarPlacement; rule: RebarLayoutRule; count: number; spacing: number };
  area: { barSize: string; spacing: number; top: boolean; bottom: boolean };
  connection: SteelConnectionKind;
  joint: { kind: StructuralJointKind; gap: number };
  load: { kind: LoadKind; value: number };
  truss: { style: TrussStyle; pitch: number; memberWidth: number; memberDepth: number; overhang: number; materialId: string; count: number; spacing: number; tailCut: TailCut };
  knee: KneeBraceOptions;
  roofFraming: RoofFramingOptions;
}

export const DEFAULT_STRUCT_TOOL: StructToolState = {
  footing: { length: 48, width: 48, thickness: 12, topOffset: -12, auto: true },
  wallFooting: { width: 24, thickness: 12, offset: 0, topOffset: -12 },
  slab: { thickness: 5, thickenedEdge: true, edgeWidth: 12, edgeDepth: 8, vaporBarrier: true },
  pile: { count: 4, diameter: 14, length: 360 },
  beam: { materialId: 'a992', profileId: 'W12x26', width: 12, depth: 24, topOffset: 0, justification: 'top' },
  beamSystem: { spacing: 16, profileId: '2x10', materialId: 'spf2', angle: 'auto' },
  brace: { profileId: 'HSS4x4x1/4', materialId: 'a992', zStart: 0, zEnd: 108 },
  rebar: { barSize: '#5', shape: 'straight', placement: 'bottom', rule: 'maxSpacing', count: 4, spacing: 12 },
  area: { barSize: '#4', spacing: 12, top: false, bottom: true },
  connection: 'shear-plate',
  joint: { kind: 'control', gap: 1 },
  load: { kind: 'point', value: 5 },
  truss: { style: 'kingpost', pitch: 33.69, memberWidth: 6, memberDepth: 8, overhang: 18, materialId: 'doug-fir', count: 1, spacing: 96, tailCut: 'plumb' },
  knee: { ...DEFAULT_KNEE },
  roofFraming: { ...DEFAULT_ROOF_FRAMING },
};

export interface StructClickResult {
  entities?: ArchEntity[];
  label?: string;
  drawingPoints?: Point[];
  select?: string[];
  log?: { text: string; kind: 'info' | 'result' | 'error' };
  openSectionId?: string;
}

export interface StructClickContext {
  model: ArchModel;
  tool: ToolId;
  st: StructToolState;
  point: Point; // snapped
  raw: Point;
  drawingPoints: Point[];
  levelId: string;
  tol: number; // pick tolerance in model inches
}

let seq = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function distToSeg(p: Point, a: Point, b: Point): { d: number; t: number; q: Point } {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const L2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2));
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { d: dist(p, q), t, q };
}

const onLevel = (e: ArchEntity, levelId: string) => (e.levelId || 'level-1') === levelId;

export function columnAt(model: ArchModel, p: Point, levelId: string, tol: number): ColumnEntity | null {
  let best: ColumnEntity | null = null;
  let bd = Infinity;
  for (const c of model.entities) {
    if (c.type !== 'column' || !onLevel(c, levelId)) continue;
    const fp = columnFootprint(c);
    const d = pointInPolygon(p, fp) ? 0 : dist(p, c.position) - Math.max(...fp.map((q) => dist(q, c.position)));
    if (d <= tol && d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function wallAt(model: ArchModel, p: Point, levelId: string, tol: number): WallEntity | null {
  let best: WallEntity | null = null;
  let bd = Infinity;
  for (const w of model.entities) {
    if (w.type !== 'wall' || !onLevel(w, levelId)) continue;
    const { d } = distToSeg(p, w.start, w.end);
    if (d <= w.thickness / 2 + tol && d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

export function beamAt(model: ArchModel, p: Point, levelId: string, tol: number): BeamEntity | null {
  let best: BeamEntity | null = null;
  let bd = Infinity;
  for (const b of model.entities) {
    if (b.type !== 'beam' || !onLevel(b, levelId)) continue;
    const { d } = distToSeg(p, b.start, b.end);
    if (d <= beamSection(b).bf / 2 + tol && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Concrete host under the cursor (columns, beams, footings, walls, then slabs). */
export function rebarHostAt(model: ArchModel, p: Point, levelId: string, tol: number, area = false): ArchEntity | null {
  const cands: ArchEntity[] = [];
  if (!area) {
    const c = columnAt(model, p, levelId, tol);
    if (c && isConcrete(columnMaterialId(c))) cands.push(c);
    const b = beamAt(model, p, levelId, tol);
    if (b && isConcrete(b.structuralMaterialId)) cands.push(b);
  }
  for (const f of model.entities) {
    if (f.type === 'footing' && onLevel(f, levelId)) {
      const fp = footingPlanOutline(f, model.entities);
      if (fp.length >= 3 && pointInPolygon(p, fp)) cands.push(f);
    }
  }
  const w = wallAt(model, p, levelId, tol);
  if (w && rebarHostOf(model, w.id)) cands.push(w);
  for (const f of model.entities) {
    if (f.type === 'floor' && onLevel(f, levelId) && f.polygon.length >= 3 && pointInPolygon(p, f.polygon) && rebarHostOf(model, f.id)) cands.push(f);
  }
  return cands.find((c) => rebarHostOf(model, c.id)) || null;
}

/** Beam end snapping: column centres first, then onto walls (and remember the wall for its top). */
export function snapBeamPoint(model: ArchModel, p: Point, levelId: string, tol: number): { p: Point; wall?: WallEntity; column?: ColumnEntity } {
  const lv = model.levels || [];
  const thisZ = lv.find((l) => l.id === levelId)?.elevation ?? 0;
  const below = [...lv].sort((a, b) => b.elevation - a.elevation).find((l) => l.elevation < thisZ - 1);
  for (const c of model.entities) {
    if (c.type !== 'column') continue;
    // columns on this level, or columns from the level below rising to this one
    if (!onLevel(c, levelId) && !(below && onLevel(c, below.id))) continue;
    if (dist(p, c.position) <= Math.max(tol, 18)) return { p: c.position, column: c };
  }
  const walls = model.entities.filter((w): w is WallEntity => w.type === 'wall' && (onLevel(w, levelId) || (!!below && onLevel(w, below.id))));
  for (const w of walls) {
    for (const end of [w.start, w.end]) if (dist(p, end) <= Math.max(tol, 12)) return { p: end, wall: w };
  }
  for (const w of walls) {
    const s = distToSeg(p, w.start, w.end);
    if (s.d <= w.thickness / 2 + 2) return { p: s.q, wall: w };
  }
  return { p };
}

function newBeam(ctx: StructClickContext, a: Point, b: Point, usage: 'beam' | 'brace'): BeamEntity {
  const s = ctx.st;
  if (usage === 'brace') {
    return {
      id: nid('br'), type: 'beam', usage: 'brace', layer: 'S-BEAM', levelId: ctx.levelId, start: a, end: b,
      structuralMaterialId: s.brace.materialId, profileId: s.brace.profileId, width: 6, depth: 6, topOffset: 0,
      startOffset: 0, endOffset: 0, rotation: 0, justification: 'center', zStart: s.brace.zStart, zEnd: s.brace.zEnd,
    };
  }
  const fam = materialById(s.beam.materialId).family;
  return {
    id: nid('bm'), type: 'beam', usage: 'beam', layer: 'S-BEAM', levelId: ctx.levelId, start: a, end: b,
    structuralMaterialId: s.beam.materialId, profileId: fam === 'concrete' ? undefined : s.beam.profileId,
    width: s.beam.width, depth: s.beam.depth, topOffset: s.beam.topOffset, startOffset: 0, endOffset: 0, rotation: 0,
    justification: s.beam.justification,
  };
}

export function footingForColumn(model: ArchModel, col: ColumnEntity, st: StructToolState, kind: 'isolated' | 'pilecap' = 'isolated'): FootingEntity {
  const sug = suggestFootingForColumn(col);
  const auto = st.footing.auto;
  const f: FootingEntity = {
    id: nid(kind === 'pilecap' ? 'pc' : 'ftg'), type: 'footing', kind, layer: 'S-FNDN', levelId: col.levelId || 'level-1',
    position: col.position, rotation: col.rotation || 0, columnId: col.id,
    length: auto ? sug.length : st.footing.length, width: auto ? sug.width : st.footing.width,
    thickness: auto ? sug.thickness : st.footing.thickness, topOffset: st.footing.topOffset, structuralMaterialId: defaultConcreteId(model),
  };
  if (kind === 'pilecap') {
    const n = Math.max(1, Math.min(9, st.pile.count));
    const side = Math.max(48, Math.ceil(Math.sqrt(n)) * st.pile.diameter * 3);
    f.length = side;
    f.width = n <= 2 ? Math.max(36, st.pile.diameter * 2.5) : side;
    f.thickness = Math.max(24, st.footing.thickness);
    f.piles = { ...st.pile };
  }
  return f;
}

function wallFootingFor(model: ArchModel, w: WallEntity, st: StructToolState): FootingEntity {
  return {
    id: nid('wf'), type: 'footing', kind: 'wall', layer: 'S-FNDN', levelId: w.levelId || 'level-1', position: w.start, rotation: 0,
    wallId: w.id, width: Math.max(st.wallFooting.width, w.thickness + 8), length: 0, thickness: st.wallFooting.thickness,
    topOffset: st.wallFooting.topOffset, offset: st.wallFooting.offset, structuralMaterialId: defaultConcreteId(model),
  };
}

function newSlab(ctx: StructClickContext, polygon: Point[], wallIds?: string[]): FloorEntity {
  const s = ctx.st.slab;
  return {
    id: nid('sog'), type: 'floor', layer: 'S-SLAB', levelId: ctx.levelId, polygon, thickness: s.thickness, material: 'concrete',
    floorTypeId: 'ft-conc-6', structural: true, foundation: true, structuralMaterialId: defaultConcreteId(ctx.model),
    thickenedEdge: s.thickenedEdge ? { width: s.edgeWidth, depth: s.edgeDepth } : null, vaporBarrier: s.vaporBarrier, spanAngle: 0, wallIds,
  };
}

/** Bay bounded by beams and walls containing `p` (for BEAM SYSTEM). */
export function findBayAt(model: ArchModel, p: Point, levelId: string): Point[] | null {
  const pseudo: WallEntity[] = [];
  for (const e of model.entities) {
    if (!onLevel(e, levelId)) continue;
    if (e.type === 'wall') pseudo.push(e);
    if (e.type === 'beam' && e.usage !== 'brace') pseudo.push({ id: e.id, type: 'wall', layer: e.layer, levelId, start: e.start, end: e.end, thickness: 1, height: 1, baseOffset: 0, justification: 'center' });
  }
  const res = findEnclosedRoomAtPoint(p, pseudo);
  return res && res.polygon.length >= 3 ? res.polygon : null;
}

export function handleStructuralClick(ctx: StructClickContext): StructClickResult {
  const { model, tool, st, point, raw, drawingPoints, levelId, tol } = ctx;
  const ents = model.entities;
  const add = (list: ArchEntity[], label: string, log: string, extra: Partial<StructClickResult> = {}): StructClickResult => ({
    entities: [...ents, ...list], label, select: list.length ? [list[list.length - 1].id] : undefined, log: { text: log, kind: 'result' }, drawingPoints: [], ...extra,
  });
  const units = model.settings.units;
  switch (tool) {
    case 'footing':
    case 'pilecap': {
      const col = columnAt(model, raw, levelId, tol);
      const kind = tool === 'pilecap' ? 'pilecap' : 'isolated';
      if (col) {
        if (ents.some((f) => f.type === 'footing' && f.columnId === col.id)) return { log: { text: 'That column already has a footing.', kind: 'error' } };
        const f = footingForColumn(model, col, st, kind);
        return add([f], kind === 'pilecap' ? 'Place Pile Cap' : 'Place Footing', `${kind === 'pilecap' ? 'PILE CAP' : 'FOOTING'}: placed under the column (follows it when the column moves).`);
      }
      const f: FootingEntity = {
        id: nid('ftg'), type: 'footing', kind, layer: 'S-FNDN', levelId, position: point, rotation: 0,
        length: st.footing.length, width: st.footing.width, thickness: st.footing.thickness, topOffset: st.footing.topOffset,
        structuralMaterialId: defaultConcreteId(model), piles: kind === 'pilecap' ? { ...st.pile } : undefined,
      };
      return add([f], 'Place Footing', 'FOOTING: placed. Click a column to place a pad under it, or select columns / a grid and run FT.');
    }
    case 'wallfooting': {
      const w = wallAt(model, raw, levelId, tol);
      if (!w) return { log: { text: 'WALL FOOTING: click a wall (or select walls first and run WF).', kind: 'error' } };
      if (ents.some((f) => f.type === 'footing' && f.wallId === w.id)) return { log: { text: 'That wall already has a footing.', kind: 'error' } };
      return add([wallFootingFor(model, w, st)], 'Place Wall Footing', 'WALL FOOTING: strip footing added under the wall; it follows the wall.');
    }
    case 'foundationslab': {
      if (drawingPoints.length === 0) {
        const walls = ents.filter((w): w is WallEntity => w.type === 'wall' && onLevel(w, levelId));
        const room = findEnclosedRoomAtPoint(raw, walls);
        const insideExisting = ents.some((f) => f.type === 'floor' && f.foundation && onLevel(f, levelId) && pointInPolygon(raw, f.polygon));
        if (room && !insideExisting) return add([newSlab(ctx, room.polygon, room.wallIds)], 'Foundation Slab', 'FOUNDATION SLAB: slab on grade created from the enclosing walls. Thickness, thickened edge and vapor barrier are in Properties.');
      }
      if (drawingPoints.length >= 3 && dist(point, drawingPoints[0]) <= tol * 1.5) return finishStructuralPolygon(ctx);
      return { drawingPoints: [...drawingPoints, point], log: { text: `FOUNDATION SLAB: ${drawingPoints.length + 1} point(s). Click the first point or press Enter to close.`, kind: 'info' } };
    }
    case 'beam':
    case 'brace': {
      const sp = tool === 'beam' ? snapBeamPoint(model, point, levelId, tol) : { p: point };
      if (drawingPoints.length === 0) return { drawingPoints: [sp.p], log: { text: `${tool.toUpperCase()}: pick the end point${tool === 'beam' ? ' (snaps to column centres and wall tops)' : ''}.`, kind: 'info' } };
      const a = drawingPoints[0];
      if (dist(a, sp.p) < 6) return {};
      const b = newBeam(ctx, a, sp.p, tool);
      // landing on wall tops: put the beam on top of the wall
      if (tool === 'beam') {
        const sa = snapBeamPoint(model, a, levelId, tol);
        const wall = sp.wall || sa.wall;
        if (wall && !sa.column && !sp.column) {
          const lvZ = (model.levels || []).find((l) => l.id === levelId)?.elevation ?? 0;
          const wallLv = (model.levels || []).find((l) => l.id === (wall.levelId || 'level-1'))?.elevation ?? 0;
          b.topOffset = wallLv + (wall.baseOffset || 0) + (wall.height || 108) + beamSection(b).d - lvZ;
        }
      }
      return { ...add([b], tool === 'beam' ? 'Draw Beam' : 'Draw Brace', `${tool === 'beam' ? 'BEAM' : 'BRACE'} ${beamSection(b).label} placed. Click to continue from its end, Esc to stop.`), drawingPoints: tool === 'beam' ? [sp.p] : [] };
    }
    case 'beamsystem': {
      const bay = findBayAt(model, raw, levelId);
      if (!bay) return { log: { text: 'BEAM SYSTEM: click inside a bay closed by beams and/or walls on this level.', kind: 'error' } };
      const s = st.beamSystem;
      const prof = s.profileId;
      const sec = beamSection({ structuralMaterialId: s.materialId, profileId: prof, width: 1.5, depth: 9.25 });
      const bs: BeamSystemEntity = {
        id: nid('bs'), type: 'beamsystem', layer: 'S-BEAM', levelId, boundary: bay, spacing: s.spacing,
        angle: s.angle === 'auto' ? defaultJoistAngle(bay) : s.angle, structuralMaterialId: s.materialId, profileId: prof,
        width: sec.bf, depth: sec.d, topOffset: 0,
      };
      return add([bs], 'Beam System', `BEAM SYSTEM: ${sec.label} joists @ ${s.spacing}" o.c. fill the bay.`);
    }
    case 'rebar':
    case 'areareinf': {
      const host = rebarHostAt(model, raw, levelId, tol, tool === 'areareinf');
      if (!host) return { log: { text: `${tool === 'rebar' ? 'REBAR' : 'AREA REINFORCEMENT'}: click a concrete ${tool === 'rebar' ? 'footing, column, beam, slab or wall' : 'slab, wall or footing'}.`, kind: 'error' } };
      if (tool === 'areareinf') {
        const a = st.area;
        const ar: AreaReinforcementEntity = { id: nid('ar'), type: 'areareinf', layer: 'S-REBAR', levelId: host.levelId || levelId, hostId: host.id, barSize: barFor(model, a.barSize), spacing: a.spacing, topX: a.top, topY: a.top, bottomX: a.bottom, bottomY: a.bottom };
        return add([ar], 'Area Reinforcement', 'AREA REINFORCEMENT added — bars stay inside the host minus cover and update when it changes.');
      }
      const r = st.rebar;
      const placement = adaptPlacement(host, r.placement);
      const rb: RebarEntity = { id: nid('rb'), type: 'rebar', layer: 'S-REBAR', levelId: host.levelId || levelId, hostId: host.id, barSize: barFor(model, r.barSize), shape: placement === 'stirrup' || placement === 'tie' ? 'stirrup' : r.shape, placement, layout: { rule: r.rule, count: r.count, spacing: r.spacing } };
      return add([rb], 'Add Rebar', `REBAR: ${rb.barSize} ${placement} bars added to the ${host.type}. Edit size, shape, layout and cover in Properties.`);
    }
    case 'connection': {
      const b = beamAt(model, raw, levelId, tol * 2);
      if (st.connection === 'base-plate') {
        const c = columnAt(model, raw, levelId, tol);
        if (!c) return { log: { text: 'BASE PLATE: click a steel column.', kind: 'error' } };
        return add([{ id: nid('cn'), type: 'connection', layer: 'S-BEAM', levelId, kind: 'base-plate', memberIds: [c.id] } as ConnectionEntity], 'Connection', 'BASE PLATE added.');
      }
      if (!b) return { log: { text: 'CONNECTION: click near the end of a beam (or select two members and run CN).', kind: 'error' } };
      const end = dist(raw, b.start) < dist(raw, b.end) ? b.start : b.end;
      const sup = supportAt(model, b, end, levelId);
      if (!sup) return { log: { text: 'CONNECTION: no column or beam found at that beam end.', kind: 'error' } };
      return add([{ id: nid('cn'), type: 'connection', layer: 'S-BEAM', levelId, kind: st.connection, memberIds: [b.id, sup.id], bolts: 3 } as ConnectionEntity], 'Connection', `CONNECTION (${st.connection}) added between the beam and its support.`);
    }
    case 'sjoint': {
      if (drawingPoints.length === 0) return { drawingPoints: [point], log: { text: 'JOINT: pick the second point across the slab or wall.', kind: 'info' } };
      const a = drawingPoints[0];
      const m = { x: (a.x + point.x) / 2, y: (a.y + point.y) / 2 };
      const host = ents.find((f) => f.type === 'floor' && onLevel(f, levelId) && pointInPolygon(m, f.polygon)) || wallAt(model, m, levelId, tol);
      if (!host) return { drawingPoints: [], log: { text: 'JOINT: the line must cross a slab (or run along a wall) on this level.', kind: 'error' } };
      const j: StructuralJointEntity = { id: nid('sj'), type: 'sjoint', layer: 'S-SLAB', levelId, kind: st.joint.kind, hostId: host.id, start: a, end: point, gap: st.joint.kind === 'expansion' ? st.joint.gap : 0 };
      return add([j], 'Structural Joint', `${st.joint.kind.toUpperCase()} JOINT added${st.joint.kind === 'expansion' ? ' — the slab is split in 3D' : ''}.`);
    }
    case 'load': {
      const unit = LOAD_UNITS[units][st.load.kind];
      const mk = (pts: Point[]): LoadEntity => ({ id: nid('ld'), type: 'load', layer: 'S-ANLY', levelId, kind: st.load.kind, points: pts, value: st.load.value, unit });
      if (st.load.kind === 'point') return add([mk([point])], 'Point Load', `POINT LOAD ${st.load.value} ${unit} placed.`);
      if (st.load.kind === 'line') {
        if (drawingPoints.length === 0) return { drawingPoints: [point], log: { text: 'LINE LOAD: pick the end point.', kind: 'info' } };
        return add([mk([drawingPoints[0], point])], 'Line Load', `LINE LOAD ${st.load.value} ${unit} placed.`);
      }
      if (drawingPoints.length >= 3 && dist(point, drawingPoints[0]) <= tol * 1.5) return finishStructuralPolygon(ctx);
      return { drawingPoints: [...drawingPoints, point], log: { text: `AREA LOAD: ${drawingPoints.length + 1} point(s). Click the first point or press Enter to close.`, kind: 'info' } };
    }
    case 'section': {
      if (drawingPoints.length === 0) return { drawingPoints: [point], log: { text: 'SECTION: pick the end of the cut line (you look to the left of start → end).', kind: 'info' } };
      if (dist(drawingPoints[0], point) < 12) return {};
      const n = ents.filter((e) => e.type === 'section').length + 1;
      const s: SectionEntity = { id: nid('sec'), type: 'section', layer: 'S-GRID', levelId, name: `Section ${n}`, start: drawingPoints[0], end: point, depth: 240 };
      return { ...add([s], 'Section', `SECTION ${n} created — opening the section view.`), openSectionId: s.id };
    }
    case 'truss': {
      const t = st.truss;
      // one click inside a room → across its short span; otherwise two clicks bearing to bearing
      let span: { start: Point; end: Point } | null = null;
      if (drawingPoints.length === 0) {
        // under a roof: span the whole footprint square to its ridge; otherwise the room's short span
        const roofHere = ents.find((e): e is RoofEntity => e.type === 'roof' && pointInPolygon(raw, e.polygon));
        if (roofHere) {
          const g = getRoofGeometry(roofHere, levelElevationOf(model, roofHere.levelId));
          const ridges = g.lines.filter((l) => l.kind === 'ridge').sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y));
          if (ridges.length) {
            const rd = { x: ridges[0].b.x - ridges[0].a.x, y: ridges[0].b.y - ridges[0].a.y };
            const L0 = Math.hypot(rd.x, rd.y) || 1;
            span = spanAcross(raw, { x: -rd.y / L0, y: rd.x / L0 }, roofHere.polygon);
          }
        }
        const room = span ? null : findEnclosedRoomAtPoint(raw, ents.filter((e): e is WallEntity => e.type === 'wall' && onLevel(e, levelId)));
        if (room) span = trussSpanThrough(raw, room.polygon);
        if (!span) return { drawingPoints: [point], log: { text: 'TRUSS: click the second bearing point.', kind: 'info' } };
      } else {
        if (dist(drawingPoints[0], point) < 24) return {};
        span = { start: drawingPoints[0], end: point };
      }
      // bearing height: top of the walls the truss lands on (default 9'-0")
      const walls = ents.filter((e): e is WallEntity => e.type === 'wall' && onLevel(e, levelId));
      const near = walls.filter((w) => distToSeg(span!.start, w.start, w.end).d < w.thickness + 6 || distToSeg(span!.end, w.start, w.end).d < w.thickness + 6);
      const bearingZ = near.length ? Math.max(...near.map((w) => (w.baseOffset || 0) + (w.height || 108))) : 108;
      // under a roof: follow its pitch
      const midP = { x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 };
      const overRoof = ents.find((e): e is RoofEntity => e.type === 'roof' && pointInPolygon(midP, e.polygon) && (e.roofStyle || 'gable') !== 'flat');
      const pitch = overRoof && overRoof.slope > 3 ? overRoof.slope : t.pitch;
      const d = { x: (span.end.x - span.start.x), y: (span.end.y - span.start.y) };
      const L = Math.hypot(d.x, d.y) || 1;
      const n = { x: -d.y / L, y: d.x / L };
      const list: TrussEntity[] = [];
      const count = Math.max(1, Math.round(t.count));
      for (let i = 0; i < count; i++) {
        const k = (i - (count - 1) / 2) * t.spacing;
        list.push({
          id: nid('truss'), type: 'truss', layer: 'S-BEAM', levelId,
          start: { x: span.start.x + n.x * k, y: span.start.y + n.y * k }, end: { x: span.end.x + n.x * k, y: span.end.y + n.y * k },
          style: t.style, pitch, memberWidth: t.memberWidth, memberDepth: t.memberDepth,
          // under a roof the top chord's upper edge meets the roof underside
          bearingZ: overRoof ? bearingZ - (t.memberDepth / 2) / Math.cos((pitch * Math.PI) / 180) : bearingZ,
          overhang: t.overhang,
          structuralMaterialId: t.materialId, tailCut: t.tailCut,
        });
      }
      const style = TRUSS_STYLES.find((x) => x.id === t.style)?.label || t.style;
      return add(list, `Place ${style} Truss${count > 1 ? 'es' : ''}`, `TRUSS: ${count} ${style} truss${count > 1 ? 'es' : ''} placed (span ${formatLength(L, units)}, bearing at ${formatLength(bearingZ, units)}).`);
    }
    case 'kneebrace': {
      // the post may belong to this level or run up from the level below (beams at its top)
      let col = columnAt(model, raw, levelId, tol);
      if (!col) {
        for (const c of ents) {
          if (c.type !== 'column') continue;
          const zr = columnZRange(model, c);
          const lz = levelElevationOf(model, levelId);
          if (zr.z1 >= lz - 1 && zr.z0 <= lz + 1 && dist(raw, c.position) <= Math.max(c.width, c.depth) / 2 + tol) col = c;
        }
      }
      if (!col) return { log: { text: 'KNEE BRACE: click a timber post (column) where beams frame in.', kind: 'error' } };
      const zr = columnZRange(model, col);
      const lvZ = levelElevationOf(model, col.levelId || 'level-1');
      const beams = ents
        .filter((e): e is BeamEntity => e.type === 'beam' && (e.usage === 'beam' || e.usage === 'ridge' || e.usage === 'purlin'))
        .map((b) => {
          const ax = beamAxis(model, b);
          return { beam: b, a: ax.start, b: ax.end, soffitZ: beamVertical(model, b, col!.position).zBot };
        })
        .filter((x) => x.soffitZ <= zr.z1 + 1 && x.soffitZ >= zr.z0 + st.knee.leg);
      const braces = kneeBracesFor(col, beams, lvZ, st.knee);
      if (!braces.length) return { log: { text: 'KNEE BRACE: no beam frames into that post (draw beams to it first).', kind: 'error' } };
      return add(braces, `Knee Braces (${braces.length})`, `KNEE BRACE: ${braces.length} ${st.knee.curved ? 'curved' : 'straight'} brace(s) added with mortise-and-tenon pegs.`);
    }
    case 'roofframing': {
      const roof = ents.find((e): e is RoofEntity => e.type === 'roof' && onLevel(e, levelId) && pointInPolygon(raw, offsetRoofOutline(e)));
      const anyRoof = roof || ents.find((e): e is RoofEntity => e.type === 'roof' && pointInPolygon(raw, offsetRoofOutline(e)));
      if (!anyRoof) return { log: { text: 'TIMBER ROOF FRAMING: click inside a roof outline.', kind: 'error' } };
      const members = roofTimberFraming(model, anyRoof, st.roofFraming, (id) => profileById(id));
      if (!members.length) return { log: { text: 'TIMBER ROOF FRAMING: that roof has no sloped faces to frame.', kind: 'error' } };
      const cnt = (u: string) => members.filter((m) => m.usage === u).length;
      return add(members, 'Timber Roof Framing', `TIMBER ROOF FRAMING: ${cnt('ridge')} ridge beam(s), ${cnt('purlin')} purlins, ${cnt('rafter')} rafters with ${st.roofFraming.tail} tails.`);
    }
    default:
      return {};
  }
}

/** Line through p in direction d clipped to a polygon (the truss bearings). */
function spanAcross(p: Point, d: Point, poly: Point[]): { start: Point; end: Point } | null {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = { x: a.x - p.x, y: a.y - p.y };
    const t = (w.x * e.y - w.y * e.x) / den;
    const u = (w.x * d.y - w.y * d.x) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  ts.sort((x, y) => x - y);
  return { start: { x: p.x + d.x * ts[0], y: p.y + d.y * ts[0] }, end: { x: p.x + d.x * ts[ts.length - 1], y: p.y + d.y * ts[ts.length - 1] } };
}

/** Plan outline of a roof (polygon + overhang) for picking. */
function offsetRoofOutline(r: RoofEntity): Point[] {
  return r.polygon;
}

/** Closes polygon tools (foundation slab sketch, area load) — click on the first point or Enter. */
export function finishStructuralPolygon(ctx: StructClickContext): StructClickResult {
  const pts = ctx.drawingPoints;
  if (pts.length < 3) return { log: { text: 'Need at least 3 points.', kind: 'error' } };
  if (ctx.tool === 'foundationslab') {
    const f = newSlab(ctx, pts);
    return { entities: [...ctx.model.entities, f], label: 'Foundation Slab', select: [f.id], drawingPoints: [], log: { text: 'FOUNDATION SLAB created from the sketch.', kind: 'result' } };
  }
  if (ctx.tool === 'load') {
    const unit = LOAD_UNITS[ctx.model.settings.units].area;
    const l: LoadEntity = { id: nid('ld'), type: 'load', layer: 'S-ANLY', levelId: ctx.levelId, kind: 'area', points: pts, value: ctx.st.load.value, unit };
    return { entities: [...ctx.model.entities, l], label: 'Area Load', select: [l.id], drawingPoints: [], log: { text: `AREA LOAD ${l.value} ${unit} placed.`, kind: 'result' } };
  }
  return {};
}

function adaptPlacement(host: ArchEntity, p: RebarPlacement): RebarPlacement {
  if (host.type === 'column') return p === 'tie' || p === 'stirrup' ? 'tie' : 'vertical';
  if (host.type === 'beam') return p === 'x' || p === 'y' ? 'bottom' : p === 'vertical' ? 'side' : p === 'tie' ? 'stirrup' : p;
  if (host.type === 'wall') return p === 'vertical' || p === 'y' ? 'vertical' : 'x';
  // footings & slabs
  if (p === 'top') return 'top';
  if (p === 'y') return 'y';
  return 'x';
}

function supportAt(model: ArchModel, b: BeamEntity, end: Point, levelId: string): ColumnEntity | BeamEntity | null {
  for (const c of model.entities) {
    if (c.type === 'column' && (onLevel(c, levelId) || c.topLevelId === levelId) && dist(c.position, end) <= Math.max(18, ...columnFootprint(c).map((q) => dist(q, c.position) + 3))) return c;
  }
  for (const o of model.entities) {
    if (o.type === 'beam' && o.id !== b.id && onLevel(o, levelId) && distToSeg(end, o.start, o.end).d < 8) return o;
  }
  return null;
}

// ============================================================================================
// SELECTION ACTIONS
// ============================================================================================

export interface ActionResult {
  entities?: ArchEntity[];
  model?: Partial<ArchModel>;
  label?: string;
  log: { text: string; kind: 'info' | 'result' | 'error' };
  select?: string[];
}

/** FT with a selection: one footing under each selected column (or every column on a selected grid). */
export function footingsUnderSelection(model: ArchModel, selectedIds: string[], st: StructToolState, kind: 'isolated' | 'pilecap' = 'isolated'): ActionResult {
  const sel = model.entities.filter((e) => selectedIds.includes(e.id));
  let cols = sel.filter((e): e is ColumnEntity => e.type === 'column');
  for (const g of sel.filter((e): e is GridEntity => e.type === 'grid')) {
    cols = cols.concat(model.entities.filter((c): c is ColumnEntity => c.type === 'column' && distToSeg(c.position, g.start, g.end).d < 6));
  }
  cols = cols.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i && !model.entities.some((f) => f.type === 'footing' && f.columnId === c.id));
  if (!cols.length) return { log: { text: 'FOOTING: select columns (or a grid line) without footings first.', kind: 'error' } };
  const fts = cols.map((c) => footingForColumn(model, c, st, kind));
  return { entities: [...model.entities, ...fts], label: `Footings under ${fts.length} column(s)`, select: fts.map((f) => f.id), log: { text: `Placed ${fts.length} ${kind === 'pilecap' ? 'pile cap(s)' : 'footing(s)'} under the selected column(s).`, kind: 'result' } };
}

export function wallFootingsUnderSelection(model: ArchModel, selectedIds: string[], st: StructToolState): ActionResult {
  const walls = model.entities.filter((w): w is WallEntity => w.type === 'wall' && selectedIds.includes(w.id) && !model.entities.some((f) => f.type === 'footing' && f.wallId === w.id));
  if (!walls.length) return { log: { text: 'WALL FOOTING: select walls without footings first (or click walls with WF).', kind: 'error' } };
  const fts = walls.map((w) => wallFootingFor(model, w, st));
  return { entities: [...model.entities, ...fts], label: `Wall footings (${fts.length})`, select: fts.map((f) => f.id), log: { text: `Placed ${fts.length} wall footing(s).`, kind: 'result' } };
}

export function applyRebarPreset(model: ArchModel, hostId: string): ActionResult {
  const host = rebarHostOf(model, hostId);
  if (!host) return { log: { text: 'Quick presets need a concrete host (footing, column, beam, slab or wall).', kind: 'error' } };
  const preset = REBAR_PRESETS.find((p) => p.hostKinds.includes(host.kind));
  if (!preset) return { log: { text: 'No preset for this host.', kind: 'error' } };
  const ent = model.entities.find((e) => e.id === hostId)!;
  const sets = preset.make(model, hostId, ent.levelId);
  return { entities: [...model.entities, ...sets], label: `Rebar preset: ${preset.label}`, log: { text: `Rebar preset applied: ${preset.label}.`, kind: 'result' } };
}

function selectedPair(model: ArchModel, selectedIds: string[]): [string, string] | null {
  const members = selectedIds.filter((id) => {
    const e = model.entities.find((x) => x.id === id);
    return e && ['beam', 'column', 'wall', 'floor', 'footing'].includes(e.type);
  });
  return members.length >= 2 ? [members[0], members[1]] : null;
}

export function joinAction(model: ArchModel, selectedIds: string[], action: 'join' | 'unjoin' | 'switch'): ActionResult {
  const pair = selectedPair(model, selectedIds);
  if (!pair) return { log: { text: `${action === 'join' ? 'JOIN GEOMETRY (JG)' : action === 'unjoin' ? 'UNJOIN (UJ)' : 'SWITCH JOIN ORDER (SWJ)'}: select two structural elements first.`, kind: 'error' } };
  const key = pairKey(pair[0], pair[1]);
  const j = model.structureJoins || { unjoined: [], switched: [] };
  let next = j;
  if (action === 'join') next = { ...j, unjoined: j.unjoined.filter((k) => k !== key) };
  else if (action === 'unjoin') next = { ...j, unjoined: Array.from(new Set([...j.unjoined, key])) };
  else next = { ...j, switched: j.switched.includes(key) ? j.switched.filter((k) => k !== key) : [...j.switched, key] };
  const verb = action === 'join' ? 'Joined' : action === 'unjoin' ? 'Unjoined' : 'Switched join order of';
  return { model: { structureJoins: next }, label: `${verb} geometry`, log: { text: `${verb} the two selected elements.`, kind: 'result' } };
}

export function connectionFromSelection(model: ArchModel, selectedIds: string[], kind: SteelConnectionKind): ActionResult {
  const sel = model.entities.filter((e) => selectedIds.includes(e.id) && (e.type === 'beam' || e.type === 'column'));
  if (kind === 'base-plate') {
    const cols = sel.filter((c) => c.type === 'column');
    if (!cols.length) return { log: { text: 'BASE PLATE: select a steel column.', kind: 'error' } };
    const cs = cols.map((c) => ({ id: nid('cn'), type: 'connection', layer: 'S-BEAM', levelId: c.levelId, kind, memberIds: [c.id] }) as ConnectionEntity);
    return { entities: [...model.entities, ...cs], label: 'Base plate', log: { text: `Added ${cs.length} base plate(s).`, kind: 'result' } };
  }
  if (sel.length < 2 || !sel.some((s) => s.type === 'beam')) return { log: { text: 'CONNECTION (CN): select a beam and its supporting column or beam.', kind: 'error' } };
  const beam = sel.find((s) => s.type === 'beam')!;
  const other = sel.find((s) => s.id !== beam.id)!;
  const cn: ConnectionEntity = { id: nid('cn'), type: 'connection', layer: 'S-BEAM', levelId: beam.levelId, kind, memberIds: [beam.id, other.id], bolts: 3 };
  return { entities: [...model.entities, cn], label: 'Connection', select: [cn.id], log: { text: `CONNECTION (${kind}) added.`, kind: 'result' } };
}

/** Columns' tops attach to the selected beam (column top = beam underside). */
export function attachColumnTopToBeam(model: ArchModel, selectedIds: string[]): ActionResult {
  const beam = model.entities.find((e): e is BeamEntity => e.type === 'beam' && selectedIds.includes(e.id));
  const cols = model.entities.filter((e): e is ColumnEntity => e.type === 'column' && selectedIds.includes(e.id));
  if (!beam || !cols.length) return { log: { text: 'Select one beam and the column(s) to attach to it.', kind: 'error' } };
  return {
    entities: model.entities.map((e) => (e.type === 'column' && selectedIds.includes(e.id) ? { ...e, topBeamId: beam.id, topLevelId: undefined } : e)),
    label: 'Attach column top to beam',
    log: { text: `Attached ${cols.length} column top(s) to the beam.`, kind: 'result' },
  };
}

export { beamPlanOutline };
