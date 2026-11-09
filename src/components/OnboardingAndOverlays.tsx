import React, { useState, useEffect } from 'react';
import { defaultEdgeSlopes, formatSlope, parseSlopeInput } from '../engine/roof';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  X,
  RotateCcw,
  CornerDownLeft,
  Undo2,
  Maximize2,
  Sliders,
  Move,
  Copy,
  RotateCw,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Keyboard,
  Compass,
  Layers,
  Terminal,
  Box,
} from 'lucide-react';
import {
  ArchEntity,
  DoorSwing,
  HatchPattern,
  Layer,
  RoofStyle,
  UnitSystem,
  WallType,
} from '../types/model';
import {
  dist,
  formatArea,
  formatLength,
  getWallTypeTotalThickness,
  normalize,
  parseLengthInput,
  polygonArea,
  scale,
  sub,
  add,
} from '../engine/geometry';

// ============================================================================
// 1. TOAST NOTIFICATIONS (Saves / Exports / Errors — never alert())
// ============================================================================

export type ToastKind = 'success' | 'info' | 'warning' | 'error';
export type ToastVariant = ToastKind;

export interface ToastItem {
  id: string;
  message: string;
  kind?: ToastKind;
  variant?: ToastVariant;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  darkMode?: boolean;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
  darkMode = false,
}) => {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="System Notifications"
      aria-live="polite"
      className="fixed bottom-24 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const effectiveKind = toast.kind ?? toast.variant ?? 'info';
        const isError = effectiveKind === 'error';
        const isSuccess = effectiveKind === 'success';
        const isWarn = effectiveKind === 'warning';

        return (
          <div
            key={toast.id}
            data-testid="toast-notification"
            role={isError ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-lg border shadow-lg text-xs transition-all ${
              isError
                ? darkMode
                  ? 'bg-red-950/95 border-red-700 text-red-100'
                  : 'bg-red-50 border-red-300 text-red-900'
                : isSuccess
                ? darkMode
                  ? 'bg-emerald-950/95 border-emerald-700 text-emerald-100'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : isWarn
                ? darkMode
                  ? 'bg-amber-950/95 border-amber-700 text-amber-100'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
                : darkMode
                ? 'bg-stone-900/95 border-stone-700 text-stone-100'
                : 'bg-white border-stone-300 text-stone-900'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {isError ? (
                <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              ) : isSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : isWarn ? (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <span className="font-medium leading-snug break-words">
                {toast.message}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// 2. FIRST-RUN 5-STEP GUIDED TOUR (Skippable & Replayable from Help)
// ============================================================================

export interface TourStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  body: string;
  tip: string;
  actionLabel?: string;
}

export const GUIDED_TOUR_STEPS: TourStep[] = [
  {
    stepNumber: 1,
    title: '01. Choose a Tool from the Left Toolbar',
    subtitle: 'Draw 2D Geometry or Build 3D BIM Elements',
    body: 'Use the Left Toolbar to pick 2D CAD tools (Line, Polyline, Circle, Arc) or intelligent BIM building tools (Wall, Door, Window, Room, Floor, Roof, Stair, Column). Switch to the Library tab to place 2D/3D furniture and fixtures.',
    tip: 'Tip: Toggle between "Beginner" (labels + step hints) and "Pro" (compact icons + larger command bar) in the Top Bar anytime.',
  },
  {
    stepNumber: 2,
    title: '02. Draft with Precision on the 2D Plan Canvas',
    subtitle: 'Object Snaps, Polar Tracking & Right-Click Menu',
    body: 'Click on the canvas to place points. Green and blue OSNAP markers automatically snap to Endpoints, Midpoints, Centers, and Intersections. Pan by dragging with the middle mouse button (or Space + Left-drag) and zoom with the scroll wheel.',
    tip: 'Tip: Right-click anywhere on the canvas to Repeat the last command, Undo, Zoom Extents, or Move/Copy/Rotate selected objects.',
  },
  {
    stepNumber: 3,
    title: '03. Follow the Bottom Hint Bar or Type Commands',
    subtitle: 'AutoCAD & Revit Keyboard Aliases',
    body: 'Just start typing anywhere to use the Command Line! Type WA for Wall, DR for Door, WN for Window, TR for Trim, O for Offset, or DLI for Linear Dimension, then press Enter or Space. The Next Step prompt guides you through every click.',
    tip: 'Tip: Press Enter or Space on an empty command line to immediately repeat your last command.',
  },
  {
    stepNumber: 4,
    title: '04. Switch Views: 2D Plan, 3D BIM, Schedules & Sheets',
    subtitle: 'Real-Time Multi-Level Building Model',
    body: 'Use the Top Bar to switch between 2D Plan, live 3D BIM (stacking Level 1, Level 2, and Roof), Split View, live editable Door/Window/Room Schedules, and printable A3/Tabloid/A1 Architectural Sheets.',
    tip: 'Tip: Export your work to multi-page PDF, CAD (.dxf), or BIM (.ifc / IFC4) from the Export & File menu.',
  },
  {
    stepNumber: 5,
    title: '05. Quick Properties & Keyboard Shortcuts',
    subtitle: 'Instant Editing Near Your Cursor',
    body: 'Click any object in the plan to see its Quick Properties popup right next to your cursor for fast edits, or inspect full Type and Instance parameters in the Right Panel. Press Ctrl+/ at any time to view the Shortcut Cheat Sheet.',
    tip: 'Tip: You can replay this 5-step Guided Tour anytime from the Help (?) dialog (F1).',
  },
];

interface GuidedTourModalProps {
  isOpen: boolean;
  stepIndex?: number;
  step?: number;
  onChangeStep: (nextStep: number) => void;
  onFinishOrSkip?: () => void;
  onClose?: () => void;
  uiMode?: 'beginner' | 'pro';
  onToggleUiMode?: () => void;
  darkMode?: boolean;
}

export const GuidedTourModal: React.FC<GuidedTourModalProps> = ({
  isOpen,
  stepIndex,
  step,
  onChangeStep,
  onFinishOrSkip,
  onClose,
  darkMode = false,
}) => {
  if (!isOpen) return null;

  const rawIdx =
    typeof stepIndex === 'number' && Number.isFinite(stepIndex)
      ? stepIndex
      : typeof step === 'number' && Number.isFinite(step)
      ? step
      : 0;
  const clampedIdx = Math.max(
    0,
    Math.min(GUIDED_TOUR_STEPS.length - 1, Math.floor(rawIdx))
  );
  const current = GUIDED_TOUR_STEPS[clampedIdx] ?? GUIDED_TOUR_STEPS[0];
  const handleFinishOrSkip = onFinishOrSkip ?? onClose ?? (() => {});
  const isFirst = clampedIdx === 0;
  const isLast = clampedIdx === GUIDED_TOUR_STEPS.length - 1;

  const StepIcon =
    clampedIdx === 0
      ? Layers
      : clampedIdx === 1
      ? Compass
      : clampedIdx === 2
      ? Terminal
      : clampedIdx === 3
      ? Box
      : Sparkles;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-tour-title"
      data-testid="guided-tour-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
    >
      <div
        className={`w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden flex flex-col ${
          darkMode
            ? 'bg-stone-900 border-stone-700 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        {/* Top Progress Header */}
        <div
          className={`px-6 py-4 border-b flex items-center justify-between ${
            darkMode
              ? 'bg-stone-950/70 border-stone-800'
              : 'bg-stone-50 border-stone-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0">
              <StepIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                Guided Tour · Step {current.stepNumber} of{' '}
                {GUIDED_TOUR_STEPS.length}
              </div>
              <div className="text-xs text-stone-600 dark:text-stone-400">
                {current.subtitle}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleFinishOrSkip}
            aria-label="Skip Guided Tour"
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              darkMode
                ? 'text-stone-300 hover:bg-stone-800 hover:text-white'
                : 'text-stone-600 hover:bg-stone-200/70 hover:text-stone-900'
            }`}
          >
            Skip Tour
          </button>
        </div>

        {/* Step Content */}
        <div className="p-6 space-y-4">
          <h2
            id="guided-tour-title"
            className="text-lg font-bold tracking-tight"
          >
            {current.title}
          </h2>

          <p className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
            {current.body}
          </p>

          <div
            className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
              darkMode
                ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                : 'bg-amber-50/90 border-amber-200 text-amber-950'
            }`}
          >
            {current.tip}
          </div>

          {/* Step Dots Indicator */}
          <div
            className="flex items-center justify-center gap-2 pt-1"
            role="tablist"
            aria-label="Tour Steps"
          >
            {GUIDED_TOUR_STEPS.map((st, idx) => {
              const active = idx === clampedIdx;
              return (
                <button
                  key={st.stepNumber}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Go to step ${st.stepNumber}: ${st.title}`}
                  onClick={() => onChangeStep(idx)}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    active
                      ? 'w-7 bg-amber-600'
                      : darkMode
                      ? 'w-2 bg-stone-700 hover:bg-stone-600'
                      : 'w-2 bg-stone-300 hover:bg-stone-400'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Footer Controls */}
        <div
          className={`px-6 py-3.5 border-t flex items-center justify-between ${
            darkMode
              ? 'bg-stone-950/50 border-stone-800'
              : 'bg-stone-50 border-stone-200'
          }`}
        >
          <button
            type="button"
            onClick={() => onChangeStep(clampedIdx - 1)}
            disabled={isFirst}
            aria-label="Previous Tour Step"
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              darkMode
                ? 'border-stone-700 hover:bg-stone-800 text-stone-200'
                : 'border-stone-300 hover:bg-stone-100 text-stone-700'
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            {!isLast ? (
              <button
                type="button"
                onClick={() => onChangeStep(clampedIdx + 1)}
                aria-label="Next Tour Step"
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>Next Step</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinishOrSkip}
                aria-label="Finish Guided Tour"
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Start Designing</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. KEYBOARD SHORTCUT CHEAT SHEET MODAL (Ctrl+/)
// ============================================================================

interface ShortcutGroup {
  category: string;
  items: Array<{ keys: string; label: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: 'Workspace & File',
    items: [
      { keys: 'Ctrl + /', label: 'Keyboard Shortcut Cheat Sheet' },
      { keys: 'F1 or ?', label: 'Help & Full Command Reference' },
      { keys: 'Ctrl + S', label: 'Save Project to Browser Storage' },
      { keys: 'Ctrl + Z / Y', label: 'Undo / Redo (120 steps)' },
      { keys: 'Ctrl + A', label: 'Select All on Active Level' },
      { keys: 'Esc', label: 'Cancel Active Tool / Deselect' },
      { keys: 'Enter / Space', label: 'Confirm Input or Repeat Last Command' },
      { keys: 'Del / E', label: 'Delete Selected Objects' },
      { keys: 'ZE', label: 'Zoom Extents (Fit Drawing)' },
    ],
  },
  {
    category: 'Precision Drafting (F-Keys)',
    items: [
      { keys: 'F3', label: 'Toggle Object Snap (OSNAP)' },
      { keys: 'F7', label: 'Toggle Adaptive Grid Display' },
      { keys: 'F8', label: 'Toggle Ortho 90° Lock' },
      { keys: 'F9', label: 'Toggle Grid Snap' },
      { keys: 'F10', label: 'Toggle Polar Angle Tracking' },
      { keys: 'F11', label: 'Toggle Smart Alignment Guides (TRACK) — Shift locks, Alt hides' },
      { keys: 'F12', label: 'Toggle Dynamic Input Near Cursor' },
      { keys: 'Tab', label: 'Cycle Wall Face (Int / Center / Ext) or Dyn Input' },
      { keys: 'Space + Drag', label: 'Pan 2D Canvas' },
    ],
  },
  {
    category: 'BIM & Building Elements',
    items: [
      { keys: 'WA', label: 'Draw Architectural Wall (Multi-Layer)' },
      { keys: 'DR', label: 'Place Hosted Door in Wall' },
      { keys: 'WN', label: 'Place Hosted Window in Wall' },
      { keys: 'RM', label: 'Tag Enclosed Room & Area' },
      { keys: 'SB', label: 'Create Floor Slab' },
      { keys: 'RF', label: 'Create Roof by Footprint (Gable/Flat)' },
      { keys: 'ST', label: 'Draw Straight Stair Run' },
      { keys: 'CL / GR', label: 'Place Structural Column / Grid Line' },
      { keys: 'CM / I / B', label: 'Place Component / Make Block' },
      { keys: 'LL / VV', label: 'Levels Manager / Visibility Graphics' },
      { keys: 'HH / HI / HR', label: 'Hide / Isolate / Reset Elements' },
    ],
  },
  {
    category: '2D CAD & Modify Tools',
    items: [
      { keys: 'L / PL / REC', label: 'Line / Polyline / Rectangle' },
      { keys: 'C / A', label: 'Circle / 3-Point Arc' },
      { keys: 'M / CO / RO', label: 'Move / Copy / Rotate' },
      { keys: 'O', label: 'Offset Parallel Copy' },
      { keys: 'TR / EX', label: 'Trim / Extend to Edges' },
      { keys: 'F / CHA', label: 'Fillet Corner / Chamfer Bevel' },
      { keys: 'MI / SC / S', label: 'Mirror / Scale / Stretch' },
      { keys: 'AR / BR / J', label: 'Array / Break / Join' },
      { keys: 'X / AL / MA', label: 'Explode / Align / Match Properties' },
    ],
  },
  {
    category: 'Annotate & Documentation',
    items: [
      { keys: 'DAL / DLI', label: 'Aligned / Linear Dimension' },
      { keys: 'DAN / DRA / DDI', label: 'Angular / Radius / Diameter Dim' },
      { keys: 'DCO / DBA', label: 'Continue / Baseline Dimension' },
      { keys: 'TX / LE', label: 'Text Note / Leader Arrow Note' },
      { keys: 'H / TG', label: 'Hatch Pattern Fill / Category Tag' },
      { keys: 'DIST / AA', label: 'Measure Distance / Measure Area' },
      { keys: 'D / DIMSTYLE', label: 'Dimension Style Settings' },
      { keys: 'SCH / SH', label: 'Open Schedules / Open Sheets' },
      { keys: 'PLOT / PDF', label: 'Export Multi-Page PDF Sheets' },
    ],
  },
];

interface ShortcutCheatSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTour?: () => void;
  onOpenGuidedTour?: () => void;
  darkMode?: boolean;
}

export const ShortcutCheatSheetModal: React.FC<ShortcutCheatSheetModalProps> = ({
  isOpen,
  onClose,
  onStartTour,
  onOpenGuidedTour,
  darkMode = false,
}) => {
  const [filter, setFilter] = useState('');

  if (!isOpen) return null;

  const handleReplayTour = onStartTour ?? onOpenGuidedTour ?? (() => {});

  const q = filter.trim().toLowerCase();
  const filteredGroups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) =>
        !q ||
        item.keys.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q)
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-sheet-title"
      data-testid="shortcut-cheatsheet-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-4xl max-h-[86vh] rounded-xl border shadow-2xl flex flex-col overflow-hidden ${
          darkMode
            ? 'bg-stone-900 border-stone-700 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b flex items-center justify-between gap-4 ${
            darkMode ? 'border-stone-800' : 'border-stone-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="shortcut-sheet-title"
                className="text-base font-bold tracking-tight"
              >
                Keyboard Shortcut Cheat Sheet (Ctrl + /)
              </h2>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                Quick reference for AutoCAD commands, Revit BIM aliases, and precision function keys
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                handleReplayTour();
              }}
              aria-label="Replay 5-Step Guided Tour"
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              Replay Guided Tour
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Shortcut Cheat Sheet"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                darkMode
                  ? 'hover:bg-stone-800 text-stone-300'
                  : 'hover:bg-stone-100 text-stone-600'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div
          className={`px-6 py-2.5 border-b ${
            darkMode
              ? 'bg-stone-950/60 border-stone-800'
              : 'bg-stone-50 border-stone-200'
          }`}
        >
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter shortcuts (e.g. Wall, F3, Trim, Dimension, Undo)..."
            aria-label="Filter keyboard shortcuts"
            autoFocus
            className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:border-amber-600 ${
              darkMode
                ? 'bg-stone-900 border-stone-700 text-stone-100 placeholder:text-stone-500'
                : 'bg-white border-stone-300 text-stone-900 placeholder:text-stone-500'
            }`}
          />
        </div>

        {/* Grid of Shortcut Categories */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredGroups.map((group) => (
            <div
              key={group.category}
              className={`p-3.5 rounded-lg border space-y-2.5 ${
                darkMode
                  ? 'bg-stone-950/50 border-stone-800'
                  : 'bg-stone-50/70 border-stone-200'
              }`}
            >
              <h3 className="text-xs font-bold tracking-wider uppercase text-amber-600 dark:text-amber-400">
                {group.category}
              </h3>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-2 text-xs py-0.5"
                  >
                    <span className="text-stone-700 dark:text-stone-300 truncate">
                      {item.label}
                    </span>
                    <kbd
                      className={`px-1.5 py-0.5 rounded border font-mono text-[11px] font-semibold shrink-0 ${
                        darkMode
                          ? 'bg-stone-900 border-stone-700 text-amber-400'
                          : 'bg-white border-stone-300 text-stone-800'
                      }`}
                    >
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. RIGHT-CLICK CANVAS CONTEXT MENU
// ============================================================================

interface CanvasContextMenuProps {
  position?: { x: number; y: number } | null;
  x?: number;
  y?: number;
  onClose: () => void;
  lastCommandAlias?: string;
  selectedCount: number;
  canUndo?: boolean;
  onRepeatLastCommand: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onZoomExtents: () => void;
  onOpenProperties: () => void;
  onMoveSelected: () => void;
  onCopySelected: () => void;
  onRotateSelected: () => void;
  onDeleteSelected: () => void;
  darkMode?: boolean;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({
  position,
  x,
  y,
  onClose,
  lastCommandAlias = 'WA',
  selectedCount,
  canUndo = true,
  onRepeatLastCommand,
  onCancel,
  onUndo,
  onZoomExtents,
  onOpenProperties,
  onMoveSelected,
  onCopySelected,
  onRotateSelected,
  onDeleteSelected,
  darkMode = false,
}) => {
  const resolvedPos =
    position ??
    (typeof x === 'number' && typeof y === 'number' ? { x, y } : null);

  useEffect(() => {
    if (!resolvedPos) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [resolvedPos, onClose]);

  if (!resolvedPos) return null;

  // Keep menu inside viewport
  const left = Math.max(8, Math.min(resolvedPos.x, window.innerWidth - 230));
  const top = Math.max(8, Math.min(resolvedPos.y, window.innerHeight - 340));

  const itemClass = `w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
    darkMode
      ? 'hover:bg-stone-800 text-stone-200'
      : 'hover:bg-stone-100 text-stone-800'
  }`;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label="Canvas Context Menu"
        data-testid="canvas-context-menu"
        style={{ left: `${left}px`, top: `${top}px` }}
        className={`fixed z-50 w-56 rounded-lg border shadow-xl py-1.5 select-none ${
          darkMode
            ? 'bg-stone-900 border-stone-700 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        <button
          type="button"
          role="menuitem"
          aria-label={`Repeat Last Command (${lastCommandAlias})`}
          onClick={() => {
            onClose();
            onRepeatLastCommand();
          }}
          className={itemClass}
        >
          <span className="flex items-center gap-2 font-medium">
            <CornerDownLeft className="w-3.5 h-3.5 text-amber-600" />
            <span>Repeat {lastCommandAlias}</span>
          </span>
          <span className="text-[10px] font-mono text-stone-500">Enter</span>
        </button>

        <button
          type="button"
          role="menuitem"
          aria-label="Cancel Active Command"
          onClick={() => {
            onClose();
            onCancel();
          }}
          className={itemClass}
        >
          <span className="flex items-center gap-2">
            <RotateCcw className="w-3.5 h-3.5 text-stone-500" />
            <span>Cancel</span>
          </span>
          <span className="text-[10px] font-mono text-stone-500">Esc</span>
        </button>

        <button
          type="button"
          role="menuitem"
          disabled={!canUndo}
          aria-label="Undo Last Action"
          onClick={() => {
            onClose();
            onUndo();
          }}
          className={`${itemClass} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <span className="flex items-center gap-2">
            <Undo2 className="w-3.5 h-3.5 text-stone-500" />
            <span>Undo</span>
          </span>
          <span className="text-[10px] font-mono text-stone-500">Ctrl+Z</span>
        </button>

        <button
          type="button"
          role="menuitem"
          aria-label="Zoom Extents"
          onClick={() => {
            onClose();
            onZoomExtents();
          }}
          className={itemClass}
        >
          <span className="flex items-center gap-2">
            <Maximize2 className="w-3.5 h-3.5 text-stone-500" />
            <span>Zoom Extents</span>
          </span>
          <span className="text-[10px] font-mono text-stone-500">ZE</span>
        </button>

        <button
          type="button"
          role="menuitem"
          aria-label="Inspect Properties"
          onClick={() => {
            onClose();
            onOpenProperties();
          }}
          className={itemClass}
        >
          <span className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-stone-500" />
            <span>Properties</span>
          </span>
          <span className="text-[10px] font-mono text-stone-500">PR</span>
        </button>

        {selectedCount > 0 && (
          <>
            <div
              className={`my-1 border-t ${
                darkMode ? 'border-stone-800' : 'border-stone-200'
              }`}
            />
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Selected ({selectedCount})
            </div>

            <button
              type="button"
              role="menuitem"
              aria-label="Move Selected Objects"
              onClick={() => {
                onClose();
                onMoveSelected();
              }}
              className={itemClass}
            >
              <span className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5 text-amber-600" />
                <span>Move</span>
              </span>
              <span className="text-[10px] font-mono text-stone-500">M</span>
            </button>

            <button
              type="button"
              role="menuitem"
              aria-label="Copy Selected Objects"
              onClick={() => {
                onClose();
                onCopySelected();
              }}
              className={itemClass}
            >
              <span className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-amber-600" />
                <span>Copy</span>
              </span>
              <span className="text-[10px] font-mono text-stone-500">CO</span>
            </button>

            <button
              type="button"
              role="menuitem"
              aria-label="Rotate Selected Objects"
              onClick={() => {
                onClose();
                onRotateSelected();
              }}
              className={itemClass}
            >
              <span className="flex items-center gap-2">
                <RotateCw className="w-3.5 h-3.5 text-amber-600" />
                <span>Rotate</span>
              </span>
              <span className="text-[10px] font-mono text-stone-500">RO</span>
            </button>

            <button
              type="button"
              role="menuitem"
              aria-label="Delete Selected Objects"
              onClick={() => {
                onClose();
                onDeleteSelected();
              }}
              className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                darkMode
                  ? 'hover:bg-red-950/60 text-red-400'
                  : 'hover:bg-red-50 text-red-600'
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </span>
              <span className="text-[10px] font-mono opacity-80">Del</span>
            </button>
          </>
        )}
      </div>
    </>
  );
};

// ============================================================================
// 5. QUICK PROPERTIES POPUP NEAR CURSOR WHEN OBJECT IS SELECTED
// ============================================================================

interface QuickPropertiesPopupProps {
  entity: ArchEntity;
  screenPosition?: { x: number; y: number };
  screenPos?: { x: number; y: number };
  layers: Layer[];
  wallTypes?: WallType[];
  units: UnitSystem;
  onUpdateEntity: (updated: ArchEntity, label: string) => void;
  onOpenFullProperties?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onRotate?: () => void;
  onDelete?: () => void;
  onClose?: () => void;
  darkMode?: boolean;
}

const QuickLengthField: React.FC<{
  label: string;
  inches: number;
  units: UnitSystem;
  onChange: (val: number) => void;
  darkMode: boolean;
}> = ({ label, inches, units, onChange, darkMode }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft !== null ? draft : formatLength(inches, units);

  const commit = () => {
    if (draft !== null) {
      const parsed = parseLengthInput(draft, units);
      if (parsed !== null && parsed > 0) {
        onChange(parsed);
      }
      setDraft(null);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
        {label}
      </label>
      <input
        type="text"
        aria-label={label}
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
        className={`w-24 px-2 py-0.5 text-xs font-mono text-right rounded border ${
          darkMode
            ? 'bg-stone-950 border-stone-700 text-stone-100'
            : 'bg-stone-50 border-stone-300 text-stone-900'
        }`}
      />
    </div>
  );
};

export const QuickPropertiesPopup: React.FC<QuickPropertiesPopupProps> = ({
  entity,
  screenPosition,
  screenPos,
  layers,
  wallTypes = [],
  units,
  onUpdateEntity,
  onMove = () => {},
  onCopy = () => {},
  onRotate = () => {},
  onDelete = () => {},
  onClose = () => {},
  darkMode = false,
}) => {
  const pos = screenPosition ?? screenPos ?? { x: 40, y: 80 };
  const left = Math.max(12, Math.min(pos.x + 22, 620));
  const top = Math.max(44, Math.min(pos.y - 24, 420));

  const selectClass = `w-28 px-1.5 py-0.5 text-xs rounded border ${
    darkMode
      ? 'bg-stone-950 border-stone-700 text-stone-100'
      : 'bg-stone-50 border-stone-300 text-stone-900'
  }`;

  const inputClass = `w-28 px-2 py-0.5 text-xs rounded border ${
    darkMode
      ? 'bg-stone-950 border-stone-700 text-stone-100'
      : 'bg-stone-50 border-stone-300 text-stone-900'
  }`;

  return (
    <div
      data-testid="quick-properties-popup"
      role="region"
      aria-label={`Quick Properties for ${entity.type}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-30 w-60 rounded-lg border shadow-xl p-2.5 space-y-2 text-xs select-none pointer-events-auto ${
        darkMode
          ? 'bg-stone-900/95 border-stone-700 text-stone-100 backdrop-blur-xs'
          : 'bg-white/95 border-stone-300 text-stone-900 backdrop-blur-xs'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-600" />
          <span className="font-bold uppercase tracking-wider text-[11px]">
            {entity.type} Quick Props
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Quick Properties Popup"
          className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-500 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2–3 Most Important Fields per Entity Type */}
      <div className="space-y-1.5">
        {/* Field 1: Layer (universal) */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
            Layer
          </label>
          <select
            aria-label="Object Layer"
            value={entity.layer}
            onChange={(e) =>
              onUpdateEntity({ ...entity, layer: e.target.value }, 'Change Layer')
            }
            className={selectClass}
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id}
              </option>
            ))}
          </select>
        </div>

        {/* Wall: Wall Type + Length + Height */}
        {entity.type === 'wall' && (
          <>
            {wallTypes.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                  Wall Type
                </label>
                <select
                  aria-label="Wall Type"
                  value={entity.wallTypeId || wallTypes[0].id}
                  onChange={(e) => {
                    const wt = wallTypes.find((w) => w.id === e.target.value);
                    if (wt) {
                      onUpdateEntity(
                        {
                          ...entity,
                          wallTypeId: wt.id,
                          thickness: getWallTypeTotalThickness(wt),
                        },
                        `Change Wall Type to ${wt.name}`
                      );
                    }
                  }}
                  className={selectClass}
                >
                  {wallTypes.map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <QuickLengthField
              label="Length"
              inches={dist(entity.start, entity.end)}
              units={units}
              darkMode={darkMode}
              onChange={(newLen) => {
                const dir = normalize(sub(entity.end, entity.start));
                const nextEnd = add(entity.start, scale(dir, newLen));
                onUpdateEntity(
                  { ...entity, end: nextEnd },
                  'Update Wall Length'
                );
              }}
            />
            <QuickLengthField
              label="Height"
              inches={entity.height}
              units={units}
              darkMode={darkMode}
              onChange={(newH) =>
                onUpdateEntity({ ...entity, height: newH }, 'Update Wall Height')
              }
            />
          </>
        )}

        {/* Line: Length */}
        {entity.type === 'line' && (
          <QuickLengthField
            label="Length"
            inches={dist(entity.start, entity.end)}
            units={units}
            darkMode={darkMode}
            onChange={(newLen) => {
              const dir = normalize(sub(entity.end, entity.start));
              const nextEnd = add(entity.start, scale(dir, newLen));
              onUpdateEntity({ ...entity, end: nextEnd }, 'Update Line Length');
            }}
          />
        )}

        {/* Circle / Arc: Radius */}
        {(entity.type === 'circle' || entity.type === 'arc') && (
          <QuickLengthField
            label="Radius"
            inches={entity.radius}
            units={units}
            darkMode={darkMode}
            onChange={(newR) =>
              onUpdateEntity({ ...entity, radius: newR }, 'Update Radius')
            }
          />
        )}

        {/* Rectangle: Width & Depth */}
        {entity.type === 'rectangle' && (
          <>
            <QuickLengthField
              label="Width"
              inches={Math.abs(entity.p2.x - entity.p1.x)}
              units={units}
              darkMode={darkMode}
              onChange={(w) => {
                const signX = entity.p2.x >= entity.p1.x ? 1 : -1;
                onUpdateEntity(
                  { ...entity, p2: { ...entity.p2, x: entity.p1.x + signX * w } },
                  'Update Rectangle Width'
                );
              }}
            />
            <QuickLengthField
              label="Depth"
              inches={Math.abs(entity.p2.y - entity.p1.y)}
              units={units}
              darkMode={darkMode}
              onChange={(h) => {
                const signY = entity.p2.y >= entity.p1.y ? 1 : -1;
                onUpdateEntity(
                  { ...entity, p2: { ...entity.p2, y: entity.p1.y + signY * h } },
                  'Update Rectangle Depth'
                );
              }}
            />
          </>
        )}

        {/* Door: Width & Swing */}
        {entity.type === 'door' && (
          <>
            <QuickLengthField
              label="Width"
              inches={entity.width}
              units={units}
              darkMode={darkMode}
              onChange={(w) =>
                onUpdateEntity({ ...entity, width: w }, 'Update Door Width')
              }
            />
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Swing
              </label>
              <select
                aria-label="Door Swing"
                value={entity.swing}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...entity, swing: e.target.value as DoorSwing },
                    'Change Door Swing'
                  )
                }
                className={selectClass}
              >
                <option value="left-in">Left-In</option>
                <option value="right-in">Right-In</option>
                <option value="left-out">Left-Out</option>
                <option value="right-out">Right-Out</option>
              </select>
            </div>
          </>
        )}

        {/* Window: Width & Sill Height */}
        {entity.type === 'window' && (
          <>
            <QuickLengthField
              label="Width"
              inches={entity.width}
              units={units}
              darkMode={darkMode}
              onChange={(w) =>
                onUpdateEntity({ ...entity, width: w }, 'Update Window Width')
              }
            />
            <QuickLengthField
              label="Sill Height"
              inches={entity.sillHeight}
              units={units}
              darkMode={darkMode}
              onChange={(s) =>
                onUpdateEntity(
                  { ...entity, sillHeight: s },
                  'Update Window Sill'
                )
              }
            />
          </>
        )}

        {/* Room: Name, Floor Material & Area */}
        {entity.type === 'room' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Name
              </label>
              <input
                type="text"
                aria-label="Room Name"
                value={entity.name}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...entity, name: e.target.value },
                    'Rename Room'
                  )
                }
                className={inputClass}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Finish
              </label>
              <select
                aria-label="Room Floor Finish"
                value={entity.floorMaterial || 'wood'}
                onChange={(e) =>
                  onUpdateEntity(
                    {
                      ...entity,
                      floorMaterial: e.target.value as
                        | 'wood'
                        | 'tile'
                        | 'concrete'
                        | 'stone',
                    },
                    'Change Room Finish'
                  )
                }
                className={selectClass}
              >
                <option value="wood">Wood</option>
                <option value="tile">Tile</option>
                <option value="concrete">Concrete</option>
                <option value="stone">Stone</option>
              </select>
            </div>
            <div className="flex items-center justify-between text-[11px] text-stone-500 pt-0.5">
              <span>Area</span>
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                {formatArea(polygonArea(entity.polygon), units)}
              </span>
            </div>
          </>
        )}

        {/* Text / Leader: Text & Size */}
        {(entity.type === 'text' || entity.type === 'leader') && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Text
              </label>
              <input
                type="text"
                aria-label="Annotation Text"
                value={entity.text}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...entity, text: e.target.value },
                    'Edit Text'
                  )
                }
                className={inputClass}
              />
            </div>
            <QuickLengthField
              label="Text Size"
              inches={entity.fontSize}
              units={units}
              darkMode={darkMode}
              onChange={(sz) =>
                onUpdateEntity({ ...entity, fontSize: sz }, 'Change Text Size')
              }
            />
          </>
        )}

        {/* Block Instance: Rotation & Scale */}
        {entity.type === 'block' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Rotation
              </label>
              <select
                aria-label="Component Rotation"
                value={entity.rotation}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...entity, rotation: Number(e.target.value) },
                    'Rotate Component'
                  )
                }
                className={selectClass}
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Scale
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                aria-label="Component Scale"
                value={entity.scale}
                onChange={(e) =>
                  onUpdateEntity(
                    {
                      ...entity,
                      scale: Math.max(0.1, parseFloat(e.target.value) || 1),
                    },
                    'Scale Component'
                  )
                }
                className={`w-20 px-2 py-0.5 text-xs font-mono text-right rounded border ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
          </>
        )}

        {/* Hatch: Pattern & Scale */}
        {entity.type === 'hatch' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Pattern
              </label>
              <select
                aria-label="Hatch Pattern"
                value={entity.pattern}
                onChange={(e) =>
                  onUpdateEntity(
                    { ...entity, pattern: e.target.value as HatchPattern },
                    'Change Hatch Pattern'
                  )
                }
                className={selectClass}
              >
                <option value="solid">Solid</option>
                <option value="diagonal">Diagonal</option>
                <option value="crosshatch">Crosshatch</option>
                <option value="brick">Brick</option>
                <option value="concrete">Concrete</option>
                <option value="insulation">Insulation</option>
              </select>
            </div>
          </>
        )}

        {/* Roof: Style & Slope */}
        {entity.type === 'roof' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Style
              </label>
              <select
                aria-label="Roof Style"
                value={entity.roofStyle}
                onChange={(e) => {
                  const style = e.target.value as RoofStyle;
                  onUpdateEntity(
                    { ...entity, roofStyle: style, edgeSlopes: entity.roofVersion === 2 ? defaultEdgeSlopes(entity.polygon, style, entity.ridgeAxis) : entity.edgeSlopes },
                    'Change Roof Style'
                  );
                }}
                className={selectClass}
              >
                <option value="flat">Flat</option>
                <option value="shed">Shed</option>
                <option value="gable">Gable</option>
                <option value="hip">Hip</option>
                <option value="mansard">Mansard</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-stone-600 dark:text-stone-300">
                Slope
              </label>
              <input
                type="text"
                aria-label="Roof Slope"
                title="Type rise:run (e.g. 4:12) or degrees (e.g. 30)"
                defaultValue={`${formatSlope(entity.slope)} · ${entity.slope.toFixed(1)}°`}
                key={`slope-${entity.id}-${entity.slope}`}
                onBlur={(e) => {
                  const deg = parseSlopeInput(e.target.value.split('·')[0]);
                  if (deg !== null && Math.abs(deg - entity.slope) > 1e-6) {
                    onUpdateEntity({ ...entity, slope: Math.max(0, Math.min(75, deg)) }, 'Change Roof Slope');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className={`w-28 px-2 py-0.5 text-xs font-mono text-right rounded border ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
          </>
        )}

        {/* Floor: Thickness */}
        {entity.type === 'floor' && (
          <QuickLengthField
            label="Thickness"
            inches={entity.thickness}
            units={units}
            darkMode={darkMode}
            onChange={(t) =>
              onUpdateEntity({ ...entity, thickness: t }, 'Update Floor Thickness')
            }
          />
        )}
      </div>

      {/* Quick Action Bar */}
      <div className="pt-1.5 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onMove}
          aria-label="Move Object (M)"
          title="Move (M)"
          className={`flex-1 py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
            darkMode
              ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
              : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
          }`}
        >
          <Move className="w-3 h-3" />
          <span>M</span>
        </button>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy Object (CO)"
          title="Copy (CO)"
          className={`flex-1 py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
            darkMode
              ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
              : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
          }`}
        >
          <Copy className="w-3 h-3" />
          <span>CO</span>
        </button>
        <button
          type="button"
          onClick={onRotate}
          aria-label="Rotate Object (RO)"
          title="Rotate (RO)"
          className={`flex-1 py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
            darkMode
              ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
              : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
          }`}
        >
          <RotateCw className="w-3 h-3" />
          <span>RO</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete Object (Del)"
          title="Delete (Del)"
          className={`flex-1 py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
            darkMode
              ? 'bg-red-950/60 hover:bg-red-900/80 text-red-300'
              : 'bg-red-50 hover:bg-red-100 text-red-600'
          }`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
