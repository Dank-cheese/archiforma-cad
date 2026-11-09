import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArchEntity,
  ArchModel,
  DetailLevel,
  ElevationDirection,
  LevelDefinition,
  Point,
  SheetScalePreset,
  UnitSystem,
  VisualStyle,
  WallEntity,
} from '../types/model';
import { dist, formatLength, parseLengthInput } from '../engine/geometry';
import {
  getElementCategory,
  ViewRenderContext,
  TestBoxEntity,
  isTestBoxEntity,
} from '../engine/elementRegistry';
import {
  Compass,
  Scissors,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sliders,
  Check,
} from 'lucide-react';

interface ElevationSectionViewProps {
  model: ArchModel;
  mode: 'elevation' | 'section';
  elevationDir?: ElevationDirection;
  sectionCoord?: number;
  onUpdateModel: (nextModel: ArchModel, actionLabel: string) => void;
  onLevelElevationChange: (levelId: string, newElevation: number) => void;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  units: UnitSystem;
  darkMode: boolean;
}

export const ElevationSectionView: React.FC<ElevationSectionViewProps> = ({
  model,
  mode,
  elevationDir = 'south',
  sectionCoord = 120,
  onUpdateModel,
  onLevelElevationChange,
  selectedIds,
  onSelectIds,
  units,
  darkMode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan & Zoom
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 380, y: 380 });
  const [zoom, setZoom] = useState<number>(1.2);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  // Level dragging state
  const [draggingLevelId, setDraggingLevelId] = useState<string | null>(null);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [editLevelText, setEditLevelText] = useState<string>('');

  // Per-view controls
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(
    model.viewDetailLevel || 'medium'
  );
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(
    model.viewVisualStyle || 'shaded'
  );
  const [viewScale, setViewScale] = useState<SheetScalePreset>(
    model.viewScale || '1/4" = 1\'-0"'
  );

  const levels = useMemo(
    () => (model.levels || []).slice().sort((a, b) => a.elevation - b.elevation),
    [model.levels]
  );
  const levelElevMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const lvl of levels) {
      map.set(lvl.id, lvl.elevation);
    }
    return map;
  }, [levels]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Elevation axis mapping:
  // South elevation: looking from South (-Y / +Y depending on orientation, viewing along X)
  // East elevation: viewing along Y
  // North elevation: viewing along X
  // West elevation: viewing along Y
  const axis: 'x' | 'y' = elevationDir === 'north' || elevationDir === 'south' ? 'x' : 'y';

  // World to SVG screen conversion
  // U = horizontal axis (X or Y), V = vertical elevation (Z in inches, inverted for SVG Y)
  const worldToScreen = useCallback(
    (u: number, z: number): { x: number; y: number } => {
      return {
        x: pan.x + u * zoom,
        y: pan.y - z * zoom,
      };
    },
    [pan, zoom]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): { u: number; z: number } => {
      return {
        u: (sx - pan.x) / zoom,
        z: (pan.y - sy) / zoom,
      };
    },
    [pan, zoom]
  );

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey || e.shiftKey) {
      // Middle click or Alt/Shift+click to pan
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
      return;
    }

    if (draggingLevelId) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sy = e.clientY - rect.top;
      const { z } = screenToWorld(0, sy);
      // Snap to nearest 6" or 12"
      const snappedZ = Math.round(z / 6) * 6;
      onLevelElevationChange(draggingLevelId, Math.max(0, snappedZ));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (draggingLevelId) {
      setDraggingLevelId(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom((prev) => {
      const next = Math.max(0.15, Math.min(8, prev * factor));
      setPan((p) => ({
        x: mx - (mx - p.x) * (next / prev),
        y: my - (my - p.y) * (next / prev),
      }));
      return next;
    });
  };

  // Level drag start
  const startDragLevel = (e: React.MouseEvent, lvlId: string) => {
    e.stopPropagation();
    setDraggingLevelId(lvlId);
  };

  // Commit typed level elevation
  const handleCommitLevelElev = (lvlId: string) => {
    const parsed = parseLengthInput(editLevelText, units);
    if (parsed !== null && parsed >= 0) {
      onLevelElevationChange(lvlId, parsed);
    }
    setEditingLevelId(null);
  };

  // Determine view bounds for level lines
  const minU = -120;
  const maxU = 480;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex flex-col select-none ${
        darkMode ? 'bg-stone-950 text-stone-100' : 'bg-stone-100 text-stone-900'
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* View Header Control Bar */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b text-xs z-10 ${
          darkMode ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-amber-600">
            {mode === 'elevation' ? (
              <>
                <Compass className="w-4 h-4" />
                <span className="capitalize">{elevationDir} Elevation View</span>
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                <span>Building Section A-A (Cut @ {formatLength(sectionCoord, units)})</span>
              </>
            )}
          </div>

          <div className="h-4 w-px bg-stone-300 dark:bg-stone-700" />

          {/* Scale preset */}
          <div className="flex items-center gap-1 text-[11px] text-stone-500">
            <span>Scale:</span>
            <select
              value={viewScale}
              onChange={(e) => setViewScale(e.target.value as SheetScalePreset)}
              className="px-1.5 py-0.5 rounded border border-stone-300 dark:border-stone-700 bg-transparent text-xs"
            >
              <option value="1/4&quot; = 1'-0&quot;">1/4" = 1'-0"</option>
              <option value="1/8&quot; = 1'-0&quot;">1/8" = 1'-0"</option>
              <option value="1:50">1:50</option>
              <option value="1:100">1:100</option>
            </select>
          </div>

          {/* Detail Level */}
          <div className="flex items-center gap-1 text-[11px] text-stone-500">
            <span>Detail:</span>
            <div className="flex items-center rounded border border-stone-300 dark:border-stone-700 overflow-hidden text-[10px]">
              {(['coarse', 'medium', 'fine'] as DetailLevel[]).map((dl) => (
                <button
                  key={dl}
                  type="button"
                  onClick={() => setDetailLevel(dl)}
                  className={`px-2 py-0.5 capitalize ${
                    detailLevel === dl
                      ? 'bg-amber-600 text-white font-semibold'
                      : 'hover:bg-stone-500/10'
                  }`}
                >
                  {dl}
                </button>
              ))}
            </div>
          </div>

          {/* Visual Style */}
          <div className="flex items-center gap-1 text-[11px] text-stone-500">
            <span>Style:</span>
            <select
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
              className="px-1.5 py-0.5 rounded border border-stone-300 dark:border-stone-700 bg-transparent text-xs capitalize"
            >
              <option value="wireframe">Wireframe</option>
              <option value="hidden-line">Hidden Line</option>
              <option value="shaded">Shaded</option>
              <option value="realistic">Realistic</option>
            </select>
          </div>
        </div>

        {/* View Zoom & Extents shortcuts */}
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setZoom(1.0);
              setPan({ x: 380, y: 380 });
            }}
            className="p-1 rounded hover:bg-stone-500/15"
            title="Reset View (Zoom 1:1)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-stone-400 font-mono">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full flex-1 cursor-default"
        onClick={() => onSelectIds([])}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Ground Plane Line (Z = 0) */}
          <line
            x1={minU - 120}
            y1={0}
            x2={maxU + 120}
            y2={0}
            stroke={darkMode ? '#78716c' : '#44403c'}
            strokeWidth={3 / zoom}
          />
          {/* Ground Hash Pattern */}
          {Array.from({ length: 24 }).map((_, i) => {
            const gx = minU - 120 + i * 28;
            return (
              <line
                key={`ground-${i}`}
                x1={gx}
                y1={0}
                x2={gx - 14}
                y2={18}
                stroke={darkMode ? '#57534e' : '#a8a29e'}
                strokeWidth={1 / zoom}
              />
            );
          })}

          {/* 1. RENDER BUILDING ELEMENTS (Walls, Floors, Roofs, Stairs, Columns, TestBox) */}
          {model.entities.map((entity) => {
            const isSel = selectedSet.has(entity.id);
            const levelElev = levelElevMap.get(entity.levelId || 'level-1') || 0;

            const renderCtx: ViewRenderContext = {
              units,
              levelElevations: levelElevMap,
              activeLevelId: model.activeLevelId || 'level-1',
              detailLevel,
              visualStyle,
              isHovered: false,
              isSelected: isSel,
              zoom,
              allEntities: model.entities,
            };

            // Check if entity has registered generator
            const categoryDef = getElementCategory(
              entity.type === 'custom' ? (entity as any).customCategory : entity.type
            );

            if (mode === 'elevation' && categoryDef?.renderElevation2D) {
              const res = categoryDef.renderElevation2D(entity, axis, renderCtx);
              return (
                <g
                  key={entity.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIds([entity.id]);
                  }}
                  className="cursor-pointer"
                >
                  {res.paths.map((p, idx) => (
                    <path
                      key={idx}
                      d={p.d}
                      stroke={p.stroke || '#000'}
                      fill={p.fill || 'none'}
                      strokeWidth={(p.strokeWidth || 1) / zoom}
                      strokeDasharray={p.strokeDasharray}
                    />
                  ))}
                  {res.texts?.map((t, idx) => (
                    <text
                      key={idx}
                      x={t.x}
                      y={t.y}
                      fontSize={t.fontSize || 8}
                      fill={t.fill || '#334155'}
                      textAnchor="middle"
                    >
                      {t.text}
                    </text>
                  ))}
                </g>
              );
            }

            if (mode === 'section' && categoryDef?.renderSection2D) {
              const res = categoryDef.renderSection2D(
                entity,
                sectionCoord,
                axis,
                renderCtx
              );
              return (
                <g
                  key={entity.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIds([entity.id]);
                  }}
                  className="cursor-pointer"
                >
                  {res.paths.map((p, idx) => (
                    <path
                      key={idx}
                      d={p.d}
                      stroke={p.stroke || '#000'}
                      fill={p.fill || 'none'}
                      strokeWidth={(p.strokeWidth || 2) / zoom}
                    />
                  ))}
                </g>
              );
            }

            // Built-in Elevation/Section Generator for Walls
            if (entity.type === 'wall') {
              const w = entity as WallEntity;
              const u1 = axis === 'x' ? w.start.x : w.start.y;
              const u2 = axis === 'x' ? w.end.x : w.end.y;
              const minWallU = Math.min(u1, u2);
              const maxWallU = Math.max(u1, u2);
              const baseZ = levelElev + (w.baseOffset || 0);
              const topZ = baseZ + (w.height || 108);

              // Inverted SVG coordinates: Z is up, SVG Y is down
              const yTop = -topZ;
              const yBottom = -baseZ;

              const isGlass = w.wallTypeId === 'wt-glass';
              const fillColor = isSel
                ? '#f59e0b44'
                : visualStyle === 'wireframe'
                ? 'none'
                : isGlass
                ? '#38bdf844'
                : darkMode
                ? '#292524'
                : '#e7e5e4';

              const strokeColor = isSel
                ? '#f59e0b'
                : darkMode
                ? '#78716c'
                : '#44403c';

              return (
                <g
                  key={w.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIds([w.id]);
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={minWallU}
                    y={yTop}
                    width={Math.max(2, maxWallU - minWallU)}
                    height={topZ - baseZ}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={(isSel ? 2 : 1) / zoom}
                  />
                </g>
              );
            }

            // Floor Slabs in Elevation/Section
            if (entity.type === 'floor') {
              const fl = entity;
              const pts = fl.polygon;
              if (pts.length < 3) return null;
              const us = pts.map((p) => (axis === 'x' ? p.x : p.y));
              const minFloorU = Math.min(...us);
              const maxFloorU = Math.max(...us);
              const slabT = fl.thickness || 9.84; // default 250mm
              const ySlabTop = -levelElev;
              const ySlabBottom = -(levelElev - slabT);

              return (
                <rect
                  key={fl.id}
                  x={minFloorU}
                  y={ySlabTop}
                  width={maxFloorU - minFloorU}
                  height={slabT}
                  fill={visualStyle === 'wireframe' ? 'none' : '#78716c66'}
                  stroke={isSel ? '#f59e0b' : '#57534e'}
                  strokeWidth={1.5 / zoom}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIds([fl.id]);
                  }}
                  className="cursor-pointer"
                />
              );
            }

            return null;
          })}

          {/* 2. DRAGGABLE LEVEL LINES WITH LEVEL BUBBLE HEADS */}
          {levels.map((lvl) => {
            const z = lvl.elevation;
            const y = -z;
            const isDragging = draggingLevelId === lvl.id;
            const isActiveLevel = lvl.id === model.activeLevelId;

            return (
              <g key={lvl.id} className="select-none">
                {/* Level Datum Line */}
                <line
                  x1={minU - 40}
                  y1={y}
                  x2={maxU + 80}
                  y2={y}
                  stroke={
                    isDragging
                      ? '#f59e0b'
                      : isActiveLevel
                      ? '#0284c7'
                      : darkMode
                      ? '#64748b'
                      : '#94a3b8'
                  }
                  strokeWidth={(isDragging || isActiveLevel ? 2 : 1) / zoom}
                  strokeDasharray={`${8 / zoom},${4 / zoom}`}
                />

                {/* Left Bubble Tag */}
                <g
                  transform={`translate(${minU - 50}, ${y})`}
                  onMouseDown={(e) => startDragLevel(e, lvl.id)}
                  className="cursor-ns-resize"
                >
                  <circle
                    r={14 / Math.sqrt(zoom)}
                    fill={isDragging ? '#f59e0b' : isActiveLevel ? '#0284c7' : '#3b82f6'}
                    stroke="#ffffff"
                    strokeWidth={1.5 / zoom}
                  />
                  <line
                    x1={0}
                    y1={-14 / Math.sqrt(zoom)}
                    x2={0}
                    y2={14 / Math.sqrt(zoom)}
                    stroke="#ffffff"
                    strokeWidth={1 / zoom}
                  />
                  <line
                    x1={-14 / Math.sqrt(zoom)}
                    y1={0}
                    x2={14 / Math.sqrt(zoom)}
                    y2={0}
                    stroke="#ffffff"
                    strokeWidth={1 / zoom}
                  />
                </g>

                {/* Right Interactive Elevation Label */}
                <g transform={`translate(${maxU + 90}, ${y})`}>
                  <text
                    x={0}
                    y={-4 / zoom}
                    fontSize={10 / Math.sqrt(zoom)}
                    fontWeight="bold"
                    fill={isActiveLevel ? '#0284c7' : darkMode ? '#e2e8f0' : '#1e293b'}
                    className="cursor-pointer"
                    onClick={() => {
                      onUpdateModel(
                        { ...model, activeLevelId: lvl.id },
                        `Switch Active Level to ${lvl.name}`
                      );
                    }}
                  >
                    {lvl.name} {isActiveLevel && '★'}
                  </text>
                  <text
                    x={0}
                    y={10 / zoom}
                    fontSize={9 / Math.sqrt(zoom)}
                    fontFamily="monospace"
                    fill={isDragging ? '#f59e0b' : darkMode ? '#94a3b8' : '#64748b'}
                    className="cursor-pointer font-mono"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingLevelId(lvl.id);
                      setEditLevelText(formatLength(lvl.elevation, units));
                    }}
                  >
                    EL. {formatLength(lvl.elevation, units)}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Inline Level Elevation Editor Modal */}
      {editingLevelId && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50">
          <div
            className={`p-4 rounded-lg shadow-xl border w-80 space-y-3 ${
              darkMode ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-600">
              <Layers className="w-4 h-4" />
              <span>Edit Level Elevation</span>
            </div>
            <p className="text-xs text-stone-500">
              Changing this level will trigger parametric recomputations for all hosted
              walls, stairs, floors, and elements.
            </p>
            <input
              type="text"
              autoFocus
              value={editLevelText}
              onChange={(e) => setEditLevelText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitLevelElev(editingLevelId);
                if (e.key === 'Escape') setEditingLevelId(null);
              }}
              placeholder={`e.g. 108" or 3000mm`}
              className="w-full px-2.5 py-1.5 rounded border text-xs font-mono bg-transparent"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingLevelId(null)}
                className="px-3 py-1 rounded text-xs border border-stone-300 dark:border-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCommitLevelElev(editingLevelId)}
                className="px-3 py-1 rounded text-xs bg-amber-600 text-white font-medium"
              >
                Apply &amp; Recompute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Hint Banner */}
      <div
        className={`px-3 py-1.5 border-t text-[11px] flex items-center justify-between z-10 ${
          darkMode
            ? 'bg-stone-900/90 border-stone-800 text-stone-400'
            : 'bg-white/90 border-stone-200 text-stone-600'
        }`}
      >
        <span>
          Tip: Drag the blue Level bubble heads vertically to adjust story heights live. Dependent
          elements recompute automatically.
        </span>
        <span>Middle-drag or Alt+drag to Pan • Wheel to Zoom</span>
      </div>
    </div>
  );
};
