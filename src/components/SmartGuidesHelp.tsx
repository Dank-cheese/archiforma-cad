import React, { useState } from 'react';

/** Help panel section: step-by-step, animated explanation of smart alignment guides (TRACK / F11). */

const G = '#22C55E';

interface Step {
  title: string;
  text: string;
  label: string;
  /** Static drawing (existing geometry), in a 240 × 130 viewBox. */
  scene: React.ReactNode;
  /** Cursor path: [x, y] keyframes; the last one is the snapped point. */
  path: Array<[number, number]>;
  /** Guides that appear when the cursor arrives. */
  guides: React.ReactNode;
}

const wall = (x1: number, y1: number, x2: number, y2: number, key?: string) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
);
const dotted = (x1: number, y1: number, x2: number, y2: number, key?: string) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={G} strokeWidth={1.5} strokeDasharray="4 4" />
);

const STEPS: Step[] = [
  {
    title: '1 · Alignment & guide crossings',
    text: 'Line up with any endpoint or midpoint (including the start of the shape you are drawing) and the cursor locks onto a green dotted guide. Where two guides cross, it snaps to the crossing — so the third side of a rectangle ends exactly above the start point.',
    label: 'Intersection',
    scene: (
      <>
        {wall(40, 100, 200, 100)}
        {wall(200, 100, 200, 30)}
        <circle cx={40} cy={100} r={3} fill="currentColor" />
      </>
    ),
    path: [[150, 60], [80, 40], [46, 33], [40, 30]],
    guides: (
      <>
        {dotted(40, 100, 40, 22)}
        {dotted(200, 30, 32, 30)}
        <line x1={200} y1={30} x2={40} y2={30} stroke="currentColor" strokeWidth={3} strokeOpacity={0.35} />
      </>
    ),
  },
  {
    title: '2 · Extension',
    text: 'Hover just past the end of an existing line or wall to see its green dotted continuation. The cursor slides along it, so new work lines up with old work.',
    label: 'Extension',
    scene: <>{wall(30, 110, 110, 50)}</>,
    path: [[200, 80], [170, 30], [152, 22], [150, 20]],
    guides: <>{dotted(110, 50, 166, 8)}</>,
  },
  {
    title: '3 · Parallel / perpendicular',
    text: 'If the segment you are drawing is within 2° of parallel or perpendicular to an existing wall, its angle snaps exactly. The reference wall lights up green.',
    label: 'Parallel',
    scene: <>{wall(30, 60, 130, 20, 'ref')}</>,
    path: [[200, 70], [215, 50], [212, 46], [210, 46]],
    guides: (
      <>
        <line x1={30} y1={60} x2={130} y2={20} stroke={G} strokeWidth={6} strokeOpacity={0.45} strokeLinecap="round" />
        <line x1={110} y1={86} x2={210} y2={46} stroke="currentColor" strokeWidth={3} strokeOpacity={0.35} />
        {dotted(110, 86, 228, 39)}
        <circle cx={110} cy={86} r={3} fill="currentColor" />
      </>
    ),
  },
  {
    title: '4 · Equal length',
    text: 'When the new segment is within 10 px of an existing length, it snaps to exactly that length. The matching wall is highlighted and both get an "=" tick. The opposite (parallel) wall wins, then the segment drawn two steps ago, then the nearest wall.',
    label: "Equal length 20'-0\"",
    scene: (
      <>
        {wall(40, 30, 200, 30)}
        <circle cx={40} cy={100} r={3} fill="currentColor" />
      </>
    ),
    path: [[150, 104], [190, 101], [197, 100], [200, 100]],
    guides: (
      <>
        <line x1={40} y1={30} x2={200} y2={30} stroke={G} strokeWidth={6} strokeOpacity={0.45} strokeLinecap="round" />
        <line x1={40} y1={100} x2={200} y2={100} stroke="currentColor" strokeWidth={3} strokeOpacity={0.35} />
        {[120].map((x) => (
          <g key={x}>
            <line x1={x - 2.5} y1={24} x2={x - 2.5} y2={36} stroke={G} strokeWidth={2} />
            <line x1={x + 2.5} y1={24} x2={x + 2.5} y2={36} stroke={G} strokeWidth={2} />
            <line x1={x - 2.5} y1={94} x2={x - 2.5} y2={106} stroke={G} strokeWidth={2} />
            <line x1={x + 2.5} y1={94} x2={x + 2.5} y2={106} stroke={G} strokeWidth={2} />
          </g>
        ))}
      </>
    ),
  },
];

export const SmartGuidesHelp: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const [ex, ey] = step.path[step.path.length - 1];
  const dur = '2.4s';
  const keyTimes = '0;0.45;0.6;0.7';
  return (
    <section
      aria-labelledby="smart-guides-help-title"
      className={`rounded-xl border p-4 ${darkMode ? 'border-green-900 bg-green-950/30' : 'border-green-200 bg-green-50/60'}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 id="smart-guides-help-title" className="text-sm font-bold">
            Smart alignment guides <span className="font-mono text-[11px] text-green-700 dark:text-green-400">TRACK · F11</span>
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Works in LINE (L), PLINE (PL), WALL (WA), RECTANG (REC) and the destination point of MOVE (M) / COPY (CO).
          </p>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Smart guide steps">
          {STEPS.map((s, k) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={s.title}
              onClick={() => setI(k)}
              className={`w-6 h-6 rounded-full text-[11px] font-bold cursor-pointer ${
                k === i ? 'bg-green-600 text-white' : darkMode ? 'bg-stone-800 text-stone-300' : 'bg-white text-stone-600 border border-stone-200'
              }`}
            >
              {k + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-4 items-center">
        <svg
          key={i /* restart the animation on every step */}
          viewBox="0 0 240 130"
          className={`w-full rounded-lg border ${darkMode ? 'bg-stone-950 border-stone-800 text-stone-300' : 'bg-white border-stone-200 text-stone-700'}`}
          role="img"
          aria-label={`${step.title} animation`}
        >
          {step.scene}
          <g opacity={0}>
            <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.55;0.6;1" dur={dur} repeatCount="indefinite" />
            {step.guides}
            <g transform={`translate(${ex} ${ey})`}>
              <line x1={-4} y1={-4} x2={4} y2={4} stroke={G} strokeWidth={2} />
              <line x1={-4} y1={4} x2={4} y2={-4} stroke={G} strokeWidth={2} />
              <rect x={8} y={6} rx={3} width={step.label.length * 5.2 + 8} height={13} fill="#052e16" stroke={G} strokeWidth={0.8} />
              <text x={12} y={15.5} fontSize={8} fontFamily="monospace" fill="#4ADE80">
                {step.label}
              </text>
            </g>
          </g>
          {/* cursor */}
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values={step.path.map((p) => `${p[0]} ${p[1]}`).join(';') + `;${ex} ${ey}`}
              keyTimes={`${keyTimes};1`}
              dur={dur}
              repeatCount="indefinite"
            />
            <path d="M0 0 L0 11 L3 8 L6 13 L8 12 L5 7 L9 7 Z" fill={darkMode ? '#fafaf9' : '#1c1917'} stroke={darkMode ? '#1c1917' : '#fafaf9'} strokeWidth={0.8} />
          </g>
        </svg>

        <div className="text-xs space-y-2">
          <div className="font-semibold text-sm">{step.title}</div>
          <p className="text-stone-600 dark:text-stone-300 leading-relaxed">{step.text}</p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={i === 0}
              onClick={() => setI((k) => Math.max(0, k - 1))}
              className="px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-stone-300 dark:border-stone-700"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={i === STEPS.length - 1}
              onClick={() => setI((k) => Math.min(STEPS.length - 1, k + 1))}
              className="px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-stone-600 dark:text-stone-300">
        <li><kbd className="font-mono font-semibold">F11</kbd> or the <b>TRACK</b> button turns guides on/off.</li>
        <li>Right-click <b>TRACK</b> to choose guide types.</li>
        <li>Hold <kbd className="font-mono font-semibold">Shift</kbd> to lock onto the current guide and slide along it.</li>
        <li>Hold <kbd className="font-mono font-semibold">Alt</kbd> to hide guides while held.</li>
        <li>Object snaps (endpoint, midpoint…) always win over guides; guides win over POLAR/ORTHO.</li>
        <li>Typed lengths or <span className="font-mono">@dx,dy</span> always override guides.</li>
      </ul>
    </section>
  );
};
