import { TAIL_CUTS, TRUSS_STYLES } from '../engine/timber';
import type { BeamEntity, TailCut, TrussEntity } from '../types/model';
import React, { useMemo, useState } from 'react';
import type {
  ArchEntity,
  ArchModel,
  BeamJustification,
  DoorEntity,
  LevelDefinition,
  RebarCover,
  RebarLayoutRule,
  RebarPlacement,
  RebarShape,
  SteelConnectionKind,
  StructuralJointKind,
  UnitSystem,
  WindowEntity,
} from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import {
  BAR_SIZES,
  barSize,
  beamAxis,
  beamSection,
  beamSystemJoists,
  columnMaterialId,
  columnSection,
  computeAreaReinfBars,
  computeLintels,
  computeRebarBars,
  defaultCover,
  hasFoundationBelow,
  isConcrete,
  materialById,
  profilesFor,
  rebarHostOf,
  REBAR_PRESETS,
  SHAPE_LABEL,
  SPAN_DEPTH_LIMIT,
  STRUCTURAL_DISCLAIMER,
  STRUCTURAL_MATERIALS,
  suggestLintel,
  wallStructuralMaterialId,
} from '../engine/structure';

export type StructuralAction = 'preset' | 'footingUnder' | 'wallFooting' | 'openSection' | 'basePlate';

interface Props {
  entity: ArchEntity;
  model: Pick<ArchModel, 'entities' | 'levels' | 'settings' | 'structureJoins'>;
  levels: LevelDefinition[];
  units: UnitSystem;
  darkMode: boolean;
  onUpdateEntity: (next: ArchEntity, label: string) => void;
  onAction: (action: StructuralAction, entityId: string) => void;
}

const rowCls = 'flex items-center justify-between gap-2';
const labelCls = 'text-xs text-stone-500 dark:text-stone-400';

/** Properties for structural elements and the structural part of walls, slabs, columns and openings. */
export const StructuralProperties: React.FC<Props> = ({ entity: e, model, levels, units, darkMode, onUpdateEntity, onAction }) => {
  const [more, setMore] = useState(false);
  const inputCls = `w-28 px-2 py-1 text-xs font-mono text-right rounded border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;
  const selectCls = `w-40 px-2 py-1 text-xs rounded border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-stone-50 border-stone-300 text-stone-900'}`;
  const box = `p-2.5 rounded-lg border space-y-2 ${darkMode ? 'bg-stone-950/50 border-stone-800' : 'bg-sky-50/50 border-sky-200/80'}`;
  const heading = 'text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400';
  const btn = 'w-full px-2 py-1.5 rounded-md text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white cursor-pointer';
  const btn2 = `w-full px-2 py-1.5 rounded-md text-xs font-semibold border cursor-pointer ${darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-300 hover:bg-white'}`;
  const upd = (patch: Record<string, unknown>, label: string) => onUpdateEntity({ ...e, ...patch } as ArchEntity, label);

  const Len: React.FC<{ label: string; value: number; onChange: (v: number) => void; neg?: boolean }> = ({ label, value, onChange, neg }) => (
    <div className={rowCls}>
      <label className={labelCls}>{label}</label>
      <input
        aria-label={label}
        key={`${label}:${value}`}
        defaultValue={formatLength(value, units)}
        className={inputCls}
        onBlur={(ev) => {
          const raw = ev.target.value.trim();
          const isNeg = raw.startsWith('-');
          const v0 = parseLengthInput(isNeg ? raw.slice(1) : raw, units);
          const v = v0 === null ? null : isNeg && neg ? -v0 : v0;
          if (v === null || (!neg && v < 0)) ev.target.value = formatLength(value, units);
          else if (Math.abs(v - value) > 1e-6) onChange(v);
        }}
        onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
      />
    </div>
  );
  const Num: React.FC<{ label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }> = ({ label, value, onChange, step, min }) => (
    <div className={rowCls}>
      <label className={labelCls}>{label}</label>
      <input aria-label={label} type="number" step={step ?? 1} min={min} value={value} className={inputCls} onChange={(ev) => onChange(Number(ev.target.value))} />
    </div>
  );
  const Sel: React.FC<{ label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
    <div className={rowCls}>
      <label className={labelCls}>{label}</label>
      <select aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)} className={selectCls}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <label className={`${rowCls} cursor-pointer`}>
      <span className={labelCls}>{label}</span>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(ev) => onChange(ev.target.checked)} />
    </label>
  );
  const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className={rowCls}>
      <span className={labelCls}>{label}</span>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
  const fmt = (v: number) => formatLength(v, units);
  const matOptions = (families: string[]): Array<[string, string]> => STRUCTURAL_MATERIALS.filter((m) => families.includes(m.family)).map((m) => [m.id, m.label]);
  const levelOptions: Array<[string, string]> = levels.map((l) => [l.id, l.name]);
  const barOptions: Array<[string, string]> = BAR_SIZES.filter((b) => b.system === (units === 'metric' ? 'metric' : 'us')).map((b) => [b.id, b.id]);
  const coverEditor = (cover: Partial<RebarCover> | undefined, base: RebarCover, onSet: (c: Partial<RebarCover>) => void, title = 'Concrete cover') => (
    <>
      <div className="text-[10px] text-stone-500 uppercase tracking-wide pt-1">{title}</div>
      <Len label="Top" value={cover?.top ?? base.top} onChange={(v) => onSet({ ...cover, top: v })} />
      <Len label="Bottom" value={cover?.bottom ?? base.bottom} onChange={(v) => onSet({ ...cover, bottom: v })} />
      <Len label="Sides" value={cover?.sides ?? base.sides} onChange={(v) => onSet({ ...cover, sides: v })} />
    </>
  );
  const presetFor = (hostId: string) => {
    const host = rebarHostOf(model, hostId);
    if (!host) return null;
    const p = REBAR_PRESETS.find((x) => x.hostKinds.includes(host.kind));
    if (!p) return null;
    return (
      <button type="button" className={btn} onClick={() => onAction('preset', hostId)} title="Quick preset — bars stay inside the host minus cover">
        Rebar preset: {p.label}
      </button>
    );
  };
  const hostSets = useMemo(() => model.entities.filter((r) => (r.type === 'rebar' || r.type === 'areareinf') && r.hostId === e.id), [model.entities, e.id]);
  const hostRebarInfo = hostSets.length > 0 && <Info label="Rebar sets" value={`${hostSets.length}`} />;
  const disclaimer = <p className="text-[10px] leading-snug text-stone-500 italic">{STRUCTURAL_DISCLAIMER}</p>;

  let body: React.ReactNode = null;
  switch (e.type) {
    case 'column': {
      const matId = columnMaterialId(e);
      const fam = materialById(matId).family;
      const sec = columnSection(e);
      const profs = profilesFor(fam, 'column');
      const topMode = e.topBeamId ? 'beam' : e.topLevelId ? 'level' : 'height';
      body = (
        <>
          <Sel label="Material" value={matId} options={matOptions(['concrete', 'steel', 'wood'])} onChange={(v) => {
            const f = materialById(v).family;
            const p = profilesFor(f, 'column')[0];
            upd({ structuralMaterialId: v, profileId: f === 'concrete' ? undefined : p?.id, width: f === 'concrete' ? Math.max(12, e.width) : p?.bf ?? e.width, depth: f === 'concrete' ? Math.max(12, e.depth) : p?.d ?? e.depth }, 'Column Material');
          }} />
          {fam === 'concrete' ? (
            <>
              <Sel label="Shape" value={e.shape} options={[['rectangular', 'Rectangle'], ['round', 'Round']]} onChange={(v) => upd({ shape: v }, 'Column Shape')} />
              <Len label={e.shape === 'round' ? 'Diameter' : 'Width'} value={e.width} onChange={(v) => upd({ width: v, depth: e.shape === 'round' ? v : e.depth }, 'Column Size')} />
              {e.shape !== 'round' && <Len label="Depth" value={e.depth} onChange={(v) => upd({ depth: v }, 'Column Size')} />}
            </>
          ) : (
            <Sel label="Section" value={sec.id} options={profs.map((p) => [p.id, p.label])} onChange={(v) => {
              const p = profs.find((x) => x.id === v)!;
              upd({ profileId: v, width: p.bf, depth: p.d, shape: p.kind === 'HSS-round' ? 'round' : 'rectangular' }, 'Column Section');
            }} />
          )}
          <Sel label="Base level" value={e.levelId || 'level-1'} options={levelOptions} onChange={(v) => upd({ levelId: v }, 'Column Base Level')} />
          <Len label="Base offset" value={e.baseOffset || 0} neg onChange={(v) => upd({ baseOffset: v }, 'Column Base Offset')} />
          <Sel label="Top" value={topMode} options={[['height', 'Unconnected height'], ['level', 'Attached to level'], ...(e.topBeamId ? [['beam', 'Attached to beam'] as [string, string]] : [])]} onChange={(v) => {
            if (v === 'height') upd({ topLevelId: undefined, topBeamId: undefined }, 'Column Top');
            else if (v === 'level') {
              const base = levels.find((l) => l.id === (e.levelId || 'level-1'));
              const above = [...levels].sort((a, b) => a.elevation - b.elevation).find((l) => l.elevation > (base?.elevation ?? 0));
              upd({ topLevelId: (above || base)?.id, topBeamId: undefined, topOffset: 0 }, 'Column Top');
            }
          }} />
          {topMode === 'level' && (
            <>
              <Sel label="Top level" value={e.topLevelId!} options={levelOptions} onChange={(v) => upd({ topLevelId: v }, 'Column Top Level')} />
              <Len label="Top offset" value={e.topOffset || 0} neg onChange={(v) => upd({ topOffset: v }, 'Column Top Offset')} />
            </>
          )}
          {topMode === 'height' && <Len label="Height" value={e.height} onChange={(v) => upd({ height: v }, 'Column Height')} />}
          {topMode === 'beam' && <p className="text-[11px] text-stone-500">Top follows the underside of its beam. Select the column + a beam and run "Attach top to beam" (ATB) to change it.</p>}
          {fam === 'steel' && <Info label="Base plate" value={`${Math.round(sec.bf + 4)}" x ${Math.round(sec.d + 4)}" + 4 anchors (auto)`} />}
          {!hasFoundationBelow(model, e) && (
            <button type="button" className={btn2} onClick={() => onAction('footingUnder', e.id)}>
              Place footing under this column
            </button>
          )}
          {isConcrete(matId) && presetFor(e.id)}
          {hostRebarInfo}
          {isConcrete(matId) && (more ? coverEditor(e.cover, defaultCover('column'), (c) => upd({ cover: { ...defaultCover('column'), ...c } }, 'Column Cover')) : null)}
        </>
      );
      break;
    }
    case 'footing': {
      body = (
        <>
          <Info label="Type" value={e.kind === 'wall' ? 'Wall (strip) footing' : e.kind === 'pilecap' ? 'Pile cap' : 'Isolated pad'} />
          {e.kind !== 'wall' && (
            <>
              <Len label="Length" value={e.length} onChange={(v) => upd({ length: v }, 'Footing Length')} />
              <Len label="Width" value={e.width} onChange={(v) => upd({ width: v }, 'Footing Width')} />
            </>
          )}
          {e.kind === 'wall' && (
            <>
              <Len label="Width" value={e.width} onChange={(v) => upd({ width: v }, 'Wall Footing Width')} />
              <Len label="Offset from wall" value={e.offset || 0} neg onChange={(v) => upd({ offset: v }, 'Wall Footing Offset')} />
            </>
          )}
          <Len label="Thickness" value={e.thickness} onChange={(v) => upd({ thickness: v }, 'Footing Thickness')} />
          <Len label="Top elevation" value={e.topOffset} neg onChange={(v) => upd({ topOffset: v }, 'Footing Top Elevation')} />
          {e.kind === 'pilecap' && (
            <>
              <Num label="Piles" value={e.piles?.count ?? 4} min={1} onChange={(v) => upd({ piles: { ...(e.piles || { diameter: 14, length: 360 }), count: Math.max(1, Math.min(9, v)) } }, 'Pile Count')} />
              <Len label="Pile diameter" value={e.piles?.diameter ?? 14} onChange={(v) => upd({ piles: { ...(e.piles || { count: 4, length: 360 }), diameter: v } }, 'Pile Diameter')} />
              <Len label="Pile length" value={e.piles?.length ?? 360} onChange={(v) => upd({ piles: { ...(e.piles || { count: 4, diameter: 14 }), length: v } }, 'Pile Length')} />
            </>
          )}
          {e.columnId && <p className="text-[11px] text-stone-500">Placed under a column — it follows the column.</p>}
          {e.wallId && <p className="text-[11px] text-stone-500">Follows its wall when the wall moves.</p>}
          <Sel label="Material" value={e.structuralMaterialId || 'conc-4000'} options={matOptions(['concrete'])} onChange={(v) => upd({ structuralMaterialId: v }, 'Footing Material')} />
          {presetFor(e.id)}
          {hostRebarInfo}
          {more && coverEditor(e.cover, defaultCover('footing'), (c) => upd({ cover: { ...defaultCover('footing'), ...c } }, 'Footing Cover'))}
        </>
      );
      break;
    }
    case 'beam': {
      const fam = materialById(e.structuralMaterialId).family;
      const sec = beamSection(e);
      const ax = beamAxis(model, e);
      const span = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
      const ratio = span / Math.max(1, sec.d);
      const profs = profilesFor(fam, 'beam');
      body = (
        <>
          <Sel label="Material" value={e.structuralMaterialId} options={matOptions(e.usage === 'brace' ? ['steel', 'wood'] : ['steel', 'concrete', 'wood'])} onChange={(v) => {
            const f = materialById(v).family;
            upd({ structuralMaterialId: v, profileId: f === 'concrete' ? undefined : profilesFor(f, 'beam')[0]?.id }, 'Beam Material');
          }} />
          {fam === 'concrete' ? (
            <>
              <Len label="Width" value={e.width} onChange={(v) => upd({ width: v }, 'Beam Width')} />
              <Len label="Depth" value={e.depth} onChange={(v) => upd({ depth: v }, 'Beam Depth')} />
            </>
          ) : (
            <Sel label="Section" value={sec.id} options={profs.map((p) => [p.id, p.label])} onChange={(v) => upd({ profileId: v }, 'Beam Section')} />
          )}
          <Sel label="Level" value={e.levelId || 'level-1'} options={levelOptions} onChange={(v) => upd({ levelId: v }, 'Beam Level')} />
          <Sel label="Usage" value={e.usage} options={[['beam', 'Beam'], ['ridge', 'Ridge beam'], ['purlin', 'Purlin'], ['rafter', 'Rafter'], ['brace', 'Brace / knee brace'], ['joist', 'Joist']]} onChange={(v) => upd({ usage: v as BeamEntity['usage'], ...(v === 'rafter' || v === 'brace' ? { zStart: e.zStart ?? e.topOffset, zEnd: e.zEnd ?? e.topOffset } : {}) }, 'Beam Usage')} />
          {fam === 'wood' && (
            <>
              <Sel label="Tail / end cut" value={e.tailCut || 'square'} options={TAIL_CUTS.map((t) => [t.id, t.label])} onChange={(v) => upd({ tailCut: v as TailCut }, 'Tail Cut')} />
              {sec.id.startsWith('GLB') && <Len label="Camber (mid-span)" value={e.camber ?? 0} onChange={(v) => upd({ camber: v }, 'Glulam Camber')} />}
              {e.usage === 'brace' && <Sel label="Shape" value={e.curved ? 'curved' : 'straight'} options={[['straight', 'Straight'], ['curved', 'Curved (arched)']]} onChange={(v) => upd({ curved: v === 'curved' || undefined }, 'Brace Shape')} />}
            </>
          )}
          {e.usage === 'brace' || e.usage === 'rafter' ? (
            <>
              <Len label="Start height" value={e.zStart ?? 0} neg onChange={(v) => upd({ zStart: v }, 'Member Start Height')} />
              <Len label="End height" value={e.zEnd ?? 108} neg onChange={(v) => upd({ zEnd: v }, 'Member End Height')} />
            </>
          ) : (
            <>
              <Len label="Top offset" value={e.topOffset} neg onChange={(v) => upd({ topOffset: v }, 'Beam Top Offset')} />
              <Sel label="Justification" value={e.justification} options={[['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]} onChange={(v) => upd({ justification: v as BeamJustification }, 'Beam Justification')} />
            </>
          )}
          <Info label="Cut length" value={fmt(Math.hypot(ax.end.x - ax.start.x, ax.end.y - ax.start.y))} />
          {e.usage !== 'brace' && <Info label="Span / depth" value={`${ratio.toFixed(1)}${ratio > SPAN_DEPTH_LIMIT[fam] ? ` ⚠ > ${SPAN_DEPTH_LIMIT[fam]}` : ''}`} />}
          {more && (
            <>
              <Len label="Start offset" value={e.startOffset} neg onChange={(v) => upd({ startOffset: v }, 'Beam Start Offset')} />
              <Len label="End offset" value={e.endOffset} neg onChange={(v) => upd({ endOffset: v }, 'Beam End Offset')} />
              <Num label="Rotation (°)" value={e.rotation} onChange={(v) => upd({ rotation: v }, 'Beam Rotation')} />
            </>
          )}
          {fam === 'concrete' && presetFor(e.id)}
          {hostRebarInfo}
          {fam === 'concrete' && more && coverEditor(e.cover, defaultCover('beam'), (c) => upd({ cover: { ...defaultCover('beam'), ...c } }, 'Beam Cover'))}
        </>
      );
      break;
    }
    case 'truss': {
      const rise = Math.round(12 * Math.tan((e.pitch * Math.PI) / 180) * 10) / 10;
      const span = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
      body = (
        <>
          <Sel label="Style" value={e.style} options={TRUSS_STYLES.map((t) => [t.id, t.label])} onChange={(v) => upd({ style: v as TrussEntity['style'] }, 'Truss Style')} />
          <Num label="Pitch (rise / 12)" value={rise} step={0.5} onChange={(v) => upd({ pitch: (Math.atan(Math.max(1, v) / 12) * 180) / Math.PI }, 'Truss Pitch')} />
          <Sel label="Species" value={e.structuralMaterialId} options={matOptions(['wood'])} onChange={(v) => upd({ structuralMaterialId: v }, 'Truss Species')} />
          <Len label="Timber width" value={e.memberWidth} onChange={(v) => upd({ memberWidth: v }, 'Truss Timber Width')} />
          <Len label="Timber depth" value={e.memberDepth} onChange={(v) => upd({ memberDepth: v }, 'Truss Timber Depth')} />
          <Len label="Bearing height" value={e.bearingZ} neg onChange={(v) => upd({ bearingZ: v }, 'Truss Bearing Height')} />
          <Len label="Overhang" value={e.overhang} onChange={(v) => upd({ overhang: v }, 'Truss Overhang')} />
          <Sel label="Tail cut" value={e.tailCut || 'plumb'} options={TAIL_CUTS.map((t) => [t.id, t.label])} onChange={(v) => upd({ tailCut: v as TailCut }, 'Truss Tail Cut')} />
          <Info label="Span" value={fmt(span)} />
          <Info label="Rise" value={fmt((span / 2) * Math.tan((e.pitch * Math.PI) / 180))} />
        </>
      );
      break;
    }
    case 'beamsystem': {
      const fam = materialById(e.structuralMaterialId).family;
      const profs = profilesFor(fam, 'beam');
      body = (
        <>
          <Sel label="Material" value={e.structuralMaterialId} options={matOptions(['wood', 'steel'])} onChange={(v) => {
            const p = profilesFor(materialById(v).family, 'beam')[0];
            upd({ structuralMaterialId: v, profileId: p?.id, width: p?.bf ?? e.width, depth: p?.d ?? e.depth }, 'Joist Material');
          }} />
          <Sel label="Joist section" value={beamSection(e).id} options={profs.map((p) => [p.id, p.label])} onChange={(v) => {
            const p = profs.find((x) => x.id === v)!;
            upd({ profileId: v, width: p.bf, depth: p.d }, 'Joist Section');
          }} />
          <Len label="Spacing (o.c.)" value={e.spacing} onChange={(v) => upd({ spacing: v }, 'Joist Spacing')} />
          <Num label="Direction (°)" value={Math.round(e.angle)} onChange={(v) => upd({ angle: v }, 'Joist Direction')} />
          <Len label="Top offset" value={e.topOffset} neg onChange={(v) => upd({ topOffset: v }, 'Joist Top Offset')} />
          <Info label="Joists" value={String(beamSystemJoists(e).length)} />
        </>
      );
      break;
    }
    case 'rebar': {
      const bars = computeRebarBars(model, e);
      const host = model.entities.find((h) => h.id === e.hostId);
      const total = bars.reduce((s, b) => s + b.length, 0);
      const wt = (total / 12) * barSize(e.barSize).lbPerFt;
      const hostKind = rebarHostOf(model, e.hostId)?.kind;
      const placements: Array<[string, string]> =
        hostKind === 'beam' ? [['bottom', 'Bottom'], ['top', 'Top'], ['side', 'Side (skin)'], ['stirrup', 'Stirrups']] :
        hostKind === 'column' ? [['vertical', 'Vertical'], ['tie', 'Ties']] :
        hostKind === 'wall' ? [['vertical', 'Vertical'], ['x', 'Horizontal']] :
        [['x', 'Bottom, X'], ['y', 'Bottom, Y'], ['top', 'Top, X']];
      const base = rebarHostOf(model, e.hostId)?.cover || defaultCover('beam');
      body = (
        <>
          <Info label="Host" value={host ? host.type : '—'} />
          <div className={rowCls}>
            <label className={labelCls}>Mark</label>
            <input aria-label="Mark" key={e.mark || ''} defaultValue={e.mark || ''} className={inputCls} onBlur={(ev) => ev.target.value !== (e.mark || '') && upd({ mark: ev.target.value || undefined }, 'Rebar Mark')} />
          </div>
          <Sel label="Bar size" value={e.barSize} options={barOptions} onChange={(v) => upd({ barSize: v }, 'Bar Size')} />
          <Sel label="Shape" value={e.shape} options={(Object.keys(SHAPE_LABEL) as RebarShape[]).map((k) => [k, SHAPE_LABEL[k]])} onChange={(v) => upd({ shape: v as RebarShape }, 'Bar Shape')} />
          <Sel label="Placement" value={e.placement} options={placements} onChange={(v) => upd({ placement: v as RebarPlacement }, 'Bar Placement')} />
          {hostKind !== 'column' || e.placement === 'tie' ? (
            <Sel label="Layout" value={e.layout.rule} options={[['single', 'Single bar'], ['count', 'Fixed number'], ['maxSpacing', 'Maximum spacing'], ['countSpacing', 'Number + spacing']]} onChange={(v) => upd({ layout: { ...e.layout, rule: v as RebarLayoutRule } }, 'Bar Layout')} />
          ) : null}
          {(e.layout.rule === 'count' || e.layout.rule === 'countSpacing' || (hostKind === 'column' && e.placement === 'vertical')) && (
            <Num label="Number" value={e.layout.count ?? 2} min={1} onChange={(v) => upd({ layout: { ...e.layout, count: Math.max(1, v) } }, 'Bar Count')} />
          )}
          {(e.layout.rule === 'maxSpacing' || e.layout.rule === 'countSpacing') && <Len label="Spacing" value={e.layout.spacing ?? 12} onChange={(v) => upd({ layout: { ...e.layout, spacing: v } }, 'Bar Spacing')} />}
          <Info label="Bars" value={`${bars.length} × ${fmt(bars.length ? total / bars.length : 0)}`} />
          <Info label="Weight" value={units === 'metric' ? `${(wt * 0.453592).toFixed(1)} kg` : `${wt.toFixed(1)} lb`} />
          {more ? coverEditor(e.cover, base, (c) => upd({ cover: c }, 'Rebar Cover Override'), 'Cover override (this set)') : null}
        </>
      );
      break;
    }
    case 'areareinf': {
      const bars = computeAreaReinfBars(model, e);
      const total = bars.reduce((s, b) => s + b.length, 0);
      const wt = (total / 12) * barSize(e.barSize).lbPerFt;
      const host = model.entities.find((h) => h.id === e.hostId);
      const isWall = host?.type === 'wall';
      body = (
        <>
          <Info label="Host" value={host ? host.type : '—'} />
          <div className={rowCls}>
            <label className={labelCls}>Mark</label>
            <input aria-label="Mark" key={e.mark || ''} defaultValue={e.mark || ''} className={inputCls} onBlur={(ev) => ev.target.value !== (e.mark || '') && upd({ mark: ev.target.value || undefined }, 'Area Reinforcement Mark')} />
          </div>
          <Sel label="Bar size" value={e.barSize} options={barOptions} onChange={(v) => upd({ barSize: v }, 'Bar Size')} />
          <Len label="Spacing" value={e.spacing} onChange={(v) => upd({ spacing: v }, 'Bar Spacing')} />
          <Check label={isWall ? 'Exterior face, horizontal' : 'Top mat, major (X)'} checked={e.topX} onChange={(v) => upd({ topX: v }, 'Mats')} />
          <Check label={isWall ? 'Exterior face, vertical' : 'Top mat, minor (Y)'} checked={e.topY} onChange={(v) => upd({ topY: v }, 'Mats')} />
          <Check label={isWall ? 'Interior face, horizontal' : 'Bottom mat, major (X)'} checked={e.bottomX} onChange={(v) => upd({ bottomX: v }, 'Mats')} />
          <Check label={isWall ? 'Interior face, vertical' : 'Bottom mat, minor (Y)'} checked={e.bottomY} onChange={(v) => upd({ bottomY: v }, 'Mats')} />
          {host?.type === 'floor' && <Num label="Major direction (°)" value={e.angle ?? 0} onChange={(v) => upd({ angle: v }, 'Major Direction')} />}
          <Info label="Bars" value={String(bars.length)} />
          <Info label="Weight" value={units === 'metric' ? `${(wt * 0.453592).toFixed(1)} kg` : `${wt.toFixed(1)} lb`} />
          {more ? coverEditor(e.cover, rebarHostOf(model, e.hostId)?.cover || defaultCover('slab'), (c) => upd({ cover: c }, 'Cover Override'), 'Cover override (this set)') : null}
        </>
      );
      break;
    }
    case 'connection':
      body = (
        <>
          <Sel label="Type" value={e.kind} options={[['shear-plate', 'Shear plate'], ['end-plate', 'End plate'], ['clip-angle', 'Clip angle'], ['base-plate', 'Base plate']]} onChange={(v) => upd({ kind: v as SteelConnectionKind }, 'Connection Type')} />
          {e.kind !== 'base-plate' && <Num label="Bolts" value={e.bolts ?? 3} min={2} onChange={(v) => upd({ bolts: Math.max(2, v) }, 'Connection Bolts')} />}
          <p className="text-[11px] text-stone-500">Simplified plates and bolts for coordination (not a connection design).</p>
        </>
      );
      break;
    case 'sjoint':
      body = (
        <>
          <Sel label="Type" value={e.kind} options={[['control', 'Control joint'], ['construction', 'Construction joint'], ['expansion', 'Expansion joint']]} onChange={(v) => upd({ kind: v as StructuralJointKind, gap: v === 'expansion' ? e.gap || 1 : 0 }, 'Joint Type')} />
          {e.kind === 'expansion' && <Len label="Gap width" value={e.gap} onChange={(v) => upd({ gap: v }, 'Joint Gap')} />}
        </>
      );
      break;
    case 'load':
      body = (
        <>
          <Info label="Type" value={`${e.kind} load`} />
          <Num label={`Value (${e.unit})`} value={e.value} step={0.5} onChange={(v) => upd({ value: v }, 'Load Value')} />
          <Sel label="Unit" value={e.unit} options={(e.kind === 'point' ? ['kip', 'kN', 'lb'] : e.kind === 'line' ? ['kip/ft', 'kN/m', 'plf'] : ['psf', 'kPa', 'ksf']).map((u) => [u, u])} onChange={(v) => upd({ unit: v }, 'Load Unit')} />
        </>
      );
      break;
    case 'section':
      body = (
        <>
          <div className={rowCls}>
            <label className={labelCls}>Name</label>
            <input aria-label="Section name" key={e.name} defaultValue={e.name} className={inputCls} onBlur={(ev) => ev.target.value && ev.target.value !== e.name && upd({ name: ev.target.value }, 'Rename Section')} />
          </div>
          <Len label="View depth" value={e.depth} onChange={(v) => upd({ depth: v }, 'Section Depth')} />
          <button type="button" className={btn} onClick={() => onAction('openSection', e.id)}>
            Open section view
          </button>
        </>
      );
      break;
    case 'wall': {
      const matId = wallStructuralMaterialId(e);
      const lintels = computeLintels(model.entities, e);
      body = (
        <>
          <Check label="Structural (load-bearing)" checked={!!e.structural} onChange={(v) => upd({ structural: v }, v ? 'Make Wall Structural' : 'Make Wall Non-Structural')} />
          {e.structural && <Sel label="Structural material" value={matId} options={matOptions(['concrete', 'masonry', 'wood'])} onChange={(v) => upd({ structuralMaterialId: v }, 'Wall Structural Material')} />}
          {lintels.length > 0 && <div className="text-[10px] text-stone-500 uppercase tracking-wide pt-1">Lintels / headers (auto)</div>}
          {lintels.map((l) => (
            <Info key={l.openingId} label={(() => { const t = model.entities.find((o) => o.id === l.openingId)?.type; return t === 'door' ? 'Door' : t === 'wallopening' ? 'Opening' : 'Window'; })()} value={l.label} />
          ))}
          {e.structural && !model.entities.some((f) => f.type === 'footing' && f.wallId === e.id) && (
            <button type="button" className={btn2} onClick={() => onAction('wallFooting', e.id)}>
              Add wall footing
            </button>
          )}
          {rebarHostOf(model, e.id) && presetFor(e.id)}
          {hostRebarInfo}
        </>
      );
      break;
    }
    case 'floor': {
      body = (
        <>
          <Check label="Structural slab" checked={!!e.structural} onChange={(v) => upd({ structural: v }, 'Structural Slab')} />
          <Check label="Foundation / slab on grade" checked={!!e.foundation} onChange={(v) => upd({ foundation: v, structural: v || e.structural }, 'Slab on Grade')} />
          {(e.structural || e.foundation) && (
            <>
              <Sel label="Material" value={e.structuralMaterialId || 'conc-4000'} options={matOptions(['concrete', 'wood'])} onChange={(v) => upd({ structuralMaterialId: v }, 'Slab Material')} />
              <Num label="Span direction (°)" value={e.spanAngle ?? 0} onChange={(v) => upd({ spanAngle: v }, 'Span Direction')} />
            </>
          )}
          {e.foundation && (
            <>
              <Check label="Thickened edge" checked={!!e.thickenedEdge} onChange={(v) => upd({ thickenedEdge: v ? { width: 12, depth: 8 } : null }, 'Thickened Edge')} />
              {e.thickenedEdge && (
                <>
                  <Len label="Edge width" value={e.thickenedEdge.width} onChange={(v) => upd({ thickenedEdge: { ...e.thickenedEdge!, width: v } }, 'Thickened Edge')} />
                  <Len label="Edge depth" value={e.thickenedEdge.depth} onChange={(v) => upd({ thickenedEdge: { ...e.thickenedEdge!, depth: v } }, 'Thickened Edge')} />
                </>
              )}
              <Check label="Vapor barrier" checked={!!e.vaporBarrier} onChange={(v) => upd({ vaporBarrier: v }, 'Vapor Barrier')} />
            </>
          )}
          <Info label="Openings" value={`${(e.openings || []).length} (shafts, stairs)`} />
          {rebarHostOf(model, e.id) && presetFor(e.id)}
          {hostRebarInfo}
          {more && rebarHostOf(model, e.id) && coverEditor(e.cover, defaultCover(e.foundation ? 'slab-on-grade' : 'slab'), (c) => upd({ cover: { ...defaultCover(e.foundation ? 'slab-on-grade' : 'slab'), ...c } }, 'Slab Cover'))}
        </>
      );
      break;
    }
    case 'door':
    case 'window':
    case 'wallopening': {
      const host = model.entities.find((w) => w.type === 'wall' && w.id === e.wallId);
      if (!host || host.type !== 'wall') break;
      const op = e as DoorEntity | WindowEntity;
      const sug = suggestLintel(op.width, materialById(wallStructuralMaterialId(host)).family);
      body = (
        <>
          <Check label="Lintel / header" checked={!op.lintel?.none} onChange={(v) => upd({ lintel: { ...(op.lintel || {}), none: !v } }, 'Lintel')} />
          {!op.lintel?.none && (
            <>
              <div className={rowCls}>
                <label className={labelCls}>Size</label>
                <input aria-label="Lintel size" key={op.lintel?.label ?? sug.label} defaultValue={op.lintel?.label ?? sug.label} className={inputCls} onBlur={(ev) => ev.target.value !== (op.lintel?.label ?? sug.label) && upd({ lintel: { ...(op.lintel || {}), label: ev.target.value } }, 'Lintel Size')} />
              </div>
              <Len label="Depth" value={op.lintel?.depth ?? sug.depth} onChange={(v) => upd({ lintel: { ...(op.lintel || {}), depth: v } }, 'Lintel Depth')} />
              <Len label="Bearing (each side)" value={op.lintel?.bearing ?? sug.bearing} onChange={(v) => upd({ lintel: { ...(op.lintel || {}), bearing: v } }, 'Lintel Bearing')} />
              <p className="text-[11px] text-stone-500">Suggested for a {fmt(op.width)} opening: {sug.label}.</p>
              {op.lintel && (op.lintel.label || op.lintel.depth || op.lintel.bearing) && (
                <button type="button" className={btn2} onClick={() => upd({ lintel: undefined }, 'Reset Lintel')}>
                  Reset to suggested
                </button>
              )}
            </>
          )}
        </>
      );
      break;
    }
    default:
      return null;
  }
  if (!body) return null;
  const title =
    e.type === 'wall' ? 'Structure' : e.type === 'floor' ? 'Structure (slab)' : e.type === 'door' || e.type === 'window' || e.type === 'wallopening' ? 'Lintel / Header' : `Structural ${e.type === 'areareinf' ? 'area reinforcement' : e.type === 'sjoint' ? 'joint' : e.type === 'beamsystem' ? 'beam system' : e.type === 'beam' && e.usage === 'brace' ? 'brace' : e.type}`;
  const hasMore = ['column', 'footing', 'beam', 'rebar', 'areareinf', 'floor'].includes(e.type);
  return (
    <div className={box} aria-label="Structural properties">
      <div className="flex items-center justify-between">
        <div className={heading}>{title}</div>
        {hasMore && (
          <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] text-amber-600 hover:underline cursor-pointer">
            {more ? 'Less' : 'More…'}
          </button>
        )}
      </div>
      {body}
      {e.type !== 'door' && e.type !== 'window' && e.type !== 'wallopening' && e.type !== 'wall' && e.type !== 'floor' && disclaimer}
    </div>
  );
};
