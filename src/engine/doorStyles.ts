/**
 * DOOR STYLES — one layout used by the plan symbol, the elevation and the 3D model so every view of
 * a door agrees (pure functions).
 *
 * A door entity's width × height is the ROUGH OPENING cut in the wall. Inside it the layout places:
 * sidelights (glass, 0–2), a transom (glass band above the leaves) and the leaves / panels, which
 * depend on the operation (kind): hinged single / double / Dutch / pivot, sliding & multi-slide,
 * pocket, barn (single / bypass), bi-fold and garage.
 */
import type { DoorEntity, DoorKind, DoorPanelStyle } from '../types/model';

export interface DoorLeafLayout {
  x0: number; // along the opening width, from the opening's start side
  x1: number;
  hinge: 'x0' | 'x1' | 'none';
  /** sliding / pocket / barn: track (0 = in the frame plane, ±1 = staggered tracks) */
  track?: number;
}

export interface DoorLayout {
  frame: number; // frame member width
  leafH: number; // height of the leaves (below the transom)
  leaves: DoorLeafLayout[];
  sidelights: Array<{ x0: number; x1: number }>;
  transom: { y0: number; y1: number } | null;
  kind: DoorKind;
  style: DoorPanelStyle;
  arched: boolean;
}

export const DOOR_KIND_LABEL: Record<DoorKind, string> = {
  single: 'Hinged single',
  double: 'Hinged double',
  dutch: 'Dutch (split leaf)',
  pivot: 'Pivot',
  sliding: 'Sliding glass (patio)',
  multislide: 'Multi-slide stacking',
  pocket: 'Pocket (slides into the wall)',
  barn: 'Barn door on track',
  'barn-bypass': 'Bypass barn doors',
  bifold: 'Bi-fold (accordion)',
  garage: 'Garage',
};

export const DOOR_STYLE_LABEL: Record<DoorPanelStyle, string> = {
  flush: 'Flush wood',
  'six-panel': '6-panel colonial',
  craftsman: 'Craftsman 3-lite',
  french: 'Full-lite French',
  plank: 'Rustic plank + strap hinges',
  arched: 'Arched-top timber',
  louvered: 'Louvered',
  glass: 'Glass panel',
  sectional: 'Sectional (raised panels)',
  'roll-up': 'Roll-up (slats)',
  carriage: 'Carriage house',
  'pivot-slab': 'Pivot slab',
};

/** Default panel design for an operation. */
export function defaultStyle(kind: DoorKind | undefined, glazed?: boolean): DoorPanelStyle {
  switch (kind) {
    case 'sliding':
    case 'multislide':
      return 'glass';
    case 'garage':
      return 'sectional';
    case 'pivot':
      return 'pivot-slab';
    case 'barn':
    case 'barn-bypass':
      return 'plank';
    case 'bifold':
      return glazed ? 'french' : 'louvered';
    default:
      return glazed ? 'french' : 'flush';
  }
}

/** True for doors whose leaves sit IN the opening and swing (plan: leaf + arc). */
export const isSwingKind = (k: DoorKind) => k === 'single' || k === 'double' || k === 'dutch' || k === 'pivot';

/**
 * Layout of a door inside its rough opening (width × height, inches). Leaves are listed from the
 * opening start (x = 0) toward its end (x = width).
 */
export function doorLayout(d: Pick<DoorEntity, 'width' | 'height' | 'swing' | 'kind' | 'panelStyle' | 'panels' | 'sidelights' | 'sidelightWidth' | 'transom' | 'frameWidth' | 'glazed'>): DoorLayout {
  const kind: DoorKind = d.kind || 'single';
  const style = d.panelStyle || defaultStyle(kind, d.glazed);
  const W = d.width;
  const fw = Math.max(1, Math.min(W / 6, d.frameWidth ?? 2));
  const nSide = Math.max(0, Math.min(2, Math.round(d.sidelights || 0)));
  const sw = nSide ? Math.max(8, d.sidelightWidth ?? 14) : 0;
  const transomH = Math.max(0, d.transom || 0);
  const arched = style === 'arched';
  const leafH = Math.max(24, d.height - fw - (transomH ? transomH + fw : 0));
  const sidelights: DoorLayout['sidelights'] = [];
  let a0 = fw;
  let a1 = W - fw;
  if (nSide >= 1) {
    sidelights.push({ x0: fw, x1: fw + sw });
    a0 = fw + sw + fw;
  }
  if (nSide >= 2) {
    sidelights.push({ x0: W - fw - sw, x1: W - fw });
    a1 = W - fw - sw - fw;
  }
  const lw = Math.max(6, a1 - a0);
  const isLeft = (d.swing || 'left-in').startsWith('left');
  const leaves: DoorLeafLayout[] = [];
  switch (kind) {
    case 'double':
      leaves.push({ x0: a0, x1: a0 + lw / 2, hinge: 'x0' }, { x0: a0 + lw / 2, x1: a1, hinge: 'x1' });
      break;
    case 'sliding':
    case 'multislide': {
      const n = Math.max(2, Math.min(8, Math.round(d.panels || (kind === 'multislide' ? 4 : 2))));
      const pw = lw / n;
      for (let i = 0; i < n; i++) leaves.push({ x0: a0 + i * pw - (i ? 1.5 : 0), x1: a0 + (i + 1) * pw + (i < n - 1 ? 1.5 : 0), hinge: 'none', track: i % 2 ? -1 : 1 });
      break;
    }
    case 'bifold': {
      const n = Math.max(2, Math.min(8, Math.round(d.panels || 4)));
      const pw = lw / n;
      for (let i = 0; i < n; i++) leaves.push({ x0: a0 + i * pw, x1: a0 + (i + 1) * pw, hinge: i % 2 ? 'x1' : 'x0' });
      break;
    }
    case 'barn-bypass':
      leaves.push({ x0: a0 - 2, x1: a0 + lw / 2 + 2, hinge: 'none', track: 1 }, { x0: a0 + lw / 2 - 2, x1: a1 + 2, hinge: 'none', track: 2 });
      break;
    case 'barn':
      leaves.push({ x0: a0 - 3, x1: a1 + 3, hinge: 'none', track: 1 });
      break;
    case 'pocket':
    case 'garage':
      leaves.push({ x0: a0, x1: a1, hinge: 'none', track: 0 });
      break;
    default:
      leaves.push({ x0: a0, x1: a1, hinge: isLeft ? 'x0' : 'x1' });
  }
  return { frame: fw, leafH, leaves, sidelights, transom: transomH ? { y0: leafH + fw, y1: leafH + fw + transomH } : null, kind, style, arched };
}
