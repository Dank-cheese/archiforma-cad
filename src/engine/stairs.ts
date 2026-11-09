import type {
  ArchEntity,
  FloorEntity,
  GripPoint,
  LevelDefinition,
  Point,
  StairConstructionStyle,
  StairEntity,
  StairLanding,
  StairLandingStructure,
  StairRailingSide,
  StairRailingStyle,
  StairRun,
  StairTemplateShape,
  UnitSystem,
} from '../types/model';

// ============================================================================
// BASIC VECTOR HELPERS (Self-contained & pure)
// ============================================================================

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const normalize = (v: Point): Point => {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-8 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
};
/** In screen/plan coordinates (+X right, +Y down), perpLeft rotates -90° (screen up when facing +X). */
const perpLeft = (d: Point): Point => ({ x: d.y, y: -d.x });
const perpRight = (d: Point): Point => ({ x: -d.y, y: d.x });

const rotateVec = (v: Point, rad: number): Point => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

// ============================================================================
// CONSTANTS & CATALOG METADATA
// ============================================================================

export const STAIR_CUT_PLANE_INCHES = 48; // 4'-0" architectural plan cut plane
export const MIN_HEADROOM_INCHES = 80;     // 6'-8" IRC/IBC minimum stair headroom

export const STAIR_TEMPLATES: Array<{
  id: StairTemplateShape;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { id: 'straight', label: 'Straight Run', shortLabel: 'Straight', description: 'Single straight flight without intermediate landing' },
  { id: 'straight-landing', label: 'Straight + Mid-Landing', shortLabel: 'Mid-Landing', description: 'Two collinear flights with flat intermediate landing' },
  { id: 'l-left', label: '90° L-Stair (Left Turn)', shortLabel: 'L-Left 90°', description: 'Quarter-turn stair turning 90° left across a corner landing' },
  { id: 'l-right', label: '90° L-Stair (Right Turn)', shortLabel: 'L-Right 90°', description: 'Quarter-turn stair turning 90° right across a corner landing' },
  { id: 'u-switchback', label: '180° U-Switchback Stair', shortLabel: 'U-Stair 180°', description: 'Half-turn parallel flights with full-width switchback landing' },
  { id: 'u-3run', label: '3-Run U-Stair (2 Landings)', shortLabel: '3-Run U', description: 'Three flights around two 90° corner landings' },
  { id: 'winder-l', label: '90° Winder Stair', shortLabel: 'Winder 90°', description: 'Quarter-turn stair with pie-shaped winder treads at the corner' },
  { id: 'winder-u', label: '180° Winder Stair', shortLabel: 'Winder 180°', description: 'Half-turn stair with two 90° winder turns' },
  { id: 'spiral', label: 'Spiral Stair', shortLabel: 'Spiral', description: 'Compact helical stair around a central column' },
];

export const STAIR_CONSTRUCTION_STYLES: Array<{
  id: StairConstructionStyle;
  label: string;
}> = [
  { id: 'closed-stringer', label: 'Standard Closed Stringer (Wood / Painted)' },
  { id: 'open-stringer', label: 'Open / Cut Sawtooth Stringer' },
  { id: 'mono-stringer', label: 'Modern Center Mono-Stringer (Steel + Oak)' },
  { id: 'concrete-monolithic', label: 'Cast-in-Place Monolithic Concrete' },
  { id: 'cabin-split-log', label: 'Rustic Wooden Cabin Split-Log Stair' },
];

export const STAIR_LANDING_STRUCTURES: Array<{
  id: StairLandingStructure;
  label: string;
}> = [
  { id: 'monolithic', label: 'Monolithic Slab Landing' },
  { id: 'timber-framed', label: 'Framed Timber / Joist Landing' },
  { id: 'steel-cantilever', label: 'Cantilevered Steel Plate Landing' },
];

export const STAIR_RAILING_STYLES: Array<{
  id: StairRailingStyle;
  label: string;
}> = [
  { id: 'wood-balusters', label: 'Wood Balusters & Newel Posts' },
  { id: 'steel-cable', label: 'Horizontal Stainless Steel Cable' },
  { id: 'glass-panels', label: 'Frameless Tempered Glass Panels' },
  { id: 'cabin-peeled-log', label: 'Rustic Cabin Peeled-Log / Branch Railing' },
];

// ============================================================================
// 1. PURE RISER & FLIGHT SPLIT CALCULATION ENGINE
// ============================================================================

export interface StairRiserCalculation {
  totalRise: number;
  numRisers: number;
  riserHeight: number;
  numTreads: number;
  treadDepth: number;
  runLength: number;
  runRiserCounts: number[];
}

/**
 * Given floor-to-floor height (e.g., 10'-0" = 120") and max riser height (e.g., 7.5" or 7.06"),
 * calculates equal risers and splits them cleanly across 1, 2, or 3 runs.
 */
export function calculateStairRisers(
  totalRiseInput: number,
  maxRiserHeight = 7.5,
  preferredTreadDepth = 10,
  numRuns = 1,
  desiredRisersOverride?: number,
  firstRunSplitRiser?: number
): StairRiserCalculation {
  const totalRise = Math.max(7, Math.abs(totalRiseInput));
  const safeMaxRiser = Math.max(4, Math.min(12, maxRiserHeight || 7.5));
  const autoRisers = Math.max(2, Math.ceil(totalRise / safeMaxRiser - 1e-9));
  const numRisers = desiredRisersOverride && desiredRisersOverride >= 2
    ? Math.round(desiredRisersOverride)
    : autoRisers;
  const riserHeight = totalRise / numRisers;
  const treadDepth = Math.max(8, preferredTreadDepth || 10);

  const clampedRuns = Math.max(1, Math.min(3, Math.round(numRuns)));
  const runRiserCounts = splitRisersAcrossRuns(numRisers, clampedRuns, firstRunSplitRiser);
  const numTreads = runRiserCounts.reduce((acc, r) => acc + Math.max(1, r - 1), 0);
  const runLength = numTreads * treadDepth;

  return {
    totalRise,
    numRisers,
    riserHeight,
    numTreads,
    treadDepth,
    runLength,
    runRiserCounts,
  };
}

/**
 * Splits `totalRisers` across `numRuns` (1, 2, or 3 flights) so every flight has at least 2 risers
 * (when possible) and the sum of risers across all flights equals `totalRisers`.
 */
export function splitRisersAcrossRuns(
  totalRisers: number,
  numRuns: number,
  firstRunRisers?: number
): number[] {
  const N = Math.max(2, Math.round(totalRisers));
  if (numRuns <= 1) return [N];
  if (numRuns === 2) {
    const r1 = firstRunRisers !== undefined
      ? Math.max(1, Math.min(N - 1, Math.round(firstRunRisers)))
      : Math.floor(N / 2);
    return [r1, N - r1];
  }
  // 3 runs
  if (firstRunRisers !== undefined) {
    const r1 = Math.max(1, Math.min(N - 2, Math.round(firstRunRisers)));
    const rem = N - r1;
    const r2 = Math.max(1, Math.floor(rem / 2));
    const r3 = Math.max(1, rem - r2);
    return [r1, r2, r3];
  }
  const r1 = Math.max(1, Math.floor(N / 3));
  const r2 = Math.max(1, Math.floor((N - r1) / 2));
  const r3 = Math.max(1, N - r1 - r2);
  return [r1, r2, r3];
}

// ============================================================================
// 2. RUN CORNERS & AUTOMATIC CONNECTED LANDING GENERATOR
// ============================================================================

export interface RunEdgeGeometry {
  dir: Point;
  leftNormal: Point;
  entryLeft: Point;
  entryRight: Point;
  exitLeft: Point;
  exitRight: Point;
  outline: [Point, Point, Point, Point];
}

/**
 * Returns the 4 corners and entry/exit edges of a single straight StairRun.
 * Entry edge is [entryLeft, entryRight] at `run.start`;
 * Exit edge is [exitLeft, exitRight] at `run.end`.
 */
export function getRunEdgeGeometry(run: Pick<StairRun, 'start' | 'end' | 'width'>): RunEdgeGeometry {
  const dir = normalize(sub(run.end, run.start));
  const leftNormal = perpLeft(dir);
  const hw = run.width / 2;
  const entryLeft = add(run.start, scale(leftNormal, hw));
  const entryRight = add(run.start, scale(leftNormal, -hw));
  const exitLeft = add(run.end, scale(leftNormal, hw));
  const exitRight = add(run.end, scale(leftNormal, -hw));
  return {
    dir,
    leftNormal,
    entryLeft,
    entryRight,
    exitLeft,
    exitRight,
    outline: [entryLeft, exitLeft, exitRight, entryRight],
  };
}

/**
 * Generates an arc of points to round a polygon corner (`prev` -> `corner` -> `next`) by `radius`.
 */
function roundCornerPoints(prev: Point, corner: Point, next: Point, radius: number, segments = 6): Point[] {
  if (radius <= 0.5) return [corner];
  const v1 = sub(prev, corner);
  const v2 = sub(next, corner);
  const l1 = Math.hypot(v1.x, v1.y);
  const l2 = Math.hypot(v2.x, v2.y);
  if (l1 < 1e-3 || l2 < 1e-3) return [corner];
  const u1 = scale(v1, 1 / l1);
  const u2 = scale(v2, 1 / l2);
  const cosTheta = Math.max(-0.999, Math.min(0.999, dot(u1, u2)));
  const halfAngle = Math.acos(cosTheta) / 2;
  const tanHalf = Math.tan(halfAngle);
  if (tanHalf < 1e-4) return [corner];

  const maxTrim = Math.min(l1 * 0.48, l2 * 0.48);
  const trimDist = Math.min(maxTrim, radius / tanHalf);
  const effRadius = trimDist * tanHalf;
  if (effRadius <= 0.5) return [corner];

  const pStart = add(corner, scale(u1, trimDist));
  const pEnd = add(corner, scale(u2, trimDist));
  const bisector = normalize(add(u1, u2));
  const centerDist = effRadius / Math.sin(halfAngle);
  const center = add(corner, scale(bisector, centerDist));

  const a0 = Math.atan2(pStart.y - center.y, pStart.x - center.x);
  let a1 = Math.atan2(pEnd.y - center.y, pEnd.x - center.x);
  let diff = a1 - a0;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (diff * i) / segments;
    pts.push({
      x: center.x + effRadius * Math.cos(a),
      y: center.y + effRadius * Math.sin(a),
    });
  }
  return pts;
}

/**
 * Automatic connected Landing polygon generator:
 * Connects the exit edge of `runA` (`[exitLeft, exitRight]`) to the entry edge of `runB`
 * (`[entryLeft, entryRight]`) with ZERO GAPS and exact intermediate landing elevation.
 *
 * Handles:
 * - Straight intermediate landings (~0° turn)
 * - 90° L-landings (Left or Right turn)
 * - 180° U-switchback full-width landings
 * - Arbitrary angle turns
 */
export function generateConnectedLandingPolygon(
  runA: Pick<StairRun, 'start' | 'end' | 'width' | 'numRisers' | 'topElevationOffset'>,
  runB: Pick<StairRun, 'start' | 'end' | 'width'>,
  options?: {
    depthOverride?: number;
    widthOverride?: number;
    cornerRadius?: number;
  }
): {
  polygon: Point[];
  depth: number;
  width: number;
  turnType: 'straight' | 'l-left' | 'l-right' | 'u-turn' | 'angled';
  elevationOffset: number;
} {
  const edgeA = getRunEdgeGeometry(runA);
  const edgeB = getRunEdgeGeometry(runB);
  const cosAng = dot(edgeA.dir, edgeB.dir);
  const sinAng = cross(edgeA.dir, edgeB.dir); // < 0 is left turn in screen coords (+Y down), > 0 is right turn
  const cornerRadius = Math.max(0, options?.cornerRadius || 0);
  const minDepth = Math.max(runA.width, runB.width);
  const requestedDepth = Math.max(minDepth, options?.depthOverride || minDepth);

  // 1. STRAIGHT INTERMEDIATE LANDING (dirs roughly parallel, cosAng > 0.7)
  if (cosAng > 0.7) {
    const chord = dist(runA.end, runB.start);
    const depth = Math.max(12, chord);
    const width = Math.max(runA.width, runB.width, options?.widthOverride || 0);
    const extraW = Math.max(0, width - runA.width) / 2;
    const eAL = add(edgeA.exitLeft, scale(edgeA.leftNormal, extraW));
    const eAR = add(edgeA.exitRight, scale(edgeA.leftNormal, -extraW));
    const eBL = add(edgeB.entryLeft, scale(edgeB.leftNormal, extraW));
    const eBR = add(edgeB.entryRight, scale(edgeB.leftNormal, -extraW));
    // Connect exitLeft -> entryLeft -> entryRight -> exitRight
    return {
      polygon: [eAL, eBL, eBR, eAR],
      depth,
      width,
      turnType: 'straight',
      elevationOffset: runA.topElevationOffset,
    };
  }

  // 2. 180° U-SWITCHBACK LANDING (dirs roughly opposite, cosAng < -0.7)
  if (cosAng < -0.7) {
    const forward = edgeA.dir;
    const depth = requestedDepth;
    // Project all 4 endpoints onto edgeA's leftNormal to find outer lateral bounds
    const pts = [edgeA.exitLeft, edgeA.exitRight, edgeB.entryLeft, edgeB.entryRight];
    const projs = pts.map((p) => dot(sub(p, runA.end), edgeA.leftNormal));
    const maxLeft = Math.max(...projs);
    const minRight = Math.min(...projs);
    const spanWidth = Math.max(runA.width + runB.width, maxLeft - minRight);
    const extraW = Math.max(0, (options?.widthOverride || spanWidth) - spanWidth) / 2;

    // Back corners on the flight line (ensuring exact connection with both flights)
    const backLeft = add(runA.end, scale(edgeA.leftNormal, maxLeft + extraW));
    const backRight = add(runA.end, scale(edgeA.leftNormal, minRight - extraW));
    const frontLeft = add(backLeft, scale(forward, depth));
    const frontRight = add(backRight, scale(forward, depth));

    // Include exact exit/entry vertices along the back edge so there is zero topological gap
    // Sort back-edge vertices from right (minRight) to left (maxLeft)
    const backVertices = [
      backRight,
      edgeA.exitRight,
      edgeA.exitLeft,
      edgeB.entryRight,
      edgeB.entryLeft,
      backLeft,
    ].sort((p1, p2) => dot(sub(p1, runA.end), edgeA.leftNormal) - dot(sub(p2, runA.end), edgeA.leftNormal));

    // Deduplicate near-identical points
    const cleanBack: Point[] = [];
    for (const p of backVertices) {
      if (cleanBack.length === 0 || dist(cleanBack[cleanBack.length - 1], p) > 0.05) {
        cleanBack.push(p);
      }
    }

    const cFL = cornerRadius > 0
      ? roundCornerPoints(backLeft, frontLeft, frontRight, cornerRadius)
      : [frontLeft];
    const cFR = cornerRadius > 0
      ? roundCornerPoints(frontLeft, frontRight, backRight, cornerRadius)
      : [frontRight];

    return {
      polygon: [...cleanBack, ...cFL, ...cFR],
      depth,
      width: maxLeft - minRight + 2 * extraW,
      turnType: 'u-turn',
      elevationOffset: runA.topElevationOffset,
    };
  }

  // 3. 90° QUARTER-TURN L-LANDING (Left or Right turn)
  const isLeftTurn = sinAng < 0;
  if (Math.abs(cosAng) <= 0.7) {
    // For a clean L-landing:
    // Run A exits at [exitLeft, exitRight] along edgeA.dir.
    // Run B enters at [entryLeft, entryRight] along edgeB.dir.
    // When turning LEFT (in screen coords, edgeB.dir = edgeA.leftNormal):
    //   Inner corner is where edgeA.exitLeft meets edgeB.entryRight.
    //   Outer corner is opposite: projected along edgeA.dir from edgeA.exitRight and -edgeB.dir from edgeB.entryLeft.
    // When turning RIGHT (in screen coords, edgeB.dir = -edgeA.leftNormal):
    //   Inner corner is where edgeA.exitRight meets edgeB.entryLeft.
    //   Outer corner is opposite: projected along edgeA.dir from edgeA.exitLeft and -edgeB.dir from edgeB.entryRight.
    const extraDepth = Math.max(0, (options?.depthOverride || minDepth) - minDepth);
    const extraWidth = Math.max(0, (options?.widthOverride || minDepth) - minDepth);

    if (isLeftTurn) {
      // Outer corner projects along +edgeA.dir from exitRight and -edgeB.dir from entryLeft
      const projAlongA = Math.max(
        runB.width + extraDepth,
        dot(sub(edgeB.entryLeft, edgeA.exitRight), edgeA.dir)
      );
      const outerCornerBase = add(edgeA.exitRight, scale(edgeA.dir, projAlongA));
      const outerCorner = add(outerCornerBase, scale(perpRight(edgeA.dir), extraWidth));
      const extExitRight = extraWidth > 0 ? add(edgeA.exitRight, scale(perpRight(edgeA.dir), extraWidth)) : edgeA.exitRight;

      const outerPts = cornerRadius > 0
        ? roundCornerPoints(extExitRight, outerCorner, edgeB.entryLeft, cornerRadius)
        : [outerCorner];

      const rawPoly = [
        edgeA.exitLeft,
        edgeA.exitRight,
        ...(extraWidth > 0 ? [extExitRight] : []),
        ...outerPts,
        edgeB.entryLeft,
        edgeB.entryRight,
      ];
      const deduped: Point[] = [];
      for (const p of rawPoly) {
        if (deduped.length === 0 || dist(deduped[deduped.length - 1], p) > 0.05) {
          deduped.push(p);
        }
      }
      if (deduped.length > 2 && dist(deduped[0], deduped[deduped.length - 1]) <= 0.05) {
        deduped.pop();
      }
      return {
        polygon: deduped,
        depth: projAlongA,
        width: runA.width + extraWidth,
        turnType: 'l-left',
        elevationOffset: runA.topElevationOffset,
      };
    } else {
      // Right turn: inner corner is edgeA.exitRight / edgeB.entryLeft
      // Outer corner is along +edgeA.dir from edgeA.exitLeft to meet edgeB.entryRight
      const projAlongA = Math.max(
        runB.width + extraDepth,
        dot(sub(edgeB.entryRight, edgeA.exitLeft), edgeA.dir)
      );
      const outerCornerBase = add(edgeA.exitLeft, scale(edgeA.dir, projAlongA));
      const outerCorner = add(outerCornerBase, scale(edgeA.leftNormal, extraWidth));
      const extExitLeft = extraWidth > 0 ? add(edgeA.exitLeft, scale(edgeA.leftNormal, extraWidth)) : edgeA.exitLeft;

      const outerPts = cornerRadius > 0
        ? roundCornerPoints(extExitLeft, outerCorner, edgeB.entryRight, cornerRadius)
        : [outerCorner];

      const rawPoly = [
        edgeA.exitRight,
        edgeA.exitLeft,
        ...(extraWidth > 0 ? [extExitLeft] : []),
        ...outerPts,
        edgeB.entryRight,
        edgeB.entryLeft,
      ];
      const deduped: Point[] = [];
      for (const p of rawPoly) {
        if (deduped.length === 0 || dist(deduped[deduped.length - 1], p) > 0.05) {
          deduped.push(p);
        }
      }
      if (deduped.length > 2 && dist(deduped[0], deduped[deduped.length - 1]) <= 0.05) {
        deduped.pop();
      }
      return {
        polygon: deduped,
        depth: projAlongA,
        width: runA.width + extraWidth,
        turnType: 'l-right',
        elevationOffset: runA.topElevationOffset,
      };
    }
  }

  return {
    polygon: [edgeA.exitLeft, edgeB.entryLeft, edgeB.entryRight, edgeA.exitRight],
    depth: requestedDepth,
    width: runA.width,
    turnType: 'angled',
    elevationOffset: runA.topElevationOffset,
  };
}

// ============================================================================
// 3. INTERACTIVE MULTI-RUN SNAPPER (Revit "Automatic Landing" Workflow)
// ============================================================================

/**
 * Given the completed `run1` and a user's second-flight click/drag from `rawStart` toward `rawEnd`,
 * snaps `run2`'s start point so that `run1` and `run2` connect through a clean architectural landing
 * (straight mid-landing, 90° L-landing left/right, or 180° U-switchback landing) and sizes `run2`
 * to consume the remaining risers!
 */
export function snapSecondRunWithAutoLanding(
  run1: StairRun,
  rawStart: Point,
  rawEnd: Point,
  remainingRisers: number,
  riserHeight: number,
  landingOptions?: {
    depth?: number;
    wellGap?: number;
    structure?: StairLandingStructure;
    thickness?: number;
    cornerRadius?: number;
    intermediateStep?: boolean;
    supportPosts?: boolean;
  }
): {
  run2: StairRun;
  landing: StairLanding;
  risersCreatedInRun2: number;
  risersRemainingAfterRun2: number;
} {
  const dir1 = normalize(sub(run1.end, run1.start));
  const left1 = perpLeft(dir1);
  const w = run1.width;
  const treadDepth = run1.treadDepth;
  const landingDepth = Math.max(w, landingOptions?.depth || w);
  const wellGap = Math.max(0, landingOptions?.wellGap ?? 6);

  // Determine intended direction of Run 2 from rawStart -> rawEnd (or from run1.end -> rawEnd if close)
  const rawVec = dist(rawStart, rawEnd) > 6 ? sub(rawEnd, rawStart) : sub(rawEnd, run1.end);
  const rawDir = normalize(rawVec);
  const c = dot(dir1, rawDir);
  const s = cross(dir1, rawDir);

  let dir2: Point;
  let snappedStart: Point;

  if (c > 0.65) {
    // Straight ahead mid-landing
    dir2 = dir1;
    snappedStart = add(run1.end, scale(dir1, landingDepth));
  } else if (c < -0.65) {
    // 180° U-switchback turn (pick left or right side based on cursor offset from run1 centerline)
    dir2 = scale(dir1, -1);
    const sideProj = dot(sub(rawEnd, run1.end), left1);
    const sideSign = sideProj >= 0 ? 1 : -1;
    snappedStart = add(run1.end, scale(left1, sideSign * (w + wellGap)));
  } else if (s < 0) {
    // 90° Left turn: Run 1 exitLeft meets Run 2 entryRight
    // Run 1 exitLeft is at run1.end + left1*(w/2).
    // For Run 2 going along left1, its entryRight is at snappedStart - dir1*(w/2) (since perpLeft(left1) = -dir1, so right normal is +dir1).
    // Wait: perpLeft(dir2) = perpLeft(left1) = { x: left1.y, y: -left1.x } = -dir1.
    // So Run 2's entryRight = snappedStart - (-dir1)*(w/2) = snappedStart + dir1*(w/2).
    // For entryRight to equal run1.end + left1*(w/2) (or extended by extra landing depth):
    dir2 = left1;
    snappedStart = add(
      add(run1.end, scale(dir1, landingDepth - w / 2)),
      scale(left1, w / 2)
    );
  } else {
    // 90° Right turn: Run 2 goes along -left1
    dir2 = scale(left1, -1);
    snappedStart = add(
      add(run1.end, scale(dir1, landingDepth - w / 2)),
      scale(left1, -w / 2)
    );
  }

  // How many risers are created in Run 2 based on cursor drag distance?
  const dragDist = Math.max(treadDepth, dot(sub(rawEnd, snappedStart), dir2));
  const desiredTreads = Math.max(1, Math.round(dragDist / treadDepth));
  const maxRisers = Math.max(2, remainingRisers);
  const risersCreated = Math.max(2, Math.min(maxRisers, desiredTreads + 1));
  const run2Len = Math.max(1, risersCreated - 1) * treadDepth;
  const snappedEnd = add(snappedStart, scale(dir2, run2Len));

  const run2: StairRun = {
    id: 'run-2',
    start: snappedStart,
    end: snappedEnd,
    width: w,
    numRisers: risersCreated,
    treadDepth,
    startRiserIndex: run1.startRiserIndex + run1.numRisers,
    baseElevationOffset: run1.topElevationOffset,
    topElevationOffset: run1.topElevationOffset + risersCreated * riserHeight,
  };

  const conn = generateConnectedLandingPolygon(run1, run2, {
    depthOverride: landingDepth,
    cornerRadius: landingOptions?.cornerRadius,
  });

  const landing: StairLanding = {
    id: 'landing-1',
    afterRunIndex: 0,
    afterRiser: run1.startRiserIndex + run1.numRisers - 1,
    elevationOffset: run1.topElevationOffset,
    polygon: conn.polygon,
    depth: conn.depth,
    width: conn.width,
    thickness: landingOptions?.thickness ?? 6,
    structure: landingOptions?.structure ?? 'monolithic',
    supportPosts: landingOptions?.supportPosts,
    cornerRadius: landingOptions?.cornerRadius,
    intermediateStep: landingOptions?.intermediateStep,
  };

  return {
    run2,
    landing,
    risersCreatedInRun2: risersCreated,
    risersRemainingAfterRun2: Math.max(0, remainingRisers - risersCreated),
  };
}

// ============================================================================
// 4. ONE-CLICK STAIR & LANDING TEMPLATES GENERATOR
// ============================================================================

export interface CreateStairTemplateOptions {
  id?: string;
  origin: Point;
  direction?: Point; // unit vector for Run 1 (default { x: 1, y: 0 })
  baseLevelId: string;
  topLevelId: string;
  baseElevation: number;
  topElevation: number;
  baseOffset?: number;
  topOffset?: number;
  width?: number;            // default 42"
  treadDepth?: number;       // default 10"
  maxRiserHeight?: number;   // default 7.5"
  desiredRisers?: number;
  shape: StairTemplateShape;
  splitRiser?: number;       // riser index where first landing sits
  landingDepth?: number;     // default = width (42")
  landingWidth?: number;
  wellGap?: number;          // default = 6"
  cornerRadius?: number;     // default = 0"
  spiralRadius?: number;     // default = width (42")
  intermediateStep?: boolean;
  constructionStyle?: StairConstructionStyle;
  landingStructure?: StairLandingStructure;
  landingThickness?: number;
  supportPosts?: boolean;
  railingStyle?: StairRailingStyle;
  railingSide?: StairRailingSide;
  railingHeight?: number;
  cutFloorAbove?: boolean;
  layer?: string;
}

/**
 * Builds a complete, normalized `StairEntity` for any of the 9 one-click templates:
 * - 'straight'
 * - 'straight-landing'
 * - 'l-left'
 * - 'l-right'
 * - 'u-switchback'
 * - 'u-3run'
 * - 'winder-l'
 * - 'winder-u'
 * - 'spiral'
 */
export function createStairFromTemplate(opts: CreateStairTemplateOptions): StairEntity {
  const width = Math.max(24, opts.width ?? 42);
  const treadDepth = Math.max(8, opts.treadDepth ?? 10);
  const maxRiserHeight = Math.max(4, opts.maxRiserHeight ?? 7.5);
  const baseOffset = opts.baseOffset ?? 0;
  const topOffset = opts.topOffset ?? 0;
  const totalRise = Math.max(
    14,
    Math.abs((opts.topElevation + topOffset) - (opts.baseElevation + baseOffset))
  );

  const shape = opts.shape;
  const numRuns =
    shape === 'u-3run'
      ? 3
      : shape === 'straight' || shape === 'spiral'
      ? 1
      : 2;

  const calc = calculateStairRisers(
    totalRise,
    maxRiserHeight,
    treadDepth,
    numRuns,
    opts.desiredRisers,
    opts.splitRiser
  );

  const dir1 = normalize(opts.direction ?? { x: 1, y: 0 });
  const left1 = perpLeft(dir1);
  const wellGap = Math.max(0, opts.wellGap ?? 6);
  const landingDepth = Math.max(width, opts.landingDepth ?? width);
  const landingThickness = opts.landingThickness ?? 6;
  const landingStructure = opts.landingStructure ?? (opts.constructionStyle === 'cabin-split-log' ? 'timber-framed' : 'monolithic');
  const supportPosts = opts.supportPosts ?? (opts.constructionStyle === 'cabin-split-log');

  const runs: StairRun[] = [];
  const landings: StairLanding[] = [];

  if (shape === 'straight' || shape === 'spiral') {
    const rCount = calc.numRisers;
    const len = Math.max(1, rCount - 1) * treadDepth;
    const endPt = shape === 'spiral'
      ? add(opts.origin, scale(dir1, (opts.spiralRadius ?? width) * 2))
      : add(opts.origin, scale(dir1, len));
    runs.push({
      id: 'run-1',
      start: opts.origin,
      end: endPt,
      width,
      numRisers: rCount,
      treadDepth,
      startRiserIndex: 1,
      baseElevationOffset: 0,
      topElevationOffset: totalRise,
    });
  } else if (
    shape === 'straight-landing' ||
    shape === 'l-left' ||
    shape === 'l-right' ||
    shape === 'u-switchback'
  ) {
    const [r1Count, r2Count] = calc.runRiserCounts;
    const len1 = Math.max(1, r1Count - 1) * treadDepth;
    const len2 = Math.max(1, r2Count - 1) * treadDepth;
    const end1 = add(opts.origin, scale(dir1, len1));
    const elev1 = r1Count * calc.riserHeight;

    const run1: StairRun = {
      id: 'run-1',
      start: opts.origin,
      end: end1,
      width,
      numRisers: r1Count,
      treadDepth,
      startRiserIndex: 1,
      baseElevationOffset: 0,
      topElevationOffset: elev1,
    };

    let start2: Point;
    let dir2: Point;
    if (shape === 'straight-landing') {
      dir2 = dir1;
      start2 = add(end1, scale(dir1, landingDepth));
    } else if (shape === 'l-left') {
      dir2 = left1;
      start2 = add(add(end1, scale(dir1, landingDepth - width / 2)), scale(left1, width / 2));
    } else if (shape === 'l-right') {
      dir2 = scale(left1, -1);
      start2 = add(add(end1, scale(dir1, landingDepth - width / 2)), scale(left1, -width / 2));
    } else {
      // u-switchback (turns left by default so Run 2 is parallel alongside Run 1)
      dir2 = scale(dir1, -1);
      start2 = add(end1, scale(left1, width + wellGap));
    }

    const end2 = add(start2, scale(dir2, len2));
    const run2: StairRun = {
      id: 'run-2',
      start: start2,
      end: end2,
      width,
      numRisers: r2Count,
      treadDepth,
      startRiserIndex: r1Count + 1,
      baseElevationOffset: elev1,
      topElevationOffset: totalRise,
    };

    const conn = generateConnectedLandingPolygon(run1, run2, {
      depthOverride: landingDepth,
      widthOverride: opts.landingWidth,
      cornerRadius: opts.cornerRadius,
    });

    runs.push(run1, run2);
    landings.push({
      id: 'landing-1',
      afterRunIndex: 0,
      afterRiser: r1Count,
      elevationOffset: elev1,
      polygon: conn.polygon,
      depth: conn.depth,
      width: conn.width,
      thickness: landingThickness,
      structure: landingStructure,
      supportPosts,
      cornerRadius: opts.cornerRadius,
      intermediateStep: opts.intermediateStep,
    });
  } else if (shape === 'u-3run') {
    const [r1Count, r2Count, r3Count] = calc.runRiserCounts;
    const len1 = Math.max(1, r1Count - 1) * treadDepth;
    const len2 = Math.max(1, r2Count - 1) * treadDepth;
    const len3 = Math.max(1, r3Count - 1) * treadDepth;

    const end1 = add(opts.origin, scale(dir1, len1));
    const elev1 = r1Count * calc.riserHeight;
    const run1: StairRun = {
      id: 'run-1',
      start: opts.origin,
      end: end1,
      width,
      numRisers: r1Count,
      treadDepth,
      startRiserIndex: 1,
      baseElevationOffset: 0,
      topElevationOffset: elev1,
    };

    // First 90° left corner landing into Run 2
    const dir2 = left1;
    const start2 = add(add(end1, scale(dir1, landingDepth - width / 2)), scale(dir2, width / 2));
    const end2 = add(start2, scale(dir2, Math.max(wellGap + treadDepth, len2)));
    const elev2 = (r1Count + r2Count) * calc.riserHeight;
    const run2: StairRun = {
      id: 'run-2',
      start: start2,
      end: end2,
      width,
      numRisers: r2Count,
      treadDepth,
      startRiserIndex: r1Count + 1,
      baseElevationOffset: elev1,
      topElevationOffset: elev2,
    };

    // Second 90° left corner landing into Run 3 (opposite to Run 1)
    const dir3 = scale(dir1, -1);
    const start3 = add(add(end2, scale(dir2, landingDepth - width / 2)), scale(dir3, width / 2));
    const end3 = add(start3, scale(dir3, len3));
    const run3: StairRun = {
      id: 'run-3',
      start: start3,
      end: end3,
      width,
      numRisers: r3Count,
      treadDepth,
      startRiserIndex: r1Count + r2Count + 1,
      baseElevationOffset: elev2,
      topElevationOffset: totalRise,
    };

    const conn1 = generateConnectedLandingPolygon(run1, run2, {
      depthOverride: landingDepth,
      cornerRadius: opts.cornerRadius,
    });
    const conn2 = generateConnectedLandingPolygon(run2, run3, {
      depthOverride: landingDepth,
      cornerRadius: opts.cornerRadius,
    });

    runs.push(run1, run2, run3);
    landings.push(
      {
        id: 'landing-1',
        afterRunIndex: 0,
        afterRiser: r1Count,
        elevationOffset: elev1,
        polygon: conn1.polygon,
        depth: conn1.depth,
        width: conn1.width,
        thickness: landingThickness,
        structure: landingStructure,
        supportPosts,
        cornerRadius: opts.cornerRadius,
      },
      {
        id: 'landing-2',
        afterRunIndex: 1,
        afterRiser: r1Count + r2Count,
        elevationOffset: elev2,
        polygon: conn2.polygon,
        depth: conn2.depth,
        width: conn2.width,
        thickness: landingThickness,
        structure: landingStructure,
        supportPosts,
        cornerRadius: opts.cornerRadius,
      }
    );
  } else if (shape === 'winder-l' || shape === 'winder-u') {
    // Winder stair: pie-shaped winder treads occupy the corner box instead of a flat landing
    const winderCount = shape === 'winder-u' ? 6 : 3;
    const straightRisers = Math.max(2, calc.numRisers - winderCount);
    const r1Count = opts.splitRiser
      ? Math.max(1, Math.min(straightRisers - 1, opts.splitRiser))
      : Math.max(1, Math.floor(straightRisers / 2));
    const r2Count = Math.max(1, straightRisers - r1Count);

    const len1 = Math.max(1, r1Count) * treadDepth;
    const len2 = Math.max(1, r2Count) * treadDepth;
    const end1 = add(opts.origin, scale(dir1, len1));
    const elev1 = r1Count * calc.riserHeight;
    const elevAfterWinder = (r1Count + winderCount) * calc.riserHeight;

    const run1: StairRun = {
      id: 'run-1',
      start: opts.origin,
      end: end1,
      width,
      numRisers: r1Count,
      treadDepth,
      startRiserIndex: 1,
      baseElevationOffset: 0,
      topElevationOffset: elev1,
    };

    const dir2 = shape === 'winder-u' ? scale(dir1, -1) : left1;
    const start2 = shape === 'winder-u'
      ? add(end1, scale(left1, width + wellGap))
      : add(add(end1, scale(dir1, width / 2)), scale(left1, width / 2));
    const end2 = add(start2, scale(dir2, len2));

    const run2: StairRun = {
      id: 'run-2',
      start: start2,
      end: end2,
      width,
      numRisers: r2Count,
      treadDepth,
      startRiserIndex: r1Count + winderCount + 1,
      baseElevationOffset: elevAfterWinder,
      topElevationOffset: totalRise,
    };

    const conn = generateConnectedLandingPolygon(run1, run2, {
      depthOverride: width,
      cornerRadius: opts.cornerRadius,
    });

    runs.push(run1, run2);
    landings.push({
      id: 'winder-turn-1',
      afterRunIndex: 0,
      afterRiser: r1Count,
      elevationOffset: elev1,
      polygon: conn.polygon,
      depth: conn.depth,
      width: conn.width,
      thickness: landingThickness,
      structure: landingStructure,
      supportPosts,
    });
  }

  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];

  return {
    id: opts.id ?? `stair-${Date.now()}`,
    type: 'stair',
    layer: opts.layer ?? 'A-STRS',
    levelId: opts.baseLevelId,
    baseLevelId: opts.baseLevelId,
    topLevelId: opts.topLevelId,
    baseOffset,
    topOffset,
    start: firstRun.start,
    end: lastRun.end,
    width,
    numRisers: calc.numRisers,
    riserHeight: Number(calc.riserHeight.toFixed(3)),
    treadDepth,
    maxRiserHeight,
    shape,
    runs,
    landings,
    wellGap,
    winderCount: shape === 'winder-u' ? 6 : shape === 'winder-l' ? 3 : 0,
    spiralRadius: opts.shape === 'spiral' ? Math.max(30, width) : undefined,
    spiralInnerRadius: opts.shape === 'spiral' ? 4 : undefined,
    spiralTurns: opts.shape === 'spiral' ? 360 : undefined,
    constructionStyle: opts.constructionStyle ?? 'closed-stringer',
    landingStructure,
    landingThickness,
    supportPosts,
    railingStyle: opts.railingStyle ?? (opts.constructionStyle === 'cabin-split-log' ? 'cabin-peeled-log' : 'wood-balusters'),
    railingSide: opts.railingSide ?? 'both',
    railingHeight: opts.railingHeight ?? 36,
    cutFloorAbove: opts.cutFloorAbove !== false,
    headroomTarget: MIN_HEADROOM_INCHES,
    showRiserNumbers: true,
  };
}

// ============================================================================
// 5. NORMALIZING & EDITING EXISTING STAIRS (Split, Rebalance, Resize)
// ============================================================================

/**
 * Ensures any `StairEntity` (including legacy single-run stairs with only `start` and `end`)
 * has populated `runs` and `landings` arrays.
 */
export function ensureStairRunsAndLandings(
  stair: StairEntity,
  levels: LevelDefinition[] = []
): {
  runs: StairRun[];
  landings: StairLanding[];
  totalRise: number;
  baseElevation: number;
  topElevation: number;
} {
  const baseLvl = levels.find((l) => l.id === (stair.baseLevelId || stair.levelId));
  const topLvl = levels.find((l) => l.id === stair.topLevelId);
  const baseElevation = (baseLvl?.elevation ?? 0) + (stair.baseOffset ?? 0);
  const defaultTop = baseElevation + Math.max(14, (stair.numRisers || 16) * (stair.riserHeight || 7));
  const topElevation = (topLvl ? topLvl.elevation : defaultTop) + (stair.topOffset ?? 0);
  const totalRise = Math.max(14, Math.abs(topElevation - baseElevation));

  if (stair.runs && stair.runs.length > 0) {
    return {
      runs: stair.runs,
      landings: stair.landings ?? [],
      totalRise,
      baseElevation,
      topElevation,
    };
  }

  // Legacy single-run stair: synthesize Run 1 from start -> end
  const numRisers = Math.max(2, stair.numRisers || 16);
  const treadDepth = Math.max(8, stair.treadDepth || dist(stair.start, stair.end) / Math.max(1, numRisers - 1));
  const run1: StairRun = {
    id: 'run-1',
    start: stair.start,
    end: stair.end,
    width: stair.width || 42,
    numRisers,
    treadDepth,
    startRiserIndex: 1,
    baseElevationOffset: 0,
    topElevationOffset: totalRise,
  };
  return {
    runs: [run1],
    landings: [],
    totalRise,
    baseElevation,
    topElevation,
  };
}

/**
 * Splits a straight stair (`shape === 'straight'` or 1 run) at `splitRiser`
 * (default `Math.floor(numRisers / 2)`) into two runs with an intermediate landing in between!
 */
export function insertLandingAtRiser(
  stair: StairEntity,
  levels: LevelDefinition[] = [],
  splitRiser?: number,
  turnShape: 'straight-landing' | 'l-left' | 'l-right' | 'u-switchback' = 'straight-landing'
): StairEntity {
  const { runs, totalRise, baseElevation, topElevation } = ensureStairRunsAndLandings(stair, levels);
  const r0 = runs[0];
  const dir = normalize(sub(r0.end, r0.start));
  const split = splitRiser !== undefined
    ? Math.max(2, Math.min(stair.numRisers - 2, Math.round(splitRiser)))
    : Math.max(2, Math.floor(stair.numRisers / 2));

  return createStairFromTemplate({
    id: stair.id,
    origin: r0.start,
    direction: dir,
    baseLevelId: stair.baseLevelId,
    topLevelId: stair.topLevelId,
    baseElevation,
    topElevation,
    baseOffset: 0,
    topOffset: 0,
    width: stair.width,
    treadDepth: stair.treadDepth,
    maxRiserHeight: stair.maxRiserHeight,
    desiredRisers: stair.numRisers,
    shape: turnShape,
    splitRiser: split,
    landingDepth: stair.width,
    wellGap: stair.wellGap ?? 6,
    constructionStyle: stair.constructionStyle,
    landingStructure: stair.landingStructure,
    landingThickness: stair.landingThickness,
    supportPosts: stair.supportPosts,
    railingStyle: stair.railingStyle,
    railingSide: stair.railingSide,
    railingHeight: stair.railingHeight,
    cutFloorAbove: stair.cutFloorAbove,
    layer: stair.layer,
  });
}

/**
 * Rebalances Run 1 and Run 2 riser counts when the user changes which riser the landing sits at
 * (e.g., after Riser 8 of 17) or types an exact landing elevation offset (e.g. +4'-8" = 56").
 * Preserves the stair's custom turn directions or template shape!
 */
export function rebalanceStairLandingSplit(
  stair: StairEntity,
  levels: LevelDefinition[],
  newAfterRiserInput: number
): StairEntity {
  const { runs, landings, totalRise, baseElevation, topElevation } = ensureStairRunsAndLandings(stair, levels);
  if (runs.length < 2) {
    return insertLandingAtRiser(stair, levels, newAfterRiserInput);
  }

  const N = Math.max(3, stair.numRisers);
  const clampedRiser = Math.max(1, Math.min(N - (runs.length === 3 ? 2 : 1), Math.round(newAfterRiserInput)));
  const dir1 = normalize(sub(runs[0].end, runs[0].start));
  const l0 = landings[0];

  // If using a standard template, rebuild cleanly from template with new splitRiser
  if (stair.shape && stair.shape !== 'straight') {
    const rebuilt = createStairFromTemplate({
      id: stair.id,
      origin: runs[0].start,
      direction: dir1,
      baseLevelId: stair.baseLevelId,
      topLevelId: stair.topLevelId,
      baseElevation,
      topElevation,
      width: stair.width,
      treadDepth: stair.treadDepth,
      maxRiserHeight: stair.maxRiserHeight,
      desiredRisers: N,
      shape: stair.shape,
      splitRiser: clampedRiser,
      landingDepth: l0?.depth ?? stair.width,
      landingWidth: l0?.width,
      wellGap: stair.wellGap ?? 6,
      cornerRadius: l0?.cornerRadius,
      intermediateStep: l0?.intermediateStep,
      constructionStyle: stair.constructionStyle,
      landingStructure: l0?.structure ?? stair.landingStructure,
      landingThickness: l0?.thickness ?? stair.landingThickness,
      supportPosts: l0?.supportPosts ?? stair.supportPosts,
      railingStyle: stair.railingStyle,
      railingSide: stair.railingSide,
      railingHeight: stair.railingHeight,
      cutFloorAbove: stair.cutFloorAbove,
      layer: stair.layer,
    });
    return {
      ...stair,
      ...rebuilt,
      baseOffset: stair.baseOffset,
      topOffset: stair.topOffset,
    };
  }

  // Custom multi-run stair: rebalance runs[0] and runs[1] along their existing directions
  const r1Count = clampedRiser;
  const r2Count = Math.max(1, N - r1Count - (runs[2]?.numRisers ?? 0));
  const riserHeight = totalRise / N;
  const td = stair.treadDepth;

  const newEnd1 = add(runs[0].start, scale(dir1, Math.max(1, r1Count - 1) * td));
  const delta1 = sub(newEnd1, runs[0].end);
  const dir2 = normalize(sub(runs[1].end, runs[1].start));
  const newStart2 = add(runs[1].start, delta1);
  const newEnd2 = add(newStart2, scale(dir2, Math.max(1, r2Count - 1) * td));

  const nextRun1: StairRun = {
    ...runs[0],
    end: newEnd1,
    numRisers: r1Count,
    topElevationOffset: r1Count * riserHeight,
  };
  const nextRun2: StairRun = {
    ...runs[1],
    start: newStart2,
    end: newEnd2,
    numRisers: r2Count,
    startRiserIndex: r1Count + 1,
    baseElevationOffset: r1Count * riserHeight,
    topElevationOffset: (r1Count + r2Count) * riserHeight,
  };

  const conn = generateConnectedLandingPolygon(nextRun1, nextRun2, {
    depthOverride: l0?.depth ?? stair.width,
    widthOverride: l0?.width,
    cornerRadius: l0?.cornerRadius,
  });

  const nextLanding0: StairLanding = {
    ...(l0 || {
      id: 'landing-1',
      afterRunIndex: 0,
      thickness: stair.landingThickness ?? 6,
      structure: stair.landingStructure ?? 'monolithic',
    }),
    afterRiser: r1Count,
    elevationOffset: r1Count * riserHeight,
    polygon: conn.polygon,
    depth: conn.depth,
    width: conn.width,
  };

  const nextRuns = [nextRun1, nextRun2, ...runs.slice(2)];
  const nextLandings = [nextLanding0, ...landings.slice(1)];

  return {
    ...stair,
    start: nextRuns[0].start,
    end: nextRuns[nextRuns.length - 1].end,
    runs: nextRuns,
    landings: nextLandings,
  };
}

/**
 * Resizes a landing's depth and/or width, shifting downstream runs so zero gaps are preserved.
 */
export function resizeStairLanding(
  stair: StairEntity,
  levels: LevelDefinition[],
  landingIndex: number,
  patch: {
    depth?: number;
    width?: number;
    cornerRadius?: number;
    intermediateStep?: boolean;
    thickness?: number;
    structure?: StairLandingStructure;
    supportPosts?: boolean;
  }
): StairEntity {
  const { runs, landings, baseElevation, topElevation } = ensureStairRunsAndLandings(stair, levels);
  const current = landings[landingIndex];
  if (!current || runs.length < 2) return stair;

  const nextDepth = patch.depth !== undefined ? Math.max(24, patch.depth) : current.depth;
  const nextWidth = patch.width !== undefined ? Math.max(stair.width, patch.width) : current.width;
  const nextCornerRadius = patch.cornerRadius !== undefined ? Math.max(0, patch.cornerRadius) : current.cornerRadius;
  const nextIntermediateStep = patch.intermediateStep !== undefined ? patch.intermediateStep : current.intermediateStep;
  const nextThickness = patch.thickness !== undefined ? Math.max(2, patch.thickness) : current.thickness;
  const nextStructure = patch.structure !== undefined ? patch.structure : current.structure;
  const nextSupportPosts = patch.supportPosts !== undefined ? patch.supportPosts : current.supportPosts;

  const dir1 = normalize(sub(runs[0].end, runs[0].start));
  if (stair.shape && stair.shape !== 'straight') {
    const rebuilt = createStairFromTemplate({
      id: stair.id,
      origin: runs[0].start,
      direction: dir1,
      baseLevelId: stair.baseLevelId,
      topLevelId: stair.topLevelId,
      baseElevation,
      topElevation,
      width: stair.width,
      treadDepth: stair.treadDepth,
      maxRiserHeight: stair.maxRiserHeight,
      desiredRisers: stair.numRisers,
      shape: stair.shape,
      splitRiser: current.afterRiser,
      landingDepth: nextDepth,
      landingWidth: nextWidth,
      wellGap: stair.wellGap ?? 6,
      cornerRadius: nextCornerRadius,
      intermediateStep: nextIntermediateStep,
      constructionStyle: stair.constructionStyle,
      landingStructure: nextStructure,
      landingThickness: nextThickness,
      supportPosts: nextSupportPosts,
      railingStyle: stair.railingStyle,
      railingSide: stair.railingSide,
      railingHeight: stair.railingHeight,
      cutFloorAbove: stair.cutFloorAbove,
      layer: stair.layer,
    });
    return {
      ...stair,
      ...rebuilt,
      baseOffset: stair.baseOffset,
      topOffset: stair.topOffset,
    };
  }

  // Custom run: shift Run 2 along Run 1's direction if straight landing, or regenerate polygon
  const deltaDepth = nextDepth - current.depth;
  const nextRuns = runs.map((r, idx) =>
    idx > landingIndex
      ? { ...r, start: add(r.start, scale(dir1, deltaDepth)), end: add(r.end, scale(dir1, deltaDepth)) }
      : r
  );
  const conn = generateConnectedLandingPolygon(nextRuns[landingIndex], nextRuns[landingIndex + 1], {
    depthOverride: nextDepth,
    widthOverride: nextWidth,
    cornerRadius: nextCornerRadius,
  });
  const updatedLanding: StairLanding = {
    ...current,
    polygon: conn.polygon,
    depth: conn.depth,
    width: conn.width,
    cornerRadius: nextCornerRadius,
    intermediateStep: nextIntermediateStep,
    thickness: nextThickness,
    structure: nextStructure,
    supportPosts: nextSupportPosts,
  };
  const nextLandings = landings.map((l, idx) => (idx === landingIndex ? updatedLanding : l));

  return {
    ...stair,
    end: nextRuns[nextRuns.length - 1].end,
    runs: nextRuns,
    landings: nextLandings,
  };
}

// ============================================================================
// 6. 2D ARCHITECTURAL PLAN GEOMETRY (Treads, Riser Numbers, Cut Line, Walk Path)
// ============================================================================

export interface StairTreadLine2D {
  a: Point;
  b: Point;
  riserNumber: number;
  elevationOffset: number;
  aboveCut: boolean;
}

export interface StairWinderTread2D {
  polygon: Point[];
  riserNumber: number;
  elevationOffset: number;
  aboveCut: boolean;
}

export interface StairLandingPlan2D {
  id: string;
  polygon: Point[];
  elevationOffset: number;
  aboveCut: boolean;
  intermediateStepLine?: [Point, Point];
}

export interface StairPlanDimension2D {
  id: string;
  kind: 'run-width' | 'tread-depth' | 'landing-depth' | 'landing-width' | 'well-gap';
  p1: Point;
  p2: Point;
  labelPos: Point;
  value: number;
  landingIndex?: number;
}

export interface StairPlanGeometry2D {
  /** Legacy 4-point outline of Run 1 for backwards compatibility */
  outline: [Point, Point, Point, Point];
  /** Legacy riser lines list for backwards compatibility */
  riserLines: Array<{ a: Point; b: Point }>;
  /** Legacy arrow shaft for backwards compatibility */
  arrowShaft: { a: Point; b: Point };
  /** Legacy arrow head for backwards compatibility */
  arrowHead: [Point, Point, Point];
  /** Multi-run & landing architectural display data */
  runPolygons: Array<{ id: string; polygon: Point[]; belowCutPolygon?: Point[]; aboveCutPolygon?: Point[] }>;
  landingPolygons: StairLandingPlan2D[];
  treadLines: StairTreadLine2D[];
  winderPolygons: StairWinderTread2D[];
  riserLabels: Array<{ position: Point; text: string; riserNumber: number; aboveCut: boolean }>;
  cutBreakLine: { a: Point; b: Point; zigzag: Point[] } | null;
  walkPath: Point[];
  walkArrowHead: [Point, Point, Point];
  walkStartCircle: Point;
  walkLabel: { position: Point; text: 'UP' | 'DN'; detail: string };
  dimensions: StairPlanDimension2D[];
  headroomOpeningPolygon: Point[];
}

/**
 * Generates the diagonal architectural break line with a central break symbol across a flight at `cutPoint`.
 */
function buildCutBreakSymbol(center: Point, runDir: Point, leftNormal: Point, width: number): {
  a: Point;
  b: Point;
  zigzag: Point[];
} {
  const hw = width / 2 + 3;
  // Diagonal angle (~30° tilted across the run width)
  const diagVec = normalize(add(leftNormal, scale(runDir, 0.38)));
  const a = add(center, scale(diagVec, hw));
  const b = add(center, scale(diagVec, -hw));
  const perpDiag = perpLeft(diagVec);
  const z1 = lerpPoint(a, b, 0.42);
  const z2 = add(lerpPoint(a, b, 0.47), scale(perpDiag, 4));
  const z3 = add(lerpPoint(a, b, 0.53), scale(perpDiag, -4));
  const z4 = lerpPoint(a, b, 0.58);
  return {
    a,
    b,
    zigzag: [a, z1, z2, z3, z4, b],
  };
}

/**
 * Computes full architectural 2D plan geometry for any `StairEntity` (straight, mid-landing,
 * L-stair, U-switchback, 3-run U, winder, or spiral).
 *
 * When `viewedFromTopLevel === true` (viewing from `topLevelId` looking down):
 * - All treads and landings are drawn with SOLID lines (no dashed above-cut split)
 * - Walk-line label displays `"DN"` pointing from top of stair down toward base.
 */
export function computeStairPlanGeometry(
  stair: StairEntity,
  optionsOrLevels?:
    | {
        levels?: LevelDefinition[];
        viewedFromTopLevel?: boolean;
        cutPlaneInches?: number;
      }
    | LevelDefinition[],
  activeLevelId?: string
): StairPlanGeometry2D {
  const isLevelsArray = Array.isArray(optionsOrLevels);
  const levels = isLevelsArray ? optionsOrLevels : optionsOrLevels?.levels;
  const viewedFromTop = isLevelsArray
    ? Boolean(
        activeLevelId &&
          stair.topLevelId === activeLevelId &&
          (stair.baseLevelId || stair.levelId) !== activeLevelId
      )
    : Boolean(optionsOrLevels?.viewedFromTopLevel);
  const cutPlane = isLevelsArray
    ? STAIR_CUT_PLANE_INCHES
    : optionsOrLevels?.cutPlaneInches ?? STAIR_CUT_PLANE_INCHES;
  const { runs, landings, totalRise } = ensureStairRunsAndLandings(stair, levels);
  const riserHeight = stair.riserHeight || totalRise / Math.max(2, stair.numRisers || 16);

  const runPolygons: Array<{ id: string; polygon: Point[] }> = [];
  const treadLines: StairTreadLine2D[] = [];
  const winderPolygons: StairWinderTread2D[] = [];
  const riserLabels: Array<{ position: Point; text: string; riserNumber: number; aboveCut: boolean }> = [];
  let cutBreakLine: { a: Point; b: Point; zigzag: Point[] } | null = null;
  const walkPath: Point[] = [];
  const dimensions: StairPlanDimension2D[] = [];

  // ---- Special case: SPIRAL STAIR ----
  if (stair.shape === 'spiral') {
    const center = runs[0].start;
    const outerR = Math.max(30, stair.spiralRadius ?? stair.width ?? 42);
    const innerR = Math.max(3, stair.spiralInnerRadius ?? 4);
    const totalRisers = Math.max(8, stair.numRisers || 16);
    const totalDeg = stair.spiralTurns ?? 360;
    const dirSign = stair.spiralClockwise === false ? -1 : 1;
    const walkR = innerR + (outerR - innerR) * 0.6;

    const circlePoly: Point[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      circlePoly.push({ x: center.x + outerR * Math.cos(a), y: center.y + outerR * Math.sin(a) });
    }
    runPolygons.push({ id: 'spiral-body', polygon: circlePoly });

    for (let i = 0; i < totalRisers; i++) {
      const a0 = (dirSign * (i / totalRisers) * totalDeg * Math.PI) / 180;
      const a1 = (dirSign * ((i + 1) / totalRisers) * totalDeg * Math.PI) / 180;
      const elev = (i + 1) * riserHeight;
      const aboveCut = !viewedFromTop && elev > cutPlane;

      const pIn0 = { x: center.x + innerR * Math.cos(a0), y: center.y + innerR * Math.sin(a0) };
      const pOut0 = { x: center.x + outerR * Math.cos(a0), y: center.y + outerR * Math.sin(a0) };
      const pOutMid = { x: center.x + outerR * Math.cos((a0 + a1) / 2), y: center.y + outerR * Math.sin((a0 + a1) / 2) };
      const pOut1 = { x: center.x + outerR * Math.cos(a1), y: center.y + outerR * Math.sin(a1) };
      const pIn1 = { x: center.x + innerR * Math.cos(a1), y: center.y + innerR * Math.sin(a1) };

      treadLines.push({
        a: pIn0,
        b: pOut0,
        riserNumber: i + 1,
        elevationOffset: elev,
        aboveCut,
      });
      if (i < totalRisers - 1) {
        winderPolygons.push({
          polygon: [pIn0, pOut0, pOutMid, pOut1, pIn1],
          riserNumber: i + 1,
          elevationOffset: elev,
          aboveCut,
        });
      }
      const midA = (a0 + a1) / 2;
      riserLabels.push({
        position: { x: center.x + (outerR - 7) * Math.cos(midA), y: center.y + (outerR - 7) * Math.sin(midA) },
        text: String(i + 1),
        riserNumber: i + 1,
        aboveCut,
      });
      const prevElev = i * riserHeight;
      if (!viewedFromTop && !cutBreakLine && prevElev <= cutPlane && elev >= cutPlane) {
        cutBreakLine = {
          a: pIn0,
          b: pOut0,
          zigzag: [pIn0, lerpPoint(pIn0, pOut0, 0.45), lerpPoint(pIn0, pOut0, 0.55), pOut0],
        };
      }
      walkPath.push({ x: center.x + walkR * Math.cos(a0), y: center.y + walkR * Math.sin(a0) });
    }

    const headTip = walkPath[walkPath.length - 1] || { x: center.x + walkR, y: center.y };
    const prevPt = walkPath[Math.max(0, walkPath.length - 2)] || center;
    const hDir = normalize(sub(headTip, prevPt));
    const hNorm = perpLeft(hDir);
    const headBase = add(headTip, scale(hDir, -7));
    const walkArrowHead: [Point, Point, Point] = [
      add(headBase, scale(hNorm, 4.5)),
      headTip,
      add(headBase, scale(hNorm, -4.5)),
    ];

    const firstEdge = getRunEdgeGeometry(runs[0]);
    return {
      outline: firstEdge.outline,
      riserLines: treadLines.map((t) => ({ a: t.a, b: t.b })),
      arrowShaft: { a: walkPath[0] || center, b: headTip },
      arrowHead: walkArrowHead,
      runPolygons,
      landingPolygons: [],
      treadLines,
      winderPolygons,
      riserLabels,
      cutBreakLine,
      walkPath,
      walkArrowHead,
      walkStartCircle: walkPath[0] || center,
      walkLabel: {
        position: add(center, { x: 0, y: outerR + 10 }),
        text: viewedFromTop ? 'DN' : 'UP',
        detail: `${totalRisers}R @ ${riserHeight.toFixed(2)}"`,
      },
      dimensions: [
        {
          id: 'dim-spiral-r',
          kind: 'run-width',
          p1: center,
          p2: { x: center.x + outerR, y: center.y },
          labelPos: { x: center.x + outerR / 2, y: center.y - 8 },
          value: outerR * 2,
        },
      ],
      headroomOpeningPolygon: circlePoly,
    };
  }

  // ---- Standard & Multi-Run / Landing / Winder Stairs ----
  for (let rIdx = 0; rIdx < runs.length; rIdx++) {
    const run = runs[rIdx];
    const edge = getRunEdgeGeometry(run);
    runPolygons.push({ id: run.id, polygon: edge.outline });

    const nRisers = Math.max(2, run.numRisers);
    for (let i = 0; i < nRisers; i++) {
      const t = nRisers <= 1 ? 0 : i / (nRisers - 1);
      const c = lerpPoint(run.start, run.end, t);
      const riserNum = run.startRiserIndex + i;
      const elev = riserNum * riserHeight;
      const aboveCut = !viewedFromTop && elev > cutPlane;

      const a = add(c, scale(edge.leftNormal, run.width / 2));
      const b = add(c, scale(edge.leftNormal, -run.width / 2));
      treadLines.push({
        a,
        b,
        riserNumber: riserNum,
        elevationOffset: elev,
        aboveCut,
      });

      // Place riser number label near the outer/left stringer edge
      const labelPos = add(
        add(c, scale(edge.dir, Math.min(4, run.treadDepth * 0.35))),
        scale(edge.leftNormal, run.width / 2 - 6)
      );
      riserLabels.push({
        position: labelPos,
        text: String(riserNum),
        riserNumber: riserNum,
        aboveCut,
      });

      // Check if the 4'-0" (48") cut plane falls right after this riser
      const prevElev = (riserNum - 1) * riserHeight;
      if (!viewedFromTop && !cutBreakLine && prevElev <= cutPlane && elev >= cutPlane) {
        cutBreakLine = buildCutBreakSymbol(c, edge.dir, edge.leftNormal, run.width);
      }
    }

    // Add walk-line points along the centerline of this run
    const walkStart = rIdx === 0 ? lerpPoint(run.start, run.end, 0.06) : run.start;
    const walkEnd = rIdx === runs.length - 1 ? lerpPoint(run.start, run.end, 0.92) : run.end;
    walkPath.push(walkStart, walkEnd);

    // If there is a landing after this run, add intermediate turning points on the landing so the walk-line turns smoothly!
    const landing = landings.find((l) => l.afterRunIndex === rIdx);
    const nextRun = runs[rIdx + 1];
    if (landing && nextRun) {
      const nextEdge = getRunEdgeGeometry(nextRun);
      const cosTurn = dot(edge.dir, nextEdge.dir);
      const turnDepth = Math.max(run.width * 0.5, landing.depth * 0.5);
      if (cosTurn < -0.7) {
        // 180° U-turn across landing: project out into landing, cross over, and enter Run 2
        const pTurn1 = add(run.end, scale(edge.dir, turnDepth));
        const pTurnMid = midpoint(
          add(run.end, scale(edge.dir, turnDepth * 1.15)),
          add(nextRun.start, scale(edge.dir, turnDepth * 1.15))
        );
        const pTurn2 = add(nextRun.start, scale(edge.dir, turnDepth));
        walkPath.push(pTurn1, pTurnMid, pTurn2);
      } else if (Math.abs(cosTurn) <= 0.7) {
        // 90° L-turn across landing: corner pivot point where centerlines intersect
        const pivot = add(run.end, scale(edge.dir, landing.depth - nextRun.width / 2));
        walkPath.push(pivot);
      }

      // If Winder stair, generate pie-shaped winder treads inside the turn polygon!
      if (stair.shape === 'winder-l' || stair.shape === 'winder-u') {
        const wCount = stair.shape === 'winder-u' ? 6 : 3;
        // Inner pivot is edge.exitLeft (for left turn)
        const pivot = edge.exitLeft;
        const baseRiser = run.startRiserIndex + run.numRisers;
        const startVec = sub(edge.exitRight, pivot);
        const totalSweepRad = stair.shape === 'winder-u' ? -Math.PI : -Math.PI / 2;

        for (let wIdx = 0; wIdx < wCount; wIdx++) {
          const rNum = baseRiser + wIdx;
          const elev = rNum * riserHeight;
          const aboveCut = !viewedFromTop && elev > cutPlane;
          const ang0 = (wIdx / wCount) * totalSweepRad;
          const ang1 = ((wIdx + 1) / wCount) * totalSweepRad;
          const ray0 = add(pivot, scale(rotateVec(startVec, ang0), 1.15));
          const ray1 = add(pivot, scale(rotateVec(startVec, ang1), 1.15));
          const prevElev = (rNum - 1) * riserHeight;
          if (!viewedFromTop && !cutBreakLine && prevElev <= cutPlane && elev >= cutPlane) {
            cutBreakLine = buildCutBreakSymbol(run.end, edge.dir, edge.leftNormal, run.width);
          }
          if (wIdx > 0) {
            treadLines.push({
              a: pivot,
              b: ray0,
              riserNumber: rNum,
              elevationOffset: elev,
              aboveCut,
            });
          }
          winderPolygons.push({
            polygon: [pivot, ray0, ray1],
            riserNumber: rNum,
            elevationOffset: elev,
            aboveCut,
          });
          const midRay = add(pivot, scale(rotateVec(startVec, (ang0 + ang1) / 2), 0.72));
          riserLabels.push({
            position: midRay,
            text: String(rNum),
            riserNumber: rNum,
            aboveCut,
          });
        }
      }
    }
  }

  // Build landing plan polygons (including optional intermediate step on U-landing)
  const landingPolygons: StairLandingPlan2D[] = landings.map((l) => {
    const aboveCut = !viewedFromTop && l.elevationOffset > cutPlane;
    let intermediateStepLine: [Point, Point] | undefined;
    if (l.intermediateStep && runs.length >= 2) {
      const edge0 = getRunEdgeGeometry(runs[0]);
      const midBack = midpoint(runs[0].end, runs[1].start);
      const midFront = add(midBack, scale(edge0.dir, l.depth));
      intermediateStepLine = [midBack, midFront];
    }
    return {
      id: l.id,
      polygon: l.customBoundary && l.customBoundary.length >= 3 ? l.customBoundary : l.polygon,
      elevationOffset: l.elevationOffset,
      aboveCut,
      intermediateStepLine,
    };
  });

  // Walk-line direction & arrow head (points UP on base level, DN on top level)
  const orderedWalkPath = viewedFromTop ? [...walkPath].reverse() : walkPath;
  const arrowTip = orderedWalkPath[orderedWalkPath.length - 1] || runs[runs.length - 1].end;
  const arrowPrev = orderedWalkPath[Math.max(0, orderedWalkPath.length - 2)] || runs[0].start;
  const arrowDir = normalize(sub(arrowTip, arrowPrev));
  const arrowNorm = perpLeft(arrowDir);
  const headBase = add(arrowTip, scale(arrowDir, -8));
  const walkArrowHead: [Point, Point, Point] = [
    add(headBase, scale(arrowNorm, 5)),
    arrowTip,
    add(headBase, scale(arrowNorm, -5)),
  ];
  const walkStartCircle = orderedWalkPath[0] || runs[0].start;

  // Dimensions for Run Width, Tread Depth, and Landing Depth x Width
  const firstEdge = getRunEdgeGeometry(runs[0]);
  dimensions.push({
    id: 'dim-run-width',
    kind: 'run-width',
    p1: firstEdge.entryLeft,
    p2: firstEdge.entryRight,
    labelPos: add(runs[0].start, scale(firstEdge.dir, -12)),
    value: runs[0].width,
  });
  if (runs[0].numRisers >= 2) {
    const t0 = firstEdge.entryRight;
    const t1 = add(firstEdge.entryRight, scale(firstEdge.dir, runs[0].treadDepth));
    dimensions.push({
      id: 'dim-tread-depth',
      kind: 'tread-depth',
      p1: t0,
      p2: t1,
      labelPos: add(midpoint(t0, t1), scale(firstEdge.leftNormal, -10)),
      value: runs[0].treadDepth,
    });
  }
  landings.forEach((l, idx) => {
    if (l.polygon.length >= 3) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of l.polygon) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      dimensions.push({
        id: `dim-landing-depth-${idx}`,
        kind: 'landing-depth',
        p1: { x: minX, y: maxY },
        p2: { x: maxX, y: maxY },
        labelPos: { x: (minX + maxX) / 2, y: maxY + 11 },
        value: l.depth,
        landingIndex: idx,
      });
      dimensions.push({
        id: `dim-landing-width-${idx}`,
        kind: 'landing-width',
        p1: { x: maxX, y: minY },
        p2: { x: maxX, y: maxY },
        labelPos: { x: maxX + 14, y: (minY + maxY) / 2 },
        value: l.width,
        landingIndex: idx,
      });
    }
  });

  const headroom = computeStairHeadroomAndOpening(stair, levels);

  return {
    outline: firstEdge.outline,
    riserLines: treadLines.map((t) => ({ a: t.a, b: t.b })),
    arrowShaft: { a: walkStartCircle, b: arrowTip },
    arrowHead: walkArrowHead,
    runPolygons,
    landingPolygons,
    treadLines,
    winderPolygons,
    riserLabels,
    cutBreakLine,
    walkPath: orderedWalkPath,
    walkArrowHead,
    walkStartCircle,
    walkLabel: {
      position: add(walkStartCircle, scale(firstEdge.dir, 14)),
      text: viewedFromTop ? 'DN' : 'UP',
      detail: `${stair.numRisers}R @ ${riserHeight.toFixed(2)}"`,
    },
    dimensions,
    headroomOpeningPolygon: headroom.openingPolygon,
  };
}

// ============================================================================
// 7. HEADROOM CLEARANCE & AUTOMATIC FLOOR OPENING ("Cut Floor Above")
// ============================================================================

export interface StairHeadroomResult {
  /** Polygon in world plan coordinates that cuts the upper floor slab */
  openingPolygon: Point[];
  /** Individual component polygons (runs + landings) for exact L/U cutouts */
  componentPolygons: Point[][];
  /** Minimum headroom clearance in inches (>= 80" = 6'-8" passes code) */
  minHeadroomInches: number;
  /** True when minHeadroomInches >= targetHeadroom (default 80") */
  passesCode: boolean;
  /** Riser index where the upper floor opening starts in order to maintain 6'-8" headroom */
  openingStartRiser: number;
}

/**
 * Computes the stairwell opening polygon that covers both runs and the landing footprint
 * while verifying minimum 6'-8" (80") headroom clearance under the upper floor slab!
 */
export function computeStairHeadroomAndOpening(
  stair: StairEntity,
  levels: LevelDefinition[] = [],
  upperSlabThickness = 8
): StairHeadroomResult {
  const { runs, landings, totalRise } = ensureStairRunsAndLandings(stair, levels);
  const targetHeadroom = stair.headroomTarget ?? MIN_HEADROOM_INCHES; // 80" = 6'-8"
  const riserHeight = stair.riserHeight || totalRise / Math.max(2, stair.numRisers || 16);

  // Maximum stair elevation where an overhead slab of thickness `upperSlabThickness` still leaves 80" headroom:
  // slabUnderside = totalRise - upperSlabThickness
  // maxSafeStepElev = slabUnderside - targetHeadroom
  const slabUnderside = Math.max(targetHeadroom + 7, totalRise - upperSlabThickness);
  const maxSafeStepElev = Math.max(0, slabUnderside - targetHeadroom);
  const openingStartRiser = Math.max(1, Math.floor(maxSafeStepElev / riserHeight) + 1);

  const componentPolygons: Point[][] = [];
  for (const r of runs) {
    componentPolygons.push(getRunEdgeGeometry(r).outline);
  }
  for (const l of landings) {
    if (l.polygon.length >= 3) componentPolygons.push(l.polygon);
  }

  // Build a clean L-shaped, U-shaped, or rectangular opening hull covering all runs and landings:
  // For multi-run L or U stairs, trace the true composite outer perimeter or bounding polygon
  const openingPolygon = buildCompositeStairOpeningPolygon(stair, runs, landings);

  // If the floor opening covers from Riser 1 (full stairwell shaft), headroom is unobstructed (`totalRise + 80`);
  // If constrained, headroom at `openingStartRiser - 1` is `slabUnderside - (openingStartRiser - 1) * riserHeight >= 80"`.
  const stepElevAtCutStart = Math.max(0, (openingStartRiser - 1) * riserHeight);
  const minHeadroomInches = Number((slabUnderside - stepElevAtCutStart).toFixed(1));

  return {
    openingPolygon,
    componentPolygons,
    minHeadroomInches,
    passesCode: minHeadroomInches >= targetHeadroom - 0.1,
    openingStartRiser,
  };
}

/**
 * Builds a single closed polygon covering all runs and landings of a stair for `FloorEntity.openings`.
 * - For Straight / Straight-Landing / U-Switchback / 3-Run U: returns the exact tight oriented bounding rectangle
 *   covering both runs and the landing(s).
 * - For 90° L-Stairs (`l-left` / `l-right` / `winder-l`): returns the true 6-vertex L-shaped polygon
 *   covering Run 1 + Corner Landing + Run 2!
 */
function buildCompositeStairOpeningPolygon(
  stair: StairEntity,
  runs: StairRun[],
  landings: StairLanding[]
): Point[] {
  if (stair.shape === 'spiral') {
    const center = runs[0].start;
    const r = Math.max(30, stair.spiralRadius ?? stair.width ?? 42);
    const pts: Point[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
    }
    return pts;
  }

  const e0 = getRunEdgeGeometry(runs[0]);
  const dir1 = e0.dir;
  const left1 = e0.leftNormal;

  // Check if 2-run 90° L-stair: build exact 6-point L-polygon covering Run 1 + Landing + Run 2
  if (runs.length === 2 && landings.length === 1) {
    const e1 = getRunEdgeGeometry(runs[1]);
    const cosAng = dot(dir1, e1.dir);
    const sinAng = cross(dir1, e1.dir);
    if (Math.abs(cosAng) < 0.35) {
      const lPoly = landings[0].polygon;
      // Project all points into (dir1, left1) local frame anchored at runs[0].start
      const toLocal = (p: Point) => ({
        u: dot(sub(p, runs[0].start), dir1),
        v: dot(sub(p, runs[0].start), left1),
      });
      const toWorld = (u: number, v: number): Point =>
        add(add(runs[0].start, scale(dir1, u)), scale(left1, v));

      const allPts = [...e0.outline, ...lPoly, ...e1.outline].map(toLocal);
      const minU = Math.min(...allPts.map((p) => p.u));
      const maxU = Math.max(...allPts.map((p) => p.u));
      const minV = Math.min(...allPts.map((p) => p.v));
      const maxV = Math.max(...allPts.map((p) => p.v));

      const r0Local = e0.outline.map(toLocal);
      const r0MinV = Math.min(...r0Local.map((p) => p.v));
      const r0MaxV = Math.max(...r0Local.map((p) => p.v));
      const r1Local = e1.outline.map(toLocal);
      const r1MinU = Math.min(...r1Local.map((p) => p.u));

      if (sinAng < 0) {
        // Left turn (+v in local coords): 6-vertex L-polygon
        return [
          toWorld(minU, r0MinV),
          toWorld(maxU, r0MinV),
          toWorld(maxU, maxV),
          toWorld(r1MinU, maxV),
          toWorld(r1MinU, r0MaxV),
          toWorld(minU, r0MaxV),
        ];
      } else {
        // Right turn (-v in local coords): 6-vertex L-polygon
        return [
          toWorld(minU, r0MaxV),
          toWorld(maxU, r0MaxV),
          toWorld(maxU, minV),
          toWorld(r1MinU, minV),
          toWorld(r1MinU, r0MinV),
          toWorld(minU, r0MinV),
        ];
      }
    }
  }

  // Oriented bounding rectangle in Run 1's local frame covering all runs and landings
  const toLocal = (p: Point) => ({
    u: dot(sub(p, runs[0].start), dir1),
    v: dot(sub(p, runs[0].start), left1),
  });
  const toWorld = (u: number, v: number): Point =>
    add(add(runs[0].start, scale(dir1, u)), scale(left1, v));

  const allWorldPts: Point[] = [];
  for (const r of runs) allWorldPts.push(...getRunEdgeGeometry(r).outline);
  for (const l of landings) allWorldPts.push(...l.polygon);

  const localPts = allWorldPts.map(toLocal);
  const minU = Math.min(...localPts.map((p) => p.u));
  const maxU = Math.max(...localPts.map((p) => p.u));
  const minV = Math.min(...localPts.map((p) => p.v));
  const maxV = Math.max(...localPts.map((p) => p.v));

  return [
    toWorld(minU, minV),
    toWorld(maxU, minV),
    toWorld(maxU, maxV),
    toWorld(minU, maxV),
  ];
}

function pointInPolySimple(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonsOverlap(polyA: Point[], polyB: Point[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  for (const p of polyA) if (pointInPolySimple(p, polyB)) return true;
  for (const p of polyB) if (pointInPolySimple(p, polyA)) return true;
  const cA = polyA.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  if (pointInPolySimple({ x: cA.x / polyA.length, y: cA.y / polyA.length }, polyB)) return true;
  return false;
}

/**
 * Synchronizes automatic floor openings ("Cut Floor Above") on upper-level `FloorEntity` slabs
 * for all stairs in `entities`.
 * Uses a deterministic marker on the opening points (or recomputes stair-managed openings)
 * so moving, resizing, or toggling `cutFloorAbove` updates the upper floor slab live!
 */
export function syncStairFloorOpenings(
  entities: ArchEntity[],
  levels: LevelDefinition[] = []
): ArchEntity[] {
  const stairs = entities.filter((e): e is StairEntity => e.type === 'stair');
  const activeStairs = stairs.filter((st) => st.cutFloorAbove !== false);

  // Compute opening polygons per target topLevelId
  const openingsByLevel = new Map<string, Point[][]>();
  for (const st of activeStairs) {
    const topLvlId = st.topLevelId || 'level-2';
    const { openingPolygon } = computeStairHeadroomAndOpening(st, levels);
    if (openingPolygon.length >= 3) {
      // Tag the first point with a non-enumerable or tiny metadata? No, JSON serialization strips symbols.
      // Instead, we match floor slabs on `topLvlId` whose outer polygon overlaps the stair opening!
      const list = openingsByLevel.get(topLvlId) ?? [];
      list.push(openingPolygon);
      openingsByLevel.set(topLvlId, list);
    }
  }

  let anyChanged = false;
  const nextEntities = entities.map((ent) => {
    if (ent.type !== 'floor') return ent;
    const fl = ent as FloorEntity;
    const lvlId = fl.levelId || 'level-1';
    const candidateOpenings = (openingsByLevel.get(lvlId) ?? []).filter((op) =>
      polygonsOverlap(op, fl.polygon)
    );

    const prevOpenings = fl.openings ?? [];
    if (candidateOpenings.length === 0 && prevOpenings.length === 0) return ent;

    const prevSig = JSON.stringify(prevOpenings);
    const nextSig = JSON.stringify(candidateOpenings);
    if (prevSig === nextSig) return ent;

    anyChanged = true;
    return {
      ...fl,
      openings: candidateOpenings.length > 0 ? candidateOpenings : undefined,
    };
  });

  return anyChanged ? nextEntities : entities;
}

// ============================================================================
// 8. DIRECT MANIPULATION GRIPS & TRANSFORMS FOR MULTI-RUN STAIRS & LANDINGS
// ============================================================================

export function getStairGrips(stair: StairEntity, levels: LevelDefinition[] = []): GripPoint[] {
  const { runs, landings } = ensureStairRunsAndLandings(stair, levels);
  const grips: GripPoint[] = [
    { entityId: stair.id, gripIndex: 'start', point: runs[0].start, kind: 'endpoint' },
    { entityId: stair.id, gripIndex: 'end', point: runs[runs.length - 1].end, kind: 'endpoint' },
    {
      entityId: stair.id,
      gripIndex: 'mid',
      point: midpoint(runs[0].start, runs[runs.length - 1].end),
      kind: 'midpoint',
    },
  ];

  // Width grip on Run 1 right edge midpoint
  const e0 = getRunEdgeGeometry(runs[0]);
  grips.push({
    entityId: stair.id,
    gripIndex: 'run-width',
    point: midpoint(e0.entryRight, e0.exitRight),
    kind: 'midpoint',
  });

  // Landing depth & width grips in 2D plan
  landings.forEach((l, idx) => {
    if (l.polygon.length >= 3 && runs[idx]) {
      const rEdge = getRunEdgeGeometry(runs[idx]);
      // Depth handle at the front edge of the landing along Run idx's direction
      const frontMid = add(runs[idx].end, scale(rEdge.dir, l.depth));
      grips.push({
        entityId: stair.id,
        gripIndex: `landing-depth-${idx}`,
        point: frontMid,
        kind: 'midpoint',
      });
      // Width handle at the outer side of the landing
      const sidePt = add(
        add(runs[idx].end, scale(rEdge.dir, l.depth * 0.5)),
        scale(rEdge.leftNormal, -l.width / 2)
      );
      grips.push({
        entityId: stair.id,
        gripIndex: `landing-width-${idx}`,
        point: sidePt,
        kind: 'endpoint',
      });
    }
  });

  return grips;
}

export function applyStairGripMove(
  stair: StairEntity,
  gripIndex: string,
  newPoint: Point,
  levels: LevelDefinition[] = []
): StairEntity {
  const { runs, landings } = ensureStairRunsAndLandings(stair, levels);
  if (gripIndex === 'mid') {
    const oldMid = midpoint(runs[0].start, runs[runs.length - 1].end);
    return moveStairEntity(stair, sub(newPoint, oldMid));
  }
  if (gripIndex === 'start' && runs.length === 1) {
    const nextRun = { ...runs[0], start: newPoint };
    return { ...stair, start: newPoint, runs: [nextRun] };
  }
  if (gripIndex === 'start') {
    return moveStairEntity(stair, sub(newPoint, runs[0].start));
  }
  if (gripIndex === 'end' && runs.length === 1) {
    const nextRun = { ...runs[0], end: newPoint };
    return { ...stair, end: newPoint, runs: [nextRun] };
  }
  if (gripIndex === 'end' && runs.length >= 2) {
    const lastIdx = runs.length - 1;
    const lastRun = runs[lastIdx];
    const dir = normalize(sub(lastRun.end, lastRun.start));
    const projLen = Math.max(stair.treadDepth * 2, dot(sub(newPoint, lastRun.start), dir));
    const nextEnd = add(lastRun.start, scale(dir, projLen));
    const nextRuns = runs.map((r, i) => (i === lastIdx ? { ...r, end: nextEnd } : r));
    return { ...stair, end: nextEnd, runs: nextRuns };
  }
  if (gripIndex === 'run-width') {
    const e0 = getRunEdgeGeometry(runs[0]);
    const midCenter = midpoint(runs[0].start, runs[0].end);
    const halfW = Math.max(15, Math.abs(dot(sub(newPoint, midCenter), e0.leftNormal)));
    const nextW = Math.round(halfW * 2);
    const nextRuns = runs.map((r) => ({ ...r, width: nextW }));
    return resizeStairLanding({ ...stair, width: nextW, runs: nextRuns }, levels, 0, {
      depth: Math.max(nextW, landings[0]?.depth ?? nextW),
    });
  }
  if (gripIndex.startsWith('landing-depth-')) {
    const idx = parseInt(gripIndex.replace('landing-depth-', ''), 10);
    const run = runs[idx];
    if (!run) return stair;
    const rEdge = getRunEdgeGeometry(run);
    const newDepth = Math.max(stair.width, Math.round(dot(sub(newPoint, run.end), rEdge.dir)));
    return resizeStairLanding(stair, levels, idx, { depth: newDepth });
  }
  if (gripIndex.startsWith('landing-width-')) {
    const idx = parseInt(gripIndex.replace('landing-width-', ''), 10);
    const run = runs[idx];
    if (!run) return stair;
    const rEdge = getRunEdgeGeometry(run);
    const newWidth = Math.max(stair.width, Math.round(Math.abs(dot(sub(newPoint, run.end), rEdge.leftNormal)) * 2));
    return resizeStairLanding(stair, levels, idx, { width: newWidth });
  }
  return stair;
}

export function moveStairEntity(stair: StairEntity, delta: Point): StairEntity {
  return {
    ...stair,
    start: add(stair.start, delta),
    end: add(stair.end, delta),
    runs: stair.runs?.map((r) => ({
      ...r,
      start: add(r.start, delta),
      end: add(r.end, delta),
    })),
    landings: stair.landings?.map((l) => ({
      ...l,
      polygon: l.polygon.map((p) => add(p, delta)),
      customBoundary: l.customBoundary?.map((p) => add(p, delta)),
    })),
  };
}

export function rotateStairEntity(
  stair: StairEntity,
  center: Point,
  angleDeg: number,
  rotPt: (p: Point, c: Point, deg: number) => Point
): StairEntity {
  return {
    ...stair,
    start: rotPt(stair.start, center, angleDeg),
    end: rotPt(stair.end, center, angleDeg),
    runs: stair.runs?.map((r) => ({
      ...r,
      start: rotPt(r.start, center, angleDeg),
      end: rotPt(r.end, center, angleDeg),
    })),
    landings: stair.landings?.map((l) => ({
      ...l,
      polygon: l.polygon.map((p) => rotPt(p, center, angleDeg)),
      customBoundary: l.customBoundary?.map((p) => rotPt(p, center, angleDeg)),
    })),
  };
}

export function mirrorStairEntity(
  stair: StairEntity,
  a: Point,
  b: Point,
  mirPt: (p: Point, a: Point, b: Point) => Point
): StairEntity {
  return {
    ...stair,
    start: mirPt(stair.start, a, b),
    end: mirPt(stair.end, a, b),
    runs: stair.runs?.map((r) => ({
      ...r,
      start: mirPt(r.start, a, b),
      end: mirPt(r.end, a, b),
    })),
    landings: stair.landings?.map((l) => ({
      ...l,
      polygon: l.polygon.map((p) => mirPt(p, a, b)),
      customBoundary: l.customBoundary?.map((p) => mirPt(p, a, b)),
    })),
  };
}

export function scaleStairEntity(
  stair: StairEntity,
  base: Point,
  factor: number
): StairEntity {
  const scalePt = (p: Point): Point => ({
    x: base.x + (p.x - base.x) * factor,
    y: base.y + (p.y - base.y) * factor,
  });
  const f = Math.max(0.1, Math.abs(factor));
  return {
    ...stair,
    start: scalePt(stair.start),
    end: scalePt(stair.end),
    width: Math.max(24, stair.width * f),
    treadDepth: Math.max(8, stair.treadDepth * f),
    runs: stair.runs?.map((r) => ({
      ...r,
      start: scalePt(r.start),
      end: scalePt(r.end),
      width: Math.max(24, r.width * f),
      treadDepth: Math.max(8, r.treadDepth * f),
    })),
    landings: stair.landings?.map((l) => ({
      ...l,
      depth: Math.max(24, l.depth * f),
      width: Math.max(24, l.width * f),
      polygon: l.polygon.map(scalePt),
      customBoundary: l.customBoundary?.map(scalePt),
    })),
  };
}

// ============================================================================
// 9. DEFAULT STAIR TOOL STATE (Used by Options Bar & Interactive Creation)
// ============================================================================

export interface StairToolState {
  mode: 'interactive' | 'template';
  template: StairTemplateShape;
  baseLevelId: string;
  topLevelId: string;
  width: number;
  treadDepth: number;
  maxRiserHeight: number;
  landingDepth: number;
  wellGap: number;
  constructionStyle: StairConstructionStyle;
  landingStructure: StairLandingStructure;
  railingStyle: StairRailingStyle;
  railingSide: StairRailingSide;
  cutFloorAbove: boolean;
  /** While in interactive multi-run mode: runs & landings accumulated so far */
  draftRuns: StairRun[];
  draftLandings: StairLanding[];
}

export const DEFAULT_STAIR_TOOL: StairToolState = {
  mode: 'interactive',
  template: 'l-left',
  baseLevelId: 'level-1',
  topLevelId: 'level-2',
  width: 42,
  treadDepth: 10,
  maxRiserHeight: 7.5,
  landingDepth: 42,
  wellGap: 6,
  constructionStyle: 'closed-stringer',
  landingStructure: 'monolithic',
  railingStyle: 'wood-balusters',
  railingSide: 'both',
  cutFloorAbove: true,
  draftRuns: [],
  draftLandings: [],
};

export function formatRisersStatusText(
  createdRisers: number,
  totalRisers: number,
  riserHeight: number,
  units: UnitSystem = 'imperial'
): string {
  const remaining = Math.max(0, totalRisers - createdRisers);
  const rhStr = units === 'metric' ? `${Math.round(riserHeight * 25.4)} mm` : `${riserHeight.toFixed(2)}"`;
  return `${createdRisers} risers created, ${remaining} remaining (${totalRisers} total @ ${rhStr})`;
}
