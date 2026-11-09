import React, { useState } from 'react';
import { X, Check, Sliders, Type, ArrowRight, Ruler } from 'lucide-react';
import { DimensionArrowType, DimStyleSettings, UnitSystem, WallFace } from '../types/model';
import { formatLength } from '../engine/geometry';

interface DimStyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: DimStyleSettings;
  units: UnitSystem;
  onSave: (updated: DimStyleSettings) => void;
  darkMode: boolean;
}

export const DimStyleModal: React.FC<DimStyleModalProps> = ({
  isOpen,
  onClose,
  settings,
  units,
  onSave,
  darkMode,
}) => {
  const [draft, setDraft] = useState<DimStyleSettings>(settings);

  // Sync draft when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setDraft(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleApply = () => {
    onSave(draft);
    onClose();
  };

  // Preview dimensions for the mini interactive canvas
  const previewText = formatLength(144, units); // sample 12'-0"
  const isTick = draft.arrowType === 'tick';
  const isArrow = draft.arrowType === 'arrow';
  const isOpenArrow = draft.arrowType === 'open-arrow';
  const isDot = draft.arrowType === 'dot';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dimstyle-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className={`w-full max-w-xl rounded-xl shadow-2xl border flex flex-col overflow-hidden ${
          darkMode
            ? 'bg-stone-900 border-stone-800 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50/60'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Ruler className="w-4 h-4" />
            </div>
            <div>
              <h2 id="dimstyle-title" className="text-sm font-semibold tracking-tight">
                Dimension Style Manager (DIMSTYLE)
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Configure architectural dimension ticks, font height, overshoot & precision
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* Live Dimension Preview */}
          <div
            className={`p-4 rounded-lg border flex flex-col items-center justify-center ${
              darkMode ? 'bg-stone-950/70 border-stone-800' : 'bg-stone-50 border-stone-200'
            }`}
          >
            <div className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 mb-2 self-start uppercase tracking-wider">
              Style Preview
            </div>
            <svg
              viewBox="0 0 320 80"
              className="w-full max-w-xs h-20 overflow-visible select-none"
            >
              {/* Reference base line */}
              <line
                x1="40"
                y1="65"
                x2="280"
                y2="65"
                stroke={darkMode ? '#44403c' : '#d6d3d1'}
                strokeWidth="1.5"
                strokeDasharray="4,4"
              />
              <circle cx="40" cy="65" r="2.5" fill="#f59e0b" />
              <circle cx="280" cy="65" r="2.5" fill="#f59e0b" />

              {/* Extension lines with overshoot */}
              <line
                x1="40"
                y1="65"
                x2="40"
                y2={30 - draft.extensionOvershoot * 1.5}
                stroke={darkMode ? '#a8a29e' : '#57534e'}
                strokeWidth="1.2"
              />
              <line
                x1="280"
                y1="65"
                x2="280"
                y2={30 - draft.extensionOvershoot * 1.5}
                stroke={darkMode ? '#a8a29e' : '#57534e'}
                strokeWidth="1.2"
              />

              {/* Dimension line */}
              <line
                x1="40"
                y1="30"
                x2="280"
                y2="30"
                stroke={darkMode ? '#a8a29e' : '#57534e'}
                strokeWidth="1.5"
              />

              {/* Arrowheads / Ticks */}
              {isTick && (
                <>
                  <line
                    x1={40 - 6}
                    y1={30 + 6}
                    x2={40 + 6}
                    y2={30 - 6}
                    stroke={darkMode ? '#f59e0b' : '#d97706'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1={280 - 6}
                    y1={30 + 6}
                    x2={280 + 6}
                    y2={30 - 6}
                    stroke={darkMode ? '#f59e0b' : '#d97706'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </>
              )}
              {isArrow && (
                <>
                  <polygon
                    points="40,30 48,26 48,34"
                    fill={darkMode ? '#f59e0b' : '#d97706'}
                  />
                  <polygon
                    points="280,30 272,26 272,34"
                    fill={darkMode ? '#f59e0b' : '#d97706'}
                  />
                </>
              )}
              {isOpenArrow && (
                <>
                  <polyline
                    points="48,26 40,30 48,34"
                    fill="none"
                    stroke={darkMode ? '#f59e0b' : '#d97706'}
                    strokeWidth="1.8"
                  />
                  <polyline
                    points="272,26 280,30 272,34"
                    fill="none"
                    stroke={darkMode ? '#f59e0b' : '#d97706'}
                    strokeWidth="1.8"
                  />
                </>
              )}
              {isDot && (
                <>
                  <circle cx="40" cy="30" r="3.5" fill={darkMode ? '#f59e0b' : '#d97706'} />
                  <circle cx="280" cy="30" r="3.5" fill={darkMode ? '#f59e0b' : '#d97706'} />
                </>
              )}

              {/* Dimension label badge */}
              <g transform="translate(160, 30)">
                <rect
                  x="-36"
                  y="-10"
                  width="72"
                  height="20"
                  rx="3"
                  fill={darkMode ? '#1c1917' : '#ffffff'}
                  stroke={darkMode ? '#44403c' : '#e7e5e4'}
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fontSize={Math.max(9, draft.textHeight * 1.2)}
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                  fill={darkMode ? '#f5f5f4' : '#1c1917'}
                >
                  {previewText}
                </text>
              </g>
            </svg>
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Arrow Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Arrow / Terminator Style
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'tick', label: 'Arch. Tick (45°)' },
                  { id: 'arrow', label: 'Filled Arrow' },
                  { id: 'open-arrow', label: 'Open Arrow' },
                  { id: 'dot', label: 'Dot / Circle' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        arrowType: opt.id as DimensionArrowType,
                      }))
                    }
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border text-left transition-colors cursor-pointer ${
                      draft.arrowType === opt.id
                        ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Height */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Text Height (inches)
              </label>
              <div className="flex items-center gap-2">
                {[6, 8, 10, 12].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, textHeight: sz }))}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium border flex-1 cursor-pointer transition-colors ${
                      draft.textHeight === sz
                        ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    {sz}"
                  </button>
                ))}
              </div>
            </div>

            {/* Extension Line Overshoot */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Extension Line Overshoot
              </label>
              <div className="flex items-center gap-2">
                {[2, 4, 6].map((ov) => (
                  <button
                    key={ov}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, extensionOvershoot: ov }))}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium border flex-1 cursor-pointer transition-colors ${
                      draft.extensionOvershoot === ov
                        ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    {ov}"
                  </button>
                ))}
              </div>
            </div>

            {/* Baseline Spacing */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Baseline Dimension Spacing (DBA)
              </label>
              <div className="flex items-center gap-2">
                {[12, 18, 24].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, baselineSpacing: sp }))}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium border flex-1 cursor-pointer transition-colors ${
                      draft.baselineSpacing === sp
                        ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    {sp}"
                  </button>
                ))}
              </div>
            </div>

            {/* Wall Face Preference */}
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Wall Face Measuring (Tab key cycles on canvas)
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'auto', label: 'Auto-detect Face' },
                  { id: 'centerline', label: 'Centerline' },
                  { id: 'interior', label: 'Interior Face' },
                  { id: 'exterior', label: 'Exterior Face' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        preferFace: opt.id as 'auto' | WallFace,
                      }))
                    }
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border text-center transition-colors cursor-pointer ${
                      draft.preferFace === opt.id
                        ? 'bg-amber-500/10 border-amber-600 text-amber-600 dark:text-amber-400 font-semibold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-end gap-2.5 px-5 py-3 border-t ${
            darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50/60'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
              darkMode ? 'text-stone-400 hover:text-stone-200' : 'text-stone-600 hover:text-stone-800'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply Style</span>
          </button>
        </div>
      </div>
    </div>
  );
};
