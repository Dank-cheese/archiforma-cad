import React, { useState } from 'react';
import type { BeamJustification, LoadKind, RebarLayoutRule, RebarPlacement, RebarShape, SteelConnectionKind, StructuralJointKind, ToolId, UnitSystem } from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import { BAR_SIZES, LOAD_UNITS, materialById, profilesFor, STRUCTURAL_MATERIALS, SHAPE_LABEL } from '../engine/structure';
import { isStructureTool, type StructToolState } from '../engine/structureTools';
import { TAIL_CUTS, TRUSS_STYLES } from '../engine/timber';
import type { TailCut, TrussStyle } from '../types/model';

const TITLES: Partial<Record<ToolId, string>> = {
  footing: 'FOOTING (FT)',
  wallfooting: 'WALL FOOTING (WF)',
  foundationslab: 'FOUNDATION SLAB (FS)',
  pilecap: 'PILE CAP (PC)',
  beam: 'BEAM (BM)',
  beamsystem: 'BEAM SYSTEM (BS)',
  brace: 'BRACE (BR)',
  rebar: 'REBAR (RB)',
  areareinf: 'AREA REINFORCEMENT (AR)',
  connection: 'CONNECTION (CN)',
  sjoint: 'JOINT (CJ)',
  load: 'LOAD (LD)',
  section: 'SECTION (SEC)',
  truss: 'TIMBER TRUSS (TR)',
  kneebrace: 'KNEE BRACE (KB)',
  roofframing: 'TIMBER ROOF FRAMING (TRF)',
};

const HINTS: Partial<Record<ToolId, string>> = {
  footing: 'Click a column (or select columns / a grid, then FT)',
  wallfooting: 'Click walls',
  foundationslab: 'Click inside walls, or sketch · Enter to close',
  pilecap: 'Click a column',
  beam: 'Click start, end · snaps to columns & wall tops · Esc to stop',
  beamsystem: 'Click inside a bay bounded by beams / walls',
  brace: 'Click start and end',
  rebar: 'Click a concrete host',
  areareinf: 'Click a slab, wall or footing',
  connection: 'Click near a beam end (or select two members, then CN)',
  sjoint: 'Two clicks across a slab',
  load: 'Click to place',
  section: 'Two clicks: the cut line (looks to the left)',
  truss: 'Click inside a room (short span) · or two bearing clicks',
  kneebrace: 'Click a post where beams frame in',
  roofframing: 'Click a roof',
};

/** Options bar for the structural tools (common options; advanced ones under More…). */
export const StructureOptionsBar: React.FC<{
  activeTool: ToolId;
  st: StructToolState;
  onChange: (next: StructToolState) => void;
  units: UnitSystem;
  darkMode: boolean;
}> = ({ activeTool, st, onChange, units, darkMode }) => {
  const [more, setMore] = useState(false);
  if (!isStructureTool(activeTool)) return null;
  const box = `absolute top-2 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border shadow-lg text-xs max-w-[96%] ${
    darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800'
  }`;
  const input = `px-1.5 py-0.5 rounded border font-mono text-xs w-20 ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const sel = `${input} w-auto font-sans`;
  const Len: React.FC<{ label: string; value: number; onSet: (v: number) => void; allowNeg?: boolean }> = ({ label, value, onSet, allowNeg }) => (
    <label className="flex items-center gap-1">
      <span className="text-stone-500">{label}</span>
      <input
        aria-label={label}
        className={input}
        defaultValue={formatLength(value, units)}
        key={`${label}-${value}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const neg = raw.startsWith('-');
          const v = parseLengthInput(neg ? raw.slice(1) : raw, units);
          if (v !== null && (v > 0 || (allowNeg && v >= 0))) onSet(neg && allowNeg ? -v : v);
          else e.target.value = formatLength(value, units);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
  const Num: React.FC<{ label: string; value: number; onSet: (v: number) => void; step?: number }> = ({ label, value, onSet, step }) => (
    <label className="flex items-center gap-1">
      <span className="text-stone-500">{label}</span>
      <input aria-label={label} type="number" step={step ?? 1} className={`${input} w-16`} value={value} onChange={(e) => onSet(Number(e.target.value) || 0)} />
    </label>
  );
  const set = <K extends keyof StructToolState>(k: K, patch: Partial<StructToolState[K]>) => onChange({ ...st, [k]: { ...(st[k] as object), ...patch } });
  const bars = BAR_SIZES.filter((b) => b.system === (units === 'metric' ? 'metric' : 'us'));
  const barPick = (value: string, onSet: (v: string) => void) => (
    <select aria-label="Bar size" value={bars.some((b) => b.id === value) ? value : bars[2].id} onChange={(e) => onSet(e.target.value)} className={sel}>
      {bars.map((b) => (
        <option key={b.id} value={b.id}>
          {b.id}
        </option>
      ))}
    </select>
  );
  const matPick = (value: string, onSet: (v: string) => void, families: string[]) => (
    <select aria-label="Material" value={value} onChange={(e) => onSet(e.target.value)} className={sel}>
      {STRUCTURAL_MATERIALS.filter((m) => families.includes(m.family)).map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
  const profilePick = (matId: string, value: string, onSet: (v: string) => void) => {
    const fam = materialById(matId).family;
    const list = profilesFor(fam, 'beam');
    if (!list.length) return null;
    return (
      <select aria-label="Section" value={list.some((p) => p.id === value) ? value : list[0].id} onChange={(e) => onSet(e.target.value)} className={sel}>
        {Array.from(new Set(list.map((p) => p.group || (fam === 'steel' ? 'Steel' : 'Dimensional lumber')))).map((g) => (
          <optgroup key={g} label={g}>
            {list
              .filter((p) => (p.group || (fam === 'steel' ? 'Steel' : 'Dimensional lumber')) === g)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    );
  };
  const hasMore = ['footing', 'pilecap', 'wallfooting', 'foundationslab', 'beam', 'brace', 'rebar', 'beamsystem', 'truss', 'roofframing'].includes(activeTool);
  const pitchToRise = (deg: number) => Math.round(12 * Math.tan((deg * Math.PI) / 180) * 10) / 10;
  const tailPick = (value: TailCut, onSet: (v: TailCut) => void) => (
    <select aria-label="Tail cut" value={value} onChange={(e) => onSet(e.target.value as TailCut)} className={sel}>
      {TAIL_CUTS.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className={box} role="toolbar" aria-label="Structure tool options">
      <span className="font-bold text-blue-700 dark:text-blue-400">{TITLES[activeTool]}</span>
      {(activeTool === 'footing' || activeTool === 'pilecap') && (
        <>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.footing.auto} onChange={(e) => set('footing', { auto: e.target.checked })} />
            <span>Auto-size from column</span>
          </label>
          {!st.footing.auto && (
            <>
              <Len label="Length" value={st.footing.length} onSet={(v) => set('footing', { length: v })} />
              <Len label="Width" value={st.footing.width} onSet={(v) => set('footing', { width: v })} />
            </>
          )}
          {activeTool === 'pilecap' && <Num label="Piles" value={st.pile.count} onSet={(v) => set('pile', { count: Math.max(1, Math.min(9, v)) })} />}
          {more && (
            <>
              <Len label="Thickness" value={st.footing.thickness} onSet={(v) => set('footing', { thickness: v })} />
              <Len label="Top elev." value={st.footing.topOffset} allowNeg onSet={(v) => set('footing', { topOffset: v })} />
              {activeTool === 'pilecap' && (
                <>
                  <Len label="Pile Ø" value={st.pile.diameter} onSet={(v) => set('pile', { diameter: v })} />
                  <Len label="Pile length" value={st.pile.length} onSet={(v) => set('pile', { length: v })} />
                </>
              )}
            </>
          )}
        </>
      )}
      {activeTool === 'wallfooting' && (
        <>
          <Len label="Width" value={st.wallFooting.width} onSet={(v) => set('wallFooting', { width: v })} />
          <Len label="Thickness" value={st.wallFooting.thickness} onSet={(v) => set('wallFooting', { thickness: v })} />
          {more && <Len label="Offset" value={st.wallFooting.offset} allowNeg onSet={(v) => set('wallFooting', { offset: v })} />}
        </>
      )}
      {activeTool === 'foundationslab' && (
        <>
          <Len label="Thickness" value={st.slab.thickness} onSet={(v) => set('slab', { thickness: v })} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.slab.thickenedEdge} onChange={(e) => set('slab', { thickenedEdge: e.target.checked })} />
            <span>Thickened edge</span>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.slab.vaporBarrier} onChange={(e) => set('slab', { vaporBarrier: e.target.checked })} />
            <span>Vapor barrier</span>
          </label>
          {more && st.slab.thickenedEdge && (
            <>
              <Len label="Edge width" value={st.slab.edgeWidth} onSet={(v) => set('slab', { edgeWidth: v })} />
              <Len label="Edge depth" value={st.slab.edgeDepth} onSet={(v) => set('slab', { edgeDepth: v })} />
            </>
          )}
        </>
      )}
      {activeTool === 'beam' && (
        <>
          {matPick(st.beam.materialId, (v) => set('beam', { materialId: v, profileId: profilesFor(materialById(v).family, 'beam')[0]?.id ?? st.beam.profileId }), ['steel', 'concrete', 'wood'])}
          {materialById(st.beam.materialId).family === 'concrete' ? (
            <>
              <Len label="W" value={st.beam.width} onSet={(v) => set('beam', { width: v })} />
              <Len label="D" value={st.beam.depth} onSet={(v) => set('beam', { depth: v })} />
            </>
          ) : (
            profilePick(st.beam.materialId, st.beam.profileId, (v) => set('beam', { profileId: v }))
          )}
          {more && (
            <>
              <Len label="Top offset" value={st.beam.topOffset} allowNeg onSet={(v) => set('beam', { topOffset: v })} />
              <select aria-label="Justification" value={st.beam.justification} onChange={(e) => set('beam', { justification: e.target.value as BeamJustification })} className={sel}>
                <option value="top">Top</option>
                <option value="center">Center</option>
                <option value="bottom">Bottom</option>
              </select>
            </>
          )}
        </>
      )}
      {activeTool === 'truss' && (
        <>
          <select aria-label="Truss style" value={st.truss.style} onChange={(e) => set('truss', { style: e.target.value as TrussStyle })} className={sel}>
            {TRUSS_STYLES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <span className="text-stone-500">Pitch</span>
            <input aria-label="Pitch rise per 12" type="number" step={0.5} className={`${input} w-14`} value={pitchToRise(st.truss.pitch)} onChange={(e) => set('truss', { pitch: (Math.atan((Number(e.target.value) || 0) / 12) * 180) / Math.PI })} />
            <span className="text-stone-500">:12</span>
          </label>
          <Len label="Timber W" value={st.truss.memberWidth} onSet={(v) => set('truss', { memberWidth: v })} />
          <Len label="D" value={st.truss.memberDepth} onSet={(v) => set('truss', { memberDepth: v })} />
          <Num label="Count" value={st.truss.count} onSet={(v) => set('truss', { count: Math.max(1, Math.min(30, v)) })} />
          {st.truss.count > 1 && <Len label="@" value={st.truss.spacing} onSet={(v) => set('truss', { spacing: v })} />}
          {more && (
            <>
              {matPick(st.truss.materialId, (v) => set('truss', { materialId: v }), ['wood'])}
              <Len label="Overhang" value={st.truss.overhang} onSet={(v) => set('truss', { overhang: v })} />
              {tailPick(st.truss.tailCut, (v) => set('truss', { tailCut: v }))}
            </>
          )}
        </>
      )}
      {activeTool === 'kneebrace' && (
        <>
          {matPick(st.knee.materialId, (v) => set('knee', { materialId: v }), ['wood'])}
          {profilePick(st.knee.materialId, st.knee.profileId, (v) => set('knee', { profileId: v }))}
          <Len label="Leg" value={st.knee.leg} onSet={(v) => set('knee', { leg: v })} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.knee.curved} onChange={(e) => set('knee', { curved: e.target.checked })} />
            <span>Curved</span>
          </label>
        </>
      )}
      {activeTool === 'roofframing' && (
        <>
          {matPick(st.roofFraming.materialId, (v) => set('roofFraming', { materialId: v }), ['wood'])}
          <label className="flex items-center gap-1"><input type="checkbox" checked={st.roofFraming.ridge !== false} onChange={(e) => set('roofFraming', { ridge: e.target.checked })} /><span>Ridge</span></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={st.roofFraming.purlins !== false} onChange={(e) => set('roofFraming', { purlins: e.target.checked })} /><span>Purlins</span></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={st.roofFraming.rafters !== false} onChange={(e) => set('roofFraming', { rafters: e.target.checked })} /><span>Rafters</span></label>
          {tailPick(st.roofFraming.tail, (v) => set('roofFraming', { tail: v }))}
          {more && (
            <>
              <span className="text-stone-500">Ridge</span>
              {profilePick(st.roofFraming.materialId, st.roofFraming.ridgeProfileId, (v) => set('roofFraming', { ridgeProfileId: v }))}
              <span className="text-stone-500">Purlin</span>
              {profilePick(st.roofFraming.materialId, st.roofFraming.purlinProfileId, (v) => set('roofFraming', { purlinProfileId: v }))}
              <Len label="@" value={st.roofFraming.purlinSpacing} onSet={(v) => set('roofFraming', { purlinSpacing: v })} />
              <span className="text-stone-500">Rafter</span>
              {profilePick(st.roofFraming.materialId, st.roofFraming.rafterProfileId, (v) => set('roofFraming', { rafterProfileId: v }))}
              <Len label="@" value={st.roofFraming.rafterSpacing} onSet={(v) => set('roofFraming', { rafterSpacing: v })} />
              <Len label="Tail" value={st.roofFraming.tailLength} onSet={(v) => set('roofFraming', { tailLength: v })} />
            </>
          )}
        </>
      )}
      {activeTool === 'brace' && (
        <>
          {matPick(st.brace.materialId, (v) => set('brace', { materialId: v, profileId: profilesFor(materialById(v).family, 'beam')[0]?.id ?? st.brace.profileId }), ['steel', 'wood'])}
          {profilePick(st.brace.materialId, st.brace.profileId, (v) => set('brace', { profileId: v }))}
          <Len label="Start ht." value={st.brace.zStart} allowNeg onSet={(v) => set('brace', { zStart: v })} />
          <Len label="End ht." value={st.brace.zEnd} allowNeg onSet={(v) => set('brace', { zEnd: v })} />
        </>
      )}
      {activeTool === 'beamsystem' && (
        <>
          {matPick(st.beamSystem.materialId, (v) => set('beamSystem', { materialId: v, profileId: profilesFor(materialById(v).family, 'beam')[0]?.id ?? st.beamSystem.profileId }), ['wood', 'steel'])}
          {profilePick(st.beamSystem.materialId, st.beamSystem.profileId, (v) => set('beamSystem', { profileId: v }))}
          <Len label="Spacing" value={st.beamSystem.spacing} onSet={(v) => set('beamSystem', { spacing: v })} />
          {more && (
            <label className="flex items-center gap-1">
              <span className="text-stone-500">Direction</span>
              <select aria-label="Joist direction" value={String(st.beamSystem.angle)} onChange={(e) => set('beamSystem', { angle: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })} className={sel}>
                <option value="auto">Auto (short span)</option>
                <option value="0">Horizontal</option>
                <option value="90">Vertical</option>
              </select>
            </label>
          )}
        </>
      )}
      {activeTool === 'rebar' && (
        <>
          {barPick(st.rebar.barSize, (v) => set('rebar', { barSize: v }))}
          <select aria-label="Placement" value={st.rebar.placement} onChange={(e) => set('rebar', { placement: e.target.value as RebarPlacement })} className={sel}>
            <option value="bottom">Bottom / X</option>
            <option value="top">Top</option>
            <option value="y">Y direction</option>
            <option value="vertical">Vertical</option>
            <option value="stirrup">Stirrups / ties</option>
            <option value="side">Side (skin)</option>
          </select>
          <select aria-label="Layout" value={st.rebar.rule} onChange={(e) => set('rebar', { rule: e.target.value as RebarLayoutRule })} className={sel}>
            <option value="single">Single bar</option>
            <option value="count">Fixed number</option>
            <option value="maxSpacing">Maximum spacing</option>
            <option value="countSpacing">Number + spacing</option>
          </select>
          {(st.rebar.rule === 'count' || st.rebar.rule === 'countSpacing') && <Num label="No." value={st.rebar.count} onSet={(v) => set('rebar', { count: Math.max(1, v) })} />}
          {(st.rebar.rule === 'maxSpacing' || st.rebar.rule === 'countSpacing') && <Len label="@" value={st.rebar.spacing} onSet={(v) => set('rebar', { spacing: v })} />}
          {more && (
            <select aria-label="Bar shape" value={st.rebar.shape} onChange={(e) => set('rebar', { shape: e.target.value as RebarShape })} className={sel}>
              {(Object.keys(SHAPE_LABEL) as RebarShape[]).map((k) => (
                <option key={k} value={k}>
                  {SHAPE_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {activeTool === 'areareinf' && (
        <>
          {barPick(st.area.barSize, (v) => set('area', { barSize: v }))}
          <Len label="@" value={st.area.spacing} onSet={(v) => set('area', { spacing: v })} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.area.top} onChange={(e) => set('area', { top: e.target.checked })} />
            <span>Top mat (EW)</span>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={st.area.bottom} onChange={(e) => set('area', { bottom: e.target.checked })} />
            <span>Bottom mat (EW)</span>
          </label>
        </>
      )}
      {activeTool === 'connection' && (
        <select aria-label="Connection type" value={st.connection} onChange={(e) => onChange({ ...st, connection: e.target.value as SteelConnectionKind })} className={sel}>
          <option value="shear-plate">Shear plate</option>
          <option value="end-plate">End plate</option>
          <option value="clip-angle">Clip angle</option>
          <option value="base-plate">Base plate</option>
        </select>
      )}
      {activeTool === 'sjoint' && (
        <>
          <select aria-label="Joint type" value={st.joint.kind} onChange={(e) => set('joint', { kind: e.target.value as StructuralJointKind })} className={sel}>
            <option value="control">Control joint</option>
            <option value="construction">Construction joint</option>
            <option value="expansion">Expansion joint</option>
          </select>
          {st.joint.kind === 'expansion' && <Len label="Gap" value={st.joint.gap} onSet={(v) => set('joint', { gap: v })} />}
        </>
      )}
      {activeTool === 'load' && (
        <>
          <select aria-label="Load type" value={st.load.kind} onChange={(e) => set('load', { kind: e.target.value as LoadKind })} className={sel}>
            <option value="point">Point</option>
            <option value="line">Line</option>
            <option value="area">Area</option>
          </select>
          <Num label="Value" value={st.load.value} step={0.5} onSet={(v) => set('load', { value: v })} />
          <span className="text-stone-500">{LOAD_UNITS[units][st.load.kind]}</span>
        </>
      )}
      <span className="text-stone-500">{HINTS[activeTool]}</span>
      {hasMore && (
        <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] text-amber-600 hover:underline cursor-pointer">
          {more ? 'Less' : 'More…'}
        </button>
      )}
    </div>
  );
};
