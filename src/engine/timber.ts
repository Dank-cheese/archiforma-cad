/**
 * TIMBER FRAMING — cabins, timber frames and chalets (pure functions).
 *
 *  - roofTimberFraming: exposed ridge beam(s), purlins canted to the roof pitch and rafters with
 *    decorative tails, generated from a roof's faces (vaulted cabin ceilings).
 *  - trussMembers: parametric King Post / Queen Post / Hammerbeam / Scissor trusses (span, pitch,
 *    timber size) as centre-line members in 3D.
 *  - kneeBracesFor: straight or curved knee braces between a post and the beams framing into it.
 *  - tailCutShift: the end profile of a rafter tail (plumb / square / bevel / scrolled).
 *
 * Plan coordinates in inches (+Y down); z = absolute height.
 */
import type { ArchModel, BeamEntity, ColumnEntity, Point, RoofEntity, TailCut, TrussEntity, TrussStyle } from '../types/model';
import { getRoofGeometry, type P3 } from './roof';

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const len = (a: Point) => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => {
  const l = len(a);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};

export const TAIL_CUTS: Array<{ id: TailCut; label: string }> = [
  { id: 'plumb', label: 'Plumb cut' },
  { id: 'square', label: 'Square cut' },
  { id: 'bevel', label: 'Bevel cut' },
  { id: 'scroll', label: 'Curved / scrolled' },
];

export const TRUSS_STYLES: Array<{ id: TrussStyle; label: string }> = [
  { id: 'kingpost', label: 'King Post' },
  { id: 'queenpost', label: 'Queen Post' },
  { id: 'hammerbeam', label: 'Hammerbeam' },
  { id: 'scissor', label: 'Scissor' },
];

let seq = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

function levelElev(model: Pick<ArchModel, 'levels'>, levelId?: string): number {
  return (model.levels || []).find((l) => l.id === (levelId || 'level-1'))?.elevation ?? 0;
}

/** Clips the infinite line p + t·d to a convex-or-not polygon: [tMin, tMax] of the inside span. */
function clipLine(p: Point, d: Point, poly: Point[]): [number, number] | null {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(sub(a, p), e) / den;
    const u = cross(sub(a, p), d) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  ts.sort((x, y) => x - y);
  return [ts[0], ts[ts.length - 1]];
}

export interface RoofFramingOptions {
  materialId: string;
  ridgeProfileId: string; // e.g. 'HT-8x12' or 'LOG-12'
  purlinProfileId: string;
  purlinSpacing: number; // along the slope (plan), inches
  rafterProfileId: string;
  rafterSpacing: number; // along the eave, inches
  tail: TailCut;
  tailLength: number; // extra tail past the roof edge (plan), inches — the overhang itself is already exposed tail
  ridge?: boolean;
  purlins?: boolean;
  rafters?: boolean;
}

export const DEFAULT_ROOF_FRAMING: RoofFramingOptions = {
  materialId: 'doug-fir',
  ridgeProfileId: 'HT-8x12',
  purlinProfileId: 'HT-6x8',
  purlinSpacing: 48,
  rafterProfileId: '4x8',
  rafterSpacing: 24,
  tail: 'plumb',
  tailLength: 0,
  ridge: true,
  purlins: true,
  rafters: true,
};

/** Depth of a catalog profile (falls back on the id's last number). */
function profDepth(profileId: string, lookup: (id: string) => { d: number; bf: number } | undefined): number {
  return lookup(profileId)?.d ?? 8;
}

/**
 * Exposed timber roof framing under a roof: ridge beam(s) along the ridge lines (top at the roof
 * underside), purlins parallel to each eave canted to the face's pitch, and rafters running up each
 * face with decorative tails past the eave. Returns new BeamEntity objects (not yet in the model).
 */
export function roofTimberFraming(
  model: Pick<ArchModel, 'levels'>,
  roof: RoofEntity,
  opts: RoofFramingOptions,
  profileLookup: (id: string) => { d: number; bf: number } | undefined
): BeamEntity[] {
  const lv = levelElev(model, roof.levelId);
  const g = getRoofGeometry(roof, lv);
  const out: BeamEntity[] = [];
  const base = (usage: BeamEntity['usage'], profileId: string, a: Point, b: Point, extra: Partial<BeamEntity>): BeamEntity => ({
    id: nid(usage),
    type: 'beam',
    layer: 'S-BEAM',
    levelId: roof.levelId,
    usage,
    start: a,
    end: b,
    structuralMaterialId: opts.materialId,
    profileId,
    width: 6,
    depth: 8,
    topOffset: 0,
    startOffset: 0,
    endOffset: 0,
    rotation: 0,
    justification: 'top',
    ...extra,
  });
  // ---- ridge beam(s)
  if (opts.ridge !== false) {
    for (const ln of g.lines) {
      if (ln.kind !== 'ridge') continue;
      const a = { x: ln.a.x, y: ln.a.y };
      const b = { x: ln.b.x, y: ln.b.y };
      if (len(sub(b, a)) < 6) continue;
      const mid = mul(add(a, b), 0.5);
      const zu = g.undersideAt(mid) ?? Math.min(ln.a.z, ln.b.z) - g.thickness;
      out.push(base('ridge', opts.ridgeProfileId, a, b, { topOffset: zu - lv }));
    }
  }
  for (const face of g.faces) {
    if (face.kind === 'gable' || face.kind === 'flat') continue;
    if (face.pts.length < 3 || face.slopeDeg < 1) continue;
    const poly = face.pts.map((p) => ({ x: p.x, y: p.y }));
    const down = unit(face.down);
    const along = { x: -down.y, y: down.x };
    // eave line: the lowest points of the face
    const zMin = Math.min(...face.pts.map((p) => p.z));
    const eavePts = face.pts.filter((p) => p.z <= zMin + 0.5);
    if (!eavePts.length) continue;
    const eaveRef = { x: eavePts[0].x, y: eavePts[0].y };
    const tan = Math.tan((face.slopeDeg * Math.PI) / 180);
    const zAt = (p: Point) => g.undersideAt(p) ?? zMin + dot(sub(eaveRef, p), down) * tan;
    // extent of the face up the slope (plan distance from the eave line)
    const depthUp = Math.max(...poly.map((p) => dot(sub(eaveRef, p), down)));
    // ---- purlins: parallel to the eave, canted to the pitch
    if (opts.purlins !== false) {
      const pd = profDepth(opts.ridgeProfileId, profileLookup);
      for (let k = opts.purlinSpacing; k < depthUp - pd; k += opts.purlinSpacing) {
        const p0 = sub(eaveRef, mul(down, k));
        const span = clipLine(p0, along, poly);
        if (!span || span[1] - span[0] < 12) continue;
        const a = add(p0, mul(along, span[0] + 2));
        const b = add(p0, mul(along, span[1] - 2));
        const zu = zAt(mul(add(a, b), 0.5));
        out.push(base('purlin', opts.purlinProfileId, a, b, { topOffset: zu - lv, rotation: face.slopeDeg * (cross(along, down) > 0 ? 1 : -1) }));
      }
    }
    // ---- rafters: up the slope with decorative tails past the eave
    if (opts.rafters !== false) {
      const eaveSpan = clipLine(eaveRef, along, poly.map((p) => add(p, mul(down, -0.01))));
      const ext = eavePts.map((p) => dot(sub({ x: p.x, y: p.y }, eaveRef), along));
      const lo = eaveSpan ? eaveSpan[0] : Math.min(...ext);
      const hi = eaveSpan ? eaveSpan[1] : Math.max(...ext);
      for (let s = lo + opts.rafterSpacing / 2; s < hi; s += opts.rafterSpacing) {
        const foot = add(eaveRef, mul(along, s));
        const up = clipLine(add(foot, mul(down, 0.5)), mul(down, -1), poly);
        if (!up || up[1] < 12) continue;
        const top = add(foot, mul(down, -(up[1] - 1)));
        const tailEnd = add(foot, mul(down, opts.tailLength - 1));
        const zTop = zAt(top);
        const zTail = zAt(foot) - (opts.tailLength - 1) * tan;
        out.push(base('rafter', opts.rafterProfileId, top, tailEnd, { zStart: zTop - lv, zEnd: zTail - lv, tailCut: opts.tail }));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// TRUSSES
// ------------------------------------------------------------------------------------------

export interface TrussMember {
  a: P3;
  b: P3;
  role: 'top' | 'bottom' | 'post' | 'web' | 'collar' | 'hammer' | 'brace';
}

/**
 * Centre lines of a parametric timber truss in 3D. The truss plane is vertical through start→end;
 * u runs along the span, v up from the bearing height.
 */
export function trussMembers(model: Pick<ArchModel, 'levels'>, t: TrussEntity): TrussMember[] {
  const S = len(sub(t.end, t.start));
  if (S < 12) return [];
  const dir = unit(sub(t.end, t.start));
  const z0 = levelElev(model, t.levelId) + t.bearingZ;
  const tan = Math.tan((Math.max(5, Math.min(70, t.pitch)) * Math.PI) / 180);
  const R = (S / 2) * tan; // rise
  const P = (u: number, v: number): P3 => {
    const q = add(t.start, mul(dir, u));
    return { x: q.x, y: q.y, z: z0 + v };
  };
  const m = (u0: number, v0: number, u1: number, v1: number, role: TrussMember['role']): TrussMember => ({ a: P(u0, v0), b: P(u1, v1), role });
  const ov = t.overhang;
  const out: TrussMember[] = [
    // top chords with overhang past each heel
    m(-ov, -ov * tan, S / 2, R, 'top'),
    m(S + ov, -ov * tan, S / 2, R, 'top'),
  ];
  const topV = (u: number) => (u <= S / 2 ? u : S - u) * tan;
  switch (t.style) {
    case 'kingpost':
      out.push(m(0, 0, S, 0, 'bottom'), m(S / 2, 0, S / 2, R, 'post'), m(S / 2, 0, S / 4, topV(S / 4), 'web'), m(S / 2, 0, (3 * S) / 4, topV((3 * S) / 4), 'web'));
      break;
    case 'queenpost': {
      const u1 = S / 3;
      const u2 = (2 * S) / 3;
      const vb = topV(u1);
      out.push(m(0, 0, S, 0, 'bottom'), m(u1, 0, u1, vb, 'post'), m(u2, 0, u2, vb, 'post'), m(u1, vb, u2, vb, 'collar'), m(u1, 0, u1 / 2, topV(u1 / 2), 'web'), m(u2, 0, (u2 + S) / 2, topV((u2 + S) / 2), 'web'));
      break;
    }
    case 'scissor': {
      // crossing bottom chords from each heel to the opposite top chord at 3/4 span
      out.push(m(0, 0, 0.75 * S, topV(0.75 * S), 'bottom'), m(S, 0, 0.25 * S, topV(0.25 * S), 'bottom'), m(S / 2, R / 3, S / 2, R, 'post'));
      break;
    }
    case 'hammerbeam': {
      const hb = 0.2 * S; // hammer beam reach
      const vPost = topV(hb);
      const vCollar = 0.72 * R;
      const uc = (u: number) => u; // readability
      out.push(
        m(0, 0, hb, 0, 'hammer'),
        m(S, 0, S - hb, 0, 'hammer'),
        m(hb, 0, hb, vPost, 'post'),
        m(S - hb, 0, S - hb, vPost, 'post'),
        m(uc(S / 2 - (R - vCollar) / tan), vCollar, S / 2 + (R - vCollar) / tan, vCollar, 'collar')
      );
      // curved braces: wall bracket under each hammer beam and arch from the hammer post to the collar
      const arc = (cu: number, cv: number, r: number, a0: number, a1: number, n = 8) => {
        for (let i = 0; i < n; i++) {
          const t0 = a0 + ((a1 - a0) * i) / n;
          const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
          out.push(m(cu + r * Math.cos(t0), cv + r * Math.sin(t0), cu + r * Math.cos(t1), cv + r * Math.sin(t1), 'brace'));
        }
      };
      const r1 = hb * 0.9;
      arc(0, -r1, r1, 0, Math.PI / 2 - 0.05); // left wall bracket: (0,-r)→… quarter arc up to the hammer beam
      arc(S, -r1, r1, Math.PI, Math.PI / 2 + 0.05);
      const r2 = Math.max(12, (S / 2 - hb) * 0.95);
      arc(S / 2, vPost, r2, Math.PI, Math.PI / 2 + 0.2, 10);
      arc(S / 2, vPost, r2, 0, Math.PI / 2 - 0.2, 10);
      break;
    }
  }
  return out;
}

/** One-click truss: across the short direction of an enclosed room polygon, through point p. */
export function trussSpanThrough(p: Point, roomPoly: Point[]): { start: Point; end: Point } | null {
  if (roomPoly.length < 3) return null;
  const xs = roomPoly.map((q) => q.x);
  const ys = roomPoly.map((q) => q.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const d = w <= h ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const span = clipLine(p, d, roomPoly);
  if (!span) return null;
  return { start: add(p, mul(d, span[0])), end: add(p, mul(d, span[1])) };
}

// ------------------------------------------------------------------------------------------
// KNEE BRACES / CORBELS
// ------------------------------------------------------------------------------------------

export interface KneeBraceOptions {
  leg: number; // inches along the post and along the beam
  curved: boolean;
  profileId: string;
  materialId: string;
}

export const DEFAULT_KNEE: KneeBraceOptions = { leg: 30, curved: false, profileId: '6x6-brace', materialId: 'doug-fir' };

/**
 * Knee braces from a post to every beam framing into (or passing over) it: each brace runs from the
 * post face `leg` below the beam soffit to the beam soffit `leg` out from the post face (45° for
 * equal legs). `beamInfo` gives each beam's plan axis and soffit height at the post.
 */
export function kneeBracesFor(
  col: ColumnEntity,
  beams: Array<{ beam: BeamEntity; a: Point; b: Point; soffitZ: number }>,
  levelZ: number,
  opts: KneeBraceOptions
): BeamEntity[] {
  const out: BeamEntity[] = [];
  const half = Math.max(col.width, col.depth) / 2;
  for (const { beam, a, b, soffitZ } of beams) {
    const d = unit(sub(b, a));
    const L = len(sub(b, a));
    const s = dot(sub(col.position, a), d);
    const off = Math.abs(cross(d, sub(col.position, a)));
    if (off > half + 6 || s < -half - 6 || s > L + half + 6) continue;
    for (const sgn of [-1, 1]) {
      // only where the beam actually continues on that side of the post
      const reach = sgn > 0 ? L - s : s;
      if (reach < half + opts.leg * 0.8) continue;
      const foot = add(col.position, mul(d, sgn * half));
      const head = add(col.position, mul(d, sgn * (half + opts.leg)));
      out.push({
        id: nid('knee'),
        type: 'beam',
        layer: 'S-BEAM',
        levelId: col.levelId,
        usage: 'brace',
        start: foot,
        end: head,
        zStart: soffitZ - opts.leg - levelZ,
        zEnd: soffitZ - levelZ,
        structuralMaterialId: opts.materialId,
        profileId: opts.profileId,
        width: 6,
        depth: 6,
        topOffset: 0,
        startOffset: 0,
        endOffset: 0,
        rotation: 0,
        justification: 'center',
        curved: opts.curved || undefined,
        kneeOf: { columnId: col.id, beamId: beam.id },
      });
    }
  }
  return out;
}

/** Points of a curved knee brace: a quadratic arc from the post (a) to the beam (b) bowed toward the corner. */
export function curvedBracePoints(a: P3, b: P3, n = 8): P3[] {
  const c = { x: a.x, y: a.y, z: b.z }; // the post / beam corner
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const k = { x: m.x + (c.x - m.x) * 0.55, y: m.y + (c.y - m.y) * 0.55, z: m.z + (c.z - m.z) * 0.55 };
  const pts: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * k.x + t * t * b.x, y: u * u * a.y + 2 * u * t * k.y + t * t * b.y, z: u * u * a.z + 2 * u * t * k.z + t * t * b.z });
  }
  return pts;
}

/**
 * Rafter-tail end profile: axial shift of a point of the end section at height y (−d/2…d/2 square to
 * the member, + = up) for a member descending at `slopeRad`.
 */
export function tailCutShift(cut: TailCut | undefined, y: number, d: number, slopeRad: number): number {
  switch (cut) {
    case 'plumb':
      return y * Math.tan(slopeRad);
    case 'bevel':
      return -(y + d / 2) * 0.9 + d * 0.45;
    case 'scroll': {
      const k = Math.max(-1, Math.min(1, (2 * y) / d));
      return -0.6 * d * (1 - Math.sqrt(1 - k * k)) + (k < 0 ? 0.25 * d * k : 0);
    }
    default:
      return 0;
  }
}
