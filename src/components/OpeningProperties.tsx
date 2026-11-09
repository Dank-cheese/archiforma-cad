import React, { useState } from 'react';
import type {
  ArchEntity,
  DepthPosition,
  DoorEntity,
  DoorKind,
  DoorPanelStyle,
  DoorType,
  FrameMaterial,
  UnitSystem,
  WallEntity,
  WallOpeningEntity,
  WindowDivisions,
  WindowEntity,
  WindowOperation,
  WindowType,
} from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import { DOOR_KIND_LABEL, DOOR_STYLE_LABEL } from '../engine/doorStyles';
import { doorTypeFields, FRAME_MATERIALS, headOf, openingWarnings, sillOf, windowTypeFields } from '../engine/openings';

type Opening = DoorEntity | WindowEntity | WallOpeningEntity;

const DOOR_KINDS = Object.entries(DOOR_KIND_LABEL) as Array<[DoorKind, string]>;
const DOOR_STYLES = Object.entries(DOOR_STYLE_LABEL) as Array<[DoorPanelStyle, string]>;
const CAT_LABEL: Record<string, string> = { hinged: 'Hinged single & double', sliding: 'Sliding & folding', specialty: 'Specialty & utility' };
/** Type <option>s grouped by catalog category. */
export function groupedDoorOptions(types: DoorType[]) {
  const cats = Array.from(new Set(types.map((t) => t.category || 'other')));
  return cats.map((c) => (
    <optgroup key={c} label={CAT_LABEL[c] || 'Other'}>
      {types
        .filter((t) => (t.category || 'other') === c)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
    </optgroup>
  ));
}
const WINDOW_OPS: Array<[WindowOperation, string]> = [
  ['fixed', 'Fixed picture'],
  ['casement', 'Casement'],
  ['double-hung', 'Double-hung'],
  ['awning', 'Awning'],
  ['slider', 'Slider'],
];
const DIVS: WindowDivisions[] = ['1x1', '2x1', '2x2', '3x2'];

/**
 * Properties of a hosted door / window / wall opening, Revit-style:
 *  TYPE properties (all of this type): width, height, kind / operation, frame material, divisions.
 *  INSTANCE properties (this one): sill + head (linked: head = sill + height), depth position, flip, mark.
 */
export const OpeningProperties: React.FC<{
  entity: Opening;
  allEntities: ArchEntity[];
  doorTypes: DoorType[];
  windowTypes: WindowType[];
  units: UnitSystem;
  darkMode: boolean;
  onUpdateEntity: (e: ArchEntity, label: string) => void;
  onUpdateDoorType?: (t: DoorType) => void;
  onUpdateWindowType?: (t: WindowType) => void;
}> = ({ entity: e, allEntities, doorTypes, windowTypes, units, darkMode, onUpdateEntity, onUpdateDoorType, onUpdateWindowType }) => {
  const [editType, setEditType] = useState(false);
  const [more, setMore] = useState(false);
  const field = `px-2 py-1 text-xs rounded border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;
  const heading = 'text-[10px] font-bold uppercase tracking-wider text-stone-400 pt-1';
  const seg = (on: boolean) =>
    `px-2 py-0.5 rounded-md border text-[11px] font-semibold ${on ? 'bg-sky-600 border-sky-600 text-white' : darkMode ? 'border-stone-700 text-stone-300' : 'border-stone-300 text-stone-600'}`;
  const up = (patch: Partial<Opening>, label: string) => onUpdateEntity({ ...e, ...patch } as ArchEntity, label);
  const host = allEntities.find((w): w is WallEntity => w.type === 'wall' && w.id === e.wallId);
  const L = host ? Math.hypot(host.end.x - host.start.x, host.end.y - host.start.y) : 0;
  const warns = openingWarnings(allEntities).filter((w) => w.id === e.id);

  const Len: React.FC<{ label: string; value: number; min?: number; onSet: (v: number) => void; testId?: string }> = ({ label, value, min = 0, onSet, testId }) => {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
      if (draft === null) return;
      const v = parseLengthInput(draft, units);
      if (v !== null && v >= min) onSet(v);
      setDraft(null);
    };
    return (
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-stone-500 dark:text-stone-400">{label}</label>
        <input
          aria-label={label}
          data-testid={testId}
          value={draft ?? formatLength(value, units)}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={commit}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              commit();
              (ev.target as HTMLInputElement).blur();
            } else if (ev.key === 'Escape') setDraft(null);
          }}
          className={`w-28 ${field} font-mono text-right`}
        />
      </div>
    );
  };
  const Sel = <T extends string>({ label, value, options, onSet }: { label: string; value: T; options: Array<[T, string]>; onSet: (v: T) => void }) => (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs text-stone-500 dark:text-stone-400">{label}</label>
      <select aria-label={label} value={value} onChange={(ev) => onSet(ev.target.value as T)} className={`w-36 ${field}`}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  const depth = e.type === 'wallopening' ? undefined : e.depthPosition;
  const depthKind = typeof depth === 'number' ? 'custom' : depth || 'center';
  const setDepth = (d: DepthPosition) => up({ depthPosition: d } as Partial<Opening>, 'Change Depth Position');

  // ---------------- TYPE (doors / windows)
  const typeBox = (() => {
    if (e.type === 'door') {
      const dt = doorTypes.find((t) => t.id === e.doorTypeId) || doorTypes[0];
      return (
        <div className={`p-2.5 rounded-lg border space-y-2 ${darkMode ? 'bg-stone-950/70 border-stone-800' : 'bg-stone-50 border-stone-200'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Door type</span>
            <button type="button" onClick={() => setEditType((v) => !v)} className="text-[10px] font-semibold text-amber-600 hover:underline">
              {editType ? 'Close type' : 'Edit type…'}
            </button>
          </div>
          <select
            aria-label="Door type"
            value={e.doorTypeId || dt?.id}
            onChange={(ev) => {
              const t = doorTypes.find((x) => x.id === ev.target.value);
              if (t) up(doorTypeFields(t), `Change Door Type: ${t.name}`);
            }}
            className={`w-full ${field}`}
          >
            {groupedDoorOptions(doorTypes)}
          </select>
          {editType && dt && onUpdateDoorType && (
            <div className="pt-2 border-t border-stone-500/20 space-y-2">
              <div className="text-[10px] text-amber-600 font-semibold">Type properties — updates every "{dt.name}" door</div>
              <Len label="Width" value={dt.width} min={18} onSet={(v) => onUpdateDoorType({ ...dt, width: v })} />
              <Len label="Height" value={dt.height} min={48} onSet={(v) => onUpdateDoorType({ ...dt, height: v })} />
              <Sel label="Operation" value={dt.kind || 'single'} options={DOOR_KINDS} onSet={(v) => onUpdateDoorType({ ...dt, kind: v })} />
              <Sel label="Leaf design" value={dt.panelStyle || 'flush'} options={DOOR_STYLES} onSet={(v) => onUpdateDoorType({ ...dt, panelStyle: v })} />
              {['sliding', 'multislide', 'bifold'].includes(dt.kind || '') && (
                <Sel label="Panels / leaves" value={String(dt.panels || 2)} options={['2', '3', '4', '5', '6'].map((n) => [n, n] as [string, string])} onSet={(v) => onUpdateDoorType({ ...dt, panels: Number(v) })} />
              )}
              <Sel label="Sidelights" value={String(dt.sidelights || 0)} options={[['0', 'None'], ['1', 'One'], ['2', 'Both sides']]} onSet={(v) => onUpdateDoorType({ ...dt, sidelights: Number(v) })} />
              <Len label="Transom height" value={dt.transom || 0} onSet={(v) => onUpdateDoorType({ ...dt, transom: v })} />
              <label className="flex items-center justify-between text-xs text-stone-500">
                Screen / storm door
                <input type="checkbox" checked={!!dt.screenDoor} onChange={(ev) => onUpdateDoorType({ ...dt, screenDoor: ev.target.checked })} />
              </label>
              <Sel label="Frame material" value={dt.frameMaterial || 'wood'} options={FRAME_MATERIALS.map((m) => [m.id, m.label] as [FrameMaterial, string])} onSet={(v) => onUpdateDoorType({ ...dt, frameMaterial: v })} />
              <Sel label="Glass lites" value={dt.divisions || '1x1'} options={DIVS.map((d) => [d, d === '1x1' ? 'None (solid)' : d] as [WindowDivisions, string])} onSet={(v) => onUpdateDoorType({ ...dt, divisions: v })} />
            </div>
          )}
        </div>
      );
    }
    if (e.type === 'window') {
      const wt = windowTypes.find((t) => t.id === e.windowTypeId) || windowTypes[0];
      return (
        <div className={`p-2.5 rounded-lg border space-y-2 ${darkMode ? 'bg-stone-950/70 border-stone-800' : 'bg-stone-50 border-stone-200'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Window type</span>
            <button type="button" onClick={() => setEditType((v) => !v)} className="text-[10px] font-semibold text-amber-600 hover:underline">
              {editType ? 'Close type' : 'Edit type…'}
            </button>
          </div>
          <select
            aria-label="Window type"
            value={e.windowTypeId || wt?.id}
            onChange={(ev) => {
              const t = windowTypes.find((x) => x.id === ev.target.value);
              if (t) up({ ...windowTypeFields(t), sillHeight: t.sillHeight }, `Change Window Type: ${t.name}`);
            }}
            className={`w-full ${field}`}
          >
            {windowTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {editType && wt && onUpdateWindowType && (
            <div className="pt-2 border-t border-stone-500/20 space-y-2">
              <div className="text-[10px] text-amber-600 font-semibold">Type properties — updates every "{wt.name}" window</div>
              <Len label="Width" value={wt.width} min={12} onSet={(v) => onUpdateWindowType({ ...wt, width: v })} />
              <Len label="Height" value={wt.height} min={12} onSet={(v) => onUpdateWindowType({ ...wt, height: v })} />
              <Sel label="Operation" value={wt.operation || 'fixed'} options={WINDOW_OPS} onSet={(v) => onUpdateWindowType({ ...wt, operation: v })} />
              <Sel label="Frame material" value={wt.frameMaterial || 'vinyl'} options={FRAME_MATERIALS.map((m) => [m.id, m.label] as [FrameMaterial, string])} onSet={(v) => onUpdateWindowType({ ...wt, frameMaterial: v })} />
              <Sel label="Divisions" value={wt.divisions || '1x1'} options={DIVS.map((d) => [d, d] as [WindowDivisions, string])} onSet={(v) => onUpdateWindowType({ ...wt, divisions: v })} />
              <Len label="Default sill (new windows)" value={wt.sillHeight} onSet={(v) => onUpdateWindowType({ ...wt, sillHeight: v })} />
            </div>
          )}
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="space-y-2" data-testid="opening-properties">
      {warns.map((w, i) => (
        <div key={i} className="flex gap-1.5 items-start text-[11px] p-2 rounded-md border border-yellow-400 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-200">
          <span aria-hidden>⚠</span>
          <span>{w.message}</span>
        </div>
      ))}
      {typeBox}

      <div className={heading}>Instance (this {e.type === 'wallopening' ? 'opening' : e.type})</div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-stone-500 dark:text-stone-400">Mark</label>
        <input aria-label="Mark" value={e.mark || ''} onChange={(ev) => up({ mark: ev.target.value }, 'Change Mark')} className={`w-28 ${field} font-mono text-right`} />
      </div>
      {e.type === 'wallopening' && (
        <>
          <Sel label="Shape" value={e.shape} options={[['rect', 'Rectangular'], ['arch', 'Arched']]} onSet={(v) => up({ shape: v } as Partial<Opening>, 'Change Opening Shape')} />
          <Len label="Width" value={e.width} min={6} onSet={(v) => up({ width: v }, 'Change Opening Width')} />
          <Len label="Height" value={e.height} min={6} onSet={(v) => up({ height: v }, 'Change Opening Height')} />
        </>
      )}
      {e.type !== 'door' && (
        <Len label="Sill height" testId="sill-input" value={sillOf(e)} onSet={(v) => up({ sillHeight: v } as Partial<Opening>, 'Change Sill Height')} />
      )}
      <Len
        label="Head height"
        testId="head-input"
        value={headOf(e)}
        min={6}
        onSet={(v) =>
          e.type === 'door'
            ? up({ height: Math.max(48, v) }, 'Change Door Head Height')
            : up({ sillHeight: Math.max(0, v - e.height) } as Partial<Opening>, 'Change Head Height (sill follows)')
        }
      />
      <div className="text-[10px] text-stone-400 -mt-1 text-right">head = sill + height ({formatLength(e.height, units)})</div>

      {e.type !== 'wallopening' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">Depth in wall</span>
          <div className="flex gap-1" role="group" aria-label="Depth position">
            {(['exterior', 'center', 'interior'] as const).map((d) => (
              <button key={d} type="button" className={seg(depthKind === d)} onClick={() => setDepth(d)}>
                {d === 'exterior' ? 'Ext' : d === 'center' ? 'Ctr' : 'Int'}
              </button>
            ))}
          </div>
        </div>
      )}
      {e.type === 'door' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">Flip</span>
          <div className="flex gap-1">
            <button
              type="button"
              className={seg(false)}
              onClick={() => {
                const [hand, face] = e.swing.split('-');
                up({ swing: `${hand}-${face === 'in' ? 'out' : 'in'}` as DoorEntity['swing'] }, 'Flip Door Facing');
              }}
            >
              ⇅ Facing
            </button>
            <button
              type="button"
              className={seg(false)}
              onClick={() => {
                const [hand, face] = e.swing.split('-');
                up({ swing: `${hand === 'left' ? 'right' : 'left'}-${face}` as DoorEntity['swing'] }, 'Flip Door Hand');
              }}
            >
              ⇆ Hand
            </button>
          </div>
        </div>
      )}
      {e.type === 'window' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">Exterior side</span>
          <button type="button" className={seg(!!e.flipFacing)} onClick={() => up({ flipFacing: !e.flipFacing } as Partial<Opening>, 'Flip Window Facing')}>
            ⇅ {e.flipFacing ? 'Flipped' : 'Wall exterior'}
          </button>
        </div>
      )}
      {host && (
        <Len
          label="From wall start (centre)"
          value={e.offset * L}
          onSet={(v) => up({ offset: Math.max(0, Math.min(L, v)) / Math.max(1, L) }, 'Move Opening Along Wall')}
        />
      )}

      <button type="button" className="text-[11px] font-semibold text-sky-600 hover:underline" onClick={() => setMore((v) => !v)} aria-expanded={more}>
        {more ? 'Less' : 'More…'}
      </button>
      {more && (
        <div className="space-y-2">
          {e.type !== 'wallopening' && (
            <>
              <Len
                label="Custom depth (+ toward exterior)"
                value={typeof depth === 'number' ? Math.abs(depth) : 0}
                onSet={(v) => setDepth(v)}
              />
              {typeof depth === 'number' && (
                <button type="button" className={seg(depth < 0)} onClick={() => setDepth(-depth)}>
                  {depth < 0 ? 'Toward interior' : 'Toward exterior'} (click to swap)
                </button>
              )}
              <Len label="Width (this instance)" value={e.width} min={12} onSet={(v) => up({ width: v }, 'Change Instance Width')} />
              <Len label="Height (this instance)" value={e.height} min={12} onSet={(v) => up({ height: v }, 'Change Instance Height')} />
              <Len label="Frame width" value={e.frameWidth ?? (e.type === 'window' ? 2.5 : 2)} min={0.5} onSet={(v) => up({ frameWidth: v } as Partial<Opening>, 'Frame Width')} />
              <label className="flex items-center justify-between text-xs text-stone-500">
                {e.type === 'window' ? 'Sill & head trim' : 'Casing trim'}
                <input type="checkbox" checked={e.trim !== false} onChange={(ev) => up({ trim: ev.target.checked } as Partial<Opening>, 'Trim')} />
              </label>
              {e.type === 'window' && (
                <label className="flex items-center justify-between text-xs text-stone-500">
                  Shutters
                  <input type="checkbox" checked={!!e.shutters} onChange={(ev) => up({ shutters: ev.target.checked } as Partial<Opening>, 'Shutters')} />
                </label>
              )}
            </>
          )}
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-stone-500 dark:text-stone-400">Comments</label>
            <input aria-label="Comments" value={e.comments || ''} onChange={(ev) => up({ comments: ev.target.value }, 'Comments')} className={`w-36 ${field}`} />
          </div>
          <div className="text-[10px] text-stone-400">
            Hosted by wall {host ? `(${formatLength(L, units)} long)` : '(missing)'} — drag it in plan to slide along the wall or onto another wall; it can never leave its wall.
          </div>
        </div>
      )}
    </div>
  );
};
