import {
  ArchEntity,
  ArcEntity,
  CircleEntity,
  DimensionEntity,
  DoorEntity,
  LineEntity,
  Point,
  PolylineEntity,
  RectangleEntity,
  WallEntity,
  WindowEntity,
} from '../types/model';
import {
  add,
  dist,
  dot,
  cross,
  lerpPoint,
  normalize,
  projectPointOnSegment,
  scale,
  sub,
  angleDegRaw,
  Segment,
} from './geometry';

// ============================================================================
// TYPES & OPTIONS
// ============================================================================

export type TrimExtendMode = 'quick' | 'standard';
export type EdgeExtensionMode = 'extend' | 'noextend';
export type WallFaceTrimMode = 'face' | 'centerline';

export interface TrimExtendOptions {
  mode?: TrimExtendMode; // default 'quick'
  edge?: EdgeExtensionMode; // default 'noextend'
  wallFaceMode?: WallFaceTrimMode; // default 'face'
  implied?: boolean;
}

export interface IntersectionResult {
  point: Point;
  paramA: number; // t in [0..1] for line/segment, angleDeg in [0..360) for arc/circle
  paramB: number;
}

export interface TrimResult {
  action: 'replaced' | 'deleted' | 'none';
  entities: ArchEntity[]; // replacement entities if 'replaced', empty if 'deleted' or 'none'
  removedPiece?: {
    type: 'line' | 'arc';
    start?: Point;
    end?: Point;
    center?: Point;
    radius?: number;
    startAngle?: number;
    endAngle?: number;
  };
  warnings?: string[];
  updatedOpenings?: (DoorEntity | WindowEntity)[];
}

export interface ExtendResult {
  extendedEntity: ArchEntity;
  extensionSegment?: {
    type: 'line' | 'arc';
    start?: Point;
    end?: Point;
    center?: Point;
    radius?: number;
    startAngle?: number;
    endAngle?: number;
  };
}

// ============================================================================
// ANGLE & CIRCULAR GEOMETRY HELPERS
// ============================================================================

/** Normalizes an angle into [0, 360) degrees */
export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Tests if testAngle (degrees) lies on counter-clockwise arc from startAngle to endAngle.
 */
export function isAngleOnArc(
  testAngle: number,
  startAngle: number,
  endAngle: number,
  tol = 1e-4
): boolean {
  const t = normalizeAngleDeg(testAngle);
  const s = normalizeAngleDeg(startAngle);
  const e = normalizeAngleDeg(endAngle);

  if (Math.abs(s - e) < tol) {
    return true; // full circle or zero-arc
  }
  if (s < e) {
    return t >= s - tol && t <= e + tol;
  }
  // Arc wraps through 0 degrees
  return t >= s - tol || t <= e + tol;
}

/**
 * Returns angular length of an arc in degrees counter-clockwise.
 */
export function arcSweepAngle(startAngle: number, endAngle: number): number {
  const s = normalizeAngleDeg(startAngle);
  const e = normalizeAngleDeg(endAngle);
  if (e >= s) return e - s;
  return 360 - (s - e);
}

// ============================================================================
// PRIMITIVE INTERSECTION FUNCTIONS (Pure Functions)
// ============================================================================

/**
 * Intersects two line segments P1-P2 and P3-P4.
 * Returns intersection point and parameters s, t along each line.
 */
export function lineLineIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
  impliedA = false,
  impliedB = false,
  tol = 1e-5
): IntersectionResult | null {
  const dx12 = p2.x - p1.x;
  const dy12 = p2.y - p1.y;
  const dx34 = p4.x - p3.x;
  const dy34 = p4.y - p3.y;

  const denom = dx12 * dy34 - dy12 * dx34;
  if (Math.abs(denom) < 1e-9) {
    return null; // parallel or collinear
  }

  const dx13 = p1.x - p3.x;
  const dy13 = p1.y - p3.y;

  const s = (dx12 * dy13 - dy12 * dx13) / denom;
  const t = (dx34 * dy13 - dy34 * dx13) / denom;

  const validA = impliedA || (t >= -tol && t <= 1 + tol);
  const validB = impliedB || (s >= -tol && s <= 1 + tol);

  if (!validA || !validB) return null;

  const pt: Point = {
    x: p1.x + t * dx12,
    y: p1.y + t * dy12,
  };

  return { point: pt, paramA: t, paramB: s };
}

/**
 * Intersects a line segment P1-P2 with a circle.
 */
export function lineCircleIntersection(
  p1: Point,
  p2: Point,
  center: Point,
  radius: number,
  impliedLine = false,
  tol = 1e-5
): IntersectionResult[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;

  const a = dx * dx + dy * dy;
  if (a < 1e-9) return [];

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let disc = b * b - 4 * a * c;
  if (disc < -1e-7) return [];
  if (disc < 0) disc = 0;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  const results: IntersectionResult[] = [];
  const candidateTs = Math.abs(t1 - t2) < 1e-6 ? [t1] : [t1, t2];

  for (const t of candidateTs) {
    if (impliedLine || (t >= -tol && t <= 1 + tol)) {
      const pt: Point = {
        x: p1.x + t * dx,
        y: p1.y + t * dy,
      };
      const ang = normalizeAngleDeg(angleDegRaw(center, pt));
      results.push({ point: pt, paramA: t, paramB: ang });
    }
  }

  return results;
}

/**
 * Intersects two circles.
 */
export function circleCircleIntersection(
  c1: Point,
  r1: number,
  c2: Point,
  r2: number
): IntersectionResult[] {
  const d = dist(c1, c2);
  if (d < 1e-7 || d > r1 + r2 + 1e-5 || d < Math.abs(r1 - r2) - 1e-5) {
    return [];
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));

  const p0: Point = {
    x: c1.x + (a * (c2.x - c1.x)) / d,
    y: c1.y + (a * (c2.y - c1.y)) / d,
  };

  const rx = -(c2.y - c1.y) * (h / d);
  const ry = (c2.x - c1.x) * (h / d);

  const pts: Point[] =
    h < 1e-6
      ? [p0]
      : [
          { x: p0.x + rx, y: p0.y + ry },
          { x: p0.x - rx, y: p0.y - ry },
        ];

  return pts.map((pt) => ({
    point: pt,
    paramA: normalizeAngleDeg(angleDegRaw(c1, pt)),
    paramB: normalizeAngleDeg(angleDegRaw(c2, pt)),
  }));
}

// ============================================================================
// GENERAL ENTITY SEGMENT / INTERSECTION EXTRACTION
// ============================================================================

export function getEntityCenterlineSegments(ent: ArchEntity): Segment[] {
  switch (ent.type) {
    case 'line':
      return [{ a: ent.start, b: ent.end, entityId: ent.id }];
    case 'wall':
      return [{ a: ent.start, b: ent.end, entityId: ent.id }];
    case 'polyline': {
      const segs: Segment[] = [];
      const pts = ent.points;
      const count = ent.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        segs.push({
          a: pts[i],
          b: pts[(i + 1) % pts.length],
          entityId: ent.id,
        });
      }
      return segs;
    }
    case 'rectangle': {
      const p1 = ent.p1;
      const p2 = ent.p2;
      const c1: Point = { x: p2.x, y: p1.y };
      const c2: Point = { x: p1.x, y: p2.y };
      return [
        { a: p1, b: c1, entityId: ent.id },
        { a: c1, b: p2, entityId: ent.id },
        { a: p2, b: c2, entityId: ent.id },
        { a: c2, b: p1, entityId: ent.id },
      ];
    }
    default:
      return [];
  }
}

/**
 * Returns all boundary/cutting segments for a wall, including both outer faces and centerline.
 */
export function getWallAllSegments(wall: WallEntity, faceOnly = false): Segment[] {
  const half = (wall.thickness || 6) / 2;
  const d = sub(wall.end, wall.start);
  const len = dist(wall.start, wall.end);
  if (len < 1e-5) return [];

  const perp = { x: -d.y / len, y: d.x / len };

  const face1A = add(wall.start, scale(perp, half));
  const face1B = add(wall.end, scale(perp, half));
  const face2A = add(wall.start, scale(perp, -half));
  const face2B = add(wall.end, scale(perp, -half));

  const list: Segment[] = [
    { a: face1A, b: face1B, entityId: wall.id },
    { a: face2A, b: face2B, entityId: wall.id },
  ];
  if (!faceOnly) {
    list.push({ a: wall.start, b: wall.end, entityId: wall.id });
  }
  return list;
}

/**
 * Pure function: calculates all intersection points between two entities a and b.
 * Supports line/line, line/arc, line/circle, arc/arc, arc/circle, circle/circle, polyline, rectangle, wall.
 */
export function intersections(
  a: ArchEntity,
  b: ArchEntity,
  options?: { implied?: boolean; impliedA?: boolean; impliedB?: boolean }
): IntersectionResult[] {
  if (a.id === b.id) return [];

  const impliedA = options?.impliedA ?? options?.implied ?? false;
  const impliedB = options?.impliedB ?? options?.implied ?? false;

  // 1. Line/Wall with Line/Wall
  const isALineLike = a.type === 'line' || a.type === 'wall';
  const isBLineLike = b.type === 'line' || b.type === 'wall';

  if (isALineLike && isBLineLike) {
    const la = a as LineEntity | WallEntity;
    const lb = b as LineEntity | WallEntity;
    const hit = lineLineIntersection(
      la.start,
      la.end,
      lb.start,
      lb.end,
      impliedA,
      impliedB
    );
    return hit ? [hit] : [];
  }

  // 2. Line/Wall with Circle/Arc
  if (isALineLike && (b.type === 'circle' || b.type === 'arc')) {
    const la = a as LineEntity | WallEntity;
    const c = b as CircleEntity | ArcEntity;
    const hits = lineCircleIntersection(
      la.start,
      la.end,
      c.center,
      c.radius,
      impliedA
    );
    if (b.type === 'arc') {
      const arc = b as ArcEntity;
      return hits.filter((h) =>
        impliedB || isAngleOnArc(h.paramB, arc.startAngle, arc.endAngle)
      );
    }
    return hits;
  }

  // 3. Circle/Arc with Line/Wall
  if ((a.type === 'circle' || a.type === 'arc') && isBLineLike) {
    const c = a as CircleEntity | ArcEntity;
    const lb = b as LineEntity | WallEntity;
    const hits = lineCircleIntersection(
      lb.start,
      lb.end,
      c.center,
      c.radius,
      impliedB
    );
    const flipped = hits.map((h) => ({
      point: h.point,
      paramA: h.paramB,
      paramB: h.paramA,
    }));
    if (a.type === 'arc') {
      const arc = a as ArcEntity;
      return flipped.filter((h) =>
        impliedA || isAngleOnArc(h.paramA, arc.startAngle, arc.endAngle)
      );
    }
    return flipped;
  }

  // 4. Circle/Arc with Circle/Arc
  if (
    (a.type === 'circle' || a.type === 'arc') &&
    (b.type === 'circle' || b.type === 'arc')
  ) {
    const c1 = a as CircleEntity | ArcEntity;
    const c2 = b as CircleEntity | ArcEntity;
    let hits = circleCircleIntersection(c1.center, c1.radius, c2.center, c2.radius);
    if (a.type === 'arc') {
      const arc1 = a as ArcEntity;
      hits = hits.filter((h) =>
        impliedA || isAngleOnArc(h.paramA, arc1.startAngle, arc1.endAngle)
      );
    }
    if (b.type === 'arc') {
      const arc2 = b as ArcEntity;
      hits = hits.filter((h) =>
        impliedB || isAngleOnArc(h.paramB, arc2.startAngle, arc2.endAngle)
      );
    }
    return hits;
  }

  // 5. Compound / Multi-segment entities (Polyline, Rectangle)
  const segsA = getEntityCenterlineSegments(a);
  const segsB = getEntityCenterlineSegments(b);

  if (segsA.length > 0 && segsB.length > 0) {
    const hits: IntersectionResult[] = [];
    for (let i = 0; i < segsA.length; i++) {
      for (let j = 0; j < segsB.length; j++) {
        const hit = lineLineIntersection(
          segsA[i].a,
          segsA[i].b,
          segsB[j].a,
          segsB[j].b,
          impliedA,
          impliedB
        );
        if (hit) {
          hits.push({
            point: hit.point,
            paramA: i + hit.paramA,
            paramB: j + hit.paramB,
          });
        }
      }
    }
    return hits;
  }

  // Mixed compound with single segment or arc
  if (segsA.length > 0) {
    const hits: IntersectionResult[] = [];
    for (let i = 0; i < segsA.length; i++) {
      const fakeLine: LineEntity = {
        id: `${a.id}-seg-${i}`,
        type: 'line',
        layer: a.layer,
        start: segsA[i].a,
        end: segsA[i].b,
      };
      const subHits = intersections(fakeLine, b, { impliedA, impliedB });
      for (const sh of subHits) {
        hits.push({ ...sh, paramA: i + sh.paramA });
      }
    }
    return hits;
  }

  if (segsB.length > 0) {
    const hits: IntersectionResult[] = [];
    for (let j = 0; j < segsB.length; j++) {
      const fakeLine: LineEntity = {
        id: `${b.id}-seg-${j}`,
        type: 'line',
        layer: b.layer,
        start: segsB[j].a,
        end: segsB[j].b,
      };
      const subHits = intersections(a, fakeLine, { impliedA, impliedB });
      for (const sh of subHits) {
        hits.push({ ...sh, paramB: j + sh.paramB });
      }
    }
    return hits;
  }

  return [];
}

// ============================================================================
// BIM WALL SPLITTING & OPENING RETENTION
// ============================================================================

/**
 * When trimming/splitting a wall into one or more pieces, maps hosted doors and windows
 * onto the surviving wall segments. If an opening falls in a removed gap or outside,
 * keeps the opening on the closest segment and generates a user warning.
 */
export function splitWallPreservingOpenings(
  originalWall: WallEntity,
  remainingIntervals: [number, number][],
  allEntities: ArchEntity[]
): {
  newWalls: WallEntity[];
  updatedOpenings: (DoorEntity | WindowEntity)[];
  warnings: string[];
} {
  const S = originalWall.start;
  const E = originalWall.end;

  const newWalls: WallEntity[] = remainingIntervals.map(([t0, t1], i) => ({
    ...originalWall,
    id: i === 0 ? originalWall.id : `wall-split-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`,
    start: lerpPoint(S, E, t0),
    end: lerpPoint(S, E, t1),
  }));

  const hostedDoors = allEntities.filter(
    (e): e is DoorEntity => e.type === 'door' && e.wallId === originalWall.id
  );
  const hostedWindows = allEntities.filter(
    (e): e is WindowEntity => e.type === 'window' && e.wallId === originalWall.id
  );

  const updatedOpenings: (DoorEntity | WindowEntity)[] = [];
  const warnings: string[] = [];

  const wallLen = dist(S, E);

  for (const op of [...hostedDoors, ...hostedWindows]) {
    const opPos = lerpPoint(S, E, op.offset);
    const opT = op.offset;

    // Check if opT falls into one of the surviving intervals
    let assignedWall: WallEntity | null = null;
    let assignedT0 = 0;
    let assignedT1 = 1;
    for (let i = 0; i < remainingIntervals.length; i++) {
      const [t0, t1] = remainingIntervals[i];
      if (opT >= t0 - 0.01 && opT <= t1 + 0.01) {
        assignedWall = newWalls[i];
        assignedT0 = t0;
        assignedT1 = t1;
        break;
      }
    }

    if (assignedWall) {
      const segSpan = Math.max(1e-4, assignedT1 - assignedT0);
      const newOffset = Math.max(0.02, Math.min(0.98, (opT - assignedT0) / segSpan));
      updatedOpenings.push({
        ...op,
        wallId: assignedWall.id,
        offset: newOffset,
      });
    } else if (newWalls.length > 0) {
      // Opening was in the trimmed gap! Re-assign to nearest surviving piece and warn
      let closestWall = newWalls[0];
      let minDist = dist(opPos, closestWall.start);
      for (const w of newWalls) {
        const d1 = dist(opPos, w.start);
        const d2 = dist(opPos, w.end);
        const dMin = Math.min(d1, d2);
        if (dMin < minDist) {
          minDist = dMin;
          closestWall = w;
        }
      }
      warnings.push(
        `Warning: Hosted ${op.type === 'door' ? 'Door' : 'Window'} at (${Math.round(
          opPos.x
        )}, ${Math.round(
          opPos.y
        )}) fell outside the trimmed wall boundary and was retained.`
      );
      updatedOpenings.push({
        ...op,
        wallId: closestWall.id,
        offset: 0.5,
      });
    }
  }

  return { newWalls, updatedOpenings, warnings };
}

// ============================================================================
// TRIM ALGORITHM (AutoCAD 2021+ Quick & Standard)
// ============================================================================

/**
 * Trims `target` at `pickPoint` using `edges` as cutting edges.
 * In Quick mode, if target crosses nothing, deletes the whole object.
 */
export function trimAt(
  target: ArchEntity,
  pickPoint: Point,
  edges: ArchEntity[],
  modeOrOptions: TrimExtendMode | TrimExtendOptions = 'quick',
  allModelEntities: ArchEntity[] = [],
  options?: TrimExtendOptions
): TrimResult {
  const resolvedOpts: TrimExtendOptions =
    typeof modeOrOptions === 'string'
      ? { mode: modeOrOptions, ...(options || {}) }
      : modeOrOptions;
  const isQuick = resolvedOpts.mode !== 'standard';
  const implied = resolvedOpts.edge === 'extend' || resolvedOpts.implied;

  // 1. Collect all cutting points along target
  const cuttingEdges = edges.filter((e) => e.id !== target.id);

  // Line / Wall trimming
  if (target.type === 'line' || target.type === 'wall') {
    const S = target.start;
    const E = target.end;
    const len = dist(S, E);
    if (len < 1e-4) return { action: 'none', entities: [target] };

    const tList: number[] = [];

    for (const edge of cuttingEdges) {
      // For walls, also check face segments as well as centerlines
      if (edge.type === 'wall' && resolvedOpts.wallFaceMode === 'face') {
        const faceSegs = getWallAllSegments(edge, false);
        for (const fs of faceSegs) {
          const hit = lineLineIntersection(S, E, fs.a, fs.b, false, implied);
          if (hit && hit.paramA > 0.005 && hit.paramA < 0.995) {
            tList.push(hit.paramA);
          }
        }
        continue;
      }

      const hits = intersections(target, edge, { impliedB: implied });
      for (const h of hits) {
        if (h.paramA > 0.005 && h.paramA < 0.995) {
          tList.push(h.paramA);
        }
      }
    }

    // If crosses nothing
    if (tList.length === 0) {
      if (isQuick) {
        return { action: 'deleted', entities: [] };
      }
      return { action: 'none', entities: [target] };
    }

    tList.sort((a, b) => a - b);
    const uniqueT: number[] = [];
    for (const t of tList) {
      if (
        uniqueT.length === 0 ||
        Math.abs(t - uniqueT[uniqueT.length - 1]) > 0.005
      ) {
        uniqueT.push(t);
      }
    }

    const intervals: [number, number][] = [];
    let prevT = 0;
    for (const t of uniqueT) {
      intervals.push([prevT, t]);
      prevT = t;
    }
    intervals.push([prevT, 1]);

    const clickProj = projectPointOnSegment(pickPoint, S, E);
    const clickT = clickProj.t;

    let clickedIdx = -1;
    let minD = Infinity;
    for (let i = 0; i < intervals.length; i++) {
      const [t0, t1] = intervals[i];
      if (clickT >= t0 && clickT <= t1) {
        clickedIdx = i;
        break;
      }
      const midT = (t0 + t1) / 2;
      const d = Math.abs(clickT - midT);
      if (d < minD) {
        minD = d;
        clickedIdx = i;
      }
    }

    if (clickedIdx === -1) return { action: 'none', entities: [target] };

    const removedInterval = intervals[clickedIdx];
    const unmerged = intervals.filter((_, idx) => idx !== clickedIdx);

    // Merge contiguous surviving intervals so an untrimmed line/wall isn't split at untouched cutting edges
    const remainingIntervals: [number, number][] = [];
    for (const [t0, t1] of unmerged) {
      if (
        remainingIntervals.length > 0 &&
        Math.abs(remainingIntervals[remainingIntervals.length - 1][1] - t0) < 1e-4
      ) {
        remainingIntervals[remainingIntervals.length - 1][1] = t1;
      } else {
        remainingIntervals.push([t0, t1]);
      }
    }

    const removedPiece = {
      type: 'line' as const,
      start: lerpPoint(S, E, removedInterval[0]),
      end: lerpPoint(S, E, removedInterval[1]),
    };

    if (remainingIntervals.length === 0) {
      return {
        action: 'deleted',
        entities: [],
        removedPiece,
      };
    }

    if (target.type === 'wall') {
      const { newWalls, updatedOpenings, warnings } = splitWallPreservingOpenings(
        target,
        remainingIntervals,
        allModelEntities
      );
      return {
        action: 'replaced',
        entities: newWalls,
        removedPiece,
        updatedOpenings,
        warnings,
      };
    }

    // Standard LineEntity
    const remainingLines: LineEntity[] = remainingIntervals.map(([t0, t1], i) => ({
      ...target,
      id: i === 0 ? target.id : `line-trim-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`,
      start: lerpPoint(S, E, t0),
      end: lerpPoint(S, E, t1),
    }));

    return {
      action: 'replaced',
      entities: remainingLines,
      removedPiece,
    };
  }

  // Arc trimming
  if (target.type === 'arc') {
    const arc = target;
    const angleList: number[] = [];

    for (const edge of cuttingEdges) {
      const hits = intersections(arc, edge, { impliedB: implied });
      for (const h of hits) {
        if (isAngleOnArc(h.paramA, arc.startAngle, arc.endAngle)) {
          angleList.push(h.paramA);
        }
      }
    }

    if (angleList.length === 0) {
      if (isQuick) return { action: 'deleted', entities: [] };
      return { action: 'none', entities: [target] };
    }

    // Sort angles counter-clockwise from startAngle
    const sweep = arcSweepAngle(arc.startAngle, arc.endAngle);
    const sorted = angleList
      .map((ang) => ({ ang, delta: arcSweepAngle(arc.startAngle, ang) }))
      .filter((item) => item.delta > 0.05 && item.delta < sweep - 0.05)
      .sort((a, b) => a.delta - b.delta);

    if (sorted.length === 0) {
      if (isQuick) return { action: 'deleted', entities: [] };
      return { action: 'none', entities: [target] };
    }

    const intervals: [number, number][] = [];
    let curAng = arc.startAngle;
    for (const item of sorted) {
      intervals.push([curAng, item.ang]);
      curAng = item.ang;
    }
    intervals.push([curAng, arc.endAngle]);

    const clickAng = normalizeAngleDeg(angleDegRaw(arc.center, pickPoint));
    let clickedIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < intervals.length; i++) {
      const [a0, a1] = intervals[i];
      if (isAngleOnArc(clickAng, a0, a1)) {
        clickedIdx = i;
        break;
      }
      const midAng = normalizeAngleDeg(a0 + arcSweepAngle(a0, a1) / 2);
      const diff = Math.abs(arcSweepAngle(midAng, clickAng));
      if (diff < minDiff) {
        minDiff = diff;
        clickedIdx = i;
      }
    }

    if (clickedIdx === -1) return { action: 'none', entities: [target] };

    const removedInterval = intervals[clickedIdx];
    const unmergedArcs = intervals.filter((_, idx) => idx !== clickedIdx);

    // Merge contiguous surviving arc intervals
    const remainingIntervals: [number, number][] = [];
    for (const [a0, a1] of unmergedArcs) {
      if (
        remainingIntervals.length > 0 &&
        Math.abs(remainingIntervals[remainingIntervals.length - 1][1] - a0) < 1e-3
      ) {
        remainingIntervals[remainingIntervals.length - 1][1] = a1;
      } else {
        remainingIntervals.push([a0, a1]);
      }
    }

    const removedPiece = {
      type: 'arc' as const,
      center: arc.center,
      radius: arc.radius,
      startAngle: removedInterval[0],
      endAngle: removedInterval[1],
    };

    if (remainingIntervals.length === 0) {
      return { action: 'deleted', entities: [], removedPiece };
    }

    const remainingArcs: ArcEntity[] = remainingIntervals.map(([a0, a1], i) => ({
      ...arc,
      id: i === 0 ? arc.id : `arc-trim-${Date.now()}-${i}`,
      startAngle: a0,
      endAngle: a1,
    }));

    return { action: 'replaced', entities: remainingArcs, removedPiece };
  }

  // Circle trimming: requires at least two intersections and leaves an Arc!
  if (target.type === 'circle') {
    const circle = target;
    const angleList: number[] = [];

    for (const edge of cuttingEdges) {
      const hits = intersections(circle, edge, { impliedB: implied });
      for (const h of hits) {
        angleList.push(h.paramA);
      }
    }

    if (angleList.length < 2) {
      if (isQuick && angleList.length === 0) {
        return { action: 'deleted', entities: [] };
      }
      return { action: 'none', entities: [target] };
    }

    angleList.sort((a, b) => a - b);
    const uniqueAngles: number[] = [];
    for (const a of angleList) {
      if (
        uniqueAngles.length === 0 ||
        Math.abs(a - uniqueAngles[uniqueAngles.length - 1]) > 0.05
      ) {
        uniqueAngles.push(a);
      }
    }

    if (uniqueAngles.length < 2) {
      return { action: 'none', entities: [target] };
    }

    // Build circular intervals
    const intervals: [number, number][] = [];
    for (let i = 0; i < uniqueAngles.length; i++) {
      intervals.push([
        uniqueAngles[i],
        uniqueAngles[(i + 1) % uniqueAngles.length],
      ]);
    }

    const clickAng = normalizeAngleDeg(angleDegRaw(circle.center, pickPoint));
    let clickedIdx = -1;
    for (let i = 0; i < intervals.length; i++) {
      const [a0, a1] = intervals[i];
      if (isAngleOnArc(clickAng, a0, a1)) {
        clickedIdx = i;
        break;
      }
    }

    if (clickedIdx === -1) clickedIdx = 0;

    const removedInterval = intervals[clickedIdx];
    // Remaining portion on a 2-cut circle is [a1, a0]
    const survivingStart = removedInterval[1];
    const survivingEnd = removedInterval[0];

    const resultingArc: ArcEntity = {
      id: `arc-cut-${Date.now()}`,
      type: 'arc',
      layer: circle.layer,
      center: circle.center,
      radius: circle.radius,
      startAngle: survivingStart,
      endAngle: survivingEnd,
    };

    return {
      action: 'replaced',
      entities: [resultingArc],
      removedPiece: {
        type: 'arc',
        center: circle.center,
        radius: circle.radius,
        startAngle: removedInterval[0],
        endAngle: removedInterval[1],
      },
    };
  }

  // Closed polyline or Rectangle: opens into an open Polyline
  if (target.type === 'rectangle' || (target.type === 'polyline' && target.closed)) {
    const pts: Point[] =
      target.type === 'rectangle'
        ? [
            target.p1,
            { x: target.p2.x, y: target.p1.y },
            target.p2,
            { x: target.p1.x, y: target.p2.y },
          ]
        : target.points;

    // Convert into open polyline
    const openPoly: PolylineEntity = {
      id: `poly-opened-${Date.now()}`,
      type: 'polyline',
      layer: target.layer,
      points: [...pts, pts[0]],
      closed: false,
    };

    return trimAt(openPoly, pickPoint, edges, resolvedOpts, allModelEntities);
  }

  // Open Polyline trimming
  if (target.type === 'polyline' && !target.closed) {
    const pts = target.points;
    if (pts.length < 2) return { action: 'none', entities: [target] };

    // Find clicked segment
    let bestSegIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const proj = projectPointOnSegment(pickPoint, pts[i], pts[i + 1]);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestSegIdx = i;
      }
    }

    const clickedLine: LineEntity = {
      id: `poly-seg-${bestSegIdx}`,
      type: 'line',
      layer: target.layer,
      start: pts[bestSegIdx],
      end: pts[bestSegIdx + 1],
    };

    const trimRes = trimAt(clickedLine, pickPoint, edges, resolvedOpts);
    if (trimRes.action === 'deleted') {
      // Remove that segment from polyline
      const pA = pts.slice(0, bestSegIdx + 1);
      const pB = pts.slice(bestSegIdx + 1);
      const res: ArchEntity[] = [];
      if (pA.length >= 2) res.push({ ...target, id: `poly-${Date.now()}-1`, points: pA });
      if (pB.length >= 2) res.push({ ...target, id: `poly-${Date.now()}-2`, points: pB });
      return { action: res.length > 0 ? 'replaced' : 'deleted', entities: res };
    }

    if (trimRes.action === 'replaced') {
      const lines = trimRes.entities as LineEntity[];
      if (lines.length === 1) {
        const nextPts = [...pts];
        nextPts[bestSegIdx] = lines[0].start;
        nextPts[bestSegIdx + 1] = lines[0].end;
        return {
          action: 'replaced',
          entities: [{ ...target, points: nextPts }],
          removedPiece: trimRes.removedPiece,
        };
      }
    }
  }

  return { action: 'none', entities: [target] };
}

// ============================================================================
// EXTEND ALGORITHM (AutoCAD 2021+ Quick & Standard)
// ============================================================================

/**
 * Extends `target` near `pickPoint` to the nearest boundary edge in `boundaries`.
 * Clicking again extends to the next boundary ahead.
 */
export function extendAt(
  target: ArchEntity,
  pickPoint: Point,
  boundaries: ArchEntity[],
  modeOrOptions: TrimExtendMode | TrimExtendOptions = 'quick',
  edgeModeOrOptions?: EdgeExtensionMode | TrimExtendOptions
): ExtendResult {
  const resolvedOpts: TrimExtendOptions =
    typeof modeOrOptions === 'string'
      ? {
          mode: modeOrOptions,
          ...(typeof edgeModeOrOptions === 'string'
            ? { edge: edgeModeOrOptions }
            : edgeModeOrOptions || {}),
        }
      : modeOrOptions;
  const implied = resolvedOpts.edge === 'extend' || resolvedOpts.implied;
  const boundaryEdges = boundaries.filter((b) => b.id !== target.id);

  // Line or Wall extending
  if (target.type === 'line' || target.type === 'wall') {
    const dStart = dist(pickPoint, target.start);
    const dEnd = dist(pickPoint, target.end);
    const extendEnd = dEnd <= dStart;

    const origin = extendEnd ? target.end : target.start;
    const rayDir = extendEnd
      ? normalize(sub(target.end, target.start))
      : normalize(sub(target.start, target.end));

    if (dist(target.start, target.end) < 1e-4) return { extendedEntity: target };

    let bestDist = Infinity;
    let bestPt: Point | null = null;

    // Collect all candidate boundary segments
    const candidateSegments: Segment[] = [];
    for (const b of boundaryEdges) {
      if (b.type === 'wall' && resolvedOpts.wallFaceMode === 'face') {
        candidateSegments.push(...getWallAllSegments(b, false));
      } else {
        candidateSegments.push(...getEntityCenterlineSegments(b));
      }
    }

    for (const seg of candidateSegments) {
      if (seg.entityId === target.id) continue;

      // Ray-segment intersection
      const hit = lineLineIntersection(
        origin,
        add(origin, scale(rayDir, 100000)),
        seg.a,
        seg.b,
        false,
        implied
      );

      if (hit) {
        const s = dot(sub(hit.point, origin), rayDir);
        if (s > 0.1 && s < bestDist) {
          bestDist = s;
          bestPt = hit.point;
        }
      }
    }

    // Also check Circles and Arcs
    for (const b of boundaryEdges) {
      if (b.type === 'circle' || b.type === 'arc') {
        const c = b as CircleEntity | ArcEntity;
        const hits = lineCircleIntersection(
          origin,
          add(origin, scale(rayDir, 100000)),
          c.center,
          c.radius,
          true
        );
        for (const h of hits) {
          if (
            b.type === 'arc' &&
            !isAngleOnArc(h.paramB, (b as ArcEntity).startAngle, (b as ArcEntity).endAngle) &&
            !implied
          ) {
            continue;
          }
          const s = dot(sub(h.point, origin), rayDir);
          if (s > 0.1 && s < bestDist) {
            bestDist = s;
            bestPt = h.point;
          }
        }
      }
    }

    if (!bestPt) return { extendedEntity: target };

    const extendedEntity: LineEntity | WallEntity = extendEnd
      ? { ...target, end: bestPt }
      : { ...target, start: bestPt };

    return {
      extendedEntity,
      extensionSegment: {
        type: 'line',
        start: origin,
        end: bestPt,
      },
    };
  }

  // Arc extending (along its own circle, never past full circle)
  if (target.type === 'arc') {
    const arc = target;
    const startPt = add(
      arc.center,
      scale(
        {
          x: Math.cos((arc.startAngle * Math.PI) / 180),
          y: Math.sin((arc.startAngle * Math.PI) / 180),
        },
        arc.radius
      )
    );
    const endPt = add(
      arc.center,
      scale(
        {
          x: Math.cos((arc.endAngle * Math.PI) / 180),
          y: Math.sin((arc.endAngle * Math.PI) / 180),
        },
        arc.radius
      )
    );

    const dStart = dist(pickPoint, startPt);
    const dEnd = dist(pickPoint, endPt);
    const extendEnd = dEnd <= dStart;

    // Extend towards endPt (CCW) or towards startPt (CW)
    const circle = {
      id: arc.id,
      type: 'circle' as const,
      layer: arc.layer,
      center: arc.center,
      radius: arc.radius,
    };

    let bestDelta = Infinity;
    let bestAng: number | null = null;

    for (const b of boundaryEdges) {
      const hits = intersections(circle, b, { impliedB: implied });
      for (const h of hits) {
        const hitAng = h.paramA;
        if (extendEnd) {
          // Advancing CCW from endAngle
          const delta = arcSweepAngle(arc.endAngle, hitAng);
          if (delta > 0.1 && delta < 359.9 && delta < bestDelta) {
            // Ensure we don't extend past startAngle (would overlap itself)
            const maxSweep = arcSweepAngle(arc.endAngle, arc.startAngle);
            if (delta <= maxSweep) {
              bestDelta = delta;
              bestAng = hitAng;
            }
          }
        } else {
          // Advancing CW from startAngle (or CCW from hitAng to startAngle)
          const delta = arcSweepAngle(hitAng, arc.startAngle);
          if (delta > 0.1 && delta < 359.9 && delta < bestDelta) {
            const maxSweep = arcSweepAngle(arc.endAngle, arc.startAngle);
            if (delta <= maxSweep) {
              bestDelta = delta;
              bestAng = hitAng;
            }
          }
        }
      }
    }

    if (bestAng === null) return { extendedEntity: target };

    const extendedArc: ArcEntity = extendEnd
      ? { ...arc, endAngle: bestAng }
      : { ...arc, startAngle: bestAng };

    return {
      extendedEntity: extendedArc,
      extensionSegment: {
        type: 'arc',
        center: arc.center,
        radius: arc.radius,
        startAngle: extendEnd ? arc.endAngle : bestAng,
        endAngle: extendEnd ? bestAng : arc.startAngle,
      },
    };
  }

  // Open Polyline: extend only first or last segment
  if (target.type === 'polyline' && !target.closed) {
    const pts = target.points;
    if (pts.length < 2) return { extendedEntity: target };

    const dFirst = dist(pickPoint, pts[0]);
    const dLast = dist(pickPoint, pts[pts.length - 1]);
    const extendLast = dLast <= dFirst;

    const segToExtend: LineEntity = extendLast
      ? {
          id: `${target.id}-last`,
          type: 'line',
          layer: target.layer,
          start: pts[pts.length - 2],
          end: pts[pts.length - 1],
        }
      : {
          id: `${target.id}-first`,
          type: 'line',
          layer: target.layer,
          start: pts[1],
          end: pts[0],
        };

    const res = extendAt(segToExtend, pickPoint, boundaries, resolvedOpts);
    if (!res || res.extendedEntity === segToExtend || res.extendedEntity.type !== 'line') {
      return { extendedEntity: target };
    }

    const extLine = res.extendedEntity as LineEntity;
    const nextPts = [...pts];
    if (extendLast) {
      nextPts[nextPts.length - 1] = extLine.end;
    } else {
      nextPts[0] = extLine.end;
    }

    return {
      extendedEntity: { ...target, points: nextPts },
      extensionSegment: res.extensionSegment,
    };
  }

  return { extendedEntity: target };
}

// ============================================================================
// FENCE & CROSSING WINDOW HITS
// ============================================================================

/**
 * Returns all { object, pickPoint } crossed by a freehand path or 2-point fence.
 */
export function fenceHits(
  path: Point[],
  objects: ArchEntity[]
): Array<{ object: ArchEntity; pickPoint: Point }> {
  if (path.length < 2) return [];

  const hits: Array<{ object: ArchEntity; pickPoint: Point }> = [];
  const visitedObjIds = new Set<string>();

  for (let i = 0; i < path.length - 1; i++) {
    const pA = path[i];
    const pB = path[i + 1];
    const fenceLine: LineEntity = {
      id: `fence-${i}`,
      type: 'line',
      layer: '0',
      start: pA,
      end: pB,
    };

    for (const obj of objects) {
      if (visitedObjIds.has(obj.id)) continue;
      const inters = intersections(obj, fenceLine);
      if (inters.length > 0) {
        hits.push({ object: obj, pickPoint: inters[0].point });
        visitedObjIds.add(obj.id);
      }
    }
  }

  return hits;
}

// ============================================================================
// CORNER COMMAND (TC / Revit Trim/Extend to Corner)
// ============================================================================

/**
 * Connects two lines or walls into a clean corner by trimming or extending them to their intersection,
 * keeping the sides clicked by p1 and p2.
 */
export function trimExtendCorner(
  e1: LineEntity | WallEntity,
  e2: LineEntity | WallEntity,
  p1: Point,
  p2: Point
): { modified: (LineEntity | WallEntity)[]; corner: Point } | null {
  const hit = lineLineIntersection(e1.start, e1.end, e2.start, e2.end, true, true);
  if (!hit) return null;
  const corner = hit.point;

  // For e1: keep side of p1
  const dStart1 = dist(p1, e1.start);
  const dEnd1 = dist(p1, e1.end);
  const keepStart1 = dStart1 <= dEnd1;
  const mod1: LineEntity | WallEntity = keepStart1
    ? { ...e1, end: corner }
    : { ...e1, start: corner };

  // For e2: keep side of p2
  const dStart2 = dist(p2, e2.start);
  const dEnd2 = dist(p2, e2.end);
  const keepStart2 = dStart2 <= dEnd2;
  const mod2: LineEntity | WallEntity = keepStart2
    ? { ...e2, end: corner }
    : { ...e2, start: corner };

  return { modified: [mod1, mod2], corner };
}

// ============================================================================
// DIMENSION ASSOCIATIVITY UPDATE
// ============================================================================

/**
 * Updates dimensions attached to an entity that has been trimmed or extended.
 */
export function updateAssociatedDimensions(
  oldEntity: ArchEntity,
  newEntities: ArchEntity[],
  allEntities: ArchEntity[],
  snapRadius = 6
): ArchEntity[] {
  if (oldEntity.type !== 'line' && oldEntity.type !== 'wall') {
    return allEntities;
  }
  if (newEntities.length === 0) return allEntities;

  const oldS = oldEntity.start;
  const oldE = oldEntity.end;
  const firstNew = newEntities[0] as LineEntity | WallEntity;
  const lastNew = newEntities[newEntities.length - 1] as LineEntity | WallEntity;

  return allEntities.map((ent) => {
    if (ent.type !== 'dimension') return ent;

    let p1 = ent.p1;
    let p2 = ent.p2;
    let changed = false;

    if (dist(p1, oldS) <= snapRadius) {
      p1 = firstNew.start;
      changed = true;
    } else if (dist(p1, oldE) <= snapRadius) {
      p1 = lastNew.end;
      changed = true;
    }

    if (dist(p2, oldS) <= snapRadius) {
      p2 = firstNew.start;
      changed = true;
    } else if (dist(p2, oldE) <= snapRadius) {
      p2 = lastNew.end;
      changed = true;
    }

    if (changed) {
      return { ...ent, p1, p2 };
    }
    return ent;
  });
}

/**
 * Finds the closest candidate entity for Trim/Extend under a cursor point.
 */
export function findTrimExtendCandidate(
  pt: Point,
  entities: ArchEntity[],
  maxDist = 20
): ArchEntity | null {
  let bestEnt: ArchEntity | null = null;
  let bestDist = maxDist;

  for (const ent of entities) {
    if (ent.type === 'line') {
      const proj = projectPointOnSegment(pt, ent.start, ent.end);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestEnt = ent;
      }
    } else if (ent.type === 'wall') {
      const proj = projectPointOnSegment(pt, ent.start, ent.end);
      const effectiveDist = Math.max(0, proj.distance - (ent.thickness ?? 4.5) / 2);
      if (effectiveDist < bestDist) {
        bestDist = effectiveDist;
        bestEnt = ent;
      }
    } else if (ent.type === 'circle') {
      const d = Math.abs(dist(pt, ent.center) - ent.radius);
      if (d < bestDist) {
        bestDist = d;
        bestEnt = ent;
      }
    } else if (ent.type === 'arc') {
      const d = Math.abs(dist(pt, ent.center) - ent.radius);
      const ang = normalizeAngleDeg(angleDegRaw(ent.center, pt));
      if (isAngleOnArc(ang, ent.startAngle, ent.endAngle, 10)) {
        if (d < bestDist) {
          bestDist = d;
          bestEnt = ent;
        }
      }
    } else if (ent.type === 'polyline') {
      const pts = ent.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const proj = projectPointOnSegment(pt, pts[i], pts[i + 1]);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          bestEnt = ent;
        }
      }
      if (ent.closed && pts.length >= 3) {
        const proj = projectPointOnSegment(pt, pts[pts.length - 1], pts[0]);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          bestEnt = ent;
        }
      }
    } else if (ent.type === 'rectangle') {
      const p1 = ent.p1;
      const p2 = { x: ent.p2.x, y: ent.p1.y };
      const p3 = ent.p2;
      const p4 = { x: ent.p1.x, y: ent.p2.y };
      const segs: [Point, Point][] = [
        [p1, p2],
        [p2, p3],
        [p3, p4],
        [p4, p1],
      ];
      for (const [a, b] of segs) {
        const proj = projectPointOnSegment(pt, a, b);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          bestEnt = ent;
        }
      }
    }
  }

  return bestEnt;
}
