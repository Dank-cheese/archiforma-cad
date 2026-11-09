import React from 'react';
import { STRUCTURAL_DISCLAIMER } from '../engine/structure';

/** Help panel section: Structure toolset quick workflows + the engineering disclaimer. */
export const StructureHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-blue-100'}`;
  return (
    <section
      aria-label="Structure help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-blue-900/50 bg-blue-950/20' : 'border-blue-200 bg-blue-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Structure (Revit Structure, simplified)</h3>
      </div>
      <div
        role="note"
        aria-label="Structural disclaimer"
        className={`px-3 py-2 rounded-lg border-2 text-xs font-semibold ${darkMode ? 'border-red-800 bg-red-950/40 text-red-200' : 'border-red-300 bg-red-50 text-red-800'}`}
      >
        ⚠ {STRUCTURAL_DISCLAIMER} Warnings are simple coordination checks — no structural calculation is performed.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Frame &amp; foundations</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Grids (<b>GR</b>), then columns (<b>CL</b>) on the intersections — concrete, steel W/HSS or wood.</li>
            <li>Select the columns (or a grid) → <b>FT</b> puts a footing under each. <b>WF</b> under walls, <b>FS</b> slab on grade, <b>PC</b> pile caps.</li>
            <li><b>BM</b> column to column (snaps to centres, cut back at faces); <b>BS</b> fills a bay with joists; <b>BRC</b> braces.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Concrete &amp; rebar</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Select a concrete beam / column / footing / slab → click its <b>Quick Preset</b> in Properties (or <b>RBP</b>).</li>
            <li><b>RB</b> for any bar set (size, shape, layout, cover); <b>ARN</b> for top/bottom mats. Bars follow the host when it is resized.</li>
            <li><b>View rebar</b> in 3D; the <b>Rebar Schedule</b> totals length and weight (CSV / sheets).</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Views &amp; coordination</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li><b>Arch | Struct | Combined</b> switch in the top bar (or DSA / DSS / DSC).</li>
            <li><b>FP</b> Foundation Plan, <b>FRP</b> Framing Plan, <b>SEC</b> sections; <b>AN</b> analytical view, <b>LD</b> loads.</li>
            <li><b>JG / UJ / SWJ</b> joins, <b>CN</b> steel connections, <b>CJ</b> joints. Schedules: Footing, Column, Beam, Rebar.</li>
          </ol>
        </div>
      </div>
    </section>
  );
};
