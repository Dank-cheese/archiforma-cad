/**
 * Shared floor-plan "plot primitives" used by every documentation output that draws a plan
 * outside the live editor: the on-screen Sheet preview (SheetsView SVG) and the PDF exporter.
 *
 * Geometry is in model inches (SVG convention: +Y down). Line weights, dash lengths and text
 * heights are in PAPER millimetres so a plan plots with the same pen weights at any scale.
 * Because the on-screen sheet and the PDF consume the same list, what you see is what plots.
 */
import { isHostedOpening, openingPlanSymbol, wallExtSign, type HostedOpening } from './openings';
import { joinGroupKey, joinHubs, mergeOutlines } from './wallJoins';

/** Continuous outlines of joined walls (one contour per join group; curtain walls excluded). */
export function joinedWallOutlines(walls: WallEntity[], openings: ArchEntity[]): Point[][] {
  const groups = new Map<string, Point[][]>();
  for (const w of walls) {
    if (w.curtain || w.wallTypeId === 'wt-curtain') continue;
    const k = joinGroupKey(w);
    const arr = groups.get(k) || [];
    arr.push(...computeWallPlanPolygons(w, walls, openings));
    groups.set(k, arr);
  }
  for (const h of joinHubs(walls)) {
    const w = walls.find((x) => x.id === h.wallIds[0]);
    if (w) groups.get(joinGroupKey(w))?.push(h.poly);
  }
  const out: Point[][] = [];
  for (const polys of groups.values()) out.push(...mergeOutlines(polys));
  return out;
}
import {
  ArchEntity,
  ArchModel,
  DoorEntity,
  HatchEntity,
  Point,
  SheetViewport,
  VisibilityCategory,
  WallEntity,
  WindowEntity,
  RoofEntity,
  SectionEntity,
} from '../types/model';
import { getRoofGeometry, offsetPolygon, roofSlopeArrows, skylightOutline, dormerGeometry } from './roof';
import { balconyPlan, computeElevation, curtainOf, roofMaterialDef } from './facade';
import { buildStructuralLevelPrims } from './structurePlan';
import { computeStructuralSection } from './structureSection';
import {
  add,
  angleDegRaw,
  computeLinearDimGeometry,
  computeRadialDimGeometry,
  computeStairPlanGeometry,
  computeWallPlanPolygons,
  dist,
  formatArea,
  formatLength,
  getBlockWorldPrimitives,
  rotatePoint,
  segmentIntersection,
  lerpPoint,
  midpoint,
  normalize,
  perpLeft,
  polygonArea,
  scale,
  sub,
} from './geometry';

export interface PrimStyle {
  stroke?: string; // undefined = no stroke
  fill?: string; // undefined = no fill
  w: number; // pen width, paper mm
  dash?: number[]; // dash pattern, paper mm
  opacity?: number; // fill/stroke opacity (default 1)
}

export type PlanPrim =
  | ({ k: 'poly'; pts: Point[]; closed: boolean; id?: string } & PrimStyle)
  | ({ k: 'circle'; c: Point; r: number; id?: string } & PrimStyle)
  | {
      k: 'text';
      id?: string;
      p: Point;
      text: string;
      size: number; // cap height, paper mm
      align: 'left' | 'center' | 'right';
      rot: number; // degrees, SVG convention (clockwise on screen)
      color: string;
      bold?: boolean;
    };

const INK = '#1c1917';
const INK_SOFT = '#44403c';
const INK_LIGHT = '#78716c';

const PEN_CUT = 0.35; // cut walls / columns
const PEN_MED = 0.25; // doors, windows, stairs
const PEN_FINE = 0.18; // linework, furniture
const PEN_HAIR = 0.13; // hatches, dims, grids

const CATEGORY_OF: Partial<Record<ArchEntity['type'], VisibilityCategory>> = {
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  wallopening: 'doors',
  floor: 'floors',
  roof: 'roofs',
  stair: 'stairs',
  column: 'columns',
  grid: 'grids',
  room: 'rooms',
  block: 'furniture',
  dimension: 'annotations',
  text: 'annotations',
  leader: 'annotations',
  tag: 'annotations',
  hatch: 'annotations',
  line: 'lines',
  polyline: 'lines',
  rectangle: 'lines',
  circle: 'lines',
  arc: 'lines',
};

/** Samples an arc given in this app's convention (SVG degrees, sweeping +angle from start to end). */
export function sampleArc(c: Point, r: number, startDeg: number, endDeg: number): Point[] {
  const sweep = (((endDeg - startDeg) % 360) + 360) % 360 || 360;
  const n = Math.max(6, Math.ceil(sweep / 6));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((startDeg + (sweep * i) / n) * Math.PI) / 180;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

export function isEntityOnLevel(e: ArchEntity, levelId: string): boolean {
  if (e.type === 'grid') return true; // grids are datum elements shown on every level
  if (e.type === 'stair') {
    return (e.baseLevelId || e.levelId || 'level-1') === levelId || e.topLevelId === levelId;
  }
  return (e.levelId || 'level-1') === levelId;
}

/** True if the entity's layer is switched on (layers are matched by id or by name). */
export function isLayerVisible(model: ArchModel, layerRef: string): boolean {
  const l = model.layers.find((x) => x.id === layerRef) || model.layers.find((x) => x.name === layerRef);
  return l ? l.visible !== false : true;
}

/** Door plan symbol (jambs gap is cut by the wall polygons): leaf + 90° swing arc. */
export function computeDoorSymbol(
  door: DoorEntity,
  host: WallEntity
): { leaf: [Point, Point]; arc: Point[]; hinge: Point; radius: number; arcStartDeg: number; arcEndDeg: number } {
  const center = lerpPoint(host.start, host.end, door.offset);
  const dir = normalize(sub(host.end, host.start));
  const norm = perpLeft(dir);
  const isLeft = door.swing.startsWith('left');
  const isIn = door.swing.endsWith('in');
  const hinge = add(center, scale(dir, isLeft ? -door.width / 2 : door.width / 2));
  const latch = add(center, scale(dir, isLeft ? door.width / 2 : -door.width / 2));
  const openTip = add(hinge, scale(norm, (isIn ? 1 : -1) * door.width));
  const a0 = angleDegRaw(hinge, latch);
  const a1 = angleDegRaw(hinge, openTip);
  const sweep = (((a1 - a0) % 360) + 360) % 360;
  // Swing arc in this app's arc convention (SVG degrees, sweeping +angle from start to end)
  const [arcStartDeg, arcEndDeg] = sweep <= 180 ? [a0, a1] : [a1, a0];
  const arc = sampleArc(hinge, door.width, arcStartDeg, arcEndDeg);
  return { leaf: [hinge, openTip], arc, hinge, radius: door.width, arcStartDeg, arcEndDeg };
}

/** Window plan symbol: frame box through the wall + two glazing lines. */
export function computeWindowSymbol(win: WindowEntity, host: WallEntity): { box: Point[]; glass: Array<[Point, Point]> } {
  const center = lerpPoint(host.start, host.end, win.offset);
  const dir = normalize(sub(host.end, host.start));
  const norm = perpLeft(dir);
  const hw = win.width / 2;
  const ht = host.thickness / 2;
  const at = (along: number, across: number) => add(add(center, scale(dir, along)), scale(norm, across));
  return {
    box: [at(-hw, ht), at(hw, ht), at(hw, -ht), at(-hw, -ht)],
    glass: [
      [at(-hw, 1.2), at(hw, 1.2)],
      [at(-hw, -1.2), at(hw, -1.2)],
    ],
  };
}

/**
 * Plot primitives of a hosted opening (door / window / wall opening) from the shared plan symbol:
 * frame + glass at the depth position, leaf + swing, sills and overhead head lines.
 */
export function openingPlanPrims(
  o: HostedOpening,
  host: WallEntity,
  levelWalls: WallEntity[],
  style: { ink?: string; soft?: string; fill?: string; id?: string; scale?: number } = {}
): PlanPrim[] {
  const ink = style.ink || INK;
  const soft = style.soft || INK_SOFT;
  const k = style.scale ?? 1;
  const sym = openingPlanSymbol(o, host, wallExtSign(host, levelWalls));
  const out: PlanPrim[] = [];
  const id = style.id;
  for (const fr of sym.frames) out.push({ k: 'poly', pts: fr, closed: true, stroke: ink, fill: style.fill ?? '#ffffff', w: PEN_FINE * k, id });
  for (const [a, b] of sym.thin) out.push({ k: 'poly', pts: [a, b], closed: false, stroke: soft, w: PEN_HAIR * k, id });
  for (const [a, b] of sym.lines) out.push({ k: 'poly', pts: [a, b], closed: false, stroke: ink, w: PEN_MED * k, id });
  for (const d of sym.dashed) out.push({ k: 'poly', pts: d, closed: false, stroke: soft, w: PEN_HAIR * k, dash: [1.2, 0.8], id });
  return out;
}

/**
 * Builds the plot primitives for one level.
 * @param mmPerIn paper mm per model inch (the viewport scale) — used to size ticks, bubbles and
 *                annotation text that must keep a constant printed size.
 */
export function buildPlanPrimitives(model: ArchModel, levelId: string, mmPerIn: number): PlanPrim[] {
  const units = model.settings.units;
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn); // paper mm -> model inches
  const vis = model.visibility?.plan2d;
  const show = (e: ArchEntity) => {
    if (!isEntityOnLevel(e, levelId)) return false;
    if (!isLayerVisible(model, e.layer)) return false;
    const cat = CATEGORY_OF[e.type];
    if (cat && vis && vis[cat] === false) return false;
    return true;
  };

  const all = model.entities;
  const ents = all.filter(show);
  const levelWalls = all.filter((e): e is WallEntity => e.type === 'wall' && isEntityOnLevel(e, levelId));
  const levelOpenings = all.filter((e): e is HostedOpening => isHostedOpening(e) && isEntityOnLevel(e, levelId));
  const wallById = new Map(levelWalls.map((w) => [w.id, w] as const));
  const blocks = model.blocks;

  const under: PlanPrim[] = []; // floors, hatches, room fills
  const mid: PlanPrim[] = []; // walls, openings, objects
  const top: PlanPrim[] = []; // annotation

  const text = (
    out: PlanPrim[],
    p: Point,
    s: string,
    size: number,
    opts: Partial<{ align: 'left' | 'center' | 'right'; rot: number; color: string; bold: boolean }> = {}
  ) => {
    if (!s) return;
    out.push({ k: 'text', p, text: s, size, align: opts.align || 'center', rot: opts.rot || 0, color: opts.color || INK, bold: opts.bold });
  };
  const line = (out: PlanPrim[], a: Point, b: Point, st: PrimStyle) => out.push({ k: 'poly', pts: [a, b], closed: false, ...st });

  const tick = (out: PlanPrim[], at: Point, dir: Point) => {
    const t = normalize(add(dir, perpLeft(dir)));
    const h = paper(1.1);
    line(out, add(at, scale(t, -h)), add(at, scale(t, h)), { stroke: INK, w: 0.25 });
  };

  /** Readable text angle for a direction (never upside down). */
  const readableRot = (a: Point, b: Point) => {
    let ang = angleDegRaw(a, b);
    if (ang > 90 && ang <= 270) ang -= 180;
    if (ang > 270) ang -= 360;
    return ang;
  };

  for (const e of ents) {
    switch (e.type) {
      case 'floor':
        if (e.polygon.length >= 3) {
          under.push({ k: 'poly', pts: e.polygon, closed: true, stroke: INK_LIGHT, fill: '#f5f5f4', w: PEN_HAIR });
          for (const op of e.openings ?? []) {
            if (op.length >= 3) {
              under.push({ k: 'poly', pts: op, closed: true, stroke: INK_SOFT, fill: '#ffffff', w: PEN_FINE, dash: [1.5, 1.0] });
            }
          }
        }
        break;
      case 'roof':
      case 'skylight':
      case 'dormer':
      case 'balcony':
      case 'railing':
        top.push(...buildRoofFacadePlanPrims(model, e, mmPerIn));
        break;
      case 'room': {
        if (e.polygon.length < 3) break;
        const area = formatArea(polygonArea(e.polygon), units);
        text(top, e.labelPos, e.name.toUpperCase(), 2.4, { bold: true });
        text(top, add(e.labelPos, { x: 0, y: paper(3.4) }), [e.mark, area].filter(Boolean).join('  ·  '), 1.9, { color: INK_SOFT });
        break;
      }
      case 'hatch': {
        if (e.polygon.length < 3) break;
        const col = e.color || INK_LIGHT;
        if (e.pattern === 'solid') {
          under.push({ k: 'poly', pts: e.polygon, closed: true, fill: col, w: 0 });
        } else {
          for (const seg of computeHatchPatternLines(e)) line(under, seg.a, seg.b, { stroke: col, w: PEN_HAIR });
          under.push({ k: 'poly', pts: e.polygon, closed: true, stroke: col, w: PEN_HAIR });
        }
        break;
      }
      case 'wall': {
        // joined pieces are filled without their own outline; the group contour is added below
        const curtain = !!e.curtain || e.wallTypeId === 'wt-curtain';
        for (const poly of computeWallPlanPolygons(e, levelWalls, levelOpenings)) {
          if (poly.length < 3) continue;
          mid.push(curtain ? { k: 'poly', pts: poly, closed: true, stroke: INK, fill: '#d6d3d1', w: PEN_CUT } : { k: 'poly', pts: poly, closed: true, stroke: '#d6d3d1', fill: '#d6d3d1', w: 0.05 });
        }
        break;
      }
      case 'door':
      case 'window':
      case 'wallopening': {
        const host = wallById.get(e.wallId);
        if (!host) break;
        mid.push(...openingPlanPrims(e, host, levelWalls));
        break;
      }
      case 'stair': {
        const viewedFromTop = e.topLevelId === levelId && (e.baseLevelId || e.levelId || 'level-1') !== levelId;
        const sg = computeStairPlanGeometry(e, {
          levels: model.levels,
          viewedFromTopLevel: viewedFromTop,
        });
        for (const lp of sg.landingPolygons) {
          mid.push({
            k: 'poly',
            pts: lp.polygon,
            closed: true,
            stroke: lp.aboveCut ? INK_SOFT : INK,
            fill: '#fafaf9',
            w: PEN_MED,
            dash: lp.aboveCut ? [1.4, 0.9] : undefined,
          });
          if (lp.intermediateStepLine) {
            line(mid, lp.intermediateStepLine[0], lp.intermediateStepLine[1], {
              stroke: INK,
              w: PEN_FINE,
            });
          }
        }
        for (const rp of sg.runPolygons) {
          mid.push({ k: 'poly', pts: rp.polygon, closed: true, stroke: INK, w: PEN_MED });
        }
        for (const wp of sg.winderPolygons) {
          mid.push({
            k: 'poly',
            pts: wp.polygon,
            closed: true,
            stroke: wp.aboveCut ? INK_SOFT : INK,
            w: PEN_FINE,
            dash: wp.aboveCut ? [1.2, 0.8] : undefined,
          });
        }
        for (const t of sg.treadLines) {
          line(mid, t.a, t.b, {
            stroke: t.aboveCut ? INK_LIGHT : INK_SOFT,
            w: PEN_FINE,
            dash: t.aboveCut ? [1.2, 0.8] : undefined,
          });
        }
        if (sg.cutBreakLine) {
          mid.push({
            k: 'poly',
            pts: sg.cutBreakLine.zigzag,
            closed: false,
            stroke: INK,
            w: PEN_MED,
          });
        }
        if (sg.walkPath.length >= 2) {
          mid.push({ k: 'poly', pts: sg.walkPath, closed: false, stroke: INK, w: PEN_FINE });
        }
        mid.push({ k: 'poly', pts: sg.walkArrowHead, closed: false, stroke: INK, w: PEN_FINE });
        for (const rl of sg.riserLabels) {
          text(top, rl.position, rl.text, 1.3, { color: rl.aboveCut ? INK_LIGHT : INK_SOFT });
        }
        text(top, sg.walkLabel.position, sg.walkLabel.text, 1.8, { bold: true });
        break;
      }
      case 'column': {
        if (e.shape === 'round') {
          mid.push({ k: 'circle', c: e.position, r: e.width / 2, stroke: INK, fill: '#a8a29e', w: PEN_CUT });
        } else {
          const hw = e.width / 2;
          const hd = e.depth / 2;
          const rad = ((e.rotation || 0) * Math.PI) / 180;
          const rot = (p: Point) => ({
            x: e.position.x + p.x * Math.cos(rad) - p.y * Math.sin(rad),
            y: e.position.y + p.x * Math.sin(rad) + p.y * Math.cos(rad),
          });
          mid.push({
            k: 'poly',
            pts: [rot({ x: -hw, y: -hd }), rot({ x: hw, y: -hd }), rot({ x: hw, y: hd }), rot({ x: -hw, y: hd })],
            closed: true,
            stroke: INK,
            fill: '#a8a29e',
            w: PEN_CUT,
          });
        }
        break;
      }
      case 'grid': {
        line(mid, e.start, e.end, { stroke: INK_LIGHT, w: PEN_HAIR, dash: [4, 1, 0.6, 1] });
        const r = paper(3.2);
        const d = normalize(sub(e.end, e.start));
        const bubbles: Point[] = [];
        if (e.showBubbleStart !== false) bubbles.push(add(e.start, scale(d, -r)));
        if (e.showBubbleEnd) bubbles.push(add(e.end, scale(d, r)));
        for (const c of bubbles) {
          top.push({ k: 'circle', c, r, stroke: INK, fill: '#ffffff', w: PEN_FINE });
          text(top, add(c, { x: 0, y: paper(1.1) }), e.label, 2.6, { bold: true });
        }
        break;
      }
      case 'line':
        line(mid, e.start, e.end, { stroke: INK_SOFT, w: PEN_FINE });
        break;
      case 'polyline':
        if (e.points.length >= 2) mid.push({ k: 'poly', pts: e.points, closed: e.closed, stroke: INK_SOFT, w: PEN_FINE });
        break;
      case 'rectangle':
        mid.push({
          k: 'poly',
          pts: [e.p1, { x: e.p2.x, y: e.p1.y }, e.p2, { x: e.p1.x, y: e.p2.y }],
          closed: true,
          stroke: INK_SOFT,
          w: PEN_FINE,
        });
        break;
      case 'circle':
        mid.push({ k: 'circle', c: e.center, r: e.radius, stroke: INK_SOFT, w: PEN_FINE });
        break;
      case 'arc':
        mid.push({ k: 'poly', pts: sampleArc(e.center, e.radius, e.startAngle, e.endAngle), closed: false, stroke: INK_SOFT, w: PEN_FINE });
        break;
      case 'block': {
        const def = blocks?.find((b) => b.id === e.blockId);
        for (const p of getBlockWorldPrimitives(e, def)) {
          if (p.type === 'line') line(mid, p.start, p.end, { stroke: INK_SOFT, w: PEN_FINE });
          else if (p.type === 'polyline') mid.push({ k: 'poly', pts: p.points, closed: p.closed, stroke: INK_SOFT, w: PEN_FINE });
          else if (p.type === 'rectangle')
            mid.push({ k: 'poly', pts: [p.p1, { x: p.p2.x, y: p.p1.y }, p.p2, { x: p.p1.x, y: p.p2.y }], closed: true, stroke: INK_SOFT, w: PEN_FINE });
          else if (p.type === 'circle') mid.push({ k: 'circle', c: p.center, r: p.radius, stroke: INK_SOFT, w: PEN_FINE });
          else if (p.type === 'arc') mid.push({ k: 'poly', pts: sampleArc(p.center, p.radius, p.startAngle, p.endAngle), closed: false, stroke: INK_SOFT, w: PEN_FINE });
        }
        break;
      }
      case 'text':
        text(top, e.position, e.text, Math.max(1.2, e.fontSize * mmPerIn), {
          align: e.alignment || 'left',
          rot: e.rotation || 0,
        });
        break;
      case 'leader':
        top.push({ k: 'poly', pts: [e.arrowPoint, e.kneePoint, e.landingPoint], closed: false, stroke: INK, w: PEN_HAIR });
        top.push({ k: 'circle', c: e.arrowPoint, r: paper(0.5), fill: INK, w: 0 });
        text(top, add(e.landingPoint, { x: e.landingPoint.x >= e.kneePoint.x ? paper(1) : -paper(1), y: paper(0.8) }), e.text, 2.0, {
          align: e.landingPoint.x >= e.kneePoint.x ? 'left' : 'right',
        });
        break;
      case 'tag':
        text(top, e.position, e.tagNumber, 2.2, { bold: true });
        break;
      case 'dimension': {
        const st: PrimStyle = { stroke: INK, w: PEN_HAIR };
        const dimType = e.dimType || 'aligned';
        const gap = paper(0.8);
        if (dimType === 'radius' || dimType === 'diameter') {
          const c = e.center || e.p1;
          const r = e.radius || dist(c, e.p2);
          const g = computeRadialDimGeometry(c, r, e.p2);
          top.push({ k: 'poly', pts: [g.arrowPoint, g.kneePoint, g.landingPoint], closed: false, ...st });
          const label = e.textOverride || (dimType === 'diameter' ? `Ø${formatLength(r * 2, units)}` : `R${formatLength(r, units)}`);
          text(top, add(g.landingPoint, { x: 0, y: -gap }), label, 2.0, { align: g.landingPoint.x >= g.kneePoint.x ? 'right' : 'left' });
          break;
        }
        if (dimType === 'angular' && e.center) {
          const r = e.radius || 24;
          const a0 = e.startAngle ?? 0;
          const a1 = e.endAngle ?? 90;
          const raw = (((a1 - a0) % 360) + 360) % 360;
          const pts = raw <= 180 ? sampleArc(e.center, r, a0, a1) : sampleArc(e.center, r, a1, a0);
          top.push({ k: 'poly', pts, closed: false, ...st });
          const sweep = e.sweepAngle ?? Math.min(raw, 360 - raw);
          text(top, pts[Math.floor(pts.length / 2)], e.textOverride || `${sweep.toFixed(1)}°`, 2.0);
          break;
        }
        let d1: Point;
        let d2: Point;
        let measured: number;
        if (dimType === 'linear') {
          const m = midpoint(e.p1, e.p2);
          const offPt = e.linearOrientation === 'vertical' ? { x: m.x + e.offset, y: m.y } : { x: m.x, y: m.y + e.offset };
          const g = computeLinearDimGeometry(e.p1, e.p2, offPt, e.linearOrientation);
          d1 = g.d1;
          d2 = g.d2;
          measured = g.measuredLength;
        } else {
          const n = perpLeft(normalize(sub(e.p2, e.p1)));
          d1 = add(e.p1, scale(n, e.offset));
          d2 = add(e.p2, scale(n, e.offset));
          measured = dist(e.p1, e.p2);
        }
        if (dist(d1, d2) < 1e-6) break;
        const dir = normalize(sub(d2, d1));
        const ov = paper(1.2);
        line(top, e.p1, add(d1, scale(normalize(sub(d1, e.p1)), dist(d1, e.p1) > 1e-6 ? ov : 0)), st);
        line(top, e.p2, add(d2, scale(normalize(sub(d2, e.p2)), dist(d2, e.p2) > 1e-6 ? ov : 0)), st);
        line(top, add(d1, scale(dir, -ov)), add(d2, scale(dir, ov)), st);
        tick(top, d1, dir);
        tick(top, d2, dir);
        const rot = readableRot(d1, d2);
        const up = perpLeft({ x: Math.cos((rot * Math.PI) / 180), y: Math.sin((rot * Math.PI) / 180) });
        // perpLeft of the reading direction points "up" on the page for readable text
        text(top, add(midpoint(d1, d2), scale(up, gap)), e.textOverride || formatLength(measured, units), 2.0, { rot });
        break;
      }
      default:
        break;
    }
  }

  // curtain-wall mullion ticks on top of the wall fill
  for (const w of levelWalls) {
    if (!w.curtain && w.wallTypeId !== 'wt-curtain') continue;
    if (!show(w)) continue;
    mid.push(...curtainWallPlanPrims(w));
  }
  // continuous wall contours (Revit-style cleanup: no seams at corners, T- or X-junctions)
  const shownWalls = levelWalls.filter((w) => show(w));
  const wallTop: PlanPrim[] = [];
  for (const h of joinHubs(shownWalls)) wallTop.push({ k: 'poly', pts: h.poly, closed: true, stroke: '#d6d3d1', fill: '#d6d3d1', w: 0.05 });
  for (const loop of joinedWallOutlines(shownWalls, levelOpenings)) wallTop.push({ k: 'poly', pts: loop, closed: true, stroke: INK, w: PEN_CUT });
  return [...under, ...mid, ...wallTop, ...top];
}

/** Curtain wall in plan: mullion squares at each vertical grid line along the wall. */
export function curtainWallPlanPrims(w: WallEntity): PlanPrim[] {
  const out: PlanPrim[] = [];
  const L = dist(w.start, w.end);
  if (L < 1) return out;
  const g = curtainOf(w);
  const n = Math.max(1, Math.round(L / Math.max(6, g.vSpacing)));
  const d = normalize(sub(w.end, w.start));
  const nrm = perpLeft(d);
  const half = Math.max(1.5, w.thickness / 2);
  const m = g.mullionSize;
  for (let i = 0; i <= n; i++) {
    const c = add(w.start, scale(d, (L * i) / n));
    const pts = [
      add(add(c, scale(d, -m / 2)), scale(nrm, half)),
      add(add(c, scale(d, m / 2)), scale(nrm, half)),
      add(add(c, scale(d, m / 2)), scale(nrm, -half)),
      add(add(c, scale(d, -m / 2)), scale(nrm, -half)),
    ];
    out.push({ k: 'poly', pts, closed: true, fill: g.mullionColor, stroke: INK, w: 0.13, id: w.id });
  }
  // glass line down the middle
  out.push({ k: 'poly', pts: [w.start, w.end], closed: false, stroke: '#0284c7', w: 0.18, id: w.id });
  return out;
}

const levelElev = (model: ArchModel, levelId?: string) => (model.levels || []).find((l) => l.id === (levelId || 'level-1'))?.elevation ?? 0;

/**
 * Plan symbols for roofs and facade elements (shared by the 2D canvas, the roof plan and sheets):
 *  - roof: dashed eave outline (above the cut plane), thin ridge / hip / valley lines,
 *          slope arrows with "4:12" labels; `roofPlan` = seen from above (solid outline, shaded faces)
 *  - skylight / dormer: dashed outlines on the roof
 *  - balcony: slab + railing line; railing: double line with posts
 */
export function buildRoofFacadePlanPrims(model: ArchModel, e: ArchEntity, mmPerIn: number, opts: { roofPlan?: boolean; color?: string } = {}): PlanPrim[] {
  const paper = (mm: number) => mm / Math.max(1e-6, mmPerIn);
  const out: PlanPrim[] = [];
  const ink = opts.color || INK;
  const id = e.id;
  const dash = opts.roofPlan ? undefined : [2.2, 1.1];
  if (e.type === 'roof') {
    if (e.polygon.length < 3) return out;
    const g = getRoofGeometry(e, levelElev(model, e.levelId));
    const mat = roofMaterialDef(e.material);
    if (opts.roofPlan) {
      for (const f of g.faces) {
        if (f.kind === 'gable') continue;
        // light from the north-west: faces looking that way are lighter
        const k = f.kind === 'flat' ? 1 : 0.86 + 0.14 * Math.max(0, -f.down.x * 0.6 - f.down.y * 0.8);
        // drafted roof plans use a light tint of the material so linework and labels stay legible
        out.push({ k: 'poly', pts: f.pts, closed: true, fill: shadeHex(mixWhite(mat.color, 0.62), k), stroke: ink, w: 0.13, id });
      }
    }
    out.push({ k: 'poly', pts: g.outline, closed: true, stroke: ink, w: opts.roofPlan ? 0.35 : 0.25, dash, id });
    for (const ln of g.lines) {
      if (ln.kind === 'eave') continue;
      if (ln.kind === 'rake') continue; // rakes lie on the outline
      out.push({ k: 'poly', pts: [ln.a, ln.b], closed: false, stroke: ink, w: ln.kind === 'break' ? 0.18 : 0.13, dash: ln.kind === 'break' ? [1.5, 0.8] : undefined, id });
    }
    if (g.style === 'flat') {
      if (e.parapetHeight && e.parapetHeight > 0) {
        const inner = offsetPolygon(g.footprint, -Math.min(6, Math.max(2, e.thickness / 2)));
        out.push({ k: 'poly', pts: inner, closed: true, stroke: ink, w: 0.13, dash, id });
      }
      const c = g.outline.reduce((a, p) => ({ x: a.x + p.x / g.outline.length, y: a.y + p.y / g.outline.length }), { x: 0, y: 0 });
      out.push({ k: 'text', p: c, text: 'FLAT ROOF', size: 2.0, align: 'center', rot: 0, color: ink, bold: true, id });
    } else {
      for (const ar of roofSlopeArrows(g)) {
        const L = paper(7);
        const tail = add(ar.at, scale(ar.dir, -L / 2));
        const tip = add(ar.at, scale(ar.dir, L / 2));
        const n = perpLeft(ar.dir);
        out.push({ k: 'poly', pts: [tail, tip], closed: false, stroke: ink, w: 0.18, id });
        out.push({ k: 'poly', pts: [add(tip, add(scale(ar.dir, -paper(1.4)), scale(n, paper(0.8)))), tip, add(tip, add(scale(ar.dir, -paper(1.4)), scale(n, -paper(0.8))))], closed: true, fill: ink, w: 0, id });
        let rot = (Math.atan2(ar.dir.y, ar.dir.x) * 180) / Math.PI;
        if (rot >= 90 - 1e-6) rot -= 180;
        if (rot < -90) rot += 180;
        out.push({ k: 'text', p: add(ar.at, scale(n, paper(1.8))), text: ar.label, size: opts.roofPlan ? 2.4 : 1.9, align: 'center', rot, color: ink, bold: true, id });
      }
    }
    return out;
  }
  if (e.type === 'skylight' || e.type === 'dormer') {
    const roof = model.entities.find((r): r is RoofEntity => r.type === 'roof' && r.id === e.roofId);
    if (!roof) return out;
    const g = getRoofGeometry(roof, levelElev(model, roof.levelId));
    if (e.type === 'skylight') {
      const o = skylightOutline(g, e);
      out.push({ k: 'poly', pts: o.plan, closed: true, fill: opts.roofPlan ? '#cfe3f3' : undefined, stroke: ink, w: 0.18, dash, id });
      out.push({ k: 'poly', pts: [o.plan[0], o.plan[2]], closed: false, stroke: ink, w: 0.1, dash, id });
      out.push({ k: 'poly', pts: [o.plan[1], o.plan[3]], closed: false, stroke: ink, w: 0.1, dash, id });
    } else {
      const dg = dormerGeometry(g, e);
      if (!dg) return out;
      out.push({ k: 'poly', pts: dg.plan, closed: true, fill: opts.roofPlan ? shadeHex(roofMaterialDef(roof.material).color, 1.2) : undefined, stroke: ink, w: 0.2, dash, id });
      const front = { x: (dg.front.a.x + dg.front.b.x) / 2, y: (dg.front.a.y + dg.front.b.y) / 2 };
      const back = { x: (dg.plan[2].x + dg.plan[3].x) / 2, y: (dg.plan[2].y + dg.plan[3].y) / 2 };
      out.push({ k: 'poly', pts: [front, back], closed: false, stroke: ink, w: 0.13, dash, id });
    }
    return out;
  }
  if (e.type === 'balcony') {
    const walls = model.entities.filter((w): w is WallEntity => w.type === 'wall' && (w.levelId || 'level-1') === (e.levelId || 'level-1'));
    const host = walls.find((w) => w.id === e.wallId);
    if (!host) return out;
    const bp = balconyPlan(host, e, walls);
    const above = e.elevationOffset > 48;
    out.push({ k: 'poly', pts: bp.slab, closed: true, fill: '#f5f5f4', stroke: ink, w: 0.25, dash: above ? [2.2, 1.1] : undefined, id });
    out.push({ k: 'poly', pts: bp.railing, closed: false, stroke: ink, w: 0.18, id });
    return out;
  }
  if (e.type === 'railing') {
    if (e.path.length < 2) return out;
    out.push({ k: 'poly', pts: e.path, closed: false, stroke: ink, w: 0.25, id });
    for (let i = 0; i + 1 < e.path.length; i++) {
      const a = e.path[i];
      const b = e.path[i + 1];
      const L = dist(a, b);
      const n = Math.max(1, Math.round(L / 48));
      for (let k = 0; k <= n; k++) {
        const c = add(a, scale(sub(b, a), k / n));
        out.push({ k: 'poly', pts: [add(c, { x: -1.5, y: -1.5 }), add(c, { x: 1.5, y: -1.5 }), add(c, { x: 1.5, y: 1.5 }), add(c, { x: -1.5, y: 1.5 })], closed: true, fill: ink, w: 0, id });
      }
    }
    return out;
  }
  return out;
}

/** Roof plan (view from above): every roof drawn solid with shaded faces, walls faint. */
export function buildRoofPlanPrimitives(model: ArchModel, mmPerIn: number): PlanPrim[] {
  const out: PlanPrim[] = [];
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  for (const w of walls) {
    const lw = walls.filter((x) => (x.levelId || 'level-1') === (w.levelId || 'level-1'));
    for (const poly of computeWallPlanPolygons(w, lw, [])) out.push({ k: 'poly', pts: poly, closed: true, stroke: '#a8a29e', w: 0.13, dash: [1.5, 1], id: w.id });
  }
  const roofs = model.entities.filter((e): e is RoofEntity => e.type === 'roof');
  const sorted = roofs.slice().sort((a, b) => levelElev(model, a.levelId) + (a.baseOffset ?? 0) - (levelElev(model, b.levelId) + (b.baseOffset ?? 0)));
  for (const r of sorted) out.push(...buildRoofFacadePlanPrims(model, r, mmPerIn, { roofPlan: true }));
  for (const e of model.entities) {
    if (e.type === 'skylight' || e.type === 'dormer') out.push(...buildRoofFacadePlanPrims(model, e, mmPerIn, { roofPlan: true }));
  }
  for (const r of sorted) {
    const g = getRoofGeometry(r, levelElev(model, r.levelId));
    const top = g.ridgeZ + g.thickness;
    const c = g.outline.reduce((a, p) => ({ x: a.x + p.x / g.outline.length, y: a.y + p.y / g.outline.length }), { x: 0, y: 0 });
    out.push({ k: 'text', p: add(c, { x: 0, y: mmPerIn > 0 ? 6 / mmPerIn : 24 }), text: `${roofMaterialDef(r.material).label.toUpperCase()} · TOP ${formatLength(top, model.settings.units)}`, size: 1.8, align: 'center', rot: 0, color: INK_SOFT, id: r.id });
  }
  return out;
}

const mixWhite = (hex: string, t: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const m = (v: number) => Math.round(v + (255 - v) * t);
  return `#${((1 << 24) | (m((n >> 16) & 255) << 16) | (m((n >> 8) & 255) << 8) | m(n & 255)).toString(16).slice(1)}`;
};

const shadeHex = (hex: string, k: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((1 << 24) | (c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
};

export interface PrimBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function primitiveBounds(prims: PlanPrim[]): PrimBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (p: Point, r = 0) => {
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  };
  for (const p of prims) {
    if (p.k === 'poly') p.pts.forEach((q) => eat(q));
    else if (p.k === 'circle') eat(p.c, p.r);
    else eat(p.p);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const PRIM_CACHE = new WeakMap<ArchModel, Map<string, { prims: PlanPrim[]; bounds: PrimBounds | null }>>();

/** Title bar height reserved at the bottom of every sheet viewport (paper mm). */
export const VIEWPORT_TITLE_BAR_MM = 8;

export interface PlanViewportTransform {
  mmPerIn: number; // exact scale requested on the viewport
  modelCenter: Point;
  contentBox: { x: number; y: number; w: number; h: number }; // paper mm, drawable area
  fits: boolean; // false => drawing is larger than the viewport at this scale (it gets clipped)
  requiredMm: { w: number; h: number }; // paper size the drawing needs at this scale
  prims: PlanPrim[];
  toPaper: (p: Point) => Point;
}

/**
 * Exact-scale transform for a plan viewport. The drawing is never silently shrunk: if it is
 * bigger than the viewport at the chosen scale it is clipped, and `fits` reports it so the UI
 * can warn and offer "Fit scale".
 */
export function computePlanViewportTransform(
  model: ArchModel,
  vp: SheetViewport,
  scaleRatio: number
): PlanViewportTransform {
  const mmPerIn = 25.4 * scaleRatio;
  const levelId = vp.levelId || model.activeLevelId || 'level-1';
  // Primitives depend only on (model, level, scale): cache per model object so dragging a
  // viewport around the sheet doesn't rebuild the plan on every mouse move.
  let perModel = PRIM_CACHE.get(model);
  if (!perModel) {
    perModel = new Map();
    PRIM_CACHE.set(model, perModel);
  }
  const key = `${vp.kind}|${vp.elevationDir || ''}|${vp.sectionId || ''}|${levelId}|${mmPerIn}`;
  let cached = perModel.get(key);
  if (!cached) {
    if (vp.kind === 'foundationplan' || vp.kind === 'framingplan') {
      const built = buildStructuralLevelPrims(model, levelId, mmPerIn, vp.kind === 'foundationplan' ? 'foundation' : 'framing');
      cached = { prims: built, bounds: primitiveBounds(built) };
    } else if (vp.kind === 'section') {
      const sec = model.entities.find((e): e is SectionEntity => e.type === 'section' && e.id === vp.sectionId) || model.entities.find((e): e is SectionEntity => e.type === 'section');
      const d = sec ? computeStructuralSection(model, sec, { mmPerIn }) : { prims: [] as PlanPrim[], bounds: { minX: 0, minY: -120, maxX: 240, maxY: 0 } };
      cached = { prims: d.prims, bounds: d.bounds };
    } else if (vp.kind === 'elevation') {
      // elevation bounds include label extents (level heads sit right of the drawing)
      const d = computeElevation(model, vp.elevationDir || 'south', { mmPerIn, shading: true, shadows: true, annotations: true });
      cached = { prims: d.prims, bounds: d.bounds };
    } else {
      const built = vp.kind === 'roofplan' ? buildRoofPlanPrimitives(model, mmPerIn) : buildPlanPrimitives(model, levelId, mmPerIn);
      cached = { prims: built, bounds: primitiveBounds(built) };
    }
    perModel.set(key, cached);
  }
  const prims = cached.prims;
  const b = cached.bounds || { minX: 0, minY: 0, maxX: 336, maxY: 216 };
  const contentBox = { x: vp.x, y: vp.y, w: vp.width, h: Math.max(4, vp.height - VIEWPORT_TITLE_BAR_MM) };
  const modelCenter = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const requiredMm = { w: (b.maxX - b.minX) * mmPerIn, h: (b.maxY - b.minY) * mmPerIn };
  const fits = requiredMm.w <= contentBox.w - 4 && requiredMm.h <= contentBox.h - 4;
  const cx = contentBox.x + contentBox.w / 2;
  const cy = contentBox.y + contentBox.h / 2;
  return {
    mmPerIn,
    modelCenter,
    contentBox,
    fits,
    requiredMm,
    prims,
    toPaper: (p: Point) => ({ x: cx + (p.x - modelCenter.x) * mmPerIn, y: cy + (p.y - modelCenter.y) * mmPerIn }),
  };
}

/**
 * Generates clipped hatch pattern segments inside a polygon for 2D & DXF export.
 */
export function computeHatchPatternLines(hatch: HatchEntity): Array<{ a: Point; b: Point }> {
  const poly = hatch.polygon;
  if (poly.length < 3) return [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const step = Math.max(4, 12 * (hatch.scale || 1));
  const baseAngle =
    hatch.pattern === 'diagonal' || hatch.pattern === 'crosshatch'
      ? (hatch.angle || 0) + 45
      : hatch.angle || 0;

  const generateFamily = (angleDeg: number): Array<{ a: Point; b: Point }> => {
    const segs: Array<{ a: Point; b: Point }> = [];
    const count = Math.min(80, Math.ceil(diag / step));
    for (let i = -count; i <= count; i++) {
      const offsetY = i * step;
      const p1 = rotatePoint({ x: cx - diag, y: cy + offsetY }, { x: cx, y: cy }, angleDeg);
      const p2 = rotatePoint({ x: cx + diag, y: cy + offsetY }, { x: cx, y: cy }, angleDeg);

      // Find intersections with polygon edges
      const hits: Point[] = [];
      for (let e = 0; e < poly.length; e++) {
        const a = poly[e];
        const b = poly[(e + 1) % poly.length];
        const inter = segmentIntersection(p1, p2, a, b);
        if (inter) hits.push(inter);
      }
      hits.sort((u, v) => dist(p1, u) - dist(p1, v));
      for (let k = 0; k + 1 < hits.length; k += 2) {
        if (dist(hits[k], hits[k + 1]) > 0.5) {
          segs.push({ a: hits[k], b: hits[k + 1] });
        }
      }
    }
    return segs;
  };

  if (hatch.pattern === 'crosshatch') {
    return [...generateFamily(baseAngle), ...generateFamily(baseAngle + 90)];
  }
  return generateFamily(baseAngle);
}
