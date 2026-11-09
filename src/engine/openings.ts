/**
 * HOSTED OPENINGS — doors (DR), windows (WN) and wall openings (WO) embedded in walls.
 *
 * Pure functions only (no React, no three.js, no imports from geometry.ts so that geometry.ts can
 * use this module). Every opening is hosted by exactly one wall and stores:
 *   { wallId, offset (0..1 along the wall = positionAlongWall), width, height, sillHeight, depthPosition }
 * Doors have sillHeight 0 (the threshold sits on the wall base).
 *
 * Coordinates: plan inches, +Y down (SVG). "s" = distance along the wall from its start;
 * "across" = offset from the centre of the wall's thickness, positive toward the wall's LEFT normal.
 */
import { doorLayout, isSwingKind } from './doorStyles';
import type {
  ArchEntity,
  DepthPosition,
  DoorEntity,
  DoorKind,
  DoorType,
  WindowType,
  GridEntity,
  Point,
  WallAssemblyLayer,
  WallEntity,
  WallOpeningEntity,
  WindowEntity,
  WindowOperation,
} from '../types/model';

export type HostedOpening = DoorEntity | WindowEntity | WallOpeningEntity;

export function isHostedOpening(e: ArchEntity | null | undefined): e is HostedOpening {
  return !!e && (e.type === 'door' || e.type === 'window' || e.type === 'wallopening');
}

/** Minimum solid wall kept between an opening and the wall end (inches). */
export const END_CLEARANCE = 2;
const EPS = 1e-6;

// ------------------------------------------------------------------------------------------
// small vector helpers (kept local to avoid an import cycle with geometry.ts)
// ------------------------------------------------------------------------------------------
const vsub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const vadd = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const vscl = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const vdot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const vlen = (a: Point) => Math.hypot(a.x, a.y);
const vdist = (a: Point, b: Point) => vlen(vsub(a, b));

// ------------------------------------------------------------------------------------------
// WALL FRAME
// ------------------------------------------------------------------------------------------

export interface WallFrame {
  start: Point;
  end: Point;
  dir: Point;     // unit vector start → end
  normal: Point;  // unit LEFT normal of dir (plan, +Y down)
  length: number;
  thickness: number;
  /** across offset (along normal, from the location line) of the centre of the wall thickness */
  center: number;
  /** across offsets of the two faces from the location line */
  leftFace: number;
  rightFace: number;
}

export function wallFrame(w: WallEntity): WallFrame {
  const v = vsub(w.end, w.start);
  const L = vlen(v);
  const dir = L > EPS ? vscl(v, 1 / L) : { x: 1, y: 0 };
  const normal = { x: -dir.y, y: dir.x }; // same as geometry.perpLeft
  const t = w.thickness;
  let leftFace = t / 2;
  let rightFace = -t / 2;
  if (w.justification === 'interior') {
    leftFace = t;
    rightFace = 0;
  } else if (w.justification === 'exterior') {
    leftFace = 0;
    rightFace = -t;
  }
  return { start: w.start, end: w.end, dir, normal, length: L, thickness: t, center: (leftFace + rightFace) / 2, leftFace, rightFace };
}

/** World point at distance s along the wall and `across` from the centre of its thickness. */
export function wallPoint(f: WallFrame, s: number, across = 0): Point {
  return vadd(vadd(f.start, vscl(f.dir, s)), vscl(f.normal, f.center + across));
}

/** Projects a point onto the wall: distance along it and perpendicular distance to the location line. */
export function projectOnWall(f: WallFrame, p: Point): { s: number; distance: number } {
  const rel = vsub(p, f.start);
  const s = vdot(rel, f.dir);
  const sc = Math.max(0, Math.min(f.length, s));
  const foot = vadd(f.start, vscl(f.dir, sc));
  return { s, distance: vdist(foot, p) };
}

/** Average of the wall end points of a level (the "building centre" used to find exteriors). */
export function levelCentreOf(walls: WallEntity[]): Point {
  if (!walls.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const w of walls) {
    x += w.start.x + w.end.x;
    y += w.start.y + w.end.y;
  }
  return { x: x / (2 * walls.length), y: y / (2 * walls.length) };
}

/** 'left' or 'right' of the start→end direction is the exterior (explicit, else away from the building centre). */
export function exteriorSideOf(wall: WallEntity, sameLevelWalls: WallEntity[]): 'left' | 'right' {
  if (wall.exteriorSide === 'left' || wall.exteriorSide === 'right') return wall.exteriorSide;
  const c = levelCentreOf(sameLevelWalls);
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const L = Math.hypot(dx, dy) || 1;
  const left = { x: -dy / L, y: dx / L };
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  return (mid.x - c.x) * left.x + (mid.y - c.y) * left.y >= 0 ? 'left' : 'right';
}

/** +1 when the wall's exterior is on its LEFT normal, -1 otherwise. */
export function wallExtSign(wall: WallEntity, sameLevelWalls: WallEntity[]): number {
  return exteriorSideOf(wall, sameLevelWalls) === 'left' ? 1 : -1;
}

/** Across offset from the LOCATION line of an opening's frame centre (for plan layer returns). */
export function frameAcrossFromLocation(o: HostedOpening, wall: WallEntity, sameLevelWalls: WallEntity[]): number | null {
  if (o.type === 'wallopening') return null;
  const f = wallFrame(wall);
  const ext = openingExtSign(o, wallExtSign(wall, sameLevelWalls));
  return f.center + depthAcross(o.depthPosition, f.thickness, frameDepthOf(o, f.thickness), ext);
}

// ------------------------------------------------------------------------------------------
// OPENING EXTENTS
// ------------------------------------------------------------------------------------------

export function sillOf(o: HostedOpening): number {
  return o.type === 'door' ? 0 : Math.max(0, o.sillHeight || 0);
}

/** Head height = sill + height (doors: height). */
export function headOf(o: HostedOpening): number {
  return sillOf(o) + o.height;
}

/** Centre distance along the host wall. */
export function centerS(o: { offset: number }, L: number): number {
  return o.offset * L;
}

export function openingSpan(o: { offset: number; width: number }, L: number): { s0: number; s1: number } {
  const c = o.offset * L;
  return { s0: c - o.width / 2, s1: c + o.width / 2 };
}

export function openingZ(o: HostedOpening): { z0: number; z1: number } {
  return { z0: sillOf(o), z1: headOf(o) };
}

// ------------------------------------------------------------------------------------------
// FIT / OVERLAP
// ------------------------------------------------------------------------------------------

export interface OpeningLike {
  id?: string;
  offset: number;
  width: number;
  z0: number;
  z1: number;
}

export function asLike(o: HostedOpening): OpeningLike {
  const z = openingZ(o);
  return { id: o.id, offset: o.offset, width: o.width, z0: z.z0, z1: z.z1 };
}

/**
 * True when two openings on the same wall collide: their spans along the wall overlap AND their
 * height ranges overlap (a high window may sit above a door).
 */
export function openingsOverlap(a: OpeningLike, b: OpeningLike, wallLength: number, gap = 0): boolean {
  const A = openingSpan(a, wallLength);
  const B = openingSpan(b, wallLength);
  const alongOverlap = A.s0 < B.s1 + gap - 1e-4 && B.s0 < A.s1 + gap - 1e-4;
  const zOverlap = a.z0 < b.z1 - 1e-4 && b.z0 < a.z1 - 1e-4;
  return alongOverlap && zOverlap;
}

export type FitIssue = 'overlap' | 'past-end' | 'too-short' | 'too-tall';

export interface FitResult {
  ok: boolean;
  issues: FitIssue[];
  overlapIds: string[];
}

/** Can an opening of this size sit at this place on the wall? */
export function checkOpeningFit(wall: WallEntity, cand: OpeningLike, others: OpeningLike[], clearance = END_CLEARANCE): FitResult {
  const L = wallFrame(wall).length;
  const issues: FitIssue[] = [];
  const { s0, s1 } = openingSpan(cand, L);
  if (cand.width + 2 * clearance > L + 1e-6) issues.push('too-short');
  else if (s0 < clearance - 1e-4 || s1 > L - clearance + 1e-4) issues.push('past-end');
  if (cand.z1 > (wall.height || 108) + 1e-4) issues.push('too-tall');
  const overlapIds: string[] = [];
  for (const o of others) {
    if (o.id && cand.id && o.id === cand.id) continue;
    if (openingsOverlap(cand, o, L)) overlapIds.push(o.id || '?');
  }
  if (overlapIds.length) issues.push('overlap');
  return { ok: issues.length === 0, issues, overlapIds };
}

export interface OpeningWarning {
  id: string;
  wallId: string;
  issue: FitIssue;
  at: Point;
  message: string;
}

/** Hosting warnings for every opening (wall too short, past the wall end, overlaps, taller than the wall). */
export function openingWarnings(entities: ArchEntity[]): OpeningWarning[] {
  const walls = new Map<string, WallEntity>();
  const byWall = new Map<string, HostedOpening[]>();
  for (const e of entities) {
    if (e.type === 'wall') walls.set(e.id, e);
    else if (isHostedOpening(e)) {
      const arr = byWall.get(e.wallId) || [];
      arr.push(e);
      byWall.set(e.wallId, arr);
    }
  }
  const out: OpeningWarning[] = [];
  for (const [wallId, ops] of byWall) {
    const w = walls.get(wallId);
    if (!w) continue;
    const f = wallFrame(w);
    const likes = ops.map(asLike);
    ops.forEach((o, i) => {
      const r = checkOpeningFit(w, likes[i], likes, 0);
      const at = wallPoint(f, centerS(o, f.length), 0);
      const name = o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening';
      for (const issue of r.issues) {
        const message =
          issue === 'too-short'
            ? `${name} ${o.mark || ''} is wider than its host wall — lengthen the wall or narrow the ${name.toLowerCase()}.`
            : issue === 'past-end'
            ? `${name} ${o.mark || ''} runs past the end of its host wall.`
            : issue === 'too-tall'
            ? `${name} ${o.mark || ''} is taller than its host wall.`
            : `${name} ${o.mark || ''} overlaps another opening on the same wall.`;
        out.push({ id: o.id, wallId, issue, at, message: message.replace(/\s+/g, ' ') });
      }
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// SNAPPING ALONG THE WALL (Center, EQ)
// ------------------------------------------------------------------------------------------

export interface AlongSnap {
  s: number;
  kind: 'center' | 'eq' | null;
  label?: string;
}

/** Keeps an opening of `width` fully inside the wall (when the wall is long enough). */
export function clampAlong(L: number, width: number, s: number, clearance = END_CLEARANCE): number {
  const lo = width / 2 + clearance;
  const hi = L - width / 2 - clearance;
  if (hi < lo) return L / 2;
  return Math.max(lo, Math.min(hi, s));
}

/**
 * Snaps a raw position along the wall to the wall midpoint ("Center") or to the middle of the free
 * gap between neighbours / wall ends ("EQ" — equal clear spacing on both sides).
 */
export function snapAlongWall(
  L: number,
  rawS: number,
  width: number,
  others: OpeningLike[],
  tol: number,
  opts: { center?: boolean; eq?: boolean; clearance?: number } = {}
): AlongSnap {
  const clearance = opts.clearance ?? END_CLEARANCE;
  const s = clampAlong(L, width, rawS, clearance);
  const cands: AlongSnap[] = [];
  if (opts.center !== false) cands.push({ s: L / 2, kind: 'center', label: 'Center' });
  if (opts.eq !== false && others.length) {
    // obstacles: wall ends and other openings (sorted)
    const spans = others.map((o) => openingSpan(o, L)).sort((a, b) => a.s0 - b.s0);
    const edges: Array<[number, number]> = [];
    let cur = 0;
    for (const sp of spans) {
      if (sp.s0 > cur) edges.push([cur, sp.s0]);
      cur = Math.max(cur, sp.s1);
    }
    if (cur < L) edges.push([cur, L]);
    for (const [a, b] of edges) {
      if (b - a >= width + 2) cands.push({ s: (a + b) / 2, kind: 'eq', label: 'EQ' });
    }
  }
  let best: AlongSnap | null = null;
  for (const c of cands) {
    const d = Math.abs(c.s - rawS);
    if (d <= tol && (!best || d < Math.abs(best.s - rawS))) best = c;
  }
  return best ? { ...best, s: clampAlong(L, width, best.s, clearance) } : { s, kind: null };
}

// ------------------------------------------------------------------------------------------
// TEMPORARY DIMENSIONS (Revit-style, light blue)
// ------------------------------------------------------------------------------------------

export interface TempDim {
  key: string;
  kind: 'wall-end' | 'opening' | 'grid';
  /** reference station along the wall (wall end, neighbour edge, grid crossing) */
  refS: number;
  /** which part of the opening is measured */
  edge: 'min' | 'max' | 'center';
  value: number;
  a: Point;
  b: Point;
}

/** Stations (along the wall) where grid lines cross the wall's location line. */
export function gridCrossings(f: WallFrame, grids: GridEntity[]): Array<{ s: number; label: string }> {
  const out: Array<{ s: number; label: string }> = [];
  for (const g of grids) {
    const d = vsub(g.end, g.start);
    const den = f.dir.x * d.y - f.dir.y * d.x;
    if (Math.abs(den) < 1e-9) continue;
    const w = vsub(g.start, f.start);
    const s = (w.x * d.y - w.y * d.x) / den;
    if (s >= -1e-6 && s <= f.length + 1e-6) out.push({ s, label: g.label });
  }
  return out;
}

/**
 * Temporary dimensions for an opening at centre station `s` on `wall`:
 * from the nearest obstacle on each side (wall end or neighbouring opening edge) to the opening
 * edge, plus the nearest grid line to the opening centre. `across` places the witness line.
 */
export function temporaryDimensions(
  wall: WallEntity,
  s: number,
  width: number,
  others: OpeningLike[],
  grids: GridEntity[],
  across: number
): TempDim[] {
  const f = wallFrame(wall);
  const L = f.length;
  const s0 = s - width / 2;
  const s1 = s + width / 2;
  let left = 0;
  let leftKind: TempDim['kind'] = 'wall-end';
  let right = L;
  let rightKind: TempDim['kind'] = 'wall-end';
  for (const o of others) {
    const sp = openingSpan(o, L);
    if (sp.s1 <= s0 + 1e-6 && sp.s1 > left) {
      left = sp.s1;
      leftKind = 'opening';
    }
    if (sp.s0 >= s1 - 1e-6 && sp.s0 < right) {
      right = sp.s0;
      rightKind = 'opening';
    }
  }
  const P = (st: number) => wallPoint(f, st, across);
  const dims: TempDim[] = [
    { key: 'left', kind: leftKind, refS: left, edge: 'min', value: Math.abs(s0 - left), a: P(left), b: P(s0) },
    { key: 'right', kind: rightKind, refS: right, edge: 'max', value: Math.abs(right - s1), a: P(s1), b: P(right) },
  ];
  const gx = gridCrossings(f, grids);
  if (gx.length) {
    const g = gx.reduce((b, c) => (Math.abs(c.s - s) < Math.abs(b.s - s) ? c : b));
    if (Math.abs(g.s - s) > 0.05) {
      const acrossG = across + Math.sign(across || 1) * 14;
      dims.push({ key: `grid-${g.label}`, kind: 'grid', refS: g.s, edge: 'center', value: Math.abs(s - g.s), a: wallPoint(f, g.s, acrossG), b: wallPoint(f, s, acrossG) });
    }
  }
  return dims;
}

/** New centre station when the user types `value` into a temporary dimension. */
export function applyTempDimValue(dim: TempDim, value: number, width: number, currentS: number): number {
  const edgeOffset = dim.edge === 'min' ? -width / 2 : dim.edge === 'max' ? width / 2 : 0;
  const curEdge = currentS + edgeOffset;
  const sign = curEdge >= dim.refS ? 1 : -1;
  return dim.refS + sign * Math.max(0, value) - edgeOffset;
}

// ------------------------------------------------------------------------------------------
// DEPTH POSITION (frame within the wall thickness)
// ------------------------------------------------------------------------------------------

/** Default frame depth for each opening type (inches; never more than the wall). */
export function frameDepthOf(o: HostedOpening, wallThickness: number): number {
  if (o.type === 'wallopening') return 0;
  const want = o.type === 'door' ? ((o.kind || 'single') === 'garage' ? 3 : 4.5) : 3.5;
  return Math.max(0.5, Math.min(wallThickness, want));
}

/**
 * Across offset (from the thickness centre, + = wall LEFT normal) of the centre of the frame.
 * extSign = +1 when the exterior is on the wall's left normal, -1 otherwise.
 */
export function depthAcross(dp: DepthPosition | undefined, thickness: number, frameDepth: number, extSign: number): number {
  const room = Math.max(0, thickness / 2 - frameDepth / 2);
  let k: number;
  if (dp === 'exterior') k = room;
  else if (dp === 'interior') k = -room;
  else if (typeof dp === 'number' && isFinite(dp)) k = Math.max(-room, Math.min(room, dp));
  else k = 0;
  return extSign * k;
}

/** Exterior sign of an opening's host after its own flip (windows can swap the exterior side). */
export function openingExtSign(o: HostedOpening, wallExtSign: number): number {
  return o.type === 'window' && o.flipFacing ? -wallExtSign : wallExtSign;
}

export function depthLabel(dp: DepthPosition | undefined): string {
  if (dp === 'exterior') return 'Exterior';
  if (dp === 'interior') return 'Interior';
  if (typeof dp === 'number') return `Custom (${dp > 0 ? '+' : ''}${Math.round(dp * 100) / 100}")`;
  return 'Center';
}

// ------------------------------------------------------------------------------------------
// HOSTING THROUGH WALL EDITS (move / rotate / stretch / split)
// ------------------------------------------------------------------------------------------

const samePt = (a: Point, b: Point, tol = 1e-3) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/**
 * Re-anchors an opening after its host wall changed from `oldWall` to `newWall` so it keeps its
 * position relative to the wall:
 *  - moved / rotated / mirrored as a whole → same parametric offset (it rides along);
 *  - stretched with one end fixed → keeps its distance from the FIXED end (Revit behaviour), so it
 *    does not creep when the other end is dragged.
 * It is never clamped or deleted: if the wall becomes too short the opening stays and a warning shows.
 */
export function reanchorOpening<T extends { offset: number }>(o: T, oldWall: WallEntity, newWall: WallEntity): T {
  const oldL = vdist(oldWall.start, oldWall.end);
  const newL = vdist(newWall.start, newWall.end);
  if (oldL < EPS || newL < EPS || Math.abs(oldL - newL) < 1e-6) return o;
  const startFixed = samePt(oldWall.start, newWall.start);
  const endFixed = samePt(oldWall.end, newWall.end);
  if (startFixed && !endFixed) return { ...o, offset: (o.offset * oldL) / newL };
  if (endFixed && !startFixed) return { ...o, offset: 1 - ((1 - o.offset) * oldL) / newL };
  return o; // scaled about some other point: keep the relative position
}

/** World point of an opening centre on the wall's location line. */
function openingWorld(o: { offset: number }, w: WallEntity): Point {
  return vadd(w.start, vscl(vsub(w.end, w.start), o.offset));
}

/**
 * Keeps hosted openings embedded when walls are edited anywhere in the app. Compares the previous
 * and next entity lists:
 *  - host changed length with one end fixed → opening keeps its distance from that end;
 *  - host was split / replaced (old id gone) → opening is re-hosted onto the new collinear wall that
 *    contains it (never deleted silently).
 * Openings the edit itself changed (new offset or host) are left as the edit made them.
 */
export function reanchorHostedOpenings(prev: ArchEntity[], next: ArchEntity[]): ArchEntity[] {
  const prevWalls = new Map<string, WallEntity>();
  const prevOps = new Map<string, HostedOpening>();
  for (const e of prev) {
    if (e.type === 'wall') prevWalls.set(e.id, e);
    else if (isHostedOpening(e)) prevOps.set(e.id, e);
  }
  if (!prevOps.size) return next;
  const nextWalls = new Map<string, WallEntity>();
  for (const e of next) if (e.type === 'wall') nextWalls.set(e.id, e);
  let changed = false;
  const out = next.map((e) => {
    if (!isHostedOpening(e)) return e;
    const before = prevOps.get(e.id);
    if (!before || before.wallId !== e.wallId || Math.abs(before.offset - e.offset) > 1e-9) return e;
    const oldW = prevWalls.get(e.wallId);
    const newW = nextWalls.get(e.wallId);
    if (oldW && newW) {
      if (samePt(oldW.start, newW.start) && samePt(oldW.end, newW.end)) return e;
      const r = reanchorOpening(e, oldW, newW);
      if (r !== e) changed = true;
      return r;
    }
    if (oldW && !newW) {
      // host split / replaced: find the new collinear wall containing the opening centre
      const p = openingWorld(e, oldW);
      let best: { w: WallEntity; s: number; d: number } | null = null;
      for (const w of nextWalls.values()) {
        const f = wallFrame(w);
        if (Math.abs(vdot(f.dir, wallFrame(oldW).dir)) < 0.999) continue;
        const pr = projectOnWall(f, p);
        if (pr.s < -1e-6 || pr.s > f.length + 1e-6 || pr.distance > 1) continue;
        if (!best || pr.distance < best.d) best = { w, s: pr.s, d: pr.distance };
      }
      if (best) {
        changed = true;
        return { ...e, wallId: best.w.id, offset: best.s / Math.max(EPS, wallFrame(best.w).length) };
      }
    }
    return e;
  });
  return changed ? out : next;
}

/** Openings hosted by any of the given walls that are not themselves in `ids`. */
export function hostedOpeningsOf(entities: ArchEntity[], wallIds: string[], excludeIds: string[] = []): HostedOpening[] {
  const set = new Set(wallIds);
  const ex = new Set(excludeIds);
  return entities.filter((e): e is HostedOpening => isHostedOpening(e) && set.has(e.wallId) && !ex.has(e.id));
}

// ------------------------------------------------------------------------------------------
// DRAG: slide along the host, or re-host onto another wall
// ------------------------------------------------------------------------------------------

/** Nearest wall to a point (within `maxDist`, or 1.5 × its thickness). */
export function nearestWall(p: Point, walls: WallEntity[], maxDist: number): { wall: WallEntity; s: number; distance: number } | null {
  let best: { wall: WallEntity; s: number; distance: number } | null = null;
  for (const w of walls) {
    const f = wallFrame(w);
    if (f.length < 1) continue;
    const pr = projectOnWall(f, p);
    if (pr.s < -2 || pr.s > f.length + 2) continue;
    if (pr.distance > Math.max(maxDist, w.thickness * 1.5)) continue;
    if (!best || pr.distance < best.distance) best = { wall: w, s: Math.max(0, Math.min(f.length, pr.s)), distance: pr.distance };
  }
  return best;
}

/**
 * Drags an opening to `p`: it slides along its host (clamped so it can never leave the wall), and
 * jumps to another wall when the cursor is clearly over that wall instead.
 */
export function dragOpening<T extends HostedOpening>(o: T, p: Point, walls: WallEntity[], tol = 18): T {
  const host = walls.find((w) => w.id === o.wallId);
  const near = nearestWall(p, walls, tol);
  if (near && host && near.wall.id !== host.id) {
    const hp = projectOnWall(wallFrame(host), p);
    if (near.distance + 1 < hp.distance || hp.s < -o.width / 2 || hp.s > wallFrame(host).length + o.width / 2) {
      const L = wallFrame(near.wall).length;
      return { ...o, wallId: near.wall.id, levelId: near.wall.levelId ?? o.levelId, offset: clampAlong(L, o.width, near.s) / L };
    }
  }
  if (!host) return o;
  const f = wallFrame(host);
  const s = clampAlong(f.length, o.width, projectOnWall(f, p).s);
  return { ...o, offset: s / f.length };
}

/** Drags one jamb (side) of an opening: the other side stays put, the width changes. */
export function dragOpeningSide<T extends HostedOpening>(o: T, side: 'min' | 'max', p: Point, host: WallEntity, minWidth = 12): T {
  const f = wallFrame(host);
  const L = f.length;
  const { s0, s1 } = openingSpan(o, L);
  const s = Math.max(0, Math.min(L, projectOnWall(f, p).s));
  let a = s0;
  let b = s1;
  if (side === 'min') a = Math.min(s, s1 - minWidth);
  else b = Math.max(s, s0 + minWidth);
  return { ...o, width: b - a, offset: (a + b) / 2 / L };
}

// ------------------------------------------------------------------------------------------
// EQUAL SPACING / COPY / ARRAY ALONG A WALL
// ------------------------------------------------------------------------------------------

/** Offsets that space the given openings equally along their wall (equal clear gaps, ends included). */
export function equalSpacingOffsets(L: number, ops: Array<{ id: string; offset: number; width: number }>): Map<string, number> {
  const sorted = [...ops].sort((a, b) => a.offset - b.offset);
  const totalW = sorted.reduce((s, o) => s + o.width, 0);
  const gap = (L - totalW) / (sorted.length + 1);
  const out = new Map<string, number>();
  let cur = gap;
  for (const o of sorted) {
    out.set(o.id, (cur + o.width / 2) / L);
    cur += o.width + gap;
  }
  return out;
}

/** Centre offsets for `count` openings spread with equal spacing between `fromS` and `toS` (stations). */
export function arrayAlongWall(L: number, fromS: number, toS: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [fromS / L];
  return Array.from({ length: n }, (_, i) => (fromS + ((toS - fromS) * i) / (n - 1)) / L);
}

/** Shifts an opening along its host by the along-wall component of a plan displacement. */
export function slideByDelta<T extends { offset: number }>(o: T, wall: WallEntity, delta: Point): T {
  const f = wallFrame(wall);
  return { ...o, offset: o.offset + vdot(delta, f.dir) / Math.max(EPS, f.length) };
}

/**
 * MOVE for a selection that may include hosted openings:
 *  - openings whose host also moves ride along unchanged;
 *  - openings moved on their own slide along their wall (or re-host onto the wall under their new spot).
 */
export function moveSelectionHosted(
  entities: ArchEntity[],
  ids: string[],
  delta: Point,
  moveFn: (e: ArchEntity, d: Point) => ArchEntity
): ArchEntity[] {
  const sel = new Set(ids);
  const walls = entities.filter((e): e is WallEntity => e.type === 'wall');
  const wallMap = new Map(walls.map((w) => [w.id, w] as const));
  return entities.map((e) => {
    if (!sel.has(e.id)) return e;
    if (!isHostedOpening(e)) return moveFn(e, delta);
    if (sel.has(e.wallId)) return e;
    const host = wallMap.get(e.wallId);
    if (!host) return e;
    const target = vadd(openingWorld(e, host), delta);
    return dragOpening(e, target, walls.filter((w) => !sel.has(w.id) && (w.levelId || 'level-1') === (host.levelId || 'level-1')), 12);
  });
}

/**
 * COPY / ARRAY for a selection that may include walls and hosted openings. Returns only the copies.
 *  - copied walls bring their hosted openings with them (Revit behaviour);
 *  - an opening copied without its wall slides along its wall (or onto the wall under its new spot);
 *    copies that would land off every wall are skipped.
 */
export function copySelectionHosted(
  entities: ArchEntity[],
  ids: string[],
  delta: Point,
  moveFn: (e: ArchEntity, d: Point) => ArchEntity,
  newId: (e: ArchEntity, i: number) => string
): ArchEntity[] {
  const sel = new Set(ids);
  const walls = entities.filter((e): e is WallEntity => e.type === 'wall');
  const wallMap = new Map(walls.map((w) => [w.id, w] as const));
  const out: ArchEntity[] = [];
  const wallIdMap = new Map<string, string>();
  let i = 0;
  for (const e of entities) {
    if (!sel.has(e.id) || isHostedOpening(e)) continue;
    const c = { ...moveFn(e, delta), id: newId(e, i++) } as ArchEntity;
    if (e.type === 'wall') wallIdMap.set(e.id, c.id);
    out.push(c);
  }
  const copiedWalls = out.filter((e): e is WallEntity => e.type === 'wall');
  for (const e of entities) {
    if (!isHostedOpening(e)) continue;
    const newHost = wallIdMap.get(e.wallId);
    if (newHost) {
      out.push({ ...e, id: newId(e, i++), wallId: newHost, mark: undefined } as ArchEntity);
      continue;
    }
    if (!sel.has(e.id)) continue;
    const host = wallMap.get(e.wallId);
    if (!host) continue;
    const target = vadd(openingWorld(e, host), delta);
    const candidates = [...walls, ...copiedWalls].filter((w) => (w.levelId || 'level-1') === (host.levelId || 'level-1'));
    const near = nearestWall(target, candidates, 12);
    if (!near) continue;
    const L = wallFrame(near.wall).length;
    const s = projectOnWall(wallFrame(near.wall), target).s;
    if (s < o2w(e) || s > L - o2w(e)) continue; // would hang off the wall
    out.push({ ...e, id: newId(e, i++), wallId: near.wall.id, offset: s / L, mark: undefined } as ArchEntity);
  }
  return out;
}
const o2w = (o: { width: number }) => o.width / 2 - 1e-6;

// ------------------------------------------------------------------------------------------
// PLAN CUT
// ------------------------------------------------------------------------------------------

/** Merged gaps [s0, s1] cut through the wall in plan by its hosted openings (clipped to the wall). */
export function planCutGaps(wall: WallEntity, openings: HostedOpening[]): Array<{ s0: number; s1: number; ids: string[] }> {
  const L = wallFrame(wall).length;
  const spans = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ ...openingSpan(o, L), id: o.id }))
    .map((g) => ({ s0: Math.max(0, g.s0), s1: Math.min(L, g.s1), id: g.id }))
    .filter((g) => g.s1 - g.s0 > 0.25)
    .sort((a, b) => a.s0 - b.s0);
  const out: Array<{ s0: number; s1: number; ids: string[] }> = [];
  for (const g of spans) {
    const last = out[out.length - 1];
    if (last && g.s0 <= last.s1 + 1e-6) {
      last.s1 = Math.max(last.s1, g.s1);
      last.ids.push(g.id);
    } else out.push({ s0: g.s0, s1: g.s1, ids: [g.id] });
  }
  return out;
}

/** Solid intervals of the wall between the cut gaps. */
export function solidIntervals(L: number, gaps: Array<{ s0: number; s1: number }>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = 0;
  for (const g of gaps) {
    if (g.s0 > cur + 0.05) out.push([cur, g.s0]);
    cur = Math.max(cur, g.s1);
  }
  if (cur < L - 0.05) out.push([cur, L]);
  return out;
}

const isFinish = (l: WallAssemblyLayer) => l.function === 'finish1' || l.function === 'finish2';

/**
 * Compound-layer bands for a wall cut by openings, with the FINISH layers returned (wrapped) into
 * each opening up to the frame: the core layers stop short of the jamb by the finish thickness and
 * the finish turns the corner to meet the frame plane.
 *
 * Bands are given as `across` ranges from the LOCATION line (same convention as geometry's
 * computeWallLayerBands). `jambPlane(gapIndex)` returns the across value (from the location line)
 * of the frame plane at that gap, or null for "no frame" (finishes meet at the core centre).
 */
export function layerBandsWithReturns(
  wall: WallEntity,
  layers: Array<WallAssemblyLayer & { hi: number; lo: number }>,
  gaps: Array<{ s0: number; s1: number; noReturn?: boolean }>,
  jambPlane: (gapIndex: number) => number | null,
  opts: {
    /** joined wall ends: station at across c (core layers may run further, e.g. into a T main wall) */
    endS?: (which: 'start' | 'end', c: number, core: boolean) => number;
    /** finish layers interrupted where a T stem's core runs into this wall */
    finishGaps?: Array<{ s0: number; s1: number; side: 'left' | 'right' }>;
  } = {}
): Array<{ layer: WallAssemblyLayer; polygons: Point[][]; dividers: Array<[Point, Point]> }> {
  const f = wallFrame(wall);
  const L = f.length;
  const W = (s: number, c: number): Point => vadd(vadd(f.start, vscl(f.dir, s)), vscl(f.normal, c));
  const coreIdx = layers.map((l, i) => (isFinish(l) ? -1 : i)).filter((i) => i >= 0);
  const k0 = coreIdx.length ? coreIdx[0] : 0;
  const k1 = coreIdx.length ? coreIdx[coreIdx.length - 1] : layers.length - 1;
  const leftFin = layers.slice(0, k0);
  const rightFin = layers.slice(k1 + 1);
  const tl = leftFin.reduce((s, l) => s + (l.hi - l.lo), 0);
  const tr = rightFin.reduce((s, l) => s + (l.hi - l.lo), 0);
  const coreHi = layers[k0]?.hi ?? f.leftFace;
  const coreLo = layers[k1]?.lo ?? f.rightFace;

  // solid intervals with their jamb info
  const solids: Array<{ a: number; b: number; ja: number | null; jb: number | null }> = [];
  let cur = 0;
  let prevGap = -1;
  gaps.forEach((g, gi) => {
    if (g.s0 > cur + 0.05) solids.push({ a: cur, b: g.s0, ja: prevGap >= 0 ? prevGap : null, jb: gi });
    cur = Math.max(cur, g.s1);
    prevGap = gi;
  });
  if (cur < L - 0.05) solids.push({ a: cur, b: L, ja: prevGap >= 0 ? prevGap : null, jb: null });

  const plane = (gi: number) => {
    const p = jambPlane(gi);
    return p === null ? (coreHi + coreLo) / 2 : Math.max(coreLo, Math.min(coreHi, p));
  };

  return layers.map((layer, idx) => {
    const polygons: Point[][] = [];
    const dividers: Array<[Point, Point]> = [];
    const core = idx >= k0 && idx <= k1 && coreIdx.length > 0;
    // finish layers on a face where a T stem's core runs in are interrupted over the stem's core
    const side: 'left' | 'right' | null = idx < k0 ? 'left' : idx > k1 ? 'right' : null;
    const fg = side ? (opts.finishGaps || []).filter((g) => g.side === side) : [];
    const mySolids = fg.length
      ? solids.flatMap((sol) => {
          let pieces = [sol];
          for (const g of fg) {
            pieces = pieces.flatMap((p) => {
              if (g.s1 <= p.a + 1e-6 || g.s0 >= p.b - 1e-6) return [p];
              const out: typeof solids = [];
              if (g.s0 > p.a + 0.05) out.push({ a: p.a, b: g.s0, ja: p.ja, jb: null });
              if (g.s1 < p.b - 0.05) out.push({ a: g.s1, b: p.b, ja: null, jb: p.jb });
              return out;
            });
          }
          return pieces;
        })
      : solids;
    for (const sol of mySolids) {
      // end station as a function of across c (core layers are notched back by the returning finish)
      const endAt = (j: number | null, dirIn: 1 | -1, base: number, c: number) => {
        if (j === null && opts.endS && (base <= 1e-9 || base >= L - 1e-9)) return opts.endS(base <= 1e-9 ? 'start' : 'end', c, core);
        if (!core || j === null || gaps[j]?.noReturn) return base;
        const cf = plane(j);
        return base + dirIn * (c > cf ? tl : tr);
      };
      const lenA = (c: number) => endAt(sol.ja, 1, sol.a, c);
      const lenB = (c: number) => endAt(sol.jb, -1, sol.b, c);
      const pts: Point[] = [];
      const hi = layer.hi;
      const lo = layer.lo;
      const stepsA = sol.ja !== null && core ? [plane(sol.ja)].filter((c) => c > lo + 1e-6 && c < hi - 1e-6) : [];
      const stepsB = sol.jb !== null && core ? [plane(sol.jb)].filter((c) => c > lo + 1e-6 && c < hi - 1e-6) : [];
      // top edge (hi) from A to B
      pts.push(W(lenA(hi - 1e-9), hi), W(lenB(hi - 1e-9), hi));
      // B side going down (hi → lo) with a step at the frame plane
      for (const c of stepsB) pts.push(W(lenB(c + 1e-9), c), W(lenB(c - 1e-9), c));
      pts.push(W(lenB(lo + 1e-9), lo), W(lenA(lo + 1e-9), lo));
      // A side going up (lo → hi)
      for (const c of stepsA.slice().reverse()) pts.push(W(lenA(c - 1e-9), c), W(lenA(c + 1e-9), c));
      const clean = pts.filter((p, i) => i === 0 || vdist(p, pts[i - 1]) > 1e-6);
      if (clean.length >= 3) polygons.push(clean);
      if (idx < layers.length - 1) dividers.push([W(lenA(lo + 1e-9), lo), W(lenB(lo + 1e-9), lo)]);

      // finish returns: the face finish layer (outermost of each side) lines the jamb up to the frame
      const returns: Array<{ j: number | null; base: number; dirIn: 1 | -1 }> = [
        { j: sol.ja, base: sol.a, dirIn: 1 },
        { j: sol.jb, base: sol.b, dirIn: -1 },
      ];
      for (const r of returns) {
        if (r.j === null || gaps[r.j]?.noReturn) continue;
        const cf = plane(r.j);
        if (idx === 0 && tl > 0 && cf < coreHi) {
          polygons.push([W(r.base, coreHi), W(r.base + r.dirIn * tl, coreHi), W(r.base + r.dirIn * tl, cf), W(r.base, cf)]);
        }
        if (idx === layers.length - 1 && tr > 0 && cf > coreLo) {
          polygons.push([W(r.base, cf), W(r.base + r.dirIn * tr, cf), W(r.base + r.dirIn * tr, coreLo), W(r.base, coreLo)]);
        }
      }
    }
    return { layer, polygons, dividers };
  });
}

// ------------------------------------------------------------------------------------------
// PLAN SYMBOLS (shared by screen, sheets/PDF and DXF)
// ------------------------------------------------------------------------------------------

export interface OpeningPlanSymbol {
  /** closed, white-filled frame / panel outlines */
  frames: Point[][];
  /** solid lines (glass, leaves, sills) */
  lines: Array<[Point, Point]>;
  /** thin lines (glass, stool / sill lines at the wall faces) */
  thin: Array<[Point, Point]>;
  /** dashed lines / polylines (swing arcs, overhead heads, garage track) */
  dashed: Point[][];
  /** hit outline for picking */
  hit: Point[];
  center: Point;
}

function sampleArcPts(c: Point, r: number, a0: number, a1: number): Point[] {
  const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 30)));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

/** Arc from `from` around `hinge` to `to` (shortest sweep). */
function swingArc(hinge: Point, from: Point, to: Point): Point[] {
  const r = vdist(hinge, from);
  const a0 = Math.atan2(from.y - hinge.y, from.x - hinge.x);
  let a1 = Math.atan2(to.y - hinge.y, to.x - hinge.x);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  return sampleArcPts(hinge, r, a0, a1);
}

/**
 * Plan symbol for a hosted opening. `wallExtSign` = +1 when the host's exterior is on its LEFT normal.
 * The wall polygons already break at the opening and close it with jamb lines; this draws what sits
 * IN the opening: frame + glass at the depth position (windows), leaf + swing (doors), head lines (WO).
 */
export function openingPlanSymbol(o: HostedOpening, wall: WallEntity, wallExtSign: number): OpeningPlanSymbol {
  const f = wallFrame(wall);
  const L = f.length;
  const c = centerS(o, L);
  const s0 = c - o.width / 2;
  const s1 = c + o.width / 2;
  const t = f.thickness;
  const P = (s: number, a: number) => wallPoint(f, s, a);
  const rect = (sa: number, sb: number, aa: number, ab: number): Point[] => [P(sa, aa), P(sb, aa), P(sb, ab), P(sa, ab)];
  const out: OpeningPlanSymbol = { frames: [], lines: [], thin: [], dashed: [], hit: rect(s0, s1, t / 2 + 2, -t / 2 - 2), center: P(c, 0) };
  const ext = openingExtSign(o, wallExtSign);

  if (o.type === 'wallopening') {
    // overhead head lines at both faces (the wall continues above the opening)
    out.dashed.push([P(s0, t / 2), P(s1, t / 2)], [P(s0, -t / 2), P(s1, -t / 2)]);
    if (o.shape === 'arch') out.dashed.push([P(c, t / 2), P(c, -t / 2)]);
    return out;
  }

  const fd = frameDepthOf(o, t);
  const fc = depthAcross(o.depthPosition, t, fd, ext);
  const fa = fc - fd / 2;
  const fb = fc + fd / 2;

  if (o.type === 'window') {
    const op: WindowOperation = o.operation || 'fixed';
    const fw = Math.min(o.width / 4, Math.max(1, o.frameWidth ?? 2.5));
    out.frames.push(rect(s0, s0 + fw, fa, fb), rect(s1 - fw, s1, fa, fb));
    if (op === 'slider') {
      const m = (s0 + s1) / 2;
      out.frames.push(rect(s0 + fw, m + 1.5, fc, fc + 0.9 * ext), rect(m - 1.5, s1 - fw, fc - 0.9 * ext, fc));
    } else if (op === 'double-hung') {
      out.lines.push([P(s0 + fw, fc + 0.6), P(s1 - fw, fc + 0.6)], [P(s0 + fw, fc - 0.6), P(s1 - fw, fc - 0.6)]);
    } else {
      out.lines.push([P(s0 + fw, fc), P(s1 - fw, fc)]);
      if (op === 'casement') {
        // casement sash swings out: thin dashed swing from the hinge jamb
        const hinge = P(s0 + fw, fc + (ext * fd) / 2);
        const tip = P(s0 + fw, fc + (ext * fd) / 2 + ext * Math.min(o.width - 2 * fw, 30));
        out.dashed.push(swingArc(hinge, P(s1 - fw, fc + (ext * fd) / 2), tip));
      }
    }
    // the frame head/sill line across the frame faces
    out.thin.push([P(s0 + fw, fa), P(s1 - fw, fa)], [P(s0 + fw, fb), P(s1 - fw, fb)]);
    // exterior sill and interior stool at the wall faces
    out.thin.push([P(s0, t / 2), P(s1, t / 2)], [P(s0, -t / 2), P(s1, -t / 2)]);
    return out;
  }

  // ---- doors: one layout (doorStyles.ts) shared with the elevation and 3D
  const lay = doorLayout(o);
  const kind: DoorKind = lay.kind;
  const inward = o.swing.endsWith('in');
  const swingSide = inward ? 1 : -1; // + = wall LEFT normal (existing 'in' convention)
  const fw = lay.frame;
  const X = (x: number) => s0 + x; // layout x → station along the wall
  out.frames.push(rect(s0, s0 + fw, fa, fb), rect(s1 - fw, s1, fa, fb));
  // sidelights: glass in the frame plane with a mullion between sidelight and leaf
  for (const sl of lay.sidelights) {
    out.lines.push([P(X(sl.x0), fc), P(X(sl.x1), fc)]);
    const mull = sl.x0 <= fw + 1e-6 ? sl.x1 : sl.x0 - fw;
    out.frames.push(rect(X(mull), X(mull + fw), fa, fb));
  }
  const a0 = X(Math.min(...lay.leaves.map((l) => l.x0)));
  const a1 = X(Math.max(...lay.leaves.map((l) => l.x1)));
  const face = fc + (swingSide * fd) / 2; // leaves hinge on the frame face of the swing side
  let reach = 0;
  const sills = () => out.thin.push([P(s0 + fw, t / 2), P(s1 - fw, t / 2)], [P(s0 + fw, -t / 2), P(s1 - fw, -t / 2)]);
  switch (kind) {
    case 'sliding':
    case 'multislide':
      for (const lf of lay.leaves) {
        const z = fc + (lf.track || 0) * 0.9 * ext;
        out.frames.push(rect(X(lf.x0), X(lf.x1), z - 0.5, z + 0.5));
      }
      sills();
      break;
    case 'pocket': {
      // leaf shown half open, sliding into the wall cavity (dashed)
      const lw = a1 - a0;
      out.frames.push(rect(a0 - lw * 0.5, a0 + lw * 0.5, fc - 0.7, fc + 0.7));
      out.dashed.push([P(a0 - lw, fc - 1.2), P(a0, fc - 1.2)], [P(a0 - lw, fc + 1.2), P(a0, fc + 1.2)], [P(a0 - lw, fc - 1.2), P(a0 - lw, fc + 1.2)]);
      sills();
      break;
    }
    case 'barn':
    case 'barn-bypass': {
      // slab(s) hung on the INTERIOR face, track shown dashed past the opening
      const inn = -ext;
      for (const lf of lay.leaves) {
        const z0 = inn * (t / 2 + 0.75 + ((lf.track || 1) - 1) * 2);
        out.frames.push(rect(X(lf.x0), X(lf.x1), z0, z0 + inn * 1.5));
      }
      const z = inn * (t / 2 + 0.75);
      out.dashed.push([P(a0 - (a1 - a0), z), P(a1 + (kind === 'barn' ? 0 : a1 - a0) * 0, z)]);
      sills();
      reach = 6;
      break;
    }
    case 'bifold': {
      // accordion: leaves folded part-way toward the swing side (zig-zag)
      const th = (40 * Math.PI) / 180;
      const pts: Point[] = [];
      let x = a0;
      pts.push(P(x, face));
      lay.leaves.forEach((lf, i) => {
        const pw = lf.x1 - lf.x0;
        x += pw * Math.cos(th);
        pts.push(P(x, face + (i % 2 === 0 ? swingSide * pw * Math.sin(th) : 0)));
      });
      out.dashed.push(pts);
      for (let i = 0; i + 1 < pts.length; i++) out.lines.push([pts[i], pts[i + 1]]);
      reach = Math.max(...lay.leaves.map((l) => (l.x1 - l.x0) * Math.sin(th)));
      sills();
      break;
    }
    case 'garage': {
      const inSide = -ext;
      out.lines.push([P(a0, fc), P(a1, fc)]);
      const depth = Math.min(o.height + 12, 108);
      const base = fc + (inSide * fd) / 2;
      out.dashed.push([P(a0, base), P(a0, base + inSide * depth), P(a1, base + inSide * depth), P(a1, base)]);
      break;
    }
    case 'pivot': {
      // offset pivot: leaf turns about a pin 1/5 of its width in from the jamb
      const lf = lay.leaves[0];
      const hingeAtStart = lf.hinge !== 'x1';
      const lw = lf.x1 - lf.x0;
      const pv = X(hingeAtStart ? lf.x0 + lw * 0.2 : lf.x1 - lw * 0.2);
      const big = lw * 0.8;
      const small = lw * 0.2;
      const pin = P(pv, fc);
      const tipBig = P(pv, fc + swingSide * big);
      const tipSmall = P(pv, fc - swingSide * small);
      out.lines.push([tipSmall, tipBig]);
      out.frames.push(rect(pv - 1, pv + 1, fc - 1, fc + 1));
      out.dashed.push(swingArc(pin, P(hingeAtStart ? X(lf.x1) : X(lf.x0), fc), tipBig));
      out.dashed.push(swingArc(pin, P(hingeAtStart ? X(lf.x0) : X(lf.x1), fc), tipSmall));
      reach = big;
      break;
    }
    default: {
      for (const lf of lay.leaves) {
        const hingeS = X(lf.hinge === 'x1' ? lf.x1 : lf.x0);
        const latchS = X(lf.hinge === 'x1' ? lf.x0 : lf.x1);
        const r = Math.abs(latchS - hingeS);
        const hinge = P(hingeS, face);
        const latch = P(latchS, face);
        const tip = P(hingeS, face + swingSide * r);
        out.lines.push([hinge, tip]);
        out.frames.push(rect(hingeS, hingeS + Math.sign(latchS - hingeS) * 1.75, face, face + swingSide * r));
        out.dashed.push(swingArc(hinge, latch, tip));
        reach = Math.max(reach, r);
        if (kind === 'dutch') out.thin.push([P(hingeS, face + swingSide * r * 0.5), P(hingeS + Math.sign(latchS - hingeS) * 1.75, face + swingSide * r * 0.5)]);
      }
      out.thin.push([P(a0, -swingSide * (t / 2)), P(a1, -swingSide * (t / 2))]);
    }
  }
  // cabin screen / storm door: a light leaf on the exterior face, swinging out
  if (o.screenDoor && isSwingKind(kind)) {
    const lf = lay.leaves[0];
    const hingeS = X(lf.hinge === 'x1' ? lf.x1 : lf.x0);
    const latchS = X(lf.hinge === 'x1' ? lf.x0 : lf.x1);
    const ef = ext * (t / 2 + 0.5);
    const r = Math.abs(latchS - hingeS);
    const tip = P(hingeS, ef + ext * r * 0.7);
    out.thin.push([P(hingeS, ef), tip]);
    out.dashed.push(swingArc(P(hingeS, ef), P(latchS, ef), P(hingeS, ef + ext * r)));
  }
  out.hit = rect(s0, s1, -swingSide * (t / 2 + 2), face + swingSide * Math.max(reach, t / 2 + 2));
  return out;
}

// ------------------------------------------------------------------------------------------
// 3D / ELEVATION WALL SHAPE WITH HOLES
// ------------------------------------------------------------------------------------------

export interface ElevOpening {
  id: string;
  kind: 'door' | 'window' | 'wallopening';
  s0: number;
  s1: number;
  z0: number;
  z1: number;
  arch?: boolean;
}

export interface WallElevationShape {
  /** outer boundary in wall-local (x = along the wall, y = up from the wall base), CCW */
  outline: Array<{ x: number; y: number }>;
  /** closed holes (windows, raised wall openings) */
  holes: Array<Array<{ x: number; y: number }>>;
  /** openings that reach the base are notched out of the outline instead of being holes */
  notches: string[];
  /** the openings actually cut (after clamping to the wall and dropping collisions) */
  placed: ElevOpening[];
}

/** Points along the head of an opening (straight or semicircular-arched), from s1 back to s0. */
export function headPoints(op: ElevOpening): Array<{ x: number; y: number }> {
  if (!op.arch) return [{ x: op.s1, y: op.z1 }, { x: op.s0, y: op.z1 }];
  const r = (op.s1 - op.s0) / 2;
  const cx = (op.s0 + op.s1) / 2;
  const springZ = Math.max(op.z0 + 1, op.z1 - r);
  const ry = op.z1 - springZ;
  const pts: Array<{ x: number; y: number }> = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: springZ + ry * Math.sin(a) });
  }
  return pts;
}

/**
 * Builds the wall's elevation face (for THREE.Shape → ExtrudeGeometry through the thickness):
 * outer outline following the (possibly roof-attached) top, with openings cut as real holes.
 * Openings touching the base become notches of the outline. One hole or notch per opening.
 */
export function wallElevationShape(
  L: number,
  top: Array<{ s: number; z: number }>,
  topAt: (s: number) => number,
  openings: ElevOpening[]
): WallElevationShape {
  const ops = openings
    .map((o) => {
      const s0 = Math.max(1, o.s0);
      const s1 = Math.min(L - 1, o.s1);
      const head = Math.min(topAt(s0), topAt(s1)) - 2;
      return { ...o, s0, s1, z0: Math.max(0, o.z0), z1: Math.min(o.z1, head) };
    })
    .filter((o) => o.s1 - o.s0 > 1 && o.z1 - o.z0 > 1)
    .sort((a, b) => a.s0 - b.s0);
  // drop openings that collide with an already placed one (they are flagged with a warning in plan)
  const placed: ElevOpening[] = [];
  for (const o of ops) {
    if (placed.some((p) => o.s0 < p.s1 + 0.5 && p.s0 < o.s1 + 0.5 && o.z0 < p.z1 + 0.5 && p.z0 < o.z1 + 0.5)) continue;
    placed.push(o);
  }
  const notchOps = placed.filter((o) => o.z0 <= 0.5);
  const holeOps = placed.filter((o) => o.z0 > 0.5);

  const outline: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (const op of notchOps) {
    outline.push({ x: op.s0, y: 0 });
    const head = headPoints(op).reverse(); // s0 → s1
    outline.push(...head);
    outline.push({ x: op.s1, y: 0 });
  }
  outline.push({ x: L, y: 0 });
  const topPts = top.filter((p) => p.s >= -1e-6 && p.s <= L + 1e-6).sort((a, b) => b.s - a.s);
  if (!topPts.length || topPts[0].s < L - 1e-6) outline.push({ x: L, y: topAt(L) });
  for (const p of topPts) outline.push({ x: Math.max(0, Math.min(L, p.s)), y: p.z });
  if (!topPts.length || topPts[topPts.length - 1].s > 1e-6) outline.push({ x: 0, y: topAt(0) });
  const clean = outline.filter((p, i) => i === 0 || Math.hypot(p.x - outline[i - 1].x, p.y - outline[i - 1].y) > 1e-4);
  if (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 1e-4) clean.pop();

  const holes = holeOps.map((op) => [{ x: op.s0, y: op.z0 }, { x: op.s1, y: op.z0 }, ...headPoints(op)]);
  return { outline: clean, holes, notches: notchOps.map((o) => o.id), placed };
}

/** Elevation openings of a wall from its hosted entities (doors / windows / wall openings). */
export function elevOpeningsOf(wall: WallEntity, openings: HostedOpening[]): ElevOpening[] {
  const L = wallFrame(wall).length;
  return openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const sp = openingSpan(o, L);
      const z = openingZ(o);
      return { id: o.id, kind: o.type, s0: sp.s0, s1: sp.s1, z0: z.z0, z1: z.z1, arch: (o.type === 'wallopening' && o.shape === 'arch') || (o.type === 'door' && o.panelStyle === 'arched') };
    });
}

// ------------------------------------------------------------------------------------------
// MARKS
// ------------------------------------------------------------------------------------------

/** Next free mark: D1, D2… / W1, W2… / O1, O2… */
export function nextOpeningMark(entities: ArchEntity[], type: HostedOpening['type']): string {
  const prefix = type === 'door' ? 'D' : type === 'window' ? 'W' : 'O';
  let max = 0;
  for (const e of entities) {
    if (e.type !== type) continue;
    const m = /^([A-Z]+)(\d+)$/.exec((e as HostedOpening).mark || '');
    if (m && m[1] === prefix) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}${max + 1}`;
}

// ------------------------------------------------------------------------------------------
// TYPES → INSTANCES
// ------------------------------------------------------------------------------------------

/** Type-driven fields copied onto every door of a type (width, height, kind, frame, lites). */
export function doorTypeFields(dt: DoorType): Partial<DoorEntity> {
  return {
    doorTypeId: dt.id,
    width: dt.width,
    height: dt.height,
    kind: dt.kind || 'single',
    frameMaterial: dt.frameMaterial,
    divisions: dt.divisions,
    glazed: dt.kind === 'sliding' || dt.kind === 'multislide' || (!!dt.divisions && dt.divisions !== '1x1'),
    frameWidth: dt.frameWidth,
    panelStyle: dt.panelStyle,
    panels: dt.panels,
    sidelights: dt.sidelights,
    sidelightWidth: dt.sidelightWidth,
    transom: dt.transom,
    screenDoor: dt.screenDoor,
  };
}

/** Type-driven fields copied onto every window of a type (width, height, operation, frame, divisions). */
export function windowTypeFields(wt: WindowType): Partial<WindowEntity> {
  return {
    windowTypeId: wt.id,
    width: wt.width,
    height: wt.height,
    operation: wt.operation || 'fixed',
    frameMaterial: wt.frameMaterial,
    divisions: wt.divisions,
    frameWidth: wt.frameWidth,
  };
}

/** Applies an edited type to all of its instances (Revit "Type Properties"). */
export function applyTypeToInstances(entities: ArchEntity[], t: { door?: DoorType; window?: WindowType }): ArchEntity[] {
  return entities.map((e) => {
    if (t.door && e.type === 'door' && e.doorTypeId === t.door.id) return { ...e, ...doorTypeFields(t.door) };
    if (t.window && e.type === 'window' && e.windowTypeId === t.window.id) return { ...e, ...windowTypeFields(t.window) };
    return e;
  });
}

export const FRAME_MATERIALS: Array<{ id: import('../types/model').FrameMaterial; label: string; color: string }> = [
  { id: 'vinyl', label: 'Vinyl (white)', color: '#f8fafc' },
  { id: 'wood', label: 'Wood', color: '#a16207' },
  { id: 'aluminum', label: 'Aluminum', color: '#94a3b8' },
  { id: 'fiberglass', label: 'Fiberglass', color: '#e7e5e4' },
  { id: 'steel', label: 'Steel', color: '#475569' },
];

export function frameColor(m: string | undefined, fallback = '#f8fafc'): string {
  return FRAME_MATERIALS.find((f) => f.id === m)?.color || fallback;
}
