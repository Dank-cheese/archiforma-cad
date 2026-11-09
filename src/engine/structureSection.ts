/**
 * STRUCTURAL SECTION: a vertical cut along a section line drawn in plan.
 * Coordinates of the drawing: x = distance along the cut from its start (inches), y = −z.
 * Cut elements are filled with their material pattern; rebar crossing the cut plane shows as
 * dots, bars lying in it as lines. Elements beyond the cut (within the view depth) are drawn light.
 */
import type { ArchModel, Point, SectionEntity, WallEntity } from '../types/model';
import type { PlanPrim } from './planPrimitives';
import { materialPatternPrims, fmtLen } from './structurePlan';
import { offsetPolygon, signedArea, type P3 } from './roof';
import {
  allRebarBars,
  beamAxis,
  beamPlanOutline,
  beamSection,
  beamSystemJoists,
  beamVertical,
  columnFootprint,
  columnMaterialId,
  columnZRange,
  footingPlanOutline,
  footingZRange,
  levelElevationOf,
  materialById,
  memberSection,
  pilePositions,
  profileOutline,
  wallStructuralMaterialId,
} from './structure';

export interface SectionDrawing {
  prims: PlanPrim[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const INK = '#1c1917';
const LIGHT = '#a8a29e';

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unit = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
const perp = (a: Point): Point => ({ x: -a.y, y: a.x });

/** u-intervals where the infinite line {a + u·d} lies inside the polygon. */
export function lineIntervals(poly: Point[], a: Point, d: Point): Array<[number, number]> {
  const n = perp(d);
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = dot(sub(p, a), n);
    const fq = dot(sub(q, a), n);
    if ((fp > 0) === (fq > 0)) continue;
    const t = fp / (fp - fq);
    ts.push(dot(sub({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, a), d));
  }
  ts.sort((x, y) => x - y);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]);
  return out;
}

export function computeStructuralSection(model: ArchModel, sec: SectionEntity, opts: { mmPerIn: number; showRebar?: boolean }): SectionDrawing {
  const paper = (mm: number) => mm / Math.max(1e-6, opts.mmPerIn);
  const a = sec.start;
  const d = unit(sub(sec.end, sec.start));
  const n = perp(d);
  const Lcut = Math.hypot(sec.end.x - sec.start.x, sec.end.y - sec.start.y);
  const depth = Math.max(1, sec.depth || 240);
  const U = (p: Point) => dot(sub(p, a), d);
  const Dn = (p: Point) => dot(sub(p, a), n); // + = in front of the viewer (beyond the cut)
  const pt = (u: number, z: number): Point => ({ x: u, y: -z });
  const rect = (u0: number, u1: number, z0: number, z1: number): Point[] => [pt(u0, z0), pt(u1, z0), pt(u1, z1), pt(u0, z1)];
  const clipU = (iv: Array<[number, number]>) => iv.map(([p, q]) => [Math.max(p, -24), Math.min(q, Lcut + 24)] as [number, number]).filter(([p, q]) => q - p > 0.05);
  const cut: PlanPrim[] = [];
  const beyond: PlanPrim[] = [];
  const top: PlanPrim[] = [];
  const fill = (poly: Point[], matId: string | undefined, id: string, seed: number) => {
    const fam = materialById(matId).family;
    for (const p of materialPatternPrims(poly, matId, paper, seed, fam === 'steel' ? '#334155' : undefined)) cut.push({ ...p, id } as PlanPrim);
    cut.push({ k: 'poly', pts: poly, closed: true, stroke: INK, w: 0.35, id });
  };
  const inDepth = (poly: Point[]) => {
    const ds = poly.map(Dn);
    return Math.max(...ds) > 0 && Math.min(...ds) < depth;
  };
  let seed = 1;

  // ---- walls
  for (const w of model.entities) {
    if (w.type !== 'wall') continue;
    const dd = unit(sub(w.end, w.start));
    const nn = perp(dd);
    const h = { x: nn.x * (w.thickness / 2), y: nn.y * (w.thickness / 2) };
    const poly = [{ x: w.start.x + h.x, y: w.start.y + h.y }, { x: w.end.x + h.x, y: w.end.y + h.y }, { x: w.end.x - h.x, y: w.end.y - h.y }, { x: w.start.x - h.x, y: w.start.y - h.y }];
    const z0 = levelElevationOf(model, w.levelId) + (w.baseOffset || 0);
    const z1 = z0 + (w.height || 108);
    const iv = clipU(lineIntervals(poly, a, d));
    if (iv.length) {
      for (const [u0, u1] of iv) {
        if ((w as WallEntity).structural) fill(rect(u0, u1, z0, z1), wallStructuralMaterialId(w as WallEntity), w.id, seed++);
        else cut.push({ k: 'poly', pts: rect(u0, u1, z0, z1), closed: true, stroke: '#78716c', fill: '#e7e5e4', w: 0.25, id: w.id });
      }
    } else if (inDepth(poly)) {
      const us = poly.map(U);
      beyond.push({ k: 'poly', pts: rect(Math.min(...us), Math.max(...us), z0, z1), closed: true, stroke: '#d6d3d1', w: 0.13, id: w.id });
    }
  }

  // ---- slabs (incl. thickened edges)
  for (const f of model.entities) {
    if (f.type !== 'floor' || f.polygon.length < 3) continue;
    const zTop = levelElevationOf(model, f.levelId);
    const zBot = zTop - f.thickness;
    const matId = f.structuralMaterialId || (f.material === 'concrete' || f.structural || f.foundation ? 'conc-4000' : 'spf2');
    for (const [u0, u1] of clipU(lineIntervals(f.polygon, a, d))) {
      fill(rect(u0, u1, zBot, zTop), matId, f.id, seed++);
      if (f.foundation && f.vaporBarrier) cut.push({ k: 'poly', pts: [pt(u0, zBot - 0.5), pt(u1, zBot - 0.5)], closed: false, stroke: '#0f172a', w: 0.18, dash: [1, 0.6] });
    }
    if (f.foundation && f.thickenedEdge) {
      const pos = signedArea(f.polygon) >= 0 ? f.polygon : [...f.polygon].reverse();
      const inner = offsetPolygon(pos, -f.thickenedEdge.width);
      const outerIv = clipU(lineIntervals(pos, a, d));
      const innerIv = clipU(lineIntervals(inner, a, d));
      for (const [u0, u1] of outerIv) {
        // ring parts = outer minus inner
        let cur = u0;
        for (const [i0, i1] of innerIv.filter(([p, q]) => q > u0 && p < u1)) {
          if (i0 > cur) fill(rect(cur, i0, zBot - f.thickenedEdge.depth, zBot), matId, f.id, seed++);
          cur = Math.max(cur, i1);
        }
        if (cur < u1) fill(rect(cur, u1, zBot - f.thickenedEdge.depth, zBot), matId, f.id, seed++);
      }
    }
  }

  // ---- footings and piles
  for (const f of model.entities) {
    if (f.type !== 'footing') continue;
    const poly = footingPlanOutline(f, model.entities);
    if (poly.length < 3) continue;
    const z = footingZRange(model, f);
    const iv = clipU(lineIntervals(poly, a, d));
    if (iv.length) for (const [u0, u1] of iv) fill(rect(u0, u1, z.zBot, z.zTop), f.structuralMaterialId || 'conc-4000', f.id, seed++);
    else if (inDepth(poly)) {
      const us = poly.map(U);
      beyond.push({ k: 'poly', pts: rect(Math.min(...us), Math.max(...us), z.zBot, z.zTop), closed: true, stroke: LIGHT, w: 0.13, dash: [1.5, 0.8], id: f.id });
    }
    if (f.kind === 'pilecap') {
      const r = (f.piles?.diameter ?? 12) / 2;
      const pl = f.piles?.length ?? 240;
      for (const c of pilePositions(f, model.entities)) {
        const off = Dn(c);
        if (Math.abs(off) < r) {
          const half = Math.sqrt(r * r - off * off);
          fill(rect(U(c) - half, U(c) + half, z.zBot - pl, z.zBot), 'conc-4000', f.id, seed++);
        }
      }
    }
  }

  // ---- columns
  for (const c of model.entities) {
    if (c.type !== 'column') continue;
    const fp = columnFootprint(c);
    const z = columnZRange(model, c);
    const iv = clipU(lineIntervals(fp, a, d));
    if (iv.length) for (const [u0, u1] of iv) fill(rect(u0, u1, z.z0, z.z1), columnMaterialId(c), c.id, seed++);
    else if (inDepth(fp)) {
      const us = fp.map(U);
      beyond.push({ k: 'poly', pts: rect(Math.min(...us), Math.max(...us), z.z0, z.z1), closed: true, stroke: LIGHT, w: 0.18, id: c.id });
    }
  }

  // ---- beams & braces & joists
  const crossMember = (id: string, s0: Point, s1: Point, matId: string | undefined, profileId: string | undefined, w: number, dpt: number, zAt: (p: Point) => { zTop: number; zBot: number }, outline?: Point[]) => {
    const md = unit(sub(s1, s0));
    const sinT = Math.abs(md.x * d.y - md.y * d.x);
    const f0 = Dn(s0);
    const f1 = Dn(s1);
    const sec = memberSection(matId, profileId, w, dpt);
    if (sinT > 0.2 && (f0 > 0) !== (f1 > 0)) {
      const t = f0 / (f0 - f1);
      const X = { x: s0.x + (s1.x - s0.x) * t, y: s0.y + (s1.y - s0.y) * t };
      const u = U(X);
      if (u < -24 || u > Lcut + 24) return;
      const v = zAt(X);
      const prof = profileOutline(sec);
      const k = 1 / sinT;
      const zc = (v.zTop + v.zBot) / 2;
      const poly = prof.outer.map((q) => pt(u + q.x * k, zc + q.y));
      fill(poly, matId, id, seed++);
      for (const hole of prof.holes) cut.push({ k: 'poly', pts: hole.map((q) => pt(u + q.x * k, zc + q.y)), closed: true, fill: '#ffffff', stroke: INK, w: 0.2, id });
      return;
    }
    if (outline) {
      const iv = clipU(lineIntervals(outline, a, d));
      if (iv.length) {
        for (const [u0, u1] of iv) {
          const v0 = zAt({ x: a.x + d.x * u0, y: a.y + d.y * u0 });
          const v1 = zAt({ x: a.x + d.x * u1, y: a.y + d.y * u1 });
          fill([pt(u0, v0.zBot), pt(u1, v1.zBot), pt(u1, v1.zTop), pt(u0, v0.zTop)], matId, id, seed++);
        }
        return;
      }
    }
    if (inDepth([s0, s1])) {
      const v0 = zAt(s0);
      const v1 = zAt(s1);
      beyond.push({ k: 'poly', pts: [pt(U(s0), v0.zBot), pt(U(s1), v1.zBot), pt(U(s1), v1.zTop), pt(U(s0), v0.zTop)], closed: true, stroke: LIGHT, w: 0.13, id });
    }
  };
  for (const b of model.entities) {
    if (b.type === 'beam') {
      const ax = beamAxis(model, b);
      crossMember(b.id, ax.start, ax.end, b.structuralMaterialId, b.profileId, b.width, b.depth, (p) => beamVertical(model, b, p), b.usage === 'brace' ? undefined : beamPlanOutline(model, b));
    } else if (b.type === 'beamsystem') {
      const lv = levelElevationOf(model, b.levelId);
      const sec = beamSection(b);
      for (const [p, q] of beamSystemJoists(b)) crossMember(b.id, p, q, b.structuralMaterialId, b.profileId, b.width, b.depth, () => ({ zTop: lv + b.topOffset, zBot: lv + b.topOffset - sec.d }));
    }
  }

  // ---- rebar: dots where bars cross the cut, lines where they lie in it
  if (opts.showRebar !== false) {
    for (const [, bars] of allRebarBars(model)) {
      for (const bar of bars) {
        for (let i = 0; i + 1 < bar.pts.length; i++) {
          const P = bar.pts[i];
          const Q = bar.pts[i + 1];
          const fp = Dn(P);
          const fq = Dn(Q);
          if (Math.abs(fp) < 0.6 && Math.abs(fq) < 0.6) {
            top.push({ k: 'poly', pts: [pt(U(P), P.z), pt(U(Q), Q.z)], closed: false, stroke: bar.color, w: Math.max(0.25, bar.dia * opts.mmPerIn * 0.8) });
          } else if ((fp > 0) !== (fq > 0)) {
            const t = fp / (fp - fq);
            const X: P3 = { x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t, z: P.z + (Q.z - P.z) * t };
            const u = U(X);
            if (u < -24 || u > Lcut + 24) continue;
            top.push({ k: 'circle', c: pt(u, X.z), r: Math.max(bar.dia / 2, paper(0.35)), fill: bar.color, stroke: '#0f172a', w: 0.05 });
          }
        }
      }
    }
  }

  // ---- bounds of the drawing so far
  const all = [...beyond, ...cut, ...top];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    const pts = p.k === 'poly' ? p.pts : p.k === 'circle' ? [p.c] : [p.p];
    for (const q of pts) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0; maxX = Lcut; minY = -120; maxY = 0;
  }
  const ann: PlanPrim[] = [];
  // grade line (lowest level) with earth hatch
  const levels = [...(model.levels || [])].sort((x, y) => x.elevation - y.elevation);
  const grade = levels[0]?.elevation ?? 0;
  const gx0 = minX - paper(8);
  const gx1 = maxX + paper(8);
  ann.push({ k: 'poly', pts: [pt(gx0, grade), pt(gx1, grade)], closed: false, stroke: INK, w: 0.35 });
  for (let x = gx0; x < gx1; x += paper(3)) ann.push({ k: 'poly', pts: [pt(x, grade), pt(x - paper(1.5), grade - paper(1.5))], closed: false, stroke: '#78716c', w: 0.13 });
  // level lines
  for (const lv of levels) {
    if (lv.elevation > -minY + 240) continue;
    ann.push({ k: 'poly', pts: [pt(gx0, lv.elevation), pt(gx1 + paper(4), lv.elevation)], closed: false, stroke: '#1e3a8a', w: 0.18, dash: [3, 1.5] });
    ann.push({ k: 'circle', c: pt(gx1 + paper(6), lv.elevation), r: paper(1.2), stroke: '#1e3a8a', w: 0.2 });
    ann.push({ k: 'text', p: pt(gx1 + paper(8.5), lv.elevation + paper(1.4)), text: lv.name, size: 2.2, align: 'left', rot: 0, color: '#1e3a8a', bold: true });
    ann.push({ k: 'text', p: pt(gx1 + paper(8.5), lv.elevation - paper(1.6)), text: `${lv.elevation >= 0 ? '+' : ''}${fmtLen(lv.elevation, model.settings.units)}`, size: 1.9, align: 'left', rot: 0, color: '#1e3a8a' });
  }
  // grids crossing the cut
  for (const g of model.entities) {
    if (g.type !== 'grid') continue;
    const fs = Dn(g.start), fe = Dn(g.end);
    if ((fs > 0) === (fe > 0)) continue;
    const t = fs / (fs - fe);
    const X = { x: g.start.x + (g.end.x - g.start.x) * t, y: g.start.y + (g.end.y - g.start.y) * t };
    const u = U(X);
    if (u < minX - 1 || u > maxX + 1) continue;
    const zTop = -minY + paper(10);
    ann.push({ k: 'poly', pts: [pt(u, maxY < 0 ? -maxY - paper(4) : grade - paper(4)), pt(u, zTop)], closed: false, stroke: '#94a3b8', w: 0.13, dash: [4, 1, 0.6, 1] });
    ann.push({ k: 'circle', c: pt(u, zTop + paper(3.2)), r: paper(3.2), stroke: INK, fill: '#ffffff', w: 0.18 });
    ann.push({ k: 'text', p: pt(u, zTop + paper(3.2)), text: g.label, size: 2.6, align: 'center', rot: 0, color: INK, bold: true });
  }
  ann.push({ k: 'text', p: { x: (minX + maxX) / 2, y: maxY + paper(9) }, text: sec.name.toUpperCase(), size: 3, align: 'center', rot: 0, color: INK, bold: true });

  const prims = [...beyond, ...cut, ...top, ...ann];
  for (const p of ann) {
    const pts = p.k === 'poly' ? p.pts : p.k === 'circle' ? [p.c] : [p.p];
    for (const q of pts) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  }
  maxX += paper(22);
  return { prims, bounds: { minX, minY, maxX, maxY } };
}
