import React, { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Film, Play, Trash2 } from 'lucide-react';
import type { CameraEntity, UnitSystem } from '../types/model';
import {
  aimDistance,
  CAMERA_ASPECTS,
  clampFov,
  DEFAULT_SUN,
  focalToFov,
  formatSunTime,
  fovLabel,
  fovToFocal,
  FOV_MAX,
  FOV_MIN,
  LENS_PRESETS,
} from '../engine/camera';
import { formatLength, parseLengthInput } from '../engine/geometry';

const inputCls = (dark: boolean) =>
  `px-2 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 ${dark ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;

/** Length field that commits on Enter / blur (typed in the project units). */
const LenField: React.FC<{ label: string; value: number; units: UnitSystem; dark: boolean; onCommit: (v: number) => void; aria: string }> = ({ label, value, units, dark, onCommit, aria }) => {
  const [txt, setTxt] = useState(formatLength(value, units));
  useEffect(() => setTxt(formatLength(value, units)), [value, units]);
  const commit = () => {
    const v = parseLengthInput(txt, units);
    if (v !== null && Number.isFinite(v)) onCommit(v);
    else setTxt(formatLength(value, units));
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>
      <input aria-label={aria} className={`${inputCls(dark)} w-28 text-right font-mono`} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
};

/**
 * CAMERA instance properties: eye / target height, FOV or lens (presets), clip planes, two-point
 * perspective, crop. Every change updates the camera's view and the live preview immediately;
 * slider drags are a single undo step.
 */
export const CameraProperties: React.FC<{
  cam: CameraEntity;
  units: UnitSystem;
  darkMode: boolean;
  onUpdate: (next: CameraEntity, label: string) => void;
  onOpen?: (id: string) => void;
}> = ({ cam, units, darkMode, onUpdate, onOpen }) => {
  const lens = fovToFocal(cam.fov);
  const preset = LENS_PRESETS.find((p) => Math.abs(p.mm - lens) < 0.6);
  const sun = cam.sun ?? DEFAULT_SUN;
  return (
    <div className={`p-2.5 rounded-lg border space-y-2 ${darkMode ? 'bg-stone-950/70 border-stone-800' : 'bg-blue-50/60 border-blue-200'}`} data-testid="camera-properties">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1">
          <CameraIcon className="w-3.5 h-3.5" /> Camera
        </span>
        {onOpen && (
          <button type="button" aria-label="Open this camera view" className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold cursor-pointer" onClick={() => onOpen(cam.id)}>
            Open view
          </button>
        )}
      </div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone-500 dark:text-stone-400">Name</span>
        <input aria-label="Camera name" className={`${inputCls(darkMode)} w-32`} defaultValue={cam.name} key={cam.id + cam.name} onBlur={(e) => e.target.value.trim() && e.target.value !== cam.name && onUpdate({ ...cam, name: e.target.value.trim() }, 'Rename Camera')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </label>
      <LenField label="Eye height" aria="Camera eye height" value={cam.eyeHeight} units={units} dark={darkMode} onCommit={(v) => onUpdate({ ...cam, eyeHeight: v }, 'Camera Eye Height')} />
      <LenField label="Target height" aria="Camera target height" value={cam.targetHeight} units={units} dark={darkMode} onCommit={(v) => onUpdate({ ...cam, targetHeight: v }, 'Camera Target Height')} />
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-500 dark:text-stone-400">Field of view</span>
          <b className="font-mono" data-testid="camera-prop-fov">{fovLabel(cam.fov)}</b>
        </div>
        <input type="range" aria-label="Camera field of view" min={FOV_MIN} max={FOV_MAX} step={1} value={Math.round(cam.fov)} className="w-full accent-blue-600" onChange={(e) => onUpdate({ ...cam, fov: clampFov(Number(e.target.value)) }, 'Camera Field of View…')} />
      </div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone-500 dark:text-stone-400">Lens</span>
        <select
          aria-label="Camera lens"
          className={`${inputCls(darkMode)} w-36`}
          value={preset ? String(preset.mm) : 'custom'}
          onChange={(e) => e.target.value !== 'custom' && onUpdate({ ...cam, fov: clampFov(focalToFov(Number(e.target.value))) }, `Camera Lens ${e.target.value} mm`)}
        >
          {LENS_PRESETS.map((p) => (
            <option key={p.mm} value={p.mm}>
              {p.label} ({Math.round(focalToFov(p.mm))}°)
            </option>
          ))}
          {!preset && <option value="custom">Custom ≈ {Math.round(lens)} mm</option>}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone-500 dark:text-stone-400">Crop</span>
        <select aria-label="Camera crop" className={`${inputCls(darkMode)} w-36`} value={cam.aspect} onChange={(e) => onUpdate({ ...cam, aspect: e.target.value as CameraEntity['aspect'] }, 'Camera Crop')}>
          {CAMERA_ASPECTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs" title="Keeps vertical lines vertical (level camera with a shift lens), as architects prefer">
        <input type="checkbox" aria-label="Two-point perspective" checked={cam.twoPoint !== false} onChange={(e) => onUpdate({ ...cam, twoPoint: e.target.checked }, e.target.checked ? 'Camera Two-Point On' : 'Camera Two-Point Off')} />
        Two-point perspective (straight verticals)
      </label>
      <details>
        <summary className="cursor-pointer text-xs text-amber-600 dark:text-amber-400">More…</summary>
        <div className="space-y-2 mt-2">
          <div className="text-[11px] text-stone-500 font-mono">Target distance {formatLength(aimDistance(cam.position, cam.target), units)} · ground {formatLength(cam.baseZ, units)}</div>
          <LenField label="Near clip" aria="Camera near clip" value={cam.near} units={units} dark={darkMode} onCommit={(v) => onUpdate({ ...cam, near: Math.max(0.5, v) }, 'Camera Near Clip')} />
          <LenField label="Far clip" aria="Camera far clip" value={cam.far} units={units} dark={darkMode} onCommit={(v) => onUpdate({ ...cam, far: Math.max(cam.near + 12, v) }, 'Camera Far Clip')} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label="Camera sun and shadows" checked={!!sun.enabled} onChange={(e) => onUpdate({ ...cam, sun: { ...sun, enabled: e.target.checked } }, e.target.checked ? 'Camera Sun On' : 'Camera Sun Off')} />
            Sun &amp; shadows {sun.enabled ? `· ${sun.month}/${sun.day} ${formatSunTime(sun.hour)}` : ''}
          </label>
          {sun.enabled && (
            <input type="range" aria-label="Camera sun time" min={5} max={21} step={0.25} value={sun.hour} className="w-full accent-amber-500" onChange={(e) => onUpdate({ ...cam, sun: { ...sun, hour: Number(e.target.value) } }, 'Camera Sun Time…')} />
          )}
        </div>
      </details>
    </div>
  );
};

/**
 * VIEWS list (right panel): every camera with its thumbnail. Click = open, double-click = rename,
 * trash = delete. Walkthrough plays (or records) a fly-through through the cameras in this order.
 */
export const CameraViewsList: React.FC<{
  cameras: CameraEntity[];
  thumbs: Record<string, string | undefined>;
  activeCameraId: string | null;
  darkMode: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onPlayWalkthrough: (record: boolean) => void;
  onNewCamera: () => void;
}> = ({ cameras, thumbs, activeCameraId, darkMode, onOpen, onRename, onDelete, onPlayWalkthrough, onNewCamera }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const clickTimer = useRef(0);
  return (
    <div className={`border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`} data-testid="camera-views-list">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold uppercase tracking-wider cursor-pointer">
        <span className="flex items-center gap-1.5">
          <CameraIcon className="w-4 h-4 text-blue-600" /> Views ({cameras.length})
        </span>
        <span className="text-stone-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {cameras.length === 0 && (
            <div className="text-[11px] text-stone-500 px-1">
              No cameras yet.{' '}
              <button type="button" className="text-blue-600 underline cursor-pointer" onClick={onNewCamera}>
                Place one (CAM)
              </button>{' '}
              in plan to save a 3D perspective view.
            </div>
          )}
          {cameras.map((c) => (
            <div
              key={c.id}
              data-testid={`camera-view-item-${c.id}`}
              className={`group flex items-center gap-2 p-1 rounded-lg border cursor-pointer ${
                activeCameraId === c.id ? 'border-blue-500 bg-blue-500/10' : darkMode ? 'border-stone-800 hover:border-blue-500/60' : 'border-stone-200 hover:border-blue-400'
              }`}
              onClick={(e) => {
                if (e.detail > 1 || editing === c.id) return;
                // wait briefly so a double-click (rename) does not open the view first
                window.clearTimeout(clickTimer.current);
                clickTimer.current = window.setTimeout(() => onOpen(c.id), 260);
              }}
              onDoubleClick={() => {
                window.clearTimeout(clickTimer.current);
                setEditing(c.id);
              }}
              title="Click to open · double-click to rename"
            >
              <div className="w-16 h-9 shrink-0 rounded overflow-hidden bg-stone-300 dark:bg-stone-800 flex items-center justify-center">
                {thumbs[c.id] ? <img src={thumbs[c.id]} alt={`${c.name} thumbnail`} className="w-full h-full object-cover" /> : <CameraIcon className="w-4 h-4 text-stone-500" />}
              </div>
              <div className="min-w-0 flex-1">
                {editing === c.id ? (
                  <input
                    autoFocus
                    aria-label="Rename camera view"
                    defaultValue={c.name}
                    className={`${inputCls(darkMode)} w-full`}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.name) onRename(c.id, v);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <div className="text-xs font-semibold truncate">{c.name}</div>
                )}
                <div className="text-[10px] font-mono text-stone-500 truncate">{fovLabel(c.fov)}</div>
              </div>
              <button
                type="button"
                aria-label={`Delete ${c.name}`}
                className="p-1 rounded text-stone-400 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {cameras.length >= 2 && (
            <div className="flex items-center gap-1.5 pt-1">
              <button type="button" aria-label="Play walkthrough" className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold cursor-pointer" onClick={() => onPlayWalkthrough(false)}>
                <Play className="w-3.5 h-3.5" /> Walkthrough
              </button>
              <button type="button" aria-label="Export walkthrough video" title="Record the fly-through as a WebM video" className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${darkMode ? 'bg-stone-800 text-stone-100' : 'bg-stone-100 text-stone-800'}`} onClick={() => onPlayWalkthrough(true)}>
                <Film className="w-3.5 h-3.5" /> WebM
              </button>
            </div>
          )}
          {cameras.length >= 2 && <div className="text-[10px] text-stone-500 px-1">The fly-through follows the cameras in this list's order.</div>}
        </div>
      )}
    </div>
  );
};
