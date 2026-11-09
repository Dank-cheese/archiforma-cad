/**
 * VIEW NAVIGATION — pure helpers for checking below grade.
 *
 * 3D (three.js) coordinates used across the app: three.x = plan x, three.y = elevation (up),
 * three.z = plan y. Grade (finished ground) is the project datum, elevation 0.
 *
 *  - below-grade detection + ground / grid fading
 *  - orbit limits, vertical pan, PageUp / PageDown steps
 *  - SECTION BOX (BX): clipping planes, face drag, handles
 *  - hover readout labels ("Top of footing  -3'-6\"")
 *  - checks under the building (footings, column bases, wall footings, slab support, floating elements)
 *  - 2D UNDERLAY: which level / foundation to draw halftone, and where load-bearing elements above
 *    have nothing below them (mismatch highlight)
 */
import type { ArchEntity, ArchModel, BeamEntity, ColumnEntity, FloorEntity, FootingEntity, Point, UnitSystem, WallEntity } from '../types/model';
import { formatLength } from './geometry';
import { offsetPolygon, pointInPolygon, signedArea } from './roof';
import { beamPlanOutline, beamVertical, columnFootprint, columnZRange, footingPlanOutline, footingZRange, levelElevationOf } from './structure';
import type { PlanPrim } from './planPrimitives';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ============================================================================================
// GRADE, GROUND & GRID
// ============================================================================================

/** Finished grade = project datum. */
export const GRADE_Z = 0;
/** Spacing of the 3D reference grid (also the PageUp / PageDown step). */
export const GRID3D_STEP = 24;
/** Ground opacity used automatically while the camera is below grade. */
export const BELOW_GRADE_GROUND_OPACITY = 0.15;
/** Grid opacity while below grade (thin faded lines). */
export const BELOW_GRADE_GRID_OPACITY = 0.3;
/** X-ray: opacity of everything above grade (foundations and structure stay solid). */
export const XRAY_OPACITY = 0.25;

/** True when the eye (three.js y) is under grade. A small tolerance avoids flicker at exactly 0. */
export function isBelowGrade(cameraY: number, gradeZ = GRADE_Z, tol = 0.25): boolean {
  return cameraY < gradeZ - tol;
}

export interface GroundState {
  /** user slider 0..1; null = automatic (opaque, or 35 % when foundations are modelled) */
  opacity: number | null;
  hidden: boolean;
  xray: boolean;
}

export const DEFAULT_GROUND_STATE: GroundState = { opacity: null, hidden: false, xray: false };

/**
 * Ground plane and grid appearance for a camera height. Below grade the ground fades to 15 % (or
 * less, if the user chose less) and becomes visible from underneath; the grid turns to thin faded
 * lines. Above grade everything returns to the user's setting.
 */
export function groundAppearance(
  cameraY: number,
  g: GroundState,
  hasFoundations: boolean
): { visible: boolean; opacity: number; doubleSided: boolean; gridOpacity: number; below: boolean } {
  const below = isBelowGrade(cameraY);
  const base = g.opacity ?? (hasFoundations ? 0.35 : 1);
  const opacity = Math.max(0, Math.min(1, below ? Math.min(base, BELOW_GRADE_GROUND_OPACITY) : base));
  return {
    visible: !g.hidden && opacity > 0.001,
    opacity,
    doubleSided: below,
    gridOpacity: below ? BELOW_GRADE_GRID_OPACITY : 1,
    below,
  };
}

/** Polar-angle limits for orbiting: the camera may go all the way under the building. */
export function orbitPolarLimits(): { min: number; max: number } {
  return { min: 0.001, max: Math.PI - 0.001 };
}

/** World distance per screen pixel at the orbit target (perspective camera, vertical FOV in degrees). */
export function worldPerPixel(distance: number, vfovDeg: number, viewportHeight: number): number {
  return (2 * Math.max(0.001, distance) * Math.tan((vfovDeg * Math.PI) / 360)) / Math.max(1, viewportHeight);
}

/**
 * Shift + middle-drag: the whole view (eye and target) moves straight up / down. Dragging down
 * lowers the view (so the model appears to move up), like grabbing the scene.
 */
export function verticalPan(eye: Vec3, target: Vec3, dyPixels: number, perPixel: number): { eye: Vec3; target: Vec3 } {
  const dz = -dyPixels * perPixel;
  return { eye: { ...eye, y: eye.y + dz }, target: { ...target, y: target.y + dz } };
}

/** PageUp / PageDown: one grid step up or down. */
export function stepVertical(eye: Vec3, target: Vec3, dir: 1 | -1, step = GRID3D_STEP): { eye: Vec3; target: Vec3 } {
  return { eye: { ...eye, y: eye.y + dir * step }, target: { ...target, y: target.y + dir * step } };
}

// ============================================================================================
// ELEVATION LABELS
// ============================================================================================

/** Elevation with sign and feet always shown (imperial): -0'-4", -3'-6", 12'-0". */
export function formatElevation(z: number, units: UnitSystem): string {
  const r = Math.round(z * 64) / 64;
  if (Math.abs(r) < 1 / 128) return units === 'metric' ? '±0 mm' : `±0'-0"`;
  const s = formatLength(Math.abs(r), units);
  const body = units === 'metric' || s.includes("'") ? s : `0'-${s}`;
  return r < 0 ? `-${body}` : body;
}

/** "Below grade -4'-6\"" badge text for the camera height. */
export function belowGradeBadge(cameraY: number, units: UnitSystem): string {
  return `Below grade ${formatElevation(cameraY - GRADE_Z, units)}`;
}

/** Friendly element name for the hover readout. */
export function elementKindLabel(e: ArchEntity | undefined): string {
  if (!e) return 'surface';
  switch (e.type) {
    case 'footing':
      return e.kind === 'wall' ? 'wall footing' : e.kind === 'pilecap' ? 'pile cap' : 'footing';
    case 'floor':
      return e.foundation ? 'slab on grade' : e.structural ? 'structural slab' : 'slab';
    case 'room':
      return 'floor finish';
    case 'wall':
      return e.structural ? 'bearing wall' : 'wall';
    case 'beam':
      return e.usage === 'joist' ? 'joist' : e.usage === 'brace' ? 'brace' : e.usage === 'rafter' ? 'rafter' : e.usage === 'purlin' ? 'purlin' : e.usage === 'ridge' ? 'ridge beam' : 'beam';
    case 'beamsystem':
      return 'joist';
    case 'column':
      return 'column';
    case 'rebar':
    case 'areareinf':
      return 'rebar';
    case 'stair':
      return 'stair';
    case 'roof':
      return 'roof';
    case 'door':
      return 'door';
    case 'window':
      return 'window';
    case 'truss':
      return 'truss';
    case 'connection':
      return 'connection';
    case 'block':
      return e.name ? e.name.toLowerCase() : 'component';
    default:
      return e.type;
  }
}

/**
 * Hover readout: what the surface is and its elevation. Faces pointing up read "Top of …",
 * faces pointing down "Bottom of …", vertical faces "<Element> face".
 * Piles are reported from their own meshes (`part: 'pile'`).
 */
export function surfaceReadout(e: ArchEntity | undefined, normalY: number, z: number, units: UnitSystem, part?: string): string {
  const kind = part === 'pile' ? 'pile' : elementKindLabel(e);
  const el = formatElevation(z, units);
  if (normalY > 0.7) return `Top of ${kind}  ${el}`;
  if (normalY < -0.7) return `Bottom of ${kind}  ${el}`;
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} face  ${el}`;
}

// ============================================================================================
// SECTION BOX (BX)
// ============================================================================================

export interface SectionBox {
  min: Vec3;
  max: Vec3;
}

export type BoxFace = 'xmin' | 'xmax' | 'ymin' | 'ymax' | 'zmin' | 'zmax';
export const BOX_FACES: BoxFace[] = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];
export const SECTION_BOX_MIN_SIZE = 6;

/** A plane in three.js form: points kept where normal · p + constant ≥ 0. */
export interface ClipPlane {
  normal: Vec3;
  constant: number;
}

/** Initial box around model extents (three.js coordinates), padded on every side. */
export function sectionBoxAround(min: Vec3, max: Vec3, pad = 12): SectionBox {
  return {
    min: { x: min.x - pad, y: min.y - pad, z: min.z - pad },
    max: { x: max.x + pad, y: max.y + pad, z: max.z + pad },
  };
}

/** The six inward-facing clipping planes of the box (for renderer.clippingPlanes). */
export function sectionBoxPlanes(b: SectionBox): ClipPlane[] {
  return [
    { normal: { x: 1, y: 0, z: 0 }, constant: -b.min.x },
    { normal: { x: -1, y: 0, z: 0 }, constant: b.max.x },
    { normal: { x: 0, y: 1, z: 0 }, constant: -b.min.y },
    { normal: { x: 0, y: -1, z: 0 }, constant: b.max.y },
    { normal: { x: 0, y: 0, z: 1 }, constant: -b.min.z },
    { normal: { x: 0, y: 0, z: -1 }, constant: b.max.z },
  ];
}

export function insideSectionBox(p: Vec3, b: SectionBox, tol = 0.01): boolean {
  return p.x >= b.min.x - tol && p.x <= b.max.x + tol && p.y >= b.min.y - tol && p.y <= b.max.y + tol && p.z >= b.min.z - tol && p.z <= b.max.z + tol;
}

/** Axis and direction a face handle moves along (outward normal). */
export function faceAxis(face: BoxFace): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } {
  return { axis: face[0] as 'x' | 'y' | 'z', sign: face.endsWith('max') ? 1 : -1 };
}

/** Centre of a face (handle position). */
export function faceCenter(b: SectionBox, face: BoxFace): Vec3 {
  const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
  const { axis, sign } = faceAxis(face);
  c[axis] = sign > 0 ? b.max[axis] : b.min[axis];
  return c;
}

/**
 * Drag one face to a new coordinate along its axis. The face never crosses the opposite face
 * (the box keeps at least SECTION_BOX_MIN_SIZE). Dragging the top (ymax) down slices the building.
 */
export function dragSectionBoxFace(b: SectionBox, face: BoxFace, value: number, minSize = SECTION_BOX_MIN_SIZE): SectionBox {
  const { axis, sign } = faceAxis(face);
  const next: SectionBox = { min: { ...b.min }, max: { ...b.max } };
  if (!Number.isFinite(value)) return next;
  if (sign > 0) next.max[axis] = Math.max(value, b.min[axis] + minSize);
  else next.min[axis] = Math.min(value, b.max[axis] - minSize);
  return next;
}

/**
 * Closest-point parameter on the face axis for a mouse ray: the handle follows the cursor along
 * its axis line (origin o, unit direction a) for the ray (origin r0, unit direction rd).
 * Returns the coordinate along the axis (the new face value), or null when the ray is parallel.
 */
export function axisValueFromRay(o: Vec3, axis: 'x' | 'y' | 'z', r0: Vec3, rd: Vec3): number | null {
  const a: Vec3 = { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 };
  const w = { x: o.x - r0.x, y: o.y - r0.y, z: o.z - r0.z };
  const dot = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;
  const b = dot(a, rd);
  const c = dot(rd, rd);
  const d = dot(a, w);
  const e = dot(rd, w);
  const den = c - b * b; // a·a = 1
  if (Math.abs(den) < 1e-6) return null;
  const s = (b * e - c * d) / den; // parameter along the axis from o
  return o[axis] + s;
}

// ============================================================================================
// CHECKS UNDER THE BUILDING
// ============================================================================================

export type BelowGradeIssueKind = 'no-footing' | 'base-gap' | 'base-overlap' | 'wall-no-footing' | 'slab-unsupported' | 'floating';

export interface BelowGradeIssue {
  id: string;
  kind: BelowGradeIssueKind;
  entityId: string;
  message: string;
  /** marker position: plan x / y and elevation z */
  at: { x: number; y: number; z: number };
}

export const ISSUE_LABEL: Record<BelowGradeIssueKind, string> = {
  'no-footing': 'Column without footing',
  'base-gap': 'Gap at column base',
  'base-overlap': 'Column base overlaps footing',
  'wall-no-footing': 'Bearing wall without footing',
  'slab-unsupported': 'Slab not supported',
  floating: 'Floating element',
};

const TOL = 0.75;

const orient = (p: Point[]) => (signedArea(p) >= 0 ? p : [...p].reverse());
const grow = (p: Point[], d: number) => (p.length >= 3 ? offsetPolygon(orient(p), d) : p);
const segDist = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Plan rectangle of a wall (centre line ± half thickness). */
export function wallBand(w: Pick<WallEntity, 'start' | 'end' | 'thickness'>, extra = 0): Point[] {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const h = w.thickness / 2 + extra;
  const nx = -uy * h;
  const ny = ux * h;
  const ex = ux * extra;
  const ey = uy * extra;
  return [
    { x: w.start.x - ex + nx, y: w.start.y - ey + ny },
    { x: w.end.x + ex + nx, y: w.end.y + ey + ny },
    { x: w.end.x + ex - nx, y: w.end.y + ey - ny },
    { x: w.start.x - ex - nx, y: w.start.y - ey - ny },
  ];
}

export function wallZRange(model: Pick<ArchModel, 'levels'>, w: WallEntity): { z0: number; z1: number } {
  const z0 = levelElevationOf(model, w.levelId) + (w.baseOffset || 0);
  return { z0, z1: z0 + (w.height || 108) };
}

export function slabZRange(model: Pick<ArchModel, 'levels'>, f: FloorEntity): { zTop: number; zBot: number } {
  const zTop = levelElevationOf(model, f.levelId);
  return { zTop, zBot: zTop - Math.max(1, f.thickness || 6) };
}

/** Fraction of a wall's centre line that lies inside any of the polygons (sampled). */
function coverage(w: Pick<WallEntity, 'start' | 'end'>, polys: Point[][]): number {
  const L = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  const n = Math.max(2, Math.ceil(L / 12));
  let ok = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t };
    if (polys.some((q) => q.length >= 3 && pointInPolygon(p, q))) ok++;
  }
  return ok / (n + 1);
}

/**
 * Checks shown when looking under the building:
 *  1. a column at the bottom of the building with no footing below it
 *  2. a gap or overlap between a column base and the top of its footing
 *  3. a structural (bearing) wall at the bottom of the building without a wall footing
 *  4. a slab whose bottom does not sit on its foundation, beams or walls
 *  5. floating elements (upper-level columns / walls) not touching anything below
 */
export function belowGradeChecks(model: Pick<ArchModel, 'levels' | 'entities' | 'settings'> & Partial<Pick<ArchModel, 'structureJoins'>>): BelowGradeIssue[] {
  const units = model.settings?.units ?? 'imperial';
  const fmt = (v: number) => formatLength(Math.abs(v), units);
  const ents = model.entities;
  const levels = [...(model.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const lowestElev = levels[0]?.elevation ?? 0;
  const columns = ents.filter((e): e is ColumnEntity => e.type === 'column');
  const footings = ents.filter((e): e is FootingEntity => e.type === 'footing');
  const walls = ents.filter((e): e is WallEntity => e.type === 'wall');
  const floors = ents.filter((e): e is FloorEntity => e.type === 'floor');
  const beams = ents.filter((e): e is BeamEntity => e.type === 'beam' && (e.usage === 'beam' || e.usage === 'joist'));
  const ftgInfo = footings.map((f) => ({ f, poly: footingPlanOutline(f, ents), z: footingZRange(model, f) }));
  const bm = { entities: ents, structureJoins: model.structureJoins } as Pick<ArchModel, 'entities' | 'structureJoins'>;
  const beamInfo = beams.map((b) => ({ b, poly: beamPlanOutline(bm, b), z: beamVertical(model, b) }));
  const colInfo = columns.map((c) => ({ c, z: columnZRange(model, c), poly: columnFootprint(c) }));
  const wallInfo = walls.map((w) => ({ w, z: wallZRange(model, w), poly: wallBand(w) }));
  const slabInfo = floors.map((f) => ({ f, z: slabZRange(model, f) }));
  const out: BelowGradeIssue[] = [];
  const atGround = (z: number) => z <= Math.max(lowestElev, GRADE_Z) + 12;

  /** Something whose top is at height z (within tolerance) under plan point p. */
  const supportAtPoint = (p: Point, z: number, selfId: string): boolean => {
    for (const { c, z: cz, poly } of colInfo) if (c.id !== selfId && Math.abs(cz.z1 - z) <= TOL + 0.5 && pointInPolygon(p, grow(poly, 1))) return true;
    for (const { b, z: bz, poly } of beamInfo) if (b.id !== selfId && z >= bz.zTop - TOL - 1 && z <= bz.zTop + TOL && poly.length >= 3 && pointInPolygon(p, grow(poly, 1))) return true;
    for (const { w, z: wz, poly } of wallInfo) if (w.id !== selfId && z >= wz.z1 - TOL - 1 && z <= wz.z1 + TOL + 12 && pointInPolygon(p, grow(poly, 1))) return true;
    for (const { f, z: sz } of slabInfo) if (f.id !== selfId && z >= sz.zBot - TOL && z <= sz.zTop + TOL && f.polygon.length >= 3 && pointInPolygon(p, f.polygon)) return true;
    for (const { f, z: fz, poly } of ftgInfo) if (f.id !== selfId && Math.abs(fz.zTop - z) <= TOL + 6 && poly.length >= 3 && pointInPolygon(p, grow(poly, 1))) return true;
    return false;
  };

  // 1 + 2 + 5: columns
  for (const { c, z } of colInfo) {
    const under = ftgInfo.filter(({ f, poly }) => f.columnId === c.id || (poly.length >= 3 && pointInPolygon(c.position, poly)));
    if (atGround(z.z0)) {
      if (!under.length) {
        out.push({ id: `nofooting-${c.id}`, kind: 'no-footing', entityId: c.id, message: 'Column has no footing below it', at: { x: c.position.x, y: c.position.y, z: z.z0 } });
        continue;
      }
      // the footing whose top is closest to the column base
      const best = under.reduce((a, b) => (Math.abs(b.z.zTop - z.z0) < Math.abs(a.z.zTop - z.z0) ? b : a));
      const gap = z.z0 - best.z.zTop;
      if (gap > TOL) out.push({ id: `gap-${c.id}`, kind: 'base-gap', entityId: c.id, message: `${fmt(gap)} gap between column base and top of footing`, at: { x: c.position.x, y: c.position.y, z: (z.z0 + best.z.zTop) / 2 } });
      else if (gap < -TOL) {
        const pen = Math.min(-gap, best.z.zTop - best.z.zBot);
        out.push({ id: `overlap-${c.id}`, kind: 'base-overlap', entityId: c.id, message: `Column base overlaps the footing by ${fmt(pen)}`, at: { x: c.position.x, y: c.position.y, z: best.z.zTop } });
      }
    } else if (!supportAtPoint(c.position, z.z0, c.id)) {
      out.push({ id: `float-${c.id}`, kind: 'floating', entityId: c.id, message: 'Column is not supported by anything below', at: { x: c.position.x, y: c.position.y, z: z.z0 } });
    }
  }

  // 3 + 5: walls
  const wallFootingPolys = ftgInfo.filter(({ f }) => f.kind === 'wall').map(({ poly }) => grow(poly, 1));
  for (const { w, z } of wallInfo) {
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    if (atGround(z.z0)) {
      if (!w.structural) continue;
      const own = ftgInfo.some(({ f }) => f.kind === 'wall' && f.wallId === w.id);
      if (!own && coverage(w, wallFootingPolys) < 0.8) out.push({ id: `wallftg-${w.id}`, kind: 'wall-no-footing', entityId: w.id, message: 'Bearing wall has no wall footing', at: { x: mid.x, y: mid.y, z: z.z0 } });
      continue;
    }
    // upper-level wall: something under at least part of its length
    const L = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    const n = Math.max(2, Math.ceil(L / 24));
    let ok = false;
    for (let i = 0; i <= n && !ok; i++) {
      const t = i / n;
      ok = supportAtPoint({ x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t }, z.z0, w.id);
    }
    if (!ok) out.push({ id: `float-${w.id}`, kind: 'floating', entityId: w.id, message: 'Wall is not supported by anything below', at: { x: mid.x, y: mid.y, z: z.z0 } });
  }

  // 4: slabs
  for (const { f, z } of slabInfo) {
    if (f.polygon.length < 3) continue;
    if (f.foundation) {
      // slab on grade bears on the ground: it must reach grade (not float above it)
      if (z.zBot > GRADE_Z + 12) out.push({ id: `slab-${f.id}`, kind: 'slab-unsupported', entityId: f.id, message: `Slab on grade sits ${fmt(z.zBot - GRADE_Z)} above grade`, at: { ...centroid(f.polygon), z: z.zBot } });
      continue;
    }
    if (atGround(z.zBot + 12) && z.zBot <= GRADE_Z + 12) continue; // ground-bearing floor at the lowest level
    const poly = f.polygon;
    const inside = (q: Point[]) => q.some((p) => pointInPolygon(p, grow(poly, 2))) || poly.some((p) => pointInPolygon(p, grow(q, 2)));
    const touches = (zTop: number) => zTop >= z.zBot - TOL && zTop <= z.zTop + TOL;
    const supported =
      beamInfo.some(({ z: bz, poly: bp }) => bp.length >= 3 && touches(bz.zTop) && inside(bp)) ||
      wallInfo.some(({ w, z: wz, poly: wp }) => w.levelId !== f.levelId && touches(wz.z1) && inside(wp)) ||
      wallInfo.some(({ z: wz, poly: wp }) => wz.z0 < z.zBot - TOL && wz.z1 >= z.zBot - TOL && inside(wp)) ||
      colInfo.some(({ z: cz, c }) => touches(cz.z1) && pointInPolygon(c.position, grow(poly, 2)));
    if (!supported) out.push({ id: `slab-${f.id}`, kind: 'slab-unsupported', entityId: f.id, message: 'Slab bottom does not sit on beams, walls or columns', at: { ...centroid(poly), z: z.zBot } });
  }
  return out;
}

function centroid(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) };
}

export function issueCounts(issues: BelowGradeIssue[]): Array<{ kind: BelowGradeIssueKind; label: string; count: number }> {
  const m = new Map<BelowGradeIssueKind, number>();
  for (const i of issues) m.set(i.kind, (m.get(i.kind) || 0) + 1);
  return (Object.keys(ISSUE_LABEL) as BelowGradeIssueKind[]).filter((k) => m.has(k)).map((k) => ({ kind: k, label: ISSUE_LABEL[k], count: m.get(k)! }));
}

// ============================================================================================
// 2D UNDERLAY
// ============================================================================================

/** 'none' | 'below' (the level under this one) | 'foundation' | 'level:<id>' */
export type UnderlayChoice = string;

export type ResolvedUnderlay = { kind: 'none' } | { kind: 'level'; levelId: string; name: string } | { kind: 'foundation'; levelId: string; name: string };

export function resolveUnderlay(choice: UnderlayChoice | undefined, levels: Array<{ id: string; name: string; elevation: number }>, activeLevelId: string): ResolvedUnderlay {
  const sorted = [...levels].sort((a, b) => a.elevation - b.elevation);
  const c = choice ?? 'below';
  if (c === 'none') return { kind: 'none' };
  if (c === 'foundation') {
    const lv = sorted[0];
    return lv ? { kind: 'foundation', levelId: lv.id, name: 'Foundation' } : { kind: 'none' };
  }
  if (c === 'below') {
    const i = sorted.findIndex((l) => l.id === activeLevelId);
    const lv = i > 0 ? sorted[i - 1] : null;
    return lv ? { kind: 'level', levelId: lv.id, name: lv.name } : { kind: 'none' };
  }
  if (c.startsWith('level:')) {
    const lv = sorted.find((l) => l.id === c.slice(6));
    if (!lv || lv.id === activeLevelId) return { kind: 'none' };
    return { kind: 'level', levelId: lv.id, name: lv.name };
  }
  return { kind: 'none' };
}

// footings belong to the Foundation underlay, not to a level's plan
const UNDERLAY_MODEL_TYPES = new Set(['wall', 'door', 'window', 'wallopening', 'column', 'floor', 'stair', 'beam', 'beamsystem', 'curtainwall', 'railing', 'balcony']);
const FOUNDATION_TYPES = new Set(['footing', 'column', 'floor', 'wall']);

/** Model elements drawn in the underlay (no annotation: text, dimensions, tags, rooms, grids). */
export function underlayEntities(entities: ArchEntity[], u: ResolvedUnderlay): ArchEntity[] {
  if (u.kind === 'none') return [];
  if (u.kind === 'foundation') {
    return entities.filter((e) => {
      if ((e.levelId || 'level-1') !== u.levelId || !FOUNDATION_TYPES.has(e.type)) return false;
      if (e.type === 'floor') return !!e.foundation;
      if (e.type === 'wall') return !!e.structural;
      return true;
    });
  }
  return entities.filter((e) => (e.levelId || 'level-1') === u.levelId && UNDERLAY_MODEL_TYPES.has(e.type));
}

/** Plan supports offered by the underlay: walls, columns, beams and footings. */
export function supportPolygons(underlay: ArchEntity[], all: ArchEntity[], structureJoins?: ArchModel['structureJoins']): Point[][] {
  const out: Point[][] = [];
  for (const e of underlay) {
    if (e.type === 'wall') out.push(wallBand(e));
    else if (e.type === 'column') out.push(columnFootprint(e));
    else if (e.type === 'footing') out.push(footingPlanOutline(e, all));
    else if (e.type === 'beam' && (e.usage === 'beam' || e.usage === 'joist')) out.push(beamPlanOutline({ entities: all, structureJoins } as Pick<ArchModel, 'entities' | 'structureJoins'>, e));
  }
  return out.filter((p) => p.length >= 3).map((p) => grow(p, 1));
}

export interface SupportMismatch {
  entityId: string;
  kind: 'wall' | 'column';
  /** unsupported runs of a wall's centre line (whole outline for a column) */
  segments: Array<[Point, Point]>;
  outline: Point[];
}

/**
 * Load-bearing elements on the current level (structural walls, columns) that have nothing under
 * them in the underlay. Walls are sampled along the centre line; each unsupported run is returned.
 */
export function supportMismatches(current: ArchEntity[], supports: Point[][], minRun = 12): SupportMismatch[] {
  const out: SupportMismatch[] = [];
  const isSupported = (p: Point) => supports.some((q) => pointInPolygon(p, q));
  for (const e of current) {
    if (e.type === 'column') {
      if (!isSupported(e.position)) out.push({ entityId: e.id, kind: 'column', segments: [], outline: columnFootprint(e) });
      continue;
    }
    if (e.type !== 'wall' || !e.structural) continue;
    const L = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
    if (L < 1) continue;
    const n = Math.max(2, Math.ceil(L / 6));
    const at = (t: number) => ({ x: e.start.x + (e.end.x - e.start.x) * t, y: e.start.y + (e.end.y - e.start.y) * t });
    const segs: Array<[Point, Point]> = [];
    let runStart: number | null = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ok = isSupported(at(t));
      if (!ok && runStart === null) runStart = Math.max(0, t - 0.5 / n);
      if ((ok || i === n) && runStart !== null) {
        const t1 = ok ? Math.min(1, t - 0.5 / n) : 1;
        if ((t1 - runStart) * L >= minRun) segs.push([at(runStart), at(t1)]);
        runStart = null;
      }
    }
    if (segs.length) out.push({ entityId: e.id, kind: 'wall', segments: segs, outline: wallBand(e) });
  }
  return out;
}

/** Halftone a plan: light gray strokes, faint fills, no text. Pans and zooms with the plan. */
export function halftonePrims(prims: PlanPrim[], dark: boolean): PlanPrim[] {
  const ink = dark ? '#8a8580' : '#a8a29e';
  const fill = dark ? 'rgba(168,162,158,0.10)' : 'rgba(120,113,108,0.10)';
  const out: PlanPrim[] = [];
  for (const p of prims) {
    if (p.k === 'text') continue;
    out.push({ ...p, id: undefined, stroke: p.stroke ? ink : p.stroke, fill: p.fill ? fill : p.fill, w: Math.min(p.w, 0.25), opacity: undefined });
  }
  return out;
}

/** Distance from a point to a polyline (used to test markers / outlines). */
export function distToPolyline(p: Point, pts: Point[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]));
  return d;
}
