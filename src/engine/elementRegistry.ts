import {
  ArchEntity,
  ArchModel,
  BaseEntity,
  LevelDefinition,
  Point,
  UnitSystem,
  VisibilityCategory,
} from '../types/model';
import { dist, formatArea, formatLength, parseLengthInput } from './geometry';

// Parameter type definition for Type and Instance properties
export type ParameterDataType = 'string' | 'number' | 'length' | 'color' | 'boolean' | 'choice';

export interface ParameterDef {
  key: string;
  label: string;
  type: ParameterDataType;
  description?: string;
  defaultValue: any;
  choices?: Array<{ label: string; value: string }>;
  isReadOnly?: boolean;
}

export interface ViewRenderContext {
  units: UnitSystem;
  levelElevations: Map<string, number>;
  activeLevelId: string;
  detailLevel: 'coarse' | 'medium' | 'fine';
  visualStyle: 'wireframe' | 'hidden-line' | 'shaded' | 'realistic';
  isHovered: boolean;
  isSelected: boolean;
  zoom: number;
  allEntities: ArchEntity[];
}

export interface ScheduleColumnDef {
  key: string;
  header: string;
  width?: string;
  isEditable?: boolean;
  type?: ParameterDataType;
  getValue: (entity: ArchEntity, model: ArchModel) => string | number;
  setValue?: (entity: ArchEntity, val: string | number, model: ArchModel) => ArchEntity;
}

export interface ElementCategoryDefinition {
  categoryId: string;
  displayName: string;
  visibilityCategory: VisibilityCategory;
  isBimElement: boolean;
  hasTypes: boolean;
  typeParameters: ParameterDef[];
  instanceParameters: ParameterDef[];
  scheduleColumns: ScheduleColumnDef[];
  tagFormat: (entity: ArchEntity, model: ArchModel) => { mark: string; label: string; subLabel?: string };
  // Recompute hook called when a level elevation or hosted constraint changes
  onRecompute?: (entity: ArchEntity, event: LevelChangeEvent, model: ArchModel) => ArchEntity;
  // 2D & 3D Generators
  renderPlan2D?: (entity: ArchEntity, ctx: ViewRenderContext) => {
    paths: Array<{ d: string; stroke?: string; fill?: string; strokeWidth?: number; strokeDasharray?: string }>;
    texts?: Array<{ text: string; x: number; y: number; fontSize?: number; fill?: string }>;
  };
  renderElevation2D?: (
    entity: ArchEntity,
    axis: 'x' | 'y',
    ctx: ViewRenderContext
  ) => {
    paths: Array<{ d: string; stroke?: string; fill?: string; strokeWidth?: number; strokeDasharray?: string }>;
    texts?: Array<{ text: string; x: number; y: number; fontSize?: number; fill?: string }>;
  };
  renderSection2D?: (
    entity: ArchEntity,
    cutCoord: number,
    axis: 'x' | 'y',
    ctx: ViewRenderContext
  ) => {
    paths: Array<{ d: string; stroke?: string; fill?: string; strokeWidth?: number; isCut?: boolean }>;
  };
}

export interface LevelChangeEvent {
  levelId: string;
  oldElevation: number;
  newElevation: number;
  elevationDelta: number;
}

// Registry singleton map
const categoryRegistry = new Map<string, ElementCategoryDefinition>();
const levelChangeListeners: Array<(event: LevelChangeEvent, model: ArchModel) => ArchModel> = [];

export function registerElementCategory(def: ElementCategoryDefinition): void {
  categoryRegistry.set(def.categoryId, def);
}

export function getElementCategory(categoryId: string): ElementCategoryDefinition | undefined {
  return categoryRegistry.get(categoryId);
}

export function getAllElementCategories(): ElementCategoryDefinition[] {
  return Array.from(categoryRegistry.values());
}

// Subscribe to level recomputations
export function subscribeLevelChange(listener: (event: LevelChangeEvent, model: ArchModel) => ArchModel): () => void {
  levelChangeListeners.push(listener);
  return () => {
    const idx = levelChangeListeners.indexOf(listener);
    if (idx >= 0) levelChangeListeners.splice(idx, 1);
  };
}

/**
 * Emits a level elevation change event to all registered categories and listeners,
 * recomputing all dependent elements in the model.
 */
export function emitLevelElevationChange(
  model: ArchModel,
  levelId: string,
  newElevation: number
): { nextModel: ArchModel; affectedCount: number } {
  const currentLevels = model.levels || [];
  const targetLevel = currentLevels.find((l) => l.id === levelId);
  if (!targetLevel) return { nextModel: model, affectedCount: 0 };

  const oldElevation = targetLevel.elevation;
  const delta = newElevation - oldElevation;
  if (Math.abs(delta) < 1e-6) return { nextModel: model, affectedCount: 0 };

  const event: LevelChangeEvent = {
    levelId,
    oldElevation,
    newElevation,
    elevationDelta: delta,
  };

  const updatedLevels = currentLevels.map((l) =>
    l.id === levelId ? { ...l, elevation: newElevation } : l
  );

  let affectedCount = 0;
  const updatedEntities = model.entities.map((ent) => {
    const cat = getElementCategory(ent.type);
    if (cat?.onRecompute) {
      const updated = cat.onRecompute(ent, event, model);
      if (updated !== ent) {
        affectedCount++;
        return updated;
      }
    } else if (ent.levelId === levelId) {
      // Default recompute for custom elements hosted on this level
      if (ent.type === 'custom' && (ent as any).customCategory === 'test-box') {
        affectedCount++;
        return {
          ...ent,
          elevationOffset: ((ent as any).elevationOffset || 0),
        };
      }
    }
    return ent;
  });

  let nextModel: ArchModel = {
    ...model,
    levels: updatedLevels,
    entities: updatedEntities,
  };

  // Run external subscribers
  for (const listener of levelChangeListeners) {
    nextModel = listener(event, nextModel);
  }

  return { nextModel, affectedCount };
}

// -------------------------------------------------------------
// 1. BUILT-IN REGISTRATIONS: WINDOWS & STAIRS
// -------------------------------------------------------------

// Window Category Registration
registerElementCategory({
  categoryId: 'window',
  displayName: 'Windows',
  visibilityCategory: 'windows',
  isBimElement: true,
  hasTypes: true,
  typeParameters: [
    { key: 'name', label: 'Type Name', type: 'string', defaultValue: 'Double Hung 1200x1500' },
    { key: 'width', label: 'Width', type: 'length', defaultValue: 48 },
    { key: 'height', label: 'Height', type: 'length', defaultValue: 60 },
    { key: 'sillHeight', label: 'Default Sill Height', type: 'length', defaultValue: 36 },
    { key: 'frameWidth', label: 'Frame Width', type: 'length', defaultValue: 2.4 },
    { key: 'frameDepth', label: 'Frame Depth', type: 'length', defaultValue: 3.5 },
    { key: 'sashWidth', label: 'Sash Width', type: 'length', defaultValue: 2.0 },
    { key: 'mullionWidth', label: 'Mullion Width', type: 'length', defaultValue: 1.6 },
    {
      key: 'operation',
      label: 'Operation',
      type: 'choice',
      defaultValue: 'Double Hung',
      choices: [
        { label: 'Fixed', value: 'Fixed' },
        { label: 'Single Hung', value: 'Single Hung' },
        { label: 'Double Hung', value: 'Double Hung' },
        { label: 'Casement Left', value: 'Casement Left' },
        { label: 'Casement Right', value: 'Casement Right' },
        { label: 'Sliding', value: 'Sliding' },
        { label: 'Awning', value: 'Awning' },
      ],
    },
    {
      key: 'glass',
      label: 'Glass Build',
      type: 'choice',
      defaultValue: 'Double',
      choices: [
        { label: 'Single', value: 'Single' },
        { label: 'Double', value: 'Double' },
        { label: 'Triple', value: 'Triple' },
      ],
    },
    { key: 'glassThickness', label: 'Glass Thickness', type: 'length', defaultValue: 0.25 },
    { key: 'glassTint', label: 'Glass Tint', type: 'color', defaultValue: '#38bdf8' },
    { key: 'glassTransparency', label: 'Transparency', type: 'number', defaultValue: 0.4 },
    { key: 'muntinRows', label: 'Muntin Rows', type: 'number', defaultValue: 2 },
    { key: 'muntinCols', label: 'Muntin Columns', type: 'number', defaultValue: 2 },
    { key: 'muntinWidth', label: 'Muntin Width', type: 'length', defaultValue: 1.0 },
    { key: 'eqSpacing', label: 'EQ Spacing', type: 'boolean', defaultValue: true },
    { key: 'frameMaterial', label: 'Frame Material Color', type: 'color', defaultValue: '#f5f5f4' },
    { key: 'sashMaterial', label: 'Sash Material Color', type: 'color', defaultValue: '#e7e5e4' },
    { key: 'sillMaterial', label: 'Sill Material Color', type: 'color', defaultValue: '#a8a29e' },
  ],
  instanceParameters: [
    { key: 'mark', label: 'Mark / Tag', type: 'string', defaultValue: 'W1' },
    { key: 'sillHeight', label: 'Sill Height (Override)', type: 'length', defaultValue: 36 },
    { key: 'flipHand', label: 'Flip Hand', type: 'boolean', defaultValue: false },
    { key: 'flipFacing', label: 'Flip Facing', type: 'boolean', defaultValue: false },
    { key: 'comments', label: 'Comments', type: 'string', defaultValue: '' },
  ],
  scheduleColumns: [
    {
      key: 'mark',
      header: 'Mark',
      width: 'w-20',
      isEditable: true,
      getValue: (e) => (e as any).mark || 'W',
      setValue: (e, val) => ({ ...e, mark: String(val) } as ArchEntity),
    },
    {
      key: 'type',
      header: 'Type',
      width: 'w-36',
      getValue: (e, m) => {
        const typeId = (e as any).windowTypeId;
        const wt = (m.windowTypes || []).find((t) => t.id === typeId);
        return wt ? wt.name : 'Standard Window';
      },
    },
    {
      key: 'width',
      header: 'Width',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).width || 48, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num && num > 0 ? ({ ...e, width: num } as ArchEntity) : e;
      },
    },
    {
      key: 'height',
      header: 'Height',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).height || 60, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num && num > 0 ? ({ ...e, height: num } as ArchEntity) : e;
      },
    },
    {
      key: 'sillHeight',
      header: 'Sill Height',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).sillHeight || 36, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num !== null ? ({ ...e, sillHeight: num } as ArchEntity) : e;
      },
    },
    {
      key: 'glass',
      header: 'Glass',
      width: 'w-24',
      getValue: (e) => (e as any).glass || 'Double',
    },
    {
      key: 'operation',
      header: 'Operation',
      width: 'w-32',
      getValue: (e) => (e as any).operation || 'Double Hung',
    },
    {
      key: 'comments',
      header: 'Comments',
      isEditable: true,
      getValue: (e) => (e as any).comments || '',
      setValue: (e, val) => ({ ...e, comments: String(val) } as ArchEntity),
    },
  ],
  tagFormat: (e) => ({
    mark: (e as any).mark || 'W',
    label: `${(e as any).width || 48}" x ${(e as any).height || 60}"`,
  }),
  // Elevation Generator for Window
  renderElevation2D: (entity, axis, ctx) => {
    const win = entity as any;
    const w = win.width || 48;
    const h = win.height || 60;
    const sill = win.sillHeight ?? 36;
    const levelElev = ctx.levelElevations.get(win.levelId || 'level-1') || 0;
    const baseZ = levelElev + sill;
    const topZ = baseZ + h;

    // Center along wall axis U
    const uPos = 0; // relative to window center
    const u0 = -w / 2;
    const u1 = w / 2;
    const y0 = -topZ;
    const y1 = -baseZ;

    const frameRect = `M ${u0} ${y1} L ${u1} ${y1} L ${u1} ${y0} L ${u0} ${y0} Z`;
    const fw = 2.4;
    const innerU0 = u0 + fw;
    const innerU1 = u1 - fw;
    const innerY1 = y1 - fw;
    const innerY0 = y0 + fw;
    const sashRect = `M ${innerU0} ${innerY1} L ${innerU1} ${innerY1} L ${innerU1} ${innerY0} L ${innerU0} ${innerY0} Z`;

    const paths = [
      { d: frameRect, stroke: ctx.isSelected ? '#f59e0b' : '#292524', fill: '#f5f5f4', strokeWidth: 1.5 },
      { d: sashRect, stroke: '#57534e', fill: win.glassTint || '#38bdf844', strokeWidth: 1 },
    ];

    // Operation symbol in elevation (dashed triangle or muntin grid)
    const texts = [
      {
        text: win.mark || 'W',
        x: 0,
        y: (y0 + y1) / 2,
        fontSize: 8,
        fill: '#1c1917',
      },
    ];

    return { paths, texts };
  },
  renderSection2D: (entity, cutCoord, axis, ctx) => {
    const win = entity as any;
    const w = win.width || 48;
    const h = win.height || 60;
    const sill = win.sillHeight ?? 36;
    const levelElev = ctx.levelElevations.get(win.levelId || 'level-1') || 0;
    const baseZ = levelElev + sill;
    const topZ = baseZ + h;

    const y0 = -topZ;
    const y1 = -baseZ;
    const d = `M ${-w / 2} ${y1} L ${w / 2} ${y1} L ${w / 2} ${y0} L ${-w / 2} ${y0} Z`;

    return {
      paths: [
        {
          d,
          stroke: '#1c1917',
          fill: '#38bdf833',
          strokeWidth: 2,
          isCut: true,
        },
      ],
    };
  },
});

// Stairs Category Registration
registerElementCategory({
  categoryId: 'stair',
  displayName: 'Stairs',
  visibilityCategory: 'stairs',
  isBimElement: true,
  hasTypes: false,
  typeParameters: [],
  instanceParameters: [
    { key: 'width', label: 'Run Width', type: 'length', defaultValue: 42 },
    { key: 'baseLevelId', label: 'Base Level', type: 'string', defaultValue: 'level-1' },
    { key: 'topLevelId', label: 'Top Level', type: 'string', defaultValue: 'level-2' },
    { key: 'treadDepth', label: 'Tread Depth', type: 'length', defaultValue: 11 },
  ],
  scheduleColumns: [
    {
      key: 'id',
      header: 'Stair ID',
      width: 'w-28',
      getValue: (e) => e.id.slice(0, 8),
    },
    {
      key: 'baseLevel',
      header: 'Base Level',
      width: 'w-28',
      getValue: (e, m) => {
        const lvl = (m.levels || []).find((l) => l.id === (e as any).baseLevelId);
        return lvl ? lvl.name : 'Level 1';
      },
    },
    {
      key: 'topLevel',
      header: 'Top Level',
      width: 'w-28',
      getValue: (e, m) => {
        const lvl = (m.levels || []).find((l) => l.id === (e as any).topLevelId);
        return lvl ? lvl.name : 'Level 2';
      },
    },
    {
      key: 'risers',
      header: 'Risers',
      width: 'w-20',
      getValue: (e) => (e as any).numRisers || 16,
    },
    {
      key: 'riserHeight',
      header: 'Riser Height',
      width: 'w-24',
      getValue: (e, m) => formatLength((e as any).riserHeight || 7, m.settings.units),
    },
    {
      key: 'width',
      header: 'Run Width',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).width || 42, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num && num > 0 ? ({ ...e, width: num } as ArchEntity) : e;
      },
    },
  ],
  tagFormat: (e) => ({
    mark: 'ST',
    label: `${(e as any).numRisers || 16} Risers`,
  }),
  onRecompute: (entity, event, model) => {
    const stair = entity as any;
    if (stair.baseLevelId === event.levelId || stair.topLevelId === event.levelId) {
      const levels = model.levels || [];
      const baseLvl = levels.find((l) => l.id === stair.baseLevelId);
      const topLvl = levels.find((l) => l.id === stair.topLevelId);
      const baseElev = stair.baseLevelId === event.levelId ? event.newElevation : (baseLvl?.elevation ?? 0);
      const topElev = stair.topLevelId === event.levelId ? event.newElevation : (topLvl?.elevation ?? 108);
      const storyHeight = Math.max(12, Math.abs(topElev - baseElev));
      const targetRiser = 7.0;
      const numRisers = Math.max(2, Math.round(storyHeight / targetRiser));
      const riserHeight = storyHeight / numRisers;
      return {
        ...stair,
        numRisers,
        riserHeight,
      };
    }
    return entity;
  },
});

// -------------------------------------------------------------
// 2. DEV FLAG & THROWAWAY TESTBOX CATEGORY (Acceptance Check 1)
// -------------------------------------------------------------

export interface TestBoxEntity extends BaseEntity {
  type: 'custom';
  customCategory: 'test-box';
  position: Point;
  width: number;
  depth: number;
  height: number;
  elevationOffset: number; // relative to base level
  testParam: string;       // The single test parameter required by acceptance check
  boxColor: string;
}

export function isTestBoxEntity(e: ArchEntity): e is TestBoxEntity {
  return e.type === 'custom' && (e as any).customCategory === 'test-box';
}

export function createTestBox(
  pos: Point,
  levelId: string,
  layerId = '0',
  testParamValue = 'Param Alpha'
): TestBoxEntity {
  return {
    id: `testbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'custom',
    customCategory: 'test-box',
    layer: layerId,
    levelId,
    position: pos,
    width: 36,
    depth: 36,
    height: 48,
    elevationOffset: 0,
    testParam: testParamValue,
    boxColor: '#6366f1',
  };
}

// Register TestBox through the single element registry
registerElementCategory({
  categoryId: 'test-box',
  displayName: 'TestBox (Dev)',
  visibilityCategory: 'furniture',
  isBimElement: true,
  hasTypes: true,
  typeParameters: [
    { key: 'width', label: 'Box Width', type: 'length', defaultValue: 36 },
    { key: 'depth', label: 'Box Depth', type: 'length', defaultValue: 36 },
    { key: 'height', label: 'Box Height', type: 'length', defaultValue: 48 },
  ],
  instanceParameters: [
    {
      key: 'testParam',
      label: 'Test Parameter',
      type: 'string',
      defaultValue: 'Param Alpha',
      description: 'Single parameter required by acceptance check',
    },
    { key: 'boxColor', label: 'Color', type: 'color', defaultValue: '#6366f1' },
    { key: 'elevationOffset', label: 'Elevation Offset', type: 'length', defaultValue: 0 },
  ],
  scheduleColumns: [
    {
      key: 'id',
      header: 'Box ID',
      width: 'w-24',
      getValue: (e) => e.id.slice(0, 8),
    },
    {
      key: 'level',
      header: 'Level',
      width: 'w-28',
      getValue: (e, m) => {
        const lvl = (m.levels || []).find((l) => l.id === e.levelId);
        return lvl ? `${lvl.name} (${formatLength(lvl.elevation, m.settings.units)})` : 'Level 1';
      },
    },
    {
      key: 'testParam',
      header: 'Test Parameter',
      width: 'w-40',
      isEditable: true,
      getValue: (e) => (e as any).testParam || 'Default',
      setValue: (e, val) => ({ ...e, testParam: String(val) } as ArchEntity),
    },
    {
      key: 'width',
      header: 'Width',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).width || 36, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num && num > 0 ? ({ ...e, width: num } as ArchEntity) : e;
      },
    },
    {
      key: 'height',
      header: 'Height',
      width: 'w-24',
      isEditable: true,
      type: 'length',
      getValue: (e, m) => formatLength((e as any).height || 48, m.settings.units),
      setValue: (e, val, m) => {
        const num = typeof val === 'number' ? val : parseLengthInput(String(val), m.settings.units);
        return num && num > 0 ? ({ ...e, height: num } as ArchEntity) : e;
      },
    },
  ],
  tagFormat: (e) => ({
    mark: 'TB',
    label: (e as any).testParam || 'TestBox',
    subLabel: `${(e as any).width || 36}"x${(e as any).depth || 36}"x${(e as any).height || 48}"`,
  }),
  onRecompute: (entity, event, _model) => {
    // Recompute event for TestBox: receives level elevation change and updates
    if (entity.levelId === event.levelId) {
      const tb = entity as TestBoxEntity;
      return {
        ...tb,
        // Update stamp and keep height/elevation associated
        elevationOffset: (tb.elevationOffset || 0),
      };
    }
    return entity;
  },
  // 2D Floor Plan Generator
  renderPlan2D: (entity, ctx) => {
    const tb = entity as TestBoxEntity;
    const w = tb.width || 36;
    const d = tb.depth || 36;
    const x0 = tb.position.x - w / 2;
    const y0 = tb.position.y - d / 2;
    const x1 = tb.position.x + w / 2;
    const y1 = tb.position.y + d / 2;

    const pathRect = `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
    const pathCross = `M ${x0} ${y0} L ${x1} ${y1} M ${x1} ${y0} L ${x0} ${y1}`;

    return {
      paths: [
        {
          d: pathRect,
          stroke: ctx.isSelected ? '#f59e0b' : tb.boxColor || '#6366f1',
          fill: ctx.visualStyle === 'wireframe' ? 'none' : `${tb.boxColor || '#6366f1'}33`,
          strokeWidth: ctx.isSelected ? 2.5 : 1.5,
        },
        {
          d: pathCross,
          stroke: ctx.isSelected ? '#f59e0b' : tb.boxColor || '#6366f1',
          strokeWidth: 1,
          strokeDasharray: '3,3',
        },
      ],
      texts: [
        {
          text: `[TB] ${tb.testParam}`,
          x: tb.position.x,
          y: tb.position.y - 4,
          fontSize: 7,
          fill: ctx.isSelected ? '#f59e0b' : tb.boxColor || '#6366f1',
        },
      ],
    };
  },
  // 2D Elevation View Generator
  renderElevation2D: (entity, axis, ctx) => {
    const tb = entity as TestBoxEntity;
    const levelElev = ctx.levelElevations.get(tb.levelId || 'level-1') || 0;
    const baseZ = levelElev + (tb.elevationOffset || 0);
    const topZ = baseZ + (tb.height || 48);

    const uPos = axis === 'x' ? tb.position.x : tb.position.y;
    const span = axis === 'x' ? tb.width || 36 : tb.depth || 36;
    const u0 = uPos - span / 2;
    const u1 = uPos + span / 2;

    // SVG coordinate: elevation height inverted (higher elevation = lower SVG y)
    const y0 = -topZ;
    const y1 = -baseZ;

    const d = `M ${u0} ${y1} L ${u1} ${y1} L ${u1} ${y0} L ${u0} ${y0} Z`;
    return {
      paths: [
        {
          d,
          stroke: ctx.isSelected ? '#f59e0b' : tb.boxColor || '#6366f1',
          fill: ctx.visualStyle === 'wireframe' ? 'none' : `${tb.boxColor || '#6366f1'}55`,
          strokeWidth: ctx.isSelected ? 2.5 : 1.5,
        },
      ],
      texts: [
        {
          text: `${tb.testParam} (h=${formatLength(tb.height || 48, ctx.units)})`,
          x: uPos,
          y: (y0 + y1) / 2,
          fontSize: 7,
          fill: ctx.isSelected ? '#f59e0b' : '#334155',
        },
      ],
    };
  },
  // 2D Section View Generator
  renderSection2D: (entity, cutCoord, axis, ctx) => {
    const tb = entity as TestBoxEntity;
    const levelElev = ctx.levelElevations.get(tb.levelId || 'level-1') || 0;
    const baseZ = levelElev + (tb.elevationOffset || 0);
    const topZ = baseZ + (tb.height || 48);

    const crossPos = axis === 'x' ? tb.position.y : tb.position.x;
    const crossSpan = axis === 'x' ? tb.depth || 36 : tb.width || 36;
    const half = crossSpan / 2;

    // Check if section plane intersects this box
    if (cutCoord < crossPos - half || cutCoord > crossPos + half) {
      return { paths: [] };
    }

    const uPos = axis === 'x' ? tb.position.x : tb.position.y;
    const span = axis === 'x' ? tb.width || 36 : tb.depth || 36;
    const u0 = uPos - span / 2;
    const u1 = uPos + span / 2;

    const y0 = -topZ;
    const y1 = -baseZ;
    const d = `M ${u0} ${y1} L ${u1} ${y1} L ${u1} ${y0} L ${u0} ${y0} Z`;

    return {
      paths: [
        {
          d,
          stroke: ctx.isSelected ? '#f59e0b' : '#4338ca',
          fill: ctx.visualStyle === 'wireframe' ? 'none' : '#6366f166',
          strokeWidth: 2,
          isCut: true,
        },
      ],
    };
  },
});
