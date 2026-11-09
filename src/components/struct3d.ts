/**
 * three.js builders for structural elements: profiled columns (with steel base plates and anchor
 * bolts), footings and piles below grade, beams / braces / joists extruded along their axis,
 * slabs with thickened edges and expansion-joint splits, lintels, connections, rebar rods,
 * loads and the analytical model.
 * World mapping: three X = plan x, three Z = plan y, three Y = up.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TailCut, TrussEntity } from '../types/model';
import { curvedBracePoints, tailCutShift, trussMembers } from '../engine/timber';
import type { ArchModel, BeamEntity, BeamSystemEntity, ColumnEntity, ConnectionEntity, FloorEntity, FootingEntity, LoadEntity, Point, StructuralJointEntity, WallEntity } from '../types/model';
import {
  analyticalModel,
  basePlateGeometry,
  beamAxis,
  beamRefZ,
  beamSection,
  beamSystemJoists,
  beamVertical,
  columnMaterialId,
  columnPlanOutline,
  columnSection,
  columnZRange,
  computeLintels,
  connectionGeometry,
  footingPlanOutline,
  footingZRange,
  levelElevationOf,
  materialById,
  pilePositions,
  profileOutline,
  slabPieces,
  jointOnHost,
  type ConnectionGeometry,
  type RebarBar,
  type SectionProfile,
} from '../engine/structure';
import { offsetPolygon, signedArea, type P3 } from '../engine/roof';

export interface Built {
  obj: THREE.Object3D;
  meshes: THREE.Object3D[];
}

const SEL = 0xf59e0b;
const V = (p: P3) => new THREE.Vector3(p.x, p.z, p.y);

export function familyMaterial(materialId: string | undefined, selected: boolean, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = materialById(materialId);
  const steel = m.family === 'steel';
  return new THREE.MeshStandardMaterial({
    color: m.family === 'concrete' ? '#b9b5ad' : m.family === 'wood' ? '#c99a5e' : m.family === 'masonry' ? '#9c9890' : '#5b6f86',
    roughness: steel ? 0.38 : 0.85,
    metalness: steel ? 0.55 : 0.02,
    emissive: selected ? SEL : 0x000000,
    emissiveIntensity: selected ? 0.35 : 0,
    ...extra,
  });
}

function shapeFrom(outer: Point[], holes: Point[][] = []): THREE.Shape {
  const sh = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) if (h.length >= 3) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  return sh;
}

/** Plan polygon extruded between z0 and z1 (plan shape → world). */
export function prismGeometry(outer: Point[], z0: number, z1: number, holes: Point[][] = []): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFrom(outer, holes), { depth: Math.max(0.1, z1 - z0), bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape y -> world z (plan y); extrusion goes down
  g.translate(0, z1, 0);
  return g;
}

function mesh(geo: THREE.BufferGeometry | null, mat: THREE.Material | THREE.Material[], id: string, shadows: boolean, edgeMat?: THREE.LineBasicMaterial): THREE.Mesh | null {
  if (!geo) return null;
  const m = new THREE.Mesh(geo, mat);
  m.userData = { entityId: id };
  m.castShadow = shadows;
  m.receiveShadow = true;
  if (edgeMat) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));
  return m;
}

const group = (items: Array<THREE.Object3D | null>): Built => {
  const g = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  for (const it of items) {
    if (!it) continue;
    g.add(it);
    if (it instanceof THREE.Mesh) meshes.push(it);
  }
  return { obj: g, meshes };
};

const merged = (list: Array<THREE.BufferGeometry | null>) => {
  const ok = list.filter((g): g is THREE.BufferGeometry => !!g).map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ok) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count * 2).fill(0), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }
  return ok.length ? mergeGeometries(ok, false) : null;
};

/** Cylinder between two world points (three space). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry | null {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  if (L < 1e-4) return null;
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// ------------------------------------------------------------------------------------------
// COLUMNS
// ------------------------------------------------------------------------------------------

export function buildColumn3D(model: ArchModel, col: ColumnEntity, o: { selected: boolean; shadows: boolean; edgeMat?: THREE.LineBasicMaterial }): Built {
  const z = columnZRange(model, col);
  const ol = columnPlanOutline(col);
  const matId = columnMaterialId(col);
  const body = mesh(prismGeometry(ol.outer, z.z0, z.z1, ol.holes), familyMaterial(matId, o.selected), col.id, o.shadows, o.edgeMat);
  const parts: Array<THREE.Object3D | null> = [body];
  if (materialById(matId).family === 'steel') {
    parts.push(...connectionMeshes(basePlateGeometry(col.position, z.z0, columnSection(col), col.rotation || 0), col.id, o.selected, o.shadows));
  }
  return group(parts);
}

// ------------------------------------------------------------------------------------------
// FOOTINGS & PILES
// ------------------------------------------------------------------------------------------

export function buildFooting3D(model: ArchModel, f: FootingEntity, o: { selected: boolean; shadows: boolean; edgeMat?: THREE.LineBasicMaterial }): Built | null {
  const poly = footingPlanOutline(f, model.entities);
  if (poly.length < 3) return null;
  const z = footingZRange(model, f);
  const mat = familyMaterial(f.structuralMaterialId || 'conc-4000', o.selected, { color: '#a9a49b' });
  const parts: Array<THREE.Object3D | null> = [mesh(prismGeometry(poly, z.zBot, z.zTop), mat, f.id, o.shadows, o.edgeMat)];
  if (f.kind === 'pilecap') {
    const r = (f.piles?.diameter ?? 14) / 2;
    const L = f.piles?.length ?? 360;
    const piles = pilePositions(f, model.entities).map((p) => {
      const g = new THREE.CylinderGeometry(r, r * 0.92, L, 16);
      g.translate(p.x, z.zBot - L / 2, p.y);
      return g;
    });
    parts.push(mesh(merged(piles), familyMaterial('conc-4000', o.selected, { color: '#8f8a82' }), f.id, false));
  }
  return group(parts);
}

// ------------------------------------------------------------------------------------------
// BEAMS, BRACES, JOISTS
// ------------------------------------------------------------------------------------------

/** Section profile extruded along a 3D axis (centre of the section on the axis). */
export function memberGeometry(
  sec: SectionProfile,
  a: P3,
  b: P3,
  rotationDeg = 0,
  opts: { tailCut?: TailCut; camber?: number } = {}
): THREE.BufferGeometry | null {
  const A = V(a);
  const B = V(b);
  const axis = new THREE.Vector3().subVectors(B, A);
  const L = axis.length();
  if (L < 0.5) return null;
  axis.normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let xAxis = new THREE.Vector3().crossVectors(worldUp, axis);
  if (xAxis.lengthSq() < 1e-6) xAxis = new THREE.Vector3(1, 0, 0);
  xAxis.normalize();
  let yAxis = new THREE.Vector3().crossVectors(axis, xAxis).normalize();
  if (rotationDeg) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, (rotationDeg * Math.PI) / 180);
    xAxis = xAxis.applyQuaternion(q);
    yAxis = yAxis.applyQuaternion(q);
  }
  let prof = profileOutline(sec);
  const tail = opts.tailCut && opts.tailCut !== 'square' ? opts.tailCut : undefined;
  if (tail === 'scroll' && sec.kind !== 'round') {
    // subdivide the sides so the scrolled end can curve
    const b2 = sec.bf / 2;
    const h2 = sec.d / 2;
    const n = 8;
    const right = Array.from({ length: n + 1 }, (_, i) => ({ x: b2, y: -h2 + (sec.d * i) / n }));
    const left = Array.from({ length: n + 1 }, (_, i) => ({ x: -b2, y: h2 - (sec.d * i) / n }));
    prof = { outer: [...right, ...left], holes: [] };
  }
  const camber = opts.camber && opts.camber > 0 ? opts.camber : 0;
  const g = new THREE.ExtrudeGeometry(shapeFrom(prof.outer, prof.holes), { depth: L, bevelEnabled: false, curveSegments: 8, steps: camber ? 16 : 1 });
  if (tail || camber) {
    // local frame: x across, y up (square to the member), z along the axis
    const slope = Math.asin(Math.max(-1, Math.min(1, -(b.z - a.z) / L))); // > 0 when descending to the end
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const y = pos.getY(i);
      if (camber) pos.setY(i, y + camber * 4 * (z / L) * (1 - z / L));
      if (tail && z >= L - 1e-4) pos.setZ(i, L + tailCutShift(tail, y, sec.d, Math.max(0, slope)));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, axis);
  m.setPosition(A);
  g.applyMatrix4(m);
  return g;
}

export function buildBeam3D(model: ArchModel, b: BeamEntity, o: { selected: boolean; shadows: boolean; edgeMat?: THREE.LineBasicMaterial }): Built | null {
  const ax = beamAxis(model, b);
  const sec = beamSection(b);
  let a: P3, c: P3;
  if (b.usage === 'brace') {
    a = { x: ax.start.x, y: ax.start.y, z: beamRefZ(model, b, ax.start) };
    c = { x: ax.end.x, y: ax.end.y, z: beamRefZ(model, b, ax.end) };
  } else {
    a = { x: ax.start.x, y: ax.start.y, z: beamVertical(model, b, ax.start).zMid };
    c = { x: ax.end.x, y: ax.end.y, z: beamVertical(model, b, ax.end).zMid };
  }
  const mat = familyMaterial(b.structuralMaterialId, o.selected, timberColor(b.structuralMaterialId));
  if (b.curved && b.usage === 'brace') {
    // curved knee brace: short straight segments along an arc
    const pts = curvedBracePoints(a, c, 10);
    const segs = pts.slice(1).map((p, i) => memberGeometry(sec, pts[i], p, b.rotation || 0));
    const m = mesh(merged(segs), mat, b.id, o.shadows);
    return m ? group([m, ...kneePegs(b, a, c, sec, o.selected)]) : null;
  }
  const geo = memberGeometry(sec, a, c, b.rotation || 0, { tailCut: b.tailCut, camber: b.camber });
  const m = mesh(geo, mat, b.id, o.shadows, o.edgeMat);
  return m ? group([m, ...(b.kneeOf ? kneePegs(b, a, c, sec, o.selected) : [])]) : null;
}

/** Wood species colour for timber members (keeps the default look for other materials). */
function timberColor(materialId?: string): THREE.MeshStandardMaterialParameters {
  const m = materialById(materialId);
  return m.family === 'wood' ? { color: m.color, roughness: 0.9 } : {};
}

/** Oak pegs of a mortise-and-tenon knee brace (one at each end). */
function kneePegs(b: BeamEntity, a: P3, c: P3, sec: SectionProfile, selected: boolean): THREE.Object3D[] {
  if (!b.kneeOf) return [];
  const geos: THREE.BufferGeometry[] = [];
  for (const p of [a, c]) {
    const g = new THREE.CylinderGeometry(0.5, 0.5, sec.bf + 1.5, 10);
    // across the brace: perpendicular to its plan direction
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const ang = Math.atan2(dy, dx);
    g.rotateZ(Math.PI / 2);
    g.rotateY(-ang + Math.PI / 2);
    g.translate(p.x, p.z, p.y);
    geos.push(g);
  }
  const m = mesh(merged(geos), new THREE.MeshStandardMaterial({ color: selected ? '#fbbf24' : '#5b3b22', roughness: 0.8 }), b.id, false);
  return m ? [m] : [];
}

/** Timber truss (TR): every member as a timber of memberWidth × memberDepth. */
export function buildTruss3D(model: ArchModel, t: TrussEntity, o: { selected: boolean; shadows: boolean; edgeMat?: THREE.LineBasicMaterial }): Built | null {
  const members = trussMembers(model, t);
  if (!members.length) return null;
  const sec: SectionProfile = { id: 'truss', label: 'truss', kind: 'rect', family: 'wood', d: t.memberDepth, bf: t.memberWidth, use: ['beam'], hewn: true };
  const geos = members.map((mb) => {
    // top chords end in a decorative tail at the overhang
    const tailed = mb.role === 'top' && mb.a.z < mb.b.z;
    return tailed ? memberGeometry(sec, mb.b, mb.a, 0, { tailCut: t.tailCut || 'plumb' }) : memberGeometry(sec, mb.a, mb.b, 0);
  });
  const m = mesh(merged(geos), familyMaterial(t.structuralMaterialId, o.selected, timberColor(t.structuralMaterialId)), t.id, o.shadows, o.edgeMat);
  return m ? group([m]) : null;
}

export function buildBeamSystem3D(model: ArchModel, bs: BeamSystemEntity, o: { selected: boolean; shadows: boolean }): Built | null {
  const sec = beamSection(bs);
  const z = levelElevationOf(model, bs.levelId) + bs.topOffset - sec.d / 2;
  const geos = beamSystemJoists(bs).map(([p, q]) => memberGeometry(sec, { ...p, z }, { ...q, z }));
  const m = mesh(merged(geos), familyMaterial(bs.structuralMaterialId, o.selected), bs.id, o.shadows);
  return m ? group([m]) : null;
}

// ------------------------------------------------------------------------------------------
// SLABS (structural / foundation): expansion-joint pieces, thickened edges, joint lines
// ------------------------------------------------------------------------------------------

export function buildSlab3D(model: ArchModel, fl: FloorEntity, o: { selected: boolean; shadows: boolean; color: string; edgeMat?: THREE.LineBasicMaterial }): Built | null {
  if (fl.polygon.length < 3) return null;
  const zTop = levelElevationOf(model, fl.levelId) + 0.2;
  const t = Math.max(1, fl.thickness || 6);
  const mat = new THREE.MeshStandardMaterial({ color: o.selected ? SEL : o.color, roughness: 0.75, metalness: 0.04 });
  const parts: Array<THREE.Object3D | null> = [];
  const pieces = slabPieces(fl, model.entities);
  for (const piece of pieces) {
    const holes = (fl.openings || []).filter((h) => h.length >= 3);
    parts.push(mesh(prismGeometry(piece, zTop - t, zTop, holes), mat, fl.id, o.shadows, o.edgeMat));
  }
  if (fl.foundation && fl.thickenedEdge) {
    const pos = signedArea(fl.polygon) >= 0 ? fl.polygon : [...fl.polygon].reverse();
    const inner = offsetPolygon(pos, -fl.thickenedEdge.width);
    if (signedArea(inner) > 0) parts.push(mesh(prismGeometry(pos, zTop - t - fl.thickenedEdge.depth, zTop - t, [[...inner].reverse()]), mat, fl.id, false));
  }
  // control / construction joints: thin dark saw-cut lines on top
  const lines: Array<THREE.BufferGeometry | null> = [];
  for (const j of model.entities) {
    if (j.type !== 'sjoint' || j.hostId !== fl.id || j.kind === 'expansion') continue;
    for (const [p, q] of jointOnHost(j as StructuralJointEntity, model.entities)) {
      const d = { x: q.x - p.x, y: q.y - p.y };
      const L = Math.hypot(d.x, d.y);
      if (L < 1) continue;
      const g = new THREE.BoxGeometry(L, 0.3, 0.5);
      g.rotateY(-Math.atan2(d.y, d.x));
      g.translate((p.x + q.x) / 2, zTop + 0.1, (p.y + q.y) / 2);
      lines.push(g);
    }
  }
  parts.push(mesh(merged(lines), new THREE.MeshBasicMaterial({ color: 0x334155 }), fl.id, false));
  return group(parts);
}

// ------------------------------------------------------------------------------------------
// LINTELS (inside walls)
// ------------------------------------------------------------------------------------------

export function buildLintels3D(model: ArchModel, wall: WallEntity, o: { selected: boolean }): Built | null {
  const ls = computeLintels(model.entities, wall);
  if (!ls.length) return null;
  const d = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y };
  const L = Math.hypot(d.x, d.y) || 1;
  const u = { x: d.x / L, y: d.y / L };
  const base = levelElevationOf(model, wall.levelId) + (wall.baseOffset || 0);
  const geos = ls.map((l) => {
    const len = l.s1 - l.s0;
    const g = new THREE.BoxGeometry(len, Math.max(1, l.zTop - l.zBot), Math.max(1.5, wall.thickness * 0.8));
    g.rotateY(-Math.atan2(u.y, u.x));
    const c = { x: wall.start.x + u.x * (l.s0 + len / 2), y: wall.start.y + u.y * (l.s0 + len / 2) };
    g.translate(c.x, base + (l.zBot + l.zTop) / 2, c.y);
    return g;
  });
  const fam = materialById(wall.structuralMaterialId || (wall.wallTypeId === 'wt-conc-8' ? 'conc-4000' : wall.wallTypeId === 'wt-cmu-8' ? 'cmu' : 'df')).family;
  const m = mesh(merged(geos), familyMaterial(fam === 'wood' ? 'lvl' : 'conc-4000', o.selected, { color: fam === 'wood' ? '#d6a35f' : '#8f8a82' }), wall.id, false);
  return m ? group([m]) : null;
}

// ------------------------------------------------------------------------------------------
// CONNECTIONS
// ------------------------------------------------------------------------------------------

function connectionMeshes(g: ConnectionGeometry, id: string, selected: boolean, shadows: boolean): THREE.Mesh[] {
  const plates = g.plates.map((p) => {
    const b = new THREE.BoxGeometry(p.size.x, p.size.z, p.size.y);
    b.rotateY(-Math.atan2(p.axisU.y, p.axisU.x));
    b.translate(p.center.x, p.center.z, p.center.y);
    return b;
  });
  const isBase = g.label === 'BP';
  const bolts = g.bolts.map((b) => {
    const len = isBase ? 15 : 2.2;
    const cyl = new THREE.CylinderGeometry(isBase ? 0.375 : 0.45, isBase ? 0.375 : 0.45, len, 8);
    if (isBase) cyl.translate(b.x, b.z + 3 - len / 2, b.y);
    else {
      const n = { x: -g.dir.y, y: g.dir.x };
      cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, 0, n.y)));
      cyl.translate(b.x, b.z, b.y);
    }
    return cyl;
  });
  const out: THREE.Mesh[] = [];
  const pm = mesh(merged(plates), new THREE.MeshStandardMaterial({ color: selected ? SEL : '#475569', metalness: 0.6, roughness: 0.35 }), id, shadows);
  const bm = mesh(merged(bolts), new THREE.MeshStandardMaterial({ color: '#d4d4d8', metalness: 0.8, roughness: 0.25 }), id, false);
  if (pm) out.push(pm);
  if (bm) out.push(bm);
  return out;
}

export function buildConnection3D(model: ArchModel, cn: ConnectionEntity, o: { selected: boolean; shadows: boolean }): Built | null {
  const g = connectionGeometry(model, cn);
  if (!g) return null;
  return group(connectionMeshes(g, cn.id, o.selected, o.shadows));
}

// ------------------------------------------------------------------------------------------
// REBAR
// ------------------------------------------------------------------------------------------

/** Bars as solid rods (one merged mesh per colour). */
export function buildRebar3D(id: string, bars: RebarBar[], selected: boolean): Built | null {
  if (!bars.length) return null;
  const byColor = new Map<string, Array<THREE.BufferGeometry | null>>();
  for (const b of bars) {
    const list = byColor.get(b.color) || [];
    const r = Math.max(0.2, b.dia / 2);
    for (let i = 0; i + 1 < b.pts.length; i++) list.push(rod(V(b.pts[i]), V(b.pts[i + 1]), r));
    for (let i = 1; i + 1 < b.pts.length; i++) {
      const s = new THREE.SphereGeometry(r, 6, 4);
      const p = V(b.pts[i]);
      s.translate(p.x, p.y, p.z);
      list.push(s);
    }
    byColor.set(b.color, list);
  }
  const parts: THREE.Mesh[] = [];
  for (const [color, geos] of byColor) {
    const m = mesh(merged(geos), new THREE.MeshStandardMaterial({ color: selected ? SEL : color, roughness: 0.45, metalness: 0.4, emissive: color, emissiveIntensity: 0.12 }), id, false);
    if (m) parts.push(m);
  }
  return group(parts);
}

// ------------------------------------------------------------------------------------------
// LOADS & ANALYTICAL MODEL
// ------------------------------------------------------------------------------------------

function arrow(at: THREE.Vector3, len: number, color: string): THREE.BufferGeometry[] {
  const shaft = new THREE.CylinderGeometry(0.6, 0.6, len, 6);
  shaft.translate(at.x, at.y + 6 + len / 2, at.z);
  const head = new THREE.ConeGeometry(2.4, 6, 10);
  head.rotateX(Math.PI);
  head.translate(at.x, at.y + 3, at.z);
  void color;
  return [shaft, head];
}

export function buildLoad3D(model: ArchModel, ld: LoadEntity, selected: boolean): Built | null {
  const z = levelElevationOf(model, ld.levelId) + (ld.zOffset ?? 0) + 1;
  const color = selected ? '#f59e0b' : '#c026d3';
  const geos: THREE.BufferGeometry[] = [];
  const pts = ld.points;
  if (ld.kind === 'point' && pts[0]) geos.push(...arrow(new THREE.Vector3(pts[0].x, z, pts[0].y), 30, color));
  else if (ld.kind === 'line' && pts.length >= 2) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(2, Math.round(L / 24));
      for (let k = 0; k <= n; k++) geos.push(...arrow(new THREE.Vector3(a.x + ((b.x - a.x) * k) / n, z, a.y + ((b.y - a.y) * k) / n), 18, color));
      const bar = rod(new THREE.Vector3(a.x, z + 24, a.y), new THREE.Vector3(b.x, z + 24, b.y), 0.6);
      if (bar) geos.push(bar);
    }
  } else if (ld.kind === 'area' && pts.length >= 3) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const step = Math.max(24, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 5);
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const A = pts[i], B = pts[j];
          if (A.y > y !== B.y > y && x < ((B.x - A.x) * (y - A.y)) / (B.y - A.y) + A.x) inside = !inside;
        }
        if (inside) geos.push(...arrow(new THREE.Vector3(x, z, y), 14, color));
      }
  }
  const parts: Array<THREE.Object3D | null> = [mesh(merged(geos), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }), ld.id, false)];
  if (ld.kind === 'area' && pts.length >= 3) {
    const plane = new THREE.ShapeGeometry(shapeFrom(pts));
    plane.rotateX(Math.PI / 2);
    plane.translate(0, z + 20, 0);
    parts.push(mesh(plane, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }), ld.id, false));
  }
  return group(parts);
}

export function buildAnalytical3D(model: ArchModel): THREE.Object3D {
  const an = analyticalModel(model);
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: 0x9333ea, depthTest: false, transparent: true, opacity: 0.95 });
  const pos: number[] = [];
  for (const m of an.members) {
    const a = V(m.a), b = V(m.b);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(lg, lineMat);
  lines.renderOrder = 10;
  g.add(lines);
  const nodeGeo = merged(an.nodes.map((n) => {
    const s = new THREE.SphereGeometry(2.2, 10, 8);
    const p = V(n);
    s.translate(p.x, p.y, p.z);
    return s;
  }));
  if (nodeGeo) {
    const nm = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: 0x7e22ce, depthTest: false }));
    nm.renderOrder = 11;
    g.add(nm);
  }
  const supGeo = merged(an.supports.map((s) => {
    const c = new THREE.ConeGeometry(5, 7, 4);
    const p = V(s.at);
    c.translate(p.x, p.y - 3.5, p.z);
    return c;
  }));
  if (supGeo) {
    const sm = new THREE.Mesh(supGeo, new THREE.MeshBasicMaterial({ color: 0x7e22ce, depthTest: false }));
    sm.renderOrder = 11;
    g.add(sm);
  }
  return g;
}
