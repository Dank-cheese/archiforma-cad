import React from 'react';

/** Help panel section: checking below grade — 3D under the ground, section box, checks, plan underlay. */
export const BelowGradeHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-amber-100'}`;
  return (
    <section
      aria-label="Checking below grade help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-amber-900/50 bg-amber-950/20' : 'border-amber-200 bg-amber-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-amber-700 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Checking below grade</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Look under the building (3D)</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open <b>3D</b>. Click <b>Bottom</b> in the view bar (or the BOTTOM face of the ViewCube) to look straight up at footings, piles and slab bottoms.</li>
            <li>Or orbit: drag past the horizon — the camera goes under the grid. The ground fades to 15%, the grid turns to faint lines, a dashed <b>GRADE</b> line appears and a badge shows the eye height, e.g. "Below grade -4'-6"".</li>
            <li>Pan anywhere: middle-drag or <b>Space + drag</b> (also straight down through the ground). <b>Shift + middle-drag</b> moves the view straight up / down; <b>PgUp / PgDn</b> move it one grid step (2'-0").</li>
            <li>Hover any surface: the readout says what it is and its elevation — "Top of footing -0'-6"", "Bottom of slab on grade -0'-5"".</li>
            <li>Back above ground everything returns to normal.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Ground, X-ray and section box</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li><b>Ground ▾</b>: ground opacity (0–100%, Auto = 35% when foundations are modelled), <b>Hide ground</b>, and <b>X-ray</b> (type <b>XR</b>): everything above grade turns see-through so foundations and structure stand out.</li>
            <li><b>Section box</b> (type <b>BX</b> — SB is the structural floor): a blue box with six handles cuts the model. Drag the <b>top</b> handle down to slice the building and look into the foundations from above; drag the bottom up to cut them off. Cut surfaces show a hatched solid colour.</li>
            <li>BX again (or the button) removes the box. Nothing is rebuilt — only materials and clipping planes change, so big models stay smooth.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Issues under the building</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li><b>Issues</b> in the view bar counts problems: a column with no footing, a gap or overlap between a column base and its footing, a bearing (Structural) wall without a wall footing, a slab that does not sit on beams / walls / columns, floating columns or walls.</li>
            <li>Orange <b>!</b> markers show while you are below grade, in X-ray, with the section box on, or with the Issues list open. Click a marker or a list line to zoom there and select the element.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Plan underlay (2D)</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>In a plan, pick <b>Underlay</b>: None, Level below (default), Foundation, or any level. It draws in light gray beneath the plan and pans / zooms with it.</li>
            <li>Tick <b>Check supports</b>: Structural walls and columns with nothing under them in the underlay are outlined in orange (the unsupported run is drawn thick); the badge counts them.</li>
            <li>Underlay off? <b>Hold U</b> to peek at the level below (or the foundation) while panning; a quick tap of U still types into the command line.</li>
            <li>The background grid always draws behind lines and fills; set its opacity in <b>VV</b> (Plan grid opacity).</li>
          </ol>
        </div>
      </div>
    </section>
  );
};
