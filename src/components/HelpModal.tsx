import React, { useState } from 'react';
import { Search, X, Play, Info, Sparkles, Keyboard, Activity } from 'lucide-react';
import { CommandDefinition, searchCommands } from '../engine/commands';
import { SmartGuidesHelp } from './SmartGuidesHelp';
import { RoofsFacadesHelp } from './RoofsFacadesHelp';
import { StructureHelp } from './StructureHelp';
import { OpeningsHelp } from './OpeningsHelp';
import { CabinHelp } from './CabinHelp';
import { CameraHelp } from './CameraHelp';
import { BelowGradeHelp } from './BelowGradeHelp';
import { ViewCubeHelp } from './ViewCubeHelp';
import { STRUCTURAL_DISCLAIMER } from '../engine/structure';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: (cmd: CommandDefinition) => void;
  onReplayTour?: () => void;
  onOpenShortcuts?: () => void;
  onLoadStressTest?: () => void;
  darkMode: boolean;
}

export const HelpModal: React.FC<HelpModalProps> = ({
  isOpen,
  onClose,
  onRunCommand,
  onReplayTour,
  onOpenShortcuts,
  onLoadStressTest,
  darkMode,
}) => {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const filtered = searchCommands(query);
  const categories = Array.from(new Set(filtered.map((c) => c.category)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-3xl max-h-[85vh] rounded-xl border shadow-2xl flex flex-col overflow-hidden ${
          darkMode
            ? 'bg-stone-900 border-stone-700 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b flex items-center justify-between gap-3 ${
            darkMode ? 'border-stone-800' : 'border-stone-200'
          }`}
        >
          <div>
            <h2 id="help-modal-title" className="text-lg font-bold tracking-tight">
              ARCHIFORMA Command Reference &amp; Guided Help (F1)
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Click any command below to start it immediately, replay the 5-step guided tour, or open the shortcut cheat sheet.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onReplayTour && (
              <button
                type="button"
                aria-label="Replay 5-Step Guided Tour"
                onClick={() => {
                  onClose();
                  onReplayTour();
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Replay Guided Tour</span>
              </button>
            )}
            {onOpenShortcuts && (
              <button
                type="button"
                aria-label="Open Keyboard Shortcut Cheat Sheet (Ctrl+/)"
                onClick={() => {
                  onClose();
                  onOpenShortcuts();
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  darkMode
                    ? 'border-stone-700 hover:bg-stone-800 text-stone-200'
                    : 'border-stone-200 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Cheat Sheet (Ctrl+/)</span>
              </button>
            )}
            {onLoadStressTest && (
              <button
                type="button"
                aria-label="Load 2,000-Object Performance Stress Test"
                onClick={() => {
                  onClose();
                  onLoadStressTest();
                }}
                title="Generate 2,000 CAD & BIM objects to test 60fps rendering & incremental 3D updates"
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  darkMode
                    ? 'border-stone-700 hover:bg-stone-800 text-stone-300'
                    : 'border-stone-200 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>2,000-Obj Test</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Help Modal"
              className={`p-2 rounded-lg transition-colors cursor-pointer ${
                darkMode ? 'hover:bg-stone-800 text-stone-400' : 'hover:bg-stone-100 text-stone-500'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Input & Alias Note */}
        <div
          className={`px-6 py-3 border-b flex flex-col gap-2.5 ${
            darkMode ? 'bg-stone-950/50 border-stone-800' : 'bg-stone-50 border-stone-200'
          }`}
        >
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search commands by name or alias (WA, RF, PT, CW, EL, SB, ST, CL, GR, LL, VV, L, DI...)..."
              aria-label="Search commands"
              autoFocus
              className={`w-full pl-9 pr-4 py-2 text-sm rounded-lg border focus:outline-none focus:border-amber-600 ${
                darkMode
                  ? 'bg-stone-900 border-stone-700 text-stone-100 placeholder:text-stone-500'
                  : 'bg-white border-stone-300 text-stone-900 placeholder:text-stone-400'
              }`}
            />
          </div>

          <div
            className={`text-xs px-3 py-2 rounded-lg border flex items-start gap-2 ${
              darkMode
                ? 'bg-amber-950/30 border-amber-800/50 text-amber-200'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">AutoCAD &amp; Revit BIM Shortcuts:</span>{' '}
              Use <code className="font-mono font-semibold">WA</code> (Wall with compound layers),{' '}
              <code className="font-mono font-semibold">TR</code> (AutoCAD 2021+ Quick Trim),{' '}
              <code className="font-mono font-semibold">EX</code> (Quick Extend),{' '}
              <code className="font-mono font-semibold">TC</code> (Trim/Extend to Corner),{' '}
              <code className="font-mono font-semibold">LL</code> (Levels),{' '}
              <code className="font-mono font-semibold">SB</code> (Floor),{' '}
              <code className="font-mono font-semibold">RF</code> (Roof),{' '}
              <code className="font-mono font-semibold">ST</code> (Stairs),{' '}
              <code className="font-mono font-semibold">CL</code> (Column),{' '}
              <code className="font-mono font-semibold">GR</code> (Grid),{' '}
              <code className="font-mono font-semibold">VV</code> (Visibility), and{' '}
              <code className="font-mono font-semibold">HH / HI / HR</code> (Hide / Isolate / Reset).
            </div>
          </div>

          {/* Dedicated AutoCAD 2021+ TRIM & EXTEND Visual Card */}
          <div
            className={`text-xs p-3.5 rounded-lg border flex flex-col gap-2 ${
              darkMode
                ? 'bg-stone-900/90 border-cyan-500/30 text-stone-200'
                : 'bg-cyan-50/60 border-cyan-300 text-stone-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-cyan-600 text-white font-bold text-[10px] uppercase tracking-wider">
                AutoCAD 2021+ Engine
              </span>
              <span className="font-semibold text-cyan-700 dark:text-cyan-300">
                Quick TRIM (TR), Quick EXTEND (EX) &amp; Revit Corner (TC)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1 text-[11px] leading-relaxed">
              <div className={`p-2 rounded border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-cyan-100'}`}>
                <div className="font-bold text-cyan-600 dark:text-cyan-400 mb-0.5">Quick Mode (Default)</div>
                Every visible object acts as an auto-cutting edge or boundary. Hover shows a faded dashed preview of the piece to remove or extend before clicking.
              </div>
              <div className={`p-2 rounded border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-cyan-100'}`}>
                <div className="font-bold text-cyan-600 dark:text-cyan-400 mb-0.5">Fence &amp; Shift Toggle</div>
                Press and drag across lines to cut/extend along a freehand path, or click 2 empty points for a straight crossing fence. Hold <kbd className="px-1 py-0.5 rounded bg-stone-200 dark:bg-stone-800 font-mono text-[10px]">Shift</kbd> to temporarily invert Trim ↔ Extend.
              </div>
              <div className={`p-2 rounded border ${darkMode ? 'bg-stone-950/60 border-stone-800' : 'bg-white border-cyan-100'}`}>
                <div className="font-bold text-cyan-600 dark:text-cyan-400 mb-0.5">Revit Corner (TC) &amp; BIM</div>
                Select two lines or walls to trim or extend into a clean mitered corner keeping clicked sides. Trim preserves hosted doors/windows on the surviving wall pieces.
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Command List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!query && <ViewCubeHelp darkMode={darkMode} />}
          {!query && <BelowGradeHelp darkMode={darkMode} />}
          {!query && <CameraHelp darkMode={darkMode} />}
          {!query && <CabinHelp darkMode={darkMode} />}
          {!query && <OpeningsHelp darkMode={darkMode} />}
          {!query && <StructureHelp darkMode={darkMode} />}
          {!query && <RoofsFacadesHelp darkMode={darkMode} />}
          {!query && <SmartGuidesHelp darkMode={darkMode} />}
          {categories.length === 0 ? (
            <div className="text-center py-8 text-sm text-stone-500">
              No commands match "{query}". Try searching for WA, LL, SB, RF, ST, CL, GR, VV, or HH.
            </div>
          ) : (
            categories.map((cat) => {
              const cmds = filtered.filter((c) => c.category === cat);
              return (
                <div key={cat} className="space-y-2.5">
                  <h3 className="text-xs font-bold tracking-wider text-stone-400 uppercase">
                    {cat}
                  </h3>
                  {cat === 'Structure' && (
                    <p role="note" className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                      ⚠ {STRUCTURAL_DISCLAIMER}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2.5">
                    {cmds.map((cmd) => (
                      <div
                        key={cmd.id}
                        onClick={() => {
                          onRunCommand(cmd);
                          onClose();
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRunCommand(cmd);
                            onClose();
                          }
                        }}
                        className={`p-3.5 rounded-lg border transition-colors cursor-pointer flex items-start justify-between gap-4 ${
                          darkMode
                            ? 'bg-stone-900/90 border-stone-800 hover:border-amber-600 hover:bg-stone-800/70'
                            : 'bg-white border-stone-200 hover:border-amber-600 hover:bg-amber-50/20'
                        }`}
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-semibold text-sm">
                              {cmd.name}
                            </span>
                            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 font-semibold">
                              Aliases: {cmd.aliases.join(', ')}
                            </span>
                          </div>
                          <p className="text-xs text-stone-600 dark:text-stone-300">
                            {cmd.description}
                          </p>
                          {cmd.conflictNote && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-400">
                              {cmd.conflictNote}
                            </p>
                          )}
                          <ol className="text-[11px] text-stone-500 dark:text-stone-400 list-decimal list-inside space-y-0.5 pt-0.5">
                            {cmd.howToUse.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </div>

                        <span className="px-2.5 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold flex items-center gap-1 shrink-0 self-center">
                          <Play className="w-3 h-3" />
                          <span>Run</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* Keyboard Shortcuts Table */}
          <div className="pt-2 border-t border-stone-200 dark:border-stone-800">
            <h3 className="text-xs font-bold tracking-wider text-stone-400 uppercase mb-2.5">
              Function Keys &amp; Global Shortcuts
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { key: 'F1', desc: 'Open Help & Command List' },
                { key: 'F3', desc: 'Toggle Object Snap (OSNAP)' },
                { key: 'F7', desc: 'Toggle Adaptive Grid' },
                { key: 'F8', desc: 'Toggle Ortho Lock (90°)' },
                { key: 'F9', desc: 'Toggle Grid Snap' },
                { key: 'F11', desc: 'Smart Alignment Guides (TRACK)' },
                { key: 'LL / VV', desc: 'Building Levels / Visibility' },
                { key: 'HH / HI / HR', desc: 'Temp Hide / Isolate / Reset' },
                { key: 'Ctrl+Z / Ctrl+Y', desc: 'Undo / Redo (120 steps)' },
                { key: 'Ctrl+A / Del', desc: 'Select All / Erase Selection' },
              ].map((s) => (
                <div
                  key={s.key}
                  className={`p-2 rounded border flex items-center justify-between ${
                    darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50'
                  }`}
                >
                  <span className="text-stone-500 dark:text-stone-400">{s.desc}</span>
                  <kbd className="font-mono font-semibold text-amber-600 dark:text-amber-400 ml-2">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
