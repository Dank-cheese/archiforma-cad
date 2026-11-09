import * as THREE from 'three';
import type {
  LevelDefinition,
  Point,
  StairConstructionStyle,
  StairEntity,
  StairLanding,
  StairLandingStructure,
  StairRailingStyle,
  StairRun,
} from '../types/model';
import {
  ensureStairRunsAndLandings,
  getRunEdgeGeometry,
} from '../engine/stairs';

const sub2 = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale2 = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
const dist2 = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const lerp2 = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const norm2 = (v: Point): Point => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-8 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};

export interface BuildStair3DOptions {
  levels: LevelDefinition[];
  selected: boolean;
  shadows: boolean;
  edgeMat?: THREE.LineBasicMaterial;
}

/**
 * Helper to create a cylinder or box strut between two 3D points `(x, y, z)` where `y` is vertical elevation
 * and `(x, z)` is plan `(x, y)`.
 */
function createStrut3D(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  radiusOrWidth: number,
  heightOrRadius: number,
  mat: THREE.Material,
  round: boolean
): THREE.Mesh | null {
  const delta = new THREE.Vector3().subVectors(p2, p1);
  const len = delta.length();
  if (len < 0.25) return null;
  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

  let geo: THREE.BufferGeometry;
  if (round) {
    geo = new THREE.CylinderGeometry(radiusOrWidth, heightOrRadius, len, 10);
    // Cylinder is aligned along +Y by default; rotate +Y to delta
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.clone().normalize()
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.copy(quat);
    return mesh;
  } else {
    geo = new THREE.BoxGeometry(radiusOrWidth, heightOrRadius, len);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.lookAt(p2);
    return mesh;
  }
}

/**
 * Extrudes a 2D plan polygon (`pts` in world `(x, y)` where `y` maps to 3D `z`)
 * horizontally from `yBottom` to `yBottom + thickness`.
 */
function createHorizontalPolygonPrism(
  pts: Point[],
  yBottom: number,
  thickness: number,
  mat: THREE.Material
): THREE.Mesh | null {
  if (pts.length < 3) return null;
  // Because `rotateX(Math.PI / 2)` maps shape `(x, y, z_extrude)` to `(x, -z_extrude, y)`:
  // Extruding by `thickness` along +Z and rotating +90° around X puts the slab from `y = 0` down to `y = -thickness`.
  // Positioning at `yBottom + thickness` places the slab cleanly between `[yBottom, yBottom + thickness]`!
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, pts[i].y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.5, thickness),
    bevelEnabled: false,
  });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = yBottom + thickness;
  return mesh;
}

/**
 * Builds a complete, multi-run 3D Stair + Landings + Stringers + Continuous 3D Railings.
 */
export function buildStair3D(
  stair: StairEntity,
  opts: BuildStair3DOptions
): { obj: THREE.Object3D; meshes: THREE.Object3D[] } {
  const group = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  const { runs, landings, totalRise, baseElevation } = ensureStairRunsAndLandings(stair, opts.levels);
  const isSel = opts.selected;

  const addMesh = (mesh: THREE.Mesh | null, withEdges = false) => {
    if (!mesh) return;
    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = true;
    mesh.userData = { entityId: stair.id };
    if (withEdges && opts.edgeMat && mesh.geometry) {
      const edges = new THREE.EdgesGeometry(mesh.geometry, 28);
      mesh.add(new THREE.LineSegments(edges, opts.edgeMat));
    }
    group.add(mesh);
    meshes.push(mesh);
  };

  const style: StairConstructionStyle = stair.constructionStyle ?? 'closed-stringer';
  const railingStyle: StairRailingStyle =
    stair.railingStyle ?? (style === 'cabin-split-log' ? 'cabin-peeled-log' : 'wood-balusters');
  const railingSide = stair.railingSide ?? 'both';
  const railingHeight = stair.railingHeight ?? 36;
  const riserHeight = stair.riserHeight || totalRise / Math.max(2, stair.numRisers || 16);

  // Materials palette
  const oakTreadMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xf59e0b : style === 'cabin-split-log' ? 0x92400e : 0xb47b48,
    roughness: 0.62,
    metalness: 0.05,
  });
  const barkLogMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xd97706 : 0x5c3a21,
    roughness: 0.85,
    metalness: 0.02,
  });
  const peeledLogMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xfbbf24 : 0xc28b52,
    roughness: 0.68,
    metalness: 0.04,
  });
  const paintedStringerMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xfde68a : 0xe7e5e4,
    roughness: 0.58,
    metalness: 0.06,
  });
  const steelSpineMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xb45309 : 0x27272a,
    roughness: 0.35,
    metalness: 0.72,
  });
  const stainlessMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xfbbf24 : 0x94a3b8,
    roughness: 0.25,
    metalness: 0.85,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0xf59e0b : 0xa8a29e,
    roughness: 0.78,
    metalness: 0.05,
  });
  const glassRailMat = new THREE.MeshStandardMaterial({
    color: isSel ? 0x38bdf8 : 0xbae6fd,
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // ==========================================================================
  // SPECIAL CASE: SPIRAL STAIR
  // ==========================================================================
  if (stair.shape === 'spiral' && runs[0]) {
    const center = runs[0].start;
    const outerR = Math.max(30, stair.spiralRadius ?? stair.width ?? 42);
    const innerR = Math.max(3.5, stair.spiralInnerRadius ?? 4.5);
    const totalRisers = Math.max(8, stair.numRisers || 16);
    const totalDeg = stair.spiralTurns ?? 360;
    const dirSign = stair.spiralClockwise === false ? -1 : 1;

    // Central column
    const colGeo = new THREE.CylinderGeometry(innerR, innerR, totalRise + railingHeight + 4, 16);
    const colMesh = new THREE.Mesh(
      colGeo,
      style === 'cabin-split-log' ? peeledLogMat : steelSpineMat
    );
    colMesh.position.set(center.x, baseElevation + (totalRise + railingHeight + 4) / 2, center.y);
    addMesh(colMesh);

    const railTopPts: THREE.Vector3[] = [];
    for (let i = 0; i < totalRisers; i++) {
      const a0 = (dirSign * (i / totalRisers) * totalDeg * Math.PI) / 180;
      const a1 = (dirSign * ((i + 1) / totalRisers) * totalDeg * Math.PI) / 180;
      const elev = baseElevation + (i + 1) * riserHeight;

      const pIn0 = { x: center.x + innerR * Math.cos(a0), y: center.y + innerR * Math.sin(a0) };
      const pOut0 = { x: center.x + outerR * Math.cos(a0), y: center.y + outerR * Math.sin(a0) };
      const pOutMid = {
        x: center.x + outerR * Math.cos((a0 + a1) / 2),
        y: center.y + outerR * Math.sin((a0 + a1) / 2),
      };
      const pOut1 = { x: center.x + outerR * Math.cos(a1), y: center.y + outerR * Math.sin(a1) };
      const pIn1 = { x: center.x + innerR * Math.cos(a1), y: center.y + innerR * Math.sin(a1) };

      const treadThick = style === 'cabin-split-log' ? 3.5 : 2.0;
      const treadMesh = createHorizontalPolygonPrism(
        [pIn0, pOut0, pOutMid, pOut1, pIn1],
        elev - treadThick,
        treadThick,
        oakTreadMat
      );
      addMesh(treadMesh, true);

      // Baluster post at outer edge of each spiral tread
      if (railingSide !== 'none') {
        const bPt = new THREE.Vector3(
          center.x + (outerR - 1.5) * Math.cos(a0),
          elev,
          center.y + (outerR - 1.5) * Math.sin(a0)
        );
        const tPt = new THREE.Vector3(bPt.x, elev + railingHeight, bPt.z);
        railTopPts.push(tPt);
        addMesh(
          createStrut3D(
            bPt,
            tPt,
            0.8,
            0.8,
            railingStyle === 'cabin-peeled-log' ? peeledLogMat : steelSpineMat,
            true
          )
        );
      }
    }

    for (let i = 0; i + 1 < railTopPts.length; i++) {
      addMesh(
        createStrut3D(
          railTopPts[i],
          railTopPts[i + 1],
          1.2,
          1.2,
          railingStyle === 'cabin-peeled-log' ? peeledLogMat : oakTreadMat,
          true
        )
      );
    }

    return { obj: group, meshes };
  }

  // ==========================================================================
  // 1. STRAIGHT / MULTI-RUN FLIGHTS (All 5 Construction Styles)
  // ==========================================================================
  for (let rIdx = 0; rIdx < runs.length; rIdx++) {
    const run = runs[rIdx];
    const edge = getRunEdgeGeometry(run);
    const runLen = Math.max(12, dist2(run.start, run.end));
    const nRisers = Math.max(2, run.numRisers);
    const nTreads = Math.max(1, nRisers - 1);
    const stepRun = runLen / nTreads;
    const flightRise = Math.max(7, run.topElevationOffset - run.baseElevationOffset);
    const stepRise = flightRise / nRisers;
    const baseY = baseElevation + run.baseElevationOffset;
    const angleY = -Math.atan2(edge.dir.y, edge.dir.x);

    const flightGroup = new THREE.Group();
    flightGroup.position.set(run.start.x, baseY, run.start.y);
    flightGroup.rotation.y = angleY;
    group.add(flightGroup);

    const addFlightPart = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      px: number,
      py: number,
      pz: number,
      rz = 0,
      rx = 0,
      withEdges = false
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      if (rz) m.rotation.z = rz;
      if (rx) m.rotation.x = rx;
      m.castShadow = opts.shadows;
      m.receiveShadow = true;
      m.userData = { entityId: stair.id };
      if (withEdges && opts.edgeMat) {
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), opts.edgeMat));
      }
      flightGroup.add(m);
      meshes.push(m);
    };

    if (style === 'concrete-monolithic') {
      // Cast-in-place monolithic concrete stair: stepped top profile + sloped soffit waist slab
      const waistThick = 6;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let i = 0; i < nRisers; i++) {
        const x0 = i * stepRun;
        const y1 = (i + 1) * stepRise;
        const x1 = i < nRisers - 1 ? (i + 1) * stepRun : nTreads * stepRun;
        shape.lineTo(x0, y1);
        if (x1 > x0) shape.lineTo(x1, y1);
      }
      // Underside sloped soffit
      shape.lineTo(nTreads * stepRun, Math.max(0, flightRise - waistThick));
      shape.lineTo(Math.min(stepRun, runLen * 0.15), 0);
      shape.closePath();

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: run.width,
        bevelEnabled: false,
      });
      extrudeGeo.translate(0, 0, -run.width / 2);
      addFlightPart(extrudeGeo, concreteMat, 0, 0, 0, 0, 0, true);
    } else if (style === 'cabin-split-log') {
      // Rustic Wooden Cabin Split-Log Stair:
      // 1. Heavy peeled-log side stringers (round logs Ø9") along left and right edges
      const diagLen = Math.hypot(runLen, flightRise) + 8;
      const pitch = Math.atan2(flightRise, runLen);
      for (const side of [-1, 1]) {
        const logGeo = new THREE.CylinderGeometry(4.2, 4.6, diagLen, 12);
        logGeo.rotateZ(-Math.PI / 2);
        addFlightPart(
          logGeo,
          peeledLogMat,
          runLen / 2,
          flightRise / 2 - 2.5,
          side * (run.width / 2 - 3.5),
          pitch
        );
      }
      // 2. Half-log split treads (flat sawn oak top + rounded bark log underside)
      for (let i = 0; i < nTreads; i++) {
        const tx = (i + 0.5) * stepRun;
        const ty = (i + 1) * stepRise;
        const treadW = run.width - 2;
        const treadD = stepRun * 0.95;
        // Flat top plank
        addFlightPart(
          new THREE.BoxGeometry(treadD, 1.8, treadW),
          oakTreadMat,
          tx,
          ty - 0.9,
          0,
          0,
          0,
          true
        );
        // Rounded bark belly under each split-log tread
        const bellyGeo = new THREE.CylinderGeometry(treadD * 0.46, treadD * 0.46, treadW, 10, 1, false, 0, Math.PI);
        bellyGeo.rotateX(Math.PI / 2);
        bellyGeo.rotateZ(Math.PI);
        addFlightPart(bellyGeo, barkLogMat, tx, ty - 1.8, 0);
      }
    } else if (style === 'mono-stringer') {
      // Modern Center Mono-Stringer: central steel HSS spine + welded brackets + thick floating oak treads
      const diagLen = Math.hypot(runLen, flightRise) + 6;
      const pitch = Math.atan2(flightRise, runLen);
      addFlightPart(
        new THREE.BoxGeometry(diagLen, 6.5, 5),
        steelSpineMat,
        runLen / 2,
        flightRise / 2 - 4,
        0,
        pitch,
        0,
        true
      );
      for (let i = 0; i < nTreads; i++) {
        const tx = (i + 0.5) * stepRun;
        const ty = (i + 1) * stepRise;
        // Steel support pedestal under tread
        addFlightPart(
          new THREE.BoxGeometry(stepRun * 0.5, 3.2, 6),
          steelSpineMat,
          tx,
          ty - 3.6,
          0
        );
        // Floating thick oak tread (2.25" thick)
        addFlightPart(
          new THREE.BoxGeometry(stepRun * 1.02, 2.25, run.width),
          oakTreadMat,
          tx,
          ty - 1.125,
          0,
          0,
          0,
          true
        );
      }
    } else if (style === 'open-stringer') {
      // Open / Cut Sawtooth Stringer: twin notched side stringers + open risers + exposed oak treads
      const diagLen = Math.hypot(runLen, flightRise) + 4;
      const pitch = Math.atan2(flightRise, runLen);
      for (const side of [-1, 1]) {
        addFlightPart(
          new THREE.BoxGeometry(diagLen, 9, 2),
          paintedStringerMat,
          runLen / 2,
          flightRise / 2 - 4.5,
          side * (run.width / 2 - 2.5),
          pitch,
          0,
          true
        );
      }
      for (let i = 0; i < nTreads; i++) {
        const tx = (i + 0.5) * stepRun;
        const ty = (i + 1) * stepRise;
        addFlightPart(
          new THREE.BoxGeometry(stepRun * 1.04, 1.75, run.width),
          oakTreadMat,
          tx,
          ty - 0.875,
          0,
          0,
          0,
          true
        );
      }
    } else {
      // Standard Closed Stringer (`closed-stringer`): side stringer boards + closed risers + oak treads with nosing
      const diagLen = Math.hypot(runLen, flightRise) + 4;
      const pitch = Math.atan2(flightRise, runLen);
      for (const side of [-1, 1]) {
        addFlightPart(
          new THREE.BoxGeometry(diagLen, 11, 1.75),
          paintedStringerMat,
          runLen / 2,
          flightRise / 2 - 2,
          side * (run.width / 2 - 0.875),
          pitch,
          0,
          true
        );
      }
      for (let i = 0; i < nRisers; i++) {
        const rx = i * stepRun;
        const ry = (i + 0.5) * stepRise;
        // Closed riser board
        addFlightPart(
          new THREE.BoxGeometry(0.85, stepRise, run.width - 3.5),
          paintedStringerMat,
          rx,
          ry,
          0
        );
        if (i < nTreads) {
          const tx = (i + 0.5) * stepRun;
          const ty = (i + 1) * stepRise;
          addFlightPart(
            new THREE.BoxGeometry(stepRun + 1.0, 1.5, run.width - 3.2),
            oakTreadMat,
            tx,
            ty - 0.75,
            0,
            0,
            0,
            true
          );
        }
      }
    }
  }

  // ==========================================================================
  // 2. LANDINGS & WINDER TURNS (Structures, Framing, Support Posts, Intermediate Step)
  // ==========================================================================
  for (let lIdx = 0; lIdx < landings.length; lIdx++) {
    const landing: StairLanding = landings[lIdx];
    const poly =
      landing.customBoundary && landing.customBoundary.length >= 3
        ? landing.customBoundary
        : landing.polygon;
    if (poly.length < 3) continue;

    const topY = baseElevation + landing.elevationOffset;
    const thickness = Math.max(3, landing.thickness ?? stair.landingThickness ?? 6);
    const structure: StairLandingStructure =
      landing.structure ?? stair.landingStructure ?? 'monolithic';
    const hasPosts = Boolean(landing.supportPosts ?? stair.supportPosts);

    // If this is a Winder stair (`winder-l` or `winder-u`), build 3D pie-shaped winder steps instead of a flat landing!
    if ((stair.shape === 'winder-l' || stair.shape === 'winder-u') && runs[lIdx]) {
      const r0 = runs[lIdx];
      const e0 = getRunEdgeGeometry(r0);
      const wCount = stair.shape === 'winder-u' ? 6 : 3;
      const pivot = e0.exitLeft;
      const startVec = sub2(e0.exitRight, pivot);
      const totalSweepRad = stair.shape === 'winder-u' ? -Math.PI : -Math.PI / 2;
      for (let wIdx = 0; wIdx < wCount; wIdx++) {
        const ang0 = (wIdx / wCount) * totalSweepRad;
        const ang1 = ((wIdx + 1) / wCount) * totalSweepRad;
        const rot = (v: Point, a: number): Point => ({
          x: v.x * Math.cos(a) - v.y * Math.sin(a),
          y: v.x * Math.sin(a) + v.y * Math.cos(a),
        });
        const p1 = add2(pivot, scale2(rot(startVec, ang0), 1.15));
        const p2 = add2(pivot, scale2(rot(startVec, ang1), 1.15));
        const stepTopY = topY + (wIdx + 1) * riserHeight;
        const stepThick = style === 'concrete-monolithic' ? riserHeight : 2.25;
        addMesh(
          createHorizontalPolygonPrism(
            [pivot, p1, p2],
            stepTopY - stepThick,
            stepThick,
            style === 'concrete-monolithic' ? concreteMat : oakTreadMat
          ),
          true
        );
      }
      continue;
    }

    // Flat Landing Platform
    if (style === 'concrete-monolithic' || structure === 'monolithic') {
      // Monolithic concrete or solid timber landing slab
      addMesh(
        createHorizontalPolygonPrism(
          poly,
          topY - thickness,
          thickness,
          style === 'concrete-monolithic' ? concreteMat : oakTreadMat
        ),
        true
      );
    } else if (structure === 'steel-cantilever') {
      // Cantilevered steel plate & perimeter channel + oak deck wear surface
      addMesh(
        createHorizontalPolygonPrism(poly, topY - thickness, thickness - 1.5, steelSpineMat),
        true
      );
      addMesh(
        createHorizontalPolygonPrism(poly, topY - 1.5, 1.5, oakTreadMat),
        true
      );
    } else {
      // `timber-framed`: top oak/plank decking + timber rim joists around perimeter
      const deckThick = 1.75;
      const joistDepth = Math.max(4, thickness - deckThick);
      addMesh(
        createHorizontalPolygonPrism(poly, topY - deckThick, deckThick, oakTreadMat),
        true
      );
      addMesh(
        createHorizontalPolygonPrism(
          poly,
          topY - thickness,
          joistDepth,
          style === 'cabin-split-log' ? peeledLogMat : paintedStringerMat
        ),
        true
      );
    }

    // Optional intermediate step on a U-landing (splits landing elevation by 1 riser at the midpoint)
    if (landing.intermediateStep) {
      const halfPoly = poly.slice(Math.floor(poly.length / 2));
      if (halfPoly.length >= 3) {
        addMesh(
          createHorizontalPolygonPrism(halfPoly, topY, riserHeight * 0.5, oakTreadMat),
          true
        );
      }
    }

    // Optional Support Posts down to the floor below (or mortised log columns for Cabin style)
    if (hasPosts || style === 'cabin-split-log') {
      const postHeight = Math.max(6, topY - thickness - baseElevation);
      if (postHeight > 8) {
        // Place support columns at the outer corners of the landing polygon
        const cornerIndices =
          poly.length >= 4
            ? [0, Math.floor(poly.length / 2), poly.length - 1]
            : [0, 1];
        const usedCorners: Point[] = [];
        for (const cIdx of cornerIndices) {
          const pt = poly[cIdx];
          if (!pt || usedCorners.some((u) => dist2(u, pt) < 14)) continue;
          usedCorners.push(pt);
          const isLog = style === 'cabin-split-log';
          const postGeo = isLog
            ? new THREE.CylinderGeometry(3.8, 4.2, postHeight, 12)
            : new THREE.BoxGeometry(5, postHeight, 5);
          const postMat = isLog
            ? peeledLogMat
            : structure === 'steel-cantilever'
            ? steelSpineMat
            : oakTreadMat;
          const postMesh = new THREE.Mesh(postGeo, postMat);
          postMesh.position.set(pt.x, baseElevation + postHeight / 2, pt.y);
          addMesh(postMesh, !isLog);
        }
      }
    }
  }

  // ==========================================================================
  // 3. CONTINUOUS 3D RAILINGS (Sloped Flights + Horizontal Landing Perimeter)
  // ==========================================================================
  if (railingSide !== 'none') {
    const sides: Array<'left' | 'right'> =
      railingSide === 'both'
        ? ['left', 'right']
        : railingSide === 'left'
        ? ['left']
        : ['right'];

    const buildRailingSegment = (
      pStart2D: Point,
      yStart: number,
      pEnd2D: Point,
      yEnd: number,
      includeEndNewel: boolean
    ) => {
      const segLen2D = dist2(pStart2D, pEnd2D);
      if (segLen2D < 4) return;

      const postMat =
        railingStyle === 'cabin-peeled-log'
          ? peeledLogMat
          : railingStyle === 'wood-balusters'
          ? oakTreadMat
          : stainlessMat;
      const topRailMat =
        railingStyle === 'cabin-peeled-log'
          ? peeledLogMat
          : railingStyle === 'wood-balusters'
          ? oakTreadMat
          : stainlessMat;
      const isRound = railingStyle === 'cabin-peeled-log' || railingStyle === 'steel-cable';
      const newelR = railingStyle === 'cabin-peeled-log' ? 2.4 : 1.5;

      const baseStart = new THREE.Vector3(pStart2D.x, yStart, pStart2D.y);
      const topStart = new THREE.Vector3(pStart2D.x, yStart + railingHeight, pStart2D.y);
      const baseEnd = new THREE.Vector3(pEnd2D.x, yEnd, pEnd2D.y);
      const topEnd = new THREE.Vector3(pEnd2D.x, yEnd + railingHeight, pEnd2D.y);

      // Start & End Newel Posts
      addMesh(createStrut3D(baseStart, topStart.clone().add(new THREE.Vector3(0, 2, 0)), newelR, newelR, postMat, isRound));
      if (includeEndNewel) {
        addMesh(createStrut3D(baseEnd, topEnd.clone().add(new THREE.Vector3(0, 2, 0)), newelR, newelR, postMat, isRound));
      }

      // Continuous Top Handrail & Bottom Rail
      const railRadius = railingStyle === 'cabin-peeled-log' ? 1.8 : 1.1;
      addMesh(createStrut3D(topStart, topEnd, railRadius, railRadius, topRailMat, isRound));

      const botStart = new THREE.Vector3(pStart2D.x, yStart + 4, pStart2D.y);
      const botEnd = new THREE.Vector3(pEnd2D.x, yEnd + 4, pEnd2D.y);
      if (railingStyle === 'cabin-peeled-log' || railingStyle === 'wood-balusters') {
        addMesh(createStrut3D(botStart, botEnd, railRadius * 0.75, railRadius * 0.75, postMat, isRound));
      }

      // Infill by Railing Style
      if (railingStyle === 'steel-cable') {
        // Intermediate posts every ~36" + 6 horizontal/sloped tensioned stainless cables
        const numPosts = Math.max(1, Math.floor(segLen2D / 36));
        for (let k = 1; k < numPosts; k++) {
          const t = k / numPosts;
          const p2 = lerp2(pStart2D, pEnd2D, t);
          const py = yStart + (yEnd - yStart) * t;
          addMesh(
            createStrut3D(
              new THREE.Vector3(p2.x, py, p2.y),
              new THREE.Vector3(p2.x, py + railingHeight, p2.y),
              0.9,
              0.9,
              stainlessMat,
              true
            )
          );
        }
        for (let c = 1; c <= 6; c++) {
          const hOff = 4 + (c * (railingHeight - 6)) / 7;
          addMesh(
            createStrut3D(
              new THREE.Vector3(pStart2D.x, yStart + hOff, pStart2D.y),
              new THREE.Vector3(pEnd2D.x, yEnd + hOff, pEnd2D.y),
              0.25,
              0.25,
              stainlessMat,
              true
            )
          );
        }
      } else if (railingStyle === 'glass-panels') {
        // Tempered glass panel between start and end posts
        const panelH = Math.max(12, railingHeight - 7);
        const mid2 = lerp2(pStart2D, pEnd2D, 0.5);
        const midY = (yStart + yEnd) / 2 + 3 + panelH / 2;
        const pitch = Math.atan2(yEnd - yStart, segLen2D);
        const dir = norm2(sub2(pEnd2D, pStart2D));
        const angY = -Math.atan2(dir.y, dir.x);
        const glassGeo = new THREE.BoxGeometry(Math.max(4, segLen2D - 4), panelH, 0.5);
        const glassMesh = new THREE.Mesh(glassGeo, glassRailMat);
        glassMesh.position.set(mid2.x, midY, mid2.y);
        glassMesh.rotation.y = angY;
        glassMesh.rotation.z = pitch;
        addMesh(glassMesh);
      } else {
        // `wood-balusters` or `cabin-peeled-log` vertical balusters every ~6"
        const spacing = railingStyle === 'cabin-peeled-log' ? 7 : 5.5;
        const count = Math.max(2, Math.floor(segLen2D / spacing));
        const balR = railingStyle === 'cabin-peeled-log' ? 0.95 : 0.6;
        for (let k = 1; k < count; k++) {
          const t = k / count;
          const p2 = lerp2(pStart2D, pEnd2D, t);
          const py = yStart + (yEnd - yStart) * t;
          addMesh(
            createStrut3D(
              new THREE.Vector3(p2.x, py + 4, p2.y),
              new THREE.Vector3(p2.x, py + railingHeight, p2.y),
              balR,
              balR,
              postMat,
              railingStyle === 'cabin-peeled-log'
            )
          );
        }
      }
    };

    // Build railings along each run and around the connected landing edges
    for (let rIdx = 0; rIdx < runs.length; rIdx++) {
      const run = runs[rIdx];
      const edge = getRunEdgeGeometry(run);
      const inset = 1.5;
      const leftStart = add2(edge.entryLeft, scale2(edge.leftNormal, -inset));
      const leftEnd = add2(edge.exitLeft, scale2(edge.leftNormal, -inset));
      const rightStart = add2(edge.entryRight, scale2(edge.leftNormal, inset));
      const rightEnd = add2(edge.exitRight, scale2(edge.leftNormal, inset));
      const y0 = baseElevation + run.baseElevationOffset;
      const y1 = baseElevation + run.topElevationOffset;

      for (const side of sides) {
        const sPt = side === 'left' ? leftStart : rightStart;
        const ePt = side === 'left' ? leftEnd : rightEnd;
        buildRailingSegment(sPt, y0, ePt, y1, rIdx === runs.length - 1);
      }

      // Connect horizontally around the intermediate landing after `rIdx` into `runs[rIdx + 1]`
      const landing = landings.find((l) => l.afterRunIndex === rIdx);
      const nextRun = runs[rIdx + 1];
      if (landing && nextRun && stair.shape !== 'winder-l' && stair.shape !== 'winder-u') {
        const nextEdge = getRunEdgeGeometry(nextRun);
        const yLanding = baseElevation + landing.elevationOffset;
        const nextLeftStart = add2(nextEdge.entryLeft, scale2(nextEdge.leftNormal, -inset));
        const nextRightStart = add2(nextEdge.entryRight, scale2(nextEdge.leftNormal, inset));

        // Trace the outer perimeter of the landing polygon between Run `rIdx` exit and `nextRun` entry
        if (landing.polygon.length >= 4) {
          for (let i = 0; i < landing.polygon.length; i++) {
            const pA = landing.polygon[i];
            const pB = landing.polygon[(i + 1) % landing.polygon.length];
            // Skip edges that are the open throat into Run 1 or Run 2
            const midEdge = lerp2(pA, pB, 0.5);
            const onRun1Exit =
              dist2(midEdge, run.end) < run.width * 0.48 &&
              Math.abs(dist2(pA, pB) - run.width) < 4;
            const onRun2Entry =
              dist2(midEdge, nextRun.start) < nextRun.width * 0.48 &&
              Math.abs(dist2(pA, pB) - nextRun.width) < 4;
            if (onRun1Exit || onRun2Entry) continue;

            // Only draw if it's longer than 6"
            if (dist2(pA, pB) >= 6) {
              buildRailingSegment(pA, yLanding, pB, yLanding, true);
            }
          }
        } else {
          for (const side of sides) {
            const fromPt = side === 'left' ? leftEnd : rightEnd;
            const toPt = side === 'left' ? nextLeftStart : nextRightStart;
            buildRailingSegment(fromPt, yLanding, toPt, yLanding, true);
          }
        }
      }
    }
  }

  return { obj: group, meshes };
}
