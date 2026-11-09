/**
 * Roof geometry engine (pure functions, no React / three.js).
 *
 * Core: a straight skeleton for simple polygons (wavefront simulation with edge and split events,
 * after Felkel & Obdržálek / Aichholzer et al.). Every skeleton face belongs to one footprint edge
 * and is planar when lifted by z = time × tan(pitch), so hip roofs over rectangles, L-, T- and
 * U-shapes get ridges, hips and valleys that meet exactly.
 *
 * Roof types are built on top of the skeleton:
 *  - hip      all edges define slope
 *  - gable    edges that don't define slope become gable ends (the skeleton apex of that edge's
 *             face is moved onto the edge, turning the face vertical)
 *  - shed     one plane rising from the single sloped edge
 *  - mansard  hip skeleton with a steep lower pitch up to a break line and the roof pitch above
 *  - flat     horizontal slab (optional parapet)
 *
 * Coordinates: plan points are model inches in the app's SVG convention (+Y down); z is up.
 */
import type { Point, RoofEntity, RoofStyle, DormerEntity, SkylightEntity, WallEntity } from '../types/model';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const EPS = 1e-7;

const sub2 = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul2 = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot2 = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross2 = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const len2 = (a: Point) => Math.hypot(a.x, a.y);
const dist2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unit2 = (a: Point): Point => {
  const l = len2(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

export function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-300) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Cleans a footprint: drops duplicate and collinear vertices and orients it with positive signed
 * area (interior on the left of every edge). Edge flags follow their edges.
 */
export function normalizeFootprint(poly: Point[], flags?: boolean[]): { polygon: Point[]; flags: boolean[] } {
  let pts = poly.map((p) => ({ x: p.x, y: p.y }));
  let fl = pts.map((_, i) => (flags ? flags[i] ?? true : true));
  // remove duplicates
  for (let i = pts.length - 1; i >= 0 && pts.length > 3; i--) {
    const j = (i + 1) % pts.length;
    if (dist2(pts[i], pts[j]) < 1e-6) {
      pts.splice(j === 0 ? 0 : j, 1);
      fl.splice(j === 0 ? 0 : j, 1);
    }
  }
  // remove collinear vertices (merge the two edges; keep the first edge's flag)
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const c = cross2(sub2(cur, prev), sub2(next, cur));
      if (Math.abs(c) < 1e-6 * Math.max(1, dist2(prev, cur) * dist2(cur, next)) && dot2(sub2(cur, prev), sub2(next, cur)) > 0) {
        const pi = (i - 1 + pts.length) % pts.length;
        fl[pi] = fl[pi] && fl[i] ? true : fl[pi] || fl[i];
        pts.splice(i, 1);
        fl.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (signedArea(pts) < 0) {
    const n = pts.length;
    const rp = pts.slice().reverse();
    // reversed edge i runs rp[i] -> rp[i+1] = original edge (n-2-i) reversed
    const rf = rp.map((_, i) => fl[(((n - 2 - i) % n) + n) % n]);
    pts = rp;
    fl = rf;
  }
  return { polygon: pts, flags: fl };
}

/** Offsets a positively-oriented polygon outward by `d` (mitred corners). */
export function offsetPolygon(poly: Point[], d: number): Point[] {
  if (Math.abs(d) < 1e-9) return poly.map((p) => ({ ...p }));
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dir = unit2(sub2(b, a));
    const outward = { x: dir.y, y: -dir.x }; // right of the edge = outside
    return { p: add2(a, mul2(outward, d)), dir };
  });
  return poly.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = cross2(l1.dir, l2.dir);
    if (Math.abs(den) < 1e-9) return { ...l2.p };
    const t = cross2(sub2(l2.p, l1.p), l2.dir) / den;
    return add2(l1.p, mul2(l1.dir, t));
  });
}

// ============================================================================================
// STRAIGHT SKELETON
// ============================================================================================

export interface SkNode {
  id: number;
  p: Point;
  t: number; // offset distance (time) — distance to the supporting edges
}

export interface SkArc {
  a: number;
  b: number;
  e1: number; // the two footprint edges whose faces this arc separates
  e2: number;
}

export interface Skeleton {
  polygon: Point[];
  nodes: SkNode[];
  arcs: SkArc[];
  /** faces[e] = node ids around the face of edge e: start vertex, end vertex, then interior nodes. */
  faces: number[][];
}

interface WVertex {
  p: Point;
  ein: number; // incoming edge (prev -> this)
  eout: number; // outgoing edge (this -> next)
  node: number;
  v: Point; // velocity
}

/** Computes the straight skeleton of a simple polygon (any orientation; normalised internally). */
export function computeStraightSkeleton(input: Point[]): Skeleton {
  const { polygon } = normalizeFootprint(input);
  const n = polygon.length;
  const normals: Point[] = [];
  const cs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const d = unit2(sub2(b, a));
    const nrm = { x: -d.y, y: d.x }; // inward (left)
    normals.push(nrm);
    cs.push(dot2(nrm, a));
  }
  const dirs = normals.map((nr) => ({ x: nr.y, y: -nr.x }));

  const nodes: SkNode[] = polygon.map((p, i) => ({ id: i, p: { ...p }, t: 0 }));
  const arcs: SkArc[] = [];
  const addNode = (p: Point, t: number) => {
    nodes.push({ id: nodes.length, p: { ...p }, t });
    return nodes.length - 1;
  };

  const velocity = (ein: number, eout: number): Point => {
    const n1 = normals[ein];
    const n2 = normals[eout];
    const det = n1.x * n2.y - n1.y * n2.x;
    if (Math.abs(det) < 1e-9) {
      return dot2(n1, n2) > 0 ? { ...n1 } : { x: 0, y: 0 };
    }
    // solve [n1; n2] v = [1, 1]
    return { x: (n2.y - n1.y) / det, y: (n1.x - n2.x) / det };
  };

  let T = 0;
  let cycles: WVertex[][] = [
    polygon.map((p, i) => {
      const ein = (i - 1 + n) % n;
      return { p: { ...p }, ein, eout: i, node: i, v: velocity(ein, i) };
    }),
  ];

  const isReflex = (w: WVertex) => cross2(dirs[w.ein], dirs[w.eout]) < -1e-9;

  const closeSmallCycle = (cyc: WVertex[]) => {
    if (cyc.length === 2) {
      const [a, b] = cyc;
      if (a.node !== b.node) arcs.push({ a: a.node, b: b.node, e1: a.ein, e2: a.eout });
    }
  };

  const antiparallel = (w: WVertex) => {
    const n1 = normals[w.ein];
    const n2 = normals[w.eout];
    return Math.abs(n1.x * n2.y - n1.y * n2.x) < 1e-9 && dot2(n1, n2) < 0;
  };
  /**
   * A vertex between two opposite-facing edges is the tip of a zero-width spike (its two wavefront
   * edges have met along a ridge). It is absorbed into the nearer neighbour on that line; the arc
   * from the tip to that neighbour is the ridge.
   */
  const resolveSpikes = () => {
    for (let ci = 0; ci < cycles.length; ci++) {
      let cyc = cycles[ci];
      for (let guard = 0; guard < 4 * cyc.length + 4 && cyc.length > 2; guard++) {
        const k = cyc.findIndex(antiparallel);
        if (k < 0) break;
        const m = cyc.length;
        const V = cyc[k];
        const P = cyc[(k - 1 + m) % m];
        const N = cyc[(k + 1) % m];
        const useP = dist2(P.p, V.p) <= dist2(N.p, V.p);
        const X = useP ? P : N;
        const node = addNode(X.p, T);
        arcs.push({ a: V.node, b: node, e1: V.ein, e2: V.eout });
        if (X.node !== node) arcs.push({ a: X.node, b: node, e1: X.ein, e2: X.eout });
        const ein = useP ? P.ein : V.ein;
        const eout = useP ? V.eout : N.eout;
        const nv: WVertex = { p: { ...X.p }, ein, eout, node, v: velocity(ein, eout) };
        const iX = useP ? (k - 1 + m) % m : (k + 1) % m;
        const next = cyc.filter((_, i) => i !== k && i !== iX);
        const insertAt = Math.min(k, iX) === 0 && Math.max(k, iX) === m - 1 ? next.length : Math.min(k, iX);
        next.splice(insertAt, 0, nv);
        cyc = next;
      }
      cycles[ci] = cyc;
    }
  };

  for (let iter = 0; iter < 20 * n + 200 && cycles.length; iter++) {
    resolveSpikes();
    // 1. drop finished cycles
    cycles = cycles.filter((c) => {
      if (c.length <= 2) {
        closeSmallCycle(c);
        return false;
      }
      return true;
    });
    if (!cycles.length) break;

    // 2. find the earliest event
    type Ev =
      | { kind: 'edge'; s: number; ci: number; ia: number; p: Point }
      | { kind: 'split'; s: number; ci: number; ir: number; iu: number; p: Point };
    let best: Ev | null = null;
    const consider = (ev: Ev) => {
      if (!best || ev.s < best.s - 1e-9 || (Math.abs(ev.s - best.s) <= 1e-9 && ev.kind === 'edge' && best.kind === 'split')) best = ev;
    };
    for (let ci = 0; ci < cycles.length; ci++) {
      const cyc = cycles[ci];
      const m = cyc.length;
      for (let ia = 0; ia < m; ia++) {
        const a = cyc[ia];
        const b = cyc[(ia + 1) % m];
        const e = a.eout;
        const d = dirs[e];
        const gap = dot2(d, sub2(b.p, a.p));
        const rate = dot2(d, sub2(b.v, a.v));
        if (gap <= 1e-7) {
          consider({ kind: 'edge', s: 0, ci, ia, p: mul2(add2(a.p, b.p), 0.5) });
        } else if (rate < -1e-12) {
          const s = -gap / rate;
          consider({ kind: 'edge', s, ci, ia, p: add2(a.p, mul2(a.v, s)) });
        }
      }
      for (let ir = 0; ir < m; ir++) {
        const r = cyc[ir];
        if (!isReflex(r)) continue;
        for (let iu = 0; iu < m; iu++) {
          const u = cyc[iu];
          const w = cyc[(iu + 1) % m];
          const e = u.eout;
          if (e === r.ein || e === r.eout || iu === ir || (iu + 1) % m === ir) continue;
          const ne = normals[e];
          // signed gap to the moving edge line shrinks at rate (1 - n·v); only approaching vertices split it
          const den = dot2(ne, r.v) - 1;
          if (den >= -1e-12) continue;
          const s = (cs[e] + T - dot2(ne, r.p)) / den;
          if (s < -1e-7) continue;
          const X = add2(r.p, mul2(r.v, s));
          const pu = add2(u.p, mul2(u.v, s));
          const pw = add2(w.p, mul2(w.v, s));
          const de = dirs[e];
          const tu = dot2(de, pu);
          const tw = dot2(de, pw);
          const tx = dot2(de, X);
          const tol = 1e-6 * Math.max(1, Math.abs(tw - tu));
          if (tx < Math.min(tu, tw) - tol || tx > Math.max(tu, tw) + tol) continue;
          consider({ kind: 'split', s: Math.max(0, s), ci, ir, iu, p: X });
        }
      }
    }
    if (!best) {
      // No more events (numerically degenerate): connect remaining vertices to their centroid
      for (const cyc of cycles) {
        const c = mul2(cyc.reduce((acc, w) => add2(acc, w.p), { x: 0, y: 0 }), 1 / cyc.length);
        const node = addNode(c, T);
        for (const w of cyc) arcs.push({ a: w.node, b: node, e1: w.ein, e2: w.eout });
      }
      cycles = [];
      break;
    }
    const ev = best as Ev;

    // 3. advance the wavefront
    const s = Math.max(0, ev.s);
    if (s > 0) {
      for (const cyc of cycles) for (const w of cyc) w.p = add2(w.p, mul2(w.v, s));
      T += s;
    }

    // 4. handle the event
    const cyc = cycles[ev.ci];
    const m = cyc.length;
    if (ev.kind === 'edge') {
      const a = cyc[ev.ia];
      const b = cyc[(ev.ia + 1) % m];
      const P = mul2(add2(a.p, b.p), 0.5);
      const node = addNode(P, T);
      arcs.push({ a: a.node, b: node, e1: a.ein, e2: a.eout });
      arcs.push({ a: b.node, b: node, e1: b.ein, e2: b.eout });
      const nv: WVertex = { p: P, ein: a.ein, eout: b.eout, node, v: velocity(a.ein, b.eout) };
      const next = cyc.slice();
      if ((ev.ia + 1) % m === 0) {
        next.splice(ev.ia, 1);
        next.splice(0, 1, nv);
      } else {
        next.splice(ev.ia, 2, nv);
      }
      cycles[ev.ci] = next;
    } else {
      const r = cyc[ev.ir];
      const u = cyc[ev.iu];
      const e = u.eout;
      const X = ev.p;
      const node = addNode(X, T);
      arcs.push({ a: r.node, b: node, e1: r.ein, e2: r.eout });
      const A: WVertex = { p: { ...X }, ein: r.ein, eout: e, node, v: velocity(r.ein, e) };
      const B: WVertex = { p: { ...X }, ein: e, eout: r.eout, node, v: velocity(e, r.eout) };
      // cycle1: A, w, ..., r_prev     cycle2: B, r_next, ..., u
      const c1: WVertex[] = [A];
      for (let k = (ev.iu + 1) % m; k !== ev.ir; k = (k + 1) % m) c1.push(cyc[k]);
      const c2: WVertex[] = [B];
      for (let k = (ev.ir + 1) % m; k !== (ev.iu + 1) % m; k = (k + 1) % m) c2.push(cyc[k]);
      cycles.splice(ev.ci, 1, c1, c2);
    }
  }

  // Faces: chain arcs bordering each edge from its end vertex back to its start vertex
  const faces: number[][] = [];
  for (let e = 0; e < n; e++) {
    const start = e;
    const end = (e + 1) % n;
    const adj = new Map<number, Array<{ to: number; idx: number }>>();
    arcs.forEach((arc, idx) => {
      if (arc.e1 !== e && arc.e2 !== e) return;
      (adj.get(arc.a) || adj.set(arc.a, []).get(arc.a)!).push({ to: arc.b, idx });
      (adj.get(arc.b) || adj.set(arc.b, []).get(arc.b)!).push({ to: arc.a, idx });
    });
    const face = [start, end];
    const used = new Set<number>();
    let cur = end;
    for (let guard = 0; guard < arcs.length + 2; guard++) {
      const opts = (adj.get(cur) || []).filter((o) => !used.has(o.idx));
      if (!opts.length) break;
      // prefer the arc leading toward the start when several are possible
      opts.sort((p, q) => (p.to === start ? -1 : q.to === start ? 1 : 0));
      const o = opts[0];
      used.add(o.idx);
      if (o.to === start) break;
      face.push(o.to);
      cur = o.to;
    }
    faces.push(face);
  }

  return { polygon, nodes, arcs, faces };
}

// ============================================================================================
// ROOF MODEL
// ============================================================================================

export interface RoofSpec {
  polygon: Point[]; // wall line footprint
  style: RoofStyle;
  slopeDeg: number;
  overhang: number;
  thickness: number;
  baseZ: number; // height of the roof underside at the wall line
  edgeSlopes?: boolean[];
  includesOverhang?: boolean; // legacy: polygon is already the eave outline
  mansardLowerSlopeDeg?: number;
  mansardBreakInset?: number;
  ridgeAxis?: 'x' | 'y';
  parapetHeight?: number;
}

export type RoofFaceKind = 'slope' | 'gable' | 'flat' | 'mansard-lower' | 'mansard-upper';

export interface RoofFace {
  edge: number; // footprint edge index
  kind: RoofFaceKind;
  /** Underside polygon in 3D (plan x/y + z). */
  pts: P3[];
  slopeDeg: number;
  /** Plan unit vector pointing down the slope (outward from the ridge). */
  down: Point;
}

export type RoofLineKind = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'break';

export interface RoofLine {
  a: P3;
  b: P3;
  kind: RoofLineKind;
}

export interface RoofGeometry {
  footprint: Point[]; // normalised wall line polygon
  outline: Point[]; // eave outline (footprint + overhang)
  flags: boolean[]; // defines slope, per footprint edge
  faces: RoofFace[];
  lines: RoofLine[];
  baseZ: number;
  eaveZ: number;
  ridgeZ: number;
  thickness: number;
  slopeDeg: number;
  style: RoofStyle;
  /** Underside height of the roof at a plan point (null outside the roof). */
  undersideAt: (p: Point) => number | null;
  /** Top surface height at a plan point. */
  topAt: (p: Point) => number | null;
}

/** Default "defines slope" flags per roof style. */
export function defaultEdgeSlopes(polygon: Point[], style: RoofStyle, ridgeAxis?: 'x' | 'y'): boolean[] {
  const { polygon: P } = normalizeFootprint(polygon);
  const n = P.length;
  if (style === 'flat') return P.map(() => false);
  if (style === 'hip' || style === 'mansard') return P.map(() => true);
  if (style === 'shed') {
    let best = 0;
    let bestKey = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      // longest edge, preferring the south-most (largest y) for a classic lean-to
      const key = dist2(a, b) * 1000 + (a.y + b.y) / 2;
      if (key > bestKey) {
        bestKey = key;
        best = i;
      }
    }
    return P.map((_, i) => i === best);
  }
  // gable: wing ends (edges whose hip face is a triangle) become gables
  const sk = computeStraightSkeleton(P);
  const tri = sk.faces.map((f) => f.length === 3);
  const flags = tri.map((t) => !t);
  if (flags.every((f) => !f)) {
    // square-ish: gable ends on the two edges perpendicular to the ridge axis
    const axis = ridgeAxis || 'x';
    return P.map((a, i) => {
      const b = P[(i + 1) % n];
      const horizontal = Math.abs(b.y - a.y) < Math.abs(b.x - a.x);
      return axis === 'x' ? horizontal : !horizontal;
    });
  }
  return flags;
}

const planeThrough = (pts: P3[]): { nx: number; ny: number; nz: number; d: number } | null => {
  // pick the 3 points with the largest triangle area for stability
  let best: { nx: number; ny: number; nz: number; d: number } | null = null;
  let bestA = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const a = pts[i];
        const b = pts[j];
        const c = pts[k];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const A = Math.hypot(nx, ny, nz);
        if (A > bestA) {
          bestA = A;
          best = { nx: nx / A, ny: ny / A, nz: nz / A, d: (nx * a.x + ny * a.y + nz * a.z) / A };
        }
      }
    }
    if (pts.length > 12 && i > 4) break;
  }
  return best;
};

const zOnPlane = (pl: { nx: number; ny: number; nz: number; d: number }, p: Point) =>
  Math.abs(pl.nz) < 1e-9 ? null : (pl.d - pl.nx * p.x - pl.ny * p.y) / pl.nz;

/** Builds the full roof geometry for a spec. */
export function computeRoofGeometry(spec: RoofSpec): RoofGeometry {
  const flagsIn = spec.edgeSlopes && spec.edgeSlopes.length === spec.polygon.length ? spec.edgeSlopes : undefined;
  const norm = normalizeFootprint(spec.polygon, flagsIn);
  const footprint = norm.polygon;
  const n = footprint.length;
  const flags = flagsIn ? norm.flags : defaultEdgeSlopes(footprint, spec.style, spec.ridgeAxis);
  const overhang = spec.includesOverhang ? 0 : Math.max(0, spec.overhang);
  const outline = offsetPolygon(footprint, overhang);
  const slopeDeg = Math.max(0, Math.min(80, spec.slopeDeg));
  const tanA = Math.tan((slopeDeg * Math.PI) / 180);
  const baseZ = spec.baseZ;
  const thickness = Math.max(1, spec.thickness);

  const faces: RoofFace[] = [];
  const lines: RoofLine[] = [];
  const style: RoofStyle = spec.style === 'flat' || slopeDeg <= 0.01 || flags.every((f) => !f) ? 'flat' : spec.style;

  const edgeOut = (i: number): Point => {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const d = unit2(sub2(b, a));
    return { x: d.y, y: -d.x };
  };

  if (style === 'flat') {
    faces.push({ edge: 0, kind: 'flat', pts: outline.map((p) => ({ x: p.x, y: p.y, z: baseZ })), slopeDeg: 0, down: { x: 0, y: 0 } });
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % n];
      lines.push({ a: { ...p, z: baseZ }, b: { ...q, z: baseZ }, kind: 'eave' });
    });
  } else if (style === 'shed') {
    const e = Math.max(0, flags.findIndex((f) => f));
    const a = outline[e];
    const nIn = mul2(edgeOut(e), -1);
    const z = (p: Point) => baseZ + (dot2(nIn, sub2(p, a)) - overhang) * tanA;
    faces.push({ edge: e, kind: 'slope', pts: outline.map((p) => ({ x: p.x, y: p.y, z: z(p) })), slopeDeg, down: edgeOut(e) });
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % n];
      lines.push({ a: { ...p, z: z(p) }, b: { ...q, z: z(q) }, kind: i === e ? 'eave' : Math.abs(z(p) - z(q)) < 1e-6 ? 'eave' : 'rake' });
    });
  } else {
    const sk = computeStraightSkeleton(outline);
    const nodePos = sk.nodes.map((nd) => ({ ...nd.p }));
    const isMansard = style === 'mansard';
    const lowerTan = Math.tan(((spec.mansardLowerSlopeDeg ?? 70) * Math.PI) / 180);
    const maxT = Math.max(...sk.nodes.map((nd) => nd.t));
    const breakT = overhang + Math.min(spec.mansardBreakInset ?? 30, Math.max(1, (maxT - overhang) * 0.6));
    const zOfT = (t: number) => {
      if (!isMansard) return baseZ + (t - overhang) * tanA;
      if (t <= breakT) return baseZ + (t - overhang) * lowerTan;
      return baseZ + (breakT - overhang) * lowerTan + (t - breakT) * tanA;
    };
    // Gable ends: each apex of a gable edge's face slides along the intersection of its two
    // neighbouring roof planes until it reaches the gable edge's vertical plane. Both neighbouring
    // faces stay planar (for a rectangle this simply extends the ridge to the gable).
    const nodeT = sk.nodes.map((nd) => nd.t);
    const on = outline.length;
    const oN: Point[] = [];
    const oC: number[] = [];
    for (let i = 0; i < on; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % on];
      const d = unit2(sub2(b, a));
      const nr = { x: -d.y, y: d.x };
      oN.push(nr);
      oC.push(dot2(nr, a));
    }
    const moved = new Set<number>();
    for (let e = 0; e < n; e++) {
      if (flags[e]) continue;
      const a = outline[e];
      const d = unit2(sub2(outline[(e + 1) % n], a));
      for (const id of sk.faces[e].slice(2)) {
        if (moved.has(id)) continue;
        const nbrs: number[] = [];
        for (let k = 0; k < n; k++) if (k !== e && flags[k] && sk.faces[k].includes(id)) nbrs.push(k);
        let placed = false;
        if (nbrs.length === 2) {
          const [k1, k2] = nbrs;
          // n_e·p = c_e  and  (n_k1 − n_k2)·p = c_k1 − c_k2
          const A1 = oN[e];
          const A2 = sub2(oN[k1], oN[k2]);
          const b1 = oC[e];
          const b2 = oC[k1] - oC[k2];
          const det = A1.x * A2.y - A1.y * A2.x;
          if (Math.abs(det) > 1e-9) {
            const P = { x: (b1 * A2.y - A1.y * b2) / det, y: (A1.x * b2 - b1 * A2.x) / det };
            const t = dot2(oN[k1], P) - oC[k1];
            if (t >= -1e-6) {
              nodePos[id] = P;
              nodeT[id] = t;
              placed = true;
            }
          }
        }
        if (!placed) {
          const p = nodePos[id];
          nodePos[id] = add2(a, mul2(d, dot2(sub2(p, a), d)));
        }
        moved.add(id);
      }
    }
    const P3of = (id: number): P3 => ({ x: nodePos[id].x, y: nodePos[id].y, z: zOfT(nodeT[id]) });
    for (let e = 0; e < n; e++) {
      const ids = sk.faces[e];
      const kind: RoofFaceKind = flags[e] ? 'slope' : 'gable';
      const pts = ids.map(P3of);
      if (isMansard && kind === 'slope') {
        // split the face at t = breakT into a steep lower part and the upper part
        const lower: P3[] = [];
        const upper: P3[] = [];
        for (let k = 0; k < ids.length; k++) {
          const i1 = ids[k];
          const i2 = ids[(k + 1) % ids.length];
          const t1 = nodeT[i1];
          const t2 = nodeT[i2];
          const p1 = P3of(i1);
          (t1 <= breakT + 1e-9 ? lower : upper).push(p1);
          if ((t1 - breakT) * (t2 - breakT) < 0) {
            const f = (breakT - t1) / (t2 - t1);
            const q1 = nodePos[i1];
            const q2 = nodePos[i2];
            const X = { x: q1.x + (q2.x - q1.x) * f, y: q1.y + (q2.y - q1.y) * f, z: zOfT(breakT) };
            lower.push(X);
            upper.push(X);
          }
        }
        if (lower.length >= 3) faces.push({ edge: e, kind: 'mansard-lower', pts: lower, slopeDeg: (Math.atan(lowerTan) * 180) / Math.PI, down: edgeOut(e) });
        if (upper.length >= 3) faces.push({ edge: e, kind: 'mansard-upper', pts: upper, slopeDeg, down: edgeOut(e) });
      } else {
        faces.push({ edge: e, kind, pts, slopeDeg: kind === 'gable' ? 90 : slopeDeg, down: edgeOut(e) });
      }
    }
    // lines: eaves along sloped outline edges, rakes along gable edges, skeleton arcs classified
    for (let e = 0; e < n; e++) {
      const a = P3of(e);
      const b = P3of((e + 1) % n);
      if (flags[e]) lines.push({ a, b, kind: 'eave' });
    }
    const faceZ = (p: Point): number | null => {
      let best: number | null = null;
      for (const f of faces) {
        if (f.kind === 'gable') continue;
        if (!pointInPolygon(p, f.pts)) continue;
        const pl = planeThrough(f.pts);
        if (!pl) continue;
        const z = zOnPlane(pl, p);
        if (z !== null && (best === null || z > best)) best = z;
      }
      return best;
    };
    const seen = new Set<string>();
    for (const arc of sk.arcs) {
      const A = P3of(arc.a);
      const B = P3of(arc.b);
      if (dist2(A, B) < 1e-6) continue;
      const key = [arc.a, arc.b].sort((x, y) => x - y).join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      const onGable = (e: number) => !flags[e];
      if (onGable(arc.e1) || onGable(arc.e2)) {
        // the arc between a slope face and a gable face is the rake
        if (onGable(arc.e1) !== onGable(arc.e2)) lines.push({ a: A, b: B, kind: 'rake' });
        continue;
      }
      if (Math.abs(A.z - B.z) < 1e-6) {
        lines.push({ a: A, b: B, kind: 'ridge' });
        continue;
      }
      const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const dir = unit2(sub2(B, A));
      const q = { x: -dir.y, y: dir.x };
      const h = Math.max(0.5, dist2(A, B) * 0.02);
      const zm = (A.z + B.z) / 2;
      const z1 = faceZ(add2(m, mul2(q, h)));
      const z2 = faceZ(add2(m, mul2(q, -h)));
      const valley = z1 !== null && z2 !== null && z1 > zm + 1e-9 && z2 > zm + 1e-9;
      lines.push({ a: A, b: B, kind: valley ? 'valley' : 'hip' });
    }
    if (isMansard) {
      for (const f of faces) {
        if (f.kind !== 'mansard-lower') continue;
        const zb = zOfT(breakT);
        const pts = f.pts.filter((p) => Math.abs(p.z - zb) < 1e-6);
        if (pts.length >= 2) lines.push({ a: pts[0], b: pts[pts.length - 1], kind: 'break' });
      }
    }
  }

  const planes = faces
    .filter((f) => f.kind !== 'gable')
    .map((f) => ({ f, pl: planeThrough(f.pts) }));
  const undersideAt = (p: Point): number | null => {
    let best: number | null = null;
    for (const { f, pl } of planes) {
      if (!pl || !pointInPolygon(p, f.pts)) continue;
      const z = zOnPlane(pl, p);
      if (z !== null && (best === null || z > best)) best = z;
    }
    if (best === null) {
      // on a boundary: nearest face by distance to its polygon
      if (!pointInPolygon(p, outline)) return null;
      let bd = Infinity;
      for (const { f, pl } of planes) {
        if (!pl) continue;
        const c = f.pts.reduce((acc, q) => ({ x: acc.x + q.x / f.pts.length, y: acc.y + q.y / f.pts.length }), { x: 0, y: 0 });
        const d = dist2(c, p);
        const z = zOnPlane(pl, p);
        if (z !== null && d < bd) {
          bd = d;
          best = z;
        }
      }
    }
    return best;
  };
  const allZ = faces.flatMap((f) => f.pts.map((q) => q.z));
  const ridgeZ = allZ.length ? Math.max(...allZ) : baseZ;
  const eaveZ = allZ.length ? Math.min(...allZ) : baseZ;
  const cosA = Math.cos((slopeDeg * Math.PI) / 180) || 1;
  const vThick = style === 'flat' ? thickness : thickness / cosA;
  return {
    footprint,
    outline,
    flags,
    faces,
    lines,
    baseZ,
    eaveZ,
    ridgeZ,
    thickness,
    slopeDeg,
    style,
    undersideAt,
    topAt: (p: Point) => {
      const z = undersideAt(p);
      return z === null ? null : z + vThick;
    },
  };
}

/** Roof spec for a RoofEntity (base level elevation must be supplied). */
export function roofSpecFromEntity(roof: RoofEntity, levelElevation: number): RoofSpec {
  const legacy = roof.roofVersion !== 2;
  const style: RoofStyle = roof.roofStyle || 'gable';
  return {
    polygon: roof.polygon,
    style,
    slopeDeg: style === 'flat' ? 0 : roof.slope,
    overhang: roof.overhang ?? 18,
    thickness: roof.thickness || 8,
    baseZ: levelElevation + (roof.baseOffset ?? 0),
    edgeSlopes: roof.edgeSlopes,
    includesOverhang: legacy,
    mansardLowerSlopeDeg: roof.mansardLowerSlope,
    mansardBreakInset: roof.mansardBreakInset,
    ridgeAxis: roof.ridgeAxis,
    parapetHeight: roof.parapetHeight,
  };
}

const ROOF_CACHE = new WeakMap<RoofEntity, Map<number, RoofGeometry>>();

/** Cached roof geometry for an entity (entities are immutable, so the object is the cache key). */
export function getRoofGeometry(roof: RoofEntity, levelElevation: number): RoofGeometry {
  let m = ROOF_CACHE.get(roof);
  if (!m) {
    m = new Map();
    ROOF_CACHE.set(roof, m);
  }
  let g = m.get(levelElevation);
  if (!g) {
    g = computeRoofGeometry(roofSpecFromEntity(roof, levelElevation));
    m.set(levelElevation, g);
  }
  return g;
}

// ============================================================================================
// SLOPE NOTATION
// ============================================================================================

/** Degrees -> rise per 12 of run ("4:12"). */
export function slopeToRise12(deg: number): number {
  return Math.tan((deg * Math.PI) / 180) * 12;
}

export function rise12ToDegrees(rise: number): number {
  return (Math.atan(rise / 12) * 180) / Math.PI;
}

export function formatSlope(deg: number): string {
  const r = slopeToRise12(deg);
  const rr = Math.round(r * 2) / 2;
  return `${Number.isInteger(rr) ? rr : rr.toFixed(1)}:12`;
}

/** Parses "4:12", "4/12", "4 in 12", "18.4°", "18.4deg" or a bare number (degrees) into degrees. */
export function parseSlopeInput(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const ratio = s.match(/^(\d+(?:\.\d+)?)\s*(?::|\/|in)\s*(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const run = parseFloat(ratio[2]);
    if (!(run > 0)) return null;
    return (Math.atan(parseFloat(ratio[1]) / run) * 180) / Math.PI;
  }
  const deg = s.match(/^(\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?$/);
  if (deg) {
    const v = parseFloat(deg[1]);
    return v >= 0 && v < 90 ? v : null;
  }
  return null;
}

// ============================================================================================
// WALL ATTACH TOP
// ============================================================================================

/**
 * Top profile of a wall attached to a roof: points (s along the wall from start, z absolute)
 * where the wall meets the roof underside. Breakpoints are exact (wall/face boundary crossings).
 */
export function wallTopProfile(wall: Pick<WallEntity, 'start' | 'end'>, geom: RoofGeometry, fallbackTopZ: number): Array<{ s: number; z: number }> {
  const L = dist2(wall.start, wall.end);
  if (L < 1e-6) return [{ s: 0, z: fallbackTopZ }];
  const d = unit2(sub2(wall.end, wall.start));
  const ts = new Set<number>([0, L]);
  const segIntersect = (a: Point, b: Point) => {
    const r = sub2(b, a);
    const den = cross2(d, r);
    if (Math.abs(den) < 1e-12) return;
    const q = sub2(a, wall.start);
    const s = cross2(q, r) / den;
    const u = cross2(q, d) / den;
    if (s > 1e-6 && s < L - 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) ts.add(s);
  };
  for (const f of geom.faces) {
    for (let i = 0; i < f.pts.length; i++) segIntersect(f.pts[i], f.pts[(i + 1) % f.pts.length]);
  }
  const sorted = [...ts].sort((a, b) => a - b);
  // also sample midpoints so the profile follows faces between breakpoints
  const out: Array<{ s: number; z: number }> = [];
  for (const s of sorted) {
    const p = add2(wall.start, mul2(d, Math.min(L, Math.max(0, s))));
    // nudge endpoints slightly inward so they hit a face rather than a shared boundary
    const z = geom.undersideAt(p) ?? geom.undersideAt(add2(p, mul2(d, s < L / 2 ? 0.01 : -0.01)));
    out.push({ s, z: z === null ? fallbackTopZ : z });
  }
  return out;
}

// ============================================================================================
// SKYLIGHTS & DORMERS
// ============================================================================================

/** The sloped face containing a plan point (null if none). */
export function faceAt(geom: RoofGeometry, p: Point): RoofFace | null {
  let best: RoofFace | null = null;
  let bestZ = -Infinity;
  for (const f of geom.faces) {
    if (f.kind === 'gable' || !pointInPolygon(p, f.pts)) continue;
    const pl = planeThrough(f.pts);
    const z = pl ? zOnPlane(pl, p) : null;
    if (z !== null && z > bestZ) {
      bestZ = z;
      best = f;
    }
  }
  return best;
}

/** Plan rectangle of a skylight (width across the slope, length measured along the slope). */
export function skylightOutline(geom: RoofGeometry, s: Pick<SkylightEntity, 'position' | 'width' | 'length'>): { plan: Point[]; pts: P3[]; face: RoofFace | null } {
  const face = faceAt(geom, s.position);
  const down = face && len2(face.down) > 0 ? face.down : { x: 0, y: 1 };
  const across = { x: -down.y, y: down.x };
  const slope = face ? face.slopeDeg : 0;
  const planLen = s.length * Math.cos((slope * Math.PI) / 180);
  const c = s.position;
  const plan = [
    add2(add2(c, mul2(across, -s.width / 2)), mul2(down, -planLen / 2)),
    add2(add2(c, mul2(across, s.width / 2)), mul2(down, -planLen / 2)),
    add2(add2(c, mul2(across, s.width / 2)), mul2(down, planLen / 2)),
    add2(add2(c, mul2(across, -s.width / 2)), mul2(down, planLen / 2)),
  ];
  const pts = plan.map((p) => ({ x: p.x, y: p.y, z: (geom.topAt(p) ?? geom.baseZ) }));
  return { plan, pts, face };
}

export interface DormerGeometry {
  /** Plan footprint cut out of the main roof. */
  plan: Point[];
  /** Wall polygons (front + two sides) in 3D. */
  walls: P3[][];
  /** The two dormer roof planes in 3D. */
  roofPlanes: P3[][];
  /** Window rectangle on the front wall (3D corners). */
  window: P3[];
  ridgeZ: number;
  front: { a: P3; b: P3 };
}

/** Simple gable dormer standing on a sloped roof face. */
export function dormerGeometry(geom: RoofGeometry, d: Pick<DormerEntity, 'position' | 'width' | 'height' | 'slope' | 'windowWidth' | 'windowHeight'>): DormerGeometry | null {
  const face = faceAt(geom, d.position);
  if (!face || face.slopeDeg <= 0.5) return null;
  const down = face.down;
  const up = mul2(down, -1);
  const across = { x: -down.y, y: down.x };
  const tanMain = Math.tan((face.slopeDeg * Math.PI) / 180);
  const tanD = Math.tan((((d.slope ?? geom.slopeDeg) || 30) * Math.PI) / 180);
  const top = (p: Point) => geom.topAt(p) ?? geom.baseZ;
  const hw = d.width / 2;
  const fl = add2(d.position, mul2(across, -hw));
  const fr = add2(d.position, mul2(across, hw));
  const zFront = top(d.position);
  // keep the dormer ridge at least 6" below the main ridge
  const maxRise = Math.max(12, geom.ridgeZ + geom.thickness - 6 - zFront);
  let height = d.height;
  if (height + hw * tanD > maxRise) height = Math.max(12, maxRise - hw * tanD);
  const zEave = zFront + height;
  const zRidge = Math.min(zEave + hw * tanD, zFront + maxRise);
  // sides end where the main roof reaches the dormer eave; the ridge runs until the roof reaches it
  const sideDepth = height / tanMain;
  const ridgeDepth = (zRidge - zFront) / tanMain;
  const bl = add2(fl, mul2(up, sideDepth));
  const br = add2(fr, mul2(up, sideDepth));
  const ridgeFront = { ...d.position, z: zRidge };
  const ridgeBack = { ...add2(d.position, mul2(up, ridgeDepth)), z: zRidge };
  const P = (p: Point, z: number): P3 => ({ x: p.x, y: p.y, z });
  const front: P3[] = [P(fl, top(fl)), P(fr, top(fr)), P(fr, zEave), P(d.position, zRidge), P(fl, zEave)];
  const sideL: P3[] = [P(fl, top(fl)), P(fl, zEave), P(bl, zEave)];
  const sideR: P3[] = [P(fr, top(fr)), P(br, zEave), P(fr, zEave)];
  const roofL: P3[] = [P(fl, zEave), ridgeFront, ridgeBack, P(bl, zEave)];
  const roofR: P3[] = [P(fr, zEave), P(br, zEave), ridgeBack, ridgeFront];
  const ww = Math.min(d.windowWidth ?? d.width * 0.6, d.width - 8);
  const wh = Math.min(d.windowHeight ?? height * 0.7, height - 4);
  const wz0 = zFront + Math.max(2, (height - wh) / 2);
  const wl = add2(d.position, mul2(across, -ww / 2));
  const wr = add2(d.position, mul2(across, ww / 2));
  const window: P3[] = [P(wl, wz0), P(wr, wz0), P(wr, wz0 + wh), P(wl, wz0 + wh)];
  const plan = [fl, fr, add2(fr, mul2(up, ridgeDepth)), add2(fl, mul2(up, ridgeDepth))];
  return { plan, walls: [front, sideL, sideR], roofPlanes: [roofL, roofR], window, ridgeZ: zRidge, front: { a: P(fl, top(fl)), b: P(fr, top(fr)) } };
}

/** Footprint from a closed chain of walls: the loop of wall centre lines offset to the exterior faces. */
export function footprintFromWalls(walls: Array<Pick<WallEntity, 'start' | 'end' | 'thickness' | 'id'>>): Point[] {
  if (walls.length < 3) return [];
  // order walls into a loop by shared endpoints
  const tol = 1.5;
  const remaining = walls.slice(1);
  const loop: Point[] = [walls[0].start, walls[0].end];
  const thick: number[] = [walls[0].thickness];
  while (remaining.length) {
    const last = loop[loop.length - 1];
    const k = remaining.findIndex((w) => dist2(w.start, last) <= tol || dist2(w.end, last) <= tol);
    if (k < 0) break;
    const w = remaining.splice(k, 1)[0];
    const next = dist2(w.start, last) <= tol ? w.end : w.start;
    loop.push(next);
    thick.push(w.thickness);
  }
  if (dist2(loop[0], loop[loop.length - 1]) <= tol) loop.pop();
  if (loop.length < 3) return [];
  const { polygon } = normalizeFootprint(loop);
  // offset to the exterior faces (average thickness / 2)
  const half = thick.reduce((a, b) => a + b, 0) / thick.length / 2;
  return offsetPolygon(polygon, half);
}

/** Connected chain of walls containing `startId` (Tab in the roof tool selects it). */
export function connectedWallChain<T extends Pick<WallEntity, 'start' | 'end' | 'id'>>(walls: T[], startId: string): T[] {
  const tol = 1.5;
  const start = walls.find((w) => w.id === startId);
  if (!start) return [];
  const out = [start];
  const seen = new Set([start.id]);
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    for (const o of walls) {
      if (seen.has(o.id)) continue;
      if ([o.start, o.end].some((p) => dist2(p, w.start) <= tol || dist2(p, w.end) <= tol)) {
        seen.add(o.id);
        out.push(o);
      }
    }
  }
  return out;
}

/** Slope arrows for plan display: one per sloped face (start at centroid, pointing downslope). */
export function roofSlopeArrows(geom: RoofGeometry): Array<{ at: Point; dir: Point; label: string; face: RoofFace }> {
  const out: Array<{ at: Point; dir: Point; label: string; face: RoofFace }> = [];
  for (const f of geom.faces) {
    if (f.kind === 'gable' || f.kind === 'flat') continue;
    // area-weighted centroid of the plan polygon
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < f.pts.length; i++) {
      const p = f.pts[i];
      const q = f.pts[(i + 1) % f.pts.length];
      const c = p.x * q.y - q.x * p.y;
      A += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
    if (Math.abs(A) < 1e-6) continue;
    out.push({ at: { x: cx / (3 * A), y: cy / (3 * A) }, dir: f.down, label: formatSlope(f.slopeDeg), face: f });
  }
  return out;
}
