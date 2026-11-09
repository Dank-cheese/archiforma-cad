/**
 * STRUCTURE ENGINE (pure functions, no UI / three.js).
 *
 * Material + section catalogs, member geometry (columns, beams, braces, joists, footings),
 * automatic joins (beam cut back at column faces, clean concrete outlines), lintels,
 * rebar layout with cover clipping, area reinforcement, expansion-joint slab splitting,
 * the analytical model, simple warnings and the structural schedules.
 *
 * Units: model inches. Plan points use the app's SVG convention (+Y down); z is up.
 *
 * For design visualization and coordination only — not a substitute for engineering by a
 * licensed structural engineer.
 */
import type {
  WallOpeningEntity,
  AreaReinforcementEntity,
  ArchEntity,
  ArchModel,
  BeamEntity,
  BeamSystemEntity,
  ColumnEntity,
  ConnectionEntity,
  DoorEntity,
  FloorEntity,
  FootingEntity,
  LoadEntity,
  Point,
  RebarCover,
  RebarEntity,
  RebarLayoutRule,
  RebarShape,
  StructuralJointEntity,
  WallEntity,
  WindowEntity,
} from '../types/model';
import { offsetPolygon, pointInPolygon, signedArea, type P3 } from './roof';

export const STRUCTURAL_DISCLAIMER =
  'For design visualization and coordination only — not a substitute for engineering by a licensed structural engineer.';

// ============================================================================================
// small vector helpers
// ============================================================================================

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const len = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Point): Point => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
const perp = (a: Point): Point => ({ x: -a.y, y: a.x });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const p3 = (p: Point, z: number): P3 => ({ x: p.x, y: p.y, z });
const add3 = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul3 = (a: P3, k: number): P3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len3 = (a: P3) => Math.hypot(a.x, a.y, a.z);
const sub3 = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm3 = (a: P3): P3 => {
  const l = len3(a);
  return l > 1e-12 ? mul3(a, 1 / l) : { x: 0, y: 0, z: 1 };
};
export const polylineLength3 = (pts: P3[]) => pts.reduce((s, p, i) => (i ? s + len3(sub3(p, pts[i - 1])) : s), 0);

/** SVG-style rotate(-deg) of a local point (matches how the app draws rotated columns). */
function rotLocal(p: Point, deg: number): Point {
  const a = (-deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

export function levelElevationOf(model: Pick<ArchModel, 'levels'>, levelId?: string): number {
  const lvl = (model.levels || []).find((l) => l.id === (levelId || 'level-1'));
  return lvl ? lvl.elevation : 0;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ============================================================================================
// MATERIALS
// ============================================================================================

export type MaterialFamily = 'concrete' | 'steel' | 'wood' | 'masonry';
export type MaterialPattern = 'stipple' | 'solid' | 'grain' | 'cmu';

export interface StructuralMaterial {
  id: string;
  label: string;
  family: MaterialFamily;
  grade: string;
  color: string;
  pattern: MaterialPattern;
}

export const STRUCTURAL_MATERIALS: StructuralMaterial[] = [
  { id: 'conc-3000', label: "Concrete f'c 3000 psi", family: 'concrete', grade: '3000 psi', color: '#b8b5ae', pattern: 'stipple' },
  { id: 'conc-4000', label: "Concrete f'c 4000 psi", family: 'concrete', grade: '4000 psi', color: '#aeaba4', pattern: 'stipple' },
  { id: 'conc-5000', label: "Concrete f'c 5000 psi", family: 'concrete', grade: '5000 psi', color: '#a4a19a', pattern: 'stipple' },
  { id: 'conc-c25', label: 'Concrete C25/30', family: 'concrete', grade: 'C25', color: '#b8b5ae', pattern: 'stipple' },
  { id: 'conc-c30', label: 'Concrete C30/37', family: 'concrete', grade: 'C30', color: '#aeaba4', pattern: 'stipple' },
  { id: 'conc-c35', label: 'Concrete C35/45', family: 'concrete', grade: 'C35', color: '#a4a19a', pattern: 'stipple' },
  { id: 'a992', label: 'Steel ASTM A992', family: 'steel', grade: 'A992', color: '#4b6b8a', pattern: 'solid' },
  { id: 'a36', label: 'Steel ASTM A36', family: 'steel', grade: 'A36', color: '#56708a', pattern: 'solid' },
  { id: 'spf2', label: 'Wood SPF #2', family: 'wood', grade: 'SPF No.2', color: '#d9b77e', pattern: 'grain' },
  { id: 'df', label: 'Wood Douglas Fir-Larch #1', family: 'wood', grade: 'DF-L No.1', color: '#c99a5e', pattern: 'grain' },
  { id: 'lvl', label: 'Wood LVL 2.0E', family: 'wood', grade: 'LVL 2.0E', color: '#d6a35f', pattern: 'grain' },
  { id: 'glulam', label: 'Wood Glulam 24F-V4', family: 'wood', grade: '24F-V4', color: '#c48a4a', pattern: 'grain' },
  { id: 'cmu', label: 'CMU (grouted masonry)', family: 'masonry', grade: "f'm 2000 psi", color: '#9c9890', pattern: 'cmu' },
  // heavy timber & log species (cabins, timber frames, chalets)
  { id: 'doug-fir', label: 'Douglas Fir (timber)', family: 'wood', grade: 'DF-L Select Structural', color: '#c58f55', pattern: 'grain' },
  { id: 'wrc', label: 'Western Red Cedar', family: 'wood', grade: 'WRC No.1', color: '#a4623d', pattern: 'grain' },
  { id: 'white-pine', label: 'Eastern White Pine', family: 'wood', grade: 'EWP Select', color: '#e0c08a', pattern: 'grain' },
  { id: 'barn-oak', label: 'Reclaimed Barn Oak', family: 'wood', grade: 'Reclaimed', color: '#7d5a3c', pattern: 'grain' },
  { id: 'pine-log', label: 'Pine Log (peeled)', family: 'wood', grade: 'Log grade', color: '#d2a86b', pattern: 'grain' },
  { id: 'cedar-log', label: 'Cedar Log (peeled)', family: 'wood', grade: 'Log grade', color: '#b07a4e', pattern: 'grain' },
];

/** Display colour of a wood species (3D, plan fill). */
export const woodColor = (materialId?: string) => materialById(materialId).color;

export const materialById = (id?: string): StructuralMaterial =>
  STRUCTURAL_MATERIALS.find((m) => m.id === id) || STRUCTURAL_MATERIALS[1];

export const isConcrete = (id?: string) => materialById(id).family === 'concrete';

export function defaultConcreteId(model: Pick<ArchModel, 'settings'>): string {
  return model.settings?.units === 'metric' ? 'conc-c30' : 'conc-4000';
}

/** Structural material of a wall: explicit, else from its wall type. */
export function wallStructuralMaterialId(wall: WallEntity): string {
  if (wall.structuralMaterialId) return wall.structuralMaterialId;
  if (wall.wallTypeId === 'wt-conc-8') return 'conc-4000';
  if (wall.wallTypeId === 'wt-cmu-8') return 'cmu';
  return 'spf2';
}

// ============================================================================================
// SECTION PROFILES
// ============================================================================================

export type ProfileKind = 'rect' | 'round' | 'W' | 'C' | 'L' | 'HSS-rect' | 'HSS-round';

export interface SectionProfile {
  id: string;
  label: string;
  kind: ProfileKind;
  family: MaterialFamily;
  d: number;   // depth (inches)
  bf: number;  // width
  tw?: number;
  tf?: number;
  t?: number;  // wall / leg thickness (HSS, L)
  weight?: number; // lb/ft (steel)
  use: Array<'column' | 'beam'>;
  /** hand-hewn timber: slightly irregular chamfered edges in 3D / section */
  hewn?: boolean;
  /** catalog group shown in pickers */
  group?: string;
}

const W = (id: string, d: number, bf: number, tw: number, tf: number, weight: number, use: Array<'column' | 'beam'>): SectionProfile => ({ id, label: id, kind: 'W', family: 'steel', d, bf, tw, tf, weight, use });

export const STEEL_PROFILES: SectionProfile[] = [
  W('W8x10', 7.89, 3.94, 0.17, 0.205, 10, ['beam']),
  W('W8x18', 8.14, 5.25, 0.23, 0.33, 18, ['beam']),
  W('W8x31', 8.0, 8.0, 0.285, 0.435, 31, ['column', 'beam']),
  W('W10x22', 10.2, 5.75, 0.24, 0.36, 22, ['beam']),
  W('W10x33', 9.73, 7.96, 0.29, 0.435, 33, ['column', 'beam']),
  W('W12x26', 12.2, 6.49, 0.23, 0.38, 26, ['beam']),
  W('W12x40', 11.9, 8.01, 0.295, 0.515, 40, ['column', 'beam']),
  W('W14x30', 13.8, 6.73, 0.27, 0.385, 30, ['beam']),
  W('W14x48', 13.8, 8.03, 0.34, 0.595, 48, ['column', 'beam']),
  W('W16x31', 15.9, 5.53, 0.275, 0.44, 31, ['beam']),
  W('W16x40', 16.0, 7.0, 0.305, 0.505, 40, ['beam']),
  W('W18x35', 17.7, 6.0, 0.3, 0.425, 35, ['beam']),
  W('W18x50', 18.0, 7.5, 0.355, 0.57, 50, ['beam']),
  W('W21x44', 20.7, 6.5, 0.35, 0.45, 44, ['beam']),
  W('W24x55', 23.6, 7.01, 0.395, 0.505, 55, ['beam']),
  { id: 'C8x11.5', label: 'C8x11.5', kind: 'C', family: 'steel', d: 8, bf: 2.26, tw: 0.22, tf: 0.39, weight: 11.5, use: ['beam'] },
  { id: 'C10x15.3', label: 'C10x15.3', kind: 'C', family: 'steel', d: 10, bf: 2.6, tw: 0.24, tf: 0.436, weight: 15.3, use: ['beam'] },
  { id: 'C12x20.7', label: 'C12x20.7', kind: 'C', family: 'steel', d: 12, bf: 2.94, tw: 0.282, tf: 0.501, weight: 20.7, use: ['beam'] },
  { id: 'L4x4x3/8', label: 'L4x4x3/8', kind: 'L', family: 'steel', d: 4, bf: 4, t: 0.375, weight: 9.8, use: ['beam'] },
  { id: 'L6x4x1/2', label: 'L6x4x1/2', kind: 'L', family: 'steel', d: 6, bf: 4, t: 0.5, weight: 16.2, use: ['beam'] },
  { id: 'HSS4x4x1/4', label: 'HSS4x4x1/4', kind: 'HSS-rect', family: 'steel', d: 4, bf: 4, t: 0.233, weight: 12.2, use: ['column', 'beam'] },
  { id: 'HSS6x6x3/8', label: 'HSS6x6x3/8', kind: 'HSS-rect', family: 'steel', d: 6, bf: 6, t: 0.349, weight: 27.5, use: ['column', 'beam'] },
  { id: 'HSS8x8x1/2', label: 'HSS8x8x1/2', kind: 'HSS-rect', family: 'steel', d: 8, bf: 8, t: 0.465, weight: 48.9, use: ['column'] },
  { id: 'HSS6.625x0.280', label: 'HSS6.625x0.280', kind: 'HSS-round', family: 'steel', d: 6.625, bf: 6.625, t: 0.26, weight: 19.0, use: ['column'] },
  { id: 'HSS8.625x0.322', label: 'HSS8.625x0.322', kind: 'HSS-round', family: 'steel', d: 8.625, bf: 8.625, t: 0.3, weight: 28.6, use: ['column'] },
];

export const WOOD_PROFILES: SectionProfile[] = [
  { id: '2x8', label: '2x8', kind: 'rect', family: 'wood', d: 7.25, bf: 1.5, use: ['beam'] },
  { id: '2x10', label: '2x10', kind: 'rect', family: 'wood', d: 9.25, bf: 1.5, use: ['beam'] },
  { id: '2x12', label: '2x12', kind: 'rect', family: 'wood', d: 11.25, bf: 1.5, use: ['beam'] },
  { id: 'LVL-1.75x11.875', label: 'LVL 1-3/4" x 11-7/8"', kind: 'rect', family: 'wood', d: 11.875, bf: 1.75, use: ['beam'] },
  { id: 'LVL-3.5x11.875', label: 'LVL 3-1/2" x 11-7/8" (2-ply)', kind: 'rect', family: 'wood', d: 11.875, bf: 3.5, use: ['beam'] },
  { id: 'GLB-5.125x12', label: 'Glulam 5-1/8" x 12"', kind: 'rect', family: 'wood', d: 12, bf: 5.125, use: ['beam'] },
  { id: 'GLB-5.125x18', label: 'Glulam 5-1/8" x 18"', kind: 'rect', family: 'wood', d: 18, bf: 5.125, use: ['beam'] },
  { id: '6x6', label: '6x6 post', kind: 'rect', family: 'wood', d: 5.5, bf: 5.5, use: ['column'] },
  { id: '8x8', label: '8x8 post', kind: 'rect', family: 'wood', d: 7.5, bf: 7.5, use: ['column'] },
  { id: 'GLC-6.75x6.75', label: 'Glulam column 6-3/4" x 6-3/4"', kind: 'rect', family: 'wood', d: 6.75, bf: 6.75, use: ['column'] },
  // ---- heavy timber (hand-hewn square timbers: full-size dimensions)
  ...([[6, 8], [8, 8], [8, 10], [8, 12], [10, 12], [12, 12]] as Array<[number, number]>).map(
    ([b, d]): SectionProfile => ({ id: `HT-${b}x${d}`, label: `Hand-hewn timber ${b}x${d}`, kind: 'rect', family: 'wood', d, bf: b, use: ['beam', 'column'], hewn: true, group: 'Heavy timber' })
  ),
  // ---- peeler-core / full-scribe round logs
  ...[8, 10, 12, 14].map((dia): SectionProfile => ({ id: `LOG-${dia}`, label: `Round log ${dia}" dia.`, kind: 'round', family: 'wood', d: dia, bf: dia, use: ['beam', 'column'], group: 'Round logs' })),
  // ---- glulam (straight or cambered)
  { id: 'GLB-3.125x12', label: 'Glulam 3-1/8" x 12"', kind: 'rect', family: 'wood', d: 12, bf: 3.125, use: ['beam'], group: 'Glulam' },
  { id: 'GLB-5.125x15', label: 'Glulam 5-1/8" x 15"', kind: 'rect', family: 'wood', d: 15, bf: 5.125, use: ['beam'], group: 'Glulam' },
  { id: 'GLB-6.75x18', label: 'Glulam 6-3/4" x 18"', kind: 'rect', family: 'wood', d: 18, bf: 6.75, use: ['beam'], group: 'Glulam' },
  // ---- rafters / purlins
  { id: '4x8', label: 'Timber rafter 4x8', kind: 'rect', family: 'wood', d: 7.5, bf: 3.5, use: ['beam'], group: 'Rafters' },
  { id: '4x10', label: 'Timber rafter 4x10', kind: 'rect', family: 'wood', d: 9.25, bf: 3.5, use: ['beam'], group: 'Rafters' },
  { id: '6x6-brace', label: 'Knee brace 6x6', kind: 'rect', family: 'wood', d: 5.5, bf: 5.5, use: ['beam'], group: 'Braces', hewn: true },
];

export const ALL_PROFILES = [...STEEL_PROFILES, ...WOOD_PROFILES];
export const profileById = (id?: string) => (id ? ALL_PROFILES.find((p) => p.id === id) : undefined);

export function profilesFor(family: MaterialFamily, use: 'column' | 'beam'): SectionProfile[] {
  return ALL_PROFILES.filter((p) => p.family === family && p.use.includes(use));
}

/** Effective section of a member: catalog profile for steel/wood, else a concrete rectangle or circle. */
export function memberSection(materialId: string | undefined, profileId: string | undefined, width: number, depth: number, round = false): SectionProfile {
  const fam = materialById(materialId).family;
  const prof = profileById(profileId);
  if (prof && (fam === 'steel' || fam === 'wood') && prof.family === fam) return prof;
  if (fam === 'steel') return STEEL_PROFILES.find((p) => p.id === 'W12x26')!;
  if (round) return { id: `round-${width}`, label: `${fmtIn(width)} dia.`, kind: 'round', family: fam, d: width, bf: width, use: ['column'] };
  return { id: `rect-${width}x${depth}`, label: `${fmtIn(width)} x ${fmtIn(depth)}`, kind: 'rect', family: fam, d: depth, bf: width, use: ['column', 'beam'] };
}

const fmtIn = (v: number) => `${Math.round(v * 100) / 100}"`;

/** Section outline centred on the origin: x across (bf), y up (d). Holes for hollow sections. */
export function profileOutline(sec: SectionProfile): { outer: Point[]; holes: Point[][] } {
  const { d, bf } = sec;
  const h = d / 2;
  const b = bf / 2;
  const circle = (r: number, n = 24) => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));
  if (sec.kind === 'rect' && sec.hewn) {
    // hand-hewn: chamfered (slightly irregular) edges
    const c = Math.min(0.9, Math.min(b, h) * 0.18);
    return {
      outer: [
        { x: -b + c, y: -h }, { x: b - c * 0.8, y: -h }, { x: b, y: -h + c * 0.9 }, { x: b, y: h - c }, { x: b - c * 1.1, y: h },
        { x: -b + c * 0.9, y: h }, { x: -b, y: h - c * 0.8 }, { x: -b, y: -h + c * 1.1 },
      ],
      holes: [],
    };
  }
  switch (sec.kind) {
    case 'W': {
      const tw = (sec.tw || 0.3) / 2;
      const tf = sec.tf || 0.4;
      return {
        outer: [
          { x: -b, y: h }, { x: b, y: h }, { x: b, y: h - tf }, { x: tw, y: h - tf }, { x: tw, y: -h + tf }, { x: b, y: -h + tf },
          { x: b, y: -h }, { x: -b, y: -h }, { x: -b, y: -h + tf }, { x: -tw, y: -h + tf }, { x: -tw, y: h - tf }, { x: -b, y: h - tf },
        ],
        holes: [],
      };
    }
    case 'C': {
      const tw = sec.tw || 0.25;
      const tf = sec.tf || 0.4;
      return {
        outer: [{ x: -b, y: h }, { x: b, y: h }, { x: b, y: h - tf }, { x: -b + tw, y: h - tf }, { x: -b + tw, y: -h + tf }, { x: b, y: -h + tf }, { x: b, y: -h }, { x: -b, y: -h }],
        holes: [],
      };
    }
    case 'L': {
      const t = sec.t || 0.375;
      return { outer: [{ x: -b, y: -h }, { x: b, y: -h }, { x: b, y: -h + t }, { x: -b + t, y: -h + t }, { x: -b + t, y: h }, { x: -b, y: h }], holes: [] };
    }
    case 'HSS-rect': {
      const t = sec.t || 0.25;
      return {
        outer: [{ x: -b, y: -h }, { x: b, y: -h }, { x: b, y: h }, { x: -b, y: h }],
        holes: [[{ x: -b + t, y: -h + t }, { x: -b + t, y: h - t }, { x: b - t, y: h - t }, { x: b - t, y: -h + t }]],
      };
    }
    case 'HSS-round':
      return { outer: circle(h), holes: [circle(h - (sec.t || 0.25)).reverse()] };
    case 'round':
      return { outer: circle(h), holes: [] };
    default:
      return { outer: [{ x: -b, y: -h }, { x: b, y: -h }, { x: b, y: h }, { x: -b, y: h }], holes: [] };
  }
}

// ============================================================================================
// COLUMNS
// ============================================================================================

export function columnMaterialId(col: ColumnEntity): string {
  if (col.structuralMaterialId) return col.structuralMaterialId;
  const t = col.columnTypeId || '';
  if (/steel/.test(t)) return 'a992';
  if (/timber|wood/.test(t)) return 'df';
  return 'conc-4000';
}

export function columnSection(col: ColumnEntity): SectionProfile {
  return memberSection(columnMaterialId(col), col.profileId, col.width, col.depth, col.shape === 'round');
}

/** Plan outline of a column (world coordinates). */
export function columnPlanOutline(col: ColumnEntity): { outer: Point[]; holes: Point[][] } {
  const o = profileOutline(columnSection(col));
  const tr = (p: Point) => add(col.position, rotLocal({ x: p.x, y: -p.y }, col.rotation || 0));
  return { outer: o.outer.map(tr), holes: o.holes.map((h) => h.map(tr)) };
}

/** Bounding rectangle of a column footprint (used for joins and cut-backs). */
export function columnFootprint(col: ColumnEntity): Point[] {
  const sec = columnSection(col);
  if (sec.kind === 'round' || sec.kind === 'HSS-round') return columnPlanOutline(col).outer;
  const b = sec.bf / 2;
  const h = sec.d / 2;
  return [{ x: -b, y: -h }, { x: b, y: -h }, { x: b, y: h }, { x: -b, y: h }].map((p) => add(col.position, rotLocal(p, col.rotation || 0)));
}

/** Bottom and top elevation of a column (absolute z). Top may follow a level or a beam. */
export function columnZRange(model: Pick<ArchModel, 'levels' | 'entities'>, col: ColumnEntity): { z0: number; z1: number } {
  const z0 = levelElevationOf(model, col.levelId) + (col.baseOffset || 0);
  let z1 = z0 + (col.height || 108);
  if (col.topLevelId) z1 = levelElevationOf(model, col.topLevelId) + (col.topOffset || 0);
  if (col.topBeamId) {
    const bm = model.entities.find((e): e is BeamEntity => e.type === 'beam' && e.id === col.topBeamId);
    if (bm) z1 = beamVertical(model, bm, col.position).zBot;
  }
  return { z0, z1: Math.max(z0 + 6, z1) };
}

// ============================================================================================
// BEAMS, BRACES, JOISTS
// ============================================================================================

export function beamSection(b: Pick<BeamEntity, 'structuralMaterialId' | 'profileId' | 'width' | 'depth'>): SectionProfile {
  return memberSection(b.structuralMaterialId, b.profileId, b.width, b.depth);
}

/** Height of the beam reference line at a plan point (braces slope from zStart to zEnd). */
/** Sloped members: braces, rafters (and any member given both end heights). */
export const isSlopedMember = (b: Pick<BeamEntity, 'usage' | 'zStart' | 'zEnd'>) => b.usage === 'brace' || b.usage === 'rafter' || (b.zStart !== undefined && b.zEnd !== undefined);

export function beamRefZ(model: Pick<ArchModel, 'levels'>, b: BeamEntity, at?: Point): number {
  const lv = levelElevationOf(model, b.levelId);
  if (isSlopedMember(b)) {
    const zs = lv + (b.zStart ?? 0);
    const ze = lv + (b.zEnd ?? 108);
    if (!at) return (zs + ze) / 2;
    const L = dist(b.start, b.end) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(at, b.start), sub(b.end, b.start)) / (L * L)));
    return zs + (ze - zs) * t;
  }
  return lv + (b.topOffset || 0);
}

/** Top / bottom of the beam section at a plan point, from its justification. */
export function beamVertical(model: Pick<ArchModel, 'levels'>, b: BeamEntity, at?: Point): { zTop: number; zBot: number; zMid: number } {
  const ref = beamRefZ(model, b, at);
  const d = beamSection(b).d;
  const j = b.usage === 'brace' ? 'center' : b.justification;
  // sloped members (rafters): the section depth is measured square to the member
  if (isSlopedMember(b) && b.usage !== 'brace') {
    const L = dist(b.start, b.end) || 1;
    const slope = Math.abs((b.zEnd ?? 0) - (b.zStart ?? 0)) / L;
    const dv = d * Math.sqrt(1 + slope * slope);
    const zTop = j === 'top' ? ref : j === 'center' ? ref + dv / 2 : ref + dv;
    return { zTop, zBot: zTop - dv, zMid: zTop - dv / 2 };
  }
  const zTop = j === 'top' ? ref : j === 'center' ? ref + d / 2 : ref + d;
  return { zTop, zBot: zTop - d, zMid: zTop - d / 2 };
}

/**
 * Moves `a` (inside `poly`) along a→b to where the segment leaves the polygon: the column face.
 * Returns null when `a` is not inside the polygon.
 */
export function cutBackAtColumnFace(a: Point, b: Point, poly: Point[]): Point | null {
  if (!pointInPolygon(a, poly)) return null;
  const d = sub(b, a);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const e = sub(q, p);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(sub(p, a), e) / den;
    const u = cross(sub(p, a), d) / den;
    if (t > 1e-9 && t <= 1 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? add(a, mul(d, best)) : null;
}

export function joinAllowed(model: Pick<ArchModel, 'structureJoins'>, a: string, b: string): boolean {
  return !(model.structureJoins?.unjoined || []).includes(pairKey(a, b));
}
export function joinSwitched(model: Pick<ArchModel, 'structureJoins'>, a: string, b: string): boolean {
  return (model.structureJoins?.switched || []).includes(pairKey(a, b));
}

export interface BeamAxis {
  start: Point;
  end: Point;
  /** column ids the member was cut back to at its start / end */
  startColumnId?: string;
  endColumnId?: string;
}

/**
 * Physical axis of a beam: the drawn line plus start/end offsets, cut back at column faces
 * (unless that join is turned off or its order switched).
 */
export function beamAxis(model: Pick<ArchModel, 'entities' | 'structureJoins'>, b: BeamEntity): BeamAxis {
  const dir = unit(sub(b.end, b.start));
  let s = add(b.start, mul(dir, -(b.startOffset || 0)));
  let e = add(b.end, mul(dir, b.endOffset || 0));
  const out: BeamAxis = { start: s, end: e };
  if (b.usage === 'brace') return out;
  const cols = model.entities.filter((c): c is ColumnEntity => c.type === 'column' && (c.levelId || 'level-1') === (b.levelId || 'level-1'));
  for (const c of cols) {
    if (!joinAllowed(model, b.id, c.id) || joinSwitched(model, b.id, c.id)) continue;
    const fp = columnFootprint(c);
    const cs = cutBackAtColumnFace(s, e, fp);
    if (cs) {
      s = cs;
      out.startColumnId = c.id;
    }
    const ce = cutBackAtColumnFace(e, s, fp);
    if (ce) {
      e = ce;
      out.endColumnId = c.id;
    }
  }
  out.start = s;
  out.end = e;
  return out;
}

/** Plan outline (rectangle) of a beam, after cut-backs. */
export function beamPlanOutline(model: Pick<ArchModel, 'entities' | 'structureJoins'>, b: BeamEntity): Point[] {
  const ax = beamAxis(model, b);
  const sec = beamSection(b);
  const n = mul(perp(unit(sub(ax.end, ax.start))), sec.bf / 2);
  return [add(ax.start, n), add(ax.end, n), sub(ax.end, n), sub(ax.start, n)];
}

/** Joist lines of a beam system: parallel to `angle`, at `spacing`, clipped to the bay boundary. */
export function beamSystemJoists(bs: BeamSystemEntity): Array<[Point, Point]> {
  if (bs.boundary.length < 3 || bs.spacing <= 0) return [];
  const dir = { x: Math.cos((bs.angle * Math.PI) / 180), y: Math.sin((bs.angle * Math.PI) / 180) };
  const n = perp(dir);
  const proj = bs.boundary.map((p) => dot(p, n));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const offsets: number[] = [];
  for (let o = lo + bs.spacing; o < hi - 0.5; o += bs.spacing) offsets.push(o);
  return scanSegments(bs.boundary, [], dir, offsets);
}

/** Default joist direction for a bay: spanning the short way (perpendicular to the longest edge). */
export function defaultJoistAngle(boundary: Point[]): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const L = dist(a, b);
    if (L > bestLen) {
      bestLen = L;
      best = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    }
  }
  return best + 90;
}

// ============================================================================================
// FOOTINGS
// ============================================================================================

export function footingCenter(f: FootingEntity, entities: ArchEntity[]): Point {
  if (f.columnId) {
    const c = entities.find((e): e is ColumnEntity => e.type === 'column' && e.id === f.columnId);
    if (c) return c.position;
  }
  return f.position;
}

/** Plan outline of a footing (follows its column / wall). */
export function footingPlanOutline(f: FootingEntity, entities: ArchEntity[]): Point[] {
  if (f.kind === 'wall') {
    const w = entities.find((e): e is WallEntity => e.type === 'wall' && e.id === f.wallId);
    if (!w) return [];
    const d = unit(sub(w.end, w.start));
    const n = perp(d);
    const ext = f.width / 2;
    const c0 = add(add(w.start, mul(d, -ext)), mul(n, f.offset || 0));
    const c1 = add(add(w.end, mul(d, ext)), mul(n, f.offset || 0));
    const h = mul(n, f.width / 2);
    return [add(c0, h), add(c1, h), sub(c1, h), sub(c0, h)];
  }
  const c = footingCenter(f, entities);
  const L = f.length / 2;
  const B = f.width / 2;
  return [{ x: -L, y: -B }, { x: L, y: -B }, { x: L, y: B }, { x: -L, y: B }].map((p) => add(c, rotLocal(p, f.rotation || 0)));
}

export function footingZRange(model: Pick<ArchModel, 'levels'>, f: FootingEntity): { zTop: number; zBot: number } {
  const zTop = levelElevationOf(model, f.levelId) + (f.topOffset ?? -12);
  return { zTop, zBot: zTop - Math.max(1, f.thickness) };
}

/** Pile positions of a pile cap (plan) — 1..9 piles in a regular pattern inside the cap. */
export function pilePositions(f: FootingEntity, entities: ArchEntity[]): Point[] {
  const n = Math.max(1, Math.min(9, f.piles?.count ?? 4));
  const c = footingCenter(f, entities);
  const dx = f.length / 2 - Math.max(6, (f.piles?.diameter ?? 12) * 0.9);
  const dy = f.width / 2 - Math.max(6, (f.piles?.diameter ?? 12) * 0.9);
  let local: Point[];
  if (n === 1) local = [{ x: 0, y: 0 }];
  else if (n === 2) local = [{ x: -dx, y: 0 }, { x: dx, y: 0 }];
  else if (n === 3) local = [{ x: -dx, y: dy }, { x: dx, y: dy }, { x: 0, y: -dy }];
  else {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    local = [];
    for (let r = 0; r < rows && local.length < n; r++) {
      for (let k = 0; k < cols && local.length < n; k++) {
        local.push({ x: cols === 1 ? 0 : -dx + (2 * dx * k) / (cols - 1), y: rows === 1 ? 0 : -dy + (2 * dy * r) / (rows - 1) });
      }
    }
  }
  return local.map((p) => add(c, rotLocal(p, f.rotation || 0)));
}

/** Footing size suggestion under a column: square pad 4× the column size, min 3'-0". */
export function suggestFootingForColumn(col: ColumnEntity): { length: number; width: number; thickness: number } {
  const sec = columnSection(col);
  const s = Math.max(36, Math.ceil((Math.max(sec.bf, sec.d) * 4) / 6) * 6);
  return { length: s, width: s, thickness: s >= 60 ? 18 : 12 };
}

// ============================================================================================
// LINTELS / HEADERS
// ============================================================================================

export interface Lintel {
  openingId: string;
  wallId: string;
  label: string;
  depth: number;
  bearing: number;
  s0: number; // along the wall (incl. bearing)
  s1: number;
  zBot: number; // above the wall base
  zTop: number;
  auto: boolean;
}

/** Suggested lintel / header for an opening width in a wall of the given material family. */
export function suggestLintel(openingWidth: number, family: MaterialFamily): { label: string; depth: number; bearing: number } {
  if (family === 'concrete' || family === 'masonry') {
    if (openingWidth <= 48) return { label: family === 'masonry' ? '8x8 CMU lintel' : '8" deep conc. lintel', depth: 8, bearing: 8 };
    if (openingWidth <= 96) return { label: family === 'masonry' ? '8x16 CMU lintel' : '16" deep conc. lintel', depth: 16, bearing: 8 };
    return { label: family === 'masonry' ? '8x24 CMU lintel' : '24" deep conc. lintel', depth: 24, bearing: 12 };
  }
  if (openingWidth <= 36) return { label: '2-2x6', depth: 5.5, bearing: 1.5 };
  if (openingWidth <= 60) return { label: '2-2x8', depth: 7.25, bearing: 3 };
  if (openingWidth <= 84) return { label: '2-2x10', depth: 9.25, bearing: 3 };
  if (openingWidth <= 120) return { label: '2-2x12', depth: 11.25, bearing: 3 };
  return { label: 'LVL 3-1/2" x 11-7/8"', depth: 11.875, bearing: 4.5 };
}

/** Lintels over every door and window in a wall (auto-sized unless overridden). */
export function computeLintels(entities: ArchEntity[], wall: WallEntity): Lintel[] {
  if (wall.wallTypeId === 'wt-glass' || wall.wallTypeId === 'wt-curtain' || wall.curtain) return [];
  const L = dist(wall.start, wall.end);
  if (L < 1) return [];
  const fam = materialById(wallStructuralMaterialId(wall)).family;
  const out: Lintel[] = [];
  for (const e of entities) {
    if ((e.type !== 'door' && e.type !== 'window' && e.type !== 'wallopening') || e.wallId !== wall.id) continue;
    const op = e as DoorEntity | WindowEntity | WallOpeningEntity;
    if (op.lintel?.none) continue;
    const head = e.type === 'door' ? e.height : (e as WindowEntity | WallOpeningEntity).sillHeight + e.height;
    const sug = suggestLintel(op.width, fam);
    const depth = op.lintel?.depth ?? sug.depth;
    const bearing = op.lintel?.bearing ?? sug.bearing;
    const c = op.offset * L;
    out.push({
      openingId: op.id,
      wallId: wall.id,
      label: op.lintel?.label ?? sug.label,
      depth,
      bearing,
      s0: Math.max(0, c - op.width / 2 - bearing),
      s1: Math.min(L, c + op.width / 2 + bearing),
      zBot: head,
      zTop: Math.min(head + depth, wall.height || 108),
      auto: !op.lintel || (op.lintel.label === undefined && op.lintel.depth === undefined),
    });
  }
  return out;
}

// ============================================================================================
// REBAR
// ============================================================================================

export interface BarSize {
  id: string;
  dia: number;       // inches
  lbPerFt: number;
  color: string;
  system: 'us' | 'metric';
}

export const BAR_SIZES: BarSize[] = [
  { id: '#3', dia: 0.375, lbPerFt: 0.376, color: '#16a34a', system: 'us' },
  { id: '#4', dia: 0.5, lbPerFt: 0.668, color: '#2563eb', system: 'us' },
  { id: '#5', dia: 0.625, lbPerFt: 1.043, color: '#dc2626', system: 'us' },
  { id: '#6', dia: 0.75, lbPerFt: 1.502, color: '#9333ea', system: 'us' },
  { id: '#7', dia: 0.875, lbPerFt: 2.044, color: '#ea580c', system: 'us' },
  { id: '#8', dia: 1.0, lbPerFt: 2.67, color: '#0891b2', system: 'us' },
  { id: '#9', dia: 1.128, lbPerFt: 3.4, color: '#be123c', system: 'us' },
  { id: '#10', dia: 1.27, lbPerFt: 4.303, color: '#4d7c0f', system: 'us' },
  { id: '#11', dia: 1.41, lbPerFt: 5.313, color: '#7c2d12', system: 'us' },
  { id: '10M', dia: 0.445, lbPerFt: 0.785 * 0.671969, color: '#16a34a', system: 'metric' },
  { id: '15M', dia: 0.63, lbPerFt: 1.57 * 0.671969, color: '#2563eb', system: 'metric' },
  { id: '20M', dia: 0.768, lbPerFt: 2.355 * 0.671969, color: '#dc2626', system: 'metric' },
  { id: '25M', dia: 0.992, lbPerFt: 3.925 * 0.671969, color: '#9333ea', system: 'metric' },
  { id: '30M', dia: 1.177, lbPerFt: 5.495 * 0.671969, color: '#ea580c', system: 'metric' },
  { id: '35M', dia: 1.406, lbPerFt: 7.85 * 0.671969, color: '#0891b2', system: 'metric' },
];

export const barSize = (id: string): BarSize => BAR_SIZES.find((b) => b.id === id) || BAR_SIZES[2];

/** Equivalent bar in the other unit system (for presets). */
export function barFor(model: Pick<ArchModel, 'settings'>, us: string): string {
  if (model.settings?.units !== 'metric') return us;
  const map: Record<string, string> = { '#3': '10M', '#4': '10M', '#5': '15M', '#6': '20M', '#7': '20M', '#8': '25M', '#9': '30M', '#10': '30M', '#11': '35M' };
  return map[us] || '15M';
}

/** Number of bars so that the spacing over `span` never exceeds `maxSpacing`. */
export function barCountForSpacing(span: number, maxSpacing: number): number {
  if (span <= 1e-9) return 1;
  if (maxSpacing <= 0) return 2;
  return Math.ceil(span / maxSpacing - 1e-9) + 1;
}

/** Positions (0..span) of bars for a layout rule. */
export function layoutPositions(span: number, rule: RebarLayoutRule, count?: number, spacing?: number): number[] {
  const s = Math.max(0, span);
  if (rule === 'single') return [s / 2];
  if (rule === 'count') {
    const n = Math.max(1, Math.round(count ?? 2));
    if (n === 1) return [s / 2];
    return Array.from({ length: n }, (_, i) => (s * i) / (n - 1));
  }
  if (rule === 'maxSpacing') {
    const n = barCountForSpacing(s, spacing ?? 12);
    if (n === 1) return [s / 2];
    return Array.from({ length: n }, (_, i) => (s * i) / (n - 1));
  }
  // count + spacing, centred, clamped to the span
  const n = Math.max(1, Math.round(count ?? 2));
  const sp = spacing ?? 12;
  const total = sp * (n - 1);
  const start = (s - Math.min(total, s)) / 2;
  return Array.from({ length: n }, (_, i) => Math.min(s, start + Math.min(sp, n > 1 ? s / (n - 1) : sp) * i));
}

/** Default concrete cover per host kind (inches). */
export function defaultCover(kind: HostKind): RebarCover {
  switch (kind) {
    case 'footing':
    case 'wallfooting':
    case 'pilecap':
      return { top: 3, bottom: 3, sides: 3 };
    case 'slab-on-grade':
      return { top: 1.5, bottom: 3, sides: 3 };
    case 'slab':
      return { top: 0.75, bottom: 0.75, sides: 0.75 };
    case 'wall':
      return { top: 1.5, bottom: 1.5, sides: 1.5 };
    default:
      return { top: 1.5, bottom: 1.5, sides: 1.5 };
  }
}

export type HostKind = 'beam' | 'column' | 'footing' | 'wallfooting' | 'pilecap' | 'slab' | 'slab-on-grade' | 'wall';

/** A concrete host described as a planar region (plan polygon or wall elevation) with a thickness. */
export interface RebarHost {
  id: string;
  kind: HostKind;
  cover: RebarCover;
  /** Box hosts (beam, column, footing, wall): origin + unit axes; u along length, v across, w up. */
  origin: P3;
  ax: P3;
  ay: P3;
  az: P3;
  L: number;
  B: number;
  H: number;
  /** Area hosts (slab, footings): plan polygon + z range. */
  polygon?: Point[];
  holes?: Point[][];
  zTop?: number;
  zBot?: number;
  round?: boolean;
  /** Walls: openings in (u, w) wall coordinates. */
  wallOpenings?: Array<{ u0: number; u1: number; w0: number; w1: number }>;
}

const V3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

/** Describes a concrete host for rebar layout (null when the element is not a concrete host). */
export function rebarHostOf(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>, hostId: string): RebarHost | null {
  const e = model.entities.find((x) => x.id === hostId);
  if (!e) return null;
  const withCover = (kind: HostKind, c?: RebarCover) => ({ ...defaultCover(kind), ...(c || {}) });
  if (e.type === 'beam') {
    if (!isConcrete(e.structuralMaterialId)) return null;
    const ax = beamAxis(model, e);
    const d = unit(sub(ax.end, ax.start));
    const n = perp(d);
    const v = beamVertical(model, e, lerp(ax.start, ax.end, 0.5));
    const sec = beamSection(e);
    return {
      id: e.id, kind: 'beam', cover: withCover('beam', e.cover),
      origin: p3(ax.start, v.zBot), ax: V3(d.x, d.y, 0), ay: V3(n.x, n.y, 0), az: V3(0, 0, 1),
      L: dist(ax.start, ax.end), B: sec.bf, H: sec.d,
    };
  }
  if (e.type === 'column') {
    if (!isConcrete(columnMaterialId(e))) return null;
    const z = columnZRange(model, e);
    const sec = columnSection(e);
    const ux = rotLocal({ x: 1, y: 0 }, e.rotation || 0);
    const uy = rotLocal({ x: 0, y: 1 }, e.rotation || 0);
    // u = up the column, v = local x (width), w-axis = local y (depth) — "B" = width, "H" = depth
    return {
      id: e.id, kind: 'column', cover: withCover('column', e.cover),
      origin: p3(e.position, z.z0), ax: V3(0, 0, 1), ay: V3(ux.x, ux.y, 0), az: V3(uy.x, uy.y, 0),
      L: z.z1 - z.z0, B: sec.bf, H: sec.d, round: sec.kind === 'round',
    };
  }
  if (e.type === 'footing') {
    if (!isConcrete(e.structuralMaterialId || 'conc-4000')) return null;
    const z = footingZRange(model, e);
    const kind: HostKind = e.kind === 'wall' ? 'wallfooting' : e.kind === 'pilecap' ? 'pilecap' : 'footing';
    const poly = footingPlanOutline(e, model.entities);
    if (poly.length < 3) return null;
    const d = unit(sub(poly[1], poly[0]));
    const n = unit(sub(poly[3], poly[0]));
    return {
      id: e.id, kind, cover: withCover(kind, e.cover),
      origin: p3(poly[0], z.zBot), ax: V3(d.x, d.y, 0), ay: V3(n.x, n.y, 0), az: V3(0, 0, 1),
      L: dist(poly[0], poly[1]), B: dist(poly[0], poly[3]), H: e.thickness,
      polygon: poly, holes: [], zTop: z.zTop, zBot: z.zBot,
    };
  }
  if (e.type === 'floor') {
    const mat = e.structuralMaterialId || (e.material === 'concrete' || e.structural || e.foundation ? 'conc-4000' : 'spf2');
    if (!isConcrete(mat)) return null;
    const kind: HostKind = e.foundation ? 'slab-on-grade' : 'slab';
    const zTop = levelElevationOf(model, e.levelId);
    return {
      id: e.id, kind, cover: withCover(kind, e.cover),
      origin: V3(0, 0, zTop - e.thickness), ax: V3(1, 0, 0), ay: V3(0, 1, 0), az: V3(0, 0, 1),
      L: 0, B: 0, H: e.thickness, polygon: e.polygon, holes: e.openings || [], zTop, zBot: zTop - e.thickness,
    };
  }
  if (e.type === 'wall') {
    if (!isConcrete(wallStructuralMaterialId(e)) && materialById(wallStructuralMaterialId(e)).family !== 'masonry') return null;
    const L = dist(e.start, e.end);
    if (L < 1) return null;
    const d = unit(sub(e.end, e.start));
    const n = perp(d);
    const z0 = levelElevationOf(model, e.levelId) + (e.baseOffset || 0);
    const openings: Array<{ u0: number; u1: number; w0: number; w1: number }> = [];
    for (const o of model.entities) {
      if ((o.type === 'door' || o.type === 'window') && o.wallId === e.id) {
        const c = o.offset * L;
        const w0 = o.type === 'window' ? o.sillHeight : 0;
        openings.push({ u0: c - o.width / 2, u1: c + o.width / 2, w0, w1: w0 + o.height });
      }
    }
    return {
      id: e.id, kind: 'wall', cover: withCover('wall', e.cover),
      origin: p3(e.start, z0), ax: V3(d.x, d.y, 0), ay: V3(n.x, n.y, 0), az: V3(0, 0, 1),
      L, B: e.thickness, H: e.height || 108, wallOpenings: openings,
    };
  }
  return null;
}

export interface RebarBar {
  pts: P3[];
  size: string;
  dia: number;
  length: number;
  color: string;
}

const at = (h: RebarHost, u: number, v: number, w: number): P3 => add3(add3(add3(h.origin, mul3(h.ax, u)), mul3(h.ay, v)), mul3(h.az, w));

/** Adds hook / leg geometry to a straight bar A→B. `inward` points into the host from the bar layer. */
function shapeBar(A: P3, B: P3, shape: RebarShape, inward: P3, legAvail: number, db: number): P3[] {
  const axis = norm3(sub3(B, A));
  const hook = Math.max(0, Math.min(12 * db, legAvail));
  const leg = (P: P3, along: P3, kind: 'hook90' | 'hook135' | 'full') => {
    if (kind === 'full') return add3(P, mul3(inward, Math.max(0, legAvail)));
    if (kind === 'hook90') return add3(P, mul3(inward, hook));
    const h = Math.max(3, 6 * db);
    return add3(P, mul3(norm3(add3(inward, along)), Math.min(h, legAvail * 1.3)));
  };
  switch (shape) {
    case 'hook90':
      return hook > 0.1 ? [leg(A, axis, 'hook90'), A, B, leg(B, mul3(axis, -1), 'hook90')] : [A, B];
    case 'hook135':
      return legAvail > 0.1 ? [leg(A, axis, 'hook135'), A, B, leg(B, mul3(axis, -1), 'hook135')] : [A, B];
    case 'ubar':
      return legAvail > 0.1 ? [leg(A, axis, 'full'), A, B, leg(B, axis, 'full')] : [A, B];
    case 'lbar':
      return hook > 0.1 ? [leg(A, axis, 'hook90'), A, B] : [A, B];
    default:
      return [A, B];
  }
}

function makeBar(pts: P3[], size: string): RebarBar {
  const bs = barSize(size);
  return { pts, size: bs.id, dia: bs.dia, length: polylineLength3(pts), color: bs.color };
}

/** Closed tie / stirrup loop in a host cross-section plane at station u. */
function loopAt(h: RebarHost, u: number, c: RebarCover, db: number, open = false): P3[] {
  const v0 = -h.B / 2 + c.sides + db / 2;
  const v1 = h.B / 2 - c.sides - db / 2;
  const isCol = h.kind === 'column';
  const w0 = isCol ? -h.H / 2 + c.sides + db / 2 : c.bottom + db / 2;
  const w1 = isCol ? h.H / 2 - c.sides - db / 2 : h.H - c.top - db / 2;
  const P = (v: number, w: number) => (isCol ? at(h, u, v, w) : at(h, u, v, w));
  if (h.round && isCol) {
    const r = Math.min(v1, w1);
    const n = 20;
    return Array.from({ length: n + 1 }, (_, i) => P(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)));
  }
  if (open) return [P(v0, w1), P(v0, w0), P(v1, w0), P(v1, w1)];
  const tail = Math.max(3, 6 * db) * 0.7;
  return [P(v0 + tail, w1 - tail), P(v0, w1), P(v0, w0), P(v1, w0), P(v1, w1), P(v0, w1), P(v0 + tail, w1 - tail * 0.3)];
}

/** Box-host coordinates for column cross-sections: w measured from the column axis. */
function colAt(h: RebarHost, u: number, v: number, w: number): P3 {
  return add3(add3(add3(h.origin, mul3(h.ax, u)), mul3(h.ay, v)), mul3(h.az, w));
}

/** Bars of a rebar set, always inside the host minus cover (recomputed whenever the host changes). */
export function computeRebarBars(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>, rb: RebarEntity): RebarBar[] {
  const h = rebarHostOf(model, rb.hostId);
  if (!h) return [];
  const c: RebarCover = { ...h.cover, ...(rb.cover || {}) } as RebarCover;
  const db = barSize(rb.barSize).dia;
  const tie = model.entities.find((x): x is RebarEntity => x.type === 'rebar' && x.hostId === rb.hostId && (x.placement === 'stirrup' || x.placement === 'tie') && x.id !== rb.id);
  const dt = rb.placement === 'stirrup' || rb.placement === 'tie' ? 0 : tie ? barSize(tie.barSize).dia : 0;
  const out: RebarBar[] = [];
  const lay = (span: number) => layoutPositions(span, rb.layout.rule, rb.layout.count, rb.layout.spacing);

  // ---- area hosts (slabs) and footings: straight bars in one direction, clipped to the outline minus cover
  if (h.polygon && (h.kind === 'slab' || h.kind === 'slab-on-grade' || h.kind === 'footing' || h.kind === 'pilecap' || h.kind === 'wallfooting')) {
    const isTop = rb.placement === 'top';
    const dirAxis = rb.placement === 'y' ? h.ay : h.ax;
    const dir = unit({ x: dirAxis.x, y: dirAxis.y });
    const z = isTop ? h.zTop! - c.top - db / 2 : h.zBot! + c.bottom + db / 2 + (rb.placement === 'y' ? db : 0);
    const segs = clippedBars(h.polygon, h.holes || [], dir, c.sides, (span) => lay(span));
    const legAvail = h.zTop! - h.zBot! - c.top - c.bottom - db;
    const inward = V3(0, 0, isTop ? -1 : 1);
    for (const [a, b] of segs) out.push(makeBar(shapeBar(p3(a, z), p3(b, z), rb.shape, inward, legAvail, db), rb.barSize));
    return out;
  }

  if (h.kind === 'beam') {
    const u0 = c.sides;
    const u1 = h.L - c.sides;
    if (u1 <= u0) return [];
    if (rb.placement === 'stirrup' || rb.placement === 'tie') {
      for (const u of lay(u1 - u0)) out.push(makeBar(loopAt(h, u0 + u, c, db, rb.shape === 'ubar'), rb.barSize));
      return out;
    }
    const vSpan = h.B - 2 * (c.sides + dt) - db;
    if (rb.placement === 'side') {
      const ws = lay(Math.max(0, h.H - c.top - c.bottom - 2 * dt - db)).map((w) => c.bottom + dt + db / 2 + w);
      for (const w of ws.slice(1, -1).length ? ws.slice(1, -1) : ws) {
        for (const v of [-h.B / 2 + c.sides + dt + db / 2, h.B / 2 - c.sides - dt - db / 2]) out.push(makeBar([at(h, u0, v, w), at(h, u1, v, w)], rb.barSize));
      }
      return out;
    }
    const top = rb.placement === 'top';
    const w = top ? h.H - c.top - dt - db / 2 : c.bottom + dt + db / 2;
    const legAvail = h.H - c.top - c.bottom - 2 * dt - db;
    for (const v of lay(Math.max(0, vSpan)).map((x) => -vSpan / 2 + x)) {
      out.push(makeBar(shapeBar(at(h, u0, v, w), at(h, u1, v, w), rb.shape, mul3(h.az, top ? -1 : 1), legAvail, db), rb.barSize));
    }
    return out;
  }

  if (h.kind === 'column') {
    const u0 = c.bottom;
    const u1 = h.L - c.top;
    if (u1 <= u0) return [];
    if (rb.placement === 'tie' || rb.placement === 'stirrup') {
      for (const u of lay(u1 - u0)) out.push(makeBar(loopAt(h, u0 + u, c, db), rb.barSize));
      return out;
    }
    // vertical bars around the perimeter
    const n = Math.max(4, Math.round(rb.layout.count ?? 8));
    const vb = h.B / 2 - c.sides - dt - db / 2;
    const wb = h.H / 2 - c.sides - dt - db / 2;
    const pts: Array<[number, number]> = [];
    if (h.round) {
      for (let i = 0; i < n; i++) pts.push([vb * Math.cos((2 * Math.PI * i) / n), vb * Math.sin((2 * Math.PI * i) / n)]);
    } else {
      pts.push([-vb, -wb], [vb, -wb], [vb, wb], [-vb, wb]);
      const extra = n - 4;
      const perSideV = Math.round((extra * vb) / (vb + wb) / 2);
      const perSideW = Math.floor((extra - 2 * perSideV) / 2);
      for (let i = 1; i <= perSideV; i++) {
        const v = -vb + (2 * vb * i) / (perSideV + 1);
        pts.push([v, -wb], [v, wb]);
      }
      for (let i = 1; i <= perSideW; i++) {
        const w = -wb + (2 * wb * i) / (perSideW + 1);
        pts.push([-vb, w], [vb, w]);
      }
    }
    for (const [v, w] of pts) out.push(makeBar([colAt(h, u0, v, w), colAt(h, u1, v, w)], rb.barSize));
    return out;
  }

  if (h.kind === 'wall') {
    // single curtain at the wall centre: 'vertical' bars spaced along the wall, 'x' horizontal bars up the height
    const holes = (h.wallOpenings || []).map((o) => rectPoly(o.u0 - c.sides, o.w0 - c.sides, o.u1 + c.sides, o.w1 + c.sides));
    const outline = rectPoly(0, 0, h.L, h.H);
    const dir2 = rb.placement === 'vertical' || rb.placement === 'y' ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const segs = clippedBars(outline, holes, dir2, c.sides, (span) => lay(span), c.bottom, c.top);
    for (const [a, b] of segs) out.push(makeBar([at(h, a.x, 0, a.y), at(h, b.x, 0, b.y)], rb.barSize));
    return out;
  }
  return out;
}

const rectPoly = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Bars of an area-reinforcement set (top/bottom mats, two directions). */
export function computeAreaReinfBars(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>, ar: AreaReinforcementEntity): RebarBar[] {
  const h = rebarHostOf(model, ar.hostId);
  if (!h) return [];
  const c: RebarCover = { ...h.cover, ...(ar.cover || {}) } as RebarCover;
  const db = barSize(ar.barSize).dia;
  const out: RebarBar[] = [];
  const lay = (span: number) => layoutPositions(span, 'maxSpacing', undefined, ar.spacing);
  if (h.kind === 'wall') {
    const holes = (h.wallOpenings || []).map((o) => rectPoly(o.u0 - c.sides, o.w0 - c.sides, o.u1 + c.sides, o.w1 + c.sides));
    const outline = rectPoly(0, 0, h.L, h.H);
    const faces: Array<{ on: boolean; v: number; horiz: boolean }> = [
      { on: ar.topX, v: h.B / 2 - c.sides - db / 2, horiz: true },
      { on: ar.topY, v: h.B / 2 - c.sides - db * 1.5, horiz: false },
      { on: ar.bottomX, v: -h.B / 2 + c.sides + db / 2, horiz: true },
      { on: ar.bottomY, v: -h.B / 2 + c.sides + db * 1.5, horiz: false },
    ];
    for (const f of faces) {
      if (!f.on) continue;
      const segs = clippedBars(outline, holes, f.horiz ? { x: 1, y: 0 } : { x: 0, y: 1 }, c.sides, lay, c.bottom, c.top);
      for (const [a, b] of segs) out.push(makeBar([at(h, a.x, f.v, a.y), at(h, b.x, f.v, b.y)], ar.barSize));
    }
    return out;
  }
  if (!h.polygon) return [];
  const ang = ((ar.angle ?? 0) * Math.PI) / 180;
  const dx = h.kind === 'slab' || h.kind === 'slab-on-grade' ? { x: Math.cos(ang), y: Math.sin(ang) } : unit({ x: h.ax.x, y: h.ax.y });
  const dy = perp(dx);
  const mats: Array<{ on: boolean; z: number; dir: Point }> = [
    { on: ar.bottomX, z: h.zBot! + c.bottom + db / 2, dir: dx },
    { on: ar.bottomY, z: h.zBot! + c.bottom + db * 1.5, dir: dy },
    { on: ar.topX, z: h.zTop! - c.top - db / 2, dir: dx },
    { on: ar.topY, z: h.zTop! - c.top - db * 1.5, dir: dy },
  ];
  for (const m of mats) {
    if (!m.on) continue;
    for (const [a, b] of clippedBars(h.polygon, h.holes || [], m.dir, c.sides, lay)) out.push(makeBar([p3(a, m.z), p3(b, m.z)], ar.barSize));
  }
  return out;
}

/** All bars in the model (rebar sets + area reinforcement), keyed by the set id. */
export function allRebarBars(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>): Map<string, RebarBar[]> {
  const out = new Map<string, RebarBar[]>();
  for (const e of model.entities) {
    if (e.type === 'rebar') out.set(e.id, computeRebarBars(model, e));
    else if (e.type === 'areareinf') out.set(e.id, computeAreaReinfBars(model, e));
  }
  return out;
}

/**
 * Straight bars parallel to `dir` across a polygon, inset by `cover` (and holes dilated by it).
 * Optional separate covers at the low / high ends perpendicular... (bottom/top of a wall).
 */
export function clippedBars(
  polygon: Point[],
  holes: Point[][],
  dir: Point,
  cover: number,
  positions: (span: number) => number[],
  coverLow?: number,
  coverHigh?: number
): Array<[Point, Point]> {
  const pos = signedArea(polygon) >= 0 ? polygon : [...polygon].reverse();
  let inset = offsetPolygon(pos, -cover);
  if (coverLow !== undefined || coverHigh !== undefined) {
    // wall: different cover at the bottom and top (y = height)
    const ys = pos.map((p) => p.y);
    const y0 = Math.min(...ys) + (coverLow ?? cover);
    const y1 = Math.max(...ys) - (coverHigh ?? cover);
    const xs = pos.map((p) => p.x);
    inset = rectPoly(Math.min(...xs) + cover, y0, Math.max(...xs) - cover, y1);
  }
  if (signedArea(inset) <= 0) return [];
  const dil = holes.filter((hh) => hh.length >= 3).map((hh) => {
    const hp = signedArea(hh) >= 0 ? hh : [...hh].reverse();
    return offsetPolygon(hp, cover);
  });
  const d = unit(dir);
  const n = perp(d);
  const proj = inset.map((p) => dot(p, n));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const offsets = positions(hi - lo).map((o) => lo + Math.max(1e-6, Math.min(hi - lo - 1e-6, o)));
  return scanSegments(inset, dil, d, offsets);
}

/** Lines {p : p·n = offset} ∩ (polygon − holes), returned as segments along `dir`. */
export function scanSegments(polygon: Point[], holes: Point[][], dir: Point, offsets: number[]): Array<[Point, Point]> {
  const d = unit(dir);
  const n = perp(d);
  const rings = [polygon, ...holes];
  const out: Array<[Point, Point]> = [];
  for (const off of offsets) {
    const ts: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const fa = dot(a, n) - off;
        const fb = dot(b, n) - off;
        if ((fa > 0) === (fb > 0)) continue;
        const t = fa / (fa - fb);
        const p = lerp(a, b, t);
        ts.push(dot(p, d));
      }
    }
    ts.sort((x, y) => x - y);
    const base = mul(n, off);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      if (ts[i + 1] - ts[i] < 0.5) continue;
      out.push([add(base, mul(d, ts[i])), add(base, mul(d, ts[i + 1]))]);
    }
  }
  return out;
}

// ============================================================================================
// PRESETS
// ============================================================================================

export interface RebarPreset {
  id: string;
  label: string;
  hostKinds: HostKind[];
  make: (model: Pick<ArchModel, 'settings'>, hostId: string, levelId?: string) => Array<RebarEntity | AreaReinforcementEntity>;
}

let uid = 0;
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;
const bar = (hostId: string, levelId: string | undefined, o: Omit<RebarEntity, 'id' | 'type' | 'layer' | 'hostId'>): RebarEntity => ({ id: rid('rb'), type: 'rebar', layer: 'S-REBAR', levelId, hostId, ...o });

export const REBAR_PRESETS: RebarPreset[] = [
  {
    id: 'beam',
    label: '4 #6 bottom, 2 #5 top, #3 stirrups @ 6"',
    hostKinds: ['beam'],
    make: (m, h, lv) => [
      bar(h, lv, { barSize: barFor(m, '#6'), shape: 'hook90', placement: 'bottom', layout: { rule: 'count', count: 4 } }),
      bar(h, lv, { barSize: barFor(m, '#5'), shape: 'hook90', placement: 'top', layout: { rule: 'count', count: 2 } }),
      bar(h, lv, { barSize: barFor(m, '#3'), shape: 'stirrup', placement: 'stirrup', layout: { rule: 'maxSpacing', spacing: 6 } }),
    ],
  },
  {
    id: 'column',
    label: '8 #8 vertical, #3 ties @ 12"',
    hostKinds: ['column'],
    make: (m, h, lv) => [
      bar(h, lv, { barSize: barFor(m, '#8'), shape: 'straight', placement: 'vertical', layout: { rule: 'count', count: 8 } }),
      bar(h, lv, { barSize: barFor(m, '#3'), shape: 'stirrup', placement: 'tie', layout: { rule: 'maxSpacing', spacing: 12 } }),
    ],
  },
  {
    id: 'footing',
    label: '#5 @ 10" EW bottom',
    hostKinds: ['footing', 'pilecap', 'wallfooting'],
    make: (m, h, lv) => [{ id: rid('ar'), type: 'areareinf', layer: 'S-REBAR', levelId: lv, hostId: h, barSize: barFor(m, '#5'), spacing: 10, topX: false, topY: false, bottomX: true, bottomY: true }],
  },
  {
    id: 'slab',
    label: '#4 @ 12" EW',
    hostKinds: ['slab', 'slab-on-grade'],
    make: (m, h, lv) => [{ id: rid('ar'), type: 'areareinf', layer: 'S-REBAR', levelId: lv, hostId: h, barSize: barFor(m, '#4'), spacing: 12, topX: false, topY: false, bottomX: true, bottomY: true }],
  },
  {
    id: 'wall',
    label: '#5 @ 12" EW each face',
    hostKinds: ['wall'],
    make: (m, h, lv) => [{ id: rid('ar'), type: 'areareinf', layer: 'S-REBAR', levelId: lv, hostId: h, barSize: barFor(m, '#5'), spacing: 12, topX: true, topY: true, bottomX: true, bottomY: true }],
  },
];

/** "#4 @ 12" EW T&B" style label of an area reinforcement set. */
export function areaReinfLabel(ar: AreaReinforcementEntity, units: 'imperial' | 'metric' = 'imperial'): string {
  const sp = units === 'metric' ? `${Math.round(ar.spacing * 25.4)}` : `${Math.round(ar.spacing * 100) / 100}"`;
  const dirs = (x: boolean, y: boolean) => (x && y ? 'EW' : x ? 'X' : y ? 'Y' : '');
  const t = dirs(ar.topX, ar.topY);
  const b = dirs(ar.bottomX, ar.bottomY);
  const where = t && b ? (t === b ? `${t} T&B` : `${t} TOP, ${b} BOT`) : t ? `${t} TOP` : b ? `${b} BOT` : '';
  return `${ar.barSize} @ ${sp} ${where}`.trim();
}

export function rebarLabel(rb: RebarEntity, units: 'imperial' | 'metric' = 'imperial'): string {
  const sp = (v?: number) => (units === 'metric' ? `${Math.round((v ?? 12) * 25.4)}` : `${Math.round((v ?? 12) * 100) / 100}"`);
  const what = rb.placement === 'stirrup' ? 'stirrups' : rb.placement === 'tie' ? 'ties' : rb.placement;
  switch (rb.layout.rule) {
    case 'single':
      return `1 ${rb.barSize} ${what}`;
    case 'count':
      return `${rb.layout.count ?? 2} ${rb.barSize} ${what}`;
    case 'maxSpacing':
      return `${rb.barSize} ${what} @ ${sp(rb.layout.spacing)}`;
    default:
      return `${rb.layout.count ?? 2} ${rb.barSize} ${what} @ ${sp(rb.layout.spacing)}`;
  }
}

// ============================================================================================
// JOINS (clean concrete outlines), EXPANSION JOINTS
// ============================================================================================

export interface JoinPoly {
  id: string;
  pts: Point[];
}

/** Parts of segment a→b outside all polygons (strict interior). */
export function segmentMinusPolygons(a: Point, b: Point, polys: Point[][]): Array<[Point, Point]> {
  const d = sub(b, a);
  const ts = [0, 1];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const e = sub(poly[(i + 1) % poly.length], p);
      const den = cross(d, e);
      if (Math.abs(den) < 1e-12) continue;
      const t = cross(sub(p, a), e) / den;
      const u = cross(sub(p, a), d) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: Array<[Point, Point]> = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1e-7) continue;
    const m = lerp(a, b, (ts[i] + ts[i + 1]) / 2);
    if (polys.some((poly) => pointInPolygon(m, poly) && distToPoly(m, poly) > 1e-3)) continue;
    const p0 = lerp(a, b, ts[i]);
    const p1 = lerp(a, b, ts[i + 1]);
    const last = out[out.length - 1];
    if (last && dist(last[1], p0) < 1e-7) last[1] = p1;
    else out.push([p0, p1]);
  }
  return out;
}

function distToPoly(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const L2 = dot(ab, ab);
    const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
    best = Math.min(best, dist(p, add(a, mul(ab, t))));
  }
  return best;
}

/**
 * Outline of joined concrete elements: each element's edges minus the interiors of the
 * elements it is joined with — so overlapping concrete reads as one clean piece.
 */
export function joinedOutlineSegments(polys: JoinPoly[], joined: (a: string, b: string) => boolean): Array<{ id: string; a: Point; b: Point }> {
  const out: Array<{ id: string; a: Point; b: Point }> = [];
  for (const P of polys) {
    const others = polys.filter((Q) => Q.id !== P.id && joined(P.id, Q.id) && bboxOverlap(P.pts, Q.pts)).map((Q) => Q.pts);
    for (let i = 0; i < P.pts.length; i++) {
      const a = P.pts[i];
      const b = P.pts[(i + 1) % P.pts.length];
      for (const [x, y] of others.length ? segmentMinusPolygons(a, b, others) : [[a, b] as [Point, Point]]) out.push({ id: P.id, a: x, b: y });
    }
  }
  return out;
}

function bboxOverlap(a: Point[], b: Point[]): boolean {
  const bb = (p: Point[]) => ({ x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)) });
  const A = bb(a);
  const B = bb(b);
  return A.x0 <= B.x1 + 1e-6 && B.x0 <= A.x1 + 1e-6 && A.y0 <= B.y1 + 1e-6 && B.y0 <= A.y1 + 1e-6;
}

/** Concrete plan footprints on a level (columns, structural concrete walls, concrete beams, footings). */
export function concreteFootprints(model: Pick<ArchModel, 'entities' | 'structureJoins' | 'levels'>, levelId: string, opts: { foundations?: boolean } = {}): JoinPoly[] {
  const out: JoinPoly[] = [];
  const onLevel = (e: ArchEntity) => (e.levelId || 'level-1') === levelId;
  for (const e of model.entities) {
    if (!onLevel(e)) continue;
    if (opts.foundations) {
      if (e.type === 'footing' && isConcrete(e.structuralMaterialId || 'conc-4000')) {
        const p = footingPlanOutline(e, model.entities);
        if (p.length >= 3) out.push({ id: e.id, pts: p });
      }
      continue;
    }
    if (e.type === 'column' && isConcrete(columnMaterialId(e))) out.push({ id: e.id, pts: columnFootprint(e) });
    else if (e.type === 'beam' && e.usage !== 'brace' && isConcrete(e.structuralMaterialId)) out.push({ id: e.id, pts: beamPlanOutline(model, e) });
  }
  return out;
}

/** Clips a polygon to the half-plane n·p ≥ c (Sutherland–Hodgman). */
export function clipHalfPlane(poly: Point[], n: Point, c: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = dot(n, a) - c;
    const fb = dot(n, b) - c;
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) out.push(lerp(a, b, fa / (fa - fb)));
  }
  return out;
}

/** Splits a slab polygon along an expansion joint line, leaving a gap. */
export function splitByJoint(poly: Point[], a: Point, b: Point, gap: number): Point[][] {
  const d = unit(sub(b, a));
  const n = perp(d);
  const c = dot(n, a);
  return [clipHalfPlane(poly, n, c + gap / 2), clipHalfPlane(poly, mul(n, -1), -(c - gap / 2))].filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1);
}

/** Slab pieces after every expansion joint hosted by it. */
export function slabPieces(floor: FloorEntity, entities: ArchEntity[]): Point[][] {
  let pieces = [floor.polygon];
  for (const j of entities) {
    if (j.type !== 'sjoint' || j.hostId !== floor.id || j.kind !== 'expansion') continue;
    pieces = pieces.flatMap((p) => splitByJoint(p, j.start, j.end, Math.max(0.25, j.gap || 1)));
  }
  return pieces;
}

/** The part of a joint line that lies on its host slab (for drawing). */
export function jointOnHost(j: StructuralJointEntity, entities: ArchEntity[]): Array<[Point, Point]> {
  const host = entities.find((e) => e.id === j.hostId);
  if (host && host.type === 'floor') {
    const d = unit(sub(j.end, j.start));
    const n = perp(d);
    return scanSegments(host.polygon, host.openings || [], d, [dot(j.start, n)]).filter(([p, q]) => {
      const m = lerp(p, q, 0.5);
      return dot(sub(m, j.start), d) > -dist(j.start, j.end) && dot(sub(m, j.start), d) < 2 * dist(j.start, j.end);
    });
  }
  return [[j.start, j.end]];
}

// ============================================================================================
// CONNECTIONS
// ============================================================================================

export interface ConnectionGeometry {
  at: P3;
  /** plan direction of the supported member, pointing away from the support */
  dir: Point;
  plates: Array<{ center: P3; size: P3; axisU: Point }>; // box plates (u = along dir in plan, v across, w up)
  bolts: P3[];
  label: string;
}

export const CONNECTION_LABELS: Record<string, string> = { 'shear-plate': 'SP', 'end-plate': 'EP', 'clip-angle': 'CA', 'base-plate': 'BP' };

export function connectionGeometry(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>, cn: ConnectionEntity): ConnectionGeometry | null {
  const members = cn.memberIds.map((id) => model.entities.find((e) => e.id === id)).filter(Boolean) as ArchEntity[];
  const col = members.find((m): m is ColumnEntity => m.type === 'column');
  const beams = members.filter((m): m is BeamEntity => m.type === 'beam');
  if (cn.kind === 'base-plate') {
    if (!col) return null;
    const z = columnZRange(model, col);
    const sec = columnSection(col);
    return basePlateGeometry(col.position, z.z0, sec, col.rotation || 0);
  }
  const bm = beams[0];
  if (!bm) return null;
  const ax = beamAxis(model, bm);
  let endPt = ax.start;
  let dir = unit(sub(ax.end, ax.start));
  const supportPt = col ? col.position : beams[1] ? closestOnSegment(lerp(ax.start, ax.end, 0.5), beams[1].start, beams[1].end) : ax.start;
  if (dist(ax.end, supportPt) < dist(ax.start, supportPt)) {
    endPt = ax.end;
    dir = unit(sub(ax.start, ax.end));
  }
  const v = beamVertical(model, bm, endPt);
  const sec = beamSection(bm);
  const n = perp(dir);
  const h = Math.max(6, sec.d - 2 * (sec.tf || 0.5) - 2);
  const nb = Math.max(2, cn.bolts ?? Math.max(2, Math.floor(h / 3)));
  const plates: ConnectionGeometry['plates'] = [];
  const bolts: P3[] = [];
  const zc = v.zMid;
  if (cn.kind === 'end-plate') {
    plates.push({ center: p3(add(endPt, mul(dir, -0.375)), zc), size: { x: 0.75, y: (sec.bf || 6) + 2, z: sec.d + 2 }, axisU: dir });
    for (let i = 0; i < nb; i++) {
      const z = zc - sec.d / 2 + ((i + 0.5) * sec.d) / nb;
      for (const s of [-1, 1]) bolts.push(p3(add(add(endPt, mul(dir, -0.8)), mul(n, s * ((sec.bf || 6) / 2 - 0.75))), z));
    }
  } else if (cn.kind === 'clip-angle') {
    for (const s of [-1, 1]) plates.push({ center: p3(add(add(endPt, mul(dir, 2)), mul(n, s * ((sec.tw || 0.3) / 2 + 0.25))), zc), size: { x: 4, y: 0.375, z: h }, axisU: dir });
    for (let i = 0; i < nb; i++) bolts.push(p3(add(endPt, mul(dir, 2.5)), zc - h / 2 + ((i + 0.5) * h) / nb));
  } else {
    plates.push({ center: p3(add(add(endPt, mul(dir, 2)), mul(n, (sec.tw || 0.3) / 2 + 0.19)), zc), size: { x: 4.5, y: 0.375, z: h }, axisU: dir });
    for (let i = 0; i < nb; i++) bolts.push(p3(add(endPt, mul(dir, 2.75)), zc - h / 2 + ((i + 0.5) * h) / nb));
  }
  return { at: p3(endPt, zc), dir, plates, bolts, label: CONNECTION_LABELS[cn.kind] || 'CN' };
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const ab = sub(b, a);
  const L2 = dot(ab, ab) || 1;
  return add(a, mul(ab, Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2))));
}

/** Automatic base plate + 4 anchor bolts under a steel column. */
export function basePlateGeometry(pos: Point, z0: number, sec: SectionProfile, rotation: number): ConnectionGeometry {
  const B = sec.bf + 4;
  const N = sec.d + 4;
  const ux = rotLocal({ x: 1, y: 0 }, rotation);
  const uy = rotLocal({ x: 0, y: 1 }, rotation);
  const t = 0.75;
  const bolts: P3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bolts.push(p3(add(add(pos, mul(ux, sx * (B / 2 - 1.5))), mul(uy, sy * (N / 2 - 1.5))), z0));
  return { at: p3(pos, z0), dir: ux, plates: [{ center: p3(pos, z0 + t / 2), size: { x: B, y: N, z: t }, axisU: ux }], bolts, label: 'BP' };
}

// ============================================================================================
// ANALYTICAL MODEL & WARNINGS
// ============================================================================================

export interface AnalyticalModel {
  members: Array<{ id: string; a: P3; b: P3; kind: 'column' | 'beam' | 'brace' }>;
  nodes: P3[];
  supports: Array<{ at: P3; kind: 'fixed' | 'pinned' }>;
}

export function analyticalModel(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>): AnalyticalModel {
  const members: AnalyticalModel['members'] = [];
  const supports: AnalyticalModel['supports'] = [];
  for (const e of model.entities) {
    if (e.type === 'column') {
      const z = columnZRange(model, e);
      members.push({ id: e.id, a: p3(e.position, z.z0), b: p3(e.position, z.z1), kind: 'column' });
      if (hasFoundationBelow(model, e)) supports.push({ at: p3(e.position, z.z0), kind: 'fixed' });
    } else if (e.type === 'beam') {
      const za = beamAnalyticalZ(model, e, e.start);
      const zb = beamAnalyticalZ(model, e, e.end);
      members.push({ id: e.id, a: p3(e.start, za), b: p3(e.end, zb), kind: e.usage === 'brace' ? 'brace' : 'beam' });
    } else if (e.type === 'footing' && e.kind === 'wall') {
      // continuous support under walls: one symbol at the middle
      const p = footingPlanOutline(e, model.entities);
      if (p.length >= 3) supports.push({ at: p3(lerp(lerp(p[0], p[1], 0.5), lerp(p[2], p[3], 0.5), 0.5), footingZRange(model, e).zTop), kind: 'pinned' });
    }
  }
  // nodes: member end points that coincide (within 3") with another member
  const ends: P3[] = members.flatMap((m) => [m.a, m.b]);
  const nodes: P3[] = [];
  for (const p of ends) {
    const touches = members.filter((m) => distPointSeg3(p, m.a, m.b) < 3).length;
    if (touches >= 2 && !nodes.some((q) => len3(sub3(p, q)) < 3)) nodes.push(p);
  }
  return { members, nodes, supports };
}

function beamAnalyticalZ(model: Pick<ArchModel, 'levels'>, b: BeamEntity, at: Point): number {
  return b.usage === 'brace' ? beamRefZ(model, b, at) : beamVertical(model, b, at).zTop;
}

function distPointSeg3(p: P3, a: P3, b: P3): number {
  const ab = sub3(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / L2)) : 0;
  return len3(sub3(p, add3(a, mul3(ab, t))));
}

export function hasFoundationBelow(model: Pick<ArchModel, 'entities'>, col: ColumnEntity): boolean {
  for (const e of model.entities) {
    if (e.type === 'footing') {
      if (e.columnId === col.id) return true;
      const p = footingPlanOutline(e, model.entities);
      if (p.length >= 3 && pointInPolygon(col.position, p)) return true;
    }
    if (e.type === 'floor' && e.foundation && pointInPolygon(col.position, e.polygon)) return true;
  }
  return false;
}

export interface StructuralWarning {
  id: string;
  entityId: string;
  message: string;
  at: Point;
}

export const SPAN_DEPTH_LIMIT: Record<MaterialFamily, number> = { steel: 24, concrete: 16, wood: 20, masonry: 16 };

/** Simple coordination warnings (no structural calculation). */
export function structuralWarnings(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins' | 'settings'>): StructuralWarning[] {
  const out: StructuralWarning[] = [];
  const levels = [...(model.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const lowest = levels[0]?.id || 'level-1';
  const columns = model.entities.filter((e): e is ColumnEntity => e.type === 'column');
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  const beams = model.entities.filter((e): e is BeamEntity => e.type === 'beam');
  for (const c of columns) {
    if ((c.levelId || 'level-1') !== lowest) continue;
    if (!hasFoundationBelow(model, c)) out.push({ id: `nofdn-${c.id}`, entityId: c.id, message: 'Column has no foundation below', at: c.position });
  }
  for (const b of beams) {
    if (b.usage === 'brace' || b.usage === 'rafter' || b.usage === 'purlin' || b.usage === 'ridge') continue; // roof framing bears on the roof / walls
    const sec = beamSection(b);
    const fam = materialById(b.structuralMaterialId).family;
    const span = dist(b.start, b.end);
    const ratio = span / Math.max(1, sec.d);
    const lim = SPAN_DEPTH_LIMIT[fam];
    if (ratio > lim) out.push({ id: `ld-${b.id}`, entityId: b.id, message: `Span/depth ${ratio.toFixed(1)} exceeds ${lim} (${fam})`, at: lerp(b.start, b.end, 0.5) });
    for (const [end, label] of [[b.start, 'start'], [b.end, 'end']] as Array<[Point, string]>) {
      const lv = b.levelId || 'level-1';
      const onCol = columns.some((c) => pointInPolygon(end, offsetPolygon(orient(columnFootprint(c)), 3)) && ((c.levelId || 'level-1') === lv || c.topLevelId === lv));
      const onWall = walls.some((w) => distToSeg(end, w.start, w.end) <= w.thickness / 2 + 3);
      const onBeam = beams.some((o) => o.id !== b.id && o.usage !== 'brace' && distToSeg(end, o.start, o.end) <= 3);
      if (!onCol && !onWall && !onBeam) out.push({ id: `nosup-${b.id}-${label}`, entityId: b.id, message: `Beam not supported at its ${label}`, at: end });
    }
  }
  return out;
}

const orient = (p: Point[]) => (signedArea(p) >= 0 ? p : [...p].reverse());

function distToSeg(p: Point, a: Point, b: Point): number {
  return dist(p, closestOnSegment(p, a, b));
}

// ============================================================================================
// SCHEDULES
// ============================================================================================

export interface StructuralScheduleTable {
  title: string;
  headers: string[];
  rows: string[][];
  weights: number[];
}

type Fmt = (inches: number) => string;

export function footingSchedule(model: ArchModel, fmt: Fmt): StructuralScheduleTable {
  const rows: string[][] = [];
  const fts = model.entities.filter((e): e is FootingEntity => e.type === 'footing');
  fts.forEach((f, i) => {
    const z = footingZRange(model, f);
    const kind = f.kind === 'wall' ? 'Wall (strip)' : f.kind === 'pilecap' ? `Pile cap (${f.piles?.count ?? 4} piles)` : 'Isolated pad';
    const size = f.kind === 'wall' ? `${fmt(f.width)} wide` : `${fmt(f.length)} x ${fmt(f.width)}`;
    const reinf = model.entities.filter((r) => (r.type === 'areareinf' || r.type === 'rebar') && r.hostId === f.id).map((r) => (r.type === 'areareinf' ? areaReinfLabel(r, model.settings.units) : rebarLabel(r as RebarEntity, model.settings.units))).join('; ');
    rows.push([`F${i + 1}`, kind, size, fmt(f.thickness), fmt(z.zTop), materialById(f.structuralMaterialId || defaultConcreteId(model)).label, reinf || '—']);
  });
  return { title: 'Footing Schedule', headers: ['Mark', 'Type', 'Size', 'Thickness', 'Top El.', 'Material', 'Reinforcement'], rows, weights: [0.6, 1.4, 1.4, 0.9, 0.9, 1.6, 2] };
}

export function columnSchedule(model: ArchModel, fmt: Fmt): StructuralScheduleTable {
  const rows: string[][] = [];
  const cols = model.entities.filter((e): e is ColumnEntity => e.type === 'column');
  const lvlName = (id?: string) => (model.levels || []).find((l) => l.id === (id || 'level-1'))?.name || 'Level 1';
  cols.forEach((c, i) => {
    const z = columnZRange(model, c);
    const sec = columnSection(c);
    const grid = nearestGridLabel(model, c.position);
    rows.push([`C${i + 1}`, grid, materialById(columnMaterialId(c)).label, sec.label, lvlName(c.levelId), c.topLevelId ? lvlName(c.topLevelId) : c.topBeamId ? 'Beam' : fmt(z.z1), fmt(z.z1 - z.z0), hasFoundationBelow(model, c) ? 'Yes' : 'No']);
  });
  return { title: 'Column Schedule', headers: ['Mark', 'Grid', 'Material', 'Section', 'Base', 'Top', 'Height', 'Foundation'], rows, weights: [0.6, 0.7, 1.6, 1.3, 0.9, 0.9, 0.9, 0.9] };
}

export function beamSchedule(model: ArchModel, fmt: Fmt): StructuralScheduleTable {
  const rows: string[][] = [];
  const lvlName = (id?: string) => (model.levels || []).find((l) => l.id === (id || 'level-1'))?.name || 'Level 1';
  let i = 0;
  for (const b of model.entities) {
    if (b.type === 'beam') {
      const ax = beamAxis(model, b);
      const sec = beamSection(b);
      const wt = sec.weight ? `${Math.round(sec.weight * (dist(ax.start, ax.end) / 12))} lb` : '—';
      rows.push([`${b.usage === 'brace' ? 'BR' : 'B'}${++i}`, b.usage === 'brace' ? 'Brace' : 'Beam', materialById(b.structuralMaterialId).label, sec.label, lvlName(b.levelId), fmt(dist(ax.start, ax.end)), fmt(beamVertical(model, b).zTop - levelElevationOf(model, b.levelId)), wt]);
    } else if (b.type === 'beamsystem') {
      const joists = beamSystemJoists(b);
      const total = joists.reduce((s, [p, q]) => s + dist(p, q), 0);
      const sec = beamSection(b);
      rows.push([`BS${++i}`, `Joists x${joists.length} @ ${fmt(b.spacing)} o.c.`, materialById(b.structuralMaterialId).label, sec.label, lvlName(b.levelId), fmt(total), fmt(b.topOffset), '—']);
    }
  }
  return { title: 'Beam Schedule', headers: ['Mark', 'Type', 'Material', 'Section', 'Level', 'Length', 'Top Offset', 'Weight'], rows, weights: [0.6, 1.5, 1.5, 1.3, 0.9, 0.9, 0.8, 0.8] };
}

export interface RebarScheduleRow {
  mark: string;
  size: string;
  shape: string;
  count: number;
  length: number; // each (average), inches
  total: number; // inches
  weightLb: number;
  host: string;
}

export function rebarScheduleRows(model: Pick<ArchModel, 'levels' | 'entities' | 'structureJoins'>): RebarScheduleRow[] {
  const rows: RebarScheduleRow[] = [];
  let n = 0;
  for (const e of model.entities) {
    if (e.type !== 'rebar' && e.type !== 'areareinf') continue;
    const bars = e.type === 'rebar' ? computeRebarBars(model, e) : computeAreaReinfBars(model, e);
    if (!bars.length) continue;
    const total = bars.reduce((s, b) => s + b.length, 0);
    const host = model.entities.find((h) => h.id === e.hostId);
    rows.push({
      mark: e.mark || `R${++n}`,
      size: e.barSize,
      shape: e.type === 'rebar' ? SHAPE_LABEL[e.shape] : 'Straight (mat)',
      count: bars.length,
      length: total / bars.length,
      total,
      weightLb: (total / 12) * barSize(e.barSize).lbPerFt,
      host: host ? hostLabel(host) : '—',
    });
    if (e.mark) n++;
  }
  return rows;
}

export const SHAPE_LABEL: Record<RebarShape, string> = { straight: 'Straight', hook90: '90° hook', hook135: '135° hook', ubar: 'U-bar', stirrup: 'Stirrup / tie', lbar: 'L-bar' };

const hostLabel = (h: ArchEntity) => (h.type === 'floor' ? (h.foundation ? 'Slab on grade' : 'Slab') : h.type === 'footing' ? 'Footing' : h.type.charAt(0).toUpperCase() + h.type.slice(1));

export function rebarSchedule(model: ArchModel, fmt: Fmt): StructuralScheduleTable {
  const metric = model.settings.units === 'metric';
  const rows = rebarScheduleRows(model).map((r) => [
    r.mark,
    r.size,
    r.shape,
    String(r.count),
    fmt(r.length),
    metric ? `${(r.total * 0.0254).toFixed(1)} m` : `${(r.total / 12).toFixed(1)} ft`,
    metric ? `${(r.weightLb * 0.453592).toFixed(1)} kg` : `${r.weightLb.toFixed(1)} lb`,
    r.host,
  ]);
  const sum = rebarScheduleRows(model).reduce((s, r) => s + r.weightLb, 0);
  if (rows.length) rows.push(['', '', '', '', '', 'TOTAL', metric ? `${(sum * 0.453592).toFixed(1)} kg` : `${sum.toFixed(1)} lb`, '']);
  return { title: 'Rebar Schedule', headers: ['Mark', 'Size', 'Shape', 'Count', 'Length (each)', 'Total Length', `Weight (${metric ? 'kg' : 'lb'})`, 'Host'], rows, weights: [0.6, 0.6, 1.1, 0.6, 1, 1, 1, 1] };
}

export function nearestGridLabel(model: Pick<ArchModel, 'entities'>, p: Point): string {
  const grids = model.entities.filter((e) => e.type === 'grid') as Array<{ start: Point; end: Point; label: string }>;
  const near = grids.filter((g) => distToSeg(p, g.start, g.end) < 6).map((g) => g.label);
  return near.length ? near.sort((a, b) => (/^[A-Z]/i.test(a) ? -1 : 1) - (/^[A-Z]/i.test(b) ? -1 : 1)).join('-') : '—';
}

// ============================================================================================
// LOADS
// ============================================================================================

export const LOAD_UNITS: Record<'imperial' | 'metric', Record<LoadEntity['kind'], string>> = {
  imperial: { point: 'kip', line: 'kip/ft', area: 'psf' },
  metric: { point: 'kN', line: 'kN/m', area: 'kPa' },
};

export const loadLabel = (l: LoadEntity) => `${Math.round(l.value * 100) / 100} ${l.unit}`;

// ============================================================================================
// DISCIPLINE
// ============================================================================================

/** Structural-only categories (hidden in the Architectural discipline). */
export const STRUCTURAL_ONLY_TYPES = new Set(['footing', 'beam', 'beamsystem', 'rebar', 'areareinf', 'connection', 'sjoint', 'load', 'truss']);

/** Whether an entity is part of the structure (shown strongly in the Structural discipline). */
export function isStructuralEntity(e: ArchEntity): boolean {
  if (STRUCTURAL_ONLY_TYPES.has(e.type) || e.type === 'column' || e.type === 'grid' || e.type === 'section') return true;
  if (e.type === 'wall') return !!e.structural;
  if (e.type === 'floor') return !!(e.structural || e.foundation);
  return false;
}
