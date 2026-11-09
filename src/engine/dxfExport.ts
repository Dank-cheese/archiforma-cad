/**
 * DXF export — AutoCAD R2000 (AC1015) ASCII DXF.
 *
 * Structure follows the minimum AutoCAD requires for R2000+ files (HEADER with $ACADVER and
 * $HANDSEED, CLASSES, the nine symbol tables, *Model_Space/*Paper_Space blocks, ENTITIES and an
 * OBJECTS section with the root dictionary + ACAD_GROUP), with a unique handle and owner on
 * every object.
 *
 * - One DXF LAYER per app layer (name, colour as nearest ACI, on/off, locked).
 * - Dimensions: native DIMENSION entities (aligned / horizontal / vertical) backed by their
 *   anonymous *D geometry block, so they render in every reader and stay editable in AutoCAD.
 *   Radius / diameter / angular dimensions are written as exploded lines + text.
 * - Hatches: native HATCH entities with a polyline boundary path and explicit pattern lines
 *   (or SOLID fill).
 * - Blocks: each used block definition is written once to the BLOCKS section and placed with
 *   INSERT (position, rotation, X/Y scale) — no duplicated exploded geometry.
 * - Units: imperial projects are written in inches ($INSUNITS 1, architectural $LUNITS),
 *   metric projects in millimetres ($INSUNITS 4).
 * - Levels: one level per file by default (a plan), or every level stacked at its elevation (Z).
 */
import {
  ArchEntity,
  ArchModel,
  BlockDefinition,
  DoorEntity,
  HatchEntity,
  Layer,
  Point,
  WallEntity,
} from '../types/model';
import {
  add,
  angleDegRaw,
  computeLinearDimGeometry,
  computeRadialDimGeometry,
  computeStairPlanGeometry,
  computeWallPlanPolygons,
  createStarterBlocks,
  createStarterLevels,
  dist,
  formatArea,
  formatLength,
  midpoint,
  normalize,
  perpLeft,
  polygonArea,
  scale,
  sub,
} from './geometry';
import { isEntityOnLevel, joinedWallOutlines, type PlanPrim } from './planPrimitives';
import { isHostedOpening, openingPlanSymbol, wallExtSign } from './openings';
import { computeElevation } from './facade';
import { buildStructuralPlanPrims } from './structurePlan';
import { STRUCTURAL_DISCLAIMER } from './structure';

export interface DxfExportOptions {
  /** Level to export (default: model.activeLevelId). Use 'all' to stack every level at its elevation. */
  levelId?: string | 'all';
  /** Also write the four exterior elevations as 2D linework, laid out below the plan (layers A-ELEV*). */
  includeElevations?: boolean;
}

// ---------------------------------------------------------------------------------------------
// AutoCAD Color Index helpers
// ---------------------------------------------------------------------------------------------

let ACI_RGB: Array<[number, number, number]> | null = null;

/** Builds the standard 256-colour AutoCAD palette (index 0 unused). */
function aciPalette(): Array<[number, number, number]> {
  if (ACI_RGB) return ACI_RGB;
  const pal: Array<[number, number, number]> = new Array(256).fill([0, 0, 0]);
  const base: Array<[number, number, number]> = [
    [0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255],
    [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192],
  ];
  base.forEach((c, i) => (pal[i] = c));
  const values = [1, 0.65, 0.5, 0.3, 0.15];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const sub10 = (i - 10) % 10;
    const v = values[Math.floor(sub10 / 2)];
    const s = sub10 % 2 === 0 ? 1 : 0.5;
    // HSV -> RGB
    const c = v * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v - c;
    const [r1, g1, b1] =
      hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    pal[i] = [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
  }
  [51, 91, 132, 173, 214, 255].forEach((g, k) => (pal[250 + k] = [g, g, g]));
  ACI_RGB = pal;
  return pal;
}

/** Nearest ACI (1..255) for a hex colour. Near-black maps to 7 (black/white), like AutoCAD. */
export function hexToNearestAci(hex: string): number {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h)) return 7;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (Math.max(r, g, b) < 70) return 7;
  const pal = aciPalette();
  let best = 7;
  let bestD = Infinity;
  for (let i = 1; i < 256; i++) {
    if (i === 7) continue;
    const [pr, pg, pb] = pal[i];
    const d = (pr - r) ** 2 * 0.3 + (pg - g) ** 2 * 0.59 + (pb - b) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function aciToHex(aci: number): string {
  const i = Math.abs(Math.round(aci));
  if (i < 1 || i > 255) return '#334155';
  if (i === 7) return '#1c1917';
  const [r, g, b] = aciPalette()[i];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---------------------------------------------------------------------------------------------
// Low-level writer
// ---------------------------------------------------------------------------------------------

/** AutoCAD-safe DXF symbol name (layers, blocks): no <>/\":;?*|=` characters. */
export function sanitizeDxfName(name: string, fallback = 'LAYER'): string {
  const s = String(name || '')
    .replace(/[<>/\\":;?*|=`,]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  return s || fallback;
}

/** Encodes text for DXF R2000: special symbols use %% codes, other non-ASCII uses \U+XXXX. */
export function encodeDxfText(s: string): string {
  let out = '';
  for (const ch of String(s ?? '').replace(/[\r\n]+/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    if (ch === 'Ø' || ch === 'ø' || ch === '⌀') out += '%%c';
    else if (ch === '°') out += '%%d';
    else if (ch === '±') out += '%%p';
    else if (cp < 32) out += ' ';
    else if (cp < 127) out += ch;
    else out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

const num = (v: number) => {
  if (!Number.isFinite(v)) return '0.0';
  const r = Math.round(v * 1e6) / 1e6;
  const s = String(r === 0 ? 0 : r);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

class DxfBuffer {
  out: string[] = [];
  g(code: number, value: string | number) {
    this.out.push(String(code), typeof value === 'number' ? (Number.isInteger(value) && code >= 60 && code < 100 ? String(value) : num(value)) : value);
  }
  int(code: number, value: number) {
    this.out.push(String(code), String(Math.round(value)));
  }
}

// ---------------------------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------------------------

export function exportModelToDXF(model: ArchModel, options: DxfExportOptions = {}): string {
  const metric = model.settings.units === 'metric';
  const f = metric ? 25.4 : 1; // model inches -> file units
  const levels = model.levels && model.levels.length > 0 ? model.levels : createStarterLevels();
  const levelSel = options.levelId ?? model.activeLevelId ?? levels[0]?.id ?? 'level-1';
  const elevOf = (levelId?: string) => {
    if (levelSel !== 'all') return 0;
    const lvl = levels.find((l) => l.id === (levelId || 'level-1'));
    return (lvl?.elevation || 0) * f;
  };

  // --- handles -----------------------------------------------------------------------------
  let nextHandle = 0x20;
  const H = () => (nextHandle++).toString(16).toUpperCase();
  const hTables = { VPORT: H(), LTYPE: H(), LAYER: H(), STYLE: H(), VIEW: H(), UCS: H(), APPID: H(), DIMSTYLE: H(), BLOCK_RECORD: H() };
  const hRootDict = H();
  const hGroupDict = H();
  const hMsBr = H();
  const hPsBr = H();

  // --- extents ------------------------------------------------------------------------------
  let exMinX = Infinity, exMinY = Infinity, exMaxX = -Infinity, exMaxY = -Infinity;
  const X = (x: number) => x * f;
  const Y = (y: number) => -y * f; // SVG Y-down -> CAD Y-up
  const track = (p: Point) => {
    const x = X(p.x);
    const y = Y(p.y);
    if (x < exMinX) exMinX = x;
    if (y < exMinY) exMinY = y;
    if (x > exMaxX) exMaxX = x;
    if (y > exMaxY) exMaxY = y;
  };

  // --- layers -------------------------------------------------------------------------------
  const layerRecords = new Map<string, { name: string; color: string; visible: boolean; locked: boolean }>();
  const layerNameByRef = new Map<string, string>();
  const registerLayer = (l: Layer) => {
    const name = sanitizeDxfName(l.name || l.id, 'LAYER');
    if (!layerRecords.has(name.toUpperCase())) {
      layerRecords.set(name.toUpperCase(), { name, color: l.color, visible: l.visible !== false, locked: !!l.locked });
    }
    layerNameByRef.set(l.id, name);
    layerNameByRef.set(l.name, name);
  };
  registerLayer({ id: '0', name: '0', color: '#ffffff', visible: true, locked: false });
  model.layers.forEach(registerLayer);
  registerLayer({ id: 'Defpoints', name: 'Defpoints', color: '#ffffff', visible: true, locked: false });
  const layerOf = (ref: string | undefined) => {
    const r = ref || '0';
    if (!layerNameByRef.has(r)) registerLayer({ id: r, name: r, color: '#44403c', visible: true, locked: false });
    return layerNameByRef.get(r)!;
  };

  // --- entity writers (into any buffer / owner) ----------------------------------------------
  const textH = (inches: number) => Math.max(0.05, inches) * f;

  const makeWriters = (buf: DxfBuffer, owner: string, z: number, doTrack: boolean) => {
    const head = (type: string, layer: string) => {
      buf.g(0, type);
      buf.g(5, H());
      buf.g(330, owner);
      buf.g(100, 'AcDbEntity');
      buf.g(8, layer);
    };
    const t = (p: Point) => doTrack && track(p);
    return {
      line(layer: string, a: Point, b: Point) {
        head('LINE', layer);
        buf.g(100, 'AcDbLine');
        buf.g(10, X(a.x)); buf.g(20, Y(a.y)); buf.g(30, z);
        buf.g(11, X(b.x)); buf.g(21, Y(b.y)); buf.g(31, z);
        t(a); t(b);
      },
      lwpoly(layer: string, pts: Point[], closed: boolean) {
        const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);
        if (closed && clean.length > 2 && dist(clean[0], clean[clean.length - 1]) < 1e-9) clean.pop();
        if (clean.length < 2) return;
        head('LWPOLYLINE', layer);
        buf.g(100, 'AcDbPolyline');
        buf.int(90, clean.length);
        buf.int(70, closed ? 1 : 0);
        if (z !== 0) buf.g(38, z);
        buf.g(43, 0);
        for (const p of clean) {
          buf.g(10, X(p.x)); buf.g(20, Y(p.y));
          t(p);
        }
      },
      circle(layer: string, c: Point, r: number) {
        head('CIRCLE', layer);
        buf.g(100, 'AcDbCircle');
        buf.g(10, X(c.x)); buf.g(20, Y(c.y)); buf.g(30, z);
        buf.g(40, r * f);
        t({ x: c.x - r, y: c.y - r }); t({ x: c.x + r, y: c.y + r });
      },
      /** Arc in this app's convention (SVG degrees, sweeping +angle from start to end). */
      arc(layer: string, c: Point, r: number, startDeg: number, endDeg: number) {
        head('ARC', layer);
        buf.g(100, 'AcDbCircle');
        buf.g(10, X(c.x)); buf.g(20, Y(c.y)); buf.g(30, z);
        buf.g(40, r * f);
        buf.g(100, 'AcDbArc');
        // Y flip turns the clockwise-on-screen sweep into CAD's counter-clockwise from -end to -start
        buf.g(50, (((-endDeg % 360) + 360) % 360));
        buf.g(51, (((-startDeg % 360) + 360) % 360));
        t({ x: c.x - r, y: c.y - r }); t({ x: c.x + r, y: c.y + r });
      },
      /** TEXT. rot = SVG degrees (clockwise); align = horizontal; middle = vertically centred on p. */
      text(layer: string, p: Point, heightIn: number, s: string, rot = 0, align: 'left' | 'center' | 'right' = 'left', middle = false) {
        if (!s) return;
        head('TEXT', layer);
        buf.g(100, 'AcDbText');
        buf.g(10, X(p.x)); buf.g(20, Y(p.y)); buf.g(30, z);
        buf.g(40, textH(heightIn));
        buf.g(1, encodeDxfText(s));
        const cadRot = (((-rot % 360) + 360) % 360);
        if (cadRot) buf.g(50, cadRot);
        buf.g(7, 'Standard');
        const h72 = align === 'center' ? 1 : align === 'right' ? 2 : 0;
        if (h72 || middle) {
          buf.int(72, h72);
          buf.g(11, X(p.x)); buf.g(21, Y(p.y)); buf.g(31, z);
        }
        buf.g(100, 'AcDbText');
        if (h72 || middle) buf.int(73, middle ? 2 : 0);
        t(p);
      },
      insert(layer: string, blockName: string, p: Point, sx: number, sy: number, rotDeg: number) {
        head('INSERT', layer);
        buf.g(100, 'AcDbBlockReference');
        buf.g(2, blockName);
        buf.g(10, X(p.x)); buf.g(20, Y(p.y)); buf.g(30, z);
        if (Math.abs(sx - 1) > 1e-9) buf.g(41, sx);
        if (Math.abs(sy - 1) > 1e-9) buf.g(42, sy);
        if (rotDeg) buf.g(50, (((rotDeg % 360) + 360) % 360));
        t(p);
      },
      hatch(layer: string, e: HatchEntity) {
        const pts = e.polygon.filter((p, i) => i === 0 || dist(p, e.polygon[i - 1]) > 1e-9);
        if (pts.length < 3) return;
        const solid = e.pattern === 'solid';
        head('HATCH', layer);
        buf.g(100, 'AcDbHatch');
        buf.g(10, 0); buf.g(20, 0); buf.g(30, z);
        buf.g(210, 0); buf.g(220, 0); buf.g(230, 1);
        buf.g(2, solid ? 'SOLID' : '_USER');
        buf.int(70, solid ? 1 : 0);
        buf.int(71, 0);
        buf.int(91, 1);
        // boundary path: external (1) + polyline (2) + outermost (16)
        buf.int(92, 1 | 2 | 16);
        buf.int(72, 0);
        buf.int(73, 1);
        buf.int(93, pts.length);
        for (const p of pts) {
          buf.g(10, X(p.x)); buf.g(20, Y(p.y));
          t(p);
        }
        buf.int(97, 0);
        buf.int(75, 0); // odd-parity (normal) hatch style
        buf.int(76, solid ? 1 : 0); // 1 = predefined (SOLID), 0 = user-defined lines
        if (!solid) {
          // Mirrors the in-app pattern (see computeHatchPatternLines): parallel lines every
          // max(4", 12" × scale), at 45° for diagonal/crosshatch, else at the hatch angle.
          const spacing = Math.max(4, 12 * (e.scale || 1)) * f;
          const svgAngle = e.pattern === 'diagonal' || e.pattern === 'crosshatch' ? (e.angle || 0) + 45 : e.angle || 0;
          const cadAngle = (((-svgAngle % 360) + 360) % 360);
          const families = e.pattern === 'crosshatch' ? [cadAngle, (cadAngle + 90) % 360] : [cadAngle];
          buf.g(52, cadAngle);
          buf.g(41, spacing);
          buf.int(77, e.pattern === 'crosshatch' ? 1 : 0);
          buf.int(78, families.length);
          for (const a of families) {
            const rad = (a * Math.PI) / 180;
            buf.g(53, a);
            buf.g(43, 0); buf.g(44, 0);
            buf.g(45, -Math.sin(rad) * spacing);
            buf.g(46, Math.cos(rad) * spacing);
            buf.int(79, 0);
          }
        }
        buf.int(98, 0);
      },
    };
  };

  // --- which entities ---------------------------------------------------------------------------
  const all = model.entities;
  const selected = all.filter((e) => levelSel === 'all' || isEntityOnLevel(e, levelSel));
  const walls = all.filter((e): e is WallEntity => e.type === 'wall');
  const wallsOnLevel = (lvl?: string) => walls.filter((w) => (w.levelId || 'level-1') === (lvl || 'level-1'));
  const doorsOnLevel = (lvl?: string) => model.entities.filter((d) => isHostedOpening(d) && (d.levelId || 'level-1') === (lvl || 'level-1'));

  // --- block definitions (only those used) ---------------------------------------------------------
  const blockDefs = model.blocks && model.blocks.length > 0 ? model.blocks : createStarterBlocks();
  const blockNameById = new Map<string, string>();
  const usedNames = new Set<string>();
  const blockSections: Array<{ name: string; br: string; flags: number; body: DxfBuffer }> = [];

  const defineBlock = (def: BlockDefinition): string => {
    if (blockNameById.has(def.id)) return blockNameById.get(def.id)!;
    let name = sanitizeDxfName(def.name || def.id, 'BLOCK').replace(/^\*+/, '');
    let n = 2;
    const base = name;
    while (usedNames.has(name.toUpperCase())) name = `${base}_${n++}`;
    usedNames.add(name.toUpperCase());
    const br = H();
    const body = new DxfBuffer();
    const w = makeWriters(body, br, 0, false);
    for (const prim of def.entities) {
      const lyr = layerOf(prim.layer || '0');
      if (prim.type === 'line') w.line(lyr, prim.start, prim.end);
      else if (prim.type === 'rectangle')
        w.lwpoly(lyr, [prim.p1, { x: prim.p2.x, y: prim.p1.y }, prim.p2, { x: prim.p1.x, y: prim.p2.y }], true);
      else if (prim.type === 'polyline') w.lwpoly(lyr, prim.points, prim.closed);
      else if (prim.type === 'circle') w.circle(lyr, prim.center, prim.radius);
      else if (prim.type === 'arc') w.arc(lyr, prim.center, prim.radius, prim.startAngle, prim.endAngle);
      else if (prim.type === 'text') w.text(lyr, prim.position, prim.fontSize, prim.text, prim.rotation || 0);
    }
    blockSections.push({ name, br, flags: 0, body });
    blockNameById.set(def.id, name);
    return name;
  };

  // --- ENTITIES ----------------------------------------------------------------------------------
  const ent = new DxfBuffer();
  const dimStyle = model.settings.dimStyle;
  const dimTextIn = dimStyle?.textHeight || 6;
  let dimBlockCount = 0;
  const units = model.settings.units;

  const wallOutlineLevelsDone = new Set<string>();
  for (const e of selected) {
    const z = elevOf(e.levelId);
    const w = makeWriters(ent, hMsBr, z, true);
    const layer = layerOf(e.layer);
    switch (e.type) {
      case 'line':
        w.line(layer, e.start, e.end);
        break;
      case 'polyline':
        w.lwpoly(layer, e.points, e.closed);
        break;
      case 'rectangle':
        w.lwpoly(layer, [e.p1, { x: e.p2.x, y: e.p1.y }, e.p2, { x: e.p1.x, y: e.p2.y }], true);
        break;
      case 'circle':
        w.circle(layer, e.center, e.radius);
        break;
      case 'arc':
        w.arc(layer, e.center, e.radius, e.startAngle, e.endAngle);
        break;
      case 'wall': {
        // curtain walls keep their own outline; other walls are written as merged join-group contours
        if (e.curtain || e.wallTypeId === 'wt-curtain') {
          for (const poly of computeWallPlanPolygons(e, wallsOnLevel(e.levelId), doorsOnLevel(e.levelId))) w.lwpoly(layer, poly, true);
          break;
        }
        const lvl = e.levelId || 'level-1';
        if (wallOutlineLevelsDone.has(lvl)) break;
        wallOutlineLevelsDone.add(lvl);
        const lw = wallsOnLevel(e.levelId).filter((x) => selected.includes(x));
        for (const loop of joinedWallOutlines(lw, doorsOnLevel(e.levelId))) w.lwpoly(layer, loop, true);
        break;
      }
      case 'door':
      case 'window':
      case 'wallopening': {
        const host = walls.find((h) => h.id === e.wallId);
        if (!host) break;
        // same symbol as screen / PDF: frame + glass at the depth position, leaf + swing, sills
        const sym = openingPlanSymbol(e, host, wallExtSign(host, wallsOnLevel(host.levelId)));
        for (const fr of sym.frames) w.lwpoly(layer, fr, true);
        for (const [a2, b2] of [...sym.lines, ...sym.thin]) w.line(layer, a2, b2);
        for (const d of sym.dashed) w.lwpoly(layer, d, false);
        break;
      }
      case 'room': {
        if (e.polygon.length < 3) break;
        w.lwpoly(layer, e.polygon, true);
        w.text(layer, e.labelPos, 9, e.name.toUpperCase(), 0, 'center', true);
        const sub2 = [e.mark, formatArea(polygonArea(e.polygon), units)].filter(Boolean).join('  ');
        w.text(layer, add(e.labelPos, { x: 0, y: 14 }), 6, sub2, 0, 'center', true);
        break;
      }
      case 'floor':
      case 'roof':
        if (e.polygon.length >= 3) w.lwpoly(layer, e.polygon, true);
        break;
      case 'stair': {
        const sg = computeStairPlanGeometry(e);
        w.lwpoly(layer, sg.outline, true);
        for (const r of sg.riserLines) w.line(layer, r.a, r.b);
        w.line(layer, sg.arrowShaft.a, sg.arrowShaft.b);
        w.lwpoly(layer, sg.arrowHead, false);
        w.text(layer, add(sg.arrowShaft.a, scale(normalize(sub(sg.arrowShaft.a, sg.arrowShaft.b)), 8)), 5, 'UP', 0, 'center', true);
        break;
      }
      case 'column': {
        if (e.shape === 'round') {
          w.circle(layer, e.position, e.width / 2);
        } else {
          const rad = ((e.rotation || 0) * Math.PI) / 180;
          const hw = e.width / 2;
          const hd = e.depth / 2;
          const rot = (p: Point) => ({
            x: e.position.x + p.x * Math.cos(rad) - p.y * Math.sin(rad),
            y: e.position.y + p.x * Math.sin(rad) + p.y * Math.cos(rad),
          });
          w.lwpoly(layer, [rot({ x: -hw, y: -hd }), rot({ x: hw, y: -hd }), rot({ x: hw, y: hd }), rot({ x: -hw, y: hd })], true);
        }
        break;
      }
      case 'grid': {
        w.line(layer, e.start, e.end);
        const d = normalize(sub(e.end, e.start));
        const r = 12;
        const ends: Point[] = [];
        if (e.showBubbleStart !== false) ends.push(add(e.start, scale(d, -r)));
        if (e.showBubbleEnd) ends.push(add(e.end, scale(d, r)));
        for (const c of ends) {
          w.circle(layer, c, r);
          w.text(layer, c, 10, e.label, 0, 'center', true);
        }
        break;
      }
      case 'text':
        w.text(layer, e.position, e.fontSize || 8, e.text, e.rotation || 0, e.alignment || 'left');
        break;
      case 'leader':
        w.lwpoly(layer, [e.arrowPoint, e.kneePoint, e.landingPoint], false);
        w.text(
          layer,
          add(e.landingPoint, { x: e.landingPoint.x >= e.kneePoint.x ? 2 : -2, y: 0 }),
          e.fontSize || 8,
          e.text,
          0,
          e.landingPoint.x >= e.kneePoint.x ? 'left' : 'right',
          true
        );
        break;
      case 'tag':
        w.text(layer, e.position, 7, e.tagNumber, 0, 'center', true);
        break;
      case 'hatch':
        w.hatch(layer, e);
        break;
      case 'block': {
        const def = blockDefs.find((b) => b.id === e.blockId);
        if (!def) break;
        const name = defineBlock(def);
        const sx = (Math.max(1, e.width) / Math.max(1, def.width)) * (e.scale || 1);
        const sy = (Math.max(1, e.depth) / Math.max(1, def.depth)) * (e.scale || 1);
        w.insert(layer, name, e.position, sx, sy, e.rotation || 0);
        track({ x: e.position.x - def.width * sx, y: e.position.y - def.depth * sy });
        track({ x: e.position.x + def.width * sx, y: e.position.y + def.depth * sy });
        break;
      }
      case 'dimension': {
        const dimType = e.dimType || 'aligned';
        if (dimType === 'radius' || dimType === 'diameter' || dimType === 'angular') {
          // exploded: leader/arc + text
          if (dimType === 'angular' && e.center) {
            const r = e.radius || 24;
            const a0 = e.startAngle ?? 0;
            const a1 = e.endAngle ?? 90;
            const raw = (((a1 - a0) % 360) + 360) % 360;
            const [s0, s1] = raw <= 180 ? [a0, a1] : [a1, a0];
            w.arc(layer, e.center, r, s0, s1);
            const midA = ((s0 + (raw <= 180 ? raw : 360 - raw) / 2) * Math.PI) / 180;
            const sweep = e.sweepAngle ?? Math.min(raw, 360 - raw);
            w.text(layer, { x: e.center.x + (r + dimTextIn) * Math.cos(midA), y: e.center.y + (r + dimTextIn) * Math.sin(midA) }, dimTextIn, e.textOverride || `${sweep.toFixed(1)}°`, 0, 'center', true);
          } else {
            const c = e.center || e.p1;
            const r = e.radius || dist(c, e.p2);
            const g = computeRadialDimGeometry(c, r, e.p2);
            w.lwpoly(layer, [g.arrowPoint, g.kneePoint, g.landingPoint], false);
            const label = e.textOverride || (dimType === 'diameter' ? `Ø${formatLength(r * 2, units)}` : `R${formatLength(r, units)}`);
            w.text(layer, add(g.landingPoint, { x: 0, y: -dimTextIn * 0.4 }), dimTextIn, label, 0, g.landingPoint.x >= g.kneePoint.x ? 'right' : 'left');
          }
          break;
        }
        // Aligned / linear: native DIMENSION + anonymous geometry block *Dn
        let d1: Point;
        let d2: Point;
        let measured: number;
        let rotatedAngle: number | null = null; // CAD degrees for rotated (linear) dims
        if (dimType === 'linear') {
          const m = midpoint(e.p1, e.p2);
          const offPt = e.linearOrientation === 'vertical' ? { x: m.x + e.offset, y: m.y } : { x: m.x, y: m.y + e.offset };
          const g = computeLinearDimGeometry(e.p1, e.p2, offPt, e.linearOrientation);
          d1 = g.d1;
          d2 = g.d2;
          measured = g.measuredLength;
          rotatedAngle = g.orientation === 'vertical' ? 90 : 0;
        } else {
          const n = perpLeft(normalize(sub(e.p2, e.p1)));
          d1 = add(e.p1, scale(n, e.offset));
          d2 = add(e.p2, scale(n, e.offset));
          measured = dist(e.p1, e.p2);
        }
        if (dist(d1, d2) < 1e-6) break;
        const label = e.textOverride || formatLength(measured, units);
        const dir = normalize(sub(d2, d1));
        let readAng = angleDegRaw(d1, d2);
        if (readAng > 90 && readAng <= 270) readAng -= 180;
        if (readAng > 270) readAng -= 360;
        const radR = (readAng * Math.PI) / 180;
        const up = perpLeft({ x: Math.cos(radR), y: Math.sin(radR) });
        const textPos = add(midpoint(d1, d2), scale(up, dimTextIn * 0.8));

        dimBlockCount++;
        const bname = `*D${dimBlockCount}`;
        const br = H();
        const body = new DxfBuffer();
        const bw = makeWriters(body, br, z, false);
        const ov = Math.max(1, dimTextIn * 0.25);
        const ext = (p: Point, d: Point) => {
          const v = sub(d, p);
          const L = Math.hypot(v.x, v.y);
          return L > 1e-6 ? add(d, scale(v, ov / L)) : d;
        };
        bw.line(layer, e.p1, ext(e.p1, d1));
        bw.line(layer, e.p2, ext(e.p2, d2));
        bw.line(layer, add(d1, scale(dir, -ov)), add(d2, scale(dir, ov)));
        const tk = normalize(add(dir, perpLeft(dir)));
        const th = Math.max(1.5, dimTextIn * 0.35);
        bw.line(layer, add(d1, scale(tk, -th)), add(d1, scale(tk, th)));
        bw.line(layer, add(d2, scale(tk, -th)), add(d2, scale(tk, th)));
        bw.text(layer, textPos, dimTextIn, label, readAng, 'center', true);
        blockSections.push({ name: bname, br, flags: 1, body });

        ent.g(0, 'DIMENSION');
        ent.g(5, H());
        ent.g(330, hMsBr);
        ent.g(100, 'AcDbEntity');
        ent.g(8, layer);
        ent.g(100, 'AcDbDimension');
        ent.g(2, bname);
        ent.g(10, X(d2.x)); ent.g(20, Y(d2.y)); ent.g(30, z);
        ent.g(11, X(textPos.x)); ent.g(21, Y(textPos.y)); ent.g(31, z);
        ent.int(70, (rotatedAngle === null ? 1 : 0) | 32);
        ent.g(1, encodeDxfText(label));
        ent.g(3, 'Standard');
        ent.g(100, 'AcDbAlignedDimension');
        ent.g(13, X(e.p1.x)); ent.g(23, Y(e.p1.y)); ent.g(33, z);
        ent.g(14, X(e.p2.x)); ent.g(24, Y(e.p2.y)); ent.g(34, z);
        if (rotatedAngle !== null) {
          ent.g(50, rotatedAngle);
          ent.g(100, 'AcDbRotatedDimension');
        }
        track(e.p1); track(e.p2); track(d1); track(d2);
        break;
      }
      default:
        break;
    }
  }

  // --- structure: columns (profiles), footings, beams, joists, joints, loads, sections as plan linework ----
  {
    const STRUCT = new Set(['column', 'footing', 'beam', 'beamsystem', 'sjoint', 'load', 'section', 'connection']);
    const mmPerIn = 25.4 / 48;
    let any = false;
    for (const e of selected) {
      if (!STRUCT.has(e.type)) continue;
      any = true;
      const z = elevOf(e.levelId);
      const w = makeWriters(ent, hMsBr, z, true);
      const layer = layerOf(e.layer);
      for (const pr of buildStructuralPlanPrims(model, e, mmPerIn, { mode: 'plan' })) {
        if (pr.k === 'text') {
          w.text(layer, pr.p, pr.size / mmPerIn, pr.text, pr.rot || 0, pr.align, true);
        } else if (pr.k === 'circle') {
          if (pr.stroke && pr.w > 0) w.circle(layer, pr.c, pr.r);
        } else if (pr.stroke && pr.w > 0 && pr.pts.length >= 2 && (pr.opacity === undefined || pr.opacity > 0)) {
          w.lwpoly(layer, pr.pts, !!pr.closed);
        }
      }
    }
    if (any || model.entities.some((e) => (e.type === 'floor' && (e.foundation || e.structural)) || (e.type === 'wall' && e.structural))) {
      registerLayer({ id: 'S-ANNO', name: 'S-ANNO', color: '#b91c1c', visible: true, locked: false });
      const w = makeWriters(ent, hMsBr, 0, false);
      const x0 = Number.isFinite(exMinX) ? exMinX / f : 0;
      const y0 = Number.isFinite(exMinY) ? -exMinY / f : 0;
      w.text('S-ANNO', { x: x0, y: y0 + 36 }, 4, `NOTE: ${STRUCTURAL_DISCLAIMER}`, 0, 'left', false);
    }
  }

  // --- elevations as 2D linework (laid out in a row below the plan) ------------------------------
  if (options.includeElevations) {
    registerLayer({ id: 'A-ELEV', name: 'A-ELEV', color: '#1c1917', visible: true, locked: false });
    registerLayer({ id: 'A-ELEV-HATC', name: 'A-ELEV-HATC', color: '#78716c', visible: true, locked: false });
    registerLayer({ id: 'A-ELEV-ANNO', name: 'A-ELEV-ANNO', color: '#b45309', visible: true, locked: false });
    const mmPerIn = 25.4 / 48; // annotation sized for 1/4" = 1'-0"
    const planMinX = Number.isFinite(exMinX) ? exMinX / f : 0;
    const planMaxY = Number.isFinite(exMinY) ? -exMinY / f : 0; // model Y (down) of the plan's bottom edge
    let cursorX = planMinX;
    const w = makeWriters(ent, hMsBr, 0, true);
    for (const dir of ['south', 'east', 'north', 'west'] as const) {
      const d = computeElevation(model, dir, { mmPerIn, shading: false, shadows: false, annotations: true, hatches: true });
      const b = d.bounds;
      if (!Number.isFinite(b.minX) || b.maxX - b.minX < 1) continue;
      const off = { x: cursorX - b.minX, y: planMaxY + 240 - b.minY };
      const T = (p: Point): Point => ({ x: p.x + off.x, y: p.y + off.y });
      for (const v of hiddenLineVectors(d.prims)) {
        if (v.kind === 'text') {
          const pr = v.prim;
          w.text('A-ELEV-ANNO', T(pr.p), pr.size / mmPerIn, pr.text, pr.rot || 0, pr.align, true);
        } else if (v.kind === 'circle') {
          w.circle(v.thin ? 'A-ELEV-HATC' : 'A-ELEV', T(v.c), v.r);
        } else {
          w.lwpoly(v.thin ? 'A-ELEV-HATC' : 'A-ELEV', v.pts.map(T), v.closed);
        }
      }
      const title = `${dir.toUpperCase()} ELEVATION`;
      w.text('A-ELEV-ANNO', { x: (b.minX + b.maxX) / 2 + off.x, y: b.maxY + off.y + 30 }, 9, title, 0, 'center', true);
      cursorX += b.maxX - b.minX + 120;
    }
  }

  // --- assemble -------------------------------------------------------------------------------
  const out = new DxfBuffer();
  if (!Number.isFinite(exMinX)) {
    exMinX = 0; exMinY = 0; exMaxX = 100; exMaxY = 100;
  }

  // HEADER (written last into the final array; $HANDSEED must exceed every handle)
  const tables = new DxfBuffer();
  const T = tables;
  const tableHead = (name: keyof typeof hTables, count: number) => {
    T.g(0, 'TABLE');
    T.g(2, name);
    T.g(5, hTables[name]);
    T.g(330, '0');
    T.g(100, 'AcDbSymbolTable');
    T.int(70, count);
  };
  const recHead = (type: string, table: keyof typeof hTables, sub2: string) => {
    T.g(0, type);
    if (type === 'DIMSTYLE') T.g(105, H());
    else T.g(5, H());
    T.g(330, hTables[table]);
    T.g(100, 'AcDbSymbolTableRecord');
    T.g(100, sub2);
  };

  T.g(0, 'SECTION');
  T.g(2, 'TABLES');

  // VPORT (*Active zoomed to extents)
  tableHead('VPORT', 1);
  recHead('VPORT', 'VPORT', 'AcDbViewportTableRecord');
  T.g(2, '*Active');
  T.int(70, 0);
  T.g(10, 0); T.g(20, 0); T.g(11, 1); T.g(21, 1);
  T.g(12, (exMinX + exMaxX) / 2); T.g(22, (exMinY + exMaxY) / 2);
  T.g(13, 0); T.g(23, 0); T.g(14, 1); T.g(24, 1); T.g(15, 1); T.g(25, 1);
  T.g(16, 0); T.g(26, 0); T.g(36, 1); T.g(17, 0); T.g(27, 0); T.g(37, 0);
  T.g(40, Math.max(1, (exMaxY - exMinY) * 1.15, ((exMaxX - exMinX) * 1.15) / 1.6));
  T.g(41, 1.6);
  T.g(42, 50); T.g(43, 0); T.g(44, 0); T.g(50, 0); T.g(51, 0);
  T.int(71, 0); T.int(72, 1000); T.int(73, 1); T.int(74, 3); T.int(75, 0); T.int(76, 0); T.int(77, 0); T.int(78, 0);
  T.g(0, 'ENDTAB');

  // LTYPE
  tableHead('LTYPE', 3);
  for (const lt of ['ByBlock', 'ByLayer', 'Continuous']) {
    recHead('LTYPE', 'LTYPE', 'AcDbLinetypeTableRecord');
    T.g(2, lt);
    T.int(70, 0);
    T.g(3, lt === 'Continuous' ? 'Solid line' : '');
    T.int(72, 65);
    T.int(73, 0);
    T.g(40, 0);
  }
  T.g(0, 'ENDTAB');

  // LAYER — one per app layer
  const layerList = Array.from(layerRecords.values());
  tableHead('LAYER', layerList.length);
  for (const l of layerList) {
    recHead('LAYER', 'LAYER', 'AcDbLayerTableRecord');
    T.g(2, l.name);
    T.int(70, l.locked ? 4 : 0);
    const aci = l.name === '0' || l.name === 'Defpoints' ? 7 : hexToNearestAci(l.color);
    T.int(62, l.visible ? aci : -aci);
    T.g(6, 'Continuous');
    if (l.name === 'Defpoints') T.int(290, 0);
    T.int(370, -3);
  }
  T.g(0, 'ENDTAB');

  // STYLE
  tableHead('STYLE', 1);
  recHead('STYLE', 'STYLE', 'AcDbTextStyleTableRecord');
  T.g(2, 'Standard');
  T.int(70, 0);
  T.g(40, 0); T.g(41, 1); T.g(50, 0);
  T.int(71, 0);
  T.g(42, 2.5);
  T.g(3, 'txt');
  T.g(4, '');
  T.g(0, 'ENDTAB');

  // VIEW, UCS (empty)
  tableHead('VIEW', 0);
  T.g(0, 'ENDTAB');
  tableHead('UCS', 0);
  T.g(0, 'ENDTAB');

  // APPID
  tableHead('APPID', 1);
  recHead('APPID', 'APPID', 'AcDbRegAppTableRecord');
  T.g(2, 'ACAD');
  T.int(70, 0);
  T.g(0, 'ENDTAB');

  // DIMSTYLE (Standard, sized for this drawing)
  T.g(0, 'TABLE');
  T.g(2, 'DIMSTYLE');
  T.g(5, hTables.DIMSTYLE);
  T.g(330, '0');
  T.g(100, 'AcDbSymbolTable');
  T.int(70, 1);
  T.g(100, 'AcDbDimStyleTable');
  recHead('DIMSTYLE', 'DIMSTYLE', 'AcDbDimStyleTableRecord');
  T.g(2, 'Standard');
  T.int(70, 0);
  T.g(41, dimTextIn * f * 0.5); // DIMASZ
  T.g(42, dimTextIn * f * 0.15); // DIMEXO
  T.g(44, dimTextIn * f * 0.25); // DIMEXE
  T.g(140, dimTextIn * f); // DIMTXT
  T.g(141, dimTextIn * f * 0.1); // DIMCEN
  T.g(142, dimTextIn * f * 0.35); // DIMTSZ (architectural ticks)
  T.g(147, dimTextIn * f * 0.25); // DIMGAP
  T.int(77, 1); // DIMTAD above
  T.int(278, 46); // decimal separator '.'
  T.int(277, metric ? 2 : 4); // DIMLUNIT: decimal / architectural
  T.int(271, 0); // DIMDEC
  T.g(0, 'ENDTAB');

  // BLOCK_RECORD
  const allBlocks = [
    { name: '*Model_Space', br: hMsBr, flags: 0, body: new DxfBuffer() },
    { name: '*Paper_Space', br: hPsBr, flags: 0, body: new DxfBuffer() },
    ...blockSections,
  ];
  tableHead('BLOCK_RECORD', allBlocks.length);
  for (const b of allBlocks) {
    T.g(0, 'BLOCK_RECORD');
    T.g(5, b.br);
    T.g(330, hTables.BLOCK_RECORD);
    T.g(100, 'AcDbSymbolTableRecord');
    T.g(100, 'AcDbBlockTableRecord');
    T.g(2, b.name);
  }
  T.g(0, 'ENDTAB');
  T.g(0, 'ENDSEC');

  // BLOCKS
  const B = new DxfBuffer();
  B.g(0, 'SECTION');
  B.g(2, 'BLOCKS');
  for (const b of allBlocks) {
    B.g(0, 'BLOCK');
    B.g(5, H());
    B.g(330, b.br);
    B.g(100, 'AcDbEntity');
    if (b.name === '*Paper_Space') B.int(67, 1);
    B.g(8, '0');
    B.g(100, 'AcDbBlockBegin');
    B.g(2, b.name);
    B.int(70, b.flags);
    B.g(10, 0); B.g(20, 0); B.g(30, 0);
    B.g(3, b.name);
    B.g(1, '');
    B.out.push(...b.body.out);
    B.g(0, 'ENDBLK');
    B.g(5, H());
    B.g(330, b.br);
    B.g(100, 'AcDbEntity');
    if (b.name === '*Paper_Space') B.int(67, 1);
    B.g(8, '0');
    B.g(100, 'AcDbBlockEnd');
  }
  B.g(0, 'ENDSEC');

  // OBJECTS
  const O = new DxfBuffer();
  O.g(0, 'SECTION');
  O.g(2, 'OBJECTS');
  O.g(0, 'DICTIONARY');
  O.g(5, hRootDict);
  O.g(330, '0');
  O.g(100, 'AcDbDictionary');
  O.int(281, 1);
  O.g(3, 'ACAD_GROUP');
  O.g(350, hGroupDict);
  O.g(0, 'DICTIONARY');
  O.g(5, hGroupDict);
  O.g(330, hRootDict);
  O.g(100, 'AcDbDictionary');
  O.int(281, 1);
  O.g(0, 'ENDSEC');

  // HEADER
  out.g(0, 'SECTION');
  out.g(2, 'HEADER');
  out.g(9, '$ACADVER'); out.g(1, 'AC1015');
  out.g(9, '$DWGCODEPAGE'); out.g(3, 'ANSI_1252');
  out.g(9, '$HANDSEED'); out.g(5, (nextHandle + 1).toString(16).toUpperCase());
  out.g(9, '$INSBASE'); out.g(10, 0); out.g(20, 0); out.g(30, 0);
  out.g(9, '$EXTMIN'); out.g(10, exMinX); out.g(20, exMinY); out.g(30, 0);
  out.g(9, '$EXTMAX'); out.g(10, exMaxX); out.g(20, exMaxY); out.g(30, 0);
  out.g(9, '$INSUNITS'); out.int(70, metric ? 4 : 1);
  out.g(9, '$MEASUREMENT'); out.int(70, metric ? 1 : 0);
  out.g(9, '$LUNITS'); out.int(70, metric ? 2 : 4);
  out.g(9, '$LUPREC'); out.int(70, metric ? 0 : 4);
  out.g(9, '$DIMSCALE'); out.g(40, 1);
  out.g(9, '$TEXTSTYLE'); out.g(7, 'Standard');
  out.g(9, '$CLAYER'); out.g(8, '0');
  out.g(0, 'ENDSEC');
  out.g(0, 'SECTION');
  out.g(2, 'CLASSES');
  out.g(0, 'ENDSEC');
  out.out.push(...tables.out, ...B.out);
  out.g(0, 'SECTION');
  out.g(2, 'ENTITIES');
  out.out.push(...ent.out);
  out.g(0, 'ENDSEC');
  out.out.push(...O.out);
  out.g(0, 'EOF');

  return out.out.join('\n') + '\n';
}

/** Model entity types the DXF exporter writes (useful for UI copy and tests). */
export const DXF_EXPORTED_TYPES: ArchEntity['type'][] = [
  'line', 'polyline', 'rectangle', 'circle', 'arc', 'wall', 'door', 'window', 'room', 'floor', 'roof',
  'stair', 'column', 'grid', 'text', 'leader', 'tag', 'hatch', 'block', 'dimension',
];


// ---------------------------------------------------------------------------------------------
// Hidden-line removal for painter's-algorithm drawings (elevations): a stroke is kept only where
// no opaque fill drawn after it covers it.
// ---------------------------------------------------------------------------------------------

type ElevVector =
  | { kind: 'text'; prim: Extract<PlanPrim, { k: 'text' }> }
  | { kind: 'circle'; c: Point; r: number; thin: boolean }
  | { kind: 'line'; pts: Point[]; closed: boolean; thin: boolean };

interface Occluder {
  pts: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

const strictlyInside = (p: Point, o: Occluder) =>
  p.x > o.minX && p.x < o.maxX && p.y > o.minY && p.y < o.maxY && pointInPoly(p, o.pts) && distToBoundary(p, o.pts) > 0.05;

/** Parts of segment a→b not covered by any occluder. */
function visibleParts(a: Point, b: Point, occ: Occluder[]): Array<[Point, Point]> {
  const sx0 = Math.min(a.x, b.x), sx1 = Math.max(a.x, b.x), sy0 = Math.min(a.y, b.y), sy1 = Math.max(a.y, b.y);
  const rel = occ.filter((o) => o.maxX > sx0 && o.minX < sx1 && o.maxY > sy0 && o.minY < sy1);
  if (!rel.length) return [[a, b]];
  const ts = [0, 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const o of rel) {
    for (let i = 0; i < o.pts.length; i++) {
      const p = o.pts[i];
      const q = o.pts[(i + 1) % o.pts.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: Array<[Point, Point]> = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const m = { x: a.x + dx * (t0 + t1) / 2, y: a.y + dy * (t0 + t1) / 2 };
    if (rel.some((o) => strictlyInside(m, o))) continue;
    const p0 = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const p1 = { x: a.x + dx * t1, y: a.y + dy * t1 };
    const last = out[out.length - 1];
    if (last && Math.hypot(last[1].x - p0.x, last[1].y - p0.y) < 1e-6) last[1] = p1;
    else out.push([p0, p1]);
  }
  return out;
}

export function hiddenLineVectors(prims: PlanPrim[]): ElevVector[] {
  const occ: Occluder[] = [];
  const out: ElevVector[] = [];
  for (let i = prims.length - 1; i >= 0; i--) {
    const pr = prims[i];
    if (pr.k === 'text') {
      out.push({ kind: 'text', prim: pr });
      continue;
    }
    const thin = pr.w < 0.2;
    if (pr.k === 'circle') {
      if (pr.stroke && pr.w > 0 && !occ.some((o) => strictlyInside(pr.c, o))) out.push({ kind: 'circle', c: pr.c, r: pr.r, thin });
      continue;
    }
    if (pr.stroke && pr.w > 0 && pr.pts.length >= 2) {
      const n = pr.pts.length;
      const segs = pr.closed ? n : n - 1;
      let run: Point[] = [];
      const group: ElevVector[] = [];
      const flush = () => {
        if (run.length >= 2) group.push({ kind: 'line', pts: run, closed: false, thin });
        run = [];
      };
      let allVisible = true;
      const pieces: Array<[Point, Point]> = [];
      for (let k = 0; k < segs; k++) {
        const parts = visibleParts(pr.pts[k], pr.pts[(k + 1) % n], occ);
        if (parts.length !== 1 || parts[0][0] !== pr.pts[k] || parts[0][1] !== pr.pts[(k + 1) % n]) allVisible = false;
        pieces.push(...parts);
      }
      if (allVisible) out.push({ kind: 'line', pts: pr.pts, closed: !!pr.closed, thin });
      else {
        for (const [p0, p1] of pieces) {
          const last = run[run.length - 1];
          if (last && Math.hypot(last.x - p0.x, last.y - p0.y) < 1e-6) run.push(p1);
          else {
            flush();
            run = [p0, p1];
          }
        }
        flush();
        out.push(...group.reverse()); // the whole list is reversed at the end
      }
    }
    if (pr.closed && pr.fill && (pr.opacity === undefined || pr.opacity >= 1) && pr.pts.length >= 3) {
      const xs = pr.pts.map((p) => p.x);
      const ys = pr.pts.map((p) => p.y);
      occ.push({ pts: pr.pts, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
    }
  }
  return out.reverse();
}
