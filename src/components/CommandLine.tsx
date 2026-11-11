import React, { useState, useRef, useEffect } from 'react';
import { Terminal, ChevronUp, ChevronDown, CornerDownLeft, Wrench, Sliders } from 'lucide-react';
import {
  CommandLogEntry,
  OsnapResult,
  Point,
  ProjectSettings,
} from '../types/model';
import { CommandDefinition, searchCommands } from '../engine/commands';
import { DEFAULT_SMART_GUIDES, formatCoord } from '../engine/geometry';

interface CommandLineProps {
  hintText: string;
  logs: CommandLogEntry[];
  onSubmitInput: (value: string) => void;
  onCancelCommand: () => void;
  lastCommandAlias: string;
  settings: ProjectSettings;
  onToggleSetting: (key: keyof ProjectSettings) => void;
  onUpdateSettings?: (updater: (prev: ProjectSettings) => ProjectSettings) => void;
  cursorWorld: Point;
  activeOsnap: OsnapResult | null;
  darkMode: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  uiMode?: 'beginner' | 'pro';
  /** Mobile collapsing tabs state */
  mobilePanel?: 'none' | 'commands' | 'properties';
  onToggleMobilePanel?: (panel: 'commands' | 'properties') => void;
  activeTool?: string;
  selectedCount?: number;
}

export const CommandLine: React.FC<CommandLineProps> = ({
  hintText,
  logs,
  onSubmitInput,
  onCancelCommand,
  lastCommandAlias,
  settings,
  onToggleSetting,
  onUpdateSettings,
  cursorWorld,
  activeOsnap,
  darkMode,
  inputRef,
  uiMode = 'beginner',
  mobilePanel = 'none',
  onToggleMobilePanel,
  activeTool = 'select',
  selectedCount = 0,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [mobileCmdExpanded, setMobileCmdExpanded] = useState(false);
  const [selectedAutoIdx, setSelectedAutoIdx] = useState(0);
  const [osnapPopoverOpen, setOsnapPopoverOpen] = useState(false);
  const [trackPopoverOpen, setTrackPopoverOpen] = useState(false);
  const [polarPopoverOpen, setPolarPopoverOpen] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const osnapBtnRef = useRef<HTMLDivElement>(null);
  const polarBtnRef = useRef<HTMLDivElement>(null);

  const isPro = uiMode === 'pro';

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, historyExpanded, isPro]);

  // Close popovers on click outside
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        osnapBtnRef.current &&
        !osnapBtnRef.current.contains(target)
      ) {
        setOsnapPopoverOpen(false);
      }
      if (
        polarBtnRef.current &&
        !polarBtnRef.current.contains(target)
      ) {
        setPolarPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  // Show autocomplete when typing a command word (no numbers/commas/@)
  const trimmed = inputVal.trim();
  const isTypingCommandAlias =
    trimmed.length > 0 && /^[a-zA-Z?]+$/.test(trimmed);
  const suggestions: CommandDefinition[] = isTypingCommandAlias
    ? searchCommands(trimmed).slice(0, 6)
    : [];

  const handleTrigger = (raw: string) => {
    onSubmitInput(raw);
    setInputVal('');
    setSelectedAutoIdx(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setInputVal('');
      onCancelCommand();
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedAutoIdx((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedAutoIdx(
          (prev) => (prev - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
    }

    // Enter or Space runs command (except when typing text with spaces or coordinates)
    if (e.key === 'Enter' || (e.key === ' ' && isTypingCommandAlias)) {
      e.preventDefault();
      if (suggestions.length > 0 && selectedAutoIdx > 0 && isTypingCommandAlias) {
        handleTrigger(suggestions[selectedAutoIdx].primaryAlias.split(' ')[0]);
      } else {
        handleTrigger(inputVal);
      }
      return;
    }

    // Space on empty input repeats last command
    if (e.key === ' ' && inputVal.trim() === '') {
      e.preventDefault();
      handleTrigger('');
    }
  };

  const recentLogs = historyExpanded
    ? logs.slice(-50)
    : isPro
    ? logs.slice(-4)
    : logs.slice(-2);

  const ALL_SNAPS: Array<{ id: OsnapResult['type']; label: string }> = [
    { id: 'Endpoint', label: 'Endpoint' },
    { id: 'Midpoint', label: 'Midpoint' },
    { id: 'Center', label: 'Center' },
    { id: 'Intersection', label: 'Intersection' },
    { id: 'Perpendicular', label: 'Perpendicular' },
    { id: 'Quadrant', label: 'Quadrant' },
    { id: 'Tangent', label: 'Tangent' },
    { id: 'Extension', label: 'Extension' },
    { id: 'Nearest', label: 'Nearest' },
  ];

  const handleToggleOsnapType = (type: OsnapResult['type']) => {
    if (!onUpdateSettings) return;
    onUpdateSettings((prev) => {
      const current = prev.enabledOsnaps || [];
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { ...prev, enabledOsnaps: next };
    });
  };

  const handleSelectAllOsnaps = () => {
    if (!onUpdateSettings) return;
    onUpdateSettings((prev) => ({
      ...prev,
      enabledOsnaps: ALL_SNAPS.map((s) => s.id),
    }));
  };

  const handleClearAllOsnaps = () => {
    if (!onUpdateSettings) return;
    onUpdateSettings((prev) => ({
      ...prev,
      enabledOsnaps: [],
    }));
  };

  const handleSetPolarIncrement = (inc: number) => {
    if (!onUpdateSettings) return;
    onUpdateSettings((prev) => ({
      ...prev,
      polarIncrement: inc,
      polarTracking: true,
      orthoEnabled: false,
    }));
    setPolarPopoverOpen(false);
  };

  return (
    <footer
      aria-label="Command Line and Status Bar"
      className={`border-t select-none shrink-0 z-30 flex flex-col relative ${
        darkMode
          ? 'bg-stone-900 border-stone-800 text-stone-100'
          : 'bg-white border-stone-200 text-stone-900'
      }`}
    >
      {/* Autocomplete Popup */}
      {suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Command Autocomplete Suggestions"
          className={`absolute bottom-full left-2 sm:left-4 right-2 sm:right-auto mb-1.5 sm:w-96 rounded-lg border shadow-xl overflow-hidden z-50 ${
            darkMode
              ? 'bg-stone-900 border-stone-700 text-stone-100'
              : 'bg-white border-stone-200 text-stone-900'
          }`}
        >
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400 border-b border-stone-200 dark:border-stone-800">
            Matching AutoCAD / Revit Commands
          </div>
          {suggestions.map((cmd, idx) => {
            const active = idx === selectedAutoIdx;
            return (
              <button
                key={cmd.id}
                type="button"
                aria-label={`Run command ${cmd.name} (${cmd.aliases.join(', ')})`}
                onClick={() => {
                  handleTrigger(cmd.aliases[0]);
                  inputRef.current?.focus();
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 cursor-pointer ${
                  active
                    ? 'bg-amber-600 text-white'
                    : darkMode
                    ? 'hover:bg-stone-800'
                    : 'hover:bg-stone-100'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold flex items-center gap-2">
                    <span className="font-mono">{cmd.aliases.join(' / ')}</span>
                    <span className={active ? 'text-amber-100' : 'text-stone-400'}>
                      — {cmd.name}
                    </span>
                  </div>
                  <div
                    className={`truncate text-[11px] ${
                      active ? 'text-amber-50' : 'text-stone-500 dark:text-stone-400'
                    }`}
                  >
                    {cmd.description}
                  </div>
                </div>
                <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-75" />
              </button>
            );
          })}
        </div>
      )}

      {/* One-line Step Hint Bar + Expandable Command History */}
      <div
        className={`px-3 md:px-4 py-1 md:py-1.5 border-b text-xs flex flex-col gap-1 ${
          darkMode
            ? 'bg-stone-950/60 border-stone-800'
            : 'bg-stone-50 border-stone-200/80'
        }`}
      >
        <div className="flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`font-semibold shrink-0 ${
                !isPro
                  ? 'px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] uppercase tracking-wider'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {isPro ? 'Prompt:' : 'Step Guide:'}
            </span>
            <span
              data-testid="step-hint-banner"
              className="font-medium text-stone-800 dark:text-stone-200 truncate md:whitespace-normal"
            >
              {(() => {
                const match = hintText.match(/^(.*?)\[(.*?)\](.*?)$/);
                if (!match) return hintText;
                const prefix = match[1];
                const optionsRaw = match[2];
                const suffix = match[3];
                const optionItems = optionsRaw.split('/').map((opt) => {
                  const capMatch = opt.match(/[A-Z]+/);
                  const key = capMatch ? capMatch[0] : opt.trim().charAt(0);
                  return { label: opt.trim(), key };
                });
                return (
                  <span className="inline-flex items-center gap-1 flex-wrap">
                    <span>{prefix}[</span>
                    {optionItems.map((opt, idx) => (
                      <React.Fragment key={opt.key + idx}>
                        {idx > 0 && <span className="text-stone-400">/</span>}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTrigger(opt.key);
                          }}
                          className="hover:underline font-semibold text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer transition-colors text-xs"
                          title={`Option ${opt.key}: ${opt.label} (click or type ${opt.key} + Enter)`}
                        >
                          {opt.label}
                        </button>
                      </React.Fragment>
                    ))}
                    <span>]{suffix}</span>
                  </span>
                );
              })()}
            </span>
          </div>

          <button
            type="button"
            aria-label="Toggle 50-line command history log"
            aria-expanded={historyExpanded}
            onClick={() => {
              setHistoryExpanded((v) => !v);
              setMobileCmdExpanded(true);
            }}
            className="text-[11px] font-mono text-stone-600 dark:text-stone-400 hover:text-amber-600 flex items-center gap-1 shrink-0 cursor-pointer"
            title="Toggle 50-line command history log"
          >
            <span>History ({logs.length})</span>
            {historyExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Scrollable History Log (Hidden on mobile unless Cmd Bar or History is expanded) */}
        <div
          ref={logContainerRef}
          className={`${
            mobileCmdExpanded || historyExpanded ? 'block' : 'hidden md:block'
          } font-mono text-[11px] overflow-y-auto space-y-0.5 ${
            historyExpanded
              ? 'max-h-36 py-1'
              : isPro
              ? 'max-h-16 py-0.5'
              : 'max-h-9'
          }`}
        >
          {recentLogs.map((entry) => (
            <div
              key={entry.id}
              className={`leading-tight ${
                entry.kind === 'error'
                  ? 'text-red-600 dark:text-red-400 font-semibold'
                  : entry.kind === 'result'
                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                  : entry.kind === 'input'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <span className="opacity-50 mr-2">{entry.timestamp}</span>
              <span>{entry.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Row: Command Input + Status Toggles (Collapsible on mobile, always visible on desktop) */}
      <div
        className={`${
          mobileCmdExpanded ? 'flex' : 'hidden md:flex'
        } px-3 md:px-4 ${
          isPro ? 'py-2.5' : 'py-2'
        } flex-wrap items-center justify-between gap-2.5 md:gap-3 border-b md:border-b-0 border-stone-200 dark:border-stone-800`}
      >
        {/* Command Line Input */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-amber-600 dark:text-amber-400 shrink-0">
            <Terminal className="w-4 h-4" />
            <span>COMMAND:</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              setSelectedAutoIdx(0);
            }}
            onKeyDown={handleKeyDown}
            aria-label="Command Line Input"
            placeholder={`Type command (WA, DR, WN, RM, L, PL, MA, AA, DI...) or x,y / @dx,dy / @len<ang — Enter repeats ${lastCommandAlias}`}
            className={`flex-1 px-3 ${
              isPro ? 'py-2 text-sm' : 'py-1.5 text-xs'
            } font-mono rounded-md border focus:outline-none focus:border-amber-600 ${
              darkMode
                ? 'bg-stone-950 border-stone-700 text-stone-100 placeholder:text-stone-500'
                : 'bg-stone-50 border-stone-300 text-stone-900 placeholder:text-stone-400'
            }`}
          />
          <button
            type="button"
            aria-label="Execute command or repeat last command"
            onClick={() => handleTrigger(inputVal)}
            className={`px-2.5 ${
              isPro ? 'py-2 text-xs' : 'py-1.5 text-xs'
            } rounded-md bg-stone-200 dark:bg-stone-800 hover:bg-amber-600 hover:text-white font-mono font-semibold transition-colors cursor-pointer shrink-0`}
            title="Execute command or repeat last command (Enter)"
          >
            Enter
          </button>
        </div>

        {/* Status Bar Toggles & Live Coordinates */}
        <div className="flex items-center gap-1.5 text-xs font-mono shrink-0 flex-wrap">
          {/* GRID (F7) */}
          <button
            type="button"
            aria-label="Toggle Grid Display (F7)"
            onClick={() => onToggleSetting('gridVisible')}
            title="Toggle Grid Display (F7)"
            aria-pressed={settings.gridVisible}
            className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
              settings.gridVisible
                ? 'bg-amber-600 border-amber-600 text-white'
                : darkMode
                ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
            }`}
          >
            GRID <span className="opacity-75">F7</span>
          </button>

          {/* SNAP (F9) */}
          <button
            type="button"
            aria-label="Toggle Grid Snap (F9)"
            onClick={() => onToggleSetting('snapEnabled')}
            title="Toggle Grid Snap (F9)"
            aria-pressed={settings.snapEnabled}
            className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
              settings.snapEnabled
                ? 'bg-amber-600 border-amber-600 text-white'
                : darkMode
                ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
            }`}
          >
            SNAP <span className="opacity-75">F9</span>
          </button>

          {/* ORTHO (F8) */}
          <button
            type="button"
            aria-label="Toggle Ortho 90 degree constraint (F8)"
            onClick={() => {
              onToggleSetting('orthoEnabled');
              if (!settings.orthoEnabled && settings.polarTracking) {
                onToggleSetting('polarTracking');
              }
            }}
            title="Toggle Ortho 90° Constraint (F8)"
            aria-pressed={settings.orthoEnabled}
            className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
              settings.orthoEnabled
                ? 'bg-amber-600 border-amber-600 text-white'
                : darkMode
                ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
            }`}
          >
            ORTHO <span className="opacity-75">F8</span>
          </button>

          {/* POLAR (F10) with Popover */}
          <div ref={polarBtnRef} className="relative inline-flex items-center">
            <button
              type="button"
              aria-label="Toggle Polar Tracking (F10)"
              onClick={() => {
                onToggleSetting('polarTracking');
                if (!settings.polarTracking && settings.orthoEnabled) {
                  onToggleSetting('orthoEnabled');
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setPolarPopoverOpen((v) => !v);
              }}
              title="Toggle Polar Tracking (F10) — Right-click or click arrow to choose angle increment"
              aria-pressed={settings.polarTracking}
              className={`px-2 py-1 rounded-l text-[11px] font-semibold border-y border-l transition-colors cursor-pointer whitespace-nowrap ${
                settings.polarTracking
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : darkMode
                  ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                  : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              POLAR <span className="opacity-75">F10</span>
            </button>
            <button
              type="button"
              aria-label="Choose Polar Angle Increment"
              onClick={() => setPolarPopoverOpen((v) => !v)}
              title="Choose Polar Angle Increment (15°, 30°, 45°, 90°)"
              className={`px-1.5 py-1 rounded-r text-[10px] font-semibold border transition-colors cursor-pointer ${
                settings.polarTracking
                  ? 'bg-amber-700 border-amber-600 text-amber-100'
                  : darkMode
                  ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                  : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              {settings.polarIncrement || 45}° ▾
            </button>

            {/* Polar Tracking Angles Popover */}
            {polarPopoverOpen && (
              <div
                className={`absolute bottom-full right-0 mb-2 w-52 rounded-lg border shadow-xl p-2 z-50 text-xs ${
                  darkMode
                    ? 'bg-stone-900 border-stone-700 text-stone-100'
                    : 'bg-white border-stone-200 text-stone-900'
                }`}
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400 border-b border-stone-200 dark:border-stone-800 mb-1">
                  Polar Tracking Angles
                </div>
                {[
                  { deg: 90, label: '90°, 180°, 270°, 360°' },
                  { deg: 45, label: '45°, 90°, 135°, 180°...' },
                  { deg: 30, label: '30°, 60°, 90°, 120°...' },
                  { deg: 15, label: '15°, 30°, 45°, 60°...' },
                ].map((item) => (
                  <button
                    key={item.deg}
                    type="button"
                    aria-label={`Set Polar Tracking to ${item.deg} degrees`}
                    onClick={() => handleSetPolarIncrement(item.deg)}
                    className={`w-full px-2 py-1.5 rounded text-left flex items-center justify-between cursor-pointer ${
                      settings.polarIncrement === item.deg
                        ? 'bg-amber-600 text-white font-semibold'
                        : darkMode
                        ? 'hover:bg-stone-800 text-stone-300'
                        : 'hover:bg-stone-100 text-stone-700'
                    }`}
                  >
                    <span>{item.deg}°</span>
                    <span className="text-[10px] opacity-75">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* OSNAP (F3) with Settings Popover */}
          <div ref={osnapBtnRef} className="relative inline-flex items-center">
            <button
              type="button"
              aria-label="Toggle Object Snap (F3)"
              onClick={() => onToggleSetting('osnapEnabled')}
              onContextMenu={(e) => {
                e.preventDefault();
                setOsnapPopoverOpen((v) => !v);
              }}
              title="Toggle Object Snap (F3) — Right-click or click arrow for Snap Settings"
              aria-pressed={settings.osnapEnabled}
              className={`px-2 py-1 rounded-l text-[11px] font-semibold border-y border-l transition-colors cursor-pointer whitespace-nowrap ${
                settings.osnapEnabled
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : darkMode
                  ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                  : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              OSNAP <span className="opacity-75">F3</span>
            </button>
            <button
              type="button"
              aria-label="Open Object Snap Settings"
              onClick={() => setOsnapPopoverOpen((v) => !v)}
              title="Configure Object Snap Types (Endpoint, Midpoint, Center, Quadrant, Tangent, Extension...)"
              className={`px-1.5 py-1 rounded-r text-[10px] font-semibold border transition-colors cursor-pointer ${
                settings.osnapEnabled
                  ? 'bg-amber-700 border-amber-600 text-amber-100'
                  : darkMode
                  ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                  : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              ▾
            </button>

            {/* OSNAP Settings Popover */}
            {osnapPopoverOpen && (
              <div
                className={`absolute bottom-full right-0 mb-2 w-64 rounded-lg border shadow-xl p-2.5 z-50 text-xs ${
                  darkMode
                    ? 'bg-stone-900 border-stone-700 text-stone-100'
                    : 'bg-white border-stone-200 text-stone-900'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-stone-200 dark:border-stone-800">
                  <span className="font-semibold text-xs text-stone-800 dark:text-stone-200">
                    Object Snap Settings
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Select All Object Snaps"
                      onClick={handleSelectAllOsnaps}
                      className="text-[10px] text-amber-600 hover:underline cursor-pointer"
                    >
                      All
                    </button>
                    <span className="text-stone-400">|</span>
                    <button
                      type="button"
                      aria-label="Clear All Object Snaps"
                      onClick={handleClearAllOsnaps}
                      className="text-[10px] text-stone-500 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 py-1">
                  {ALL_SNAPS.map((snap) => {
                    const checked = (settings.enabledOsnaps || []).includes(snap.id);
                    return (
                      <label
                        key={snap.id}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer select-none text-[11px] ${
                          checked
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-stone-900 dark:text-stone-100 font-medium'
                            : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleOsnapType(snap.id)}
                          className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>{snap.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* TRACK (F11) — smart alignment guides; right-click for guide types */}
          <div className="relative">
            <button
              type="button"
              aria-label="Toggle Smart Alignment Guides (F11)"
              onClick={() => onToggleSetting('osnapTracking')}
              onContextMenu={(e) => {
                e.preventDefault();
                setTrackPopoverOpen((o) => !o);
              }}
              title="Smart alignment guides (F11) — green dotted inference: alignment, extension, parallel, perpendicular, equal length. Right-click for options · Shift = lock to guide · Alt = off while held"
              aria-pressed={settings.osnapTracking}
              className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                settings.osnapTracking
                  ? 'bg-green-600 border-green-600 text-white'
                  : darkMode
                  ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                  : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
              }`}
            >
              TRACK <span className="opacity-75">F11</span>
            </button>
            {trackPopoverOpen && (
              <div
                role="dialog"
                aria-label="Smart Guide Settings"
                className={`absolute bottom-full mb-2 right-0 w-56 p-2.5 rounded-lg border shadow-lg z-50 text-xs ${
                  darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-900'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stone-200 dark:border-stone-800">
                  <span className="font-semibold">Smart guides</span>
                  <button
                    type="button"
                    aria-label="Close Smart Guide Settings"
                    onClick={() => setTrackPopoverOpen(false)}
                    className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                {(
                  [
                    ['alignment', 'Alignment'],
                    ['extension', 'Extension'],
                    ['parallel', 'Parallel'],
                    ['perpendicular', 'Perpendicular'],
                    ['equalLength', 'Equal length'],
                  ] as const
                ).map(([key, label]) => {
                  const sg = { ...DEFAULT_SMART_GUIDES, ...(settings.smartGuides || {}) };
                  return (
                    <label key={key} className="flex items-center gap-2 py-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="accent-green-600"
                        checked={sg[key]}
                        onChange={(e) =>
                          onUpdateSettings?.((prev) => ({
                            ...prev,
                            smartGuides: { ...DEFAULT_SMART_GUIDES, ...(prev.smartGuides || {}), [key]: e.target.checked },
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
                <p className="mt-1.5 pt-1.5 border-t border-stone-200 dark:border-stone-800 text-[10px] text-stone-500">
                  Hold <b>Shift</b> to lock onto a guide, <b>Alt</b> to hide guides. Typed lengths always win.
                </p>
              </div>
            )}
          </div>

          {/* DYN (F12) */}
          <button
            type="button"
            aria-label="Toggle Dynamic Input (F12)"
            onClick={() => onToggleSetting('dynamicInput')}
            title="Toggle Dynamic Input (F12) — Floating length and angle boxes at cursor"
            aria-pressed={settings.dynamicInput}
            className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
              settings.dynamicInput
                ? 'bg-amber-600 border-amber-600 text-white'
                : darkMode
                ? 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                : 'bg-stone-100 border-stone-200 text-stone-600 hover:text-stone-900'
            }`}
          >
            DYN <span className="opacity-75">F12</span>
          </button>

          {/* Live Cursor Coordinates & Active OSNAP readout */}
          <div
            data-testid="cursor-coords"
            className={`ml-1 px-2.5 py-1 rounded border text-[11px] tabular-nums min-w-[170px] text-right ${
              darkMode
                ? 'bg-stone-950 border-stone-800 text-stone-300'
                : 'bg-stone-50 border-stone-200 text-stone-700'
            }`}
            title="Live cursor X, Y coordinates"
          >
            {activeOsnap ? (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                [{activeOsnap.type}] {formatCoord(activeOsnap.point, settings.units)}
              </span>
            ) : (
              <span>XY: {formatCoord(cursorWorld, settings.units)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Collapsing Tabs Bar (Commands, Properties, Command Line) */}
      <div
        role="tablist"
        aria-label="Mobile Collapsing Workspace Tabs"
        data-testid="mobile-collapsing-tabs"
        className={`grid md:hidden grid-cols-3 gap-1.5 px-2 py-1.5 ${
          darkMode ? 'bg-stone-900' : 'bg-white'
        }`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'commands'}
          aria-expanded={mobilePanel === 'commands'}
          aria-label="Commands Tab"
          data-testid="mobile-commands-tab"
          onClick={() => {
            if (mobilePanel !== 'commands') setMobileCmdExpanded(false);
            onToggleMobilePanel?.('commands');
          }}
          className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-1 transition-colors cursor-pointer whitespace-nowrap ${
            mobilePanel === 'commands'
              ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
              : darkMode
              ? 'bg-stone-950 border-stone-800 text-stone-200 hover:border-stone-700'
              : 'bg-stone-100 border-stone-200 text-stone-800 hover:border-stone-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 shrink-0" />
            <span>Commands</span>
          </span>
          {mobilePanel === 'commands' ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'properties'}
          aria-expanded={mobilePanel === 'properties'}
          aria-label="Properties Tab"
          data-testid="mobile-properties-tab"
          onClick={() => {
            if (mobilePanel !== 'properties') setMobileCmdExpanded(false);
            onToggleMobilePanel?.('properties');
          }}
          className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-1 transition-colors cursor-pointer whitespace-nowrap ${
            mobilePanel === 'properties'
              ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
              : darkMode
              ? 'bg-stone-950 border-stone-800 text-stone-200 hover:border-stone-700'
              : 'bg-stone-100 border-stone-200 text-stone-800 hover:border-stone-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span>
              Properties{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </span>
          </span>
          {mobilePanel === 'properties' ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mobileCmdExpanded}
          aria-expanded={mobileCmdExpanded}
          aria-label="Command Line Tab"
          data-testid="mobile-cmdline-tab"
          onClick={() => {
            const next = !mobileCmdExpanded;
            setMobileCmdExpanded(next);
            if (next && mobilePanel !== 'none') {
              onToggleMobilePanel?.(mobilePanel);
            }
          }}
          className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-1 transition-colors cursor-pointer whitespace-nowrap ${
            mobileCmdExpanded
              ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
              : darkMode
              ? 'bg-stone-950 border-stone-800 text-stone-200 hover:border-stone-700'
              : 'bg-stone-100 border-stone-200 text-stone-800 hover:border-stone-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>Cmd Line</span>
          </span>
          {mobileCmdExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>
      </div>
    </footer>
  );
};


