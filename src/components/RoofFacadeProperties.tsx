import React, { useState } from 'react';
import type {
  ArchEntity,
  DoorEntity,
  ExteriorFinish,
  InteriorFinish,
  LevelDefinition,
  RoofEntity,
  RoofMaterial,
  RoofStyle,
  UnitSystem,
  WallEntity,
  WindowDivisions,
  WindowEntity,
} from '../types/model';
import { EXTERIOR_FINISHES, INTERIOR_FINISHES, ROOF_MATERIALS, curtainOf, isCurtainWall, wallFinishBands } from '../engine/facade';
import {
  computeRoofGeometry,
  defaultEdgeSlopes,
  formatSlope,
  normalizeFootprint,
  offsetPolygon,
  parseSlopeInput,
  pointInPolygon,
  roofSpecFromEntity,
} from '../engine/roof';
import { formatArea, formatLength, parseLengthInput, polygonArea } from '../engine/geometry';
import { RoofStyleIcon, ROOF_STYLES } from './ToolOptionsBar';

interface Props {
  entity: ArchEntity;
  allEntities: ArchEntity[];
  levels: LevelDefinition[];
  units: UnitSystem;
  darkMode: boolean;
  onUpdateEntity: (next: ArchEntity, label: string) => void;
}

const rowCls = 'flex items-center justify-between gap-2';
const labelCls = 'text-xs text-stone-500 dark:text-stone-400';

/** Converts a legacy roof (outline incl. overhang, sitting on its level) to the v2 model. */
export function upgradeRoof(r: RoofEntity): RoofEntity {
  if (r.roofVersion === 2) return r;
  const norm = normalizeFootprint(r.polygon);
  const poly = offsetPolygon(norm.polygon, -(r.overhang || 0));
  const style: RoofStyle = r.roofStyle || 'gable';
  return {
    ...r,
    roofVersion: 2,
    polygon: poly,
    edgeSlopes: defaultEdgeSlopes(poly, style, r.ridgeAxis),
    baseOffset: 0,
    fasciaDepth: 8,
    gutter: style !== 'flat',
    material: style === 'flat' ? 'membrane' : 'asphalt-shingle',
  };
}

export const RoofFacadeProperties: React.FC<Props> = ({ entity, allEntities, levels, units, darkMode, onUpdateEntity }) => {
  const [more, setMore] = useState(false);
  const inputCls = `w-28 px-2 py-1 text-xs font-mono text-right rounded border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;
  const selectCls = `w-36 px-2 py-1 text-xs rounded border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;
  const section = `p-2.5 rounded-lg border space-y-2 ${darkMode ? 'bg-stone-950/50 border-stone-800' : 'bg-stone-50 border-stone-200/80'}`;
  const heading = 'text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400';

  const Len: React.FC<{ label: string; value: number; onChange: (v: number) => void; min?: number }> = ({ label, value, onChange, min = 0 }) => (
    <div className={rowCls}>
      <label className={labelCls}>{label}</label>
      <input
        aria-label={label}
        key={`${label}:${value}`}
        defaultValue={formatLength(value, units)}
        className={inputCls}
        onBlur={(e) => {
          const v = parseLengthInput(e.target.value, units);
          if (v === null || v < min) e.target.value = formatLength(value, units);
          else if (Math.abs(v - value) > 1e-6) onChange(v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
  const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <label className={`${rowCls} cursor-pointer`}>
      <span className={labelCls}>{label}</span>
      <input type="checkbox" className="accent-amber-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
  const Pick = <T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }) => (
    <div className={rowCls}>
      <label className={labelCls}>{label}</label>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={selectCls}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  const levelElev = (id?: string) => levels.find((l) => l.id === (id || 'level-1'))?.elevation ?? 0;

  // ------------------------------------------------------------------ ROOF
  if (entity.type === 'roof') {
    const r = entity;
    const up = (patch: Partial<RoofEntity>, label: string) => onUpdateEntity({ ...upgradeRoof(r), ...patch }, label);
    const v2 = upgradeRoof(r);
    const geom = computeRoofGeometry(roofSpecFromEntity(v2, levelElev(v2.levelId)));
    const flags = v2.edgeSlopes && v2.edgeSlopes.length === v2.polygon.length ? v2.edgeSlopes : geom.flags;
    return (
      <div className="space-y-2.5">
        <div className={section}>
          <div className={heading}>Roof type</div>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Roof type">
            {ROOF_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={r.roofStyle === s.id}
                title={`${s.label} roof`}
                onClick={() =>
                  up(
                    {
                      roofStyle: s.id,
                      edgeSlopes: defaultEdgeSlopes(v2.polygon, s.id, v2.ridgeAxis),
                      slope: s.id === 'flat' ? 0 : v2.slope || 18.43,
                      material: s.id === 'flat' ? 'membrane' : v2.material === 'membrane' ? 'asphalt-shingle' : v2.material,
                    },
                    `Roof Type: ${s.label}`
                  )
                }
                className={`flex flex-col items-center py-1 rounded border cursor-pointer ${r.roofStyle === s.id ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'border-transparent hover:bg-stone-100 dark:hover:bg-stone-800'}`}
              >
                <RoofStyleIcon style={s.id} />
                <span className="text-[9px]">{s.label}</span>
              </button>
            ))}
          </div>
          {r.roofStyle !== 'flat' && (
            <div className={rowCls}>
              <label className={labelCls}>Slope</label>
              <div className="flex items-center gap-1">
                <input
                  aria-label="Slope rise:run"
                  key={`s1:${v2.slope}`}
                  defaultValue={formatSlope(v2.slope)}
                  className={`${inputCls} w-16`}
                  onBlur={(e) => {
                    const v = parseSlopeInput(e.target.value);
                    if (v && v > 0 && v < 80) up({ slope: v }, `Roof Slope ${formatSlope(v)}`);
                    else e.target.value = formatSlope(v2.slope);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <input
                  aria-label="Slope degrees"
                  key={`s2:${v2.slope}`}
                  defaultValue={`${v2.slope.toFixed(1)}°`}
                  className={`${inputCls} w-16`}
                  onBlur={(e) => {
                    const v = parseSlopeInput(e.target.value);
                    if (v && v > 0 && v < 80) up({ slope: v }, `Roof Slope ${v.toFixed(1)}°`);
                    else e.target.value = `${v2.slope.toFixed(1)}°`;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            </div>
          )}
          <Len label="Overhang" value={v2.overhang} onChange={(v) => up({ overhang: Math.min(96, v) }, 'Roof Overhang')} />
          <Len label="Thickness" value={v2.thickness} min={2} onChange={(v) => up({ thickness: v }, 'Roof Thickness')} />
          <Pick
            label="Base level"
            value={v2.levelId || 'level-1'}
            options={levels.map((l) => ({ id: l.id, label: l.name }))}
            onChange={(v) => up({ levelId: v }, 'Roof Base Level')}
          />
          <Len label="Base offset" value={v2.baseOffset ?? 0} onChange={(v) => up({ baseOffset: v }, 'Roof Base Offset')} />
          <Pick
            label="Material"
            value={(v2.material || 'asphalt-shingle') as RoofMaterial}
            options={ROOF_MATERIALS.map((m) => ({ id: m.id, label: m.label }))}
            onChange={(v) => up({ material: v }, 'Roof Material')}
          />
          {r.roofStyle === 'flat' && <Len label="Parapet height" value={v2.parapetHeight ?? 0} onChange={(v) => up({ parapetHeight: v }, 'Roof Parapet')} />}
          <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] font-semibold text-amber-600 hover:underline cursor-pointer">
            {more ? 'Less' : 'More… (fascia, gutter, mansard)'}
          </button>
          {more && (
            <>
              <Len label="Fascia depth" value={v2.fasciaDepth ?? 8} onChange={(v) => up({ fasciaDepth: v }, 'Roof Fascia Depth')} />
              <Check label="Gutter" checked={!!v2.gutter} onChange={(v) => up({ gutter: v }, v ? 'Add Gutter' : 'Remove Gutter')} />
              {r.roofStyle === 'mansard' && (
                <>
                  <div className={rowCls}>
                    <label className={labelCls}>Lower slope</label>
                    <input
                      aria-label="Mansard lower slope"
                      key={`ml:${v2.mansardLowerSlope}`}
                      defaultValue={`${(v2.mansardLowerSlope ?? 70).toFixed(0)}°`}
                      className={inputCls}
                      onBlur={(e) => {
                        const v = parseSlopeInput(e.target.value);
                        if (v && v > 20 && v < 85) up({ mansardLowerSlope: v }, 'Mansard Lower Slope');
                      }}
                    />
                  </div>
                  <Len label="Break inset" value={v2.mansardBreakInset ?? 30} onChange={(v) => up({ mansardBreakInset: v }, 'Mansard Break Inset')} />
                </>
              )}
            </>
          )}
        </div>
        {r.roofStyle !== 'flat' && r.roofStyle !== 'mansard' && (
          <div className={section}>
            <div className={heading}>Edges — defines slope</div>
            <p className="text-[10px] text-stone-500">Unticked edges become gable ends. Shed roofs slope from the first ticked edge.</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {v2.polygon.map((p, i) => {
                const q = v2.polygon[(i + 1) % v2.polygon.length];
                const len = Math.hypot(q.x - p.x, q.y - p.y);
                return (
                  <label key={i} className={`${rowCls} cursor-pointer`}>
                    <span className="text-xs font-mono">
                      Edge {i + 1} · {formatLength(len, units)}
                    </span>
                    <input
                      type="checkbox"
                      className="accent-amber-600"
                      aria-label={`Edge ${i + 1} defines slope`}
                      checked={!!flags[i]}
                      onChange={(e) => {
                        const next = flags.slice();
                        next[i] = e.target.checked;
                        up({ edgeSlopes: next }, `Edge ${i + 1} ${e.target.checked ? 'defines slope' : 'gable end'}`);
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <div className="text-[11px] font-mono text-stone-500 space-y-0.5 px-1">
          <div>Ridge: {formatLength(geom.ridgeZ + geom.thickness, units)} · Eave: {formatLength(geom.eaveZ, units)}</div>
          <div>Plan area: {formatArea(polygonArea(geom.outline), units)}</div>
          <div>Lines: {['ridge', 'hip', 'valley'].map((k) => `${geom.lines.filter((l) => l.kind === k).length} ${k}`).join(', ')}</div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ WALL (facade)
  if (entity.type === 'wall') {
    const w = entity;
    const up = (patch: Partial<WallEntity>, label: string) => onUpdateEntity({ ...w, ...patch }, label);
    const H = (w.height || 108) + (w.parapetHeight || 0);
    const curtain = isCurtainWall(w);
    const roofs = allEntities.filter((e): e is RoofEntity => e.type === 'roof');
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    const roofAbove = roofs.find((r) => {
      const g = computeRoofGeometry(roofSpecFromEntity(r, levelElev(r.levelId)));
      return pointInPolygon(mid, g.outline);
    });
    const attachedTo = roofs.find((r) => r.id === w.attachedRoofId);
    const bands = wallFinishBands(w, H);
    return (
      <div className="space-y-2.5">
        {curtain ? (
          <div className={section}>
            <div className={heading}>Curtain wall grid</div>
            <Len label="Vertical grid ↔" value={curtainOf(w).vSpacing} min={6} onChange={(v) => up({ curtain: { ...curtainOf(w), vSpacing: v, panels: {} } }, 'Curtain Grid Spacing')} />
            <Len label="Horizontal grid ↕" value={curtainOf(w).hSpacing} min={6} onChange={(v) => up({ curtain: { ...curtainOf(w), hSpacing: v, panels: {} } }, 'Curtain Grid Spacing')} />
            <Len label="Mullion size" value={curtainOf(w).mullionSize} min={0.5} onChange={(v) => up({ curtain: { ...curtainOf(w), mullionSize: v } }, 'Mullion Size')} />
            <div className={rowCls}>
              <label className={labelCls}>Mullion colour</label>
              <input type="color" aria-label="Mullion colour" value={curtainOf(w).mullionColor} onChange={(e) => up({ curtain: { ...curtainOf(w), mullionColor: e.target.value } }, 'Mullion Colour')} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-stone-500">
                {Object.values(curtainOf(w).panels || {}).filter((t) => t !== 'glass').length} non-glass panel(s) — click cells in an elevation to change
              </span>
              <button type="button" className="text-[11px] text-amber-600 hover:underline cursor-pointer" onClick={() => up({ curtain: { ...curtainOf(w), panels: {} } }, 'Reset Curtain Panels')}>
                All glass
              </button>
            </div>
          </div>
        ) : (
          <div className={section}>
            <div className={heading}>Finishes</div>
            <Pick
              label="Exterior (top)"
              value={(w.exteriorFinish || 'lap-siding') as ExteriorFinish}
              options={EXTERIOR_FINISHES.map((f) => ({ id: f.id, label: f.label }))}
              onChange={(v) => up({ exteriorFinish: v }, 'Exterior Finish')}
            />
            {bands.slice(0, -1).map((b) => (
              <div key={b.index} className="flex items-center gap-1">
                <span className="text-[11px] font-mono text-stone-500 w-24 shrink-0">0–{formatLength(b.z1, units)}</span>
                <select
                  aria-label={`Band ${b.index + 1} finish`}
                  value={b.finish}
                  className={`${selectCls} w-28`}
                  onChange={(e) => {
                    const next = (w.finishBands || []).slice().sort((x, y) => x.upTo - y.upTo).map((x, i) => (i === b.index ? { ...x, finish: e.target.value as ExteriorFinish } : x));
                    up({ finishBands: next }, 'Band Finish');
                  }}
                >
                  {EXTERIOR_FINISHES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Remove split"
                  aria-label={`Remove split ${b.index + 1}`}
                  className="text-stone-400 hover:text-red-600 cursor-pointer px-1"
                  onClick={() => up({ finishBands: (w.finishBands || []).slice().sort((x, y) => x.upTo - y.upTo).filter((_, i) => i !== b.index) }, 'Remove Face Split')}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className={rowCls}>
              <label className={labelCls}>Add split at</label>
              <input
                aria-label="Add split at height"
                placeholder={formatLength(36, units)}
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const v = parseLengthInput((e.target as HTMLInputElement).value, units);
                  if (v && v > 1 && v < H - 1) {
                    const cur = bands.find((b) => v > b.z0 && v < b.z1)?.finish || w.exteriorFinish || 'lap-siding';
                    up({ finishBands: [...(w.finishBands || []), { upTo: v, finish: cur }].sort((x, y) => x.upTo - y.upTo) }, 'Split Face');
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </div>
            <Pick
              label="Interior"
              value={(w.interiorFinish || 'paint') as InteriorFinish}
              options={INTERIOR_FINISHES}
              onChange={(v) => up({ interiorFinish: v }, 'Interior Finish')}
            />
            <Pick
              label="Exterior side"
              value={(w.exteriorSide || 'auto') as 'auto' | 'left' | 'right'}
              options={[
                { id: 'auto', label: 'Auto (outside)' },
                { id: 'left', label: 'Left of direction' },
                { id: 'right', label: 'Right of direction' },
              ]}
              onChange={(v) => up({ exteriorSide: v }, 'Exterior Side')}
            />
            <Len label="Parapet" value={w.parapetHeight ?? 0} onChange={(v) => up({ parapetHeight: v }, 'Wall Parapet')} />
          </div>
        )}
        <div className={section}>
          <div className={heading}>Top</div>
          {attachedTo ? (
            <div className="flex items-center justify-between">
              <span className="text-xs">Attached to roof ✓</span>
              <button type="button" className="px-2 py-0.5 rounded border text-xs cursor-pointer" onClick={() => up({ attachedRoofId: undefined }, 'Detach Wall from Roof')}>
                Detach (DT)
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-500">{roofAbove ? 'A roof is above this wall.' : 'No roof above this wall.'}</span>
              <button
                type="button"
                disabled={!roofAbove}
                className="px-2 py-0.5 rounded bg-amber-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => roofAbove && up({ attachedRoofId: roofAbove.id }, 'Attach Wall to Roof')}
              >
                Attach to roof (AT)
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ WINDOW / DOOR styles
  if (entity.type === 'window' || entity.type === 'door') {
    const e = entity as WindowEntity | DoorEntity;
    type StyleFields = { frameWidth?: number; divisions?: WindowDivisions; trim?: boolean; shutters?: boolean; glazed?: boolean };
    const up = (patch: StyleFields, label: string) => onUpdateEntity({ ...e, ...patch } as ArchEntity, label);
    const divs: Array<{ id: WindowDivisions; label: string }> = [
      { id: '1x1', label: '1 × 1' },
      { id: '2x1', label: '2 × 1' },
      { id: '2x2', label: '2 × 2' },
      { id: '3x2', label: '3 × 2' },
    ];
    return (
      <div className={section}>
        <div className={heading}>{entity.type === 'window' ? 'Window style' : 'Door style'}</div>
        <Len label="Frame width" value={e.frameWidth ?? (entity.type === 'window' ? 2.5 : 2)} min={0.5} onChange={(v) => up({ frameWidth: v }, 'Frame Width')} />
        <Pick label={entity.type === 'window' ? 'Divisions' : 'Glass lites'} value={(e.divisions || '1x1') as WindowDivisions} options={divs} onChange={(v) => up({ divisions: v, ...(entity.type === 'door' ? { glazed: v !== '1x1' } : {}) }, 'Divisions')} />
        <Check label={entity.type === 'window' ? 'Sill & head trim' : 'Casing trim'} checked={e.trim !== false} onChange={(v) => up({ trim: v }, 'Trim')} />
        {entity.type === 'window' && <Check label="Shutters" checked={!!(e as WindowEntity).shutters} onChange={(v) => up({ shutters: v }, 'Shutters')} />}
      </div>
    );
  }

  // ------------------------------------------------------------------ ADD-ONS
  if (entity.type === 'skylight') {
    const up = (patch: Partial<typeof entity>, label: string) => onUpdateEntity({ ...entity, ...patch }, label);
    return (
      <div className={section}>
        <div className={heading}>Skylight</div>
        <Len label="Width (across)" value={entity.width} min={6} onChange={(v) => up({ width: v }, 'Skylight Width')} />
        <Len label="Length (along slope)" value={entity.length} min={6} onChange={(v) => up({ length: v }, 'Skylight Length')} />
        <p className="text-[10px] text-stone-500">Drag the grip in plan to move it on the roof.</p>
      </div>
    );
  }
  if (entity.type === 'dormer') {
    const up = (patch: Partial<typeof entity>, label: string) => onUpdateEntity({ ...entity, ...patch }, label);
    return (
      <div className={section}>
        <div className={heading}>Dormer</div>
        <Len label="Width" value={entity.width} min={24} onChange={(v) => up({ width: v }, 'Dormer Width')} />
        <Len label="Wall height" value={entity.height} min={12} onChange={(v) => up({ height: v }, 'Dormer Height')} />
        <div className={rowCls}>
          <label className={labelCls}>Dormer slope</label>
          <input
            aria-label="Dormer slope"
            key={`ds:${entity.slope}`}
            defaultValue={entity.slope ? formatSlope(entity.slope) : 'same as roof'}
            className={inputCls}
            onBlur={(ev) => {
              const v = parseSlopeInput(ev.target.value);
              if (v && v > 0) up({ slope: v }, 'Dormer Slope');
            }}
          />
        </div>
        <Len label="Window width" value={entity.windowWidth ?? entity.width * 0.6} min={6} onChange={(v) => up({ windowWidth: v }, 'Dormer Window')} />
        <Len label="Window height" value={entity.windowHeight ?? entity.height * 0.7} min={6} onChange={(v) => up({ windowHeight: v }, 'Dormer Window')} />
      </div>
    );
  }
  if (entity.type === 'sweep') {
    const up = (patch: Partial<typeof entity>, label: string) => onUpdateEntity({ ...entity, ...patch }, label);
    return (
      <div className={section}>
        <div className={heading}>{entity.profile === 'reveal' ? 'Reveal' : 'Sweep'}</div>
        <Pick
          label="Profile"
          value={entity.profile}
          options={[
            { id: 'band', label: 'Band' },
            { id: 'cornice', label: 'Cornice' },
            { id: 'base', label: 'Base' },
            { id: 'reveal', label: 'Reveal (groove)' },
          ]}
          onChange={(v) => up({ profile: v, projection: v === 'reveal' ? -1 : Math.max(1, entity.projection) }, 'Sweep Profile')}
        />
        <Len label="Height" value={entity.height} onChange={(v) => up({ height: v }, 'Sweep Height')} />
        <Len label="Size" value={entity.size} min={0.5} onChange={(v) => up({ size: v }, 'Sweep Size')} />
        {entity.profile !== 'reveal' && (
          <div className={rowCls}>
            <label className={labelCls}>Colour</label>
            <input type="color" aria-label="Sweep colour" value={entity.color || '#f5f5f4'} onChange={(e) => up({ color: e.target.value }, 'Sweep Colour')} />
          </div>
        )}
      </div>
    );
  }
  if (entity.type === 'balcony') {
    const up = (patch: Partial<typeof entity>, label: string) => onUpdateEntity({ ...entity, ...patch }, label);
    return (
      <div className={section}>
        <div className={heading}>Balcony</div>
        <Len label="Width" value={entity.width} min={24} onChange={(v) => up({ width: v }, 'Balcony Width')} />
        <Len label="Depth" value={entity.depth} min={12} onChange={(v) => up({ depth: v }, 'Balcony Depth')} />
        <Len label="Floor height" value={entity.elevationOffset} onChange={(v) => up({ elevationOffset: v }, 'Balcony Height')} />
        <Len label="Slab" value={entity.slabThickness} min={2} onChange={(v) => up({ slabThickness: v }, 'Balcony Slab')} />
        <Len label="Railing height" value={entity.railingHeight} min={12} onChange={(v) => up({ railingHeight: v }, 'Balcony Railing')} />
        <Pick label="Railing" value={entity.railingStyle} options={[{ id: 'balusters', label: 'Balusters' }, { id: 'glass', label: 'Glass' }]} onChange={(v) => up({ railingStyle: v }, 'Balcony Railing Style')} />
        <div className={rowCls}>
          <label className={labelCls}>Position along wall</label>
          <input
            aria-label="Balcony position percent"
            type="range"
            min={0}
            max={100}
            value={Math.round(entity.offset * 100)}
            onChange={(e) => up({ offset: Number(e.target.value) / 100 }, 'Balcony Position')}
          />
        </div>
      </div>
    );
  }
  if (entity.type === 'railing') {
    const up = (patch: Partial<typeof entity>, label: string) => onUpdateEntity({ ...entity, ...patch }, label);
    return (
      <div className={section}>
        <div className={heading}>Railing</div>
        <Pick label="Style" value={entity.style} options={[{ id: 'balusters', label: 'Top rail + balusters' }, { id: 'glass', label: 'Glass panels' }]} onChange={(v) => up({ style: v }, 'Railing Style')} />
        <Len label="Height" value={entity.height} min={12} onChange={(v) => up({ height: v }, 'Railing Height')} />
        {entity.style === 'balusters' && <Len label="Baluster spacing" value={entity.balusterSpacing} min={2} onChange={(v) => up({ balusterSpacing: v }, 'Baluster Spacing')} />}
        <Len label="Base offset" value={entity.baseOffset} onChange={(v) => up({ baseOffset: v }, 'Railing Base Offset')} />
      </div>
    );
  }
  return null;
};
