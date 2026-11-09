/**
 * BIM COMPONENT LIBRARY — cabin & living, kitchen & bath, stairs / porches / site (pure data).
 *
 * Each component is a BlockDefinition with a 2D architectural plan symbol (local coordinates centred
 * on 0,0; +Y = the component's "front") and a `libKind` that selects its parametric 3D model in
 * components/library3d.ts. Width × depth × height scale both.
 */
import type { ArchEntity, BlockCategory, BlockDefinition } from '../types/model';

type E = ArchEntity;
let n = 0;
const id = (p: string) => `${p}-${n++}`;
const rect = (x1: number, y1: number, x2: number, y2: number): E => ({ id: id('r'), type: 'rectangle', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
const line = (x1: number, y1: number, x2: number, y2: number): E => ({ id: id('l'), type: 'line', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const circle = (cx: number, cy: number, r: number): E => ({ id: id('c'), type: 'circle', layer: '0', center: { x: cx, y: cy }, radius: r });
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): E => ({ id: id('a'), type: 'arc', layer: '0', center: { x: cx, y: cy }, radius: r, startAngle: a0, endAngle: a1 });
const poly = (pts: Array<[number, number]>, closed = true): E => ({ id: id('p'), type: 'polyline', layer: '0', points: pts.map(([x, y]) => ({ x, y })), closed });

interface Spec {
  libKind: string;
  name: string;
  category: BlockCategory;
  w: number;
  d: number;
  h: number;
  color: string;
  tags: string[];
  mount?: BlockDefinition['mount'];
  symbol: (w: number, d: number) => E[];
}

const W2 = (w: number) => w / 2;

/** Stone-coursing lines inside a rectangle (plan). */
const stoneLines = (x1: number, y1: number, x2: number, y2: number, step = 8): E[] => {
  const out: E[] = [];
  for (let y = y1 + step; y < y2; y += step) out.push(line(x1, y, x2, y));
  return out;
};

const stairSymbol = (w: number, d: number, risers = 14): E[] => {
  const out: E[] = [rect(-W2(w), -W2(d), W2(w), W2(d))];
  for (let i = 1; i < risers; i++) {
    const y = -W2(d) + (d * i) / risers;
    out.push(line(-W2(w), y, W2(w), y));
  }
  out.push(line(0, W2(d) - 6, 0, -W2(d) + 10), line(-4, -W2(d) + 16, 0, -W2(d) + 10), line(4, -W2(d) + 16, 0, -W2(d) + 10));
  return out;
};

const SPECS: Spec[] = [
  // ======================================================================== CABIN & LIVING
  {
    libKind: 'fireplace-stone', name: 'Stone Hearth & Wood-Burning Fireplace', category: 'Cabin & Living', w: 72, d: 30, h: 96, color: '#9c9083',
    tags: ['fireplace', 'hearth', 'stone', 'chimney', 'wood burning', 'cabin'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) * 0.45, -W2(d) + 4, W2(w) * 0.45, W2(d) * 0.3), rect(-W2(w) - 6, W2(d), W2(w) + 6, W2(d) + 18), ...stoneLines(-W2(w), -W2(d), W2(w), W2(d), 7)],
  },
  {
    libKind: 'woodstove', name: 'Cast-Iron Wood Stove with Flue Pipe', category: 'Cabin & Living', w: 28, d: 24, h: 32, color: '#2b2b2b',
    tags: ['stove', 'wood stove', 'cast iron', 'flue', 'heater'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), circle(0, -W2(d) * 0.4, 3.5), rect(-W2(w) - 9, W2(d) + 2, W2(w) + 9, W2(d) + 20)],
  },
  {
    libKind: 'chandelier-antler', name: 'Antler Chandelier', category: 'Cabin & Living', w: 36, d: 36, h: 30, color: '#d8ccb4', mount: 'ceiling',
    tags: ['chandelier', 'antler', 'light', 'ceiling', 'lodge'],
    symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, 3), ...[0, 60, 120, 180, 240, 300].map((a) => line(0, 0, W2(w) * Math.cos((a * Math.PI) / 180), W2(w) * Math.sin((a * Math.PI) / 180)))],
  },
  {
    libKind: 'chandelier-iron', name: 'Wrought-Iron Chandelier', category: 'Cabin & Living', w: 32, d: 32, h: 28, color: '#1f1f1f', mount: 'ceiling',
    tags: ['chandelier', 'wrought iron', 'light', 'ceiling', 'candle'],
    symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, W2(w) * 0.6), ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => circle(W2(w) * Math.cos((a * Math.PI) / 180), W2(w) * Math.sin((a * Math.PI) / 180), 1.5))],
  },
  {
    libKind: 'table-liveedge', name: 'Live-Edge Timber Dining Table', category: 'Cabin & Living', w: 96, d: 40, h: 30, color: '#8a5a33',
    tags: ['table', 'dining', 'live edge', 'slab', 'timber'],
    symbol: (w, d) => [poly([[-W2(w), -W2(d) + 2], [-W2(w) * 0.5, -W2(d)], [0, -W2(d) + 3], [W2(w) * 0.5, -W2(d) + 1], [W2(w), -W2(d) + 3], [W2(w), W2(d) - 2], [W2(w) * 0.4, W2(d)], [-W2(w) * 0.3, W2(d) - 3], [-W2(w), W2(d) - 1]]), rect(-W2(w) + 10, -W2(d) - 14, W2(w) - 10, -W2(d) - 4), rect(-W2(w) + 10, W2(d) + 4, W2(w) - 10, W2(d) + 14)],
  },
  {
    libKind: 'sofa-leather', name: 'Leather Sofa with Log Frame', category: 'Cabin & Living', w: 84, d: 38, h: 34, color: '#6b3f24',
    tags: ['sofa', 'couch', 'leather', 'log', 'rustic'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w), -W2(d), W2(w), -W2(d) + 9), circle(-W2(w) + 4, W2(d) - 4, 4), circle(W2(w) - 4, W2(d) - 4, 4), line(-W2(w) / 3, -W2(d) + 9, -W2(w) / 3, W2(d)), line(W2(w) / 3, -W2(d) + 9, W2(w) / 3, W2(d))],
  },
  {
    libKind: 'armchair-log', name: 'Log-Frame Leather Armchair', category: 'Cabin & Living', w: 36, d: 36, h: 36, color: '#6b3f24',
    tags: ['armchair', 'chair', 'log', 'leather'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w), -W2(d), W2(w), -W2(d) + 8), circle(-W2(w) + 4, W2(d) - 4, 4), circle(W2(w) - 4, W2(d) - 4, 4)],
  },
  {
    libKind: 'bunkbed', name: 'Bunk Beds (twin over twin)', category: 'Cabin & Living', w: 42, d: 80, h: 66, color: '#a87a4a',
    tags: ['bunk', 'bed', 'kids', 'cabin', 'sleeping'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) + 3, -W2(d) + 3, W2(w) - 3, -W2(d) + 14), line(-W2(w), -W2(d), W2(w), W2(d)), line(W2(w), -W2(d), -W2(w), W2(d)), rect(W2(w), -W2(d) + 20, W2(w) + 4, W2(d) - 20)],
  },
  {
    libKind: 'windowseat', name: 'Built-in Window Seat Bench', category: 'Cabin & Living', w: 72, d: 24, h: 18, color: '#e3c48f',
    tags: ['window seat', 'bench', 'built-in', 'nook'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w) / 3, -W2(d), -W2(w) / 3, W2(d)), line(W2(w) / 3, -W2(d), W2(w) / 3, W2(d)), rect(-W2(w), -W2(d), W2(w), -W2(d) + 6)],
  },
  {
    libKind: 'bookcase', name: 'Bookcase (timber)', category: 'Cabin & Living', w: 36, d: 14, h: 84, color: '#8a5a33',
    tags: ['bookcase', 'shelves', 'library', 'storage'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w) / 3, -W2(d), -W2(w) / 3, W2(d)), line(W2(w) / 3, -W2(d), W2(w) / 3, W2(d))],
  },
  // ======================================================================== KITCHEN & BATH
  {
    libKind: 'sink-farmhouse', name: 'Farmhouse Apron-Front Sink Cabinet', category: 'Kitchen & Bath', w: 36, d: 25, h: 36, color: '#f5f5f4',
    tags: ['sink', 'farmhouse', 'apron', 'kitchen'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) + 3, -W2(d) + 4, W2(w) - 3, W2(d) - 2), circle(0, -W2(d) + 3, 1.5), circle(0, 2, 1.2)],
  },
  {
    libKind: 'island-butcher', name: 'Kitchen Island with Butcher-Block Top', category: 'Kitchen & Bath', w: 72, d: 36, h: 36, color: '#3f5f4a',
    tags: ['island', 'kitchen', 'butcher block', 'counter'],
    symbol: (w, d) => [rect(-W2(w) - 1.5, -W2(d) - 1.5, W2(w) + 1.5, W2(d) + 12), rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w) / 3, -W2(d), -W2(w) / 3, W2(d)), line(W2(w) / 3, -W2(d), W2(w) / 3, W2(d))],
  },
  {
    libKind: 'hood-copper', name: 'Range Hood — Copper', category: 'Kitchen & Bath', w: 36, d: 22, h: 30, color: '#b8733a', mount: 'wall-high',
    tags: ['range hood', 'hood', 'copper', 'kitchen', 'vent'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) * 0.35, -W2(d), W2(w) * 0.35, -W2(d) + 8), line(-W2(w), W2(d), 0, -W2(d) + 8), line(W2(w), W2(d), 0, -W2(d) + 8)],
  },
  {
    libKind: 'hood-timber', name: 'Range Hood — Timber Mantel', category: 'Kitchen & Bath', w: 42, d: 24, h: 30, color: '#8a5a33', mount: 'wall-high',
    tags: ['range hood', 'hood', 'timber', 'mantel', 'kitchen'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) * 0.35, -W2(d), W2(w) * 0.35, -W2(d) + 8)],
  },
  {
    libKind: 'hood-stainless', name: 'Range Hood — Stainless Chimney', category: 'Kitchen & Bath', w: 36, d: 22, h: 30, color: '#c7ccd1', mount: 'wall-high',
    tags: ['range hood', 'hood', 'stainless', 'steel', 'kitchen'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) * 0.25, -W2(d), W2(w) * 0.25, -W2(d) + 7)],
  },
  {
    libKind: 'tub-clawfoot', name: 'Freestanding Clawfoot Tub', category: 'Kitchen & Bath', w: 66, d: 30, h: 24, color: '#f8fafc',
    tags: ['tub', 'bathtub', 'clawfoot', 'bath', 'freestanding'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) + 4, -W2(d) + 4, W2(w) - 4, W2(d) - 4), circle(-W2(w) + 9, 0, 1.6), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => circle(sx * (W2(w) - 6), sy * (W2(d) - 3), 2))],
  },
  {
    libKind: 'tub-soaking', name: 'Freestanding Soaking Tub', category: 'Kitchen & Bath', w: 67, d: 32, h: 22, color: '#f8fafc',
    tags: ['tub', 'soaking', 'bath', 'freestanding', 'oval'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) + 5, -W2(d) + 5, W2(w) - 5, W2(d) - 5), circle(0, 0, 1.6)],
  },
  {
    libKind: 'shower-glass', name: 'Walk-in Glass Shower Enclosure', category: 'Kitchen & Bath', w: 60, d: 36, h: 80, color: '#e5e7eb',
    tags: ['shower', 'glass', 'walk-in', 'enclosure', 'bath'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w), W2(d), W2(w) * 0.2, W2(d)), circle(0, -W2(d) + 6, 2), line(-W2(w), -W2(d), W2(w), W2(d)), line(W2(w), -W2(d), -W2(w), W2(d))],
  },
  {
    libKind: 'vanity-double', name: 'Double Vanity', category: 'Kitchen & Bath', w: 72, d: 22, h: 34, color: '#5b6b73',
    tags: ['vanity', 'double', 'sink', 'bathroom'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w) * 0.75, -W2(d) + 4, -W2(w) * 0.25, W2(d) - 3), rect(W2(w) * 0.25, -W2(d) + 4, W2(w) * 0.75, W2(d) - 3)],
  },
  {
    libKind: 'sauna', name: 'Sauna Benches & Heater', category: 'Kitchen & Bath', w: 72, d: 60, h: 84, color: '#d9b77e',
    tags: ['sauna', 'bench', 'heater', 'spa', 'cedar'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), rect(-W2(w), -W2(d), W2(w), -W2(d) + 20), rect(-W2(w), -W2(d) + 20, W2(w), -W2(d) + 36), rect(W2(w) - 20, W2(d) - 20, W2(w) - 2, W2(d) - 2), circle(W2(w) - 11, W2(d) - 11, 5)],
  },
  // ======================================================================== STAIRS, PORCHES & SITE
  { libKind: 'stair-straight', name: 'Straight Stair', category: 'Stairs, Porches & Site', w: 36, d: 132, h: 108, color: '#a87a4a', tags: ['stair', 'straight', 'steps'], symbol: (w, d) => stairSymbol(w, d) },
  {
    libKind: 'stair-l', name: 'L-Shape Stair (landing)', category: 'Stairs, Porches & Site', w: 84, d: 96, h: 108, color: '#a87a4a', tags: ['stair', 'l-shape', 'landing'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), -W2(w) + 36, W2(d)), rect(-W2(w), -W2(d), W2(w), -W2(d) + 36), ...Array.from({ length: 7 }, (_, i) => line(-W2(w), W2(d) - i * 9, -W2(w) + 36, W2(d) - i * 9)), ...Array.from({ length: 6 }, (_, i) => line(-W2(w) + 36 + i * 8, -W2(d), -W2(w) + 36 + i * 8, -W2(d) + 36))],
  },
  {
    libKind: 'stair-u', name: 'U-Shape Stair (switchback)', category: 'Stairs, Porches & Site', w: 78, d: 108, h: 108, color: '#a87a4a', tags: ['stair', 'u-shape', 'switchback', 'landing'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(0, -W2(d) + 36, 0, W2(d)), line(-W2(w), -W2(d) + 36, W2(w), -W2(d) + 36), ...Array.from({ length: 7 }, (_, i) => line(-W2(w), W2(d) - i * 10, 0, W2(d) - i * 10)), ...Array.from({ length: 7 }, (_, i) => line(0, W2(d) - i * 10, W2(w), W2(d) - i * 10))],
  },
  {
    libKind: 'stair-spiral', name: 'Spiral Stair', category: 'Stairs, Porches & Site', w: 60, d: 60, h: 108, color: '#3f3f46', tags: ['stair', 'spiral', 'helical', 'loft'],
    symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, 3), ...Array.from({ length: 12 }, (_, i) => line(0, 0, W2(w) * Math.cos((i * Math.PI) / 6), W2(w) * Math.sin((i * Math.PI) / 6)))],
  },
  {
    libKind: 'stair-splitlog', name: 'Split-Log Cabin Stairs with Log Handrail', category: 'Stairs, Porches & Site', w: 40, d: 132, h: 108, color: '#b07a4e', tags: ['stair', 'split log', 'log', 'cabin', 'handrail'],
    symbol: (w, d) => [...stairSymbol(w, d), circle(-W2(w) - 2, -W2(d) + 4, 3), circle(-W2(w) - 2, W2(d) - 4, 3), line(-W2(w) - 2, -W2(d) + 4, -W2(w) - 2, W2(d) - 4)],
  },
  {
    libKind: 'porch-post', name: 'Cabin Porch Log Post', category: 'Stairs, Porches & Site', w: 10, d: 10, h: 96, color: '#b07a4e', tags: ['porch', 'post', 'log', 'column', 'wrap-around'],
    symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, W2(w) * 0.6)],
  },
  {
    libKind: 'railing-branch', name: 'Rustic Branch Railing (8 ft)', category: 'Stairs, Porches & Site', w: 96, d: 4, h: 36, color: '#8a6240', tags: ['railing', 'branch', 'rustic', 'porch'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), ...[-1, 1].map((s) => circle(s * (W2(w) - 2), 0, 2.5))],
  },
  {
    libKind: 'railing-cable', name: 'Cable Railing (8 ft)', category: 'Stairs, Porches & Site', w: 96, d: 4, h: 36, color: '#57534e', tags: ['railing', 'cable', 'modern', 'deck'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w), 0, W2(w), 0)],
  },
  {
    libKind: 'railing-picket', name: 'Picket Railing (8 ft)', category: 'Stairs, Porches & Site', w: 96, d: 4, h: 36, color: '#f5f5f4', tags: ['railing', 'picket', 'porch', 'baluster'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), ...Array.from({ length: 15 }, (_, i) => line(-W2(w) + 6 + i * 6, -W2(d), -W2(w) + 6 + i * 6, W2(d)))],
  },
  {
    libKind: 'pergola', name: 'Outdoor Timber Pergola', category: 'Stairs, Porches & Site', w: 144, d: 120, h: 108, color: '#a87a4a', tags: ['pergola', 'outdoor', 'timber', 'shade', 'garden'],
    symbol: (w, d) => [...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rect(sx * (W2(w) - 10) - 3, sy * (W2(d) - 10) - 3, sx * (W2(w) - 10) + 3, sy * (W2(d) - 10) + 3)), ...Array.from({ length: 9 }, (_, i) => line(-W2(w), -W2(d) + 6 + i * ((d - 12) / 8), W2(w), -W2(d) + 6 + i * ((d - 12) / 8)))],
  },
  {
    libKind: 'pavilion', name: 'Timber Pavilion (gable roof)', category: 'Stairs, Porches & Site', w: 192, d: 144, h: 168, color: '#8a5a33', tags: ['pavilion', 'gazebo', 'timber', 'shelter', 'outdoor'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), line(-W2(w), 0, W2(w), 0), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rect(sx * (W2(w) - 18) - 4, sy * (W2(d) - 18) - 4, sx * (W2(w) - 18) + 4, sy * (W2(d) - 18) + 4))],
  },
  {
    libKind: 'adirondack', name: 'Adirondack Chair', category: 'Stairs, Porches & Site', w: 30, d: 36, h: 38, color: '#3f6b4f', tags: ['adirondack', 'chair', 'outdoor', 'porch', 'deck'],
    symbol: (w, d) => [poly([[-W2(w), W2(d)], [W2(w), W2(d)], [W2(w) - 2, -W2(d)], [-W2(w) + 2, -W2(d)]]), ...Array.from({ length: 5 }, (_, i) => line(-W2(w) + 3 + i * ((w - 6) / 4), -W2(d), -W2(w) + 3 + i * ((w - 6) / 4), -W2(d) + 12))],
  },
  {
    libKind: 'firepit', name: 'Fire Pit with Stone Seating Ring', category: 'Stairs, Porches & Site', w: 144, d: 144, h: 18, color: '#8b8178', tags: ['fire pit', 'stone', 'seating', 'outdoor', 'campfire'],
    symbol: (w) => [circle(0, 0, 20), circle(0, 0, 15), arc(0, 0, W2(w), 200, 340), arc(0, 0, W2(w) - 16, 200, 340), arc(0, 0, W2(w), 20, 160), arc(0, 0, W2(w) - 16, 20, 160)],
  },
  {
    libKind: 'firewood', name: 'Stacked Firewood Rack', category: 'Stairs, Porches & Site', w: 96, d: 24, h: 60, color: '#8a5a33', tags: ['firewood', 'wood pile', 'rack', 'logs'],
    symbol: (w, d) => [rect(-W2(w), -W2(d), W2(w), W2(d)), ...Array.from({ length: 14 }, (_, i) => circle(-W2(w) + 4 + i * ((w - 8) / 13), 0, 3))],
  },
  { libKind: 'tree-pine', name: 'Pine Tree', category: 'Stairs, Porches & Site', w: 144, d: 144, h: 360, color: '#2f5d3a', tags: ['tree', 'pine', 'evergreen', 'conifer', 'landscape'], symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, 6), ...Array.from({ length: 8 }, (_, i) => line(0, 0, W2(w) * 0.9 * Math.cos((i * Math.PI) / 4), W2(w) * 0.9 * Math.sin((i * Math.PI) / 4)))] },
  { libKind: 'tree-birch', name: 'Birch Tree', category: 'Stairs, Porches & Site', w: 120, d: 120, h: 300, color: '#7aa35a', tags: ['tree', 'birch', 'deciduous', 'landscape'], symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, 4), arc(0, 0, W2(w) * 0.7, 30, 150), arc(0, 0, W2(w) * 0.7, 210, 330)] },
  { libKind: 'tree-cedar', name: 'Cedar Tree', category: 'Stairs, Porches & Site', w: 108, d: 108, h: 336, color: '#3d6b45', tags: ['tree', 'cedar', 'evergreen', 'landscape'], symbol: (w) => [circle(0, 0, W2(w)), circle(0, 0, W2(w) * 0.55), circle(0, 0, 5)] },
  {
    libKind: 'boulder', name: 'Boulder', category: 'Stairs, Porches & Site', w: 48, d: 40, h: 30, color: '#8d8a84', tags: ['boulder', 'rock', 'stone', 'landscape'],
    symbol: (w, d) => [poly([[-W2(w), 0], [-W2(w) * 0.6, -W2(d)], [W2(w) * 0.3, -W2(d) * 0.9], [W2(w), -W2(d) * 0.1], [W2(w) * 0.7, W2(d)], [-W2(w) * 0.5, W2(d) * 0.85]])],
  },
];

/** Library component definitions (merged into the project's blocks). */
export function createLibraryBlocks(): BlockDefinition[] {
  return SPECS.map((s) => ({
    id: `lib-${s.libKind}`,
    name: s.name,
    category: s.category,
    kind: 'custom',
    libKind: s.libKind,
    tags: s.tags,
    mount: s.mount,
    width: s.w,
    depth: s.d,
    height: s.h,
    color: s.color,
    entities: s.symbol(s.w, s.d),
  }));
}

/** Search across names, categories and keywords. */
export function searchBlocks(blocks: BlockDefinition[], q: string, category?: string): BlockDefinition[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return blocks.filter((b) => {
    if (category && category !== 'All' && b.category !== category) return false;
    if (!terms.length) return true;
    const hay = `${b.name} ${b.category} ${(b.tags || []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export const LIBRARY_CATEGORIES = ['All', 'Cabin & Living', 'Kitchen & Bath', 'Stairs, Porches & Site', 'Furniture', 'Plumbing', 'Kitchen', 'Architecture', 'Site', 'Custom'];
