/**
 * 3D builders for roofs and facades (three.js).
 *
 * Plan coordinates are model inches (+Y down in plan). three.js world: X = plan x, Z = plan y, Y = up.
 * Everything here is driven by the pure engines in ../engine/roof.ts and ../engine/facade.ts so the
 * 3D model, plan, roof plan and elevations always agree.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
  ArchModel,
  BalconyEntity,
  DoorEntity,
  DormerEntity,
  ExteriorFinish,
  InteriorFinish,
  Point,
  RailingStyle,
  RoofEntity,
  RoofMaterial,
  SkylightEntity,
  SweepEntity,
  WallEntity,
  WallOpeningEntity,
  WindowEntity,
} from '../types/model';
import { crossingCuts, cutStations, wallEndCuts } from '../engine/wallJoins';
import { doorLayout, isSwingKind } from '../engine/doorStyles';
import {
  depthAcross,
  elevOpeningsOf,
  frameColor,
  frameDepthOf,
  openingExtSign,
  wallElevationShape,
  type HostedOpening,
} from '../engine/openings';
import {
  dormerGeometry,
  faceAt,
  getRoofGeometry,
  offsetPolygon,
  pointInPolygon,
  skylightOutline,
  type P3,
  type RoofFace,
} from '../engine/roof';
import {
  balconyPlan,
  curtainCells,
  curtainOf,
  DIVISIONS,
  finishDef,
  isCurtainWall,
  profileZ,
  roofMaterialDef,
  wallExteriorSide,
  wallFinishBands,
  wallProfile,
} from '../engine/facade';

export interface Built {
  obj: THREE.Object3D;
  meshes: THREE.Object3D[];
}

const SEL = 0xf59e0b;
const TILE = 48; // inches covered by one texture tile

// ------------------------------------------------------------------------------------------
// Procedural textures (one CanvasTexture per finish / roof material, cached)
// ------------------------------------------------------------------------------------------

const texCache = new Map<string, THREE.Texture>();

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function makeTexture(key: string, draw: (g: CanvasRenderingContext2D, S: number) => void): THREE.Texture | null {
  const hit = texCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  draw(g, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

function noise(g: CanvasRenderingContext2D, S: number, amount: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < S * S * 0.06; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${amount * r()})`;
    g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
  }
}

/** Texture for an exterior finish; one tile = 48" x 48" (canvas y = up the wall). */
export function finishTexture(finish: ExteriorFinish): THREE.Texture | null {
  const def = finishDef(finish);
  return makeTexture(`finish:${finish}`, (g, S) => {
    const px = S / TILE; // px per inch
    g.fillStyle = def.color;
    g.fillRect(0, 0, S, S);
    const r = rng(finish.length * 977);
    g.strokeStyle = def.joint;
    switch (finish) {
      case 'brick': {
        const bw = 8 * px, bh = (8 / 3) * px;
        for (let row = 0; row * bh < S; row++) {
          const off = row % 2 ? bw / 2 : 0;
          for (let x = -bw; x < S + bw; x += bw) {
            g.fillStyle = shadeHex(def.color, 0.86 + r() * 0.24);
            g.fillRect(x + off + 0.6, row * bh + 0.6, bw - 1.2, bh - 1.2);
          }
        }
        g.globalAlpha = 0.55;
        g.fillStyle = def.joint;
        for (let row = 0; row * bh < S; row++) g.fillRect(0, row * bh, S, 0.9);
        g.globalAlpha = 1;
        break;
      }
      case 'lap-siding': {
        const h = 6 * px;
        for (let y = 0; y < S; y += h) {
          const gr = g.createLinearGradient(0, y, 0, y + h);
          gr.addColorStop(0, shadeHex(def.color, 0.8));
          gr.addColorStop(0.18, shadeHex(def.color, 1.02));
          gr.addColorStop(1, shadeHex(def.color, 0.95));
          g.fillStyle = gr;
          g.fillRect(0, y, S, h);
        }
        break;
      }
      case 'board-batten': {
        for (let x = 0; x < S; x += 12 * px) {
          g.fillStyle = shadeHex(def.color, 0.78);
          g.fillRect(x + 6 * px - 1.5 * px, 0, 3 * px, S);
          g.fillStyle = shadeHex(def.color, 1.06);
          g.fillRect(x + 6 * px - 1.5 * px, 0, 0.8 * px, S);
        }
        break;
      }
      case 'stucco':
        noise(g, S, 0.18, 11);
        break;
      case 'log-round':
      case 'log-d':
      case 'log-chinked': {
        // stacked logs: rounded shading per course (chinking: white mortar bands)
        const h = (finish === 'log-round' ? 9 : finish === 'log-d' ? 7.5 : 10) * px;
        for (let y = 0; y < S; y += h) {
          const gr = g.createLinearGradient(0, y, 0, y + h);
          if (finish === 'log-chinked') {
            gr.addColorStop(0, '#f1ece2');
            gr.addColorStop(0.12, '#f1ece2');
            gr.addColorStop(0.14, shadeHex(def.color, 0.85));
            gr.addColorStop(0.6, shadeHex(def.color, 1.05));
            gr.addColorStop(1, shadeHex(def.color, 0.8));
          } else {
            gr.addColorStop(0, shadeHex(def.color, 0.55));
            gr.addColorStop(0.25, shadeHex(def.color, 1.1));
            gr.addColorStop(0.55, shadeHex(def.color, 1.0));
            gr.addColorStop(1, shadeHex(def.color, 0.6));
          }
          g.fillStyle = gr;
          g.fillRect(0, y, S, h);
          // grain / checks
          g.globalAlpha = 0.25;
          g.strokeStyle = shadeHex(def.color, 0.6);
          for (let k = 0; k < 3; k++) {
            const yy = y + h * (0.3 + r() * 0.5);
            g.beginPath();
            g.moveTo(r() * S * 0.3, yy);
            g.lineTo(S * (0.5 + r() * 0.5), yy + (r() - 0.5) * 2);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
        break;
      }
      case 'cedar-bb': {
        for (let y = 0; y < S; y += 4 * px) {
          g.globalAlpha = 0.15;
          g.fillStyle = shadeHex(def.color, 0.8 + r() * 0.3);
          g.fillRect(0, y, S, 4 * px);
        }
        g.globalAlpha = 1;
        for (let x = 0; x < S; x += 12 * px) {
          g.fillStyle = shadeHex(def.color, 0.72);
          g.fillRect(x + 6 * px - 1.25 * px, 0, 2.5 * px, S);
          g.fillStyle = shadeHex(def.color, 1.1);
          g.fillRect(x + 6 * px - 1.25 * px, 0, 0.6 * px, S);
        }
        break;
      }
      case 'stone': {
        let y = 0;
        while (y < S) {
          const h = (5 + r() * 6) * px;
          let x = -r() * 10 * px;
          while (x < S) {
            const w = (9 + r() * 14) * px;
            g.fillStyle = shadeHex(def.color, 0.78 + r() * 0.34);
            g.beginPath();
            g.roundRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4, 3);
            g.fill();
            x += w;
          }
          y += h;
        }
        noise(g, S, 0.12, 5);
        break;
      }
      case 'wood-cladding': {
        const h = 6 * px;
        for (let y = 0; y < S; y += h) {
          g.fillStyle = shadeHex(def.color, 0.85 + r() * 0.25);
          g.fillRect(0, y, S, h - 1);
          g.strokeStyle = shadeHex(def.color, 0.75);
          g.globalAlpha = 0.35;
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            const yy = y + 2 + r() * (h - 4);
            g.moveTo(0, yy);
            g.bezierCurveTo(S * 0.3, yy + 2, S * 0.6, yy - 2, S, yy + r() * 2);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.fillStyle = def.joint;
          g.fillRect(0, y + h - 1, S, 1);
        }
        break;
      }
      case 'fiber-cement': {
        noise(g, S, 0.06, 3);
        g.lineWidth = 2;
        g.strokeStyle = def.joint;
        g.strokeRect(1, 1, S - 2, S / 2 - 2);
        g.strokeRect(1, S / 2 + 1, S - 2, S / 2 - 2);
        g.fillStyle = shadeHex(def.color, 0.7);
        for (const [fx, fy] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.44], [0.94, 0.44], [0.06, 0.56], [0.94, 0.56], [0.06, 0.94], [0.94, 0.94]]) g.fillRect(fx * S - 1, fy * S - 1, 2, 2);
        break;
      }
      case 'concrete': {
        noise(g, S, 0.12, 21);
        g.strokeStyle = def.joint;
        g.lineWidth = 1;
        g.strokeRect(0.5, 0.5, S - 1, S - 1);
        g.fillStyle = shadeHex(def.color, 0.65);
        for (const fx of [0.25, 0.75]) for (const fy of [0.25, 0.75]) {
          g.beginPath();
          g.arc(fx * S, fy * S, 2, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
    }
  });
}

/** Texture for a roof material; v runs up the slope. */
export function roofTexture(m: RoofMaterial | undefined): THREE.Texture | null {
  const def = roofMaterialDef(m);
  return makeTexture(`roof:${def.id}`, (g, S) => {
    const px = S / TILE;
    g.fillStyle = def.color;
    g.fillRect(0, 0, S, S);
    const r = rng(def.id.length * 131);
    switch (def.id) {
      case 'asphalt-shingle': {
        const h = 6 * px, w = 12 * px;
        for (let row = 0; row * h < S; row++) {
          const off = (row % 2) * w / 2;
          for (let x = -w; x < S + w; x += w) {
            g.fillStyle = shadeHex(def.color, 0.8 + r() * 0.4);
            g.fillRect(x + off, row * h, w - 1, h);
          }
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(0, row * h, S, 1.5);
        }
        noise(g, S, 0.15, 7);
        break;
      }
      case 'standing-seam': {
        for (let x = 0; x < S; x += 16 * px) {
          g.fillStyle = shadeHex(def.color, 1.25);
          g.fillRect(x, 0, 1.2 * px, S);
          g.fillStyle = shadeHex(def.color, 0.7);
          g.fillRect(x + 1.2 * px, 0, 0.8 * px, S);
        }
        break;
      }
      case 'clay-tile': {
        const w = 8 * px, h = 12 * px;
        for (let x = 0; x < S; x += w) {
          const gr = g.createLinearGradient(x, 0, x + w, 0);
          gr.addColorStop(0, shadeHex(def.color, 0.7));
          gr.addColorStop(0.5, shadeHex(def.color, 1.15));
          gr.addColorStop(1, shadeHex(def.color, 0.7));
          g.fillStyle = gr;
          g.fillRect(x, 0, w, S);
        }
        g.fillStyle = 'rgba(0,0,0,0.3)';
        for (let y = 0; y < S; y += h) g.fillRect(0, y, S, 2);
        break;
      }
      case 'slate': {
        const h = 7 * px, w = 12 * px;
        for (let row = 0; row * h < S; row++) {
          const off = (row % 2) * w / 2;
          for (let x = -w; x < S + w; x += w) {
            g.fillStyle = shadeHex(def.color, 0.82 + r() * 0.3);
            g.fillRect(x + off + 0.5, row * h + 0.5, w - 1, h - 1);
          }
        }
        break;
      }
      case 'membrane': {
        noise(g, S, 0.05, 9);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(0, 0, S, 1.5);
        g.fillRect(0, S / 2, S, 1.5);
        break;
      }
      case 'green-roof': {
        for (let i = 0; i < 1600; i++) {
          g.fillStyle = `hsl(${85 + r() * 40},${35 + r() * 30}%,${22 + r() * 25}%)`;
          g.beginPath();
          g.arc(r() * S, r() * S, 1 + r() * 3, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
    }
  });
}

const INTERIOR_COLORS: Record<string, string> = {
  paint: '#f5f5f4',
  plaster: '#ede6da',
  'wood-panel': '#b48a60',
  tile: '#e5e7eb',
  exposed: '#a8a29e',
  'knotty-pine': '#e3c48f',
  'log-interior': '#d2a86b',
};
export const interiorColor = (f?: InteriorFinish) => INTERIOR_COLORS[f || 'paint'] || '#f5f5f4';

// ------------------------------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------------------------------

const V = (p: P3) => new THREE.Vector3(p.x, p.z, p.y);

function newell(pts: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.lengthSq() > 1e-12 ? n.normalize() : n;
}

/**
 * Planar polygon (with optional holes) → triangulated geometry with uniform normal and
 * texture coordinates in tiles (u along the horizontal of the plane, v up the plane).
 */
export function polygonGeometry(outer: P3[], holes: P3[][] = [], opts: { flip?: boolean; tile?: number; up?: boolean } = {}): THREE.BufferGeometry | null {
  if (outer.length < 3) return null;
  const O = outer.map(V);
  let N = newell(O);
  if (N.lengthSq() < 0.5) return null;
  if (opts.up && N.y < 0) N = N.clone().negate();
  if (opts.flip) N = N.clone().negate();
  const up = new THREE.Vector3(0, 1, 0);
  let U = new THREE.Vector3().crossVectors(up, N);
  if (U.lengthSq() < 1e-6) U = new THREE.Vector3(1, 0, 0);
  U.normalize();
  const W = new THREE.Vector3().crossVectors(N, U).normalize();
  const H = holes.filter((h) => h.length >= 3).map((h) => h.map(V));
  const to2 = (p: THREE.Vector3) => new THREE.Vector2(p.dot(U), p.dot(W));
  const all = [...O, ...H.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(O.map(to2), H.map((h) => h.map(to2)));
  const tile = opts.tile ?? TILE;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const t of tris) {
    let [i, j, k] = t;
    e1.subVectors(all[j], all[i]);
    e2.subVectors(all[k], all[i]);
    if (e1.cross(e2).dot(N) < 0) [j, k] = [k, j];
    for (const idx of [i, j, k]) {
      const p = all[idx];
      pos.push(p.x, p.y, p.z);
      nor.push(N.x, N.y, N.z);
      uv.push(p.dot(U) / tile, p.dot(W) / tile);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

function quadGeometry(a: P3, b: P3, c: P3, d: P3): THREE.BufferGeometry | null {
  return polygonGeometry([a, b, c, d]);
}

/** Box spanning plan points a→b (centre line), given width across, height and base z. */
function segmentBox(a: Point, b: Point, width: number, z0: number, height: number): THREE.BufferGeometry | null {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 0.01) return null;
  const g = new THREE.BoxGeometry(L, height, width);
  g.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
  g.translate((a.x + b.x) / 2, z0 + height / 2, (a.y + b.y) / 2);
  return g;
}

function mergeOrNull(list: Array<THREE.BufferGeometry | null>): THREE.BufferGeometry | null {
  const ok = list.filter((g): g is THREE.BufferGeometry => !!g).map((g) => (g.index ? g.toNonIndexed() : g));
  if (!ok.length) return null;
  // align attributes (all of ours have position/normal/uv)
  for (const g of ok) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((g.getAttribute('position').count) * 2).fill(0), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }
  return mergeGeometries(ok, false);
}

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}, selected = false) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.04,
    emissive: selected ? SEL : 0x000000,
    emissiveIntensity: selected ? 0.35 : 0,
    ...extra,
  });
}

/** Transparent, reflective glass (picks up the scene's studio environment). */
const glassMat = (selected = false, tint = 0x9fd6f5) =>
  new THREE.MeshPhysicalMaterial({
    color: selected ? 0xfde68a : tint,
    transparent: true,
    opacity: 0.32,
    roughness: 0.03,
    metalness: 0.25,
    reflectivity: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

function mesh(geo: THREE.BufferGeometry | null, mat: THREE.Material, id: string, extra: Record<string, unknown> = {}, shadow = true): THREE.Mesh | null {
  if (!geo) return null;
  const m = new THREE.Mesh(geo, mat);
  m.userData = { entityId: id, ...extra };
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------------------------------
// ROOF
// ------------------------------------------------------------------------------------------

function planeZFn(pts: P3[]): ((p: Point) => number) | null {
  const O = pts.map(V);
  const N = newell(O);
  if (Math.abs(N.y) < 1e-6) return null;
  const P0 = O[0];
  // N·(X - P0) = 0 → y = P0.y - (N.x (x - P0.x) + N.z (z - P0.z)) / N.y
  return (p: Point) => P0.y - (N.x * (p.x - P0.x) + N.z * (p.y - P0.z)) / N.y;
}

export interface RoofBuildOpts {
  levelElev: number;
  selectedIds: Set<string>;
  skylights: SkylightEntity[];
  shadows: boolean;
  edgeMat?: THREE.LineBasicMaterial;
}

export function buildRoof3D(rf: RoofEntity, o: RoofBuildOpts): Built | null {
  if (!rf.polygon || rf.polygon.length < 3) return null;
  const geom = getRoofGeometry(rf, o.levelElev);
  const sel = o.selectedIds.has(rf.id);
  const def = roofMaterialDef(rf.material);
  const tex = roofTexture(rf.material);
  const roofMat = std(0xffffff, { map: tex, color: tex ? 0xffffff : def.color, roughness: def.id === 'standing-seam' ? 0.45 : 0.85, metalness: def.id === 'standing-seam' ? 0.35 : 0.02 }, sel);
  const trimMat = std('#f4f1ea', { roughness: 0.6, side: THREE.DoubleSide }, sel);
  const soffitMat = std('#ece6da', { roughness: 0.8 }, sel);
  const group = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  const add = (m: THREE.Object3D | null) => {
    if (!m) return;
    group.add(m);
    if (m instanceof THREE.Mesh) meshes.push(m);
  };

  const sideGeos: Array<THREE.BufferGeometry | null> = [];
  const undersideGeos: Array<THREE.BufferGeometry | null> = [];

  // skylights hosted by this roof, grouped by face
  const skyByFace = new Map<RoofFace, P3[][]>();
  for (const s of o.skylights) {
    const so = skylightOutline(geom, s);
    if (!so.face || so.face.kind === 'gable') continue;
    const host = so.face;
    if (!so.plan.every((p) => pointInPolygon(p, host.pts))) continue;
    const list = skyByFace.get(host) ?? [];
    list.push(so.plan.map((p) => ({ x: p.x, y: p.y, z: 0 })));
    skyByFace.set(host, list);
  }

  for (const f of geom.faces) {
    if (f.kind === 'gable') continue;
    const vT = f.kind === 'flat' ? geom.thickness : geom.thickness / Math.max(0.2, Math.cos((f.slopeDeg * Math.PI) / 180));
    const bottom = f.pts;
    const top = f.pts.map((p) => ({ ...p, z: p.z + vT }));
    const zTop = planeZFn(top);
    const zBot = planeZFn(bottom);
    const holes = skyByFace.get(f) ?? [];
    const holesTop = zTop ? holes.map((h) => h.map((p) => ({ ...p, z: zTop(p) }))) : [];
    const holesBot = zBot ? holes.map((h) => h.map((p) => ({ ...p, z: zBot(p) }))) : [];
    const topGeo = polygonGeometry(top, holesTop, { up: true });
    const topMesh = mesh(topGeo, roofMat, rf.id, { roofFace: f.edge }, o.shadows);
    if (topMesh && o.edgeMat) topMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(topGeo!, 25), o.edgeMat));
    add(topMesh);
    undersideGeos.push(polygonGeometry(bottom, holesBot, { up: true, flip: true }));
    for (let i = 0; i < bottom.length; i++) {
      const j = (i + 1) % bottom.length;
      sideGeos.push(quadGeometry(bottom[j], bottom[i], top[i], top[j]));
    }
    // skylight wells
    holesTop.forEach((ht, k) => {
      const hb = holesBot[k];
      for (let i = 0; i < ht.length; i++) {
        const j = (i + 1) % ht.length;
        sideGeos.push(quadGeometry(hb[i], hb[j], ht[j], ht[i]));
      }
    });
  }
  add(mesh(mergeOrNull(sideGeos), trimMat, rf.id, {}, o.shadows));
  add(mesh(mergeOrNull(undersideGeos), soffitMat, rf.id, {}, false));

  // fascia, boxed soffit and gutter along each eave
  const fp = geom.footprint;
  const ol = geom.outline;
  const n = fp.length;
  const vTe = geom.style === 'flat' ? geom.thickness : geom.thickness / Math.max(0.2, Math.cos((geom.slopeDeg * Math.PI) / 180));
  const eaveTop = geom.eaveZ + vTe;
  const fasciaDepth = Math.max(vTe, rf.fasciaDepth ?? 8);
  const fasciaBot = eaveTop - fasciaDepth;
  const fasciaGeos: Array<THREE.BufferGeometry | null> = [];
  const soffitGeos: Array<THREE.BufferGeometry | null> = [];
  const gutterGeos: Array<THREE.BufferGeometry | null> = [];
  if (ol.length === n) {
    for (let e = 0; e < n; e++) {
      const isEave = geom.style === 'flat' || geom.flags[e];
      if (!isEave) continue;
      const a = ol[e];
      const b = ol[(e + 1) % n];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1) continue;
      const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      const out = { x: d.y, y: -d.x }; // outward for a CCW (positive-area, +Y-down) polygon
      // verify outward direction against the footprint
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probe = { x: mid.x + out.x * 2, y: mid.y + out.y * 2 };
      const o2 = pointInPolygon(probe, ol) ? { x: -out.x, y: -out.y } : out;
      const A = { x: a.x + o2.x * 0.6, y: a.y + o2.y * 0.6 };
      const B = { x: b.x + o2.x * 0.6, y: b.y + o2.y * 0.6 };
      fasciaGeos.push(segmentBox(A, B, 1.25, fasciaBot, fasciaDepth));
      if (geom.style !== 'flat' && fasciaBot < geom.eaveZ + 0.01) {
        const fa = fp[e];
        const fb = fp[(e + 1) % n];
        soffitGeos.push(polygonGeometry([{ ...a, z: fasciaBot }, { ...b, z: fasciaBot }, { ...fb, z: fasciaBot }, { ...fa, z: fasciaBot }], [], { up: true, flip: true }));
      }
      if (rf.gutter && geom.style !== 'flat') {
        const c = new THREE.CylinderGeometry(2.6, 2.6, L, 10, 1, true);
        const dirV = new THREE.Vector3(d.x, 0, d.y);
        c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV));
        c.translate(mid.x + o2.x * 3.6, eaveTop - 2.6, mid.y + o2.y * 3.6);
        gutterGeos.push(c);
      }
    }
  }
  add(mesh(mergeOrNull(fasciaGeos), trimMat, rf.id, {}, o.shadows));
  add(mesh(mergeOrNull(soffitGeos), soffitMat, rf.id, {}, false));
  add(mesh(mergeOrNull(gutterGeos), std('#e7e5e4', { metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }, sel), rf.id, {}, false));

  // flat-roof parapet
  if (geom.style === 'flat' && (rf.parapetHeight ?? 0) > 0) {
    const shape = new THREE.Shape(ol.map((p) => new THREE.Vector2(p.x, p.y)));
    const inner = offsetPolygon(ol, -6);
    shape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y))));
    const pg = new THREE.ExtrudeGeometry(shape, { depth: rf.parapetHeight!, bevelEnabled: false });
    pg.rotateX(Math.PI / 2);
    pg.translate(0, geom.baseZ + geom.thickness + rf.parapetHeight!, 0);
    const pm = mesh(pg, std('#e7e2d8', {}, sel), rf.id, {}, o.shadows);
    if (pm && o.edgeMat) pm.add(new THREE.LineSegments(new THREE.EdgesGeometry(pg), o.edgeMat));
    add(pm);
  }
  return { obj: group, meshes };
}

export function buildSkylight3D(rf: RoofEntity, s: SkylightEntity, levelElev: number, selected: boolean): Built | null {
  const geom = getRoofGeometry(rf, levelElev);
  const so = skylightOutline(geom, s);
  if (!so.face) return null;
  const curb = 4;
  const frame = std('#3f3f46', { metalness: 0.4, roughness: 0.4 }, selected);
  const sides: Array<THREE.BufferGeometry | null> = [];
  const pts = so.pts;
  const up = pts.map((p) => ({ ...p, z: p.z + curb }));
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sides.push(quadGeometry(pts[i], pts[j], up[j], up[i]));
  }
  const g = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  const m1 = mesh(mergeOrNull(sides), new THREE.MeshStandardMaterial({ color: frame.color, emissive: frame.emissive, emissiveIntensity: frame.emissiveIntensity, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.4 }), s.id);
  const glass = mesh(polygonGeometry(up, [], { up: true }), glassMat(selected, 0x93c5fd), s.id, {}, false);
  for (const m of [m1, glass]) if (m) { g.add(m); meshes.push(m); }
  return { obj: g, meshes };
}

export function buildDormer3D(rf: RoofEntity, d: DormerEntity, levelElev: number, selected: boolean, shadows: boolean): Built | null {
  const geom = getRoofGeometry(rf, levelElev);
  const dg = dormerGeometry(geom, d);
  if (!dg) return null;
  const g = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  const add = (m: THREE.Mesh | null) => {
    if (m) {
      g.add(m);
      meshes.push(m);
    }
  };
  const tex = finishTexture('lap-siding');
  const wallMat = std(0xffffff, { map: tex, side: THREE.DoubleSide }, selected);
  const [front, ...sides] = dg.walls;
  add(mesh(polygonGeometry(front, [dg.window]), wallMat, d.id, {}, shadows));
  for (const s of sides) add(mesh(polygonGeometry(s), wallMat, d.id, {}, shadows));
  const rtex = roofTexture(rf.material);
  const rMat = std(0xffffff, { map: rtex, color: rtex ? 0xffffff : roofMaterialDef(rf.material).color, side: THREE.DoubleSide }, selected);
  for (const plane of dg.roofPlanes) add(mesh(polygonGeometry(plane.map((p) => ({ ...p, z: p.z + 1.5 }))), rMat, d.id, {}, shadows));
  // window: glass a little behind the face + frame
  const w = dg.window;
  const down = (() => {
    const f = faceAt(geom, d.position);
    return f ? f.down : { x: 0, y: 1 };
  })();
  const inset = (p: P3, k: number) => ({ x: p.x - down.x * k, y: p.y - down.y * k, z: p.z });
  add(mesh(polygonGeometry(w.map((p) => inset(p, 1.5))), glassMat(selected), d.id, {}, false));
  const frameGeos: Array<THREE.BufferGeometry | null> = [];
  for (let i = 0; i < 4; i++) {
    const a = w[i];
    const b = w[(i + 1) % 4];
    const fa = { x: a.x + down.x * 0.4, y: a.y + down.y * 0.4 };
    const fb = { x: b.x + down.x * 0.4, y: b.y + down.y * 0.4 };
    if (Math.abs(a.z - b.z) < 0.01) frameGeos.push(segmentBox(fa, fb, 1.5, a.z - 1, 2));
    else {
      const bx = new THREE.BoxGeometry(2, Math.abs(b.z - a.z), 1.5);
      bx.rotateY(-Math.atan2(down.x, down.y) + Math.PI / 2);
      bx.translate(fa.x, Math.min(a.z, b.z) + Math.abs(b.z - a.z) / 2, fa.y);
      frameGeos.push(bx);
    }
  }
  add(mesh(mergeOrNull(frameGeos), std('#f8fafc', { roughness: 0.5 }, selected), d.id));
  return { obj: g, meshes };
}

// ------------------------------------------------------------------------------------------
// WALLS (finishes, roof-attached tops, openings with styled windows / doors, curtain walls)
// ------------------------------------------------------------------------------------------

export interface WallBuildOpts {
  model: ArchModel;
  levelElev: number;
  doors: DoorEntity[];
  windows: WindowEntity[];
  /** empty wall openings (WO) hosted by this wall */
  wallOpenings?: WallOpeningEntity[];
  /** internal: already split at X-crossings */
  noSplit?: boolean;
  selectedIds: Set<string>;
  sameLevelWalls: WallEntity[];
  isExteriorWall: boolean;
  glassWall: boolean;
  coreColor: string;
  shadows: boolean;
  edgeMat?: THREE.LineBasicMaterial;
}

/** Whether the wall's exterior-side face is outdoors (not inside any room on its level). */
export function wallIsExterior(model: ArchModel, wall: WallEntity, sameLevelWalls: WallEntity[]): boolean {
  if (wall.exteriorFinish || (wall.finishBands && wall.finishBands.length) || wall.exteriorSide) return true;
  const rooms = model.entities.filter((e) => e.type === 'room' && (e.levelId || 'level-1') === (wall.levelId || 'level-1')) as Array<{ polygon: Point[] }>;
  if (!rooms.length) return true;
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const d = { x: (wall.end.x - wall.start.x) / L, y: (wall.end.y - wall.start.y) / L };
  const side = wallExteriorSide(wall, sameLevelWalls);
  const out = side === 'left' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
  const k = wall.thickness / 2 + 6;
  for (const f of [0.25, 0.5, 0.75]) {
    const p = { x: wall.start.x + (wall.end.x - wall.start.x) * f + out.x * k, y: wall.start.y + (wall.end.y - wall.start.y) * f + out.y * k };
    if (!rooms.some((r) => r.polygon && r.polygon.length >= 3 && pointInPolygon(p, r.polygon))) return true;
  }
  return false;
}

export function buildWall3D(wall: WallEntity, o: WallBuildOpts): Built | null {
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (L < 1) return null;
  // X-crossing: a thinner wall crossing another is built as pieces that stop at the main wall's faces
  if (!isCurtainWall(wall) && !o.noSplit) {
    const xs = crossingCuts(wall, o.sameLevelWalls);
    if (xs.length) {
      const dx = (wall.end.x - wall.start.x) / L;
      const dy = (wall.end.y - wall.start.y) / L;
      const at = (s: number) => ({ x: wall.start.x + dx * s, y: wall.start.y + dy * s });
      const cutsS = [0, ...xs.map((x) => (x.s0 + x.s1) / 2), L];
      const parent = new THREE.Group();
      const meshes: THREE.Object3D[] = [];
      for (let i = 0; i + 1 < cutsS.length; i++) {
        const a = cutsS[i];
        const b = cutsS[i + 1];
        if (b - a < 1) continue;
        const piece: WallEntity = { ...wall, start: at(a), end: at(b), joins: { start: i === 0 ? wall.joins?.start : undefined, end: i + 2 === cutsS.length ? wall.joins?.end : undefined } };
        const remap = <T extends { offset: number }>(list: T[]) =>
          list.filter((x) => x.offset * L > a && x.offset * L < b).map((x) => ({ ...x, offset: (x.offset * L - a) / (b - a) }));
        const built = buildWall3D(piece, { ...o, noSplit: true, doors: remap(o.doors), windows: remap(o.windows), wallOpenings: remap(o.wallOpenings || []) });
        if (built) {
          parent.add(built.obj);
          meshes.push(...built.meshes);
        }
      }
      return { obj: parent, meshes };
    }
  }
  const prof = wallProfile(o.model, wall);
  const base = prof.baseZ;
  const sel = o.selectedIds.has(wall.id);
  const t = wall.thickness;
  const side = wallExteriorSide(wall, o.sameLevelWalls);
  const sg = side === 'left' ? 1 : -1; // local +z is the plan "left" of start→end
  const group = new THREE.Group();
  group.position.set(wall.start.x, base, wall.start.y);
  group.rotation.y = -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  const meshes: THREE.Object3D[] = [];
  const add = (m: THREE.Object3D | null, pick = true) => {
    if (!m) return;
    group.add(m);
    if (pick) meshes.push(m);
  };
  const topAt = (s: number) => profileZ(prof, Math.max(0, Math.min(L, s))) - base;
  const H = Math.max(...prof.top.map((p) => p.z)) - base;

  if (isCurtainWall(wall)) {
    const g = curtainOf(wall);
    const cells = curtainCells(wall, L, H);
    const ms = Math.max(1, g.mullionSize);
    const md = Math.max(4, t);
    const mullMat = std(g.mullionColor || '#334155', { metalness: 0.45, roughness: 0.35 }, sel);
    const mulls: Array<THREE.BufferGeometry | null> = [];
    for (const c of cells.cols) {
      const x = Math.max(ms / 2, Math.min(L - ms / 2, c));
      const b = new THREE.BoxGeometry(ms, H, md);
      b.translate(x, H / 2, 0);
      mulls.push(b);
    }
    for (const r of cells.rows) {
      const y = Math.max(ms / 2, Math.min(H - ms / 2, r));
      const b = new THREE.BoxGeometry(L, ms, md);
      b.translate(L / 2, y, 0);
      mulls.push(b);
    }
    add(mesh(mergeOrNull(mulls), mullMat, wall.id, { wallId: wall.id }, o.shadows));
    const solids: Array<THREE.BufferGeometry | null> = [];
    const glassG: Array<THREE.BufferGeometry | null> = [];
    const doorG: Array<THREE.BufferGeometry | null> = [];
    for (let ci = 0; ci < cells.cols.length - 1; ci++) {
      for (let ri = 0; ri < cells.rows.length - 1; ri++) {
        const x0 = cells.cols[ci] + ms / 2, x1 = cells.cols[ci + 1] - ms / 2;
        const y0 = cells.rows[ri] + ms / 2, y1 = cells.rows[ri + 1] - ms / 2;
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        const type = cells.type(ci, ri);
        const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, type === 'solid' ? 2 : 0.6);
        b.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
        (type === 'solid' ? solids : type === 'door' ? doorG : glassG).push(b);
        if (type === 'window') {
          // operable vent: aluminum sash inside the panel, opened slightly (awning) + handle
          const st = 2;
          const sashG = [
            new THREE.BoxGeometry(x1 - x0 - 2, st, 1.2).translate((x0 + x1) / 2, y0 + 1 + st / 2, sg * 0.9),
            new THREE.BoxGeometry(x1 - x0 - 2, st, 1.2).translate((x0 + x1) / 2, y1 - 1 - st / 2, sg * 0.9),
            new THREE.BoxGeometry(st, y1 - y0 - 2, 1.2).translate(x0 + 1 + st / 2, (y0 + y1) / 2, sg * 0.9),
            new THREE.BoxGeometry(st, y1 - y0 - 2, 1.2).translate(x1 - 1 - st / 2, (y0 + y1) / 2, sg * 0.9),
            new THREE.BoxGeometry(5, 0.8, 1).translate((x0 + x1) / 2, y0 + 4, -sg * 1.2),
          ];
          solids.push(...sashG);
        }
        if (type === 'door') {
          const h = new THREE.BoxGeometry(1, Math.min(30, (y1 - y0) * 0.4), 1.2);
          h.translate(x1 - 4, y0 + 40, sg * 1.5);
          solids.push(h);
        }
      }
    }
    add(mesh(mergeOrNull(glassG), glassMat(sel), wall.id, { wallId: wall.id }, false));
    add(mesh(mergeOrNull(doorG), glassMat(sel, 0x38bdf8), wall.id, { wallId: wall.id }, false));
    add(mesh(mergeOrNull(solids), std('#57534e', { roughness: 0.5 }, sel), wall.id, { wallId: wall.id }, o.shadows));
    return { obj: group, meshes };
  }

  // ---- openings (wall-local: x along the wall, y up from the base): REAL holes — the wall face is a
  // THREE.Shape with one hole (or base notch, for doors / floor-level openings) per opening, extruded
  // through the thickness, so the reveals are the wall's own cut faces. No boolean library needed.
  const hosted: HostedOpening[] = [...o.doors, ...o.windows, ...(o.wallOpenings || [])];
  const byId = new Map(hosted.map((h) => [h.id, h] as const));
  const eshape = wallElevationShape(
    L,
    prof.top.map((p) => ({ s: p.s, z: p.z - base })),
    topAt,
    elevOpeningsOf(wall, hosted)
  );
  const clean: Op3[] = eshape.placed.map((pl) => ({ e: byId.get(pl.id)!, kind: pl.kind, x0: pl.s0, x1: pl.s1, y0: pl.z0, y1: pl.z1, arch: !!pl.arch }));
  const shape = new THREE.Shape(eshape.outline.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of eshape.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));

  // log walls: a slightly thinner core fills between the stacked logs, which form the faces
  const isLogWall = !!(o.model.wallTypes || []).find((wt) => wt.id === wall.wallTypeId)?.log;
  const coreT = isLogWall ? t * 0.78 : t;
  const core = new THREE.ExtrudeGeometry(shape, { depth: coreT, bevelEnabled: false });
  core.translate(0, 0, -coreT / 2);
  // ---- joined ends: move the end vertices onto the corner cut (miter / butt / T trim …) so corners and
  // junctions have no gaps, no overlapping end caps and no z-fighting (wallJoins.ts)
  const endCuts = wallEndCuts(wall, o.sameLevelWalls);
  const stS = cutStations(wall, endCuts.start);
  const stE = cutStations(wall, endCuts.end);
  const cutX = (which: 'start' | 'end', z: number) => {
    const st = which === 'start' ? stS : stE;
    const k = Math.max(0, Math.min(1, (z + t / 2) / Math.max(1e-6, t)));
    return st.right + (st.left - st.right) * k;
  };
  const applyCuts = (g: THREE.BufferGeometry, zOff = 0) => {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x <= 1e-4) pos.setX(i, cutX('start', pos.getZ(i) + zOff));
      else if (x >= L - 1e-4) pos.setX(i, cutX('end', pos.getZ(i) + zOff));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  };
  applyCuts(core);
  /** Edges without seams: lines lying on a joined end cap are dropped (they would show the joint). */
  const seamlessEdges = (g: THREE.BufferGeometry) => {
    const eg = new THREE.EdgesGeometry(g, 20);
    const p = eg.getAttribute('position') as THREE.BufferAttribute;
    const keep: number[] = [];
    const onCap = (which: 'start' | 'end', x: number, z: number) => Math.abs(x - cutX(which, z)) < 1e-3;
    for (let i = 0; i < p.count; i += 2) {
      const a = [p.getX(i), p.getY(i), p.getZ(i)];
      const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      let drop = false;
      for (const which of ['start', 'end'] as const) {
        const kind = endCuts[which].kind;
        if (kind === 'free' || kind === 'disallowed') continue;
        if (!onCap(which, a[0], a[2]) || !onCap(which, b[0], b[2])) continue;
        const vertical = Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
        // keep real corner edges (miter / butt / T / hub); drop cap outlines and straight-through seams
        if (!vertical || kind === 'collinear' || kind === 'through') drop = true;
      }
      if (!drop) keep.push(...a, ...b);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    eg.dispose();
    return out;
  };
  const wType = (o.model.wallTypes || []).find((wt) => wt.id === wall.wallTypeId);
  const logType = wType?.log;
  const inColor = interiorColor(wall.interiorFinish || wType?.interiorFinish);
  const capMat = o.glassWall ? glassMat(sel) : std(sel ? '#fcd34d' : logType ? (logType.chinking ? '#efe9dd' : '#5a3d26') : inColor, { roughness: 0.8 }, sel);
  // log walls: the core shows only between the logs (shadow gap / white chinking)
  const sideMat = o.glassWall ? capMat : std(logType ? (logType.chinking ? '#efe9dd' : '#5a3d26') : o.coreColor, { roughness: 0.8 }, sel);
  const coreMesh = new THREE.Mesh(core, [capMat, sideMat]);
  coreMesh.userData = { entityId: wall.id, wallId: wall.id };
  coreMesh.castShadow = o.shadows && !o.glassWall;
  coreMesh.receiveShadow = true;
  if (o.edgeMat) coreMesh.add(new THREE.LineSegments(seamlessEdges(core), o.edgeMat));
  add(coreMesh);

  // ---- exterior finish skins, one per band, clipped to the band's height range
  if (o.isExteriorWall && !o.glassWall && !logType) {
    const skinGeo = new THREE.ShapeGeometry(shape);
    applyCuts(skinGeo, sg * (t / 2));
    const bands = wallFinishBands(wall, H);
    bands.forEach((band, i) => {
      const def = finishDef(band.finish);
      const tex = finishTexture(band.finish);
      const planes: THREE.Plane[] = [];
      if (i > 0) planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(base + band.z0)));
      if (i < bands.length - 1) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), base + band.z1));
      const m = new THREE.MeshStandardMaterial({
        color: tex ? 0xffffff : def.color,
        map: tex ? tex.clone() : null,
        roughness: band.finish === 'brick' || band.finish === 'stone' || band.finish === 'stucco' ? 0.95 : 0.8,
        metalness: 0.02,
        side: THREE.DoubleSide,
        clippingPlanes: planes,
        emissive: sel ? SEL : 0x000000,
        emissiveIntensity: sel ? 0.3 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      if (m.map) {
        m.map.repeat.set(1 / TILE, 1 / TILE);
        m.map.needsUpdate = true;
      }
      const skin = new THREE.Mesh(skinGeo, m);
      skin.position.z = sg * (t / 2 + 0.08);
      skin.userData = { entityId: wall.id, wallId: wall.id, paintable: true };
      skin.receiveShadow = true;
      add(skin);
    });
    // band joints
    for (const band of bands.slice(1)) {
      const b = new THREE.BoxGeometry(L, 0.75, 0.6);
      b.translate(L / 2, band.z0, sg * (t / 2 + 0.3));
      applyCuts(b);
      add(mesh(b, std('#57534e'), wall.id, { wallId: wall.id }, false), false);
    }
  }

  // ---- LOG WALLS: stacked round / D / square-chinked courses, cut at openings, with saddle-notch
  // corner overhangs (the courses of crossing walls are offset by half a course)
  if (logType && !o.glassWall) {
    const h = Math.max(4, logType.course);
    const ov = logType.overhang ?? 0;
    const dirX = Math.abs(wall.end.x - wall.start.x) >= Math.abs(wall.end.y - wall.start.y);
    const shift = dirX ? 0 : h / 2;
    const cornerKinds = new Set(['miter', 'butt', 'squareoff', 'hub']);
    const xa = cornerKinds.has(endCuts.start.kind) && ov > 0 ? -(t / 2 + ov) : Math.min(cutX('start', -t / 2), cutX('start', t / 2));
    const xb = cornerKinds.has(endCuts.end.kind) && ov > 0 ? L + t / 2 + ov : Math.max(cutX('end', -t / 2), cutX('end', t / 2));
    const logColor = wType?.layers[Math.floor(wType.layers.length / 2)]?.color || '#c08a55';
    // alternate log tints so the courses read like individual logs
    const logMats = [std(sel ? '#fcd34d' : logColor, { roughness: 0.88 }, sel), std(sel ? '#fcd34d' : shadeHex(logColor, 0.86), { roughness: 0.9 }, sel)];
    const geos: THREE.BufferGeometry[] = [];
    const geos2: THREE.BufferGeometry[] = [];
    const step = 2;
    for (let i = -1; i * h + shift < H; i++) {
      const y0 = Math.max(0, i * h + shift);
      const y1 = i * h + shift + h;
      if (y1 - y0 < h * 0.45) continue;
      // runs along the wall where this course exists (below the top, outside openings)
      const runs: Array<[number, number]> = [];
      let runStart: number | null = null;
      const nSteps = Math.max(1, Math.ceil((xb - xa) / step));
      for (let k = 0; k <= nSteps; k++) {
        const xx = k === nSteps ? xb : xa + k * step;
        const top = topAt(Math.max(0, Math.min(L, xx)));
        const inOpening = clean.some((op) => xx > op.x0 - 0.5 && xx < op.x1 + 0.5 && y0 < op.y1 && y1 > op.y0);
        const ok = top >= y0 + h * 0.55 && !inOpening;
        if (ok && runStart === null) runStart = xx;
        if ((!ok || k === nSteps) && runStart !== null) {
          const end = ok ? xx : Math.max(runStart, xx - step);
          if (end - runStart > 3) runs.push([runStart, end]);
          runStart = null;
        }
      }
      for (const [a, b] of runs) {
        const len = b - a;
        const cy = (y0 + Math.min(y1, H)) / 2;
        const target = (i & 1) ? geos2 : geos;
        if (logType.profile === 'round') {
          // round log: full width, scribed so a dark seam shows between courses
          const r = (t / 2) * 1.04;
          const g = new THREE.CylinderGeometry(r, r, len, 20, 1, false);
          g.rotateZ(Math.PI / 2);
          g.scale(1, (h * 0.5) / r, 1);
          g.translate((a + b) / 2, i * h + shift + h / 2, 0);
          target.push(g);
        } else if (logType.profile === 'd') {
          // D-log: round outside, flat inside (half-round bulge on the exterior face over a flat log)
          const r = (h / 2) * 0.98;
          const g = new THREE.CylinderGeometry(r, r, len, 20, 1, false);
          g.rotateZ(Math.PI / 2);
          g.scale(1, 1, (t * 0.3) / r);
          g.translate((a + b) / 2, i * h + shift + h / 2, sg * (t / 2 - t * 0.3));
          target.push(g);
          const f = new THREE.BoxGeometry(len, h * 0.96, t * 0.55);
          f.translate((a + b) / 2, i * h + shift + h / 2, -sg * (t / 2 - (t * 0.55) / 2));
          target.push(f);
        } else {
          // hand-hewn square timbers with white chinking between them
          const g = new THREE.BoxGeometry(len, h * 0.78, t + 0.6);
          g.translate((a + b) / 2, i * h + shift + h * 0.5, 0);
          target.push(g);
        }
        void cy;
      }
    }
    for (const [list, m] of [[geos, logMats[0]], [geos2, logMats[1]]] as const) {
      if (!list.length) continue;
      const lm = mesh(mergeOrNull(list), m, wall.id, { wallId: wall.id }, o.shadows);
      if (lm) add(lm);
    }
  }

  // ---- styled windows and doors
  for (const op of clean) add3DOpening(group, meshes, op, t, sg, o);
  return { obj: group, meshes };
}

interface Op3 {
  e: HostedOpening;
  kind: 'door' | 'window' | 'wallopening';
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  arch: boolean;
}

/**
 * Frame, sashes / leaves, glass and sills of one opening, placed at its depth position inside the
 * wall thickness (local z: + = wall LEFT normal; sg = exterior side sign). Wall openings get nothing.
 */
/** Centre prism of a star join (3+ walls meeting at one point without a straight-through pair). */
export function buildJoinHub3D(id: string, poly: Point[], z0: number, height: number, color: string, shadows: boolean): Built | null {
  if (poly.length < 3 || height <= 0) return null;
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  // shape (x, y) + extrusion z  →  three (x, z0 + z, y)
  g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, z0, 0, 1, 0, 0, 0, 0, 0, 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }));
  m.castShadow = shadows;
  m.receiveShadow = true;
  m.userData = { entityId: id };
  return { obj: m, meshes: [m] };
}

function add3DOpening(group: THREE.Group, meshes: THREE.Object3D[], op: Op3, t: number, sg: number, o: WallBuildOpts) {
  if (op.kind === 'wallopening') return;
  const sel = o.selectedIds.has(op.e.id);
  const id = op.e.id;
  const w = op.x1 - op.x0;
  const h = op.y1 - op.y0;
  const cx = (op.x0 + op.x1) / 2;
  const ext = openingExtSign(op.e, sg); // windows may flip their exterior side
  const fd = frameDepthOf(op.e, t);
  const zc = depthAcross((op.e as DoorEntity | WindowEntity).depthPosition, t, fd, ext);
  const frameGeos: Array<THREE.BufferGeometry | null> = [];
  const trimGeos: Array<THREE.BufferGeometry | null> = [];
  const sillGeos: Array<THREE.BufferGeometry | null> = [];
  const glassGeos: Array<THREE.BufferGeometry | null> = [];
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
    if (bw <= 0.01 || bh <= 0.01 || bd <= 0.01) return null;
    const b = new THREE.BoxGeometry(bw, bh, bd);
    b.translate(x, y, z);
    return b;
  };
  /** box spanning across from za to zb (any order) */
  const boxZ = (bw: number, bh: number, za: number, zb: number, x: number, y: number) => box(bw, bh, Math.abs(zb - za), x, y, (za + zb) / 2);
  const push = (m: THREE.Mesh | null) => {
    if (m) {
      group.add(m);
      meshes.push(m);
    }
  };
  const fcol = sel ? '#f59e0b' : frameColor((op.e as DoorEntity | WindowEntity).frameMaterial, '#f8fafc');
  const extFace = ext * (t / 2);
  const intFace = -ext * (t / 2);

  if (op.kind === 'window') {
    const win = op.e as WindowEntity;
    const fw = Math.max(1, Math.min(w / 4, win.frameWidth ?? 2.5));
    // outer frame at the depth position
    frameGeos.push(box(w, fw, fd, cx, op.y0 + fw / 2, zc), box(w, fw, fd, cx, op.y1 - fw / 2, zc), box(fw, h, fd, op.x0 + fw / 2, op.y0 + h / 2, zc), box(fw, h, fd, op.x1 - fw / 2, op.y0 + h / 2, zc));
    const ix0 = op.x0 + fw, ix1 = op.x1 - fw, iy0 = op.y0 + fw, iy1 = op.y1 - fw;
    const iw = ix1 - ix0, ih = iy1 - iy0;
    const sash = 1.5;
    const pane = (x0: number, x1: number, y0: number, y1: number, z: number, withSash: boolean) => {
      if (withSash) frameGeos.push(box(x1 - x0, sash, 1.4, (x0 + x1) / 2, y0 + sash / 2, z), box(x1 - x0, sash, 1.4, (x0 + x1) / 2, y1 - sash / 2, z), box(sash, y1 - y0, 1.4, x0 + sash / 2, (y0 + y1) / 2, z), box(sash, y1 - y0, 1.4, x1 - sash / 2, (y0 + y1) / 2, z));
      const g = withSash ? sash : 0;
      glassGeos.push(box(x1 - x0 - 2 * g, y1 - y0 - 2 * g, 0.25, (x0 + x1) / 2, (y0 + y1) / 2, z));
    };
    const op2 = win.operation || 'fixed';
    if (op2 === 'slider') {
      const m = (ix0 + ix1) / 2;
      pane(ix0, m + 1, iy0, iy1, zc + ext * 0.8, true);
      pane(m - 1, ix1, iy0, iy1, zc - ext * 0.8, true);
    } else if (op2 === 'double-hung') {
      const m = (iy0 + iy1) / 2;
      pane(ix0, ix1, m - 1, iy1, zc + ext * 0.8, true);
      pane(ix0, ix1, iy0, m + 1, zc - ext * 0.8, true);
    } else if (op2 === 'casement' || op2 === 'awning') {
      pane(ix0, ix1, iy0, iy1, zc, true);
      // operator handle on the interior side
      frameGeos.push(op2 === 'casement' ? box(0.8, 4, 1, ix1 - 3, (iy0 + iy1) / 2, zc - ext * 1.5) : box(4, 0.8, 1, (ix0 + ix1) / 2, iy0 + 3, zc - ext * 1.5));
    } else pane(ix0, ix1, iy0, iy1, zc, false);
    // muntins (simulated divided lites) on the exterior side of the glass
    const [nc, nr] = DIVISIONS[win.divisions || '1x1'] || [1, 1];
    const mw = 1.1;
    for (let i = 1; i < nc; i++) frameGeos.push(box(mw, ih, 0.8, ix0 + (iw * i) / nc, (iy0 + iy1) / 2, zc + ext * 0.5));
    for (let j = 1; j < nr; j++) frameGeos.push(box(iw, mw, 0.8, (ix0 + ix1) / 2, iy0 + (ih * j) / nr, zc + ext * 0.5));
    // exterior sill (sloped board projecting past the face) and interior stool, filling the reveal
    if (!op.arch && op.y0 > 1) {
      const zFrameExt = zc + (ext * fd) / 2;
      const zFrameInt = zc - (ext * fd) / 2;
      sillGeos.push(boxZ(w + 3, 1.25, zFrameExt, extFace + ext * 1.75, cx, op.y0 - 0.625));
      sillGeos.push(boxZ(w + 4, 0.9, zFrameInt, intFace - ext * 1.0, cx, op.y0 - 0.45));
    }
    if (win.trim !== false) {
      trimGeos.push(box(w + 4, 3.5, 1.5, cx, op.y1 + 1.75, extFace + ext * 0.75));
      trimGeos.push(box(1.75, h, 1, op.x0 - 0.9, op.y0 + h / 2, extFace + ext * 0.5), box(1.75, h, 1, op.x1 + 0.9, op.y0 + h / 2, extFace + ext * 0.5));
    }
    if (win.shutters) {
      const shG: Array<THREE.BufferGeometry | null> = [];
      const sw = Math.max(10, w / 2);
      shG.push(box(sw, h, 1.25, op.x0 - 2 - sw / 2, op.y0 + h / 2, extFace + ext * 0.9), box(sw, h, 1.25, op.x1 + 2 + sw / 2, op.y0 + h / 2, extFace + ext * 0.9));
      for (const xx of [op.x0 - 2 - sw / 2, op.x1 + 2 + sw / 2]) for (let k = 1; k < 8; k++) shG.push(box(sw - 3, 0.5, 0.5, xx, op.y0 + (h * k) / 8, extFace + ext * 1.6));
      push(mesh(mergeOrNull(shG), std('#1f4d3a', { roughness: 0.6 }, sel), id));
    }
    push(mesh(mergeOrNull(glassGeos), glassMat(sel), id, {}, false));
    push(mesh(mergeOrNull(frameGeos), std(fcol, { roughness: 0.45, metalness: win.frameMaterial === 'aluminum' ? 0.5 : 0 }, sel), id));
    push(mesh(mergeOrNull(sillGeos), std(sel ? '#fcd34d' : '#e7e5e4', { roughness: 0.6 }, sel), id));
  } else {
    const d = op.e as DoorEntity;
    const lay = doorLayout({ ...d, width: w, height: h });
    const kind = lay.kind;
    const fw = lay.frame;
    const X = (x: number) => op.x0 + x; // layout x → wall-local x
    const swingSide = d.swing.endsWith('in') ? 1 : -1;
    const faceZ = zc + (swingSide * fd) / 2;
    const metalMat = std('#1c1917', { metalness: 0.6, roughness: 0.4 }, sel);
    const metalGeos: Array<THREE.BufferGeometry | null> = [];
    const leafGlass: Array<THREE.BufferGeometry | null> = [];
    const woodLook = lay.style === 'plank' || lay.style === 'arched' || lay.style === 'carriage';
    const leafColor = sel ? '#fbbf24' : lay.style === 'sectional' || lay.style === 'roll-up' ? '#f1f0ee' : lay.style === 'glass' ? fcol : woodLook ? '#6f4a2c' : '#7c4a21';
    // ---- frame: jambs + head (an arch for arched doors), sidelight mullions, transom bar
    frameGeos.push(box(fw, h, fd, op.x0 + fw / 2, h / 2, zc), box(fw, h, fd, op.x1 - fw / 2, h / 2, zc));
    if (lay.arched) {
      const r = w / 2;
      const spring = h - r;
      for (let i = 0; i < 16; i++) {
        const t0 = (Math.PI * i) / 16;
        const t1 = (Math.PI * (i + 1)) / 16;
        const p0 = { x: cx + (r - fw / 2) * Math.cos(t0), y: spring + (r - fw / 2) * Math.sin(t0) };
        const p1 = { x: cx + (r - fw / 2) * Math.cos(t1), y: spring + (r - fw / 2) * Math.sin(t1) };
        const seg = box(Math.hypot(p1.x - p0.x, p1.y - p0.y) + 0.4, fw, fd, 0, 0, 0);
        if (seg) {
          seg.rotateZ(Math.atan2(p1.y - p0.y, p1.x - p0.x));
          seg.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, zc);
          frameGeos.push(seg);
        }
      }
    } else frameGeos.push(box(w, fw, fd, cx, h - fw / 2, zc));
    for (const sl of lay.sidelights) {
      const mx = sl.x0 <= fw + 1e-6 ? sl.x1 + fw / 2 : sl.x0 - fw / 2;
      frameGeos.push(box(fw, h, fd, X(mx), h / 2, zc));
      leafGlass.push(box(sl.x1 - sl.x0, lay.leafH - 12, 0.3, X((sl.x0 + sl.x1) / 2), 10 + (lay.leafH - 12) / 2, zc));
      frameGeos.push(box(sl.x1 - sl.x0, 10, 1.5, X((sl.x0 + sl.x1) / 2), 5, zc));
    }
    if (lay.transom) {
      frameGeos.push(box(w - 2 * fw, fw, fd, cx, lay.transom.y0 - fw / 2, zc));
      leafGlass.push(box(w - 2 * fw, lay.transom.y1 - lay.transom.y0, 0.3, cx, (lay.transom.y0 + lay.transom.y1) / 2, zc));
    }
    const lh = lay.leafH - 0.25;

    /** One leaf of a given style, built in local coords: x 0..lw from the hinge edge, y 0..lh, z = thickness. */
    const leafParts = (lw: number, lhh: number, dirX: 1 | -1, th = 1.75) => {
      const solid: Array<THREE.BufferGeometry | null> = [];
      const glassP: Array<THREE.BufferGeometry | null> = [];
      const metal: Array<THREE.BufferGeometry | null> = [];
      const Bx = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => box(bw, bh, bd, dirX * x, y, z);
      const st = Math.min(4.5, lw * 0.14);
      const frameRect = (x0: number, x1: number, y0: number, y1: number, rail = st) => {
        solid.push(Bx(x1 - x0, rail, th, (x0 + x1) / 2, y0 + rail / 2, 0), Bx(x1 - x0, rail, th, (x0 + x1) / 2, y1 - rail / 2, 0), Bx(rail, y1 - y0, th, x0 + rail / 2, (y0 + y1) / 2, 0), Bx(rail, y1 - y0, th, x1 - rail / 2, (y0 + y1) / 2, 0));
      };
      const lites = (x0: number, x1: number, y0: number, y1: number, c: number, r: number) => {
        glassP.push(Bx(x1 - x0, y1 - y0, 0.3, (x0 + x1) / 2, (y0 + y1) / 2, 0));
        for (let i = 1; i < c; i++) solid.push(Bx(1, y1 - y0, th * 0.6, x0 + ((x1 - x0) * i) / c, (y0 + y1) / 2, 0));
        for (let j = 1; j < r; j++) solid.push(Bx(x1 - x0, 1, th * 0.6, (x0 + x1) / 2, y0 + ((y1 - y0) * j) / r, 0));
      };
      switch (lay.style) {
        case 'six-panel': {
          solid.push(Bx(lw, lhh, th * 0.7, lw / 2, lhh / 2, 0));
          const cw = (lw - 3 * st) / 2;
          const rows = [0.22, 0.42, 0.22].map((f) => f * (lhh - 4 * st));
          let y = st;
          for (const rh of [rows[2], rows[1], rows[0]]) {
            for (const x of [st + cw / 2, 2 * st + cw * 1.5]) for (const zz of [th * 0.4, -th * 0.4]) solid.push(Bx(cw - 2, rh - 2, 0.35, x, y + rh / 2, zz));
            y += rh + st;
          }
          frameRect(0, lw, 0, lhh);
          break;
        }
        case 'craftsman': {
          const gy0 = lhh * 0.7;
          frameRect(0, lw, 0, lhh);
          solid.push(Bx(lw - 2 * st, gy0 - st, th, lw / 2, (st + gy0) / 2, 0));
          lites(st, lw - st, gy0, lhh - st, 3, 1);
          solid.push(Bx(lw - 2 * st + 2, 1.6, th + 1.2, lw / 2, gy0 - 1, 0)); // dentil shelf
          break;
        }
        case 'french':
        case 'glass': {
          const rail = lay.style === 'glass' ? Math.min(2.5, st) : st;
          frameRect(0, lw, 0, lhh, rail);
          const bottom = lay.style === 'glass' ? rail : rail * 2.2;
          if (lay.style !== 'glass') solid.push(Bx(lw - 2 * rail, bottom - rail, th, lw / 2, rail + (bottom - rail) / 2, 0));
          const [c, r] = lay.style === 'glass' ? [1, 1] : d.divisions && d.divisions !== '1x1' ? [DIVISIONS[d.divisions][0], DIVISIONS[d.divisions][1] + 2] : [2, 5];
          lites(rail, lw - rail, bottom, lhh - rail, c, r);
          break;
        }
        case 'plank':
        case 'arched': {
          const n = Math.max(3, Math.round(lw / 5.5));
          const bw = lw / n;
          for (let i = 0; i < n; i++) solid.push(Bx(bw - 0.3, lhh, th, bw * i + bw / 2, lhh / 2, 0));
          if (kind === 'barn' || kind === 'barn-bypass') {
            // Z brace on the face
            solid.push(Bx(lw - 2, 5, 0.9, lw / 2, lhh * 0.15, th / 2 + 0.45), Bx(lw - 2, 5, 0.9, lw / 2, lhh * 0.85, th / 2 + 0.45));
            const dg = box(Math.hypot(lw - 4, lhh * 0.7), 5, 0.9, 0, 0, 0);
            if (dg) {
              dg.rotateZ(Math.atan2(lhh * 0.7, (lw - 4) * dirX));
              dg.translate((dirX * lw) / 2, lhh / 2, th / 2 + 0.45);
              solid.push(dg);
            }
          } else {
            // black iron strap hinges (both faces) + clavos
            for (const y of [lhh * 0.16, lhh * 0.84]) for (const zz of [th / 2 + 0.15, -th / 2 - 0.15]) metal.push(Bx(lw * 0.62, 2, 0.25, (lw * 0.62) / 2, y, zz));
          }
          break;
        }
        case 'louvered': {
          frameRect(0, lw, 0, lhh, Math.min(3, st));
          for (let y = st + 1; y < lhh - st; y += 1.75) {
            const sl = Bx(lw - 2 * Math.min(3, st), 1.6, 0.35, lw / 2, y, 0);
            if (sl) {
              sl.rotateX(0.6);
              solid.push(sl);
            }
          }
          break;
        }
        case 'sectional':
        case 'roll-up':
        case 'carriage': {
          if (lay.style === 'roll-up') {
            for (let y = 1.5; y < lhh; y += 3) solid.push(Bx(lw, 2.8, th * 0.6, lw / 2, y, 0));
          } else if (lay.style === 'sectional') {
            for (let i = 0; i < 4; i++) {
              const y0 = (lhh * i) / 4 + 0.3;
              const y1 = (lhh * (i + 1)) / 4 - 0.3;
              solid.push(Bx(lw, y1 - y0, th, lw / 2, (y0 + y1) / 2, 0));
              const n = Math.max(2, Math.round(lw / 48));
              for (let j = 0; j < n; j++) for (const zz of [th / 2 + 0.2, -th / 2 - 0.2]) solid.push(Bx(lw / n - 6, y1 - y0 - 6, 0.4, (lw * (j + 0.5)) / n, (y0 + y1) / 2, zz));
            }
          } else {
            const gy = lhh * 0.75;
            solid.push(Bx(lw, gy, th, lw / 2, gy / 2, 0));
            for (const half of [0, 1]) {
              const hx0 = (lw / 2) * half;
              lites(hx0 + 3, hx0 + lw / 2 - 3, gy + 2, lhh - 3, 3, 1);
              solid.push(Bx(lw / 2, lhh - gy, th, hx0 + lw / 4, (gy + lhh) / 2 - 0.01, -th * 0.2));
              const dl = Math.hypot(lw / 2 - 6, gy - 6);
              for (const sgn of [1, -1]) {
                const xb = box(dl, 3.5, 0.8, 0, 0, 0);
                if (xb) {
                  xb.rotateZ(sgn * Math.atan2(gy - 6, lw / 2 - 6));
                  xb.translate(dirX * (hx0 + lw / 4), gy / 2, th / 2 + 0.4);
                  solid.push(xb);
                }
              }
              metal.push(Bx(lw * 0.15, 1.5, 0.3, hx0 + (half ? lw / 2 - lw * 0.075 - 2 : lw * 0.075 + 2), gy * 0.3, th / 2 + 0.9), Bx(lw * 0.15, 1.5, 0.3, hx0 + (half ? lw / 2 - lw * 0.075 - 2 : lw * 0.075 + 2), gy * 0.7, th / 2 + 0.9));
            }
          }
          break;
        }
        case 'pivot-slab':
          solid.push(Bx(lw, lhh, th * 1.3, lw / 2, lhh / 2, 0));
          metal.push(Bx(1.2, lhh * 0.6, 1.2, lw - 5, lhh / 2, th / 2 + 2.2), Bx(1.2, lhh * 0.6, 1.2, lw - 5, lhh / 2, -th / 2 - 2.2));
          break;
        default:
          solid.push(Bx(lw, lhh, th, lw / 2, lhh / 2, 0));
      }
      return { solid, glassP, metal };
    };
    const addLeaf = (parts: ReturnType<typeof leafParts>, place: (g: THREE.Group) => void, handleAt?: { x: number; y: number }, dirX: 1 | -1 = 1) => {
      const g = new THREE.Group();
      place(g);
      const lm = mesh(mergeOrNull(parts.solid), std(leafColor, { roughness: 0.6 }, sel), id);
      if (lm) g.add(lm), meshes.push(lm);
      const gm = mesh(mergeOrNull(parts.glassP), glassMat(sel), id, {}, false);
      if (gm) g.add(gm), meshes.push(gm);
      const mm = mesh(mergeOrNull(parts.metal), metalMat, id, {}, false);
      if (mm) g.add(mm);
      if (handleAt) {
        const plank = woodLook;
        const hm = mesh(
          mergeOrNull([box(plank ? 0.8 : 1, plank ? 8 : 1, 3.6, dirX * handleAt.x, handleAt.y, 0)]),
          std(plank ? '#1c1917' : '#d4af37', { metalness: 0.8, roughness: 0.3 }),
          id,
          {},
          false
        );
        if (hm) g.add(hm);
      }
      group.add(g);
    };
    const swingLeaf = (lf: { x0: number; x1: number; hinge: 'x0' | 'x1' | 'none' }, open = 0.35, y0 = 0, hh = lh) => {
      const lw = lf.x1 - lf.x0;
      const dirX: 1 | -1 = lf.hinge === 'x1' ? -1 : 1;
      const hingeX = X(lf.hinge === 'x1' ? lf.x1 : lf.x0);
      const parts = lay.arched ? archedLeaf(lw, hh, dirX) : leafParts(lw, hh, dirX);
      addLeaf(parts, (g) => {
        g.position.set(hingeX, y0, faceZ - swingSide * 0.9);
        g.rotation.y = -swingSide * dirX * open;
      }, { x: lw - 3, y: 36 - y0 }, dirX);
    };
    /** Arched-top timber leaf: planks clipped to the arch (extruded shape) + strap hinges. */
    const archedLeaf = (lw: number, hh: number, dirX: 1 | -1) => {
      const r = lw / 2;
      const spring = Math.max(r, h - fw - r);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(lw, 0);
      sh.lineTo(lw, spring);
      sh.absarc(r, spring, r, 0, Math.PI, false);
      sh.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 2, bevelEnabled: false, curveSegments: 16 });
      g.translate(0, 0, -1);
      if (dirX < 0) g.scale(-1, 1, 1);
      const metal: Array<THREE.BufferGeometry | null> = [];
      for (const y of [hh * 0.16, spring * 0.9]) for (const zz of [1.15, -1.15]) metal.push(box(lw * 0.62, 2, 0.25, (dirX * lw * 0.62) / 2, y, zz));
      metal.push(box(lw * 0.24, hh * 0.1, 0.4, dirX * lw * 0.5, spring * 0.78, 1.1)); // speakeasy grille
      return { solid: [g] as Array<THREE.BufferGeometry | null>, glassP: [] as Array<THREE.BufferGeometry | null>, metal };
    };

    switch (kind) {
      case 'sliding':
      case 'multislide':
        lay.leaves.forEach((lf, i) => {
          const z = zc + (lf.track || 0) * 0.9 * ext;
          // the last panel is shown slid partly open
          const shift = i === lay.leaves.length - 1 && i > 0 ? -(lf.x1 - lf.x0) * 0.35 : 0;
          addLeaf(leafParts(lf.x1 - lf.x0, lh, 1, 1.4), (g) => g.position.set(X(lf.x0) + shift, 0, z));
        });
        break;
      case 'pocket': {
        const lf = lay.leaves[0];
        const lw = lf.x1 - lf.x0;
        addLeaf(leafParts(lw, lh, 1, 1.4), (g) => g.position.set(X(lf.x0) - lw * 0.45, 0, zc), { x: lw - 2, y: 36 });
        break;
      }
      case 'barn':
      case 'barn-bypass': {
        const inn = -ext;
        lay.leaves.forEach((lf, i) => {
          const z = inn * (t / 2 + 1.6 + ((lf.track || 1) - 1) * 2.2);
          const shift = i === 0 ? -(lf.x1 - lf.x0) * 0.3 : 0;
          addLeaf(leafParts(lf.x1 - lf.x0, h + 1.5, 1, 1.75), (g) => g.position.set(X(lf.x0) + shift, 0.5, z));
        });
        // black steel track + rollers above the opening on the interior face
        const lx0 = Math.min(...lay.leaves.map((l) => l.x0));
        const lx1 = Math.max(...lay.leaves.map((l) => l.x1));
        metalGeos.push(box((lx1 - lx0) * 1.95, 1.5, 0.5, X(lx0 - (lx1 - lx0) * 0.45 + ((lx1 - lx0) * 1.95) / 2 - (lx1 - lx0) * 0.5), h + 4, inn * (t / 2 + 0.6)));
        for (const lf of lay.leaves) for (const xr of [lf.x0 + 6, lf.x1 - 6]) {
          const c = new THREE.CylinderGeometry(1.9, 1.9, 0.8, 14);
          c.rotateX(Math.PI / 2);
          c.translate(X(xr) + (lf === lay.leaves[0] ? -(lf.x1 - lf.x0) * 0.3 : 0), h + 3.5, inn * (t / 2 + 1.4));
          metalGeos.push(c);
        }
        break;
      }
      case 'bifold': {
        // accordion leaves folded part-way: alternate leaves turn about shared edges
        const th = 0.7;
        let px = X(lay.leaves[0].x0);
        let pz = faceZ;
        lay.leaves.forEach((lf, i) => {
          const lw = lf.x1 - lf.x0;
          const ang = i % 2 === 0 ? -swingSide * th : swingSide * th;
          const x0 = px;
          const z0 = pz;
          addLeaf(leafParts(lw, lh, 1, 1.4), (g) => {
            g.position.set(x0, 0, z0);
            g.rotation.y = ang;
          });
          px += lw * Math.cos(ang);
          pz -= lw * Math.sin(ang);
        });
        break;
      }
      case 'garage': {
        const lf = lay.leaves[0];
        addLeaf(leafParts(lf.x1 - lf.x0, lh, 1, 2), (g) => g.position.set(X(lf.x0), 0, zc));
        break;
      }
      case 'pivot': {
        const lf = lay.leaves[0];
        const lw = lf.x1 - lf.x0;
        const dirX: 1 | -1 = lf.hinge === 'x1' ? -1 : 1;
        const pv = X(lf.hinge === 'x1' ? lf.x1 - lw * 0.2 : lf.x0 + lw * 0.2);
        addLeaf(leafParts(lw, lh, dirX, 2.25), (g) => {
          // the slab turns about an offset pin: its local origin sits 0.2·lw behind the pivot
          g.position.set(pv, 0, zc);
          g.rotation.y = -swingSide * dirX * 0.5;
          g.children.forEach(() => undefined);
          g.translateX(-dirX * lw * 0.2);
        });
        metalGeos.push(box(1.2, 1.2, 1.2, pv, 0.6, zc), box(1.2, 1.2, 1.2, pv, lh, zc));
        break;
      }
      case 'dutch': {
        const lf = lay.leaves[0];
        swingLeaf(lf, 0.15, 0, lh * 0.5 - 0.3);
        swingLeaf(lf, 0.75, lh * 0.5 + 0.3, lh * 0.5 - 0.3);
        // shelf on the bottom leaf
        frameGeos.push(box(lf.x1 - lf.x0, 1.2, 5, X((lf.x0 + lf.x1) / 2), lh * 0.5, faceZ - swingSide * 3));
        break;
      }
      default:
        for (const lf of lay.leaves) swingLeaf(lf, kind === 'double' ? 0.3 : 0.35);
    }
    // cabin screen / storm door on the exterior face (light frame + see-through mesh)
    if (d.screenDoor && isSwingKind(kind)) {
      const lf = lay.leaves[0];
      const lw = lf.x1 - lf.x0;
      const dirX: 1 | -1 = lf.hinge === 'x1' ? -1 : 1;
      const g = new THREE.Group();
      g.position.set(X(lf.hinge === 'x1' ? lf.x1 : lf.x0), 0, ext * (t / 2 + 1.2));
      g.rotation.y = ext * dirX * 0.12;
      const fr = [box(2, lh, 1, (dirX * 2) / 2, lh / 2, 0), box(2, lh, 1, dirX * (lw - 1), lh / 2, 0), box(lw, 2.5, 1, (dirX * lw) / 2, lh - 1.25, 0), box(lw, 3.5, 1, (dirX * lw) / 2, 1.75, 0), box(lw, 3, 1, (dirX * lw) / 2, lh * 0.45, 0)];
      const fm = mesh(mergeOrNull(fr), std(sel ? '#fbbf24' : '#3f3a36', { roughness: 0.6 }, sel), id);
      if (fm) g.add(fm), meshes.push(fm);
      const meshG = box(lw - 4, lh - 6, 0.1, (dirX * lw) / 2, lh / 2, 0);
      const sm = mesh(meshG, new THREE.MeshStandardMaterial({ color: '#1c1917', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), id, {}, false);
      if (sm) g.add(sm);
      group.add(g);
    }
    // threshold
    sillGeos.push(boxZ(w, 0.75, zc - fd / 2 - 0.5, zc + fd / 2 + 0.5, cx, 0.375));
    if (d.trim !== false && kind !== 'garage') {
      for (const side of [1, -1]) {
        const face = side * (t / 2) + side * 0.5;
        if (lay.arched) {
          trimGeos.push(box(3.5, h - w / 2 + 2, 1, op.x0 - 1.75, (h - w / 2 + 2) / 2, face), box(3.5, h - w / 2 + 2, 1, op.x1 + 1.75, (h - w / 2 + 2) / 2, face));
        } else {
          trimGeos.push(box(3.5, h + 3.5, 1, op.x0 - 1.75, (h + 3.5) / 2, face), box(3.5, h + 3.5, 1, op.x1 + 1.75, (h + 3.5) / 2, face), box(w + 7, 3.5, 1, cx, h + 1.75, face));
        }
      }
    }
    push(mesh(mergeOrNull(leafGlass), glassMat(sel), id, {}, false));
    push(mesh(mergeOrNull(metalGeos), metalMat, id, {}, false));
    push(mesh(mergeOrNull(frameGeos), std(fcol, { roughness: 0.5, metalness: d.frameMaterial === 'aluminum' || d.frameMaterial === 'steel' ? 0.5 : 0 }, sel), id));
    push(mesh(mergeOrNull(sillGeos), std('#a8a29e', { roughness: 0.6 }, sel), id));
  }
  if (o.isExteriorWall || op.kind === 'door') push(mesh(mergeOrNull(trimGeos), std('#fafaf9', { roughness: 0.5 }, sel), id));
}

// ------------------------------------------------------------------------------------------
// SWEEPS / REVEALS, BALCONIES, RAILINGS
// ------------------------------------------------------------------------------------------

export function buildSweep3D(model: ArchModel, sw: SweepEntity, wall: WallEntity, sameLevelWalls: WallEntity[], selected: boolean, shadows: boolean): Built | null {
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (L < 1) return null;
  const prof = wallProfile(model, wall);
  const t = wall.thickness;
  const sg = wallExteriorSide(wall, sameLevelWalls) === 'left' ? 1 : -1;
  const group = new THREE.Group();
  group.position.set(wall.start.x, prof.baseZ, wall.start.y);
  group.rotation.y = -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  const size = Math.max(0.5, sw.size);
  let geo: THREE.BufferGeometry;
  let color = sw.color || '#f5f5f4';
  if (sw.profile === 'reveal' || sw.projection < 0) {
    geo = new THREE.BoxGeometry(L, size, 0.4);
    geo.translate(L / 2, sw.height + size / 2, sg * (t / 2 + 0.15));
    color = sw.color || '#3f3f46';
  } else {
    const p = Math.max(0.5, sw.projection);
    const pts: Array<[number, number]> =
      sw.profile === 'cornice'
        ? [[0, 0], [p * 0.35, 0], [p * 0.35, size * 0.25], [p * 0.7, size * 0.45], [p, size * 0.78], [p, size], [0, size]]
        : sw.profile === 'base'
        ? [[0, 0], [p, 0], [p, size * 0.72], [0, size]]
        : [[0, 0], [p, 0], [p, size], [0, size]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
    const m = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, sw.height, sg, 0, 0, sg * (t / 2 + 0.1), 0, 0, 0, 1);
    geo.applyMatrix4(m);
    geo.computeVertexNormals();
  }
  const mat = std(color, { roughness: 0.6, side: THREE.DoubleSide }, selected);
  const m = mesh(geo, mat, sw.id, {}, shadows);
  if (!m) return null;
  group.add(m);
  return { obj: group, meshes: [m] };
}

export function railingGeometry(path: Point[], z0: number, height: number, style: RailingStyle, spacing: number): { metal: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null } {
  const metal: Array<THREE.BufferGeometry | null> = [];
  const glass: Array<THREE.BufferGeometry | null> = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.5) continue;
    metal.push(segmentBox(a, b, 2.25, z0 + height - 1.5, 1.5));
    if (style === 'glass') {
      const g = segmentBox(a, b, 0.5, z0 + 3, height - 5);
      glass.push(g);
      metal.push(segmentBox(a, b, 1.5, z0 + 1, 2));
    } else {
      metal.push(segmentBox(a, b, 1.5, z0 + 3, 1.25));
      const n = Math.max(1, Math.floor(L / Math.max(2, spacing)));
      for (let k = 1; k < n; k++) {
        const f = k / n;
        const c = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        const bb = new THREE.BoxGeometry(0.75, height - 4.5, 0.75);
        bb.translate(c.x, z0 + 3 + (height - 4.5) / 2, c.y);
        metal.push(bb);
      }
    }
  }
  for (const p of path) {
    const post = new THREE.BoxGeometry(2.5, height, 2.5);
    post.translate(p.x, z0 + height / 2, p.y);
    metal.push(post);
  }
  return { metal: mergeOrNull(metal), glass: mergeOrNull(glass) };
}

export function buildRailing3D(id: string, path: Point[], z0: number, height: number, style: RailingStyle, spacing: number, selected: boolean, shadows: boolean): THREE.Mesh[] {
  const { metal, glass } = railingGeometry(path, z0, height, style, spacing);
  const out: THREE.Mesh[] = [];
  const m = mesh(metal, std('#27272a', { metalness: 0.6, roughness: 0.35 }, selected), id, {}, shadows);
  if (m) out.push(m);
  const g = mesh(glass, glassMat(selected, 0xbae6fd), id, {}, false);
  if (g) out.push(g);
  return out;
}

export function buildBalcony3D(bc: BalconyEntity, wall: WallEntity, sameLevelWalls: WallEntity[], levelElev: number, selected: boolean, shadows: boolean): Built | null {
  const bp = balconyPlan(wall, bc, sameLevelWalls);
  if (bp.slab.length < 3) return null;
  const group = new THREE.Group();
  const meshes: THREE.Object3D[] = [];
  const top = levelElev + bc.elevationOffset;
  const shape = new THREE.Shape(bp.slab.map((p) => new THREE.Vector2(p.x, p.y)));
  const sg = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2, bc.slabThickness), bevelEnabled: false });
  sg.rotateX(Math.PI / 2);
  sg.translate(0, top, 0);
  const slab = mesh(sg, std('#d6d3d1', { roughness: 0.7 }, selected), bc.id, {}, shadows);
  if (slab) group.add(slab), meshes.push(slab);
  for (const m of buildRailing3D(bc.id, bp.railing, top, bc.railingHeight, bc.railingStyle, 4, selected, shadows)) {
    group.add(m);
    meshes.push(m);
  }
  return { obj: group, meshes };
}
