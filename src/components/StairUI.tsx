import React, { useState } from 'react';
import { Check, CornerUpLeft, CornerUpRight, Layers, Plus, RotateCcw, Scissors, ShieldCheck, X } from 'lucide-react';
import type {
  LevelDefinition,
  StairConstructionStyle,
  StairEntity,
  StairLandingStructure,
  StairRailingSide,
  StairRailingStyle,
  StairTemplateShape,
  UnitSystem,
} from '../types/model';
import {
  calculateStairRisers,
  computeStairHeadroomAndOpening,
  createStairFromTemplate,
  ensureStairRunsAndLandings,
  insertLandingAtRiser,
  rebalanceStairLandingSplit,
  resizeStairLanding,
  STAIR_CONSTRUCTION_STYLES,
  STAIR_LANDING_STRUCTURES,
  STAIR_RAILING_STYLES,
  STAIR_TEMPLATES,
  type StairToolState,
} from '../engine/stairs';
import { formatLength, parseLengthInput } from '../engine/geometry';

// ============================================================================
// 1. FLOATING CONTEXTUAL STAIR OPTIONS BAR (When activeTool === 'stair')
// ============================================================================

export interface StairOptionsBarProps {
  toolState: StairToolState;
  onChangeToolState: (patch: Partial<StairToolState>) => void;
  levels: LevelDefinition[];
  units: UnitSystem;
  risersCreatedSoFar: number;
  onPlaceTemplateNow: (template: StairTemplateShape) => void;
  onFinishInteractive: () => void;
  onCancelInteractive: () => void;
}

export const StairOptionsBar: React.FC<StairOptionsBarProps> = ({
  toolState,
  onChangeToolState,
  levels,
  units,
  risersCreatedSoFar,
  onPlaceTemplateNow,
  onFinishInteractive,
  onCancelInteractive,
}) => {
  const baseLvl = levels.find((l) => l.id === toolState.baseLevelId) ?? levels[0];
  const topLvl =
    levels.find((l) => l.id === toolState.topLevelId) ??
    levels[1] ??
    { id: 'level-2', name: 'Level 2', elevation: (baseLvl?.elevation ?? 0) + 120 };

  const totalRise = Math.max(14, Math.abs((topLvl?.elevation ?? 120) - (baseLvl?.elevation ?? 0)));
  const calc = calculateStairRisers(
    totalRise,
    toolState.maxRiserHeight,
    toolState.treadDepth,
    toolState.mode === 'template' && toolState.template === 'u-3run' ? 3 : 2
  );
  const remaining = Math.max(0, calc.numRisers - risersCreatedSoFar);

  return (
    <div
      data-testid="stair-options-bar"
      className="flex flex-wrap items-center gap-2 border-b border-stone-300 bg-amber-50/95 px-3 py-1.5 text-[11px] text-stone-800 shadow-sm dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-200"
    >
      <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
        <Layers size={13} />
        <span>STAIR BY COMPONENT</span>
      </div>

      {/* Creation Workflow Toggle */}
      <div className="flex items-center rounded border border-stone-300 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-800">
        <button
          type="button"
          onClick={() => onChangeToolState({ mode: 'interactive' })}
          className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
            toolState.mode === 'interactive'
              ? 'bg-amber-600 text-white'
              : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-700'
          }`}
          title="Draw Run 1 (Click 1 -> Click 2), then draw Run 2 in any direction to auto-generate a connected landing"
        >
          Interactive Multi-Run (Auto-Landing)
        </button>
        <button
          type="button"
          onClick={() => onChangeToolState({ mode: 'template' })}
          className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
            toolState.mode === 'template'
              ? 'bg-amber-600 text-white'
              : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-700'
          }`}
          title="Place a complete stair & landing template with one click"
        >
          One-Click Templates
        </button>
      </div>

      {/* One-Click Template Buttons */}
      <div className="flex flex-wrap items-center gap-1">
        {STAIR_TEMPLATES.map((tpl) => {
          const active = toolState.template === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                onChangeToolState({ mode: 'template', template: tpl.id });
              }}
              onDoubleClick={() => onPlaceTemplateNow(tpl.id)}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
                active && toolState.mode === 'template'
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-stone-300 bg-white text-stone-700 hover:border-amber-500 hover:bg-amber-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
              }`}
              title={`${tpl.label}: ${tpl.description} (Click to select, or click 'Place Stair' to insert immediately)`}
            >
              {tpl.shortLabel}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPlaceTemplateNow(toolState.template)}
          className="ml-1 flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm hover:bg-emerald-700"
          title="Insert selected stair template into the current floor plan immediately"
        >
          <Plus size={11} />
          <span>Place Stair</span>
        </button>
      </div>

      <span className="h-4 w-px bg-stone-300 dark:bg-stone-700" />

      {/* Base & Top Level Selectors */}
      <label className="flex items-center gap-1">
        <span className="text-[10px] text-stone-500">Base:</span>
        <select
          aria-label="Stair Base Level"
          value={toolState.baseLevelId}
          onChange={(e) => onChangeToolState({ baseLevelId: e.target.value })}
          className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] dark:border-stone-700 dark:bg-stone-800"
        >
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({formatLength(l.elevation, units)})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-stone-500">Top:</span>
        <select
          aria-label="Stair Top Level"
          value={toolState.topLevelId}
          onChange={(e) => onChangeToolState({ topLevelId: e.target.value })}
          className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] dark:border-stone-700 dark:bg-stone-800"
        >
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({formatLength(l.elevation, units)})
            </option>
          ))}
        </select>
      </label>

      {/* Run Width & Tread Depth */}
      <label className="flex items-center gap-1">
        <span className="text-[10px] text-stone-500">Width:</span>
        <input
          type="number"
          aria-label="Stair Run Width"
          min={24}
          max={120}
          step={2}
          value={toolState.width}
          onChange={(e) => {
            const w = Math.max(24, Number(e.target.value) || 42);
            onChangeToolState({ width: w, landingDepth: Math.max(w, toolState.landingDepth) });
          }}
          className="w-12 rounded border border-stone-300 bg-white px-1 py-0.5 text-[10px] dark:border-stone-700 dark:bg-stone-800"
        />
        <span className="text-[10px] text-stone-500">&quot;</span>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-stone-500">Tread:</span>
        <input
          type="number"
          aria-label="Stair Tread Depth"
          min={9}
          max={18}
          step={0.5}
          value={toolState.treadDepth}
          onChange={(e) => onChangeToolState({ treadDepth: Math.max(9, Number(e.target.value) || 10) })}
          className="w-12 rounded border border-stone-300 bg-white px-1 py-0.5 text-[10px] dark:border-stone-700 dark:bg-stone-800"
        />
        <span className="text-[10px] text-stone-500">&quot;</span>
      </label>

      {/* Construction Style & Railing Style */}
      <label className="flex items-center gap-1">
        <span className="text-[10px] text-stone-500">Style:</span>
        <select
          aria-label="Stair Construction Style"
          value={toolState.constructionStyle}
          onChange={(e) => {
            const cs = e.target.value as StairConstructionStyle;
            onChangeToolState({
              constructionStyle: cs,
              railingStyle: cs === 'cabin-split-log' ? 'cabin-peeled-log' : toolState.railingStyle,
              landingStructure: cs === 'cabin-split-log' ? 'timber-framed' : toolState.landingStructure,
            });
          }}
          className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] dark:border-stone-700 dark:bg-stone-800"
        >
          {STAIR_CONSTRUCTION_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {/* Cut Floor Above Checkbox */}
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="checkbox"
          checked={toolState.cutFloorAbove}
          onChange={(e) => onChangeToolState({ cutFloorAbove: e.target.checked })}
          className="rounded border-stone-300 text-amber-600"
        />
        <span className="text-[10px] font-medium">Cut Floor Above</span>
      </label>

      {/* Live Riser Status Badge */}
      <div
        data-testid="stair-riser-status"
        className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
      >
        {toolState.mode === 'interactive' && risersCreatedSoFar > 0
          ? `${risersCreatedSoFar} risers created, ${remaining} remaining (${calc.numRisers} total @ ${calc.riserHeight.toFixed(2)}")`
          : `${calc.numRisers} risers @ ${calc.riserHeight.toFixed(2)}" · Rise ${formatLength(totalRise, units)}`}
      </div>

      {/* Finish / Cancel Multi-Run buttons */}
      {toolState.draftRuns.length > 0 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFinishInteractive}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
          >
            <Check size={11} />
            <span>Finish Stair</span>
          </button>
          <button
            type="button"
            onClick={onCancelInteractive}
            className="flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700"
          >
            <X size={11} />
            <span>Cancel</span>
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. STAIR & LANDING PROPERTIES PANEL (In RightPanel when a stair is selected)
// ============================================================================

export interface StairPropertiesPanelProps {
  stair: StairEntity;
  levels: LevelDefinition[];
  units: UnitSystem;
  onUpdateStair: (updated: StairEntity) => void;
}

export const StairPropertiesPanel: React.FC<StairPropertiesPanelProps> = ({
  stair,
  levels,
  units,
  onUpdateStair,
}) => {
  const { runs, landings, totalRise, baseElevation, topElevation } = ensureStairRunsAndLandings(stair, levels);
  const firstLanding = landings[0];
  const headroom = computeStairHeadroomAndOpening(stair, levels);
  const riserHeight = stair.riserHeight || totalRise / Math.max(2, stair.numRisers || 16);

  const [exactElevText, setExactElevText] = useState<string>('');
  const [splitTurnShape, setSplitTurnShape] = useState<'straight-landing' | 'l-left' | 'l-right' | 'u-switchback'>('straight-landing');

  const handleChangeTemplate = (newShape: StairTemplateShape) => {
    const dir =
      runs[0] && (runs[0].end.x !== runs[0].start.x || runs[0].end.y !== runs[0].start.y)
        ? {
            x: runs[0].end.x - runs[0].start.x,
            y: runs[0].end.y - runs[0].start.y,
          }
        : { x: 1, y: 0 };

    const rebuilt = createStairFromTemplate({
      id: stair.id,
      origin: runs[0]?.start ?? stair.start,
      direction: dir,
      baseLevelId: stair.baseLevelId,
      topLevelId: stair.topLevelId,
      baseElevation,
      topElevation,
      baseOffset: stair.baseOffset,
      topOffset: stair.topOffset,
      width: stair.width,
      treadDepth: stair.treadDepth,
      maxRiserHeight: stair.maxRiserHeight ?? 7.5,
      desiredRisers: stair.numRisers,
      shape: newShape,
      splitRiser: firstLanding?.afterRiser,
      landingDepth: firstLanding?.depth ?? stair.width,
      landingWidth: firstLanding?.width,
      wellGap: stair.wellGap ?? 6,
      cornerRadius: firstLanding?.cornerRadius,
      intermediateStep: firstLanding?.intermediateStep,
      constructionStyle: stair.constructionStyle,
      landingStructure: stair.landingStructure,
      landingThickness: stair.landingThickness,
      supportPosts: stair.supportPosts,
      railingStyle: stair.railingStyle,
      railingSide: stair.railingSide,
      railingHeight: stair.railingHeight,
      cutFloorAbove: stair.cutFloorAbove,
      layer: stair.layer,
    });
    onUpdateStair(rebuilt);
  };

  const handleApplyExactLandingElevation = () => {
    if (!exactElevText.trim()) return;
    const cleaned = exactElevText.trim().replace(/^\+/, '');
    const parsedInches = parseLengthInput(cleaned, units);
    if (parsedInches === null || parsedInches <= 0) return;
    const targetRiser = Math.max(1, Math.min(stair.numRisers - 1, Math.round(parsedInches / riserHeight)));
    onUpdateStair(rebalanceStairLandingSplit(stair, levels, targetRiser));
    setExactElevText('');
  };

  return (
    <div data-testid="stair-properties-panel" className="mt-2 space-y-3 border-t border-stone-200 pt-2.5 text-[11px] dark:border-stone-800">
      {/* 1. STAIR & LANDING TEMPLATE / CONFIGURATION */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Stair &amp; Landing Configuration
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {runs.length} {runs.length === 1 ? 'Run' : 'Runs'} · {landings.length}{' '}
            {landings.length === 1 ? 'Landing' : 'Landings'}
          </span>
        </div>

        <label className="block">
          <span className="text-[10px] text-stone-500">Stair Shape / Template</span>
          <select
            aria-label="Stair Shape Template"
            value={stair.shape ?? (runs.length > 1 ? 'l-left' : 'straight')}
            onChange={(e) => handleChangeTemplate(e.target.value as StairTemplateShape)}
            className="mt-0.5 w-full rounded border border-stone-300 bg-white px-2 py-1 text-[11px] dark:border-stone-700 dark:bg-stone-800"
          >
            {STAIR_TEMPLATES.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label}
              </option>
            ))}
          </select>
        </label>

        {/* Split a Straight Stair into 2 Runs + Landing */}
        {(runs.length === 1 || stair.shape === 'straight') && stair.shape !== 'spiral' && (
          <div className="rounded border border-amber-300 bg-amber-50/70 p-2 dark:border-amber-800/60 dark:bg-amber-950/30">
            <div className="mb-1 font-medium text-amber-900 dark:text-amber-200">
              Split Straight Stair with Intermediate Landing
            </div>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Split Landing Turn Type"
                value={splitTurnShape}
                onChange={(e) => setSplitTurnShape(e.target.value as any)}
                className="flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-[10px] dark:border-stone-700 dark:bg-stone-800"
              >
                <option value="straight-landing">Straight Mid-Landing</option>
                <option value="l-left">90° L-Landing (Left)</option>
                <option value="l-right">90° L-Landing (Right)</option>
                <option value="u-switchback">180° U-Switchback Landing</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  onUpdateStair(
                    insertLandingAtRiser(
                      stair,
                      levels,
                      Math.floor(stair.numRisers / 2),
                      splitTurnShape
                    )
                  )
                }
                className="flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
              >
                <Scissors size={11} />
                <span>Insert Landing at Riser…</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. LANDING RISER SPLIT, ELEVATION & DIMENSIONS */}
      {firstLanding && runs.length >= 2 && (
        <div className="space-y-2 rounded border border-stone-200 bg-stone-50/80 p-2 dark:border-stone-800 dark:bg-stone-900/50">
          <div className="flex items-center justify-between font-semibold text-stone-700 dark:text-stone-200">
            <span>Landing 1 — Split &amp; Dimensions</span>
            <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">
              Elev +{formatLength(firstLanding.elevationOffset, units)}
            </span>
          </div>

          {/* Riser Split Slider & Stepper */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-stone-600 dark:text-stone-400">
              <span>
                Landing sits after <strong>Riser {firstLanding.afterRiser}</strong> of {stair.numRisers}
              </span>
              <span>
                Run 1: {runs[0].numRisers}R · Run 2: {runs[1].numRisers}R
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                aria-label="Landing Riser Split"
                min={2}
                max={Math.max(2, stair.numRisers - 2)}
                value={firstLanding.afterRiser}
                onChange={(e) =>
                  onUpdateStair(rebalanceStairLandingSplit(stair, levels, Number(e.target.value)))
                }
                className="flex-1 accent-amber-600"
              />
              <input
                type="number"
                aria-label="Landing Split Riser Number"
                min={1}
                max={stair.numRisers - 1}
                value={firstLanding.afterRiser}
                onChange={(e) =>
                  onUpdateStair(rebalanceStairLandingSplit(stair, levels, Number(e.target.value)))
                }
                className="w-12 rounded border border-stone-300 bg-white px-1 py-0.5 text-center font-mono text-[10px] dark:border-stone-700 dark:bg-stone-800"
              />
            </div>
          </div>

          {/* Exact Landing Height Input (e.g. +4'-8") */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-stone-500">Exact Height:</span>
            <input
              type="text"
              aria-label="Landing Exact Height"
              placeholder={`+${formatLength(firstLanding.elevationOffset, units)} (e.g. +4'-8")`}
              value={exactElevText}
              onChange={(e) => setExactElevText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApplyExactLandingElevation();
              }}
              className="flex-1 rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[10px] dark:border-stone-700 dark:bg-stone-800"
            />
            <button
              type="button"
              onClick={handleApplyExactLandingElevation}
              className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800"
            >
              Set
            </button>
          </div>

          {/* Landing Depth, Landing Width, Well Gap */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-stone-500">
                Landing Depth ({formatLength(firstLanding.depth, units)})
              </span>
              <input
                type="number"
                aria-label="Landing Depth"
                min={stair.width}
                max={240}
                step={2}
                value={Math.round(firstLanding.depth)}
                onChange={(e) =>
                  onUpdateStair(
                    resizeStairLanding(stair, levels, 0, {
                      depth: Math.max(stair.width, Number(e.target.value) || stair.width),
                    })
                  )
                }
                className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-800"
              />
            </label>

            <label className="block">
              <span className="text-[10px] text-stone-500">
                Landing Width ({formatLength(firstLanding.width, units)})
              </span>
              <input
                type="number"
                aria-label="Landing Width"
                min={stair.width}
                max={300}
                step={2}
                value={Math.round(firstLanding.width)}
                onChange={(e) =>
                  onUpdateStair(
                    resizeStairLanding(stair, levels, 0, {
                      width: Math.max(stair.width, Number(e.target.value) || stair.width),
                    })
                  )
                }
                className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-800"
              />
            </label>
          </div>

          {(stair.shape === 'u-switchback' || stair.shape === 'u-3run' || stair.shape === 'winder-u') && (
            <label className="block">
              <span className="text-[10px] text-stone-500">
                Well Gap Between Flights ({formatLength(stair.wellGap ?? 6, units)})
              </span>
              <input
                type="number"
                aria-label="Stair Well Gap"
                min={0}
                max={96}
                step={2}
                value={stair.wellGap ?? 6}
                onChange={(e) => {
                  const nextGap = Math.max(0, Number(e.target.value) || 0);
                  const updated = createStairFromTemplate({
                    id: stair.id,
                    origin: runs[0].start,
                    direction: {
                      x: runs[0].end.x - runs[0].start.x,
                      y: runs[0].end.y - runs[0].start.y,
                    },
                    baseLevelId: stair.baseLevelId,
                    topLevelId: stair.topLevelId,
                    baseElevation,
                    topElevation,
                    width: stair.width,
                    treadDepth: stair.treadDepth,
                    desiredRisers: stair.numRisers,
                    shape: stair.shape ?? 'u-switchback',
                    splitRiser: firstLanding.afterRiser,
                    landingDepth: firstLanding.depth,
                    landingWidth: firstLanding.width,
                    wellGap: nextGap,
                    cornerRadius: firstLanding.cornerRadius,
                    intermediateStep: firstLanding.intermediateStep,
                    constructionStyle: stair.constructionStyle,
                    landingStructure: firstLanding.structure,
                    landingThickness: firstLanding.thickness,
                    supportPosts: firstLanding.supportPosts,
                    railingStyle: stair.railingStyle,
                    railingSide: stair.railingSide,
                    cutFloorAbove: stair.cutFloorAbove,
                    layer: stair.layer,
                  });
                  onUpdateStair(updated);
                }}
                className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-800"
              />
            </label>
          )}

          {/* Custom Landing Sketch Options: Corner Radius & U-Landing Intermediate Step */}
          <div className="grid grid-cols-2 items-center gap-2 pt-1">
            <label className="block">
              <span className="text-[10px] text-stone-500">Curved Corner Radius (&quot;)</span>
              <input
                type="number"
                aria-label="Landing Corner Radius"
                min={0}
                max={36}
                step={2}
                value={firstLanding.cornerRadius ?? 0}
                onChange={(e) =>
                  onUpdateStair(
                    resizeStairLanding(stair, levels, 0, {
                      cornerRadius: Math.max(0, Number(e.target.value) || 0),
                    })
                  )
                }
                className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-800"
              />
            </label>

            <label className="mt-3 flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(firstLanding.intermediateStep)}
                onChange={(e) =>
                  onUpdateStair(
                    resizeStairLanding(stair, levels, 0, {
                      intermediateStep: e.target.checked,
                    })
                  )
                }
                className="rounded border-stone-300 text-amber-600"
              />
              <span className="text-[10px]">Middle Step on Landing</span>
            </label>
          </div>

          {/* Landing Thickness & Structure */}
          <div className="space-y-1.5 border-t border-stone-200 pt-1.5 dark:border-stone-800">
            <label className="block">
              <span className="text-[10px] text-stone-500">Landing Structure</span>
              <select
                aria-label="Landing Structure"
                value={firstLanding.structure ?? stair.landingStructure ?? 'monolithic'}
                onChange={(e) => {
                  const s = e.target.value as StairLandingStructure;
                  const resized = resizeStairLanding(stair, levels, 0, { structure: s });
                  onUpdateStair({ ...resized, landingStructure: s });
                }}
                className="mt-0.5 w-full rounded border border-stone-300 bg-white px-2 py-1 text-[11px] dark:border-stone-700 dark:bg-stone-800"
              >
                {STAIR_LANDING_STRUCTURES.map((ls) => (
                  <option key={ls.id} value={ls.id}>
                    {ls.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 items-center gap-2">
              <label className="block">
                <span className="text-[10px] text-stone-500">Thickness (&quot;)</span>
                <input
                  type="number"
                  aria-label="Landing Thickness"
                  min={2}
                  max={24}
                  step={0.5}
                  value={firstLanding.thickness ?? stair.landingThickness ?? 6}
                  onChange={(e) => {
                    const th = Math.max(2, Number(e.target.value) || 6);
                    const resized = resizeStairLanding(stair, levels, 0, { thickness: th });
                    onUpdateStair({ ...resized, landingThickness: th });
                  }}
                  className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-800"
                />
              </label>

              <label className="mt-3 flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(firstLanding.supportPosts ?? stair.supportPosts)}
                  onChange={(e) => {
                    const sp = e.target.checked;
                    const resized = resizeStairLanding(stair, levels, 0, { supportPosts: sp });
                    onUpdateStair({ ...resized, supportPosts: sp });
                  }}
                  className="rounded border-stone-300 text-amber-600"
                />
                <span className="text-[10px]">Support Posts Below</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 3. 3D CONSTRUCTION STYLE, CABIN / MODERN STYLES & RAILINGS */}
      <div className="space-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-800">
        <div className="font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          3D Construction &amp; Railings
        </div>

        <label className="block">
          <span className="text-[10px] text-stone-500">Stair Construction Style</span>
          <select
            aria-label="Stair 3D Construction Style"
            value={stair.constructionStyle ?? 'closed-stringer'}
            onChange={(e) => {
              const cs = e.target.value as StairConstructionStyle;
              onUpdateStair({
                ...stair,
                constructionStyle: cs,
                railingStyle: cs === 'cabin-split-log' ? 'cabin-peeled-log' : stair.railingStyle,
                supportPosts: cs === 'cabin-split-log' ? true : stair.supportPosts,
              });
            }}
            className="mt-0.5 w-full rounded border border-stone-300 bg-white px-2 py-1 text-[11px] dark:border-stone-700 dark:bg-stone-800"
          >
            {STAIR_CONSTRUCTION_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-stone-500">Railing Style</span>
            <select
              aria-label="Stair Railing Style"
              value={stair.railingStyle ?? 'wood-balusters'}
              onChange={(e) =>
                onUpdateStair({
                  ...stair,
                  railingStyle: e.target.value as StairRailingStyle,
                })
              }
              className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-[11px] dark:border-stone-700 dark:bg-stone-800"
            >
              {STAIR_RAILING_STYLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] text-stone-500">Railing Sides</span>
            <select
              aria-label="Stair Railing Side"
              value={stair.railingSide ?? 'both'}
              onChange={(e) =>
                onUpdateStair({
                  ...stair,
                  railingSide: e.target.value as StairRailingSide,
                })
              }
              className="mt-0.5 w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-[11px] dark:border-stone-700 dark:bg-stone-800"
            >
              <option value="both">Inner &amp; Outer (Both)</option>
              <option value="left">Left / Inner Only</option>
              <option value="right">Right / Outer Only</option>
              <option value="none">No Railing</option>
            </select>
          </label>
        </div>
      </div>

      {/* 4. AUTOMATIC FLOOR OPENING ("Cut Floor Above") & HEADROOM CLEARANCE */}
      <div className="space-y-1.5 rounded border border-emerald-200 bg-emerald-50/60 p-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <label className="flex cursor-pointer items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200">
            <input
              type="checkbox"
              checked={stair.cutFloorAbove !== false}
              onChange={(e) =>
                onUpdateStair({
                  ...stair,
                  cutFloorAbove: e.target.checked,
                })
              }
              className="rounded border-stone-300 text-emerald-600"
            />
            <span>Cut Floor Above (Auto Stairwell Opening)</span>
          </span>
        </label>

        <div className="flex items-center justify-between text-[10px] text-emerald-800 dark:text-emerald-300">
          <span className="flex items-center gap-1">
            <ShieldCheck size={12} />
            <span>
              Headroom Clearance: <strong>{formatLength(headroom.minHeadroomInches, units)}</strong>
            </span>
          </span>
          <span className="rounded bg-emerald-600/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold">
            {headroom.passesCode ? '≥ 6\'-8" CODE OK' : 'CHECK HEADROOM'}
          </span>
        </div>
      </div>
    </div>
  );
};
