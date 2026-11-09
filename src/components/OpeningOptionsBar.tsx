import React, { useState } from 'react';
import type { ArchModel, ToolId, UnitSystem } from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import { isOpeningTool, type OpeningToolState } from './OpeningsPlanLayer';
import { groupedDoorOptions } from './OpeningProperties';

const TITLE: Record<string, string> = { door: 'DOOR (DR)', window: 'WINDOW (WN)', wallopening: 'WALL OPENING (WO)' };

/** Options bar for Door / Window / Wall Opening placement (common options; advanced under More…). */
export const OpeningOptionsBar: React.FC<{
  activeTool: ToolId;
  model: ArchModel;
  ot: OpeningToolState;
  onChange: (next: OpeningToolState) => void;
  units: UnitSystem;
  darkMode: boolean;
}> = ({ activeTool, model, ot, onChange, units, darkMode }) => {
  const [more, setMore] = useState(false);
  if (!isOpeningTool(activeTool)) return null;
  const box = `absolute top-2 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border shadow-lg text-xs max-w-[96%] ${
    darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800'
  }`;
  const input = `px-1.5 py-0.5 rounded border font-mono text-xs w-20 ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const sel = `${input} w-auto font-sans`;
  const seg = (on: boolean) =>
    `px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
      on ? 'bg-sky-600 border-sky-600 text-white' : darkMode ? 'border-stone-700 text-stone-300 hover:bg-stone-800' : 'border-stone-300 text-stone-600 hover:bg-stone-100'
    }`;
  const set = (patch: Partial<OpeningToolState>) => onChange({ ...ot, ...patch });
  const fmt = (v: number) => (v < 0 ? '-' : '') + formatLength(Math.abs(v), units);
  const Len: React.FC<{ label: string; value: number; onSet: (v: number) => void; min?: number; signed?: boolean }> = ({ label, value, onSet, min = 0, signed }) => (
    <label className="flex items-center gap-1">
      <span className="text-stone-500">{label}</span>
      <input
        aria-label={label}
        className={input}
        defaultValue={fmt(value)}
        key={`${label}-${value}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const neg = signed && raw.startsWith('-');
          const v = parseLengthInput(neg ? raw.slice(1) : raw, units);
          if (v !== null && v >= min) onSet(neg ? -v : v);
          else e.target.value = fmt(value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
  const depthKind = typeof ot.depthPosition === 'number' ? 'custom' : ot.depthPosition;

  return (
    <div className={box} data-testid="opening-options-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="font-bold text-sky-600">{TITLE[activeTool]}</span>
      {activeTool === 'door' && (
        <select aria-label="Door type" className={sel} value={ot.doorTypeId || model.doorTypes?.[0]?.id} onChange={(e) => set({ doorTypeId: e.target.value })}>
          {groupedDoorOptions(model.doorTypes ?? [])}
        </select>
      )}
      {activeTool === 'window' && (
        <select aria-label="Window type" className={sel} value={ot.windowTypeId || model.windowTypes?.[0]?.id} onChange={(e) => set({ windowTypeId: e.target.value, sill: undefined })}>
          {(model.windowTypes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {activeTool === 'wallopening' && (
        <>
          <div className="flex items-center gap-1" role="group" aria-label="Opening shape">
            <button type="button" className={seg(ot.woShape === 'rect')} onClick={() => set({ woShape: 'rect' })}>
              Rectangular
            </button>
            <button type="button" className={seg(ot.woShape === 'arch')} onClick={() => set({ woShape: 'arch' })}>
              Arched
            </button>
          </div>
          <Len label="W" value={ot.woWidth} min={6} onSet={(v) => set({ woWidth: v })} />
          <Len label="H" value={ot.woHeight} min={6} onSet={(v) => set({ woHeight: v })} />
        </>
      )}
      {activeTool !== 'wallopening' && (
        <div className="flex items-center gap-1" role="group" aria-label="Depth position">
          <span className="text-stone-500">Depth</span>
          {(['exterior', 'center', 'interior'] as const).map((d) => (
            <button key={d} type="button" className={seg(depthKind === d)} onClick={() => set({ depthPosition: d })} title={`Frame at the ${d} of the wall thickness`}>
              {d === 'exterior' ? 'Ext' : d === 'center' ? 'Center' : 'Int'}
            </button>
          ))}
        </div>
      )}
      {activeTool !== 'wallopening' && (
        <button type="button" className={seg(ot.flip)} onClick={() => set({ flip: !ot.flip })} title="SPACE while placing">
          ⇅ Flip (Space)
        </button>
      )}
      {activeTool === 'door' && (
        <button type="button" className={seg(false)} onClick={() => set({ hand: ot.hand === 'left' ? 'right' : 'left' })} title="Shift+Space while placing">
          Hinge: {ot.hand === 'left' ? 'Left' : 'Right'}
        </button>
      )}
      <label className="flex items-center gap-1 cursor-pointer" title="Snap to the wall midpoint">
        <input type="checkbox" checked={ot.snapCenter} onChange={(e) => set({ snapCenter: e.target.checked })} /> Center
      </label>
      <label className="flex items-center gap-1 cursor-pointer" title="Snap to equal spacing between neighbouring openings / wall ends">
        <input type="checkbox" checked={ot.snapEq} onChange={(e) => set({ snapEq: e.target.checked })} /> EQ
      </label>
      <button type="button" className="text-sky-600 font-semibold hover:underline" onClick={() => setMore((v) => !v)} aria-expanded={more}>
        {more ? 'Less' : 'More…'}
      </button>
      {more && (
        <div className="basis-full flex flex-wrap items-center gap-2 pt-1 border-t border-stone-500/20">
          {activeTool !== 'wallopening' && (
            <Len
              label="Custom depth (from centre, + toward exterior)"
              signed
              value={typeof ot.depthPosition === 'number' ? ot.depthPosition : 0}
              onSet={(v) => set({ depthPosition: v })}
            />
          )}
          {activeTool === 'window' && (
            <Len
              label="Sill height"
              value={ot.sill ?? (model.windowTypes ?? []).find((t) => t.id === ot.windowTypeId)?.sillHeight ?? model.windowTypes?.[0]?.sillHeight ?? 36}
              onSet={(v) => set({ sill: v })}
            />
          )}
          {activeTool === 'wallopening' && <Len label="Sill height" value={ot.woSill} onSet={(v) => set({ woSill: v })} />}
        </div>
      )}
      <span className="text-stone-400 hidden xl:inline">Hover a wall · click to place · blue numbers are editable · Esc to finish</span>
    </div>
  );
};
