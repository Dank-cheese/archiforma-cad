/**
 * WALL JOINS — Revit-style wall cleanup (pure functions, no imports from geometry.ts).
 *
 * Every wall end is classified against the other walls on its level:
 *   - L / angled corner (2 ends meet)        → MITER (default), BUTT or SQUARE-OFF (WJ tool), or disallowed
 *   - collinear continuation (2 ends, 180°)  → square ends that share an edge (and can HEAL into one wall)
 *   - T-junction (end touches another wall)  → the stem is trimmed at the main wall's NEAR FACE
 *   - 3+ ends at one point                    → a collinear pair runs through and the rest are trimmed
 *                                               like T stems; otherwise a star join with a central HUB
 *   - X-crossing (interiors cross)           → the secondary wall is split at the main wall's faces
 * Each wall's footprint pieces then TILE the plan (no overlaps), so the outline of a group of joined
 * walls is found by cancelling shared edges: one continuous contour, no seams at corners or junctions.
 *
 * Plan coordinates: inches, +Y down. "Left" of a direction u is perpLeft(u) = (-u.y, u.x).
 */
import type { ArchEntity, Point, WallEntity, WallOpeningEntity, DoorEntity, WindowEntity, JoinStyle, WallEndJoin } from '../types/model';
export type { JoinStyle, WallEndJoin };

export const JOIN_TOL = 1.5; // inches: endpoints closer than this are joined

// ------------------------------------------------------------------------------------------
// vectors
// ------------------------------------------------------------------------------------------
type V = Point;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const cross = (a: V, b: V) => a.x * b.y - a.y * b.x;
const len = (a: V) => Math.hypot(a.x, a.y);
const dist = (a: V, b: V) => len(sub(a, b));
const perpLeft = (u: V): V => ({ x: -u.y, y: u.x });
const unit = (a: V): V => {
  const l = len(a);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Intersection of two infinite lines p + t·d and q + s·e (null when parallel). */
export function lineX(p: V, d: V, q: V, e: V): V | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}

// ------------------------------------------------------------------------------------------
// wall faces and arms
// ------------------------------------------------------------------------------------------

export interface WallFaces {
  dir: V;
  n: V; // left normal
  L: number;
  lo: number; // left face offset (+n)
  ro: number; // right face offset (−n)
}

export function wallFaces(w: WallEntity): WallFaces {
  const v = sub(w.end, w.start);
  const L = len(v);
  const dir = unit(v);
  const t = w.thickness;
  let lo = t / 2;
  let ro = t / 2;
  if (w.justification === 'interior') {
    lo = t;
    ro = 0;
  } else if (w.justification === 'exterior') {
    lo = 0;
    ro = t;
  }
  return { dir, n: perpLeft(dir), L, lo, ro };
}

/** One wall end seen from the joint: outgoing direction and its left / right face lines. */
interface Arm {
  wall: WallEntity;
  end: 'start' | 'end';
  P: V; // the wall's endpoint
  u: V; // outgoing unit direction (away from the joint)
  nu: V; // perpLeft(u)
  offL: number; // offset of the face left of u
  offR: number; // offset of the face right of u
  ang: number;
  join?: WallEndJoin;
}

function armOf(w: WallEntity, end: 'start' | 'end'): Arm {
  const f = wallFaces(w);
  const u = end === 'start' ? f.dir : mul(f.dir, -1);
  return {
    wall: w,
    end,
    P: end === 'start' ? w.start : w.end,
    u,
    nu: perpLeft(u),
    offL: end === 'start' ? f.lo : f.ro,
    offR: end === 'start' ? f.ro : f.lo,
    ang: Math.atan2(u.y, u.x),
    join: w.joins?.[end],
  };
}
const faceLp = (a: Arm) => add(a.P, mul(a.nu, a.offL));
const faceRp = (a: Arm) => sub(a.P, mul(a.nu, a.offR));

/** End cut: the two corner points of a wall end on its LEFT and RIGHT faces (wall orientation). */
export interface EndCut {
  left: V;
  right: V;
  kind: 'free' | 'miter' | 'butt' | 'squareoff' | 'tee' | 'through' | 'hub' | 'collinear' | 'disallowed';
  /** T-junction detail for layer cleanup: the main wall and the core face line the stem's core runs to */
  tee?: { mainId: string; coreP: V; coreD: V };
}

const squareCut = (a: Arm, kind: EndCut['kind'] = 'free'): { cl: V; cr: V; kind: EndCut['kind'] } => ({ cl: faceLp(a), cr: faceRp(a), kind });

/** Converts arm-relative corners (left/right of the outgoing direction) to the wall's left/right. */
function toWallCut(a: Arm, cl: V, cr: V, kind: EndCut['kind'], tee?: EndCut['tee']): EndCut {
  return a.end === 'start' ? { left: cl, right: cr, kind, tee } : { left: cr, right: cl, kind, tee };
}

/** Trims an arm's two faces at a line (point q, direction e); falls back to a square end. */
function trimAt(a: Arm, q: V, e: V, maxReach: number): { cl: V; cr: V } | null {
  const cl = lineX(faceLp(a), a.u, q, e);
  const cr = lineX(faceRp(a), a.u, q, e);
  if (!cl || !cr) return null;
  if (dist(cl, a.P) > maxReach || dist(cr, a.P) > maxReach) return null;
  return { cl, cr };
}

const sameLevel = (a: WallEntity, b: WallEntity) => (a.levelId || 'level-1') === (b.levelId || 'level-1');
const isCurtain = (w: WallEntity) => !!w.curtain || w.wallTypeId === 'wt-curtain';

/** Wall ends (other walls) meeting at point P. */
function armsAt(P: V, walls: WallEntity[], self: WallEntity): Arm[] {
  const out: Arm[] = [];
  for (const w of walls) {
    if (!sameLevel(w, self)) continue;
    if (dist(w.start, w.end) < 1e-6) continue;
    if (dist(w.start, P) <= JOIN_TOL) out.push(armOf(w, 'start'));
    else if (dist(w.end, P) <= JOIN_TOL) out.push(armOf(w, 'end'));
  }
  return out;
}

/** The wall whose band contains P away from its ends (T-junction main wall). */
function teeMainAt(P: V, walls: WallEntity[], self: WallEntity): WallEntity | null {
  let best: { w: WallEntity; d: number } | null = null;
  for (const w of walls) {
    if (w.id === self.id || !sameLevel(w, self)) continue;
    const f = wallFaces(w);
    if (f.L < 1) continue;
    const rel = sub(P, w.start);
    const s = dot(rel, f.dir);
    if (s <= JOIN_TOL || s >= f.L - JOIN_TOL) continue;
    const off = dot(rel, f.n); // across from the location line
    const lo = f.lo + JOIN_TOL;
    const ro = f.ro + JOIN_TOL;
    if (off > lo || off < -ro) continue;
    const d = Math.abs(off - (f.lo - f.ro) / 2);
    if (!best || d < best.d) best = { w, d };
  }
  return best ? best.w : null;
}

/** The near face of `main` toward an arm, and its core face (first non-finish layer boundary). */
function nearFaceOf(main: WallEntity, a: Arm, coreFrac?: { left: number; right: number }): { q: V; e: V; coreQ: V } {
  const f = wallFaces(main);
  const onLeft = dot(a.u, f.n) > 0; // the stem goes off toward main's left side
  const q = onLeft ? add(main.start, mul(f.n, f.lo)) : sub(main.start, mul(f.n, f.ro));
  const coreOff = onLeft ? f.lo - (coreFrac?.left ?? 0) : -(f.ro - (coreFrac?.right ?? 0));
  return { q, e: f.dir, coreQ: add(main.start, mul(f.n, coreOff)) };
}

export interface JoinContext {
  /** thickness of the finish layers on each face of a wall (for core-to-core T cleanup) */
  finishOf?: (w: WallEntity) => { left: number; right: number };
}

/**
 * The cut at one end of a wall, from the walls around it (same level). This is the local, per-wall
 * version of the join graph (cheap enough to call per wall when drawing).
 */
export function wallEndCut(wall: WallEntity, end: 'start' | 'end', walls: WallEntity[], ctx: JoinContext = {}): EndCut {
  const me = armOf(wall, end);
  const maxReach = Math.max(24, wall.thickness * 6);
  const others = armsAt(me.P, walls, wall).filter((a) => a.wall.id !== wall.id);
  const all = [me, ...others];

  // nothing at this end: T-junction or a free end
  if (!others.length) {
    if (me.join?.disallow) return toWallCut(me, faceLp(me), faceRp(me), 'disallowed');
    const main = teeMainAt(me.P, walls, wall);
    if (main && !isCurtain(main) && Math.abs(cross(me.u, wallFaces(main).dir)) > 0.15) {
      const nf = nearFaceOf(main, me, ctx.finishOf?.(main));
      const t = trimAt(me, nf.q, nf.e, maxReach);
      if (t) return toWallCut(me, t.cl, t.cr, 'tee', { mainId: main.id, coreP: nf.coreQ, coreD: nf.e });
    }
    const sq = squareCut(me);
    return toWallCut(me, sq.cl, sq.cr, sq.kind);
  }

  // a disallowed join anywhere at this point keeps every end square (visible seam)
  if (all.some((a) => a.join?.disallow)) return toWallCut(me, faceLp(me), faceRp(me), 'disallowed');

  // ---- two ends: corner or straight continuation
  if (others.length === 1) {
    const o = others[0];
    const c = cross(me.u, o.u);
    if (Math.abs(c) < 0.02) {
      // collinear continuation (or folded back): square ends sharing one edge
      return toWallCut(me, faceLp(me), faceRp(me), 'collinear');
    }
    const style: JoinStyle = me.join?.style || o.join?.style || 'miter';
    if (style === 'miter') {
      const cl = lineX(faceLp(me), me.u, faceRp(o), o.u);
      const cr = lineX(faceRp(me), me.u, faceLp(o), o.u);
      if (cl && cr && dist(cl, me.P) < maxReach && dist(cr, me.P) < maxReach) return toWallCut(me, cl, cr, 'miter');
      return toWallCut(me, faceLp(me), faceRp(me), 'free');
    }
    // BUTT / SQUARE-OFF: the primary wall runs to the other's far face, the other stops at its near face
    const primary = pickPrimary(me, o);
    if (primary === me) {
      const f = wallFaces(o.wall);
      const onLeft = dot(me.u, perpLeft(o.u)) > 0; // me lies on o's arm-left side
      void f;
      const far = onLeft ? faceRp(o) : faceLp(o);
      const t = trimAt(me, far, o.u, maxReach);
      if (!t) return toWallCut(me, faceLp(me), faceRp(me), 'free');
      if (style === 'squareoff') {
        const s = Math.max(dot(sub(t.cl, me.P), me.u), dot(sub(t.cr, me.P), me.u));
        const base = add(me.P, mul(me.u, s));
        return toWallCut(me, add(base, mul(me.nu, me.offL)), sub(base, mul(me.nu, me.offR)), 'squareoff');
      }
      return toWallCut(me, t.cl, t.cr, 'butt');
    }
    const onLeft = dot(me.u, o.nu) > 0; // I go off toward o's left: o's near face is its left face
    const near = onLeft ? faceLp(o) : faceRp(o);
    const t = trimAt(me, near, o.u, maxReach);
    return t ? toWallCut(me, t.cl, t.cr, style) : toWallCut(me, faceLp(me), faceRp(me), 'free');
  }

  // ---- three or more ends: a collinear same-thickness pair runs through, the rest are T stems
  const through = findThroughPair(all);
  if (through) {
    if (through[0] === me || through[1] === me) return toWallCut(me, faceLp(me), faceRp(me), 'through');
    const a = through[0];
    const onLeft = dot(me.u, a.nu) > 0;
    const near = onLeft ? faceLp(a) : faceRp(a);
    const fin = ctx.finishOf?.(a.wall);
    const coreOff = onLeft ? a.offL - (fin ? (a.end === 'start' ? fin.left : fin.right) : 0) : -(a.offR - (fin ? (a.end === 'start' ? fin.right : fin.left) : 0));
    const t = trimAt(me, near, a.u, maxReach);
    if (t) return toWallCut(me, t.cl, t.cr, 'tee', { mainId: a.wall.id, coreP: add(a.P, mul(a.nu, coreOff)), coreD: a.u });
    return toWallCut(me, faceLp(me), faceRp(me), 'free');
  }
  // ---- star join with a central hub
  const sorted = [...all].sort((p, q) => p.ang - q.ang);
  const i = sorted.indexOf(me);
  const next = sorted[(i + 1) % sorted.length];
  const prev = sorted[(i - 1 + sorted.length) % sorted.length];
  const cl = lineX(faceLp(me), me.u, faceRp(next), next.u) || faceLp(me);
  const cr = lineX(faceRp(me), me.u, faceLp(prev), prev.u) || faceRp(me);
  if (dist(cl, me.P) > maxReach || dist(cr, me.P) > maxReach) return toWallCut(me, faceLp(me), faceRp(me), 'free');
  return toWallCut(me, cl, cr, 'hub');
}

function pickPrimary(a: Arm, b: Arm): Arm {
  if (a.join?.primary && !b.join?.primary) return a;
  if (b.join?.primary && !a.join?.primary) return b;
  if (Math.abs(a.wall.thickness - b.wall.thickness) > 1e-6) return a.wall.thickness > b.wall.thickness ? a : b;
  return a.wall.id < b.wall.id ? a : b;
}

function findThroughPair(arms: Arm[]): [Arm, Arm] | null {
  let best: [Arm, Arm] | null = null;
  for (let i = 0; i < arms.length; i++)
    for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i];
      const b = arms[j];
      if (dot(a.u, b.u) > -0.999) continue;
      if (Math.abs(a.offL - b.offR) > 0.01 || Math.abs(a.offR - b.offL) > 0.01) continue;
      if (!best || a.wall.thickness > best[0].wall.thickness) best = [a, b];
    }
  return best;
}

/** Both end cuts of a wall. */
export function wallEndCuts(wall: WallEntity, walls: WallEntity[], ctx: JoinContext = {}): { start: EndCut; end: EndCut } {
  return { start: wallEndCut(wall, 'start', walls, ctx), end: wallEndCut(wall, 'end', walls, ctx) };
}

/** The joined 4-corner footprint of a wall: [startLeft, endLeft, endRight, startRight]. */
export function joinedWallCorners(wall: WallEntity, walls: WallEntity[]): [V, V, V, V] {
  const c = wallEndCuts(wall, walls);
  return [c.start.left, c.end.left, c.end.right, c.start.right];
}

/** Along-wall position (from the start) of each face at an end cut, for 3D and layer bands. */
export function cutStations(wall: WallEntity, cut: EndCut): { left: number; right: number } {
  const f = wallFaces(wall);
  return { left: dot(sub(cut.left, wall.start), f.dir), right: dot(sub(cut.right, wall.start), f.dir) };
}

// ------------------------------------------------------------------------------------------
// HUBS (star joins) and X-CROSSINGS
// ------------------------------------------------------------------------------------------

/** Centre polygons of star joins (3+ walls meeting without a straight-through pair). */
export function joinHubs(walls: WallEntity[]): Array<{ key: string; poly: V[]; wallIds: string[] }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; poly: V[]; wallIds: string[] }> = [];
  for (const w of walls) {
    for (const end of ['start', 'end'] as const) {
      const P = end === 'start' ? w.start : w.end;
      const arms = armsAt(P, walls, w);
      if (arms.length < 3) continue;
      const key = `${w.levelId || 'level-1'}:${Math.round(P.x * 2)}:${Math.round(P.y * 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (arms.some((a) => a.join?.disallow) || findThroughPair(arms)) continue;
      const sorted = [...arms].sort((p, q) => p.ang - q.ang);
      const poly: V[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const b = sorted[(i + 1) % sorted.length];
        poly.push(lineX(faceLp(a), a.u, faceRp(b), b.u) || faceLp(a));
      }
      if (Math.abs(signedArea(poly)) > 1e-3) out.push({ key, poly, wallIds: sorted.map((a) => a.wall.id) });
    }
  }
  return out;
}

/**
 * X-crossings: where this wall's interior crosses another wall's interior, the THINNER wall (ties: the
 * later id) is cut through by the other. Returns the intervals of this wall covered by those mains, with
 * the exact cut points on its faces (so plan pieces end cleanly on the main wall's faces).
 */
export function crossingCuts(wall: WallEntity, walls: WallEntity[]): Array<{ mainId: string; s0: number; s1: number; a: EndCut; b: EndCut }> {
  const f = wallFaces(wall);
  if (f.L < 1) return [];
  const out: Array<{ mainId: string; s0: number; s1: number; a: EndCut; b: EndCut }> = [];
  for (const m of walls) {
    if (m.id === wall.id || !sameLevel(m, wall) || isCurtain(m)) continue;
    const mf = wallFaces(m);
    if (mf.L < 1 || Math.abs(cross(f.dir, mf.dir)) < 0.15) continue;
    const mainWins = m.thickness > wall.thickness + 1e-6 || (Math.abs(m.thickness - wall.thickness) <= 1e-6 && m.id < wall.id);
    if (!mainWins) continue;
    const X = lineX(wall.start, f.dir, m.start, mf.dir);
    if (!X) continue;
    const s = dot(sub(X, wall.start), f.dir);
    const t = dot(sub(X, m.start), mf.dir);
    if (s <= JOIN_TOL || s >= f.L - JOIN_TOL || t <= JOIN_TOL || t >= mf.L - JOIN_TOL) continue;
    const mL = add(m.start, mul(mf.n, mf.lo));
    const mR = sub(m.start, mul(mf.n, mf.ro));
    const wl = add(wall.start, mul(f.n, f.lo));
    const wr = sub(wall.start, mul(f.n, f.ro));
    const pts = [mL, mR].map((q) => ({ l: lineX(wl, f.dir, q, mf.dir)!, r: lineX(wr, f.dir, q, mf.dir)! }));
    const st = pts.map((p) => ({ ...p, s: (dot(sub(p.l, wall.start), f.dir) + dot(sub(p.r, wall.start), f.dir)) / 2 }));
    st.sort((p, q) => p.s - q.s);
    out.push({
      mainId: m.id,
      s0: Math.min(dot(sub(st[0].l, wall.start), f.dir), dot(sub(st[0].r, wall.start), f.dir)),
      s1: Math.max(dot(sub(st[1].l, wall.start), f.dir), dot(sub(st[1].r, wall.start), f.dir)),
      a: { left: st[0].l, right: st[0].r, kind: 'tee' },
      b: { left: st[1].l, right: st[1].r, kind: 'tee' },
    });
  }
  return out.sort((p, q) => p.s0 - q.s0);
}

// ------------------------------------------------------------------------------------------
// FOOTPRINT PIECES (plan) with opening gaps and crossings
// ------------------------------------------------------------------------------------------

export interface GapLike {
  s0: number;
  s1: number;
}

/**
 * Plan pieces of a wall: the joined footprint, split at opening gaps (square jambs) and at X-crossings
 * (cut on the main wall's faces). Each piece is [aLeft, bLeft, bRight, aRight].
 */
export function wallPlanPieces(wall: WallEntity, walls: WallEntity[], gaps: GapLike[]): V[][] {
  const f = wallFaces(wall);
  if (f.L < 1) return [];
  const cuts = wallEndCuts(wall, walls);
  type B = { s: number; l: V; r: V };
  const square = (s: number): B => ({ s, l: add(add(wall.start, mul(f.dir, s)), mul(f.n, f.lo)), r: sub(add(wall.start, mul(f.dir, s)), mul(f.n, f.ro)) });
  // boundaries: start cut, [gap/crossing pairs], end cut
  const breaks: Array<{ a: B; b: B }> = [];
  for (const g of gaps) if (g.s1 > 0.05 && g.s0 < f.L - 0.05) breaks.push({ a: square(Math.max(0, g.s0)), b: square(Math.min(f.L, g.s1)) });
  for (const x of crossingCuts(wall, walls)) breaks.push({ a: { s: x.s0, l: x.a.left, r: x.a.right }, b: { s: x.s1, l: x.b.left, r: x.b.right } });
  breaks.sort((p, q) => p.a.s - q.a.s);
  const startB: B = { s: 0, l: cuts.start.left, r: cuts.start.right };
  const endB: B = { s: f.L, l: cuts.end.left, r: cuts.end.right };
  const pieces: V[][] = [];
  let cur: B = startB;
  for (const br of breaks) {
    if (br.a.s > cur.s + 0.05) pieces.push([cur.l, br.a.l, br.a.r, cur.r]);
    if (br.b.s > cur.s) cur = br.b.s >= f.L - 0.05 ? { ...endB, s: f.L + 1 } : br.b;
  }
  if (cur.s < f.L - 0.05) pieces.push([cur.l, endB.l, endB.r, cur.r]);
  return pieces;
}

// ------------------------------------------------------------------------------------------
// MERGED OUTLINES (one continuous contour per group of joined walls)
// ------------------------------------------------------------------------------------------

export function signedArea(pts: V[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

const EPS = 1e-3;
const keyOf = (p: V) => `${Math.round(p.x / EPS)}:${Math.round(p.y / EPS)}`;

/**
 * Union of polygons that TILE (touch along edges, never overlap): shared edges cancel, collinear
 * T-contacts are split first. Returns the boundary loops (collinear vertices removed).
 */
export function mergeOutlines(polys: V[][]): V[][] {
  const cleanPolys = polys
    .map((p) => p.filter((q, i) => dist(q, p[(i + p.length - 1) % p.length]) > EPS))
    .filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > EPS);
  const oriented = cleanPolys.map((p) => (signedArea(p) < 0 ? [...p].reverse() : p));
  const verts: V[] = [];
  for (const p of oriented) verts.push(...p);
  // split every edge at other vertices lying on it
  const edges: Array<[V, V]> = [];
  for (const p of oriented) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const d = sub(b, a);
      const L = len(d);
      if (L < EPS) continue;
      const u = mul(d, 1 / L);
      const cuts: number[] = [];
      for (const v of verts) {
        const t = dot(sub(v, a), u);
        if (t <= EPS || t >= L - EPS) continue;
        if (Math.abs(cross(u, sub(v, a))) > EPS * 5) continue;
        cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      let prev = a;
      for (const t of cuts) {
        const q = add(a, mul(u, t));
        if (dist(q, prev) > EPS) edges.push([prev, q]);
        prev = q;
      }
      if (dist(prev, b) > EPS) edges.push([prev, b]);
    }
  }
  // cancel opposite pairs
  const count = new Map<string, { e: [V, V]; n: number }>();
  for (const e of edges) {
    const k = `${keyOf(e[0])}>${keyOf(e[1])}`;
    const rk = `${keyOf(e[1])}>${keyOf(e[0])}`;
    const r = count.get(rk);
    if (r && r.n > 0) {
      r.n--;
      continue;
    }
    const c = count.get(k);
    if (c) c.n++;
    else count.set(k, { e, n: 1 });
  }
  const remaining: Array<[V, V]> = [];
  for (const { e, n } of count.values()) for (let i = 0; i < n; i++) remaining.push(e);
  // chain loops
  const byStart = new Map<string, Array<[V, V]>>();
  for (const e of remaining) {
    const k = keyOf(e[0]);
    const l = byStart.get(k) || [];
    l.push(e);
    byStart.set(k, l);
  }
  const loops: V[][] = [];
  const used = new Set<[V, V]>();
  for (const e0 of remaining) {
    if (used.has(e0)) continue;
    const loop: V[] = [];
    let e: [V, V] | undefined = e0;
    let guard = 0;
    while (e && !used.has(e) && guard++ < 100000) {
      used.add(e);
      loop.push(e[0]);
      const cands: Array<[V, V]> = (byStart.get(keyOf(e[1])) || []).filter((x) => !used.has(x));
      if (cands.length <= 1) e = cands[0];
      else {
        // at a pinch vertex take the sharpest right turn (keeps loops simple)
        const din = unit(sub(e[1], e[0]));
        let best = cands[0];
        let bestAng = Infinity;
        for (const c of cands) {
          const dout = unit(sub(c[1], c[0]));
          const ang = Math.atan2(cross(din, dout), dot(din, dout));
          if (ang < bestAng) {
            bestAng = ang;
            best = c;
          }
        }
        e = best;
      }
    }
    const simple = simplifyLoop(loop);
    if (simple.length >= 3) loops.push(simple);
  }
  return loops;
}

function simplifyLoop(pts: V[]): V[] {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      if (dist(a, b) < EPS || Math.abs(cross(unit(sub(b, a)), unit(sub(c, b)))) < 1e-6) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Walls that clean up together share a join group (same wall type; curtain walls stay separate). */
export function joinGroupKey(w: WallEntity): string {
  if (isCurtain(w)) return `curtain:${w.id}`;
  return `${w.levelId || 'level-1'}|${w.wallTypeId || `t${w.thickness}`}`;
}

// ------------------------------------------------------------------------------------------
// WJ TOOL: cycle the join at a corner
// ------------------------------------------------------------------------------------------

export const JOIN_CYCLE: Array<{ style?: JoinStyle; disallow?: boolean; label: string }> = [
  { style: 'miter', label: 'Miter' },
  { style: 'butt', label: 'Butt' },
  { style: 'squareoff', label: 'Square off' },
  { disallow: true, label: 'Disallow join' },
];

/** The wall ends at (or nearest to) a clicked point, within `tol`. */
export function wallEndsNear(p: V, walls: WallEntity[], tol: number): Array<{ wallId: string; end: 'start' | 'end'; P: V }> {
  let best: V | null = null;
  let bd = tol;
  for (const w of walls)
    for (const P of [w.start, w.end]) {
      const d = dist(P, p);
      if (d <= bd) {
        bd = d;
        best = P;
      }
    }
  if (!best) return [];
  const out: Array<{ wallId: string; end: 'start' | 'end'; P: V }> = [];
  for (const w of walls) {
    if (dist(w.start, best) <= JOIN_TOL) out.push({ wallId: w.id, end: 'start', P: w.start });
    else if (dist(w.end, best) <= JOIN_TOL) out.push({ wallId: w.id, end: 'end', P: w.end });
  }
  return out;
}

/** Current join state label of a set of wall ends. */
export function joinStateIndex(walls: WallEntity[], ends: Array<{ wallId: string; end: 'start' | 'end' }>): number {
  const js = ends.map((e) => walls.find((w) => w.id === e.wallId)?.joins?.[e.end]);
  if (js.some((j) => j?.disallow)) return 3;
  const st = js.find((j) => j?.style)?.style || 'miter';
  return st === 'butt' ? 1 : st === 'squareoff' ? 2 : 0;
}

/**
 * Applies a join state to all wall ends at a corner. For BUTT / SQUARE-OFF, `primaryWallId` runs
 * through (default: the first end). Returns the updated entity list.
 */
export function setCornerJoin(
  entities: ArchEntity[],
  ends: Array<{ wallId: string; end: 'start' | 'end' }>,
  state: { style?: JoinStyle; disallow?: boolean },
  primaryWallId?: string
): ArchEntity[] {
  const primary = primaryWallId ?? ends[0]?.wallId;
  return entities.map((e) => {
    if (e.type !== 'wall') return e;
    const mine = ends.filter((x) => x.wallId === e.id);
    if (!mine.length) return e;
    const joins = { ...(e.joins || {}) };
    for (const m of mine) {
      joins[m.end] = state.disallow ? { disallow: true } : { style: state.style, primary: state.style !== 'miter' && e.id === primary ? true : undefined };
    }
    return { ...e, joins };
  });
}

// ------------------------------------------------------------------------------------------
// HEAL collinear walls (same type) into one, keeping hosted openings in place
// ------------------------------------------------------------------------------------------

type Hosted = DoorEntity | WindowEntity | WallOpeningEntity;
const isHosted = (e: ArchEntity): e is Hosted => e.type === 'door' || e.type === 'window' || e.type === 'wallopening';

function sameKind(a: WallEntity, b: WallEntity): boolean {
  return (
    sameLevel(a, b) &&
    (a.wallTypeId || '') === (b.wallTypeId || '') &&
    Math.abs(a.thickness - b.thickness) < 1e-6 &&
    Math.abs((a.height || 0) - (b.height || 0)) < 1e-6 &&
    Math.abs((a.baseOffset || 0) - (b.baseOffset || 0)) < 1e-6 &&
    !isCurtain(a) &&
    !isCurtain(b) &&
    (a.attachedRoofId || '') === (b.attachedRoofId || '') &&
    JSON.stringify(a.finishBands || []) === JSON.stringify(b.finishBands || []) &&
    (a.exteriorFinish || '') === (b.exteriorFinish || '') &&
    !!a.structural === !!b.structural
  );
}

/**
 * Merges walls of the same type that continue each other in a straight line end-to-end (and nothing
 * else joins at that point, so T- and X-junctions are left alone). The first wall keeps its id; hosted
 * doors / windows / openings are re-hosted at the same world position. Returns the same array when
 * nothing merged.
 */
export function healCollinearWalls(entities: ArchEntity[]): ArchEntity[] {
  let ents = entities;
  let merged = true;
  let any = false;
  let guard = 0;
  while (merged && guard++ < 500) {
    merged = false;
    const walls = ents.filter((e): e is WallEntity => e.type === 'wall');
    outer: for (const a of walls) {
      for (const endA of ['start', 'end'] as const) {
        const P = endA === 'start' ? a.start : a.end;
        if (a.joins?.[endA]?.disallow) continue;
        const atP = armsAt(P, walls, a);
        if (atP.length !== 2) continue; // exactly a and one other
        const o = atP.find((x) => x.wall.id !== a.id);
        if (!o || o.join?.disallow) continue;
        const b = o.wall;
        if (!sameKind(a, b) || a.justification !== (o.end === (endA === 'end' ? 'start' : 'end') ? b.justification : flipJ(b.justification))) continue;
        const ua = armOf(a, endA).u;
        if (dot(ua, o.u) > -0.9999) continue; // must continue straight on
        if (teeMainAt(P, walls.filter((w) => w.id !== a.id && w.id !== b.id), a)) continue;
        // new geometry: far end of a → far end of b, in a's direction
        const aFar = endA === 'start' ? a.end : a.start;
        const bFar = o.end === 'start' ? b.end : b.start;
        const start = endA === 'end' ? a.start : bFar;
        const end = endA === 'end' ? bFar : a.end;
        const newWall: WallEntity = {
          ...a,
          start,
          end,
          joins: {
            start: endA === 'end' ? a.joins?.start : o.end === 'start' ? b.joins?.end : b.joins?.start,
            end: endA === 'end' ? (o.end === 'start' ? b.joins?.end : b.joins?.start) : a.joins?.end,
          },
        };
        void aFar;
        const NL = dist(start, end);
        const nf = unit(sub(end, start));
        const worldOf = (h: Hosted, w: WallEntity) => add(w.start, mul(sub(w.end, w.start), h.offset));
        ents = ents
          .filter((e) => e.id !== b.id)
          .map((e) => {
            if (e.id === a.id) return newWall;
            if (isHosted(e) && (e.wallId === a.id || e.wallId === b.id)) {
              const host = e.wallId === a.id ? a : b;
              const p = worldOf(e, host);
              return { ...e, wallId: a.id, offset: dot(sub(p, start), nf) / NL };
            }
            if (e.type === 'tag' && e.targetId === b.id) return { ...e, targetId: a.id };
            return e;
          });
        merged = true;
        any = true;
        break outer;
      }
    }
  }
  return any ? ents : entities;
}

const flipJ = (j: WallEntity['justification']): WallEntity['justification'] => (j === 'interior' ? 'exterior' : j === 'exterior' ? 'interior' : 'center');
