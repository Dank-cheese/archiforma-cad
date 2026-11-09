import React from 'react';

/** Help panel section: CAMERA (CAM) perspective views, Views list, sun, export and walkthroughs. */
export const CameraHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const card = `p-3 rounded-lg border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-blue-100'}`;
  return (
    <section
      aria-label="Camera views help"
      className={`rounded-xl border p-4 space-y-3 ${darkMode ? 'border-blue-900/50 bg-blue-950/20' : 'border-blue-200 bg-blue-50/60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider">New</span>
        <h3 className="font-semibold text-sm">Camera (CAM) — saved 3D perspective views</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Placing a camera (in plan)</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Type <b>CAM</b> (or Build → Camera) and click the camera position. The eye is 5'-6" (1.7 m) above the ground under it — the level's floor (the model has no site terrain yet).</li>
            <li>Move to aim: the blue wedge points at the cursor; its distance is the target distance. Click to lock the direction (or type a distance).</li>
            <li>Move sideways: the wedge edges follow the cursor — 20° to 100°, shown live as "FOV 62° · ≈ 30 mm". Click to finish; "Camera 1" opens.</li>
            <li>Mouse wheel = FOV at any step (Ctrl+wheel still zooms). Type <b>62</b> for an angle or <b>35mm</b> for a lens. A live 3D preview follows the mouse.</li>
          </ol>
        </div>
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Editing</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Select a camera in plan: drag the grips — position, target, and the two wedge edges (FOV). The preview window updates live.</li>
            <li>Properties: eye / target height, FOV or lens (18 · 24 · 35 · 50 · 85 mm), crop (16:9, 4:3, 1:1, A3 landscape), two-point perspective (straight verticals); near / far clip under More….</li>
            <li>Inside a camera view: drag to look around, ↑ ↓ walk, ← → turn, Shift+← → sidestep, PgUp / PgDn height. <b>Save view</b> stores it, <b>Reset</b> goes back.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Views list, sun & export</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li><b>Views</b> (right panel): thumbnails of every camera — click opens, double-click renames, trash deletes. Cameras show only in plan.</li>
            <li><b>Sun</b> in a camera view: date + time-of-day slider with live shadows (latitude under More…; plan north is up).</li>
            <li><b>PNG ▾</b>: 1× (1600 px), 2× or 4× high-resolution images. Sheets: camera views are listed with <b>+ Place</b> and print in the PDF.</li>
          </ul>
        </div>
        <div className={card}>
          <div className="font-bold text-blue-700 dark:text-blue-400 mb-1">Walkthrough</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Place two or more cameras along a path. <b>Walkthrough</b> in the Views list flies smoothly through them in list order.</li>
            <li><b>WebM</b> records the same fly-through as a video file. Stop any time.</li>
          </ul>
        </div>
      </div>
    </section>
  );
};
