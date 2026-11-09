import { RoofFacadeProperties } from './RoofFacadeProperties';
import { StructuralProperties, type StructuralAction } from './StructuralProperties';
import { CameraProperties } from './CameraViews';
import type { StructureJoinSettings } from '../types/model';
import { OpeningProperties } from './OpeningProperties';
import { StairPropertiesPanel } from './StairUI';
import { createStairFromTemplate, ensureStairRunsAndLandings } from '../engine/stairs';
import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Layers as LayersIcon,
  Sliders,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  ArchEntity,
  ColumnType,
  DoorSwing,
  DoorType,
  FloorType,
  Layer,
  LayerId,
  LevelDefinition,
  ProjectSettings,
  RoofStyle,
  UnitSystem,
  WallJustification,
  WallType,
  WindowType,
} from '../types/model';
import {
  computeStairParameters,
  dist,
  formatArea,
  formatLength,
  getWallTypeTotalThickness,
  parseLengthInput,
  polygonArea,
} from '../engine/geometry';

interface RightPanelProps {
  selectedEntities: ArchEntity[];
  allEntities: ArchEntity[];
  layers: Layer[];
  activeLayer: LayerId;
  levels?: LevelDefinition[];
  activeLevelId?: string;
  wallTypes?: WallType[];
  activeWallTypeId?: string;
  onChangeActiveWallType?: (wallTypeId: string) => void;
  onOpenWallTypeEditor?: (wallTypeId: string) => void;
  floorTypes?: FloorType[];
  onUpdateFloorType?: (updated: FloorType) => void;
  columnTypes?: ColumnType[];
  onUpdateColumnType?: (updated: ColumnType) => void;
  doorTypes?: DoorType[];
  onUpdateDoorType?: (updated: DoorType) => void;
  windowTypes?: WindowType[];
  onUpdateWindowType?: (updated: WindowType) => void;
  units: UnitSystem;
  settings: ProjectSettings;
  onUpdateEntity: (updated: ArchEntity, actionLabel: string) => void;
  onDeleteSelected: () => void;
  onSetActiveLayer: (id: LayerId) => void;
  onUpdateLayer: (updated: Layer) => void;
  onAddLayer: (name: string, color: string) => void;
  onUpdateSettings: (partial: Partial<ProjectSettings>) => void;
  layersExpanded: boolean;
  onToggleLayersExpanded: () => void;
  onOpenBlockEditor?: (blockId: string) => void;
  onExplodeSelected?: () => void;
  onOpenUniversalEditType?: (entity: ArchEntity) => void;
  structureJoins?: StructureJoinSettings;
  onStructuralAction?: (action: StructuralAction, entityId: string) => void;
  /** CAMERA: open a camera view; the Views list (thumbnails, walkthrough) rendered above Layers */
  onOpenCamera?: (id: string) => void;
  viewsSlot?: React.ReactNode;
  darkMode: boolean;
}

const LengthInput: React.FC<{
  label: string;
  inches: number;
  units: UnitSystem;
  onChange: (newInches: number) => void;
  darkMode: boolean;
}> = ({ label, inches, units, onChange, darkMode }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft !== null ? draft : formatLength(inches, units);

  const commit = () => {
    if (draft !== null) {
      const parsed = parseLengthInput(draft, units);
      if (parsed !== null && parsed >= 0) {
        onChange(parsed);
      }
      setDraft(null);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs text-stone-500 dark:text-stone-400">
        {label}
      </label>
      <input
        type="text"
        value={displayed}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
          }
        }}
        className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border focus:outline-none focus:border-amber-600 ${
          darkMode
            ? 'bg-stone-950 border-stone-700 text-stone-100'
            : 'bg-stone-50 border-stone-300 text-stone-900'
        }`}
      />
    </div>
  );
};

export const RightPanel: React.FC<RightPanelProps> = ({
  selectedEntities,
  allEntities,
  layers,
  activeLayer,
  levels = [],
  wallTypes = [],
  activeWallTypeId = 'wt-ext-2x6',
  onChangeActiveWallType,
  onOpenWallTypeEditor,
  floorTypes = [],
  onUpdateFloorType,
  columnTypes = [],
  onUpdateColumnType,
  doorTypes = [],
  onUpdateDoorType,
  windowTypes = [],
  onUpdateWindowType,
  units,
  settings,
  onUpdateEntity,
  onDeleteSelected,
  onSetActiveLayer,
  onUpdateLayer,
  onAddLayer,
  onUpdateSettings,
  layersExpanded,
  onToggleLayersExpanded,
  onOpenBlockEditor,
  onExplodeSelected,
  onOpenUniversalEditType,
  onOpenCamera,
  viewsSlot,
  structureJoins,
  onStructuralAction,
  darkMode,
}) => {
  const [showAdvancedProps, setShowAdvancedProps] = useState(false);
  const [editTypeInlineOpen, setEditTypeInlineOpen] = useState(false);
  const [showAddLayer, setShowAddLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerColor, setNewLayerColor] = useState('#0f766e');

  const single = selectedEntities.length === 1 ? selectedEntities[0] : null;

  return (
    <aside
      aria-label="Properties and Layers Panel"
      className={`w-68 sm:w-72 border-l flex flex-col overflow-y-auto select-none shrink-0 z-20 ${
        darkMode
          ? 'bg-stone-900 border-stone-800 text-stone-100'
          : 'bg-white border-stone-200 text-stone-900'
      }`}
    >
      {/* PROPERTIES SECTION */}
      <div className="p-4 border-b border-stone-200 dark:border-stone-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Properties (PR)
            </h2>
          </div>
          {selectedEntities.length > 0 && (
            <button
              type="button"
              onClick={onDeleteSelected}
              title="Delete Selected (E / DE / Del)"
              className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 font-medium cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          )}
        </div>

        {/* Empty selection: show Drawing Settings + Default Wall Type */}
        {selectedEntities.length === 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-stone-500 dark:text-stone-400">
              No object selected. Click any wall, door, floor, roof, stair, column, or line to edit Type &amp; Instance properties.
            </p>

            {wallTypes.length > 0 && (
              <div
                className={`p-2.5 rounded-lg border space-y-2 ${
                  darkMode
                    ? 'bg-stone-950/60 border-stone-800'
                    : 'bg-stone-50 border-stone-200/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Default Wall Type (WA)
                  </span>
                  {onOpenWallTypeEditor && (
                    <button
                      type="button"
                      onClick={() => onOpenWallTypeEditor(activeWallTypeId)}
                      className="text-[11px] font-semibold text-amber-600 hover:underline cursor-pointer"
                    >
                      Edit Type…
                    </button>
                  )}
                </div>
                <select
                  value={activeWallTypeId}
                  onChange={(e) =>
                    onChangeActiveWallType && onChangeActiveWallType(e.target.value)
                  }
                  className={`w-full px-2 py-1 text-xs font-medium rounded border ${
                    darkMode
                      ? 'bg-stone-900 border-stone-700 text-stone-100'
                      : 'bg-white border-stone-300 text-stone-900'
                  }`}
                >
                  {wallTypes.map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.name} ({formatLength(getWallTypeTotalThickness(wt), units)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              className={`p-3 rounded-lg border space-y-2.5 ${
                darkMode
                  ? 'bg-stone-950/50 border-stone-800'
                  : 'bg-stone-50 border-stone-200/80'
              }`}
            >
              <div className="text-[11px] font-semibold text-stone-400 uppercase">
                Drawing Defaults
              </div>

              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="active-layer-select"
                  className="text-xs text-stone-500 dark:text-stone-400"
                >
                  Current Layer
                </label>
                <select
                  id="active-layer-select"
                  value={activeLayer}
                  onChange={(e) => onSetActiveLayer(e.target.value)}
                  className={`w-32 px-2 py-1 text-xs font-mono rounded border focus:outline-none focus:border-amber-600 ${
                    darkMode
                      ? 'bg-stone-900 border-stone-700 text-stone-100'
                      : 'bg-white border-stone-300 text-stone-900'
                  }`}
                >
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <LengthInput
                label="Grid Spacing"
                inches={settings.gridSize}
                units={units}
                onChange={(val) =>
                  onUpdateSettings({ gridSize: Math.max(1, val) })
                }
                darkMode={darkMode}
              />

              <LengthInput
                label="Snap Increment"
                inches={settings.snapSize}
                units={units}
                onChange={(val) =>
                  onUpdateSettings({ snapSize: Math.max(0.5, val) })
                }
                darkMode={darkMode}
              />

              {/* More... toggle for advanced settings */}
              <button
                type="button"
                onClick={() => setShowAdvancedProps((v) => !v)}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 pt-1 cursor-pointer"
              >
                {showAdvancedProps ? (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Hide Advanced…</span>
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>More…</span>
                  </>
                )}
              </button>

              {showAdvancedProps && (
                <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      Alias "DI" Action
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          revitStyleDI: !settings.revitStyleDI,
                        })
                      }
                      className={`px-2 py-1 text-[11px] font-mono rounded border cursor-pointer ${
                        darkMode
                          ? 'bg-stone-900 border-stone-700 text-stone-200'
                          : 'bg-white border-stone-300 text-stone-800'
                      }`}
                    >
                      {settings.revitStyleDI
                        ? 'Revit (Dimension)'
                        : 'AutoCAD (Measure)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Multiple entities selected */}
        {selectedEntities.length > 1 && (
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-amber-600">
              {selectedEntities.length} Objects Selected
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Use Move (M), Copy (CO), Rotate (RO), or Delete (E) to modify the selection together.
            </p>
          </div>
        )}

        {/* Single entity selected */}
        {single && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                {single.type.toUpperCase()}
              </span>
              <span className="text-[11px] font-mono text-stone-400">
                #{single.id}
              </span>
            </div>

            {/* Universal Type Properties (Type vs Instance) */}
            <div
              className={`p-2.5 rounded-lg border space-y-1.5 ${
                darkMode
                  ? 'bg-stone-950/70 border-stone-800'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Type Properties
                </span>
                {onOpenUniversalEditType && (
                  <button
                    type="button"
                    onClick={() => onOpenUniversalEditType(single)}
                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-semibold cursor-pointer"
                    title="Edit Type Parameters (Duplicate, Rename, updates all instances)"
                  >
                    Edit Type…
                  </button>
                )}
              </div>
              <div className="text-xs font-semibold truncate text-stone-700 dark:text-stone-300">
                {(single as any).name ||
                  (single as any).wallTypeId ||
                  (single as any).windowTypeId ||
                  (single as any).doorTypeId ||
                  (single as any).customCategory ||
                  `${single.type} Standard`}
              </div>
            </div>

            {/* Layer Assignment */}
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="entity-layer-select"
                className="text-xs text-stone-500 dark:text-stone-400"
              >
                Layer
              </label>
              <select
                id="entity-layer-select"
                value={single.layer}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...single, layer: e.target.value },
                    'Change Layer'
                  )
                }
                className={`w-32 px-2 py-1 text-xs font-mono rounded border focus:outline-none focus:border-amber-600 ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              >
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Building Level Assignment (Instance Property) */}
            {levels.length > 0 && single.type !== 'grid' && (
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-stone-500 dark:text-stone-400">
                  Base Level
                </label>
                <select
                  value={single.levelId || 'level-1'}
                  onChange={(e) =>
                    onUpdateEntity(
                      { ...single, levelId: e.target.value },
                      'Change Element Level'
                    )
                  }
                  className={`w-32 px-2 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 ${
                    darkMode
                      ? 'bg-stone-950 border-stone-700 text-stone-100'
                      : 'bg-stone-50 border-stone-300 text-stone-900'
                  }`}
                >
                  {levels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name} ({formatLength(lvl.elevation, units)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* WALL PROPERTIES (Type vs Instance) */}
            {single.type === 'wall' && (
              <>
                {/* TYPE SELECTOR BOX */}
                {wallTypes.length > 0 && (
                  <div
                    className={`p-2.5 rounded-lg border space-y-2 ${
                      darkMode
                        ? 'bg-stone-950/70 border-stone-800'
                        : 'bg-stone-50 border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Type Selector
                      </span>
                      {onOpenWallTypeEditor && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenWallTypeEditor(
                              single.wallTypeId || wallTypes[0].id
                            )
                          }
                          className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-semibold cursor-pointer"
                          title="Edit Wall Type Assembly (changes all walls of this type)"
                        >
                          Edit Type…
                        </button>
                      )}
                    </div>

                    <select
                      value={single.wallTypeId || wallTypes[0].id}
                      onChange={(e) => {
                        const wt = wallTypes.find((t) => t.id === e.target.value);
                        if (!wt) return;
                        const totalT = getWallTypeTotalThickness(wt);
                        onUpdateEntity(
                          {
                            ...single,
                            wallTypeId: wt.id,
                            thickness: totalT,
                          },
                          `Set Wall Type: ${wt.name}`
                        );
                      }}
                      className={`w-full px-2 py-1 text-xs font-medium rounded border ${
                        darkMode
                          ? 'bg-stone-900 border-stone-700 text-stone-100'
                          : 'bg-white border-stone-300 text-stone-900'
                      }`}
                    >
                      {wallTypes.map((wt) => (
                        <option key={wt.id} value={wt.id}>
                          {wt.name} ({formatLength(getWallTypeTotalThickness(wt), units)})
                        </option>
                      ))}
                    </select>

                    {/* Compound Assembly Layers Summary */}
                    {(() => {
                      const wt = wallTypes.find(
                        (t) => t.id === (single.wallTypeId || wallTypes[0]?.id)
                      );
                      if (!wt) return null;
                      return (
                        <div className="space-y-1 pt-1 border-t border-stone-500/20">
                          <div className="flex items-center justify-between text-[10px] text-stone-400">
                            <span>Assembly Layers ({wt.layers.length})</span>
                            <span className="font-mono">
                              Total: {formatLength(getWallTypeTotalThickness(wt), units)}
                            </span>
                          </div>
                          {wt.layers.map((lyr) => (
                            <div
                              key={lyr.id}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span
                                  className="w-2.5 h-2.5 rounded-xs shrink-0 border border-stone-500/40"
                                  style={{ backgroundColor: lyr.color }}
                                />
                                <span className="truncate">{lyr.name}</span>
                              </div>
                              <span className="font-mono text-[10px] text-stone-400">
                                {lyr.thickness}"
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 pt-1">
                  Instance Properties
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Length
                  </span>
                  <span className="font-mono font-medium">
                    {formatLength(dist(single.start, single.end), units)}
                  </span>
                </div>

                <LengthInput
                  label="Thickness"
                  inches={single.thickness}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, thickness: Math.max(1, val) },
                      'Change Wall Thickness'
                    )
                  }
                  darkMode={darkMode}
                />

                <LengthInput
                  label="Unconnected Height"
                  inches={single.height}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, height: Math.max(12, val) },
                      'Change Wall Height'
                    )
                  }
                  darkMode={darkMode}
                />

                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Location Line
                  </label>
                  <select
                    value={single.justification}
                    onChange={(e) =>
                      onUpdateEntity(
                        {
                          ...single,
                          justification: e.target.value as WallJustification,
                        },
                        'Change Wall Justification'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  >
                    <option value="center">Centerline</option>
                    <option value="interior">Interior</option>
                    <option value="exterior">Exterior</option>
                  </select>
                </div>

                <LengthInput
                  label="Base Offset"
                  inches={single.baseOffset}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, baseOffset: val },
                      'Change Wall Base Offset'
                    )
                  }
                  darkMode={darkMode}
                />
              </>
            )}

            {/* DOORS / WINDOWS / WALL OPENINGS: type properties (all of this type) vs instance properties */}
            {(single.type === 'door' || single.type === 'window' || single.type === 'wallopening') && (
              <OpeningProperties
                entity={single}
                allEntities={allEntities}
                doorTypes={doorTypes}
                windowTypes={windowTypes}
                units={units}
                darkMode={darkMode}
                onUpdateEntity={onUpdateEntity}
                onUpdateDoorType={onUpdateDoorType}
                onUpdateWindowType={onUpdateWindowType}
              />
            )}

            {/* ROOM PROPERTIES */}
            {single.type === 'room' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="room-name-input"
                    className="text-xs text-stone-500 dark:text-stone-400"
                  >
                    Room Name
                  </label>
                  <input
                    id="room-name-input"
                    type="text"
                    value={single.name}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, name: e.target.value },
                        'Rename Room'
                      )
                    }
                    className={`w-32 px-2 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Computed Area
                  </span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatArea(polygonArea(single.polygon), units)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Floor Finish
                  </label>
                  <select
                    value={single.floorMaterial ?? 'wood'}
                    onChange={(e) =>
                      onUpdateEntity(
                        {
                          ...single,
                          floorMaterial: e.target.value as
                            | 'wood'
                            | 'tile'
                            | 'concrete'
                            | 'stone',
                        },
                        'Change Room Finish'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  >
                    <option value="wood">Oak Wood</option>
                    <option value="stone">Travertine</option>
                    <option value="tile">Ceramic Tile</option>
                    <option value="concrete">Concrete</option>
                  </select>
                </div>
              </>
            )}

            {/* LINE PROPERTIES */}
            {single.type === 'line' && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-stone-500 dark:text-stone-400">
                  Length
                </span>
                <span className="font-mono font-medium">
                  {formatLength(dist(single.start, single.end), units)}
                </span>
              </div>
            )}

            {/* CIRCLE / ARC PROPERTIES */}
            {(single.type === 'circle' || single.type === 'arc') && (
              <LengthInput
                label="Radius"
                inches={single.radius}
                units={units}
                onChange={(val) =>
                  onUpdateEntity(
                    { ...single, radius: Math.max(1, val) },
                    'Change Radius'
                  )
                }
                darkMode={darkMode}
              />
            )}

            {/* RECTANGLE PROPERTIES */}
            {single.type === 'rectangle' && (
              <>
                <LengthInput
                  label="Width"
                  inches={Math.abs(single.p2.x - single.p1.x)}
                  units={units}
                  onChange={(val) => {
                    const sign = single.p2.x >= single.p1.x ? 1 : -1;
                    onUpdateEntity(
                      {
                        ...single,
                        p2: {
                          x: single.p1.x + sign * Math.max(1, val),
                          y: single.p2.y,
                        },
                      },
                      'Change Rectangle Width'
                    );
                  }}
                  darkMode={darkMode}
                />
                <LengthInput
                  label="Depth"
                  inches={Math.abs(single.p2.y - single.p1.y)}
                  units={units}
                  onChange={(val) => {
                    const sign = single.p2.y >= single.p1.y ? 1 : -1;
                    onUpdateEntity(
                      {
                        ...single,
                        p2: {
                          x: single.p2.x,
                          y: single.p1.y + sign * Math.max(1, val),
                        },
                      },
                      'Change Rectangle Depth'
                    );
                  }}
                  darkMode={darkMode}
                />
              </>
            )}

            {/* TEXT PROPERTIES */}
            {single.type === 'text' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Text Content (MText)
                  </label>
                  <textarea
                    rows={2}
                    value={single.text}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, text: e.target.value },
                        'Edit Text'
                      )
                    }
                    className={`w-full px-2 py-1 text-xs font-sans rounded border focus:outline-none focus:border-amber-600 ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <LengthInput
                  label="Text Height"
                  inches={single.fontSize}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, fontSize: Math.max(2, val) },
                      'Change Text Size'
                    )
                  }
                  darkMode={darkMode}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Rotation (°)
                  </label>
                  <input
                    type="number"
                    value={single.rotation}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, rotation: parseFloat(e.target.value) || 0 },
                        'Change Text Rotation'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Alignment
                  </label>
                  <div className="flex items-center gap-1">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        onClick={() =>
                          onUpdateEntity(
                            { ...single, alignment: align },
                            'Change Text Alignment'
                          )
                        }
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border capitalize cursor-pointer transition-colors ${
                          (single.alignment ?? 'left') === align
                            ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                            : darkMode
                            ? 'border-stone-800 hover:bg-stone-800 text-stone-400'
                            : 'border-stone-200 hover:bg-stone-100 text-stone-600'
                        }`}
                      >
                        {align}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* LEADER PROPERTIES */}
            {single.type === 'leader' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Leader Note
                  </label>
                  <textarea
                    rows={2}
                    value={single.text}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, text: e.target.value },
                        'Edit Leader Note'
                      )
                    }
                    className={`w-full px-2 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <LengthInput
                  label="Text Height"
                  inches={single.fontSize}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, fontSize: Math.max(2, val) },
                      'Change Leader Font Size'
                    )
                  }
                  darkMode={darkMode}
                />
              </>
            )}

            {/* HATCH PROPERTIES */}
            {single.type === 'hatch' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Pattern
                  </label>
                  <select
                    value={single.pattern}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, pattern: e.target.value as any },
                        'Change Hatch Pattern'
                      )
                    }
                    className={`w-32 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  >
                    <option value="solid">Solid Fill</option>
                    <option value="diagonal">Diagonal Lines</option>
                    <option value="crosshatch">Crosshatch</option>
                    <option value="brick">Brick Masonry</option>
                    <option value="concrete">Concrete Aggregate</option>
                    <option value="insulation">Batt Insulation</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Pattern Scale
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="10"
                    value={single.scale}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, scale: Math.max(0.2, parseFloat(e.target.value) || 1) },
                        'Change Hatch Scale'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Pattern Angle (°)
                  </label>
                  <input
                    type="number"
                    step="15"
                    value={single.angle}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, angle: parseFloat(e.target.value) || 0 },
                        'Change Hatch Angle'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
              </>
            )}

            {/* TAG PROPERTIES */}
            {single.type === 'tag' && (
              <>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Category
                  </span>
                  <span className="font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    {single.targetType} Tag
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Tag Number
                  </label>
                  <input
                    type="text"
                    value={single.tagNumber}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, tagNumber: e.target.value },
                        'Edit Tag Number'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-center font-bold rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Label
                  </label>
                  <input
                    type="text"
                    value={single.label}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, label: e.target.value },
                        'Edit Tag Label'
                      )
                    }
                    className={`w-32 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Tag Shape
                  </label>
                  <select
                    value={single.shape}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, shape: e.target.value as any },
                        'Change Tag Shape'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  >
                    <option value="pill">Pill / Oval</option>
                    <option value="hexagon">Hexagon</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                </div>
              </>
            )}

            {/* DIMENSION PROPERTIES */}
            {single.type === 'dimension' && (
              <>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Dimension Type
                  </span>
                  <span className="font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    {single.dimType ?? 'aligned'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Measured
                  </span>
                  <span className="font-mono font-semibold">
                    {single.dimType === 'angular'
                      ? `${(single.sweepAngle ?? 45).toFixed(1)}°`
                      : single.dimType === 'linear'
                      ? formatLength(
                          single.linearOrientation === 'horizontal'
                            ? Math.abs(single.p2.x - single.p1.x)
                            : Math.abs(single.p2.y - single.p1.y),
                          units
                        )
                      : formatLength(dist(single.p1, single.p2), units)}
                  </span>
                </div>
                {single.dimType === 'linear' && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-stone-500 dark:text-stone-400">
                      Orientation
                    </label>
                    <select
                      value={single.linearOrientation ?? 'horizontal'}
                      onChange={(e) =>
                        onUpdateEntity(
                          { ...single, linearOrientation: e.target.value as any },
                          'Change Linear Dimension Orientation'
                        )
                      }
                      className={`w-28 px-2 py-1 text-xs rounded border ${
                        darkMode
                          ? 'bg-stone-950 border-stone-700 text-stone-100'
                          : 'bg-stone-50 border-stone-300 text-stone-900'
                      }`}
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Text Override
                  </label>
                  <input
                    type="text"
                    placeholder="Auto"
                    value={single.textOverride ?? ''}
                    onChange={(e) =>
                      onUpdateEntity(
                        {
                          ...single,
                          textOverride: e.target.value || undefined,
                        },
                        'Change Dimension Override'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
              </>
            )}

            {/* BLOCK / COMPONENT PROPERTIES */}
            {single.type === 'block' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Name
                  </label>
                  <input
                    type="text"
                    value={single.name}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, name: e.target.value },
                        'Rename Component'
                      )
                    }
                    className={`w-32 px-2 py-1 text-xs font-medium rounded border focus:outline-none focus:border-amber-600 ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>

                <LengthInput
                  label="Width"
                  inches={single.width}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, width: Math.max(4, val) },
                      'Change Component Width'
                    )
                  }
                  darkMode={darkMode}
                />

                <LengthInput
                  label="Depth"
                  inches={single.depth}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, depth: Math.max(4, val) },
                      'Change Component Depth'
                    )
                  }
                  darkMode={darkMode}
                />

                <LengthInput
                  label="Height (3D)"
                  inches={single.height}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, height: Math.max(2, val) },
                      'Change Component Height'
                    )
                  }
                  darkMode={darkMode}
                />

                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Material Color
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={single.color || '#0d9488'}
                      onChange={(e) =>
                        onUpdateEntity(
                          { ...single, color: e.target.value },
                          'Change Component Color'
                        )
                      }
                      aria-label="Component Material Color"
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-[11px] font-mono text-stone-400">
                      {single.color}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Rotation (°)
                  </label>
                  <input
                    type="number"
                    step="15"
                    value={single.rotation}
                    onChange={(e) =>
                      onUpdateEntity(
                        {
                          ...single,
                          rotation: parseFloat(e.target.value) || 0,
                        },
                        'Change Component Rotation'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Scale
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="10"
                    value={single.scale}
                    onChange={(e) =>
                      onUpdateEntity(
                        {
                          ...single,
                          scale: Math.max(
                            0.1,
                            parseFloat(e.target.value) || 1
                          ),
                        },
                        'Change Component Scale'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>

                <div className="pt-2 border-t border-stone-200 dark:border-stone-800 grid grid-cols-2 gap-1.5">
                  {onOpenBlockEditor && (
                    <button
                      type="button"
                      onClick={() => onOpenBlockEditor(single.blockId)}
                      className={`px-2 py-1.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                        darkMode
                          ? 'bg-stone-950 border-stone-700 hover:border-amber-500 text-amber-400'
                          : 'bg-stone-50 border-stone-300 hover:border-amber-600 text-amber-700'
                      }`}
                      title="Edit Block Definition (BE / BEDIT) — updates all instances"
                    >
                      Edit Block (BE)
                    </button>
                  )}
                  {onExplodeSelected && (
                    <button
                      type="button"
                      onClick={onExplodeSelected}
                      className={`px-2 py-1.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                        darkMode
                          ? 'bg-stone-950 border-stone-700 hover:border-amber-500 text-stone-300'
                          : 'bg-stone-50 border-stone-300 hover:border-amber-600 text-stone-700'
                      }`}
                      title="Explode Block (X / EXPLODE) into individual 2D primitives"
                    >
                      Explode (X)
                    </button>
                  )}
                </div>
              </>
            )}

            {/* FLOOR SLAB PROPERTIES (SB) */}
            {single.type === 'floor' && (
              <>
                {floorTypes.length > 0 && (
                  <div
                    className={`p-2.5 rounded-lg border space-y-2 ${
                      darkMode
                        ? 'bg-stone-950/70 border-stone-800'
                        : 'bg-stone-50 border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Floor Type
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditTypeInlineOpen((v) => !v)}
                        className="text-[10px] font-semibold text-amber-600 hover:underline cursor-pointer"
                      >
                        {editTypeInlineOpen ? 'Close Type' : 'Edit Type…'}
                      </button>
                    </div>
                    <select
                      value={single.floorTypeId || floorTypes[0].id}
                      onChange={(e) => {
                        const ft = floorTypes.find((t) => t.id === e.target.value);
                        if (!ft) return;
                        onUpdateEntity(
                          {
                            ...single,
                            floorTypeId: ft.id,
                            thickness: ft.thickness,
                            material: ft.material,
                          },
                          `Set Floor Type: ${ft.name}`
                        );
                      }}
                      className={`w-full px-2 py-1 text-xs font-medium rounded border ${
                        darkMode
                          ? 'bg-stone-900 border-stone-700 text-stone-100'
                          : 'bg-white border-stone-300 text-stone-900'
                      }`}
                    >
                      {floorTypes.map((ft) => (
                        <option key={ft.id} value={ft.id}>
                          {ft.name}
                        </option>
                      ))}
                    </select>

                    {editTypeInlineOpen && onUpdateFloorType && (() => {
                      const ft =
                        floorTypes.find(
                          (t) => t.id === (single.floorTypeId || floorTypes[0].id)
                        ) || floorTypes[0];
                      return (
                        <div className="pt-2 border-t border-stone-500/20 space-y-2">
                          <div className="text-[10px] text-amber-600 font-semibold">
                            Type Properties (Updates all {ft.name} floors)
                          </div>
                          <LengthInput
                            label="Type Thickness"
                            inches={ft.thickness}
                            units={units}
                            onChange={(val) =>
                              onUpdateFloorType({
                                ...ft,
                                thickness: Math.max(2, val),
                              })
                            }
                            darkMode={darkMode}
                          />
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Slab Area
                  </span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatArea(polygonArea(single.polygon), units)}
                  </span>
                </div>

                <LengthInput
                  label="Slab Thickness"
                  inches={single.thickness}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, thickness: Math.max(1, val) },
                      'Change Floor Thickness'
                    )
                  }
                  darkMode={darkMode}
                />

                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Finish Material
                  </label>
                  <select
                    value={single.material}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, material: e.target.value as any },
                        'Change Floor Material'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  >
                    <option value="concrete">Concrete</option>
                    <option value="wood">Hardwood</option>
                    <option value="stone">Stone Paver</option>
                    <option value="tile">Ceramic Tile</option>
                  </select>
                </div>
              </>
            )}

            {/* ROOF PROPERTIES (RF) */}
            {(single.type === 'roof' ||
              single.type === 'skylight' ||
              single.type === 'dormer' ||
              single.type === 'sweep' ||
              single.type === 'balcony' ||
              single.type === 'railing' ||
              single.type === 'wall') && (
              <RoofFacadeProperties
                entity={single}
                allEntities={allEntities}
                levels={levels}
                units={units}
                darkMode={darkMode}
                onUpdateEntity={onUpdateEntity}
              />
            )}

            {/* CAMERA (CAM) */}
            {single.type === 'camera' && (
              <CameraProperties cam={single} units={units} darkMode={darkMode} onUpdate={(next, label) => onUpdateEntity(next, label)} onOpen={onOpenCamera} />
            )}

            {/* STRUCTURE (columns, footings, beams, rebar, joints, loads, sections; structural extras of walls / slabs / openings) */}
            {['column', 'footing', 'beam', 'beamsystem', 'rebar', 'areareinf', 'connection', 'sjoint', 'load', 'section', 'truss', 'wall', 'floor', 'door', 'window', 'wallopening'].includes(single.type) && (
              <StructuralProperties
                entity={single}
                model={{ entities: allEntities, levels, settings, structureJoins }}
                levels={levels}
                units={units}
                darkMode={darkMode}
                onUpdateEntity={onUpdateEntity}
                onAction={(a, id) => onStructuralAction?.(a, id)}
              />
            )}

            {/* STAIR PROPERTIES (ST) */}
            {single.type === 'stair' && (
              <>
                {levels.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-stone-500 dark:text-stone-400">
                        Base Level
                      </label>
                      <select
                        value={single.baseLevelId}
                        onChange={(e) => {
                          const baseLvl = levels.find((l) => l.id === e.target.value);
                          const topLvl = levels.find((l) => l.id === single.topLevelId);
                          const { runs, landings } = ensureStairRunsAndLandings(single, levels);
                          const rebuilt = createStairFromTemplate({
                            id: single.id,
                            origin: runs[0]?.start ?? single.start,
                            direction:
                              runs[0]
                                ? { x: runs[0].end.x - runs[0].start.x, y: runs[0].end.y - runs[0].start.y }
                                : { x: 1, y: 0 },
                            baseLevelId: e.target.value,
                            topLevelId: single.topLevelId,
                            baseElevation: baseLvl?.elevation ?? 0,
                            topElevation: topLvl?.elevation ?? 120,
                            baseOffset: single.baseOffset,
                            topOffset: single.topOffset,
                            width: single.width,
                            treadDepth: single.treadDepth,
                            maxRiserHeight: single.maxRiserHeight ?? 7.5,
                            shape: single.shape ?? (runs.length > 1 ? 'l-left' : 'straight'),
                            landingDepth: landings[0]?.depth ?? single.width,
                            landingWidth: landings[0]?.width,
                            wellGap: single.wellGap ?? 6,
                            cornerRadius: landings[0]?.cornerRadius,
                            intermediateStep: landings[0]?.intermediateStep,
                            constructionStyle: single.constructionStyle,
                            landingStructure: single.landingStructure,
                            landingThickness: single.landingThickness,
                            supportPosts: single.supportPosts,
                            railingStyle: single.railingStyle,
                            railingSide: single.railingSide,
                            cutFloorAbove: single.cutFloorAbove,
                            layer: single.layer,
                          });
                          onUpdateEntity(rebuilt, 'Change Stair Base Level');
                        }}
                        className={`w-32 px-2 py-1 text-xs rounded border ${
                          darkMode
                            ? 'bg-stone-950 border-stone-700 text-stone-100'
                            : 'bg-stone-50 border-stone-300 text-stone-900'
                        }`}
                      >
                        {levels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-stone-500 dark:text-stone-400">
                        Top Level
                      </label>
                      <select
                        value={single.topLevelId}
                        onChange={(e) => {
                          const baseLvl = levels.find((l) => l.id === single.baseLevelId);
                          const topLvl = levels.find((l) => l.id === e.target.value);
                          const { runs, landings } = ensureStairRunsAndLandings(single, levels);
                          const rebuilt = createStairFromTemplate({
                            id: single.id,
                            origin: runs[0]?.start ?? single.start,
                            direction:
                              runs[0]
                                ? { x: runs[0].end.x - runs[0].start.x, y: runs[0].end.y - runs[0].start.y }
                                : { x: 1, y: 0 },
                            baseLevelId: single.baseLevelId,
                            topLevelId: e.target.value,
                            baseElevation: baseLvl?.elevation ?? 0,
                            topElevation: topLvl?.elevation ?? 120,
                            baseOffset: single.baseOffset,
                            topOffset: single.topOffset,
                            width: single.width,
                            treadDepth: single.treadDepth,
                            maxRiserHeight: single.maxRiserHeight ?? 7.5,
                            shape: single.shape ?? (runs.length > 1 ? 'l-left' : 'straight'),
                            landingDepth: landings[0]?.depth ?? single.width,
                            landingWidth: landings[0]?.width,
                            wellGap: single.wellGap ?? 6,
                            cornerRadius: landings[0]?.cornerRadius,
                            intermediateStep: landings[0]?.intermediateStep,
                            constructionStyle: single.constructionStyle,
                            landingStructure: single.landingStructure,
                            landingThickness: single.landingThickness,
                            supportPosts: single.supportPosts,
                            railingStyle: single.railingStyle,
                            railingSide: single.railingSide,
                            cutFloorAbove: single.cutFloorAbove,
                            layer: single.layer,
                          });
                          onUpdateEntity(rebuilt, 'Change Stair Top Level');
                        }}
                        className={`w-32 px-2 py-1 text-xs rounded border ${
                          darkMode
                            ? 'bg-stone-950 border-stone-700 text-stone-100'
                            : 'bg-stone-50 border-stone-300 text-stone-900'
                        }`}
                      >
                        {levels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="p-2 rounded border border-amber-500/30 bg-amber-500/5 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-stone-500 dark:text-stone-400">
                      Auto Risers:
                    </span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {single.numRisers} Risers @ {single.riserHeight.toFixed(2)}&quot;
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500 dark:text-stone-400">
                      Run Length:
                    </span>
                    <span className="font-mono">
                      {formatLength(dist(single.start, single.end), units)}
                    </span>
                  </div>
                </div>

                <LengthInput
                  label="Run Width"
                  inches={single.width}
                  units={units}
                  onChange={(val) => {
                    const nextW = Math.max(24, val);
                    const { runs, landings, baseElevation, topElevation } = ensureStairRunsAndLandings(single, levels);
                    const rebuilt = createStairFromTemplate({
                      id: single.id,
                      origin: runs[0]?.start ?? single.start,
                      direction:
                        runs[0]
                          ? { x: runs[0].end.x - runs[0].start.x, y: runs[0].end.y - runs[0].start.y }
                          : { x: 1, y: 0 },
                      baseLevelId: single.baseLevelId,
                      topLevelId: single.topLevelId,
                      baseElevation,
                      topElevation,
                      width: nextW,
                      treadDepth: single.treadDepth,
                      desiredRisers: single.numRisers,
                      shape: single.shape ?? (runs.length > 1 ? 'l-left' : 'straight'),
                      splitRiser: landings[0]?.afterRiser,
                      landingDepth: Math.max(nextW, landings[0]?.depth ?? nextW),
                      landingWidth: landings[0]?.width,
                      wellGap: single.wellGap ?? 6,
                      cornerRadius: landings[0]?.cornerRadius,
                      intermediateStep: landings[0]?.intermediateStep,
                      constructionStyle: single.constructionStyle,
                      landingStructure: single.landingStructure,
                      landingThickness: single.landingThickness,
                      supportPosts: single.supportPosts,
                      railingStyle: single.railingStyle,
                      railingSide: single.railingSide,
                      cutFloorAbove: single.cutFloorAbove,
                      layer: single.layer,
                    });
                    onUpdateEntity(rebuilt, 'Change Stair Width');
                  }}
                  darkMode={darkMode}
                />

                <LengthInput
                  label="Tread Depth"
                  inches={single.treadDepth}
                  units={units}
                  onChange={(val) => {
                    const nextTd = Math.max(9, val);
                    const { runs, landings, baseElevation, topElevation } = ensureStairRunsAndLandings(single, levels);
                    const rebuilt = createStairFromTemplate({
                      id: single.id,
                      origin: runs[0]?.start ?? single.start,
                      direction:
                        runs[0]
                          ? { x: runs[0].end.x - runs[0].start.x, y: runs[0].end.y - runs[0].start.y }
                          : { x: 1, y: 0 },
                      baseLevelId: single.baseLevelId,
                      topLevelId: single.topLevelId,
                      baseElevation,
                      topElevation,
                      width: single.width,
                      treadDepth: nextTd,
                      desiredRisers: single.numRisers,
                      shape: single.shape ?? (runs.length > 1 ? 'l-left' : 'straight'),
                      splitRiser: landings[0]?.afterRiser,
                      landingDepth: landings[0]?.depth ?? single.width,
                      landingWidth: landings[0]?.width,
                      wellGap: single.wellGap ?? 6,
                      cornerRadius: landings[0]?.cornerRadius,
                      intermediateStep: landings[0]?.intermediateStep,
                      constructionStyle: single.constructionStyle,
                      landingStructure: single.landingStructure,
                      landingThickness: single.landingThickness,
                      supportPosts: single.supportPosts,
                      railingStyle: single.railingStyle,
                      railingSide: single.railingSide,
                      cutFloorAbove: single.cutFloorAbove,
                      layer: single.layer,
                    });
                    onUpdateEntity(rebuilt, 'Change Stair Tread Depth');
                  }}
                  darkMode={darkMode}
                />

                <StairPropertiesPanel
                  stair={single}
                  levels={levels}
                  units={units}
                  onUpdateStair={(updated) => onUpdateEntity(updated, 'Update Stair & Landing')}
                />
              </>
            )}

            {/* COLUMN PROPERTIES (CL - Type vs Instance) */}
            {single.type === 'column' && (
              <>
                {columnTypes.length > 0 && (
                  <div
                    className={`p-2.5 rounded-lg border space-y-2 ${
                      darkMode
                        ? 'bg-stone-950/70 border-stone-800'
                        : 'bg-stone-50 border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Column Type
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditTypeInlineOpen((v) => !v)}
                        className="text-[10px] font-semibold text-amber-600 hover:underline cursor-pointer"
                      >
                        {editTypeInlineOpen ? 'Close Type' : 'Edit Type…'}
                      </button>
                    </div>
                    <select
                      value={single.columnTypeId || columnTypes[0].id}
                      onChange={(e) => {
                        const ct = columnTypes.find((t) => t.id === e.target.value);
                        if (!ct) return;
                        onUpdateEntity(
                          {
                            ...single,
                            columnTypeId: ct.id,
                            shape: ct.shape,
                            width: ct.width,
                            depth: ct.depth,
                            color: ct.color,
                          },
                          `Set Column Type: ${ct.name}`
                        );
                      }}
                      className={`w-full px-2 py-1 text-xs font-medium rounded border ${
                        darkMode
                          ? 'bg-stone-900 border-stone-700 text-stone-100'
                          : 'bg-white border-stone-300 text-stone-900'
                      }`}
                    >
                      {columnTypes.map((ct) => (
                        <option key={ct.id} value={ct.id}>
                          {ct.name}
                        </option>
                      ))}
                    </select>

                    {editTypeInlineOpen && onUpdateColumnType && (() => {
                      const ct =
                        columnTypes.find(
                          (t) => t.id === (single.columnTypeId || columnTypes[0].id)
                        ) || columnTypes[0];
                      return (
                        <div className="pt-2 border-t border-stone-500/20 space-y-2">
                          <div className="text-[10px] text-amber-600 font-semibold">
                            Type Size (Updates all {ct.name} columns)
                          </div>
                          <LengthInput
                            label={ct.shape === 'round' ? 'Diameter' : 'Type Width'}
                            inches={ct.width}
                            units={units}
                            onChange={(val) =>
                              onUpdateColumnType({
                                ...ct,
                                width: Math.max(4, val),
                                depth:
                                  ct.shape === 'round' ? Math.max(4, val) : ct.depth,
                              })
                            }
                            darkMode={darkMode}
                          />
                          {ct.shape === 'rectangular' && (
                            <LengthInput
                              label="Type Depth"
                              inches={ct.depth}
                              units={units}
                              onChange={(val) =>
                                onUpdateColumnType({
                                  ...ct,
                                  depth: Math.max(4, val),
                                })
                              }
                              darkMode={darkMode}
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 pt-1">
                  Instance Properties
                </div>
                <LengthInput
                  label={single.shape === 'round' ? 'Diameter' : 'Width'}
                  inches={single.width}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      {
                        ...single,
                        width: Math.max(4, val),
                        depth: single.shape === 'round' ? Math.max(4, val) : single.depth,
                      },
                      'Change Column Width'
                    )
                  }
                  darkMode={darkMode}
                />
                {single.shape === 'rectangular' && (
                  <LengthInput
                    label="Depth"
                    inches={single.depth}
                    units={units}
                    onChange={(val) =>
                      onUpdateEntity(
                        { ...single, depth: Math.max(4, val) },
                        'Change Column Depth'
                      )
                    }
                    darkMode={darkMode}
                  />
                )}
                <LengthInput
                  label="Height (3D)"
                  inches={single.height}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, height: Math.max(12, val) },
                      'Change Column Height'
                    )
                  }
                  darkMode={darkMode}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Rotation (°)
                  </label>
                  <input
                    type="number"
                    step="15"
                    value={single.rotation}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, rotation: parseFloat(e.target.value) || 0 },
                        'Rotate Column'
                      )
                    }
                    className={`w-28 px-2 py-1 text-xs font-mono text-right rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
              </>
            )}

            {/* GRID PROPERTIES (GR) */}
            {single.type === 'grid' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-stone-500 dark:text-stone-400">
                    Bubble Label
                  </label>
                  <input
                    type="text"
                    value={single.label}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, label: e.target.value.toUpperCase() },
                        'Rename Grid Line'
                      )
                    }
                    className={`w-24 px-2 py-1 text-xs font-mono font-bold text-center rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-stone-50 border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Show Start Bubble
                  </span>
                  <input
                    type="checkbox"
                    checked={single.showBubbleStart !== false}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, showBubbleStart: e.target.checked },
                        'Toggle Grid Bubble'
                      )
                    }
                    className="w-4 h-4 accent-amber-600"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    Show End Bubble
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(single.showBubbleEnd)}
                    onChange={(e) =>
                      onUpdateEntity(
                        { ...single, showBubbleEnd: e.target.checked },
                        'Toggle Grid End Bubble'
                      )
                    }
                    className="w-4 h-4 accent-amber-600"
                  />
                </div>
              </>
            )}

            {/* CUSTOM / REGISTERED ELEMENT PROPERTIES (e.g. TestBox) */}
            {single.type === 'custom' && (
              <>
                {/* Instance Parameter: testParam (required by Acceptance Check 1!) */}
                {single.customCategory === 'test-box' && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Test Parameter
                    </label>
                    <input
                      type="text"
                      value={single.testParam || ''}
                      onChange={(e) =>
                        onUpdateEntity(
                          { ...single, testParam: e.target.value },
                          'Edit TestBox Parameter'
                        )
                      }
                      className={`w-32 px-2 py-1 text-xs font-medium rounded border focus:outline-none focus:border-amber-600 ${
                        darkMode
                          ? 'bg-stone-950 border-stone-700 text-stone-100'
                          : 'bg-stone-50 border-stone-300 text-stone-900'
                      }`}
                    />
                  </div>
                )}

                <LengthInput
                  label="Width"
                  inches={single.width || 36}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, width: Math.max(6, val) },
                      'Change Width'
                    )
                  }
                  darkMode={darkMode}
                />

                <LengthInput
                  label="Height (3D)"
                  inches={single.height || 48}
                  units={units}
                  onChange={(val) =>
                    onUpdateEntity(
                      { ...single, height: Math.max(6, val) },
                      'Change Height'
                    )
                  }
                  darkMode={darkMode}
                />
              </>
            )}
          </div>
        )}
      </div>

      {viewsSlot}

      {/* COLLAPSIBLE LAYERS SECTION */}
      <div className="flex-1 flex flex-col min-h-0">
        <button
          type="button"
          onClick={onToggleLayersExpanded}
          aria-expanded={layersExpanded}
          className={`px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider border-b transition-colors cursor-pointer ${
            darkMode
              ? 'border-stone-800 hover:bg-stone-800/60'
              : 'border-stone-200 hover:bg-stone-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <LayersIcon className="w-4 h-4 text-amber-600" />
            <span>Layers (LA)</span>
          </div>
          {layersExpanded ? (
            <ChevronDown className="w-4 h-4 text-stone-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-stone-400" />
          )}
        </button>

        {layersExpanded && (
          <div className="p-3 space-y-2 overflow-y-auto flex-1">
            {layers.map((layer) => {
              const isCurrent = activeLayer === layer.id;
              return (
                <div
                  key={layer.id}
                  className={`px-2.5 py-1.5 rounded-md border text-xs flex items-center justify-between gap-2 transition-colors ${
                    isCurrent
                      ? darkMode
                        ? 'bg-amber-950/30 border-amber-700/70'
                        : 'bg-amber-50/70 border-amber-300'
                      : darkMode
                      ? 'bg-stone-950/40 border-stone-800'
                      : 'bg-stone-50/60 border-stone-200/80'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(e) =>
                        onUpdateLayer({ ...layer, color: e.target.value })
                      }
                      aria-label={`${layer.name} color`}
                      title={`Change color for layer ${layer.name}`}
                      className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => onSetActiveLayer(layer.id)}
                      title={`Set ${layer.name} as current layer`}
                      className="font-mono font-medium truncate text-left cursor-pointer hover:text-amber-600"
                    >
                      {layer.name}
                      {isCurrent && (
                        <span className="ml-1 text-[10px] text-amber-600 font-sans">
                          (Active)
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLayer({ ...layer, visible: !layer.visible })
                      }
                      aria-label={`Toggle visibility for layer ${layer.name}`}
                      title={
                        layer.visible
                          ? `Hide layer ${layer.name}`
                          : `Show layer ${layer.name}`
                      }
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        layer.visible
                          ? 'text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800'
                          : 'text-stone-300 dark:text-stone-600 hover:bg-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      {layer.visible ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLayer({ ...layer, locked: !layer.locked })
                      }
                      aria-label={`Toggle lock for layer ${layer.name}`}
                      title={
                        layer.locked
                          ? `Unlock layer ${layer.name}`
                          : `Lock layer ${layer.name} (prevents selection)`
                      }
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        layer.locked
                          ? 'text-amber-600 hover:bg-stone-200 dark:hover:bg-stone-800'
                          : 'text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      {layer.locked ? (
                        <Lock className="w-3.5 h-3.5" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add Custom Layer */}
            {!showAddLayer ? (
              <button
                type="button"
                onClick={() => setShowAddLayer(true)}
                className="w-full py-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center justify-center gap-1 border border-dashed border-stone-300 dark:border-stone-700 rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Layer</span>
              </button>
            ) : (
              <div className="p-2 rounded-md border border-stone-300 dark:border-stone-700 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newLayerColor}
                    onChange={(e) => setNewLayerColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    placeholder="e.g. A-FURN"
                    value={newLayerName}
                    onChange={(e) => setNewLayerName(e.target.value.toUpperCase())}
                    className={`flex-1 px-2 py-1 font-mono rounded border ${
                      darkMode
                        ? 'bg-stone-950 border-stone-700 text-stone-100'
                        : 'bg-white border-stone-300 text-stone-900'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAddLayer(false)}
                    className="px-2 py-1 text-stone-500 hover:text-stone-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (newLayerName.trim()) {
                        onAddLayer(newLayerName.trim(), newLayerColor);
                        setNewLayerName('');
                        setShowAddLayer(false);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
