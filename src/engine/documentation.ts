import { jsPDF } from 'jspdf';
import { beamSchedule, columnSchedule, footingSchedule, rebarSchedule, STRUCTURAL_DISCLAIMER } from './structure';
import {
  ArchEntity,
  ArchModel,
  ArcEntity,
  CircleEntity,
  DoorEntity,
  DoorSwing,
  FloorEntity,
  HatchEntity,
  Layer,
  LevelDefinition,
  LineEntity,
  Point,
  PolylineEntity,
  RoomEntity,
  SheetDefinition,
  SheetScalePreset,
  SheetSize,
  SheetViewport,
  TagEntity,
  TextEntity,
  WallEntity,
  WindowEntity,
  SheetViewportKind,
} from '../types/model';
import {
  add,
  angleDegRaw,
  computeLinearDimGeometry,
  computePolygonAreaAndPerimeter,
  computeRadialDimGeometry,
  computeStairPlanGeometry,
  computeWallPlanPolygons,
  createDefaultLayers,
  createStarterBlocks,
  createStarterLevels,
  dist,
  formatArea,
  formatLength,
  getBlockWorldPrimitives,
  lerpPoint,
  midpoint,
  normalize,
  perpLeft,
  polygonArea,
  polygonCentroid,
  rotatePoint,
  scale,
  segmentIntersection,
  sub,
} from './geometry';
import {
  computePlanViewportTransform,
  PlanPrim,
  PlanViewportTransform,
  VIEWPORT_TITLE_BAR_MM,
} from './planPrimitives';

// ============================================================================
// 1. SCHEDULES (DOOR, WINDOW, ROOM) & CSV EXPORT
// ============================================================================

export interface DoorScheduleRow {
  id: string;
  mark: string;
  typeName: string;
  doorTypeId: string;
  levelId: string;
  levelName: string;
  width: number; // inches
  height: number; // inches
  swing: DoorSwing;
  wallName: string;
  comments: string;
}

export interface WindowScheduleRow {
  id: string;
  mark: string;
  typeName: string;
  windowTypeId: string;
  levelId: string;
  levelName: string;
  width: number; // inches
  height: number; // inches
  sillHeight: number; // inches
  wallName: string;
  comments: string;
}

export interface RoomScheduleRow {
  id: string;
  mark: string;
  name: string;
  levelId: string;
  levelName: string;
  areaSqIn: number;
  perimeterIn: number;
  areaFormatted: string;
  perimeterFormatted: string;
  floorMaterial: 'wood' | 'tile' | 'concrete' | 'stone';
  comments: string;
}

export function getDoorScheduleRows(model: ArchModel): DoorScheduleRow[] {
  const levels = model.levels ?? createStarterLevels();
  const doorTypes = model.doorTypes ?? [];
  const wallTypes = model.wallTypes ?? [];
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  const tags = model.entities.filter(
    (e): e is TagEntity => e.type === 'tag' && e.targetType === 'door'
  );
  const doors = model.entities.filter((e): e is DoorEntity => e.type === 'door');

  return doors.map((door, idx) => {
    const tag = tags.find((t) => t.targetId === door.id);
    const mark = door.mark || tag?.tagNumber || `D${idx + 1}`;
    const dt = doorTypes.find((t) => t.id === door.doorTypeId);
    const hostWall = walls.find((w) => w.id === door.wallId);
    const levelId = door.levelId || hostWall?.levelId || 'level-1';
    const lvl = levels.find((l) => l.id === levelId);
    const wt = wallTypes.find((w) => w.id === hostWall?.wallTypeId);

    return {
      id: door.id,
      mark,
      typeName: dt?.name || `Custom ${door.width}" × ${door.height}"`,
      doorTypeId: door.doorTypeId || '',
      levelId,
      levelName: lvl?.name || 'Level 1',
      width: door.width,
      height: door.height,
      swing: door.swing,
      wallName: wt?.name || (hostWall ? `${hostWall.thickness}" Wall` : 'Wall'),
      comments: door.comments || '',
    };
  });
}

export function getWindowScheduleRows(model: ArchModel): WindowScheduleRow[] {
  const levels = model.levels ?? createStarterLevels();
  const windowTypes = model.windowTypes ?? [];
  const wallTypes = model.wallTypes ?? [];
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  const tags = model.entities.filter(
    (e): e is TagEntity => e.type === 'tag' && e.targetType === 'window'
  );
  const windows = model.entities.filter((e): e is WindowEntity => e.type === 'window');

  return windows.map((win, idx) => {
    const tag = tags.find((t) => t.targetId === win.id);
    const mark = win.mark || tag?.tagNumber || `W${idx + 1}`;
    const wt = windowTypes.find((t) => t.id === win.windowTypeId);
    const hostWall = walls.find((w) => w.id === win.wallId);
    const levelId = win.levelId || hostWall?.levelId || 'level-1';
    const lvl = levels.find((l) => l.id === levelId);
    const wallType = wallTypes.find((w) => w.id === hostWall?.wallTypeId);

    return {
      id: win.id,
      mark,
      typeName: wt?.name || `Custom ${win.width}" × ${win.height}"`,
      windowTypeId: win.windowTypeId || '',
      levelId,
      levelName: lvl?.name || 'Level 1',
      width: win.width,
      height: win.height,
      sillHeight: win.sillHeight,
      wallName: wallType?.name || (hostWall ? `${hostWall.thickness}" Wall` : 'Wall'),
      comments: win.comments || '',
    };
  });
}

export function getRoomScheduleRows(model: ArchModel): RoomScheduleRow[] {
  const levels = model.levels ?? createStarterLevels();
  const tags = model.entities.filter(
    (e): e is TagEntity => e.type === 'tag' && e.targetType === 'room'
  );
  const rooms = model.entities.filter((e): e is RoomEntity => e.type === 'room');

  return rooms.map((room, idx) => {
    const tag = tags.find((t) => t.targetId === room.id);
    const mark = room.mark || tag?.tagNumber || `${101 + idx}`;
    const levelId = room.levelId || 'level-1';
    const lvl = levels.find((l) => l.id === levelId);
    const { area, perimeter } = computePolygonAreaAndPerimeter(room.polygon);

    return {
      id: room.id,
      mark,
      name: room.name,
      levelId,
      levelName: lvl?.name || 'Level 1',
      areaSqIn: area,
      perimeterIn: perimeter,
      areaFormatted: formatArea(area, model.settings.units),
      perimeterFormatted: formatLength(perimeter, model.settings.units),
      floorMaterial: room.floorMaterial || 'wood',
      comments: room.comments || '',
    };
  });
}

/**
 * Scales a RoomEntity polygon proportionally around its centroid so its area matches `targetAreaSqIn`.
 * Also detaches `wallIds` so manual area overrides aren't immediately reverted by wall auto-sync.
 */
export function scaleRoomToTargetArea(
  room: RoomEntity,
  targetAreaSqIn: number
): RoomEntity {
  const currentArea = polygonArea(room.polygon);
  if (currentArea < 1 || targetAreaSqIn <= 0) return room;
  const factor = Math.sqrt(targetAreaSqIn / currentArea);
  const center = polygonCentroid(room.polygon);
  const nextPolygon = room.polygon.map((pt) => ({
    x: center.x + (pt.x - center.x) * factor,
    y: center.y + (pt.y - center.y) * factor,
  }));
  return {
    ...room,
    wallIds: [], // convert to custom boundary so the user's edited area persists
    polygon: nextPolygon,
    labelPos: center,
  };
}

// ----------------------------------------------------------------------------
// Schedule tables shared by the Schedules tab, CSV export and sheet/PDF tables
// ----------------------------------------------------------------------------

export type ScheduleKind = 'doors' | 'windows' | 'rooms' | 'footings' | 'columns' | 'beams' | 'rebar';

export const STRUCTURAL_SCHEDULE_KINDS: ScheduleKind[] = ['footings', 'columns', 'beams', 'rebar'];
export const isStructuralSchedule = (k: ScheduleKind) => STRUCTURAL_SCHEDULE_KINDS.includes(k);

/** Sheet viewport kind -> schedule kind (null when the viewport is not a schedule). */
export function scheduleKindOfViewport(k: SheetViewportKind): ScheduleKind | null {
  const m: Partial<Record<SheetViewportKind, ScheduleKind>> = {
    'schedule-doors': 'doors',
    'schedule-windows': 'windows',
    'schedule-rooms': 'rooms',
    'schedule-footings': 'footings',
    'schedule-columns': 'columns',
    'schedule-beams': 'beams',
    'schedule-rebar': 'rebar',
  };
  return m[k] ?? null;
}

/** True when the model has structural content (for the coordination disclaimer on exports). */
export function hasStructuralContent(model: ArchModel): boolean {
  return model.entities.some((e) => ['footing', 'beam', 'beamsystem', 'rebar', 'areareinf', 'connection', 'sjoint', 'load', 'section'].includes(e.type) || (e.type === 'wall' && e.structural) || (e.type === 'floor' && (e.structural || e.foundation)));
}

export interface ScheduleTable {
  title: string;
  headers: string[];
  rows: string[][];
  /** Relative column widths used when laying the table out on a sheet. */
  weights: number[];
}

const SWING_LABEL: Record<DoorSwing, string> = {
  'left-in': 'Left / In',
  'right-in': 'Right / In',
  'left-out': 'Left / Out',
  'right-out': 'Right / Out',
};

export function getScheduleTable(model: ArchModel, kind: ScheduleKind): ScheduleTable {
  const units = model.settings.units;
  const lenUnit = units === 'metric' ? 'mm' : 'ft-in';
  const fmtL = (v: number) => formatLength(v, units);
  if (kind === 'footings') return footingSchedule(model, fmtL);
  if (kind === 'columns') return columnSchedule(model, fmtL);
  if (kind === 'beams') return beamSchedule(model, fmtL);
  if (kind === 'rebar') return rebarSchedule(model, fmtL);
  if (kind === 'doors') {
    return {
      title: 'Door Schedule',
      headers: ['Mark', 'Door Type', 'Level', `Width (${lenUnit})`, `Height (${lenUnit})`, 'Swing', 'Host Wall', 'Comments'],
      weights: [0.7, 2.2, 1, 1, 1, 1, 1.6, 1.6],
      rows: getDoorScheduleRows(model).map((r) => [
        r.mark,
        r.typeName,
        r.levelName,
        formatLength(r.width, units),
        formatLength(r.height, units),
        SWING_LABEL[r.swing] || r.swing,
        r.wallName,
        r.comments,
      ]),
    };
  }
  if (kind === 'windows') {
    return {
      title: 'Window Schedule',
      headers: ['Mark', 'Window Type', 'Level', `Width (${lenUnit})`, `Height (${lenUnit})`, `Sill Height (${lenUnit})`, 'Host Wall', 'Comments'],
      weights: [0.7, 2.2, 1, 1, 1, 1.1, 1.6, 1.4],
      rows: getWindowScheduleRows(model).map((r) => [
        r.mark,
        r.typeName,
        r.levelName,
        formatLength(r.width, units),
        formatLength(r.height, units),
        formatLength(r.sillHeight, units),
        r.wallName,
        r.comments,
      ]),
    };
  }
  return {
    title: 'Room Schedule',
    headers: ['Number', 'Room Name', 'Level', `Area (${units === 'metric' ? 'm²' : 'sq ft'})`, `Perimeter (${lenUnit})`, 'Floor Finish', 'Comments'],
    weights: [0.8, 2, 1, 1.1, 1.2, 1, 1.6],
    rows: getRoomScheduleRows(model).map((r) => [
      r.mark,
      r.name,
      r.levelName,
      r.areaFormatted,
      r.perimeterFormatted,
      r.floorMaterial,
      r.comments,
    ]),
  };
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** RFC 4180 CSV (CRLF line endings). Prefix with a UTF-8 BOM when saving so Excel reads ², × etc. */
export function exportScheduleToCSV(model: ArchModel, scheduleType: ScheduleKind): string {
  const t = getScheduleTable(model, scheduleType);
  const rows = [t.headers, ...t.rows];
  if (isStructuralSchedule(scheduleType)) rows.push([], [`NOTE: ${STRUCTURAL_DISCLAIMER}`]);
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

// ============================================================================
// 2. ARCHITECTURAL SHEETS, SCALES & MULTI-PAGE PDF EXPORT (jsPDF)
// ============================================================================

export function getSheetDimensionsMm(size: SheetSize): {
  widthMm: number;
  heightMm: number;
  label: string;
} {
  switch (size) {
    case 'A3':
      return { widthMm: 420, heightMm: 297, label: 'A3 Landscape (420 × 297 mm)' };
    case 'Tabloid':
      return { widthMm: 431.8, heightMm: 279.4, label: 'Tabloid / ANSI B (17" × 11")' };
    case 'A1':
      return { widthMm: 841, heightMm: 594, label: 'A1 Landscape (841 × 594 mm)' };
    default:
      return { widthMm: 420, heightMm: 297, label: 'A3 Landscape (420 × 297 mm)' };
  }
}

/** All view scales offered on sheets, from largest (most detailed) to smallest. */
export const SHEET_SCALE_PRESETS: SheetScalePreset[] = [
  '1/2" = 1\'-0"',
  '1:50',
  '1/4" = 1\'-0"',
  '3/16" = 1\'-0"',
  '1/8" = 1\'-0"',
  '1:100',
  '1:200',
];

/**
 * Returns the physical paper-to-model scale ratio.
 * Example: '1/4" = 1\'-0"' -> 0.25" on paper represents 12" in model -> ratio = 1/48.
 * '1:50' -> ratio = 1/50 = 0.02.
 */
export function getScaleRatio(scalePreset: SheetScalePreset): number {
  switch (scalePreset) {
    case '1/2" = 1\'-0"':
      return 0.5 / 12; // 1/24
    case '1/4" = 1\'-0"':
      return 0.25 / 12; // 1/48
    case '3/16" = 1\'-0"':
      return 0.1875 / 12; // 1/64
    case '1/8" = 1\'-0"':
      return 0.125 / 12; // 1/96
    case '1:50':
      return 1 / 50;
    case '1:100':
      return 1 / 100;
    case '1:200':
      return 1 / 200;
    default:
      return 1 / 48;
  }
}

export function modelInchesToSheetMm(modelInches: number, scalePreset: SheetScalePreset): number {
  return modelInches * 25.4 * getScaleRatio(scalePreset);
}

/** Plan viewport transform at the viewport's exact scale (never silently shrunk). */
export function getPlanViewportTransform(model: ArchModel, vp: SheetViewport): PlanViewportTransform {
  return computePlanViewportTransform(model, vp, getScaleRatio(vp.scale));
}

/**
 * Largest standard scale at which the plan fits inside the viewport (prefers the project's
 * unit family: imperial architectural scales or metric ratios). Returns null if none fit.
 */
export function findFittingScale(model: ArchModel, vp: SheetViewport): SheetScalePreset | null {
  const metric = model.settings.units === 'metric';
  const family = SHEET_SCALE_PRESETS.filter((s) => (metric ? s.startsWith('1:') : !s.startsWith('1:')));
  const ordered = [...family, ...SHEET_SCALE_PRESETS.filter((s) => !family.includes(s))];
  ordered.sort((a, b) => getScaleRatio(b) - getScaleRatio(a));
  const preferred = ordered.filter((s) => family.includes(s));
  for (const s of preferred) {
    if (computePlanViewportTransform(model, vp, getScaleRatio(s)).fits) return s;
  }
  for (const s of ordered) {
    if (computePlanViewportTransform(model, vp, getScaleRatio(s)).fits) return s;
  }
  return null;
}

export function createStarterSheets(): SheetDefinition[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      id: 'sheet-a101',
      sheetNumber: 'A101',
      title: 'Floor Plan, 3D Isometric & Schedules',
      size: 'A3',
      date: today,
      scaleLabel: '1/4" = 1\'-0"',
      drawnBy: 'ARCHIFORMA BIM',
      checkedBy: 'Principal Architect',
      viewports: [
        {
          id: 'vp-plan-l1',
          kind: 'plan',
          title: 'Level 1 — Floor Plan',
          levelId: 'level-1',
          scale: '1/4" = 1\'-0"',
          x: 16,
          y: 16,
          width: 235,
          height: 175,
        },
        {
          id: 'vp-3d-main',
          kind: '3d',
          title: '3D Isometric Massing View',
          scale: '1/8" = 1\'-0"',
          x: 258,
          y: 16,
          width: 146,
          height: 112,
        },
        {
          id: 'vp-sched-rooms',
          kind: 'schedule-rooms',
          title: 'Room Finish & Area Schedule',
          scale: '1/4" = 1\'-0"',
          x: 16,
          y: 198,
          width: 235,
          height: 76,
        },
        {
          id: 'vp-sched-doors',
          kind: 'schedule-doors',
          title: 'Door Schedule',
          scale: '1/4" = 1\'-0"',
          x: 258,
          y: 134,
          width: 146,
          height: 72,
        },
      ],
    },
    {
      id: 'sheet-a201',
      sheetNumber: 'A201',
      title: 'Exterior Elevations & Roof Plan',
      size: 'A3',
      date: today,
      scaleLabel: 'As Noted',
      drawnBy: 'ARCHIFORMA BIM',
      checkedBy: 'Principal Architect',
      viewports: [
        { id: 'vp-elev-s', kind: 'elevation', elevationDir: 'south', title: 'South Elevation', scale: '1/4" = 1\'-0"', x: 16, y: 16, width: 246, height: 135 },
        { id: 'vp-elev-e', kind: 'elevation', elevationDir: 'east', title: 'East Elevation', scale: '1/8" = 1\'-0"', x: 268, y: 16, width: 136, height: 100 },
        { id: 'vp-roofplan', kind: 'roofplan', title: 'Roof Plan', scale: '3/16" = 1\'-0"', x: 16, y: 158, width: 246, height: 128 },
        { id: 'vp-elev-w', kind: 'elevation', elevationDir: 'west', title: 'West Elevation', scale: '1/8" = 1\'-0"', x: 268, y: 122, width: 136, height: 100 },
      ],
    },
    {
      id: 'sheet-s101',
      sheetNumber: 'S101',
      title: 'Foundation & Framing Plans, Section, Schedules',
      size: 'A3',
      date: today,
      scaleLabel: 'As Noted',
      drawnBy: 'ARCHIFORMA BIM',
      checkedBy: 'Structural Engineer of Record',
      viewports: [
        { id: 'vp-fdn', kind: 'foundationplan', title: 'Foundation Plan', levelId: 'level-1', scale: '1/8" = 1\'-0"', x: 14, y: 16, width: 132, height: 108 },
        { id: 'vp-frm', kind: 'framingplan', title: 'Level 2 — Framing Plan', levelId: 'level-2', scale: '1/8" = 1\'-0"', x: 149, y: 16, width: 132, height: 108 },
        { id: 'vp-sec2', kind: 'section', sectionId: 'sec-2', title: 'Section 2', scale: '1:100', x: 284, y: 16, width: 122, height: 108 },
        { id: 'vp-sch-col', kind: 'schedule-columns', title: 'Column Schedule', scale: '1/4" = 1\'-0"', x: 14, y: 130, width: 196, height: 62 },
        { id: 'vp-sch-ftg', kind: 'schedule-footings', title: 'Footing Schedule', scale: '1/4" = 1\'-0"', x: 14, y: 196, width: 196, height: 62 },
        { id: 'vp-sch-rb', kind: 'schedule-rebar', title: 'Rebar Schedule', scale: '1/4" = 1\'-0"', x: 214, y: 130, width: 192, height: 98 },
      ],
    },
  ];
}

/** Title block geometry (paper mm) — shared by the PDF and the on-screen sheet. */
export function getTitleBlockRect(size: SheetSize): { x: number; y: number; w: number; h: number } {
  const { widthMm: W, heightMm: H } = getSheetDimensionsMm(size);
  const margin = 11.5;
  const w = Math.min(145, W * 0.35);
  const h = 52;
  return { x: W - margin - w, y: H - margin - h, w, h };
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Converts a cap height in paper mm to a font size in points (Helvetica cap height ≈ 0.72 em). */
const capMmToPt = (mm: number) => mm / 0.72 / 0.352778;

/** jsPDF's built-in fonts are WinAnsi: keep common symbols, replace anything else. */
const pdfSafe = (s: string) =>
  String(s ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ]/g, '?');

/**
 * Renders one or more SheetDefinitions into a multi-page jsPDF document (one page per sheet,
 * each page at its own paper size).
 */
export function generateSheetsPDF(
  model: ArchModel,
  sheets?: SheetDefinition[],
  threeCanvasDataUrl?: string | null,
  cameraImages?: Record<string, string>
): jsPDF {
  const sheetList =
    sheets && sheets.length > 0 ? sheets : model.sheets && model.sheets.length > 0 ? model.sheets : createStarterSheets();

  const firstDims = getSheetDimensionsMm(sheetList[0].size);
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [firstDims.widthMm, firstDims.heightMm],
    compress: true,
  });
  doc.setProperties({
    title: `${model.projectName || 'Archiforma'} — Sheets`,
    creator: 'ARCHIFORMA',
    subject: sheetList.map((s) => `${s.sheetNumber} ${s.title}`).join('; '),
  });

  sheetList.forEach((sheet, pageIdx) => {
    const dims = getSheetDimensionsMm(sheet.size);
    if (pageIdx > 0) {
      doc.addPage([dims.widthMm, dims.heightMm], 'landscape');
    }

    const W = dims.widthMm;
    const H = dims.heightMm;
    const margin = 10;

    // 1. Sheet border (double line)
    doc.setDrawColor(28, 25, 23);
    doc.setLineWidth(0.6);
    doc.rect(margin, margin, W - margin * 2, H - margin * 2);
    doc.setLineWidth(0.2);
    doc.rect(margin + 1.5, margin + 1.5, W - (margin + 1.5) * 2, H - (margin + 1.5) * 2);

    // 2. Viewports
    for (const vp of sheet.viewports) {
      renderViewportOnPdf(doc, model, vp, vp.kind === 'camera' ? cameraImages?.[vp.cameraId || ''] ?? null : threeCanvasDataUrl);
    }

    // 2b. Structural coordination disclaimer (pages with structural views, or any page of a model with structure)
    const structuralPage = sheet.viewports.some((v) => ['foundationplan', 'framingplan', 'section'].includes(v.kind) || (scheduleKindOfViewport(v.kind) && isStructuralSchedule(scheduleKindOfViewport(v.kind)!)));
    if (structuralPage || hasStructuralContent(model)) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(185, 28, 28);
      doc.text(pdfSafe(`NOTE: ${STRUCTURAL_DISCLAIMER}`), margin + 3, H - margin - 2.2);
    }

    // 3. Title block (bottom-right)
    const tb = getTitleBlockRect(sheet.size);
    const { x: tbX, y: tbY, w: tbW, h: tbH } = tb;
    doc.setLineDashPattern([], 0);
    doc.setFillColor(250, 250, 249);
    doc.setDrawColor(28, 25, 23);
    doc.setLineWidth(0.45);
    doc.rect(tbX, tbY, tbW, tbH, 'FD');
    doc.setLineWidth(0.25);
    doc.line(tbX, tbY + 14, tbX + tbW, tbY + 14);
    doc.line(tbX, tbY + 28, tbX + tbW, tbY + 28);
    doc.line(tbX, tbY + 40, tbX + tbW, tbY + 40);
    const numBoxW = 36;
    doc.line(tbX + tbW - numBoxW, tbY + 28, tbX + tbW - numBoxW, tbY + tbH);

    const label = (s: string, x: number, y: number) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(120, 113, 108);
      doc.text(s, x, y);
    };
    const value = (s: string, x: number, y: number, size: number, maxWidth?: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      doc.setTextColor(28, 25, 23);
      doc.text(pdfSafe(s), x, y, maxWidth ? { maxWidth } : undefined);
    };

    label('PROJECT', tbX + 3, tbY + 4.5);
    value(model.projectName || 'Architectural Project', tbX + 3, tbY + 10.5, 10.5, tbW - 6);
    label('SHEET TITLE', tbX + 3, tbY + 18.5);
    value(sheet.title || 'General Plan', tbX + 3, tbY + 24.5, 9.5, tbW - 6);
    label('DATE', tbX + 3, tbY + 32);
    label('SCALE', tbX + 40, tbY + 32);
    label('SIZE', tbX + 78, tbY + 32);
    value(sheet.date || new Date().toISOString().slice(0, 10), tbX + 3, tbY + 37.5, 8);
    value(sheet.scaleLabel || 'As Noted', tbX + 40, tbY + 37.5, 8, 36);
    value(sheet.size, tbX + 78, tbY + 37.5, 8);
    label(`DRAWN: ${pdfSafe(sheet.drawnBy || '-')}`, tbX + 3, tbY + 46.5);
    label(`CHECKED: ${pdfSafe(sheet.checkedBy || '-')}`, tbX + 50, tbY + 46.5);
    label('SHEET NO.', tbX + tbW - numBoxW + 3, tbY + 32.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(28, 25, 23);
    doc.text(pdfSafe(sheet.sheetNumber || `A10${pageIdx + 1}`), tbX + tbW - numBoxW / 2, tbY + 46, { align: 'center' });
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 113, 108);
    doc.text(`${pageIdx + 1} of ${sheetList.length}`, tbX + tbW - 2, tbY + tbH - 1.5, { align: 'right' });
  });

  return doc;
}

/** Draws plan plot primitives onto a jsPDF page through a paper-space transform. */
function drawPrimsOnPdf(doc: jsPDF, prims: PlanPrim[], toPaper: (p: Point) => Point, mmPerIn: number) {
  for (const p of prims) {
    if (p.k === 'text') {
      const pt = toPaper(p.p);
      const size = capMmToPt(p.size);
      doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const [r, g, b] = hexToRgb(p.color);
      doc.setTextColor(r, g, b);
      const s = pdfSafe(p.text);
      // Anchor manually so alignment works with rotation (jsPDF angle is counter-clockwise)
      const wMm = doc.getTextWidth(s);
      const shift = p.align === 'center' ? -wMm / 2 : p.align === 'right' ? -wMm : 0;
      const rad = (p.rot * Math.PI) / 180;
      const x = pt.x + shift * Math.cos(rad);
      const y = pt.y + shift * Math.sin(rad);
      doc.text(s, x, y, { angle: -p.rot, baseline: 'middle' });
      continue;
    }
    const hasStroke = !!p.stroke && p.w > 0;
    const hasFill = !!p.fill;
    if (!hasStroke && !hasFill) continue;
    if (hasStroke) {
      const [r, g, b] = hexToRgb(p.stroke!);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(p.w);
      doc.setLineDashPattern(p.dash || [], 0);
    }
    if (hasFill) {
      const [r, g, b] = hexToRgb(p.fill!);
      doc.setFillColor(r, g, b);
    }
    const style = hasStroke && hasFill ? 'FD' : hasFill ? 'F' : 'S';
    const translucent = p.opacity !== undefined && p.opacity < 1;
    if (translucent) {
      doc.saveGraphicsState();
      doc.setGState(new (doc as unknown as { GState: new (o: Record<string, number>) => unknown }).GState({ opacity: p.opacity!, 'stroke-opacity': p.opacity! }) as never);
    }
    if (p.k === 'circle') {
      const c = toPaper(p.c);
      doc.circle(c.x, c.y, Math.max(0.05, p.r * mmPerIn), style);
    } else if (p.pts.length >= 2) {
      const pts = p.pts.map(toPaper);
      const deltas: number[][] = [];
      for (let i = 1; i < pts.length; i++) deltas.push([pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y]);
      doc.lines(deltas, pts[0].x, pts[0].y, [1, 1], p.closed ? style : 'S', p.closed);
    }
    if (translucent) doc.restoreGraphicsState();
  }
  doc.setLineDashPattern([], 0);
}

function renderViewportOnPdf(doc: jsPDF, model: ArchModel, vp: SheetViewport, threeCanvasDataUrl?: string | null) {
  const { x, y, width, height } = vp;
  const headerH = VIEWPORT_TITLE_BAR_MM;
  const contentH = Math.max(4, height - headerH);

  doc.setLineDashPattern([], 0);
  doc.setDrawColor(168, 162, 158);
  doc.setLineWidth(0.25);
  doc.rect(x, y, width, height);

  let note = '';
  if (vp.kind === 'plan' || vp.kind === 'elevation' || vp.kind === 'roofplan' || vp.kind === 'foundationplan' || vp.kind === 'framingplan' || vp.kind === 'section') {
    const t = getPlanViewportTransform(model, vp);
    // Clip to the viewport so an over-sized drawing never spills over neighbouring views
    doc.saveGraphicsState();
    doc.rect(x, y, width, contentH, null as unknown as string);
    doc.clip();
    doc.discardPath();
    drawPrimsOnPdf(doc, t.prims, t.toPaper, t.mmPerIn);
    doc.restoreGraphicsState();
    if (!t.fits) note = 'CLIPPED AT THIS SCALE';
  } else if (vp.kind === '3d' || vp.kind === 'camera') {
    let drawn = false;
    if (threeCanvasDataUrl && threeCanvasDataUrl.startsWith('data:image/')) {
      try {
        const props = doc.getImageProperties(threeCanvasDataUrl);
        const boxW = width - 4;
        const boxH = contentH - 4;
        const s = Math.min(boxW / props.width, boxH / props.height);
        const iw = props.width * s;
        const ih = props.height * s;
        const fmt = threeCanvasDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
        doc.addImage(threeCanvasDataUrl, fmt, x + 2 + (boxW - iw) / 2, y + 2 + (boxH - ih) / 2, iw, ih);
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn && vp.kind === 'camera') {
      doc.setFontSize(7);
      doc.setTextColor(120, 113, 108);
      doc.text('Camera view not rendered yet - open it once in the app', x + 4, y + contentH / 2);
    } else if (!drawn) renderIsometricWireframeOnPdf(doc, model, x, y, width, contentH);
  } else if (scheduleKindOfViewport(vp.kind)) {
    const kind: ScheduleKind = scheduleKindOfViewport(vp.kind)!;
    const hidden = renderScheduleTableOnPdf(doc, getScheduleTable(model, kind), x + 2, y + 2, width - 4, contentH - 4);
    if (hidden > 0) note = `+${hidden} MORE ROWS - ENLARGE VIEWPORT`;
  }

  // Viewport title bar
  const barY = y + height - headerH;
  doc.setLineDashPattern([], 0);
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(168, 162, 158);
  doc.setLineWidth(0.25);
  doc.rect(x, barY, width, headerH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(28, 25, 23);
  doc.text(pdfSafe(vp.title), x + 3, barY + 5.2, { maxWidth: width * 0.58 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(120, 113, 108);
  const isSchedule = vp.kind.startsWith('schedule');
  doc.text(isSchedule ? '' : vp.kind === '3d' ? 'Scale: N.T.S.' : `Scale: ${vp.scale}`, x + width - 3, barY + 5.2, { align: 'right' });
  if (note) {
    // Warning sits in the title bar, between the view title and the scale
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(185, 28, 28);
    doc.text(note, x + width * 0.62, barY + 5.2);
  }
}

function renderIsometricWireframeOnPdf(doc: jsPDF, model: ArchModel, x: number, y: number, w: number, h: number) {
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  const levels = model.levels ?? createStarterLevels();
  if (walls.length === 0) return;

  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = 0.5;
  const iso = (wx: number, wy: number, wz: number): Point => ({
    x: (wx - wy) * cos30,
    y: (wx + wy) * sin30 - wz,
  });

  const segs: Array<[Point, Point]> = [];
  for (const wall of walls) {
    const lvl = levels.find((l) => l.id === (wall.levelId || 'level-1'));
    const z0 = (lvl?.elevation || 0) + (wall.baseOffset || 0);
    const z1 = z0 + (wall.height || 108);
    const b1 = iso(wall.start.x, wall.start.y, z0);
    const b2 = iso(wall.end.x, wall.end.y, z0);
    const t1 = iso(wall.start.x, wall.start.y, z1);
    const t2 = iso(wall.end.x, wall.end.y, z1);
    segs.push([b1, b2], [t1, t2], [b1, t1], [b2, t2]);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  const s = Math.min((w - 10) / Math.max(1, maxX - minX), (h - 10) / Math.max(1, maxY - minY));
  const ox = x + w / 2 - ((minX + maxX) / 2) * s;
  const oy = y + h / 2 - ((minY + maxY) / 2) * s;
  doc.setDrawColor(68, 64, 60);
  doc.setLineWidth(0.25);
  for (const [a, b] of segs) doc.line(ox + a.x * s, oy + a.y * s, ox + b.x * s, oy + b.y * s);
}

/**
 * Draws a schedule table that fits its box: columns sized by weight, font shrunk (down to a
 * legible minimum) so every row fits; returns how many rows still did not fit.
 */
function renderScheduleTableOnPdf(doc: jsPDF, table: ScheduleTable, x: number, y: number, w: number, h: number): number {
  const all = [table.headers, ...table.rows];
  const minRowH = 3.6;
  const rowH = Math.max(minRowH, Math.min(5.5, h / Math.max(1, all.length)));
  const fit = Math.max(1, Math.floor(h / rowH));
  const shown = Math.min(all.length, fit);
  const hidden = all.length - shown;
  const totalWeight = table.weights.reduce((a, b) => a + b, 0) || 1;
  const colW = table.weights.map((wt) => (w * wt) / totalWeight);
  const fontPt = Math.min(6, Math.max(4.2, rowH * 1.25));

  for (let r = 0; r < shown; r++) {
    const ry = y + r * rowH;
    if (r === 0) {
      doc.setFillColor(231, 229, 228);
      doc.rect(x, ry, w, rowH, 'F');
    }
    doc.setDrawColor(214, 211, 209);
    doc.setLineWidth(0.15);
    doc.rect(x, ry, w, rowH);
    doc.setFont('helvetica', r === 0 ? 'bold' : 'normal');
    doc.setFontSize(fontPt);
    doc.setTextColor(28, 25, 23);
    let cx = x;
    for (let c = 0; c < colW.length; c++) {
      let cell = pdfSafe(all[r][c] || '');
      const maxW = colW[c] - 2;
      if (doc.getTextWidth(cell) > maxW) {
        while (cell.length > 1 && doc.getTextWidth(cell + '...') > maxW) cell = cell.slice(0, -1);
        cell += '...';
      }
      doc.text(cell, cx + 1, ry + rowH / 2, { baseline: 'middle' });
      if (c > 0) doc.line(cx, ry, cx, ry + rowH);
      cx += colW[c];
    }
  }
  return hidden;
}

// ============================================================================
// 3. IMPROVED DXF EXPORT & DXF IMPORT (USING dxf-parser)
// ============================================================================

export { computeHatchPatternLines } from './planPrimitives';

export { exportModelToDXF, hexToNearestAci, aciToHex } from './dxfExport';
export type { DxfExportOptions } from './dxfExport';
export { importFromDXF, cleanDxfText } from './dxfImport';
export type { DxfImportResult, DxfImportSummary } from './dxfImport';

// ============================================================================
// 4. BASIC IFC4 EXPORT (WALLS, DOORS, WINDOWS, SLABS & SPACES) — see ifcExport.ts
// ============================================================================

export { exportToIFC4, makeIfcGuid } from './ifcExport';
