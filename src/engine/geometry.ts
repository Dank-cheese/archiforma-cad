import { applyCameraGrip, cameraGrips, wedgePoints } from './camera';
import {
  ArchEntity,
  ArchModel,
  ArcEntity,
  BlockDefinition,
  BlockInstanceEntity,
  CircleEntity,
  ColumnEntity,
  ColumnType,
  DimensionEntity,
  DimensionType,
  DimStyleSettings,
  DoorEntity,
  DoorType,
  FloorEntity,
  FloorType,
  GridEntity,
  GripPoint,
  HatchEntity,
  HatchPattern,
  Layer,
  LeaderEntity,
  LevelDefinition,
  LineEntity,
  OsnapResult,
  OsnapType,
  Point,
  PolylineEntity,
  RectangleEntity,
  RoofEntity,
  RoomEntity,
  StairEntity,
  StarterComponentKind,
  TagEntity,
  TextEntity,
  UnitSystem,
  SmartGuideSettings,
  VisibilityCategory,
  VisibilitySettings,
  WallAssemblyLayer,
  WallEntity,
  WallFace,
  WallType,
  WindowEntity,
  WallOpeningEntity,
  WindowType,
} from '../types/model';
import { trimAt, extendAt } from './trimExtend';
import { createLibraryBlocks } from './componentLibrary';
import { joinedWallCorners, wallPlanPieces, wallEndCuts, cutStations, crossingCuts, wallFaces } from './wallJoins';
import {
  isHostedOpening,
  planCutGaps,
  openingSpan,
  layerBandsWithReturns,
  frameAcrossFromLocation,
  dragOpening,
  dragOpeningSide,
  copySelectionHosted,
  doorTypeFields,
  windowTypeFields,
  type HostedOpening,
} from './openings';
import {
  applyStairGripMove,
  computeStairPlanGeometry as computeMultiRunStairPlanGeometry,
  ensureStairRunsAndLandings,
  getRunEdgeGeometry,
  getStairGrips,
  mirrorStairEntity,
  moveStairEntity,
  rotateStairEntity,
  scaleStairEntity,
  syncStairFloorOpenings,
  type StairPlanGeometry2D,
} from './stairs';

export const INCH_TO_MM = 25.4;

export const DEFAULT_DIM_STYLE: DimStyleSettings = {
  textHeight: 8,
  arrowType: 'tick',
  precision: 1,
  baselineSpacing: 18,
  extensionOvershoot: 4,
  preferFace: 'auto',
};

// --- BASIC POINT & VECTOR MATH ---

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(v: Point, s: number): Point {
  return { x: v.x * s, y: v.y * s };
}

export function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function perpLeft(v: Point): Point {
  // In screen coordinates (Y down) or CAD coordinates, perpendicular vector (-y, x)
  return { x: -v.y, y: v.x };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Angle in degrees [0, 360).
 * Note: Our 2D world uses standard Cartesian math (+X right, +Y up in display readouts,
 * or consistent world coordinates where +X is East and +Y is South/North).
 * To make architectural coordinates intuitive on an SVG canvas AND match CAD polar angles:
 * Let's define world X = right (+East), world Y = down (+South on SVG),
 * and for angle display / polar input "@length<angle", 0° = right (+X), 90° = up (-Y in SVG).
 */
export function angleDegCad(from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = -(to.y - from.y); // +Y up for CAD polar angles
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function angleDegRaw(from: Point, to: Point): number {
  let deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function rotatePoint(p: Point, center: Point, angleDeg: number): Point {
  // Positive angle = counter-clockwise in CAD (+Y up -> -Y in SVG)
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

// --- UNIT FORMATTING & PARSING ---

export function formatLength(inches: number, units: UnitSystem): string {
  if (!Number.isFinite(inches)) return '0"';
  const sign = inches < 0 ? '-' : '';
  const absIn = Math.abs(inches);

  if (units === 'metric') {
    const mm = Math.round(absIn * INCH_TO_MM);
    return `${sign}${mm} mm`;
  }

  // Imperial: feet and inches (rounded to nearest 1/2" or 1" for clean architectural display)
  const roundedHalf = Math.round(absIn * 2) / 2;
  const feet = Math.floor(roundedHalf / 12);
  const remInches = roundedHalf - feet * 12;
  const wholeIn = Math.floor(remInches);
  const half = remInches - wholeIn >= 0.4;
  const inStr = half ? `${wholeIn} 1/2"` : `${wholeIn}"`;
  if (feet === 0) {
    return `${sign}${inStr}`;
  }
  return `${sign}${feet}'-${inStr}`;
}

export function formatArea(sqInches: number, units: UnitSystem): string {
  const absSqIn = Math.abs(sqInches);
  if (units === 'metric') {
    const sqMeters = (absSqIn * INCH_TO_MM * INCH_TO_MM) / 1_000_000;
    return `${sqMeters.toFixed(1)} m²`;
  }
  const sqFeet = absSqIn / 144;
  return `${Math.round(sqFeet)} sq ft`;
}

export function formatCoord(p: Point, units: UnitSystem): string {
  return `${formatLength(p.x, units)}, ${formatLength(-p.y, units)}`;
}

/**
 * Parses a length string into internal inches.
 * Supports:
 * - Architectural feet & inches: "12'-6\"", "12'6\"", "12'", "6\"", "12'-6.5\""
 * - Metric: "3000mm", "3m", or plain number when units === 'metric' (treated as mm)
 * - Imperial plain number: treated as inches (e.g. "120" -> 120"), or if suffixed with "'" -> feet
 */
export function parseLengthInput(raw: string, units: UnitSystem): number | null {
  const s = raw.trim();
  if (!s) return null;

  // Check explicit mm or m suffix
  const mmMatch = s.match(/^([+-]?\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return parseFloat(mmMatch[1]) / INCH_TO_MM;
  }
  const mMatch = s.match(/^([+-]?\d+(?:\.\d+)?)\s*m$/i);
  if (mMatch) {
    return (parseFloat(mMatch[1]) * 1000) / INCH_TO_MM;
  }

  // Inch part with optional fraction: 6, 6.5, 6 1/2, 1/2
  const INCH = '(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+)';
  const inchValue = (txt: string): number => {
    const parts = txt.trim().split(/\s+/);
    let total = 0;
    for (const part of parts) {
      const frac = part.match(/^(\d+)\/(\d+)$/);
      total += frac ? (Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : 0) : parseFloat(part);
    }
    return total;
  };

  // Check feet and inches e.g. 12'-6", 12' 6", 12'6, -5'-4", 9'-8 1/2"
  const ftInMatch = s.match(new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)'\\s*-?\\s*${INCH}?\\s*"?$`));
  if (ftInMatch) {
    const ft = parseFloat(ftInMatch[1]);
    const sign = ft < 0 || s.startsWith('-') ? -1 : 1;
    const inch = ftInMatch[2] ? inchValue(ftInMatch[2]) : 0;
    return sign * (Math.abs(ft) * 12 + inch);
  }

  // Check explicit inches e.g. 36", 30 1/2", 3/4"
  const inMatch = s.match(new RegExp(`^([+-]?)${INCH}\\s*"$`));
  if (inMatch) {
    return (inMatch[1] === '-' ? -1 : 1) * inchValue(inMatch[2]);
  }

  // Plain number
  const num = Number(s);
  if (!Number.isNaN(num)) {
    return units === 'metric' ? num / INCH_TO_MM : num;
  }

  return null;
}

/**
 * Parses command line point or distance input during an active drawing/editing tool:
 * - Absolute: "x,y" (e.g. "120,96" or "10',8'")
 * - Relative: "@dx,dy" (e.g. "@120,0" or "@10',0")
 * - Polar: "@length<angle" (e.g. "@144<90" or "@12'<0")
 * - Direct distance: "144" or "12'" or "12'-6\"" -> moves along current cursor direction from basePoint
 */
export function parseCoordinateInput(
  raw: string,
  basePoint: Point | null,
  cursorPoint: Point,
  units: UnitSystem,
  orthoEnabled: boolean
): Point | null {
  const s = raw.trim();
  if (!s) return null;

  // 1. Polar: @length<angle or length<angle
  const polarMatch = s.match(/^@?([^<]+)<([+-]?\d+(?:\.\d+)?)$/);
  if (polarMatch) {
    const len = parseLengthInput(polarMatch[1], units);
    const angleDeg = parseFloat(polarMatch[2]);
    if (len !== null && !Number.isNaN(angleDeg)) {
      const origin = basePoint ?? { x: 0, y: 0 };
      const rad = (angleDeg * Math.PI) / 180;
      return {
        x: origin.x + len * Math.cos(rad),
        y: origin.y - len * Math.sin(rad), // CAD +Y is up (-Y in SVG)
      };
    }
  }

  // 2. Relative Cartesian: @dx,dy
  if (s.startsWith('@') && s.includes(',')) {
    const parts = s.slice(1).split(',');
    if (parts.length === 2) {
      const dx = parseLengthInput(parts[0], units);
      const dy = parseLengthInput(parts[1], units);
      if (dx !== null && dy !== null) {
        const origin = basePoint ?? { x: 0, y: 0 };
        return {
          x: origin.x + dx,
          y: origin.y - dy, // CAD +dy is up (-Y in SVG)
        };
      }
    }
  }

  // 3. Absolute Cartesian: x,y
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2) {
      const x = parseLengthInput(parts[0], units);
      const y = parseLengthInput(parts[1], units);
      if (x !== null && y !== null) {
        return { x, y };
      }
    }
  }

  // 4. Direct distance along cursor direction from basePoint
  const len = parseLengthInput(s, units);
  if (len !== null && basePoint) {
    const target = orthoEnabled ? applyOrtho(basePoint, cursorPoint) : cursorPoint;
    const dir = normalize(sub(target, basePoint));
    return {
      x: basePoint.x + dir.x * len,
      y: basePoint.y + dir.y * len,
    };
  }

  return null;
}

// --- SNAPPING & CONSTRAINTS ---

export function applyGridSnap(p: Point, snapSize: number): Point {
  if (snapSize <= 0) return p;
  return {
    x: Math.round(p.x / snapSize) * snapSize,
    y: Math.round(p.y / snapSize) * snapSize,
  };
}

export function applyOrtho(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: to.x, y: from.y };
  }
  return { x: from.x, y: to.y };
}

// --- GEOMETRIC PROJECTIONS & INTERSECTIONS ---

export function projectPointOnSegment(p: Point, a: Point, b: Point): {
  point: Point;
  t: number;
  distance: number;
} {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq < 1e-9) {
    return { point: a, t: 0, distance: dist(p, a) };
  }
  const tRaw = dot(sub(p, a), ab) / lenSq;
  const t = Math.max(0, Math.min(1, tRaw));
  const proj = lerpPoint(a, b, t);
  return { point: proj, t, distance: dist(p, proj) };
}

export function projectPointOnLine(p: Point, a: Point, b: Point): {
  point: Point;
  t: number;
} {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq < 1e-9) return { point: a, t: 0 };
  const t = dot(sub(p, a), ab) / lenSq;
  return { point: lerpPoint(a, b, t), t };
}

export function segmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): Point | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-8) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;
  if (t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
    return {
      x: a1.x + t * r.x,
      y: a1.y + t * r.y,
    };
  }
  return null;
}

export function lineIntersectionInfinite(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): Point | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-7) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / rxs;
  return {
    x: a1.x + t * r.x,
    y: a1.y + t * r.y,
  };
}

/**
 * Computes circle passing through 3 non-collinear points (for 3-point Arc tool).
 */
export function circleFromThreePoints(
  p1: Point,
  p2: Point,
  p3: Point
): {
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
} | null {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-5) return null;

  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;

  const center = { x: ux, y: uy };
  const radius = dist(center, p1);

  const a1 = angleDegRaw(center, p1);
  const a2 = angleDegRaw(center, p2);
  const a3 = angleDegRaw(center, p3);

  // Determine whether going CCW (increasing angle in SVG) from a1 to a3 passes through a2
  const norm = (deg: number) => ((deg % 360) + 360) % 360;
  const span12 = norm(a2 - a1);
  const span13 = norm(a3 - a1);

  if (span12 <= span13) {
    return { center, radius, startAngle: a1, endAngle: a3 };
  } else {
    return { center, radius, startAngle: a3, endAngle: a1 };
  }
}

export function describeSvgArc(
  center: Point,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;
  const start = {
    x: center.x + radius * Math.cos(startRad),
    y: center.y + radius * Math.sin(startRad),
  };
  const end = {
    x: center.x + radius * Math.cos(endRad),
    y: center.y + radius * Math.sin(endRad),
  };
  const sweep = ((endAngleDeg - startAngleDeg) % 360 + 360) % 360;
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

// --- ENTITY SEGMENTS EXTRACTION (FOR OSNAP & INTERSECTIONS) ---

export interface Segment {
  a: Point;
  b: Point;
  entityId: string;
}

export function getEntitySegments(entity: ArchEntity): Segment[] {
  switch (entity.type) {
    case 'line':
    case 'wall':
      return [{ a: entity.start, b: entity.end, entityId: entity.id }];
    case 'polyline': {
      const segs: Segment[] = [];
      for (let i = 0; i < entity.points.length - 1; i++) {
        segs.push({ a: entity.points[i], b: entity.points[i + 1], entityId: entity.id });
      }
      if (entity.closed && entity.points.length > 2) {
        segs.push({
          a: entity.points[entity.points.length - 1],
          b: entity.points[0],
          entityId: entity.id,
        });
      }
      return segs;
    }
    case 'rectangle': {
      const { p1, p2 } = entity;
      const c1 = { x: p1.x, y: p1.y };
      const c2 = { x: p2.x, y: p1.y };
      const c3 = { x: p2.x, y: p2.y };
      const c4 = { x: p1.x, y: p2.y };
      return [
        { a: c1, b: c2, entityId: entity.id },
        { a: c2, b: c3, entityId: entity.id },
        { a: c3, b: c4, entityId: entity.id },
        { a: c4, b: c1, entityId: entity.id },
      ];
    }
    case 'block': {
      const hw = (entity.width * (entity.scale || 1)) / 2;
      const hd = (entity.depth * (entity.scale || 1)) / 2;
      const pos = entity.position;
      const rot = entity.rotation || 0;
      const c1 = rotatePoint({ x: pos.x - hw, y: pos.y - hd }, pos, rot);
      const c2 = rotatePoint({ x: pos.x + hw, y: pos.y - hd }, pos, rot);
      const c3 = rotatePoint({ x: pos.x + hw, y: pos.y + hd }, pos, rot);
      const c4 = rotatePoint({ x: pos.x - hw, y: pos.y + hd }, pos, rot);
      return [
        { a: c1, b: c2, entityId: entity.id },
        { a: c2, b: c3, entityId: entity.id },
        { a: c3, b: c4, entityId: entity.id },
        { a: c4, b: c1, entityId: entity.id },
      ];
    }
    case 'grid':
      return [{ a: entity.start, b: entity.end, entityId: entity.id }];
    case 'stair': {
      const { runs, landings } = ensureStairRunsAndLandings(entity);
      const segs: Segment[] = [];
      for (const r of runs) {
        const g = getRunEdgeGeometry(r);
        for (let i = 0; i < 4; i++) {
          segs.push({ a: g.outline[i], b: g.outline[(i + 1) % 4], entityId: entity.id });
        }
      }
      for (const l of landings) {
        for (let i = 0; i < l.polygon.length; i++) {
          segs.push({ a: l.polygon[i], b: l.polygon[(i + 1) % l.polygon.length], entityId: entity.id });
        }
      }
      return segs;
    }
    case 'railing': {
      const segs: Segment[] = [];
      for (let i = 0; i + 1 < entity.path.length; i++) segs.push({ a: entity.path[i], b: entity.path[i + 1], entityId: entity.id });
      return segs;
    }
    case 'floor':
    case 'roof': {
      const segs: Segment[] = [];
      for (let i = 0; i < entity.polygon.length; i++) {
        const j = (i + 1) % entity.polygon.length;
        segs.push({ a: entity.polygon[i], b: entity.polygon[j], entityId: entity.id });
      }
      return segs;
    }
    case 'column': {
      if (entity.shape === 'round') return [];
      const hw = entity.width / 2;
      const hd = entity.depth / 2;
      const pos = entity.position;
      const rot = entity.rotation || 0;
      const c1 = rotatePoint({ x: pos.x - hw, y: pos.y - hd }, pos, rot);
      const c2 = rotatePoint({ x: pos.x + hw, y: pos.y - hd }, pos, rot);
      const c3 = rotatePoint({ x: pos.x + hw, y: pos.y + hd }, pos, rot);
      const c4 = rotatePoint({ x: pos.x - hw, y: pos.y + hd }, pos, rot);
      return [
        { a: c1, b: c2, entityId: entity.id },
        { a: c2, b: c3, entityId: entity.id },
        { a: c3, b: c4, entityId: entity.id },
        { a: c4, b: c1, entityId: entity.id },
      ];
    }
    default:
      return [];
  }
}

// --- OBJECT SNAPS (OSNAP) ---

export const DEFAULT_ENABLED_OSNAPS: OsnapType[] = [
  'Endpoint',
  'Midpoint',
  'Center',
  'Intersection',
  'Perpendicular',
  'Quadrant',
  'Tangent',
  'Extension',
  'Nearest',
];

export function findBestOsnap(
  cursorWorld: Point,
  entities: ArchEntity[],
  layers: Layer[],
  toleranceWorld: number,
  referencePoint?: Point | null,
  enabledOsnaps: OsnapType[] = DEFAULT_ENABLED_OSNAPS
): OsnapResult | null {
  const isEnabled = (type: OsnapType) =>
    !enabledOsnaps || enabledOsnaps.includes(type);

  const visibleEntitySet = new Set(
    layers.filter((l) => l.visible).map((l) => l.id)
  );
  const activeEntities = entities.filter((e) => visibleEntitySet.has(e.layer));

  const candidates: Array<OsnapResult & { dist: number; priority: number }> = [];

  const addCandidate = (
    type: OsnapResult['type'],
    point: Point,
    priority: number,
    entityId?: string
  ) => {
    if (!isEnabled(type)) return;
    const d = dist(cursorWorld, point);
    if (d <= toleranceWorld) {
      candidates.push({ type, point, entityId, dist: d, priority });
    }
  };

  const nearbySegments: Segment[] = [];
  const checkIntersections = isEnabled('Intersection');
  const checkExtension = isEnabled('Extension');
  const checkNearest = isEnabled('Nearest');
  const checkPerp = Boolean(referencePoint && isEnabled('Perpendicular'));

  for (const e of activeEntities) {
    const segs = getEntitySegments(e);

    for (const seg of segs) {
      const minX = Math.min(seg.a.x, seg.b.x);
      const maxX = Math.max(seg.a.x, seg.b.x);
      const minY = Math.min(seg.a.y, seg.b.y);
      const maxY = Math.max(seg.a.y, seg.b.y);
      const inSegBBox =
        cursorWorld.x >= minX - toleranceWorld &&
        cursorWorld.x <= maxX + toleranceWorld &&
        cursorWorld.y >= minY - toleranceWorld &&
        cursorWorld.y <= maxY + toleranceWorld;

      if (checkIntersections && inSegBBox) {
        nearbySegments.push(seg);
      }

      // Endpoint (priority 1)
      if (
        Math.abs(cursorWorld.x - seg.a.x) <= toleranceWorld &&
        Math.abs(cursorWorld.y - seg.a.y) <= toleranceWorld
      ) {
        addCandidate('Endpoint', seg.a, 1, e.id);
      }
      if (
        Math.abs(cursorWorld.x - seg.b.x) <= toleranceWorld &&
        Math.abs(cursorWorld.y - seg.b.y) <= toleranceWorld
      ) {
        addCandidate('Endpoint', seg.b, 1, e.id);
      }

      // Midpoint (priority 2)
      const midX = (seg.a.x + seg.b.x) * 0.5;
      const midY = (seg.a.y + seg.b.y) * 0.5;
      if (
        Math.abs(cursorWorld.x - midX) <= toleranceWorld &&
        Math.abs(cursorWorld.y - midY) <= toleranceWorld
      ) {
        addCandidate('Midpoint', { x: midX, y: midY }, 2, e.id);
      }

      // Perpendicular (priority 2) when referencePoint exists
      if (checkPerp && referencePoint && inSegBBox) {
        const proj = projectPointOnSegment(referencePoint, seg.a, seg.b);
        if (proj.t > 0.02 && proj.t < 0.98) {
          addCandidate('Perpendicular', proj.point, 2, e.id);
        }
      }

      // Extension (priority 3) - collinear extension past endpoints
      if (
        checkExtension &&
        cursorWorld.x >= minX - 400 &&
        cursorWorld.x <= maxX + 400 &&
        cursorWorld.y >= minY - 400 &&
        cursorWorld.y <= maxY + 400
      ) {
        const lineLen = dist(seg.a, seg.b);
        if (lineLen > 1e-2) {
          const dir = normalize(sub(seg.b, seg.a));
          const v = sub(cursorWorld, seg.a);
          const tParam = dot(v, dir) / lineLen;
          if (tParam < -0.01 || tParam > 1.01) {
            const maxExtension = Math.max(360, lineLen * 3);
            const extensionDist =
              tParam < 0 ? -tParam * lineLen : (tParam - 1) * lineLen;
            if (extensionDist <= maxExtension) {
              const projPoint = add(seg.a, scale(dir, tParam * lineLen));
              if (dist(cursorWorld, projPoint) <= toleranceWorld) {
                addCandidate('Extension', projPoint, 3, e.id);
              }
            }
          }
        }
      }

      // Nearest (priority 4)
      if (checkNearest && inSegBBox) {
        const near = projectPointOnSegment(cursorWorld, seg.a, seg.b);
        addCandidate('Nearest', near.point, 4, e.id);
      }
    }

    if (e.type === 'circle' || e.type === 'arc') {
      const rBound = e.radius + toleranceWorld;
      if (
        Math.abs(cursorWorld.x - e.center.x) <= rBound ||
        Math.abs(cursorWorld.y - e.center.y) <= rBound ||
        referencePoint
      ) {
        // Center (priority 1)
        addCandidate('Center', e.center, 1, e.id);

        // Quadrants (priority 2)
        const cardinalAngles = [0, 90, 180, 270];
        const normDeg = (deg: number) => ((deg % 360) + 360) % 360;

        for (const ang of cardinalAngles) {
          let include = true;
          if (e.type === 'arc') {
            const s = normDeg(e.startAngle);
            const end = normDeg(e.endAngle);
            const sweep = normDeg(end - s);
            const cur = normDeg(ang - s);
            include = cur <= sweep;
          }
          if (include) {
            const rad = (ang * Math.PI) / 180;
            const quadPt = {
              x: e.center.x + e.radius * Math.cos(rad),
              y: e.center.y + e.radius * Math.sin(rad),
            };
            addCandidate('Quadrant', quadPt, 2, e.id);
          }
        }

        // Tangent (priority 2) when referencePoint exists and is outside circle
        if (referencePoint) {
          const dRef = dist(referencePoint, e.center);
          if (dRef > e.radius + 1e-3) {
            const beta = Math.acos(Math.min(1, e.radius / dRef));
            const phi = Math.atan2(
              referencePoint.y - e.center.y,
              referencePoint.x - e.center.x
            );
            const t1 = {
              x: e.center.x + e.radius * Math.cos(phi + beta),
              y: e.center.y + e.radius * Math.sin(phi + beta),
            };
            const t2 = {
              x: e.center.x + e.radius * Math.cos(phi - beta),
              y: e.center.y + e.radius * Math.sin(phi - beta),
            };
            addCandidate('Tangent', t1, 2, e.id);
            addCandidate('Tangent', t2, 2, e.id);
          }
        }

        if (e.type === 'arc') {
          const sRad = (e.startAngle * Math.PI) / 180;
          const eRad = (e.endAngle * Math.PI) / 180;
          addCandidate(
            'Endpoint',
            {
              x: e.center.x + e.radius * Math.cos(sRad),
              y: e.center.y + e.radius * Math.sin(sRad),
            },
            1,
            e.id
          );
          addCandidate(
            'Endpoint',
            {
              x: e.center.x + e.radius * Math.cos(eRad),
              y: e.center.y + e.radius * Math.sin(eRad),
            },
            1,
            e.id
          );
        }
      }
    }

    if (e.type === 'rectangle') {
      addCandidate('Center', midpoint(e.p1, e.p2), 2, e.id);
    }

    if (e.type === 'block' || e.type === 'column') {
      addCandidate('Center', e.position, 1, e.id);
    }

    if (e.type === 'dimension') {
      addCandidate('Endpoint', e.p1, 1, e.id);
      addCandidate('Endpoint', e.p2, 1, e.id);
    }
  }

  // Intersection (priority 1) - only among segments whose AABB is within toleranceWorld of cursorWorld
  for (let i = 0; i < nearbySegments.length; i++) {
    for (let j = i + 1; j < nearbySegments.length; j++) {
      const s1 = nearbySegments[i];
      const s2 = nearbySegments[j];
      if (
        dist(s1.a, s2.a) < 1e-4 ||
        dist(s1.a, s2.b) < 1e-4 ||
        dist(s1.b, s2.a) < 1e-4 ||
        dist(s1.b, s2.b) < 1e-4
      ) {
        continue;
      }
      const pt = segmentIntersection(s1.a, s1.b, s2.a, s2.b);
      if (pt) {
        addCandidate('Intersection', pt, 1, s1.entityId);
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort by priority first (if within 60% of tolerance), then by distance
  candidates.sort((a, b) => {
    if (a.priority !== b.priority && Math.abs(a.dist - b.dist) < toleranceWorld * 0.5) {
      return a.priority - b.priority;
    }
    return a.dist - b.dist;
  });

  const best = candidates[0];
  return {
    type: best.type,
    point: best.point,
    entityId: best.entityId,
  };
}

// --- WALL GEOMETRY, AUTO-JOIN CORNERS & DOOR/WINDOW OPENINGS ---

export function getWallOffsetVectors(wall: WallEntity): {
  dir: Point;
  normal: Point;
  leftOffset: number;
  rightOffset: number;
} {
  const dir = normalize(sub(wall.end, wall.start));
  const normal = perpLeft(dir); // left side of wall direction
  const t = wall.thickness;
  if (wall.justification === 'interior') {
    return { dir, normal, leftOffset: t, rightOffset: 0 };
  }
  if (wall.justification === 'exterior') {
    return { dir, normal, leftOffset: 0, rightOffset: t };
  }
  return { dir, normal, leftOffset: t / 2, rightOffset: t / 2 };
}

/**
 * Computes the 4-corner mitered polygon for a wall, automatically joining cleanly
 * with any other wall that shares its start or end point!
 */
export function computeWallCornersWithJoins(
  wall: WallEntity,
  allWalls: WallEntity[]
): [Point, Point, Point, Point] {
  // Revit-style cleanup (miter / butt / square-off / T trims / through walls / hubs): see wallJoins.ts
  return joinedWallCorners(wall, allWalls);
}

/**
 * Splits a wall into solid 2D polygons leaving clean gaps where its hosted openings (doors, windows,
 * wall openings) cut it in plan. Each piece is closed, so the cut is finished with jamb lines.
 */
export function computeWallPlanPolygons(
  wall: WallEntity,
  allWalls: WallEntity[],
  openings: ArchEntity[]
): Point[][] {
  if (dist(wall.start, wall.end) < 1) return [];
  const hosted = openings.filter((o): o is HostedOpening => isHostedOpening(o) && o.wallId === wall.id);
  // joined ends, opening gaps (square jambs) and X-crossing splits; pieces tile with their neighbours
  return wallPlanPieces(wall, allWalls, planCutGaps(wall, hosted));
}

// --- POLYGON & ROOM DETECTION MATH ---

export function polygonSignedArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

export function polygonArea(pts: Point[]): number {
  return Math.abs(polygonSignedArea(pts));
}

export function computePolygonAreaAndPerimeter(pts: Point[]): {
  area: number;
  perimeter: number;
} {
  if (pts.length < 3) {
    let perim = 0;
    for (let i = 0; i < pts.length - 1; i++) perim += dist(pts[i], pts[i + 1]);
    return { area: 0, perimeter: perim };
  }
  const area = polygonArea(pts);
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    perimeter += dist(pts[i], next);
  }
  return { area, perimeter };
}

export function computeEntityAreaAndPerimeter(entity: ArchEntity): {
  area: number;
  perimeter: number;
  description: string;
} {
  switch (entity.type) {
    case 'circle': {
      const area = Math.PI * entity.radius * entity.radius;
      const perimeter = 2 * Math.PI * entity.radius;
      return { area, perimeter, description: `Circle (R = ${entity.radius.toFixed(1)}")` };
    }
    case 'rectangle': {
      const w = Math.abs(entity.p2.x - entity.p1.x);
      const h = Math.abs(entity.p2.y - entity.p1.y);
      return {
        area: w * h,
        perimeter: 2 * (w + h),
        description: `Rectangle (${w.toFixed(1)}" × ${h.toFixed(1)}")`,
      };
    }
    case 'room': {
      const { area, perimeter } = computePolygonAreaAndPerimeter(entity.polygon);
      return { area, perimeter, description: `Room: ${entity.name}` };
    }
    case 'polyline': {
      let perim = 0;
      for (let i = 0; i < entity.points.length - 1; i++) {
        perim += dist(entity.points[i], entity.points[i + 1]);
      }
      if (entity.closed && entity.points.length > 2) {
        perim += dist(entity.points[entity.points.length - 1], entity.points[0]);
        const area = polygonArea(entity.points);
        return { area, perimeter: perim, description: `Closed Polyline (${entity.points.length} vertices)` };
      }
      return { area: 0, perimeter: perim, description: `Polyline (${entity.points.length} vertices, open)` };
    }
    case 'wall': {
      const length = dist(entity.start, entity.end);
      const area = length * entity.thickness;
      return {
        area,
        perimeter: 2 * (length + entity.thickness),
        description: `Wall footprint (${length.toFixed(1)}" × ${entity.thickness}")`,
      };
    }
    case 'line': {
      const length = dist(entity.start, entity.end);
      return { area: 0, perimeter: length, description: `Line (Length = ${length.toFixed(1)}")` };
    }
    case 'arc': {
      const sweep = ((entity.endAngle - entity.startAngle) % 360 + 360) % 360;
      const arcLength = ((sweep * Math.PI) / 180) * entity.radius;
      const sectorArea = (sweep / 360) * Math.PI * entity.radius * entity.radius;
      return {
        area: sectorArea,
        perimeter: arcLength,
        description: `Arc (R = ${entity.radius.toFixed(1)}", ${sweep.toFixed(1)}°)`,
      };
    }
    case 'block': {
      const w = entity.width * (entity.scale || 1);
      const d = entity.depth * (entity.scale || 1);
      return {
        area: w * d,
        perimeter: 2 * (w + d),
        description: `Component: ${entity.name} (${w.toFixed(1)}" × ${d.toFixed(1)}")`,
      };
    }
    case 'floor': {
      const { area, perimeter } = computePolygonAreaAndPerimeter(entity.polygon);
      return { area, perimeter, description: `Floor Slab (${entity.thickness}" thick)` };
    }
    case 'roof': {
      const { area, perimeter } = computePolygonAreaAndPerimeter(entity.polygon);
      return { area, perimeter, description: `Roof (${entity.roofStyle}, ${entity.slope}° slope)` };
    }
    case 'column': {
      if (entity.shape === 'round') {
        const r = entity.width / 2;
        return {
          area: Math.PI * r * r,
          perimeter: 2 * Math.PI * r,
          description: `Round Column (Ø${entity.width}")`,
        };
      }
      return {
        area: entity.width * entity.depth,
        perimeter: 2 * (entity.width + entity.depth),
        description: `Column (${entity.width}" × ${entity.depth}")`,
      };
    }
    case 'stair': {
      const runLen = dist(entity.start, entity.end);
      return {
        area: runLen * entity.width,
        perimeter: 2 * (runLen + entity.width),
        description: `Stair Run (${entity.numRisers} risers @ ${entity.riserHeight.toFixed(2)}")`,
      };
    }
    default:
      return { area: 0, perimeter: 0, description: entity.type };
  }
}

// --- POLAR TRACKING (F10) & OBJECT SNAP TRACKING / OTRACK (F11) ---

export interface PolarSnapResult {
  point: Point;
  angleDeg: number;
  distance: number;
  diffDeg: number;
}

export function computePolarSnap(
  referencePoint: Point,
  cursorWorld: Point,
  incrementDeg: number,
  toleranceDeg: number = 3.0
): PolarSnapResult | null {
  const d = dist(referencePoint, cursorWorld);
  if (d < 1e-3) return null;

  const rawAngle = angleDegCad(referencePoint, cursorWorld); // 0..360 CAD polar angle
  const step = Math.max(1, incrementDeg);
  const nearest = Math.round(rawAngle / step) * step;
  let diff = Math.abs(rawAngle - nearest);
  if (diff > 180) diff = 360 - diff;

  if (diff <= toleranceDeg) {
    const snappedAngleCad = ((nearest % 360) + 360) % 360;
    const diffRad = (diff * Math.PI) / 180;
    const projectedDist = d * Math.cos(diffRad);
    const snapRad = (snappedAngleCad * Math.PI) / 180;
    const snappedPoint = {
      x: referencePoint.x + projectedDist * Math.cos(snapRad),
      y: referencePoint.y - projectedDist * Math.sin(snapRad), // CAD +Y is up, SVG is down
    };
    return {
      point: snappedPoint,
      angleDeg: snappedAngleCad,
      distance: projectedDist,
      diffDeg: diff,
    };
  }

  return null;
}

export interface OsnapTrackingGuide {
  sourcePoint: Point;
  axis: 'horizontal' | 'vertical';
  line: { p1: Point; p2: Point };
}

export interface OsnapTrackingResult {
  point: Point;
  guides: OsnapTrackingGuide[];
}

/**
 * Legacy OTRACK API (horizontal/vertical alignment with a list of points). It is now a thin
 * wrapper over the smart-guide alignment core used by `inferCursor`, so there is one system.
 */
export function computeOsnapTracking(
  cursorWorld: Point,
  acquiredPoints: Point[],
  toleranceWorld: number,
  worldSpan: number = 2000
): OsnapTrackingResult | null {
  if (acquiredPoints.length === 0) return null;
  const { h, v } = findAlignmentSources(
    cursorWorld,
    acquiredPoints.map((p) => ({ p, current: false })),
    toleranceWorld
  );
  const guides: OsnapTrackingGuide[] = [];
  const point = { ...cursorWorld };
  if (h) {
    point.y = h.p.y;
    guides.push({
      sourcePoint: h.p,
      axis: 'horizontal',
      line: { p1: { x: Math.min(h.p.x, cursorWorld.x) - worldSpan, y: h.p.y }, p2: { x: Math.max(h.p.x, cursorWorld.x) + worldSpan, y: h.p.y } },
    });
  }
  if (v) {
    point.x = v.p.x;
    guides.push({
      sourcePoint: v.p,
      axis: 'vertical',
      line: { p1: { x: v.p.x, y: Math.min(v.p.y, cursorWorld.y) - worldSpan }, p2: { x: v.p.x, y: Math.max(v.p.y, cursorWorld.y) + worldSpan } },
    });
  }
  return guides.length ? { point, guides } : null;
}

// ============================================================================
// SMART ALIGNMENT GUIDES (TRACK / F11) — inference engine
// ============================================================================

export const DEFAULT_SMART_GUIDES: SmartGuideSettings = {
  alignment: true,
  extension: true,
  parallel: true,
  perpendicular: true,
  equalLength: true,
};

/** Screen-pixel tolerance for alignment / extension / intersection / equal length. */
export const SMART_GUIDE_TOL_PX = 10;
/** Angular tolerance for parallel / perpendicular (degrees). */
export const SMART_GUIDE_ANGLE_TOL_DEG = 2;

export interface InferenceSegment {
  id: string;
  a: Point;
  b: Point;
}

export type GuideKind = 'alignment' | 'extension' | 'parallel' | 'perpendicular' | 'equal';

/** A green dotted guide. `from`→`to` is what gets drawn; `origin` + `dir` is the infinite line it snaps along. */
export interface Guide {
  kind: GuideKind;
  from: Point;
  to: Point;
  origin: Point;
  dir: Point; // unit vector
  refSegmentId?: string;
}

export interface InferenceResult {
  point: Point;
  guides: Guide[]; // at most 2
  label?: string;
  equalTo?: string; // id of the segment whose length was matched
  /** Reference segments to highlight in green (parallel/perpendicular/equal-length source). */
  highlight: InferenceSegment[];
  /** Segments that get an "=" tick (matching segment + the new segment). */
  equalMarks: Array<{ a: Point; b: Point }>;
  /** True when any guide moved the cursor. */
  snapped: boolean;
}

export interface InferenceOptions {
  /** Existing segments to infer from (pass only those visible on screen). */
  segments: InferenceSegment[];
  /** Points already picked in the current command (last one is the segment start). */
  currentPoints: Point[];
  /** Screen pixels per world inch. */
  zoom: number;
  settings?: Partial<SmartGuideSettings>;
  /** Whether segment-based guides (parallel, perpendicular, equal length) apply to this command. */
  segmentGuides?: boolean;
  /** Shift-lock: keep the cursor on this guide line. */
  lockGuide?: Guide | null;
  /** Units for the equal-length label. */
  units?: UnitSystem;
}

interface AlignSource {
  p: Point;
  current: boolean;
}

/** Best horizontal and vertical alignment source within `tol` (shared by OTRACK and inferCursor). */
function findAlignmentSources(
  cursor: Point,
  sources: AlignSource[],
  tol: number
): { h: AlignSource | null; v: AlignSource | null } {
  let h: AlignSource | null = null;
  let hScore = Infinity;
  let v: AlignSource | null = null;
  let vScore = Infinity;
  const near = tol * 0.5;
  for (const s of sources) {
    const dx = Math.abs(cursor.x - s.p.x);
    const dy = Math.abs(cursor.y - s.p.y);
    if (dx < near && dy < near) continue; // sitting on the point: object snap's job
    // Score: offset first, then prefer points of the current command, then the nearest source
    const bias = s.current ? -1e-3 * tol : 0;
    if (dy <= tol) {
      const sc = dy + bias + 1e-6 * dx;
      if (sc < hScore) {
        hScore = sc;
        h = s;
      }
    }
    if (dx <= tol) {
      const sc = dx + bias + 1e-6 * dy;
      if (sc < vScore) {
        vScore = sc;
        v = s;
      }
    }
  }
  return { h, v };
}

const angDiff180 = (a: Point, b: Point): number => {
  // smallest angle between two directions, ignoring orientation (0..90)
  const c = Math.abs(a.x * b.x + a.y * b.y);
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
};

const projectOnLine = (p: Point, origin: Point, dir: Point): Point => {
  const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
};

const lineIntersection = (o1: Point, d1: Point, o2: Point, d2: Point): Point | null => {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < Math.sin((5 * Math.PI) / 180)) return null; // near-parallel
  const t = ((o2.x - o1.x) * d2.y - (o2.y - o1.y) * d2.x) / den;
  return { x: o1.x + d1.x * t, y: o1.y + d1.y * t };
};

const segDistance = (p: Point, a: Point, b: Point): number => {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  if (L2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
};

/**
 * Smart alignment guides: infers where the user means to click.
 *
 * Priority (object snaps are resolved by the caller before this runs):
 *   intersection of two guides > equal length + parallel > single alignment / extension guide
 *   > parallel / perpendicular (or equal length alone) > nothing (caller applies POLAR / ORTHO).
 * Tolerances are zoom-independent: 10 screen px for points/lines/lengths, 2° for angles.
 * Pure function — no React, no DOM.
 */
export function inferCursor(cursor: Point, opts: InferenceOptions): InferenceResult {
  const cfg: SmartGuideSettings = { ...DEFAULT_SMART_GUIDES, ...(opts.settings || {}) };
  const zoom = Math.max(1e-6, opts.zoom);
  const tol = SMART_GUIDE_TOL_PX / zoom;
  const units = opts.units || 'imperial';
  const pts = opts.currentPoints;
  const ref = pts.length > 0 ? pts[pts.length - 1] : null;
  const segGuides = opts.segmentGuides !== false && !!ref;

  // Segments of the current command (p0→p1, p1→p2, …) join the reference set
  const current: InferenceSegment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (dist(pts[i], pts[i + 1]) > 1e-6) current.push({ id: `current-${i}`, a: pts[i], b: pts[i + 1] });
  }
  const allSegs = [...opts.segments, ...current];
  const none: InferenceResult = { point: cursor, guides: [], highlight: [], equalMarks: [], snapped: false };

  const lineGuide = (kind: GuideKind, origin: Point, dir: Point, from: Point, at: Point, refSegmentId?: string): Guide => ({
    kind,
    origin,
    dir,
    from,
    to: at,
    refSegmentId,
  });
  const H = { x: 1, y: 0 };
  const V = { x: 0, y: 1 };

  // ---- Shift lock: stay on the locked guide; still allow crossing another alignment guide ----
  if (opts.lockGuide) {
    const lg = opts.lockGuide;
    let p = projectOnLine(cursor, lg.origin, lg.dir);
    const guides: Guide[] = [{ ...lg, to: p }];
    let label = 'Locked';
    if (cfg.alignment) {
      const sources: AlignSource[] = [
        ...allSegs.flatMap((s) => [{ p: s.a, current: false }, { p: s.b, current: false }, { p: midpoint(s.a, s.b), current: false }]),
        ...pts.map((q) => ({ p: q, current: true })),
      ];
      const { h, v } = findAlignmentSources(p, sources, tol);
      for (const [src, dir] of [[v, V], [h, H]] as const) {
        if (!src) continue;
        const x = lineIntersection(lg.origin, lg.dir, src.p, dir);
        if (x && dist(x, p) <= tol) {
          p = x;
          guides.push(lineGuide('alignment', src.p, dir, src.p, x));
          label = 'Locked · Aligned';
          break;
        }
      }
    }
    return { point: p, guides: guides.slice(0, 2), label, highlight: [], equalMarks: [], snapped: true };
  }

  // ---- 1. Line guides: alignment (H/V through endpoints & midpoints) and extensions ----
  type LG = { g: Guide; d: number; throughRef: boolean };
  const lineGuides: LG[] = [];
  if (cfg.alignment) {
    const sources: AlignSource[] = [];
    for (const s of allSegs) {
      sources.push({ p: s.a, current: s.id.startsWith('current-') }, { p: s.b, current: s.id.startsWith('current-') }, { p: midpoint(s.a, s.b), current: false });
    }
    for (const q of pts) sources.push({ p: q, current: true });
    const { h, v } = findAlignmentSources(cursor, sources, tol);
    if (h) {
      const at = { x: cursor.x, y: h.p.y };
      lineGuides.push({ g: lineGuide('alignment', h.p, H, h.p, at), d: Math.abs(cursor.y - h.p.y), throughRef: !!ref && dist(h.p, ref) < 1e-9 });
    }
    if (v) {
      const at = { x: v.p.x, y: cursor.y };
      lineGuides.push({ g: lineGuide('alignment', v.p, V, v.p, at), d: Math.abs(cursor.x - v.p.x), throughRef: !!ref && dist(v.p, ref) < 1e-9 });
    }
  }
  if (cfg.extension) {
    const maxBeyond = 600 / zoom; // continuation shown up to 600 px past the end
    const ext: LG[] = [];
    for (const s of allSegs) {
      const L = dist(s.a, s.b);
      if (L < 1e-6) continue;
      const dir = scale(sub(s.b, s.a), 1 / L);
      const t = (cursor.x - s.a.x) * dir.x + (cursor.y - s.a.y) * dir.y;
      let end: Point | null = null;
      if (t > L && t - L <= maxBeyond) end = s.b;
      else if (t < 0 && -t <= maxBeyond) end = s.a;
      if (!end) continue;
      const foot = { x: s.a.x + dir.x * t, y: s.a.y + dir.y * t };
      const d = dist(cursor, foot);
      if (d > tol) continue;
      // Pure horizontal/vertical extensions duplicate alignment from that endpoint; keep the
      // better label ("Extension") by replacing an identical alignment guide.
      const g = lineGuide('extension', end, dir, end, foot, s.id);
      const dup = lineGuides.findIndex((lg2) => lg2.g.kind === 'alignment' && angDiff180(lg2.g.dir, dir) < 0.01 && dist(lg2.g.origin, end!) < 1e-6);
      if (dup >= 0) {
        lineGuides[dup] = { g, d, throughRef: lineGuides[dup].throughRef };
        continue;
      }
      ext.push({ g, d, throughRef: !!ref && dist(ref, end) < 1e-9 });
    }
    ext.sort((a, b) => a.d - b.d);
    lineGuides.push(...ext.slice(0, 2));
  }

  // ---- 2. Intersection of two guides ----
  let bestX: { p: Point; a: LG; b: LG; d: number } | null = null;
  for (let i = 0; i < lineGuides.length; i++) {
    for (let j = i + 1; j < lineGuides.length; j++) {
      const a = lineGuides[i];
      const b = lineGuides[j];
      const x = lineIntersection(a.g.origin, a.g.dir, b.g.origin, b.g.dir);
      if (!x) continue;
      const d = dist(x, cursor);
      if (d <= tol * 1.5 && (!bestX || d < bestX.d)) bestX = { p: x, a, b, d };
    }
  }
  if (bestX) {
    const p = bestX.p;
    return {
      point: p,
      guides: [{ ...bestX.a.g, to: p }, { ...bestX.b.g, to: p }],
      label: bestX.a.g.kind === 'extension' || bestX.b.g.kind === 'extension' ? 'Intersection · Extension' : 'Intersection',
      highlight: [],
      equalMarks: [],
      snapped: true,
    };
  }

  // ---- Segment-based inference (needs a start point) ----
  const v0 = ref ? sub(cursor, ref) : { x: 0, y: 0 };
  const L0 = Math.hypot(v0.x, v0.y);
  const segOk = segGuides && L0 > tol;

  // Parallel / perpendicular angle snap
  type AS = { dir: Point; kind: 'parallel' | 'perpendicular'; seg: InferenceSegment; diff: number };
  let angleSnap: AS | null = null;
  if (segOk && (cfg.parallel || cfg.perpendicular)) {
    const u = scale(v0, 1 / L0);
    const lastId = current.length ? current[current.length - 1].id : '';
    for (const s of allSegs) {
      const L = dist(s.a, s.b);
      if (L < 1e-6) continue;
      const sd = scale(sub(s.b, s.a), 1 / L);
      const diff = angDiff180(u, sd);
      // the segment ending at the start point is only a perpendicular reference (parallel = collinear)
      if (cfg.parallel && diff <= SMART_GUIDE_ANGLE_TOL_DEG && s.id !== lastId) {
        const dir = u.x * sd.x + u.y * sd.y >= 0 ? sd : scale(sd, -1);
        if (!angleSnap || diff < angleSnap.diff - 1e-9 || (Math.abs(diff - angleSnap.diff) < 1e-9 && segDistance(cursor, s.a, s.b) < segDistance(cursor, angleSnap.seg.a, angleSnap.seg.b))) {
          angleSnap = { dir, kind: 'parallel', seg: s, diff };
        }
      }
      const pdiff = Math.abs(90 - diff);
      if (cfg.perpendicular && pdiff <= SMART_GUIDE_ANGLE_TOL_DEG) {
        const n = perpLeft(sd);
        const dir = u.x * n.x + u.y * n.y >= 0 ? n : scale(n, -1);
        if (!angleSnap || pdiff < angleSnap.diff - 1e-9) angleSnap = { dir, kind: 'perpendicular', seg: s, diff: pdiff };
      }
    }
    // Horizontal / vertical references are better expressed as alignment guides through the start point
    if (angleSnap && (angDiff180(angleSnap.dir, H) < 1e-6 || angDiff180(angleSnap.dir, V) < 1e-6) && lineGuides.some((lg) => lg.throughRef)) {
      angleSnap = null;
    }
  }

  // Equal length match along a given direction
  const equalAlong = (dir: Point): { seg: InferenceSegment; len: number } | null => {
    if (!ref || !cfg.equalLength) return null;
    const proj = (cursor.x - ref.x) * dir.x + (cursor.y - ref.y) * dir.y;
    if (proj <= tol) return null;
    const twoAgo = current.length >= 2 ? current[current.length - 2].id : '';
    let best: { seg: InferenceSegment; len: number; rank: number; d: number } | null = null;
    for (const s of allSegs) {
      const L = dist(s.a, s.b);
      if (L < 1e-6 || Math.abs(proj - L) * zoom > SMART_GUIDE_TOL_PX) continue;
      const sd = scale(sub(s.b, s.a), 1 / L);
      const rank = angDiff180(dir, sd) <= SMART_GUIDE_ANGLE_TOL_DEG ? 0 : s.id === twoAgo ? 1 : 2;
      const d = segDistance(cursor, s.a, s.b);
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { seg: s, len: L, rank, d };
    }
    return best ? { seg: best.seg, len: best.len } : null;
  };
  const eqLabel = (len: number) => `Equal length ${formatLength(len, units)}`;
  const eqResult = (dir: Point, m: { seg: InferenceSegment; len: number }, guides: Guide[], prefix: string, highlight: InferenceSegment[]): InferenceResult => {
    const p = add(ref!, scale(dir, m.len));
    return {
      point: p,
      guides: guides.map((g) => ({ ...g, to: g.kind === 'parallel' || g.kind === 'perpendicular' ? add(p, scale(dir, Math.min(m.len * 0.25, 40 / zoom))) : p })).slice(0, 2),
      label: `${prefix}${eqLabel(m.len)}`,
      equalTo: m.seg.id,
      highlight: [...highlight.filter((h) => h.id !== m.seg.id), m.seg],
      equalMarks: [{ a: m.seg.a, b: m.seg.b }, { a: ref!, b: p }],
      snapped: true,
    };
  };

  // ---- 3. Equal length + parallel / perpendicular (or + alignment through the start point) ----
  if (segOk && cfg.equalLength) {
    if (angleSnap) {
      const m = equalAlong(angleSnap.dir);
      if (m) {
        const g = lineGuide(angleSnap.kind, ref!, angleSnap.dir, ref!, cursor, angleSnap.seg.id);
        return eqResult(angleSnap.dir, m, [g], angleSnap.kind === 'parallel' ? 'Parallel · ' : 'Perpendicular · ', [angleSnap.seg]);
      }
    }
    const through = lineGuides.filter((lg) => lg.throughRef).sort((a, b) => a.d - b.d)[0];
    if (through) {
      const dir = (cursor.x - ref!.x) * through.g.dir.x + (cursor.y - ref!.y) * through.g.dir.y >= 0 ? through.g.dir : scale(through.g.dir, -1);
      const m = equalAlong(dir);
      if (m) return eqResult(dir, m, [through.g], through.g.kind === 'extension' ? 'Extension · ' : '', []);
    }
  }

  // ---- 4. Single alignment / extension guide ----
  if (lineGuides.length) {
    const lg = [...lineGuides].sort((a, b) => a.d - b.d)[0];
    const p = projectOnLine(cursor, lg.g.origin, lg.g.dir);
    return {
      point: p,
      guides: [{ ...lg.g, to: p }],
      label: lg.g.kind === 'extension' ? 'Extension' : 'Aligned',
      highlight: [],
      equalMarks: [],
      snapped: true,
    };
  }

  // ---- 5. Parallel / perpendicular alone, or equal length alone ----
  if (segOk && angleSnap) {
    const p = projectOnLine(cursor, ref!, angleSnap.dir);
    const beyond = add(p, scale(angleSnap.dir, 40 / zoom));
    return {
      point: p,
      guides: [lineGuide(angleSnap.kind, ref!, angleSnap.dir, ref!, beyond, angleSnap.seg.id)],
      label: angleSnap.kind === 'parallel' ? 'Parallel' : 'Perpendicular',
      highlight: [angleSnap.seg],
      equalMarks: [],
      snapped: true,
    };
  }
  if (segOk && cfg.equalLength) {
    const u = scale(v0, 1 / L0);
    const m = equalAlong(u);
    if (m) return eqResult(u, m, [], '', []);
  }

  return none;
}

/** Uniform-grid spatial index over segments, for fast "segments on screen" queries. */
export interface SegmentIndex {
  cell: number;
  cells: Map<string, InferenceSegment[]>;
  all: InferenceSegment[];
}

export function buildSegmentIndex(segments: InferenceSegment[], cell = 240): SegmentIndex {
  const cells = new Map<string, InferenceSegment[]>();
  for (const s of segments) {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell);
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell);
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) {
      // very long segment: keep in a catch-all bucket
      const k = 'big';
      (cells.get(k) || cells.set(k, []).get(k)!).push(s);
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        (cells.get(k) || cells.set(k, []).get(k)!).push(s);
      }
    }
  }
  return { cell, cells, all: segments };
}

/** Segments whose bounding box touches the world rectangle (deduplicated). */
export function querySegmentIndex(index: SegmentIndex, rect: { minX: number; minY: number; maxX: number; maxY: number }): InferenceSegment[] {
  const { cell, cells } = index;
  const x0 = Math.floor(rect.minX / cell);
  const x1 = Math.floor(rect.maxX / cell);
  const y0 = Math.floor(rect.minY / cell);
  const y1 = Math.floor(rect.maxY / cell);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size * 4) {
    return index.all.filter(
      (s) => Math.max(s.a.x, s.b.x) >= rect.minX && Math.min(s.a.x, s.b.x) <= rect.maxX && Math.max(s.a.y, s.b.y) >= rect.minY && Math.min(s.a.y, s.b.y) <= rect.maxY
    );
  }
  const seen = new Set<InferenceSegment>();
  const out: InferenceSegment[] = [];
  const take = (arr?: InferenceSegment[]) => {
    if (!arr) return;
    for (const s of arr) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (Math.max(s.a.x, s.b.x) >= rect.minX && Math.min(s.a.x, s.b.x) <= rect.maxX && Math.max(s.a.y, s.b.y) >= rect.minY && Math.min(s.a.y, s.b.y) <= rect.maxY) out.push(s);
    }
  };
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) take(cells.get(`${x},${y}`));
  take(cells.get('big'));
  return out;
}

/** Straight segments (walls, lines, polylines, rectangles) to infer from. */
export function getInferenceSegments(entities: ArchEntity[]): InferenceSegment[] {
  const out: InferenceSegment[] = [];
  for (const e of entities) {
    if (e.type !== 'wall' && e.type !== 'line' && e.type !== 'polyline' && e.type !== 'rectangle') continue;
    getEntitySegments(e).forEach((s, i) => out.push({ id: i === 0 && (e.type === 'wall' || e.type === 'line') ? e.id : `${e.id}#${i}`, a: s.a, b: s.b }));
  }
  return out;
}

export function polygonCentroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let area6 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const f = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    cx += (pts[i].x + pts[j].x) * f;
    cy += (pts[i].y + pts[j].y) * f;
    area6 += f;
  }
  if (Math.abs(area6) < 1e-5) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / pts.length, y: sum.y / pts.length };
  }
  return { x: cx / (3 * area6), y: cy / (3 * area6) };
}

export function isPointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Finds the smallest enclosed room polygon of walls containing `clickPoint`.
 * Splits walls at T-junctions and intersections, builds a planar half-edge graph,
 * extracts minimal interior cycles, and returns the cycle containing `clickPoint`!
 */
export function findEnclosedRoomAtPoint(
  clickPoint: Point,
  walls: WallEntity[]
): { polygon: Point[]; wallIds: string[] } | null {
  if (walls.length < 3) return null;
  const SNAP_TOL = 2.0; // merge vertices within 2 inches

  // 1. Collect split parameters `t` along each wall where other walls intersect or touch it
  const splitParams: Map<string, number[]> = new Map();
  for (const w of walls) {
    splitParams.set(w.id, [0, 1]);
  }

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const w1 = walls[i];
      const w2 = walls[j];
      const len1 = dist(w1.start, w1.end);
      const len2 = dist(w2.start, w2.end);
      if (len1 < 1 || len2 < 1) continue;

      // Segment intersection
      const inter = segmentIntersection(w1.start, w1.end, w2.start, w2.end);
      if (inter) {
        const t1 = dist(w1.start, inter) / len1;
        const t2 = dist(w2.start, inter) / len2;
        splitParams.get(w1.id)!.push(Math.max(0, Math.min(1, t1)));
        splitParams.get(w2.id)!.push(Math.max(0, Math.min(1, t2)));
      }

      // Also check T-junctions where an endpoint of one wall lies near the interior of another wall
      for (const ep of [w1.start, w1.end]) {
        const proj = projectPointOnSegment(ep, w2.start, w2.end);
        if (proj.distance <= SNAP_TOL) {
          splitParams.get(w2.id)!.push(proj.t);
        }
      }
      for (const ep of [w2.start, w2.end]) {
        const proj = projectPointOnSegment(ep, w1.start, w1.end);
        if (proj.distance <= SNAP_TOL) {
          splitParams.get(w1.id)!.push(proj.t);
        }
      }
    }
  }

  // 2. Build merged vertex list and undirected sub-edges
  const vertices: Point[] = [];
  const getVertexIndex = (pt: Point): number => {
    for (let i = 0; i < vertices.length; i++) {
      if (dist(vertices[i], pt) <= SNAP_TOL) {
        return i;
      }
    }
    vertices.push(pt);
    return vertices.length - 1;
  };

  interface HalfEdge {
    id: number;
    from: number;
    to: number;
    wallId: string;
    angle: number;
  }

  const halfEdges: HalfEdge[] = [];
  const outgoing: Map<number, HalfEdge[]> = new Map();

  const addHalfEdge = (from: number, to: number, wallId: string) => {
    if (from === to) return;
    const list = outgoing.get(from) ?? [];
    if (list.some((e) => e.to === to)) return;
    const pFrom = vertices[from];
    const pTo = vertices[to];
    const angle = Math.atan2(pTo.y - pFrom.y, pTo.x - pFrom.x);
    const he: HalfEdge = { id: halfEdges.length, from, to, wallId, angle };
    halfEdges.push(he);
    list.push(he);
    outgoing.set(from, list);
  };

  for (const w of walls) {
    const ts = splitParams
      .get(w.id)!
      .slice()
      .sort((a, b) => a - b);
    const uniqueTs: number[] = [];
    for (const t of ts) {
      if (uniqueTs.length === 0 || Math.abs(t - uniqueTs[uniqueTs.length - 1]) > 0.01) {
        uniqueTs.push(t);
      }
    }
    for (let k = 0; k < uniqueTs.length - 1; k++) {
      const pA = lerpPoint(w.start, w.end, uniqueTs[k]);
      const pB = lerpPoint(w.start, w.end, uniqueTs[k + 1]);
      const idxA = getVertexIndex(pA);
      const idxB = getVertexIndex(pB);
      addHalfEdge(idxA, idxB, w.id);
      addHalfEdge(idxB, idxA, w.id);
    }
  }

  // Sort outgoing edges around each vertex by angle
  for (const [, list] of outgoing) {
    list.sort((a, b) => a.angle - b.angle);
  }

  // 3. Traverse minimal faces using planar face traversal
  const visited = new Set<number>();
  const candidateRooms: Array<{ polygon: Point[]; wallIds: string[]; area: number }> = [];

  for (const startEdge of halfEdges) {
    if (visited.has(startEdge.id)) continue;

    const cycleEdges: HalfEdge[] = [];
    let curr: HalfEdge | undefined = startEdge;
    let safety = 0;

    while (curr && !visited.has(curr.id) && safety < 100) {
      visited.add(curr.id);
      cycleEdges.push(curr);
      safety++;

      const nextList = outgoing.get(curr.to);
      if (!nextList || nextList.length === 0) {
        curr = undefined;
        break;
      }

      // Find the reverse twin edge (curr.to -> curr.from)
      const twinIdx = nextList.findIndex((e) => e.to === curr!.from);
      if (twinIdx === -1) {
        curr = undefined;
        break;
      }

      // Pick the previous edge in angle order around `curr.to` for interior face
      const nextIdx = (twinIdx - 1 + nextList.length) % nextList.length;
      curr = nextList[nextIdx];
      if (curr.id === startEdge.id) {
        break;
      }
    }

    if (curr && curr.id === startEdge.id && cycleEdges.length >= 3) {
      const poly = cycleEdges.map((e) => vertices[e.from]);
      const signedArea = polygonSignedArea(poly);
      // Only keep interior faces (positive signed area in SVG Y-down coordinates)
      const absArea = Math.abs(signedArea);
      if (absArea > 144 && isPointInPolygon(clickPoint, poly)) {
        const wallIdSet = Array.from(new Set(cycleEdges.map((e) => e.wallId)));
        candidateRooms.push({
          polygon: poly,
          wallIds: wallIdSet,
          area: absArea,
        });
      }
    }
  }

  if (candidateRooms.length === 0) return null;
  candidateRooms.sort((a, b) => a.area - b.area);
  return {
    polygon: candidateRooms[0].polygon,
    wallIds: candidateRooms[0].wallIds,
  };
}

/**
 * Calculates wall faces: Centerline, Interior (-thickness/2), Exterior (+thickness/2).
 */
export function computeWallFaces(wall: WallEntity): {
  centerline: { start: Point; end: Point };
  interior: { start: Point; end: Point };
  exterior: { start: Point; end: Point };
} {
  const d = sub(wall.end, wall.start);
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-4) {
    return {
      centerline: { start: wall.start, end: wall.end },
      interior: { start: wall.start, end: wall.end },
      exterior: { start: wall.start, end: wall.end },
    };
  }
  const dir = { x: d.x / len, y: d.y / len };
  const norm = perpLeft(dir); // normal pointing left of the wall orientation
  const halfThick = wall.thickness / 2;

  return {
    centerline: { start: wall.start, end: wall.end },
    exterior: {
      start: add(wall.start, scale(norm, halfThick)),
      end: add(wall.end, scale(norm, halfThick)),
    },
    interior: {
      start: add(wall.start, scale(norm, -halfThick)),
      end: add(wall.end, scale(norm, -halfThick)),
    },
  };
}

/**
 * Finds the closest wall face (Interior, Centerline, Exterior) to a cursor point.
 */
export function findClosestWallFace(
  cursor: Point,
  wall: WallEntity,
  threshold = 36
): {
  face: WallFace;
  distance: number;
  pointOnFace: Point;
  wall: WallEntity;
} | null {
  const faces = computeWallFaces(wall);
  const cProj = projectPointOnSegment(cursor, faces.centerline.start, faces.centerline.end);
  const eProj = projectPointOnSegment(cursor, faces.exterior.start, faces.exterior.end);
  const iProj = projectPointOnSegment(cursor, faces.interior.start, faces.interior.end);

  const cDist = dist(cursor, cProj.point);
  const eDist = dist(cursor, eProj.point);
  const iDist = dist(cursor, iProj.point);

  let bestFace: WallFace = 'centerline';
  let bestDist = cDist;
  let bestPt = cProj.point;

  if (eDist < bestDist) {
    bestFace = 'exterior';
    bestDist = eDist;
    bestPt = eProj.point;
  }
  if (iDist < bestDist) {
    bestFace = 'interior';
    bestDist = iDist;
    bestPt = iProj.point;
  }

  if (bestDist <= threshold) {
    return {
      face: bestFace,
      distance: bestDist,
      pointOnFace: bestPt,
      wall,
    };
  }
  return null;
}

/**
 * Auto-detects the nearest wall face under cursor across all walls, supporting manual override.
 */
export function detectWallFaceUnderCursor(
  cursor: Point,
  walls: WallEntity[],
  threshold = 36,
  overrideFace: 'auto' | WallFace = 'auto'
): {
  face: WallFace;
  pointOnFace: Point;
  wall: WallEntity;
} | null {
  let best: { face: WallFace; distance: number; pointOnFace: Point; wall: WallEntity } | null = null;
  for (const w of walls) {
    const res = findClosestWallFace(cursor, w, threshold);
    if (res && (!best || res.distance < best.distance)) {
      best = res;
    }
  }
  if (!best) return null;

  if (overrideFace !== 'auto' && overrideFace !== best.face) {
    const faces = computeWallFaces(best.wall);
    const seg = faces[overrideFace];
    const proj = projectPointOnSegment(cursor, seg.start, seg.end);
    return {
      face: overrideFace,
      pointOnFace: proj.point,
      wall: best.wall,
    };
  }

  return {
    face: best.face,
    pointOnFace: best.pointOnFace,
    wall: best.wall,
  };
}

/**
 * Calculates linear dimension geometry (strictly horizontal or vertical).
 */
export function computeLinearDimGeometry(
  p1: Point,
  p2: Point,
  rawOffsetPoint: Point,
  forcedOrientation?: 'horizontal' | 'vertical'
): {
  orientation: 'horizontal' | 'vertical';
  d1: Point;
  d2: Point;
  offset: number;
  measuredLength: number;
} {
  const mid = midpoint(p1, p2);
  const dx = Math.abs(rawOffsetPoint.x - mid.x);
  const dy = Math.abs(rawOffsetPoint.y - mid.y);
  const orientation = forcedOrientation ?? (dy >= dx ? 'horizontal' : 'vertical');

  if (orientation === 'horizontal') {
    const y = rawOffsetPoint.y;
    return {
      orientation: 'horizontal',
      d1: { x: p1.x, y },
      d2: { x: p2.x, y },
      offset: y - mid.y,
      measuredLength: Math.abs(p2.x - p1.x),
    };
  } else {
    const x = rawOffsetPoint.x;
    return {
      orientation: 'vertical',
      d1: { x, y: p1.y },
      d2: { x, y: p2.y },
      offset: x - mid.x,
      measuredLength: Math.abs(p2.y - p1.y),
    };
  }
}

/**
 * Calculates angular dimension geometry between two rays/points from a center vertex.
 */
export function computeAngularDimGeometry(
  center: Point,
  p1: Point,
  p2: Point,
  offsetPoint?: Point
): {
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  radius: number;
} {
  const a1 = angleDegRaw(center, p1);
  const a2 = angleDegRaw(center, p2);
  let sweep = a2 - a1;
  while (sweep < 0) sweep += 360;
  if (sweep > 180) {
    sweep = 360 - sweep;
  }
  const r = offsetPoint ? dist(center, offsetPoint) : Math.max(24, Math.min(dist(center, p1), dist(center, p2)));
  return {
    startAngle: a1,
    endAngle: a2,
    sweepAngle: sweep,
    radius: Math.max(12, r),
  };
}

/**
 * Calculates radial dimension geometry for arc or circle.
 */
export function computeRadialDimGeometry(
  center: Point,
  radius: number,
  cursor: Point
): {
  arrowPoint: Point;
  kneePoint: Point;
  landingPoint: Point;
  label: string;
} {
  const ang = (angleDegRaw(center, cursor) * Math.PI) / 180;
  const arrowPoint: Point = {
    x: center.x + radius * Math.cos(ang),
    y: center.y + radius * Math.sin(ang),
  };
  const d = Math.max(radius + 18, dist(center, cursor));
  const kneePoint: Point = {
    x: center.x + d * Math.cos(ang),
    y: center.y + d * Math.sin(ang),
  };
  const isRight = kneePoint.x >= center.x;
  const landingPoint: Point = {
    x: kneePoint.x + (isRight ? 18 : -18),
    y: kneePoint.y,
  };
  return {
    arrowPoint,
    kneePoint,
    landingPoint,
    label: `R ${radius.toFixed(1)}"`,
  };
}

/**
 * Synchronizes associated dimensions with their target walls or lines.
 */
export function syncAssociatedDimensions(entities: ArchEntity[]): ArchEntity[] {
  const entityMap = new Map<string, ArchEntity>();
  for (const ent of entities) {
    entityMap.set(ent.id, ent);
  }

  return entities.map((ent) => {
    if (ent.type !== 'dimension' || !ent.association) return ent;
    const { entityId1, ref1, offsetParam1, entityId2, ref2, offsetParam2 } = ent.association;
    let newP1 = ent.p1;
    let newP2 = ent.p2;

    if (entityId1) {
      const e1 = entityMap.get(entityId1);
      if (e1 && e1.type === 'wall') {
        const faces = computeWallFaces(e1);
        const seg =
          ref1 === 'exterior'
            ? faces.exterior
            : ref1 === 'interior'
            ? faces.interior
            : faces.centerline;
        if (typeof offsetParam1 === 'number') {
          newP1 = lerpPoint(seg.start, seg.end, offsetParam1);
        } else if (ref1 === 'start') {
          newP1 = seg.start;
        } else if (ref1 === 'end') {
          newP1 = seg.end;
        } else {
          const proj = projectPointOnSegment(ent.p1, seg.start, seg.end);
          newP1 = proj.point;
        }
      } else if (e1 && e1.type === 'line') {
        if (ref1 === 'start') newP1 = e1.start;
        else if (ref1 === 'end') newP1 = e1.end;
      }
    }

    if (entityId2) {
      const e2 = entityMap.get(entityId2);
      if (e2 && e2.type === 'wall') {
        const faces = computeWallFaces(e2);
        const seg =
          ref2 === 'exterior'
            ? faces.exterior
            : ref2 === 'interior'
            ? faces.interior
            : faces.centerline;
        if (typeof offsetParam2 === 'number') {
          newP2 = lerpPoint(seg.start, seg.end, offsetParam2);
        } else if (ref2 === 'start') {
          newP2 = seg.start;
        } else if (ref2 === 'end') {
          newP2 = seg.end;
        } else {
          const proj = projectPointOnSegment(ent.p2, seg.start, seg.end);
          newP2 = proj.point;
        }
      } else if (e2 && e2.type === 'line') {
        if (ref2 === 'start') newP2 = e2.start;
        else if (ref2 === 'end') newP2 = e2.end;
      }
    }

    if (
      newP1.x !== ent.p1.x ||
      newP1.y !== ent.p1.y ||
      newP2.x !== ent.p2.x ||
      newP2.y !== ent.p2.y
    ) {
      return { ...ent, p1: newP1, p2: newP2 };
    }
    return ent;
  });
}

/**
 * Synchronizes category tags (doors, windows, rooms) to track host positions.
 */
export function syncAssociatedTags(entities: ArchEntity[]): ArchEntity[] {
  const wallMap = new Map<string, WallEntity>();
  const entityMap = new Map<string, ArchEntity>();
  for (const ent of entities) {
    entityMap.set(ent.id, ent);
    if (ent.type === 'wall') wallMap.set(ent.id, ent);
  }

  return entities.map((ent) => {
    if (ent.type !== 'tag') return ent;
    const target = entityMap.get(ent.targetId);
    if (!target) return ent;

    if (target.type === 'door' || target.type === 'window' || target.type === 'wallopening') {
      const host = wallMap.get(target.wallId);
      if (host) {
        const c = lerpPoint(host.start, host.end, target.offset);
        const dir = normalize(sub(host.end, host.start));
        const norm = perpLeft(dir);
        const tagPos = add(c, scale(norm, host.thickness / 2 + 14));
        return { ...ent, position: tagPos };
      }
    } else if (target.type === 'room') {
      const c = polygonCentroid(target.polygon);
      return { ...ent, position: c };
    }
    return ent;
  });
}

/**
 * Re-synchronizes hosted doors, windows, rooms, associated dimensions, and tags.
 */
export function syncHostedBimEntities(entities: ArchEntity[]): ArchEntity[] {
  const walls = entities.filter((e): e is WallEntity => e.type === 'wall');
  const wallMap = new Map(walls.map((w) => [w.id, w]));

  const baseSynchronized = entities
    .filter((e) => {
      // Hosted openings cannot exist without a wall. Deleting a wall asks first
      // ("Also delete N hosted doors/windows?"), so this only cleans up after that confirmation.
      if (e.type === 'door' || e.type === 'window' || e.type === 'wallopening') {
        return wallMap.has(e.wallId);
      }
      return true;
    })
    .map((e) => {
      if (e.type === 'room' && e.wallIds.length > 0) {
        // Attempt to re-detect enclosed room around current labelPos (or centroid)
        const probe = isPointInPolygon(e.labelPos, e.polygon)
          ? e.labelPos
          : polygonCentroid(e.polygon);
        const updated = findEnclosedRoomAtPoint(probe, walls);
        if (updated) {
          const newCentroid = polygonCentroid(updated.polygon);
          return {
            ...e,
            polygon: updated.polygon,
            wallIds: updated.wallIds,
            labelPos: newCentroid,
          };
        }
      }
      return e;
    });

  const withDims = syncAssociatedDimensions(baseSynchronized);
  const withTags = syncAssociatedTags(withDims);
  return syncStairFloorOpenings(withTags);
}

// --- GRIPS (FOR DIRECT CANVAS EDITING) ---

export function getEntityGrips(
  entity: ArchEntity,
  allEntities: ArchEntity[]
): GripPoint[] {
  switch (entity.type) {
    case 'line':
    case 'wall':
      return [
        { entityId: entity.id, gripIndex: 'start', point: entity.start, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'end', point: entity.end, kind: 'endpoint' },
        {
          entityId: entity.id,
          gripIndex: 'mid',
          point: midpoint(entity.start, entity.end),
          kind: 'midpoint',
        },
      ];
    case 'polyline':
      return entity.points.map((pt, idx) => ({
        entityId: entity.id,
        gripIndex: `vertex-${idx}`,
        point: pt,
        kind: 'endpoint',
      }));
    case 'rectangle': {
      const { p1, p2 } = entity;
      return [
        { entityId: entity.id, gripIndex: 'p1', point: p1, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'p2', point: p2, kind: 'endpoint' },
        {
          entityId: entity.id,
          gripIndex: 'p12',
          point: { x: p2.x, y: p1.y },
          kind: 'endpoint',
        },
        {
          entityId: entity.id,
          gripIndex: 'p21',
          point: { x: p1.x, y: p2.y },
          kind: 'endpoint',
        },
        {
          entityId: entity.id,
          gripIndex: 'center',
          point: midpoint(p1, p2),
          kind: 'center',
        },
      ];
    }
    case 'circle':
      return [
        { entityId: entity.id, gripIndex: 'center', point: entity.center, kind: 'center' },
        {
          entityId: entity.id,
          gripIndex: 'radius-e',
          point: { x: entity.center.x + entity.radius, y: entity.center.y },
          kind: 'endpoint',
        },
        {
          entityId: entity.id,
          gripIndex: 'radius-n',
          point: { x: entity.center.x, y: entity.center.y - entity.radius },
          kind: 'endpoint',
        },
      ];
    case 'arc': {
      const sRad = (entity.startAngle * Math.PI) / 180;
      const eRad = (entity.endAngle * Math.PI) / 180;
      return [
        { entityId: entity.id, gripIndex: 'center', point: entity.center, kind: 'center' },
        {
          entityId: entity.id,
          gripIndex: 'start',
          point: {
            x: entity.center.x + entity.radius * Math.cos(sRad),
            y: entity.center.y + entity.radius * Math.sin(sRad),
          },
          kind: 'endpoint',
        },
        {
          entityId: entity.id,
          gripIndex: 'end',
          point: {
            x: entity.center.x + entity.radius * Math.cos(eRad),
            y: entity.center.y + entity.radius * Math.sin(eRad),
          },
          kind: 'endpoint',
        },
      ];
    }
    case 'door':
    case 'window':
    case 'wallopening': {
      const host = allEntities.find(
        (w): w is WallEntity => w.type === 'wall' && w.id === entity.wallId
      );
      if (!host) return [];
      const pt = lerpPoint(host.start, host.end, entity.offset);
      const L = Math.max(1, dist(host.start, host.end));
      const sp = openingSpan(entity, L);
      return [
        { entityId: entity.id, gripIndex: 'offset', point: pt, kind: 'midpoint' },
        // jamb grips: drag a side to change the width (the other side stays put)
        { entityId: entity.id, gripIndex: 'side-min', point: lerpPoint(host.start, host.end, sp.s0 / L), kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'side-max', point: lerpPoint(host.start, host.end, sp.s1 / L), kind: 'endpoint' },
      ];
    }
    case 'dimension': {
      const dir = normalize(sub(entity.p2, entity.p1));
      const norm = perpLeft(dir);
      const mid = midpoint(entity.p1, entity.p2);
      const offsetPt = add(mid, scale(norm, entity.offset));
      return [
        { entityId: entity.id, gripIndex: 'p1', point: entity.p1, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'p2', point: entity.p2, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'offset', point: offsetPt, kind: 'midpoint' },
      ];
    }
    case 'text':
      return [
        { entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'endpoint' },
      ];
    case 'leader':
      return [
        { entityId: entity.id, gripIndex: 'arrow', point: entity.arrowPoint, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'knee', point: entity.kneePoint, kind: 'midpoint' },
        { entityId: entity.id, gripIndex: 'landing', point: entity.landingPoint, kind: 'endpoint' },
      ];
    case 'hatch':
      return entity.polygon.map((pt, idx) => ({
        entityId: entity.id,
        gripIndex: `vertex-${idx}`,
        point: pt,
        kind: 'endpoint',
      }));
    case 'tag':
      return [
        { entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'center' },
      ];
    case 'room':
      return [
        { entityId: entity.id, gripIndex: 'labelPos', point: entity.labelPos, kind: 'center' },
      ];
    case 'block': {
      const hw = (entity.width * (entity.scale || 1)) / 2;
      const hd = (entity.depth * (entity.scale || 1)) / 2;
      const cornerPt = rotatePoint(
        { x: entity.position.x + hw, y: entity.position.y + hd },
        entity.position,
        entity.rotation || 0
      );
      return [
        { entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'center' },
        { entityId: entity.id, gripIndex: 'corner', point: cornerPt, kind: 'endpoint' },
      ];
    }
    case 'floor':
      return entity.polygon.map((pt, idx) => ({
        entityId: entity.id,
        gripIndex: `vertex-${idx}`,
        point: pt,
        kind: 'endpoint',
      }));
    case 'roof': {
      const grips: GripPoint[] = entity.polygon.map((pt, idx) => ({
        entityId: entity.id,
        gripIndex: `vertex-${idx}`,
        point: pt,
        kind: 'endpoint' as const,
      }));
      if (entity.roofVersion === 2 && entity.polygon.length >= 3) {
        const h = roofHandles(entity);
        if (h.overhang) grips.push({ entityId: entity.id, gripIndex: 'overhang', point: h.overhang.point, kind: 'midpoint' });
        if (h.ridge) grips.push({ entityId: entity.id, gripIndex: 'ridge', point: h.ridge.point, kind: 'center' });
      }
      return grips;
    }
    case 'camera':
      return cameraGrips(entity).map((g) => ({ entityId: entity.id, gripIndex: g.gripIndex, point: g.point, kind: g.gripIndex === 'position' ? ('center' as const) : g.gripIndex === 'target' ? ('endpoint' as const) : ('midpoint' as const) }));
    case 'footing':
      return entity.columnId || entity.wallId ? [] : [{ entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'center' }];
    case 'beam':
    case 'sjoint':
    case 'section':
    case 'truss':
      return [
        { entityId: entity.id, gripIndex: 'start', point: entity.start, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'end', point: entity.end, kind: 'endpoint' },
      ];
    case 'beamsystem':
      return entity.boundary.map((pt, idx) => ({ entityId: entity.id, gripIndex: `vertex-${idx}`, point: pt, kind: 'endpoint' as const }));
    case 'load':
      return entity.points.map((pt, idx) => ({ entityId: entity.id, gripIndex: `vertex-${idx}`, point: pt, kind: 'endpoint' as const }));
    case 'skylight':
    case 'dormer':
      return [{ entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'center' }];
    case 'railing':
      return entity.path.map((pt, idx) => ({ entityId: entity.id, gripIndex: `vertex-${idx}`, point: pt, kind: 'endpoint' as const }));
    case 'stair':
      return getStairGrips(entity);
    case 'grid':
      return [
        { entityId: entity.id, gripIndex: 'start', point: entity.start, kind: 'endpoint' },
        { entityId: entity.id, gripIndex: 'end', point: entity.end, kind: 'endpoint' },
        {
          entityId: entity.id,
          gripIndex: 'mid',
          point: midpoint(entity.start, entity.end),
          kind: 'midpoint',
        },
      ];
    case 'column':
      return [
        { entityId: entity.id, gripIndex: 'position', point: entity.position, kind: 'center' },
      ];
  }
  return [];
}

export function applyGripMove(
  entity: ArchEntity,
  gripIndex: string,
  newPoint: Point,
  allEntities: ArchEntity[]
): ArchEntity {
  switch (entity.type) {
    case 'line':
    case 'wall': {
      if (gripIndex === 'start') return { ...entity, start: newPoint };
      if (gripIndex === 'end') return { ...entity, end: newPoint };
      if (gripIndex === 'mid') {
        const oldMid = midpoint(entity.start, entity.end);
        const delta = sub(newPoint, oldMid);
        return {
          ...entity,
          start: add(entity.start, delta),
          end: add(entity.end, delta),
        };
      }
      return entity;
    }
    case 'polyline': {
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        const pts = entity.points.map((p, i) => (i === idx ? newPoint : p));
        return { ...entity, points: pts };
      }
      return entity;
    }
    case 'rectangle': {
      if (gripIndex === 'p1') return { ...entity, p1: newPoint };
      if (gripIndex === 'p2') return { ...entity, p2: newPoint };
      if (gripIndex === 'p12') {
        return {
          ...entity,
          p1: { x: entity.p1.x, y: newPoint.y },
          p2: { x: newPoint.x, y: entity.p2.y },
        };
      }
      if (gripIndex === 'p21') {
        return {
          ...entity,
          p1: { x: newPoint.x, y: entity.p1.y },
          p2: { x: entity.p2.x, y: newPoint.y },
        };
      }
      if (gripIndex === 'center') {
        const oldCenter = midpoint(entity.p1, entity.p2);
        const delta = sub(newPoint, oldCenter);
        return {
          ...entity,
          p1: add(entity.p1, delta),
          p2: add(entity.p2, delta),
        };
      }
      return entity;
    }
    case 'circle': {
      if (gripIndex === 'center') return { ...entity, center: newPoint };
      if (gripIndex.startsWith('radius')) {
        return { ...entity, radius: Math.max(2, dist(entity.center, newPoint)) };
      }
      return entity;
    }
    case 'arc': {
      if (gripIndex === 'center') return { ...entity, center: newPoint };
      if (gripIndex === 'start') {
        return { ...entity, startAngle: angleDegRaw(entity.center, newPoint) };
      }
      if (gripIndex === 'end') {
        return { ...entity, endAngle: angleDegRaw(entity.center, newPoint) };
      }
      return entity;
    }
    case 'door':
    case 'window':
    case 'wallopening': {
      const host = allEntities.find(
        (w): w is WallEntity => w.type === 'wall' && w.id === entity.wallId
      );
      if (!host) return entity;
      if (gripIndex === 'side-min' || gripIndex === 'side-max') {
        return dragOpeningSide(entity, gripIndex === 'side-min' ? 'min' : 'max', newPoint, host);
      }
      // slide along the host; dragging onto another wall (same level) re-hosts the opening
      const levelWalls = allEntities.filter(
        (w): w is WallEntity => w.type === 'wall' && (w.levelId || 'level-1') === (host.levelId || 'level-1')
      );
      return dragOpening(entity, newPoint, levelWalls, 18);
    }
    case 'dimension': {
      if (gripIndex === 'p1') return { ...entity, p1: newPoint };
      if (gripIndex === 'p2') return { ...entity, p2: newPoint };
      if (gripIndex === 'offset') {
        const dir = normalize(sub(entity.p2, entity.p1));
        const norm = perpLeft(dir);
        const mid = midpoint(entity.p1, entity.p2);
        const offset = dot(sub(newPoint, mid), norm);
        return { ...entity, offset };
      }
      return entity;
    }
    case 'text':
      return { ...entity, position: newPoint };
    case 'leader': {
      if (gripIndex === 'arrow') return { ...entity, arrowPoint: newPoint };
      if (gripIndex === 'knee') return { ...entity, kneePoint: newPoint };
      if (gripIndex === 'landing') return { ...entity, landingPoint: newPoint };
      return entity;
    }
    case 'hatch': {
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        const pts = entity.polygon.map((p, i) => (i === idx ? newPoint : p));
        return { ...entity, polygon: pts };
      }
      return entity;
    }
    case 'tag':
      return { ...entity, position: newPoint };
    case 'room':
      return { ...entity, labelPos: newPoint };
    case 'block': {
      if (gripIndex === 'position') {
        return { ...entity, position: newPoint };
      }
      if (gripIndex === 'corner') {
        const unrot = rotatePoint(newPoint, entity.position, -(entity.rotation || 0));
        const nextW = Math.max(6, Math.round(Math.abs(unrot.x - entity.position.x) * 2));
        const nextD = Math.max(6, Math.round(Math.abs(unrot.y - entity.position.y) * 2));
        return { ...entity, width: nextW, depth: nextD };
      }
      return entity;
    }
    case 'floor':
    case 'roof': {
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        const pts = entity.polygon.map((p, i) => (i === idx ? newPoint : p));
        return { ...entity, polygon: pts };
      }
      if (entity.type === 'roof' && (gripIndex === 'overhang' || gripIndex === 'ridge')) {
        return applyRoofHandle(entity, gripIndex, newPoint);
      }
      return entity;
    }
    case 'camera':
      return applyCameraGrip(entity, gripIndex, newPoint);
    case 'footing':
      return gripIndex === 'position' ? { ...entity, position: newPoint } : entity;
    case 'beam':
    case 'sjoint':
    case 'section':
    case 'truss':
      if (gripIndex === 'start') return { ...entity, start: newPoint };
      if (gripIndex === 'end') return { ...entity, end: newPoint };
      return entity;
    case 'beamsystem':
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        return { ...entity, boundary: entity.boundary.map((p, i) => (i === idx ? newPoint : p)) };
      }
      return entity;
    case 'load':
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        return { ...entity, points: entity.points.map((p, i) => (i === idx ? newPoint : p)) };
      }
      return entity;
    case 'skylight':
    case 'dormer':
      return gripIndex === 'position' ? { ...entity, position: newPoint } : entity;
    case 'railing':
      if (gripIndex.startsWith('vertex-')) {
        const idx = parseInt(gripIndex.replace('vertex-', ''), 10);
        return { ...entity, path: entity.path.map((p, i) => (i === idx ? newPoint : p)) };
      }
      return entity;
    case 'stair':
      return applyStairGripMove(entity, gripIndex, newPoint);
    case 'grid': {
      if (gripIndex === 'start') return { ...entity, start: newPoint };
      if (gripIndex === 'end') return { ...entity, end: newPoint };
      if (gripIndex === 'mid') {
        const oldMid = midpoint(entity.start, entity.end);
        const delta = sub(newPoint, oldMid);
        return {
          ...entity,
          start: add(entity.start, delta),
          end: add(entity.end, delta),
        };
      }
      return entity;
    }
    case 'column':
      return { ...entity, position: newPoint };
  }
  return entity;
}

// --- ENTITY TRANSFORMS (MOVE, ROTATE, CLONE) ---

export function moveEntity(entity: ArchEntity, delta: Point): ArchEntity {
  switch (entity.type) {
    case 'camera':
      return { ...entity, position: add(entity.position, delta), target: add(entity.target, delta) };
    case 'footing':
      return entity.columnId || entity.wallId ? entity : { ...entity, position: add(entity.position, delta) };
    case 'beam':
    case 'sjoint':
    case 'section':
    case 'truss':
      return { ...entity, start: add(entity.start, delta), end: add(entity.end, delta) };
    case 'beamsystem':
      return { ...entity, boundary: entity.boundary.map((p) => add(p, delta)) };
    case 'load':
      return { ...entity, points: entity.points.map((p) => add(p, delta)) };
    case 'skylight':
    case 'dormer':
      return { ...entity, position: add(entity.position, delta) };
    case 'railing':
      return { ...entity, path: entity.path.map((p) => add(p, delta)) };
    case 'stair':
      return moveStairEntity(entity, delta);
    case 'line':
    case 'wall':
    case 'grid':
      return {
        ...entity,
        start: add(entity.start, delta),
        end: add(entity.end, delta),
      };
    case 'polyline':
      return {
        ...entity,
        points: entity.points.map((p) => add(p, delta)),
      };
    case 'rectangle':
      return {
        ...entity,
        p1: add(entity.p1, delta),
        p2: add(entity.p2, delta),
      };
    case 'circle':
    case 'arc':
      return {
        ...entity,
        center: add(entity.center, delta),
      };
    case 'dimension':
      return {
        ...entity,
        p1: add(entity.p1, delta),
        p2: add(entity.p2, delta),
      };
    case 'text':
      return {
        ...entity,
        position: add(entity.position, delta),
      };
    case 'room':
      return {
        ...entity,
        polygon: entity.polygon.map((p) => add(p, delta)),
        labelPos: add(entity.labelPos, delta),
      };
    case 'leader':
      return {
        ...entity,
        arrowPoint: add(entity.arrowPoint, delta),
        kneePoint: add(entity.kneePoint, delta),
        landingPoint: add(entity.landingPoint, delta),
      };
    case 'hatch':
    case 'floor':
    case 'roof':
      return {
        ...entity,
        polygon: entity.polygon.map((p) => add(p, delta)),
      };
    case 'tag':
    case 'block':
    case 'column':
      return {
        ...entity,
        position: add(entity.position, delta),
      };
    case 'door':
    case 'window':
    case 'wallopening':
      return entity;
  }
  return entity;
}

export function rotateEntity(
  entity: ArchEntity,
  center: Point,
  angleDeg: number
): ArchEntity {
  switch (entity.type) {
    case 'camera':
      return { ...entity, position: rotatePoint(entity.position, center, angleDeg), target: rotatePoint(entity.target, center, angleDeg) };
    case 'footing':
      return entity.columnId || entity.wallId ? entity : { ...entity, position: rotatePoint(entity.position, center, angleDeg), rotation: (entity.rotation || 0) + angleDeg };
    case 'beam':
    case 'sjoint':
    case 'section':
    case 'truss':
      return { ...entity, start: rotatePoint(entity.start, center, angleDeg), end: rotatePoint(entity.end, center, angleDeg) };
    case 'beamsystem':
      return { ...entity, boundary: entity.boundary.map((p) => rotatePoint(p, center, angleDeg)), angle: entity.angle + angleDeg };
    case 'load':
      return { ...entity, points: entity.points.map((p) => rotatePoint(p, center, angleDeg)) };
    case 'skylight':
    case 'dormer':
      return { ...entity, position: rotatePoint(entity.position, center, angleDeg) };
    case 'railing':
      return { ...entity, path: entity.path.map((p) => rotatePoint(p, center, angleDeg)) };
    case 'stair':
      return rotateStairEntity(entity, center, angleDeg, rotatePoint);
    case 'line':
    case 'wall':
    case 'grid':
      return {
        ...entity,
        start: rotatePoint(entity.start, center, angleDeg),
        end: rotatePoint(entity.end, center, angleDeg),
      };
    case 'polyline':
      return {
        ...entity,
        points: entity.points.map((p) => rotatePoint(p, center, angleDeg)),
      };
    case 'rectangle': {
      // Rotating a rectangle by non-90° converts or rotates its two diagonal corners
      return {
        ...entity,
        p1: rotatePoint(entity.p1, center, angleDeg),
        p2: rotatePoint(entity.p2, center, angleDeg),
      };
    }
    case 'circle':
      return {
        ...entity,
        center: rotatePoint(entity.center, center, angleDeg),
      };
    case 'arc':
      return {
        ...entity,
        center: rotatePoint(entity.center, center, angleDeg),
        startAngle: (entity.startAngle - angleDeg + 360) % 360,
        endAngle: (entity.endAngle - angleDeg + 360) % 360,
      };
    case 'dimension':
      return {
        ...entity,
        p1: rotatePoint(entity.p1, center, angleDeg),
        p2: rotatePoint(entity.p2, center, angleDeg),
      };
    case 'text':
      return {
        ...entity,
        position: rotatePoint(entity.position, center, angleDeg),
        rotation: (entity.rotation - angleDeg) % 360,
      };
    case 'room':
      return {
        ...entity,
        polygon: entity.polygon.map((p) => rotatePoint(p, center, angleDeg)),
        labelPos: rotatePoint(entity.labelPos, center, angleDeg),
      };
    case 'leader':
      return {
        ...entity,
        arrowPoint: rotatePoint(entity.arrowPoint, center, angleDeg),
        kneePoint: rotatePoint(entity.kneePoint, center, angleDeg),
        landingPoint: rotatePoint(entity.landingPoint, center, angleDeg),
      };
    case 'hatch':
      return {
        ...entity,
        polygon: entity.polygon.map((p) => rotatePoint(p, center, angleDeg)),
        angle: (entity.angle + angleDeg) % 360,
      };
    case 'floor':
    case 'roof':
      return {
        ...entity,
        polygon: entity.polygon.map((p) => rotatePoint(p, center, angleDeg)),
      };
    case 'tag':
      return {
        ...entity,
        position: rotatePoint(entity.position, center, angleDeg),
      };
    case 'block':
    case 'column':
      return {
        ...entity,
        position: rotatePoint(entity.position, center, angleDeg),
        rotation: ((entity.rotation || 0) - angleDeg + 360) % 360,
      };
    case 'door':
    case 'window':
    case 'wallopening':
      return entity;
  }
  return entity;
}

// --- AUTOCAD MODIFY OPERATIONS (PURE GEOMETRY FUNCTIONS) ---

export function mirrorPoint(p: Point, a: Point, b: Point): Point {
  const proj = projectPointOnLine(p, a, b).point;
  return {
    x: 2 * proj.x - p.x,
    y: 2 * proj.y - p.y,
  };
}

export function mirrorEntity(entity: ArchEntity, a: Point, b: Point): ArchEntity {
  switch (entity.type) {
    case 'stair':
      return mirrorStairEntity(entity, a, b, mirrorPoint);
    case 'line':
    case 'wall':
    case 'grid':
      return {
        ...entity,
        start: mirrorPoint(entity.start, a, b),
        end: mirrorPoint(entity.end, a, b),
      };
    case 'polyline':
      return {
        ...entity,
        points: entity.points.map((pt) => mirrorPoint(pt, a, b)),
      };
    case 'rectangle':
      return {
        ...entity,
        p1: mirrorPoint(entity.p1, a, b),
        p2: mirrorPoint(entity.p2, a, b),
      };
    case 'circle':
      return {
        ...entity,
        center: mirrorPoint(entity.center, a, b),
      };
    case 'arc': {
      const sRad = (entity.startAngle * Math.PI) / 180;
      const eRad = (entity.endAngle * Math.PI) / 180;
      const pStart = {
        x: entity.center.x + entity.radius * Math.cos(sRad),
        y: entity.center.y + entity.radius * Math.sin(sRad),
      };
      const pEnd = {
        x: entity.center.x + entity.radius * Math.cos(eRad),
        y: entity.center.y + entity.radius * Math.sin(eRad),
      };
      const newCenter = mirrorPoint(entity.center, a, b);
      const newPStart = mirrorPoint(pStart, a, b);
      const newPEnd = mirrorPoint(pEnd, a, b);
      return {
        ...entity,
        center: newCenter,
        startAngle: angleDegRaw(newCenter, newPEnd),
        endAngle: angleDegRaw(newCenter, newPStart),
      };
    }
    case 'dimension':
      return {
        ...entity,
        p1: mirrorPoint(entity.p1, a, b),
        p2: mirrorPoint(entity.p2, a, b),
        offset: -entity.offset,
      };
    case 'text':
      return {
        ...entity,
        position: mirrorPoint(entity.position, a, b),
      };
    case 'room':
      return {
        ...entity,
        polygon: entity.polygon.map((pt) => mirrorPoint(pt, a, b)),
        labelPos: mirrorPoint(entity.labelPos, a, b),
      };
    case 'leader':
      return {
        ...entity,
        arrowPoint: mirrorPoint(entity.arrowPoint, a, b),
        kneePoint: mirrorPoint(entity.kneePoint, a, b),
        landingPoint: mirrorPoint(entity.landingPoint, a, b),
      };
    case 'hatch':
    case 'floor':
    case 'roof':
      return {
        ...entity,
        polygon: entity.polygon.map((pt) => mirrorPoint(pt, a, b)),
      };
    case 'tag':
      return {
        ...entity,
        position: mirrorPoint(entity.position, a, b),
      };
    case 'block':
    case 'column':
      return {
        ...entity,
        position: mirrorPoint(entity.position, a, b),
        rotation: (360 - (entity.rotation || 0)) % 360,
      };
    case 'door':
    case 'window':
    case 'wallopening':
      return entity;
  }
  return entity;
}

export function scaleEntityByBase(
  entity: ArchEntity,
  base: Point,
  factor: number
): ArchEntity {
  const scalePt = (p: Point): Point => ({
    x: base.x + (p.x - base.x) * factor,
    y: base.y + (p.y - base.y) * factor,
  });

  switch (entity.type) {
    case 'stair':
      return scaleStairEntity(entity, base, factor);
    case 'line':
    case 'wall':
    case 'grid':
      return {
        ...entity,
        start: scalePt(entity.start),
        end: scalePt(entity.end),
      };
    case 'polyline':
      return {
        ...entity,
        points: entity.points.map(scalePt),
      };
    case 'rectangle':
      return {
        ...entity,
        p1: scalePt(entity.p1),
        p2: scalePt(entity.p2),
      };
    case 'circle':
      return {
        ...entity,
        center: scalePt(entity.center),
        radius: Math.max(1, Math.abs(entity.radius * factor)),
      };
    case 'arc':
      return {
        ...entity,
        center: scalePt(entity.center),
        radius: Math.max(1, Math.abs(entity.radius * factor)),
      };
    case 'dimension':
      return {
        ...entity,
        p1: scalePt(entity.p1),
        p2: scalePt(entity.p2),
        offset: entity.offset * factor,
      };
    case 'text':
      return {
        ...entity,
        position: scalePt(entity.position),
        fontSize: Math.max(2, entity.fontSize * factor),
      };
    case 'room':
      return {
        ...entity,
        polygon: entity.polygon.map(scalePt),
        labelPos: scalePt(entity.labelPos),
      };
    case 'leader':
      return {
        ...entity,
        arrowPoint: scalePt(entity.arrowPoint),
        kneePoint: scalePt(entity.kneePoint),
        landingPoint: scalePt(entity.landingPoint),
        fontSize: Math.max(2, entity.fontSize * factor),
      };
    case 'hatch':
      return {
        ...entity,
        polygon: entity.polygon.map(scalePt),
        scale: entity.scale * factor,
      };
    case 'floor':
    case 'roof':
      return {
        ...entity,
        polygon: entity.polygon.map(scalePt),
      };
    case 'tag':
      return {
        ...entity,
        position: scalePt(entity.position),
      };
    case 'block':
      return {
        ...entity,
        position: scalePt(entity.position),
        scale: Math.max(0.1, (entity.scale || 1) * factor),
      };
    case 'column':
      return {
        ...entity,
        position: scalePt(entity.position),
        width: Math.max(2, entity.width * factor),
        depth: Math.max(2, entity.depth * factor),
      };
    case 'door':
    case 'window':
    case 'wallopening':
      return entity;
  }
  return entity;
}

export function stretchEntities(
  entities: ArchEntity[],
  pA: Point,
  pB: Point,
  delta: Point
): ArchEntity[] {
  const minX = Math.min(pA.x, pB.x);
  const maxX = Math.max(pA.x, pB.x);
  const minY = Math.min(pA.y, pB.y);
  const maxY = Math.max(pA.y, pB.y);

  const isInside = (p: Point) =>
    p.x >= minX - 1e-4 && p.x <= maxX + 1e-4 && p.y >= minY - 1e-4 && p.y <= maxY + 1e-4;

  const stretchPt = (p: Point) => (isInside(p) ? add(p, delta) : p);

  return entities.map((ent) => {
    switch (ent.type) {
      case 'line':
      case 'wall': {
        const newStart = stretchPt(ent.start);
        const newEnd = stretchPt(ent.end);
        return { ...ent, start: newStart, end: newEnd };
      }
      case 'polyline':
        return { ...ent, points: ent.points.map(stretchPt) };
      case 'rectangle': {
        const c1In = isInside(ent.p1);
        const c2In = isInside(ent.p2);
        if (c1In && c2In) {
          return { ...ent, p1: add(ent.p1, delta), p2: add(ent.p2, delta) };
        } else if (c1In) {
          return { ...ent, p1: add(ent.p1, delta) };
        } else if (c2In) {
          return { ...ent, p2: add(ent.p2, delta) };
        }
        return ent;
      }
      case 'dimension':
        return { ...ent, p1: stretchPt(ent.p1), p2: stretchPt(ent.p2) };
      case 'circle':
      case 'arc':
        return isInside(ent.center) ? { ...ent, center: add(ent.center, delta) } : ent;
      case 'text':
        return isInside(ent.position) ? { ...ent, position: add(ent.position, delta) } : ent;
      case 'room':
        return {
          ...ent,
          polygon: ent.polygon.map(stretchPt),
          labelPos: isInside(ent.labelPos) ? add(ent.labelPos, delta) : ent.labelPos,
        };
      default:
        return ent;
    }
  });
}

export function offsetLine(
  start: Point,
  end: Point,
  distance: number,
  sidePoint: Point
): { start: Point; end: Point } {
  const dir = normalize(sub(end, start));
  const normal = perpLeft(dir);
  const mid = midpoint(start, end);
  const toSide = sub(sidePoint, mid);
  const sideSign = dot(toSide, normal) >= 0 ? 1 : -1;
  const offsetVec = scale(normal, distance * sideSign);
  return {
    start: add(start, offsetVec),
    end: add(end, offsetVec),
  };
}

export function offsetEntity(
  entity: ArchEntity,
  distance: number,
  sidePoint: Point
): ArchEntity | null {
  if (distance <= 0) return null;
  const newId = `${entity.type}-off-${Date.now()}`;

  switch (entity.type) {
    case 'line': {
      const off = offsetLine(entity.start, entity.end, distance, sidePoint);
      return { ...entity, id: newId, start: off.start, end: off.end };
    }
    case 'wall': {
      const off = offsetLine(entity.start, entity.end, distance, sidePoint);
      return { ...entity, id: newId, start: off.start, end: off.end };
    }
    case 'circle': {
      const d = dist(entity.center, sidePoint);
      const newRadius =
        d >= entity.radius ? entity.radius + distance : Math.max(1, entity.radius - distance);
      return { ...entity, id: newId, radius: newRadius };
    }
    case 'arc': {
      const d = dist(entity.center, sidePoint);
      const newRadius =
        d >= entity.radius ? entity.radius + distance : Math.max(1, entity.radius - distance);
      return { ...entity, id: newId, radius: newRadius };
    }
    case 'polyline': {
      const pts = entity.points;
      if (pts.length < 2) return null;
      const offSegments: { start: Point; end: Point }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        offSegments.push(offsetLine(pts[i], pts[i + 1], distance, sidePoint));
      }
      if (entity.closed && pts.length > 2) {
        offSegments.push(offsetLine(pts[pts.length - 1], pts[0], distance, sidePoint));
      }
      const newPts: Point[] = [];
      for (let i = 0; i < offSegments.length; i++) {
        const curr = offSegments[i];
        if (i === 0 && !entity.closed) {
          newPts.push(curr.start);
        }
        if (i < offSegments.length - 1) {
          const next = offSegments[i + 1];
          const corner = lineIntersectionInfinite(curr.start, curr.end, next.start, next.end);
          if (corner && dist(corner, curr.end) < distance * 4) {
            newPts.push(corner);
          } else {
            newPts.push(curr.end);
          }
        } else if (entity.closed) {
          const next = offSegments[0];
          const corner = lineIntersectionInfinite(curr.start, curr.end, next.start, next.end);
          if (corner && dist(corner, curr.end) < distance * 4) {
            newPts.push(corner);
          } else {
            newPts.push(curr.end);
          }
        } else {
          newPts.push(curr.end);
        }
      }
      return { ...entity, id: newId, points: newPts };
    }
    case 'rectangle': {
      const minX = Math.min(entity.p1.x, entity.p2.x);
      const maxX = Math.max(entity.p1.x, entity.p2.x);
      const minY = Math.min(entity.p1.y, entity.p2.y);
      const maxY = Math.max(entity.p1.y, entity.p2.y);
      const isInside =
        sidePoint.x >= minX &&
        sidePoint.x <= maxX &&
        sidePoint.y >= minY &&
        sidePoint.y <= maxY;
      const sign = isInside ? -1 : 1;
      return {
        ...entity,
        id: newId,
        p1: { x: minX - distance * sign, y: minY - distance * sign },
        p2: { x: maxX + distance * sign, y: maxY + distance * sign },
      };
    }
    default:
      return null;
  }
}

export function lineCircleIntersections(
  p1: Point,
  p2: Point,
  center: Point,
  radius: number
): Point[] {
  const d = sub(p2, p1);
  const f = sub(p1, center);
  const a = dot(d, d);
  const b = 2 * dot(f, d);
  const c = dot(f, f) - radius * radius;
  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);
  const results: Point[] = [];
  if (t1 >= 0 && t1 <= 1) {
    results.push(lerpPoint(p1, p2, t1));
  }
  if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > 1e-4) {
    results.push(lerpPoint(p1, p2, t2));
  }
  return results;
}

export function trimLineOrWall(
  entity: LineEntity | WallEntity,
  cuttingSegments: Segment[],
  clickPoint: Point
): (LineEntity | WallEntity)[] {
  const dummyCutters: ArchEntity[] = cuttingSegments.map((s, idx) => ({
    id: s.entityId ?? `cut-${idx}`,
    type: 'line',
    layer: '0',
    start: s.a,
    end: s.b,
    color: '#ffffff',
    lineWidth: 1,
    lineType: 'continuous',
  } as LineEntity));

  const res = trimAt(entity, clickPoint, dummyCutters, 'quick', [entity]);
  return res.entities.filter((e): e is LineEntity | WallEntity => e.type === 'line' || e.type === 'wall');
}

export function extendLineOrWall(
  entity: LineEntity | WallEntity,
  boundarySegments: Segment[],
  clickPoint: Point
): LineEntity | WallEntity | null {
  const dummyBounds: ArchEntity[] = boundarySegments.map((s, idx) => ({
    id: s.entityId ?? `bound-${idx}`,
    type: 'line',
    layer: '0',
    start: s.a,
    end: s.b,
    color: '#ffffff',
    lineWidth: 1,
    lineType: 'continuous',
  } as LineEntity));

  const res = extendAt(entity, clickPoint, dummyBounds, 'quick', 'noextend');
  return res.extendedEntity === entity ? null : (res.extendedEntity as LineEntity | WallEntity);
}

export function filletEntities(
  e1: LineEntity | WallEntity,
  e2: LineEntity | WallEntity,
  radius: number,
  _p1Click?: Point,
  _p2Click?: Point
): { modified: (LineEntity | WallEntity)[]; arc?: ArcEntity } | null {
  const corner = lineIntersectionInfinite(e1.start, e1.end, e2.start, e2.end);
  if (!corner) return null;

  const e1StartNear = dist(e1.start, corner) < dist(e1.end, corner);
  const e1Far = e1StartNear ? e1.end : e1.start;

  const e2StartNear = dist(e2.start, corner) < dist(e2.end, corner);
  const e2Far = e2StartNear ? e2.end : e2.start;

  if (radius <= 0.01) {
    const mod1: LineEntity | WallEntity = e1StartNear
      ? { ...e1, start: corner }
      : { ...e1, end: corner };
    const mod2: LineEntity | WallEntity = e2StartNear
      ? { ...e2, start: corner }
      : { ...e2, end: corner };
    return { modified: [mod1, mod2] };
  }

  const v1 = normalize(sub(e1Far, corner));
  const v2 = normalize(sub(e2Far, corner));

  const cosVal = Math.max(-0.9999, Math.min(0.9999, dot(v1, v2)));
  const theta = Math.acos(cosVal);
  if (theta < 0.05 || theta > Math.PI - 0.05) return null;

  const dTan = radius / Math.tan(theta / 2);
  const t1 = add(corner, scale(v1, dTan));
  const t2 = add(corner, scale(v2, dTan));

  const bisector = normalize(add(v1, v2));
  const dCenter = radius / Math.sin(theta / 2);
  const arcCenter = add(corner, scale(bisector, dCenter));

  let a1 = angleDegRaw(arcCenter, t1);
  let a2 = angleDegRaw(arcCenter, t2);
  const crossProd = cross(v1, v2);
  if (crossProd < 0) {
    const tmp = a1;
    a1 = a2;
    a2 = tmp;
  }

  const arc: ArcEntity = {
    id: `arc-fillet-${Date.now()}`,
    type: 'arc',
    layer: e1.layer,
    center: arcCenter,
    radius,
    startAngle: a1,
    endAngle: a2,
  };

  const mod1: LineEntity | WallEntity = e1StartNear
    ? { ...e1, start: t1 }
    : { ...e1, end: t1 };
  const mod2: LineEntity | WallEntity = e2StartNear
    ? { ...e2, start: t2 }
    : { ...e2, end: t2 };

  return { modified: [mod1, mod2], arc };
}

export function chamferEntities(
  e1: LineEntity | WallEntity,
  e2: LineEntity | WallEntity,
  d1: number,
  d2: number
): { modified: (LineEntity | WallEntity)[]; chamferLine: LineEntity } | null {
  const corner = lineIntersectionInfinite(e1.start, e1.end, e2.start, e2.end);
  if (!corner) return null;

  const e1StartNear = dist(e1.start, corner) < dist(e1.end, corner);
  const e1Far = e1StartNear ? e1.end : e1.start;
  const e2StartNear = dist(e2.start, corner) < dist(e2.end, corner);
  const e2Far = e2StartNear ? e2.end : e2.start;

  const v1 = normalize(sub(e1Far, corner));
  const v2 = normalize(sub(e2Far, corner));

  const c1 = add(corner, scale(v1, Math.max(0.1, d1)));
  const c2 = add(corner, scale(v2, Math.max(0.1, d2)));

  const mod1: LineEntity | WallEntity = e1StartNear
    ? { ...e1, start: c1 }
    : { ...e1, end: c1 };
  const mod2: LineEntity | WallEntity = e2StartNear
    ? { ...e2, start: c2 }
    : { ...e2, end: c2 };

  const chamferLine: LineEntity = {
    id: `line-chamfer-${Date.now()}`,
    type: 'line',
    layer: e1.layer,
    start: c1,
    end: c2,
  };

  return { modified: [mod1, mod2], chamferLine };
}

export function breakEntity(
  entity: ArchEntity,
  p1: Point,
  p2: Point
): ArchEntity[] {
  if (entity.type === 'line' || entity.type === 'wall') {
    const S = entity.start;
    const E = entity.end;
    const t1 = projectPointOnSegment(p1, S, E).t;
    const t2 = projectPointOnSegment(p2, S, E).t;

    if (Math.abs(t1 - t2) < 0.005) {
      const ptBreak = lerpPoint(S, E, t1);
      const piece1 = { ...entity, id: entity.id, end: ptBreak };
      const piece2 = { ...entity, id: `${entity.type}-brk-${Date.now()}`, start: ptBreak };
      return [piece1, piece2];
    }

    const ta = Math.min(t1, t2);
    const tb = Math.max(t1, t2);
    const results: ArchEntity[] = [];
    if (ta > 0.01) {
      results.push({ ...entity, id: entity.id, end: lerpPoint(S, E, ta) });
    }
    if (tb < 0.99) {
      results.push({
        ...entity,
        id: `${entity.type}-brk-${Date.now()}`,
        start: lerpPoint(S, E, tb),
      });
    }
    return results;
  }

  if (entity.type === 'circle') {
    const a1 = angleDegRaw(entity.center, p1);
    const a2 = angleDegRaw(entity.center, p2);
    const arc: ArcEntity = {
      id: `arc-brk-${Date.now()}`,
      type: 'arc',
      layer: entity.layer,
      center: entity.center,
      radius: entity.radius,
      startAngle: a2,
      endAngle: a1,
    };
    return [arc];
  }

  return [entity];
}

export function joinEntities(entities: ArchEntity[]): ArchEntity[] {
  if (entities.length < 2) return entities;

  const allLines = entities.every((e): e is LineEntity => e.type === 'line');
  if (allLines) {
    const lines = entities as LineEntity[];
    const l1 = lines[0];
    const l2 = lines[1];
    const dir1 = normalize(sub(l1.end, l1.start));
    const dir2 = normalize(sub(l2.end, l2.start));
    const isCollinear =
      Math.abs(cross(dir1, dir2)) < 0.05 &&
      dist(l2.start, projectPointOnLine(l2.start, l1.start, l1.end).point) < 2.0;

    if (isCollinear) {
      const pts = [l1.start, l1.end, l2.start, l2.end];
      const dots = pts.map((p) => ({ pt: p, val: dot(p, dir1) }));
      dots.sort((a, b) => a.val - b.val);
      const merged: LineEntity = {
        ...l1,
        start: dots[0].pt,
        end: dots[dots.length - 1].pt,
      };
      return [merged];
    }

    const chainPts: Point[] = [l1.start, l1.end];
    const rest = lines.slice(1);
    while (rest.length > 0) {
      const tip = chainPts[chainPts.length - 1];
      const matchIdx = rest.findIndex(
        (l) => dist(tip, l.start) < 4.0 || dist(tip, l.end) < 4.0
      );
      if (matchIdx === -1) break;
      const match = rest.splice(matchIdx, 1)[0];
      if (dist(tip, match.start) < 4.0) {
        chainPts.push(match.end);
      } else {
        chainPts.push(match.start);
      }
    }
    if (chainPts.length > 2) {
      const poly: PolylineEntity = {
        id: `pline-join-${Date.now()}`,
        type: 'polyline',
        layer: l1.layer,
        levelId: l1.levelId,
        points: chainPts,
        closed: dist(chainPts[0], chainPts[chainPts.length - 1]) < 4.0,
      };
      return [poly, ...rest];
    }
  }

  const allWalls = entities.every((e): e is WallEntity => e.type === 'wall');
  if (allWalls && entities.length === 2) {
    const [w1, w2] = entities as WallEntity[];
    const dir1 = normalize(sub(w1.end, w1.start));
    const dir2 = normalize(sub(w2.end, w2.start));
    const isCollinear =
      Math.abs(cross(dir1, dir2)) < 0.05 &&
      dist(w2.start, projectPointOnLine(w2.start, w1.start, w1.end).point) < 2.0;
    if (isCollinear) {
      const pts = [w1.start, w1.end, w2.start, w2.end];
      const dots = pts.map((p) => ({ pt: p, val: dot(p, dir1) }));
      dots.sort((a, b) => a.val - b.val);
      const merged: WallEntity = {
        ...w1,
        start: dots[0].pt,
        end: dots[dots.length - 1].pt,
      };
      return [merged];
    }
  }

  return entities;
}

export function explodeEntity(
  entity: ArchEntity,
  allBlocks?: BlockDefinition[]
): ArchEntity[] {
  const stamp = Date.now();
  switch (entity.type) {
    case 'polyline': {
      const lines: LineEntity[] = [];
      const pts = entity.points;
      for (let i = 0; i < pts.length - 1; i++) {
        lines.push({
          id: `line-exp-${stamp}-${i}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: pts[i],
          end: pts[i + 1],
        });
      }
      if (entity.closed && pts.length > 2) {
        lines.push({
          id: `line-exp-${stamp}-c`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: pts[pts.length - 1],
          end: pts[0],
        });
      }
      return lines;
    }
    case 'rectangle': {
      const { p1, p2 } = entity;
      const c1 = p1;
      const c2 = { x: p2.x, y: p1.y };
      const c3 = p2;
      const c4 = { x: p1.x, y: p2.y };
      return [
        { id: `line-rect-1-${stamp}`, type: 'line', layer: entity.layer, levelId: entity.levelId, start: c1, end: c2 },
        { id: `line-rect-2-${stamp}`, type: 'line', layer: entity.layer, levelId: entity.levelId, start: c2, end: c3 },
        { id: `line-rect-3-${stamp}`, type: 'line', layer: entity.layer, levelId: entity.levelId, start: c3, end: c4 },
        { id: `line-rect-4-${stamp}`, type: 'line', layer: entity.layer, levelId: entity.levelId, start: c4, end: c1 },
      ];
    }
    case 'wall': {
      return [
        {
          id: `line-wall-exp-${stamp}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: entity.start,
          end: entity.end,
        },
      ];
    }
    case 'room':
    case 'floor':
    case 'roof':
    case 'hatch': {
      const lines: LineEntity[] = [];
      for (let i = 0; i < entity.polygon.length; i++) {
        const j = (i + 1) % entity.polygon.length;
        lines.push({
          id: `line-poly-${stamp}-${i}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: entity.polygon[i],
          end: entity.polygon[j],
        });
      }
      return lines;
    }
    case 'railing': {
      const lines: LineEntity[] = [];
      for (let i = 0; i < entity.path.length - 1; i++) {
        lines.push({
          id: `line-rail-${stamp}-${i}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: entity.path[i],
          end: entity.path[i + 1],
        });
      }
      return lines;
    }
    case 'stair': {
      const plan = computeMultiRunStairPlanGeometry(entity);
      const lines: LineEntity[] = [];
      plan.runPolygons.forEach((rp, rIdx) => {
        for (let i = 0; i < rp.polygon.length; i++) {
          lines.push({
            id: `line-stair-run-${stamp}-${rIdx}-${i}`,
            type: 'line',
            layer: entity.layer,
            levelId: entity.levelId,
            start: rp.polygon[i],
            end: rp.polygon[(i + 1) % rp.polygon.length],
          });
        }
      });
      plan.landingPolygons.forEach((lp, lIdx) => {
        for (let i = 0; i < lp.polygon.length; i++) {
          lines.push({
            id: `line-stair-lnd-${stamp}-${lIdx}-${i}`,
            type: 'line',
            layer: entity.layer,
            levelId: entity.levelId,
            start: lp.polygon[i],
            end: lp.polygon[(i + 1) % lp.polygon.length],
          });
        }
      });
      plan.treadLines.forEach((tl, tIdx) => {
        lines.push({
          id: `line-stair-trd-${stamp}-${tIdx}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: tl.a,
          end: tl.b,
        });
      });
      return lines.length > 0 ? lines : [entity];
    }
    case 'dimension': {
      return [
        {
          id: `line-dim-exp-${stamp}`,
          type: 'line',
          layer: entity.layer,
          levelId: entity.levelId,
          start: entity.p1,
          end: entity.p2,
        },
      ];
    }
    case 'block': {
      return explodeBlockInstance(entity, allBlocks);
    }
    default:
      return [entity];
  }
}

export function getBlockWorldPrimitives(
  instance: BlockInstanceEntity,
  blockDef?: BlockDefinition
): ArchEntity[] {
  const blocks = createStarterBlocks();
  const def =
    blockDef ||
    blocks.find((b) => b.id === instance.blockId) ||
    blocks[0];
  if (!def) return [];

  const sx =
    (Math.max(1, instance.width) / Math.max(1, def.width)) *
    (instance.scale || 1);
  const sy =
    (Math.max(1, instance.depth) / Math.max(1, def.depth)) *
    (instance.scale || 1);
  const avgScale = (sx + sy) / 2;
  const rotDeg = instance.rotation || 0;
  const rad = (-rotDeg * Math.PI) / 180; // rotatePoint uses -angleDeg in SVG
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const txPt = (localPt: Point): Point => {
    const xScaled = localPt.x * sx;
    const yScaled = localPt.y * sy;
    return {
      x: instance.position.x + (xScaled * cos - yScaled * sin),
      y: instance.position.y + (xScaled * sin + yScaled * cos),
    };
  };

  const results: ArchEntity[] = [];
  def.entities.forEach((prim, idx) => {
    const id = `${instance.id}-prim-${idx}`;
    const layer = instance.layer || 'A-FURN';
    switch (prim.type) {
      case 'line':
        results.push({
          id,
          type: 'line',
          layer,
          start: txPt(prim.start),
          end: txPt(prim.end),
        });
        break;
      case 'polyline':
        results.push({
          id,
          type: 'polyline',
          layer,
          points: prim.points.map(txPt),
          closed: prim.closed,
        });
        break;
      case 'rectangle': {
        // Transform the 4 corners of the rectangle so rotated blocks stay accurate!
        const c1 = txPt({ x: prim.p1.x, y: prim.p1.y });
        const c2 = txPt({ x: prim.p2.x, y: prim.p1.y });
        const c3 = txPt({ x: prim.p2.x, y: prim.p2.y });
        const c4 = txPt({ x: prim.p1.x, y: prim.p2.y });
        if (Math.abs(rotDeg % 180) < 1e-3) {
          results.push({
            id,
            type: 'rectangle',
            layer,
            p1: c1,
            p2: c3,
          });
        } else {
          results.push({
            id,
            type: 'polyline',
            layer,
            points: [c1, c2, c3, c4],
            closed: true,
          });
        }
        break;
      }
      case 'circle':
        results.push({
          id,
          type: 'circle',
          layer,
          center: txPt(prim.center),
          radius: Math.max(0.5, prim.radius * avgScale),
        });
        break;
      case 'arc':
        results.push({
          id,
          type: 'arc',
          layer,
          center: txPt(prim.center),
          radius: Math.max(0.5, prim.radius * avgScale),
          startAngle: (prim.startAngle - rotDeg + 360) % 360,
          endAngle: (prim.endAngle - rotDeg + 360) % 360,
        });
        break;
      default:
        break;
    }
  });

  return results;
}

export function explodeBlockInstance(
  instance: BlockInstanceEntity,
  allBlocks?: BlockDefinition[]
): ArchEntity[] {
  const def = (allBlocks || createStarterBlocks()).find(
    (b) => b.id === instance.blockId
  );
  const prims = getBlockWorldPrimitives(instance, def);
  const exploded: ArchEntity[] = [];
  prims.forEach((p, i) => {
    if (p.type === 'rectangle') {
      exploded.push(...explodeEntity(p));
    } else {
      exploded.push({
        ...p,
        id: `${p.type}-expblk-${Date.now()}-${i}`,
      });
    }
  });
  return exploded;
}

export function createBlockFromSelection(
  name: string,
  basePoint: Point,
  selectedEntities: ArchEntity[],
  color = '#0d9488',
  height = 32,
  layer = 'A-FURN'
): { blockDef: BlockDefinition; instance: BlockInstanceEntity } {
  const localEntities: ArchEntity[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const trackPt = (pt: Point) => {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  };

  const toLocal = (pt: Point): Point => {
    const loc = { x: pt.x - basePoint.x, y: pt.y - basePoint.y };
    trackPt(loc);
    return loc;
  };

  selectedEntities.forEach((ent, idx) => {
    const lid = `bprim-${idx}`;
    if (ent.type === 'line') {
      localEntities.push({
        id: lid,
        type: 'line',
        layer: '0',
        start: toLocal(ent.start),
        end: toLocal(ent.end),
      });
    } else if (ent.type === 'wall') {
      localEntities.push({
        id: lid,
        type: 'line',
        layer: '0',
        start: toLocal(ent.start),
        end: toLocal(ent.end),
      });
    } else if (ent.type === 'rectangle') {
      localEntities.push({
        id: lid,
        type: 'rectangle',
        layer: '0',
        p1: toLocal(ent.p1),
        p2: toLocal(ent.p2),
      });
    } else if (ent.type === 'polyline') {
      localEntities.push({
        id: lid,
        type: 'polyline',
        layer: '0',
        points: ent.points.map(toLocal),
        closed: ent.closed,
      });
    } else if (ent.type === 'circle') {
      const c = toLocal(ent.center);
      trackPt({ x: c.x - ent.radius, y: c.y - ent.radius });
      trackPt({ x: c.x + ent.radius, y: c.y + ent.radius });
      localEntities.push({
        id: lid,
        type: 'circle',
        layer: '0',
        center: c,
        radius: ent.radius,
      });
    } else if (ent.type === 'arc') {
      const c = toLocal(ent.center);
      trackPt({ x: c.x - ent.radius, y: c.y - ent.radius });
      trackPt({ x: c.x + ent.radius, y: c.y + ent.radius });
      localEntities.push({
        id: lid,
        type: 'arc',
        layer: '0',
        center: c,
        radius: ent.radius,
        startAngle: ent.startAngle,
        endAngle: ent.endAngle,
      });
    }
  });

  if (!Number.isFinite(minX)) {
    minX = -18;
    maxX = 18;
    minY = -18;
    maxY = 18;
    localEntities.push({
      id: 'bprim-default',
      type: 'rectangle',
      layer: '0',
      p1: { x: -18, y: -18 },
      p2: { x: 18, y: 18 },
    });
  }

  const width = Math.max(6, Math.round(maxX - minX));
  const depth = Math.max(6, Math.round(maxY - minY));
  const blockId = `block-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;

  const blockDef: BlockDefinition = {
    id: blockId,
    name,
    category: 'Custom',
    kind: 'custom',
    width,
    depth,
    height,
    color,
    entities: localEntities,
  };

  const instance: BlockInstanceEntity = {
    id: `blkinst-${Date.now()}`,
    type: 'block',
    layer,
    blockId,
    name,
    position: basePoint,
    rotation: 0,
    scale: 1,
    width,
    depth,
    height,
    color,
  };

  return { blockDef, instance };
}

export function alignEntity(
  source: ArchEntity,
  refA: Point,
  refB: Point,
  srcA?: Point,
  srcB?: Point
): ArchEntity | null {
  let sA = srcA;
  let sB = srcB;
  if (!sA || !sB) {
    if (source.type === 'line' || source.type === 'wall') {
      sA = source.start;
      sB = source.end;
    } else if (source.type === 'polyline' && source.points.length >= 2) {
      sA = source.points[0];
      sB = source.points[1];
    } else {
      return null;
    }
  }

  const moveDelta = sub(refA, sA);
  const shifted = moveEntity(source, moveDelta);

  const refAngle = angleDegCad(refA, refB);
  const shiftedSrcB = add(sB, moveDelta);
  const srcAngle = angleDegCad(refA, shiftedSrcB);
  const diffAngle = refAngle - srcAngle;

  return rotateEntity(shifted, refA, diffAngle);
}

export function createRectangularArray(
  entities: ArchEntity[],
  rows: number,
  cols: number,
  rowSpacing: number,
  colSpacing: number,
  allEntities?: ArchEntity[]
): ArchEntity[] {
  const result: ArchEntity[] = [];
  const safeRows = Math.max(1, Math.min(50, rows));
  const safeCols = Math.max(1, Math.min(50, cols));

  for (let r = 0; r < safeRows; r++) {
    for (let c = 0; c < safeCols; c++) {
      if (r === 0 && c === 0) continue;
      const delta = { x: c * colSpacing, y: r * rowSpacing };
      const newId = (ent: ArchEntity) => `${ent.type}-ar-${r}-${c}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      if (allEntities) {
        // hosted openings stay embedded: arrayed along their wall, or carried by arrayed walls
        result.push(...copySelectionHosted(allEntities, entities.map((e) => e.id), delta, moveEntity, newId));
        continue;
      }
      for (const ent of entities) {
        if (isHostedOpening(ent)) continue;
        const cloned = moveEntity(ent, delta);
        result.push({ ...cloned, id: newId(ent) });
      }
    }
  }
  return result;
}

export function createPolarArray(
  entities: ArchEntity[],
  center: Point,
  count: number,
  totalAngleDeg: number
): ArchEntity[] {
  const result: ArchEntity[] = [];
  const safeCount = Math.max(2, Math.min(100, count));
  const angleStep = totalAngleDeg / safeCount;

  for (let i = 1; i < safeCount; i++) {
    const angle = i * angleStep;
    for (const ent of entities) {
      if (isHostedOpening(ent)) continue;
      const rotated = rotateEntity(ent, center, angle);
      result.push({
        ...rotated,
        id: `${ent.type}-polar-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      });
    }
  }
  return result;
}

// --- HIT TESTING & BOX SELECTION (WINDOW vs CROSSING) ---

export function getEntityBoundingBox(
  entity: ArchEntity,
  allEntities: ArchEntity[]
): { minX: number; minY: number; maxX: number; maxY: number } {
  const fromPts = (pts: Point[]) => {
    if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxX: Math.max(...pts.map((p) => p.x)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
  };

  switch (entity.type) {
    case 'camera':
      return fromPts(wedgePoints(entity.position, entity.target, entity.fov));
    case 'footing': {
      const fp = footingPlanOutline(entity, allEntities);
      return fp.length ? fromPts(fp) : fromPts([entity.position]);
    }
    case 'beam':
    case 'sjoint':
    case 'section':
    case 'truss':
      return fromPts([entity.start, entity.end]);
    case 'beamsystem':
      return fromPts(entity.boundary);
    case 'load':
      return fromPts(entity.points);
    case 'rebar':
    case 'areareinf':
    case 'connection': {
      const hostId = entity.type === 'connection' ? entity.memberIds[0] : entity.hostId;
      const host = allEntities.find((h) => h.id === hostId);
      return host && host.type !== 'rebar' && host.type !== 'areareinf' && host.type !== 'connection' ? getEntityBoundingBox(host, allEntities) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    case 'skylight':
      return fromPts([add(entity.position, { x: -entity.length, y: -entity.length }), add(entity.position, { x: entity.length, y: entity.length })]);
    case 'dormer':
      return fromPts([add(entity.position, { x: -entity.width, y: -entity.width }), add(entity.position, { x: entity.width, y: entity.width })]);
    case 'railing':
      return fromPts(entity.path);
    case 'balcony':
    case 'sweep': {
      const host = allEntities.find((h): h is WallEntity => h.type === 'wall' && h.id === entity.wallId);
      if (!host) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const pad = entity.type === 'balcony' ? entity.depth + host.thickness : host.thickness;
      const bb = fromPts([host.start, host.end]);
      return { minX: bb.minX - pad, minY: bb.minY - pad, maxX: bb.maxX + pad, maxY: bb.maxY + pad };
    }
    case 'line':
    case 'wall':
      return fromPts([entity.start, entity.end]);
    case 'polyline':
      return fromPts(entity.points);
    case 'rectangle':
      return fromPts([entity.p1, entity.p2]);
    case 'circle':
    case 'arc':
      return {
        minX: entity.center.x - entity.radius,
        minY: entity.center.y - entity.radius,
        maxX: entity.center.x + entity.radius,
        maxY: entity.center.y + entity.radius,
      };
    case 'door':
    case 'window':
    case 'wallopening': {
      const host = allEntities.find(
        (w): w is WallEntity => w.type === 'wall' && w.id === entity.wallId
      );
      if (!host) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const c = lerpPoint(host.start, host.end, entity.offset);
      const r = entity.width / 2;
      return { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
    }
    case 'room':
      return fromPts(entity.polygon);
    case 'dimension':
      return fromPts([entity.p1, entity.p2]);
    case 'text': {
      const w = entity.text.length * entity.fontSize * 0.6;
      const h = entity.fontSize;
      return {
        minX: entity.position.x - w / 2,
        minY: entity.position.y - h / 2,
        maxX: entity.position.x + w / 2,
        maxY: entity.position.y + h / 2,
      };
    }
    case 'leader':
      return fromPts([entity.arrowPoint, entity.kneePoint, entity.landingPoint]);
    case 'hatch':
      return fromPts(entity.polygon);
    case 'tag':
      return {
        minX: entity.position.x - 16,
        minY: entity.position.y - 12,
        maxX: entity.position.x + 16,
        maxY: entity.position.y + 12,
      };
    case 'block': {
      const hw = (entity.width * (entity.scale || 1)) / 2;
      const hd = (entity.depth * (entity.scale || 1)) / 2;
      const pos = entity.position;
      const rot = entity.rotation || 0;
      const corners = [
        rotatePoint({ x: pos.x - hw, y: pos.y - hd }, pos, rot),
        rotatePoint({ x: pos.x + hw, y: pos.y - hd }, pos, rot),
        rotatePoint({ x: pos.x + hw, y: pos.y + hd }, pos, rot),
        rotatePoint({ x: pos.x - hw, y: pos.y + hd }, pos, rot),
      ];
      return fromPts(corners);
    }
    case 'floor':
    case 'roof':
      return fromPts(entity.polygon);
    case 'stair': {
      const { runs, landings } = ensureStairRunsAndLandings(entity);
      const pts: Point[] = [];
      for (const r of runs) pts.push(...getRunEdgeGeometry(r).outline);
      for (const l of landings) pts.push(...l.polygon);
      if (entity.shape === 'spiral' && runs[0]) {
        const rad = Math.max(30, entity.spiralRadius ?? entity.width ?? 42);
        pts.push(
          { x: runs[0].start.x - rad, y: runs[0].start.y - rad },
          { x: runs[0].start.x + rad, y: runs[0].start.y + rad }
        );
      }
      return fromPts(pts);
    }
    case 'column': {
      const hw = entity.width / 2;
      const hd = entity.depth / 2;
      const pos = entity.position;
      return {
        minX: pos.x - hw,
        minY: pos.y - hd,
        maxX: pos.x + hw,
        maxY: pos.y + hd,
      };
    }
    case 'grid':
      return fromPts([entity.start, entity.end]);
    case 'custom': {
      const hw = ((entity as any).width || 36) / 2;
      const hd = ((entity as any).depth || 36) / 2;
      const pos = (entity as any).position || { x: 0, y: 0 };
      return {
        minX: pos.x - hw,
        minY: pos.y - hd,
        maxX: pos.x + hw,
        maxY: pos.y + hd,
      };
    }
  }
}

export function findEntitiesAtPoint(
  point: Point,
  entities: ArchEntity[],
  tol: number
): ArchEntity[] {
  const hits: ArchEntity[] = [];
  for (const ent of entities) {
    const box = getEntityBoundingBox(ent, entities);
    if (
      point.x >= box.minX - tol &&
      point.x <= box.maxX + tol &&
      point.y >= box.minY - tol &&
      point.y <= box.maxY + tol
    ) {
      hits.push(ent);
    }
  }
  return hits;
}

export function isEntityInSelectionBox(
  entity: ArchEntity,
  allEntities: ArchEntity[],
  boxStart: Point,
  boxEnd: Point
): boolean {
  const isCrossing = boxEnd.x < boxStart.x; // Right-to-Left = Crossing (AutoCAD style)
  const minX = Math.min(boxStart.x, boxEnd.x);
  const maxX = Math.max(boxStart.x, boxEnd.x);
  const minY = Math.min(boxStart.y, boxEnd.y);
  const maxY = Math.max(boxStart.y, boxEnd.y);

  const bbox = getEntityBoundingBox(entity, allEntities);
  const fullyInside =
    bbox.minX >= minX && bbox.maxX <= maxX && bbox.minY >= minY && bbox.maxY <= maxY;

  if (!isCrossing) {
    return fullyInside;
  }
  if (fullyInside) return true;

  // Crossing check: bbox overlaps selection rect AND any segment/edge crosses or lies inside
  const bboxOverlaps =
    bbox.maxX >= minX && bbox.minX <= maxX && bbox.maxY >= minY && bbox.minY <= maxY;
  if (!bboxOverlaps) return false;

  const segs = getEntitySegments(entity);
  if (segs.length === 0) return true;

  const boxCorners: [Point, Point, Point, Point] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const boxEdges: Array<[Point, Point]> = [
    [boxCorners[0], boxCorners[1]],
    [boxCorners[1], boxCorners[2]],
    [boxCorners[2], boxCorners[3]],
    [boxCorners[3], boxCorners[0]],
  ];

  for (const s of segs) {
    if (
      (s.a.x >= minX && s.a.x <= maxX && s.a.y >= minY && s.a.y <= maxY) ||
      (s.b.x >= minX && s.b.x <= maxX && s.b.y >= minY && s.b.y <= maxY)
    ) {
      return true;
    }
    for (const [b1, b2] of boxEdges) {
      if (segmentIntersection(s.a, s.b, b1, b2)) return true;
    }
  }

  return false;
}

export function computeModelExtents(entities: ArchEntity[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (entities.length === 0) {
    return { minX: -120, minY: -120, maxX: 480, maxY: 360 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const e of entities) {
    const b = getEntityBoundingBox(e, entities);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (!Number.isFinite(minX)) {
    return { minX: -120, minY: -120, maxX: 480, maxY: 360 };
  }
  return { minX, minY, maxX, maxY };
}

// --- REAL ASCII DXF EXPORT (OPENS IN FREECAD / LIBRECAD / AUTOCAD) ---

import { computeRoofGeometry, roofSpecFromEntity } from './roof';
import { footingPlanOutline } from './structure';
import {
  createStarterSheets,
  exportModelToDXF,
  exportScheduleToCSV,
  exportToIFC4,
  generateSheetsPDF,
  getDoorScheduleRows,
  getRoomScheduleRows,
  getScaleRatio,
  getSheetDimensionsMm,
  getWindowScheduleRows,
  importFromDXF,
  modelInchesToSheetMm,
  scaleRoomToTargetArea,
} from './documentation';

export {
  createStarterSheets,
  exportModelToDXF,
  exportScheduleToCSV,
  exportToIFC4,
  generateSheetsPDF,
  getDoorScheduleRows,
  getRoomScheduleRows,
  getScaleRatio,
  getSheetDimensionsMm,
  getWindowScheduleRows,
  importFromDXF,
  modelInchesToSheetMm,
  scaleRoomToTargetArea,
};

export function exportToDXF(model: ArchModel, options?: { levelId?: string | 'all'; includeElevations?: boolean }): string {
  return exportModelToDXF(model, options);
}

// --- STARTER COMPONENT LIBRARY (11 ARCHITECTURAL CAD/BIM SYMBOLS) ---

export function createStarterBlocks(): BlockDefinition[] {
  const rect = (id: string, x1: number, y1: number, x2: number, y2: number): RectangleEntity => ({
    id,
    type: 'rectangle',
    layer: '0',
    p1: { x: x1, y: y1 },
    p2: { x: x2, y: y2 },
  });
  const line = (id: string, x1: number, y1: number, x2: number, y2: number): LineEntity => ({
    id,
    type: 'line',
    layer: '0',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  });
  const circle = (id: string, cx: number, cy: number, r: number): CircleEntity => ({
    id,
    type: 'circle',
    layer: '0',
    center: { x: cx, y: cy },
    radius: r,
  });
  const arc = (
    id: string,
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number
  ): ArcEntity => ({
    id,
    type: 'arc',
    layer: '0',
    center: { x: cx, y: cy },
    radius: r,
    startAngle,
    endAngle,
  });

  return [
    // 1. BED (Queen Bed: 60" W x 80" D x 28" H)
    {
      id: 'starter-bed',
      name: 'Queen Bed',
      category: 'Furniture',
      kind: 'bed',
      width: 60,
      depth: 80,
      height: 28,
      color: '#cbd5e1',
      entities: [
        rect('bed-frame', -30, -40, 30, 40),
        rect('bed-headboard', -30, -40, 30, -35),
        rect('bed-pillow-l', -26, -32, -3, -18),
        rect('bed-pillow-r', 3, -32, 26, -18),
        line('bed-sheet-1', -30, -12, 30, -12),
        line('bed-sheet-2', -30, -6, 30, -6),
      ],
    },
    // 2. SOFA (3-Seater Sofa: 84" W x 36" D x 32" H)
    {
      id: 'starter-sofa',
      name: '3-Seater Sofa',
      category: 'Furniture',
      kind: 'sofa',
      width: 84,
      depth: 36,
      height: 32,
      color: '#64748b',
      entities: [
        rect('sofa-outer', -42, -18, 42, 18),
        rect('sofa-back', -42, -18, 42, -10),
        rect('sofa-arm-l', -42, -10, -34, 18),
        rect('sofa-arm-r', 34, -10, 42, 18),
        line('sofa-cush-1', -11, -10, -11, 18),
        line('sofa-cush-2', 11, -10, 11, 18),
      ],
    },
    // 3. TABLE + CHAIRS (Dining Set: 72" W x 54" D x 30" H)
    {
      id: 'starter-table-chairs',
      name: 'Table + Chairs',
      category: 'Furniture',
      kind: 'table-chairs',
      width: 72,
      depth: 54,
      height: 30,
      color: '#b45309',
      entities: [
        rect('tbl-top', -30, -18, 30, 18),
        // Top 2 chairs
        rect('chr-t1', -22, -27, -6, -18),
        rect('chr-t2', 6, -27, 22, -18),
        // Bottom 2 chairs
        rect('chr-b1', -22, 18, -6, 27),
        rect('chr-b2', 6, 18, 22, 27),
        // Left & Right end chairs
        rect('chr-l', -36, -9, -30, 9),
        rect('chr-r', 30, -9, 36, 9),
      ],
    },
    // 4. TOILET (Water Closet: 20" W x 28" D x 30" H)
    {
      id: 'starter-toilet',
      name: 'Toilet (WC)',
      category: 'Plumbing',
      kind: 'toilet',
      width: 20,
      depth: 28,
      height: 30,
      color: '#f8fafc',
      entities: [
        rect('wc-tank', -10, -14, 10, -6),
        circle('wc-bowl-outer', 0, 4, 9),
        circle('wc-bowl-inner', 0, 4, 6),
        line('wc-seat-l', -7, -6, -8, 2),
        line('wc-seat-r', 7, -6, 8, 2),
      ],
    },
    // 5. SINK (Vanity Sink: 24" W x 20" D x 34" H)
    {
      id: 'starter-sink',
      name: 'Vanity Sink',
      category: 'Plumbing',
      kind: 'sink',
      width: 24,
      depth: 20,
      height: 34,
      color: '#e2e8f0',
      entities: [
        rect('sink-counter', -12, -10, 12, 10),
        rect('sink-basin', -9, -5, 9, 7),
        circle('sink-drain', 0, 0, 1.5),
        line('sink-faucet', 0, -9, 0, -3),
        line('sink-tap-l', -4, -7.5, 4, -7.5),
      ],
    },
    // 6. BATHTUB (Standard Tub: 60" W x 32" D x 22" H)
    {
      id: 'starter-bathtub',
      name: 'Bathtub',
      category: 'Plumbing',
      kind: 'bathtub',
      width: 60,
      depth: 32,
      height: 22,
      color: '#f1f5f9',
      entities: [
        rect('tub-outer', -30, -16, 30, 16),
        rect('tub-inner', -26, -12, 26, 12),
        circle('tub-drain', -21, 0, 1.8),
        line('tub-faucet', -29, 0, -24, 0),
      ],
    },
    // 7. KITCHEN COUNTER (Counter + Double Sink: 96" W x 25" D x 36" H)
    {
      id: 'starter-kitchen-counter',
      name: 'Kitchen Counter',
      category: 'Kitchen',
      kind: 'kitchen-counter',
      width: 96,
      depth: 25,
      height: 36,
      color: '#d6d3d1',
      entities: [
        rect('kc-top', -48, -12.5, 48, 12.5),
        rect('kc-sink-l', -15, -7, -1, 7),
        rect('kc-sink-r', 1, -7, 15, 7),
        circle('kc-drain-l', -8, 0, 1.4),
        circle('kc-drain-r', 8, 0, 1.4),
        line('kc-faucet', 0, -10, 0, -3),
      ],
    },
    // 8. FRIDGE (Refrigerator: 36" W x 32" D x 70" H)
    {
      id: 'starter-fridge',
      name: 'Refrigerator',
      category: 'Kitchen',
      kind: 'fridge',
      width: 36,
      depth: 32,
      height: 70,
      color: '#94a3b8',
      entities: [
        rect('fr-body', -18, -16, 18, 16),
        line('fr-door-gap', -18, 12, 18, 12),
        line('fr-split', 0, 12, 0, 16),
        line('fr-handle-l', -3, 17.5, -3, 16),
        line('fr-handle-r', 3, 17.5, 3, 16),
      ],
    },
    // 9. STOVE (Range / Stove: 30" W x 26" D x 36" H)
    {
      id: 'starter-stove',
      name: 'Range / Stove',
      category: 'Kitchen',
      kind: 'stove',
      width: 30,
      depth: 26,
      height: 36,
      color: '#475569',
      entities: [
        rect('stv-body', -15, -13, 15, 13),
        line('stv-panel', -15, -10, 15, -10),
        circle('stv-b1', -7.5, -3.5, 3.8),
        circle('stv-b2', 7.5, -3.5, 3.8),
        circle('stv-b3', -7.5, 6.5, 4.2),
        circle('stv-b4', 7.5, 6.5, 4.2),
      ],
    },
    // 10. STAIRS (Straight Stairs: 42" W x 120" D x 108" H)
    {
      id: 'starter-stairs',
      name: 'Stairs (Straight)',
      category: 'Architecture',
      kind: 'stairs',
      width: 42,
      depth: 120,
      height: 108,
      color: '#a8a29e',
      entities: [
        rect('str-outer', -21, -60, 21, 60),
        rect('str-rail-l', -21, -60, -18.5, 60),
        rect('str-rail-r', 18.5, -60, 21, 60),
        line('str-t1', -18.5, -48, 18.5, -48),
        line('str-t2', -18.5, -36, 18.5, -36),
        line('str-t3', -18.5, -24, 18.5, -24),
        line('str-t4', -18.5, -12, 18.5, -12),
        line('str-t5', -18.5, 0, 18.5, 0),
        line('str-t6', -18.5, 12, 18.5, 12),
        line('str-t7', -18.5, 24, 18.5, 24),
        line('str-t8', -18.5, 36, 18.5, 36),
        line('str-t9', -18.5, 48, 18.5, 48),
        // Direction arrow pointing UP (toward -Y)
        line('str-arr-shaft', 0, 48, 0, -48),
        line('str-arr-head-l', 0, -48, -6, -36),
        line('str-arr-head-r', 0, -48, 6, -36),
      ],
    },
    // 11. TREE (Deciduous Site Tree: 96" W x 96" D x 144" H)
    {
      id: 'starter-tree',
      name: 'Tree (Canopy)',
      category: 'Site',
      kind: 'tree',
      width: 96,
      depth: 96,
      height: 144,
      color: '#15803d',
      entities: [
        circle('tree-canopy', 0, 0, 48),
        circle('tree-inner', 0, 0, 34),
        circle('tree-trunk', 0, 0, 6),
        arc('tree-fol-1', -14, -14, 22, 180, 320),
        arc('tree-fol-2', 14, -14, 22, 220, 360),
        arc('tree-fol-3', 14, 14, 22, 0, 140),
        arc('tree-fol-4', -14, 14, 22, 40, 180),
        line('tree-cross-x', -14, 0, 14, 0),
        line('tree-cross-y', 0, -14, 0, 14),
      ],
    },
    // cabin & living, kitchen & bath, stairs / porches / site (parametric 3D models)
    ...createLibraryBlocks(),
  ];
}

// --- REVIT-STYLE BIM BUILDING TYPES & HELPERS ---

export function getWallTypeTotalThickness(wallType: WallType): number {
  const sum = wallType.layers.reduce(
    (acc, layer) => acc + Math.max(0.125, Number(layer.thickness) || 0),
    0
  );
  return Math.round(sum * 1000) / 1000;
}

/**
 * 4 Starter Wall Types required by prompt:
 * 1. Interior 4-1/2" (Gypsum 1/2" + Stud 3-1/2" + Gypsum 1/2" = 4.5")
 * 2. Exterior 2x6 (Gypsum 5/8" + Stud 5-1/2" + Sheathing 1/2" + Siding 3/4" = 7.375")
 * 3. Concrete 8" (Cast-in-Place Concrete 8" = 8.0")
 * 4. Glass partition (Glazing 1-1/2" = 1.5")
 */
export function createStarterWallTypes(): WallType[] {
  return [
    {
      id: 'wt-int-45',
      name: 'Interior 4-1/2"',
      defaultHeight: 108,
      layers: [
        {
          id: 'lyr-int-gyp1',
          name: 'Gypsum 1/2"',
          function: 'finish1',
          thickness: 0.5,
          color: '#e7e5e4',
        },
        {
          id: 'lyr-int-stud',
          name: 'Stud 3-1/2"',
          function: 'structure',
          thickness: 3.5,
          color: '#d6d3d1',
        },
        {
          id: 'lyr-int-gyp2',
          name: 'Gypsum 1/2"',
          function: 'finish2',
          thickness: 0.5,
          color: '#e7e5e4',
        },
      ],
    },
    {
      id: 'wt-ext-2x6',
      name: 'Exterior 2x6',
      defaultHeight: 108,
      layers: [
        {
          id: 'lyr-ext-gyp',
          name: 'Gypsum 5/8"',
          function: 'finish1',
          thickness: 0.625,
          color: '#e7e5e4',
        },
        {
          id: 'lyr-ext-stud',
          name: 'Stud 5-1/2"',
          function: 'structure',
          thickness: 5.5,
          color: '#f59e0b',
        },
        {
          id: 'lyr-ext-sheath',
          name: 'Sheathing 1/2"',
          function: 'substrate',
          thickness: 0.5,
          color: '#a8a29e',
        },
        {
          id: 'lyr-ext-siding',
          name: 'Siding 3/4"',
          function: 'finish2',
          thickness: 0.75,
          color: '#78716c',
        },
      ],
    },
    {
      id: 'wt-conc-8',
      name: 'Concrete 8"',
      defaultHeight: 108,
      layers: [
        {
          id: 'lyr-conc-core',
          name: 'Concrete 8"',
          function: 'structure',
          thickness: 8.0,
          color: '#78716c',
        },
      ],
    },
    {
      id: 'wt-cmu-8',
      name: 'CMU 8" (grouted)',
      defaultHeight: 108,
      layers: [
        {
          id: 'lyr-cmu-core',
          name: 'CMU 7-5/8"',
          function: 'structure',
          thickness: 7.625,
          color: '#9c9890',
        },
      ],
    },
    {
      id: 'wt-glass',
      name: 'Glass partition',
      defaultHeight: 108,
      isCurtainOrGlass: true,
      layers: [
        {
          id: 'lyr-glass-pane',
          name: 'Tempered Glazing 1-1/2"',
          function: 'glazing',
          thickness: 1.5,
          color: '#38bdf8',
        },
      ],
    },
    {
      id: 'wt-curtain',
      name: 'Curtain Wall (glass grid)',
      defaultHeight: 108,
      isCurtainOrGlass: true,
      layers: [
        {
          id: 'lyr-cw-unit',
          name: 'Aluminium Curtain Wall Unit 4"',
          function: 'glazing',
          thickness: 4,
          color: '#7dd3fc',
        },
      ],
    },
    // ---- cabin & log walls (stacked courses in 3D / elevation, saddle-notch corners)
    {
      id: 'wt-log-round-10',
      name: 'Full-Scribe Round Log 10"',
      defaultHeight: 108,
      log: { profile: 'round', course: 9, overhang: 14 },
      exteriorFinish: 'log-round',
      interiorFinish: 'log-interior',
      layers: [
        { id: 'lyr-log-ext', name: 'Log face (round)', function: 'finish1', thickness: 1.5, color: '#c08a55' },
        { id: 'lyr-log-core', name: 'Log core 7"', function: 'structure', thickness: 7, color: '#d2a86b' },
        { id: 'lyr-log-int', name: 'Log face (round)', function: 'finish2', thickness: 1.5, color: '#c08a55' },
      ],
    },
    {
      id: 'wt-log-d-8',
      name: 'D-Log 8" (flat interior)',
      defaultHeight: 108,
      log: { profile: 'd', course: 7.5, overhang: 0 },
      exteriorFinish: 'log-d',
      interiorFinish: 'log-interior',
      layers: [
        { id: 'lyr-dlog-ext', name: 'Log face (round)', function: 'finish1', thickness: 1.5, color: '#c08a55' },
        { id: 'lyr-dlog-core', name: 'D-log core 6-1/2"', function: 'structure', thickness: 6.5, color: '#d2a86b' },
      ],
    },
    {
      id: 'wt-log-square-8',
      name: 'Square-Chinked Appalachian Log 8"',
      defaultHeight: 108,
      log: { profile: 'square', course: 10, chinking: true, overhang: 10 },
      exteriorFinish: 'log-chinked',
      interiorFinish: 'log-interior',
      layers: [
        { id: 'lyr-sq-timber', name: 'Hewn square timber 8"', function: 'structure', thickness: 8, color: '#8a6240' },
      ],
    },
    {
      id: 'wt-cabin-bb',
      name: 'Cedar Board-and-Batten Cabin Wall',
      defaultHeight: 108,
      exteriorFinish: 'cedar-bb',
      interiorFinish: 'knotty-pine',
      layers: [
        { id: 'lyr-cbb-pine', name: 'Knotty pine T&G 3/4"', function: 'finish1', thickness: 0.75, color: '#e3c48f' },
        { id: 'lyr-cbb-stud', name: 'Stud 2x6 + insulation', function: 'structure', thickness: 5.5, color: '#f2d6a2' },
        { id: 'lyr-cbb-sheath', name: 'Sheathing 1/2"', function: 'substrate', thickness: 0.5, color: '#c9a46b' },
        { id: 'lyr-cbb-cedar', name: 'Cedar board & batten 1"', function: 'finish2', thickness: 1, color: '#a4623d' },
      ],
    },
    {
      id: 'wt-pine-lining',
      name: 'Knotty Pine T&G Interior Partition',
      defaultHeight: 108,
      interiorFinish: 'knotty-pine',
      layers: [
        { id: 'lyr-kp-1', name: 'Knotty pine T&G 3/4"', function: 'finish1', thickness: 0.75, color: '#e3c48f' },
        { id: 'lyr-kp-stud', name: 'Stud 2x4', function: 'structure', thickness: 3.5, color: '#f2d6a2' },
        { id: 'lyr-kp-2', name: 'Knotty pine T&G 3/4"', function: 'finish2', thickness: 0.75, color: '#e3c48f' },
      ],
    },
  ];
}

export function createStarterLevels(): LevelDefinition[] {
  return [
    { id: 'level-1', name: 'Level 1', elevation: 0 },
    { id: 'level-2', name: 'Level 2', elevation: 108 },
    { id: 'level-roof', name: 'Roof', elevation: 216 },
  ];
}

export function createStarterFloorTypes(): FloorType[] {
  return [
    {
      id: 'ft-wood-8',
      name: 'Wood Joist 8" - Hardwood Finish',
      thickness: 8,
      material: 'wood',
      color: '#d6c7b2',
    },
    {
      id: 'ft-conc-6',
      name: 'Concrete Structural Slab 6"',
      thickness: 6,
      material: 'concrete',
      color: '#cbd5e1',
    },
    {
      id: 'ft-stone-8',
      name: 'Stone Paver Slab 8"',
      thickness: 8,
      material: 'stone',
      color: '#d6d3d1',
    },
    {
      id: 'ft-tile-6',
      name: 'Ceramic Tile on Deck 6"',
      thickness: 6,
      material: 'tile',
      color: '#e2e8f0',
    },
  ];
}

export function createStarterColumnTypes(): ColumnType[] {
  const t = (id: string, name: string, shape: 'rectangular' | 'round', width: number, depth: number, color: string, structuralMaterialId: string, profileId?: string): ColumnType => ({ id, name, shape, width, depth, color, structuralMaterialId, profileId });
  return [
    t('ct-conc-12', 'Concrete Rectangular 12" × 12"', 'rectangular', 12, 12, '#78716c', 'conc-4000'),
    t('ct-conc-16', 'Concrete Rectangular 16" × 16"', 'rectangular', 16, 16, '#78716c', 'conc-4000'),
    t('ct-conc-round-16', 'Concrete Round Ø16"', 'round', 16, 16, '#78716c', 'conc-4000'),
    t('ct-steel-w8', 'Steel W8x31', 'rectangular', 8, 8, '#475569', 'a992', 'W8x31'),
    t('ct-steel-w10', 'Steel W10x33', 'rectangular', 7.96, 9.73, '#475569', 'a992', 'W10x33'),
    t('ct-steel-w12', 'Steel W12x40', 'rectangular', 8.01, 11.9, '#475569', 'a992', 'W12x40'),
    t('ct-steel-w14', 'Steel W14x48', 'rectangular', 8.03, 13.8, '#475569', 'a992', 'W14x48'),
    t('ct-steel-hss6', 'Steel HSS6x6x3/8 (square)', 'rectangular', 6, 6, '#475569', 'a992', 'HSS6x6x3/8'),
    t('ct-steel-round-10', 'Steel HSS8.625 round (pipe)', 'round', 8.625, 8.625, '#475569', 'a992', 'HSS8.625x0.322'),
    t('ct-timber-6', 'Wood Post 6x6', 'rectangular', 5.5, 5.5, '#b45309', 'df', '6x6'),
    t('ct-timber-8', 'Wood Post 8x8', 'rectangular', 7.5, 7.5, '#b45309', 'df', '8x8'),
    t('ct-glulam', 'Glulam Column 6-3/4" × 6-3/4"', 'rectangular', 6.75, 6.75, '#b45309', 'glulam', 'GLC-6.75x6.75'),
  ];
}

/**
 * Door type catalog (Revit-style families). Type properties (size, kind, frame, lites) apply to every
 * door of the type; sill, depth position, swing / flip and mark are per instance.
 */
function doorTypeFieldsOf(id: string): Partial<DoorEntity> {
  const t = createStarterDoorTypes().find((x) => x.id === id)!;
  return doorTypeFields(t);
}
function windowTypeFieldsOf(id: string): Partial<WindowEntity> {
  const t = createStarterWindowTypes().find((x) => x.id === id)!;
  return windowTypeFields(t);
}

export function createStarterDoorTypes(): DoorType[] {
  const d = (id: string, name: string, width: number, height: number, extra: Partial<DoorType> = {}): DoorType => ({
    id,
    name,
    width,
    height,
    kind: 'single',
    frameMaterial: 'wood',
    divisions: '1x1',
    frameWidth: 2,
    ...extra,
  });
  const H = 'hinged' as const;
  const SL = 'sliding' as const;
  const SP = 'specialty' as const;
  return [
    // ---- hinged single & double
    d('dt-36x80', 'Flush Wood 36" × 80"', 36, 80, { panelStyle: 'flush', category: H }),
    d('dt-30x80', 'Flush Wood 30" × 80"', 30, 80, { panelStyle: 'flush', category: H }),
    d('dt-32x80', 'Flush Wood 32" × 80"', 32, 80, { panelStyle: 'flush', category: H }),
    d('dt-6panel-36', '6-Panel Colonial 36" × 80"', 36, 80, { panelStyle: 'six-panel', frameMaterial: 'wood', category: H }),
    d('dt-craftsman-36', 'Craftsman 3-Lite Top Glass 36" × 80"', 36, 80, { panelStyle: 'craftsman', category: H }),
    d('dt-french-30', 'Full-Lite French Door 30" × 80"', 30, 80, { panelStyle: 'french', divisions: '2x2', category: H }),
    d('dt-double-60x80', 'Full-Lite French Double 60" × 80"', 60, 80, { kind: 'double', panelStyle: 'french', divisions: '2x2', category: H }),
    d('dt-double-flush-60', 'Double Flush 60" × 80"', 60, 80, { kind: 'double', panelStyle: 'flush', category: H }),
    d('dt-plank-36', 'Rustic Plank Cabin Door (strap hinges) 36" × 80"', 36, 80, { panelStyle: 'plank', frameMaterial: 'wood', category: H }),
    d('dt-dutch-36', 'Dutch Door (split leaf) 36" × 80"', 36, 80, { kind: 'dutch', panelStyle: 'plank', category: H }),
    d('dt-arched-42', 'Arched-Top Solid Timber Entry 42" × 96"', 42, 96, { panelStyle: 'arched', frameMaterial: 'wood', frameWidth: 3, category: H }),
    d('dt-entry-sl', 'Entry Door + Sidelights & Transom 36" (70" × 98" RO)', 70, 98, { panelStyle: 'craftsman', sidelights: 2, sidelightWidth: 12, transom: 14, category: H }),
    // ---- sliding & folding
    d('dt-pocket-30', 'Pocket Door 30" × 80"', 30, 80, { kind: 'pocket', panelStyle: 'flush', category: SL }),
    d('dt-barn-36', 'Barn Door on Black Steel Track 36" × 84"', 36, 84, { kind: 'barn', panelStyle: 'plank', frameMaterial: 'steel', category: SL }),
    d('dt-barn-bypass-72', 'Bypass Barn Doors (double) 72" × 84"', 72, 84, { kind: 'barn-bypass', panelStyle: 'plank', frameMaterial: 'steel', category: SL }),
    d('dt-slide-72x80', 'Sliding Glass Patio 2-Panel 72" × 80"', 72, 80, { kind: 'sliding', panels: 2, frameMaterial: 'aluminum', category: SL }),
    d('dt-slide-96x80', 'Sliding Glass Patio 2-Panel 96" × 80"', 96, 80, { kind: 'sliding', panels: 2, frameMaterial: 'aluminum', category: SL }),
    d('dt-patio-3', 'Sliding Glass Patio 3-Panel 108" × 80"', 108, 80, { kind: 'sliding', panels: 3, frameMaterial: 'aluminum', category: SL }),
    d('dt-patio-4', 'Sliding Glass Patio 4-Panel 144" × 80"', 144, 80, { kind: 'sliding', panels: 4, frameMaterial: 'aluminum', category: SL }),
    d('dt-multislide-4', 'Multi-Slide Stacking Glass 4-Panel 160" × 96"', 160, 96, { kind: 'multislide', panels: 4, frameMaterial: 'aluminum', category: SL }),
    d('dt-bifold-3', 'Bi-Fold Accordion Patio 3-Leaf 96" × 96"', 96, 96, { kind: 'bifold', panels: 3, panelStyle: 'french', frameMaterial: 'aluminum', category: SL }),
    d('dt-bifold-4', 'Bi-Fold Accordion Patio 4-Leaf 128" × 96"', 128, 96, { kind: 'bifold', panels: 4, panelStyle: 'french', frameMaterial: 'aluminum', category: SL }),
    d('dt-bifold-5', 'Bi-Fold Accordion Patio 5-Leaf 160" × 96"', 160, 96, { kind: 'bifold', panels: 5, panelStyle: 'french', frameMaterial: 'aluminum', category: SL }),
    d('dt-bifold-6', 'Bi-Fold Accordion Patio 6-Leaf 192" × 96"', 192, 96, { kind: 'bifold', panels: 6, panelStyle: 'french', frameMaterial: 'aluminum', category: SL }),
    // ---- specialty & utility
    d('dt-louver-bifold-48', 'Louvered Closet Bi-Fold 48" × 80"', 48, 80, { kind: 'bifold', panels: 4, panelStyle: 'louvered', category: SP }),
    d('dt-pivot-48', 'Pivot Entry Door 48" × 96"', 48, 96, { kind: 'pivot', panelStyle: 'pivot-slab', frameMaterial: 'steel', category: SP }),
    d('dt-garage-16x7', 'Garage Sectional 16\'-0" × 7\'-0"', 192, 84, { kind: 'garage', panelStyle: 'sectional', frameMaterial: 'steel', frameWidth: 3, category: SP }),
    d('dt-rollup-9x7', 'Roll-Up Garage Door 9\'-0" × 7\'-0"', 108, 84, { kind: 'garage', panelStyle: 'roll-up', frameMaterial: 'steel', frameWidth: 3, category: SP }),
    d('dt-carriage-16x7', 'Carriage-House Garage Door 16\'-0" × 7\'-0"', 192, 84, { kind: 'garage', panelStyle: 'carriage', frameMaterial: 'wood', frameWidth: 3, category: SP }),
    d('dt-screen-36', 'Cabin Door + Screen / Storm Door 36" × 80"', 36, 80, { panelStyle: 'plank', screenDoor: true, frameMaterial: 'wood', category: SP }),
    // earlier starter types (kept so existing projects still resolve)
    d('dt-36x84', 'Single Flush 36" × 84"', 36, 84),
    d('dt-30x84', 'Interior Passage 30" × 84"', 30, 84),
    d('dt-42x84', 'Entry Wide 42" × 84"', 42, 84),
  ];
}

/** Window type catalog: sliders, fixed picture, casement, double-hung and awning. */
export function createStarterWindowTypes(): WindowType[] {
  const w = (id: string, name: string, width: number, height: number, sillHeight: number, operation: WindowType['operation'], extra: Partial<WindowType> = {}): WindowType => ({
    id,
    name,
    width,
    height,
    sillHeight,
    operation,
    frameMaterial: 'vinyl',
    divisions: '1x1',
    frameWidth: 2.5,
    ...extra,
  });
  return [
    w('wnt-sl-36x48', 'Slider 36" × 48"', 36, 48, 36, 'slider'),
    w('wnt-sl-24x36', 'Slider 24" × 36"', 24, 36, 48, 'slider'),
    w('wnt-sl-48x60', 'Slider 48" × 60"', 48, 60, 24, 'slider'),
    w('wnt-sl-72x48', 'Slider 72" × 48"', 72, 48, 36, 'slider'),
    w('wnt-60x54', 'Fixed Picture 60" × 54"', 60, 54, 30, 'fixed'),
    w('wnt-48x48', 'Casement 48" × 48"', 48, 48, 36, 'casement', { divisions: '2x1' }),
    w('wnt-dh-36x60', 'Double-Hung 36" × 60"', 36, 60, 24, 'double-hung', { frameMaterial: 'wood', divisions: '2x2' }),
    w('wnt-36x36', 'Awning 36" × 36"', 36, 36, 48, 'awning'),
  ];
}

export function createDefaultVisibility(): VisibilitySettings {
  const allTrue: Record<VisibilityCategory, boolean> = {
    walls: true,
    doors: true,
    windows: true,
    floors: true,
    roofs: true,
    stairs: true,
    columns: true,
    grids: true,
    rooms: true,
    furniture: true,
    annotations: true,
    lines: true,
    structure: true,
  };
  return {
    plan2d: { ...allTrue },
    view3d: { ...allTrue },
  };
}

/**
 * Computes individual layer bands and division lines for a Wall with a compound WallType.
 * Used when zoomed in on the 2D plan view so each assembly layer is visible!
 */
export function computeWallLayerBands(
  wall: WallEntity,
  wallType: WallType,
  openings: ArchEntity[] = [],
  sameLevelWalls: WallEntity[] = [],
  wallTypes: WallType[] = []
): Array<{
  layer: WallAssemblyLayer;
  polygons: Point[][];
  dividerLine?: { start: Point; end: Point }[];
}> {
  if (!wallType || wallType.layers.length === 0) return [];
  const wallLen = dist(wall.start, wall.end);
  if (wallLen < 1) return [];

  const { leftOffset } = getWallOffsetVectors(wall);
  const totalThickness = getWallTypeTotalThickness(wallType) || wall.thickness;
  const scaleRatio = wall.thickness / Math.max(0.125, totalThickness);

  // across ranges of each layer from the location line (left face first)
  let cur = leftOffset;
  const layers = wallType.layers.map((lyr) => {
    const thick = lyr.thickness * scaleRatio;
    const r = { ...lyr, hi: cur, lo: cur - thick };
    cur -= thick;
    return r;
  });

  const hosted = openings.filter((o): o is HostedOpening => isHostedOpening(o) && o.wallId === wall.id);
  const levelWalls = sameLevelWalls.length ? sameLevelWalls : [wall];
  // X-crossings split this wall like gaps (square, no finish returns)
  const crossings = crossingCuts(wall, levelWalls).map((x) => ({ s0: x.s0, s1: x.s1, ids: [] as string[], noReturn: true }));
  const gaps = [...planCutGaps(wall, hosted).map((g) => ({ ...g, noReturn: false })), ...crossings].sort((a, b) => a.s0 - b.s0);
  const byId = new Map(hosted.map((o) => [o.id, o] as const));

  // Revit-style layer cleanup at joins: layers follow the corner cut (miter: core meets core, finish
  // meets finish); a T stem's core runs through the main wall's finish up to its core face.
  const finishOf = (w: WallEntity) => {
    const wt = wallTypes.find((t) => t.id === w.wallTypeId);
    if (!wt || wt.layers.length < 2) return { left: 0, right: 0 };
    const k = w.thickness / Math.max(0.125, getWallTypeTotalThickness(wt) || w.thickness);
    const isF = (l: WallAssemblyLayer) => l.function === 'finish1' || l.function === 'finish2';
    let left = 0;
    for (const l of wt.layers) { if (!isF(l)) break; left += l.thickness * k; }
    let right = 0;
    for (const l of [...wt.layers].reverse()) { if (!isF(l)) break; right += l.thickness * k; }
    return { left, right };
  };
  const cuts = wallEndCuts(wall, levelWalls, { finishOf });
  const wf = wallFaces(wall);
  const span = wf.lo + wf.ro;
  const endS = (which: 'start' | 'end', c: number, isCore: boolean) => {
    const cut = cuts[which];
    if (isCore && cut.kind === 'tee' && cut.tee) {
      // core runs on to the main wall's core face
      const p = add(wall.start, scale(wf.n, c));
      const x = lineIntersectionInfinite(p, add(p, wf.dir), cut.tee.coreP, add(cut.tee.coreP, cut.tee.coreD));
      if (x) return dot(sub(x, wall.start), wf.dir);
    }
    const st = cutStations(wall, cut);
    const k = span > 1e-9 ? (c + wf.ro) / span : 0.5;
    return st.right + (st.left - st.right) * k;
  };
  // T stems landing on this wall interrupt its finish on that face over the stem's core
  const finishGaps: Array<{ s0: number; s1: number; side: 'left' | 'right' }> = [];
  const myFin = finishOf(wall);
  for (const o of levelWalls) {
    if (o.id === wall.id) continue;
    for (const end of ['start', 'end'] as const) {
      const P = end === 'start' ? o.start : o.end;
      const rel = sub(P, wall.start);
      const sAlong = dot(rel, wf.dir);
      const off = dot(rel, wf.n);
      if (sAlong <= 1.5 || sAlong >= wf.L - 1.5 || off > wf.lo + 1.5 || off < -wf.ro - 1.5) continue;
      const c = wallEndCuts(o, levelWalls, { finishOf })[end];
      if (c.kind !== 'tee' || c.tee?.mainId !== wall.id) continue;
      const of = finishOf(o);
      const sL = dot(sub(c.left, wall.start), wf.dir);
      const sR = dot(sub(c.right, wall.start), wf.dir);
      const sideV = dot(sub(add(c.left, c.right), scale(wall.start, 2)), wf.n);
      const side: 'left' | 'right' = sideV > 0 ? 'left' : 'right';
      if ((side === 'left' ? myFin.left : myFin.right) <= 0) continue;
      const lo = Math.min(sL, sR);
      const hi = Math.max(sL, sR);
      const w = hi - lo;
      const ot = o.thickness || 1;
      // shrink to the stem's core (its finishes stop at the main's face)
      finishGaps.push({ s0: lo + (w * (end === 'start' ? of.right : of.left)) / ot, s1: hi - (w * (end === 'start' ? of.left : of.right)) / ot, side });
    }
  }
  const bands = layerBandsWithReturns(wall, layers, gaps, (gi) => {
    // frame plane of the (first) framed opening in this gap; finishes wrap up to it
    for (const id of gaps[gi].ids) {
      const o = byId.get(id);
      if (!o) continue;
      const fp = frameAcrossFromLocation(o, wall, levelWalls);
      if (fp !== null) return fp;
    }
    return null;
  }, { endS, finishGaps });
  return bands.map((b, i) => ({
    layer: wallType.layers[i],
    polygons: b.polygons,
    dividerLine: b.dividers.length ? b.dividers.map(([start, end]) => ({ start, end })) : undefined,
  }));
}

/**
 * Automatic riser & tread calculator for straight stairs between two building levels.
 * Enforces building code target riser <= 7.0" and standard tread = 11.0".
 */
export function computeStairParameters(
  baseElevation: number,
  topElevation: number,
  preferredTreadDepth = 11
): {
  totalRise: number;
  numRisers: number;
  riserHeight: number;
  numTreads: number;
  treadDepth: number;
  runLength: number;
} {
  const totalRise = Math.max(7, Math.abs(topElevation - baseElevation));
  const numRisers = Math.max(2, Math.ceil(totalRise / 7.0));
  const riserHeight = totalRise / numRisers;
  const numTreads = Math.max(1, numRisers - 1);
  const treadDepth = Math.max(9, preferredTreadDepth);
  const runLength = numTreads * treadDepth;
  return {
    totalRise,
    numRisers,
    riserHeight,
    numTreads,
    treadDepth,
    runLength,
  };
}

export function computeStairPlanGeometry(
  stair: StairEntity,
  options?: {
    levels?: LevelDefinition[];
    viewedFromTopLevel?: boolean;
    cutPlaneInches?: number;
  }
): StairPlanGeometry2D {
  return computeMultiRunStairPlanGeometry(stair, options);
}

/**
 * Finds all structural grid intersections for Column snapping and OSNAP.
 */
export function findGridIntersections(
  grids: GridEntity[]
): Array<{ point: Point; label: string; gridIds: [string, string] }> {
  const results: Array<{ point: Point; label: string; gridIds: [string, string] }> = [];
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      const g1 = grids[i];
      const g2 = grids[j];
      const pt = segmentIntersection(g1.start, g1.end, g2.start, g2.end);
      if (pt) {
        results.push({
          point: pt,
          label: `${g1.label}-${g2.label}`,
          gridIds: [g1.id, g2.id],
        });
      }
    }
  }
  return results;
}

/**
 * Computes an outer rectangular or polygonal footprint from a set of walls on a level,
 * with optional eave overhang (in inches) for Roof by Footprint or Floor by Walls.
 */
export function computeOuterFootprintFromWalls(
  walls: WallEntity[],
  overhang = 0
): Point[] {
  if (walls.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    for (const pt of [w.start, w.end]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 12 || maxY - minY < 12) return [];
  return [
    { x: minX - overhang, y: minY - overhang },
    { x: maxX + overhang, y: minY - overhang },
    { x: maxX + overhang, y: maxY + overhang },
    { x: minX - overhang, y: maxY + overhang },
  ];
}

// --- DEFAULT LAYERS & SAMPLE PROJECT ---

export function createDefaultLayers(): Layer[] {
  return [
    { id: '0', name: '0', color: '#44403c', visible: true, locked: false },
    { id: 'A-WALL', name: 'A-WALL', color: '#1c1917', visible: true, locked: false },
    { id: 'A-DOOR', name: 'A-DOOR', color: '#b45309', visible: true, locked: false },
    { id: 'A-GLAZ', name: 'A-GLAZ', color: '#0284c7', visible: true, locked: false },
    { id: 'A-FLOR', name: 'A-FLOR', color: '#78716c', visible: true, locked: false },
    { id: 'A-ROOF', name: 'A-ROOF', color: '#9a3412', visible: true, locked: false },
    { id: 'A-STRS', name: 'A-STRS', color: '#78716c', visible: true, locked: false },
    { id: 'S-GRID', name: 'S-GRID', color: '#0369a1', visible: true, locked: false },
    { id: 'S-COLS', name: 'S-COLS', color: '#334155', visible: true, locked: false },
    { id: 'A-FURN', name: 'A-FURN', color: '#0d9488', visible: true, locked: false },
    { id: 'A-AREA', name: 'A-AREA', color: '#15803d', visible: true, locked: false },
    { id: 'A-ANNO', name: 'A-ANNO', color: '#57534e', visible: true, locked: false },
    { id: 'S-FNDN', name: 'S-FNDN', color: '#7c2d12', visible: true, locked: false },
    { id: 'S-BEAM', name: 'S-BEAM', color: '#1e3a8a', visible: true, locked: false },
    { id: 'S-SLAB', name: 'S-SLAB', color: '#57534e', visible: true, locked: false },
    { id: 'S-REBAR', name: 'S-REBAR', color: '#b91c1c', visible: true, locked: false },
    { id: 'S-ANLY', name: 'S-ANLY', color: '#7e22ce', visible: true, locked: false },
    { id: 'A-CAMR', name: 'A-CAMR', color: '#2563eb', visible: true, locked: false },
  ];
}

export function createBlankProject(): ArchModel {
  return {
    projectName: 'Untitled Building Plan',
    layers: createDefaultLayers(),
    activeLayer: '0',
    entities: [],
    blocks: createStarterBlocks(),
    levels: createStarterLevels(),
    activeLevelId: 'level-1',
    wallTypes: createStarterWallTypes(),
    floorTypes: createStarterFloorTypes(),
    columnTypes: createStarterColumnTypes(),
    doorTypes: createStarterDoorTypes(),
    windowTypes: createStarterWindowTypes(),
    visibility: createDefaultVisibility(),
    sheets: createStarterSheets(),
    activeSheetId: 'sheet-a101',
    settings: {
      units: 'imperial',
      gridSize: 12,
      snapSize: 6,
      gridVisible: true,
      snapEnabled: true,
      orthoEnabled: false,
      osnapEnabled: true,
      polarTracking: false,
      polarIncrement: 45,
      osnapTracking: true,
      dynamicInput: true,
      enabledOsnaps: [...DEFAULT_ENABLED_OSNAPS],
      revitStyleDI: true,
      dimStyle: { ...DEFAULT_DIM_STYLE },
    },
  };
}

/**
 * Creates the initial 2-room house sample project:
 * - Outer perimeter walls: 28'-0" (336") wide x 18'-0" (216") deep
 *   - Top wall split at x = 192" (16'-0") where the interior partition meets it
 *   - Bottom wall split at x = 192" (16'-0")
 * - Interior partition wall at x = 192" dividing Living Studio (16'x18') and Bedroom (12'x18')
 * - 1 interior door on the partition wall (or exterior entry + interior door) — prompt says:
 *   "a 2-room house with walls, one door, two windows, room labels, and two dimensions"
 *   Let's include exactly the clean 2-room house with walls, 1 door connecting the rooms,
 *   2 windows on exterior walls, 2 room labels ("Living Room" and "Bedroom"), and 2 dimensions!
 */
/**
 * Small structural sample: a 3 x 2 column grid on pad footings, steel beams at Level 2,
 * one concrete beam with rebar, and a slab on grade with area reinforcement.
 * (For design visualization and coordination only — not engineered.)
 */
export function createSampleStructure(): ArchEntity[] {
  const xs: Array<[string, number]> = [['1', 0], ['2', 192], ['3', 336]];
  const ys: Array<[string, number]> = [['A', 0], ['B', 216]];
  const out: ArchEntity[] = [];
  for (const [lab, x] of xs) out.push({ id: `grid-${lab}`, type: 'grid', layer: 'S-GRID', levelId: 'level-1', start: { x, y: -60 }, end: { x, y: 276 }, label: lab, showBubbleStart: true });
  for (const [lab, y] of ys) out.push({ id: `grid-${lab}`, type: 'grid', layer: 'S-GRID', levelId: 'level-1', start: { x: -60, y }, end: { x: 396, y }, label: lab, showBubbleStart: true });
  for (const [xl, x] of xs) {
    for (const [yl, y] of ys) {
      const concrete = xl === '3';
      const id = `col-${yl}${xl}`;
      out.push({
        id, type: 'column', layer: 'S-COLS', levelId: 'level-1', position: { x, y }, rotation: 0,
        shape: 'rectangular', width: concrete ? 16 : 8, depth: concrete ? 16 : 8, height: 108, baseOffset: -6, // bears on the footing top (6" below grade)
        columnTypeId: concrete ? 'ct-conc-12' : 'ct-steel-w8', structuralMaterialId: concrete ? 'conc-4000' : 'a992',
        profileId: concrete ? undefined : 'W8x31', topLevelId: 'level-2', topOffset: 0,
      } as ColumnEntity);
      out.push({ id: `ftg-${yl}${xl}`, type: 'footing', kind: 'isolated', layer: 'S-FNDN', levelId: 'level-1', position: { x, y }, rotation: 0, length: 48, width: 48, thickness: 12, topOffset: -6, columnId: id, structuralMaterialId: 'conc-4000' });
      out.push({ id: `ar-ftg-${yl}${xl}`, type: 'areareinf', layer: 'S-REBAR', levelId: 'level-1', hostId: `ftg-${yl}${xl}`, barSize: '#5', spacing: 10, topX: false, topY: false, bottomX: true, bottomY: true });
    }
  }
  const steel = (id: string, a: Point, b: Point, profileId: string): ArchEntity => ({
    id, type: 'beam', usage: 'beam', layer: 'S-BEAM', levelId: 'level-2', start: a, end: b, structuralMaterialId: 'a992', profileId,
    width: 6, depth: 12, topOffset: 0, startOffset: 0, endOffset: 0, rotation: 0, justification: 'top',
  });
  out.push(steel('bm-A12', { x: 0, y: 0 }, { x: 192, y: 0 }, 'W12x26'));
  out.push(steel('bm-A23', { x: 192, y: 0 }, { x: 336, y: 0 }, 'W12x26'));
  out.push(steel('bm-B12', { x: 0, y: 216 }, { x: 192, y: 216 }, 'W12x26'));
  out.push(steel('bm-B23', { x: 192, y: 216 }, { x: 336, y: 216 }, 'W12x26'));
  out.push(steel('bm-1AB', { x: 0, y: 0 }, { x: 0, y: 216 }, 'W14x30'));
  out.push(steel('bm-2AB', { x: 192, y: 0 }, { x: 192, y: 216 }, 'W14x30'));
  out.push({
    id: 'bm-3AB', type: 'beam', usage: 'beam', layer: 'S-BEAM', levelId: 'level-2', start: { x: 336, y: 0 }, end: { x: 336, y: 216 },
    structuralMaterialId: 'conc-4000', width: 12, depth: 24, topOffset: 0, startOffset: 0, endOffset: 0, rotation: 0, justification: 'top',
  });
  const rb = (id: string, o: Record<string, unknown>): ArchEntity => ({ id, type: 'rebar', layer: 'S-REBAR', levelId: 'level-2', hostId: 'bm-3AB', ...o } as unknown as ArchEntity);
  out.push(rb('rb-3AB-bot', { mark: 'B1', barSize: '#6', shape: 'hook90', placement: 'bottom', layout: { rule: 'count', count: 4 } }));
  out.push(rb('rb-3AB-top', { mark: 'B2', barSize: '#5', shape: 'hook90', placement: 'top', layout: { rule: 'count', count: 2 } }));
  out.push(rb('rb-3AB-stir', { mark: 'S1', barSize: '#3', shape: 'stirrup', placement: 'stirrup', layout: { rule: 'maxSpacing', spacing: 6 } }));
  out.push({ id: 'cn-2A', type: 'connection', layer: 'S-BEAM', levelId: 'level-2', kind: 'shear-plate', memberIds: ['bm-2AB', 'col-A2'], bolts: 3 });
  out.push({
    id: 'sog-1', type: 'floor', layer: 'S-SLAB', levelId: 'level-1', polygon: [{ x: -3, y: -3 }, { x: 339, y: -3 }, { x: 339, y: 219 }, { x: -3, y: 219 }],
    thickness: 5, material: 'concrete', floorTypeId: 'ft-conc-6', structural: true, foundation: true, structuralMaterialId: 'conc-4000',
    thickenedEdge: { width: 12, depth: 8 }, vaporBarrier: true, spanAngle: 0,
  });
  out.push({ id: 'ar-sog-1', type: 'areareinf', layer: 'S-REBAR', levelId: 'level-1', hostId: 'sog-1', mark: 'S2', barSize: '#4', spacing: 12, topX: false, topY: false, bottomX: true, bottomY: true });
  out.push({ id: 'sj-1', type: 'sjoint', layer: 'S-SLAB', levelId: 'level-1', kind: 'control', hostId: 'sog-1', start: { x: 192, y: -20 }, end: { x: 192, y: 240 }, gap: 0 });
  out.push({ id: 'sec-1', type: 'section', layer: 'S-GRID', levelId: 'level-1', name: 'Section 1', start: { x: 380, y: 108 }, end: { x: -40, y: 108 }, depth: 240 });
  out.push({ id: 'sec-2', type: 'section', layer: 'S-GRID', levelId: 'level-1', name: 'Section 2', start: { x: 336, y: 260 }, end: { x: 336, y: -40 }, depth: 120 });
  return out;
}

export function createSampleProject(): ArchModel {
  // Coordinates in inches:
  // Top-left (0, 0), Top-mid (192, 0), Top-right (336, 0)
  // Bottom-left (0, 216), Bottom-mid (192, 216), Bottom-right (336, 216)
  const walls: WallEntity[] = [
    {
      id: 'wall-n1',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 0, y: 0 },
      end: { x: 192, y: 0 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-n2',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 192, y: 0 },
      end: { x: 336, y: 0 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-e',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 336, y: 0 },
      end: { x: 336, y: 216 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-s2',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 336, y: 216 },
      end: { x: 192, y: 216 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-s1',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 192, y: 216 },
      end: { x: 0, y: 216 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-w',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-ext-2x6',
      start: { x: 0, y: 216 },
      end: { x: 0, y: 0 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
    {
      id: 'wall-mid',
      type: 'wall',
      layer: 'A-WALL',
      levelId: 'level-1',
      wallTypeId: 'wt-int-45',
      start: { x: 192, y: 0 },
      end: { x: 192, y: 216 },
      thickness: 6,
      height: 108,
      baseOffset: 0,
      justification: 'center',
    },
  ];

  // Hosted openings (embedded in their walls): typed doors / windows with marks and depth positions,
  // plus one arched wall opening.
  const door: DoorEntity = {
    id: 'door-1',
    type: 'door',
    layer: 'A-DOOR',
    levelId: 'level-1',
    mark: 'D1',
    wallId: 'wall-mid',
    offset: 0.55,
    swing: 'left-in',
    depthPosition: 'center',
    ...(doorTypeFieldsOf('dt-32x80') as Pick<DoorEntity, 'width' | 'height'>),
  };
  const entryDoor: DoorEntity = {
    id: 'door-2',
    type: 'door',
    layer: 'A-DOOR',
    levelId: 'level-1',
    mark: 'D2',
    wallId: 'wall-s1',
    offset: 0.62,
    swing: 'right-in',
    depthPosition: 'exterior',
    ...(doorTypeFieldsOf('dt-36x80') as Pick<DoorEntity, 'width' | 'height'>),
  };
  const archOpening: WallOpeningEntity = {
    id: 'wo-1',
    type: 'wallopening',
    layer: 'A-WALL',
    levelId: 'level-1',
    mark: 'O1',
    wallId: 'wall-mid',
    offset: 0.2,
    width: 36,
    height: 90,
    sillHeight: 0,
    shape: 'arch',
  };

  const windows: WindowEntity[] = [
    {
      id: 'win-1',
      type: 'window',
      layer: 'A-GLAZ',
      levelId: 'level-1',
      mark: 'W1',
      wallId: 'wall-n1',
      offset: 0.5,
      sillHeight: 30,
      depthPosition: 'exterior',
      ...(windowTypeFieldsOf('wnt-60x54') as Pick<WindowEntity, 'width' | 'height'>),
    },
    {
      id: 'win-2',
      type: 'window',
      layer: 'A-GLAZ',
      levelId: 'level-1',
      mark: 'W2',
      wallId: 'wall-e',
      offset: 0.5,
      sillHeight: 36,
      depthPosition: 'center',
      ...(windowTypeFieldsOf('wnt-48x48') as Pick<WindowEntity, 'width' | 'height'>),
    },
    {
      id: 'win-3',
      type: 'window',
      layer: 'A-GLAZ',
      levelId: 'level-1',
      mark: 'W3',
      wallId: 'wall-w',
      offset: 0.5,
      sillHeight: 24,
      depthPosition: 'exterior',
      ...(windowTypeFieldsOf('wnt-dh-36x60') as Pick<WindowEntity, 'width' | 'height'>),
    },
    {
      id: 'win-4',
      type: 'window',
      layer: 'A-GLAZ',
      levelId: 'level-1',
      mark: 'W4',
      wallId: 'wall-s2',
      offset: 0.5,
      sillHeight: 36,
      depthPosition: 'center',
      ...(windowTypeFieldsOf('wnt-sl-72x48') as Pick<WindowEntity, 'width' | 'height'>),
    },
  ];

  const rooms: RoomEntity[] = [
    {
      id: 'room-living',
      type: 'room',
      layer: 'A-AREA',
      levelId: 'level-1',
      name: 'Living Room',
      wallIds: ['wall-n1', 'wall-mid', 'wall-s1', 'wall-w'],
      polygon: [
        { x: 0, y: 0 },
        { x: 192, y: 0 },
        { x: 192, y: 216 },
        { x: 0, y: 216 },
      ],
      labelPos: { x: 96, y: 108 },
      floorMaterial: 'wood',
    },
    {
      id: 'room-bedroom',
      type: 'room',
      layer: 'A-AREA',
      levelId: 'level-1',
      name: 'Bedroom',
      wallIds: ['wall-n2', 'wall-e', 'wall-s2', 'wall-mid'],
      polygon: [
        { x: 192, y: 0 },
        { x: 336, y: 0 },
        { x: 336, y: 216 },
        { x: 192, y: 216 },
      ],
      labelPos: { x: 264, y: 108 },
      floorMaterial: 'stone',
    },
  ];

  const dimensions: DimensionEntity[] = [
    {
      id: 'dim-width',
      type: 'dimension',
      dimType: 'aligned',
      layer: 'A-ANNO',
      levelId: 'level-1',
      p1: { x: 0, y: 0 },
      p2: { x: 336, y: 0 },
      offset: -28,
      association: {
        entityId1: 'wall-n1',
        ref1: 'start',
        entityId2: 'wall-n2',
        ref2: 'end',
      },
    },
    {
      id: 'dim-depth',
      type: 'dimension',
      dimType: 'aligned',
      layer: 'A-ANNO',
      levelId: 'level-1',
      p1: { x: 0, y: 216 },
      p2: { x: 0, y: 0 },
      offset: -28,
      association: {
        entityId1: 'wall-w',
        ref1: 'start',
        entityId2: 'wall-w',
        ref2: 'end',
      },
    },
  ];

  // Facade: stone base (to 3'-0") with lap siding above on the exterior walls, and the
  // north bedroom wall as a curtain-wall section.
  const facadeWalls: WallEntity[] = walls.map((w) => {
    if (w.id === 'wall-n2') {
      return {
        ...w,
        wallTypeId: 'wt-curtain',
        thickness: 4,
        curtain: { hSpacing: 54, vSpacing: 36, mullionSize: 2.5, mullionColor: '#334155', panels: { '1,0': 'door', '0,1': 'window' } },
      };
    }
    if (w.wallTypeId === 'wt-ext-2x6') {
      return { ...w, exteriorFinish: 'lap-siding', finishBands: [{ upTo: 36, finish: 'stone' }] };
    }
    return w;
  });
  // Hip roof over the 2-room house: 5:12, 1'-6" overhang, plate at the top of the 9'-0" walls
  const roof: RoofEntity = {
    id: 'roof-main',
    type: 'roof',
    layer: 'A-ROOF',
    levelId: 'level-1',
    roofVersion: 2,
    polygon: [
      { x: -3, y: -3 },
      { x: 339, y: -3 },
      { x: 339, y: 219 },
      { x: -3, y: 219 },
    ],
    roofStyle: 'hip',
    slope: (Math.atan(5 / 12) * 180) / Math.PI,
    overhang: 18,
    thickness: 8,
    baseOffset: 108,
    fasciaDepth: 8,
    gutter: true,
    material: 'asphalt-shingle',
  };

  return {
    projectName: 'Courtyard Residence — 2-Room Plan',
    layers: createDefaultLayers(),
    activeLayer: 'A-WALL',
    entities: [...rooms, ...facadeWalls, door, entryDoor, archOpening, ...windows, ...dimensions, roof, ...createSampleStructure()],
    blocks: createStarterBlocks(),
    levels: createStarterLevels(),
    activeLevelId: 'level-1',
    wallTypes: createStarterWallTypes(),
    floorTypes: createStarterFloorTypes(),
    columnTypes: createStarterColumnTypes(),
    doorTypes: createStarterDoorTypes(),
    windowTypes: createStarterWindowTypes(),
    visibility: createDefaultVisibility(),
    sheets: createStarterSheets(),
    activeSheetId: 'sheet-a101',
    settings: {
      units: 'imperial',
      gridSize: 12,
      snapSize: 6,
      gridVisible: true,
      snapEnabled: true,
      orthoEnabled: false,
      osnapEnabled: true,
      polarTracking: false,
      polarIncrement: 45,
      osnapTracking: true,
      dynamicInput: true,
      enabledOsnaps: [...DEFAULT_ENABLED_OSNAPS],
      revitStyleDI: true,
      dimStyle: { ...DEFAULT_DIM_STYLE },
    },
  };
}

/**
 * Computes a representative world anchor point for any entity so the Quick Properties
 * popup can position itself near the selected object.
 */
export function getEntityAnchorPoint(
  entity: ArchEntity,
  allEntities: ArchEntity[] = []
): Point {
  switch (entity.type) {
    case 'line':
    case 'wall':
    case 'stair':
    case 'grid':
      return midpoint(entity.start, entity.end);
    case 'dimension':
      return midpoint(entity.p1, entity.p2);
    case 'rectangle':
      return midpoint(entity.p1, entity.p2);
    case 'circle':
    case 'arc':
      return entity.center;
    case 'polyline':
      return entity.points.length > 0 ? polygonCentroid(entity.points) : { x: 0, y: 0 };
    case 'room':
      return entity.labelPos;
    case 'floor':
    case 'roof':
    case 'hatch':
      return entity.polygon.length > 0 ? polygonCentroid(entity.polygon) : { x: 0, y: 0 };
    case 'door':
    case 'window':
    case 'wallopening': {
      const host = allEntities.find(
        (e): e is WallEntity => e.type === 'wall' && e.id === entity.wallId
      );
      if (host) return lerpPoint(host.start, host.end, entity.offset);
      return { x: 0, y: 0 };
    }
    case 'text':
    case 'tag':
    case 'block':
    case 'column':
      return entity.position;
    case 'leader':
      return entity.landingPoint;
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Generates a realistic 2,000-object architectural + CAD stress-test dataset
 * (walls, rooms, doors, windows, columns, furniture blocks, lines, circles, dimensions)
 * for benchmarking 2D SVG memoization, OSNAP spatial culling, and incremental 3D updates.
 */
export function createStressTestEntities(
  count = 2000,
  levelId = 'level-1'
): ArchEntity[] {
  const result: ArchEntity[] = [];
  const cols = 40;
  const cellW = 72; // 6 ft grid cells
  const cellH = 72;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const bx = col * cellW;
    const by = row * cellH;
    const mod = i % 6;

    if (mod === 0) {
      result.push({
        id: `stress-wall-${i}`,
        type: 'wall',
        layer: 'A-WALL',
        levelId,
        wallTypeId: 'wt-int-45',
        start: { x: bx, y: by },
        end: { x: bx + 60, y: by },
        thickness: 4.5,
        height: 108,
        baseOffset: 0,
        justification: 'center',
      });
    } else if (mod === 1) {
      result.push({
        id: `stress-line-${i}`,
        type: 'line',
        layer: 'A-DETL',
        levelId,
        start: { x: bx + 6, y: by + 12 },
        end: { x: bx + 54, y: by + 48 },
      });
    } else if (mod === 2) {
      result.push({
        id: `stress-rect-${i}`,
        type: 'rectangle',
        layer: 'A-FURN',
        levelId,
        p1: { x: bx + 10, y: by + 10 },
        p2: { x: bx + 46, y: by + 40 },
      });
    } else if (mod === 3) {
      result.push({
        id: `stress-circle-${i}`,
        type: 'circle',
        layer: 'A-DETL',
        levelId,
        center: { x: bx + 30, y: by + 30 },
        radius: 14,
      });
    } else if (mod === 4) {
      result.push({
        id: `stress-col-${i}`,
        type: 'column',
        layer: 'A-WALL',
        levelId,
        columnTypeId: 'ct-rect-12',
        position: { x: bx + 30, y: by + 30 },
        rotation: 0,
        shape: 'rectangular',
        width: 12,
        depth: 12,
        height: 108,
      });
    } else {
      result.push({
        id: `stress-text-${i}`,
        type: 'text',
        layer: 'A-ANNO',
        levelId,
        position: { x: bx + 12, y: by + 30 },
        text: `M-${i}`,
        fontSize: 8,
        rotation: 0,
        alignment: 'left',
      });
    }
  }

  return result;
}



// --- ROOF GRIPS (overhang & ridge height) ---

/** Plan positions of a roof's overhang grip (mid eave of the first sloped edge) and ridge-height
 *  handle (drawn above the highest ridge point by the roof's rise, so dragging it up raises the ridge). */
export function roofHandles(roof: RoofEntity): {
  overhang?: { point: Point; edge: number };
  ridge?: { point: Point; base: Point; rise: number; run: number };
} {
  const g = computeRoofGeometry(roofSpecFromEntity(roof, 0));
  const out: ReturnType<typeof roofHandles> = {};
  const n = g.outline.length;
  const e = Math.max(0, g.flags.findIndex((f) => f));
  if (n >= 3) {
    out.overhang = { point: midpoint(g.outline[e], g.outline[(e + 1) % n]), edge: e };
  }
  if (g.style !== 'flat' && g.slopeDeg > 0.5) {
    let top = g.faces[0]?.pts[0];
    for (const f of g.faces) for (const p of f.pts) if (!top || p.z > top.z) top = p;
    if (top) {
      const rise = top.z - g.baseZ;
      const run = rise / Math.tan((g.slopeDeg * Math.PI) / 180);
      out.ridge = { point: { x: top.x, y: top.y - Math.max(12, rise) }, base: { x: top.x, y: top.y }, rise, run };
    }
  }
  return out;
}

export function applyRoofHandle(roof: RoofEntity, grip: 'overhang' | 'ridge', p: Point): RoofEntity {
  const h = roofHandles(roof);
  if (grip === 'overhang' && h.overhang) {
    const g = computeRoofGeometry(roofSpecFromEntity(roof, 0));
    const fp = g.footprint;
    const e = h.overhang.edge;
    const a = fp[e];
    const b = fp[(e + 1) % fp.length];
    const d = normalize(sub(b, a));
    const outward = { x: d.y, y: -d.x };
    const over = (p.x - a.x) * outward.x + (p.y - a.y) * outward.y;
    return { ...roof, overhang: Math.round(Math.max(0, Math.min(96, over))) };
  }
  if (grip === 'ridge' && h.ridge && h.ridge.run > 1) {
    const rise = Math.max(6, h.ridge.base.y - p.y);
    const deg = (Math.atan(rise / h.ridge.run) * 180) / Math.PI;
    return { ...roof, slope: Math.round(Math.min(75, Math.max(2, deg)) * 100) / 100 };
  }
  return roof;
}
