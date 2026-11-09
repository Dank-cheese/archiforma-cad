import { finishDef, isCurtainWall, paintWallBand, wallFinishBands, wallProfile } from './engine/facade';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArchEntity,
  ArchModel,
  BlockDefinition,
  ColumnType,
  CommandLogEntry,
  DoorType,
  FloorEntity,
  FloorType,
  Layer,
  LayerId,
  LevelDefinition,
  OsnapResult,
  Point,
  ProjectSettings,
  RoofEntity,
  ToolId,
  ViewMode,
  VisibilitySettings,
  WallEntity,
  WallType,
  WindowType,
} from './types/model';
import type { ElevationDirection, RailingEntity } from './types/model';
import { connectedWallChain, defaultEdgeSlopes, footprintFromWalls, formatSlope, getRoofGeometry, normalizeFootprint, pointInPolygon } from './engine/roof';
import { DEFAULT_FACADE_TOOL, DEFAULT_ROOF_TOOL, FacadeToolState, RoofToolState, ToolOptionsBar } from './components/ToolOptionsBar';
import {
  applyTypeToInstances,
  copySelectionHosted,
  equalSpacingOffsets,
  hostedOpeningsOf,
  isHostedOpening,
  moveSelectionHosted,
  reanchorHostedOpenings,
} from './engine/openings';
import { OpeningOptionsBar } from './components/OpeningOptionsBar';
import { healCollinearWalls, JOIN_CYCLE, joinStateIndex, setCornerJoin, wallEndsNear } from './engine/wallJoins';
import { DEFAULT_OPENING_TOOL, type OpeningToolState } from './components/OpeningsPlanLayer';
import {
  alignEntity,
  breakEntity,
  syncAssociatedTags,
  chamferEntities,
  computeEntityAreaAndPerimeter,
  computeModelExtents,
  computeOuterFootprintFromWalls,
  computePolygonAreaAndPerimeter,
  createBlankProject,
  createBlockFromSelection,
  createDefaultLayers,
  createDefaultVisibility,
  createPolarArray,
  createRectangularArray,
  createSampleProject,
  createStarterBlocks,
  createStarterColumnTypes,
  createStarterDoorTypes,
  createStarterFloorTypes,
  createStarterLevels,
  createStarterSheets,
  createStarterWallTypes,
  createStarterWindowTypes,
  createStressTestEntities,
  DEFAULT_DIM_STYLE,
  dist,
  explodeEntity,
  exportToDXF,
  exportToIFC4,
  extendLineOrWall,
  filletEntities,
  findEnclosedRoomAtPoint,
  formatArea,
  formatLength,
  generateSheetsPDF,
  getEntitySegments,
  getWallTypeTotalThickness,
  importFromDXF,
  joinEntities,
  mirrorEntity,
  moveEntity,
  offsetEntity,
  parseCoordinateInput,
  parseLengthInput,
  polygonArea,
  polygonCentroid,
  rotateEntity,
  scaleEntityByBase,
  Segment,
  stretchEntities,
  sub,
  syncHostedBimEntities,
  trimLineOrWall,
} from './engine/geometry';
import {
  trimAt,
  extendAt,
  trimExtendCorner,
  fenceHits,
  updateAssociatedDimensions,
  TrimExtendMode,
  EdgeExtensionMode,
} from './engine/trimExtend';
import {
  createHistoryState,
  pushHistory,
  redoHistory,
  undoHistory,
} from './engine/history';
import {
  CommandContext,
  CommandDefinition,
  findCommandByAlias,
  getToolStepHint,
} from './engine/commands';
import { TopBar } from './components/TopBar';
import { LeftToolbar } from './components/LeftToolbar';
import { RightPanel } from './components/RightPanel';
import { CommandLine } from './components/CommandLine';
import { HelpModal } from './components/HelpModal';
import { DimStyleModal } from './components/DimStyleModal';
import { BlockEditorModal } from './components/BlockEditorModal';
import {
  LevelManagerModal,
  VisibilityModal,
  WallTypeEditorModal,
} from './components/BimModals';
import { Canvas2D } from './components/Canvas2D';
import { Canvas3D, Canvas3DHandle } from './components/Canvas3D';
import { CameraViewsList } from './components/CameraViews';
import { DEFAULT_GROUND_STATE, type GroundState } from './engine/view';
import { loadViewCubeSettings, parseOnOff, saveViewCubeSettings, type Cardinal, type Hotspot } from './engine/viewCube';
import { aspectRatio, clampFov, focalToFov, fovLabel, groundElevationAt, makeCamera, nextCameraName } from './engine/camera';
import type { CameraEntity } from './types/model';
import { SchedulesView } from './components/SchedulesView';
import { SheetsView } from './components/SheetsView';
import { FacadeElevationView } from './components/FacadeElevationView';
import { RoofPlanView } from './components/RoofPlanView';
import { StructuralView } from './components/StructuralViews';
import { syncStairFloorOpenings } from './engine/stairs';
import { StructureOptionsBar } from './components/StructureOptionsBar';
import type { StructuralAction } from './components/StructuralProperties';
import { hasStructuralContent } from './engine/documentation';
import { STRUCTURAL_DISCLAIMER } from './engine/structure';
import type { Discipline } from './types/model';
import {
  applyRebarPreset,
  attachColumnTopToBeam,
  connectionFromSelection,
  DEFAULT_STRUCT_TOOL,
  finishStructuralPolygon,
  footingsUnderSelection,
  handleStructuralClick,
  isStructureTool,
  joinAction,
  wallFootingsUnderSelection,
  type ActionResult,
  type StructClickResult,
  type StructToolState,
} from './engine/structureTools';
import {
  GuidedTourModal,
  ShortcutCheatSheetModal,
  ToastContainer,
  ToastItem,
  ToastVariant,
} from './components/OnboardingAndOverlays';

const STORAGE_KEY = 'archiforma_project_v1';
const STRUCT_NOTE = '(Design visualization and coordination only — not a substitute for engineering by a licensed structural engineer.)';
const TOUR_SEEN_KEY = 'archiforma_tour_seen_v1';
const UI_MODE_KEY = 'archiforma_ui_mode_v1';

/** Keeps the saved catalog entries and adds starter entries that were introduced later. */
function mergeById<T extends { id: string }>(saved: T[] | undefined, starters: T[]): T[] {
  if (!saved || saved.length === 0) return starters;
  const have = new Set(saved.map((x) => x.id));
  const starterById = new Map(starters.map((x) => [x.id, x] as const));
  // saved entries win, but pick up fields added to the starter catalog since they were saved
  return [...saved.map((x) => ({ ...(starterById.get(x.id) || {}), ...x }) as T), ...starters.filter((x) => !have.has(x.id))];
}

function loadInitialModel(): ArchModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ArchModel;
      if (parsed && Array.isArray(parsed.entities) && Array.isArray(parsed.layers)) {
        const defaultLayers = createDefaultLayers();
        const existingLayerIds = new Set(parsed.layers.map((l) => l.id));
        const mergedLayers = [
          ...parsed.layers,
          ...defaultLayers.filter((dl) => !existingLayerIds.has(dl.id)),
        ];
        return {
          ...parsed,
          layers: mergedLayers,
          blocks: mergeById(parsed.blocks, createStarterBlocks()),
          levels:
            parsed.levels && parsed.levels.length > 0
              ? parsed.levels
              : createStarterLevels(),
          activeLevelId: parsed.activeLevelId || 'level-1',
          wallTypes: mergeById(parsed.wallTypes, createStarterWallTypes()),
          floorTypes:
            parsed.floorTypes && parsed.floorTypes.length > 0
              ? parsed.floorTypes
              : createStarterFloorTypes(),
          columnTypes: mergeById(parsed.columnTypes, createStarterColumnTypes()),
          doorTypes: mergeById(parsed.doorTypes, createStarterDoorTypes()),
          windowTypes: mergeById(parsed.windowTypes, createStarterWindowTypes()),
          visibility: parsed.visibility || createDefaultVisibility(),
          sheets:
            parsed.sheets && parsed.sheets.length > 0
              ? parsed.sheets
              : createStarterSheets(),
          activeSheetId: parsed.activeSheetId || 'sheet-a101',
          settings: {
            ...parsed.settings,
            dimStyle: {
              ...DEFAULT_DIM_STYLE,
              ...(parsed.settings?.dimStyle || {}),
            },
          },
        };
      }
    }
  } catch {
    // Ignore storage read errors and fall back to sample project
  }
  return createSampleProject();
}

export default function App() {
  const [history, setHistory] = useState(() =>
    createHistoryState(loadInitialModel())
  );
  const model = history.present;

  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [lastCommandAlias, setLastCommandAlias] = useState<string>('WA');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [dimStyleOpen, setDimStyleOpen] = useState<boolean>(false);
  const [blockEditorOpen, setBlockEditorOpen] = useState<boolean>(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  // Beginner / Pro UI Mode + First-run Guided Tour + Shortcut Cheat Sheet + Toasts
  const [uiMode, setUiMode] = useState<'beginner' | 'pro'>(() => {
    try {
      const saved = localStorage.getItem(UI_MODE_KEY);
      return saved === 'pro' ? 'pro' : 'beginner';
    } catch {
      return 'beginner';
    }
  });
  const [tourOpen, setTourOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOUR_SEEN_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [tourStep, setTourStep] = useState<number>(0);
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-4), { id, message, variant }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3600);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCloseTour = useCallback(() => {
    setTourOpen(false);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleStartTour = useCallback(() => {
    setTourStep(0);
    setTourOpen(true);
  }, []);

  const handleToggleUiMode = useCallback(() => {
    setUiMode((prev) => {
      const next = prev === 'beginner' ? 'pro' : 'beginner';
      try {
        localStorage.setItem(UI_MODE_KEY, next);
      } catch {
        // Ignore storage errors
      }
      addToast(
        next === 'beginner'
          ? 'Switched to Beginner Mode (toolbar labels & step guides visible)'
          : 'Switched to Pro Mode (compact icon toolbar & expanded command line)',
        'info'
      );
      return next;
    });
  }, [addToast]);

  // BIM Modals & State
  const [levelModalOpen, setLevelModalOpen] = useState<boolean>(false);
  const [visibilityModalOpen, setVisibilityModalOpen] = useState<boolean>(false);
  const [wallTypeModalOpen, setWallTypeModalOpen] = useState<boolean>(false);
  const [editingWallTypeId, setEditingWallTypeId] = useState<string | null>(null);
  const [activeWallTypeId, setActiveWallTypeId] = useState<string>('wt-ext-2x6');
  // Roof (RF) and facade tool options (shown in the floating tool options bar)
  const [roofTool, setRoofTool] = useState<RoofToolState>(DEFAULT_ROOF_TOOL);
  const [facadeTool, setFacadeTool] = useState<FacadeToolState>(DEFAULT_FACADE_TOOL);
  const [elevationDir, setElevationDir] = useState<ElevationDirection>('south');
  // STRUCTURE: discipline (Architectural / Structural / Combined), analytical + rebar display, tool options
  const [discipline, setDiscipline] = useState<Discipline>(() => {
    try {
      const d = localStorage.getItem('archiforma_discipline_v1');
      return d === 'architectural' || d === 'structural' || d === 'combined' ? d : 'combined';
    } catch {
      return 'combined';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('archiforma_discipline_v1', discipline);
    } catch {
      /* ignore */
    }
  }, [discipline]);
  const [analytical, setAnalytical] = useState(false);
  const [viewRebar, setViewRebar] = useState(false);
  const [structTool, setStructTool] = useState<StructToolState>(DEFAULT_STRUCT_TOOL);
  const [openingTool, setOpeningTool] = useState<OpeningToolState>(DEFAULT_OPENING_TOOL);
  /** Wall deletion waiting for "Also delete N hosted doors/windows?" */
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; hosted: string[]; label: string } | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>(undefined);
  const [framingLevelId, setFramingLevelId] = useState<string>('level-2');
  const [tempHiddenIds, setTempHiddenIds] = useState<string[]>([]);
  const [tempIsolatedIds, setTempIsolatedIds] = useState<string[]>([]);

  const [leftTab, setLeftTab] = useState<'tools' | 'library'>('tools');
  const [activeInsertBlockId, setActiveInsertBlockId] = useState<string>('blk-bed');
  const [insertRotation, setInsertRotation] = useState<number>(0);
  const [insertScale, setInsertScale] = useState<number>(1);
  const [layersExpanded, setLayersExpanded] = useState<boolean>(true);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  // AutoCAD Modify Tools State
  const [modifySubStep, setModifySubStep] = useState<number>(0);
  const [pickedEntityId, setPickedEntityId] = useState<string | null>(null);
  const [cuttingEdgeIds, setCuttingEdgeIds] = useState<string[]>([]);
  const [boundaryEdgeIds, setBoundaryEdgeIds] = useState<string[]>([]);
  const [trimUndoStack, setTrimUndoStack] = useState<ArchEntity[][]>([]);
  const [trimEraseSubMode, setTrimEraseSubMode] = useState<boolean>(false);
  const [trimCrossingSubMode, setTrimCrossingSubMode] = useState<boolean>(false);
  const [offsetDist, setOffsetDist] = useState<number>(12);
  const [filletRadius, setFilletRadius] = useState<number>(0);
  const [chamferD1, setChamferD1] = useState<number>(12);
  const [chamferD2, setChamferD2] = useState<number>(12);
  const [arrayMode, setArrayMode] = useState<'rect' | 'polar'>('rect');
  const [arrayRows] = useState<number>(3);
  const [arrayCols] = useState<number>(3);
  const [arrayRowSpacing] = useState<number>(48);
  const [arrayColSpacing] = useState<number>(48);
  const [arrayCount] = useState<number>(6);
  const [arrayAngle] = useState<number>(360);

  const [cursorWorld, setCursorWorld] = useState<Point>({ x: 0, y: 0 });
  const [activeOsnap, setActiveOsnap] = useState<OsnapResult | null>(null);
  const [viewTransform, setViewTransform] = useState({
    panX: 180,
    panY: 130,
    zoom: 1.5,
  });

  const [logs, setLogs] = useState<CommandLogEntry[]>([
    {
      id: 'init-1',
      timestamp: '00:00',
      text: 'Welcome to ARCHIFORMA. Sample 2-room house loaded. Type WA (Wall), SB (Floor), RF (Roof), ST (Stairs), CL (Column), GR (Grid), LL (Levels), VV (Visibility), or press F1 for Help.',
      kind: 'info',
    },
  ]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvas3dRef = useRef<Canvas3DHandle | null>(null);
  // CAMERA (CAM): FOV used while placing, the camera view open in 3D, rendered thumbnails / sheet images
  const [cameraFov, setCameraFov] = useState(60);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [cameraRenders, setCameraRenders] = useState<Record<string, { sig: string; rev: number; thumb: string; sheet: string }>>({});
  const bakerRef = useRef<Canvas3DHandle | null>(null);
  // BELOW GRADE (3D): ground opacity / hide / X-ray and the section box (BX), kept across view switches
  const [ground3d, setGround3d] = useState<GroundState>(DEFAULT_GROUND_STATE);
  const [sectionBox3d, setSectionBox3d] = useState(false);
  // UNDERLAY (2D plans): choice per level and the support-mismatch highlight
  const [underlayByLevel, setUnderlayByLevel] = useState<Record<string, string>>({});
  const [underlayMismatch, setUnderlayMismatch] = useState(false);
  // VIEWCUBE (NAVVCUBE): on / off (persisted) and views requested from the plan's cube
  const [viewCubeOn, setViewCubeOn] = useState(() => loadViewCubeSettings().on);
  type CubeRequest = { nonce: number; kind: 'hotspot'; h: Hotspot } | { nonce: number; kind: 'home' } | { nonce: number; kind: 'cardinal'; c: Cardinal };
  const [cubeRequest, setCubeRequest] = useState<CubeRequest | null>(null);
  // COMMAND PROMPT with options ("Enter an option [ON/OFF] <ON>:") — answered on the command line or by clicking a chip
  const [cmdPrompt, setCmdPrompt] = useState<null | { text: string; answer: (input: string) => boolean }>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  const logMessage = useCallback(
    (
      text: string,
      kind: 'input' | 'info' | 'error' | 'result' = 'info'
    ) => {
      const now = new Date();
      const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(
        now.getSeconds()
      ).padStart(2, '0')}`;
      setLogs((prev) => [
        ...prev.slice(-49),
        { id: `log-${Date.now()}-${Math.random()}`, timestamp: ts, text, kind },
      ]);
      if (kind === 'error') {
        addToast(text, 'error');
      }
    },
    [addToast]
  );

  // Autosave to localStorage whenever model changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch {
      // Ignore quota errors
    }
  }, [model]);

  const commitModel = useCallback(
    (nextModel: ArchModel, actionLabel: string) => {
      setHistory((prev) => {
        // hosted openings stay embedded whatever edited their wall (grips, stretch, trim, properties…)
        let ents = reanchorHostedOpenings(prev.present.entities, nextModel.entities);
        // collinear walls of the same type that touch end-to-end heal into one wall (openings kept in place)
        const healed = healCollinearWalls(ents);
        if (healed !== ents) ents = syncHostedBimEntities(healed);
        const syncedStairs = syncStairFloorOpenings(ents, nextModel.levels ?? prev.present.levels);
        if (syncedStairs !== ents) ents = syncedStairs;
        const synced = ents === nextModel.entities ? nextModel : { ...nextModel, entities: syncAssociatedTags(ents) };
        return pushHistory(prev, synced, actionLabel);
      });
    },
    []
  );

  // PAINT (PT) in 3D: apply the facade tool's finish to the clicked band of the wall's exterior face
  const handlePaintWall3D = useCallback(
    (wallId: string, zAbs: number) => {
      const wall = model.entities.find((e): e is WallEntity => e.type === 'wall' && e.id === wallId);
      if (!wall) return;
      if (isCurtainWall(wall)) {
        logMessage('PAINT: curtain walls use panel types — click a cell in an elevation to change it.', 'error');
        return;
      }
      const prof = wallProfile(model, wall);
      const H = Math.max(...prof.top.map((p) => p.z)) - prof.baseZ;
      const bands = wallFinishBands(wall, H);
      const z = zAbs - prof.baseZ;
      const idx = bands.findIndex((b) => z >= b.z0 - 0.01 && z <= b.z1 + 0.01);
      const band = idx >= 0 && idx < bands.length - 1 ? bands[idx].index : null;
      const finish = facadeTool.finish;
      commitModel(
        { ...model, entities: model.entities.map((e) => (e.id === wallId && e.type === 'wall' ? paintWallBand(e, band, finish) : e)) },
        `Paint ${finishDef(finish).label}`
      );
      logMessage(`PAINT: ${finishDef(finish).label} applied${band !== null ? ` to band ${band + 1}` : ''} (3D).`, 'result');
    },
    [commitModel, facadeTool.finish, logMessage, model]
  );

  // STRUCTURE: apply the result of a structural tool click / selection action (with undo)
  const applyStructResult = (res: StructClickResult | ActionResult) => {
    const r = res as StructClickResult & ActionResult;
    if (r.model) commitModel({ ...model, ...r.model, ...(r.entities ? { entities: r.entities } : {}) }, r.label || 'Structure');
    else if (r.entities) commitModel({ ...model, entities: r.entities }, r.label || 'Structure');
    if (r.select) setSelectedIds(r.select);
    if (r.drawingPoints) setDrawingPoints(r.drawingPoints);
    if (r.log) logMessage(r.log.text, r.log.kind);
    if (r.openSectionId) {
      setActiveSectionId(r.openSectionId);
      setViewMode('stsection');
      setActiveTool('select');
    }
  };
  const structCtx = (tool: ToolId, point: Point, raw: Point, tol: number) => ({
    model,
    tool,
    st: structTool,
    point,
    raw,
    drawingPoints,
    levelId: model.activeLevelId || 'level-1',
    tol,
  });
  const handleStructuralCanvasClick = (tool: ToolId, snapped: Point, raw: Point, tol: number) => {
    applyStructResult(handleStructuralClick(structCtx(tool, snapped, raw, tol)));
  };
  const openStructuralView = (kind: 'foundationplan' | 'framingplan' | 'stsection', sectionId?: string) => {
    if (kind === 'stsection') {
      const secs = model.entities.filter((e) => e.type === 'section');
      if (!secs.length) {
        logMessage('No sections yet — draw a cut line in plan with SECTION (SEC).', 'error');
        return;
      }
      setActiveSectionId(sectionId || activeSectionId || secs[0].id);
    }
    if (kind === 'framingplan') {
      const lv = model.activeLevelId || 'level-1';
      const sorted = [...(model.levels || [])].sort((a, b) => a.elevation - b.elevation);
      // framing plan of the level above the active one by default (beams sit under it)
      const above = sorted.find((l) => l.elevation > (sorted.find((x) => x.id === lv)?.elevation ?? 0));
      if (!model.entities.some((e) => e.type === 'beam' && (e.levelId || 'level-1') === framingLevelId)) setFramingLevelId(above?.id || lv);
    }
    setViewMode(kind);
    logMessage(`Opened ${kind === 'foundationplan' ? 'Foundation Plan' : kind === 'framingplan' ? 'Framing Plan' : 'Structural Section'}. ${STRUCT_NOTE}`, 'info');
  };
  const handleStructuralAction = (action: StructuralAction, id: string) => {
    if (action === 'preset') applyStructResult(applyRebarPreset(model, id));
    else if (action === 'footingUnder') applyStructResult(footingsUnderSelection(model, [id], structTool));
    else if (action === 'wallFooting') applyStructResult(wallFootingsUnderSelection(model, [id], structTool));
    else if (action === 'openSection') openStructuralView('stsection', id);
  };

  const updateEntities = useCallback(
    (nextEntities: ArchEntity[], actionLabel: string) => {
      commitModel({ ...model, entities: nextEntities }, actionLabel);
    },
    [commitModel, model]
  );

  const activeLevelId = model.activeLevelId || 'level-1';

  // Finish chained polyline or wall if user switches tools or presses Enter
  const finalizeChainedDrawing = useCallback(
    (closeLoop = false) => {
      if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        const poly: ArchEntity = {
          id: `pline-${Date.now()}`,
          type: 'polyline',
          layer: model.activeLayer,
          levelId: activeLevelId,
          points: drawingPoints,
          closed: closeLoop,
        };
        updateEntities([...model.entities, poly], 'Draw Polyline');
        logMessage(
          `Created Polyline with ${drawingPoints.length} vertices.`,
          'result'
        );
      }
      setDrawingPoints([]);
    },
    [activeLevelId, activeTool, drawingPoints, logMessage, model.activeLayer, model.entities, updateEntities]
  );

  const handleExplodeSelection = useCallback(() => {
    if (selectedIds.length === 0) {
      logMessage('EXPLODE (X): Select a block, polyline, rectangle, wall, or room first.', 'info');
      return;
    }
    let anyExploded = false;
    let nextEntities = [...model.entities];
    const newSelected: string[] = [];

    for (const id of selectedIds) {
      const ent = nextEntities.find((e) => e.id === id);
      if (!ent) continue;
      const exploded = explodeEntity(ent, model.blocks ?? []);
      if (exploded.length > 0 && exploded[0] !== ent) {
        anyExploded = true;
        nextEntities = nextEntities.filter((e) => e.id !== id).concat(exploded);
        newSelected.push(...exploded.map((e) => e.id));
      }
    }

    if (anyExploded) {
      updateEntities(nextEntities, 'Explode Object(s)');
      setSelectedIds(newSelected);
      logMessage(`Exploded compound object(s) into ${newSelected.length} individual primitive(s).`, 'result');
      setActiveTool('select');
    } else {
      logMessage('EXPLODE (X): Selected objects cannot be exploded (select a block, polyline, rectangle, wall, room, stair, floor, roof, hatch, or railing).', 'info');
    }
  }, [model.entities, model.blocks, selectedIds, updateEntities, logMessage]);

  const handleJoinSelection = useCallback(() => {
    if (selectedIds.length < 2) {
      logMessage('JOIN (J): Select 2 or more collinear or connected lines/walls to join.', 'info');
      return;
    }
    const selected = model.entities.filter((e) => selectedIds.includes(e.id));
    const joined = joinEntities(selected);
    if (joined.length < selected.length) {
      const remaining = model.entities.filter((e) => !selectedIds.includes(e.id));
      updateEntities([...remaining, ...joined], 'Join Objects');
      setSelectedIds(joined.map((e) => e.id));
      logMessage(`Joined objects successfully (${selected.length} -> ${joined.length}).`, 'result');
      setActiveTool('select');
    } else {
      logMessage('JOIN (J): Objects could not be joined (must be collinear or connected at endpoints).', 'info');
    }
  }, [model.entities, selectedIds, updateEntities, logMessage]);

  const executeMirror = useCallback(
    (deleteSource: boolean) => {
      if (drawingPoints.length < 2) return;
      const [p1, p2] = drawingPoints;
      const selected = model.entities.filter((e) => selectedIds.includes(e.id));
      if (selected.length === 0) return;

      const mirrored: ArchEntity[] = selected
        .filter((e) => e.type !== 'door' && e.type !== 'window')
        .map((e, idx) => ({
          ...mirrorEntity(e, p1, p2),
          id: `${e.type}-mir-${Date.now()}-${idx}`,
        }));

      let nextEntities: ArchEntity[];
      if (deleteSource) {
        const remaining = model.entities.filter((e) => !selectedIds.includes(e.id));
        nextEntities = syncHostedBimEntities([...remaining, ...mirrored]);
      } else {
        nextEntities = syncHostedBimEntities([...model.entities, ...mirrored]);
      }
      updateEntities(nextEntities, 'Mirror Selection');
      setSelectedIds(mirrored.map((e) => e.id));
      setDrawingPoints([]);
      setModifySubStep(0);
      setActiveTool('select');
      logMessage(
        `Mirrored ${mirrored.length} object(s)${deleteSource ? ' (source erased)' : ''}.`,
        'result'
      );
    },
    [drawingPoints, model.entities, selectedIds, updateEntities, logMessage]
  );

  const executeRectangularArray = useCallback(
    (rows: number, cols: number, rowSp: number, colSp: number) => {
      const selected = model.entities.filter((e) => selectedIds.includes(e.id));
      if (selected.length === 0) return;
      const copies = createRectangularArray(selected, rows, cols, rowSp, colSp, model.entities);
      updateEntities([...model.entities, ...copies], `Array (${rows}x${cols})`);
      setSelectedIds(copies.map((e) => e.id));
      setActiveTool('select');
      logMessage(`Created ${rows}x${cols} array (${copies.length} copies).`, 'result');
    },
    [model.entities, selectedIds, updateEntities, logMessage]
  );

  const handleActivateTool = useCallback(
    (tool: ToolId) => {
      if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        finalizeChainedDrawing(false);
      } else {
        setDrawingPoints([]);
      }

      setModifySubStep(0);
      setPickedEntityId(null);
      setCuttingEdgeIds([]);
      setBoundaryEdgeIds([]);
      setTrimUndoStack([]);
      setTrimEraseSubMode(false);
      setTrimCrossingSubMode(false);
      setActiveTool(tool);
      if (tool !== 'roof') setRoofTool((r) => (r.pickedWallIds.length ? { ...r, pickedWallIds: [] } : r));
      if (tool === 'camera') {
        if (viewMode !== '2d' && viewMode !== 'split') {
          setViewMode('2d');
          setActiveCameraId(null);
        }
        logMessage('CAMERA (CAM): click the camera position, aim, then widen the view. Wheel = field of view, type 35mm for a lens.', 'info');
      }

      // STRUCTURE: tools that act on the current selection first (FT / PC under selected columns or grids,
      // WF under selected walls, CN between two selected members)
      if (selectedIds.length > 0) {
        const selEnts = model.entities.filter((e) => selectedIds.includes(e.id));
        if ((tool === 'footing' || tool === 'pilecap') && selEnts.some((e) => e.type === 'column' || e.type === 'grid')) {
          applyStructResult(footingsUnderSelection(model, selectedIds, structTool, tool === 'pilecap' ? 'pilecap' : 'isolated'));
          setActiveTool('select');
          return;
        }
        if (tool === 'wallfooting' && selEnts.some((e) => e.type === 'wall')) {
          applyStructResult(wallFootingsUnderSelection(model, selectedIds, structTool));
          setActiveTool('select');
          return;
        }
        if (tool === 'connection' && selEnts.filter((e) => e.type === 'beam' || e.type === 'column').length >= (structTool.connection === 'base-plate' ? 1 : 2)) {
          applyStructResult(connectionFromSelection(model, selectedIds, structTool.connection));
          setActiveTool('select');
          return;
        }
      }
      const structHints: Partial<Record<ToolId, string>> = {
        footing: 'FOOTING (FT): click a column to put a pad under it (or select columns / a grid line first and run FT). Footings are dashed in plan (below the floor).',
        wallfooting: 'WALL FOOTING (WF): click walls to add strip footings (they follow the wall).',
        foundationslab: 'FOUNDATION SLAB (FS): click inside walls, or sketch a boundary and press Enter. Thickened edges / vapor barrier in the options bar.',
        pilecap: 'PILE CAP (PC): click a column; set the pile count, diameter and length under More….',
        beam: 'BEAM (BM): click start and end — snaps to column centres and wall tops. Keeps chaining from the last end; Esc / Enter to stop.',
        beamsystem: 'BEAM SYSTEM (BS): click inside a bay bounded by beams or walls to fill it with joists.',
        brace: 'BRACE (BR): click start and end; heights in the options bar.',
        rebar: 'REBAR (RB): click a concrete footing, column, beam, slab or wall. Tip: select a host and use a Quick Preset in Properties.',
        areareinf: 'AREA REINFORCEMENT (AR): click a slab, wall or footing — top / bottom mats, both directions.',
        connection: 'CONNECTION (CN): click near a beam end (or select two members first). Base plate: click a steel column.',
        sjoint: 'JOINT (CJ): two clicks across a slab — control, construction or expansion (splits the slab in 3D).',
        load: 'LOAD (LD): point = 1 click, line = 2 clicks, area = sketch + Enter.',
        section: 'SECTION (SEC): two clicks for the cut line; the view looks to the left of start → end and opens automatically.',
      };
      if (structHints[tool]) logMessage(`${structHints[tool]} ${STRUCT_NOTE}`, 'info');

      const facadeHints: Partial<Record<ToolId, string>> = {
        skylight: 'SKYLIGHT (SKY): Click on a sloped roof face. Width and length are in the options bar; it cuts the roof in 3D.',
        dormer: 'DORMER (DMR): Click on a sloped roof face where the dormer front should sit. Window size is in Properties.',
        curtainwall: 'CURTAIN WALL (CW): Click wall points like WALL, then Enter. Click cells in an elevation to switch Glass / Solid / Door.',
        paint: 'PAINT (PT): Pick a finish in the options bar, then click a wall face in an elevation or in 3D (or a wall in plan).',
        splitface: 'SPLIT FACE (SF): Open an elevation and click a wall face at the height where the finish should change.',
        sweep: 'SWEEP (SWP): Choose Band / Cornice / Base and the height in the options bar, then click a wall.',
        reveal: 'REVEAL (RVL): Set the height in the options bar, then click a wall to cut a groove.',
        balcony: 'BALCONY (BAL): Set width, depth and railing style, then click an exterior wall.',
        railing: 'RAILING (RAIL): Click the path points, then press Enter. Choose Balusters or Glass in the options bar.',
      };
      if (facadeHints[tool]) logMessage(facadeHints[tool]!, 'info');

      if (tool === 'room') {
        logMessage(
          'ROOM (RM): Click inside any area enclosed by walls to create a room and calculate its area.',
          'info'
        );
      } else if (tool === 'floor') {
        logMessage(
          'FLOOR (SB): Click inside an enclosed room to create a floor slab, sketch boundary points, or press Enter / type W to generate floor from all walls on this level.',
          'info'
        );
      } else if (tool === 'roof') {
        logMessage(
          'ROOF (RF): Pick walls (Tab = whole connected chain) or switch to Sketch and click the outline; press Enter to create. Type, slope and overhang are in the options bar.',
          'info'
        );
      } else if (tool === 'stair') {
        logMessage(
          'STAIR (ST): Click start point of straight stair run, then click end point (auto-calculates risers & treads between levels).',
          'info'
        );
      } else if (tool === 'column') {
        logMessage(
          'COLUMN (CL): Click a Grid Intersection or point to place a structural column (press R to rotate 90°).',
          'info'
        );
      } else if (tool === 'grid') {
        logMessage(
          'GRID (GR): Click start point and end point to place a datum grid line with auto-numbered bubble (A, B, C / 1, 2, 3).',
          'info'
        );
      } else if (tool === 'offset') {
        logMessage(
          `OFFSET (O): Distance = ${formatLength(offsetDist, model.settings.units)}. Type distance, type T for Through point, or click object to offset.`,
          'info'
        );
      } else if (tool === 'trim') {
        const mode = model.settings.trimMode ?? 'quick';
        logMessage(
          mode === 'quick'
            ? 'TRIM (TR) [Quick mode]: Click object to trim, Shift+click to extend, or drag fence across objects. Options: [cuTting edges/Crossing/mOde/Project/eRase/Undo]'
            : 'TRIM (TR) [Standard mode]: Select cutting edges or press Enter to select all objects as cutting edges.',
          'info'
        );
      } else if (tool === 'extend') {
        const mode = model.settings.trimMode ?? 'quick';
        logMessage(
          mode === 'quick'
            ? 'EXTEND (EX) [Quick mode]: Click object near end to extend, Shift+click to trim, or drag fence across objects. Options: [Boundary edges/Crossing/mOde/Project/Undo]'
            : 'EXTEND (EX) [Standard mode]: Select boundary edges or press Enter to select all objects as boundaries.',
          'info'
        );
      } else if (tool === 'corner') {
        logMessage(
          'CORNER (TC): Select two lines or walls to trim or extend to a clean corner (keeps clicked sides).',
          'info'
        );
      } else if (tool === 'fillet') {
        logMessage(
          `FILLET (F): Radius = ${formatLength(filletRadius, model.settings.units)}. Type R to set radius, or click first line/wall (radius 0 joins clean corner).`,
          'info'
        );
      } else if (tool === 'chamfer') {
        logMessage(
          `CHAMFER (CHA): D1 = ${formatLength(chamferD1, model.settings.units)}, D2 = ${formatLength(chamferD2, model.settings.units)}. Type D to change distances, or select first line/wall.`,
          'info'
        );
      } else if (tool === 'mirror') {
        logMessage(
          selectedIds.length > 0
            ? 'MIRROR (MI): Click first point of mirror reflection line.'
            : 'MIRROR (MI): Click an object to mirror, or select objects first and run MI.',
          'info'
        );
      } else if (tool === 'stretch') {
        logMessage(
          'STRETCH (S): Click first corner of crossing window across endpoints to stretch.',
          'info'
        );
      } else if (tool === 'scale') {
        logMessage(
          selectedIds.length > 0
            ? 'SCALE (SC): Click base point for scaling.'
            : 'SCALE (SC): Select objects to scale first, then run SC.',
          'info'
        );
      } else if (tool === 'break') {
        logMessage('BREAK (BR): Click object to break at first break point.', 'info');
      } else if (tool === 'explode') {
        if (selectedIds.length > 0) {
          handleExplodeSelection();
        } else {
          logMessage('EXPLODE (X): Click a polyline, rectangle, or wall to explode it into lines.', 'info');
        }
      } else if (tool === 'join') {
        if (selectedIds.length >= 2) {
          handleJoinSelection();
        } else {
          logMessage('JOIN (J): Select lines or walls to join, then press Enter.', 'info');
        }
      } else if (tool === 'array') {
        if (selectedIds.length > 0) {
          logMessage('ARRAY (AR): Type R for Rectangular array, or P for Polar array, and press Enter.', 'info');
        } else {
          logMessage('ARRAY (AR): Select objects first, then run AR.', 'info');
        }
      } else if (tool === 'align') {
        logMessage('ALIGN (AL): Click the object to align.', 'info');
      } else if (tool === 'matchprop') {
        logMessage('MATCHPROP (MA): Click source object to copy properties from.', 'info');
      } else if (tool === 'area') {
        logMessage('AREA (AA): Click corner points for area polygon (press Enter to finish), or click an existing object.', 'info');
      } else if (tool === 'dli') {
        logMessage('DIMLINEAR (DLI): Click first extension origin (hover wall & press Tab to cycle Interior / Centerline / Exterior face).', 'info');
      } else if (tool === 'dimension') {
        logMessage('DIMALIGNED (DAL): Click first extension origin (hover wall & press Tab to cycle Interior / Centerline / Exterior face).', 'info');
      } else if (tool === 'dan') {
        logMessage('DIMANGULAR (DAN): Click vertex point of the angle to measure.', 'info');
      } else if (tool === 'dra') {
        logMessage('DIMRADIUS (DRA): Click a circle or arc to dimension its radius.', 'info');
      } else if (tool === 'ddi') {
        logMessage('DIMDIAMETER (DDI): Click a circle or arc to dimension its diameter.', 'info');
      } else if (tool === 'dco') {
        logMessage('DIMCONTINUE (DCO): Click next extension origin to chain from the last linear/aligned dimension.', 'info');
      } else if (tool === 'dba') {
        logMessage('DIMBASELINE (DBA): Click next extension origin to stack from the base of the last dimension.', 'info');
      } else if (tool === 'leader') {
        logMessage('MLEADER (LE): Click arrowhead point, then elbow point, then landing point.', 'info');
      } else if (tool === 'hatch') {
        logMessage('HATCH (H): Click inside any closed room, rectangle, circle, or closed polyline to fill.', 'info');
      } else if (tool === 'tag') {
        logMessage('TAG (TG): Click a Door (D1…), Window (W1…), or Room (name + area) to place a category tag.', 'info');
      } else if (tool === 'block') {
        logMessage(
          selectedIds.length > 0
            ? `BLOCK (B): ${selectedIds.length} object(s) selected. Click base point on canvas to define block insertion origin.`
            : 'BLOCK (B): Click objects on the canvas to include in the block, then click a base point.',
          'info'
        );
      } else if (tool === 'insert') {
        setLeftTab('library');
        const blk = (model.blocks ?? []).find((b) => b.id === activeInsertBlockId) || (model.blocks ?? [])[0];
        logMessage(
          `INSERT / COMPONENT (I / CM): Placing "${blk?.name ?? 'Component'}". Click on canvas to place (press R to rotate 90°, or pick another block in the Library tab).`,
          'info'
        );
      } else if (tool === 'bedit') {
        logMessage('BEDIT (BE): Click a placed block instance to edit its definition, or use the Block Editor dialog.', 'info');
      }
    },
    [
      activeTool,
      selectedIds,
      model,
      structTool,
      drawingPoints.length,
      finalizeChainedDrawing,
      logMessage,
      offsetDist,
      filletRadius,
      chamferD1,
      chamferD2,
      model.settings.units,
      model.blocks,
      activeInsertBlockId,
      selectedIds,
      handleExplodeSelection,
      handleJoinSelection,
      viewMode,
    ]
  );

  const handleModifyEntityClick = useCallback(
    (entity: ArchEntity, clickPoint: Point, shiftKey: boolean = false) => {
      // 1. OFFSET
      if (activeTool === 'offset') {
        setPickedEntityId(entity.id);
        setModifySubStep(2);
        logMessage(`OFFSET: Selected ${entity.type}. Click point on side to place copy.`, 'info');
        return;
      }

      // Check locked layer for any modification
      const lockedLayerIds = new Set(
        model.layers.filter((l) => l.locked || !l.visible).map((l) => l.id)
      );

      // Determine effective tool when Shift is pressed in TRIM/EXTEND
      let effectiveTool = activeTool;
      if (activeTool === 'trim' && shiftKey) {
        effectiveTool = 'extend';
      } else if (activeTool === 'extend' && shiftKey) {
        effectiveTool = 'trim';
      }

      // 2. TRIM
      if (effectiveTool === 'trim') {
        // Locked layers check
        if (lockedLayerIds.has(entity.layer)) {
          logMessage('Object is on a locked layer and cannot be modified.', 'error');
          addToast('Object is on a locked layer and cannot be modified.', 'error');
          return;
        }

        // In-command erase sub-mode
        if (trimEraseSubMode) {
          setTrimUndoStack((prev) => [...prev, model.entities]);
          const remaining = model.entities.filter((e) => e.id !== entity.id);
          updateEntities(syncHostedBimEntities(remaining), `Erase ${entity.type}`);
          logMessage(`Erased ${entity.type}. Select next object or press Enter to return to Trim.`, 'result');
          return;
        }

        const trimMode: TrimExtendMode = model.settings.trimMode ?? 'quick';
        const edgeMode: EdgeExtensionMode = model.settings.edgeMode ?? 'noextend';

        // In Standard mode when picking cutting edges:
        if (trimMode === 'standard' && modifySubStep === 1) {
          setCuttingEdgeIds((prev) =>
            prev.includes(entity.id) ? prev.filter((id) => id !== entity.id) : [...prev, entity.id]
          );
          logMessage('TRIM: Toggled cutting edge. Press Enter when done picking edges.', 'info');
          return;
        }

        // Collect cutting edges
        let edges: ArchEntity[];
        if (trimMode === 'quick' || cuttingEdgeIds.length === 0) {
          edges = model.entities.filter((e) => e.id !== entity.id);
        } else {
          edges = model.entities.filter((e) => cuttingEdgeIds.includes(e.id) && e.id !== entity.id);
        }

        const trimRes = trimAt(entity, clickPoint, edges, trimMode, model.entities, {
          edge: edgeMode,
          implied: edgeMode === 'extend',
        });

        if (trimRes.action === 'deleted') {
          setTrimUndoStack((prev) => [...prev, model.entities]);
          const remaining = model.entities.filter((e) => e.id !== entity.id);
          updateEntities(syncHostedBimEntities(remaining), `Trim ${entity.type} (Deleted)`);
          logMessage(`Trimmed ${entity.type} (entire object deleted). Click next object to trim or Esc to finish.`, 'result');
          return;
        }

        if (trimRes.action === 'replaced') {
          setTrimUndoStack((prev) => [...prev, model.entities]);
          const remaining = model.entities.filter((e) => e.id !== entity.id);
          let next = syncHostedBimEntities([...remaining, ...trimRes.entities]);
          next = updateAssociatedDimensions(entity, trimRes.entities, next);
          updateEntities(next, `Trim ${entity.type}`);
          if (trimRes.warnings && trimRes.warnings.length > 0) {
            for (const w of trimRes.warnings) {
              logMessage(`Warning: ${w}`, 'error');
              addToast(w, 'warning');
            }
          }
          logMessage(`Trimmed ${entity.type}. Click next object to trim or Esc to finish.`, 'result');
          return;
        }

        logMessage('No cutting edge intersects that piece.', 'info');
        return;
      }

      // 3. EXTEND
      if (effectiveTool === 'extend') {
        // Locked layer check
        if (lockedLayerIds.has(entity.layer)) {
          logMessage('Object is on a locked layer and cannot be modified.', 'error');
          addToast('Object is on a locked layer and cannot be modified.', 'error');
          return;
        }

        if (entity.type === 'circle') {
          logMessage('Circles cannot be extended.', 'error');
          addToast('Circles cannot be extended.', 'error');
          return;
        }

        const trimMode: TrimExtendMode = model.settings.trimMode ?? 'quick';
        const edgeMode: EdgeExtensionMode = model.settings.edgeMode ?? 'noextend';

        // In Standard mode when picking boundary edges:
        if (trimMode === 'standard' && modifySubStep === 1) {
          setBoundaryEdgeIds((prev) =>
            prev.includes(entity.id) ? prev.filter((id) => id !== entity.id) : [...prev, entity.id]
          );
          logMessage('EXTEND: Toggled boundary edge. Press Enter when done picking boundaries.', 'info');
          return;
        }

        // Collect boundaries
        let boundaries: ArchEntity[];
        if (trimMode === 'quick' || boundaryEdgeIds.length === 0) {
          boundaries = model.entities.filter((e) => e.id !== entity.id);
        } else {
          boundaries = model.entities.filter((e) => boundaryEdgeIds.includes(e.id) && e.id !== entity.id);
        }

        const extRes = extendAt(entity, clickPoint, boundaries, trimMode, edgeMode);
        if (extRes.extendedEntity && extRes.extendedEntity !== entity) {
          setTrimUndoStack((prev) => [...prev, model.entities]);
          const remaining = model.entities.filter((e) => e.id !== entity.id);
          let next = syncHostedBimEntities([...remaining, extRes.extendedEntity]);
          next = updateAssociatedDimensions(entity, [extRes.extendedEntity], next);
          updateEntities(next, `Extend ${entity.type}`);
          logMessage(`Extended ${entity.type} to boundary. Click next object or Esc to finish.`, 'result');
          return;
        }

        logMessage('Object does not intersect an edge.', 'info');
        return;
      }

      // 4. CORNER (TC / TRIMCORNER)
      if (activeTool === 'corner') {
        if (entity.type !== 'line' && entity.type !== 'wall') {
          logMessage('CORNER (TC): Please select a line or wall.', 'error');
          return;
        }
        if (lockedLayerIds.has(entity.layer)) {
          logMessage('Object is on a locked layer and cannot be modified.', 'error');
          addToast('Object is on a locked layer and cannot be modified.', 'error');
          return;
        }
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setDrawingPoints([clickPoint]);
          setModifySubStep(1);
          logMessage(`CORNER: Selected first ${entity.type}. Click second line or wall to form corner.`, 'info');
          return;
        }
        const first = model.entities.find((e) => e.id === pickedEntityId);
        if (!first || (first.type !== 'line' && first.type !== 'wall')) {
          setPickedEntityId(null);
          setModifySubStep(0);
          return;
        }
        if (first.id === entity.id) {
          logMessage('CORNER: Please select a different line or wall.', 'info');
          return;
        }
        const p1 = drawingPoints[0] || first.start;
        const p2 = clickPoint;
        const res = trimExtendCorner(first, entity, p1, p2);
        if (!res) {
          logMessage('Lines or walls are parallel and do not form a corner.', 'error');
          addToast('Parallel elements do not form a corner.', 'error');
          setPickedEntityId(null);
          setDrawingPoints([]);
          setModifySubStep(0);
          return;
        }
        const [mod1, mod2] = res.modified;
        setTrimUndoStack((prev) => [...prev, model.entities]);
        const remaining = model.entities.filter((e) => e.id !== first.id && e.id !== entity.id);
        let next = syncHostedBimEntities([...remaining, mod1, mod2]);
        next = updateAssociatedDimensions(first, [mod1], next);
        next = updateAssociatedDimensions(entity, [mod2], next);
        updateEntities(next, 'Trim/Extend to Corner');
        setPickedEntityId(null);
        setDrawingPoints([]);
        setModifySubStep(0);
        logMessage('Connected elements to clean corner.', 'result');
        addToast('Corner formed.', 'success');
        return;
      }

      // 4. FILLET
      if (activeTool === 'fillet') {
        if (entity.type !== 'line' && entity.type !== 'wall') {
          logMessage('FILLET (F): Please select a line or wall.', 'error');
          return;
        }
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setDrawingPoints([clickPoint]);
          setModifySubStep(1);
          logMessage(`FILLET: Selected first ${entity.type}. Click second line or wall.`, 'info');
          return;
        }
        const first = model.entities.find((e) => e.id === pickedEntityId);
        if (!first || (first.type !== 'line' && first.type !== 'wall')) {
          setPickedEntityId(null);
          setModifySubStep(0);
          return;
        }
        if (first.id === entity.id) {
          logMessage('FILLET: Select a different line or wall.', 'info');
          return;
        }
        const res = filletEntities(first, entity, filletRadius, drawingPoints[0], clickPoint);
        if (res) {
          const remaining = model.entities.filter(
            (e) => e.id !== first.id && e.id !== entity.id
          );
          const additions: ArchEntity[] = [...res.modified];
          if (res.arc) additions.push(res.arc);
          const next = syncHostedBimEntities([...remaining, ...additions]);
          updateEntities(next, filletRadius === 0 ? 'Fillet Corner Join' : 'Fillet Arc');
          setPickedEntityId(null);
          setDrawingPoints([]);
          setModifySubStep(0);
          logMessage(
            filletRadius === 0
              ? 'Fillet: Clean corner join created.'
              : `Fillet: Created arc with radius ${formatLength(filletRadius, model.settings.units)}.`,
            'result'
          );
        } else {
          logMessage('FILLET: Lines/walls are parallel or do not intersect.', 'error');
        }
        return;
      }

      // 5. CHAMFER
      if (activeTool === 'chamfer') {
        if (entity.type !== 'line' && entity.type !== 'wall') {
          logMessage('CHAMFER (CHA): Please select a line or wall.', 'error');
          return;
        }
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setDrawingPoints([clickPoint]);
          setModifySubStep(1);
          logMessage(`CHAMFER: Selected first ${entity.type}. Click second line or wall.`, 'info');
          return;
        }
        const first = model.entities.find((e) => e.id === pickedEntityId);
        if (!first || (first.type !== 'line' && first.type !== 'wall')) {
          setPickedEntityId(null);
          setModifySubStep(0);
          return;
        }
        if (first.id === entity.id) {
          logMessage('CHAMFER: Select a different line or wall.', 'info');
          return;
        }
        const res = chamferEntities(first, entity, chamferD1, chamferD2);
        if (res) {
          const remaining = model.entities.filter(
            (e) => e.id !== first.id && e.id !== entity.id
          );
          const next = syncHostedBimEntities([...remaining, ...res.modified, res.chamferLine]);
          updateEntities(next, 'Chamfer Corner');
          setPickedEntityId(null);
          setDrawingPoints([]);
          setModifySubStep(0);
          logMessage('Chamfer: Created corner bevel.', 'result');
        } else {
          logMessage('CHAMFER: Lines/walls are parallel or do not intersect.', 'error');
        }
        return;
      }

      // 6. BREAK
      if (activeTool === 'break') {
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setDrawingPoints([clickPoint]);
          setModifySubStep(1);
          logMessage(
            `BREAK: Selected ${entity.type} at point. Click second break point (or click same point to split).`,
            'info'
          );
          return;
        }
        const target = model.entities.find((e) => e.id === pickedEntityId) || entity;
        const res = breakEntity(target, drawingPoints[0], clickPoint);
        const remaining = model.entities.filter((e) => e.id !== target.id);
        const next = syncHostedBimEntities([...remaining, ...res]);
        updateEntities(next, `Break ${target.type}`);
        setPickedEntityId(null);
        setDrawingPoints([]);
        setModifySubStep(0);
        logMessage(`Broke ${target.type}.`, 'result');
        return;
      }

      // 7. EXPLODE
      if (activeTool === 'explode') {
        const exploded = explodeEntity(entity, model.blocks ?? []);
        if (exploded.length > 0 && exploded[0] !== entity) {
          const remaining = model.entities.filter((e) => e.id !== entity.id);
          updateEntities([...remaining, ...exploded], `Explode ${entity.type}`);
          setSelectedIds(exploded.map((e) => e.id));
          logMessage(`Exploded ${entity.type} into ${exploded.length} primitive(s).`, 'result');
          setActiveTool('select');
        } else {
          logMessage(`EXPLODE: Object of type ${entity.type} cannot be exploded.`, 'info');
        }
        return;
      }

      // 8. JOIN
      if (activeTool === 'join') {
        const nextIds = selectedIds.includes(entity.id)
          ? selectedIds
          : [...selectedIds, entity.id];
        if (nextIds.length >= 2) {
          const selected = model.entities.filter((e) => nextIds.includes(e.id));
          const joined = joinEntities(selected);
          if (joined.length < selected.length) {
            const remaining = model.entities.filter((e) => !nextIds.includes(e.id));
            updateEntities(syncHostedBimEntities([...remaining, ...joined]), 'Join Objects');
            setSelectedIds(joined.map((e) => e.id));
            logMessage(`Joined objects successfully (${selected.length} -> ${joined.length}).`, 'result');
            setActiveTool('select');
            return;
          }
        }
        setSelectedIds(nextIds);
        logMessage(
          `JOIN: Added ${entity.type} to selection (${nextIds.length} selected). Click another collinear/connected line or wall (or press Enter) to join.`,
          'info'
        );
        return;
      }

      // 9. ALIGN
      if (activeTool === 'align') {
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setModifySubStep(1);
          logMessage(`ALIGN: Selected object to align. Click first destination reference point (or click reference line).`, 'info');
          return;
        }
        if (entity.type === 'line' || entity.type === 'wall') {
          const source = model.entities.find((e) => e.id === pickedEntityId);
          if (source) {
            const aligned = alignEntity(source, entity.start, entity.end);
            if (aligned) {
              const remaining = model.entities.filter((e) => e.id !== source.id);
              updateEntities([...remaining, aligned], 'Align Object');
              setPickedEntityId(null);
              setModifySubStep(0);
              logMessage('Aligned object to reference line.', 'result');
              setActiveTool('select');
              return;
            }
          }
        }
      }

      // 10. MATCHPROP (MA)
      if (activeTool === 'matchprop') {
        if (modifySubStep === 0 || !pickedEntityId) {
          setPickedEntityId(entity.id);
          setModifySubStep(1);
          logMessage(
            `MATCHPROP: Source is ${entity.type} (Layer: ${entity.layer}). Click destination object(s) to apply properties to (Esc to finish).`,
            'info'
          );
          return;
        }
        const source = model.entities.find((e) => e.id === pickedEntityId);
        if (source) {
          const updated = model.entities.map((e) => {
            if (e.id !== entity.id) return e;
            const clone = { ...e, layer: source.layer };
            if (source.type === 'wall' && clone.type === 'wall') {
              clone.thickness = source.thickness;
              clone.height = source.height;
              clone.justification = source.justification;
              clone.wallTypeId = source.wallTypeId;
            }
            if (source.type === 'text' && clone.type === 'text') {
              clone.fontSize = source.fontSize;
            }
            return clone;
          });
          updateEntities(updated, `Match Properties to ${entity.type}`);
          logMessage(
            `Matched properties to ${entity.type}. Click next object or press Esc when done.`,
            'result'
          );
        }
        return;
      }

      // 11. AREA (AA) by clicking object
      if (activeTool === 'area') {
        const { area, perimeter, description } = computeEntityAreaAndPerimeter(entity);
        const areaM = formatArea(area, 'metric');
        const areaImp = formatArea(area, 'imperial');
        const perimM = formatLength(perimeter, 'metric');
        const perimImp = formatLength(perimeter, 'imperial');
        logMessage(
          `AREA (${description}): Area = ${model.settings.units === 'metric' ? `${areaM} (${areaImp})` : `${areaImp} (${areaM})`}, Perimeter = ${model.settings.units === 'metric' ? `${perimM} (${perimImp})` : `${perimImp} (${perimM})`}`,
          'result'
        );
        return;
      }

      if (selectedIds.length === 0 && ['mirror', 'scale', 'array'].includes(activeTool)) {
        setSelectedIds([entity.id]);
        logMessage(`Selected ${entity.type} for ${activeTool.toUpperCase()}.`, 'info');
      }
    },
    [
      activeTool,
      modifySubStep,
      pickedEntityId,
      cuttingEdgeIds,
      boundaryEdgeIds,
      filletRadius,
      chamferD1,
      chamferD2,
      drawingPoints,
      model.entities,
      model.blocks,
      model.layers,
      model.settings.units,
      model.settings.trimMode,
      model.settings.edgeMode,
      trimEraseSubMode,
      selectedIds,
      updateEntities,
      logMessage,
      addToast,
    ]
  );

  const handleFenceComplete = useCallback(
    (path: Point[], shiftKey: boolean = false) => {
      if (path.length < 2) return;
      let effectiveTool = activeTool;
      if (activeTool === 'trim' && shiftKey) {
        effectiveTool = 'extend';
      } else if (activeTool === 'extend' && shiftKey) {
        effectiveTool = 'trim';
      }
      const isTrim = effectiveTool === 'trim';
      const lockedLayerIds = new Set(
        model.layers.filter((l) => l.locked || !l.visible).map((l) => l.id)
      );
      const candidates = model.entities.filter((e) => !lockedLayerIds.has(e.layer));
      const hits = fenceHits(path, candidates);

      if (hits.length === 0) {
        logMessage('Fence did not cross any objects.', 'info');
        return;
      }

      const trimMode: TrimExtendMode = model.settings.trimMode ?? 'quick';
      const edgeMode: EdgeExtensionMode = model.settings.edgeMode ?? 'noextend';
      let currentEntities = [...model.entities];
      let modifiedCount = 0;

      for (const hit of hits) {
        const target = currentEntities.find((e) => e.id === hit.object.id);
        if (!target || lockedLayerIds.has(target.layer)) continue;

        if (isTrim) {
          let edges: ArchEntity[];
          if (trimMode === 'quick' || cuttingEdgeIds.length === 0) {
            edges = currentEntities.filter((e) => e.id !== target.id);
          } else {
            edges = currentEntities.filter((e) => cuttingEdgeIds.includes(e.id) && e.id !== target.id);
          }

          const trimRes = trimAt(target, hit.pickPoint, edges, trimMode, currentEntities, {
            edge: edgeMode,
            implied: edgeMode === 'extend',
          });

          if (trimRes.action === 'deleted') {
            currentEntities = currentEntities.filter((e) => e.id !== target.id);
            modifiedCount++;
          } else if (trimRes.action === 'replaced') {
            const others = currentEntities.filter((e) => e.id !== target.id);
            currentEntities = updateAssociatedDimensions(target, trimRes.entities, [...others, ...trimRes.entities]);
            modifiedCount++;
          }
        } else {
          if (target.type === 'circle') continue;
          let boundaries: ArchEntity[];
          if (trimMode === 'quick' || boundaryEdgeIds.length === 0) {
            boundaries = currentEntities.filter((e) => e.id !== target.id);
          } else {
            boundaries = currentEntities.filter((e) => boundaryEdgeIds.includes(e.id) && e.id !== target.id);
          }

          const extRes = extendAt(target, hit.pickPoint, boundaries, trimMode, edgeMode);
          if (extRes.extendedEntity && extRes.extendedEntity !== target) {
            const others = currentEntities.filter((e) => e.id !== target.id);
            currentEntities = updateAssociatedDimensions(target, [extRes.extendedEntity], [...others, extRes.extendedEntity]);
            modifiedCount++;
          }
        }
      }

      if (modifiedCount > 0) {
        setTrimUndoStack((prev) => [...prev, model.entities]);
        const next = syncHostedBimEntities(currentEntities);
        updateEntities(next, `Fence ${isTrim ? 'Trim' : 'Extend'} (${modifiedCount} objects)`);
        logMessage(`Fence ${isTrim ? 'trimmed' : 'extended'} ${modifiedCount} object(s).`, 'result');
        addToast(`Fence ${isTrim ? 'trimmed' : 'extended'} ${modifiedCount} object(s).`, 'success');
      } else {
        logMessage('Fence crossed objects, but no valid cuts or extensions were found.', 'info');
      }
    },
    [
      activeTool,
      model.layers,
      model.entities,
      model.settings.trimMode,
      model.settings.edgeMode,
      cuttingEdgeIds,
      boundaryEdgeIds,
      updateEntities,
      logMessage,
      addToast,
    ]
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      const { nextState, undoneLabel } = undoHistory(prev);
      if (undoneLabel) {
        logMessage(`Undo: ${undoneLabel}`, 'info');
      } else {
        logMessage('Nothing to undo.', 'info');
      }
      return nextState;
    });
  }, [logMessage]);

  const handleRedo = useCallback(() => {
    setHistory((prev) => {
      const { nextState, redoneLabel } = redoHistory(prev);
      if (redoneLabel) {
        logMessage(`Redo: ${redoneLabel}`, 'info');
      } else {
        logMessage('Nothing to redo.', 'info');
      }
      return nextState;
    });
  }, [logMessage]);

  const handleZoomExtents = useCallback(() => {
    const ext = computeModelExtents(model.entities);
    const rect = svgRef.current?.getBoundingClientRect();
    const viewW = rect?.width || 900;
    const viewH = rect?.height || 620;
    const modelW = Math.max(120, ext.maxX - ext.minX);
    const modelH = Math.max(120, ext.maxY - ext.minY);
    const pad = 1.35;
    const nextZoom = Math.max(
      0.25,
      Math.min(8, Math.min(viewW / (modelW * pad), viewH / (modelH * pad)))
    );
    const cx = (ext.minX + ext.maxX) / 2;
    const cy = (ext.minY + ext.maxY) / 2;
    setViewTransform({
      zoom: nextZoom,
      panX: viewW / 2 - cx * nextZoom,
      panY: viewH / 2 - cy * nextZoom,
    });
    canvas3dRef.current?.setCameraPreset('fit');
    logMessage('Zoomed to model extents.', 'info');
  }, [logMessage, model.entities]);

  /** Deletes ids; deleting walls with hosted openings asks "Also delete N hosted doors/windows?" first. */
  const requestDelete = useCallback(
    (ids: string[], label: string, confirmed = false) => {
      const wallIds = model.entities.filter((e) => e.type === 'wall' && ids.includes(e.id)).map((e) => e.id);
      const hosted = hostedOpeningsOf(model.entities, wallIds, ids).map((o) => o.id);
      if (hosted.length && !confirmed) {
        setPendingDelete({ ids, hosted, label });
        return;
      }
      const drop = new Set([...ids, ...hosted]);
      const next = syncHostedBimEntities(model.entities.filter((e) => !drop.has(e.id)));
      updateEntities(next, label);
      setSelectedIds((cur) => cur.filter((id) => !drop.has(id)));
      logMessage(`${label}: deleted ${ids.length} object(s)${hosted.length ? ` and ${hosted.length} hosted door(s)/window(s)` : ''}.`, 'result');
    },
    [model.entities, updateEntities, logMessage]
  );

  const handleDeleteSelectionOrStartErase = useCallback(() => {
    if (selectedIds.length > 0) {
      requestDelete(selectedIds, `Delete ${selectedIds.length} Object(s)`);
    } else {
      handleActivateTool('erase');
      logMessage('ERASE (E / DE): Click objects to erase them.', 'info');
    }
  }, [handleActivateTool, logMessage, requestDelete, selectedIds]);

  const handleSelectAll = useCallback(() => {
    const unlockedLayers = new Set(
      model.layers.filter((l) => l.visible && !l.locked).map((l) => l.id)
    );
    const allIds = model.entities
      .filter(
        (e) =>
          unlockedLayers.has(e.layer) &&
          ((e.levelId || 'level-1') === activeLevelId || e.type === 'grid')
      )
      .map((e) => e.id);
    setSelectedIds(allIds);
    logMessage(`Selected ${allIds.length} object(s) on current level.`, 'info');
  }, [activeLevelId, logMessage, model.entities, model.layers]);

  // Temporary Hide / Isolate handlers (HH, HI, HR)
  const handleTempHideSelected = useCallback(() => {
    if (selectedIds.length === 0) {
      logMessage('HIDE ELEMENT (HH): Select one or more objects first, then type HH.', 'info');
      return;
    }
    setTempHiddenIds((prev) => Array.from(new Set([...prev, ...selectedIds])));
    logMessage(
      `Temporarily hid ${selectedIds.length} element(s). Type HR to reset temporary hide/isolate.`,
      'result'
    );
    setSelectedIds([]);
  }, [logMessage, selectedIds]);

  const handleTempIsolateSelected = useCallback(() => {
    if (selectedIds.length === 0) {
      logMessage('ISOLATE ELEMENT (HI): Select one or more objects first, then type HI.', 'info');
      return;
    }
    setTempIsolatedIds(selectedIds);
    logMessage(
      `Temporarily isolated ${selectedIds.length} element(s). Type HR to restore all elements.`,
      'result'
    );
  }, [logMessage, selectedIds]);

  const handleResetTempHideIsolate = useCallback(() => {
    setTempHiddenIds([]);
    setTempIsolatedIds([]);
    logMessage('Reset Temporary Hide/Isolate (HR) — all elements restored.', 'result');
  }, [logMessage]);

  const handleLoadStressTest = useCallback(() => {
    const stressEntities = createStressTestEntities(2000, activeLevelId);
    commitModel(
      {
        ...model,
        projectName: '2,000-Object Stress Test',
        entities: stressEntities,
      },
      'Load 2,000-Object Performance Benchmark'
    );
    setSelectedIds([]);
    setDrawingPoints([]);
    setTempHiddenIds([]);
    setTempIsolatedIds([]);
    setViewMode('2d');
    setViewTransform({ panX: 50, panY: 50, zoom: 0.22 });
    logMessage(
      `Loaded 2,000-object performance benchmark (${stressEntities.length} CAD & BIM entities).`,
      'result'
    );
    addToast('Loaded 2,000-object performance benchmark smoothly!', 'success');
  }, [activeLevelId, addToast, commitModel, logMessage, model]);

  // Command Context for COMMAND_REGISTRY
  const commandContext: CommandContext = {
    activateTool: handleActivateTool,
    deleteSelectionOrStartErase: handleDeleteSelectionOrStartErase,
    undo: handleUndo,
    redo: handleRedo,
    zoomExtents: handleZoomExtents,
    openLayersPanel: () => {
      setLayersExpanded(true);
      logMessage('LAYERS (LA): Layers panel expanded.', 'info');
    },
    openPropertiesPanel: () => {
      if (viewMode === 'schedules' || viewMode === 'sheets') {
        setViewMode('2d');
      }
      setLayersExpanded(false);
      let activeSelCount = selectedIds.length;
      if (activeSelCount === 0 && model.entities.length > 0) {
        const lastEnt = model.entities[model.entities.length - 1];
        setSelectedIds([lastEnt.id]);
        activeSelCount = 1;
      }
      setTimeout(() => {
        const panel = document.querySelector('aside[aria-label*="Properties" i], aside');
        if (panel instanceof HTMLElement) {
          panel.scrollTop = 0;
          const firstField = panel.querySelector<HTMLElement>('input, select, button');
          firstField?.focus();
        }
      }, 20);
      logMessage(
        activeSelCount > 0
          ? `PROPERTIES (PR): Expanded & focused Properties inspector (${activeSelCount} object(s) selected).`
          : 'PROPERTIES (PR): Expanded & focused Properties inspector.',
        'info'
      );
      addToast('Properties inspector focused.', 'info');
    },
    openHelpModal: () => setHelpOpen(true),
    openDimStyleModal: () => setDimStyleOpen(true),
    openLibraryTab: () => setLeftTab('library'),
    openBlockEditor: (blockId?: string) => {
      const selEnt = model.entities.find(
        (e) => selectedIds.includes(e.id) && e.type === 'block'
      );
      const targetId =
        blockId ||
        (selEnt && selEnt.type === 'block' ? selEnt.blockId : activeInsertBlockId);
      setEditingBlockId(targetId);
      setBlockEditorOpen(true);
    },
    openLevelModal: () => setLevelModalOpen(true),
    openLevelManager: () => setLevelModalOpen(true),
    openVisibilityModal: () => setVisibilityModalOpen(true),
    tempHideSelected: handleTempHideSelected,
    hideSelectedElements: handleTempHideSelected,
    tempIsolateSelected: handleTempIsolateSelected,
    isolateSelectedElements: handleTempIsolateSelected,
    tempResetHideIsolate: handleResetTempHideIsolate,
    resetTemporaryHideIsolate: handleResetTempHideIsolate,
    openSchedulesView: () => {
      setViewMode('schedules');
      logMessage('Switched to Schedules view (Doors, Windows, Rooms).', 'info');
    },
    openSheetsView: () => {
      setViewMode('sheets');
      logMessage('Switched to Architectural Sheets view.', 'info');
    },
    exportDxf: () => handleExportDxf('level'),
    exportIfc: () => handleExportIfc(),
    exportPdf: () => handleExportPdf(),
    openShortcutCheatSheet: () => setShortcutSheetOpen(true),
    startGuidedTour: () => handleStartTour(),
    loadStressTest: () => handleLoadStressTest(),
    openElevation: (d) => {
      setElevationDir(d);
      setViewMode('elevation');
    },
    openRoofPlan: () => setViewMode('roofplan'),
    openStructuralView: (k: 'foundationplan' | 'framingplan' | 'stsection') => openStructuralView(k),
    setDiscipline: (d: Discipline) => {
      setDiscipline(d);
      logMessage(`Discipline: ${d}.`, 'info');
    },
    toggleAnalytical: () => {
      setAnalytical((a) => !a);
      logMessage(`Analytical view ${analytical ? 'off' : 'on'} (centrelines, nodes, supports, loads).`, 'info');
    },
    navViewCube: () => {
      const text = `NAVVCUBE  Enter an option [ON/OFF] <${viewCubeOn ? 'ON' : 'OFF'}>:`;
      logMessage(text, 'info');
      setCmdPrompt({
        text,
        answer: (input) => {
          const v = parseOnOff(input, viewCubeOn);
          if (v === null) {
            logMessage(`Invalid option "${input}". Enter ON or OFF.`, 'error');
            return false;
          }
          setViewCube(v);
          return true;
        },
      });
    },
    toggleSectionBox: () => {
      const on = !sectionBox3d;
      setSectionBox3d(on);
      if (on && viewMode !== '3d' && viewMode !== 'split') setViewMode('3d');
      logMessage(
        on
          ? 'SECTION BOX (BX): drag the blue handles to cut the model — pull the top face down to look into the foundations. BX again turns it off.'
          : 'Section box off.',
        'info'
      );
    },
    toggleXray: () => {
      setGround3d((g) => ({ ...g, xray: !g.xray }));
      if (viewMode !== '3d' && viewMode !== 'split') setViewMode('3d');
      logMessage(`X-ray ${ground3d.xray ? 'off' : 'on'}: everything above grade ${ground3d.xray ? 'is solid again' : 'turns see-through'}.`, 'info');
    },
    toggleViewRebar: () => {
      setViewRebar((v) => !v);
      logMessage(`View rebar ${viewRebar ? 'off' : 'on'}.`, 'info');
    },
    structureJoin: (a: 'join' | 'unjoin' | 'switch') => applyStructResult(joinAction(model, selectedIds, a)),
    attachColumnTopToBeam: () => applyStructResult(attachColumnTopToBeam(model, selectedIds)),
    applyRebarPresetToSelection: () => {
      if (!selectedIds.length) {
        logMessage('Select a concrete host (footing, column, beam, slab or wall) first.', 'error');
        return;
      }
      let m = model;
      let applied = 0;
      for (const id of selectedIds) {
        const r = applyRebarPreset(m, id);
        if (r.entities) {
          m = { ...m, entities: r.entities };
          applied++;
        }
      }
      if (applied) {
        commitModel(m, `Rebar presets (${applied})`);
        logMessage(`Applied quick rebar presets to ${applied} host(s).`, 'result');
      } else logMessage('No concrete hosts in the selection.', 'error');
    },
    equalizeOpenings: () => {
      // selected openings (grouped by wall), or every opening of the selected walls
      const sel = model.entities.filter((e) => selectedIds.includes(e.id));
      const wallIds = new Set<string>([
        ...sel.filter(isHostedOpening).map((o) => o.wallId),
        ...sel.filter((e) => e.type === 'wall').map((w) => w.id),
      ]);
      let changed = 0;
      let next = model.entities;
      for (const wid of wallIds) {
        const wall = model.entities.find((e): e is WallEntity => e.type === 'wall' && e.id === wid);
        if (!wall) continue;
        const pickedOnWall = sel.filter(isHostedOpening).filter((o) => o.wallId === wid);
        const ops = pickedOnWall.length >= 2 || !sel.some((e) => e.id === wid) ? pickedOnWall : hostedOpeningsOf(model.entities, [wid]);
        if (ops.length < 1) continue;
        const offs = equalSpacingOffsets(dist(wall.start, wall.end), ops);
        next = next.map((e) => (isHostedOpening(e) && offs.has(e.id) ? { ...e, offset: offs.get(e.id)! } : e));
        changed += ops.length;
      }
      if (!changed) {
        logMessage('EQ: select openings on one wall (or a wall with openings) first.', 'error');
        return;
      }
      updateEntities(syncHostedBimEntities(next), 'Equal Spacing (EQ)');
      logMessage(`EQ: spaced ${changed} opening(s) equally along their wall.`, 'result');
    },
    attachSelectedWallsToRoof: () => attachWallsToRoof(true),
    detachSelectedWalls: () => attachWallsToRoof(false),
    selectAll: handleSelectAll,
    logMessage,
    isRevitStyleDI: model.settings.revitStyleDI,
  };

  const activeWallType =
    (model.wallTypes ?? []).find((wt) => wt.id === activeWallTypeId) ??
    (model.wallTypes ?? [])[1];

  // Add point during drawing (also handles Wall chaining & Room click detection!)
  const handleAddDrawingPoint = useCallback(
    (pt: Point) => {
      // Special case: ROOM (RM) tool creates room on single click inside enclosed walls on active level
      if (activeTool === 'room') {
        const walls = model.entities.filter(
          (e): e is WallEntity =>
            e.type === 'wall' && (e.levelId || 'level-1') === activeLevelId
        );
        const enclosed = findEnclosedRoomAtPoint(pt, walls);
        if (enclosed) {
          const roomCount =
            model.entities.filter((e) => e.type === 'room').length + 1;
          const centroid = polygonCentroid(enclosed.polygon);
          const newRoom: ArchEntity = {
            id: `room-${Date.now()}`,
            type: 'room',
            layer: 'A-AREA',
            levelId: activeLevelId,
            name: `Room ${roomCount}`,
            wallIds: enclosed.wallIds,
            polygon: enclosed.polygon,
            labelPos: centroid,
            floorMaterial: 'wood',
          };
          updateEntities([...model.entities, newRoom], 'Create Room');
          setSelectedIds([newRoom.id]);
          const areaStr = formatArea(
            polygonArea(enclosed.polygon),
            model.settings.units
          );
          logMessage(`Created "${newRoom.name}" (${areaStr}).`, 'result');
        } else {
          logMessage(
            'ROOM (RM): No enclosed wall boundary found at that point on the active level. Make sure walls form a closed loop.',
            'error'
          );
        }
        return;
      }

      // Special case: WALL (WA) tool chains wall segments using active WallType thickness!
      if (activeTool === 'wall' || activeTool === 'curtainwall') {
        const isCW = activeTool === 'curtainwall';
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
        } else {
          const prevPt = drawingPoints[drawingPoints.length - 1];
          if (dist(prevPt, pt) > 1) {
            const wtThickness = activeWallType
              ? getWallTypeTotalThickness(activeWallType)
              : 6;
            const newWall: WallEntity = {
              id: `wall-${Date.now()}`,
              type: 'wall',
              layer: 'A-WALL',
              levelId: activeLevelId,
              wallTypeId: isCW ? 'wt-curtain' : activeWallType?.id ?? 'wt-ext-2x6',
              start: prevPt,
              end: pt,
              thickness: isCW ? 4 : wtThickness,
              height: 108,
              baseOffset: 0,
              justification: 'center',
              ...(isCW
                ? { curtain: { hSpacing: facadeTool.cwHSpacing, vSpacing: facadeTool.cwVSpacing, mullionSize: 2.5, mullionColor: '#334155' } }
                : {}),
            };
            const synced = syncHostedBimEntities([...model.entities, newWall]);
            updateEntities(synced, 'Draw Wall');
            setDrawingPoints([pt]);
            logMessage(
              `Added ${isCW ? 'Curtain Wall' : `Wall (${activeWallType?.name ?? 'Wall'}`}, ${formatLength(
                dist(prevPt, pt),
                model.settings.units
              )}). Click next point or press Enter to finish.`,
              'result'
            );
          }
        }
        return;
      }

      // Special case: OFFSET (O) — point click sets side point!
      if (activeTool === 'offset' && pickedEntityId) {
        const target = model.entities.find((e) => e.id === pickedEntityId);
        if (target) {
          const off = offsetEntity(target, offsetDist, pt);
          if (off) {
            updateEntities([...model.entities, off], `Offset ${target.type}`);
            logMessage(
              `Created Offset copy (${formatLength(offsetDist, model.settings.units)}). Click another side or pick next object.`,
              'result'
            );
          }
        }
        return;
      }

      // Special case: MIRROR (MI) — click points 1 & 2 for mirror line axis
      if (activeTool === 'mirror') {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
          setModifySubStep(1);
          logMessage('MIRROR: Click second point of reflection axis line.', 'info');
        } else if (drawingPoints.length === 1) {
          setDrawingPoints([drawingPoints[0], pt]);
          setModifySubStep(2);
          logMessage(
            'MIRROR: Erase source objects? Type Y (Yes) or N (No, default) in command line below and press Enter.',
            'info'
          );
        }
        return;
      }

      // Special case: STRETCH (S)
      if (activeTool === 'stretch') {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
          setModifySubStep(1);
          logMessage('STRETCH: Click opposite corner of crossing window.', 'info');
        } else if (drawingPoints.length === 1) {
          setDrawingPoints([drawingPoints[0], pt]);
          setModifySubStep(2);
          logMessage('STRETCH: Click base point for stretch.', 'info');
        } else if (drawingPoints.length === 2) {
          setDrawingPoints([drawingPoints[0], drawingPoints[1], pt]);
          setModifySubStep(3);
          logMessage('STRETCH: Click second displacement point or type @dx,dy.', 'info');
        } else if (drawingPoints.length === 3) {
          const pA = drawingPoints[0];
          const pB = drawingPoints[1];
          const base = drawingPoints[2];
          const delta = sub(pt, base);
          const stretched = stretchEntities(model.entities, pA, pB, delta);
          updateEntities(stretched, 'Stretch Endpoints');
          setDrawingPoints([]);
          setModifySubStep(0);
          setActiveTool('select');
          logMessage('Stretched endpoints.', 'result');
        }
        return;
      }

      // Special case: SCALE (SC)
      if (activeTool === 'scale' && selectedIds.length > 0) {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
          setModifySubStep(1);
          logMessage('SCALE: Click point or type scale factor (e.g. 1.5, 0.5) and press Enter.', 'info');
        } else {
          const base = drawingPoints[0];
          const dNow = dist(base, pt);
          const factor = Math.max(0.01, dNow / 60);
          const scaled = model.entities.map((ent) =>
            selectedIds.includes(ent.id) ? scaleEntityByBase(ent, base, factor) : ent
          );
          updateEntities(scaled, `Scale Selection (${factor.toFixed(2)}x)`);
          setDrawingPoints([]);
          setModifySubStep(0);
          setActiveTool('select');
          logMessage(`Scaled selection by ${factor.toFixed(2)}x.`, 'result');
        }
        return;
      }

      // Special case: ARRAY (polar or rectangular)
      if (activeTool === 'array' && selectedIds.length > 0) {
        if (arrayMode === 'polar') {
          const center = pt;
          const polarCopies = createPolarArray(
            model.entities.filter((e) => selectedIds.includes(e.id)),
            center,
            arrayCount,
            arrayAngle
          );
          updateEntities(syncHostedBimEntities([...model.entities, ...polarCopies]), 'Polar Array');
          logMessage(`Created Polar Array with ${polarCopies.length} copies.`, 'result');
          setActiveTool('select');
          return;
        } else {
          const rectCopies = createRectangularArray(
            model.entities.filter((e) => selectedIds.includes(e.id)),
            arrayRows,
            arrayCols,
            arrayRowSpacing,
            arrayColSpacing,
            model.entities
          );
          updateEntities(syncHostedBimEntities([...model.entities, ...rectCopies]), 'Rectangular Array');
          logMessage(`Created Rectangular Array (${arrayRows}×${arrayCols}, +${rectCopies.length} copies).`, 'result');
          setActiveTool('select');
          return;
        }
      }

      // Special case: ALIGN
      if (activeTool === 'align' && pickedEntityId) {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
          setModifySubStep(2);
          logMessage('ALIGN: Click second destination point along reference direction.', 'info');
        } else if (drawingPoints.length === 1) {
          const refA = drawingPoints[0];
          const refB = pt;
          const source = model.entities.find((e) => e.id === pickedEntityId);
          if (source) {
            const aligned = alignEntity(source, refA, refB);
            if (aligned) {
              const remaining = model.entities.filter((e) => e.id !== source.id);
              updateEntities([...remaining, aligned], 'Align Object');
              logMessage('Aligned object with destination points.', 'result');
            }
          }
          setPickedEntityId(null);
          setDrawingPoints([]);
          setModifySubStep(0);
          setActiveTool('select');
        }
        return;
      }

      // Special case: BREAK — point 2
      if (activeTool === 'break' && pickedEntityId && drawingPoints.length === 1) {
        const target = model.entities.find((e) => e.id === pickedEntityId);
        if (target) {
          const res = breakEntity(target, drawingPoints[0], pt);
          const remaining = model.entities.filter((e) => e.id !== target.id);
          updateEntities([...remaining, ...res], `Break ${target.type}`);
          logMessage(`Broke ${target.type}.`, 'result');
        }
        setPickedEntityId(null);
        setDrawingPoints([]);
        setModifySubStep(0);
        return;
      }

      // Special case: BLOCK (B)
      if (activeTool === 'block' && selectedIds.length > 0) {
        setDrawingPoints([pt]);
        logMessage(
          'BLOCK (B): Base point set. Type a block name in the command line below and press Enter (or press Enter for default name):',
          'info'
        );
        commandInputRef.current?.focus();
        return;
      }

      setDrawingPoints((prev) => [...prev, pt]);
    },
    [
      activeLevelId,
      activeTool,
      activeWallType,
      drawingPoints,
      logMessage,
      model.entities,
      model.settings.units,
      updateEntities,
      pickedEntityId,
      offsetDist,
      selectedIds,
      arrayMode,
      arrayCount,
      arrayAngle,
    ]
  );

  // Helper to create Floor or Roof from sketched points or active level walls
  const createFloorFromSketchOrWalls = useCallback(() => {
    const ft = (model.floorTypes ?? [])[0];
    if (drawingPoints.length >= 3) {
      const newFloor: FloorEntity = {
        id: `floor-${Date.now()}`,
        type: 'floor',
        layer: 'A-FLOR',
        levelId: activeLevelId,
        polygon: drawingPoints,
        thickness: ft?.thickness ?? 6,
        floorTypeId: ft?.id ?? 'ft-wood-oak',
        material: ft?.material ?? 'Oak Hardwood',
      };
      updateEntities([...model.entities, newFloor], 'Create Floor Slab');
      setSelectedIds([newFloor.id]);
      setDrawingPoints([]);
      setActiveTool('select');
      logMessage(
        `Created Floor Slab (${formatArea(
          polygonArea(newFloor.polygon),
          model.settings.units
        )}).`,
        'result'
      );
      return;
    }

    const levelWalls = model.entities.filter(
      (e): e is WallEntity =>
        e.type === 'wall' && (e.levelId || 'level-1') === activeLevelId
    );
    const allWalls =
      levelWalls.length > 0
        ? levelWalls
        : model.entities.filter((e): e is WallEntity => e.type === 'wall');
    const footprint = computeOuterFootprintFromWalls(allWalls, 0);
    if (footprint) {
      const newFloor: FloorEntity = {
        id: `floor-${Date.now()}`,
        type: 'floor',
        layer: 'A-FLOR',
        levelId: activeLevelId,
        polygon: footprint,
        thickness: ft?.thickness ?? 6,
        floorTypeId: ft?.id ?? 'ft-wood-oak',
        material: ft?.material ?? 'Oak Hardwood',
      };
      updateEntities([...model.entities, newFloor], 'Create Floor from Walls');
      setSelectedIds([newFloor.id]);
      setDrawingPoints([]);
      setActiveTool('select');
      logMessage(
        `Created Floor Slab from wall footprint (${formatArea(
          polygonArea(footprint),
          model.settings.units
        )}).`,
        'result'
      );
    } else {
      logMessage('FLOOR (SB): Draw walls first or click 3+ points to sketch a floor boundary.', 'error');
    }
  }, [activeLevelId, drawingPoints, logMessage, model.entities, model.floorTypes, model.settings.units, updateEntities]);

  /** Revit "Attach Top": selected walls follow the underside of the roof above them. */
  const attachWallsToRoof = useCallback(
    (attach: boolean) => {
      const sel = model.entities.filter((e): e is WallEntity => e.type === 'wall' && selectedIds.includes(e.id));
      if (!sel.length) {
        logMessage(`${attach ? 'ATTACH (AT)' : 'DETACH (DT)'}: select one or more walls first.`, 'error');
        return;
      }
      if (!attach) {
        updateEntities(
          model.entities.map((e) => (e.type === 'wall' && selectedIds.includes(e.id) ? { ...e, attachedRoofId: undefined } : e)),
          'Detach Walls from Roof'
        );
        logMessage(`Detached ${sel.length} wall(s) from the roof.`, 'result');
        return;
      }
      const roofs = model.entities.filter((e): e is RoofEntity => e.type === 'roof');
      let count = 0;
      const next = model.entities.map((e) => {
        if (e.type !== 'wall' || !selectedIds.includes(e.id)) return e;
        const mid = { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 };
        const roof = roofs.find((r) => {
          const lv = (model.levels || []).find((l) => l.id === (r.levelId || 'level-1'))?.elevation ?? 0;
          return pointInPolygon(mid, getRoofGeometry(r, lv).outline);
        });
        if (!roof) return e;
        count++;
        return { ...e, attachedRoofId: roof.id };
      });
      if (!count) {
        logMessage('ATTACH (AT): no roof found above the selected walls.', 'error');
        return;
      }
      updateEntities(next, 'Attach Walls to Roof');
      logMessage(`Attached ${count} wall(s) to the roof — gable ends now rise to the roof underside.`, 'result');
    },
    [logMessage, model.entities, model.levels, selectedIds, updateEntities]
  );

  const createRoofFromSketchOrWalls = useCallback(() => {
    const levelWalls = model.entities.filter(
      (e): e is WallEntity => e.type === 'wall' && (e.levelId || 'level-1') === activeLevelId
    );
    let footprint: Point[] = [];
    let wallIds: string[] = [];
    let source = '';
    if (roofTool.mode === 'sketch' && drawingPoints.length >= 3) {
      footprint = drawingPoints;
      source = 'sketched outline';
    } else if (roofTool.pickedWallIds.length > 0) {
      const picked = levelWalls.filter((w) => roofTool.pickedWallIds.includes(w.id));
      footprint = footprintFromWalls(picked);
      wallIds = picked.map((w) => w.id);
      source = `${picked.length} picked walls`;
      if (footprint.length < 3) {
        logMessage('ROOF (RF): The picked walls do not form a closed loop. Press Tab over a wall to pick its whole connected chain.', 'error');
        return;
      }
    } else if (drawingPoints.length >= 3) {
      footprint = drawingPoints;
      source = 'sketched outline';
    } else if (levelWalls.length >= 3) {
      // nothing picked: use the longest closed chain of walls on this level
      const longest = levelWalls.slice().sort((x, y) => dist(y.start, y.end) - dist(x.start, x.end))[0];
      const chain = connectedWallChain(levelWalls, longest.id);
      footprint = footprintFromWalls(chain);
      wallIds = chain.map((w) => w.id);
      source = 'the walls on this level';
      if (footprint.length < 3) {
        const bbox = computeOuterFootprintFromWalls(levelWalls, 3);
        footprint = bbox || [];
      }
    }
    if (footprint.length < 3) {
      logMessage('ROOF (RF): Pick walls (Tab = whole chain) or sketch 3+ points, then press Enter.', 'error');
      return;
    }
    const norm = normalizeFootprint(footprint);
    const plate = wallIds.length
      ? Math.max(...levelWalls.filter((w) => wallIds.includes(w.id)).map((w) => (w.baseOffset || 0) + (w.height || 108)))
      : Math.max(108, ...levelWalls.map((w) => (w.baseOffset || 0) + (w.height || 108)));
    const style = roofTool.style;
    const newRoof: RoofEntity = {
      id: `roof-${Date.now()}`,
      type: 'roof',
      layer: 'A-ROOF',
      levelId: activeLevelId,
      roofVersion: 2,
      polygon: norm.polygon,
      edgeSlopes: defaultEdgeSlopes(norm.polygon, style),
      roofStyle: style,
      slope: style === 'flat' ? 0 : roofTool.slope,
      thickness: 8,
      overhang: style === 'flat' ? 6 : 18,
      baseOffset: Number.isFinite(plate) ? plate : 108,
      fasciaDepth: 8,
      gutter: style !== 'flat',
      material: style === 'flat' ? 'membrane' : 'asphalt-shingle',
      parapetHeight: style === 'flat' ? 30 : 0,
      wallIds,
    };
    updateEntities([...model.entities, newRoof], `Create ${style[0].toUpperCase()}${style.slice(1)} Roof`);
    setSelectedIds([newRoof.id]);
    setDrawingPoints([]);
    setRoofTool((r) => ({ ...r, pickedWallIds: [] }));
    setActiveTool('select');
    logMessage(
      `Created ${style} roof from ${source} (${style === 'flat' ? 'flat' : formatSlope(newRoof.slope)}, ${formatLength(newRoof.overhang, model.settings.units)} overhang). Edit edges' "Defines slope", material and slope in Properties; select gable walls → "Attach to roof".`,
      'result'
    );
  }, [activeLevelId, drawingPoints, logMessage, model.entities, model.settings.units, roofTool, updateEntities]);

  const createRailingFromPath = useCallback(() => {
    if (drawingPoints.length < 2) {
      logMessage('RAILING (RAIL): Click at least 2 path points, then press Enter.', 'error');
      return;
    }
    const rail: RailingEntity = {
      id: `rail-${Date.now()}`,
      type: 'railing',
      layer: 'A-WALL',
      levelId: activeLevelId,
      path: drawingPoints,
      height: facadeTool.railingHeight,
      baseOffset: 0,
      style: facadeTool.railingStyle,
      balusterSpacing: 4,
    };
    updateEntities([...model.entities, rail], 'Create Railing');
    setSelectedIds([rail.id]);
    setDrawingPoints([]);
    logMessage(`Created ${facadeTool.railingStyle === 'glass' ? 'glass' : 'baluster'} railing (${drawingPoints.length - 1} segments).`, 'result');
  }, [activeLevelId, drawingPoints, facadeTool.railingHeight, facadeTool.railingStyle, logMessage, model.entities, updateEntities]);

  // ---- CAMERA (CAM) ----------------------------------------------------------------------
  const cameras = useMemo(() => model.entities.filter((e): e is CameraEntity => e.type === 'camera'), [model.entities]);
  const activeCamera = activeCameraId ? cameras.find((c) => c.id === activeCameraId) ?? null : null;

  const openCamera = useCallback(
    (id: string) => {
      const cam = model.entities.find((e): e is CameraEntity => e.type === 'camera' && e.id === id);
      if (!cam) return;
      setDrawingPoints([]);
      setActiveTool('select');
      setSelectedIds([id]);
      setActiveCameraId(id);
      setViewMode('3d');
      logMessage(`Opened ${cam.name} (${fovLabel(cam.fov)}). Drag to look around, arrow keys to walk, then Save view.`, 'info');
    },
    [logMessage, model.entities]
  );

  const placeCamera = useCallback(
    (position: Point, target: Point, fov: number) => {
      const cam = makeCamera({
        id: `cam-${Date.now()}`,
        name: nextCameraName(model.entities),
        levelId: activeLevelId,
        position,
        target,
        fov,
        baseZ: groundElevationAt(model, position, activeLevelId),
      });
      updateEntities([...model.entities, cam], `Place ${cam.name}`);
      setDrawingPoints([]);
      setActiveTool('select');
      setSelectedIds([cam.id]);
      setActiveCameraId(cam.id);
      setViewMode('3d');
      logMessage(
        `${cam.name} placed — ${fovLabel(cam.fov)}, eye ${formatLength(cam.eyeHeight, model.settings.units)} above the ground. Its perspective view is open; it is listed under Views in the right panel.`,
        'result'
      );
    },
    [activeLevelId, logMessage, model, updateEntities]
  );

  const updateCamera = useCallback(
    (cam: CameraEntity, label: string) => updateEntities(model.entities.map((e) => (e.id === cam.id ? cam : e)), label),
    [model.entities, updateEntities]
  );

  const deleteCamera = useCallback(
    (id: string) => {
      const cam = cameras.find((c) => c.id === id);
      updateEntities(model.entities.filter((e) => e.id !== id), `Delete ${cam?.name ?? 'Camera'}`);
      setSelectedIds((ids) => ids.filter((x) => x !== id));
      if (activeCameraId === id) setActiveCameraId(null);
      logMessage(`Deleted ${cam?.name ?? 'camera'} (Ctrl+Z to undo).`, 'result');
    },
    [activeCameraId, cameras, logMessage, model.entities, updateEntities]
  );

  const runWalkthrough = useCallback(
    (record: boolean) => {
      if (cameras.length < 2) {
        logMessage('WALKTHROUGH: place at least two cameras along the path first.', 'error');
        return;
      }
      setDrawingPoints([]);
      setActiveTool('select');
      setActiveCameraId(cameras[0].id);
      setViewMode('3d');
      logMessage(`WALKTHROUGH: flying through ${cameras.length} cameras${record ? ' and recording WebM video' : ''}…`, 'info');
      const start = (attempt = 0) => {
        const h = canvas3dRef.current;
        if (!h) {
          if (attempt < 50) window.setTimeout(() => start(attempt + 1), 100);
          return;
        }
        h.playWalkthrough(cameras, { record }).then((blob) => {
          if (!record) return;
          if (!blob) {
            logMessage('WALKTHROUGH: this browser could not record video (MediaRecorder / WebM unavailable).', 'error');
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(model.projectName || 'archiforma').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()}_walkthrough.webm`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          logMessage(`WALKTHROUGH: exported ${a.download} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`, 'result');
        });
      };
      window.setTimeout(() => start(), 300);
    },
    [cameras, logMessage, model.projectName]
  );

  // a camera view only lives in the full 3D view
  useEffect(() => {
    if (viewMode !== '3d') setActiveCameraId(null);
  }, [viewMode]);

  // Thumbnails (Views list) and sheet images are rendered off-screen whenever a camera changes, and
  // again on the Sheets view after the model changed.
  const modelRevRef = useRef<{ ents: unknown; rev: number }>({ ents: null, rev: 0 });
  if (modelRevRef.current.ents !== model.entities) modelRevRef.current = { ents: model.entities, rev: modelRevRef.current.rev + 1 };
  const modelRev = modelRevRef.current.rev;
  const camRenderSig = (c: CameraEntity) => JSON.stringify([c.position, c.target, c.eyeHeight, c.targetHeight, c.baseZ, c.fov, c.near, c.far, c.twoPoint, c.aspect, c.sun]);
  const camerasToBake = cameras.filter((c) => {
    const r = cameraRenders[c.id];
    return !r || r.sig !== camRenderSig(c) || (viewMode === 'sheets' && r.rev !== modelRev);
  });
  const bakeKey = camerasToBake.map((c) => c.id + camRenderSig(c)).join('#') + (viewMode === 'sheets' ? `@${modelRev}` : '');
  const main3dMounted = viewMode === '3d' || viewMode === 'split';
  useEffect(() => {
    if (!camerasToBake.length) return;
    let cancelled = false;
    let timer = 0;
    const run = (attempt: number) => {
      if (cancelled) return;
      const h = main3dMounted && canvas3dRef.current ? canvas3dRef.current : bakerRef.current;
      if (!h) {
        if (attempt < 30) timer = window.setTimeout(() => run(attempt + 1), 150);
        return;
      }
      const out: typeof cameraRenders = {};
      for (const c of camerasToBake) {
        const a = aspectRatio(c.aspect);
        const thumb = h.renderCameraImage(c, 240, Math.round(240 / a), 'image/jpeg');
        const sheet = h.renderCameraImage(c, 1400, Math.round(1400 / a), 'image/jpeg');
        if (thumb) out[c.id] = { sig: camRenderSig(c), rev: modelRev, thumb, sheet: sheet || thumb };
      }
      if (Object.keys(out).length) setCameraRenders((prev) => ({ ...prev, ...out }));
    };
    timer = window.setTimeout(() => run(0), 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakeKey]);
  const cameraThumbs = useMemo(() => Object.fromEntries(Object.entries(cameraRenders).map(([k, v]) => [k, v.thumb])), [cameraRenders]);
  const cameraSheetImages = useMemo(() => Object.fromEntries(Object.entries(cameraRenders).map(([k, v]) => [k, v.sheet])), [cameraRenders]);

  // Command Line input submission handler
  const setViewCube = (on: boolean) => {
    setViewCubeOn(on);
    saveViewCubeSettings({ on });
    logMessage(`ViewCube ${on ? 'ON' : 'OFF'}.`, 'result');
  };
  const requestCubeView = (r: { kind: 'hotspot'; h: Hotspot } | { kind: 'home' } | { kind: 'cardinal'; c: Cardinal }) => {
    if (viewMode !== '3d' && viewMode !== 'split') setViewMode('3d');
    setCubeRequest({ ...r, nonce: Date.now() } as CubeRequest);
  };

  const handleCommandLineSubmit = (rawInput: string) => {
    const trimmed = rawInput.trim();

    // an open option prompt (e.g. NAVVCUBE [ON/OFF]) takes the answer first; empty Enter = default
    if (cmdPrompt) {
      logMessage(`> ${trimmed || '(default)'}`, 'input');
      if (cmdPrompt.answer(trimmed)) setCmdPrompt(null);
      return;
    }

    // CAMERA (CAM): typed values — "35mm" = lens, a length in step 2 = target distance, a number in step 3 = FOV
    if (activeTool === 'camera' && trimmed && !trimmed.includes(',')) {
      const lens = trimmed.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
      if (lens) {
        const f = clampFov(focalToFov(Number(lens[1])));
        if (drawingPoints.length >= 2) placeCamera(drawingPoints[0], drawingPoints[1], f);
        else {
          setCameraFov(Math.round(f));
          logMessage(`CAMERA: lens ${lens[1]} mm → ${fovLabel(f)}.`, 'info');
        }
        return;
      }
      if (drawingPoints.length === 1) {
        const d = parseLengthInput(trimmed, model.settings.units);
        if (d !== null && d >= 12) {
          const p0 = drawingPoints[0];
          const v = sub(cursorWorld, p0);
          const L = Math.hypot(v.x, v.y);
          const u = L > 1e-6 ? { x: v.x / L, y: v.y / L } : { x: 0, y: -1 };
          handleAddDrawingPoint({ x: p0.x + u.x * d, y: p0.y + u.y * d });
          logMessage(`CAMERA: target distance ${formatLength(d, model.settings.units)} — direction locked. Move sideways for the field of view.`, 'info');
          return;
        }
      }
      const deg = Number(trimmed.replace(/(°|deg)$/i, '').trim());
      if (Number.isFinite(deg) && deg > 0) {
        const f = clampFov(deg);
        if (drawingPoints.length >= 2) placeCamera(drawingPoints[0], drawingPoints[1], f);
        else {
          setCameraFov(f);
          logMessage(`CAMERA: ${fovLabel(f)}.`, 'info');
        }
        return;
      }
    }

    // 1. Empty Enter/Space: finish active chained tool OR repeat last command
    if (!trimmed) {
      if ((activeTool === 'foundationslab' || activeTool === 'load') && drawingPoints.length >= 3) {
        applyStructResult(finishStructuralPolygon(structCtx(activeTool, drawingPoints[drawingPoints.length - 1], drawingPoints[drawingPoints.length - 1], 12)));
        return;
      }
      if (isStructureTool(activeTool) && drawingPoints.length > 0) {
        setDrawingPoints([]);
        logMessage(`${activeTool.toUpperCase()}: chain finished.`, 'info');
        return;
      }
      if (activeTool === 'floor') {
        createFloorFromSketchOrWalls();
        return;
      }
      if (activeTool === 'roof') {
        createRoofFromSketchOrWalls();
        return;
      }
      if (activeTool === 'railing') {
        createRailingFromPath();
        return;
      }
      if (activeTool === 'trim') {
        if (modifySubStep === 1) {
          setModifySubStep(2);
          logMessage(
            cuttingEdgeIds.length > 0
              ? `Selected ${cuttingEdgeIds.length} cutting edge(s). Click objects to trim.`
              : 'Selected ALL objects as cutting edges. Click objects to trim.',
            'info'
          );
          return;
        }
        if (trimEraseSubMode) {
          setTrimEraseSubMode(false);
          logMessage('Exited erase mode. Click objects to trim.', 'info');
          return;
        }
      }
      if (activeTool === 'extend') {
        if (modifySubStep === 1) {
          setModifySubStep(2);
          logMessage(
            boundaryEdgeIds.length > 0
              ? `Selected ${boundaryEdgeIds.length} boundary edge(s). Click objects near ends to extend.`
              : 'Selected ALL objects as boundaries. Click objects near ends to extend.',
            'info'
          );
          return;
        }
      }
      if (activeTool === 'offset' && modifySubStep === 0) {
        setModifySubStep(1);
        logMessage(`OFFSET: Distance accepted (${formatLength(offsetDist, model.settings.units)}). Click object to offset.`, 'info');
        return;
      }
      if (activeTool === 'mirror' && modifySubStep === 2) {
        executeMirror(false);
        return;
      }
      if (activeTool === 'join') {
        handleJoinSelection();
        return;
      }
      if (activeTool === 'explode') {
        handleExplodeSelection();
        return;
      }
      if (activeTool === 'array' && selectedIds.length > 0) {
        executeRectangularArray(arrayRows, arrayCols, arrayRowSpacing, arrayColSpacing);
        return;
      }
      if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        finalizeChainedDrawing(false);
        setActiveTool('select');
        return;
      }
      if ((activeTool === 'wall' || activeTool === 'curtainwall') && drawingPoints.length > 0) {
        setDrawingPoints([]);
        setActiveTool('select');
        logMessage(activeTool === 'curtainwall' ? 'Finished Curtain Wall chain.' : 'Finished Wall chain.', 'info');
        return;
      }
      if (activeTool === 'area' && drawingPoints.length >= 3) {
        const { area, perimeter } = computePolygonAreaAndPerimeter(drawingPoints);
        const areaM = formatArea(area, 'metric');
        const areaImp = formatArea(area, 'imperial');
        const perimM = formatLength(perimeter, 'metric');
        const perimImp = formatLength(perimeter, 'imperial');
        logMessage(
          `AREA (Polygon with ${drawingPoints.length} points): Area = ${model.settings.units === 'metric' ? `${areaM} (${areaImp})` : `${areaImp} (${areaM})`}, Perimeter = ${model.settings.units === 'metric' ? `${perimM} (${perimImp})` : `${perimImp} (${perimM})`}`,
          'result'
        );
        setDrawingPoints([]);
        setActiveTool('select');
        return;
      }
      if (activeTool === 'matchprop') {
        setPickedEntityId(null);
        setModifySubStep(0);
        setActiveTool('select');
        logMessage('Finished Matchprop.', 'info');
        return;
      }
      if (activeTool === 'copy' && drawingPoints.length > 0) {
        setDrawingPoints([]);
        setActiveTool('select');
        return;
      }
      if (activeTool === 'block' && selectedIds.length > 0 && drawingPoints.length === 1) {
        const selected = model.entities.filter((e) => selectedIds.includes(e.id));
        const customCount =
          (model.blocks ?? []).filter((b) => b.kind === 'custom').length + 1;
        const defaultName = `Custom Block ${customCount}`;
        const { blockDef, instance } = createBlockFromSelection(
          defaultName,
          drawingPoints[0],
          selected,
          '#0d9488',
          30,
          'A-FURN'
        );
        const remaining = model.entities.filter((e) => !selectedIds.includes(e.id));
        commitModel(
          {
            ...model,
            blocks: [...(model.blocks ?? []), blockDef],
            entities: [...remaining, { ...instance, levelId: activeLevelId }],
          },
          `Create Block "${defaultName}"`
        );
        setSelectedIds([instance.id]);
        setActiveInsertBlockId(blockDef.id);
        setLeftTab('library');
        setDrawingPoints([]);
        setActiveTool('select');
        logMessage(
          `Saved block "${defaultName}" to Library and replaced selection with block instance.`,
          'result'
        );
        return;
      }

      const repeatCmd = findCommandByAlias(lastCommandAlias);
      if (repeatCmd) {
        logMessage(`COMMAND: ${lastCommandAlias} (Repeat ${repeatCmd.name})`, 'input');
        repeatCmd.run(commandContext);
      }
      return;
    }

    logMessage(`> ${trimmed}`, 'input');

    // Support W (Walls) option in FLOOR (SB) or ROOF (RF)
    if (activeTool === 'floor' && trimmed.toUpperCase() === 'W') {
      createFloorFromSketchOrWalls();
      return;
    }
    if (activeTool === 'roof' && trimmed.toUpperCase() === 'W') {
      createRoofFromSketchOrWalls();
      return;
    }

    // Handle options for TRIM (TR)
    if (activeTool === 'trim') {
      const up = trimmed.toUpperCase();
      if (up === 'T' || up === 'CUTTING' || up === 'CUTTING EDGES') {
        setModifySubStep(1);
        logMessage('Select cutting edges… Select objects or <select all> (press Enter when done):', 'info');
        return;
      }
      if (up === 'C' || up === 'CROSSING') {
        setTrimCrossingSubMode(true);
        logMessage('TRIM (Crossing): Drag or click two points across objects to trim.', 'info');
        return;
      }
      if (up === 'O' || up === 'MODE') {
        const cur = model.settings.trimMode ?? 'quick';
        const next = cur === 'quick' ? 'standard' : 'quick';
        commitModel(
          { ...model, settings: { ...model.settings, trimMode: next } },
          `Set Trim Mode: ${next}`
        );
        logMessage(`Trim mode set to: ${next.toUpperCase()}`, 'result');
        addToast(`Trim mode: ${next.toUpperCase()}`, 'info');
        return;
      }
      if (up === 'R' || up === 'ERASE') {
        setTrimEraseSubMode((prev) => !prev);
        logMessage('TRIM (eRase): Click objects to delete them directly without exiting Trim (press Enter to return to Trim).', 'info');
        return;
      }
      if (up === 'U' || up === 'UNDO') {
        if (trimUndoStack.length > 0) {
          const prevEntities = trimUndoStack[trimUndoStack.length - 1];
          setTrimUndoStack((s) => s.slice(0, -1));
          updateEntities(prevEntities, 'Undo last trim');
          logMessage('Undid last trim.', 'result');
          addToast('Undid last trim.', 'info');
        } else {
          logMessage('Nothing to undo in current trim command.', 'info');
        }
        return;
      }
      if (up === 'P' || up === 'PROJECT') {
        logMessage('Projection mode set to None (2D plan view).', 'info');
        return;
      }
      if (up === 'E' || up === 'EDGE') {
        const curEdge = model.settings.edgeMode ?? 'noextend';
        const nextEdge = curEdge === 'noextend' ? 'extend' : 'noextend';
        commitModel(
          { ...model, settings: { ...model.settings, edgeMode: nextEdge } },
          `Set Edge Extension: ${nextEdge}`
        );
        logMessage(
          `Edge extension mode: ${nextEdge === 'extend' ? 'Extend (implied intersections)' : 'No extend (exact intersections)'}`,
          'result'
        );
        addToast(`Edge mode: ${nextEdge}`, 'info');
        return;
      }
    }

    // Handle options for EXTEND (EX)
    if (activeTool === 'extend') {
      const up = trimmed.toUpperCase();
      if (up === 'B' || up === 'BOUNDARY' || up === 'BOUNDARY EDGES') {
        setModifySubStep(1);
        logMessage('Select boundary edges… Select objects or <select all> (press Enter when done):', 'info');
        return;
      }
      if (up === 'C' || up === 'CROSSING') {
        setTrimCrossingSubMode(true);
        logMessage('EXTEND (Crossing): Drag or click two points across objects to extend.', 'info');
        return;
      }
      if (up === 'O' || up === 'MODE') {
        const cur = model.settings.trimMode ?? 'quick';
        const next = cur === 'quick' ? 'standard' : 'quick';
        commitModel(
          { ...model, settings: { ...model.settings, trimMode: next } },
          `Set Trim/Extend Mode: ${next}`
        );
        logMessage(`Extend mode set to: ${next.toUpperCase()}`, 'result');
        addToast(`Extend mode: ${next.toUpperCase()}`, 'info');
        return;
      }
      if (up === 'U' || up === 'UNDO') {
        if (trimUndoStack.length > 0) {
          const prevEntities = trimUndoStack[trimUndoStack.length - 1];
          setTrimUndoStack((s) => s.slice(0, -1));
          updateEntities(prevEntities, 'Undo last extend');
          logMessage('Undid last extend.', 'result');
          addToast('Undid last extend.', 'info');
        } else {
          logMessage('Nothing to undo in current extend command.', 'info');
        }
        return;
      }
      if (up === 'P' || up === 'PROJECT') {
        logMessage('Projection mode set to None (2D plan view).', 'info');
        return;
      }
      if (up === 'E' || up === 'EDGE') {
        const curEdge = model.settings.edgeMode ?? 'noextend';
        const nextEdge = curEdge === 'noextend' ? 'extend' : 'noextend';
        commitModel(
          { ...model, settings: { ...model.settings, edgeMode: nextEdge } },
          `Set Edge Extension: ${nextEdge}`
        );
        logMessage(
          `Edge extension mode: ${nextEdge === 'extend' ? 'Extend (implied intersections)' : 'No extend (exact intersections)'}`,
          'result'
        );
        addToast(`Edge mode: ${nextEdge}`, 'info');
        return;
      }
    }

    // Handle modify tools inputs:
    if (activeTool === 'offset') {
      if (trimmed.toUpperCase() === 'T') {
        logMessage('OFFSET: Through point mode. Click object to offset, then click through point.', 'info');
        setModifySubStep(1);
        return;
      }
      const parsedDist = parseLengthInput(trimmed, model.settings.units);
      if (parsedDist !== null && parsedDist > 0) {
        setOffsetDist(parsedDist);
        setModifySubStep(1);
        logMessage(`OFFSET: Distance set to ${formatLength(parsedDist, model.settings.units)}. Click object to offset.`, 'info');
        return;
      }
    }

    if (activeTool === 'fillet') {
      if (trimmed.toUpperCase() === 'R' || trimmed.toUpperCase().startsWith('R ')) {
        const rest = trimmed.replace(/^R\s*/i, '').trim();
        if (rest) {
          const r = parseLengthInput(rest, model.settings.units);
          if (r !== null && r >= 0) {
            setFilletRadius(r);
            logMessage(`FILLET: Radius set to ${formatLength(r, model.settings.units)}. Select first line or wall.`, 'info');
            return;
          }
        } else {
          logMessage(`FILLET: Current radius = ${formatLength(filletRadius, model.settings.units)}. Type new radius (0 for clean corner):`, 'info');
          return;
        }
      }
      const numR = parseLengthInput(trimmed, model.settings.units);
      if (numR !== null && numR >= 0) {
        setFilletRadius(numR);
        logMessage(`FILLET: Radius set to ${formatLength(numR, model.settings.units)}. Select first line or wall.`, 'info');
        return;
      }
    }

    if (activeTool === 'chamfer') {
      if (trimmed.toUpperCase() === 'D' || trimmed.toUpperCase().startsWith('D ')) {
        const parts = trimmed.replace(/^D\s*/i, '').split(/[,\s]+/);
        if (parts.length >= 2) {
          const d1 = parseLengthInput(parts[0], model.settings.units);
          const d2 = parseLengthInput(parts[1], model.settings.units);
          if (d1 !== null && d2 !== null) {
            setChamferD1(d1);
            setChamferD2(d2);
            logMessage(`CHAMFER: Distances set to ${formatLength(d1, model.settings.units)}, ${formatLength(d2, model.settings.units)}. Select first line or wall.`, 'info');
            return;
          }
        } else {
          logMessage('CHAMFER: Type two distances separated by comma (e.g. 12, 12):', 'info');
          return;
        }
      }
    }

    if (activeTool === 'mirror' && modifySubStep === 2) {
      if (trimmed.toUpperCase() === 'Y' || trimmed.toUpperCase() === 'YES') {
        executeMirror(true);
        return;
      }
      if (trimmed.toUpperCase() === 'N' || trimmed.toUpperCase() === 'NO') {
        executeMirror(false);
        return;
      }
    }

    if (activeTool === 'scale' && selectedIds.length > 0 && drawingPoints.length === 1) {
      const factor = parseFloat(trimmed);
      if (!Number.isNaN(factor) && factor > 0) {
        const base = drawingPoints[0];
        const scaled = model.entities.map((ent) =>
          selectedIds.includes(ent.id) ? scaleEntityByBase(ent, base, factor) : ent
        );
        updateEntities(scaled, `Scale Selection (${factor}x)`);
        setDrawingPoints([]);
        setModifySubStep(0);
        setActiveTool('select');
        logMessage(`Scaled selection by factor ${factor}x.`, 'result');
        return;
      }
    }

    if (activeTool === 'array' && selectedIds.length > 0) {
      if (trimmed.toUpperCase() === 'R') {
        setArrayMode('rect');
        executeRectangularArray(arrayRows, arrayCols, arrayRowSpacing, arrayColSpacing);
        return;
      }
      if (trimmed.toUpperCase() === 'P') {
        setArrayMode('polar');
        logMessage('ARRAY: Polar mode. Click center point for circular array.', 'info');
        return;
      }
      const parts = trimmed.split(/[,\s]+/);
      if (parts.length >= 4) {
        const rows = parseInt(parts[0], 10);
        const cols = parseInt(parts[1], 10);
        const rSp = parseLengthInput(parts[2], model.settings.units) || arrayRowSpacing;
        const cSp = parseLengthInput(parts[3], model.settings.units) || arrayColSpacing;
        if (!isNaN(rows) && !isNaN(cols)) {
          executeRectangularArray(rows, cols, rSp, cSp);
          return;
        }
      }
    }

    // 2. If waiting for Text Note content in TX / MTEXT tool (step 1)
    if (activeTool === 'text' && drawingPoints.length === 1) {
      const pos = drawingPoints[0];
      const newText: ArchEntity = {
        id: `text-${Date.now()}`,
        type: 'text',
        layer: 'A-ANNO',
        levelId: activeLevelId,
        position: pos,
        text: trimmed,
        fontSize: model.settings.dimStyle?.textHeight || 10,
        rotation: 0,
        alignment: 'left',
      };
      updateEntities([...model.entities, newText], 'Add Text Note');
      setDrawingPoints([]);
      setActiveTool('select');
      setSelectedIds([newText.id]);
      logMessage(`Added text note: "${trimmed}"`, 'result');
      return;
    }

    // 2a. If waiting for Block Name in B / BLOCK tool
    if (activeTool === 'block' && selectedIds.length > 0 && drawingPoints.length === 1) {
      const selected = model.entities.filter((e) => selectedIds.includes(e.id));
      const { blockDef, instance } = createBlockFromSelection(
        trimmed,
        drawingPoints[0],
        selected,
        '#0d9488',
        30,
        'A-FURN'
      );
      const remaining = model.entities.filter((e) => !selectedIds.includes(e.id));
      commitModel(
        {
          ...model,
          blocks: [...(model.blocks ?? []), blockDef],
          entities: [...remaining, { ...instance, levelId: activeLevelId }],
        },
        `Create Block "${trimmed}"`
      );
      setSelectedIds([instance.id]);
      setActiveInsertBlockId(blockDef.id);
      setLeftTab('library');
      setDrawingPoints([]);
      setActiveTool('select');
      logMessage(
        `Saved block "${trimmed}" to Library (${selected.length} objects) and placed instance.`,
        'result'
      );
      return;
    }

    // 2a-insert. Handle R (rotate) or S (scale) or block name while in INSERT mode
    if (activeTool === 'insert') {
      if (trimmed.toUpperCase() === 'R') {
        const nextRot = (insertRotation + 90) % 360;
        setInsertRotation(nextRot);
        logMessage(`INSERT: Rotation set to ${nextRot}°. Click on canvas to place.`, 'info');
        return;
      }
      if (/^R\s+(-?\d+(\.\d+)?)$/i.test(trimmed)) {
        const ang = parseFloat(trimmed.replace(/^R\s+/i, ''));
        setInsertRotation(ang);
        logMessage(`INSERT: Rotation set to ${ang}°. Click on canvas to place.`, 'info');
        return;
      }
      if (/^S\s+(\d+(\.\d+)?)$/i.test(trimmed)) {
        const sc = Math.max(0.1, parseFloat(trimmed.replace(/^S\s+/i, '')));
        setInsertScale(sc);
        logMessage(`INSERT: Scale set to ${sc}x. Click on canvas to place.`, 'info');
        return;
      }
      const matchedBlock = (model.blocks ?? []).find(
        (b) =>
          b.name.toLowerCase() === trimmed.toLowerCase() ||
          b.id.toLowerCase() === trimmed.toLowerCase()
      );
      if (matchedBlock) {
        setActiveInsertBlockId(matchedBlock.id);
        logMessage(`INSERT: Selected block "${matchedBlock.name}". Click on canvas to place.`, 'info');
        return;
      }
    }

    // 2b. If waiting for Leader note at step 2
    if (activeTool === 'leader' && drawingPoints.length === 2) {
      const p0 = drawingPoints[0];
      const p1 = drawingPoints[1];
      const p2 = { x: p1.x + 24, y: p1.y };
      const newLeader: ArchEntity = {
        id: `leader-${Date.now()}`,
        type: 'leader',
        layer: 'A-ANNO',
        levelId: activeLevelId,
        arrowPoint: p0,
        kneePoint: p1,
        landingPoint: p2,
        text: trimmed,
        fontSize: model.settings.dimStyle?.textHeight || 10,
      };
      updateEntities([...model.entities, newLeader], 'Create Leader Note');
      setDrawingPoints([]);
      setActiveTool('select');
      setSelectedIds([newLeader.id]);
      logMessage(`Created Leader note: "${trimmed}"`, 'result');
      return;
    }

    // 3. Close polyline option ("C") during PLINE
    if (
      activeTool === 'polyline' &&
      drawingPoints.length >= 3 &&
      trimmed.toUpperCase() === 'C'
    ) {
      finalizeChainedDrawing(true);
      setActiveTool('select');
      return;
    }

    // 4. Support "Z E" (Zoom Extents two-word AutoCAD input)
    if (/^Z(?:OOM)?\s+E(?:XTENTS)?$/i.test(trimmed)) {
      handleZoomExtents();
      return;
    }

    // 5. While an interactive tool is active, check if input is a coordinate, polar, angle, or radius
    if (activeTool !== 'select') {
      if (activeTool === 'circle' && drawingPoints.length === 1) {
        const r = parseLengthInput(trimmed, model.settings.units);
        if (r !== null && r > 0) {
          const newCircle: ArchEntity = {
            id: `circle-${Date.now()}`,
            type: 'circle',
            layer: model.activeLayer,
            levelId: activeLevelId,
            center: drawingPoints[0],
            radius: r,
          };
          updateEntities([...model.entities, newCircle], 'Draw Circle');
          setDrawingPoints([]);
          setActiveTool('select');
          logMessage(
            `Created Circle with radius ${formatLength(
              r,
              model.settings.units
            )}.`,
            'result'
          );
          return;
        }
      }

      if (
        activeTool === 'rotate' &&
        selectedIds.length > 0 &&
        drawingPoints.length === 1
      ) {
        const ang = Number(trimmed);
        if (!Number.isNaN(ang)) {
          const base = drawingPoints[0];
          const rotated = syncHostedBimEntities(
            model.entities.map((ent) =>
              selectedIds.includes(ent.id) ? rotateEntity(ent, base, ang) : ent
            )
          );
          updateEntities(rotated, `Rotate Selection (${ang}°)`);
          setDrawingPoints([]);
          setActiveTool('select');
          logMessage(`Rotated selection by ${ang}°.`, 'result');
          return;
        }
      }

      const refPt =
        drawingPoints.length > 0
          ? drawingPoints[drawingPoints.length - 1]
          : null;
      const parsedPt = parseCoordinateInput(
        trimmed,
        refPt,
        cursorWorld,
        model.settings.units,
        model.settings.orthoEnabled
      );

      if (parsedPt) {
        if (activeTool === 'line' && drawingPoints.length === 1) {
          const p0 = drawingPoints[0];
          updateEntities(
            [
              ...model.entities,
              {
                id: `line-${Date.now()}`,
                type: 'line',
                layer: model.activeLayer,
                levelId: activeLevelId,
                start: p0,
                end: parsedPt,
              },
            ],
            'Draw Line'
          );
          setDrawingPoints([]);
          logMessage(
            `Created Line (${formatLength(
              dist(p0, parsedPt),
              model.settings.units
            )}).`,
            'result'
          );
          return;
        }

        if (activeTool === 'rectangle' && drawingPoints.length === 1) {
          const p1 = drawingPoints[0];
          updateEntities(
            [
              ...model.entities,
              {
                id: `rect-${Date.now()}`,
                type: 'rectangle',
                layer: model.activeLayer,
                levelId: activeLevelId,
                p1,
                p2: parsedPt,
              },
            ],
            'Draw Rectangle'
          );
          setDrawingPoints([]);
          logMessage('Created Rectangle.', 'result');
          return;
        }

        if (
          (activeTool === 'move' || activeTool === 'copy') &&
          selectedIds.length > 0 &&
          drawingPoints.length === 1
        ) {
          const delta = sub(parsedPt, drawingPoints[0]);
          if (activeTool === 'move') {
            const moved = syncHostedBimEntities(moveSelectionHosted(model.entities, selectedIds, delta, moveEntity));
            updateEntities(moved, 'Move Selection');
            setDrawingPoints([]);
            setActiveTool('select');
            logMessage('Moved selected object(s).', 'result');
          } else {
            const stamp = Date.now();
            const copies = copySelectionHosted(model.entities, selectedIds, delta, moveEntity, (ent, idx) => `${ent.type}-${stamp}-${idx}`);
            updateEntities(syncHostedBimEntities([...model.entities, ...copies]), 'Copy Selection');
            logMessage(`Copied ${copies.length} object(s).`, 'result');
          }
          return;
        }

        handleAddDrawingPoint(parsedPt);
        return;
      }
    }

    // 6. Match command alias from COMMAND_REGISTRY
    const cmd = findCommandByAlias(trimmed);
    if (cmd) {
      setLastCommandAlias(cmd.aliases[0]);
      cmd.run(commandContext);
      return;
    }

    logMessage(
      `Unknown command or coordinate "${trimmed}". Press F1 or type ? for command list.`,
      'error'
    );
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              osnapEnabled: !model.settings.osnapEnabled,
            },
          },
          'Toggle OSNAP'
        );
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              gridVisible: !model.settings.gridVisible,
            },
          },
          'Toggle Grid'
        );
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              orthoEnabled: !model.settings.orthoEnabled,
            },
          },
          'Toggle Ortho'
        );
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              snapEnabled: !model.settings.snapEnabled,
            },
          },
          'Toggle Snap'
        );
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              polarTracking: !model.settings.polarTracking,
              orthoEnabled: !model.settings.polarTracking ? false : model.settings.orthoEnabled,
            },
          },
          'Toggle Polar Tracking'
        );
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              osnapTracking: !model.settings.osnapTracking,
            },
          },
          'Toggle Smart Guides (TRACK)'
        );
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        commitModel(
          {
            ...model,
            settings: {
              ...model.settings,
              dynamicInput: !model.settings.dynamicInput,
            },
          },
          'Toggle Dynamic Input'
        );
        return;
      }

      // Ctrl+/ or Cmd+/ toggles the Keyboard Shortcut Cheat Sheet modal
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShortcutSheetOpen((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        if (cmdPrompt) {
          setCmdPrompt(null);
          logMessage('*Cancel*', 'info');
          return;
        }
        if (shortcutSheetOpen) {
          setShortcutSheetOpen(false);
          return;
        }
        if (tourOpen) {
          handleCloseTour();
          return;
        }
        if (wallTypeModalOpen) {
          setWallTypeModalOpen(false);
          return;
        }
        if (visibilityModalOpen) {
          setVisibilityModalOpen(false);
          return;
        }
        if (levelModalOpen) {
          setLevelModalOpen(false);
          return;
        }
        if (blockEditorOpen) {
          setBlockEditorOpen(false);
          return;
        }
        if (dimStyleOpen) {
          setDimStyleOpen(false);
          return;
        }
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (activeTool === 'polyline' && drawingPoints.length >= 2) {
          finalizeChainedDrawing(false);
        }
        setDrawingPoints([]);
        if (activeTool !== 'select') {
          setActiveTool('select');
          logMessage('Cancelled command.', 'info');
        } else {
          setSelectedIds([]);
        }
        return;
      }

      if (isTextInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 1800);
        logMessage('Project saved to localStorage.', 'result');
        addToast('Project saved to browser storage.', 'success');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedIds.length > 0) {
          handleDeleteSelectionOrStartErase();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCommandLineSubmit('');
        return;
      }

      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /^[a-zA-Z0-9@?]$/.test(e.key)
      ) {
        commandInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // File & Export handlers
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(model, null, 2)], {
      type: 'application/json',
    });
    const safeName =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma_project';
    triggerDownload(blob, `${safeName}.json`);
    logMessage('Exported project JSON file.', 'result');
    addToast(`Exported project JSON (${safeName}.json).`, 'success');
  };

  const handleImportJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ArchModel;
        if (parsed && Array.isArray(parsed.entities) && Array.isArray(parsed.layers)) {
          commitModel(parsed, `Open ${file.name}`);
          setSelectedIds([]);
          logMessage(`Loaded project "${parsed.projectName}".`, 'result');
          addToast(`Opened project "${parsed.projectName}".`, 'success');
        } else {
          logMessage('Invalid project JSON format.', 'error');
        }
      } catch {
        logMessage('Failed to parse JSON file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleExportDxf = (scope: 'level' | 'all' | 'elevations' = 'level') => {
    const levelsList = model.levels ?? [];
    const lvl = levelsList.find((l) => l.id === activeLevelId);
    const dxfContent = exportToDXF(model, { levelId: scope === 'all' ? 'all' : activeLevelId, includeElevations: scope === 'elevations' });
    const blob = new Blob([dxfContent], { type: 'application/dxf' });
    const baseName =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma_plan';
    const suffix =
      scope === 'all'
        ? 'all_levels'
        : (lvl?.name || activeLevelId).replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
    const fileName = `${baseName}_${suffix}.dxf`;
    triggerDownload(blob, fileName);
    const unitsNote = model.settings.units === 'metric' ? 'millimetres' : 'inches';
    logMessage(
      `Exported AutoCAD R2000 DXF "${fileName}" (${scope === 'all' ? 'all levels at their elevations' : scope === 'elevations' ? `${lvl?.name || 'current level'} + N/S/E/W elevations` : lvl?.name || 'current level'}, units: ${unitsNote}; one DXF layer per app layer, native dimensions, hatches & blocks).`,
      'result'
    );
    addToast(`Exported DXF drawing (${fileName}).`, 'success');
  };

  const handleImportDxf = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dxfText = String(reader.result || '');
        const res = importFromDXF(dxfText, activeLevelId, model.layers, model.settings.units);
        const skippedList = Object.entries(res.summary.skipped)
          .map(([t, n]) => `${n} ${t}`)
          .join(', ');
        if (res.entities.length === 0) {
          logMessage(
            `No supported CAD objects (LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT) found in "${file.name}".${skippedList ? ` Skipped: ${skippedList}.` : ''}`,
            'error'
          );
          return;
        }
        commitModel(
          {
            ...model,
            layers: res.layers,
            entities: [...model.entities, ...res.entities],
          },
          `Import DXF (${file.name})`
        );
        setSelectedIds(res.entities.map((e) => e.id));
        setViewMode('2d');
        const s = res.summary;
        logMessage(
          `Imported ${res.entities.length} editable object(s) from "${file.name}" onto ${model.levels?.find((l) => l.id === activeLevelId)?.name || 'the current level'}: ${s.lines} lines, ${s.polylines} polylines, ${s.circles} circles, ${s.arcs} arcs, ${s.texts} texts. Source units: ${s.sourceUnits}.${s.newLayers.length ? ` New layers: ${s.newLayers.join(', ')}.` : ''}`,
          'result'
        );
        if (skippedList) {
          logMessage(`Not converted (unsupported types): ${skippedList}. Explode blocks/dimensions in your CAD program first if you need them.`, 'info');
        }
        addToast(
          `Imported ${res.entities.length} CAD object(s) from "${file.name}"${skippedList ? ' (some types skipped — see command log)' : ''}.`,
          'success'
        );
      } catch (err) {
        logMessage(
          `Failed to parse DXF file "${file.name}": ${
            err instanceof Error ? err.message : 'Invalid DXF syntax'
          }`,
          'error'
        );
      }
    };
    reader.readAsText(file);
  };

  const handleExportIfc = () => {
    const ifcContent = exportToIFC4(model);
    const blob = new Blob([ifcContent], { type: 'application/x-step' });
    const safeName =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma_bim';
    triggerDownload(blob, `${safeName}.ifc`);
    logMessage(
      'Exported IFC4 BIM file (.ifc) with Walls, Doors, Windows, Slabs, and Spaces (compatible with FreeCAD & BlenderBIM).',
      'result'
    );
    addToast(`Exported IFC4 BIM model (${safeName}.ifc).`, 'success');
  };

  const handleExportPdf = () => {
    const threeImg = canvas3dRef.current?.capturePngDataUrl() || null;
    const pdfDoc = generateSheetsPDF(model, model.sheets, threeImg, cameraSheetImages);
    const safeName =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma_sheets';
    pdfDoc.save(`${safeName}_sheets.pdf`);
    logMessage(
      `Exported multi-page architectural PDF (${safeName}_sheets.pdf).`,
      'result'
    );
    addToast(`Exported multi-page PDF (${safeName}_sheets.pdf).`, 'success');
  };

  const handleExport2dPng = () => {
    const svgEl = svgRef.current;
    if (!svgEl) {
      logMessage('Switch to 2D Plan or Split view to export 2D PNG.', 'error');
      return;
    }
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = svgEl.clientWidth || 1200;
      canvas.height = svgEl.clientHeight || 800;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = darkMode ? '#0c0a09' : '#f8f7f4';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        stampStructuralNote(ctx, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            triggerDownload(pngBlob, 'archiforma_2d_plan.png');
            logMessage('Exported 2D Plan PNG.', 'result');
            addToast('Exported 2D Plan PNG.', 'success');
          }
        }, 'image/png');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  /** Structural coordination note on image exports (when the model has structure). */
  const stampStructuralNote = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!hasStructuralContent(model)) return;
    const text = `NOTE: ${STRUCTURAL_DISCLAIMER}`;
    ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(8, h - 28, Math.min(w - 16, tw + 16), 20);
    ctx.fillStyle = '#b91c1c';
    ctx.fillText(text, 16, h - 14);
  };
  const download3d = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      let out = dataUrl;
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        stampStructuralNote(ctx, c.width, c.height);
        out = c.toDataURL('image/png');
      }
      const a = document.createElement('a');
      a.href = out;
      a.download = 'archiforma_3d_view.png';
      a.click();
      logMessage('Exported 3D View PNG.', 'result');
      addToast('Exported 3D View PNG.', 'success');
    };
    img.src = dataUrl;
  };
  const handleExport3dPng = () => {
    const dataUrl = canvas3dRef.current?.capturePngDataUrl();
    if (!dataUrl) {
      setViewMode('split');
      setTimeout(() => {
        const retryUrl = canvas3dRef.current?.capturePngDataUrl();
        if (retryUrl) download3d(retryUrl);
      }, 150);
      return;
    }
    download3d(dataUrl);
  };

  const selectedEntities = model.entities.filter((e) =>
    selectedIds.includes(e.id)
  );
  const activeStep = [
    'offset',
    'trim',
    'extend',
    'fillet',
    'chamfer',
    'mirror',
    'array',
    'scale',
    'stretch',
    'break',
    'align',
  ].includes(activeTool)
    ? modifySubStep
    : drawingPoints.length;
  const hintText = cmdPrompt
    ? cmdPrompt.text
    : getToolStepHint(
        activeTool,
        activeStep,
        selectedIds.length
      );

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden ${
        darkMode ? 'dark bg-stone-950 text-stone-100' : 'bg-stone-50 text-stone-900'
      }`}
    >
      {/* 1. TOP BAR */}
      <TopBar
        projectName={model.projectName}
        onChangeProjectName={(name) =>
          commitModel({ ...model, projectName: name }, 'Rename Project')
        }
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSaveLocal={() => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 1800);
          logMessage('Project saved to browser storage.', 'result');
          addToast('Project saved to browser storage.', 'success');
        }}
        onNewBlankProject={() => {
          commitModel(createBlankProject(), 'New Blank Project');
          setSelectedIds([]);
          setDrawingPoints([]);
          setTempHiddenIds([]);
          setTempIsolatedIds([]);
          logMessage('Started a new blank project.', 'info');
          addToast('Started a new blank project.', 'info');
        }}
        onLoadSampleProject={() => {
          commitModel(createSampleProject(), 'Load Sample 2-Room House');
          setSelectedIds([]);
          setDrawingPoints([]);
          setTempHiddenIds([]);
          setTempIsolatedIds([]);
          logMessage('Loaded sample 2-room house project.', 'info');
          addToast('Loaded sample 2-room house project.', 'success');
        }}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onImportDxf={handleImportDxf}
        onExportDxf={handleExportDxf}
        onExportIfc={handleExportIfc}
        onExportPdf={handleExportPdf}
        onExport2dPng={handleExport2dPng}
        onExport3dPng={handleExport3dPng}
        viewMode={viewMode}
        elevationDir={elevationDir}
        onOpenStructuralView={openStructuralView}
        sections={model.entities.filter((e) => e.type === 'section').map((e) => ({ id: e.id, name: (e as { name: string }).name }))}
        discipline={discipline}
        onChangeDiscipline={(d) => {
          setDiscipline(d);
          logMessage(
            d === 'structural'
              ? `STRUCTURAL discipline: architectural finishes fade to light gray; structure is shown strongly. ${STRUCT_NOTE}`
              : d === 'architectural'
              ? 'ARCHITECTURAL discipline: structural-only elements (footings, beams, rebar, loads…) are hidden.'
              : 'COMBINED discipline: everything shown.',
            'info'
          );
        }}
        onOpenElevation={(d) => {
          setElevationDir(d);
          setViewMode('elevation');
          logMessage(`Opened ${d} elevation. Use PAINT (PT), SPLIT FACE (SF), TAG (TG) or DIMENSION (DI) here; click curtain-wall cells to change panels.`, 'info');
        }}
        onOpenRoofPlan={() => {
          setViewMode('roofplan');
          logMessage('Opened Roof Plan.', 'info');
        }}
        onChangeViewMode={(nextMode) => {
          setActiveCameraId(null);
          setViewMode(nextMode);
          if (nextMode === 'split') {
            setViewTransform({ panX: 70, panY: 165, zoom: 1.05 });
          } else if (nextMode === '2d') {
            setViewTransform({ panX: 180, panY: 130, zoom: 1.5 });
          }
        }}
        levels={model.levels ?? []}
        activeLevelId={activeLevelId}
        onChangeActiveLevel={(lvlId) => {
          const lvl = (model.levels ?? []).find((l) => l.id === lvlId);
          commitModel(
            { ...model, activeLevelId: lvlId },
            `Switch Plan to ${lvl?.name ?? lvlId}`
          );
          setSelectedIds([]);
          setDrawingPoints([]);
          logMessage(
            `Switched active 2D Plan to "${lvl?.name ?? lvlId}" (Elevation ${formatLength(
              lvl?.elevation ?? 0,
              model.settings.units
            )}). 3D View stacks all levels.`,
            'info'
          );
        }}
        onOpenLevelModal={() => setLevelModalOpen(true)}
        onOpenVisibilityModal={() => setVisibilityModalOpen(true)}
        units={model.settings.units}
        onToggleUnits={() => {
          const nextUnits =
            model.settings.units === 'imperial' ? 'metric' : 'imperial';
          commitModel(
            {
              ...model,
              settings: { ...model.settings, units: nextUnits },
            },
            `Switch Units to ${nextUnits}`
          );
          logMessage(
            `Switched display units to ${
              nextUnits === 'imperial' ? 'Imperial (ft-in)' : 'Metric (mm)'
            }.`,
            'info'
          );
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onOpenHelp={() => setHelpOpen(true)}
        savedNotice={savedNotice}
        uiMode={uiMode}
        onToggleUiMode={handleToggleUiMode}
        onOpenShortcuts={() => setShortcutSheetOpen(true)}
        onStartTour={handleStartTour}
      />

      {/* 2. MIDDLE WORKSPACE (Left Toolbar + Center 2D/3D/Split/Schedules/Sheets Viewport + Right Properties/Layers) */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {(viewMode === '2d' || viewMode === '3d' || viewMode === 'split' || viewMode === 'elevation' || viewMode === 'roofplan' || viewMode === 'foundationplan' || viewMode === 'framingplan' || viewMode === 'stsection') && (
          <LeftToolbar
            activeTool={activeTool}
            onSelectTool={(tool) => {
              handleActivateTool(tool);
            }}
            onDeleteAction={handleDeleteSelectionOrStartErase}
            leftTab={leftTab}
            onChangeLeftTab={setLeftTab}
            blocks={model.blocks ?? []}
            activeInsertBlockId={activeInsertBlockId}
            onSelectInsertBlock={(id) => {
              setActiveInsertBlockId(id);
            }}
            insertRotation={insertRotation}
            onChangeInsertRotation={setInsertRotation}
            insertScale={insertScale}
            onChangeInsertScale={setInsertScale}
            onOpenBlockEditor={(blockId) => {
              setEditingBlockId(blockId || activeInsertBlockId);
              setBlockEditorOpen(true);
            }}
            units={model.settings.units}
            darkMode={darkMode}
            uiMode={uiMode}
            viewCubeOn={viewCubeOn}
            onToggleViewCube={() => setViewCube(!viewCubeOn)}
          />
        )}

        {/* Center Viewport Area */}
        <section
          aria-label="Drawing Viewport"
          className="flex-1 flex min-w-0 min-h-0 relative overflow-hidden"
        >
          {(viewMode === '2d' || viewMode === 'split') && (
            <div
              className={`${
                viewMode === 'split'
                  ? 'w-1/2 border-r border-stone-300 dark:border-stone-800'
                  : 'w-full'
              } h-full relative`}
            >
              <Canvas2D
                model={model}
                activeTool={activeTool}
                selectedIds={selectedIds}
                onSelectIds={setSelectedIds}
                drawingPoints={drawingPoints}
                onAddDrawingPoint={handleAddDrawingPoint}
                onFinishDrawing={(newEntities, label) => {
                  if (newEntities.length > 0) {
                    const next = syncHostedBimEntities([
                      ...model.entities,
                      ...newEntities,
                    ]);
                    updateEntities(next, label);
                    setSelectedIds(newEntities.map((e) => e.id));
                    logMessage(`${label} completed.`, 'result');
                  }
                  setDrawingPoints([]);
                }}
                onUpdateModel={(nextEntities, label) => {
                  updateEntities(nextEntities, label);
                }}
                onCursorMove={(pt, osnap) => {
                  setCursorWorld(pt);
                  setActiveOsnap(osnap);
                }}
                onLog={logMessage}
                svgRef={svgRef}
                viewTransform={viewTransform}
                onChangeViewTransform={setViewTransform}
                darkMode={darkMode}
                modifySubStep={modifySubStep}
                pickedEntityId={pickedEntityId}
                cuttingEdgeIds={cuttingEdgeIds}
                boundaryEdgeIds={boundaryEdgeIds}
                onModifyEntityClick={handleModifyEntityClick}
                onFenceComplete={handleFenceComplete}
                trimMode={model.settings.trimMode ?? 'quick'}
                edgeMode={model.settings.edgeMode ?? 'noextend'}
                trimEraseSubMode={trimEraseSubMode}
                activeInsertBlock={
                  (model.blocks ?? []).find(
                    (b) => b.id === activeInsertBlockId
                  ) ??
                  (model.blocks ?? [])[0] ??
                  null
                }
                insertRotation={insertRotation}
                insertScale={insertScale}
                onRotateInsertBlock={() => {
                  const next = (insertRotation + 90) % 360;
                  setInsertRotation(next);
                  logMessage(`Rotated insert preview to ${next}°.`, 'info');
                }}
                onOpenBlockEditor={(blockId) => {
                  setEditingBlockId(blockId || activeInsertBlockId);
                  setBlockEditorOpen(true);
                }}
                activeWallType={activeWallType}
                activeFloorType={(model.floorTypes ?? [])[0]}
                activeColumnType={(model.columnTypes ?? [])[0]}
                tempHiddenIds={tempHiddenIds}
                tempIsolatedIds={tempIsolatedIds}
                onResetTempHideIsolate={handleResetTempHideIsolate}
                uiMode={uiMode}
                hintText={hintText}
                lastCommandAlias={lastCommandAlias}
                onRepeatLastCommand={() => {
                  const repeatCmd = findCommandByAlias(lastCommandAlias);
                  if (repeatCmd) {
                    logMessage(`COMMAND: ${lastCommandAlias} (Repeat ${repeatCmd.name})`, 'input');
                    repeatCmd.run(commandContext);
                  }
                }}
                onCancelCommand={() => {
                  setDrawingPoints([]);
                  setActiveTool('select');
                  logMessage('Cancelled command.', 'info');
                }}
                onUndo={handleUndo}
                onZoomExtents={handleZoomExtents}
                onFocusProperties={() => {
                  addToast('Properties panel focused in the right sidebar.', 'info');
                }}
                onSelectTool={(tool) => handleActivateTool(tool)}
                onDeleteSelection={handleDeleteSelectionOrStartErase}
                roofTool={roofTool}
                onRoofToolChange={setRoofTool}
                onFinishRoof={createRoofFromSketchOrWalls}
                facadeTool={facadeTool}
                discipline={discipline}
                analytical={analytical}
                viewRebar={viewRebar}
                onStructuralClick={handleStructuralCanvasClick}
                onOpenSection={(id) => openStructuralView('stsection', id)}
                cameraFov={cameraFov}
                onCameraFovChange={setCameraFov}
                onPlaceCamera={placeCamera}
                onOpenCamera={openCamera}
                underlayChoice={underlayByLevel[activeLevelId] ?? 'below'}
                onUnderlayChoiceChange={(c) => {
                  setUnderlayByLevel((m) => ({ ...m, [activeLevelId]: c }));
                  logMessage(c === 'none' ? 'Underlay off (hold U to peek at the level below).' : `Underlay: ${c === 'below' ? 'level below' : c === 'foundation' ? 'foundation' : (model.levels ?? []).find((l) => `level:${l.id}` === c)?.name ?? c} in halftone beneath this plan.`, 'info');
                }}
                underlayMismatch={underlayMismatch}
                viewCube={viewCubeOn && viewMode === '2d'}
                onPlanViewCube={requestCubeView}
                onUnderlayMismatchChange={setUnderlayMismatch}
                openingTool={openingTool}
                onOpeningToolChange={setOpeningTool}
                onRequestDelete={(ids, label) => requestDelete(ids, label)}
                onOpenElevation={(d) => {
                  setElevationDir(d);
                  setViewMode('elevation');
                  logMessage(`Opened ${d} elevation from the plan marker.`, 'info');
                }}
              />
              <ToolOptionsBar
                activeTool={activeTool}
                roof={roofTool}
                onRoofChange={setRoofTool}
                onFinishRoof={createRoofFromSketchOrWalls}
                facade={facadeTool}
                onFacadeChange={setFacadeTool}
                units={model.settings.units}
                darkMode={darkMode}
              />
              <StructureOptionsBar activeTool={activeTool} st={structTool} onChange={setStructTool} units={model.settings.units} darkMode={darkMode} />
              <OpeningOptionsBar activeTool={activeTool} model={model} ot={openingTool} onChange={setOpeningTool} units={model.settings.units} darkMode={darkMode} />
            </div>
          )}

          {(viewMode === '3d' || viewMode === 'split') && (
            <div
              className={`${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              } h-full relative`}
            >
              <Canvas3D
                ref={canvas3dRef}
                model={model}
                selectedIds={selectedIds}
                onSelectIds={setSelectedIds}
                darkMode={darkMode}
                tempHiddenIds={tempHiddenIds}
                tempIsolatedIds={tempIsolatedIds}
                onResetTempHideIsolate={handleResetTempHideIsolate}
                paintMode={activeTool === 'paint'}
                onPaintWall={handlePaintWall3D}
                discipline={discipline}
                viewRebar={viewRebar}
                analytical={analytical}
                onToggleViewRebar={() => setViewRebar((v) => !v)}
                onToggleAnalytical={() => setAnalytical((a) => !a)}
                cameraView={viewMode === '3d' ? activeCamera : null}
                onSaveCameraView={(c) => {
                  updateCamera(c, `Save ${c.name} View`);
                  logMessage(`Saved ${c.name}: the new position and direction are stored in the camera.`, 'result');
                }}
                onCameraChange={updateCamera}
                onCloseCameraView={() => setActiveCameraId(null)}
                onLog={logMessage}
                ground={ground3d}
                onGroundChange={setGround3d}
                sectionBox={sectionBox3d}
                onToggleSectionBox={() => setSectionBox3d((v) => !v)}
                viewCube={viewCubeOn}
                viewRequest={cubeRequest}
              />
              {viewMode === '3d' && activeTool === 'paint' && (
                <ToolOptionsBar
                  activeTool={activeTool}
                  roof={roofTool}
                  onRoofChange={setRoofTool}
                  onFinishRoof={createRoofFromSketchOrWalls}
                  facade={facadeTool}
                  onFacadeChange={setFacadeTool}
                  units={model.settings.units}
                  darkMode={darkMode}
                />
              )}
            </div>
          )}

          {viewMode === 'elevation' && (
            <div className="w-full h-full relative flex">
              <FacadeElevationView
                model={model}
                dir={elevationDir}
                onChangeDir={setElevationDir}
                onUpdateModel={(next, label) => commitModel(next, label)}
                activeTool={activeTool}
                facadeTool={facadeTool}
                selectedIds={selectedIds}
                onSelectIds={setSelectedIds}
                onLog={logMessage}
                darkMode={darkMode}
              />
              <ToolOptionsBar
                activeTool={activeTool}
                roof={roofTool}
                onRoofChange={setRoofTool}
                onFinishRoof={createRoofFromSketchOrWalls}
                facade={facadeTool}
                onFacadeChange={setFacadeTool}
                units={model.settings.units}
                darkMode={darkMode}
              />
            </div>
          )}

          {viewMode === 'roofplan' && (
            <RoofPlanView model={model} selectedIds={selectedIds} onSelectIds={setSelectedIds} darkMode={darkMode} />
          )}

          {(viewMode === 'foundationplan' || viewMode === 'framingplan' || viewMode === 'stsection') && (
            <StructuralView
              model={model}
              kind={viewMode}
              levelId={viewMode === 'framingplan' ? framingLevelId : model.activeLevelId || 'level-1'}
              onChangeLevel={setFramingLevelId}
              sectionId={activeSectionId}
              onChangeSection={setActiveSectionId}
              analytical={analytical}
              onToggleAnalytical={() => setAnalytical((a) => !a)}
              selectedIds={selectedIds}
              onSelectIds={setSelectedIds}
              darkMode={darkMode}
            />
          )}

          {viewMode === 'schedules' && (
            <SchedulesView
              model={model}
              onUpdateModel={(nextModel, label) => {
                commitModel(nextModel, label);
              }}
              onLocateEntity={(entityId, levelId) => {
                if (levelId && levelId !== activeLevelId) {
                  commitModel(
                    { ...model, activeLevelId: levelId },
                    `Switch to ${levelId}`
                  );
                }
                setSelectedIds([entityId]);
                setViewMode('2d');
                logMessage('Located and selected element in 2D Plan.', 'info');
              }}
              onLog={(text, kind) => {
                logMessage(text, kind);
                if (kind === 'result' && text.toLowerCase().includes('export')) {
                  addToast(text, 'success');
                }
              }}
              darkMode={darkMode}
            />
          )}

          {viewMode === 'sheets' && (
            <SheetsView
              model={model}
              onUpdateModel={(nextModel, label) => {
                commitModel(nextModel, label);
              }}
              onChangeProjectName={(name) =>
                commitModel({ ...model, projectName: name }, 'Rename Project')
              }
              capture3dDataUrl={() =>
                canvas3dRef.current?.capturePngDataUrl() || null
              }
              cameraImages={cameraSheetImages}
              onLog={(text, kind) => {
                logMessage(text, kind);
                if (kind === 'result' && text.toLowerCase().includes('pdf')) {
                  addToast(text, 'success');
                }
              }}
              darkMode={darkMode}
            />
          )}
        </section>

        {/* Hidden renderer for camera thumbnails / sheet images when no 3D view is open */}
        {camerasToBake.length > 0 && !main3dMounted && (
          <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: 480, height: 270, pointerEvents: 'none' }}>
            <Canvas3D ref={bakerRef} model={model} selectedIds={[]} onSelectIds={() => undefined} darkMode={darkMode} discipline={discipline} preview />
          </div>
        )}

        {/* Right Panel: Properties & Layers */}
        {(viewMode === '2d' || viewMode === '3d' || viewMode === 'split' || viewMode === 'elevation' || viewMode === 'roofplan' || viewMode === 'foundationplan' || viewMode === 'framingplan' || viewMode === 'stsection') && (
          <RightPanel
          structureJoins={model.structureJoins}
          onStructuralAction={handleStructuralAction}
          onOpenCamera={openCamera}
          viewsSlot={
            <CameraViewsList
              cameras={cameras}
              thumbs={cameraThumbs}
              activeCameraId={viewMode === '3d' ? activeCameraId : null}
              darkMode={darkMode}
              onOpen={openCamera}
              onRename={(id, name) => {
                const c = cameras.find((x) => x.id === id);
                if (c) updateCamera({ ...c, name }, 'Rename Camera');
              }}
              onDelete={deleteCamera}
              onPlayWalkthrough={runWalkthrough}
              onNewCamera={() => handleActivateTool('camera')}
            />
          }
          selectedEntities={selectedEntities}
          allEntities={model.entities}
          layers={model.layers}
          activeLayer={model.activeLayer}
          units={model.settings.units}
          settings={model.settings}
          levels={model.levels ?? []}
          wallTypes={model.wallTypes ?? []}
          floorTypes={model.floorTypes ?? []}
          columnTypes={model.columnTypes ?? []}
          doorTypes={model.doorTypes ?? []}
          windowTypes={model.windowTypes ?? []}
          activeWallTypeId={activeWallTypeId}
          onChangeActiveWallType={(id) => {
            setActiveWallTypeId(id);
            const wt = (model.wallTypes ?? []).find((t) => t.id === id);
            logMessage(`Default wall type: ${wt?.name ?? id} — new walls (WA) use it.`, 'info');
          }}
          onOpenWallTypeEditor={(wtId) => {
            setEditingWallTypeId(wtId);
            setWallTypeModalOpen(true);
          }}
          onUpdateFloorType={(updatedFt: FloorType) => {
            const nextFloorTypes = (model.floorTypes ?? []).map((ft) =>
              ft.id === updatedFt.id ? updatedFt : ft
            );
            const nextEntities = model.entities.map((ent) => {
              if (ent.type === 'floor' && ent.floorTypeId === updatedFt.id) {
                return {
                  ...ent,
                  thickness: updatedFt.thickness,
                  material: updatedFt.material,
                };
              }
              return ent;
            });
            commitModel(
              {
                ...model,
                floorTypes: nextFloorTypes,
                entities: nextEntities,
              },
              `Edit Floor Type "${updatedFt.name}"`
            );
            logMessage(
              `Updated Floor Type "${updatedFt.name}" — all instances updated.`,
              'result'
            );
          }}
          onUpdateColumnType={(updatedCt: ColumnType) => {
            const nextColTypes = (model.columnTypes ?? []).map((ct) =>
              ct.id === updatedCt.id ? updatedCt : ct
            );
            const nextEntities = model.entities.map((ent) => {
              if (ent.type === 'column' && ent.columnTypeId === updatedCt.id) {
                return {
                  ...ent,
                  shape: updatedCt.shape,
                  width: updatedCt.width,
                  depth: updatedCt.depth,
                };
              }
              return ent;
            });
            commitModel(
              {
                ...model,
                columnTypes: nextColTypes,
                entities: nextEntities,
              },
              `Edit Column Type "${updatedCt.name}"`
            );
            logMessage(
              `Updated Column Type "${updatedCt.name}" — all instances updated.`,
              'result'
            );
          }}
          onUpdateDoorType={(updatedDt: DoorType) => {
            const nextDoorTypes = (model.doorTypes ?? []).map((dt) => (dt.id === updatedDt.id ? updatedDt : dt));
            commitModel(
              { ...model, doorTypes: nextDoorTypes, entities: applyTypeToInstances(model.entities, { door: updatedDt }) },
              `Edit Door Type "${updatedDt.name}"`
            );
            logMessage(`Updated Door Type "${updatedDt.name}" — all instances updated.`, 'result');
          }}
          onUpdateWindowType={(updatedWt: WindowType) => {
            const nextWinTypes = (model.windowTypes ?? []).map((wt) => (wt.id === updatedWt.id ? updatedWt : wt));
            commitModel(
              { ...model, windowTypes: nextWinTypes, entities: applyTypeToInstances(model.entities, { window: updatedWt }) },
              `Edit Window Type "${updatedWt.name}"`
            );
            logMessage(`Updated Window Type "${updatedWt.name}" — all instances updated.`, 'result');
          }}
          onUpdateEntity={(updated, label) => {
            const next = syncHostedBimEntities(
              model.entities.map((e) => (e.id === updated.id ? updated : e))
            );
            updateEntities(next, label);
          }}
          onDeleteSelected={handleDeleteSelectionOrStartErase}
          onSetActiveLayer={(layerId: LayerId) =>
            commitModel({ ...model, activeLayer: layerId }, 'Set Active Layer')
          }
          onUpdateLayer={(updatedLayer: Layer) => {
            const nextLayers = model.layers.map((l) =>
              l.id === updatedLayer.id ? updatedLayer : l
            );
            commitModel(
              { ...model, layers: nextLayers },
              `Update Layer ${updatedLayer.name}`
            );
          }}
          onAddLayer={(name, color) => {
            if (model.layers.some((l) => l.id === name)) return;
            const nextLayers: Layer[] = [
              ...model.layers,
              { id: name, name, color, visible: true, locked: false },
            ];
            commitModel(
              { ...model, layers: nextLayers, activeLayer: name },
              `Add Layer ${name}`
            );
          }}
          onUpdateSettings={(partial: Partial<ProjectSettings>) =>
            commitModel(
              {
                ...model,
                settings: { ...model.settings, ...partial },
              },
              'Update Settings'
            )
          }
          layersExpanded={layersExpanded}
          onToggleLayersExpanded={() => setLayersExpanded((v) => !v)}
          onOpenBlockEditor={(blockId) => {
            setEditingBlockId(blockId);
            setBlockEditorOpen(true);
          }}
          onExplodeSelected={handleExplodeSelection}
          darkMode={darkMode}
        />
        )}
      </main>

      {/* 3. BOTTOM COMMAND LINE & STATUS BAR */}
      <CommandLine
        hintText={hintText}
        logs={logs}
        onSubmitInput={handleCommandLineSubmit}
        onCancelCommand={() => {
          setCmdPrompt(null);
          setDrawingPoints([]);
          setActiveTool('select');
          logMessage('Cancelled command.', 'info');
        }}
        lastCommandAlias={lastCommandAlias}
        settings={model.settings}
        onToggleSetting={(key) => {
          commitModel(
            {
              ...model,
              settings: {
                ...model.settings,
                [key]: !model.settings[key],
              },
            },
            `Toggle ${key}`
          );
        }}
        onUpdateSettings={(updater) => {
          commitModel(
            {
              ...model,
              settings: updater(model.settings),
            },
            'Update Precision Settings'
          );
        }}
        cursorWorld={cursorWorld}
        activeOsnap={activeOsnap}
        darkMode={darkMode}
        inputRef={commandInputRef}
        uiMode={uiMode}
      />

      {/* 4. HELP MODAL (F1) */}
      {/* Deleting a wall with hosted openings asks first — openings are never deleted silently */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="del-hosted-title">
          <div className={`w-[360px] rounded-xl border shadow-2xl p-4 space-y-3 ${darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-800'}`}>
            <div id="del-hosted-title" className="text-sm font-bold">
              Also delete {pendingDelete.hosted.length} hosted door{pendingDelete.hosted.length === 1 ? '' : 's'}/window{pendingDelete.hosted.length === 1 ? '' : 's'}?
            </div>
            <p className="text-xs text-stone-500">
              The wall{pendingDelete.ids.length === 1 ? '' : 's'} you are deleting host{pendingDelete.ids.length === 1 ? 's' : ''} {pendingDelete.hosted.length} opening{pendingDelete.hosted.length === 1 ? '' : 's'}. Openings can't exist without a wall, so they are deleted with it. You can undo this (Ctrl+Z).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                className={`px-3 py-1.5 text-xs rounded-lg border ${darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-300 hover:bg-stone-100'}`}
                onClick={() => {
                  setPendingDelete(null);
                  logMessage('Delete cancelled — the wall and its openings were kept.', 'info');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-delete-hosted"
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                onClick={() => {
                  const p = pendingDelete;
                  setPendingDelete(null);
                  requestDelete(p.ids, p.label, true);
                }}
              >
                Delete wall + {pendingDelete.hosted.length}
              </button>
            </div>
          </div>
        </div>
      )}

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        onRunCommand={(cmd: CommandDefinition) => {
          setLastCommandAlias(cmd.aliases[0]);
          logMessage(`COMMAND: ${cmd.aliases[0]} (${cmd.name})`, 'input');
          cmd.run(commandContext);
        }}
        darkMode={darkMode}
        onReplayTour={handleStartTour}
        onOpenShortcuts={() => setShortcutSheetOpen(true)}
        onLoadStressTest={handleLoadStressTest}
      />

      {/* 5. DIMENSION STYLE MODAL (D / DIMSTYLE) */}
      <DimStyleModal
        isOpen={dimStyleOpen}
        onClose={() => setDimStyleOpen(false)}
        settings={model.settings.dimStyle || DEFAULT_DIM_STYLE}
        units={model.settings.units}
        onSave={(nextDimStyle) => {
          commitModel(
            {
              ...model,
              settings: {
                ...model.settings,
                dimStyle: nextDimStyle,
              },
            },
            'Update Dimension Style (DIMSTYLE)'
          );
          logMessage(
            `Updated Dimension Style: Arrow=${nextDimStyle.arrowType}, TextHeight=${nextDimStyle.textHeight}", WallFace=${nextDimStyle.preferFace}.`,
            'result'
          );
        }}
        darkMode={darkMode}
      />

      {/* 6. BLOCK EDITOR MODAL (BE / BEDIT) */}
      <BlockEditorModal
        isOpen={blockEditorOpen}
        onClose={() => setBlockEditorOpen(false)}
        blocks={model.blocks ?? []}
        initialBlockId={editingBlockId}
        units={model.settings.units}
        onSaveBlock={(updatedBlock: BlockDefinition) => {
          const nextBlocks = (model.blocks ?? []).map((b) =>
            b.id === updatedBlock.id ? updatedBlock : b
          );
          const nextEntities = model.entities.map((ent) => {
            if (ent.type === 'block' && ent.blockId === updatedBlock.id) {
              return {
                ...ent,
                name: updatedBlock.name,
                width: updatedBlock.width,
                depth: updatedBlock.depth,
                height: updatedBlock.height,
                color: updatedBlock.color,
              };
            }
            return ent;
          });
          commitModel(
            {
              ...model,
              blocks: nextBlocks,
              entities: nextEntities,
            },
            `Edit Block Definition "${updatedBlock.name}" (BEDIT)`
          );
          logMessage(
            `Updated block definition "${updatedBlock.name}" — all placed instances updated in 2D and 3D.`,
            'result'
          );
        }}
        darkMode={darkMode}
      />

      {/* 7. BUILDING LEVELS MANAGER MODAL (LL / LEVEL) */}
      <LevelManagerModal
        isOpen={levelModalOpen}
        onClose={() => setLevelModalOpen(false)}
        levels={model.levels ?? []}
        activeLevelId={activeLevelId}
        units={model.settings.units}
        onSelectLevel={(id: string) =>
          commitModel({ ...model, activeLevelId: id }, 'Switch Level')
        }
        onUpdateLevels={(nextLevels: LevelDefinition[], nextActiveId?: string) => {
          commitModel(
            {
              ...model,
              levels: nextLevels,
              activeLevelId: nextActiveId || activeLevelId,
            },
            'Update Building Levels (LL)'
          );
          logMessage(
            `Updated Building Levels (${nextLevels.length} levels).`,
            'result'
          );
        }}
      />

      {/* 8. VISIBILITY / GRAPHICS OVERRIDES MODAL (VV / VG) */}
      <VisibilityModal
        isOpen={visibilityModalOpen}
        onClose={() => setVisibilityModalOpen(false)}
        visibility={model.visibility || createDefaultVisibility()}
        tempHiddenCount={tempHiddenIds.length}
        tempIsolatedCount={tempIsolatedIds.length}
        onResetTempHideIsolate={handleResetTempHideIsolate}
        gridOpacity={model.settings.gridOpacity}
        onGridOpacityChange={(v) => commitModel({ ...model, settings: { ...model.settings, gridOpacity: v } }, 'Plan Grid Opacity…')}
        onUpdateVisibility={(nextVis: VisibilitySettings) => {
          commitModel(
            {
              ...model,
              visibility: nextVis,
            },
            'Update Visibility/Graphics (VV)'
          );
          logMessage(
            'Updated Visibility/Graphics category overrides for 2D Plan & 3D View.',
            'result'
          );
        }}
      />

      {/* 9. WALL TYPE COMPOUND LAYER ASSEMBLY EDITOR MODAL */}
      <WallTypeEditorModal
        isOpen={wallTypeModalOpen}
        onClose={() => setWallTypeModalOpen(false)}
        wallTypes={model.wallTypes ?? []}
        units={model.settings.units}
        initialWallTypeId={editingWallTypeId || activeWallTypeId}
        onSaveWallType={(updatedWt: WallType) => {
          const exists = (model.wallTypes ?? []).some(
            (wt) => wt.id === updatedWt.id
          );
          const nextWallTypes = exists
            ? (model.wallTypes ?? []).map((wt) =>
                wt.id === updatedWt.id ? updatedWt : wt
              )
            : [...(model.wallTypes ?? []), updatedWt];
          const newThickness = getWallTypeTotalThickness(updatedWt);
          const nextEntities = syncHostedBimEntities(
            model.entities.map((ent) => {
              if (ent.type === 'wall' && ent.wallTypeId === updatedWt.id) {
                return {
                  ...ent,
                  thickness: newThickness,
                };
              }
              return ent;
            })
          );
          commitModel(
            {
              ...model,
              wallTypes: nextWallTypes,
              entities: nextEntities,
            },
            `Edit Wall Type "${updatedWt.name}"`
          );
          logMessage(
            `Saved Wall Type "${updatedWt.name}" (${updatedWt.layers.length} layers, Total Thickness = ${newThickness}") — all walls of this type updated.`,
            'result'
          );
        }}
      />

      {/* 10. FIRST-RUN 5-STEP GUIDED TOUR MODAL */}
      <GuidedTourModal
        isOpen={tourOpen}
        stepIndex={tourStep}
        step={tourStep}
        onChangeStep={setTourStep}
        onFinishOrSkip={handleCloseTour}
        onClose={handleCloseTour}
        uiMode={uiMode}
        onToggleUiMode={handleToggleUiMode}
        darkMode={darkMode}
      />

      {/* 11. KEYBOARD SHORTCUT CHEAT SHEET MODAL (Ctrl+/) */}
      <ShortcutCheatSheetModal
        isOpen={shortcutSheetOpen}
        onClose={() => setShortcutSheetOpen(false)}
        onStartTour={handleStartTour}
        onOpenGuidedTour={handleStartTour}
        darkMode={darkMode}
      />

      {/* 12. NON-BLOCKING TOAST NOTIFICATIONS */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        darkMode={darkMode}
      />
    </div>
  );
}
