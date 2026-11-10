import React, { useState, useRef } from 'react';
import {
  Undo2,
  Redo2,
  Save,
  Download,
  HelpCircle,
  Sun,
  Moon,
  FolderOpen,
  FilePlus2,
  Home,
  FileCode2,
  Image as ImageIcon,
  Box,
  ChevronDown,
  Check,
  Layers,
  Eye,
  FileUp,
  FileText,
  Cuboid,
} from 'lucide-react';
import { Discipline, ElevationDirection, LevelDefinition, UnitSystem, ViewMode } from '../types/model';
import { formatLength } from '../engine/geometry';

interface TopBarProps {
  projectName: string;
  onChangeProjectName: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSaveLocal: () => void;
  onNewBlankProject: () => void;
  onLoadSampleProject: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onImportDxf?: (file: File) => void;
  onExportDxf: (scope?: 'level' | 'all' | 'elevations') => void;
  onExportIfc?: () => void;
  onExportPdf?: () => void;
  onExport2dPng: () => void;
  onExport3dPng: () => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  elevationDir?: ElevationDirection;
  onOpenElevation?: (dir: ElevationDirection) => void;
  onOpenRoofPlan?: () => void;
  onOpenStructuralView?: (kind: 'foundationplan' | 'framingplan' | 'stsection', sectionId?: string) => void;
  sections?: Array<{ id: string; name: string }>;
  discipline?: Discipline;
  onChangeDiscipline?: (d: Discipline) => void;
  levels?: LevelDefinition[];
  activeLevelId?: string;
  onSelectLevel?: (levelId: string) => void;
  onChangeActiveLevel?: (levelId: string) => void;
  onOpenLevelManager?: () => void;
  onOpenLevelModal?: () => void;
  onOpenVisibilityModal?: () => void;
  units: UnitSystem;
  onToggleUnits: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenHelp: () => void;
  onOpenShortcuts?: () => void;
  onStartTour?: () => void;
  uiMode?: 'beginner' | 'pro';
  onToggleUiMode?: () => void;
  savedNotice: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  onChangeProjectName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSaveLocal,
  onNewBlankProject,
  onLoadSampleProject,
  onExportJson,
  onImportJson,
  onImportDxf,
  onExportDxf,
  onExportIfc,
  onExportPdf,
  onExport2dPng,
  onExport3dPng,
  viewMode,
  onChangeViewMode,
  elevationDir,
  onOpenElevation,
  onOpenRoofPlan,
  onOpenStructuralView,
  sections = [],
  discipline = 'combined',
  onChangeDiscipline,
  levels = [],
  activeLevelId = 'level-1',
  onSelectLevel,
  onChangeActiveLevel,
  onOpenLevelManager,
  onOpenLevelModal,
  onOpenVisibilityModal,
  units,
  onToggleUnits,
  darkMode,
  onToggleDarkMode,
  onOpenHelp,
  onOpenShortcuts,
  onStartTour,
  uiMode = 'beginner',
  onToggleUiMode,
  savedNotice,
}) => {
  const [elevMenuOpen, setElevMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);

  const handleLevelChange = onChangeActiveLevel || onSelectLevel;
  const handleOpenLevelDialog = onOpenLevelModal || onOpenLevelManager;

  return (
    <header
      className={`h-13 px-4 border-b flex items-center justify-between gap-3 select-none shrink-0 z-30 ${
        darkMode
          ? 'bg-stone-900 border-stone-800 text-stone-100'
          : 'bg-white border-stone-200 text-stone-900'
      }`}
    >
      {/* Left: Brand & Editable Project Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded bg-amber-600 text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs">
            AF
          </div>
          <span className="font-bold tracking-tight text-base whitespace-nowrap hidden min-[1700px]:inline">
            ARCHIFORMA
          </span>
        </div>

        <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
          /
        </span>

        <label className="sr-only" htmlFor="project-name-input">
          Project Name
        </label>
        <input
          id="project-name-input"
          type="text"
          value={projectName}
          onChange={(e) => onChangeProjectName(e.target.value)}
          aria-label="Project Name"
          className={`px-2 py-1 text-sm font-medium rounded border border-transparent hover:border-stone-300 focus:border-amber-600 focus:outline-none transition-colors w-32 sm:w-44 truncate ${
            darkMode
              ? 'bg-transparent hover:bg-stone-800 focus:bg-stone-800 text-stone-100'
              : 'bg-transparent hover:bg-stone-100 focus:bg-white text-stone-800'
          }`}
          title="Click to rename project"
        />
      </div>

      {/* Center: Level Switcher + View Switcher + Beginner/Pro Mode Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {levels.length > 0 && (
          <div
            className={`flex items-center rounded-lg border px-1.5 py-0.5 gap-1 ${
              darkMode
                ? 'bg-stone-950 border-stone-800'
                : 'bg-stone-100 border-stone-200/80'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 ml-1 shrink-0" />
            <select
              aria-label="Active Building Level"
              value={activeLevelId}
              onChange={(e) =>
                handleLevelChange && handleLevelChange(e.target.value)
              }
              title="Active Building Level (LL) — Each level has its own 2D plan; 3D stacks all levels"
              className={`text-xs font-semibold py-1 pr-1 bg-transparent focus:outline-none cursor-pointer ${
                darkMode ? 'text-stone-100' : 'text-stone-800'
              }`}
            >
              {[...levels]
                .sort((a, b) => a.elevation - b.elevation)
                .map((lvl) => (
                  <option
                    key={lvl.id}
                    value={lvl.id}
                    className={
                      darkMode
                        ? 'bg-stone-900 text-stone-100'
                        : 'bg-white text-stone-900'
                    }
                  >
                    {lvl.name} ({formatLength(lvl.elevation, units)})
                  </option>
                ))}
            </select>
            {handleOpenLevelDialog && (
              <button
                type="button"
                onClick={handleOpenLevelDialog}
                aria-label="Manage Levels and Elevations (LL)"
                title="Manage Levels & Elevations (LL)"
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                  darkMode
                    ? 'bg-stone-800 hover:bg-stone-700 text-amber-400'
                    : 'bg-white hover:bg-stone-200 text-amber-700 border border-stone-200'
                }`}
              >
                LL
              </button>
            )}
          </div>
        )}

        <div
          role="group"
          aria-label="View Mode Switcher"
          className={`flex items-center p-1 rounded-lg border ${
            darkMode
              ? 'bg-stone-950 border-stone-800'
              : 'bg-stone-100 border-stone-200/80'
          }`}
        >
          {(
            [
              { id: '2d', label: '2D Plan' },
              { id: '3d', label: '3D' },
              { id: 'split', label: 'Split' },
              { id: 'schedules', label: 'Schedules' },
              { id: 'sheets', label: 'Sheets' },
            ] as const
          ).map((tab, tabIdx) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                style={{ order: tabIdx < 3 ? tabIdx : tabIdx + 1 }}
                type="button"
                onClick={() => onChangeViewMode(tab.id)}
                aria-label={`Switch to ${tab.label} view`}
                aria-pressed={active}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-amber-600 text-white shadow-xs'
                    : darkMode
                    ? 'text-stone-300 hover:text-stone-100'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
                title={`Switch to ${tab.label} view`}
              >
                {tab.label}
              </button>
            );
          })}
          {onOpenElevation && (
            <div className="relative" style={{ order: 3 }}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={elevMenuOpen}
                aria-label="Elevations menu"
                onClick={() => setElevMenuOpen((o) => !o)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === 'elevation' || viewMode === 'roofplan' || viewMode === 'foundationplan' || viewMode === 'framingplan' || viewMode === 'stsection'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : darkMode
                    ? 'text-stone-300 hover:text-stone-100'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
                title="Elevations & Roof Plan"
              >
                {viewMode === 'elevation' && elevationDir
                  ? `${elevationDir[0].toUpperCase()}${elevationDir.slice(1)} Elev.`
                  : viewMode === 'roofplan'
                  ? 'Roof Plan'
                  : viewMode === 'foundationplan'
                  ? 'Foundation Plan'
                  : viewMode === 'framingplan'
                  ? 'Framing Plan'
                  : viewMode === 'stsection'
                  ? 'Section'
                  : 'Elevations'}{' '}
                ▾
              </button>
              {elevMenuOpen && (
                <div
                  role="menu"
                  className={`absolute left-0 top-full mt-1 w-44 rounded-lg border shadow-xl z-50 py-1 text-xs ${
                    darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-800'
                  }`}
                  onMouseLeave={() => setElevMenuOpen(false)}
                >
                  {(['north', 'south', 'east', 'west'] as ElevationDirection[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setElevMenuOpen(false);
                        onOpenElevation(d);
                      }}
                      className={`w-full text-left px-3 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'}`}
                    >
                      {d[0].toUpperCase() + d.slice(1)} Elevation
                    </button>
                  ))}
                  {onOpenRoofPlan && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setElevMenuOpen(false);
                        onOpenRoofPlan();
                      }}
                      className={`w-full text-left px-3 py-1.5 border-t cursor-pointer ${darkMode ? 'border-stone-800 hover:bg-stone-800' : 'border-stone-100 hover:bg-stone-100'}`}
                    >
                      Roof Plan
                    </button>
                  )}
                  {onOpenStructuralView && (
                    <>
                      <div className={`px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider border-t ${darkMode ? 'border-stone-800 text-blue-400' : 'border-stone-100 text-blue-700'}`}>Structural</div>
                      {(
                        [
                          ['foundationplan', 'Foundation Plan'],
                          ['framingplan', 'Framing Plan'],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setElevMenuOpen(false);
                            onOpenStructuralView(k);
                          }}
                          className={`w-full text-left px-3 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'}`}
                        >
                          {label}
                        </button>
                      ))}
                      {sections.map((sec) => (
                        <button
                          key={sec.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setElevMenuOpen(false);
                            onOpenStructuralView('stsection', sec.id);
                          }}
                          className={`w-full text-left px-3 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'}`}
                        >
                          {sec.name}
                        </button>
                      ))}
                      {sections.length === 0 && <div className="px-3 py-1 text-[11px] text-stone-500">Sections: draw one with SEC</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {onChangeDiscipline && (
          <div
            role="radiogroup"
            aria-label="Discipline"
            title="Discipline: Architectural hides structural-only elements; Structural fades finishes and shows structure strongly; Combined shows everything"
            className={`flex items-center p-0.5 rounded-lg border text-[11px] font-semibold ${darkMode ? 'bg-stone-950 border-stone-800' : 'bg-stone-100 border-stone-200/80'}`}
          >
            {(
              [
                ['architectural', 'Arch'],
                ['structural', 'Struct'],
                ['combined', 'Combined'],
              ] as const
            ).map(([d, label]) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={discipline === d}
                aria-label={`${d[0].toUpperCase()}${d.slice(1)} discipline`}
                onClick={() => onChangeDiscipline(d)}
                className={`px-2 py-1 rounded-md cursor-pointer ${
                  discipline === d ? (d === 'structural' ? 'bg-blue-700 text-white' : 'bg-stone-700 text-white') : darkMode ? 'text-stone-300' : 'text-stone-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {onOpenVisibilityModal && (
          <button
            type="button"
            onClick={onOpenVisibilityModal}
            aria-label="Visibility and Graphics Overrides (VV)"
            title="Visibility / Graphics Overrides (VV / VG)"
            className={`px-2 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              darkMode
                ? 'border-stone-800 bg-stone-950 hover:bg-stone-800 text-stone-200'
                : 'border-stone-200 bg-stone-100 hover:bg-stone-200 text-stone-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-mono text-[11px] font-semibold">VV</span>
          </button>
        )}

        {/* Beginner / Pro Mode Toggle */}
        {onToggleUiMode && (
          <div
            role="group"
            aria-label="Beginner or Pro Interface Mode"
            data-testid="ui-mode-toggle"
            className={`flex items-center p-0.5 rounded-lg border text-xs font-semibold shrink-0 ${
              darkMode
                ? 'bg-stone-950 border-stone-800'
                : 'bg-stone-100 border-stone-200'
            }`}
          >
            <button
              type="button"
              onClick={() => uiMode !== 'beginner' && onToggleUiMode()}
              aria-label="Switch to Beginner Mode (Toolbar labels and step hints)"
              aria-pressed={uiMode === 'beginner'}
              title="Beginner Mode: Shows labels under toolbar icons and step-by-step hints"
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                uiMode === 'beginner'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : darkMode
                  ? 'text-stone-300 hover:text-stone-100'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              Beginner
            </button>
            <button
              type="button"
              onClick={() => uiMode !== 'pro' && onToggleUiMode()}
              aria-label="Switch to Pro Mode (Icons only and larger command line)"
              aria-pressed={uiMode === 'pro'}
              title="Pro Mode: Compact icon-only toolbar and larger AutoCAD/Revit command line"
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                uiMode === 'pro'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : darkMode
                  ? 'text-stone-300 hover:text-stone-100'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              Pro
            </button>
          </div>
        )}
      </div>

      {/* Right: Undo, Redo, Units, Save, File/Export Menu, Dark Mode, Help */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo (U)"
          title="Undo (U / Ctrl+Z)"
          className={`p-2 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
            darkMode
              ? 'hover:bg-stone-800 text-stone-200'
              : 'hover:bg-stone-100 text-stone-700'
          }`}
        >
          <Undo2 className="w-4 h-4" />
          <span className="hidden min-[1800px]:inline">Undo</span>
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo (REDO)"
          title="Redo (REDO / Ctrl+Y)"
          className={`p-2 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
            darkMode
              ? 'hover:bg-stone-800 text-stone-200'
              : 'hover:bg-stone-100 text-stone-700'
          }`}
        >
          <Redo2 className="w-4 h-4" />
          <span className="hidden min-[1800px]:inline">Redo</span>
        </button>

        <div
          className={`h-4 w-px mx-1 ${
            darkMode ? 'bg-stone-800' : 'bg-stone-200'
          }`}
        />

        {/* Units Switcher */}
        <button
          type="button"
          onClick={onToggleUnits}
          aria-label={`Toggle drawing units (currently ${
            units === 'imperial' ? 'Imperial feet and inches' : 'Metric millimeters'
          })`}
          title="Toggle drawing units between Imperial (ft-in) and Metric (mm)"
          className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-medium border transition-colors cursor-pointer whitespace-nowrap ${
            darkMode
              ? 'border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200'
              : 'border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800'
          }`}
        >
          <span className="hidden min-[1800px]:inline">{units === 'imperial' ? `ft-in (12'-6")` : 'Metric (mm)'}</span>
          <span className="min-[1800px]:hidden">{units === 'imperial' ? 'ft-in' : 'mm'}</span>
        </button>

        {/* Save Button */}
        <button
          type="button"
          onClick={onSaveLocal}
          aria-label="Save project to browser storage (Ctrl+S)"
          title="Save project to browser storage (Ctrl+S)"
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer whitespace-nowrap ${
            savedNotice
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : darkMode
              ? 'border-stone-700 hover:bg-stone-800 text-stone-200'
              : 'border-stone-300 hover:bg-stone-100 text-stone-800'
          }`}
        >
          {savedNotice ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Saved</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span className="hidden min-[1800px]:inline">Save</span>
            </>
          )}
        </button>

        {/* Project & Export Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Project and Export Menu"
            title="Project File & Export Options (DXF, IFC4, PDF, PNG, JSON)"
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export &amp; File</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                aria-label="Project and Export Options"
                className={`absolute right-0 mt-1.5 w-64 rounded-lg border shadow-lg py-1.5 z-50 text-xs ${
                  darkMode
                    ? 'bg-stone-900 border-stone-700 text-stone-100'
                    : 'bg-white border-stone-200 text-stone-800'
                }`}
              >
                <div className="px-3 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                  Project Files &amp; CAD Import
                </div>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="New Blank Project"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewBlankProject();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FilePlus2 className="w-4 h-4 text-amber-600" />
                  <span>New Blank Project</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Load Sample 2-Room House"
                  onClick={() => {
                    setMenuOpen(false);
                    onLoadSampleProject();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <Home className="w-4 h-4 text-amber-600" />
                  <span>Load Sample 2-Room House</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Import CAD DXF File"
                  onClick={() => {
                    setMenuOpen(false);
                    dxfInputRef.current?.click();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FileUp className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="font-medium">Import CAD (.dxf)…</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      LINE, LWPOLYLINE, CIRCLE, ARC, TEXT
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Open Project JSON File"
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FolderOpen className="w-4 h-4 text-stone-500" />
                  <span>Open Project (.json)…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Save Project JSON File"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportJson();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <Save className="w-4 h-4 text-stone-500" />
                  <span>Save Project (.json)</span>
                </button>
                <a
                  href="/archiforma_latest.zip"
                  download="archiforma_latest.zip"
                  role="menuitem"
                  aria-label="Download Project Source Code ZIP"
                  onClick={() => setMenuOpen(false)}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <Download className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="font-medium">Download Source Code (.zip)</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      Complete Archiforma source archive
                    </div>
                  </div>
                </a>

                <div
                  className={`my-1 border-t ${
                    darkMode ? 'border-stone-800' : 'border-stone-200'
                  }`}
                />
                <div className="px-3 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                  Documentation, CAD &amp; BIM Export
                </div>

                {onExportPdf && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Export Multi-Page PDF Sheets"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPdf();
                    }}
                    className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                      darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-rose-600" />
                    <div>
                      <div className="font-medium">Export Sheets (.pdf)</div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400">
                        Multi-page A3 / Tabloid / A1 sheets
                      </div>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  aria-label="Export CAD DXF File"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportDxf('level');
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FileCode2 className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="font-medium">Export CAD (.dxf) — current level</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      AutoCAD R2000 · layers, dimensions, hatches &amp; blocks
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  aria-label="Export CAD DXF File with all levels"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportDxf('all');
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FileCode2 className="w-4 h-4 text-amber-600/70" />
                  <div>
                    <div className="font-medium">Export CAD (.dxf) — all levels</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      Every level stacked at its elevation (Z)
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  aria-label="Export CAD DXF File with elevations"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportDxf('elevations');
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <FileCode2 className="w-4 h-4 text-orange-600" />
                  <div>
                    <div className="font-medium">Export CAD (.dxf) — plan + elevations</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      N/S/E/W elevations as 2D linework (A-ELEV layers)
                    </div>
                  </div>
                </button>

                {onExportIfc && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Export IFC4 BIM File"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportIfc();
                    }}
                    className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                      darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                    }`}
                  >
                    <Cuboid className="w-4 h-4 text-teal-600" />
                    <div>
                      <div className="font-medium">Export BIM (.ifc — IFC4)</div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400">
                        Walls, Doors, Windows, Slabs &amp; Spaces
                      </div>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  aria-label="Export 2D Plan PNG"
                  onClick={() => {
                    setMenuOpen(false);
                    onExport2dPng();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-sky-600" />
                  <span>Export 2D Plan (.png)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Export 3D View PNG"
                  onClick={() => {
                    setMenuOpen(false);
                    onExport3dPng();
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer ${
                    darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                  }`}
                >
                  <Box className="w-4 h-4 text-emerald-600" />
                  <span>Export 3D View (.png)</span>
                </button>

                {onStartTour && (
                  <>
                    <div
                      className={`my-1 border-t ${
                        darkMode ? 'border-stone-800' : 'border-stone-200'
                      }`}
                    />
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Replay 5-Step Guided Tour"
                      onClick={() => {
                        setMenuOpen(false);
                        onStartTour();
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center gap-2.5 cursor-pointer font-medium text-amber-600 dark:text-amber-400 ${
                        darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100'
                      }`}
                    >
                      <HelpCircle className="w-4 h-4" />
                      <span>Replay 5-Step Guided Tour</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Open Project JSON File Input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportJson(file);
              e.target.value = '';
            }}
          />

          <input
            ref={dxfInputRef}
            type="file"
            accept=".dxf"
            aria-label="Import CAD DXF File Input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onImportDxf) onImportDxf(file);
              e.target.value = '';
            }}
          />
        </div>

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className={`p-2 rounded-md transition-colors cursor-pointer ${
            darkMode
              ? 'hover:bg-stone-800 text-amber-400'
              : 'hover:bg-stone-100 text-stone-700'
          }`}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Keyboard Shortcut Cheat Sheet (Ctrl+/) */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            aria-label="Keyboard Shortcut Cheat Sheet (Ctrl+/)"
            title="Keyboard Shortcut Cheat Sheet (Ctrl+/)"
            className={`px-2 py-1.5 rounded-md text-xs font-mono font-semibold border transition-colors cursor-pointer hidden sm:inline-flex items-center ${
              darkMode
                ? 'border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200'
                : 'border-stone-300 bg-stone-100 hover:bg-stone-200 text-stone-800'
            }`}
          >
            Ctrl+/
          </button>
        )}

        {/* Help Button (?) */}
        <button
          type="button"
          onClick={onOpenHelp}
          aria-label="Help and Command Reference (F1)"
          title="Help & AutoCAD/Revit Command Reference (F1)"
          className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
            darkMode
              ? 'border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-100'
              : 'border-stone-300 bg-stone-100 hover:bg-stone-200 text-stone-800'
          }`}
        >
          <HelpCircle className="w-4 h-4 text-amber-600" />
          <span>?</span>
        </button>
      </div>
    </header>
  );
};

