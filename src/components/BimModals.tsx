import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Layers,
  Eye,
  Sliders,
  Check,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  LevelDefinition,
  UnitSystem,
  VisibilityCategory,
  VisibilitySettings,
  WallAssemblyLayer,
  WallType,
} from '../types/model';
import {
  formatLength,
  getWallTypeTotalThickness,
  parseLengthInput,
} from '../engine/geometry';

// --- 1. LEVEL MANAGER MODAL (LL / LEVEL) ---

interface LevelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  levels: LevelDefinition[];
  activeLevelId: string;
  units: UnitSystem;
  onSelectLevel: (levelId: string) => void;
  onUpdateLevels: (nextLevels: LevelDefinition[], nextActiveId?: string) => void;
}

export const LevelManagerModal: React.FC<LevelManagerModalProps> = ({
  isOpen,
  onClose,
  levels,
  activeLevelId,
  units,
  onSelectLevel,
  onUpdateLevels,
}) => {
  const [newName, setNewName] = useState('');
  const [newElevationText, setNewElevationText] = useState('');

  if (!isOpen) return null;

  const sortedLevels = [...levels].sort((a, b) => a.elevation - b.elevation);

  const handleElevationEdit = (id: string, raw: string) => {
    const parsed = parseLengthInput(raw, units);
    if (parsed !== null && Number.isFinite(parsed)) {
      onUpdateLevels(
        levels.map((l) => (l.id === id ? { ...l, elevation: parsed } : l))
      );
    }
  };

  const handleNameEdit = (id: string, name: string) => {
    if (!name.trim()) return;
    onUpdateLevels(
      levels.map((l) => (l.id === id ? { ...l, name: name.trim() } : l))
    );
  };

  const handleAddLevel = (e: React.FormEvent) => {
    e.preventDefault();
    const highest = sortedLevels[sortedLevels.length - 1]?.elevation ?? 0;
    const defaultElev = highest + 108; // +9'-0" above highest level
    const parsedElev = newElevationText.trim()
      ? parseLengthInput(newElevationText, units) ?? defaultElev
      : defaultElev;
    const name =
      newName.trim() || `Level ${levels.length + 1}`;
    const newId = `level-${Date.now()}`;
    const next = [...levels, { id: newId, name, elevation: parsedElev }];
    onUpdateLevels(next, newId);
    setNewName('');
    setNewElevationText('');
  };

  const handleDeleteLevel = (id: string) => {
    if (levels.length <= 1) return;
    const remaining = levels.filter((l) => l.id !== id);
    const nextActive =
      activeLevelId === id ? remaining[0].id : activeLevelId;
    onUpdateLevels(remaining, nextActive);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div
        className="w-full max-w-lg rounded-lg border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
          }}
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold">
                Building Levels & Elevations (LL)
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Each level has its own 2D plan; 3D view stacks all levels by elevation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="space-y-1.5">
            {sortedLevels
              .slice()
              .reverse()
              .map((lvl) => {
                const isActive = lvl.id === activeLevelId;
                return (
                  <div
                    key={lvl.id}
                    className={`flex items-center gap-2 p-2 rounded border transition-colors ${
                      isActive
                        ? 'border-amber-500/70 bg-amber-500/10'
                        : 'border-stone-500/20 hover:bg-stone-500/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectLevel(lvl.id)}
                      className={`px-2 py-1 rounded text-[11px] font-mono font-semibold transition-colors ${
                        isActive
                          ? 'bg-amber-600 text-white'
                          : 'border border-stone-500/30 hover:bg-stone-500/15'
                      }`}
                      title="Make this the active 2D plan level"
                    >
                      {isActive ? 'ACTIVE' : 'Switch'}
                    </button>

                    <input
                      type="text"
                      defaultValue={lvl.name}
                      onBlur={(e) => handleNameEdit(lvl.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleNameEdit(lvl.id, (e.target as HTMLInputElement).value);
                        }
                      }}
                      className="flex-1 min-w-0 px-2 py-1 rounded border text-xs font-medium bg-transparent"
                      style={{ borderColor: 'var(--border-main)' }}
                    />

                    <div className="flex items-center gap-1">
                      <span
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Elev:
                      </span>
                      <input
                        type="text"
                        key={`${lvl.id}-${lvl.elevation}-${units}`}
                        defaultValue={formatLength(lvl.elevation, units)}
                        onBlur={(e) => handleElevationEdit(lvl.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleElevationEdit(
                              lvl.id,
                              (e.target as HTMLInputElement).value
                            );
                          }
                        }}
                        className="w-24 px-2 py-1 rounded border text-xs font-mono text-right bg-transparent"
                        style={{ borderColor: 'var(--border-main)' }}
                      />
                    </div>

                    {levels.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteLevel(lvl.id)}
                        className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                        title="Delete level"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          <form
            onSubmit={handleAddLevel}
            className="pt-3 border-t flex items-center gap-2"
            style={{ borderColor: 'var(--border-main)' }}
          >
            <input
              type="text"
              placeholder="New level name (e.g. Level 3)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded border text-xs bg-transparent"
              style={{ borderColor: 'var(--border-main)' }}
            />
            <input
              type="text"
              placeholder={`Elev (e.g. 27'-0")`}
              value={newElevationText}
              onChange={(e) => setNewElevationText(e.target.value)}
              className="w-28 px-2.5 py-1.5 rounded border text-xs font-mono bg-transparent"
              style={{ borderColor: 'var(--border-main)' }}
            />
            <button
              type="submit"
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Story
            </button>
          </form>
        </div>

        <div
          className="px-4 py-2.5 border-t flex items-center justify-between text-[11px]"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
          }}
        >
          <span>Tip: Switch to 3D or Split view to see all levels stacked.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 2. VISIBILITY / GRAPHICS OVERRIDES MODAL (VV / VG) ---

interface VisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  visibility: VisibilitySettings;
  onUpdateVisibility: (next: VisibilitySettings) => void;
  tempHiddenCount: number;
  tempIsolatedCount: number;
  onResetTempHideIsolate: () => void;
  /** VIEW: opacity of the plan's background grid (0–1) */
  gridOpacity?: number;
  onGridOpacityChange?: (v: number) => void;
}

const CATEGORY_METADATA: Array<{
  key: VisibilityCategory;
  label: string;
  group: 'Model Categories' | 'Datum & Annotation';
}> = [
  { key: 'walls', label: 'Walls (WA)', group: 'Model Categories' },
  { key: 'doors', label: 'Doors (DR)', group: 'Model Categories' },
  { key: 'windows', label: 'Windows (WN)', group: 'Model Categories' },
  { key: 'floors', label: 'Floors / Slabs (SB)', group: 'Model Categories' },
  { key: 'roofs', label: 'Roofs (RF)', group: 'Model Categories' },
  { key: 'stairs', label: 'Stairs (ST)', group: 'Model Categories' },
  { key: 'columns', label: 'Columns (CL)', group: 'Model Categories' },
  { key: 'rooms', label: 'Rooms & Area Fill (RM)', group: 'Model Categories' },
  { key: 'furniture', label: 'Furniture & Components (CM)', group: 'Model Categories' },
  { key: 'lines', label: '2D Detail Lines & Shapes', group: 'Datum & Annotation' },
  { key: 'grids', label: 'Structural Grids (GR)', group: 'Datum & Annotation' },
  { key: 'annotations', label: 'Dimensions, Text & Tags', group: 'Datum & Annotation' },
];

export const VisibilityModal: React.FC<VisibilityModalProps> = ({
  isOpen,
  onClose,
  visibility,
  onUpdateVisibility,
  tempHiddenCount,
  tempIsolatedCount,
  onResetTempHideIsolate,
  gridOpacity,
  onGridOpacityChange,
}) => {
  if (!isOpen) return null;

  const toggleCategory = (view: 'plan2d' | 'view3d', cat: VisibilityCategory) => {
    onUpdateVisibility({
      ...visibility,
      [view]: {
        ...visibility[view],
        [cat]: !visibility[view][cat],
      },
    });
  };

  const setAll = (val: boolean) => {
    const nextMap = {} as Record<VisibilityCategory, boolean>;
    CATEGORY_METADATA.forEach((c) => {
      nextMap[c.key] = val;
    });
    onUpdateVisibility({
      plan2d: { ...nextMap },
      view3d: { ...nextMap },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div
        className="w-full max-w-xl rounded-lg border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
          }}
        >
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold">
                Visibility / Graphics Overrides (VV / VG)
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Show or hide element categories independently for 2D Plan and 3D views
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
          {onGridOpacityChange && (
            <label className="flex items-center gap-3 px-3 py-2 rounded border text-xs" style={{ borderColor: 'var(--border-main)' }} title="The grid always draws behind lines and fills">
              <span className="font-semibold whitespace-nowrap">Plan grid opacity</span>
              <input
                type="range"
                aria-label="Plan grid opacity"
                min={0}
                max={100}
                step={5}
                value={Math.round((gridOpacity ?? 1) * 100)}
                onChange={(e) => onGridOpacityChange(Number(e.target.value) / 100)}
                className="flex-1 accent-amber-500"
              />
              <span className="font-mono w-10 text-right">{Math.round((gridOpacity ?? 1) * 100)}%</span>
            </label>
          )}
          {(tempHiddenCount > 0 || tempIsolatedCount > 0) && (
            <div className="flex items-center justify-between px-3 py-2 rounded border border-amber-500/50 bg-amber-500/10 text-xs">
              <span>
                Temporary Hide/Isolate active ({tempIsolatedCount > 0 ? `${tempIsolatedCount} isolated` : `${tempHiddenCount} hidden`})
              </span>
              <button
                type="button"
                onClick={onResetTempHideIsolate}
                className="px-2.5 py-1 rounded bg-amber-600 text-white font-medium text-[11px]"
              >
                Reset (HR)
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs pb-1">
            <span style={{ color: 'var(--text-muted)' }}>
              Check or uncheck categories per viewport:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAll(true)}
                className="px-2 py-1 rounded border text-[11px] hover:bg-stone-500/10"
                style={{ borderColor: 'var(--border-main)' }}
              >
                Show All
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                className="px-2 py-1 rounded border text-[11px] hover:bg-stone-500/10"
                style={{ borderColor: 'var(--border-main)' }}
              >
                Hide All
              </button>
            </div>
          </div>

          <div
            className="rounded border overflow-hidden"
            style={{ borderColor: 'var(--border-main)' }}
          >
            <div
              className="grid grid-cols-12 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider border-b"
              style={{
                borderColor: 'var(--border-main)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
              }}
            >
              <div className="col-span-8">Category</div>
              <div className="col-span-2 text-center">2D Plan</div>
              <div className="col-span-2 text-center">3D View</div>
            </div>

            {CATEGORY_METADATA.map((item) => {
              const v2d = visibility.plan2d[item.key] !== false;
              const v3d = visibility.view3d[item.key] !== false;
              return (
                <div
                  key={item.key}
                  className="grid grid-cols-12 items-center px-3 py-2 text-xs border-b last:border-b-0 hover:bg-stone-500/5"
                  style={{ borderColor: 'var(--border-main)' }}
                >
                  <div className="col-span-8 flex items-center gap-2">
                    <span className="font-medium">{item.label}</span>
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      · {item.group}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <input
                      type="checkbox"
                      checked={v2d}
                      onChange={() => toggleCategory('plan2d', item.key)}
                      className="w-4 h-4 accent-amber-600 cursor-pointer"
                    />
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <input
                      type="checkbox"
                      checked={v3d}
                      onChange={() => toggleCategory('view3d', item.key)}
                      className="w-4 h-4 accent-amber-600 cursor-pointer"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="px-4 py-2.5 border-t flex items-center justify-between text-[11px]"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
          }}
        >
          <span>Shortcuts: HH = Hide Element · HI = Isolate · HR = Reset</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 3. WALL TYPE ASSEMBLY EDITOR MODAL ("Edit Type...") ---

interface WallTypeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallTypes: WallType[];
  initialWallTypeId: string;
  units: UnitSystem;
  onSaveWallType: (updatedType: WallType, isNew?: boolean) => void;
}

export const WallTypeEditorModal: React.FC<WallTypeEditorModalProps> = ({
  isOpen,
  onClose,
  wallTypes,
  initialWallTypeId,
  units,
  onSaveWallType,
}) => {
  const currentType =
    wallTypes.find((t) => t.id === initialWallTypeId) || wallTypes[0];

  const [selectedTypeId, setSelectedTypeId] = useState<string>(
    currentType?.id || 'wt-ext-2x6'
  );
  const [name, setName] = useState<string>(currentType?.name || 'Custom Wall');
  const [defaultHeight, setDefaultHeight] = useState<number>(
    currentType?.defaultHeight || 108
  );
  const [isGlass, setIsGlass] = useState<boolean>(
    Boolean(currentType?.isCurtainOrGlass)
  );
  const [layers, setLayers] = useState<WallAssemblyLayer[]>(
    currentType?.layers || []
  );

  React.useEffect(() => {
    const found =
      wallTypes.find((t) => t.id === initialWallTypeId) || wallTypes[0];
    if (found) {
      setSelectedTypeId(found.id);
      setName(found.name);
      setDefaultHeight(found.defaultHeight);
      setIsGlass(Boolean(found.isCurtainOrGlass));
      setLayers(found.layers.map((l) => ({ ...l })));
    }
  }, [initialWallTypeId, wallTypes, isOpen]);

  if (!isOpen || !currentType) return null;

  const handleSelectWallType = (id: string) => {
    const found = wallTypes.find((t) => t.id === id);
    if (!found) return;
    setSelectedTypeId(found.id);
    setName(found.name);
    setDefaultHeight(found.defaultHeight);
    setIsGlass(Boolean(found.isCurtainOrGlass));
    setLayers(found.layers.map((l) => ({ ...l })));
  };

  const totalThickness = getWallTypeTotalThickness({
    id: selectedTypeId,
    name,
    defaultHeight,
    layers,
  });

  const handleLayerChange = (
    idx: number,
    patch: Partial<WallAssemblyLayer>
  ) => {
    setLayers((prev) =>
      prev.map((lyr, i) => (i === idx ? { ...lyr, ...patch } : lyr))
    );
  };

  const handleAddLayer = () => {
    setLayers((prev) => [
      ...prev,
      {
        id: `lyr-${Date.now()}`,
        name: 'Gypsum 1/2"',
        function: 'finish2',
        thickness: 0.5,
        color: '#e7e5e4',
      },
    ]);
  };

  const handleRemoveLayer = (idx: number) => {
    if (layers.length <= 1) return;
    setLayers((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveLayer = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= layers.length) return;
    const copy = [...layers];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setLayers(copy);
  };

  const handleDuplicateType = () => {
    const newId = `wt-custom-${Date.now()}`;
    const dup: WallType = {
      id: newId,
      name: `${name} (Copy)`,
      defaultHeight,
      isCurtainOrGlass: isGlass,
      layers: layers.map((l, idx) => ({ ...l, id: `lyr-${Date.now()}-${idx}` })),
    };
    onSaveWallType(dup, true);
    setSelectedTypeId(newId);
    setName(dup.name);
  };

  const handleApply = () => {
    const updated: WallType = {
      id: selectedTypeId,
      name: name.trim() || 'Wall Type',
      defaultHeight: Math.max(12, defaultHeight),
      isCurtainOrGlass: isGlass,
      layers,
    };
    onSaveWallType(updated, false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div
        className="w-full max-w-2xl rounded-lg border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
          }}
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold">
                Revit Type Properties — Compound Wall Assembly
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Changes to a Wall Type automatically update all walls using this type
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Family / Type selector row */}
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-5">
              <label
                className="block text-[10px] font-semibold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Select Wall Type
              </label>
              <select
                value={selectedTypeId}
                onChange={(e) => handleSelectWallType(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-main)',
                }}
              >
                {wallTypes.map((wt) => (
                  <option key={wt.id} value={wt.id}>
                    {wt.name} ({formatLength(getWallTypeTotalThickness(wt), units)})
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-4">
              <label
                className="block text-[10px] font-semibold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Type Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border text-xs bg-transparent"
                style={{ borderColor: 'var(--border-main)' }}
              />
            </div>

            <div className="col-span-3 flex justify-end">
              <button
                type="button"
                onClick={handleDuplicateType}
                className="px-2.5 py-1.5 rounded border text-xs font-medium hover:bg-stone-500/10"
                style={{ borderColor: 'var(--border-main)' }}
              >
                Duplicate Type…
              </button>
            </div>
          </div>

          {/* Live Cross-Section Assembly Diagram */}
          <div
            className="p-3 rounded border"
            style={{
              borderColor: 'var(--border-main)',
              backgroundColor: 'var(--bg-elevated)',
            }}
          >
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Exterior Side (Top) → Interior Side (Bottom)
              </span>
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                Total Thickness: {formatLength(totalThickness, units)} ({totalThickness.toFixed(3)}")
              </span>
            </div>

            <div className="flex h-10 w-full rounded overflow-hidden border border-stone-500/40">
              {layers.map((lyr) => {
                const pct = Math.max(8, (lyr.thickness / Math.max(0.25, totalThickness)) * 100);
                return (
                  <div
                    key={lyr.id}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: lyr.color,
                    }}
                    className="h-full border-r last:border-r-0 border-stone-700/40 flex flex-col items-center justify-center px-1 overflow-hidden text-stone-900"
                    title={`${lyr.name}: ${lyr.thickness}"`}
                  >
                    <span className="text-[10px] font-semibold truncate max-w-full">
                      {lyr.name}
                    </span>
                    <span className="text-[9px] font-mono">
                      {lyr.thickness}"
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Compound Layers Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                Compound Structure Layers (Shown in 2D Plan when zoomed in)
              </span>
              <button
                type="button"
                onClick={handleAddLayer}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Layer
              </button>
            </div>

            <div
              className="rounded border overflow-hidden"
              style={{ borderColor: 'var(--border-main)' }}
            >
              <div
                className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b"
                style={{
                  borderColor: 'var(--border-main)',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-muted)',
                }}
              >
                <div className="col-span-4">Layer Material / Name</div>
                <div className="col-span-3">Function</div>
                <div className="col-span-2">Thickness (in)</div>
                <div className="col-span-1 text-center">Color</div>
                <div className="col-span-2 text-right">Order</div>
              </div>

              {layers.map((lyr, idx) => (
                <div
                  key={lyr.id}
                  className="grid grid-cols-12 gap-2 items-center px-3 py-1.5 text-xs border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-main)' }}
                >
                  <div className="col-span-4">
                    <input
                      type="text"
                      value={lyr.name}
                      onChange={(e) =>
                        handleLayerChange(idx, { name: e.target.value })
                      }
                      className="w-full px-2 py-1 rounded border text-xs bg-transparent"
                      style={{ borderColor: 'var(--border-main)' }}
                    />
                  </div>
                  <div className="col-span-3">
                    <select
                      value={lyr.function}
                      onChange={(e) =>
                        handleLayerChange(idx, {
                          function: e.target.value as WallAssemblyLayer['function'],
                        })
                      }
                      className="w-full px-1.5 py-1 rounded border text-xs"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-main)',
                      }}
                    >
                      <option value="finish1">Finish 1 (Ext)</option>
                      <option value="substrate">Substrate</option>
                      <option value="thermal">Thermal / Air</option>
                      <option value="structure">Structure [Core]</option>
                      <option value="finish2">Finish 2 (Int)</option>
                      <option value="glazing">Glazing / Curtain</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.125"
                      min="0.125"
                      value={lyr.thickness}
                      onChange={(e) =>
                        handleLayerChange(idx, {
                          thickness: Math.max(0.125, parseFloat(e.target.value) || 0.5),
                        })
                      }
                      className="w-full px-2 py-1 rounded border text-xs font-mono bg-transparent"
                      style={{ borderColor: 'var(--border-main)' }}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="color"
                      value={lyr.color}
                      onChange={(e) =>
                        handleLayerChange(idx, { color: e.target.value })
                      }
                      className="w-6 h-6 rounded border-0 cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveLayer(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-stone-500/15 disabled:opacity-30"
                      title="Move layer up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveLayer(idx, 1)}
                      disabled={idx === layers.length - 1}
                      className="p-1 rounded hover:bg-stone-500/15 disabled:opacity-30"
                      title="Move layer down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {layers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLayer(idx)}
                        className="p-1 rounded text-red-500 hover:bg-red-500/10"
                        title="Delete layer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={isGlass}
                onChange={(e) => setIsGlass(e.target.checked)}
                className="w-4 h-4 accent-amber-600"
              />
              <span>Render as Translucent Glazing / Glass Partition in 3D</span>
            </label>
          </div>
        </div>

        <div
          className="px-4 py-3 border-t flex items-center justify-between"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-elevated)',
          }}
        >
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            Computed Type Thickness: {formatLength(totalThickness, units)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border text-xs font-medium hover:bg-stone-500/10"
              style={{ borderColor: 'var(--border-main)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              <Check className="w-3.5 h-3.5" />
              Apply to Type & Instances
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
