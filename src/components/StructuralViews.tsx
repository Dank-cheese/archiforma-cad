import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Network, AlertTriangle } from 'lucide-react';
import type { ArchModel, SectionEntity } from '../types/model';
import { primitiveBounds, type PlanPrim } from '../engine/planPrimitives';
import { PrimsWorld, SCREEN_PX_PER_MM } from './PrimsWorld';
import { buildStructuralLevelPrims } from '../engine/structurePlan';
import { computeStructuralSection } from '../engine/structureSection';
import { STRUCTURAL_DISCLAIMER, structuralWarnings } from '../engine/structure';

export type StructuralViewKind = 'foundationplan' | 'framingplan' | 'stsection';

/** FOUNDATION PLAN, FRAMING PLAN (per level) and STRUCTURAL SECTION views. Live from the model. */
export const StructuralView: React.FC<{
  model: ArchModel;
  kind: StructuralViewKind;
  levelId: string;
  onChangeLevel: (id: string) => void;
  sectionId?: string;
  onChangeSection: (id: string) => void;
  analytical: boolean;
  onToggleAnalytical: () => void;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  darkMode: boolean;
}> = ({ model, kind, levelId, onChangeLevel, sectionId, onChangeSection, analytical, onToggleAnalytical, selectedIds, onSelectIds, darkMode }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1.5, panX: 200, panY: 150 });
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomKey = Math.round(Math.log(view.zoom) * 8);
  const mmPerIn = Math.exp(zoomKey / 8) / SCREEN_PX_PER_MM;
  const sections = model.entities.filter((e): e is SectionEntity => e.type === 'section');
  const section = sections.find((s) => s.id === sectionId) || sections[0];
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const prims: PlanPrim[] = useMemo(() => {
    if (kind === 'stsection') return section ? computeStructuralSection(model, section, { mmPerIn }).prims : [];
    return buildStructuralLevelPrims(model, levelId, mmPerIn, kind === 'foundationplan' ? 'foundation' : 'framing', { analytical, selectedIds: selSet, hit: true, warnings: true });
  }, [model, kind, levelId, mmPerIn, analytical, selSet, section]);
  const bounds = useMemo(() => primitiveBounds(prims), [prims]);
  const fit = () => {
    const el = wrapRef.current;
    if (!el || !bounds) return;
    const w = el.clientWidth || 1000;
    const h = (el.clientHeight || 600) - 70;
    const z = Math.max(0.2, Math.min(10, Math.min((w - 120) / Math.max(1, bounds.maxX - bounds.minX), (h - 80) / Math.max(1, bounds.maxY - bounds.minY))));
    setView({ zoom: z, panX: w / 2 - ((bounds.minX + bounds.maxX) / 2) * z, panY: h / 2 + 10 - ((bounds.minY + bounds.maxY) / 2) * z });
  };
  useEffect(() => {
    requestAnimationFrame(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, levelId, section?.id]);
  const warnings = useMemo(() => structuralWarnings(model), [model]);
  const title = kind === 'foundationplan' ? 'Foundation Plan' : kind === 'framingplan' ? 'Framing Plan' : 'Structural Section';
  const bar = darkMode ? 'border-stone-800 bg-stone-900 text-stone-200' : 'border-stone-200 bg-stone-50 text-stone-800';
  const selectCls = `px-1.5 py-0.5 rounded border text-xs ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  return (
    <div ref={wrapRef} className={`flex-1 h-full relative flex flex-col ${darkMode ? 'bg-stone-950' : 'bg-white'}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs flex-wrap ${bar}`}>
        <span className="font-bold uppercase tracking-wide">{title}</span>
        {kind === 'framingplan' && (
          <select aria-label="Framing plan level" value={levelId} onChange={(e) => onChangeLevel(e.target.value)} className={selectCls}>
            {(model.levels || []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {kind === 'stsection' && (
          <select aria-label="Section" value={section?.id || ''} onChange={(e) => onChangeSection(e.target.value)} className={selectCls}>
            {sections.length === 0 && <option value="">No sections — draw one with SECTION (SEC)</option>}
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {kind === 'framingplan' && (
          <button type="button" aria-pressed={analytical} onClick={onToggleAnalytical} className={`px-2 py-1 rounded font-semibold border cursor-pointer flex items-center gap-1 ${analytical ? 'bg-purple-600 text-white border-purple-600' : 'border-stone-300 dark:border-stone-700'}`}>
            <Network className="w-3.5 h-3.5" /> Analytical
          </button>
        )}
        <button type="button" onClick={fit} className="px-2 py-1 rounded font-semibold border cursor-pointer flex items-center gap-1 border-stone-300 dark:border-stone-700">
          <Maximize2 className="w-3.5 h-3.5" /> Fit
        </button>
        {kind !== 'stsection' && warnings.length > 0 && (
          <span className="flex items-center gap-1 text-red-600 font-semibold" title={warnings.map((w) => `• ${w.message}`).join('\n')}>
            <AlertTriangle className="w-3.5 h-3.5" /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto text-stone-500">Click to select · wheel = zoom · right-drag = pan</span>
      </div>
      <svg
        className="flex-1 w-full select-none"
        aria-label={title}
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
            onPrimClick={(id, e) => {
              e.stopPropagation();
              if (model.entities.some((x) => x.id === id)) onSelectIds(e.shiftKey ? Array.from(new Set([...selectedIds, id])) : [id]);
            }}
          />
        </g>
      </svg>
      <div className={`px-3 py-1 text-[11px] border-t ${darkMode ? 'border-stone-800 text-stone-400' : 'border-stone-200 text-stone-500'}`} role="note">
        ⚠ {STRUCTURAL_DISCLAIMER}
      </div>
    </div>
  );
};
