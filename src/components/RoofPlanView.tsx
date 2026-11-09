import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { ArchModel } from '../types/model';
import { buildRoofPlanPrimitives, primitiveBounds } from '../engine/planPrimitives';
import { PrimsWorld, SCREEN_PX_PER_MM } from './PrimsWorld';

/** ROOF PLAN: every roof seen from above — shaded faces, ridges/hips/valleys, slope arrows. */
export const RoofPlanView: React.FC<{
  model: ArchModel;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  darkMode: boolean;
}> = ({ model, selectedIds, onSelectIds, darkMode }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1.5, panX: 200, panY: 150 });
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomKey = Math.round(Math.log(view.zoom) * 8);
  const prims = useMemo(() => buildRoofPlanPrimitives(model, Math.exp(zoomKey / 8) / SCREEN_PX_PER_MM), [model, zoomKey]);
  const bounds = useMemo(() => primitiveBounds(prims), [prims]);
  const fit = () => {
    const el = wrapRef.current;
    if (!el || !bounds) return;
    const w = el.clientWidth || 1000;
    const h = el.clientHeight || 600;
    const z = Math.max(0.2, Math.min(10, Math.min((w - 120) / Math.max(1, bounds.maxX - bounds.minX), (h - 120) / Math.max(1, bounds.maxY - bounds.minY))));
    setView({ zoom: z, panX: w / 2 - ((bounds.minX + bounds.maxX) / 2) * z, panY: h / 2 - ((bounds.minY + bounds.maxY) / 2) * z });
  };
  useEffect(() => {
    requestAnimationFrame(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasRoofs = model.entities.some((e) => e.type === 'roof');
  return (
    <div ref={wrapRef} className={`flex-1 h-full relative flex flex-col ${darkMode ? 'bg-stone-950' : 'bg-white'}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs ${darkMode ? 'border-stone-800 bg-stone-900 text-stone-200' : 'border-stone-200 bg-stone-50 text-stone-800'}`}>
        <span className="font-bold uppercase tracking-wide">Roof Plan</span>
        <button type="button" onClick={fit} className="px-2 py-1 rounded text-xs font-semibold border cursor-pointer flex items-center gap-1 border-stone-300 dark:border-stone-700">
          <Maximize2 className="w-3.5 h-3.5" /> Fit
        </button>
        <span className="ml-auto text-stone-500">
          {hasRoofs ? 'Click a roof to edit it in Properties · wheel = zoom, right-drag = pan' : 'No roofs yet — use ROOF (RF) in the plan to create one.'}
        </span>
      </div>
      <svg
        className="flex-1 w-full select-none"
        aria-label="Roof plan"
        onWheel={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const z = Math.max(0.15, Math.min(20, v.zoom * f));
            return { zoom: z, panX: mx - ((mx - v.panX) / v.zoom) * z, panY: my - ((my - v.panY) / v.zoom) * z };
          });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) panRef.current = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
        }}
        onPointerMove={(e) => {
          const d = panRef.current;
          if (d) setView((v) => ({ ...v, panX: d.px + e.clientX - d.x, panY: d.py + e.clientY - d.y }));
        }}
        onPointerUp={() => (panRef.current = null)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if ((e.target as Element).tagName === 'svg') onSelectIds([]);
        }}
      >
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          <PrimsWorld
            prims={prims}
            zoom={view.zoom}
            colorOverride={(p) => (p.id && selectedIds.includes(p.id) && p.k !== 'text' && !(p.k === 'poly' && p.fill && !p.stroke) ? '#d97706' : undefined)}
            onPrimClick={(id, e) => {
              e.stopPropagation();
              const ent = model.entities.find((x) => x.id === id);
              if (ent && ent.type !== 'wall') onSelectIds([id]);
            }}
          />
        </g>
      </svg>
    </div>
  );
};
