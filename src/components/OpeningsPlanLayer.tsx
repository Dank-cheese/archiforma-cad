import React, { useMemo } from 'react';
import type {
  ArchEntity,
  ArchModel,
  DepthPosition,
  DoorEntity,
  GridEntity,
  Point,
  ToolId,
  WallEntity,
  WallOpeningEntity,
  WindowEntity,
} from '../types/model';
import {
  asLike,
  centerS,
  checkOpeningFit,
  doorTypeFields,
  isHostedOpening,
  nearestWall,
  nextOpeningMark,
  openingWarnings,
  openingSpan,
  projectOnWall,
  snapAlongWall,
  temporaryDimensions,
  wallExtSign,
  wallFrame,
  wallPoint,
  windowTypeFields,
  type FitIssue,
  type HostedOpening,
  type TempDim,
} from '../engine/openings';
import { formatLength } from '../engine/geometry';
import { openingPlanPrims } from '../engine/planPrimitives';
import { PrimsWorld } from './PrimsWorld';

// ------------------------------------------------------------------------------------------
// TOOL STATE (DR / WN / WO options bar)
// ------------------------------------------------------------------------------------------

export interface OpeningToolState {
  doorTypeId?: string;
  windowTypeId?: string;
  depthPosition: DepthPosition;
  /** SPACE: door swings to the other side / window exterior side flipped */
  flip: boolean;
  hand: 'left' | 'right';
  snapCenter: boolean;
  snapEq: boolean;
  /** window sill override for new windows (undefined = the type's sill) */
  sill?: number;
  woShape: 'rect' | 'arch';
  woWidth: number;
  woHeight: number;
  woSill: number;
}

export const DEFAULT_OPENING_TOOL: OpeningToolState = {
  depthPosition: 'center',
  flip: false,
  hand: 'left',
  snapCenter: true,
  snapEq: true,
  woShape: 'rect',
  woWidth: 36,
  woHeight: 84,
  woSill: 0,
};

export const isOpeningTool = (t: ToolId): t is 'door' | 'window' | 'wallopening' => t === 'door' || t === 'window' || t === 'wallopening';

export const TEMP_DIM_COLOR = '#0ea5e9';

export interface OpeningPlacement {
  wall: WallEntity;
  s: number;
  entity: HostedOpening;
  ok: boolean;
  issues: FitIssue[];
  snap: 'center' | 'eq' | null;
  dims: TempDim[];
  cursorSide: number; // +1 = cursor on the wall's LEFT normal side
}

const ISSUE_TEXT: Record<FitIssue, string> = {
  overlap: 'overlaps another opening',
  'past-end': 'runs past the wall end',
  'too-short': 'wall too short',
  'too-tall': 'taller than the wall',
};
export const issueText = (issues: FitIssue[]) => issues.map((i) => ISSUE_TEXT[i]).join(', ');

/** Builds the opening the tool would place on `wall` at station `s`. */
export function buildOpeningEntity(
  model: ArchModel,
  tool: 'door' | 'window' | 'wallopening',
  ot: OpeningToolState,
  wall: WallEntity,
  s: number,
  cursorSide: number,
  activeLevelId: string,
  id: string
): HostedOpening {
  const L = Math.max(1, wallFrame(wall).length);
  const levelId = wall.levelId || activeLevelId;
  const base = { id, levelId, wallId: wall.id, offset: s / L };
  if (tool === 'door') {
    const dt = (model.doorTypes ?? []).find((t) => t.id === ot.doorTypeId) || (model.doorTypes ?? [])[0];
    // Revit: the door swings toward the side the cursor is on; SPACE flips it
    const side = (ot.flip ? -1 : 1) * (cursorSide || 1);
    const d: DoorEntity = {
      ...base,
      type: 'door',
      layer: 'A-DOOR',
      width: dt?.width ?? 36,
      height: dt?.height ?? 80,
      swing: `${ot.hand}-${side > 0 ? 'in' : 'out'}` as DoorEntity['swing'],
      ...(dt ? doorTypeFields(dt) : {}),
      depthPosition: ot.depthPosition,
      mark: nextOpeningMark(model.entities, 'door'),
    };
    return d;
  }
  if (tool === 'window') {
    const wt = (model.windowTypes ?? []).find((t) => t.id === ot.windowTypeId) || (model.windowTypes ?? [])[0];
    const w: WindowEntity = {
      ...base,
      type: 'window',
      layer: 'A-GLAZ',
      width: wt?.width ?? 48,
      height: wt?.height ?? 48,
      sillHeight: ot.sill ?? wt?.sillHeight ?? 36,
      ...(wt ? windowTypeFields(wt) : {}),
      depthPosition: ot.depthPosition,
      flipFacing: ot.flip || undefined,
      mark: nextOpeningMark(model.entities, 'window'),
    };
    return w;
  }
  const wo: WallOpeningEntity = {
    ...base,
    type: 'wallopening',
    layer: 'A-WALL',
    width: ot.woWidth,
    height: ot.woHeight,
    sillHeight: ot.woSill,
    shape: ot.woShape,
    mark: nextOpeningMark(model.entities, 'wallopening'),
  };
  return wo;
}

/** Live placement under the cursor: hosted wall, snapped station, fit check and temporary dimensions. */
export function computeOpeningPlacement(
  model: ArchModel,
  levelEntities: ArchEntity[],
  tool: 'door' | 'window' | 'wallopening',
  ot: OpeningToolState,
  cursor: Point,
  zoom: number,
  activeLevelId: string,
  lockWallId?: string
): OpeningPlacement | null {
  const walls = levelEntities.filter((e): e is WallEntity => e.type === 'wall' && !e.curtain && e.wallTypeId !== 'wt-curtain');
  const hit = lockWallId ? (() => {
    const w = walls.find((x) => x.id === lockWallId);
    if (!w) return null;
    const pr = projectOnWall(wallFrame(w), cursor);
    return { wall: w, s: pr.s, distance: pr.distance };
  })() : nearestWall(cursor, walls, 30 / Math.max(0.05, zoom) + 6);
  if (!hit) return null;
  const wall = hit.wall;
  const f = wallFrame(wall);
  const L = f.length;
  if (L < 6) return null;
  const rel = { x: cursor.x - f.start.x, y: cursor.y - f.start.y };
  const cursorSide = rel.x * f.normal.x + rel.y * f.normal.y - f.center >= 0 ? 1 : -1;
  const probe = buildOpeningEntity(model, tool, ot, wall, L / 2, cursorSide, activeLevelId, '__preview__');
  const others = levelEntities.filter((e): e is HostedOpening => isHostedOpening(e) && e.wallId === wall.id).map(asLike);
  const raw = projectOnWall(f, cursor).s;
  const snap = snapAlongWall(L, raw, probe.width, others, 10 / Math.max(0.05, zoom), { center: ot.snapCenter, eq: ot.snapEq });
  const entity = { ...probe, offset: snap.s / L } as HostedOpening;
  const fit = checkOpeningFit(wall, asLike(entity), others);
  const grids = model.entities.filter((e): e is GridEntity => e.type === 'grid');
  const extSide = wallExtSign(wall, levelEntities.filter((e): e is WallEntity => e.type === 'wall'));
  const dims = temporaryDimensions(wall, snap.s, entity.width, others, grids, extSide * (f.thickness / 2 + 16 / Math.max(0.05, zoom) + 6));
  return { wall, s: snap.s, entity, ok: fit.ok, issues: fit.issues, snap: snap.kind, dims, cursorSide };
}

// ------------------------------------------------------------------------------------------
// RENDERING
// ------------------------------------------------------------------------------------------

/** Light-blue Revit-style temporary dimension with a clickable value. */
export const TempDimSvg: React.FC<{
  dim: TempDim;
  zoom: number;
  units: ArchModel['settings']['units'];
  onEdit?: (dim: TempDim, at: Point) => void;
}> = ({ dim, zoom, units, onEdit }) => {
  const k = 1 / Math.max(0.05, zoom);
  const dx = dim.b.x - dim.a.x;
  const dy = dim.b.y - dim.a.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.01) return null;
  const ux = dx / L;
  const uy = dy / L;
  const nx = -uy;
  const ny = ux;
  const mid = { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 };
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  const tick = (p: Point) => (
    <line x1={p.x - (ux + nx) * 4 * k} y1={p.y - (uy + ny) * 4 * k} x2={p.x + (ux + nx) * 4 * k} y2={p.y + (uy + ny) * 4 * k} stroke={TEMP_DIM_COLOR} strokeWidth={1.3 * k} />
  );
  const label = formatLength(dim.value, units);
  const tp = { x: mid.x + nx * 9 * k, y: mid.y + ny * 9 * k };
  const w = (label.length * 6.6 + 8) * k;
  return (
    <g data-testid={`temp-dim-${dim.key}`}>
      <line x1={dim.a.x} y1={dim.a.y} x2={dim.b.x} y2={dim.b.y} stroke={TEMP_DIM_COLOR} strokeWidth={1.1 * k} pointerEvents="none" />
      {tick(dim.a)}
      {tick(dim.b)}
      <g
        transform={`rotate(${ang} ${tp.x} ${tp.y})`}
        style={{ cursor: onEdit ? 'text' : 'default' }}
        pointerEvents={onEdit ? 'auto' : 'none'}
        onPointerDown={(e) => {
          if (!onEdit) return;
          e.stopPropagation();
          e.preventDefault();
          onEdit(dim, tp);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <title>Click to type an exact distance</title>
        <rect x={tp.x - w / 2} y={tp.y - 7 * k} width={w} height={14 * k} rx={3 * k} fill="#f0f9ff" fillOpacity={0.92} stroke={TEMP_DIM_COLOR} strokeWidth={0.8 * k} />
        <text x={tp.x} y={tp.y} fontSize={10.5 * k} fill="#0369a1" textAnchor="middle" dominantBaseline="central" fontFamily="JetBrains Mono, monospace" fontWeight={700} style={{ userSelect: 'none' }}>
          {label}
        </text>
      </g>
    </g>
  );
};

/** Yellow warning triangle (hosting problems are flagged, never auto-deleted). */
const WarnIcon: React.FC<{ at: Point; zoom: number; title: string }> = ({ at, zoom, title }) => {
  const k = 1 / Math.max(0.05, zoom);
  const s = 9 * k;
  return (
    <g data-testid="opening-warning" pointerEvents="auto">
      <title>{title}</title>
      <polygon points={`${at.x},${at.y - s * 1.6} ${at.x + s},${at.y + s * 0.2} ${at.x - s},${at.y + s * 0.2}`} transform={`translate(0 ${-s * 1.2})`} fill="#facc15" stroke="#a16207" strokeWidth={1.1 * k} />
      <text x={at.x} y={at.y - s * 1.55} fontSize={9 * k} textAnchor="middle" dominantBaseline="central" fontWeight={800} fill="#713f12" style={{ userSelect: 'none' }}>
        !
      </text>
    </g>
  );
};

export const OpeningsPlanLayer: React.FC<{
  model: ArchModel;
  entities: ArchEntity[]; // visible entities on the active level
  walls: WallEntity[];
  selectedIds: Set<string>;
  zoom: number;
  darkMode: boolean;
  activeTool: ToolId;
  placement: OpeningPlacement | null;
  onEntityClick: (e: React.MouseEvent, ent: ArchEntity) => void;
  onEntityContextMenu: (e: React.MouseEvent, ent: ArchEntity) => void;
  onEditDim: (dim: TempDim, at: Point, ctx: { openingId?: string }) => void;
  onFlip: (id: string, what: 'facing' | 'hand') => void;
  /** 'static' = opening symbols + warnings (memoized with the plan); 'live' = preview, temp dims, flip controls */
  part: 'static' | 'live';
}> = ({ model, entities, walls, selectedIds, zoom, darkMode, activeTool, placement, onEntityClick, onEntityContextMenu, onEditDim, onFlip, part }) => {
  const wallById = useMemo(() => new Map(walls.map((w) => [w.id, w] as const)), [walls]);
  const openings = useMemo(() => entities.filter(isHostedOpening), [entities]);
  const warnings = useMemo(() => openingWarnings([...walls, ...openings]), [walls, openings]);
  const k = 1 / Math.max(0.05, zoom);
  const units = model.settings.units;

  // the single selected opening gets temporary dimensions + flip controls (Revit)
  const selOpening = useMemo(() => {
    if (activeTool !== 'select' || selectedIds.size !== 1) return null;
    const id = [...selectedIds][0];
    const o = openings.find((x) => x.id === id);
    if (!o) return null;
    const w = wallById.get(o.wallId);
    if (!w) return null;
    const f = wallFrame(w);
    const others = openings.filter((x) => x.wallId === w.id && x.id !== o.id).map(asLike);
    const grids = model.entities.filter((e): e is GridEntity => e.type === 'grid');
    const ext = wallExtSign(w, walls);
    const s = centerS(o, f.length);
    const dims = temporaryDimensions(w, s, o.width, others, grids, ext * (f.thickness / 2 + 16 * k + 6));
    return { o, w, f, dims, ext, s };
  }, [activeTool, selectedIds, openings, wallById, model.entities, walls, k]);

  return (
    <g data-testid={part === 'static' ? 'openings-layer' : 'openings-live'}>
      {part === 'static' && openings.map((o) => {
        const host = wallById.get(o.wallId);
        if (!host) return null;
        const sel = selectedIds.has(o.id);
        const ink = sel ? '#d97706' : darkMode ? '#e7e5e4' : '#1c1917';
        const soft = sel ? '#d97706' : darkMode ? '#a8a29e' : '#57534e';
        const prims = openingPlanPrims(o, host, walls, { ink, soft, fill: darkMode ? '#1c1917' : '#ffffff', scale: 1.7 });
        const f = wallFrame(host);
        const sp = openingSpan(o, f.length);
        const t = f.thickness / 2 + 3;
        const hit = [wallPoint(f, sp.s0, t), wallPoint(f, sp.s1, t), wallPoint(f, sp.s1, -t), wallPoint(f, sp.s0, -t)];
        return (
          <g
            key={o.id}
            data-testid={`opening-${o.type}`}
            data-opening-id={o.id}
            onClick={(e) => onEntityClick(e, o)}
            onContextMenu={(e) => onEntityContextMenu(e, o)}
            className="cursor-pointer"
          >
            <polygon points={hit.map((p) => `${p.x},${p.y}`).join(' ')} fill={sel ? 'rgba(245,158,11,0.10)' : 'transparent'} />
            <PrimsWorld prims={prims} zoom={zoom} />
          </g>
        );
      })}

      {part === 'static' && warnings.map((w, i) => (
        <WarnIcon key={`${w.id}-${w.issue}-${i}`} at={w.at} zoom={zoom} title={w.message} />
      ))}

      {/* selected opening: temporary dimensions + flip arrows */}
      {part === 'live' && selOpening && (
        <g data-testid="opening-selected-controls">
          {selOpening.dims.map((d) => (
            <TempDimSvg key={d.key} dim={d} zoom={zoom} units={units} onEdit={(dim, at) => onEditDim(dim, at, { openingId: selOpening.o.id })} />
          ))}
          {selOpening.o.type !== 'wallopening' && (() => {
            const { f, s, ext } = selOpening;
            const side = -ext; // controls on the interior side
            const p = wallPoint(f, s, side * (f.thickness / 2 + 14 * k + 4));
            const nx = f.normal.x * side;
            const ny = f.normal.y * side;
            const a = 7 * k;
            const flipLabel = selOpening.o.type === 'door' ? 'Flip swing side (facing)' : 'Flip exterior side';
            return (
              <>
                <g
                  data-testid="flip-facing"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onFlip(selOpening.o.id, 'facing');
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>{flipLabel}</title>
                  <circle cx={p.x} cy={p.y} r={a * 1.25} fill="#f0f9ff" stroke={TEMP_DIM_COLOR} strokeWidth={k} />
                  <path
                    d={`M ${p.x + nx * a} ${p.y + ny * a} L ${p.x + (nx * a) / 3 + ny * a * 0.55} ${p.y + (ny * a) / 3 - nx * a * 0.55} M ${p.x + nx * a} ${p.y + ny * a} L ${p.x + (nx * a) / 3 - ny * a * 0.55} ${p.y + (ny * a) / 3 + nx * a * 0.55} M ${p.x - nx * a} ${p.y - ny * a} L ${p.x - (nx * a) / 3 + ny * a * 0.55} ${p.y - (ny * a) / 3 - nx * a * 0.55} M ${p.x - nx * a} ${p.y - ny * a} L ${p.x - (nx * a) / 3 - ny * a * 0.55} ${p.y - (ny * a) / 3 + nx * a * 0.55} M ${p.x + nx * a} ${p.y + ny * a} L ${p.x - nx * a} ${p.y - ny * a}`}
                    stroke={TEMP_DIM_COLOR}
                    strokeWidth={1.4 * k}
                    fill="none"
                  />
                </g>
                {selOpening.o.type === 'door' && (selOpening.o.kind || 'single') === 'single' && (() => {
                  const q = wallPoint(f, s + selOpening.o.width / 2 + 10 * k, side * (f.thickness / 2 + 14 * k + 4));
                  const ux = f.dir.x;
                  const uy = f.dir.y;
                  return (
                    <g
                      data-testid="flip-hand"
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onFlip(selOpening.o.id, 'hand');
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <title>Flip hand (hinge side)</title>
                      <circle cx={q.x} cy={q.y} r={a * 1.25} fill="#f0f9ff" stroke={TEMP_DIM_COLOR} strokeWidth={k} />
                      <path d={`M ${q.x - ux * a} ${q.y - uy * a} L ${q.x + ux * a} ${q.y + uy * a}`} stroke={TEMP_DIM_COLOR} strokeWidth={1.4 * k} />
                      <path d={`M ${q.x + ux * a} ${q.y + uy * a} l ${(-ux + uy) * a * 0.5} ${(-uy - ux) * a * 0.5} M ${q.x - ux * a} ${q.y - uy * a} l ${(ux - uy) * a * 0.5} ${(uy + ux) * a * 0.5}`} stroke={TEMP_DIM_COLOR} strokeWidth={1.4 * k} fill="none" />
                    </g>
                  );
                })()}
              </>
            );
          })()}
        </g>
      )}

      {/* live placement preview: snapped into the wall, centred in its thickness; red when it does not fit */}
      {part === 'live' && placement && (() => {
        const { wall, entity, ok, snap, s } = placement;
        const f = wallFrame(wall);
        const col = ok ? '#0284c7' : '#dc2626';
        const sp = openingSpan(entity, f.length);
        const cut = [wallPoint(f, sp.s0, f.thickness / 2), wallPoint(f, sp.s1, f.thickness / 2), wallPoint(f, sp.s1, -f.thickness / 2), wallPoint(f, sp.s0, -f.thickness / 2)];
        const prims = openingPlanPrims(entity, wall, walls, { ink: col, soft: col, fill: ok ? '#e0f2fe' : '#fee2e2', scale: 1.2 });
        const lbl = wallPoint(f, s, 0);
        return (
          <g data-testid="opening-preview" data-fits={ok ? "yes" : "no"} data-s={s.toFixed(2)} data-wall={wall.id} pointerEvents="none">
            <polygon points={cut.map((p) => `${p.x},${p.y}`).join(' ')} fill={ok ? 'rgba(224,242,254,0.95)' : 'rgba(254,226,226,0.95)'} stroke={col} strokeWidth={1.4 * k} />
            <PrimsWorld prims={prims} zoom={zoom} />
            {snap && (
              <text x={lbl.x} y={lbl.y - (f.thickness / 2 + 8 * k + 2)} fontSize={10 * k} fill={col} textAnchor="middle" fontWeight={800} fontFamily="JetBrains Mono, monospace" style={{ userSelect: 'none' }}>
                {snap === 'center' ? 'CENTER' : 'EQ'}
              </text>
            )}
          </g>
        );
      })()}
      {part === 'live' && placement && (
        <g data-testid="opening-preview-dims">
          {placement.dims.map((d) => (
            <TempDimSvg key={d.key} dim={d} zoom={zoom} units={units} onEdit={(dim, at) => onEditDim(dim, at, {})} />
          ))}
        </g>
      )}
    </g>
  );
};
