import { ArchModel, LevelDefinition, StairEntity } from '../types/model';

export type StairPresetCode = 'IBC Commercial' | 'IBC Residential' | 'UK Part K Private' | 'Custom';

export interface StairCodePreset {
  name: StairPresetCode;
  maxRiserHeight: number; // inches or mm (internal units in inches: 178mm ~ 7.0", 196mm ~ 7.72")
  minTreadDepth: number;  // inches (279mm ~ 11.0", 254mm ~ 10.0")
  minRunWidth: number;    // inches (1120mm ~ 44", 914mm ~ 36", 800mm ~ 31.5")
}

export const STAIR_PRESETS: Record<StairPresetCode, StairCodePreset> = {
  'IBC Commercial': {
    name: 'IBC Commercial',
    maxRiserHeight: 7.0,   // ~178 mm
    minTreadDepth: 11.0,   // ~279 mm
    minRunWidth: 44.0,     // ~1120 mm
  },
  'IBC Residential': {
    name: 'IBC Residential',
    maxRiserHeight: 7.75,  // ~196 mm
    minTreadDepth: 10.0,   // ~254 mm
    minRunWidth: 36.0,     // ~914 mm
  },
  'UK Part K Private': {
    name: 'UK Part K Private',
    maxRiserHeight: 8.66,  // ~220 mm
    minTreadDepth: 8.66,   // ~220 mm
    minRunWidth: 31.5,     // ~800 mm
  },
  'Custom': {
    name: 'Custom',
    maxRiserHeight: 8.0,
    minTreadDepth: 10.0,
    minRunWidth: 36.0,
  },
};

export interface StairCalculationResult {
  totalRise: number;
  desiredRisers: number;
  actualRisers: number;
  riserHeight: number;
  actualTreads: number;
  runLength: number;
  doubleRisePlusTread: number; // 2R + T (comfort check: 550 to 700 mm ~ 21.6" to 27.5")
  slopeAngleDeg: number;
  passesCode: boolean;
  warnings: string[];
}

export function computeStairEngineCalculations(
  stair: Partial<StairEntity>,
  model: ArchModel,
  presetCode: StairPresetCode = 'IBC Commercial'
): StairCalculationResult {
  const levels = model.levels || [];
  const baseLvl = levels.find((l) => l.id === (stair.baseLevelId || 'level-1')) || levels[0] || { elevation: 0 };
  const topLvl = levels.find((l) => l.id === (stair.topLevelId || 'level-2')) || levels[1] || { elevation: 108 };

  const baseElev = baseLvl.elevation + (stair.baseOffset || 0);
  const topElev = topLvl.elevation + (stair.topOffset || 0);
  const totalRise = Math.max(12, Math.abs(topElev - baseElev));

  const preset = STAIR_PRESETS[presetCode] || STAIR_PRESETS['IBC Commercial'];
  const maxRiser = preset.maxRiserHeight;
  const minTread = preset.minTreadDepth;

  // Desired number of risers
  const calculatedDesired = Math.ceil(totalRise / maxRiser);
  const desiredRisers = stair.numRisers || calculatedDesired;
  const actualRisers = Math.max(2, desiredRisers);
  const riserHeight = totalRise / actualRisers;
  const actualTreads = Math.max(1, actualRisers - 1);
  const treadDepth = stair.treadDepth || minTread;
  const runLength = actualTreads * treadDepth;

  // 2R + T rule (in inches: ~21.6" to 27.5" corresponds to 550mm - 700mm)
  const doubleRisePlusTread = 2 * riserHeight + treadDepth;
  const slopeRad = Math.atan(riserHeight / treadDepth);
  const slopeAngleDeg = (slopeRad * 180) / Math.PI;

  const warnings: string[] = [];
  let passesCode = true;

  if (riserHeight > maxRiser) {
    warnings.push(`Riser height (${riserHeight.toFixed(2)}") exceeds code maximum (${maxRiser}").`);
    passesCode = false;
  }
  if (treadDepth < minTread) {
    warnings.push(`Tread depth (${treadDepth.toFixed(2)}") is less than code minimum (${minTread}").`);
    passesCode = false;
  }
  if ((stair.width || 36) < preset.minRunWidth) {
    warnings.push(`Run width (${stair.width || 36}") is below preset minimum (${preset.minRunWidth}").`);
    passesCode = false;
  }
  // Comfort check: 2R + T between 21.6 inches (~550mm) and 27.5 inches (~700mm)
  if (doubleRisePlusTread < 21.6 || doubleRisePlusTread > 27.5) {
    warnings.push(`Comfort rule (2R+T = ${doubleRisePlusTread.toFixed(1)}") is outside optimal range [21.6" - 27.5"].`);
  }

  return {
    totalRise,
    desiredRisers,
    actualRisers,
    riserHeight,
    actualTreads,
    runLength,
    doubleRisePlusTread,
    slopeAngleDeg,
    passesCode,
    warnings,
  };
}
