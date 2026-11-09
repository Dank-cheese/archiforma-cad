import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Maximize2, Sun, Layers } from 'lucide-react';
import type { ArchModel, ElevationAnnotation, ElevationDirection, Point, ToolId, WallEntity } from '../types/model';
import {
  computeElevation,
  curtainOf,
  finishDef,
  hitTestElevation,
  paintWallBand,
  splitWallFace,
  wallProfile,
  ElevationHit,
} from '../engine/facade';
import { formatLength } from '../engine/geometry';
import { PrimsWorld, SCREEN_PX_PER_MM } from './PrimsWorld';
import type { FacadeToolState } from './ToolOptionsBar';

const DIRS: ElevationDirection[] = ['north', 'south', 'east', 'west'];
const CYCLE: Record<string, 'glass' | 'solid' | 'door' | 'window'> = { glass: 'solid', solid: 'door', door: 'window', window: 'glass' };

interface Props {
  model: ArchModel;
  dir: ElevationDirection;
  onChangeDir: (d: ElevationDirection) => void;
  onUpdateModel: (next: ArchModel, label: string) => void;
  activeTool: ToolId;
  facadeTool: FacadeToolState;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  onLog: (text: string, kind?: 'input' | 'info' | 'error' | 'result') => void;
  darkMode: boolean;
}

/** Live orthographic elevation (N/S/E/W) with paint, split face, curtain-wall cells, tags and dimensions. */
export const FacadeElevationView: React.FC<Props> = ({ model, dir, onChangeDir, onUpdateModel, activeTool, facadeTool, selectedIds, onSelectIds, onLog, darkMode }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ zoom: 1.8, panX: 120, panY: 560 });
  const [shading, setShading] = useState(true);
  const [shadows, setShadows] = useState(true);
  const [hover, setHover] = useState<ElevationHit | null>(null);
  const [dimStart, setDimStart] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  /** Height grip drag on a selected door / window / wall opening (top = head, bottom = sill). */
  const [hDrag, setHDrag] = useState<{ id: string; edge: 'top' | 'bottom'; y0: number; cur: number } | null>(null);
  const skipClickRef = useRef(false);
  const fittedFor = useRef<string>('');

  const mmPerIn = view.zoom / SCREEN_PX_PER_MM;
  // recompute when the model changes (live) or the zoom changes enough to resize annotation
  const zoomKey = Math.round(Math.log(view.zoom) * 8);
  const drawing = useMemo(
    () => computeElevation(model, dir, { mmPerIn: Math.exp(zoomKey / 8) / SCREEN_PX_PER_MM, shading, shadows, annotations: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, dir, shading, shadows, zoomKey]
  );

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const b = drawing.bounds;
    const w = el.clientWidth || 1000;
    const h = el.clientHeight || 600;
    const z = Math.max(0.2, Math.min(12, Math.min((w - 80) / Math.max(1, b.maxX - b.minX), (h - 80) / Math.max(1, b.maxY - b.minY))));
    setView({ zoom: z, panX: w / 2 - ((b.minX + b.maxX) / 2) * z, panY: h / 2 - ((b.minY + b.maxY) / 2) * z });
  }, [drawing.bounds]);

  useEffect(() => {
    // fit once per direction (and on first show)
    if (fittedFor.current !== dir) {
      fittedFor.current = dir;
      requestAnimationFrame(fit);
    }
  }, [dir, fit]);

  useEffect(() => {
    if (!['dimension', 'dli', 'tag'].includes(activeTool)) setDimStart(null);
  }, [activeTool]);

  const toWorld = (cx: number, cy: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.panX) / view.zoom, y: (cy - r.top - view.panY) / view.zoom };
  };

  const setWall = (wallId: string, fn: (w: WallEntity) => WallEntity, label: string) => {
    onUpdateModel({ ...model, entities: model.entities.map((e) => (e.id === wallId && e.type === 'wall' ? fn(e) : e)) }, label);
  };
  const addAnnotation = (an: ElevationAnnotation, label: string) => {
    onUpdateModel({ ...model, elevationAnnotations: [...(model.elevationAnnotations || []), an] }, label);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    const hit = hitTestElevation(drawing, p);
    const z = -p.y;
    if (activeTool === 'dimension' || activeTool === 'dli') {
      if (!dimStart) {
        setDimStart(p);
        onLog('ELEVATION DIMENSION: click the second point.', 'info');
        return;
      }
      const vertical = Math.abs(p.y - dimStart.y) > Math.abs(p.x - dimStart.x);
      addAnnotation(
        {
          id: `edim-${Date.now()}`,
          view: dir,
          kind: 'dimension',
          p1: { u: dimStart.x, z: -dimStart.y },
          p2: vertical ? { u: dimStart.x, z } : { u: p.x, z: -dimStart.y },
          orientation: vertical ? 'vertical' : 'horizontal',
          offset: 8 * (SCREEN_PX_PER_MM / view.zoom) * 2.4,
        },
        'Add Elevation Dimension'
      );
      setDimStart(null);
      return;
    }
    if (!hit) {
      if (activeTool === 'select') onSelectIds([]);
      return;
    }
    const t = hit.target;
    if (activeTool === 'tag') {
      if (t.kind !== 'wall' && t.kind !== 'cw-cell') {
        onLog('TAG: click a wall face to tag its finish.', 'error');
        return;
      }
      addAnnotation(
        {
          id: `etag-${Date.now()}`,
          view: dir,
          kind: 'tag',
          p1: { u: p.x, z },
          p2: { u: p.x + 30 / view.zoom * 3, z: z + 24 / view.zoom * 3 },
          targetWallId: t.wallId,
          targetBand: t.kind === 'wall' && t.band !== null ? t.band : undefined,
        },
        'Tag Finish'
      );
      return;
    }
    if (activeTool === 'paint') {
      if (t.kind !== 'wall') {
        onLog('PAINT: click a wall face (curtain walls use panel types — click a cell with Select to cycle).', 'error');
        return;
      }
      if (!t.exterior) {
        onLog('PAINT: that is an interior face — set its interior finish in Properties.', 'info');
        return;
      }
      setWall(t.wallId, (w) => paintWallBand(w, t.band, facadeTool.finish), `Paint ${finishDef(facadeTool.finish).label}`);
      onLog(`PAINT: ${finishDef(facadeTool.finish).label} applied${t.band !== null ? ` to band ${t.band + 1}` : ''}.`, 'result');
      return;
    }
    if (activeTool === 'splitface') {
      if (t.kind !== 'wall' || !t.exterior) {
        onLog('SPLIT FACE: click an exterior wall face at the height to split.', 'error');
        return;
      }
      const wall = model.entities.find((x): x is WallEntity => x.type === 'wall' && x.id === t.wallId);
      if (!wall) return;
      const prof = wallProfile(model, wall);
      const H = Math.max(...prof.top.map((q) => q.z)) - prof.baseZ;
      const h = Math.round(z - prof.baseZ);
      const next = splitWallFace(wall, h, H);
      if (next === wall) {
        onLog('SPLIT FACE: too close to an existing split or the wall edge.', 'error');
        return;
      }
      setWall(t.wallId, () => next, `Split Face at ${formatLength(h, model.settings.units)}`);
      onLog(`SPLIT FACE: split at ${formatLength(h, model.settings.units)}. Use PAINT (PT) to give each part its own finish.`, 'result');
      return;
    }
    // select
    if (t.kind === 'cw-cell') {
      const wall = model.entities.find((x): x is WallEntity => x.type === 'wall' && x.id === t.wallId);
      if (!wall) return;
      const g = curtainOf(wall);
      const key = `${t.col},${t.row}`;
      const cur = g.panels?.[key] || 'glass';
      const nextType = CYCLE[cur];
      // doors only in the bottom row: elsewhere the cycle skips from Solid to Window
      const finalType = nextType === 'door' && t.row !== 0 ? 'window' : nextType;
      setWall(wall.id, (w) => ({ ...w, curtain: { ...curtainOf(w), panels: { ...(curtainOf(w).panels || {}), [key]: finalType } } }), `Curtain Panel: ${finalType}`);
      onLog(`Curtain panel (${t.col + 1}, ${t.row + 1}) → ${finalType}. Click again to cycle Glass → Solid → Door → Window${t.row !== 0 ? ' (doors only in the bottom row)' : ''}.`, 'result');
      onSelectIds([wall.id]);
      return;
    }
    const id = t.kind === 'wall' ? t.wallId : t.kind === 'roof' ? t.roofId : t.id;
    onSelectIds(e.shiftKey ? Array.from(new Set([...selectedIds, id])) : [id]);
  };

  const selectedHits = drawing.hits.filter((h) => {
    const t = h.target;
    const id = t.kind === 'wall' || t.kind === 'cw-cell' ? t.wallId : t.kind === 'roof' ? t.roofId : t.id;
    return selectedIds.includes(id);
  });

  // height grips for a single selected opening
  const gripOpening = (() => {
    if (activeTool !== 'select' || selectedIds.length !== 1) return null;
    const h = drawing.hits.find((x) => (x.target.kind === 'door' || x.target.kind === 'window' || x.target.kind === 'wallopening') && x.target.id === selectedIds[0]);
    if (!h) return null;
    const ent = model.entities.find((x) => x.id === selectedIds[0]);
    if (!ent || (ent.type !== 'door' && ent.type !== 'window' && ent.type !== 'wallopening')) return null;
    const xs = h.poly.map((q) => q.x);
    const ys = h.poly.map((q) => q.y);
    return { ent, cx: (Math.min(...xs) + Math.max(...xs)) / 2, top: Math.min(...ys), bottom: Math.max(...ys), x0: Math.min(...xs), x1: Math.max(...xs) };
  })();

  const commitHeightDrag = () => {
    if (!hDrag) return;
    const dz = Math.round(-(hDrag.cur - hDrag.y0));
    setHDrag(null);
    if (Math.abs(dz) < 0.5) return;
    const units = model.settings.units;
    const next = model.entities.map((x) => {
      if (x.id !== hDrag.id) return x;
      if (x.type === 'door') return hDrag.edge === 'top' ? { ...x, height: Math.max(48, x.height + dz) } : x;
      if (x.type === 'window' || x.type === 'wallopening') {
        if (hDrag.edge === 'top') return { ...x, height: Math.max(6, x.height + dz) };
        const d2 = Math.max(-x.sillHeight, Math.min(x.height - 6, dz));
        return { ...x, sillHeight: x.sillHeight + d2, height: x.height - d2 };
      }
      return x;
    });
    onUpdateModel({ ...model, entities: next }, hDrag.edge === 'top' ? 'Change Opening Height (grip)' : 'Change Sill Height (grip)');
    onLog(`${hDrag.edge === 'top' ? 'Head' : 'Sill'} moved ${dz > 0 ? 'up' : 'down'} ${formatLength(Math.abs(dz), units)}.`, 'result');
  };

  const exportPng = () => {
    const b = drawing.bounds;
    const z = 3;
    const pad = 40;
    const W = Math.ceil((b.maxX - b.minX) * z + pad * 2);
    const H = Math.ceil((b.maxY - b.minY) * z + pad * 2);
    const g = svgRef.current?.querySelector('g[data-drawing]');
    if (!g) return;
    const k = SCREEN_PX_PER_MM / view.zoom; // keep current annotation proportions
    void k;
    const inner = g.innerHTML;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${pad - b.minX * z} ${pad - b.minY * z}) scale(${z})">${inner}</g></svg>`;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      c.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(model.projectName || 'archiforma').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()}_${dir}_elevation.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        onLog(`Exported ${dir} elevation as PNG.`, 'result');
      }, 'image/png');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const hint =
    activeTool === 'paint'
      ? `PAINT (PT): click a wall face to apply ${finishDef(facadeTool.finish).label}`
      : activeTool === 'splitface'
      ? 'SPLIT FACE (SF): click a wall face at the height where the finish should change'
      : activeTool === 'tag'
      ? 'TAG (TG): click a wall face to tag its finish'
      : activeTool === 'dimension' || activeTool === 'dli'
      ? dimStart
        ? 'DIMENSION: click the second point'
        : 'DIMENSION: click the first point'
      : 'Click to select · curtain-wall cells cycle Glass → Solid → Door → Window · wheel = zoom, drag = pan';

  const btn = (on: boolean) =>
    `px-2 py-1 rounded text-xs font-semibold border cursor-pointer flex items-center gap-1 ${
      on ? 'bg-amber-600 border-amber-600 text-white' : darkMode ? 'border-stone-700 text-stone-300 hover:bg-stone-800' : 'border-stone-300 text-stone-700 hover:bg-stone-100'
    }`;

  return (
    <div ref={wrapRef} className={`flex-1 h-full relative flex flex-col ${darkMode ? 'bg-stone-950' : 'bg-white'}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs ${darkMode ? 'border-stone-800 bg-stone-900 text-stone-200' : 'border-stone-200 bg-stone-50 text-stone-800'}`}>
        <span className="font-bold uppercase tracking-wide">Elevation</span>
        <div className="flex gap-1" role="tablist" aria-label="Elevation direction">
          {DIRS.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={d === dir} onClick={() => onChangeDir(d)} className={btn(d === dir)}>
              {d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-stone-300 dark:bg-stone-700" />
        <button type="button" aria-pressed={shading} onClick={() => setShading((v) => !v)} className={btn(shading)} title="Light shading">
          <Layers className="w-3.5 h-3.5" /> Shading
        </button>
        <button type="button" aria-pressed={shadows} onClick={() => setShadows((v) => !v)} className={btn(shadows)} title="Eave shadows">
          <Sun className="w-3.5 h-3.5" /> Shadows
        </button>
        <button type="button" onClick={fit} className={btn(false)} title="Zoom to fit">
          <Maximize2 className="w-3.5 h-3.5" /> Fit
        </button>
        <button type="button" onClick={exportPng} className={btn(false)} title="Export this elevation as PNG">
          <Download className="w-3.5 h-3.5" /> PNG
        </button>
        <span className="ml-auto text-stone-500 truncate">{hint}</span>
      </div>
      <svg
        ref={svgRef}
        className="flex-1 w-full select-none"
        style={{ cursor: activeTool === 'paint' ? 'cell' : activeTool === 'splitface' ? 'row-resize' : 'default' }}
        aria-label={`${dir} elevation`}
        onWheel={(e) => {
          const r = svgRef.current!.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const z = Math.max(0.15, Math.min(20, v.zoom * f));
            return { zoom: z, panX: mx - ((mx - v.panX) / v.zoom) * z, panY: my - ((my - v.panY) / v.zoom) * z };
          });
        }}
        onPointerDown={(e) => {
          if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
            panRef.current = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (hDrag) {
            const p = toWorld(e.clientX, e.clientY);
            setHDrag({ ...hDrag, cur: Math.round(p.y) });
            return;
          }
          if (panRef.current) {
            const d = panRef.current;
            setView((v) => ({ ...v, panX: d.px + e.clientX - d.x, panY: d.py + e.clientY - d.y }));
            return;
          }
          const p = toWorld(e.clientX, e.clientY);
          setCursor(p);
          setHover(hitTestElevation(drawing, p));
        }}
        onPointerUp={() => {
          panRef.current = null;
          if (hDrag) {
            skipClickRef.current = true;
            commitHeightDrag();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (e.button === 0 && !e.altKey) handleClick(e);
        }}
      >
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          <g data-drawing="">
            <PrimsWorld prims={drawing.prims} zoom={view.zoom} />
          </g>
          {selectedHits.map((h, i) => (
            <polygon key={`sel-${i}`} points={h.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill="rgba(245,158,11,0.12)" stroke="#d97706" strokeWidth={2 / view.zoom} pointerEvents="none" />
          ))}
          {hover && (
            <polygon
              points={hover.poly.map((q) => `${q.x},${q.y}`).join(' ')}
              fill={activeTool === 'paint' ? `${finishDef(facadeTool.finish).color}66` : 'rgba(34,197,94,0.08)'}
              stroke={activeTool === 'paint' || activeTool === 'splitface' ? '#16a34a' : '#22C55E'}
              strokeWidth={1.5 / view.zoom}
              pointerEvents="none"
            />
          )}
          {activeTool === 'splitface' && hover && cursor && hover.target.kind === 'wall' && (
            <line x1={Math.min(...hover.poly.map((q) => q.x))} x2={Math.max(...hover.poly.map((q) => q.x))} y1={cursor.y} y2={cursor.y} stroke="#16a34a" strokeWidth={2 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} pointerEvents="none" />
          )}
          {gripOpening && (() => {
            const g = gripOpening;
            const sz = 7 / view.zoom;
            const edges: Array<'top' | 'bottom'> = g.ent.type === 'door' ? ['top'] : ['top', 'bottom'];
            return (
              <g data-testid="elevation-height-grips">
                {hDrag && (
                  <>
                    <line x1={g.x0} x2={g.x1} y1={hDrag.cur} y2={hDrag.cur} stroke="#0ea5e9" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${3 / view.zoom}`} pointerEvents="none" />
                    <text x={g.x1 + 6 / view.zoom} y={hDrag.cur} fontSize={11 / view.zoom} fill="#0369a1" dominantBaseline="central" fontFamily="JetBrains Mono, monospace" fontWeight={700} pointerEvents="none">
                      {formatLength(Math.abs(hDrag.cur - hDrag.y0), model.settings.units)} {hDrag.cur < hDrag.y0 ? '↑' : '↓'}
                    </text>
                  </>
                )}
                {edges.map((edge) => {
                  const y = edge === 'top' ? g.top : g.bottom;
                  return (
                    <rect
                      key={edge}
                      data-testid={`height-grip-${edge}`}
                      x={g.cx - sz / 2}
                      y={y - sz / 2}
                      width={sz}
                      height={sz}
                      fill="#0ea5e9"
                      stroke="#ffffff"
                      strokeWidth={1 / view.zoom}
                      style={{ cursor: 'ns-resize' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (svgRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                        setHDrag({ id: g.ent.id, edge, y0: y, cur: y });
                      }}
                    >
                      <title>{edge === 'top' ? 'Drag to change the head height' : 'Drag to change the sill height'}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })()}
          {dimStart && cursor && (
            <line x1={dimStart.x} y1={dimStart.y} x2={cursor.x} y2={cursor.y} stroke="#d97706" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${3 / view.zoom}`} pointerEvents="none" />
          )}
        </g>
      </svg>
      <div className={`absolute bottom-2 left-3 text-[11px] font-mono px-2 py-0.5 rounded ${darkMode ? 'bg-stone-900/80 text-stone-300' : 'bg-white/80 text-stone-600'}`}>
        {hover
          ? hover.target.kind === 'wall'
            ? `Wall ${hover.target.exterior ? 'exterior' : 'interior'} face${hover.target.band !== null ? ` · band ${hover.target.band + 1}` : ''}`
            : hover.target.kind === 'cw-cell'
            ? `Curtain panel ${hover.target.col + 1},${hover.target.row + 1}`
            : hover.target.kind
          : `${dir.toUpperCase()} ELEVATION`}
        {cursor ? `  ·  z = ${formatLength(-cursor.y, model.settings.units)}` : ''}
      </div>
    </div>
  );
};
