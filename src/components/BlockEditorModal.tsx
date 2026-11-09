import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Check, Boxes } from 'lucide-react';
import {
  ArchEntity,
  BlockDefinition,
  UnitSystem,
} from '../types/model';
import {
  describeSvgArc,
  formatLength,
  parseLengthInput,
} from '../engine/geometry';

interface BlockEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  blocks: BlockDefinition[];
  initialBlockId?: string | null;
  units: UnitSystem;
  onSaveBlock: (updatedBlock: BlockDefinition) => void;
  darkMode: boolean;
}

const COLOR_SWATCHES = [
  '#6366f1',
  '#0d9488',
  '#b45309',
  '#0284c7',
  '#0891b2',
  '#38bdf8',
  '#78716c',
  '#64748b',
  '#475569',
  '#92400e',
  '#15803d',
  '#dc2626',
];

export const BlockEditorModal: React.FC<BlockEditorModalProps> = ({
  isOpen,
  onClose,
  blocks,
  initialBlockId,
  units,
  onSaveBlock,
  darkMode,
}) => {
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [widthStr, setWidthStr] = useState<string>('');
  const [depthStr, setDepthStr] = useState<string>('');
  const [heightStr, setHeightStr] = useState<string>('');
  const [color, setColor] = useState<string>('#0d9488');
  const [entities, setEntities] = useState<ArchEntity[]>([]);

  // Load selected block into editor state
  const loadBlockIntoDraft = (blk: BlockDefinition) => {
    setSelectedBlockId(blk.id);
    setName(blk.name);
    setWidthStr(formatLength(blk.width, units));
    setDepthStr(formatLength(blk.depth, units));
    setHeightStr(formatLength(blk.height, units));
    setColor(blk.color);
    setEntities(blk.entities.map((e) => ({ ...e })));
  };

  useEffect(() => {
    if (!isOpen || blocks.length === 0) return;
    const target =
      blocks.find((b) => b.id === initialBlockId) || blocks[0];
    if (target) {
      loadBlockIntoDraft(target);
    }
  }, [isOpen, initialBlockId, blocks.length]);

  if (!isOpen || blocks.length === 0) return null;

  const activeBlock =
    blocks.find((b) => b.id === selectedBlockId) || blocks[0];

  const parsedW = Math.max(
    4,
    parseLengthInput(widthStr, units) ?? activeBlock.width
  );
  const parsedD = Math.max(
    4,
    parseLengthInput(depthStr, units) ?? activeBlock.depth
  );
  const parsedH = Math.max(
    2,
    parseLengthInput(heightStr, units) ?? activeBlock.height
  );

  const handleAddPrimitive = (kind: 'rectangle' | 'line' | 'circle') => {
    const id = `be-${kind}-${Date.now()}`;
    if (kind === 'rectangle') {
      const hw = Math.round(parsedW * 0.35);
      const hd = Math.round(parsedD * 0.35);
      setEntities((prev) => [
        ...prev,
        {
          id,
          type: 'rectangle',
          layer: 'A-FURN',
          p1: { x: -hw, y: -hd },
          p2: { x: hw, y: hd },
        },
      ]);
    } else if (kind === 'line') {
      const hw = Math.round(parsedW * 0.4);
      setEntities((prev) => [
        ...prev,
        {
          id,
          type: 'line',
          layer: 'A-FURN',
          start: { x: -hw, y: 0 },
          end: { x: hw, y: 0 },
        },
      ]);
    } else if (kind === 'circle') {
      const r = Math.max(3, Math.round(Math.min(parsedW, parsedD) * 0.25));
      setEntities((prev) => [
        ...prev,
        {
          id,
          type: 'circle',
          layer: 'A-FURN',
          center: { x: 0, y: 0 },
          radius: r,
        },
      ]);
    }
  };

  const handleFitPrimitivesToBounds = () => {
    const sx = parsedW / Math.max(1, activeBlock.width);
    const sy = parsedD / Math.max(1, activeBlock.depth);
    setEntities((prev) =>
      prev.map((ent) => {
        if (ent.type === 'rectangle') {
          return {
            ...ent,
            p1: { x: ent.p1.x * sx, y: ent.p1.y * sy },
            p2: { x: ent.p2.x * sx, y: ent.p2.y * sy },
          };
        }
        if (ent.type === 'line') {
          return {
            ...ent,
            start: { x: ent.start.x * sx, y: ent.start.y * sy },
            end: { x: ent.end.x * sx, y: ent.end.y * sy },
          };
        }
        if (ent.type === 'circle' || ent.type === 'arc') {
          return {
            ...ent,
            center: { x: ent.center.x * sx, y: ent.center.y * sy },
            radius: ent.radius * ((sx + sy) / 2),
          };
        }
        return ent;
      })
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: BlockDefinition = {
      ...activeBlock,
      name: name.trim() || activeBlock.name,
      width: parsedW,
      depth: parsedD,
      height: parsedH,
      color,
      entities,
    };
    onSaveBlock(updated);
    onClose();
  };

  const viewSpan = Math.max(parsedW, parsedD, 36) * 0.72;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bedit-modal-title"
    >
      <div
        className={`w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          darkMode
            ? 'bg-stone-900 border-stone-700 text-stone-100'
            : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Boxes className="w-5 h-5 text-amber-600" />
            <div>
              <h2 id="bedit-modal-title" className="text-sm font-bold">
                Block Editor (BE / BEDIT)
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Edit block geometry, 3D dimensions, and material color — all placed instances update automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
            aria-label="Close Block Editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
          {/* Block Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1">
                Select Block Definition
              </label>
              <select
                value={selectedBlockId}
                onChange={(e) => {
                  const found = blocks.find((b) => b.id === e.target.value);
                  if (found) loadBlockIntoDraft(found);
                }}
                className={`w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border focus:outline-none focus:border-amber-600 ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              >
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.category})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1">
                Block Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border focus:outline-none focus:border-amber-600 ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
          </div>

          {/* 3D Dimensions & Color */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">
                Width (X)
              </label>
              <input
                type="text"
                value={widthStr}
                onChange={(e) => setWidthStr(e.target.value)}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">
                Depth (Y)
              </label>
              <input
                type="text"
                value={depthStr}
                onChange={(e) => setDepthStr(e.target.value)}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">
                Height (3D Z)
              </label>
              <input
                type="text"
                value={heightStr}
                onChange={(e) => setHeightStr(e.target.value)}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-300 text-stone-900'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">
                Material Color
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                />
                <div className="flex flex-wrap gap-1">
                  {COLOR_SWATCHES.slice(0, 6).map((sw) => (
                    <button
                      key={sw}
                      type="button"
                      onClick={() => setColor(sw)}
                      style={{ backgroundColor: sw }}
                      className={`w-4 h-4 rounded-xs border cursor-pointer ${
                        color.toLowerCase() === sw.toLowerCase()
                          ? 'ring-2 ring-amber-500 border-white'
                          : 'border-black/20'
                      }`}
                      title={`Color ${sw}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 2D Symbol Preview + Primitive List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Live 2D SVG Preview */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                  2D Symbol Preview (Origin at 0,0)
                </span>
                <button
                  type="button"
                  onClick={handleFitPrimitivesToBounds}
                  className="text-[11px] text-amber-600 hover:text-amber-700 font-medium cursor-pointer"
                >
                  Scale 2D to Width×Depth
                </button>
              </div>
              <div
                className={`h-52 rounded-lg border flex items-center justify-center overflow-hidden ${
                  darkMode
                    ? 'bg-stone-950 border-stone-800'
                    : 'bg-[#f8f7f4] border-stone-200'
                }`}
              >
                <svg
                  viewBox={`${-viewSpan} ${-viewSpan} ${viewSpan * 2} ${viewSpan * 2}`}
                  className="w-full h-full"
                >
                  {/* Origin crosshair */}
                  <line
                    x1={-viewSpan}
                    y1={0}
                    x2={viewSpan}
                    y2={0}
                    stroke={darkMode ? '#292524' : '#e7e5e4'}
                    strokeWidth={viewSpan * 0.012}
                  />
                  <line
                    x1={0}
                    y1={-viewSpan}
                    x2={0}
                    y2={viewSpan}
                    stroke={darkMode ? '#292524' : '#e7e5e4'}
                    strokeWidth={viewSpan * 0.012}
                  />
                  {/* Overall Width x Depth dashed envelope */}
                  <rect
                    x={-parsedW / 2}
                    y={-parsedD / 2}
                    width={parsedW}
                    height={parsedD}
                    fill="none"
                    stroke="#d97706"
                    strokeWidth={viewSpan * 0.015}
                    strokeDasharray={`${viewSpan * 0.04},${viewSpan * 0.03}`}
                    opacity={0.55}
                  />
                  {/* Block 2D Primitives */}
                  {entities.map((ent) => {
                    if (ent.type === 'rectangle') {
                      const x = Math.min(ent.p1.x, ent.p2.x);
                      const y = Math.min(ent.p1.y, ent.p2.y);
                      const w = Math.abs(ent.p2.x - ent.p1.x);
                      const h = Math.abs(ent.p2.y - ent.p1.y);
                      return (
                        <rect
                          key={ent.id}
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={`${color}22`}
                          stroke={color}
                          strokeWidth={viewSpan * 0.022}
                        />
                      );
                    }
                    if (ent.type === 'line') {
                      return (
                        <line
                          key={ent.id}
                          x1={ent.start.x}
                          y1={ent.start.y}
                          x2={ent.end.x}
                          y2={ent.end.y}
                          stroke={color}
                          strokeWidth={viewSpan * 0.022}
                        />
                      );
                    }
                    if (ent.type === 'circle') {
                      return (
                        <circle
                          key={ent.id}
                          cx={ent.center.x}
                          cy={ent.center.y}
                          r={ent.radius}
                          fill={`${color}22`}
                          stroke={color}
                          strokeWidth={viewSpan * 0.022}
                        />
                      );
                    }
                    if (ent.type === 'arc') {
                      return (
                        <path
                          key={ent.id}
                          d={describeSvgArc(
                            ent.center,
                            ent.radius,
                            ent.startAngle,
                            ent.endAngle
                          )}
                          fill="none"
                          stroke={color}
                          strokeWidth={viewSpan * 0.022}
                        />
                      );
                    }
                    return null;
                  })}
                </svg>
              </div>
            </div>

            {/* 2D Primitives Editor */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                  2D Symbol Primitives ({entities.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAddPrimitive('rectangle')}
                    className="px-2 py-0.5 text-[11px] font-medium rounded border border-stone-300 dark:border-stone-700 hover:border-amber-600 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Rect
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddPrimitive('line')}
                    className="px-2 py-0.5 text-[11px] font-medium rounded border border-stone-300 dark:border-stone-700 hover:border-amber-600 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Line
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddPrimitive('circle')}
                    className="px-2 py-0.5 text-[11px] font-medium rounded border border-stone-300 dark:border-stone-700 hover:border-amber-600 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Circle
                  </button>
                </div>
              </div>

              <div
                className={`h-52 overflow-y-auto rounded-lg border p-2 space-y-1.5 ${
                  darkMode
                    ? 'bg-stone-950 border-stone-800'
                    : 'bg-stone-50 border-stone-200'
                }`}
              >
                {entities.map((ent, idx) => (
                  <div
                    key={ent.id}
                    className={`px-2 py-1.5 rounded border text-xs flex items-center justify-between gap-2 ${
                      darkMode
                        ? 'bg-stone-900 border-stone-800'
                        : 'bg-white border-stone-200'
                    }`}
                  >
                    <span className="font-mono text-[11px] truncate">
                      {idx + 1}. {ent.type.toUpperCase()}
                      {ent.type === 'rectangle' &&
                        ` (${Math.round(Math.abs(ent.p2.x - ent.p1.x))}"×${Math.round(
                          Math.abs(ent.p2.y - ent.p1.y)
                        )}")`}
                      {ent.type === 'circle' && ` (R=${Math.round(ent.radius)}")`}
                    </span>
                    {entities.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setEntities((prev) =>
                            prev.filter((item) => item.id !== ent.id)
                          )
                        }
                        className="text-stone-400 hover:text-red-500 p-0.5 cursor-pointer"
                        title="Remove primitive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                darkMode
                  ? 'border-stone-700 hover:bg-stone-800 text-stone-300'
                  : 'border-stone-300 hover:bg-stone-100 text-stone-700'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save & Update All Instances</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
