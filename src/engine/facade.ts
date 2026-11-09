/**
 * Facade engine (pure functions): exterior finishes, wall profiles (roof-attached tops, parapets),
 * curtain-wall grids, window/door styles and orthographic N/S/E/W elevations.
 *
 * Elevations are produced as plot primitives (`PlanPrim`) in elevation coordinates
 * (x = u along the view, y = −z so +y is down), painter-sorted far → near, so the same output
 * drives the on-screen elevation view, sheets/PDF and DXF export. Hit regions are returned for
 * PAINT, SPLIT FACE, curtain-wall cell editing and tags.
 */
import type {
  ArchModel,
  BalconyEntity,
  CurtainGrid,
  CurtainPanelType,
  DoorEntity,
  DormerEntity,
  ElevationDirection,
  ExteriorFinish,
  FinishBand,
  InteriorFinish,
  Point,
  RailingEntity,
  RoofEntity,
  RoofMaterial,
  SkylightEntity,
  SweepEntity,
  WallEntity,
  WindowDivisions,
  WindowEntity,
  DoorPanelStyle,
  WallOpeningEntity,
} from '../types/model';
import { computeWallCornersWithJoins, formatLength } from './geometry';
import { exteriorSideOf, headPoints } from './openings';
import { doorLayout } from './doorStyles';
import type { PlanPrim, PrimStyle } from './planPrimitives';
import {
  RoofGeometry,
  dormerGeometry,
  formatSlope,
  getRoofGeometry,
  pointInPolygon,
  skylightOutline,
  wallTopProfile,
  P3,
} from './roof';

// ============================================================================================
// FINISHES & MATERIALS
// ============================================================================================

export interface FinishDef {
  id: ExteriorFinish;
  label: string;
  color: string; // base colour (elevation fill / 3D texture)
  joint: string; // hatch / joint colour
}

export const EXTERIOR_FINISHES: FinishDef[] = [
  { id: 'brick', label: 'Brick', color: '#b5654d', joint: '#7c3a2a' },
  { id: 'lap-siding', label: 'Lap Siding', color: '#e9e4da', joint: '#8a8378' },
  { id: 'board-batten', label: 'Board & Batten', color: '#dedbd3', joint: '#7d786f' },
  { id: 'stucco', label: 'Stucco', color: '#f1e9d8', joint: '#a39a86' },
  { id: 'stone', label: 'Stone', color: '#b8b0a3', joint: '#6e665b' },
  { id: 'wood-cladding', label: 'Wood Cladding', color: '#b98556', joint: '#7a5232' },
  { id: 'fiber-cement', label: 'Fiber-Cement Panel', color: '#a9b0b8', joint: '#5f666e' },
  { id: 'concrete', label: 'Concrete', color: '#c9c7c2', joint: '#8a8781' },
  { id: 'log-round', label: 'Full-Scribe Round Log', color: '#c08a55', joint: '#6b4526' },
  { id: 'log-d', label: 'D-Log', color: '#c99561', joint: '#6b4526' },
  { id: 'log-chinked', label: 'Square Log + Chinking', color: '#8a6240', joint: '#f3efe6' },
  { id: 'cedar-bb', label: 'Cedar Board & Batten', color: '#a4623d', joint: '#6d3c22' },
];

/** Log course height (inches) drawn by the log finishes. */
export const LOG_COURSE: Partial<Record<ExteriorFinish, number>> = { 'log-round': 9, 'log-d': 7.5, 'log-chinked': 10 };

export const INTERIOR_FINISHES: Array<{ id: InteriorFinish; label: string }> = [
  { id: 'paint', label: 'Painted Gypsum' },
  { id: 'plaster', label: 'Plaster' },
  { id: 'wood-panel', label: 'Wood Paneling' },
  { id: 'tile', label: 'Ceramic Tile' },
  { id: 'exposed', label: 'Exposed Structure' },
  { id: 'knotty-pine', label: 'Knotty Pine T&G' },
  { id: 'log-interior', label: 'Log (interior face)' },
];

export const ROOF_MATERIALS: Array<{ id: RoofMaterial; label: string; color: string; joint: string }> = [
  { id: 'asphalt-shingle', label: 'Asphalt Shingle', color: '#5b5f66', joint: '#33363b' },
  { id: 'standing-seam', label: 'Standing-Seam Metal', color: '#7d8a96', joint: '#4b5560' },
  { id: 'clay-tile', label: 'Clay Tile', color: '#b85c38', joint: '#7a3519' },
  { id: 'slate', label: 'Slate', color: '#4b5563', joint: '#272d36' },
  { id: 'membrane', label: 'Flat Membrane', color: '#d4d4d8', joint: '#a1a1aa' },
  { id: 'green-roof', label: 'Green Roof', color: '#6d9a4a', joint: '#3f6527' },
];

export const finishDef = (f?: ExteriorFinish): FinishDef => EXTERIOR_FINISHES.find((d) => d.id === f) || EXTERIOR_FINISHES[1];
export const roofMaterialDef = (m?: RoofMaterial) => ROOF_MATERIALS.find((d) => d.id === m) || ROOF_MATERIALS[0];

/** Default exterior finish from the wall type (glass/curtain walls have none). */
export function defaultExteriorFinish(wall: WallEntity): ExteriorFinish {
  if (wall.wallTypeId === 'wt-conc-8') return 'concrete';
  if (wall.wallTypeId === 'wt-log-round-10') return 'log-round';
  if (wall.wallTypeId === 'wt-log-d-8') return 'log-d';
  if (wall.wallTypeId === 'wt-log-square-8') return 'log-chinked';
  if (wall.wallTypeId === 'wt-cabin-bb') return 'cedar-bb';
  return 'lap-siding';
}

export function isCurtainWall(wall: WallEntity): boolean {
  return !!wall.curtain || wall.wallTypeId === 'wt-curtain';
}

export const DEFAULT_CURTAIN: CurtainGrid = {
  hSpacing: 48,
  vSpacing: 48,
  mullionSize: 2.5,
  mullionColor: '#334155',
};

export function curtainOf(wall: WallEntity): CurtainGrid {
  return { ...DEFAULT_CURTAIN, ...(wall.curtain || {}) };
}

/** Finish bands of a wall's exterior face (heights relative to the wall base), bottom to top. */
export function wallFinishBands(wall: WallEntity, wallHeight: number): Array<{ z0: number; z1: number; finish: ExteriorFinish; index: number }> {
  const top = wall.exteriorFinish || defaultExteriorFinish(wall);
  const bands = (wall.finishBands || []).filter((b) => b.upTo > 0 && b.upTo < wallHeight).sort((a, b) => a.upTo - b.upTo);
  const out: Array<{ z0: number; z1: number; finish: ExteriorFinish; index: number }> = [];
  let z = 0;
  bands.forEach((b, i) => {
    if (b.upTo > z) out.push({ z0: z, z1: b.upTo, finish: b.finish, index: i });
    z = b.upTo;
  });
  out.push({ z0: z, z1: Math.max(z, wallHeight), finish: top, index: bands.length });
  return out;
}

/** Applies a finish to one band (or the whole face) of a wall's exterior. */
export function paintWallBand(wall: WallEntity, bandIndex: number | null, finish: ExteriorFinish): WallEntity {
  const bands = (wall.finishBands || []).slice().sort((a, b) => a.upTo - b.upTo);
  if (bandIndex === null || bandIndex >= bands.length) return { ...wall, exteriorFinish: finish };
  const next: FinishBand[] = bands.map((b, i) => (i === bandIndex ? { ...b, finish } : b));
  return { ...wall, finishBands: next };
}

/** SPLIT FACE: adds a horizontal split at `height` above the wall base. The part below keeps
 *  the finish it had at that height. */
export function splitWallFace(wall: WallEntity, height: number, wallHeight: number): WallEntity {
  if (height <= 1 || height >= wallHeight - 1) return wall;
  const bands = wallFinishBands(wall, wallHeight);
  const hit = bands.find((b) => height > b.z0 && height < b.z1);
  if (!hit) return wall;
  const existing = (wall.finishBands || []).slice();
  if (existing.some((b) => Math.abs(b.upTo - height) < 0.5)) return wall;
  existing.push({ upTo: height, finish: hit.finish });
  existing.sort((a, b) => a.upTo - b.upTo);
  return { ...wall, finishBands: existing };
}

// ============================================================================================
// WALL GEOMETRY HELPERS
// ============================================================================================

const levelElevation = (model: ArchModel, levelId?: string) =>
  (model.levels || []).find((l) => l.id === (levelId || 'level-1'))?.elevation ?? 0;

/** Plan centre of the building on a level (used to tell exterior from interior faces). */
/** 'left' or 'right' of the start→end direction is the exterior. */
export function wallExteriorSide(wall: WallEntity, sameLevelWalls: WallEntity[]): 'left' | 'right' {
  return exteriorSideOf(wall, sameLevelWalls);
}

export interface WallProfile {
  baseZ: number; // absolute base height
  /** Top line along the wall centre line: s from start (0..L), absolute z. */
  top: Array<{ s: number; z: number }>;
  attached: boolean;
  length: number;
}

/** Absolute base and top profile of a wall (roof-attached tops follow the roof underside). */
export function wallProfile(model: ArchModel, wall: WallEntity): WallProfile {
  const base = levelElevation(model, wall.levelId) + (wall.baseOffset || 0);
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const flatTop = base + (wall.height || 108) + (wall.parapetHeight || 0);
  if (wall.attachedRoofId) {
    const roof = model.entities.find((e): e is RoofEntity => e.type === 'roof' && e.id === wall.attachedRoofId);
    if (roof) {
      const g = getRoofGeometry(roof, levelElevation(model, roof.levelId));
      const prof = wallTopProfile(wall, g, base + (wall.height || 108));
      if (prof.length >= 2) return { baseZ: base, top: prof.map((p) => ({ s: p.s, z: Math.max(base + 12, p.z) })), attached: true, length: L };
    }
  }
  return { baseZ: base, top: [{ s: 0, z: flatTop }, { s: L, z: flatTop }], attached: false, length: L };
}

/** Top height at a position along the wall (linear between profile points). */
export function profileZ(prof: WallProfile, s: number): number {
  const t = prof.top;
  if (s <= t[0].s) return t[0].z;
  for (let i = 1; i < t.length; i++) {
    if (s <= t[i].s) {
      const f = (s - t[i - 1].s) / Math.max(1e-9, t[i].s - t[i - 1].s);
      return t[i - 1].z + (t[i].z - t[i - 1].z) * f;
    }
  }
  return t[t.length - 1].z;
}

/** Cells of a curtain wall grid along s (0..L) and height (0..H). */
export function curtainCells(wall: WallEntity, L: number, H: number): { cols: number[]; rows: number[]; type: (c: number, r: number) => CurtainPanelType } {
  const g = curtainOf(wall);
  const nc = Math.max(1, Math.round(L / Math.max(6, g.vSpacing)));
  const nr = Math.max(1, Math.round(H / Math.max(6, g.hSpacing)));
  const cols = Array.from({ length: nc + 1 }, (_, i) => (L * i) / nc);
  const rows = Array.from({ length: nr + 1 }, (_, i) => (H * i) / nr);
  return { cols, rows, type: (c, r) => g.panels?.[`${c},${r}`] || 'glass' };
}

export const DIVISIONS: Record<WindowDivisions, [number, number]> = {
  '1x1': [1, 1],
  '2x1': [2, 1],
  '2x2': [2, 2],
  '3x2': [3, 2],
};

// ============================================================================================
// ELEVATIONS
// ============================================================================================

export interface ViewBasis {
  look: Point; // plan direction the viewer looks
  u: (p: Point) => number; // horizontal coordinate (viewer's right = +u)
  depth: (p: Point) => number; // distance from the viewer (bigger = farther)
}

export function viewBasis(dir: ElevationDirection): ViewBasis {
  switch (dir) {
    case 'north':
      return { look: { x: 0, y: 1 }, u: (p) => -p.x, depth: (p) => p.y };
    case 'south':
      return { look: { x: 0, y: -1 }, u: (p) => p.x, depth: (p) => -p.y };
    case 'east':
      return { look: { x: -1, y: 0 }, u: (p) => -p.y, depth: (p) => -p.x };
    case 'west':
    default:
      return { look: { x: 1, y: 0 }, u: (p) => p.y, depth: (p) => p.x };
  }
}

export type ElevationTarget =
  | { kind: 'wall'; wallId: string; exterior: boolean; band: number | null; z0: number; z1: number }
  | { kind: 'cw-cell'; wallId: string; col: number; row: number }
  | { kind: 'roof'; roofId: string }
  | { kind: 'window'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'wallopening'; id: string };

export interface ElevationHit {
  poly: Point[]; // elevation coords (u, −z)
  depth: number;
  target: ElevationTarget;
}

export interface ElevationDrawing {
  prims: PlanPrim[];
  hits: ElevationHit[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Converts a plan point + height into elevation coordinates. */
  project: (p: Point, z: number) => Point;
}

export interface ElevationOptions {
  /** Paper mm per model inch — sizes annotation (ticks, text offsets) like a plotted view. */
  mmPerIn: number;
  shading?: boolean;
  shadows?: boolean;
  annotations?: boolean;
  /** Draw finish hatches (on by default). */
  hatches?: boolean;
}

interface Item {
  depth: number;
  prims: PlanPrim[];
}

const INK = '#1c1917';
const INK_SOFT = '#44403c';

const shade = (hex: string, k: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((1 << 24) | (c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
};

/** Clips segment a→b to a polygon (even-odd), returning the inside pieces. */
export function clipSegmentToPolygon(a: Point, b: Point, poly: Point[]): Array<[Point, Point]> {
  const ts: number[] = [0, 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: Array<[Point, Point]> = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1e-9) continue;
    const m = (ts[i] + ts[i + 1]) / 2;
    if (pointInPolygon({ x: a.x + dx * m, y: a.y + dy * m }, poly)) {
      out.push([
        { x: a.x + dx * ts[i], y: a.y + dy * ts[i] },
        { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] },
      ]);
    }
  }
  return out;
}

/** Deterministic pseudo-random in [0,1) from a seed and index. */
const rnd = (seed: number, i: number) => {
  let x = Math.imul(seed ^ (i * 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Finish hatch linework for a face polygon in elevation coords (x = u, y = −z). */
export function finishHatch(finish: ExteriorFinish, poly: Point[], seedKey: string): PlanPrim[] {
  if (poly.length < 3) return [];
  const def = finishDef(finish);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const out: PlanPrim[] = [];
  const st: PrimStyle = { stroke: def.joint, w: 0.1 };
  const seg = (a: Point, b: Point, style: PrimStyle = st) => {
    for (const [p, q] of clipSegmentToPolygon(a, b, poly)) out.push({ k: 'poly', pts: [p, q], closed: false, ...style });
  };
  const seed = hashStr(seedKey);
  // z grows upward: rows from the bottom (maxY) up
  const rows = (h: number, fn: (y: number, i: number) => void) => {
    let i = 0;
    for (let y = maxY - h; y > minY - 1e-6 && i < 400; y -= h, i++) fn(y, i);
  };
  const cols = (w: number, fn: (x: number, i: number) => void) => {
    let i = 0;
    for (let x = Math.floor(minX / w) * w; x <= maxX && i < 600; x += w, i++) if (x > minX) fn(x, i);
  };
  switch (finish) {
    case 'log-round':
    case 'log-d':
    case 'log-chinked': {
      // stacked courses: a joint line per log (chinking: a white band), a shading line under each round log
      const h = LOG_COURSE[finish] || 9;
      rows(h, (y) => {
        if (finish === 'log-chinked') {
          seg({ x: minX, y }, { x: maxX, y }, { stroke: def.joint, w: 0.6 });
          seg({ x: minX, y: y + 0.9 }, { x: maxX, y: y + 0.9 }, { stroke: '#6b4526', w: 0.08 });
        } else {
          seg({ x: minX, y }, { x: maxX, y }, { stroke: def.joint, w: 0.22 });
          seg({ x: minX, y: y + h * 0.25 }, { x: maxX, y: y + h * 0.25 }, { stroke: def.joint, w: 0.06, opacity: 0.5 });
        }
      });
      break;
    }
    case 'cedar-bb':
      cols(12, (x) => {
        seg({ x, y: minY }, { x, y: maxY });
        seg({ x: x + 2.5, y: minY }, { x: x + 2.5, y: maxY });
      });
      break;
    case 'brick': {
      const h = 8; // three courses shown as one 8" band with running bond joints
      rows(h, (y, i) => {
        seg({ x: minX, y }, { x: maxX, y });
        const off = i % 2 ? 8 : 0;
        for (let x = Math.floor(minX / 16) * 16 + off; x <= maxX; x += 16) if (x > minX) seg({ x, y }, { x, y: y + h });
      });
      break;
    }
    case 'lap-siding':
      rows(6, (y) => seg({ x: minX, y }, { x: maxX, y }));
      break;
    case 'board-batten':
      cols(12, (x) => {
        seg({ x, y: minY }, { x, y: maxY });
        seg({ x: x + 2, y: minY }, { x: x + 2, y: maxY });
      });
      break;
    case 'wood-cladding':
      cols(6, (x) => seg({ x, y: minY }, { x, y: maxY }));
      break;
    case 'fiber-cement':
      cols(48, (x) => seg({ x, y: minY }, { x, y: maxY }, { stroke: def.joint, w: 0.18 }));
      rows(48, (y) => seg({ x: minX, y }, { x: maxX, y }, { stroke: def.joint, w: 0.18 }));
      break;
    case 'concrete':
      cols(96, (x) => seg({ x, y: minY }, { x, y: maxY }));
      rows(48, (y) => seg({ x: minX, y }, { x: maxX, y }));
      for (let x = Math.floor(minX / 24) * 24 + 12; x < maxX; x += 24) {
        for (let y = maxY - 12; y > minY; y -= 24) {
          if (pointInPolygon({ x, y }, poly)) out.push({ k: 'circle', c: { x, y }, r: 0.7, fill: def.joint, w: 0 });
        }
      }
      break;
    case 'stucco': {
      let i = 0;
      for (let x = minX + 3; x < maxX; x += 9) {
        for (let y = minY + 3; y < maxY; y += 9) {
          const jx = x + (rnd(seed, i) - 0.5) * 7;
          const jy = y + (rnd(seed, i + 7919) - 0.5) * 7;
          i++;
          if (pointInPolygon({ x: jx, y: jy }, poly)) out.push({ k: 'circle', c: { x: jx, y: jy }, r: 0.35, fill: def.joint, w: 0 });
        }
      }
      break;
    }
    case 'stone': {
      let y = maxY;
      let i = 0;
      while (y > minY && i < 300) {
        const h = 7 + rnd(seed, i) * 6;
        const ny = y - h;
        seg({ x: minX, y: ny }, { x: maxX, y: ny });
        let x = minX + rnd(seed, i + 101) * 14;
        let j = 0;
        while (x < maxX && j < 400) {
          seg({ x, y: ny }, { x, y });
          x += 12 + rnd(seed, i * 31 + j) * 16;
          j++;
        }
        y = ny;
        i++;
      }
      break;
    }
  }
  return out;
}

/** Roof material linework on a projected roof face. */
function roofHatch(material: RoofMaterial | undefined, poly: Point[], face3d: P3[], project: (p: Point, z: number) => Point, downDir: Point, joint: string): PlanPrim[] {
  if (poly.length < 3) return [];
  const out: PlanPrim[] = [];
  const st: PrimStyle = { stroke: joint, w: 0.1 };
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const seg = (a: Point, b: Point) => {
    for (const [p, q] of clipSegmentToPolygon(a, b, poly)) out.push({ k: 'poly', pts: [p, q], closed: false, ...st });
  };
  const m = material || 'asphalt-shingle';
  if (m === 'membrane') return out;
  if (m === 'green-roof') {
    for (let x = minX + 4; x < maxX; x += 10) for (let y = minY + 3; y < maxY; y += 7) if (pointInPolygon({ x, y }, poly)) out.push({ k: 'circle', c: { x, y }, r: 0.9, fill: joint, w: 0 });
    return out;
  }
  if (m === 'standing-seam') {
    // seams run down the slope: project 3D lines spaced 16" across the face
    const across = { x: -downDir.y, y: downDir.x };
    const c = face3d.reduce((a, p) => ({ x: a.x + p.x / face3d.length, y: a.y + p.y / face3d.length }), { x: 0, y: 0 });
    const ext = Math.max(...face3d.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) + 24;
    const zAt = (p: Point) => {
      // plane through the face (least squares over 3 points)
      const [a, b, d] = face3d;
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = d.x - a.x, vy = d.y - a.y, vz = d.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      return Math.abs(nz) < 1e-9 ? a.z : a.z - (nx * (p.x - a.x) + ny * (p.y - a.y)) / nz;
    };
    for (let k = -ext; k <= ext; k += 16) {
      const o = { x: c.x + across.x * k, y: c.y + across.y * k };
      const p1 = { x: o.x - downDir.x * ext, y: o.y - downDir.y * ext };
      const p2 = { x: o.x + downDir.x * ext, y: o.y + downDir.y * ext };
      seg(project(p1, zAt(p1)), project(p2, zAt(p2)));
    }
    return out;
  }
  const spacing = m === 'slate' ? 7 : m === 'clay-tile' ? 9 : 6;
  let i = 0;
  for (let y = maxY - spacing; y > minY && i < 300; y -= spacing, i++) {
    seg({ x: minX, y }, { x: maxX, y });
    if (m === 'clay-tile') for (let x = minX + (i % 2) * 5; x < maxX; x += 10) seg({ x, y }, { x, y: y + spacing });
  }
  return out;
}

const centroid = (pts: Point[]) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });

/** Computes the orthographic elevation drawing for one direction. */
export function computeElevation(model: ArchModel, dir: ElevationDirection, opts: ElevationOptions): ElevationDrawing {
  const vb = viewBasis(dir);
  const project = (p: Point, z: number): Point => ({ x: vb.u(p), y: -z });
  const paper = (mm: number) => mm / Math.max(1e-6, opts.mmPerIn);
  const shading = opts.shading !== false;
  const hatches = opts.hatches !== false;
  const items: Item[] = [];
  const hits: ElevationHit[] = [];
  const visibleLayer = (ref: string) => {
    const l = model.layers.find((x) => x.id === ref) || model.layers.find((x) => x.name === ref);
    return l ? l.visible !== false : true;
  };
  const vis3d = model.visibility?.view3d;
  const ents = model.entities.filter((e) => visibleLayer(e.layer));
  const walls = ents.filter((e): e is WallEntity => e.type === 'wall' && vis3d?.walls !== false);
  const doors = ents.filter((e): e is DoorEntity => e.type === 'door' && vis3d?.doors !== false);
  const windows = ents.filter((e): e is WindowEntity => e.type === 'window' && vis3d?.windows !== false);
  const wallOpenings = ents.filter((e): e is WallOpeningEntity => e.type === 'wallopening');
  const roofs = ents.filter((e): e is RoofEntity => e.type === 'roof' && vis3d?.roofs !== false);
  const sweeps = ents.filter((e): e is SweepEntity => e.type === 'sweep');
  const balconies = ents.filter((e): e is BalconyEntity => e.type === 'balcony');
  const railings = ents.filter((e): e is RailingEntity => e.type === 'railing');
  const skylights = ents.filter((e): e is SkylightEntity => e.type === 'skylight');
  const dormers = ents.filter((e): e is DormerEntity => e.type === 'dormer');
  const lightK = (normalPlan: Point) => {
    if (!shading) return 1;
    // faces turned towards the viewer are lightest; a light from the viewer's upper-left
    const facing = -(normalPlan.x * vb.look.x + normalPlan.y * vb.look.y);
    return 0.82 + 0.18 * Math.max(0, facing);
  };
  const quad = (a: Point, b: Point, z0a: number, z0b: number, z1b: number, z1a: number) => [project(a, z0a), project(b, z0b), project(b, z1b), project(a, z1a)];

  const wallsByLevel = new Map<string, WallEntity[]>();
  for (const w of walls) {
    const k = w.levelId || 'level-1';
    (wallsByLevel.get(k) || wallsByLevel.set(k, []).get(k)!).push(w);
  }

  // ---------------------------------------------------------------------------- WALLS
  for (const wall of walls) {
    const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (L < 1) continue;
    const prof = wallProfile(model, wall);
    const same = wallsByLevel.get(wall.levelId || 'level-1') || [wall];
    const [sL, eL, eR, sR] = computeWallCornersWithJoins(wall, same);
    const dirv = { x: (wall.end.x - wall.start.x) / L, y: (wall.end.y - wall.start.y) / L };
    const leftN = { x: -dirv.y, y: dirv.x };
    const extSide = wallExteriorSide(wall, same);
    const sOf = (p: Point) => (p.x - wall.start.x) * dirv.x + (p.y - wall.start.y) * dirv.y;
    const faces: Array<{ a: Point; b: Point; n: Point; long: boolean; side?: 'left' | 'right' }> = [
      { a: sL, b: eL, n: leftN, long: true, side: 'left' },
      { a: sR, b: eR, n: { x: -leftN.x, y: -leftN.y }, long: true, side: 'right' },
      { a: sL, b: sR, n: { x: -dirv.x, y: -dirv.y }, long: false },
      { a: eL, b: eR, n: dirv, long: false },
    ];
    const curtain = isCurtainWall(wall);
    const H = Math.max(...prof.top.map((t) => t.z)) - prof.baseZ;
    for (const f of faces) {
      if (f.n.x * vb.look.x + f.n.y * vb.look.y >= -1e-6) continue; // back face
      const depth = (vb.depth(f.a) + vb.depth(f.b)) / 2;
      const sa = sOf(f.a);
      const sb = sOf(f.b);
      // top profile between sa and sb (inclusive breakpoints)
      const topPts: Array<{ s: number; z: number }> = [{ s: sa, z: profileZ(prof, Math.max(0, Math.min(L, sa))) }];
      for (const t of prof.top) if (t.s > Math.min(sa, sb) + 1e-6 && t.s < Math.max(sa, sb) - 1e-6) topPts.push(t);
      topPts.push({ s: sb, z: profileZ(prof, Math.max(0, Math.min(L, sb))) });
      topPts.sort((p, q) => (sa <= sb ? p.s - q.s : q.s - p.s));
      const ptAt = (s: number): Point => {
        // point on this face line at centre-line station s
        const k = Math.abs(sb - sa) < 1e-9 ? 0 : (s - sa) / (sb - sa);
        return { x: f.a.x + (f.b.x - f.a.x) * k, y: f.a.y + (f.b.y - f.a.y) * k };
      };
      const outline: Point[] = [project(f.a, prof.baseZ), project(f.b, prof.baseZ), ...topPts.slice().reverse().map((t) => project(ptAt(t.s), t.z))];
      const prims: PlanPrim[] = [];
      const isExt = f.long && f.side === extSide;
      if (curtain && f.long) {
        // ---- curtain wall grid
        const g = curtainOf(wall);
        const cells = curtainCells(wall, L, H);
        for (let c = 0; c + 1 < cells.cols.length; c++) {
          for (let r = 0; r + 1 < cells.rows.length; r++) {
            const s0 = cells.cols[c], s1 = cells.cols[c + 1];
            const z0 = prof.baseZ + cells.rows[r], z1 = prof.baseZ + cells.rows[r + 1];
            const poly = quad(ptAt(s0), ptAt(s1), z0, z0, z1, z1);
            const type = cells.type(c, r);
            const fill = type === 'solid' ? '#94a3b8' : type === 'door' ? '#bfdbfe' : type === 'window' ? '#d7eaf7' : '#cfe3f3';
            prims.push({ k: 'poly', pts: poly, closed: true, fill: shade(fill, lightK(f.n)), w: 0 });
            if (type === 'glass' || type === 'door' || type === 'window') {
              // reflection streak
              const p0 = poly[0], p2 = poly[2];
              prims.push({ k: 'poly', pts: [{ x: p0.x + (p2.x - p0.x) * 0.2, y: p0.y + (p2.y - p0.y) * 0.75 }, { x: p0.x + (p2.x - p0.x) * 0.45, y: p0.y + (p2.y - p0.y) * 0.3 }], closed: false, stroke: '#ffffff', w: 0.25, opacity: 0.8 });
            }
            if (type === 'window') {
              // operable vent: inner sash + dashed awning triangle (apex at the top hinge)
              const ins = (p: Point, q: Point, k2: number) => ({ x: p.x + (q.x - p.x) * k2, y: p.y + (q.y - p.y) * k2 });
              const c0 = poly[0], c1 = poly[1], c2 = poly[2], c3 = poly[3];
              const i0 = ins(c0, c2, 0.06), i2 = ins(c2, c0, 0.06), i1 = ins(c1, c3, 0.06), i3 = ins(c3, c1, 0.06);
              prims.push({ k: 'poly', pts: [i0, i1, i2, i3], closed: true, stroke: g.mullionColor, w: 0.25 });
              prims.push({ k: 'poly', pts: [i0, { x: (i2.x + i3.x) / 2, y: (i2.y + i3.y) / 2 }, i1], closed: false, stroke: INK_SOFT, w: 0.15, dash: [1.2, 0.8] });
            }
            if (type === 'door') {
              const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[2].y) / 2 };
              prims.push({ k: 'poly', pts: [{ x: mid.x, y: poly[0].y }, { x: mid.x, y: poly[2].y }], closed: false, stroke: g.mullionColor, w: 0.25 });
              prims.push({ k: 'circle', c: { x: mid.x - 3, y: mid.y }, r: 1, fill: INK, w: 0 });
            }
            hits.push({ poly, depth: depth - 0.02, target: { kind: 'cw-cell', wallId: wall.id, col: c, row: r } });
          }
        }
        const mw = g.mullionSize;
        for (const s of cells.cols) {
          const a = ptAt(Math.max(0, s - mw / 2)), b = ptAt(Math.min(L, s + mw / 2));
          prims.push({ k: 'poly', pts: quad(a, b, prof.baseZ, prof.baseZ, prof.baseZ + H, prof.baseZ + H), closed: true, fill: g.mullionColor, stroke: g.mullionColor, w: 0.1 });
        }
        for (const r of cells.rows) {
          const z0 = prof.baseZ + Math.max(0, r - mw / 2), z1 = prof.baseZ + Math.min(H, r + mw / 2);
          prims.push({ k: 'poly', pts: quad(ptAt(0), ptAt(L), z0, z0, z1, z1), closed: true, fill: g.mullionColor, stroke: g.mullionColor, w: 0.1 });
        }
        prims.push({ k: 'poly', pts: outline, closed: true, stroke: INK, w: 0.35 });
      } else if (isExt) {
        // ---- exterior face with finish bands
        const bands = wallFinishBands(wall, H);
        for (const band of bands) {
          const z0 = prof.baseZ + band.z0;
          const z1 = prof.baseZ + band.z1;
          // clip the face polygon to the band (top profile may be lower than z1)
          const poly = clipPolygonY(outline, -z1, -z0);
          if (poly.length < 3) continue;
          const def = finishDef(band.finish);
          prims.push({ k: 'poly', pts: poly, closed: true, fill: shade(def.color, lightK(f.n)), w: 0 });
          if (hatches) prims.push(...finishHatch(band.finish, poly, `${wall.id}:${band.index}`));
          if (band.z0 > 0) prims.push({ k: 'poly', pts: [project(ptAt(sa), z0), project(ptAt(sb), z0)], closed: false, stroke: INK_SOFT, w: 0.25 });
          hits.push({ poly, depth, target: { kind: 'wall', wallId: wall.id, exterior: true, band: band.index < bands.length - 1 ? band.index : null, z0: band.z0, z1: band.z1 } });
        }
        if (wall.parapetHeight) {
          const zc = profileZ(prof, 0);
          prims.push({ k: 'poly', pts: quad(ptAt(sa), ptAt(sb), zc - 2, zc - 2, zc, zc), closed: true, fill: '#d6d3d1', stroke: INK, w: 0.18 });
        }
        prims.push({ k: 'poly', pts: outline, closed: true, stroke: INK, w: 0.35 });
      } else {
        prims.push({ k: 'poly', pts: outline, closed: true, fill: shade('#f4f2ee', lightK(f.n)), stroke: INK, w: f.long ? 0.3 : 0.25 });
        hits.push({ poly: outline, depth, target: { kind: 'wall', wallId: wall.id, exterior: false, band: null, z0: 0, z1: H } });
      }
      items.push({ depth, prims });

      if (!f.long || curtain) continue;
      // ---- openings on this (visible, long) face
      for (const w of windows.filter((x) => x.wallId === wall.id)) {
        const s = w.offset * L;
        const a = ptAt(s - w.width / 2), b = ptAt(s + w.width / 2);
        const z0 = prof.baseZ + w.sillHeight;
        const prims2 = windowElevation(w, a, b, z0, project, paper, lightK(f.n));
        items.push({ depth: depth - 0.05, prims: prims2 });
        hits.push({ poly: quad(a, b, z0, z0, z0 + w.height, z0 + w.height), depth: depth - 0.05, target: { kind: 'window', id: w.id } });
      }
      for (const wo of wallOpenings.filter((x) => x.wallId === wall.id)) {
        const s = wo.offset * L;
        const z0 = prof.baseZ + wo.sillHeight;
        const op = { id: wo.id, kind: 'wallopening' as const, s0: s - wo.width / 2, s1: s + wo.width / 2, z0, z1: z0 + wo.height, arch: wo.shape === 'arch' };
        const poly = headPoints(op).reverse();
        const pts = [project(ptAt(op.s0), z0), ...poly.map((q) => project(ptAt(q.x), q.y)), project(ptAt(op.s1), z0)];
        items.push({ depth: depth - 0.05, prims: [{ k: 'poly', pts, closed: true, fill: shade('#57534e', lightK(f.n)), stroke: INK, w: 0.3 }] });
        hits.push({ poly: pts, depth: depth - 0.05, target: { kind: 'wallopening', id: wo.id } });
      }
      for (const d of doors.filter((x) => x.wallId === wall.id)) {
        const s = d.offset * L;
        const a = ptAt(s - d.width / 2), b = ptAt(s + d.width / 2);
        const prims2 = doorElevation(d, a, b, prof.baseZ, project, lightK(f.n), isExt);
        items.push({ depth: depth - 0.05, prims: prims2 });
        hits.push({ poly: quad(a, b, prof.baseZ, prof.baseZ, prof.baseZ + d.height, prof.baseZ + d.height), depth: depth - 0.05, target: { kind: 'door', id: d.id } });
      }
      // ---- sweeps & reveals on the exterior face
      if (isExt) {
        for (const sw of sweeps.filter((x) => x.wallId === wall.id)) {
          const z0 = prof.baseZ + sw.height;
          const z1 = z0 + sw.size;
          const poly = quad(ptAt(0), ptAt(L), z0, z0, z1, z1);
          const prims3: PlanPrim[] = [];
          if (sw.profile === 'reveal') {
            prims3.push({ k: 'poly', pts: poly, closed: true, fill: '#57534e', w: 0 });
            prims3.push({ k: 'poly', pts: [poly[0], poly[1]], closed: false, stroke: INK, w: 0.18 });
            prims3.push({ k: 'poly', pts: [poly[3], poly[2]], closed: false, stroke: INK, w: 0.18 });
          } else {
            const col = sw.color || '#f5f5f4';
            prims3.push({ k: 'poly', pts: poly, closed: true, fill: shade(col, lightK(f.n)), stroke: INK, w: 0.25 });
            if (sw.profile === 'cornice') {
              const zm1 = z0 + sw.size * 0.35, zm2 = z0 + sw.size * 0.7;
              prims3.push({ k: 'poly', pts: [project(ptAt(0), zm1), project(ptAt(L), zm1)], closed: false, stroke: INK_SOFT, w: 0.13 });
              prims3.push({ k: 'poly', pts: [project(ptAt(0), zm2), project(ptAt(L), zm2)], closed: false, stroke: INK_SOFT, w: 0.13 });
            } else if (sw.profile === 'base') {
              const zm = z0 + sw.size * 0.8;
              prims3.push({ k: 'poly', pts: [project(ptAt(0), zm), project(ptAt(L), zm)], closed: false, stroke: INK_SOFT, w: 0.13 });
            }
          }
          items.push({ depth: depth - 0.04 - Math.max(0, sw.projection) * 0.001, prims: prims3 });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------- BALCONIES & RAILINGS
  const boxItems = (planPoly: Point[], z0: number, z1: number, fill: string, stroke = INK) => {
    const n = planPoly.length;
    // orientation-independent outward normals
    let area = 0;
    for (let i = 0; i < n; i++) area += planPoly[i].x * planPoly[(i + 1) % n].y - planPoly[(i + 1) % n].x * planPoly[i].y;
    const sgn = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = planPoly[i], b = planPoly[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const L = Math.hypot(ex, ey) || 1;
      const nrm = { x: (sgn * ey) / L, y: (-sgn * ex) / L };
      if (nrm.x * vb.look.x + nrm.y * vb.look.y >= -1e-6) continue;
      items.push({ depth: (vb.depth(a) + vb.depth(b)) / 2, prims: [{ k: 'poly', pts: quad(a, b, z0, z0, z1, z1), closed: true, fill: shade(fill, lightK(nrm)), stroke, w: 0.25 }] });
    }
  };
  const railingAlong = (path: Point[], zBase: number, height: number, style: 'balusters' | 'glass', spacing: number) => {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const depth = (vb.depth(a) + vb.depth(b)) / 2 - 0.03;
      const prims: PlanPrim[] = [];
      if (style === 'glass') prims.push({ k: 'poly', pts: quad(a, b, zBase + 2, zBase + 2, zBase + height - 2, zBase + height - 2), closed: true, fill: '#cfe3f3', stroke: '#64748b', w: 0.13, opacity: 0.85 });
      else {
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(L / Math.max(2, spacing)));
        for (let k = 0; k <= n; k++) {
          const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
          prims.push({ k: 'poly', pts: [project(p, zBase), project(p, zBase + height)], closed: false, stroke: INK_SOFT, w: 0.13 });
        }
        prims.push({ k: 'poly', pts: [project(a, zBase + 3), project(b, zBase + 3)], closed: false, stroke: INK_SOFT, w: 0.2 });
      }
      prims.push({ k: 'poly', pts: quad(a, b, zBase + height - 2, zBase + height - 2, zBase + height, zBase + height), closed: true, fill: '#57534e', stroke: INK, w: 0.18 });
      items.push({ depth, prims });
    }
  };
  for (const bc of balconies) {
    const wall = walls.find((w) => w.id === bc.wallId);
    if (!wall) continue;
    const g = balconyPlan(wall, bc, wallsByLevel.get(wall.levelId || 'level-1') || [wall]);
    const top = levelElevation(model, wall.levelId) + bc.elevationOffset;
    boxItems(g.slab, top - bc.slabThickness, top, '#e7e5e4');
    railingAlong(g.railing, top, bc.railingHeight, bc.railingStyle, 4);
  }
  for (const r of railings) {
    if (r.path.length < 2) continue;
    railingAlong(r.path, levelElevation(model, r.levelId) + (r.baseOffset || 0), r.height || 42, r.style || 'balusters', r.balusterSpacing || 4);
  }

  // ---------------------------------------------------------------------------- ROOFS
  const roofGeoms: Array<{ roof: RoofEntity; g: RoofGeometry }> = [];
  for (const roof of roofs) {
    if (roof.polygon.length < 3) continue;
    const g = getRoofGeometry(roof, levelElevation(model, roof.levelId));
    roofGeoms.push({ roof, g });
    const mat = roofMaterialDef(roof.material);
    const cosA = Math.cos((g.slopeDeg * Math.PI) / 180) || 1;
    const vT = g.style === 'flat' ? g.thickness : g.thickness / cosA;
    const fascia = Math.max(roof.fasciaDepth ?? 8, vT);
    const skyOnRoof = skylights.filter((s) => s.roofId === roof.id);
    if (g.style === 'flat') {
      const zTop = g.baseZ + g.thickness;
      boxItems(g.outline, g.baseZ, zTop, '#d6d3d1');
      if (roof.parapetHeight && roof.parapetHeight > 0) boxItems(g.outline, zTop, zTop + roof.parapetHeight, '#e7e5e4');
      continue;
    }
    for (const f of g.faces) {
      if (f.kind === 'gable') continue;
      const top = f.pts.map((p) => ({ ...p, z: p.z + vT }));
      const poly = top.map((p) => project(p, p.z));
      const depth = top.reduce((a, p) => a + vb.depth(p), 0) / top.length;
      // light: faces sloping toward the viewer are lighter
      const k = shading ? 0.78 + 0.22 * Math.max(0, -(f.down.x * vb.look.x + f.down.y * vb.look.y)) : 1;
      const prims: PlanPrim[] = [{ k: 'poly', pts: poly, closed: true, fill: shade(mat.color, k), w: 0 }];
      if (hatches) prims.push(...roofHatch(roof.material, poly, top, project, f.down, mat.joint));
      prims.push({ k: 'poly', pts: poly, closed: true, stroke: INK, w: 0.25 });
      items.push({ depth, prims });
      hits.push({ poly, depth, target: { kind: 'roof', roofId: roof.id } });
    }
    // fascia band + gutter along eaves and rakes
    for (const ln of g.lines) {
      if (ln.kind !== 'eave' && ln.kind !== 'rake') continue;
      const a = { x: ln.a.x, y: ln.a.y }, b = { x: ln.b.x, y: ln.b.y };
      const depth = (vb.depth(a) + vb.depth(b)) / 2 - 0.5;
      const za = ln.a.z + vT, zb = ln.b.z + vT;
      const prims: PlanPrim[] = [{ k: 'poly', pts: quad(a, b, za - fascia, zb - fascia, zb, za), closed: true, fill: '#f5f5f4', stroke: INK, w: 0.25 }];
      if (roof.gutter && ln.kind === 'eave') prims.push({ k: 'poly', pts: quad(a, b, za - fascia - 1, zb - fascia - 1, zb - fascia + 5, za - fascia + 5), closed: true, fill: '#e7e5e4', stroke: INK, w: 0.18 });
      items.push({ depth, prims });
    }
    // things sitting on a roof face are drawn just in front of that face (centroid depth sorting
    // would otherwise bury them behind their own host face)
    const faceDepth = (pts: P3[]) => pts.reduce((a, p) => a + vb.depth(p), 0) / pts.length;
    const hostDepth = (p: Point) => {
      const f = g.faces.find((ff) => ff.kind !== 'gable' && pointInPolygon(p, ff.pts));
      return f ? faceDepth(f.pts) : vb.depth(p);
    };
    for (const sk of skyOnRoof) {
      const o = skylightOutline(g, sk);
      const curb = o.pts.map((p) => ({ ...p, z: p.z + 4 }));
      const poly = curb.map((p) => project(p, p.z));
      const facing = o.face ? o.face.down.x * vb.look.x + o.face.down.y * vb.look.y < 0.2 : true;
      if (!facing) continue;
      const depth = Math.min(hostDepth(sk.position), faceDepth(curb)) - 0.2;
      items.push({ depth, prims: [{ k: 'poly', pts: poly, closed: true, fill: '#cfe3f3', stroke: INK, w: 0.25 }] });
    }
    for (const dm of dormers.filter((x) => x.roofId === roof.id)) {
      const dg = dormerGeometry(g, dm);
      if (!dg) continue;
      const hostD = hostDepth(dm.position);
      const pushPoly = (pts: P3[], fill: string, w = 0.25) => {
        const poly = pts.map((p) => project(p, p.z));
        const depth = Math.min(hostD, faceDepth(pts)) - 0.3 - (faceDepth(pts) - Math.min(...pts.map((q) => vb.depth(q)))) * 1e-3;
        items.push({ depth, prims: [{ k: 'poly', pts: poly, closed: true, fill, stroke: INK, w }] });
        return depth;
      };
      const wallFill = finishDef('lap-siding').color;
      const fd = pushPoly(dg.walls[0], wallFill);
      pushPoly(dg.walls[1], shade(wallFill, 0.9));
      pushPoly(dg.walls[2], shade(wallFill, 0.9));
      for (const rp of dg.roofPlanes) pushPoly(rp, mat.color);
      const win = dg.window.map((p) => project(p, p.z));
      items.push({ depth: fd - 0.01, prims: [{ k: 'poly', pts: win, closed: true, fill: '#cfe3f3', stroke: INK, w: 0.25 }] });
    }
  }

  // ---------------------------------------------------------------------------- PAINT ORDER
  items.sort((a, b) => b.depth - a.depth);
  const prims: PlanPrim[] = [];
  for (const it of items) prims.push(...it.prims);

  // bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (p: Point) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };
  for (const p of prims) if (p.k === 'poly') p.pts.forEach(eat);
  if (!Number.isFinite(minX)) {
    minX = 0; maxX = 240; minY = -120; maxY = 0;
  }

  // ---------------------------------------------------------------------------- SHADOWS
  if (opts.shadows) {
    for (const { roof, g } of roofGeoms) {
      if (g.style === 'flat') continue;
      for (const ln of g.lines) {
        if (ln.kind !== 'eave') continue;
        const a = { x: ln.a.x, y: ln.a.y }, b = { x: ln.b.x, y: ln.b.y };
        const ex = b.x - a.x, ey = b.y - a.y;
        const L = Math.hypot(ex, ey) || 1;
        // eave edge must face the viewer
        const out = { x: ey / L, y: -ex / L };
        const fp = g.footprint;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const outward = pointInPolygon({ x: mid.x + out.x, y: mid.y + out.y }, fp) ? { x: -out.x, y: -out.y } : out;
        if (outward.x * vb.look.x + outward.y * vb.look.y > -0.3) continue;
        const drop = (roof.overhang ?? 18) * 1.1; // 45° sun, slightly raking
        const za = Math.min(ln.a.z, ln.b.z);
        // only where there is wall below: clip to the footprint's extent along the view
        const fu = fp.map((q) => vb.u(q));
        const uMin = Math.min(...fu), uMax = Math.max(...fu);
        const ua = Math.max(uMin, Math.min(vb.u(a), vb.u(b)));
        const ub = Math.min(uMax, Math.max(vb.u(a), vb.u(b)));
        if (ub - ua < 1) continue;
        const y0 = -za;
        prims.push({ k: 'poly', pts: [{ x: ua, y: y0 }, { x: ub, y: y0 }, { x: ub, y: y0 + drop }, { x: ua, y: y0 + drop }], closed: true, fill: '#1c1917', w: 0, opacity: 0.16 });
      }
    }
  }

  // ---------------------------------------------------------------------------- ANNOTATION
  if (opts.annotations !== false) {
    const levels = (model.levels || []).slice().sort((a, b) => a.elevation - b.elevation);
    const x0 = minX - paper(8);
    const x1 = maxX + paper(14);
    // ground line
    const ground = levels[0]?.elevation ?? 0;
    prims.push({ k: 'poly', pts: [{ x: x0, y: -ground }, { x: maxX + paper(6), y: -ground }], closed: false, stroke: INK, w: 0.7 });
    for (const lvl of levels) {
      const y = -lvl.elevation;
      prims.push({ k: 'poly', pts: [{ x: x0, y }, { x: x1, y }], closed: false, stroke: '#2563eb', w: 0.18, dash: [3, 1.5] });
      const r = paper(1.6);
      prims.push({ k: 'circle', c: { x: x1 + r, y }, r, fill: '#ffffff', stroke: '#2563eb', w: 0.2 });
      prims.push({ k: 'poly', pts: [{ x: x1, y }, { x: x1 + 2 * r, y }], closed: false, stroke: '#2563eb', w: 0.2 });
      prims.push({ k: 'text', p: { x: x1 + 2 * r + paper(1.2), y: y - paper(1.6) }, text: lvl.name, size: 2.2, align: 'left', rot: 0, color: '#1e3a8a', bold: true });
      prims.push({ k: 'text', p: { x: x1 + 2 * r + paper(1.2), y: y + paper(1.6) }, text: `${lvl.elevation >= 0 ? '+' : ''}${formatLength(lvl.elevation, model.settings.units)}`, size: 1.9, align: 'left', rot: 0, color: '#1e3a8a' });
    }
    // roof slope labels on faces seen in profile (downslope roughly across the view)
    for (const { g } of roofGeoms) {
      if (g.style === 'flat') continue;
      const done = new Set<string>();
      for (const f of g.faces) {
        if (f.kind === 'gable') continue;
        const across = Math.abs(f.down.x * vb.look.x + f.down.y * vb.look.y);
        if (across > 0.3) continue;
        const proj = f.pts.map((p) => project(p, p.z + g.thickness));
        const top = proj.reduce((a, p) => (p.y < a.y ? p : a));
        const low = proj.reduce((a, p) => (p.y > a.y ? p : a));
        const key = `${Math.round(f.slopeDeg * 10)}:${Math.sign(top.x - low.x)}`;
        if (done.has(key)) continue;
        done.add(key);
        const m = { x: (top.x + low.x) / 2, y: (top.y + low.y) / 2 };
        const ang = (Math.atan2(top.y - low.y, top.x - low.x) * 180) / Math.PI;
        const rot = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
        const nrm = { x: Math.sin((rot * Math.PI) / 180), y: -Math.cos((rot * Math.PI) / 180) };
        prims.push({ k: 'text', p: { x: m.x + nrm.x * paper(3), y: m.y + nrm.y * paper(3) }, text: formatSlope(f.slopeDeg), size: 2.0, align: 'center', rot, color: INK, bold: true });
      }
    }
    // stored dimensions & tags for this view
    for (const an of (model.elevationAnnotations || []).filter((a) => a.view === dir)) {
      if (an.kind === 'dimension' && an.p2) {
        prims.push(...elevationDimension(an.p1, an.p2, an.offset ?? 0, an.orientation, model.settings.units, paper));
      } else if (an.kind === 'tag') {
        const wall = walls.find((w) => w.id === an.targetWallId);
        if (!wall) continue;
        const bands = wallFinishBands(wall, (wall.height || 108) + (wall.parapetHeight || 0));
        const band = an.targetBand !== undefined && an.targetBand !== null ? bands.find((b) => b.index === an.targetBand) : bands[bands.length - 1];
        const label = isCurtainWall(wall) ? 'Curtain Wall' : finishDef(band?.finish).label;
        const p = { x: an.p1.u, y: -an.p1.z };
        const q = an.p2 ? { x: an.p2.u, y: -an.p2.z } : { x: p.x + paper(10), y: p.y - paper(8) };
        prims.push({ k: 'circle', c: p, r: paper(0.6), fill: INK, w: 0 });
        prims.push({ k: 'poly', pts: [p, q, { x: q.x + paper(3), y: q.y }], closed: false, stroke: INK, w: 0.18 });
        prims.push({ k: 'text', p: { x: q.x + paper(4), y: q.y }, text: label.toUpperCase(), size: 2.0, align: 'left', rot: 0, color: INK, bold: true });
      }
    }
  }

  for (const p of prims) {
    if (p.k === 'poly') p.pts.forEach(eat);
    else if (p.k === 'circle') eat(p.c);
    else {
      // include the text's extent (≈0.62 em per character, unrotated labels) so labels are not clipped on sheets
      const em = p.size / 0.72 / opts.mmPerIn;
      const w = Math.abs(Math.cos((p.rot * Math.PI) / 180)) * em * 0.62 * p.text.length;
      const x0 = p.align === 'center' ? p.p.x - w / 2 : p.align === 'right' ? p.p.x - w : p.p.x;
      eat({ x: x0, y: p.p.y - em / 2 });
      eat({ x: x0 + w, y: p.p.y + em / 2 });
    }
  }
  return { prims, hits, bounds: { minX, minY, maxX, maxY }, project };
}

/** A dimension in elevation coordinates (u, z) → primitives. */
export function elevationDimension(
  p1: { u: number; z: number },
  p2: { u: number; z: number },
  offset: number,
  orientation: 'horizontal' | 'vertical' | undefined,
  units: 'imperial' | 'metric',
  paper: (mm: number) => number
): PlanPrim[] {
  const a = { x: p1.u, y: -p1.z };
  const b = { x: p2.u, y: -p2.z };
  const vertical = orientation ? orientation === 'vertical' : Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
  const out: PlanPrim[] = [];
  const st: PrimStyle = { stroke: INK, w: 0.13 };
  let d1: Point, d2: Point, len: number;
  if (vertical) {
    const x = Math.max(a.x, b.x) + offset;
    d1 = { x, y: a.y };
    d2 = { x, y: b.y };
    len = Math.abs(b.y - a.y);
  } else {
    const y = Math.max(a.y, b.y) + offset;
    d1 = { x: a.x, y };
    d2 = { x: b.x, y };
    len = Math.abs(b.x - a.x);
  }
  out.push({ k: 'poly', pts: [a, d1], closed: false, ...st, dash: [1, 0.6] });
  out.push({ k: 'poly', pts: [b, d2], closed: false, ...st, dash: [1, 0.6] });
  out.push({ k: 'poly', pts: [d1, d2], closed: false, ...st });
  const t = paper(1.1);
  for (const d of [d1, d2]) out.push({ k: 'poly', pts: [{ x: d.x - t, y: d.y + t }, { x: d.x + t, y: d.y - t }], closed: false, stroke: INK, w: 0.25 });
  const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
  out.push({
    k: 'text',
    p: vertical ? { x: mid.x - paper(1.5), y: mid.y } : { x: mid.x, y: mid.y - paper(1.5) },
    text: formatLength(len, units),
    size: 2.0,
    align: 'center',
    rot: vertical ? -90 : 0,
    color: INK,
  });
  return out;
}

/** Clips a polygon to the horizontal strip yMin..yMax (Sutherland–Hodgman, two planes). */
export function clipPolygonY(poly: Point[], yMin: number, yMax: number): Point[] {
  const clip = (pts: Point[], keep: (p: Point) => boolean, edgeY: number) => {
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const pin = keep(p);
      const qin = keep(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (edgeY - p.y) / (q.y - p.y);
        out.push({ x: p.x + (q.x - p.x) * t, y: edgeY });
      }
    }
    return out;
  };
  let r = clip(poly, (p) => p.y >= yMin - 1e-9, yMin);
  if (r.length < 3) return [];
  r = clip(r, (p) => p.y <= yMax + 1e-9, yMax);
  return r.length >= 3 ? r : [];
}

/** Window in elevation: frame, glass, muntins, sill/head trim and optional shutters. */
function windowElevation(
  w: WindowEntity,
  a: Point,
  b: Point,
  z0: number,
  project: (p: Point, z: number) => Point,
  paper: (mm: number) => number,
  k: number
): PlanPrim[] {
  const out: PlanPrim[] = [];
  const P = (p: Point, z: number) => project(p, z);
  const lerp = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const W = w.width;
  const z1 = z0 + w.height;
  const fw = Math.max(1, w.frameWidth ?? 2.5);
  const tf = fw / W;
  const rect = (t0: number, t1: number, za: number, zb: number) => [P(lerp(t0), za), P(lerp(t1), za), P(lerp(t1), zb), P(lerp(t0), zb)];
  const trim = w.trim !== false;
  if (w.shutters) {
    const sw = Math.min(W / 2, 20) / W;
    for (const [t0, t1] of [[-sw - 0.02, -0.02], [1.02, 1.02 + sw]]) {
      out.push({ k: 'poly', pts: rect(t0, t1, z0, z1), closed: true, fill: shade('#3f6212', k), stroke: INK, w: 0.18 });
      for (let z = z0 + 3; z < z1 - 2; z += 3) out.push({ k: 'poly', pts: [P(lerp(t0 + 0.01), z), P(lerp(t1 - 0.01), z)], closed: false, stroke: '#1a2e05', w: 0.1 });
    }
  }
  if (trim) {
    const ext = 3 / W;
    out.push({ k: 'poly', pts: rect(-ext, 1 + ext, z1, z1 + 4), closed: true, fill: '#fafaf9', stroke: INK, w: 0.18 });
    out.push({ k: 'poly', pts: rect(-ext - 0.01, 1 + ext + 0.01, z0 - 2.5, z0), closed: true, fill: '#fafaf9', stroke: INK, w: 0.18 });
  }
  out.push({ k: 'poly', pts: rect(0, 1, z0, z1), closed: true, fill: '#fafaf9', stroke: INK, w: 0.25 });
  out.push({ k: 'poly', pts: rect(tf, 1 - tf, z0 + fw, z1 - fw), closed: true, fill: shade('#cfe3f3', k), stroke: INK_SOFT, w: 0.15 });
  const [cx, cy] = DIVISIONS[w.divisions || '1x1'];
  for (let i = 1; i < cx; i++) {
    const t = tf + ((1 - 2 * tf) * i) / cx;
    out.push({ k: 'poly', pts: [P(lerp(t), z0 + fw), P(lerp(t), z1 - fw)], closed: false, stroke: '#fafaf9', w: Math.max(0.25, Math.min(0.6, paper(0) + 0.35)) });
  }
  for (let j = 1; j < cy; j++) {
    const z = z0 + fw + ((w.height - 2 * fw) * j) / cy;
    out.push({ k: 'poly', pts: [P(lerp(tf), z), P(lerp(1 - tf), z)], closed: false, stroke: '#fafaf9', w: 0.45 });
  }
  // operation: meeting rails for sliders / double-hung, dashed swing triangles for casement / awning
  const op = w.operation || 'fixed';
  const dash = [1.2, 0.8];
  if (op === 'slider') out.push({ k: 'poly', pts: [P(lerp(0.5), z0 + fw), P(lerp(0.5), z1 - fw)], closed: false, stroke: INK, w: 0.3 });
  if (op === 'double-hung') {
    const zm = (z0 + z1) / 2;
    out.push({ k: 'poly', pts: [P(lerp(tf), zm), P(lerp(1 - tf), zm)], closed: false, stroke: INK, w: 0.35 });
  }
  if (op === 'casement') out.push({ k: 'poly', pts: [P(lerp(1 - tf), z0 + fw), P(lerp(tf), (z0 + z1) / 2), P(lerp(1 - tf), z1 - fw)], closed: false, stroke: INK_SOFT, w: 0.15, dash });
  if (op === 'awning') out.push({ k: 'poly', pts: [P(lerp(tf), z0 + fw), P(lerp(0.5), z1 - fw), P(lerp(1 - tf), z0 + fw)], closed: false, stroke: INK_SOFT, w: 0.15, dash });
  return out;
}

/**
 * Door in elevation from the shared door layout (doorStyles.ts): casing, frame, sidelights, transom
 * and each leaf drawn in its style (flush, 6-panel, Craftsman, French, plank with strap hinges,
 * arched timber, louvered, glass, sectional / roll-up / carriage garage, pivot slab), plus barn
 * tracks, Dutch splits and screen doors.
 */
function doorElevation(d: DoorEntity, a: Point, b: Point, z0: number, project: (p: Point, z: number) => Point, k: number, exterior: boolean): PlanPrim[] {
  const out: PlanPrim[] = [];
  const W = d.width;
  const lay = doorLayout(d);
  // x = inches along the opening from a; z = absolute height
  const X = (x: number): Point => ({ x: a.x + ((b.x - a.x) * x) / W, y: a.y + ((b.y - a.y) * x) / W });
  const P = (x: number, z: number) => project(X(x), z);
  const rect = (x0: number, x1: number, za: number, zb: number) => [P(x0, za), P(x1, za), P(x1, zb), P(x0, zb)];
  const poly = (pts: Array<[number, number]>, st: Partial<PrimStyle> & { w: number }, closed = true) => out.push({ k: 'poly', pts: pts.map(([x, z]) => P(x, z)), closed, ...st } as PlanPrim);
  const ln = (x0: number, za: number, x1: number, zb: number, stroke = INK_SOFT, w = 0.12, dash?: number[]) => out.push({ k: 'poly', pts: [P(x0, za), P(x1, zb)], closed: false, stroke, w, dash });
  const fw = lay.frame;
  const top = z0 + d.height;
  const leafTop = z0 + lay.leafH;
  const glass = '#cfe3f3';
  const wood = shade(lay.style === 'plank' || lay.style === 'arched' || lay.style === 'carriage' ? '#7a5332' : exterior ? '#7c4a2d' : '#d6c4a8', k);
  const slab = lay.kind === 'garage' && lay.style !== 'carriage' ? shade('#f1f0ee', k) : lay.style === 'glass' ? shade(glass, k) : wood;
  const archPts = (x0: number, x1: number, zBase: number, zTop: number, n = 16): Array<[number, number]> => {
    const r = (x1 - x0) / 2;
    const cx = (x0 + x1) / 2;
    const spring = Math.max(zBase + 1, zTop - r);
    const ry = zTop - spring;
    const pts: Array<[number, number]> = [[x0, zBase], [x1, zBase]];
    for (let i = 0; i <= n; i++) {
      const t = (Math.PI * i) / n;
      pts.push([cx + r * Math.cos(t), spring + ry * Math.sin(t)]);
    }
    return pts;
  };
  // casing (not for garages / barn doors which sit on the face)
  if (d.trim !== false && lay.kind !== 'garage') {
    if (lay.arched) poly(archPts(-3.5, W + 3.5, z0, top + 3.5), { fill: '#fafaf9', stroke: INK, w: 0.18 });
    else out.push({ k: 'poly', pts: rect(-3.5, W + 3.5, z0, top + 3.5), closed: true, fill: '#fafaf9', stroke: INK, w: 0.18 });
  }
  // frame / rough opening
  if (lay.arched) poly(archPts(0, W, z0, top), { fill: '#e7e5e4', stroke: INK, w: 0.25 });
  else out.push({ k: 'poly', pts: rect(0, W, z0, top), closed: true, fill: lay.kind === 'barn' || lay.kind === 'barn-bypass' ? shade('#3f3a36', k) : '#e7e5e4', stroke: INK, w: 0.25 });
  // sidelights & transom
  for (const sl of lay.sidelights) {
    out.push({ k: 'poly', pts: rect(sl.x0, sl.x1, z0 + 10, leafTop - 2), closed: true, fill: shade(glass, k), stroke: INK_SOFT, w: 0.15 });
    out.push({ k: 'poly', pts: rect(sl.x0, sl.x1, z0, z0 + 10), closed: true, fill: wood, stroke: INK_SOFT, w: 0.12 });
  }
  if (lay.transom) {
    out.push({ k: 'poly', pts: rect(fw, W - fw, z0 + lay.transom.y0, z0 + lay.transom.y1), closed: true, fill: shade(glass, k), stroke: INK_SOFT, w: 0.15 });
    for (const t of [1 / 3, 2 / 3]) ln(fw + (W - 2 * fw) * t, z0 + lay.transom.y0, fw + (W - 2 * fw) * t, z0 + lay.transom.y1, '#fafaf9', 0.35);
  }
  const leafStyle = (x0: number, x1: number, za: number, zb: number, style: DoorPanelStyle, hinge: 'x0' | 'x1' | 'none') => {
    const w = x1 - x0;
    const h = zb - za;
    const st = Math.min(4.5, w * 0.14); // stile / rail
    const pnl = (px0: number, px1: number, pz0: number, pz1: number) => {
      out.push({ k: 'poly', pts: rect(px0, px1, pz0, pz1), closed: true, stroke: shade(slab, 0.62), w: 0.12 });
      out.push({ k: 'poly', pts: rect(px0 + 1, px1 - 1, pz0 + 1, pz1 - 1), closed: true, stroke: shade(slab, 0.78), w: 0.08 });
    };
    const lites = (gx0: number, gx1: number, gz0: number, gz1: number, cols: number, rows: number) => {
      out.push({ k: 'poly', pts: rect(gx0, gx1, gz0, gz1), closed: true, fill: shade(glass, k), stroke: INK_SOFT, w: 0.12 });
      for (let i = 1; i < cols; i++) ln(gx0 + ((gx1 - gx0) * i) / cols, gz0, gx0 + ((gx1 - gx0) * i) / cols, gz1, '#fafaf9', 0.35);
      for (let j = 1; j < rows; j++) ln(gx0, gz0 + ((gz1 - gz0) * j) / rows, gx1, gz0 + ((gz1 - gz0) * j) / rows, '#fafaf9', 0.35);
    };
    const straps = () => {
      const fromX = hinge === 'x1' ? x1 : x0;
      const dir = hinge === 'x1' ? -1 : 1;
      for (const zz of [za + h * 0.16, zb - h * 0.16]) {
        out.push({ k: 'poly', pts: rect(Math.min(fromX, fromX + dir * w * 0.62), Math.max(fromX, fromX + dir * w * 0.62), zz - 1, zz + 1), closed: true, fill: '#1c1917', w: 0 });
        out.push({ k: 'circle', c: P(fromX + dir * w * 0.62, zz), r: 1.4, fill: '#1c1917', w: 0 });
      }
    };
    switch (style) {
      case 'six-panel': {
        const cw = (w - 3 * st) / 2;
        const rowsH = [0.22, 0.42, 0.22].map((f) => f * (h - 4 * st));
        let z = za + st;
        for (const rh of [rowsH[2], rowsH[1], rowsH[0]]) {
          pnl(x0 + st, x0 + st + cw, z, z + rh);
          pnl(x0 + 2 * st + cw, x1 - st, z, z + rh);
          z += rh + st;
        }
        break;
      }
      case 'craftsman': {
        const gz0 = zb - h * 0.3;
        lites(x0 + st, x1 - st, gz0, zb - st, 3, 1);
        out.push({ k: 'poly', pts: rect(x0 + st - 1, x1 - st + 1, gz0 - 2.5, gz0 - 0.5), closed: true, fill: shade(slab, 0.85), stroke: INK_SOFT, w: 0.1 });
        const cw = (w - 3 * st) / 2;
        pnl(x0 + st, x0 + st + cw, za + st * 2, gz0 - 5);
        pnl(x0 + 2 * st + cw, x1 - st, za + st * 2, gz0 - 5);
        break;
      }
      case 'french':
      case 'glass': {
        const [c, r] = style === 'glass' ? [1, 1] : d.divisions && d.divisions !== '1x1' ? [DIVISIONS[d.divisions][0], DIVISIONS[d.divisions][1] + 2] : [2, 5];
        lites(x0 + st, x1 - st, za + (style === 'glass' ? st : st * 2.2), zb - st, c, r);
        break;
      }
      case 'plank':
      case 'arched': {
        for (let x = x0 + 5; x < x1 - 1; x += 5) ln(x, za, x, zb, shade(slab, 0.6), 0.1);
        if (style === 'plank' && (lay.kind === 'barn' || lay.kind === 'barn-bypass')) {
          // Z brace
          ln(x0 + 2, za + h * 0.15, x1 - 2, za + h * 0.15, shade(slab, 0.45), 0.4);
          ln(x0 + 2, zb - h * 0.15, x1 - 2, zb - h * 0.15, shade(slab, 0.45), 0.4);
          ln(x0 + 2, za + h * 0.15, x1 - 2, zb - h * 0.15, shade(slab, 0.45), 0.4);
        } else if (hinge !== 'none') straps();
        if (style === 'arched') out.push({ k: 'poly', pts: rect(x0 + w * 0.38, x1 - w * 0.38, zb - h * 0.32, zb - h * 0.2), closed: true, fill: '#1c1917', stroke: '#1c1917', w: 0.1 });
        break;
      }
      case 'louvered':
        out.push({ k: 'poly', pts: rect(x0 + st * 0.7, x1 - st * 0.7, za + st, zb - st), closed: true, stroke: shade(slab, 0.6), w: 0.12 });
        for (let z = za + st + 1.5; z < zb - st; z += 1.75) ln(x0 + st * 0.7, z, x1 - st * 0.7, z, shade(slab, 0.55), 0.1);
        break;
      case 'sectional':
        for (let i = 1; i < 4; i++) ln(x0, za + (h * i) / 4, x1, za + (h * i) / 4, INK_SOFT, 0.2);
        for (let i = 0; i < 4; i++) {
          const n = Math.max(2, Math.round(w / 48));
          for (let j = 0; j < n; j++) out.push({ k: 'poly', pts: rect(x0 + (w * j) / n + 3, x0 + (w * (j + 1)) / n - 3, za + (h * i) / 4 + 3, za + (h * (i + 1)) / 4 - 3), closed: true, stroke: shade(slab, 0.8), w: 0.08 });
        }
        break;
      case 'roll-up':
        for (let z = za + 3; z < zb; z += 3) ln(x0, z, x1, z, shade(slab, 0.72), 0.08);
        out.push({ k: 'poly', pts: rect(x0 - 1, x1 + 1, zb - 3, zb + 4), closed: true, fill: shade('#a8a29e', k), stroke: INK_SOFT, w: 0.12 });
        break;
      case 'carriage': {
        const halves = [[x0, (x0 + x1) / 2], [(x0 + x1) / 2, x1]];
        for (const [h0, h1] of halves) {
          lites(h0 + 3, h1 - 3, zb - h * 0.25, zb - 3, 3, 1);
          for (let x = h0 + 5; x < h1 - 1; x += 5) ln(x, za + 3, x, zb - h * 0.25 - 3, shade(slab, 0.6), 0.08);
          ln(h0 + 3, za + 3, h1 - 3, zb - h * 0.25 - 3, shade(slab, 0.45), 0.35);
          ln(h1 - 3, za + 3, h0 + 3, zb - h * 0.25 - 3, shade(slab, 0.45), 0.35);
          out.push({ k: 'poly', pts: rect(h0 + 3, h1 - 3, za + 3, zb - h * 0.25 - 3), closed: true, stroke: shade(slab, 0.5), w: 0.2 });
        }
        ln((x0 + x1) / 2, za, (x0 + x1) / 2, zb, INK, 0.25);
        break;
      }
      case 'pivot-slab':
        for (let z = za + h * 0.25; z < zb; z += h * 0.25) ln(x0 + 2, z, x1 - 2, z, shade(slab, 0.7), 0.08);
        out.push({ k: 'poly', pts: rect(hinge === 'x1' ? x0 + 4 : x1 - 6, hinge === 'x1' ? x0 + 6 : x1 - 4, za + h * 0.2, zb - h * 0.2), closed: true, fill: '#57534e', w: 0 });
        break;
      default:
        break;
    }
    // handle on the latch side of swing leaves
    if (hinge !== 'none' && style !== 'pivot-slab' && lay.kind !== 'bifold') {
      const hx = hinge === 'x0' ? x1 - 3 : x0 + 3;
      if (style === 'plank' || style === 'arched') out.push({ k: 'poly', pts: rect(hx - 0.6, hx + 0.6, za + 32, za + 42), closed: true, fill: '#1c1917', w: 0 });
      else out.push({ k: 'circle', c: P(hx, za + 36), r: 1.2, fill: '#d4a017', stroke: INK, w: 0.1 });
    }
  };
  // barn track above the opening (black steel) with rollers
  if (lay.kind === 'barn' || lay.kind === 'barn-bypass') {
    const lx0 = Math.min(...lay.leaves.map((l) => l.x0));
    const lx1 = Math.max(...lay.leaves.map((l) => l.x1));
    out.push({ k: 'poly', pts: rect(lx0 - (lx1 - lx0) * 0.9, lx1 + 2, top + 2, top + 3.5), closed: true, fill: '#1c1917', w: 0 });
    for (const lf of lay.leaves) for (const xr of [lf.x0 + 6, lf.x1 - 6]) out.push({ k: 'circle', c: P(xr, top + 1.5), r: 1.8, fill: '#292524', w: 0 });
  }
  for (const lf of lay.leaves) {
    const za = z0 + (lay.kind === 'barn' || lay.kind === 'barn-bypass' ? 0.5 : 0);
    const zb = lay.kind === 'barn' || lay.kind === 'barn-bypass' ? top + 1.5 : leafTop;
    if (lay.arched) poly(archPts(lf.x0, lf.x1, za, top - fw), { fill: slab, stroke: INK_SOFT, w: 0.15 });
    else out.push({ k: 'poly', pts: rect(lf.x0, lf.x1, za, zb), closed: true, fill: slab, stroke: INK_SOFT, w: 0.15 });
    leafStyle(lf.x0, lf.x1, za, lay.arched ? top - fw - (lf.x1 - lf.x0) / 2 : zb, lay.style, lf.hinge);
  }
  if (lay.kind === 'dutch') {
    const lf = lay.leaves[0];
    out.push({ k: 'poly', pts: rect(lf.x0 - 0.5, lf.x1 + 0.5, z0 + lay.leafH * 0.5 - 0.6, z0 + lay.leafH * 0.5 + 1.2), closed: true, fill: shade(slab, 0.8), stroke: INK, w: 0.15 });
  }
  // cabin screen / storm door (exterior elevations)
  if (d.screenDoor && exterior) {
    const lf = lay.leaves[0];
    out.push({ k: 'poly', pts: rect(lf.x0 + 0.5, lf.x1 - 0.5, z0 + 0.5, leafTop - 0.5), closed: true, stroke: '#3f3a36', w: 0.35 });
    out.push({ k: 'poly', pts: rect(lf.x0 + 3, lf.x1 - 3, z0 + 3, leafTop - 3), closed: true, fill: '#44403c', opacity: 0.25, w: 0 });
    ln(lf.x0 + 0.5, z0 + lay.leafH * 0.45, lf.x1 - 0.5, z0 + lay.leafH * 0.45, '#3f3a36', 0.3);
  }
  return out;
}

/** Plan geometry of a balcony: slab polygon and the railing path (3 outer sides). */
export function balconyPlan(wall: WallEntity, bc: BalconyEntity, sameLevelWalls: WallEntity[]): { slab: Point[]; railing: Point[] } {
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const d = { x: (wall.end.x - wall.start.x) / L, y: (wall.end.y - wall.start.y) / L };
  const side = wallExteriorSide(wall, sameLevelWalls);
  const out = side === 'left' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
  const c = { x: wall.start.x + d.x * bc.offset * L, y: wall.start.y + d.y * bc.offset * L };
  const face = { x: c.x + out.x * (wall.thickness / 2), y: c.y + out.y * (wall.thickness / 2) };
  const hw = bc.width / 2;
  const p1 = { x: face.x - d.x * hw, y: face.y - d.y * hw };
  const p2 = { x: face.x + d.x * hw, y: face.y + d.y * hw };
  const p3 = { x: p2.x + out.x * bc.depth, y: p2.y + out.y * bc.depth };
  const p4 = { x: p1.x + out.x * bc.depth, y: p1.y + out.y * bc.depth };
  const inset = 2;
  const r1 = { x: p1.x + d.x * inset, y: p1.y + d.y * inset };
  const r2 = { x: p4.x + d.x * inset - out.x * inset, y: p4.y + d.y * inset - out.y * inset };
  const r3 = { x: p3.x - d.x * inset - out.x * inset, y: p3.y - d.y * inset - out.y * inset };
  const r4 = { x: p2.x - d.x * inset, y: p2.y - d.y * inset };
  return { slab: [p1, p2, p3, p4], railing: [r1, r2, r3, r4] };
}

/** Elevation marker placement around the model (plan coords) and the direction each opens. */
export function elevationMarkerPositions(model: ArchModel, levelId?: string): Array<{ dir: ElevationDirection; at: Point; pointing: Point }> {
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall' && (!levelId || (e.levelId || 'level-1') === levelId));
  const pts = walls.flatMap((w) => [w.start, w.end]);
  const all = pts.length ? pts : model.entities.flatMap((e) => ('start' in e && 'end' in e ? [e.start as Point, e.end as Point] : []));
  if (!all.length) return [];
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const gap = Math.max(72, 0.2 * Math.max(maxX - minX, maxY - minY));
  return [
    { dir: 'north', at: { x: cx, y: minY - gap }, pointing: { x: 0, y: 1 } },
    { dir: 'south', at: { x: cx, y: maxY + gap }, pointing: { x: 0, y: -1 } },
    { dir: 'east', at: { x: maxX + gap, y: cy }, pointing: { x: -1, y: 0 } },
    { dir: 'west', at: { x: minX - gap, y: cy }, pointing: { x: 1, y: 0 } },
  ];
}

/** Picks the nearest hit region under an elevation-space point. */
export function hitTestElevation(drawing: ElevationDrawing, p: Point, filter?: (t: ElevationTarget) => boolean): ElevationHit | null {
  let best: ElevationHit | null = null;
  for (const h of drawing.hits) {
    if (filter && !filter(h.target)) continue;
    if (!pointInPolygon(p, h.poly)) continue;
    if (!best || h.depth < best.depth) best = h;
  }
  return best;
}

export const centroidOf = centroid;
