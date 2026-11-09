import React from 'react';
import { RoofStyleIcon, ROOF_STYLES } from './ToolOptionsBar';

/** Help panel section: quick workflows for roofs (RF) and facades (elevations, finishes, curtain walls). */
export const RoofsFacadesHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-orange-100'}`;
  return (
    <section
      aria-label="Roofs and facades help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-orange-900/50 bg-orange-950/20' : 'border-orange-200 bg-orange-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-orange-600 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Roofs &amp; Facades</h3>
      </div>
      <div className="flex gap-3 flex-wrap">
        {ROOF_STYLES.map((s) => (
          <div key={s.id} className="flex flex-col items-center text-[10px] text-stone-500 dark:text-stone-400">
            <RoofStyleIcon style={s.id} className="w-10 h-7" />
            {s.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-orange-600 dark:text-orange-400 mb-1">Roof in four steps</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li><b>RF</b>, choose the type and slope (type 4:12 or degrees).</li>
            <li>Click walls, or hover one and press <kbd className="font-mono">Tab</kbd> for the whole chain. Or use Sketch.</li>
            <li><kbd className="font-mono">Enter</kbd>. Untick “Defines slope” on an edge for a gable end.</li>
            <li>Select the gable walls, then <b>AT</b> to attach them to the roof. Add a <b>SKY</b>light or <b>DMR</b> dormer.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-orange-600 dark:text-orange-400 mb-1">Facade in four steps</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li><b>Elevations ▾</b> (or click a marker in plan) opens a live elevation.</li>
            <li><b>SF</b> splits a face at a height, then <b>PT</b> paints each band (also works in 3D).</li>
            <li><b>CW</b> draws a curtain wall. Click its cells in elevation to cycle Glass, Solid and Door.</li>
            <li>Add <b>SWP</b> bands, <b>BAL</b>conies and <b>RAIL</b>ings. <b>TG</b> tags finishes. Place elevations on Sheets.</li>
          </ol>
        </div>
      </div>
    </section>
  );
};
