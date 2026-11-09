import React from 'react';

/** Help panel section: wall joins, timber / cabin catalog, door catalog and the component library. */
export const CabinHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-amber-100'}`;
  return (
    <section
      aria-label="Wall joins, timber and cabins help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-amber-900/50 bg-amber-950/20' : 'border-amber-200 bg-amber-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-amber-700 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Wall joins · timber & cabins · doors · component library</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Seamless wall joins (automatic)</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>L, angled and star corners miter; a T trims the stem at the main wall's near face; X-crossings split the thinner wall.</li>
            <li>Joined walls of one type draw as ONE contour with uninterrupted fill; core meets core and finish meets finish. 3D corners have no gaps or z-fighting.</li>
            <li>Collinear walls of the same type that touch end-to-end heal into one wall automatically, keeping their doors and windows.</li>
            <li><b>WJ</b> (Wall Join): click a corner to cycle Miter → Butt → Square off → Disallow join (keeps a seam). Shift+click swaps the through wall.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Timber frames, cabins & chalets</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li><b>BM / CL</b> wood pickers: hand-hewn timbers 6x8–12x12 (Douglas Fir, Western Red Cedar, White Pine, Reclaimed Barn Oak), round logs 8–14" dia., glulam 3-1/8x12, 5-1/8x15, 6-3/4x18 (camber in Properties).</li>
            <li><b>TRF</b> click a roof: exposed ridge beam, purlins canted to the pitch and rafters with Plumb / Square / Bevel / Scrolled tails.</li>
            <li><b>TRS</b> trusses: King Post, Queen Post, Hammerbeam, Scissor — one click inside a room spans it (Count + spacing for a row).</li>
            <li><b>KB</b> click a post: straight or curved mortise-and-tenon knee braces to every beam framing in.</li>
            <li>Wall types: Full-Scribe Round Log 10", D-Log, Square-Chinked Appalachian log (stacked courses, saddle-notch corner overhangs), Cedar Board-and-Batten, Knotty Pine T&G lining.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Door catalog (DR)</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Hinged: Flush, 6-Panel Colonial, Craftsman 3-Lite, French (single / double), Rustic Plank with strap hinges, Dutch, Arched-top timber, Entry with sidelights & transom.</li>
            <li>Sliding & folding: Pocket, Barn door on black steel track (single / bypass), 2–4 panel patio, Multi-slide stacking, Bi-fold accordion 3–6 leaves.</li>
            <li>Specialty: Louvered closet bi-fold, Pivot entry (offset pivot), Sectional / Roll-up / Carriage-house garage, Cabin screen & storm door.</li>
            <li>Each has its plan symbol (swing, slide, fold, pocket, pivot), elevation and 3D leaf; Edit type… sets operation, design, panels, sidelights, transom.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">Component library (CM / Library tab)</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Search and filter by category: Cabin & Living, Kitchen & Bath, Stairs, Porches & Site.</li>
            <li>Stone fireplaces and wood stoves run their chimney / flue up through the roof above them; chandeliers hang from the ceiling.</li>
            <li>Plan symbols scale with the component; R rotates while inserting.</li>
          </ul>
        </div>
      </div>
    </section>
  );
};
