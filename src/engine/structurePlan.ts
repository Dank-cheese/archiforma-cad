/**
 * Plan primitives for structural elements (plan, Foundation Plan, Framing Plan, sheets/PDF).
 * Sizes are paper millimetres; geometry is model inches (SVG +Y down).
 */
import type {
  ArchEntity,
  ArchModel,
  BeamEntity,
  ColumnEntity,
  FloorEntity,
  FootingEntity,
  Point,
  WallEntity,
} from '../types/model';
import type { PlanPrim, PrimStyle } from './planPrimitives';
import {
  allRebarBars,
  analyticalModel,
  areaReinfLabel,
  beamAxis,
  beamPlanOutline,
  beamSection,
  beamSystemJoists,
  columnMaterialId,
  columnPlanOutline,
  columnZRange,
  computeLintels,
  concreteFootprints,
  connectionGeometry,
  footingPlanOutline,
  isConcrete,
  joinAllowed,
  joinedOutlineSegments,
  jointOnHost,
  levelElevationOf,
  loadLabel,
  materialById,
  pilePositions,
  rebarLabel,
  scanSegments,
  structuralWarnings,
  wallStructuralMaterialId,
  type StructuralWarning,
  type RebarBar,
} from './structure';
import { offsetPolygon, signedArea } from './roof';

export type StructuralPlanMode = 'plan' | 'foundation' | 'framing';

export interface StructuralPrimOpts {
  mode: StructuralPlanMode;
  color?: string; // selection highlight
  analytical?: boolean;
  /** add invisible fat hit targets for thin members (interactive views only) */
  hit?: boolean;
  /** pre-computed bars (by set id) to avoid recomputing per entity */
  bars?: Map<string, RebarBar[]>;
  showRebar?: boolean;
}

const INK = '#1c1917';
const STEEL = '#1e3a8a';
const CONC = '#57534e';
const WOOD = '#92400e';
const FDN = '#7c2d12';
const ANLY = '#7e22ce';
const LOAD = '#c026d3';

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const len = (a: Point) => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
const perp = (a: Point): Point => ({ x: -a.y, y: a.x });
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const centroid = (pts: Point[]) => pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
const angleOf = (d: Point) => {
  let r = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (r >= 90 - 1e-6) r -= 180;
  if (r < -90) r += 180;
  return r;
};

/** Colour for a material family in plan. */
export function familyInk(materialId?: string): string {
  const f = materialById(materialId).family;
  return f === 'steel' ? STEEL : f === 'wood' ? WOOD : f === 'masonry' ? '#44403c' : CONC;
}

/** Plan / section material pattern inside a polygon: concrete stipple, steel solid, wood grain, CMU hatch. */
export function materialPatternPrims(poly: Point[], materialId: string | undefined, paper: (mm: number) => number, seed = 1, color?: string): PlanPrim[] {
  const out: PlanPrim[] = [];
  if (poly.length < 3) return out;
  const mat = materialById(materialId);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (mat.pattern === 'solid') {
    out.push({ k: 'poly', pts: poly, closed: true, fill: color || '#64748b', w: 0 });
    return out;
  }
  out.push({ k: 'poly', pts: poly, closed: true, fill: mat.family === 'wood' ? '#f3e2c3' : mat.family === 'masonry' ? '#e7e5e4' : '#ecebe8', w: 0 });
  if (mat.pattern === 'stipple') {
    // deterministic stipple dots + a few small triangles (aggregate), density in paper space
    let s = (seed * 9301 + 49297) % 233280;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const step = paper(1.4);
    const n = Math.min(400, Math.round(((x1 - x0) * (y1 - y0)) / (step * step)));
    for (let i = 0; i < n; i++) {
      const p = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
      if (!inside(p, poly)) continue;
      if (i % 9 === 0) {
        const r = paper(0.35);
        out.push({ k: 'poly', pts: [{ x: p.x, y: p.y - r }, { x: p.x + r, y: p.y + r * 0.7 }, { x: p.x - r, y: p.y + r * 0.7 }], closed: true, stroke: '#78716c', w: 0.08 });
      } else out.push({ k: 'circle', c: p, r: paper(0.12), fill: '#78716c', w: 0 });
    }
  } else if (mat.pattern === 'grain') {
    // wood in section/plan: diagonal X plus grain lines
    const pos = signedArea(poly) >= 0 ? poly : [...poly].reverse();
    out.push({ k: 'poly', pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false, stroke: '#a16207', w: 0.1 });
    out.push({ k: 'poly', pts: [{ x: x1, y: y0 }, { x: x0, y: y1 }], closed: false, stroke: '#a16207', w: 0.1 });
    const gap = Math.max(paper(0.9), Math.min(x1 - x0, y1 - y0) / 6);
    const offs: number[] = [];
    for (let o = y0 + gap / 2; o < y1; o += gap) offs.push(o);
    for (const [a, b] of scanSegments(pos, [], { x: 1, y: 0 }, offs))
      out.push({ k: 'poly', pts: [a, b], closed: false, stroke: '#d6a35f', w: 0.07 });
  } else if (mat.pattern === 'cmu') {
    const pos = signedArea(poly) >= 0 ? poly : [...poly].reverse();
    const d = unit({ x: 1, y: 1 });
    const n = perp(d);
    const pr = pos.map((p) => p.x * n.x + p.y * n.y);
    const lo = Math.min(...pr), hi = Math.max(...pr);
    const offs: number[] = [];
    for (let o = lo + paper(1.2); o < hi; o += paper(1.2)) offs.push(o);
    for (const [a, b] of scanSegments(pos, [], d, offs)) out.push({ k: 'poly', pts: [a, b], closed: false, stroke: '#78716c', w: 0.1 });
  }
  return out;
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-300) + a.x) c = !c;
  }
  return c;
}

const hash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
};

/** Plan primitives for one structural entity (or the structural extras of a wall / floor). */
export function buildStructuralPlanPrims(model: ArchModel, e: ArchEntity, mmPerIn: number, o: StructuralPrimOpts): PlanPrim[] {
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn);
  const out: PlanPrim[] = [];
  const id = e.id;
  const sel = o.color;
  const units = model.settings.units;
  const push = (p: PlanPrim) => out.push({ ...p, id } as PlanPrim);
  const line = (a: Point, b: Point, st: PrimStyle) => push({ k: 'poly', pts: [a, b], closed: false, ...st });
  const text = (p: Point, s: string, size: number, opts: Partial<{ align: 'left' | 'center' | 'right'; rot: number; color: string; bold: boolean }> = {}) =>
    push({ k: 'text', p, text: s, size, align: opts.align || 'center', rot: opts.rot || 0, color: sel || opts.color || INK, bold: opts.bold });
  const hitLine = (a: Point, b: Point) => o.hit && push({ k: 'poly', pts: [a, b], closed: false, stroke: '#000000', w: 3, opacity: 0 });
  const fmt = (v: number) => fmtLen(v, units);

  switch (e.type) {
    case 'column': {
      const ol = columnPlanOutline(e);
      const matId = columnMaterialId(e);
      const fam = materialById(matId).family;
      for (const p of materialPatternPrims(ol.outer, matId, paper, hash(id), fam === 'steel' ? sel || '#334155' : undefined)) push(p);
      for (const h of ol.holes) push({ k: 'poly', pts: h, closed: true, fill: '#ffffff', stroke: sel || INK, w: 0.18 });
      push({ k: 'poly', pts: ol.outer, closed: true, stroke: sel || INK, w: 0.35 });
      if (o.mode !== 'plan') {
        const sec = columnPlanOutline(e);
        const top = Math.min(...sec.outer.map((p) => p.y));
        text({ x: e.position.x + paper(1), y: top - paper(2.2) }, columnLabel(e), 1.6, { align: 'left', color: familyInk(matId) });
      }
      break;
    }
    case 'footing': {
      const fp = footingPlanOutline(e, model.entities);
      if (fp.length < 3) break;
      const strong = o.mode === 'foundation';
      if (strong) for (const p of materialPatternPrims(fp, e.structuralMaterialId || 'conc-4000', paper, hash(id))) push(p);
      push({ k: 'poly', pts: fp, closed: true, stroke: sel || FDN, w: strong ? 0.35 : 0.2, dash: strong ? undefined : [2, 1] });
      if (e.kind === 'pilecap') {
        for (const pp of pilePositions(e, model.entities)) push({ k: 'circle', c: pp, r: (e.piles?.diameter ?? 12) / 2, stroke: sel || FDN, w: 0.18, dash: [1.2, 0.8] });
      }
      if (strong || sel) {
        const c = centroid(fp);
        const lab = e.kind === 'wall' ? `WF ${fmt(e.width)} x ${fmt(e.thickness)}` : `${e.kind === 'pilecap' ? 'PC' : 'F'} ${fmt(e.length)} x ${fmt(e.width)} x ${fmt(e.thickness)}`;
        const rot = e.kind === 'wall' ? angleOf(sub(fp[1], fp[0])) : 0;
        const at = e.kind === 'wall' ? add(c, mul(perp(unit(sub(fp[1], fp[0]))), e.width / 2 + paper(2))) : add(c, { x: 0, y: (e.width / 2) + paper(2.5) });
        text(at, lab, 1.6, { rot, color: FDN });
      }
      break;
    }
    case 'beam': {
      const ax = beamAxis(model, e);
      const sec = beamSection(e);
      const ink = sel || familyInk(e.structuralMaterialId);
      const d = unit(sub(ax.end, ax.start));
      const rot = angleOf(d);
      const n = perp(d);
      const label = e.usage === 'brace' ? `${e.kneeOf ? 'KB' : 'BR'} ${sec.label}` : e.usage === 'ridge' ? `RIDGE ${sec.label}` : e.usage === 'purlin' ? `PURLIN ${sec.label}` : e.usage === 'rafter' ? `RAFTER ${sec.label}` : sec.label;
      if (e.usage === 'brace') {
        line(ax.start, ax.end, { stroke: ink, w: 0.3, dash: [3, 1, 0.6, 1] });
        // little chevron toward the high end
        const hiEnd = (e.zEnd ?? 108) >= (e.zStart ?? 0) ? ax.end : ax.start;
        const back = unit(sub(hiEnd === ax.end ? ax.start : ax.end, hiEnd));
        push({ k: 'poly', pts: [add(add(hiEnd, mul(back, paper(2))), mul(perp(back), paper(1))), hiEnd, add(add(hiEnd, mul(back, paper(2))), mul(perp(back), -paper(1)))], closed: false, stroke: ink, w: 0.25 });
      } else if (o.mode === 'framing' && !isConcrete(e.structuralMaterialId)) {
        line(ax.start, ax.end, { stroke: ink, w: 0.6 });
      } else {
        const ol = beamPlanOutline(model, e);
        if (o.mode === 'framing') for (const p of materialPatternPrims(ol, e.structuralMaterialId, paper, hash(id))) push(p);
        push({ k: 'poly', pts: ol, closed: true, stroke: ink, w: o.mode === 'framing' ? 0.3 : 0.2, dash: o.mode === 'framing' ? undefined : [2, 1] });
      }
      // repetitive framing (rafters, purlins, knee braces) is only labelled when selected
      if ((e.usage !== 'rafter' && e.usage !== 'purlin' && !e.kneeOf) || sel) text(add(mid(ax.start, ax.end), mul(n, sec.bf / 2 + paper(1.8))), label, 1.6, { rot, color: ink });
      hitLine(ax.start, ax.end);
      break;
    }
    case 'truss': {
      const ink = sel || familyInk(e.structuralMaterialId);
      const d = unit(sub(e.end, e.start));
      const n = perp(d);
      const a = add(e.start, mul(d, -e.overhang));
      const b = add(e.end, mul(d, e.overhang));
      const hw = e.memberWidth / 2;
      push({ k: 'poly', pts: [add(a, mul(n, hw)), add(b, mul(n, hw)), add(b, mul(n, -hw)), add(a, mul(n, -hw))], closed: true, stroke: ink, w: 0.3, fill: '#e7d3b5' });
      line(e.start, e.end, { stroke: ink, w: 0.13, dash: [3, 1, 0.6, 1] });
      // posts / webs meeting the chord shown as ticks
      const S = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
      const ticks = e.style === 'kingpost' || e.style === 'scissor' ? [0.5] : e.style === 'queenpost' ? [1 / 3, 2 / 3] : [0.2, 0.8];
      for (const t of ticks) {
        const q = add(e.start, mul(d, S * t));
        line(add(q, mul(n, hw + paper(0.8))), add(q, mul(n, -hw - paper(0.8))), { stroke: ink, w: 0.25 });
      }
      const rise = Math.round(12 * Math.tan((e.pitch * Math.PI) / 180) * 10) / 10;
      const style = e.style === 'kingpost' ? 'KING POST' : e.style === 'queenpost' ? 'QUEEN POST' : e.style === 'hammerbeam' ? 'HAMMERBEAM' : 'SCISSOR';
      text(add(mid(e.start, e.end), mul(n, hw + paper(2))), `${style} TRUSS ${rise}:12`, 1.6, { rot: angleOf(d), color: ink });
      hitLine(a, b);
      break;
    }
    case 'beamsystem': {
      const ink = sel || familyInk(e.structuralMaterialId);
      push({ k: 'poly', pts: e.boundary, closed: true, stroke: ink, w: 0.13, dash: [1.5, 1] });
      for (const [a, b] of beamSystemJoists(e)) line(a, b, { stroke: ink, w: o.mode === 'framing' ? 0.25 : 0.15, dash: o.mode === 'framing' ? undefined : [2, 1] });
      const c = centroid(e.boundary);
      const dir = { x: Math.cos((e.angle * Math.PI) / 180), y: Math.sin((e.angle * Math.PI) / 180) };
      const L = paper(14);
      const a = add(c, mul(dir, -L / 2));
      const b = add(c, mul(dir, L / 2));
      line(a, b, { stroke: ink, w: 0.25 });
      for (const [p, q] of [[a, dir], [b, mul(dir, -1)]] as Array<[Point, Point]>) push({ k: 'poly', pts: [add(add(p, mul(q, paper(1.6))), mul(perp(q), paper(0.8))), p, add(add(p, mul(q, paper(1.6))), mul(perp(q), -paper(0.8)))], closed: false, stroke: ink, w: 0.25 });
      push({ k: 'poly', pts: [add(c, { x: -paper(14), y: paper(1.2) }), add(c, { x: paper(14), y: paper(1.2) }), add(c, { x: paper(14), y: paper(4.6) }), add(c, { x: -paper(14), y: paper(4.6) })], closed: true, fill: '#ffffff', w: 0 });
      text(add(c, { x: 0, y: paper(2.9) }), `${beamSection(e).label} @ ${fmt(e.spacing)} o.c.`, 1.7, { color: ink, bold: true });
      if (o.hit) push({ k: 'poly', pts: e.boundary, closed: true, fill: '#000000', opacity: 0, w: 0 });
      break;
    }
    case 'rebar':
    case 'areareinf': {
      if (o.showRebar === false) break;
      let bars = o.bars?.get(e.id) ?? [];
      const host = model.entities.find((h) => h.id === e.hostId);
      if (host && host.type === 'floor' && bars.length > 12) {
        // slabs: a representative strip of the mat through the slab centre (area-reinforcement symbol)
        const c = centroid(host.polygon);
        const sp = e.type === 'areareinf' ? e.spacing : e.layout.spacing ?? 12;
        bars = bars.filter((b) => {
          const a = b.pts[0];
          const z = b.pts[b.pts.length - 1];
          const d = unit({ x: z.x - a.x, y: z.y - a.y });
          const off = Math.abs((c.x - a.x) * -d.y + (c.y - a.y) * d.x);
          return off <= sp * 2.6;
        });
      }
      const MAX = 160;
      bars.slice(0, MAX).forEach((b) => {
        const plan = b.pts.map((p) => ({ x: p.x, y: p.y }));
        const span = plan.reduce((s, p, i) => (i ? s + len(sub(p, plan[i - 1])) : s), 0);
        const col = sel || b.color;
        if (span < 0.5) {
          push({ k: 'circle', c: plan[0], r: Math.max(paper(0.35), b.dia / 2), fill: col, w: 0 });
        } else {
          push({ k: 'poly', pts: plan, closed: false, stroke: col, w: 0.18 });
          push({ k: 'circle', c: plan[0], r: paper(0.32), fill: col, w: 0 });
          push({ k: 'circle', c: plan[plan.length - 1], r: paper(0.32), fill: col, w: 0 });
        }
      });
      if (bars.length && (o.mode !== 'plan' || sel)) {
        const label = e.type === 'areareinf' ? areaReinfLabel(e, units) : rebarLabel(e, units);
        const sets = model.entities.filter((r) => (r.type === 'rebar' || r.type === 'areareinf') && r.hostId === e.hostId);
        const k = Math.max(0, sets.findIndex((r) => r.id === e.id));
        let at: Point;
        let align: 'left' | 'center' = 'left';
        if (host && host.type === 'floor') {
          at = add(centroid(host.polygon), { x: 0, y: paper(6 + 3 * k) });
          align = 'center';
        } else if (host && host.type === 'beam') {
          const ax = beamAxis(model, host);
          const d = unit(sub(ax.end, ax.start));
          at = add(mid(ax.start, ax.end), mul(perp(d), -(beamSection(host).bf / 2 + paper(2.4 + 2.4 * k))));
          text(at, `${e.mark ? e.mark + ': ' : ''}${label}`, 1.5, { color: '#b91c1c', align, rot: angleOf(d) });
          break;
        } else {
          const fp = host && host.type === 'footing' ? footingPlanOutline(host, model.entities) : [];
          const top = fp.length ? Math.min(...fp.map((p) => p.y)) : bars[0].pts[0].y;
          const left = fp.length ? Math.min(...fp.map((p) => p.x)) : bars[0].pts[0].x;
          at = { x: left, y: top - paper(2 + 2.6 * k) };
        }
        text(at, `${e.mark ? e.mark + ': ' : ''}${label}`, 1.5, { color: '#b91c1c', align });
      }
      break;
    }
    case 'connection': {
      const g = connectionGeometry(model, e);
      if (!g) break;
      const at = { x: g.at.x, y: g.at.y };
      const r = paper(1.4);
      push({ k: 'poly', pts: [{ x: at.x, y: at.y - r }, { x: at.x + r, y: at.y + r * 0.8 }, { x: at.x - r, y: at.y + r * 0.8 }], closed: true, fill: sel || '#0f172a', w: 0 });
      text(add(at, { x: paper(1.8), y: -paper(1.6) }), g.label, 1.5, { align: 'left', color: '#0f172a', bold: true });
      break;
    }
    case 'sjoint': {
      const ink = sel || '#0f766e';
      const segs = jointOnHost(e, model.entities);
      for (const [a, b] of segs) {
        if (e.kind === 'expansion') {
          const n = mul(perp(unit(sub(b, a))), Math.max(e.gap / 2, paper(0.4)));
          line(add(a, n), add(b, n), { stroke: ink, w: 0.25 });
          line(sub(a, n), sub(b, n), { stroke: ink, w: 0.25 });
        } else line(a, b, { stroke: ink, w: 0.25, dash: e.kind === 'control' ? [2.5, 1] : [5, 1, 0.8, 1] });
        hitLine(a, b);
      }
      if (segs.length) {
        const [a0, b] = segs[0];
        const a = { x: a0.x + (b.x - a0.x) * 0.5 - (b.x - a0.x) * 0.3, y: a0.y + (b.y - a0.y) * 0.5 - (b.y - a0.y) * 0.3 };
        const tag = e.kind === 'expansion' ? `E.J. (${fmt(e.gap)})` : e.kind === 'control' ? 'C.J.' : 'CONST. JT.';
        text(add(mid(a, b), mul(perp(unit(sub(b, a))), paper(2.4))), tag, 1.6, { rot: angleOf(sub(b, a)), color: ink, bold: true });
      }
      break;
    }
    case 'load': {
      const ink = sel || LOAD;
      const lab = loadLabel(e);
      if (e.kind === 'point' && e.points[0]) {
        const p = e.points[0];
        push({ k: 'circle', c: p, r: paper(1.6), stroke: ink, w: 0.25 });
        line(add(p, { x: -paper(1.1), y: -paper(1.1) }), add(p, { x: paper(1.1), y: paper(1.1) }), { stroke: ink, w: 0.25 });
        line(add(p, { x: paper(1.1), y: -paper(1.1) }), add(p, { x: -paper(1.1), y: paper(1.1) }), { stroke: ink, w: 0.25 });
        text(add(p, { x: paper(2.4), y: -paper(2) }), lab, 1.7, { align: 'left', color: ink, bold: true });
        if (o.hit) push({ k: 'circle', c: p, r: paper(2), fill: '#000', opacity: 0, w: 0 });
      } else if (e.kind === 'line' && e.points.length >= 2) {
        push({ k: 'poly', pts: e.points, closed: false, stroke: ink, w: 0.3 });
        for (let i = 0; i + 1 < e.points.length; i++) {
          const a = e.points[i], b = e.points[i + 1];
          const d = unit(sub(b, a));
          const L = len(sub(b, a));
          const n = perp(d);
          for (let s = 0; s <= L + 1e-6; s += Math.max(paper(4), L / 12)) {
            const p = add(a, mul(d, s));
            line(p, add(p, mul(n, paper(2))), { stroke: ink, w: 0.18 });
          }
          hitLine(a, b);
        }
        const a = e.points[0], b = e.points[1];
        text(add(mid(a, b), mul(perp(unit(sub(b, a))), paper(3.6))), lab, 1.7, { rot: angleOf(sub(b, a)), color: ink, bold: true });
      } else if (e.kind === 'area' && e.points.length >= 3) {
        const pos = signedArea(e.points) >= 0 ? e.points : [...e.points].reverse();
        push({ k: 'poly', pts: e.points, closed: true, stroke: ink, w: 0.25, fill: ink, opacity: 0.08 });
        const d = unit({ x: 1, y: -1 });
        const n = perp(d);
        const pr = pos.map((p) => p.x * n.x + p.y * n.y);
        const lo = Math.min(...pr), hi = Math.max(...pr);
        const offs: number[] = [];
        for (let k = lo + paper(3); k < hi; k += paper(3)) offs.push(k);
        for (const [a, b] of scanSegments(pos, [], d, offs)) line(a, b, { stroke: ink, w: 0.1 });
        const c = centroid(e.points);
        push({ k: 'poly', pts: [add(c, { x: -paper(9), y: -paper(2) }), add(c, { x: paper(9), y: -paper(2) }), add(c, { x: paper(9), y: paper(2) }), add(c, { x: -paper(9), y: paper(2) })], closed: true, fill: '#ffffff', w: 0 });
        text(c, lab, 1.8, { color: ink, bold: true });
      }
      break;
    }
    case 'section': {
      const ink = sel || '#0f172a';
      const d = unit(sub(e.end, e.start));
      const n = perp(d); // view direction (left of start→end in plan math = looking side)
      line(e.start, e.end, { stroke: ink, w: 0.35, dash: [6, 1.2, 1, 1.2] });
      hitLine(e.start, e.end);
      for (const p of [e.start, e.end]) {
        const r = paper(3);
        const c = p;
        push({ k: 'circle', c, r, stroke: ink, fill: '#ffffff', w: 0.25 });
        // filled arrow half pointing the view direction
        push({ k: 'poly', pts: [add(c, mul(perp(n), r)), add(c, mul(n, r * 1.9)), add(c, mul(perp(n), -r))], closed: true, fill: ink, w: 0 });
        text(c, e.name.replace(/^Section\s*/i, '') || 'S', 2.2, { bold: true, color: sel ? '#ffffff' : '#ffffff' });
      }
      break;
    }
    case 'floor': {
      // structural extras for a slab: material pattern (framing / foundation), span arrow, thickened edge
      if (!e.structural && !e.foundation) break;
      if (o.mode === 'plan' && !sel) break; // combined plan: the slab is drawn by the floor layer; extras only when selected
      const strong = o.mode !== 'plan';
      if (strong && e.polygon.length >= 3) {
        push({ k: 'poly', pts: e.polygon, closed: true, stroke: sel || CONC, w: 0.3 });
        for (const hole of e.openings || []) {
          push({ k: 'poly', pts: hole, closed: true, stroke: sel || CONC, w: 0.25, fill: '#ffffff' });
          if (hole.length >= 3) {
            line(hole[0], hole[2 % hole.length], { stroke: CONC, w: 0.13 });
            line(hole[1], hole[3 % hole.length], { stroke: CONC, w: 0.13 });
          }
        }
      }
      if (e.foundation && e.thickenedEdge && e.polygon.length >= 3) {
        const pos = signedArea(e.polygon) >= 0 ? e.polygon : [...e.polygon].reverse();
        push({ k: 'poly', pts: offsetPolygon(pos, -e.thickenedEdge.width), closed: true, stroke: sel || FDN, w: 0.18, dash: [2, 1] });
      }
      const c = centroid(e.polygon);
      const ang = ((e.spanAngle ?? 0) * Math.PI) / 180;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const L = paper(18);
      const a = add(c, mul(dir, -L / 2));
      const b = add(c, mul(dir, L / 2));
      const ink = sel || CONC;
      line(a, b, { stroke: ink, w: 0.3 });
      // one-way span symbol: half arrowheads at both ends
      push({ k: 'poly', pts: [a, add(add(a, mul(dir, paper(2))), mul(perp(dir), paper(1.1)))], closed: false, stroke: ink, w: 0.3 });
      push({ k: 'poly', pts: [b, add(add(b, mul(dir, -paper(2))), mul(perp(dir), -paper(1.1)))], closed: false, stroke: ink, w: 0.3 });
      const what = e.foundation ? `${fmt(e.thickness)} SLAB ON GRADE${e.vaporBarrier ? ' / VAPOR BARRIER' : ''}` : `${fmt(e.thickness)} ${materialById(e.structuralMaterialId || 'conc-4000').family === 'concrete' ? 'CONC.' : ''} SLAB`;
      text(add(c, mul(perp(dir), -paper(2.2))), what, 1.7, { rot: angleOf(dir), color: ink, bold: true });
      break;
    }
    case 'wall': {
      // structural extras: material pattern + lintels over openings
      if (!e.structural) break;
      const L = len(sub(e.end, e.start));
      if (L < 1) break;
      const d = unit(sub(e.end, e.start));
      const n = perp(d);
      for (const lt of computeLintels(model.entities, e)) {
        const a = add(e.start, mul(d, lt.s0));
        const b = add(e.start, mul(d, lt.s1));
        const h = mul(n, e.thickness / 2 + paper(0.6));
        push({ k: 'poly', pts: [add(a, h), add(b, h), sub(b, h), sub(a, h)], closed: true, stroke: sel || '#0f766e', w: 0.18, dash: [1.5, 0.8] });
        if (o.mode !== 'plan' || sel) text(add(mid(a, b), mul(n, e.thickness / 2 + paper(2.6))), lt.label, 1.4, { rot: angleOf(d), color: '#0f766e' });
      }
      break;
    }
  }
  return out;
}

export function columnLabel(c: ColumnEntity): string {
  const sec = columnPlanOutline(c);
  void sec;
  const mat = materialById(columnMaterialId(c));
  const s = c.profileId || (c.shape === 'round' ? `Ø${Math.round(c.width)}"` : `${Math.round(c.width)}x${Math.round(c.depth)}`);
  return mat.family === 'concrete' ? `${s} CONC.` : s;
}

export function fmtLen(v: number, units: 'imperial' | 'metric'): string {
  if (units === 'metric') return `${Math.round(v * 25.4)}`;
  const neg = v < 0;
  const a = Math.abs(v);
  const ft = Math.floor(a / 12 + 1e-9);
  const inch = Math.round((a - ft * 12) * 4) / 4;
  const s = ft > 0 ? `${ft}'-${inch}"` : `${inch}"`;
  return neg ? `-${s}` : s;
}

/**
 * Clean outlines of joined concrete on a level (columns + concrete beams, or footings in the
 * foundation plan): edges hidden where one concrete element runs into another.
 */
export function concreteJoinPrims(model: ArchModel, levelId: string, foundations: boolean, ink = CONC): PlanPrim[] {
  const polys = concreteFootprints(model, levelId, { foundations });
  if (polys.length < 2) return [];
  return joinedOutlineSegments(polys, (a, b) => joinAllowed(model, a, b)).map((s) => ({ k: 'poly', pts: [s.a, s.b], closed: false, stroke: ink, w: 0.35, id: s.id }) as PlanPrim);
}

/** Warning markers (red triangle with "!"). */
export function warningPrims(warnings: StructuralWarning[], mmPerIn: number): PlanPrim[] {
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn);
  const out: PlanPrim[] = [];
  for (const w of warnings) {
    const r = paper(1.8);
    const c = add(w.at, { x: paper(2.5), y: -paper(2.5) });
    out.push({ k: 'poly', pts: [{ x: c.x, y: c.y - r }, { x: c.x + r, y: c.y + r * 0.8 }, { x: c.x - r, y: c.y + r * 0.8 }], closed: true, fill: '#dc2626', stroke: '#7f1d1d', w: 0.15, id: w.entityId });
    out.push({ k: 'text', p: { x: c.x, y: c.y + paper(0.25) }, text: '!', size: 1.6, align: 'center', rot: 0, color: '#ffffff', bold: true, id: w.entityId });
  }
  return out;
}

/** Analytical model in plan: member centrelines, nodes, supports. */
export function analyticalPrims(model: ArchModel, levelId: string, mmPerIn: number): PlanPrim[] {
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn);
  const an = analyticalModel(model);
  const lvZ = levelElevationOf(model, levelId);
  const out: PlanPrim[] = [];
  for (const m of an.members) {
    const ent = model.entities.find((e) => e.id === m.id);
    if (!ent || (ent.levelId || 'level-1') !== levelId) continue;
    if (m.kind === 'column') {
      out.push({ k: 'circle', c: { x: m.a.x, y: m.a.y }, r: paper(0.9), stroke: ANLY, w: 0.25, id: m.id });
    } else out.push({ k: 'poly', pts: [{ x: m.a.x, y: m.a.y }, { x: m.b.x, y: m.b.y }], closed: false, stroke: ANLY, w: 0.25, dash: m.kind === 'brace' ? [2, 1] : [5, 1, 1, 1], id: m.id });
  }
  for (const n of an.nodes) if (Math.abs(n.z - lvZ) < 160) out.push({ k: 'circle', c: { x: n.x, y: n.y }, r: paper(0.6), fill: ANLY, w: 0 });
  for (const s of an.supports) {
    const c = { x: s.at.x, y: s.at.y };
    const r = paper(1.6);
    out.push({ k: 'poly', pts: [{ x: c.x, y: c.y }, { x: c.x + r, y: c.y + r * 1.4 }, { x: c.x - r, y: c.y + r * 1.4 }], closed: true, stroke: ANLY, fill: s.kind === 'fixed' ? ANLY : '#ffffff', w: 0.2 });
  }
  return out;
}

/** Which levels' columns appear in a framing plan of `levelId`: columns on it, and columns topping out at it. */
function columnsForFraming(model: ArchModel, levelId: string): ColumnEntity[] {
  const z = levelElevationOf(model, levelId);
  return model.entities.filter((e): e is ColumnEntity => {
    if (e.type !== 'column') return false;
    if ((e.levelId || 'level-1') === levelId) return true;
    const r = columnZRange(model, e);
    return r.z1 >= z - 1 && r.z0 < z;
  });
}

/**
 * Whole-level structural drawing for the Foundation Plan and Framing Plan views / sheets.
 * Architectural walls are drawn light; structure strong.
 */
export function buildStructuralLevelPrims(model: ArchModel, levelId: string, mmPerIn: number, mode: 'foundation' | 'framing', opts: { analytical?: boolean; selectedIds?: Set<string>; hit?: boolean; warnings?: boolean } = {}): PlanPrim[] {
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn);
  const out: PlanPrim[] = [];
  const bars = allRebarBars(model);
  const onLevel = (e: ArchEntity) => (e.levelId || 'level-1') === levelId;
  const selColor = (e: ArchEntity) => (opts.selectedIds?.has(e.id) ? '#d97706' : undefined);
  const levels = [...(model.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const lowest = levels[0]?.id || 'level-1';
  const fdnLevel = mode === 'foundation' ? lowest : levelId;
  // grids (all levels, they are datums)
  for (const g of model.entities) {
    if (g.type !== 'grid') continue;
    out.push({ k: 'poly', pts: [g.start, g.end], closed: false, stroke: '#94a3b8', w: 0.13, dash: [4, 1, 0.6, 1] });
    const r = paper(3.2);
    const d = unit(sub(g.end, g.start));
    const c = add(g.start, mul(d, -r));
    out.push({ k: 'circle', c, r, stroke: INK, fill: '#ffffff', w: 0.18 });
    out.push({ k: 'text', p: c, text: g.label, size: 2.6, align: 'center', rot: 0, color: INK, bold: true });
  }
  // architectural walls, light
  for (const w of model.entities) {
    if (w.type !== 'wall' || (w.levelId || 'level-1') !== fdnLevel) continue;
    const d = unit(sub(w.end, w.start));
    const n = mul(perp(d), w.thickness / 2);
    const poly = [add(w.start, n), add(w.end, n), sub(w.end, n), sub(w.start, n)];
    const structural = !!(w as WallEntity).structural;
    if (structural) for (const p of materialPatternPrims(poly, wallStructuralMaterialId(w as WallEntity), paper, hash(w.id))) out.push({ ...p, id: w.id } as PlanPrim);
    out.push({ k: 'poly', pts: poly, closed: true, stroke: structural ? selColor(w) || CONC : '#cbd5e1', w: structural ? 0.3 : 0.13, fill: structural ? undefined : '#f8fafc', id: w.id });
    if (structural && mode === 'framing') out.push(...buildStructuralPlanPrims(model, w, mmPerIn, { mode, color: selColor(w), hit: opts.hit }));
  }
  if (mode === 'foundation') {
    for (const e of model.entities) {
      if (e.type === 'floor' && e.foundation && onLevelOf(e, fdnLevel)) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), hit: opts.hit }));
    }
    for (const e of model.entities) {
      if (e.type === 'footing' && onLevelOf(e, fdnLevel)) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), hit: opts.hit }));
    }
    out.push(...concreteJoinPrims(model, fdnLevel, true, FDN));
    for (const e of model.entities) {
      if ((e.type === 'rebar' || e.type === 'areareinf') && onLevelOf(e, fdnLevel)) {
        const host = model.entities.find((h) => h.id === e.hostId);
        if (host && (host.type === 'footing' || (host.type === 'floor' && (host as FloorEntity).foundation))) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), bars }));
      }
      if (e.type === 'sjoint' && onLevelOf(e, fdnLevel)) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), hit: opts.hit }));
    }
    for (const c of model.entities) {
      if (c.type === 'column' && onLevelOf(c, fdnLevel)) out.push(...buildStructuralPlanPrims(model, c, mmPerIn, { mode, color: selColor(c), hit: opts.hit }));
    }
  } else {
    for (const e of model.entities) {
      if (e.type === 'floor' && (e.structural || e.foundation) && onLevel(e) && !e.foundation) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e) }));
    }
    for (const e of model.entities) {
      if (!onLevel(e)) continue;
      if (e.type === 'beamsystem' || e.type === 'beam' || e.type === 'sjoint' || e.type === 'load') out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), hit: opts.hit }));
    }
    for (const e of model.entities) {
      if ((e.type === 'rebar' || e.type === 'areareinf') && onLevel(e)) {
        const host = model.entities.find((h) => h.id === e.hostId);
        if (host && (host.type === 'beam' || (host.type === 'floor' && !(host as FloorEntity).foundation))) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), bars }));
      }
    }
    for (const c of columnsForFraming(model, levelId)) out.push(...buildStructuralPlanPrims(model, c, mmPerIn, { mode, color: selColor(c), hit: opts.hit }));
    out.push(...concreteJoinPrims(model, levelId, false));
    for (const e of model.entities) if (e.type === 'connection' && onLevel(e)) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e) }));
    if (opts.analytical) out.push(...analyticalPrims(model, levelId, mmPerIn));
  }
  for (const e of model.entities) if (e.type === 'section' && onLevelOf(e, fdnLevel)) out.push(...buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: selColor(e), hit: opts.hit }));
  if (opts.warnings) {
    const ws = structuralWarnings(model).filter((w) => {
      const ent = model.entities.find((x) => x.id === w.entityId);
      return ent && onLevelOf(ent, mode === 'foundation' ? fdnLevel : levelId);
    });
    out.push(...warningPrims(ws, mmPerIn));
  }
  return out;
}

const onLevelOf = (e: ArchEntity, levelId: string) => (e.levelId || 'level-1') === levelId;

export type { FootingEntity, BeamEntity };
