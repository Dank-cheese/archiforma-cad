import React, { useMemo } from 'react';
import type { ArchEntity, ArchModel, Discipline, Point, ToolId, WallEntity } from '../types/model';
import { PrimsWorld, SCREEN_PX_PER_MM } from './PrimsWorld';
import { allRebarBars, structuralWarnings } from '../engine/structure';
import { analyticalPrims, buildStructuralPlanPrims, concreteJoinPrims, materialPatternPrims, warningPrims } from '../engine/structurePlan';
import { computeWallPlanPolygons } from '../engine/geometry';
import { wallStructuralMaterialId } from '../engine/structure';

const STRUCT_TYPES = new Set(['column', 'footing', 'beam', 'beamsystem', 'rebar', 'areareinf', 'connection', 'sjoint', 'load', 'section', 'truss']);
const TWO_POINT: ToolId[] = ['beam', 'brace', 'sjoint', 'section'];

/**
 * Structural layer of the 2D plan: columns (all disciplines), and in Structural / Combined
 * disciplines footings (dashed), beams, joists, rebar, joints, loads, connections, sections,
 * structural wall / slab extras, analytical model and warnings. In the Structural discipline
 * everything architectural underneath is faded by a light veil.
 */
export const StructurePlanLayer: React.FC<{
  model: ArchModel;
  entities: ArchEntity[]; // visible on this level
  levelId: string;
  discipline: Discipline;
  analytical: boolean;
  viewRebar: boolean;
  selectedIds: Set<string>;
  zoom: number;
  darkMode: boolean;
  activeTool: ToolId;
  drawingPoints: Point[];
  cursor: Point;
  onEntityClick: (e: React.MouseEvent, ent: ArchEntity) => void;
  onEntityContextMenu: (e: React.MouseEvent, ent: ArchEntity) => void;
  onOpenSection?: (id: string) => void;
}> = ({ model, entities, levelId, discipline, analytical, viewRebar, selectedIds, zoom, darkMode, activeTool, drawingPoints, cursor, onEntityClick, onEntityContextMenu, onOpenSection }) => {
  const zKey = Math.round(Math.log(zoom) * 6);
  const mmPerIn = Math.exp(zKey / 6) / SCREEN_PX_PER_MM;
  const structural = discipline === 'structural';
  const mode = structural ? 'framing' : 'plan';
  const bars = useMemo(() => (discipline === 'architectural' ? new Map() : allRebarBars(model)), [model, discipline]);
  const warnings = useMemo(() => (discipline === 'architectural' ? [] : structuralWarnings(model)), [model, discipline]);
  const levelWalls = useMemo(() => entities.filter((e): e is WallEntity => e.type === 'wall'), [entities]);

  const sel = (id: string) => (selectedIds.has(id) ? '#d97706' : undefined);
  const drawn = entities.filter((e) => STRUCT_TYPES.has(e.type) || (discipline !== 'architectural' && ((e.type === 'floor' && (e.structural || e.foundation)) || (e.type === 'wall' && e.structural))));
  // hosts whose rebar is shown: View rebar on, or the host / bar set selected
  const rebarShown = (e: ArchEntity) => {
    if (viewRebar) return true;
    if (selectedIds.has(e.id)) return true;
    const hostId = (e as { hostId?: string }).hostId;
    return !!hostId && selectedIds.has(hostId);
  };
  // order: slabs, footings, walls extras, beams/systems, columns, rebar, the rest
  const rank: Record<string, number> = { floor: 0, footing: 1, wall: 2, beamsystem: 3, beam: 4, column: 5, sjoint: 6, rebar: 7, areareinf: 7, connection: 8, load: 9, section: 10 };
  const ordered = [...drawn].sort((a, b) => (rank[a.type] ?? 5) - (rank[b.type] ?? 5));

  const preview = (() => {
    if (!drawingPoints.length) return null;
    const pts = [...drawingPoints, cursor];
    const closed = activeTool === 'foundationslab' || activeTool === 'load';
    if (!TWO_POINT.includes(activeTool) && !closed) return null;
    return <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={closed ? 'rgba(34,197,94,0.08)' : 'none'} stroke="#16a34a" strokeWidth={1.4 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} pointerEvents="none" />;
  })();

  return (
    <>
      {structural && <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill={darkMode ? '#0c0a09' : '#ffffff'} opacity={0.66} pointerEvents="none" />}
      {/* structural walls: material pattern + strong outline over the veil */}
      {structural &&
        levelWalls
          .filter((w) => w.structural)
          .map((w) => {
            const polys = computeWallPlanPolygons(w, levelWalls, entities);
            const matId = wallStructuralMaterialId(w);
            return (
              <g key={`sw-${w.id}`} onClick={(e) => onEntityClick(e, w)} onContextMenu={(e) => onEntityContextMenu(e, w)} className="cursor-pointer">
                <PrimsWorld
                  zoom={zoom}
                  onPrimClick={() => undefined}
                  prims={polys.flatMap((p) => [...materialPatternPrims(p, matId, (mm) => mm / mmPerIn, 3), { k: 'poly' as const, pts: p, closed: true, stroke: sel(w.id) || '#1c1917', w: 0.35 }])}
                />
              </g>
            );
          })}
      {ordered.map((e) => {
        if (e.type === 'rebar' || e.type === 'areareinf') {
          if (discipline === 'architectural' || !rebarShown(e)) return null;
        }
        const prims = buildStructuralPlanPrims(model, e, mmPerIn, { mode, color: sel(e.id), hit: true, bars, showRebar: true });
        if (!prims.length) return null;
        return (
          <g
            key={`st-${e.id}`}
            onClick={(ev) => {
              if (e.type === 'section' && onOpenSection && ev.detail >= 2) {
                ev.stopPropagation();
                onOpenSection(e.id);
                return;
              }
              onEntityClick(ev, e);
            }}
            onDoubleClick={(ev) => {
              if (e.type === 'section' && onOpenSection) {
                ev.stopPropagation();
                onOpenSection(e.id);
              }
            }}
            onContextMenu={(ev) => onEntityContextMenu(ev, e)}
            className="cursor-pointer"
          >
            <PrimsWorld prims={prims} zoom={zoom} onPrimClick={() => undefined} />
          </g>
        );
      })}
      {discipline !== 'architectural' && (
        <g pointerEvents="none">
          <PrimsWorld prims={concreteJoinPrims(model, levelId, false)} zoom={zoom} />
        </g>
      )}
      {analytical && discipline !== 'architectural' && (
        <g pointerEvents="none">
          <PrimsWorld prims={analyticalPrims(model, levelId, mmPerIn)} zoom={zoom} />
        </g>
      )}
      {discipline !== 'architectural' && warnings.length > 0 && (
        <g pointerEvents="none">
          <PrimsWorld
            prims={warningPrims(
              warnings.filter((w) => entities.some((e) => e.id === w.entityId)),
              mmPerIn
            )}
            zoom={zoom}
          />
        </g>
      )}
      {preview}
    </>
  );
};
