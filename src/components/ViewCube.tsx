import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, Home, RotateCcw, RotateCw } from 'lucide-react';
import {
  CUBE_FACES,
  FACE_LABEL,
  cubeCssTransform,
  faceCssMatrix,
  hotspotForCell,
  hotspotKey,
  hotspotLabel,
  POLAR_EPS,
  viewRotation,
  type ArrowDir,
  type Cardinal,
  type CubeFace,
  type Hotspot,
  type Projection,
} from '../engine/viewCube';

/** Cube half-size, compass radius and where the compass sits under the cube (px). */
const H = 25;
const RING_R = 52;
const RING_DROP = H + 6;
const W = 156;

export interface ViewCubeHandle {
  /** Called by the 3D view every frame it renders: camera view matrix (column-major) + cube front offset. */
  setOrientation: (viewMatrix: ArrayLike<number>, frontOffset: number, aligned: CubeFace | null, upsideDown: boolean) => void;
}

export interface ViewCubeProps {
  darkMode: boolean;
  projection: Projection;
  /** plan view: a static cube seen from the TOP; clicks open the 3D view there */
  plan?: boolean;
  /** plan view: the cube's front offset (radians) */
  frontOffset?: number;
  onHotspot: (h: Hotspot) => void;
  onArrow?: (a: ArrowDir) => void;
  onRoll?: (clockwise: boolean) => void;
  onOrbitDrag?: (dx: number, dy: number) => void;
  onCompassRotate?: (deltaRad: number) => void;
  onCardinal: (c: Cardinal) => void;
  onHome: () => void;
  onSetProjection: (p: Projection) => void;
  onSetHome?: () => void;
  onSetFront?: () => void;
  onResetFront?: () => void;
}

const CELL = ['22%', '56%', '22%'];

/**
 * AutoCAD-style VIEWCUBE (CSS 3D): 6 faces, 12 edges and 8 corners as hotspots, a compass ring with
 * N / E / S / W, a Home button with a menu, and roll / adjacent-face arrows when a face is seen
 * head-on. 50 % opacity when idle, 100 % on hover. Dragging the cube orbits the model.
 */
export const ViewCube = forwardRef<ViewCubeHandle, ViewCubeProps>(
  ({ darkMode, projection, plan = false, frontOffset = 0, onHotspot, onArrow, onRoll, onOrbitDrag, onCompassRotate, onCardinal, onHome, onSetProjection, onSetHome, onSetFront, onResetFront }, ref) => {
    const cubeRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [aligned, setAligned] = useState<CubeFace | null>(plan ? 'top' : null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [active, setActive] = useState(false); // dragging: stay opaque
    const alignedRef = useRef<CubeFace | null>(aligned);
    const upsideRef = useRef(false);
    const letterRefs = useRef<Partial<Record<Cardinal, HTMLButtonElement | null>>>({});
    const placeLetters = (m: ArrayLike<number>) => {
      const r = RING_R - 6;
      for (const [c, d] of letters) {
        const el = letterRefs.current[c];
        if (!el) continue;
        const x = d.x * r;
        const y = -RING_DROP; // world y (CSS drop is down)
        const z = d.z * r;
        const cx = m[0] * x + m[4] * y + m[8] * z;
        const cy = m[1] * x + m[5] * y + m[9] * z;
        const cz = m[2] * x + m[6] * y + m[10] * z;
        el.style.transform = `translate(${cx.toFixed(1)}px, ${(-cy).toFixed(1)}px)`;
        el.style.opacity = cz < -1 ? '0.7' : '1'; // far side of the ring: a little fainter, still clickable
      }
    };

    useImperativeHandle(ref, () => ({
      setOrientation: (m, fo, al, upsideDown) => {
        placeLetters(m);
        if (cubeRef.current) cubeRef.current.style.transform = cubeCssTransform(m, fo);
        if (ringRef.current) ringRef.current.style.transform = `${cubeCssTransform(m, 0)} translate3d(0px, ${RING_DROP}px, 0px) rotateX(90deg)`;
        upsideRef.current = upsideDown;
        if (al !== alignedRef.current) {
          alignedRef.current = al;
          setAligned(al);
        }
      },
    }));

    // ---- cube: click a hotspot, or drag to orbit ----
    const drag = useRef<null | { x: number; y: number; h: Hotspot; moved: boolean; id: number }>(null);
    const onCellDown = (e: React.PointerEvent, h: Hotspot) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { x: e.clientX, y: e.clientY, h, moved: false, id: e.pointerId };
      rootRef.current?.setPointerCapture(e.pointerId);
      setActive(true);
    };
    // ---- compass ring: drag to turn about the vertical ----
    const ringDrag = useRef<null | { a: number; moved: boolean }>(null);
    const centerAngle = (e: { clientX: number; clientY: number }) => {
      const r = stageRef.current!.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    const onRingDown = (e: React.PointerEvent) => {
      if (e.button !== 0 || plan) return;
      e.preventDefault();
      e.stopPropagation();
      ringDrag.current = { a: centerAngle(e), moved: false };
      rootRef.current?.setPointerCapture(e.pointerId);
      setActive(true);
    };
    const onStageMove = (e: React.PointerEvent) => {
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 3 && !plan) d.moved = true;
        if (d.moved) {
          onOrbitDrag?.(dx, dy);
          d.x = e.clientX;
          d.y = e.clientY;
        }
        return;
      }
      const rd = ringDrag.current;
      if (rd) {
        const a = centerAngle(e);
        let da = a - rd.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        rd.a = a;
        rd.moved = true;
        onCompassRotate?.(upsideRef.current ? -da : da);
      }
    };
    const onStageUp = (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      ringDrag.current = null;
      setActive(false);
      try {
        rootRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (d && !d.moved) onHotspot(d.h);
    };

    const planM = plan ? viewRotation(POLAR_EPS, frontOffset) : null;
    const face = (f: CubeFace) => (
      <div
        key={f}
        className="absolute"
        style={{ left: -H, top: -H, width: 2 * H, height: 2 * H, transform: faceCssMatrix(f, H), backfaceVisibility: 'hidden', transformOrigin: '50% 50%' }}
        data-testid={`viewcube-face-${f}`}
      >
        <div
          className={`absolute inset-0 grid border ${darkMode ? 'border-stone-500' : 'border-slate-400'}`}
          style={{ gridTemplateColumns: CELL.join(' '), gridTemplateRows: CELL.join(' ') }}
        >
          {[-1, 0, 1].map((row) =>
            [-1, 0, 1].map((col) => {
              const h = hotspotForCell(f, col, row);
              const k = hotspotKey(h);
              const hot = hover === k;
              const centre = col === 0 && row === 0;
              return (
                <div
                  key={`${row}${col}`}
                  data-hotspot={k}
                  data-testid={`viewcube-${f}-${col}-${row}`}
                  title={hotspotLabel(h)}
                  onPointerEnter={() => setHover(k)}
                  onPointerLeave={() => setHover((v) => (v === k ? null : v))}
                  onPointerDown={(e) => onCellDown(e, h)}
                  className={`flex items-center justify-center cursor-pointer select-none pointer-events-auto ${
                    hot ? 'bg-sky-400/90' : centre ? (darkMode ? 'bg-stone-700/95' : 'bg-slate-100/95') : darkMode ? 'bg-stone-600/95' : 'bg-slate-200/95'
                  }`}
                >
                  {centre && (
                    <span className={`text-[8px] font-bold tracking-wide pointer-events-none ${hot ? 'text-white' : darkMode ? 'text-stone-100' : 'text-slate-700'}`}>
                      {FACE_LABEL[f]}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );

    const ticks: React.ReactNode[] = [];
    for (let d = 0; d < 360; d += 15) {
      const a = (d * Math.PI) / 180;
      const major = d % 90 === 0;
      if (major) continue;
      const r0 = RING_R - (d % 45 === 0 ? 11 : 8);
      const r1 = RING_R - 3;
      ticks.push(<line key={d} x1={RING_R + Math.sin(a) * r0} y1={RING_R - Math.cos(a) * r0} x2={RING_R + Math.sin(a) * r1} y2={RING_R - Math.cos(a) * r1} stroke={darkMode ? '#a8a29e' : '#64748b'} strokeWidth={d % 45 === 0 ? 1.4 : 0.8} />);
    }
    // cardinal letters are screen-facing buttons placed on the ring each frame (always clickable)
    const letters: Array<[Cardinal, { x: number; z: number }]> = [
      ['N', { x: 0, z: -1 }],
      ['E', { x: 1, z: 0 }],
      ['S', { x: 0, z: 1 }],
      ['W', { x: -1, z: 0 }],
    ];

    const arrowBtn = 'absolute w-4 h-4 flex items-center justify-center rounded-sm cursor-pointer text-slate-500 hover:text-white hover:bg-sky-500 dark:text-stone-300';
    const showArrows = !plan && aligned !== null;
    const menuItem = 'w-full text-left px-2.5 py-1 rounded text-[11px] hover:bg-amber-500 hover:text-white cursor-pointer flex items-center gap-1.5';
    const projLabel: Record<Projection, string> = { perspective: 'Perspective', orthographic: 'Orthographic', 'perspective-ortho-faces': 'Perspective with Ortho Faces' };

    return (
      <div
        data-testid={plan ? 'viewcube-plan' : 'viewcube'}
        className={`absolute top-2 right-2 z-20 select-none transition-opacity duration-150 ${active || menuOpen ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}
        ref={rootRef}
        style={{ width: W, height: W + 6 }}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* HOME (top-left) — right-click for the menu */}
        <button
          type="button"
          aria-label="ViewCube home"
          title="Home view (right-click for options)"
          onClick={onHome}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          className={`absolute left-1 top-1 z-10 w-6 h-6 rounded flex items-center justify-center cursor-pointer ${darkMode ? 'text-stone-200 hover:bg-stone-700' : 'text-slate-600 hover:bg-slate-200'}`}
        >
          <Home className="w-4 h-4" />
        </button>
        {/* menu arrow (top-right) */}
        <button
          type="button"
          aria-label="ViewCube menu"
          aria-expanded={menuOpen}
          title="ViewCube options"
          onClick={() => setMenuOpen((v) => !v)}
          className={`absolute right-1 top-1 z-10 w-5 h-5 rounded flex items-center justify-center cursor-pointer ${darkMode ? 'text-stone-200 hover:bg-stone-700' : 'text-slate-600 hover:bg-slate-200'}`}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <div
            data-testid="viewcube-menu"
            className={`absolute right-1 top-7 z-30 w-56 p-1 rounded-lg border shadow-lg ${darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-800'}`}
            onPointerLeave={() => setMenuOpen(false)}
          >
            <button type="button" className={menuItem} onClick={() => (setMenuOpen(false), onHome())}>
              <Home className="w-3.5 h-3.5" /> Go Home
            </button>
            <div className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
            {(['orthographic', 'perspective', 'perspective-ortho-faces'] as Projection[]).map((p) => (
              <button key={p} type="button" role="menuitemradio" aria-checked={projection === p} className={menuItem} onClick={() => (setMenuOpen(false), onSetProjection(p))}>
                <span className="w-3.5 text-center">{projection === p ? '●' : ''}</span> {projLabel[p]}
              </button>
            ))}
            {!plan && (
              <>
                <div className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
                <button type="button" className={menuItem} onClick={() => (setMenuOpen(false), onSetHome?.())}>
                  Set Current View as Home
                </button>
                <button type="button" className={menuItem} onClick={() => (setMenuOpen(false), onSetFront?.())}>
                  Set Current View as Front
                </button>
                <button type="button" className={menuItem} onClick={() => (setMenuOpen(false), onResetFront?.())}>
                  Reset Front
                </button>
              </>
            )}
          </div>
        )}

        {/* 3D stage: compass ring + cube share one 3D context */}
        <div
          ref={stageRef}
          className="absolute"
          // the stage itself must not catch hits: in its 3D context it would hide everything behind z = 0
          style={{ left: W / 2 - RING_R - 4, top: W / 2 - RING_R - 6, width: 2 * RING_R + 8, height: 2 * RING_R + 8, transformStyle: 'preserve-3d', pointerEvents: 'none' }}
        >
          <div ref={ringRef} className="absolute" style={{ left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d', transform: planM ? `${cubeCssTransform(planM, 0)} translate3d(0px, ${RING_DROP}px, 0px) rotateX(90deg)` : undefined }}>
            <svg
              width={2 * RING_R}
              height={2 * RING_R}
              className="absolute overflow-visible"
              style={{ left: -RING_R, top: -RING_R }}
              data-testid="viewcube-compass"
            >
              <circle
                cx={RING_R}
                cy={RING_R}
                r={RING_R - 6}
                fill="none"
                stroke={darkMode ? 'rgba(168,162,158,0.45)' : 'rgba(100,116,139,0.35)'}
                strokeWidth={11}
                className={plan ? '' : 'cursor-grab'}
                onPointerDown={onRingDown}
                style={{ pointerEvents: 'stroke' }}
              >
                <title>Drag to turn the view about the vertical</title>
              </circle>
              {ticks}
            </svg>
          </div>
          <div ref={cubeRef} className="absolute" style={{ left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d', transform: planM ? cubeCssTransform(planM, frontOffset) : undefined }}>
            {CUBE_FACES.map(face)}
          </div>
        </div>

        {/* compass letters (screen-facing) */}
        <div className="absolute pointer-events-none" style={{ left: W / 2, top: W / 2 - 2, width: 0, height: 0 }}>
          {letters.map(([c]) => (
            <button
              key={c}
              type="button"
              ref={(el) => {
                letterRefs.current[c] = el;
                if (el && planM) placeLetters(planM);
              }}
              data-testid={`viewcube-cardinal-${c}`}
              aria-label={`View from the ${c === 'N' ? 'north' : c === 'E' ? 'east' : c === 'S' ? 'south' : 'west'}`}
              title={`View from the ${c === 'N' ? 'north' : c === 'E' ? 'east' : c === 'S' ? 'south' : 'west'}`}
              onClick={(e) => {
                e.stopPropagation();
                onCardinal(c);
              }}
              className={`absolute -left-2 -top-2 w-4 h-4 rounded-full border text-[8px] font-bold leading-none flex items-center justify-center pointer-events-auto cursor-pointer hover:scale-125 transition-transform ${
                c === 'N' ? 'bg-red-600 border-red-700 text-white' : darkMode ? 'bg-stone-700 border-stone-500 text-stone-100' : 'bg-white border-slate-400 text-slate-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* face-on view: triangle arrows (adjacent face) and roll arrows (90°) */}
        {showArrows && (
          <>
            {(
              [
                ['up', W / 2 - 8, W / 2 - H - 26, '▲'],
                ['down', W / 2 - 8, W / 2 + H + 12, '▼'],
                ['left', W / 2 - H - 26, W / 2 - 8, '◀'],
                ['right', W / 2 + H + 10, W / 2 - 8, '▶'],
              ] as Array<[ArrowDir, number, number, string]>
            ).map(([dir, x, y, ch]) => (
              <button key={dir} type="button" aria-label={`ViewCube ${dir} face`} title={`Turn to the face ${dir === 'up' ? 'above' : dir === 'down' ? 'below' : `on the ${dir}`}`} className={`${arrowBtn} text-[9px]`} style={{ left: x, top: y }} onClick={() => onArrow?.(dir)}>
                {ch}
              </button>
            ))}
            <button type="button" aria-label="Roll view counter-clockwise" title="Rotate the view 90° counter-clockwise" className={arrowBtn} style={{ left: W / 2 + H + 4, top: W / 2 - H - 26 }} onClick={() => onRoll?.(false)}>
              <RotateCcw className="w-3 h-3" />
            </button>
            <button type="button" aria-label="Roll view clockwise" title="Rotate the view 90° clockwise" className={arrowBtn} style={{ left: W / 2 + H + 20, top: W / 2 - H - 14 }} onClick={() => onRoll?.(true)}>
              <RotateCw className="w-3 h-3" />
            </button>
          </>
        )}
        {hover && (
          <div className={`absolute left-1/2 -translate-x-1/2 bottom-0 px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap pointer-events-none ${darkMode ? 'bg-stone-800 text-stone-100' : 'bg-white/95 text-slate-700 shadow'}`} data-testid="viewcube-hover-label">
            {hotspotLabel(hover.split(',').map(Number) as Hotspot)}
          </div>
        )}
      </div>
    );
  }
);
ViewCube.displayName = 'ViewCube';
