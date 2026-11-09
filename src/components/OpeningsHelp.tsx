import React from 'react';

/** Help panel section: hosted doors, windows and wall openings (embedded in walls, Revit-style). */
export const OpeningsHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-sky-100'}`;
  return (
    <section
      aria-label="Doors and windows help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-sky-900/50 bg-sky-950/20' : 'border-sky-200 bg-sky-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-sky-600 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Doors, windows &amp; openings — embedded in walls</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-sky-700 dark:text-sky-400 mb-1">Placing (DR · WN · WO)</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Pick a type in the options bar, plus Depth: Ext / Center / Int.</li>
            <li>Hover a wall: the preview snaps into it. <b className="text-red-600">Red</b> means it doesn't fit (overlap or past the wall end).</li>
            <li><b>Space</b> flips the swing or exterior side. <b>Shift+Space</b> flips the door hinge.</li>
            <li>It snaps to <b>Center</b> and <b>EQ</b> (equal gaps). Click a <span className="text-sky-600 font-bold">blue dimension</span> and type a distance.</li>
            <li>Click to place; the tool stays active. <b>Esc</b> to finish.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-sky-700 dark:text-sky-400 mb-1">Editing</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Drag the middle grip to slide along the wall, or onto another wall to re-host. Openings can never leave their wall.</li>
            <li>Drag a side grip to change the width; the other side stays put.</li>
            <li>In an elevation, drag the blue top or bottom grip to change the head or sill.</li>
            <li>The ⇅ / ⇆ buttons flip facing and hand. <b>EQ</b> spaces the selected openings equally.</li>
            <li>Move, Copy and Array keep openings hosted. Copying a wall brings its openings.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-sky-700 dark:text-sky-400 mb-1">How they're embedded</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Moving or rotating a wall carries its openings. Stretching keeps them the same distance from the fixed end.</li>
            <li>If a wall becomes too short, a <b className="text-yellow-600">yellow ⚠</b> warning appears; nothing is deleted.</li>
            <li>Deleting a wall asks: "Also delete N hosted doors/windows?"</li>
            <li>Type properties apply to every instance; sill, head (head = sill + height), depth, flip and mark are per instance.</li>
            <li>Curtain walls: in an elevation, click a panel to cycle Glass → Solid → Door → Window.</li>
          </ul>
        </div>
      </div>
    </section>
  );
};
