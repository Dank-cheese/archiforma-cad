import React from 'react';

/** Help panel section: the ViewCube (NAVVCUBE). */
export const ViewCubeHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-sky-100'}`;
  return (
    <section aria-label="ViewCube help" className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-sky-900/50 bg-sky-950/20' : 'border-sky-200 bg-sky-50/60'}`}>
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-sky-700 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">ViewCube (NAVVCUBE / CUBE)</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-sky-700 dark:text-sky-400 mb-1">Click to snap the view</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>The cube sits top-right of the 3D view and turns with the camera. It is 50% see-through until you hover it.</li>
            <li><b>Faces</b> (TOP, BOTTOM, FRONT, BACK, LEFT, RIGHT): the view glides to look straight at that side.</li>
            <li><b>Edges</b> (12): the 45° view between two faces. <b>Corners</b> (8): isometric views — SE / SW / NE / NW Iso, from above or below. Hotspots light up blue and their name shows under the cube.</li>
            <li>Looking at a face: the <b>▲ ▼ ◀ ▶</b> arrows turn to the next face; the curved arrows roll the view 90°.</li>
            <li><b>Drag the cube</b> to orbit freely.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-sky-700 dark:text-sky-400 mb-1">Compass, Home & options</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li><b>Compass</b> under the cube: click N / E / S / W to view from that side (plan north is up); drag the ring to turn the view about the vertical.</li>
            <li><b>Home</b> (house, top-left) glides back to the Home view. Right-click it or use <b>▾</b> for: Go Home · Orthographic · Perspective · Perspective with Ortho Faces (orthographic only when looking straight at a face) · Set Current View as Home · Set Current View as Front · Reset Front.</li>
            <li>Turn it on / off: <b>View / Navigation → ViewCube</b> in the left toolbar, or type <b>NAVVCUBE</b> (or <b>CUBE</b>) → <i>Enter an option [ON/OFF]</i> → type or click ON / OFF. Home, Front, projection and on / off are remembered in this browser.</li>
            <li>In the <b>plan</b> the cube shows TOP; click any face, edge, corner or compass letter to open 3D from there.</li>
          </ul>
        </div>
      </div>
    </section>
  );
};
