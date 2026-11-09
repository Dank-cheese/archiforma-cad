import React, { useState } from 'react';
import type { ExteriorFinish, RailingStyle, RoofStyle, SweepProfile, ToolId, UnitSystem } from '../types/model';
import { EXTERIOR_FINISHES } from '../engine/facade';
import { formatSlope, parseSlopeInput, rise12ToDegrees } from '../engine/roof';
import { formatLength, parseLengthInput } from '../engine/geometry';

export interface RoofToolState {
  mode: 'pick' | 'sketch';
  style: RoofStyle;
  slope: number; // degrees
  pickedWallIds: string[];
}

export interface FacadeToolState {
  finish: ExteriorFinish;
  sweepProfile: SweepProfile;
  sweepHeight: number;
  sweepSize: number;
  balconyWidth: number;
  balconyDepth: number;
  balconyElevation: number;
  railingStyle: RailingStyle;
  railingHeight: number;
  skylightWidth: number;
  skylightLength: number;
  dormerWidth: number;
  dormerHeight: number;
  cwHSpacing: number;
  cwVSpacing: number;
}

export const DEFAULT_ROOF_TOOL: RoofToolState = { mode: 'pick', style: 'gable', slope: rise12ToDegrees(4), pickedWallIds: [] };

export const DEFAULT_FACADE_TOOL: FacadeToolState = {
  finish: 'brick',
  sweepProfile: 'band',
  sweepHeight: 96,
  sweepSize: 8,
  balconyWidth: 96,
  balconyDepth: 48,
  balconyElevation: 108,
  railingStyle: 'balusters',
  railingHeight: 42,
  skylightWidth: 24,
  skylightLength: 48,
  dormerWidth: 60,
  dormerHeight: 42,
  cwHSpacing: 48,
  cwVSpacing: 48,
};

/** Little pictures for roof types (24×16). */
export const RoofStyleIcon: React.FC<{ style: RoofStyle; className?: string }> = ({ style, className }) => {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 16" className={className || 'w-6 h-4'} aria-hidden>
      {style === 'flat' && <path d="M3 7h18v3H3z M2 7h20" {...s} />}
      {style === 'shed' && <path d="M3 12 21 4v4L3 14z" {...s} />}
      {style === 'gable' && <path d="M2 13 12 3l10 10 M5 13V10 M19 13v-3" {...s} />}
      {style === 'hip' && <path d="M2 13 7 5h10l5 8z M7 5l-1 8 M17 5l1 8" {...s} />}
      {style === 'mansard' && <path d="M2 14 5 7h14l3 7z M5 7l3-4h8l3 4" {...s} />}
    </svg>
  );
};

export const ROOF_STYLES: Array<{ id: RoofStyle; label: string }> = [
  { id: 'flat', label: 'Flat' },
  { id: 'shed', label: 'Shed' },
  { id: 'gable', label: 'Gable' },
  { id: 'hip', label: 'Hip' },
  { id: 'mansard', label: 'Mansard' },
];

const FACADE_TOOLS: ToolId[] = ['paint', 'splitface', 'sweep', 'reveal', 'balcony', 'railing', 'skylight', 'dormer', 'curtainwall'];

/** Floating options bar for the roof and facade tools (simple by default, advanced under More…). */
export const ToolOptionsBar: React.FC<{
  activeTool: ToolId;
  roof: RoofToolState;
  onRoofChange: (next: RoofToolState) => void;
  onFinishRoof: () => void;
  facade: FacadeToolState;
  onFacadeChange: (next: FacadeToolState) => void;
  units: UnitSystem;
  darkMode: boolean;
}> = ({ activeTool, roof, onRoofChange, onFinishRoof, facade, onFacadeChange, units, darkMode }) => {
  const [more, setMore] = useState(false);
  if (activeTool !== 'roof' && !FACADE_TOOLS.includes(activeTool)) return null;
  const box = `absolute top-2 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border shadow-lg text-xs max-w-[96%] ${
    darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800'
  }`;
  const input = `px-1.5 py-0.5 rounded border font-mono text-xs w-20 ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const LengthField: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
    <label className="flex items-center gap-1">
      <span className="text-stone-500">{label}</span>
      <input
        aria-label={label}
        className={input}
        defaultValue={formatLength(value, units)}
        key={`${label}-${value}`}
        onBlur={(e) => {
          const v = parseLengthInput(e.target.value, units);
          if (v !== null && v > 0) onChange(v);
          else e.target.value = formatLength(value, units);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
  const setF = (patch: Partial<FacadeToolState>) => onFacadeChange({ ...facade, ...patch });

  if (activeTool === 'roof') {
    return (
      <div className={box} role="toolbar" aria-label="Roof tool options">
        <span className="font-bold text-amber-600">ROOF</span>
        <div className="flex rounded-md border overflow-hidden border-stone-300 dark:border-stone-700">
          {(['pick', 'sketch'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={roof.mode === m}
              onClick={() => onRoofChange({ ...roof, mode: m })}
              className={`px-2 py-0.5 cursor-pointer ${roof.mode === m ? 'bg-amber-600 text-white' : ''}`}
            >
              {m === 'pick' ? 'Pick walls' : 'Sketch'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Roof type">
          {ROOF_STYLES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={roof.style === r.id}
              title={`${r.label} roof`}
              onClick={() => onRoofChange({ ...roof, style: r.id })}
              className={`flex flex-col items-center px-1.5 py-0.5 rounded cursor-pointer ${roof.style === r.id ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}
            >
              <RoofStyleIcon style={r.id} />
              <span className="text-[9px] leading-none">{r.label}</span>
            </button>
          ))}
        </div>
        {roof.style !== 'flat' && (
          <label className="flex items-center gap-1">
            <span className="text-stone-500">Slope</span>
            <input
              aria-label="Roof slope"
              className={input}
              key={roof.slope}
              defaultValue={formatSlope(roof.slope)}
              title="4:12 or degrees (e.g. 18.4°)"
              onBlur={(e) => {
                const v = parseSlopeInput(e.target.value);
                if (v !== null && v > 0) onRoofChange({ ...roof, slope: v });
                else e.target.value = formatSlope(roof.slope);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="text-stone-400 font-mono">{roof.slope.toFixed(1)}°</span>
          </label>
        )}
        {roof.mode === 'pick' ? (
          <span className="text-stone-500">
            {roof.pickedWallIds.length} wall(s) · click walls, <kbd className="font-mono font-semibold">Tab</kbd> = whole chain
          </span>
        ) : (
          <span className="text-stone-500">click corners, close at the first point</span>
        )}
        <button type="button" onClick={onFinishRoof} className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold cursor-pointer hover:bg-amber-700">
          Finish ✓
        </button>
      </div>
    );
  }

  const finishPicker = (
    <label className="flex items-center gap-1">
      <span className="text-stone-500">Finish</span>
      <select aria-label="Exterior finish" value={facade.finish} onChange={(e) => setF({ finish: e.target.value as ExteriorFinish })} className={`${input} w-36 font-sans`}>
        {EXTERIOR_FINISHES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
  const title: Record<string, string> = {
    paint: 'PAINT (PT)',
    splitface: 'SPLIT FACE (SF)',
    sweep: 'SWEEP (SWP)',
    reveal: 'REVEAL (RVL)',
    balcony: 'BALCONY (BAL)',
    railing: 'RAILING (RAIL)',
    skylight: 'SKYLIGHT (SKY)',
    dormer: 'DORMER (DMR)',
    curtainwall: 'CURTAIN WALL (CW)',
  };
  return (
    <div className={box} role="toolbar" aria-label="Facade tool options">
      <span className="font-bold text-teal-600">{title[activeTool]}</span>
      {activeTool === 'paint' && (
        <>
          {finishPicker}
          <span className="text-stone-500">Click a wall face in an elevation, 3D or plan</span>
        </>
      )}
      {activeTool === 'splitface' && <span className="text-stone-500">In an elevation, click a wall face at the height to split it</span>}
      {(activeTool === 'sweep' || activeTool === 'reveal') && (
        <>
          {activeTool === 'sweep' && (
            <select aria-label="Sweep profile" value={facade.sweepProfile === 'reveal' ? 'band' : facade.sweepProfile} onChange={(e) => setF({ sweepProfile: e.target.value as SweepProfile })} className={`${input} w-24 font-sans`}>
              <option value="band">Band</option>
              <option value="cornice">Cornice</option>
              <option value="base">Base</option>
            </select>
          )}
          <LengthField label="Height" value={facade.sweepHeight} onChange={(v) => setF({ sweepHeight: v })} />
          {more && <LengthField label="Size" value={facade.sweepSize} onChange={(v) => setF({ sweepSize: v })} />}
          <span className="text-stone-500">Click a wall</span>
        </>
      )}
      {activeTool === 'balcony' && (
        <>
          <LengthField label="Width" value={facade.balconyWidth} onChange={(v) => setF({ balconyWidth: v })} />
          <LengthField label="Depth" value={facade.balconyDepth} onChange={(v) => setF({ balconyDepth: v })} />
          {more && <LengthField label="Floor height" value={facade.balconyElevation} onChange={(v) => setF({ balconyElevation: v })} />}
          <select aria-label="Railing style" value={facade.railingStyle} onChange={(e) => setF({ railingStyle: e.target.value as RailingStyle })} className={`${input} w-24 font-sans`}>
            <option value="balusters">Balusters</option>
            <option value="glass">Glass</option>
          </select>
          <span className="text-stone-500">Click an exterior wall</span>
        </>
      )}
      {activeTool === 'railing' && (
        <>
          <select aria-label="Railing style" value={facade.railingStyle} onChange={(e) => setF({ railingStyle: e.target.value as RailingStyle })} className={`${input} w-24 font-sans`}>
            <option value="balusters">Balusters</option>
            <option value="glass">Glass panels</option>
          </select>
          {more && <LengthField label="Height" value={facade.railingHeight} onChange={(v) => setF({ railingHeight: v })} />}
          <span className="text-stone-500">Click path points · Enter to finish</span>
        </>
      )}
      {activeTool === 'skylight' && (
        <>
          <LengthField label="Width" value={facade.skylightWidth} onChange={(v) => setF({ skylightWidth: v })} />
          <LengthField label="Length" value={facade.skylightLength} onChange={(v) => setF({ skylightLength: v })} />
          <span className="text-stone-500">Click on a roof face</span>
        </>
      )}
      {activeTool === 'dormer' && (
        <>
          <LengthField label="Width" value={facade.dormerWidth} onChange={(v) => setF({ dormerWidth: v })} />
          <LengthField label="Height" value={facade.dormerHeight} onChange={(v) => setF({ dormerHeight: v })} />
          <span className="text-stone-500">Click on a sloped roof face</span>
        </>
      )}
      {activeTool === 'curtainwall' && (
        <>
          <LengthField label="Grid ↔" value={facade.cwVSpacing} onChange={(v) => setF({ cwVSpacing: v })} />
          {more && <LengthField label="Grid ↕" value={facade.cwHSpacing} onChange={(v) => setF({ cwHSpacing: v })} />}
          <span className="text-stone-500">Click wall points · Enter to finish</span>
        </>
      )}
      {['sweep', 'reveal', 'balcony', 'railing', 'curtainwall'].includes(activeTool) && (
        <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] text-amber-600 hover:underline cursor-pointer">
          {more ? 'Less' : 'More…'}
        </button>
      )}
    </div>
  );
};
