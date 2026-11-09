/**
 * Parametric 3D models for the component library (componentLibrary.ts). Local frame: x = width
 * (−w/2…w/2), z = depth (plan +y = front), y = up from the floor. The caller positions / rotates.
 */
import * as THREE from 'three';

export interface LibBuildOpts {
  selected: boolean;
  shadows: boolean;
  /** height above the component's base that a chimney / flue must reach (through the roof) */
  chimneyTop?: number;
  /** height of the ceiling above the base (for hung chandeliers) */
  ceiling?: number;
}

const SEL = 0xf59e0b;

export function buildLibrary3D(kind: string, w: number, d: number, h: number, color: string, o: LibBuildOpts): { group: THREE.Group; meshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const mat = (c: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.02, emissive: o.selected ? SEL : 0x000000, emissiveIntensity: o.selected ? 0.28 : 0, ...extra });
  const M = {
    base: mat(color),
    wood: mat('#8a5a33', { roughness: 0.8 }),
    darkWood: mat('#5b3a22', { roughness: 0.85 }),
    log: mat('#b07a4e', { roughness: 0.9 }),
    stone: mat('#9c9083', { roughness: 0.95 }),
    stoneDark: mat('#6f675f', { roughness: 0.95 }),
    iron: mat('#1f1f1f', { metalness: 0.6, roughness: 0.45 }),
    leather: mat('#6b3f24', { roughness: 0.55 }),
    white: mat('#f8fafc', { roughness: 0.25 }),
    porcelain: mat('#f1f5f9', { roughness: 0.15, metalness: 0.05 }),
    steel: mat('#c7ccd1', { metalness: 0.75, roughness: 0.3 }),
    copper: mat('#b8733a', { metalness: 0.7, roughness: 0.35 }),
    antler: mat('#e3d6bd', { roughness: 0.7 }),
    fire: mat('#f97316', { emissive: 0xf97316, emissiveIntensity: 0.6 }),
    foliage: mat(color, { roughness: 0.9 }),
    bark: mat('#5b4636', { roughness: 0.95 }),
    birch: mat('#ece8df', { roughness: 0.8 }),
    cushion: mat(color, { roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe3f5, transparent: true, opacity: 0.28, roughness: 0.03, metalness: 0.2, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  };
  const put = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = o.shadows && m !== M.glass;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const B = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material, ry = 0) => put(new THREE.BoxGeometry(Math.max(0.1, bw), Math.max(0.1, bh), Math.max(0.1, bd)), m, x, y, z, ry);
  const C = (r0: number, r1: number, ch: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, rx = 0, rz = 0) => put(new THREE.CylinderGeometry(r0, r1, ch, seg), m, x, y, z, 0, rx, rz);
  /** horizontal cylinder (log) along x */
  const LX = (r: number, l: number, x: number, y: number, z: number, m: THREE.Material) => put(new THREE.CylinderGeometry(r, r, l, 12), m, x, y, z, 0, 0, Math.PI / 2);
  /** horizontal cylinder along z */
  const LZ = (r: number, l: number, x: number, y: number, z: number, m: THREE.Material) => put(new THREE.CylinderGeometry(r, r, l, 12), m, x, y, z, 0, Math.PI / 2, 0);
  const S = (r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) => {
    const g = new THREE.SphereGeometry(r, 16, 12);
    g.scale(sx, sy, sz);
    return put(g, m, x, y, z);
  };
  /** a member between two 3D points (rectangular) */
  const strut = (a: THREE.Vector3, b: THREE.Vector3, bw: number, bd: number, m: THREE.Material) => {
    const dv = new THREE.Vector3().subVectors(b, a);
    const L = dv.length();
    if (L < 0.1) return;
    const g = new THREE.BoxGeometry(bw, L, bd);
    const mesh = put(g, m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
  };
  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const hw = w / 2;
  const hd = d / 2;

  switch (kind) {
    // ------------------------------------------------------------------ CABIN & LIVING
    case 'fireplace-stone': {
      // stone mass with firebox, raised hearth, timber mantel and a stone chimney through the roof
      B(w, h, d, 0, h / 2, -hd * 0.1, M.stone);
      for (let y = 6; y < h; y += 7) B(w + 0.4, 0.6, d + 0.4, 0, y, -hd * 0.1, M.stoneDark);
      B(w * 0.5, h * 0.35, 2, 0, 18 + h * 0.175, hd * 0.8 - 1, mat('#1c1917'));
      put(new THREE.ConeGeometry(4, 9, 8), M.fire, 0, 18 + 4.5, hd * 0.6);
      LX(2, w * 0.35, 0, 20, hd * 0.6, M.darkWood);
      B(w + 12, 14, 18, 0, 7, hd + 9 - hd * 0.1, M.stoneDark); // raised hearth
      B(w * 0.85, 5, 8, 0, 18 + h * 0.35 + 6, hd * 0.95, M.wood); // mantel
      const top = Math.max(h + 24, o.chimneyTop ?? h + 72);
      B(w * 0.45, top - h, d * 0.7, 0, h + (top - h) / 2, -hd * 0.25, M.stone);
      for (let y = h + 7; y < top; y += 7) B(w * 0.45 + 0.4, 0.6, d * 0.7 + 0.4, 0, y, -hd * 0.25, M.stoneDark);
      B(w * 0.52, 3, d * 0.8, 0, top + 1.5, -hd * 0.25, M.stoneDark);
      break;
    }
    case 'woodstove': {
      B(w, h * 0.7, d, 0, 6 + (h * 0.7) / 2, 0, M.iron);
      B(w + 2, 1.5, d + 2, 0, 6 + h * 0.7 + 0.75, 0, M.iron);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C(1.2, 1.2, 6, sx * (hw - 2), 3, sz * (hd - 2), M.iron, 8);
      B(w * 0.5, h * 0.35, 0.5, 0, 6 + h * 0.35, hd + 0.3, M.fire);
      B(w * 0.6, h * 0.45, 0.6, 0, 6 + h * 0.35, hd + 0.6, M.glass);
      const top = Math.max(h + 30, o.chimneyTop ?? h + 72);
      C(3.2, 3.2, top - h * 0.75, 0, h * 0.75 + (top - h * 0.75) / 2, -hd * 0.3, M.iron, 16);
      put(new THREE.ConeGeometry(6, 5, 16), M.iron, 0, top + 2, -hd * 0.3);
      // stone heat shield / hearth pad
      B(w + 24, 1.5, d + 24, 0, 0.75, 0, M.stone);
      break;
    }
    case 'chandelier-antler':
    case 'chandelier-iron': {
      const ceil = o.ceiling ?? 108;
      const drop = Math.min(ceil - 20, ceil - h);
      C(0.4, 0.4, ceil - drop - h * 0.5, 0, ceil - (ceil - drop - h * 0.5) / 2, 0, M.iron, 6);
      const cy = drop + h * 0.45;
      if (kind === 'chandelier-iron') {
        put(new THREE.TorusGeometry(hw * 0.95, 0.7, 8, 36), M.iron, 0, cy, 0, 0, Math.PI / 2);
        put(new THREE.TorusGeometry(hw * 0.55, 0.6, 8, 28), M.iron, 0, cy + h * 0.25, 0, 0, Math.PI / 2);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const x = hw * 0.95 * Math.cos(a);
          const z = hw * 0.95 * Math.sin(a);
          C(0.8, 0.8, 4, x, cy + 2, z, M.white, 8);
          S(0.8, x, cy + 4.6, z, M.fire);
          strut(V3(0, cy + h * 0.45, 0), V3(x, cy, z), 0.5, 0.5, M.iron);
        }
      } else {
        S(3, 0, cy, 0, M.antler);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const p0 = V3(0, cy, 0);
          const p1 = V3(hw * 0.55 * Math.cos(a), cy + 3, hw * 0.55 * Math.sin(a));
          const p2 = V3(hw * Math.cos(a), cy + h * 0.35, hw * Math.sin(a));
          strut(p0, p1, 1.4, 1.4, M.antler);
          strut(p1, p2, 1.1, 1.1, M.antler);
          strut(p1, V3(hw * 0.75 * Math.cos(a + 0.3), cy + h * 0.45, hw * 0.75 * Math.sin(a + 0.3)), 0.8, 0.8, M.antler);
          C(0.7, 0.7, 3.5, p2.x, p2.y + 1.5, p2.z, M.white, 8);
          S(0.7, p2.x, p2.y + 3.8, p2.z, M.fire);
        }
      }
      break;
    }
    case 'table-liveedge': {
      // irregular slab top (extruded wavy outline) on trestle legs
      const sh = new THREE.Shape();
      const pts: Array<[number, number]> = [[-hw, -hd + 2], [-hw * 0.5, -hd], [0, -hd + 3], [hw * 0.5, -hd + 1], [hw, -hd + 3], [hw, hd - 2], [hw * 0.4, hd], [-hw * 0.3, hd - 3], [-hw, hd - 1]];
      sh.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 2.5, bevelEnabled: true, bevelSize: 0.4, bevelThickness: 0.4, bevelSegments: 2 });
      g.rotateX(Math.PI / 2);
      put(g, M.base, 0, h, 0);
      for (const sx of [-1, 1]) {
        B(4, h - 3, d * 0.7, sx * (hw - 12), (h - 3) / 2, 0, M.iron);
        B(4, 2, d * 0.75, sx * (hw - 12), 1, 0, M.iron);
      }
      // benches
      for (const sz of [-1, 1]) {
        B(w - 24, 2, 12, 0, 17, sz * (hd + 9), M.wood);
        for (const sx of [-1, 1]) B(3, 16, 10, sx * (hw - 18), 8, sz * (hd + 9), M.wood);
      }
      break;
    }
    case 'sofa-leather':
    case 'armchair-log': {
      // log frame + leather cushions
      const seatH = h * 0.45;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(2.4, 2.4, seatH + 4, sx * (hw - 2.5), (seatH + 4) / 2, sz * (hd - 2.5), M.log, 10);
      LX(2.4, w, 0, seatH - 6, -hd + 2.5, M.log);
      LX(2.4, w, 0, seatH - 6, hd - 2.5, M.log);
      for (const sx of [-1, 1]) LZ(2.4, d, sx * (hw - 2.5), seatH + 4, 0, M.log);
      LX(2.6, w, 0, h - 2.6, -hd + 2.5, M.log);
      for (const sx of [-1, 1]) C(2.4, 2.4, h, sx * (hw - 2.5), h / 2, -hd + 2.5, M.log, 10);
      const nSeat = kind === 'sofa-leather' ? 3 : 1;
      const cw = (w - 10) / nSeat;
      for (let i = 0; i < nSeat; i++) {
        const cx = -hw + 5 + cw * (i + 0.5);
        B(cw - 1, 6, d - 12, cx, seatH, 2, M.leather);
        B(cw - 1, h * 0.45, 6, cx, seatH + h * 0.25, -hd + 7, M.leather);
      }
      break;
    }
    case 'bunkbed': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(3.5, h, 3.5, sx * (hw - 1.75), h / 2, sz * (hd - 1.75), M.wood);
      for (const y of [12, h * 0.6]) {
        B(w - 3, 2, d - 3, 0, y, 0, M.wood);
        B(w - 5, 6, d - 6, 0, y + 4, 0, M.white);
        B(w - 10, 3, 14, 0, y + 8.5, -hd + 10, mat('#cbd5e1'));
        B(w - 3, 4, 1.5, 0, y + 6, hd - 1, M.wood);
      }
      B(w - 3, 6, 1.5, 0, h - 6, hd - 1, M.wood);
      // ladder
      for (const sz of [hd - 20, hd - 6]) B(1.5, h * 0.75, 2, hw + 1.5, h * 0.375, sz - hd, M.wood);
      for (let y = 10; y < h * 0.7; y += 11) B(1.5, 1.2, 14, hw + 1.5, y, -hd + 13 + 0, M.wood);
      break;
    }
    case 'windowseat': {
      B(w, h - 3, d, 0, (h - 3) / 2, 0, M.base);
      for (const x of [-w / 3, 0, w / 3]) B(w / 3 - 3, (h - 3) * 0.6, 0.5, x, (h - 3) / 2, hd + 0.25, M.wood);
      B(w, 4, d, 0, h - 1, 0, mat('#5f6f52', { roughness: 0.9 }));
      for (const x of [-w / 3, 0, w / 3]) B(w / 3 - 4, 10, 4, x, h + 5, -hd + 3, mat('#b45309', { roughness: 0.9 }));
      break;
    }
    case 'bookcase': {
      B(w, h, 1, 0, h / 2, -hd + 0.5, M.base);
      for (const sx of [-1, 1]) B(1.25, h, d, sx * (hw - 0.6), h / 2, 0, M.base);
      const n = 6;
      for (let i = 0; i <= n; i++) B(w - 2.5, 1, d, 0, (i * (h - 1)) / n + 0.5, 0, M.base);
      // books
      for (let i = 0; i < n; i++) {
        let x = -hw + 2;
        let k = 0;
        while (x < hw - 4) {
          const bw = 1 + ((k * 7) % 5) * 0.3;
          const bh = (h / n) * (0.6 + ((k * 13) % 7) * 0.04);
          B(bw, bh, d * 0.7, x + bw / 2, (i * (h - 1)) / n + 1 + bh / 2, 0, mat(['#7f1d1d', '#1e3a5f', '#365314', '#78350f', '#57534e'][k % 5]));
          x += bw + 0.15;
          k++;
        }
      }
      break;
    }
    // ------------------------------------------------------------------ KITCHEN & BATH
    case 'sink-farmhouse': {
      B(w, h - 1.5, d - 1, 0, (h - 1.5) / 2, -0.5, M.base);
      B(w + 1, 1.5, d + 1, 0, h - 0.75, 0, mat('#78716c', { roughness: 0.3 }));
      B(w - 4, 10, 2, 0, h - 6, hd, M.porcelain); // apron front
      B(w - 6, 8, d - 8, 0, h - 5, 1, M.porcelain);
      C(0.6, 0.6, 12, 0, h + 6, -hd + 3, M.steel, 10);
      LZ(0.5, 8, 0, h + 12, -hd + 7, M.steel);
      break;
    }
    case 'island-butcher': {
      B(w, h - 1.75, d, 0, (h - 1.75) / 2, 0, M.base);
      for (const x of [-w / 3, 0, w / 3]) B(w / 3 - 3, h - 10, 0.5, x, (h - 1.75) / 2, hd + 0.25, mat('#2f4a39'));
      B(w + 3, 1.75, d + 14, 0, h - 0.875, 6, mat('#c8955a', { roughness: 0.7 }));
      for (let x = -hw; x < hw; x += 2) B(0.08, 1.8, d + 14, x, h - 0.85, 6, mat('#a8743f'));
      for (const x of [-w / 3, 0, w / 3]) {
        C(7, 7, 1.5, x, 26, hd + 16, M.wood, 16);
        C(0.9, 0.9, 25, x, 12.5, hd + 16, M.iron, 8);
      }
      break;
    }
    case 'hood-copper':
    case 'hood-timber':
    case 'hood-stainless': {
      const m = kind === 'hood-copper' ? M.copper : kind === 'hood-stainless' ? M.steel : M.base;
      const base = 66; // bottom of the hood above the floor
      const g = new THREE.CylinderGeometry(w * 0.2, w * 0.68, h * 0.55, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, (d / w) * 1.0);
      put(g, m, 0, base + h * 0.275, 0);
      B(w * 0.36, h * 0.45 + 30, d * 0.45, 0, base + h * 0.55 + (h * 0.45 + 30) / 2, -hd * 0.3, m);
      if (kind === 'hood-timber') B(w + 4, 5, d * 0.55, 0, base + 2, hd * 0.25, M.darkWood);
      break;
    }
    case 'tub-clawfoot': {
      const g = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
      g.scale(hw - 1, h * 0.7, hd - 1);
      const outer = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      outer.scale(hw, h * 0.75, hd);
      outer.rotateX(Math.PI);
      put(outer, M.porcelain, 0, h, 0);
      put(new THREE.TorusGeometry(1, 0.06, 8, 48), M.porcelain, 0, h, 0, 0, Math.PI / 2).scale.set(hw, hd, 1);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) S(1.8, sx * (hw - 7), 3, sz * (hd - 5), mat('#b88a2a', { metalness: 0.7, roughness: 0.3 }));
      C(0.6, 0.6, 8, -hw + 4, h + 4, 0, mat('#b88a2a', { metalness: 0.7, roughness: 0.3 }), 8);
      void g;
      break;
    }
    case 'tub-soaking': {
      const outer = new THREE.CylinderGeometry(1, 0.85, h, 40, 1);
      outer.scale(hw, 1, hd);
      put(outer, M.porcelain, 0, h / 2, 0);
      const inner = new THREE.CylinderGeometry(1, 0.9, 1, 40, 1);
      inner.scale(hw - 3, 1, hd - 3);
      put(inner, mat('#dbeafe', { roughness: 0.1 }), 0, h - 0.4, 0);
      C(0.6, 0.6, 34, -hw - 4, 17, 0, M.steel, 8);
      break;
    }
    case 'shower-glass': {
      B(w, 2, d, 0, 1, 0, mat('#e5e7eb', { roughness: 0.4 }));
      B(w, h, 2, 0, h / 2, -hd + 1, mat('#cbd5e1', { roughness: 0.5 })); // tiled back wall
      for (let y = 6; y < h; y += 6) B(w, 0.15, 0.1, 0, y, -hd + 2.05, mat('#94a3b8'));
      B(0.4, h - 4, d - 2, hw - 0.2, h / 2 + 1, 1, M.glass);
      B(w * 0.6, h - 4, 0.4, hw - w * 0.3, h / 2 + 1, hd - 0.2, M.glass);
      C(4, 4, 0.5, 0, h - 6, -hd + 8, M.steel, 20);
      C(0.4, 0.4, 7, 0, h - 3, -hd + 5, M.steel, 8, Math.PI / 2);
      break;
    }
    case 'vanity-double': {
      B(w, h - 1.5, d, 0, (h - 1.5) / 2, 0, M.base);
      B(w + 1, 1.5, d + 1, 0, h - 0.75, 0, mat('#e7e5e4', { roughness: 0.2 }));
      for (const sx of [-1, 1]) {
        const s = new THREE.CylinderGeometry(1, 1, 4, 24);
        s.scale(7, 1, 5.5);
        put(s, M.porcelain, sx * w * 0.25, h + 1.5, 1);
        C(0.5, 0.5, 8, sx * w * 0.25, h + 4, -hd + 3, M.steel, 8);
        B(20, 28, 1, sx * w * 0.25, h + 26, -hd - 0.5, mat('#e0f2fe', { metalness: 0.9, roughness: 0.05 }));
      }
      break;
    }
    case 'sauna': {
      const cedar = mat('#d9b77e', { roughness: 0.85 });
      B(w, h, 1, 0, h / 2, -hd + 0.5, cedar);
      for (let y = 4; y < h; y += 4) B(w, 0.15, 0.2, 0, y, -hd + 1.05, mat('#b8935c'));
      // two-tier bench
      B(w, 2, 20, 0, 18, -hd + 10, cedar);
      B(w, 2, 18, 0, 38, -hd + 9, cedar);
      B(w, 18, 1.5, 0, 9, -hd + 20, cedar);
      B(w, 20, 1.5, 0, 28, -hd + 19, cedar);
      // heater with stones
      B(18, 26, 18, hw - 11, 13, hd - 11, M.iron);
      for (let i = 0; i < 14; i++) S(2.2, hw - 18 + (i % 4) * 4.2, 27 + Math.floor(i / 4) * 1.5, hd - 17 + ((i * 3) % 4) * 3.5, M.stoneDark);
      C(5, 5, 9, -hw + 8, 4.5, hd - 8, M.wood, 16); // bucket
      break;
    }
    // ------------------------------------------------------------------ STAIRS, PORCHES & SITE
    case 'stair-straight':
    case 'stair-splitlog': {
      const n = Math.max(8, Math.round(h / 7));
      const rh = h / n;
      const run = d / n;
      for (let i = 0; i < n; i++) {
        const z = hd - run * (i + 0.5);
        const y = rh * (i + 1);
        if (kind === 'stair-splitlog') {
          const g = new THREE.CylinderGeometry(run * 0.6, run * 0.6, w, 12, 1, false, 0, Math.PI);
          g.rotateZ(Math.PI / 2);
          put(g, M.log, 0, y - rh * 0.1, z);
        } else B(w, 1.5, run + 1, 0, y - 0.75, z, M.base);
      }
      // stringers
      const ang = Math.atan2(h, d);
      for (const sx of [-1, 1]) {
        const g = new THREE.BoxGeometry(2, 10, Math.hypot(h, d));
        const m2 = put(g, kind === 'stair-splitlog' ? M.log : M.wood, sx * (hw - 1), h / 2 - 4, 0);
        m2.rotation.x = ang;
      }
      // handrail (log on posts for the split-log stair)
      const rail = kind === 'stair-splitlog' ? M.log : M.iron;
      strut(V3(-hw - 2, 36, hd), V3(-hw - 2, h + 36, -hd), kind === 'stair-splitlog' ? 3.5 : 1.5, kind === 'stair-splitlog' ? 3.5 : 1.5, rail);
      for (const t of [0, 0.5, 1]) C(kind === 'stair-splitlog' ? 2.2 : 0.6, kind === 'stair-splitlog' ? 2.2 : 0.6, 36, -hw - 2, h * t + 18, hd - d * t, rail, 8);
      break;
    }
    case 'stair-l':
    case 'stair-u': {
      const tw = 36;
      const half = h / 2;
      const n = Math.max(6, Math.round(half / 7));
      const rh = half / n;
      // first flight (+z → −z on the left), landing, second flight
      for (let i = 0; i < n; i++) B(tw, 1.5, 10, -hw + tw / 2, rh * (i + 1), hd - 5 - i * 10, M.base);
      const landZ = hd - n * 10 - tw / 2;
      B(tw, 2, tw, -hw + tw / 2, half, landZ, M.base);
      if (kind === 'stair-l') {
        for (let i = 0; i < n; i++) B(10, 1.5, tw, -hw + tw + 5 + i * 10, half + rh * (i + 1), landZ, M.base);
      } else {
        B(w, 2, tw, 0, half, landZ, M.base);
        for (let i = 0; i < n; i++) B(tw, 1.5, 10, hw - tw / 2, half + rh * (i + 1), landZ + tw / 2 + 5 + i * 10, M.base);
      }
      C(2, 2, half, -hw + tw / 2, half / 2, landZ, M.wood, 8);
      break;
    }
    case 'stair-spiral': {
      const n = Math.max(12, Math.round(h / 7.5));
      C(2, 2, h + 36, 0, (h + 36) / 2, 0, M.iron, 12);
      for (let i = 0; i < n; i++) {
        const a = (i * 2 * Math.PI * 1.1) / n;
        const sh = new THREE.Shape();
        sh.moveTo(0, 0);
        sh.absarc(0, 0, hw, -0.25, 0.25, false);
        sh.lineTo(0, 0);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 1.5, bevelEnabled: false, curveSegments: 6 });
        g.rotateX(-Math.PI / 2);
        put(g, M.base, 0, (h * (i + 1)) / n - 1.5, 0, -a);
        const px = (hw - 1) * Math.cos(a);
        const pz = -(hw - 1) * Math.sin(a);
        C(0.5, 0.5, 34, px, (h * (i + 1)) / n + 17, pz, M.iron, 6);
      }
      break;
    }
    case 'porch-post': {
      C(hw * 0.95, hw, h, 0, h / 2, 0, M.log, 14);
      for (let i = 0; i < 5; i++) put(new THREE.TorusGeometry(hw * 0.97, 0.15, 6, 20), mat('#7a5332'), 0, 10 + i * (h / 5), 0, 0, Math.PI / 2);
      B(w + 4, 2, d + 4, 0, 1, 0, M.stoneDark);
      break;
    }
    case 'railing-branch':
    case 'railing-cable':
    case 'railing-picket': {
      const post = kind === 'railing-branch' ? M.log : kind === 'railing-cable' ? M.steel : M.white;
      for (const sx of [-1, 1]) kind === 'railing-branch' ? C(2.5, 2.8, h, sx * (hw - 2.5), h / 2, 0, post, 10) : B(4, h, 4, sx * (hw - 2), h / 2, 0, post);
      if (kind === 'railing-branch') {
        LX(2, w, 0, h - 2, 0, M.log);
        LX(1.6, w, 0, 4, 0, M.log);
        // crooked branch infill: two crossing branches
        strut(V3(-hw + 4, 5, 0), V3(hw - 4, h - 4, 0), 2, 2, M.log);
        strut(V3(-hw + 4, h - 4, 0), V3(hw - 4, 5, 0), 2, 2, M.log);
        strut(V3(-hw * 0.4, 5, 0), V3(-hw * 0.1, h - 4, 0), 1.4, 1.4, M.log);
      } else if (kind === 'railing-cable') {
        B(w, 1.5, 3.5, 0, h - 0.75, 0, M.wood);
        for (let y = 4; y < h - 3; y += 3.5) LX(0.12, w - 4, 0, y, 0, M.steel);
      } else {
        B(w, 2.5, 3.5, 0, h - 1.25, 0, M.white);
        B(w, 2.5, 3.5, 0, 4, 0, M.white);
        for (let x = -hw + 6; x < hw - 4; x += 5) B(1.5, h - 8, 1.5, x, h / 2 + 0.5, 0, M.white);
      }
      break;
    }
    case 'pergola': {
      const px = hw - 10;
      const pz = hd - 10;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B(6, h, 6, sx * px, h / 2, sz * pz, M.base);
      for (const sz of [-1, 1]) B(w, 9, 3.5, 0, h - 4.5, sz * pz, M.base);
      for (let i = 0; i < 9; i++) B(2, 7, d, -px + (2 * px * i) / 8, h + 3.5, 0, M.base);
      for (let i = 0; i < 12; i++) B(w - 10, 1.5, 1.5, 0, h + 7.75, -pz + (2 * pz * i) / 11, M.base);
      // knee braces
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(V3(sx * px, h - 30, sz * pz), V3(sx * (px - 22), h - 9, sz * pz), 3.5, 3.5, M.base);
      break;
    }
    case 'pavilion': {
      const px = hw - 18;
      const pz = hd - 18;
      const eave = h * 0.55;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        B(8, eave, 8, sx * px, eave / 2, sz * pz, M.base);
        B(16, 6, 16, sx * px, 3, sz * pz, M.stoneDark);
        strut(V3(sx * px, eave - 28, sz * pz), V3(sx * px, eave - 4, sz * (pz - 24)), 4, 4, M.base);
      }
      for (const sx of [-1, 1]) B(10, 12, d - 20, sx * px, eave + 6, 0, M.base);
      for (const sz of [-1, 1]) B(w - 20, 12, 10, 0, eave + 6, sz * pz, M.base);
      // gable roof along x (ridge parallel to the width)
      const rise = h - eave - 12;
      const slopeL = Math.hypot(hd + 12, rise);
      const ang = Math.atan2(rise, hd + 12);
      for (const sz of [-1, 1]) {
        const g = new THREE.BoxGeometry(w + 24, 4, slopeL);
        const m2 = put(g, mat('#4b5563', { roughness: 0.6 }), 0, eave + 12 + rise / 2, sz * ((hd + 12) / 2));
        m2.rotation.x = sz * ang;
      }
      B(w + 24, 6, 6, 0, h, 0, M.base); // ridge beam
      // king-post trusses at each end
      for (const sx of [-1, 1]) {
        strut(V3(sx * px, eave + 12, -pz), V3(sx * px, eave + 12, pz), 5, 7, M.base);
        strut(V3(sx * px, eave + 12, 0), V3(sx * px, h - 3, 0), 5, 5, M.base);
      }
      break;
    }
    case 'adirondack': {
      const paint = M.base;
      for (let i = 0; i < 5; i++) {
        const x = -hw + 4 + (i * (w - 8)) / 4;
        strut(V3(x, 14, 0), V3(x, h, -hd - 2), 3, 0.75, paint);
      }
      for (let i = 0; i < 6; i++) B(w - 6, 0.75, 3, 0, 14 - i * 0.5, -6 + i * 3.5, paint);
      for (const sx of [-1, 1]) {
        B(5, 0.75, d * 0.75, sx * (hw - 2), 24, 1, paint);
        strut(V3(sx * (hw - 4), 0, hd - 4), V3(sx * (hw - 4), 24, hd - 4), 3, 1.5, paint);
        strut(V3(sx * (hw - 6), 0, -hd + 8), V3(sx * (hw - 6), 16, hd - 6), 3, 1.5, paint);
      }
      break;
    }
    case 'firepit': {
      // stone ring pit + fire + curved stone seat walls
      const ring = new THREE.CylinderGeometry(20, 21, 14, 24, 1, true);
      put(ring, M.stone, 0, 7, 0);
      put(new THREE.TorusGeometry(20.5, 1.8, 8, 24), M.stoneDark, 0, 14, 0, 0, Math.PI / 2);
      put(new THREE.ConeGeometry(7, 12, 8), M.fire, 0, 8, 0);
      for (let i = 0; i < 4; i++) LX(1.5, 14, 0, 3, 0, M.darkWood).rotation.y = (i * Math.PI) / 4;
      for (const [a0, a1] of [[0.35, 2.8], [3.5, 5.95]]) {
        const n = 10;
        for (let i = 0; i < n; i++) {
          const a = a0 + ((a1 - a0) * (i + 0.5)) / n;
          const r = hw - 8;
          B(((a1 - a0) / n) * r + 0.5, h, 16, r * Math.cos(a), h / 2, r * Math.sin(a), M.stone, -a + Math.PI / 2);
        }
      }
      break;
    }
    case 'firewood': {
      B(w, 2, d, 0, 1, 0, M.iron);
      for (const sx of [-1, 1]) B(2, h, d, sx * (hw - 1), h / 2, 0, M.iron);
      B(w, 1.5, d + 6, 0, h + 0.75, 0, mat('#4b5563'));
      const r = 3;
      for (let row = 0; row * 2 * r * 0.95 + r + 2 < h - 2; row++) {
        for (let x = -hw + 3 + (row % 2 ? r : 0); x < hw - 3; x += 2 * r) LZ(r * (0.85 + ((row * 7 + Math.round(x)) % 5) * 0.04), d - 2, x, 2 + r + row * 2 * r * 0.95, 0, (row + Math.round(x)) % 3 ? M.wood : M.darkWood);
      }
      break;
    }
    case 'tree-pine':
    case 'tree-cedar': {
      C(hw * 0.07, hw * 0.1, h * 0.25, 0, h * 0.125, 0, M.bark, 10);
      const tiers = kind === 'tree-pine' ? 5 : 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const r = hw * (1 - t * 0.8) * (kind === 'tree-cedar' ? 0.75 : 1);
        put(new THREE.ConeGeometry(r, h * 0.32, 12), M.foliage, 0, h * 0.2 + t * h * 0.62 + h * 0.16, 0);
      }
      break;
    }
    case 'tree-birch': {
      for (const [dx, dz, lean] of [[0, 0, 0], [6, 3, 0.12], [-5, 4, -0.1]]) {
        const tr = C(hw * 0.05, hw * 0.07, h * 0.75, dx, h * 0.375, dz, M.birch, 10);
        tr.rotation.z = lean;
        for (let k = 0; k < 6; k++) B(hw * 0.11, 0.6, hw * 0.11, dx, h * 0.1 + k * h * 0.11, dz, mat('#292524'));
      }
      for (const [x, y, z, r] of [[0, 0.72, 0, 0.55], [hw * 0.3, 0.62, hw * 0.2, 0.4], [-hw * 0.3, 0.65, -hw * 0.15, 0.42], [0, 0.85, hw * 0.1, 0.38]]) S(hw * r, x, h * y, z, M.foliage);
      break;
    }
    case 'boulder': {
      const g = new THREE.DodecahedronGeometry(1, 1);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.82 + (((i * 7919) % 97) / 97) * 0.3;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      g.scale(hw, h * 0.75, hd);
      put(g, M.stone, 0, h * 0.4, 0);
      break;
    }
    default:
      B(w, h, d, 0, h / 2, 0, M.base);
  }
  return { group, meshes };
}
