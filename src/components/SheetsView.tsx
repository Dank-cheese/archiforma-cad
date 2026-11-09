import { aspectRatio } from '../engine/camera';
import type { CameraEntity } from '../types/model';
import React, { useState, useRef } from 'react';
import {
  FilePlus2,
  Trash2,
  FileDown,
  Layers,
  Box,
  Table2,
  GripVertical,
  Maximize2,
} from 'lucide-react';
import {
  ArchModel,
  Point,
  SheetDefinition,
  SheetScalePreset,
  SheetSize,
  SheetViewport,
  SheetViewportKind,
  WallEntity,
  ElevationDirection,
} from '../types/model';
import {
  createStarterSheets,
  findFittingScale,
  generateSheetsPDF,
  getPlanViewportTransform,
  getScheduleTable,
  getSheetDimensionsMm,
  ScheduleKind,
  SHEET_SCALE_PRESETS,
  scheduleKindOfViewport,
  hasStructuralContent,
} from '../engine/documentation';
import { STRUCTURAL_DISCLAIMER } from '../engine/structure';
import { createStarterLevels } from '../engine/geometry';
import { PlanPrim, VIEWPORT_TITLE_BAR_MM } from '../engine/planPrimitives';

const SCALE_PRESETS: SheetScalePreset[] = SHEET_SCALE_PRESETS;

interface SheetsViewProps {
  model: ArchModel;
  onUpdateModel: (nextModel: ArchModel, actionLabel: string) => void;
  onChangeProjectName: (name: string) => void;
  capture3dDataUrl?: () => string | null;
  /** CAMERA views rendered as images (by camera id) for camera viewports and the PDF */
  cameraImages?: Record<string, string>;
  onLog: (text: string, kind?: 'input' | 'info' | 'error' | 'result') => void;
  darkMode: boolean;
}

export const SheetsView: React.FC<SheetsViewProps> = ({
  model,
  onUpdateModel,
  onChangeProjectName,
  capture3dDataUrl,
  cameraImages = {},
  onLog,
  darkMode,
}) => {
  const sheets =
    model.sheets && model.sheets.length > 0
      ? model.sheets
      : createStarterSheets();
  const activeSheetId = model.activeSheetId || sheets[0].id;
  const activeSheet =
    sheets.find((s) => s.id === activeSheetId) || sheets[0];

  const [selectedViewportId, setSelectedViewportId] = useState<string | null>(
    activeSheet.viewports[0]?.id || null
  );
  const [newSheetSize, setNewSheetSize] = useState<SheetSize>('A3');

  // Dragging / Resizing viewport on sheet
  const sheetSvgRef = useRef<SVGSVGElement | null>(null);
  const [dragState, setDragState] = useState<{
    vpId: string;
    mode: 'move' | 'resize';
    startMouseMm: Point;
    origVp: SheetViewport;
  } | null>(null);
  // Live geometry while dragging; committed to the model (one undo step) on mouse-up
  const [dragDraft, setDragDraft] = useState<SheetViewport | null>(null);

  const levels = model.levels ?? createStarterLevels();
  const sheetDims = getSheetDimensionsMm(activeSheet.size);

  const updateSheets = (
    nextSheets: SheetDefinition[],
    nextActiveId: string,
    label: string
  ) => {
    onUpdateModel(
      {
        ...model,
        sheets: nextSheets,
        activeSheetId: nextActiveId,
      },
      label
    );
  };

  const updateActiveSheet = (
    updater: (s: SheetDefinition) => SheetDefinition,
    label: string
  ) => {
    const nextSheets = sheets.map((s) =>
      s.id === activeSheet.id ? updater(s) : s
    );
    updateSheets(nextSheets, activeSheet.id, label);
  };

  const handleAddSheet = (size: SheetSize) => {
    const nextNum = `A10${sheets.length + 1}`;
    const today = new Date().toISOString().slice(0, 10);
    const newSheet: SheetDefinition = {
      id: `sheet-${Date.now()}`,
      sheetNumber: nextNum,
      title: `Architectural Sheet ${sheets.length + 1}`,
      size,
      date: today,
      scaleLabel: '1/4" = 1\'-0"',
      drawnBy: 'ARCHIFORMA BIM',
      checkedBy: 'Principal Architect',
      viewports: [
        {
          id: `vp-plan-${Date.now()}`,
          kind: 'plan',
          title: `${levels[0]?.name || 'Level 1'} — Floor Plan`,
          levelId: levels[0]?.id || 'level-1',
          scale: '1/4" = 1\'-0"',
          x: 18,
          y: 18,
          width: size === 'A1' ? 460 : 230,
          height: size === 'A1' ? 340 : 175,
        },
      ],
    };
    updateSheets(
      [...sheets, newSheet],
      newSheet.id,
      `Create ${size} Sheet ${nextNum}`
    );
    setSelectedViewportId(newSheet.viewports[0].id);
    onLog(`Created new ${size} sheet "${nextNum} — ${newSheet.title}".`, 'result');
  };

  const handleDeleteSheet = (sheetId: string) => {
    if (sheets.length <= 1) {
      onLog('Cannot delete the only sheet in the project.', 'error');
      return;
    }
    const remaining = sheets.filter((s) => s.id !== sheetId);
    const nextActive =
      sheetId === activeSheet.id ? remaining[0].id : activeSheet.id;
    updateSheets(remaining, nextActive, 'Delete Sheet');
    onLog('Deleted sheet.', 'info');
  };

  const computeSummaryScaleLabel = (vps: SheetViewport[]): string => {
    const plans = vps.filter((v) => isDrawingViewport(v.kind));
    if (plans.length === 0) return 'N.T.S.';
    const unique = Array.from(new Set(plans.map((v) => v.scale)));
    return unique.length === 1 ? unique[0] : 'As Noted';
  };

  const handlePlaceViewportOnSheet = (
    kind: SheetViewportKind,
    levelId?: string,
    dropPosMm?: Point,
    elevationDir?: ElevationDirection,
    sectionId?: string
  ) => {
    const lvl = levels.find((l) => l.id === levelId);
    const camera = kind === 'camera' ? (model.entities.find((e) => e.id === sectionId && e.type === 'camera') as CameraEntity | undefined) : undefined;
    const secName = (model.entities.find((e) => e.id === sectionId) as { name?: string } | undefined)?.name;
    const structTitles: Partial<Record<SheetViewportKind, string>> = {
      foundationplan: 'Foundation Plan',
      framingplan: `${lvl?.name || 'Level 2'} — Framing Plan`,
      section: secName || 'Structural Section',
      'schedule-footings': 'Footing Schedule',
      'schedule-columns': 'Column Schedule',
      'schedule-beams': 'Beam Schedule',
      'schedule-rebar': 'Rebar Schedule',
    };
    const title =
      camera ? camera.name : structTitles[kind] ? structTitles[kind]! : kind === 'elevation'
        ? `${(elevationDir || 'south').charAt(0).toUpperCase()}${(elevationDir || 'south').slice(1)} Elevation`
        : kind === 'roofplan'
        ? 'Roof Plan'
        : kind === 'plan'
        ? `${lvl?.name || 'Level 1'} — Floor Plan`
        : kind === '3d'
        ? '3D Isometric View'
        : kind === 'schedule-doors'
        ? 'Door Schedule'
        : kind === 'schedule-windows'
        ? 'Window Schedule'
        : 'Room Finish & Area Schedule';

    const camW = 160;
    const camH = camera ? Math.round(camW / aspectRatio(camera.aspect)) + 10 : 0;
    const defaultW = camera ? camW :
      kind === 'plan' || kind === 'roofplan' || kind === 'foundationplan' || kind === 'framingplan' ? 210 : kind === 'elevation' || kind === 'section' ? 190 : kind === '3d' ? 145 : 185;
    const defaultH = camera ? camH :
      kind === 'plan' || kind === 'roofplan' || kind === 'foundationplan' || kind === 'framingplan' ? 155 : kind === 'elevation' || kind === 'section' ? 105 : kind === '3d' ? 115 : 75;

    const offsetCount = activeSheet.viewports.length;
    const x = dropPosMm
      ? Math.max(12, Math.min(sheetDims.widthMm - defaultW - 12, dropPosMm.x - defaultW / 2))
      : 20 + (offsetCount % 3) * 24;
    const y = dropPosMm
      ? Math.max(12, Math.min(sheetDims.heightMm - defaultH - 12, dropPosMm.y - defaultH / 2))
      : 20 + (offsetCount % 3) * 20;

    const newVp: SheetViewport = {
      id: `vp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      title,
      levelId,
      ...(kind === 'elevation' ? { elevationDir: elevationDir || 'south' } : {}),
      ...(kind === 'section' ? { sectionId } : {}),
      ...(kind === 'camera' ? { cameraId: sectionId } : {}),
      scale: '1/4" = 1\'-0"',
      x: Math.round(x),
      y: Math.round(y),
      width: defaultW,
      height: defaultH,
    };

    updateActiveSheet((s) => {
      const nextVps = [...s.viewports, newVp];
      return {
        ...s,
        viewports: nextVps,
        scaleLabel: computeSummaryScaleLabel(nextVps),
      };
    }, `Place "${title}" on Sheet ${activeSheet.sheetNumber}`);

    setSelectedViewportId(newVp.id);
    onLog(`Placed "${title}" onto Sheet ${activeSheet.sheetNumber}.`, 'result');
  };

  const handleExportMultiPagePdf = () => {
    const threeImg = capture3dDataUrl ? capture3dDataUrl() : null;
    const pdfDoc = generateSheetsPDF(model, sheets, threeImg, cameraImages);
    const safeName =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma_sheets';
    pdfDoc.save(`${safeName}_sheets.pdf`);
    onLog(
      `Exported ${sheets.length}-page architectural PDF (${safeName}_sheets.pdf).`,
      'result'
    );
  };

  const clientToSheetMm = (clientX: number, clientY: number): Point => {
    const svg = sheetSvgRef.current;
    if (!svg) return { x: 20, y: 20 };
    const rect = svg.getBoundingClientRect();
    const rx = (clientX - rect.left) / Math.max(1, rect.width);
    const ry = (clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: rx * sheetDims.widthMm,
      y: ry * sheetDims.heightMm,
    };
  };

  const selectedViewport =
    activeSheet.viewports.find((v) => v.id === selectedViewportId) || null;

  return (
    <div
      className={`flex-1 h-full flex overflow-hidden select-none ${
        darkMode ? 'bg-stone-950 text-stone-100' : 'bg-stone-100 text-stone-900'
      }`}
      onMouseMove={(e) => {
        if (!dragState) return;
        const currMm = clientToSheetMm(e.clientX, e.clientY);
        const dx = currMm.x - dragState.startMouseMm.x;
        const dy = currMm.y - dragState.startMouseMm.y;
        const o = dragState.origVp;
        if (dragState.mode === 'move') {
          setDragDraft({
            ...o,
            x: Math.round(Math.max(10, Math.min(sheetDims.widthMm - o.width - 10, o.x + dx))),
            y: Math.round(Math.max(10, Math.min(sheetDims.heightMm - o.height - 10, o.y + dy))),
          });
        } else {
          setDragDraft({
            ...o,
            width: Math.round(Math.max(60, Math.min(sheetDims.widthMm - 10 - o.x, o.width + dx))),
            height: Math.round(Math.max(40, Math.min(sheetDims.heightMm - 10 - o.y, o.height + dy))),
          });
        }
      }}
      onMouseUp={() => {
        if (!dragState) return;
        const draft = dragDraft;
        const o = dragState.origVp;
        setDragState(null);
        setDragDraft(null);
        if (!draft || (draft.x === o.x && draft.y === o.y && draft.width === o.width && draft.height === o.height)) return;
        updateActiveSheet(
          (sh) => ({ ...sh, viewports: sh.viewports.map((v) => (v.id === draft.id ? { ...v, x: draft.x, y: draft.y, width: draft.width, height: draft.height } : v)) }),
          dragState.mode === 'move' ? `Move Viewport "${draft.title}"` : `Resize Viewport "${draft.title}"`
        );
      }}
      onMouseLeave={() => {
        if (dragState) {
          setDragState(null);
          setDragDraft(null);
        }
      }}
    >
      {/* Left Sidebar: Sheet List + Drag-and-Drop View & Schedule Palette */}
      <aside
        className={`w-72 border-r flex flex-col shrink-0 overflow-y-auto ${
          darkMode
            ? 'bg-stone-900 border-stone-800'
            : 'bg-white border-stone-200'
        }`}
      >
        {/* 1. Sheets Manager */}
        <div className="p-3.5 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-stone-400">
              Document Sheets ({sheets.length})
            </span>
          </div>

          <div className="space-y-1.5 mb-3">
            {sheets.map((s) => {
              const isActive = s.id === activeSheet.id;
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    updateSheets(sheets, s.id, `Switch to Sheet ${s.sheetNumber}`);
                    setSelectedViewportId(s.viewports[0]?.id || null);
                  }}
                  className={`px-2.5 py-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    isActive
                      ? 'border-amber-600 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : darkMode
                      ? 'border-stone-800 bg-stone-950/60 hover:bg-stone-800'
                      : 'border-stone-200 bg-stone-50 hover:bg-stone-100'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs">
                        {s.sheetNumber}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-stone-500/15">
                        {s.size}
                      </span>
                    </div>
                    <div className="text-xs truncate opacity-90">{s.title}</div>
                  </div>
                  {sheets.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSheet(s.id);
                      }}
                      title="Delete Sheet"
                      className="p-1 rounded hover:bg-red-500/15 text-stone-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* New Sheet Creator */}
          <div className="flex items-center gap-1.5">
            <select
              aria-label="New Sheet Size"
              value={newSheetSize}
              onChange={(e) => setNewSheetSize(e.target.value as SheetSize)}
              className={`px-2 py-1.5 rounded-md border text-xs font-mono ${
                darkMode
                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                  : 'bg-stone-50 border-stone-200 text-stone-800'
              }`}
            >
              <option value="A3">A3 (420×297mm)</option>
              <option value="Tabloid">Tabloid (17"×11")</option>
              <option value="A1">A1 (841×594mm)</option>
            </select>
            <button
              type="button"
              onClick={() => handleAddSheet(newSheetSize)}
              className="flex-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center gap-1 cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>New Sheet</span>
            </button>
          </div>
        </div>

        {/* 2. Drag Views & Schedules onto Sheet */}
        <div className="p-3.5 border-b border-stone-200 dark:border-stone-800">
          <div className="text-[11px] font-mono uppercase tracking-wider font-bold text-stone-400 mb-1">
            Drag Views onto Sheet
          </div>
          <p className="text-[11px] text-stone-500 mb-2.5">
            Drag any Plan, 3D View, or Schedule onto the sheet canvas (or click +).
          </p>

          <div className="space-y-1.5">
            {/* Plan Views per Level */}
            {levels.map((lvl) => (
              <div
                key={lvl.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/archiforma-viewport',
                    JSON.stringify({ kind: 'plan', levelId: lvl.id })
                  );
                }}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                  darkMode
                    ? 'border-stone-800 bg-stone-950 hover:border-amber-500/50'
                    : 'border-stone-200 bg-stone-50 hover:border-amber-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                  <Layers className="w-3.5 h-3.5 text-amber-600" />
                  <span className="font-medium">{lvl.name} — Floor Plan</span>
                </div>
                <button
                  type="button"
                  onClick={() => handlePlaceViewportOnSheet('plan', lvl.id)}
                  className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
                >
                  + Place
                </button>
              </div>
            ))}

            {/* 3D Isometric View */}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/archiforma-viewport',
                  JSON.stringify({ kind: '3d' })
                );
              }}
              className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                darkMode
                  ? 'border-stone-800 bg-stone-950 hover:border-amber-500/50'
                  : 'border-stone-200 bg-stone-50 hover:border-amber-500'
              }`}
            >
              <div className="flex items-center gap-2">
                <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                <Box className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-medium">3D Building View</span>
              </div>
              <button
                type="button"
                onClick={() => handlePlaceViewportOnSheet('3d')}
                className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
              >
                + Place
              </button>
            </div>

            {/* CAMERA views (perspective images) */}
            {model.entities
              .filter((e): e is CameraEntity => e.type === 'camera')
              .map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/archiforma-viewport', JSON.stringify({ kind: 'camera', sectionId: c.id }));
                  }}
                  className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                    darkMode ? 'border-stone-800 bg-stone-950 hover:border-amber-500/50' : 'border-stone-200 bg-stone-50 hover:border-amber-500'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                    {cameraImages[c.id] ? <img src={cameraImages[c.id]} alt="" className="w-8 h-5 object-cover rounded" /> : <Box className="w-3.5 h-3.5 text-blue-600" />}
                    <span className="font-medium truncate">{c.name}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Place ${c.name}`}
                    onClick={() => handlePlaceViewportOnSheet('camera', undefined, undefined, undefined, c.id)}
                    className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
                  >
                    + Place
                  </button>
                </div>
              ))}

            {/* Elevations & Roof Plan */}
            {(
              [
                { kind: 'elevation', dir: 'north', label: 'North Elevation' },
                { kind: 'elevation', dir: 'south', label: 'South Elevation' },
                { kind: 'elevation', dir: 'east', label: 'East Elevation' },
                { kind: 'elevation', dir: 'west', label: 'West Elevation' },
                { kind: 'roofplan', dir: undefined, label: 'Roof Plan' },
              ] as const
            ).map((item) => (
              <div
                key={item.label}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/archiforma-viewport',
                    JSON.stringify({ kind: item.kind, elevationDir: item.dir })
                  );
                }}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                  darkMode
                    ? 'border-stone-800 bg-stone-950 hover:border-amber-500/50'
                    : 'border-stone-200 bg-stone-50 hover:border-amber-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                  <Layers className="w-3.5 h-3.5 text-orange-600" />
                  <span className="font-medium">{item.label}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Place ${item.label}`}
                  onClick={() => handlePlaceViewportOnSheet(item.kind, undefined, undefined, item.dir)}
                  className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
                >
                  + Place
                </button>
              </div>
            ))}

            {/* Structure: foundation plan, framing plans, sections, structural schedules */}
            <div className="pt-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">Structure</div>
            {(
              [
                { kind: 'foundationplan' as SheetViewportKind, label: 'Foundation Plan', levelId: undefined as string | undefined, sectionId: undefined as string | undefined },
                ...levels.map((l) => ({ kind: 'framingplan' as SheetViewportKind, label: `${l.name} — Framing Plan`, levelId: l.id as string | undefined, sectionId: undefined as string | undefined })),
                ...model.entities.filter((e) => e.type === 'section').map((e) => ({ kind: 'section' as SheetViewportKind, label: (e as { name: string }).name, levelId: undefined as string | undefined, sectionId: e.id as string | undefined })),
                { kind: 'schedule-footings' as SheetViewportKind, label: 'Footing Schedule', levelId: undefined, sectionId: undefined },
                { kind: 'schedule-columns' as SheetViewportKind, label: 'Column Schedule', levelId: undefined, sectionId: undefined },
                { kind: 'schedule-beams' as SheetViewportKind, label: 'Beam Schedule', levelId: undefined, sectionId: undefined },
                { kind: 'schedule-rebar' as SheetViewportKind, label: 'Rebar Schedule', levelId: undefined, sectionId: undefined },
              ]
            ).map((item) => (
              <div
                key={`${item.kind}-${item.levelId || ''}-${item.sectionId || ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/archiforma-viewport', JSON.stringify({ kind: item.kind, levelId: item.levelId, sectionId: item.sectionId }));
                }}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                  darkMode ? 'border-stone-800 bg-stone-950 hover:border-blue-500/50' : 'border-stone-200 bg-stone-50 hover:border-blue-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                  {item.kind.startsWith('schedule') ? <Table2 className="w-3.5 h-3.5 text-blue-700" /> : <Layers className="w-3.5 h-3.5 text-blue-700" />}
                  <span className="font-medium">{item.label}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Place ${item.label}`}
                  onClick={() => handlePlaceViewportOnSheet(item.kind, item.levelId, undefined, undefined, item.sectionId)}
                  className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
                >
                  + Place
                </button>
              </div>
            ))}

            {/* Schedules */}
            {(
              [
                { kind: 'schedule-rooms', label: 'Room Schedule' },
                { kind: 'schedule-doors', label: 'Door Schedule' },
                { kind: 'schedule-windows', label: 'Window Schedule' },
              ] as const
            ).map((item) => (
              <div
                key={item.kind}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/archiforma-viewport',
                    JSON.stringify({ kind: item.kind })
                  );
                }}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between text-xs cursor-grab active:cursor-grabbing ${
                  darkMode
                    ? 'border-stone-800 bg-stone-950 hover:border-amber-500/50'
                    : 'border-stone-200 bg-stone-50 hover:border-amber-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-stone-400" />
                  <Table2 className="w-3.5 h-3.5 text-sky-600" />
                  <span className="font-medium">{item.label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handlePlaceViewportOnSheet(item.kind)}
                  className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-bold cursor-pointer"
                >
                  + Place
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Selected Viewport Scale & Title Block Inspector */}
        <div className="p-3.5 space-y-3 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-wider font-bold text-stone-400">
            Title Block &amp; Scale
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <label className="block text-[11px] text-stone-500 mb-0.5">
                Project Name
              </label>
              <input
                type="text"
                value={model.projectName}
                onChange={(e) => onChangeProjectName(e.target.value)}
                className={`w-full px-2 py-1.5 rounded border text-xs ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-200 text-stone-900'
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-stone-500 mb-0.5">
                  Sheet Number
                </label>
                <input
                  type="text"
                  value={activeSheet.sheetNumber}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateActiveSheet(
                      (s) => ({ ...s, sheetNumber: val }),
                      'Edit Sheet Number'
                    );
                  }}
                  className={`w-full px-2 py-1.5 rounded border font-mono text-xs ${
                    darkMode
                      ? 'bg-stone-950 border-stone-700 text-stone-100'
                      : 'bg-stone-50 border-stone-200 text-stone-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-[11px] text-stone-500 mb-0.5">
                  Paper Size
                </label>
                <select
                  value={activeSheet.size}
                  onChange={(e) => {
                    const sz = e.target.value as SheetSize;
                    updateActiveSheet(
                      (s) => ({ ...s, size: sz }),
                      `Change Sheet Size to ${sz}`
                    );
                  }}
                  className={`w-full px-2 py-1.5 rounded border font-mono text-xs ${
                    darkMode
                      ? 'bg-stone-950 border-stone-700 text-stone-100'
                      : 'bg-stone-50 border-stone-200 text-stone-900'
                  }`}
                >
                  <option value="A3">A3</option>
                  <option value="Tabloid">Tabloid</option>
                  <option value="A1">A1</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-stone-500 mb-0.5">
                Sheet Title
              </label>
              <input
                type="text"
                value={activeSheet.title}
                onChange={(e) => {
                  const val = e.target.value;
                  updateActiveSheet(
                    (s) => ({ ...s, title: val }),
                    'Edit Sheet Title'
                  );
                }}
                className={`w-full px-2 py-1.5 rounded border text-xs ${
                  darkMode
                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                    : 'bg-stone-50 border-stone-200 text-stone-900'
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-stone-500 mb-0.5">
                  Issue Date
                </label>
                <input
                  type="text"
                  value={activeSheet.date}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateActiveSheet(
                      (s) => ({ ...s, date: val }),
                      'Edit Sheet Date'
                    );
                  }}
                  className={`w-full px-2 py-1.5 rounded border font-mono text-xs ${
                    darkMode
                      ? 'bg-stone-950 border-stone-700 text-stone-100'
                      : 'bg-stone-50 border-stone-200 text-stone-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-[11px] text-stone-500 mb-0.5">
                  Sheet Scale
                </label>
                <input
                  type="text"
                  value={activeSheet.scaleLabel}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateActiveSheet(
                      (s) => ({ ...s, scaleLabel: val }),
                      'Edit Sheet Scale'
                    );
                  }}
                  className={`w-full px-2 py-1.5 rounded border font-mono text-xs ${
                    darkMode
                      ? 'bg-stone-950 border-stone-700 text-stone-100'
                      : 'bg-stone-50 border-stone-200 text-stone-900'
                  }`}
                />
              </div>
            </div>
          </div>

          {selectedViewport && (
            <div
              className={`p-2.5 rounded-lg border mt-3 space-y-2 ${
                darkMode
                  ? 'bg-stone-950 border-stone-800'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                  Selected Viewport
                </span>
                <button
                  type="button"
                  onClick={() => {
                    updateActiveSheet((s) => {
                      const nextVps = s.viewports.filter(
                        (v) => v.id !== selectedViewport.id
                      );
                      return {
                        ...s,
                        viewports: nextVps,
                        scaleLabel: computeSummaryScaleLabel(nextVps),
                      };
                    }, 'Remove Viewport from Sheet');
                    setSelectedViewportId(null);
                  }}
                  className="text-[11px] text-red-500 hover:underline cursor-pointer"
                >
                  Remove
                </button>
              </div>

              <div className="text-xs font-medium truncate">
                {selectedViewport.title}
              </div>

              <div>
                <label className="block text-[11px] text-stone-500 mb-0.5">
                  Viewport Scale
                </label>
                <select
                  aria-label="Viewport Scale"
                  value={selectedViewport.scale}
                  onChange={(e) => {
                    const nextScale = e.target.value as SheetScalePreset;
                    updateActiveSheet((s) => {
                      const nextVps = s.viewports.map((v) =>
                        v.id === selectedViewport.id
                          ? { ...v, scale: nextScale }
                          : v
                      );
                      return {
                        ...s,
                        viewports: nextVps,
                        scaleLabel: computeSummaryScaleLabel(nextVps),
                      };
                    }, `Set Viewport Scale to ${nextScale}`);
                  }}
                  className={`w-full px-2 py-1.5 rounded border font-mono text-xs ${
                    darkMode
                      ? 'bg-stone-900 border-stone-700 text-stone-100'
                      : 'bg-white border-stone-200 text-stone-900'
                  }`}
                >
                  {SCALE_PRESETS.map((sc) => (
                    <option key={sc} value={sc}>
                      {sc}
                    </option>
                  ))}
                </select>
                {isDrawingViewport(selectedViewport.kind) &&
                  (() => {
                    const t = getPlanViewportTransform(model, selectedViewport);
                    if (t.fits) {
                      return (
                        <p className="mt-1 text-[11px] text-emerald-600">
                          Plotted at true scale ({Math.round(t.requiredMm.w)} × {Math.round(t.requiredMm.h)} mm on paper).
                        </p>
                      );
                    }
                    const fit = findFittingScale(model, selectedViewport);
                    return (
                      <div className="mt-1.5 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
                        <p>
                          At {selectedViewport.scale} the plan needs {Math.round(t.requiredMm.w)} × {Math.round(t.requiredMm.h)} mm, but the
                          viewport is {Math.round(t.contentBox.w)} × {Math.round(t.contentBox.h)} mm. The view is clipped.
                        </p>
                        {fit && (
                          <button
                            type="button"
                            className="mt-1 px-2 py-0.5 rounded bg-red-700 text-white font-semibold hover:bg-red-800 cursor-pointer"
                            onClick={() =>
                              updateActiveSheet((s) => {
                                const nextVps = s.viewports.map((v) => (v.id === selectedViewport.id ? { ...v, scale: fit } : v));
                                return { ...s, viewports: nextVps, scaleLabel: computeSummaryScaleLabel(nextVps) };
                              }, `Fit Viewport Scale (${fit})`)
                            }
                          >
                            Use {fit}
                          </button>
                        )}
                      </div>
                    );
                  })()}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Sheet Preview & Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Sheet Action Bar */}
        <div
          className={`px-6 py-3 border-b flex items-center justify-between gap-4 shrink-0 ${
            darkMode
              ? 'bg-stone-900/90 border-stone-800'
              : 'bg-white border-stone-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-xs font-bold">
              {activeSheet.sheetNumber}
            </span>
            <h2 className="text-sm font-bold">{activeSheet.title}</h2>
            <span className="text-xs text-stone-400 font-mono">
              ({sheetDims.label} — Scale: {activeSheet.scaleLabel})
            </span>
          </div>

          <button
            type="button"
            onClick={handleExportMultiPagePdf}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>Export Multi-Page PDF ({sheets.length} {sheets.length === 1 ? 'Sheet' : 'Sheets'})</span>
          </button>
        </div>

        {/* Interactive Sheet Paper Canvas */}
        <div
          className="flex-1 overflow-auto p-6 flex items-center justify-center"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData('application/archiforma-viewport');
            if (!raw) return;
            try {
              const data = JSON.parse(raw) as {
                kind: SheetViewportKind;
                levelId?: string;
                elevationDir?: ElevationDirection;
                sectionId?: string;
              };
              const dropMm = clientToSheetMm(e.clientX, e.clientY);
              handlePlaceViewportOnSheet(data.kind, data.levelId, dropMm, data.elevationDir, data.sectionId);
            } catch {
              // ignore invalid drop
            }
          }}
        >
          <div
            style={{ aspectRatio: `${sheetDims.widthMm} / ${sheetDims.heightMm}` }}
            className="w-full max-w-5xl bg-white text-stone-900 shadow-xl border border-stone-300 rounded-sm relative">
            <svg
              ref={sheetSvgRef}
              viewBox={`0 0 ${sheetDims.widthMm} ${sheetDims.heightMm}`}
              className="w-full h-full block select-none"
            >
              {/* Paper Background */}
              <rect
                x={0}
                y={0}
                width={sheetDims.widthMm}
                height={sheetDims.heightMm}
                fill="#ffffff"
              />

              {/* Outer Architectural Sheet Margin Border */}
              <rect
                x={10}
                y={10}
                width={sheetDims.widthMm - 20}
                height={sheetDims.heightMm - 20}
                fill="none"
                stroke="#1c1917"
                strokeWidth={0.7}
              />
              <rect
                x={11.5}
                y={11.5}
                width={sheetDims.widthMm - 23}
                height={sheetDims.heightMm - 23}
                fill="none"
                stroke="#1c1917"
                strokeWidth={0.25}
              />

              {/* Structural coordination disclaimer (also printed on the PDF) */}
              {hasStructuralContent(model) && (
                <text x={13} y={sheetDims.heightMm - 12.2} fontSize={2.3} fontWeight="bold" fill="#b91c1c" fontFamily="Helvetica, Arial, sans-serif">
                  NOTE: {STRUCTURAL_DISCLAIMER}
                </text>
              )}

              {/* Placed Viewports */}
              {activeSheet.viewports.map((committedVp) => {
                const vp = dragDraft && dragDraft.id === committedVp.id ? dragDraft : committedVp;
                const isSelected = vp.id === selectedViewportId;
                const planT = isDrawingViewport(vp.kind) ? getPlanViewportTransform(model, vp) : null;
                const scaleText = isDrawingViewport(vp.kind) ? `Scale: ${vp.scale}` : vp.kind === '3d' ? 'Scale: N.T.S.' : '';
                return (
                  <g
                    key={vp.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedViewportId(vp.id);
                    }}
                  >
                    {renderSheetViewportSvg(model, vp, planT, cameraImages)}

                    {/* Selection & Drag Header */}
                    <rect
                      x={vp.x}
                      y={vp.y}
                      width={vp.width}
                      height={vp.height}
                      fill="none"
                      stroke={isSelected ? '#d97706' : '#a8a29e'}
                      strokeWidth={isSelected ? 0.8 : 0.3}
                      strokeDasharray={isSelected ? 'none' : '2,1'}
                    />

                    {/* Drag-to-move bar at bottom title strip */}
                    <rect
                      x={vp.x}
                      y={vp.y + vp.height - 8}
                      width={vp.width}
                      height={8}
                      fill={isSelected ? '#fef3c7' : '#f5f5f4'}
                      stroke={isSelected ? '#d97706' : '#a8a29e'}
                      strokeWidth={0.3}
                      className="cursor-move"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedViewportId(vp.id);
                        setDragState({
                          vpId: vp.id,
                          mode: 'move',
                          startMouseMm: clientToSheetMm(e.clientX, e.clientY),
                          origVp: vp,
                        });
                      }}
                    />
                    <text
                      x={vp.x + 3}
                      y={vp.y + vp.height - 2.6}
                      fontSize={3.2}
                      fontWeight="bold"
                      fill="#1c1917"
                      className="pointer-events-none"
                    >
                      {vp.title}
                    </text>
                    <text
                      x={vp.x + vp.width - 3}
                      y={vp.y + vp.height - 2.6}
                      fontSize={2.8}
                      fill="#57534e"
                      textAnchor="end"
                      className="pointer-events-none"
                    >
                      {scaleText}
                    </text>
                    {planT && !planT.fits && (
                      <text
                        x={vp.x + vp.width * 0.62}
                        y={vp.y + vp.height - 2.6}
                        fontSize={2.2}
                        fontWeight="bold"
                        fill="#b91c1c"
                        className="pointer-events-none"
                      >
                        CLIPPED AT THIS SCALE
                      </text>
                    )}

                    {/* Bottom-right corner resize handle */}
                    {isSelected && (
                      <rect
                        x={vp.x + vp.width - 4}
                        y={vp.y + vp.height - 12}
                        width={4}
                        height={4}
                        fill="#d97706"
                        className="cursor-nwse-resize"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            vpId: vp.id,
                            mode: 'resize',
                            startMouseMm: clientToSheetMm(e.clientX, e.clientY),
                            origVp: vp,
                          });
                        }}
                      />
                    )}
                  </g>
                );
              })}

              {/* Architectural Title Block in Bottom-Right Corner */}
              {(() => {
                const W = sheetDims.widthMm;
                const H = sheetDims.heightMm;
                const tbW = Math.min(145, W * 0.35);
                const tbH = 52;
                const tbX = W - 11.5 - tbW;
                const tbY = H - 11.5 - tbH;
                const numBoxW = 36;

                return (
                  <g>
                    <rect
                      x={tbX}
                      y={tbY}
                      width={tbW}
                      height={tbH}
                      fill="#fafaf9"
                      stroke="#1c1917"
                      strokeWidth={0.5}
                    />
                    <line
                      x1={tbX}
                      y1={tbY + 14}
                      x2={tbX + tbW}
                      y2={tbY + 14}
                      stroke="#1c1917"
                      strokeWidth={0.3}
                    />
                    <line
                      x1={tbX}
                      y1={tbY + 28}
                      x2={tbX + tbW}
                      y2={tbY + 28}
                      stroke="#1c1917"
                      strokeWidth={0.3}
                    />
                    <line
                      x1={tbX}
                      y1={tbY + 40}
                      x2={tbX + tbW}
                      y2={tbY + 40}
                      stroke="#1c1917"
                      strokeWidth={0.3}
                    />
                    <line
                      x1={tbX + tbW - numBoxW}
                      y1={tbY + 28}
                      x2={tbX + tbW - numBoxW}
                      y2={tbY + tbH}
                      stroke="#1c1917"
                      strokeWidth={0.3}
                    />

                    <text
                      x={tbX + 3}
                      y={tbY + 4.5}
                      fontSize={2.6}
                      fontWeight="bold"
                      fill="#b45309"
                    >
                      ARCHIFORMA BIM DOCUMENTATION
                    </text>
                    <text
                      x={tbX + 3}
                      y={tbY + 11}
                      fontSize={4.2}
                      fontWeight="bold"
                      fill="#1c1917"
                    >
                      {model.projectName}
                    </text>

                    <text x={tbX + 3} y={tbY + 18.2} fontSize={2.3} fill="#78716c">
                      SHEET TITLE
                    </text>
                    <text
                      x={tbX + 3}
                      y={tbY + 24.5}
                      fontSize={3.8}
                      fontWeight="bold"
                      fill="#1c1917"
                    >
                      {activeSheet.title}
                    </text>

                    <text x={tbX + 3} y={tbY + 32} fontSize={2.2} fill="#78716c">
                      DATE
                    </text>
                    <text x={tbX + 44} y={tbY + 32} fontSize={2.2} fill="#78716c">
                      SCALE
                    </text>
                    <text x={tbX + 82} y={tbY + 32} fontSize={2.2} fill="#78716c">
                      SIZE
                    </text>

                    <text
                      x={tbX + 3}
                      y={tbY + 37.5}
                      fontSize={3.1}
                      fontWeight="bold"
                      fill="#1c1917"
                    >
                      {activeSheet.date}
                    </text>
                    <text
                      x={tbX + 44}
                      y={tbY + 37.5}
                      fontSize={3.1}
                      fontWeight="bold"
                      fill="#1c1917"
                    >
                      {activeSheet.scaleLabel}
                    </text>
                    <text
                      x={tbX + 82}
                      y={tbY + 37.5}
                      fontSize={3.1}
                      fontWeight="bold"
                      fill="#1c1917"
                    >
                      {activeSheet.size}
                    </text>

                    <text x={tbX + 3} y={tbY + 46.5} fontSize={2.5} fill="#57534e">
                      DRAWN BY: {activeSheet.drawnBy || 'ARCHIFORMA'}
                    </text>

                    <text
                      x={tbX + tbW - numBoxW + 3}
                      y={tbY + 32.5}
                      fontSize={2.2}
                      fill="#78716c"
                    >
                      SHEET NO.
                    </text>
                    <text
                      x={tbX + tbW - numBoxW / 2}
                      y={tbY + 46.5}
                      fontSize={6.5}
                      fontWeight="bold"
                      fill="#1c1917"
                      textAnchor="middle"
                    >
                      {activeSheet.sheetNumber}
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Capitalised cap-height (paper mm) -> SVG font-size (paper mm). Matches the PDF (Helvetica). */
const capToFont = (mm: number) => mm / 0.72;

function PrimsSvg({ prims, toPaper, mmPerIn }: { prims: PlanPrim[]; toPaper: (p: Point) => Point; mmPerIn: number }) {
  return (
    <>
      {prims.map((p, i) => {
        if (p.k === 'text') {
          const pt = toPaper(p.p);
          return (
            <text
              key={i}
              x={pt.x}
              y={pt.y}
              fontSize={capToFont(p.size)}
              fontFamily="Helvetica, Arial, sans-serif"
              fontWeight={p.bold ? 'bold' : 'normal'}
              fill={p.color}
              textAnchor={p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}
              dominantBaseline="central"
              transform={p.rot ? `rotate(${p.rot} ${pt.x} ${pt.y})` : undefined}
            >
              {p.text}
            </text>
          );
        }
        const common = {
          ...(p.opacity !== undefined && p.opacity < 1 ? { fillOpacity: p.opacity, strokeOpacity: p.opacity } : {}),
          stroke: p.stroke && p.w > 0 ? p.stroke : 'none',
          strokeWidth: p.w,
          fill: p.fill || 'none',
          strokeDasharray: p.dash && p.dash.length ? p.dash.join(',') : undefined,
          strokeLinejoin: 'round' as const,
        };
        if (p.k === 'circle') {
          const c = toPaper(p.c);
          return <circle key={i} cx={c.x} cy={c.y} r={Math.max(0.05, p.r * mmPerIn)} {...common} />;
        }
        const pts = p.pts.map(toPaper).map((q) => `${q.x},${q.y}`).join(' ');
        return p.closed ? <polygon key={i} points={pts} {...common} /> : <polyline key={i} points={pts} {...common} fill="none" />;
      })}
    </>
  );
}

/** Viewports drawn from vector primitives at an exact scale (plans, elevations, roof plans). */
const isDrawingViewport = (k: SheetViewportKind) => k === 'plan' || k === 'elevation' || k === 'roofplan' || k === 'foundationplan' || k === 'framingplan' || k === 'section';

function renderSheetViewportSvg(model: ArchModel, vp: SheetViewport, planT?: ReturnType<typeof getPlanViewportTransform> | null, cameraImages: Record<string, string> = {}) {
  const { x, y, width, height } = vp;
  const contentH = Math.max(4, height - VIEWPORT_TITLE_BAR_MM);

  if (vp.kind === 'camera') {
    const img = cameraImages[vp.cameraId || ''];
    const cam = model.entities.find((e) => e.id === vp.cameraId);
    return (
      <g className="pointer-events-none" data-testid={`sheet-camera-${vp.cameraId}`}>
        <rect x={x} y={y} width={width} height={contentH} fill="#f5f5f4" />
        {img ? (
          <image href={img} x={x + 1} y={y + 1} width={width - 2} height={contentH - 2} preserveAspectRatio="xMidYMid meet" />
        ) : (
          <text x={x + width / 2} y={y + contentH / 2} fontSize={3} textAnchor="middle" fill="#78716c">
            {cam ? 'Rendering camera view…' : 'Camera deleted'}
          </text>
        )}
      </g>
    );
  }

  if (isDrawingViewport(vp.kind)) {
    const t = planT || getPlanViewportTransform(model, vp);
    const clipId = `vp-clip-${vp.id}`;
    return (
      <g>
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={width} height={contentH} />
          </clipPath>
        </defs>
        <rect x={x} y={y} width={width} height={contentH} fill="#ffffff" />
        <g clipPath={`url(#${clipId})`} className="pointer-events-none">
          <PrimsSvg prims={t.prims} toPaper={t.toPaper} mmPerIn={t.mmPerIn} />
        </g>
      </g>
    );
  }

  if (vp.kind === '3d') {
    const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
    const levels = model.levels ?? createStarterLevels();
    const cos30 = Math.cos(Math.PI / 6);
    const iso = (wx: number, wy: number, wz: number): Point => ({ x: (wx - wy) * cos30, y: (wx + wy) * 0.5 - wz });
    const quads = walls.map((w) => {
      const lvl = levels.find((l) => l.id === (w.levelId || 'level-1'));
      const z0 = (lvl?.elevation || 0) + (w.baseOffset || 0);
      const z1 = z0 + (w.height || 108);
      return { id: w.id, pts: [iso(w.start.x, w.start.y, z0), iso(w.end.x, w.end.y, z0), iso(w.end.x, w.end.y, z1), iso(w.start.x, w.start.y, z1)] };
    });
    const all = quads.flatMap((q) => q.pts);
    if (all.length === 0) return <g />;
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    const s = Math.min((width - 10) / Math.max(1, maxX - minX), (contentH - 10) / Math.max(1, maxY - minY));
    const ox = x + width / 2 - ((minX + maxX) / 2) * s;
    const oy = y + contentH / 2 - ((minY + maxY) / 2) * s;
    return (
      <g className="pointer-events-none">
        {quads.map((q) => (
          <polygon
            key={q.id}
            points={q.pts.map((p) => `${ox + p.x * s},${oy + p.y * s}`).join(' ')}
            fill="#e7e5e4"
            fillOpacity={0.75}
            stroke="#292524"
            strokeWidth={0.28}
          />
        ))}
      </g>
    );
  }

  // Schedule table — same layout rules as the PDF (fit rows, truncate cells, report overflow)
  const kind: ScheduleKind = scheduleKindOfViewport(vp.kind) || 'rooms';
  const table = getScheduleTable(model, kind);
  const all = [table.headers, ...table.rows];
  const tx = x + 2;
  const ty = y + 2;
  const tw = width - 4;
  const th = contentH - 4;
  const rowH = Math.max(3.6, Math.min(5.5, th / Math.max(1, all.length)));
  const shown = Math.min(all.length, Math.max(1, Math.floor(th / rowH)));
  const hidden = all.length - shown;
  const totalW = table.weights.reduce((a, b) => a + b, 0) || 1;
  const colW = table.weights.map((wt) => (tw * wt) / totalW);
  const fontPt = Math.min(6, Math.max(4.2, rowH * 1.25));
  const fontMm = fontPt * 0.352778;
  const fitText = (s: string, maxW: number) => {
    const maxChars = Math.max(1, Math.floor(maxW / (fontMm * 0.52)));
    return s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 2))}...` : s;
  };
  return (
    <g className="pointer-events-none">
      {all.slice(0, shown).map((r, ri) => {
        const ry = ty + ri * rowH;
        let cx = tx;
        return (
          <g key={ri}>
            <rect x={tx} y={ry} width={tw} height={rowH} fill={ri === 0 ? '#e7e5e4' : '#ffffff'} stroke="#d6d3d1" strokeWidth={0.15} />
            {colW.map((cw, ci) => {
              const cellX = cx;
              cx += cw;
              return (
                <g key={ci}>
                  {ci > 0 && <line x1={cellX} y1={ry} x2={cellX} y2={ry + rowH} stroke="#d6d3d1" strokeWidth={0.15} />}
                  <text
                    x={cellX + 1}
                    y={ry + rowH / 2}
                    fontSize={fontMm}
                    fontFamily="Helvetica, Arial, sans-serif"
                    fontWeight={ri === 0 ? 'bold' : 'normal'}
                    fill="#1c1917"
                    dominantBaseline="central"
                  >
                    {fitText(r[ci] || '', cw - 2)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      {hidden > 0 && (
        <text x={x + width * 0.62} y={y + height - 2.6} fontSize={2} fontWeight="bold" fill="#b91c1c">
          +{hidden} MORE ROWS - ENLARGE VIEWPORT
        </text>
      )}
    </g>
  );
}
