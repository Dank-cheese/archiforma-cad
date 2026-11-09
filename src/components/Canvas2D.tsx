import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArchEntity,
  ArchModel,
  ArcEntity,
  BlockDefinition,
  BlockInstanceEntity,
  CircleEntity,
  ColumnEntity,
  ColumnType,
  DimensionEntity,
  DoorEntity,
  FloorEntity,
  FloorType,
  GridEntity,
  GripPoint,
  HatchEntity,
  LeaderEntity,
  OsnapResult,
  Point,
  RoofEntity,
  RoomEntity,
  StairEntity,
  TagEntity,
  ToolId,
  VisibilityCategory,
  WallEntity,
  WallFace,
  WallType,
  WindowEntity,
} from '../types/model';
import type { ElevationDirection } from '../types/model';
import { PrimsWorld, SCREEN_PX_PER_MM } from './PrimsWorld';
import { StructurePlanLayer } from './StructurePlanLayer';
import {
  OpeningsPlanLayer,
  DEFAULT_OPENING_TOOL,
  buildOpeningEntity,
  computeOpeningPlacement,
  isOpeningTool,
  issueText,
  type OpeningToolState,
} from './OpeningsPlanLayer';
import { JOIN_CYCLE, joinGroupKey, joinHubs, joinStateIndex, mergeOutlines, setCornerJoin, wallEndsNear } from '../engine/wallJoins';
import { applyTempDimValue, copySelectionHosted, isHostedOpening, moveSelectionHosted, wallFrame as openingFrame, type TempDim } from '../engine/openings';
import { isStructureTool } from '../engine/structureTools';
import { STRUCTURAL_ONLY_TYPES } from '../engine/structure';
import type { Discipline } from '../types/model';
import { buildPlanPrimitives, buildRoofFacadePlanPrims, curtainWallPlanPrims } from '../engine/planPrimitives';
import { buildStructuralLevelPrims } from '../engine/structurePlan';
import { ViewCube } from './ViewCube';
import { loadViewCubeSettings, saveViewCubeSettings, type Cardinal, type Hotspot } from '../engine/viewCube';
import { halftonePrims, resolveUnderlay, supportMismatches, supportPolygons, underlayEntities } from '../engine/view';
import { connectedWallChain, faceAt, footprintFromWalls, getRoofGeometry, normalizeFootprint, offsetPolygon } from '../engine/roof';
import { elevationMarkerPositions, finishDef, paintWallBand, splitWallFace } from '../engine/facade';
import type { FacadeToolState, RoofToolState } from './ToolOptionsBar';
import {
  add,
  angleDegCad,
  angleDegRaw,
  applyGridSnap,
  applyGripMove,
  applyOrtho,
  circleFromThreePoints,
  computeAngularDimGeometry,
  computeLinearDimGeometry,
  buildSegmentIndex,
  getInferenceSegments,
  inferCursor,
  querySegmentIndex,
  computePolarSnap,
  computeRadialDimGeometry,
  computeStairParameters,
  computeStairPlanGeometry,
  computeWallFaces,
  computeWallLayerBands,
  computeWallPlanPolygons,
  cross,
  DEFAULT_DIM_STYLE,
  describeSvgArc,
  detectWallFaceUnderCursor,
  dist,
  findBestOsnap,
  findEntitiesAtPoint,
  findEnclosedRoomAtPoint,
  findGridIntersections,
  formatArea,
  formatLength,
  getBlockWorldPrimitives,
  getEntityAnchorPoint,
  getEntityGrips,
  getWallTypeTotalThickness,
  isEntityInSelectionBox,
  isPointInPolygon,
  lerpPoint,
  midpoint,
  moveEntity,
  normalize,
  Guide,
  InferenceResult,
  parseLengthInput,
  perpLeft,
  PolarSnapResult,
  polygonArea,
  polygonCentroid,
  projectPointOnSegment,
  rotateEntity,
  scale,
  sub,
  syncHostedBimEntities,
} from '../engine/geometry';
import {
  trimAt,
  extendAt,
  findTrimExtendCandidate,
} from '../engine/trimExtend';
import {
  CanvasContextMenu,
  QuickPropertiesPopup,
} from './OnboardingAndOverlays';
import { getElementCategory } from '../engine/elementRegistry';
import { CameraPlanLayer } from './CameraPlanLayer';
import { Canvas3D } from './Canvas3D';
import { aspectRatio, clampFov, fovFromCursor, fovLabel, groundElevationAt, makeCamera, nextCameraName } from '../engine/camera';
import type { CameraEntity } from '../types/model';
import {
  calculateStairRisers,
  computeStairPlanGeometry as computeFullStairPlanGeometry,
  createStairFromTemplate,
  DEFAULT_STAIR_TOOL,
  snapSecondRunWithAutoLanding,
  syncStairFloorOpenings,
  type StairToolState,
} from '../engine/stairs';
import { StairOptionsBar } from './StairUI';

interface Canvas2DProps {
  model: ArchModel;
  activeTool: ToolId;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  drawingPoints: Point[];
  onAddDrawingPoint: (pt: Point) => void;
  onFinishDrawing: (entitiesToAdd: ArchEntity[], actionLabel: string) => void;
  onUpdateModel: (nextEntities: ArchEntity[], actionLabel: string) => void;
  onCursorMove: (pt: Point, osnap: OsnapResult | null) => void;
  onLog: (text: string, kind?: 'input' | 'info' | 'error' | 'result') => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  viewTransform: { panX: number; panY: number; zoom: number };
  onChangeViewTransform: React.Dispatch<
    React.SetStateAction<{ panX: number; panY: number; zoom: number }>
  >;
  darkMode: boolean;
  modifySubStep?: number;
  pickedEntityId?: string | null;
  cuttingEdgeIds?: string[];
  boundaryEdgeIds?: string[];
  onModifyEntityClick?: (entity: ArchEntity, clickPoint: Point, shiftKey?: boolean) => void;
  onFenceComplete?: (path: Point[], shiftKey: boolean) => void;
  trimMode?: 'quick' | 'standard';
  edgeMode?: 'extend' | 'noextend';
  trimEraseSubMode?: boolean;
  activeInsertBlock?: BlockDefinition | null;
  insertRotation?: number;
  insertScale?: number;
  onRotateInsertBlock?: () => void;
  onOpenBlockEditor?: (blockId?: string) => void;
  activeWallType?: WallType;
  activeFloorType?: FloorType;
  activeColumnType?: ColumnType;
  tempHiddenIds?: string[];
  tempIsolatedIds?: string[];
  onResetTempHideIsolate?: () => void;
  uiMode?: 'beginner' | 'pro';
  hintText?: string;
  lastCommandAlias?: string;
  onRepeatLastCommand?: () => void;
  onCancelCommand?: () => void;
  onUndo?: () => void;
  onZoomExtents?: () => void;
  onFocusProperties?: () => void;
  onSelectTool?: (tool: ToolId) => void;
  onDeleteSelection?: () => void;
  roofTool?: RoofToolState;
  onRoofToolChange?: (next: RoofToolState) => void;
  onFinishRoof?: () => void;
  facadeTool?: FacadeToolState;
  onOpenElevation?: (dir: ElevationDirection) => void;
  discipline?: Discipline;
  analytical?: boolean;
  viewRebar?: boolean;
  /** Structural tools: the App turns the click into elements (tolerance = model inches). */
  onStructuralClick?: (tool: ToolId, snapped: Point, raw: Point, tol: number) => void;
  onOpenSection?: (id: string) => void;
  /** DR / WN / WO options (type, depth position, flip, snaps) */
  openingTool?: OpeningToolState;
  onOpeningToolChange?: (next: OpeningToolState) => void;
  /** Deletes ids through the App (asks before deleting a wall's hosted openings) */
  onRequestDelete?: (ids: string[], label: string) => void;
  /** CAMERA (CAM): FOV used before the third click (wheel / typed), and placement / open callbacks */
  cameraFov?: number;
  onCameraFovChange?: (fov: number) => void;
  onPlaceCamera?: (position: Point, target: Point, fov: number) => void;
  onOpenCamera?: (id: string) => void;
  /** UNDERLAY (Revit-style): 'none' | 'below' | 'foundation' | 'level:<id>' for this plan */
  underlayChoice?: string;
  onUnderlayChoiceChange?: (choice: string) => void;
  /** outline load-bearing walls / columns that have nothing under them in the underlay */
  underlayMismatch?: boolean;
  onUnderlayMismatchChange?: (on: boolean) => void;
  /** VIEWCUBE in plan: a static TOP cube; clicks open the 3D view there */
  viewCube?: boolean;
  onPlanViewCube?: (r: { kind: 'hotspot'; h: Hotspot } | { kind: 'home' } | { kind: 'cardinal'; c: Cardinal }) => void;
}

function getEntityCategory(ent: ArchEntity): VisibilityCategory {
  const catKey = ent.type === 'custom' ? (ent as any).customCategory : ent.type;
  const reg = getElementCategory(catKey);
  if (reg) {
    return reg.visibilityCategory;
  }
  switch (ent.type) {
    case 'footing':
    case 'beam':
    case 'beamsystem':
    case 'rebar':
    case 'areareinf':
    case 'connection':
    case 'sjoint':
    case 'load':
    case 'truss':
      return 'structure';
    case 'section':
    case 'camera':
      return 'annotations';
    case 'wall':
      return 'walls';
    case 'door':
    case 'wallopening':
      return 'doors';
    case 'window':
      return 'windows';
    case 'floor':
      return 'floors';
    case 'roof':
      return 'roofs';
    case 'stair':
      return 'stairs';
    case 'column':
      return 'columns';
    case 'grid':
      return 'grids';
    case 'room':
      return 'rooms';
    case 'block':
      return 'furniture';
    case 'dimension':
    case 'text':
    case 'leader':
    case 'tag':
    case 'hatch':
      return 'annotations';
    default:
      return 'lines';
  }
}

interface MemoizedCadPrimitiveItemProps {
  ent: ArchEntity;
  isSelected: boolean;
  strokeColor: string;
  zoom: number;
  onEntityClick: (e: React.MouseEvent, entity: ArchEntity) => void;
  onEntityContextMenu: (e: React.MouseEvent, entity: ArchEntity) => void;
}

const MemoizedCadPrimitiveItem: React.FC<MemoizedCadPrimitiveItemProps> = React.memo(
  ({ ent, isSelected, strokeColor, zoom, onEntityClick, onEntityContextMenu }) => {
    const sw = (isSelected ? 2.5 : 1.75) / zoom;
    switch (ent.type) {
      case 'line':
        return (
          <g
            onClick={(e) => onEntityClick(e, ent)}
            onContextMenu={(e) => onEntityContextMenu(e, ent)}
            className="cursor-pointer"
          >
            <line
              x1={ent.start.x}
              y1={ent.start.y}
              x2={ent.end.x}
              y2={ent.end.y}
              stroke="transparent"
              strokeWidth={12 / zoom}
            />
            <line
              x1={ent.start.x}
              y1={ent.start.y}
              x2={ent.end.x}
              y2={ent.end.y}
              stroke={strokeColor}
              strokeWidth={sw}
              strokeLinecap="round"
            />
          </g>
        );
      case 'polyline': {
        const pts = ent.points.map((p) => `${p.x},${p.y}`).join(' ');
        return (
          <g
            onClick={(e) => onEntityClick(e, ent)}
            onContextMenu={(e) => onEntityContextMenu(e, ent)}
            className="cursor-pointer"
          >
            {ent.closed ? (
              <polygon
                points={pts}
                fill="none"
                stroke={strokeColor}
                strokeWidth={sw}
              />
            ) : (
              <polyline
                points={pts}
                fill="none"
                stroke={strokeColor}
                strokeWidth={sw}
              />
            )}
          </g>
        );
      }
      case 'rectangle': {
        const x = Math.min(ent.p1.x, ent.p2.x);
        const y = Math.min(ent.p1.y, ent.p2.y);
        const w = Math.abs(ent.p2.x - ent.p1.x);
        const h = Math.abs(ent.p2.y - ent.p1.y);
        return (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke={strokeColor}
            strokeWidth={sw}
            onClick={(e) => onEntityClick(e, ent)}
            onContextMenu={(e) => onEntityContextMenu(e, ent)}
            className="cursor-pointer"
          />
        );
      }
      case 'circle':
        return (
          <circle
            cx={ent.center.x}
            cy={ent.center.y}
            r={ent.radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={sw}
            onClick={(e) => onEntityClick(e, ent)}
            onContextMenu={(e) => onEntityContextMenu(e, ent)}
            className="cursor-pointer"
          />
        );
      case 'arc':
        return (
          <path
            d={describeSvgArc(
              ent.center,
              ent.radius,
              ent.startAngle,
              ent.endAngle
            )}
            fill="none"
            stroke={strokeColor}
            strokeWidth={sw}
            onClick={(e) => onEntityClick(e, ent)}
            onContextMenu={(e) => onEntityContextMenu(e, ent)}
            className="cursor-pointer"
          />
        );
      default:
        return null;
    }
  }
);

export const Canvas2D: React.FC<Canvas2DProps> = ({
  model,
  activeTool,
  selectedIds,
  onSelectIds,
  drawingPoints,
  onAddDrawingPoint,
  onFinishDrawing,
  onUpdateModel,
  onCursorMove,
  onLog,
  svgRef,
  viewTransform,
  onChangeViewTransform,
  darkMode,
  modifySubStep = 0,
  pickedEntityId = null,
  cuttingEdgeIds = [],
  boundaryEdgeIds = [],
  onModifyEntityClick,
  onFenceComplete,
  trimMode = 'quick',
  edgeMode = 'noextend',
  trimEraseSubMode = false,
  activeInsertBlock = null,
  insertRotation = 0,
  insertScale = 1,
  onRotateInsertBlock,
  onOpenBlockEditor,
  activeWallType,
  activeFloorType,
  activeColumnType,
  tempHiddenIds = [],
  tempIsolatedIds = [],
  onResetTempHideIsolate,
  uiMode = 'beginner',
  hintText = '',
  lastCommandAlias = 'WA',
  onRepeatLastCommand,
  onCancelCommand,
  onUndo,
  onZoomExtents,
  onFocusProperties,
  onSelectTool,
  onDeleteSelection,
  roofTool,
  onRoofToolChange,
  onFinishRoof,
  facadeTool,
  onOpenElevation,
  discipline = 'combined',
  analytical = false,
  viewRebar = false,
  onStructuralClick,
  onOpenSection,
  openingTool = DEFAULT_OPENING_TOOL,
  onOpeningToolChange,
  onRequestDelete,
  cameraFov = 60,
  onCameraFovChange,
  onPlaceCamera,
  onOpenCamera,
  underlayChoice = 'below',
  onUnderlayChoiceChange,
  underlayMismatch = false,
  onUnderlayMismatchChange,
  viewCube = false,
  onPlanViewCube,
}) => {
  // UNDERLAY: hold U to show it while it is switched off
  const [underlayHeld, setUnderlayHeld] = useState(false);
  // CAMERA: a wheel turn during step 3 overrides the cursor FOV until the mouse moves on
  const [camFovOverride, setCamFovOverride] = useState<{ fov: number; at: Point } | null>(null);
  const [cameraPreviewHidden, setCameraPreviewHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorWorld, setCursorWorld] = useState<Point>({ x: 0, y: 0 });
  const [rawCursorWorld, setRawCursorWorld] = useState<Point>({ x: 0, y: 0 });
  const [activeOsnap, setActiveOsnap] = useState<OsnapResult | null>(null);
  const [activePolarSnap, setActivePolarSnap] = useState<PolarSnapResult | null>(null);
  // Smart alignment guides (TRACK / F11): current inference, Shift-lock and Alt-suppress state
  const [activeInference, setActiveInference] = useState<InferenceResult | null>(null);
  const lastInferenceRef = useRef<InferenceResult | null>(null);
  const guideLockRef = useRef<Guide | null>(null);
  const modifierRef = useRef<{ shift: boolean; alt: boolean }>({ shift: false, alt: false });
  const [screenCursor, setScreenCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [columnRotation, setColumnRotation] = useState<number>(0);
  const openingToolRef = useRef<OpeningToolState>(openingTool);
  openingToolRef.current = openingTool;
  /** Temporary dimension being typed into (placing or for the selected opening) */
  const [editingDim, setEditingDim] = useState<{
    dim: TempDim;
    at: Point;
    text: string;
    openingId?: string;
    wallId: string;
    s: number;
    width: number;
    cursorSide: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Wall face measuring state (Tab to cycle: Interior / Centerline / Exterior)
  const [wallFaceOverride, setWallFaceOverride] = useState<'auto' | WallFace>('auto');
  const [dimAssoc1, setDimAssoc1] = useState<{
    entityId: string;
    face: WallFace;
    offsetParam: number;
  } | null>(null);
  const [dimAssoc2, setDimAssoc2] = useState<{
    entityId: string;
    face: WallFace;
    offsetParam: number;
  } | null>(null);
  const [radialTarget, setRadialTarget] = useState<CircleEntity | ArcEntity | null>(null);

  // Dynamic Input local state
  const [dynLength, setDynLength] = useState<string>('');
  const [dynAngle, setDynAngle] = useState<string>('');
  const [dynEditingField, setDynEditingField] = useState<'length' | 'angle' | null>(null);
  const dynLengthRef = useRef<HTMLInputElement>(null);
  const dynAngleRef = useRef<HTMLInputElement>(null);

  // Clear tracking points and dynamic input when tool finishes or cancels
  useEffect(() => {
    if (drawingPoints.length === 0) {
      setActivePolarSnap(null);
      setActiveInference(null);
      guideLockRef.current = null;
      setDynEditingField(null);
      setDimAssoc1(null);
      setDimAssoc2(null);
      setRadialTarget(null);
    }
  }, [drawingPoints.length, activeTool]);

  // STAIR (ST) tool state (Revit "Stair by Component" with Automatic Landings + One-Click Templates)
  const [stairTool, setStairTool] = useState<StairToolState>(DEFAULT_STAIR_TOOL);
  useEffect(() => {
    if (activeTool === 'stair') {
      const levels = [...(model.levels ?? [])].sort((a, b) => a.elevation - b.elevation);
      const curLvlId = model.activeLevelId || 'level-1';
      const curIdx = levels.findIndex((l) => l.id === curLvlId);
      const baseLvl = curIdx >= 0 ? levels[curIdx] : levels[0] ?? { id: 'level-1', name: 'Level 1', elevation: 0 };
      const topLvl =
        curIdx >= 0 && curIdx + 1 < levels.length
          ? levels[curIdx + 1]
          : levels[levels.length - 1] ?? { id: 'level-2', name: 'Level 2', elevation: baseLvl.elevation + 108 };
      setStairTool((prev) => ({
        ...prev,
        baseLevelId: baseLvl.id,
        topLevelId: topLvl.id !== baseLvl.id ? topLvl.id : (levels[1]?.id ?? 'level-2'),
        draftRuns: [],
        draftLandings: [],
      }));
    }
  }, [activeTool, model.activeLevelId, model.levels]);

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  // Box selection state
  const [boxSelectStart, setBoxSelectStart] = useState<Point | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<Point | null>(null);

  // Grip dragging state
  const [draggingGrip, setDraggingGrip] = useState<GripPoint | null>(null);
  const [previewEntities, setPreviewEntities] = useState<ArchEntity[] | null>(
    null
  );

  // Shift tracking for Trim/Extend live preview
  const [shiftPressed, setShiftPressed] = useState(false);
  useEffect(() => {
    const onKeyChange = (e: KeyboardEvent) => {
      const down = e.type === 'keydown';
      if (e.key === 'Shift') {
        setShiftPressed(down);
        modifierRef.current.shift = down;
        // Shift locks onto the guide currently shown (released -> unlock)
        if (down && !guideLockRef.current && lastInferenceRef.current?.guides.length) {
          guideLockRef.current = lastInferenceRef.current.guides[0];
        }
        if (!down) guideLockRef.current = null;
      }
      if (e.key === 'Alt') {
        modifierRef.current.alt = down;
        if (down) e.preventDefault(); // keep the browser menu bar from stealing focus
      }
    };
    window.addEventListener('keydown', onKeyChange);
    window.addEventListener('keyup', onKeyChange);
    return () => {
      window.removeEventListener('keydown', onKeyChange);
      window.removeEventListener('keyup', onKeyChange);
    };
  }, []);

  // Freehand and 2-point fence state for TRIM and EXTEND
  const [fencePath, setFencePath] = useState<Point[]>([]);
  const [isFenceDragging, setIsFenceDragging] = useState(false);
  const [twoPointFenceStart, setTwoPointFenceStart] = useState<Point | null>(null);
  const fencePointerDownRef = useRef(false);
  const fenceStartPtRef = useRef<Point | null>(null);

  const allEntities = previewEntities ?? model.entities;
  const activeLevelId = model.activeLevelId || 'level-1';
  const visibleLayers = useMemo(
    () => new Map(model.layers.map((l) => [l.id, l])),
    [model.layers]
  );
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Filter entities visible on the current 2D Plan view (respecting Level, VV Category, Layer, and Temporary Hide/Isolate)
  const isEntityVisibleInPlan = useCallback(
    (ent: ArchEntity): boolean => {
      const layer = visibleLayers.get(ent.layer);
      if (layer && !layer.visible) return false;
      if (discipline === 'architectural' && STRUCTURAL_ONLY_TYPES.has(ent.type)) return false;

      const cat = getEntityCategory(ent);
      if (model.visibility?.plan2d && model.visibility.plan2d[cat] === false) {
        return false;
      }

      if (tempIsolatedIds.length > 0 && !tempIsolatedIds.includes(ent.id)) {
        return false;
      }
      if (tempHiddenIds.includes(ent.id)) {
        return false;
      }

      if (ent.type === 'grid') return true;
      if (ent.type === 'stair') {
        const entLvl = ent.levelId || 'level-1';
        return (
          entLvl === activeLevelId ||
          ent.baseLevelId === activeLevelId ||
          ent.topLevelId === activeLevelId
        );
      }

      return (ent.levelId || 'level-1') === activeLevelId;
    },
    [activeLevelId, model.visibility?.plan2d, tempHiddenIds, tempIsolatedIds, visibleLayers, discipline]
  );

  const entities = useMemo(
    () => allEntities.filter(isEntityVisibleInPlan),
    [allEntities, isEntityVisibleInPlan]
  );

  // Spatial index of straight segments for smart alignment guides (rebuilt when the plan changes)
  const inferenceIndex = useMemo(() => buildSegmentIndex(getInferenceSegments(entities)), [entities]);
  const grids = useMemo(
    () => entities.filter((e): e is GridEntity => e.type === 'grid'),
    [entities]
  );
  const gridIntersections = useMemo(() => findGridIntersections(grids), [grids]);

  // Optional underlay walls from the level immediately below the active level
  // ---------------- UNDERLAY (halftone level / foundation drawn beneath this plan) ----------------
  const underlay = useMemo(() => {
    const levels = model.levels ?? [];
    let r = resolveUnderlay(underlayChoice, levels, activeLevelId);
    if (r.kind === 'none' && underlayHeld) {
      r = resolveUnderlay('below', levels, activeLevelId);
      if (r.kind === 'none') r = resolveUnderlay('foundation', levels, activeLevelId);
    }
    return r;
  }, [underlayChoice, underlayHeld, model.levels, activeLevelId]);
  // pens / hatch scale are rebuilt only when the zoom doubles or halves
  const underlayZoomBucket = Math.pow(2, Math.round(Math.log2(Math.max(0.05, viewTransform.zoom))));
  const underlayEnts = useMemo(() => underlayEntities(allEntities, underlay), [allEntities, underlay]);
  const underlayPrims = useMemo(() => {
    if (underlay.kind === 'none') return [];
    const mm = underlayZoomBucket / SCREEN_PX_PER_MM;
    const sub = { ...model, entities: underlay.kind === 'foundation' ? allEntities : underlayEnts };
    const prims = underlay.kind === 'foundation' ? buildStructuralLevelPrims(sub, underlay.levelId, mm, 'foundation', { warnings: false }) : buildPlanPrimitives(sub, underlay.levelId, mm);
    return halftonePrims(prims, darkMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlay, underlayEnts, allEntities, underlayZoomBucket, darkMode, model.layers, model.visibility, model.wallTypes, model.settings.units]);
  const mismatches = useMemo(() => {
    if (!underlayMismatch || underlay.kind === 'none') return [];
    const current = allEntities.filter((e) => (e.levelId || 'level-1') === activeLevelId && (e.type === 'column' || e.type === 'wall'));
    return supportMismatches(current, supportPolygons(underlayEnts, allEntities, model.structureJoins));
  }, [underlayMismatch, underlay, underlayEnts, allEntities, activeLevelId, model.structureJoins]);

  // hold U: show the underlay while held (a quick tap still types U into the command line)
  useEffect(() => {
    let startedOnCanvas = false;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== 'u' && e.key !== 'U') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.repeat) {
        startedOnCanvas = !typing(e.target);
        return;
      }
      if (!startedOnCanvas) return;
      e.preventDefault(); // auto-repeat: no more "uuu" in the command line
      setUnderlayHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== 'u' && e.key !== 'U') return;
      setUnderlayHeld((held) => {
        if (held) {
          // remove the single "u" typed by the first key press
          const el = document.activeElement as HTMLInputElement | null;
          if (el && el.tagName === 'INPUT' && /^u$/i.test(el.value)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(el, '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.blur();
          }
        }
        return false;
      });
      startedOnCanvas = false;
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  const wallsForFace = useMemo(
    () => entities.filter((e): e is WallEntity => e.type === 'wall'),
    [entities]
  );
  const isDimWallTool = ['dimension', 'dli', 'dco', 'dba'].includes(activeTool);
  const effectiveFacePref =
    wallFaceOverride !== 'auto'
      ? wallFaceOverride
      : model.settings.dimStyle?.preferFace ?? 'auto';
  const detectedWallFace = isDimWallTool
    ? detectWallFaceUnderCursor(rawCursorWorld, wallsForFace, 36, effectiveFacePref)
    : null;

  // Listen for Spacebar for Space+drag pan and Tab for cycling wall face
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && isOpeningTool(activeTool) && onOpeningToolChange) {
        // SPACE flips the door swing / window exterior side while placing (Shift+Space = door hand)
        e.preventDefault();
        if (e.shiftKey && activeTool === 'door') onOpeningToolChange({ ...openingToolRef.current, hand: openingToolRef.current.hand === 'left' ? 'right' : 'left' });
        else onOpeningToolChange({ ...openingToolRef.current, flip: !openingToolRef.current.flip });
        return;
      }
      if (e.code === 'Space') {
        setSpacePressed(true);
      }
      if (e.key === 'Tab' && ['dimension', 'dli', 'dco', 'dba'].includes(activeTool)) {
        e.preventDefault();
        setWallFaceOverride((prev) =>
          prev === 'auto'
            ? 'interior'
            : prev === 'interior'
            ? 'centerline'
            : prev === 'centerline'
            ? 'exterior'
            : 'auto'
        );
      }
      if (
        (e.key === 'r' || e.key === 'R') &&
        !e.ctrlKey &&
        !e.metaKey &&
        activeTool === 'insert' &&
        onRotateInsertBlock
      ) {
        e.preventDefault();
        onRotateInsertBlock();
      }
      if (
        (e.key === 'r' || e.key === 'R') &&
        !e.ctrlKey &&
        !e.metaKey &&
        activeTool === 'column'
      ) {
        e.preventDefault();
        setColumnRotation((prev) => (prev + 90) % 360);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeTool, onRotateInsertBlock, onOpeningToolChange]);

  // React's onWheel is passive, so the page / browser zoom must be blocked by a native listener:
  // the wheel only zooms the plan (or sets the camera FOV while placing a camera).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const block = (ev: WheelEvent) => ev.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, [svgRef]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - viewTransform.panX) / viewTransform.zoom,
        y: (sy - viewTransform.panY) / viewTransform.zoom,
      };
    },
    [svgRef, viewTransform]
  );

  // Compute snapped point with Grid Intersection priority (for columns), OSNAP, OTRACK, POLAR, ORTHO, and GRID SNAP
  const computeSnappedPoint = useCallback(
    (rawWorld: Point): {
      snapped: Point;
      osnap: OsnapResult | null;
      polar: PolarSnapResult | null;
      inference: InferenceResult | null;
    } => {
      const refPoint =
        drawingPoints.length > 0
          ? drawingPoints[drawingPoints.length - 1]
          : null;

      const tolWorld = 12 / viewTransform.zoom;

      // 0. If placing a Column (CL), prioritize Structural Grid Intersections
      if (activeTool === 'column' && gridIntersections.length > 0) {
        let bestGridHit: { point: Point; d: number } | null = null;
        for (const gi of gridIntersections) {
          const d = dist(rawWorld, gi.point);
          if (d <= tolWorld * 2 && (!bestGridHit || d < bestGridHit.d)) {
            bestGridHit = { point: gi.point, d };
          }
        }
        if (bestGridHit) {
          return {
            snapped: bestGridHit.point,
            osnap: { point: bestGridHit.point, type: 'Intersection' },
            polar: null,
            inference: null,
          };
        }
      }

      // 1. Check OSNAP first
      let osnap: OsnapResult | null = null;
      if (model.settings.osnapEnabled) {
        osnap = findBestOsnap(
          rawWorld,
          entities,
          model.layers,
          tolWorld,
          refPoint,
          model.settings.enabledOsnaps
        );
      }

      if (osnap) {
        return { snapped: osnap.point, osnap, polar: null, inference: null };
      }

      // 2. Smart alignment guides (TRACK, F11) — alignment, guide crossings, extension,
      //    parallel / perpendicular and equal length. Beats POLAR / ORTHO / grid snap.
      let inference: InferenceResult | null = null;
      const trackTool =
        activeTool !== 'select' || !!draggingGrip;
      if (model.settings.osnapTracking && trackTool && !modifierRef.current.alt) {
        const svgEl = svgRef.current;
        const w = svgEl?.clientWidth || 1600;
        const h = svgEl?.clientHeight || 1000;
        const z = viewTransform.zoom;
        const view = {
          minX: -viewTransform.panX / z,
          minY: -viewTransform.panY / z,
          maxX: (w - viewTransform.panX) / z,
          maxY: (h - viewTransform.panY) / z,
        };
        const segmentTools: ToolId[] = ['line', 'polyline', 'wall', 'curtainwall', 'railing', 'floor', 'roof', 'area', 'move', 'copy'];
        const res = inferCursor(rawWorld, {
          segments: querySegmentIndex(inferenceIndex, view),
          currentPoints: drawingPoints,
          zoom: z,
          settings: model.settings.smartGuides,
          segmentGuides: segmentTools.includes(activeTool),
          lockGuide: guideLockRef.current,
          units: model.settings.units,
        });
        if (res.snapped) inference = res;
      }
      let pt = rawWorld;
      if (inference) {
        return { snapped: inference.point, osnap: null, polar: null, inference };
      }

      // 3. Polar Tracking (F10)
      let polarSnap: PolarSnapResult | null = null;
      if (model.settings.polarTracking && refPoint) {
        const pSnap = computePolarSnap(
          refPoint,
          pt,
          model.settings.polarIncrement || 45,
          3.0
        );
        if (pSnap) {
          pt = pSnap.point;
          polarSnap = pSnap;
        }
      }

      // 4. Apply ORTHO if reference point exists and not polar snapped
      if (model.settings.orthoEnabled && refPoint && !polarSnap) {
        pt = applyOrtho(refPoint, pt);
      }

      // 5. Apply Grid Snap if not osnapped, polar snapped, or tracked
      if (model.settings.snapEnabled && !osnap && !polarSnap) {
        pt = applyGridSnap(pt, model.settings.snapSize);
        if (model.settings.orthoEnabled && refPoint) {
          pt = applyOrtho(refPoint, pt);
        }
      }

      return { snapped: pt, osnap: null, polar: polarSnap, inference: null };
    },
    [
      activeTool,
      gridIntersections,
      drawingPoints,
      entities,
      model.layers,
      model.settings.orthoEnabled,
      model.settings.osnapEnabled,
      model.settings.polarTracking,
      model.settings.polarIncrement,
      model.settings.osnapTracking,
      model.settings.smartGuides,
      model.settings.units,
      model.settings.enabledOsnaps,
      model.settings.snapEnabled,
      model.settings.snapSize,
      inferenceIndex,
      draggingGrip,
      svgRef,
      viewTransform.zoom,
      viewTransform.panX,
      viewTransform.panY,
    ]
  );

  const findNearestWall = useCallback(
    (pt: Point, maxDistInches = 24): { wall: WallEntity; offset: number } | null => {
      const walls = entities.filter((e): e is WallEntity => e.type === 'wall');
      let best: { wall: WallEntity; offset: number; dist: number } | null = null;
      for (const w of walls) {
        const proj = projectPointOnSegment(pt, w.start, w.end);
        if (proj.distance <= Math.max(maxDistInches, w.thickness * 1.5)) {
          const wallLen = Math.max(1, dist(w.start, w.end));
          const clampedT = Math.max(24 / wallLen, Math.min(1 - 24 / wallLen, proj.t));
          if (!best || proj.distance < best.dist) {
            best = { wall: w, offset: clampedT, dist: proj.distance };
          }
        }
      }
      return best ? { wall: best.wall, offset: best.offset } : null;
    },
    [entities]
  );

  const commitEditingDim = () => {
    if (!editingDim) return;
    const v = parseLengthInput(editingDim.text, model.settings.units);
    if (v === null || v < 0) {
      onLog(`"${editingDim.text}" is not a length — try 2'-6" or 30.`, 'error');
      return;
    }
    const newS = applyTempDimValue(editingDim.dim, v, editingDim.width, editingDim.s);
    const w = model.entities.find((e): e is WallEntity => e.type === 'wall' && e.id === editingDim.wallId);
    setEditingDim(null);
    if (!w) return;
    const L = Math.max(1, dist(w.start, w.end));
    if (editingDim.openingId) {
      onUpdateModel(
        syncHostedBimEntities(model.entities.map((e) => (e.id === editingDim.openingId && isHostedOpening(e) ? { ...e, offset: newS / L } : e))),
        'Move Opening (temporary dimension)'
      );
      onLog(`Opening moved: ${formatLength(v, model.settings.units)} from the reference.`, 'result');
    } else {
      placeOpeningAt(w.id, newS, editingDim.cursorSide);
    }
  };

  const handleCommitDynamicInput = () => {
    if (drawingPoints.length === 0) return;
    const ref = drawingPoints[drawingPoints.length - 1];
    const parsedLen = parseLengthInput(dynLength, model.settings.units);
    const parsedAng = parseFloat(dynAngle);
    if (parsedLen !== null && !isNaN(parsedAng) && parsedLen > 0) {
      const rad = (parsedAng * Math.PI) / 180;
      const targetPt: Point = {
        x: ref.x + parsedLen * Math.cos(rad),
        y: ref.y - parsedLen * Math.sin(rad),
      };

      if (activeTool === 'line') {
        onFinishDrawing(
          [
            {
              id: `line-${Date.now()}`,
              type: 'line',
              layer: model.activeLayer,
              levelId: activeLevelId,
              start: ref,
              end: targetPt,
            },
          ],
          'Draw Line'
        );
      } else {
        onAddDrawingPoint(targetPt);
      }
      setDynEditingField(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // CAMERA (CAM): the wheel changes the field of view (Ctrl / ⌘ + wheel still zooms the plan)
    if (activeTool === 'camera' && !e.ctrlKey && !e.metaKey) {
      const cur = drawingPoints.length >= 2 ? camFovOverride?.fov ?? fovFromCursor(drawingPoints[0], drawingPoints[1], rawCursorWorld) : cameraFov;
      const next = clampFov(Math.round(cur + (e.deltaY < 0 ? -2 : 2)));
      onCameraFovChange?.(next);
      if (drawingPoints.length >= 2) setCamFovOverride({ fov: next, at: rawCursorWorld });
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    onChangeViewTransform((prev) => {
      const nextZoom = Math.max(0.15, Math.min(20, prev.zoom * zoomFactor));
      const worldX = (mouseX - prev.panX) / prev.zoom;
      const worldY = (mouseY - prev.panY) / prev.zoom;
      return {
        zoom: nextZoom,
        panX: mouseX - worldX * nextZoom,
        panY: mouseY - worldY * nextZoom,
      };
    });
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Middle mouse button (button === 1) or Space+Left click -> Pan
    if (e.button === 1 || (e.button === 0 && spacePressed)) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewTransform.panX,
        panY: viewTransform.panY,
      };
      return;
    }

    if (e.button !== 0) return;

    const raw = screenToWorld(e.clientX, e.clientY);
    const { snapped } = computeSnappedPoint(raw);

    // Check if clicking on a visible grip when in select mode
    if (activeTool === 'select' && selectedIds.length > 0) {
      const gripTol = 9 / viewTransform.zoom;
      for (const id of selectedIds) {
        const ent = model.entities.find((el) => el.id === id);
        if (!ent) continue;
        const grips = getEntityGrips(ent, model.entities);
        const hitGrip = grips.find((g) => dist(raw, g.point) <= gripTol);
        if (hitGrip) {
          setDraggingGrip(hitGrip);
          setPreviewEntities(model.entities);
          return;
        }
      }
    }

    // STRUCTURAL tools (FT, WF, FS, PC, BM, BS, BR, RB, AR, CN, CJ, LD, SEC) are handled by the structure engine
    if (isStructureTool(activeTool) && onStructuralClick) {
      onStructuralClick(activeTool, snapped, raw, 10 / viewTransform.zoom);
      return;
    }

    // Handle active drawing/BIM tools on canvas click
    if (activeTool === 'line') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const p0 = drawingPoints[0];
        if (dist(p0, snapped) > 0.5) {
          onFinishDrawing(
            [
              {
                id: `line-${Date.now()}`,
                type: 'line',
                layer: model.activeLayer,
                levelId: activeLevelId,
                start: p0,
                end: snapped,
              },
            ],
            'Draw Line'
          );
        }
      }
      return;
    }

    if (activeTool === 'polyline' || activeTool === 'wall') {
      onAddDrawingPoint(snapped);
      return;
    }

    // FLOOR (SB): Click inside an enclosed room OR sketch boundary polygon
    if (activeTool === 'floor') {
      if (drawingPoints.length === 0) {
        const enclosed = findEnclosedRoomAtPoint(raw, wallsForFace);
        if (enclosed) {
          const ft = activeFloorType ?? (model.floorTypes ?? [])[0];
          const newFloor: FloorEntity = {
            id: `floor-${Date.now()}`,
            type: 'floor',
            layer: 'A-FLOR',
            levelId: activeLevelId,
            polygon: enclosed.polygon,
            thickness: ft ? ft.thickness : 6,
            floorTypeId: ft?.id ?? 'ft-wood-oak',
            material: ft?.material ?? 'Oak Hardwood',
          };
          onFinishDrawing([newFloor], 'Create Floor Slab');
          onSelectIds([newFloor.id]);
          onLog(
            `FLOOR created from enclosed walls (${formatArea(
              polygonArea(enclosed.polygon),
              model.settings.units
            )}, thickness ${newFloor.thickness}").`,
            'result'
          );
          return;
        }
      }
      if (
        drawingPoints.length >= 3 &&
        dist(snapped, drawingPoints[0]) <= 16 / viewTransform.zoom
      ) {
        const ft = activeFloorType ?? (model.floorTypes ?? [])[0];
        const newFloor: FloorEntity = {
          id: `floor-${Date.now()}`,
          type: 'floor',
          layer: 'A-FLOR',
          levelId: activeLevelId,
          polygon: drawingPoints,
          thickness: ft ? ft.thickness : 6,
          floorTypeId: ft?.id ?? 'ft-wood-oak',
          material: ft?.material ?? 'Oak Hardwood',
        };
        onFinishDrawing([newFloor], 'Sketch Floor Slab');
        onSelectIds([newFloor.id]);
        return;
      }
      onAddDrawingPoint(snapped);
      return;
    }

    // ROOF (RF): Sketch roof footprint polygon (or press Enter / W to auto-generate from walls)
    if (activeTool === 'roof') {
      if (roofTool?.mode !== 'sketch') {
        // PICK WALLS: click toggles a wall; Tab picks the whole connected chain
        const hit = findNearestWall(raw, 18);
        if (!hit) {
          onLog('ROOF: Click a wall to pick it (Tab = whole chain), or switch to Sketch in the options bar.', 'info');
          return;
        }
        const ids = roofTool?.pickedWallIds || [];
        const next = ids.includes(hit.wall.id) ? ids.filter((x) => x !== hit.wall.id) : [...ids, hit.wall.id];
        onRoofToolChange?.({ ...(roofTool as RoofToolState), pickedWallIds: next });
        return;
      }
      if (
        drawingPoints.length >= 3 &&
        dist(snapped, drawingPoints[0]) <= 16 / viewTransform.zoom
      ) {
        onFinishRoof?.();
        return;
      }
      onAddDrawingPoint(snapped);
      return;
    }

    // ---- FACADE & ROOF ADD-ON TOOLS -------------------------------------------------------
    if (activeTool === 'skylight' || activeTool === 'dormer') {
      const ft = facadeTool;
      const hostRoof = roofs.find((r) => {
        const g = getRoofGeometry(r, levelElevById(r.levelId));
        return g.style !== 'flat' && !!faceAt(g, raw);
      });
      if (!hostRoof) {
        onLog(`${activeTool === 'skylight' ? 'SKYLIGHT' : 'DORMER'}: Click on a sloped roof face.`, 'error');
        return;
      }
      const ent: ArchEntity =
        activeTool === 'skylight'
          ? { id: `sky-${Date.now()}`, type: 'skylight', layer: 'A-ROOF', levelId: hostRoof.levelId, roofId: hostRoof.id, position: raw, width: ft?.skylightWidth ?? 24, length: ft?.skylightLength ?? 48 }
          : { id: `dormer-${Date.now()}`, type: 'dormer', layer: 'A-ROOF', levelId: hostRoof.levelId, roofId: hostRoof.id, position: raw, width: ft?.dormerWidth ?? 60, height: ft?.dormerHeight ?? 42 };
      onUpdateModel([...model.entities, ent], activeTool === 'skylight' ? 'Place Skylight' : 'Place Dormer');
      onSelectIds([ent.id]);
      onLog(`Placed ${activeTool} on roof. Adjust size and position in Properties or drag its grip.`, 'result');
      return;
    }
    if (activeTool === 'balcony' || activeTool === 'sweep' || activeTool === 'reveal' || activeTool === 'paint') {
      const hit = findNearestWall(raw, 24);
      if (!hit) {
        onLog('Click on a wall.', 'error');
        return;
      }
      const ft = facadeTool;
      if (activeTool === 'paint') {
        const finish = ft?.finish ?? 'brick';
        onUpdateModel(
          model.entities.map((e) => (e.id === hit.wall.id && e.type === 'wall' ? paintWallBand(e, null, finish) : e)),
          `Paint Wall (${finishDef(finish).label})`
        );
        onLog(`PAINT: applied ${finishDef(finish).label} to the exterior face (top band). Use an elevation to paint individual split bands.`, 'result');
        return;
      }
      const ent: ArchEntity =
        activeTool === 'balcony'
          ? {
              id: `balc-${Date.now()}`,
              type: 'balcony',
              layer: 'A-WALL',
              levelId: hit.wall.levelId,
              wallId: hit.wall.id,
              offset: hit.offset,
              width: ft?.balconyWidth ?? 96,
              depth: ft?.balconyDepth ?? 48,
              elevationOffset: ft?.balconyElevation ?? 108,
              slabThickness: 6,
              railingHeight: 42,
              railingStyle: ft?.railingStyle ?? 'balusters',
            }
          : {
              id: `sweep-${Date.now()}`,
              type: 'sweep',
              layer: 'A-WALL',
              levelId: hit.wall.levelId,
              wallId: hit.wall.id,
              profile: activeTool === 'reveal' ? 'reveal' : ft?.sweepProfile ?? 'band',
              height: ft?.sweepHeight ?? 96,
              size: activeTool === 'reveal' ? 1.5 : ft?.sweepSize ?? 8,
              projection: activeTool === 'reveal' ? -1 : 3,
            };
      onUpdateModel([...model.entities, ent], activeTool === 'balcony' ? 'Add Balcony' : activeTool === 'reveal' ? 'Add Reveal' : 'Add Sweep');
      onSelectIds([ent.id]);
      onLog(
        activeTool === 'balcony'
          ? 'Added balcony. Edit width, depth, height and railing in Properties.'
          : `Added ${activeTool} along the wall's exterior face. See it in an elevation or 3D.`,
        'result'
      );
      return;
    }
    if (activeTool === 'railing' || activeTool === 'curtainwall') {
      onAddDrawingPoint(snapped);
      return;
    }
    if (activeTool === 'splitface') {
      const hit = findNearestWall(raw, 24);
      if (hit) {
        const splitH = Math.max(12, Math.min((hit.wall.height || 108) - 12, facadeTool?.sweepHeight ?? 36));
        const splitWall = splitWallFace(hit.wall, splitH, hit.wall.height || 108);
        const paintedWall = paintWallBand(splitWall, 0, facadeTool?.finish ?? 'stone');
        onUpdateModel(
          model.entities.map((e) => (e.id === hit.wall.id ? paintedWall : e)),
          `Split Wall Face (${formatLength(splitH, model.settings.units)})`
        );
        onSelectIds([hit.wall.id]);
        onLog(
          `SPLIT FACE (SF): Split wall face at ${formatLength(splitH, model.settings.units)} above base. Open Elevations or 3D to inspect or click exact split heights.`,
          'result'
        );
      } else {
        onOpenElevation?.('south');
        onLog('SPLIT FACE (SF): Switched to South Elevation — click any wall face at the height of the split.', 'info');
      }
      return;
    }

    // STAIR (ST): Revit "Stair by Component" — One-Click Templates OR Interactive Multi-Run with Automatic Landing
    if (activeTool === 'stair') {
      if (stairTool.mode === 'template') {
        handlePlaceTemplateStairAt(snapped);
        return;
      }
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const p0 = drawingPoints[0];
        if (dist(p0, snapped) > 10) {
          const createdSoFar = stairTool.draftRuns.reduce((s, r) => s + r.numRisers, 0);
          const remaining = Math.max(2, stairCalc.numRisers - createdSoFar);

          if (stairTool.draftRuns.length === 0) {
            const rawLen = dist(p0, snapped);
            const treads = Math.max(2, Math.min(stairCalc.numRisers - 1, Math.round(rawLen / stairTool.treadDepth)));
            const risersInRun1 = treads + 1;
            const dir = normalize(sub(snapped, p0));

            if (risersInRun1 < stairCalc.numRisers) {
              const endPt = add(p0, scale(dir, treads * stairTool.treadDepth));
              const run1 = {
                id: 'run-1',
                start: p0,
                end: endPt,
                width: stairTool.width,
                numRisers: risersInRun1,
                treadDepth: stairTool.treadDepth,
                startRiserIndex: 1,
                baseElevationOffset: 0,
                topElevationOffset: risersInRun1 * stairCalc.riserHeight,
              };
              setStairTool((prev) => ({ ...prev, draftRuns: [run1], draftLandings: [] }));
              onFinishDrawing([], '');
              onLog(
                `STAIR Run 1: ${risersInRun1} risers created, ${stairCalc.numRisers - risersInRun1} remaining. Click start and end of Run 2 in any direction (straight, 90° L, or 180° U) to auto-generate the landing, or click Finish Stair.`,
                'info'
              );
            } else {
              const finalEnd = add(p0, scale(dir, (stairCalc.numRisers - 1) * stairTool.treadDepth));
              const run1 = {
                id: 'run-1',
                start: p0,
                end: finalEnd,
                width: stairTool.width,
                numRisers: stairCalc.numRisers,
                treadDepth: stairTool.treadDepth,
                startRiserIndex: 1,
                baseElevationOffset: 0,
                topElevationOffset: stairCalc.totalRise,
              };
              handleFinishInteractiveStair([run1], []);
            }
          } else {
            const prevRun = stairTool.draftRuns[stairTool.draftRuns.length - 1];
            const { run2, landing } = snapSecondRunWithAutoLanding(
              prevRun,
              p0,
              snapped,
              remaining,
              stairCalc.riserHeight,
              {
                depth: stairTool.landingDepth,
                wellGap: stairTool.wellGap,
                structure: stairTool.landingStructure,
              }
            );
            const nextRun = { ...run2, id: `run-${stairTool.draftRuns.length + 1}` };
            const nextLanding = {
              ...landing,
              id: `landing-${stairTool.draftLandings.length + 1}`,
              afterRunIndex: stairTool.draftRuns.length - 1,
            };
            const nextRuns = [...stairTool.draftRuns, nextRun];
            const nextLandings = [...stairTool.draftLandings, nextLanding];
            const totalCreatedNow = createdSoFar + nextRun.numRisers;

            if (totalCreatedNow >= stairCalc.numRisers || nextRuns.length >= 3) {
              handleFinishInteractiveStair(nextRuns, nextLandings);
            } else {
              setStairTool((prev) => ({
                ...prev,
                draftRuns: nextRuns,
                draftLandings: nextLandings,
              }));
              onFinishDrawing([], '');
              onLog(
                `STAIR Run ${nextRuns.length} + Automatic Landing created (${totalCreatedNow} risers created, ${
                  stairCalc.numRisers - totalCreatedNow
                } remaining). Draw Run 3 or click Finish Stair.`,
                'info'
              );
            }
          }
        }
      }
      return;
    }

    // COLUMN (CL): Place column (snaps to Grid intersections automatically)
    if (activeTool === 'column') {
      const ct = activeColumnType ?? (model.columnTypes ?? [])[0];
      const newCol: ColumnEntity = {
        id: `col-${Date.now()}`,
        type: 'column',
        layer: 'S-COLS',
        levelId: activeLevelId,
        position: snapped,
        width: ct?.width ?? 12,
        depth: ct?.depth ?? 12,
        height: 108,
        rotation: columnRotation,
        shape: ct?.shape ?? 'rectangular',
        columnTypeId: ct?.id ?? 'ct-conc-12',
      };
      onUpdateModel([...model.entities, newCol], 'Place Structural Column');
      onSelectIds([newCol.id]);
      const hitGrid = gridIntersections.find((gi) => dist(gi.point, snapped) < 1);
      onLog(
        hitGrid
          ? `Placed Column (${ct?.name ?? '12"×12"'}) snapped to Grid Intersection ${hitGrid.label}.`
          : `Placed Column (${ct?.name ?? '12"×12"'}) at (${formatLength(
              snapped.x,
              model.settings.units
            )}, ${formatLength(snapped.y, model.settings.units)}).`,
        'result'
      );
      return;
    }

    // GRID (GR): Draw structural grid line with auto-incremented bubble label
    if (activeTool === 'grid') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const p0 = drawingPoints[0];
        if (dist(p0, snapped) > 12) {
          const isVertical =
            Math.abs(snapped.y - p0.y) >= Math.abs(snapped.x - p0.x);
          const existingGrids = model.entities.filter(
            (ent): ent is GridEntity => ent.type === 'grid'
          );
          let nextLabel = '1';
          if (isVertical) {
            const numCount =
              existingGrids.filter((g) => /^\d+$/.test(g.label)).length + 1;
            nextLabel = String(numCount);
          } else {
            const alphaCount = existingGrids.filter((g) =>
              /^[A-Za-z]+$/.test(g.label)
            ).length;
            nextLabel = String.fromCharCode(65 + (alphaCount % 26));
          }
          const newGrid: GridEntity = {
            id: `grid-${Date.now()}`,
            type: 'grid',
            layer: 'S-GRID',
            start: p0,
            end: snapped,
            label: nextLabel,
          };
          onFinishDrawing([newGrid], `Draw Grid Line ${nextLabel}`);
          onSelectIds([newGrid.id]);
          onLog(
            `Placed Structural Grid Line "${nextLabel}". Draw another or press Esc.`,
            'result'
          );
        }
      }
      return;
    }

    if (activeTool === 'rectangle') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const p1 = drawingPoints[0];
        if (Math.abs(snapped.x - p1.x) > 1 && Math.abs(snapped.y - p1.y) > 1) {
          onFinishDrawing(
            [
              {
                id: `rect-${Date.now()}`,
                type: 'rectangle',
                layer: model.activeLayer,
                levelId: activeLevelId,
                p1,
                p2: snapped,
              },
            ],
            'Draw Rectangle'
          );
        }
      }
      return;
    }

    if (activeTool === 'circle') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const center = drawingPoints[0];
        const radius = dist(center, snapped);
        if (radius > 1) {
          onFinishDrawing(
            [
              {
                id: `circle-${Date.now()}`,
                type: 'circle',
                layer: model.activeLayer,
                levelId: activeLevelId,
                center,
                radius,
              },
            ],
            'Draw Circle'
          );
        }
      }
      return;
    }

    if (activeTool === 'arc') {
      if (drawingPoints.length < 2) {
        onAddDrawingPoint(snapped);
      } else {
        const arcData = circleFromThreePoints(
          drawingPoints[0],
          drawingPoints[1],
          snapped
        );
        if (arcData) {
          onFinishDrawing(
            [
              {
                id: `arc-${Date.now()}`,
                type: 'arc',
                layer: model.activeLayer,
                levelId: activeLevelId,
                ...arcData,
              },
            ],
            'Draw Arc'
          );
        } else {
          onLog('Arc points are collinear — please pick 3 non-collinear points.', 'error');
        }
      }
      return;
    }

    // CAMERA (CAM): 1 position · 2 direction (+ target distance) · 3 field of view
    if (activeTool === 'camera') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
        setCamFovOverride(null);
        return;
      }
      if (drawingPoints.length === 1) {
        if (dist(drawingPoints[0], snapped) < 12) {
          onLog('CAMERA: aim a little further from the camera (at least 1\').', 'error');
          return;
        }
        onAddDrawingPoint(snapped);
        return;
      }
      const fov = camFovOverride?.fov ?? fovFromCursor(drawingPoints[0], drawingPoints[1], raw);
      setCamFovOverride(null);
      onPlaceCamera?.(drawingPoints[0], drawingPoints[1], fov);
      return;
    }

    // WALL JOIN (WJ): click a corner to cycle Miter → Butt → Square off → Disallow join
    // (Shift+click on a Butt / Square-off corner swaps which wall runs through)
    if (activeTool === 'walljoin') {
      const ends = wallEndsNear(raw, walls, 18 / viewTransform.zoom + 6);
      if (!ends.length) {
        onLog('WALL JOIN (WJ): click near a wall corner or junction.', 'error');
        return;
      }
      const cur = joinStateIndex(walls, ends);
      if (ends.length === 1) {
        // T-junction / free end: only Allow ↔ Disallow
        const next = cur === 3 ? { style: 'miter' as const } : { disallow: true };
        onUpdateModel(setCornerJoin(model.entities, ends, next), next.disallow ? 'Disallow Wall Join' : 'Allow Wall Join');
        onLog(`WALL JOIN: ${next.disallow ? 'Disallow join (separate seam)' : 'Join allowed (clean T)'}.`, 'result');
        return;
      }
      if (e.shiftKey && (cur === 1 || cur === 2)) {
        const prim = ends.find((x) => !walls.find((w) => w.id === x.wallId)?.joins?.[x.end]?.primary) || ends[0];
        onUpdateModel(setCornerJoin(model.entities, ends, JOIN_CYCLE[cur], prim.wallId), 'Swap Wall Join');
        onLog('WALL JOIN: swapped which wall runs through.', 'result');
        return;
      }
      const nextIdx = (cur + 1) % JOIN_CYCLE.length;
      onUpdateModel(setCornerJoin(model.entities, ends, JOIN_CYCLE[nextIdx]), `Wall Join: ${JOIN_CYCLE[nextIdx].label}`);
      onLog(`WALL JOIN: ${JOIN_CYCLE[nextIdx].label}. Click again to cycle${nextIdx === 1 || nextIdx === 2 ? ' · Shift+click swaps the through wall' : ''}.`, 'result');
      return;
    }

    // DOOR (DR) / WINDOW (WN) / WALL OPENING (WO): place the previewed opening; stay in the tool
    if (isOpeningTool(activeTool)) {
      const pl = computeOpeningPlacement(model, entities, activeTool, openingTool, raw, viewTransform.zoom, activeLevelId);
      if (!pl) {
        onLog(`${activeTool === 'door' ? 'DOOR' : activeTool === 'window' ? 'WINDOW' : 'WALL OPENING'}: hover a wall — openings are hosted by walls.`, 'error');
        return;
      }
      placeOpeningAt(pl.wall.id, pl.s, pl.cursorSide);
      return;
    }

    if (activeTool === 'dimension' || activeTool === 'dli') {
      const resolvePt = (pt: Point) => {
        if (detectedWallFace) {
          const faces = computeWallFaces(detectedWallFace.wall);
          const seg = faces[detectedWallFace.face];
          const proj = projectPointOnSegment(pt, seg.start, seg.end);
          return {
            point: proj.point,
            assoc: {
              entityId: detectedWallFace.wall.id,
              face: detectedWallFace.face,
              offsetParam: proj.t,
            },
          };
        }
        return { point: pt, assoc: null };
      };

      if (drawingPoints.length === 0) {
        const r1 = resolvePt(snapped);
        setDimAssoc1(r1.assoc);
        onAddDrawingPoint(r1.point);
      } else if (drawingPoints.length === 1) {
        const r2 = resolvePt(snapped);
        setDimAssoc2(r2.assoc);
        onAddDrawingPoint(r2.point);
      } else {
        const p1 = drawingPoints[0];
        const p2 = drawingPoints[1];
        const association =
          dimAssoc1 || dimAssoc2
            ? {
                entityId1: dimAssoc1?.entityId,
                ref1: dimAssoc1?.face,
                offsetParam1: dimAssoc1?.offsetParam,
                entityId2: dimAssoc2?.entityId,
                ref2: dimAssoc2?.face,
                offsetParam2: dimAssoc2?.offsetParam,
              }
            : undefined;

        if (activeTool === 'dli') {
          const lin = computeLinearDimGeometry(p1, p2, raw);
          onFinishDrawing(
            [
              {
                id: `dim-${Date.now()}`,
                type: 'dimension',
                dimType: 'linear',
                linearOrientation: lin.orientation,
                layer: 'A-ANNO',
                levelId: activeLevelId,
                p1,
                p2,
                offset: Math.abs(lin.offset) < 12 ? -24 : lin.offset,
                association,
              },
            ],
            'Place Linear Dimension'
          );
        } else {
          const dir = normalize(sub(p2, p1));
          const norm = perpLeft(dir);
          const offset =
            (raw.x - midpoint(p1, p2).x) * norm.x +
            (raw.y - midpoint(p1, p2).y) * norm.y;
          onFinishDrawing(
            [
              {
                id: `dim-${Date.now()}`,
                type: 'dimension',
                dimType: 'aligned',
                layer: 'A-ANNO',
                levelId: activeLevelId,
                p1,
                p2,
                offset: Math.abs(offset) < 12 ? -24 : offset,
                association,
              },
            ],
            'Place Aligned Dimension'
          );
        }
      }
      return;
    }

    if (activeTool === 'dan') {
      if (drawingPoints.length < 3) {
        onAddDrawingPoint(snapped);
      } else {
        const center = drawingPoints[0];
        const p1 = drawingPoints[1];
        const p2 = drawingPoints[2];
        const angGeo = computeAngularDimGeometry(center, p1, p2, raw);
        onFinishDrawing(
          [
            {
              id: `dim-ang-${Date.now()}`,
              type: 'dimension',
              dimType: 'angular',
              layer: 'A-ANNO',
              levelId: activeLevelId,
              p1,
              p2,
              center,
              startAngle: angGeo.startAngle,
              endAngle: angGeo.endAngle,
              sweepAngle: angGeo.sweepAngle,
              radius: angGeo.radius,
              offset: angGeo.radius,
            },
          ],
          'Place Angular Dimension'
        );
      }
      return;
    }

    if (activeTool === 'dra' || activeTool === 'ddi') {
      if (!radialTarget) {
        const hit = entities.find(
          (ent): ent is CircleEntity | ArcEntity =>
            (ent.type === 'circle' || ent.type === 'arc') &&
            Math.abs(dist(raw, ent.center) - ent.radius) <= 28
        );
        if (hit) {
          setRadialTarget(hit);
          onAddDrawingPoint(hit.center);
          onLog(
            `${activeTool.toUpperCase()}: Selected ${hit.type}. Click to position dimension label.`,
            'info'
          );
        } else {
          onLog(
            `${activeTool.toUpperCase()}: Click directly on the edge of a Circle or Arc.`,
            'error'
          );
        }
      } else {
        const dimType = activeTool === 'dra' ? 'radius' : 'diameter';
        onFinishDrawing(
          [
            {
              id: `dim-${dimType}-${Date.now()}`,
              type: 'dimension',
              dimType,
              layer: 'A-ANNO',
              levelId: activeLevelId,
              center: radialTarget.center,
              radius: radialTarget.radius,
              p1: radialTarget.center,
              p2: raw,
              offset: 0,
            },
          ],
          `Place ${dimType === 'radius' ? 'Radius' : 'Diameter'} Dimension`
        );
        setRadialTarget(null);
      }
      return;
    }

    if (activeTool === 'dco' || activeTool === 'dba') {
      const dims = entities.filter(
        (ent): ent is DimensionEntity =>
          ent.type === 'dimension' &&
          (!ent.dimType || ent.dimType === 'aligned' || ent.dimType === 'linear')
      );
      const refDim =
        dims.find((d) => selectedIds.includes(d.id)) ?? dims[dims.length - 1];
      if (!refDim) {
        onLog(
          'Place an Aligned (DAL) or Linear (DLI) dimension first before running Continue (DCO) or Baseline (DBA).',
          'error'
        );
        return;
      }

      let pt = snapped;
      let assoc2: { entityId: string; face: WallFace; offsetParam: number } | undefined;
      if (detectedWallFace) {
        const faces = computeWallFaces(detectedWallFace.wall);
        const seg = faces[detectedWallFace.face];
        const proj = projectPointOnSegment(snapped, seg.start, seg.end);
        pt = proj.point;
        assoc2 = {
          entityId: detectedWallFace.wall.id,
          face: detectedWallFace.face,
          offsetParam: proj.t,
        };
      }

      if (activeTool === 'dco') {
        const newDim: DimensionEntity = {
          id: `dim-dco-${Date.now()}`,
          type: 'dimension',
          dimType: refDim.dimType ?? 'aligned',
          linearOrientation: refDim.linearOrientation,
          layer: 'A-ANNO',
          levelId: activeLevelId,
          p1: refDim.p2,
          p2: pt,
          offset: refDim.offset,
          association: {
            entityId1: refDim.association?.entityId2,
            ref1: refDim.association?.ref2,
            offsetParam1: refDim.association?.offsetParam2,
            entityId2: assoc2?.entityId,
            ref2: assoc2?.face,
            offsetParam2: assoc2?.offsetParam,
          },
        };
        onUpdateModel([...model.entities, newDim], 'Continue Dimension');
        onLog('Chained dimension placed. Click next point or press Esc to finish.', 'info');
      } else {
        const spacing = model.settings.dimStyle?.baselineSpacing ?? 18;
        const sign = refDim.offset >= 0 ? 1 : -1;
        const newDim: DimensionEntity = {
          id: `dim-dba-${Date.now()}`,
          type: 'dimension',
          dimType: refDim.dimType ?? 'aligned',
          linearOrientation: refDim.linearOrientation,
          layer: 'A-ANNO',
          levelId: activeLevelId,
          p1: refDim.p1,
          p2: pt,
          offset: refDim.offset + sign * spacing,
          association: {
            entityId1: refDim.association?.entityId1,
            ref1: refDim.association?.ref1,
            offsetParam1: refDim.association?.offsetParam1,
            entityId2: assoc2?.entityId,
            ref2: assoc2?.face,
            offsetParam2: assoc2?.offsetParam,
          },
        };
        onUpdateModel([...model.entities, newDim], 'Baseline Dimension');
        onLog('Stacked baseline dimension placed. Click next point or press Esc to finish.', 'info');
      }
      return;
    }

    if (activeTool === 'leader') {
      if (drawingPoints.length < 2) {
        onAddDrawingPoint(snapped);
      } else {
        const arrowPoint = drawingPoints[0];
        const kneePoint = drawingPoints[1];
        const landingPoint: Point = {
          x: snapped.x,
          y: kneePoint.y,
        };
        const newLeader: LeaderEntity = {
          id: `leader-${Date.now()}`,
          type: 'leader',
          layer: 'A-ANNO',
          levelId: activeLevelId,
          arrowPoint,
          kneePoint,
          landingPoint,
          text: 'DETAIL NOTE',
          fontSize: model.settings.dimStyle?.textHeight ?? 8,
        };
        onFinishDrawing([newLeader], 'Place Leader Note');
        onSelectIds([newLeader.id]);
        onLog(
          'LEADER placed. Edit note text in the Properties panel on the right.',
          'result'
        );
      }
      return;
    }

    if (activeTool === 'hatch') {
      // 1. Check if inside an existing room, rectangle, or closed polyline
      let hatchPoly: Point[] | null = null;
      for (const ent of entities) {
        if (ent.type === 'room' && isPointInPolygon(raw, ent.polygon)) {
          hatchPoly = ent.polygon;
          break;
        }
        if (ent.type === 'rectangle') {
          const minX = Math.min(ent.p1.x, ent.p2.x);
          const maxX = Math.max(ent.p1.x, ent.p2.x);
          const minY = Math.min(ent.p1.y, ent.p2.y);
          const maxY = Math.max(ent.p1.y, ent.p2.y);
          if (raw.x >= minX && raw.x <= maxX && raw.y >= minY && raw.y <= maxY) {
            hatchPoly = [
              { x: minX, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x: minX, y: maxY },
            ];
            break;
          }
        }
        if (ent.type === 'polyline' && ent.closed && isPointInPolygon(raw, ent.points)) {
          hatchPoly = ent.points;
          break;
        }
      }
      // 2. Or check enclosed walls at click point
      if (!hatchPoly) {
        const enclosed = findEnclosedRoomAtPoint(raw, wallsForFace);
        if (enclosed) {
          hatchPoly = enclosed.polygon;
        }
      }
      if (hatchPoly) {
        const newHatch: HatchEntity = {
          id: `hatch-${Date.now()}`,
          type: 'hatch',
          layer: 'A-AREA',
          levelId: activeLevelId,
          polygon: hatchPoly,
          pattern: 'diagonal',
          scale: 1,
          angle: 0,
        };
        onFinishDrawing([newHatch], 'Place Hatch Pattern');
        onSelectIds([newHatch.id]);
        onLog(
          'HATCH created. Choose pattern (Solid, Diagonal, Crosshatch, Brick, Concrete, Insulation), scale, and angle in Properties.',
          'result'
        );
      } else {
        onLog(
          'HATCH: Click inside a closed Room, Rectangle, Closed Polyline, or area enclosed by walls.',
          'error'
        );
      }
      return;
    }

    if (activeTool === 'tag') {
      // Find door, window, or room near click point
      let hitTarget: ArchEntity | null = null;
      for (const ent of entities) {
        if (ent.type === 'door' || ent.type === 'window') {
          const host = wallsForFace.find((w) => w.id === ent.wallId);
          if (host) {
            const c = lerpPoint(host.start, host.end, ent.offset);
            if (dist(raw, c) <= 32) {
              hitTarget = ent;
              break;
            }
          }
        } else if (ent.type === 'room' && isPointInPolygon(raw, ent.polygon)) {
          hitTarget = ent;
        }
      }

      if (hitTarget) {
        if (hitTarget.type === 'door' || hitTarget.type === 'window') {
          const host = wallsForFace.find((w) => w.id === hitTarget!.wallId);
          if (host) {
            const isDoor = hitTarget.type === 'door';
            const prefix = isDoor ? 'D' : 'W';
            const count =
              model.entities.filter(
                (e) => e.type === 'tag' && e.targetType === hitTarget!.type
              ).length + 1;
            const c = lerpPoint(host.start, host.end, hitTarget.offset);
            const dir = normalize(sub(host.end, host.start));
            const norm = perpLeft(dir);
            const pos = add(c, scale(norm, host.thickness / 2 + 16));
            const newTag: TagEntity = {
              id: `tag-${Date.now()}`,
              type: 'tag',
              layer: 'A-ANNO',
              levelId: activeLevelId,
              targetId: hitTarget.id,
              targetType: hitTarget.type,
              position: pos,
              tagNumber: `${prefix}${count}`,
              label: `${hitTarget.width}" × ${hitTarget.height}"`,
              shape: isDoor ? 'pill' : 'hexagon',
            };
            onFinishDrawing([newTag], `Tag ${isDoor ? 'Door' : 'Window'} (${prefix}${count})`);
            onSelectIds([newTag.id]);
            onLog(`Placed ${isDoor ? 'Door' : 'Window'} Tag ${prefix}${count}.`, 'result');
          }
        } else if (hitTarget.type === 'room') {
          const count =
            model.entities.filter((e) => e.type === 'tag' && e.targetType === 'room').length +
            101;
          const areaStr = formatArea(polygonArea(hitTarget.polygon), model.settings.units);
          const newTag: TagEntity = {
            id: `tag-${Date.now()}`,
            type: 'tag',
            layer: 'A-ANNO',
            levelId: activeLevelId,
            targetId: hitTarget.id,
            targetType: 'room',
            position: { x: hitTarget.labelPos.x, y: hitTarget.labelPos.y + 30 },
            tagNumber: `${count}`,
            label: `${hitTarget.name} (${areaStr})`,
            shape: 'rectangle',
          };
          onFinishDrawing([newTag], `Tag Room (${hitTarget.name})`);
          onSelectIds([newTag.id]);
          onLog(`Placed Room Tag ${count}: ${hitTarget.name} — ${areaStr}.`, 'result');
        }
      } else {
        onLog('TAG: Click on a Door, Window, or inside a Room to tag it.', 'error');
      }
      return;
    }

    if (activeTool === 'dist') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const p1 = drawingPoints[0];
        const d = dist(p1, snapped);
        const dx = Math.abs(snapped.x - p1.x);
        const dy = Math.abs(snapped.y - p1.y);
        const ang = angleDegCad(p1, snapped);
        onLog(
          `DIST = ${formatLength(d, model.settings.units)} | ΔX = ${formatLength(
            dx,
            model.settings.units
          )}, ΔY = ${formatLength(dy, model.settings.units)} | Angle = ${ang.toFixed(1)}°`,
          'result'
        );
        onFinishDrawing([], 'Measure Distance');
      }
      return;
    }

    if (activeTool === 'text') {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      }
      return;
    }

    if (
      (activeTool === 'move' || activeTool === 'copy' || activeTool === 'rotate') &&
      selectedIds.length > 0
    ) {
      if (drawingPoints.length === 0) {
        onAddDrawingPoint(snapped);
      } else {
        const base = drawingPoints[0];
        const delta = sub(snapped, base);
        if (activeTool === 'move') {
          // hosted openings moved on their own slide along their wall (or re-host onto the wall under them)
          const moved = syncHostedBimEntities(moveSelectionHosted(model.entities, selectedIds, delta, moveEntity));
          onUpdateModel(moved, 'Move Selection');
          onFinishDrawing([], 'Move Selection');
        } else if (activeTool === 'copy') {
          // copies stay hosted: openings copy along their wall, copied walls bring their openings
          const stamp = Date.now();
          const copies = copySelectionHosted(model.entities, selectedIds, delta, moveEntity, (ent, idx) => `${ent.type}-${stamp}-${idx}`);
          onUpdateModel(syncHostedBimEntities([...model.entities, ...copies]), 'Copy Selection');
          onLog(`Copied ${copies.length} object(s). Click another point or press Enter to finish.`, 'info');
        } else if (activeTool === 'rotate') {
          const ang = angleDegCad(base, snapped);
          const rotated = syncHostedBimEntities(
            model.entities.map((ent) =>
              selectedIds.includes(ent.id) ? rotateEntity(ent, base, ang) : ent
            )
          );
          onUpdateModel(rotated, `Rotate Selection (${ang.toFixed(1)}°)`);
          onFinishDrawing([], 'Rotate Selection');
        }
      }
      return;
    }

    if (activeTool === 'insert' && activeInsertBlock) {
      const newBlockInst: BlockInstanceEntity = {
        id: `block-${Date.now()}`,
        type: 'block',
        layer: 'A-FURN',
        levelId: activeLevelId,
        blockId: activeInsertBlock.id,
        name: activeInsertBlock.name,
        position: snapped,
        rotation: insertRotation,
        scale: insertScale,
        width: activeInsertBlock.width,
        depth: activeInsertBlock.depth,
        height: activeInsertBlock.height,
        color: activeInsertBlock.color,
      };
      onUpdateModel(
        [...model.entities, newBlockInst],
        `Insert ${activeInsertBlock.name}`
      );
      onSelectIds([newBlockInst.id]);
      onLog(
        `Placed "${activeInsertBlock.name}" at (${formatLength(
          snapped.x,
          model.settings.units
        )}, ${formatLength(
          snapped.y,
          model.settings.units
        )}) [Rot=${insertRotation}°, Scale=${insertScale}]. Click again to place another or press Esc.`,
        'result'
      );
      return;
    }

    if (activeTool === 'block' && selectedIds.length > 0) {
      onAddDrawingPoint(snapped);
      return;
    }

    // Handle modify tools background point clicking (mirror axis, stretch box, scale base, etc.)
    if (
      ((activeTool === 'mirror' || activeTool === 'scale' || activeTool === 'array') &&
        selectedIds.length > 0) ||
      (activeTool === 'offset' && (modifySubStep ?? 0) >= 2) ||
      ((activeTool === 'break' || activeTool === 'align') &&
        ((modifySubStep ?? 0) >= 1 || Boolean(pickedEntityId))) ||
      activeTool === 'stretch' ||
      activeTool === 'area'
    ) {
      onAddDrawingPoint(snapped);
      return;
    }

    // Start box selection if clicking empty canvas in select mode
    if (activeTool === 'select') {
      if (!e.shiftKey) {
        onSelectIds([]);
      }
      setBoxSelectStart(raw);
      setBoxSelectEnd(raw);
    }

    if (activeTool === 'trim' || activeTool === 'extend') {
      fencePointerDownRef.current = true;
      fenceStartPtRef.current = raw;
      setFencePath([raw]);
      setIsFenceDragging(false);
      return;
    }
  };

  // CAMERA placement draft (wedge follows the cursor) and the camera shown in the live preview window
  const cameraDraft = useMemo(() => {
    if (activeTool !== 'camera' || drawingPoints.length === 0) return null;
    const position = drawingPoints[0];
    if (drawingPoints.length === 1) {
      const target = dist(position, cursorWorld) < 1 ? { x: position.x, y: position.y - 120 } : cursorWorld;
      return { position, target, fov: cameraFov, stage: 1 as const, cursor: rawCursorWorld };
    }
    const target = drawingPoints[1];
    const fov = camFovOverride?.fov ?? fovFromCursor(position, target, rawCursorWorld);
    return { position, target, fov, stage: 2 as const, cursor: rawCursorWorld };
  }, [activeTool, drawingPoints, cursorWorld, rawCursorWorld, cameraFov, camFovOverride]);
  const previewCamera: CameraEntity | null = useMemo(() => {
    if (cameraDraft) {
      return makeCamera({
        id: 'camera-draft',
        name: nextCameraName(model.entities),
        levelId: activeLevelId,
        position: cameraDraft.position,
        target: cameraDraft.target,
        fov: cameraDraft.fov,
        baseZ: groundElevationAt(model, cameraDraft.position, activeLevelId),
      });
    }
    if (activeTool === 'select' && selectedIds.length === 1) {
      const ent = entities.find((e) => e.id === selectedIds[0]);
      if (ent && ent.type === 'camera') return ent;
    }
    return null;
  }, [cameraDraft, activeTool, selectedIds, entities, model, activeLevelId]);
  useEffect(() => {
    setCameraPreviewHidden(false);
  }, [previewCamera?.id]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      onChangeViewTransform((prev) => ({
        ...prev,
        panX: panStartRef.current.panX + dx,
        panY: panStartRef.current.panY + dy,
      }));
      return;
    }

    const raw = screenToWorld(e.clientX, e.clientY);
    setRawCursorWorld(raw);
    if (camFovOverride && dist(raw, camFovOverride.at) > 6 / viewTransform.zoom) setCamFovOverride(null);

    if (fencePointerDownRef.current) {
      if (fenceStartPtRef.current && dist(raw, fenceStartPtRef.current) > 6 / viewTransform.zoom) {
        setIsFenceDragging(true);
      }
      setFencePath((prev) => {
        const last = prev[prev.length - 1];
        if (!last || dist(last, raw) > 4 / viewTransform.zoom) {
          return [...prev, raw];
        }
        return prev;
      });
    }

    // Shift = lock onto the current guide; Alt = guides off while held
    modifierRef.current.alt = e.altKey;
    if (e.shiftKey) {
      if (!guideLockRef.current && lastInferenceRef.current?.guides.length) {
        guideLockRef.current = lastInferenceRef.current.guides[0];
      }
    } else {
      guideLockRef.current = null;
    }
    const { snapped, osnap, polar, inference } = computeSnappedPoint(raw);
    setCursorWorld(snapped);
    setActiveOsnap(osnap);
    setActivePolarSnap(polar);
    setActiveInference(inference);
    lastInferenceRef.current = inference;
    onCursorMove(snapped, osnap);

    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setScreenCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    // Live update dynamic input values if user is not actively typing in them
    if (drawingPoints.length > 0 && dynEditingField === null) {
      const ref = drawingPoints[drawingPoints.length - 1];
      const d = dist(ref, snapped);
      const ang = angleDegCad(ref, snapped);
      setDynLength(formatLength(d, model.settings.units));
      setDynAngle(ang.toFixed(1));
    }

    if (draggingGrip) {
      const updated = syncHostedBimEntities(
        model.entities.map((ent) =>
          ent.id === draggingGrip.entityId
            ? applyGripMove(ent, draggingGrip.gripIndex, snapped, model.entities)
            : ent
        )
      );
      setPreviewEntities(updated);
      return;
    }

    if (boxSelectStart) {
      setBoxSelectEnd(raw);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (fencePointerDownRef.current) {
      fencePointerDownRef.current = false;
      const raw = screenToWorld(e.clientX, e.clientY);
      fenceStartPtRef.current = null;

      if (isFenceDragging && fencePath.length >= 2) {
        onFenceComplete?.(fencePath, e.shiftKey || shiftPressed);
        setFencePath([]);
        setIsFenceDragging(false);
        setTwoPointFenceStart(null);
        return;
      }

      setFencePath([]);
      setIsFenceDragging(false);

      if (twoPointFenceStart === null) {
        setTwoPointFenceStart(raw);
        onLog('Fence: Click second point across objects to trim/extend (or drag freehand):', 'info');
      } else {
        onFenceComplete?.([twoPointFenceStart, raw], e.shiftKey || shiftPressed);
        setTwoPointFenceStart(null);
      }
      return;
    }

    if (draggingGrip && previewEntities) {
      onUpdateModel(previewEntities, 'Edit Grip');
      setDraggingGrip(null);
      setPreviewEntities(null);
      return;
    }

    if (boxSelectStart && boxSelectEnd) {
      if (dist(boxSelectStart, boxSelectEnd) > 4 / viewTransform.zoom) {
        const lockedLayers = new Set(
          model.layers.filter((l) => l.locked || !l.visible).map((l) => l.id)
        );
        const matched = entities
          .filter(
            (ent) =>
              !lockedLayers.has(ent.layer) &&
              isEntityInSelectionBox(
                ent,
                entities,
                boxSelectStart,
                boxSelectEnd
              )
          )
          .map((ent) => ent.id);

        if (e.shiftKey) {
          onSelectIds(Array.from(new Set([...selectedIds, ...matched])));
        } else {
          onSelectIds(matched);
        }
      }
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
    }
  };

  const handleEntityClick = (e: React.MouseEvent, entity: ArchEntity) => {
    const layerObj = model.layers.find((l) => l.id === entity.layer);
    if (layerObj?.locked) {
      onLog(`Layer "${layerObj.name}" is locked.`, 'info');
      return;
    }

    if (activeTool === 'erase') {
      e.stopPropagation();
      if (onRequestDelete) {
        onRequestDelete([entity.id], `Erase ${entity.type}`);
        return;
      }
      const next = syncHostedBimEntities(
        model.entities.filter((el) => el.id !== entity.id)
      );
      onUpdateModel(next, `Erase ${entity.type}`);
      return;
    }

    if (
      onModifyEntityClick &&
      [
        'offset',
        'trim',
        'extend',
        'corner',
        'fillet',
        'chamfer',
        'break',
        'align',
        'explode',
        'join',
        'matchprop',
        'area',
      ].includes(activeTool)
    ) {
      e.stopPropagation();
      onModifyEntityClick(entity, cursorWorld);
      return;
    }

    if (
      (activeTool === 'mirror' || activeTool === 'scale' || activeTool === 'array') &&
      selectedIds.length === 0
    ) {
      e.stopPropagation();
      onSelectIds([entity.id]);
      return;
    }

    if (activeTool === 'bedit') {
      e.stopPropagation();
      if (entity.type === 'block') {
        onOpenBlockEditor?.(entity.blockId);
      } else {
        onOpenBlockEditor?.();
      }
      return;
    }

    if (
      activeTool === 'select' ||
      (activeTool === 'block' && drawingPoints.length === 0) ||
      ((activeTool === 'move' ||
        activeTool === 'copy' ||
        activeTool === 'rotate') &&
        selectedIds.length === 0)
    ) {
      e.stopPropagation();
      if (e.shiftKey || activeTool === 'block') {
        if (selectedIds.includes(entity.id)) {
          onSelectIds(selectedIds.filter((id) => id !== entity.id));
        } else {
          onSelectIds([...selectedIds, entity.id]);
        }
      } else {
        onSelectIds([entity.id]);
      }
    }
  };

  const handleEntityClickRef = useRef(handleEntityClick);
  handleEntityClickRef.current = handleEntityClick;

  const handleEntityClickStable = useCallback(
    (e: React.MouseEvent, entity: ArchEntity) => {
      setContextMenu(null);
      handleEntityClickRef.current(e, entity);
    },
    []
  );

  const handleEntityContextMenu = (e: React.MouseEvent, entity: ArchEntity) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!selectedIdsSet.has(entity.id)) {
      onSelectIds([entity.id]);
    }
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleEntityContextMenuRef = useRef(handleEntityContextMenu);
  handleEntityContextMenuRef.current = handleEntityContextMenu;

  const handleEntityContextMenuStable = useCallback(
    (e: React.MouseEvent, entity: ArchEntity) => {
      handleEntityContextMenuRef.current(e, entity);
    },
    []
  );

  const handleSvgContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const walls = useMemo(
    () => entities.filter((e): e is WallEntity => e.type === 'wall'),
    [entities]
  );
  const levelElevById = useCallback(
    (id?: string) => (model.levels || []).find((l) => l.id === (id || 'level-1'))?.elevation ?? 0,
    [model.levels]
  );
  // ROOF pick mode: Tab picks the whole connected chain of the wall under the cursor
  useEffect(() => {
    if (activeTool !== 'roof' || roofTool?.mode === 'sketch') return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const hit = findNearestWall(cursorWorld, 36);
      if (!hit || !roofTool) return;
      const chain = connectedWallChain(walls, hit.wall.id).map((w) => w.id);
      onRoofToolChange?.({ ...roofTool, pickedWallIds: Array.from(new Set([...roofTool.pickedWallIds, ...chain])) });
      onLog(`ROOF: picked a chain of ${chain.length} connected walls. Press Enter (or Finish) to create the roof.`, 'info');
    };
    window.addEventListener('keydown', onTab);
    return () => window.removeEventListener('keydown', onTab);
  }, [activeTool, roofTool, walls, cursorWorld, findNearestWall, onRoofToolChange, onLog]);
  const roofFacadeEntities = useMemo(
    () => entities.filter((e) => e.type === 'roof' || e.type === 'skylight' || e.type === 'dormer' || e.type === 'balcony' || e.type === 'railing'),
    [entities]
  );
  const doors = useMemo(
    () => entities.filter((e): e is DoorEntity => e.type === 'door'),
    [entities]
  );
  const windows = useMemo(
    () => entities.filter((e): e is WindowEntity => e.type === 'window'),
    [entities]
  );
  const hostedOpenings = useMemo(() => entities.filter(isHostedOpening), [entities]);
  // joined wall pieces, star hubs and merged outlines (one contour per join group)
  const { wallPieces, wallHubs, wallOutlines } = useMemo(() => {
    const pieces = new Map<string, Point[][]>();
    for (const w of walls) pieces.set(w.id, computeWallPlanPolygons(w, walls, hostedOpenings));
    const hubs = joinHubs(walls);
    const groups = new Map<string, Point[][]>();
    for (const w of walls) {
      if (w.curtain || w.wallTypeId === 'wt-curtain') continue;
      const k = joinGroupKey(w);
      const arr = groups.get(k) || [];
      arr.push(...(pieces.get(w.id) || []));
      groups.set(k, arr);
    }
    for (const h of hubs) {
      const w = walls.find((x) => x.id === h.wallIds[0]);
      if (!w) continue;
      const k = joinGroupKey(w);
      groups.get(k)?.push(h.poly);
    }
    const outlines: Point[][] = [];
    for (const polys of groups.values()) outlines.push(...mergeOutlines(polys));
    return { wallPieces: pieces, wallHubs: hubs, wallOutlines: outlines };
  }, [walls, hostedOpenings]);
  const floors = useMemo(
    () => entities.filter((e): e is FloorEntity => e.type === 'floor'),
    [entities]
  );
  const roofs = useMemo(
    () => entities.filter((e): e is RoofEntity => e.type === 'roof'),
    [entities]
  );
  const stairs = useMemo(
    () => entities.filter((e): e is StairEntity => e.type === 'stair'),
    [entities]
  );
  const columns = useMemo(
    () => entities.filter((e): e is ColumnEntity => e.type === 'column'),
    [entities]
  );

  // STAIR calculation & placement helpers
  const stairLevels = useMemo(() => {
    const levels = [...(model.levels ?? [])].sort((a, b) => a.elevation - b.elevation);
    const baseLvl =
      levels.find((l) => l.id === stairTool.baseLevelId) ??
      levels.find((l) => l.id === activeLevelId) ??
      levels[0] ?? { id: 'level-1', name: 'Level 1', elevation: 0 };
    const curIdx = levels.findIndex((l) => l.id === baseLvl.id);
    const defaultTop =
      curIdx >= 0 && curIdx + 1 < levels.length
        ? levels[curIdx + 1]
        : levels[levels.length - 1] ?? { id: 'level-2', name: 'Level 2', elevation: baseLvl.elevation + 108 };
    const topLvl =
      levels.find((l) => l.id === stairTool.topLevelId && l.id !== baseLvl.id) ?? defaultTop;
    return { baseLvl, topLvl };
  }, [model.levels, stairTool.baseLevelId, stairTool.topLevelId, activeLevelId]);

  const stairCalc = useMemo(() => {
    const totalRise = Math.max(14, Math.abs(stairLevels.topLvl.elevation - stairLevels.baseLvl.elevation));
    return calculateStairRisers(
      totalRise,
      stairTool.maxRiserHeight,
      stairTool.treadDepth,
      stairTool.mode === 'template' && stairTool.template === 'u-3run' ? 3 : 2
    );
  }, [stairLevels, stairTool.maxRiserHeight, stairTool.treadDepth, stairTool.mode, stairTool.template]);

  const handlePlaceTemplateStairAt = useCallback(
    (originPt: Point, templateOverride?: StairEntity['shape']) => {
      const tpl = templateOverride ?? stairTool.template;
      const newStair = createStairFromTemplate({
        id: `stair-${Date.now()}`,
        origin: originPt,
        shape: tpl || 'l-left',
        baseLevelId: stairLevels.baseLvl.id,
        topLevelId: stairLevels.topLvl.id,
        baseElevation: stairLevels.baseLvl.elevation,
        topElevation: stairLevels.topLvl.elevation,
        width: stairTool.width,
        treadDepth: stairTool.treadDepth,
        maxRiserHeight: stairTool.maxRiserHeight,
        landingDepth: stairTool.landingDepth,
        wellGap: stairTool.wellGap,
        constructionStyle: stairTool.constructionStyle,
        landingStructure: stairTool.landingStructure,
        railingStyle: stairTool.railingStyle,
        railingSide: stairTool.railingSide,
        cutFloorAbove: stairTool.cutFloorAbove,
        layer: 'A-STRS',
      });
      const nextEnts = syncStairFloorOpenings([...model.entities, newStair], model.levels ?? []);
      onUpdateModel(nextEnts, `Place ${(tpl || 'l-left').toUpperCase()} Stair`);
      onFinishDrawing([], '');
      onSelectIds([newStair.id]);
      onSelectTool?.('select');
      onLog(
        `STAIR (${tpl}) placed: ${newStair.numRisers} Risers @ ${newStair.riserHeight.toFixed(2)}" | Tread = ${newStair.treadDepth}" (${newStair.runs?.length ?? 1} run(s), ${newStair.landings?.length ?? 0} landing(s)).`,
        'result'
      );
    },
    [stairTool, stairLevels, model.entities, model.levels, onUpdateModel, onFinishDrawing, onSelectIds, onSelectTool, onLog]
  );

  const handleFinishInteractiveStair = useCallback(
    (runsOverride?: StairToolState['draftRuns'], landingsOverride?: StairToolState['draftLandings']) => {
      if (stairTool.mode === 'template') {
        const centerWorld = {
          x: Math.round((450 - viewTransform.panX) / viewTransform.zoom / 12) * 12,
          y: Math.round((300 - viewTransform.panY) / viewTransform.zoom / 12) * 12,
        };
        handlePlaceTemplateStairAt(centerWorld);
        return;
      }
      const runs = runsOverride ?? stairTool.draftRuns;
      const landings = landingsOverride ?? stairTool.draftLandings;
      if (runs.length === 0) {
        onLog('STAIR: Click start and end points on the canvas to draw at least one flight.', 'error');
        return;
      }
      const totalRisers = runs.reduce((s, r) => s + r.numRisers, 0);
      const riserHeight = Number((stairCalc.totalRise / Math.max(1, totalRisers)).toFixed(2));
      let shape: StairEntity['shape'] = 'straight';
      if (runs.length === 2) {
        const d1 = normalize(sub(runs[0].end, runs[0].start));
        const d2 = normalize(sub(runs[1].end, runs[1].start));
        const dotP = d1.x * d2.x + d1.y * d2.y;
        const cr = d1.x * d2.y - d1.y * d2.x;
        if (dotP < -0.5) shape = 'u-switchback';
        else if (Math.abs(cr) > 0.5) shape = cr < 0 ? 'l-left' : 'l-right';
        else shape = 'straight-landing';
      } else if (runs.length >= 3) {
        shape = 'u-3run';
      }
      const newStair: StairEntity = {
        id: `stair-${Date.now()}`,
        type: 'stair',
        layer: 'A-STRS',
        levelId: stairLevels.baseLvl.id,
        start: runs[0].start,
        end: runs[runs.length - 1].end,
        width: stairTool.width,
        baseLevelId: stairLevels.baseLvl.id,
        topLevelId: stairLevels.topLvl.id,
        numRisers: totalRisers,
        desiredRisers: stairCalc.numRisers,
        riserHeight,
        treadDepth: runs[0].treadDepth ?? stairTool.treadDepth,
        maxRiserHeight: stairTool.maxRiserHeight,
        shape,
        runs,
        landings,
        constructionStyle: stairTool.constructionStyle,
        landingStructure: stairTool.landingStructure,
        railingStyle: stairTool.railingStyle,
        railingSide: stairTool.railingSide,
        cutFloorAbove: stairTool.cutFloorAbove,
      };
      const nextEnts = syncStairFloorOpenings([...model.entities, newStair], model.levels ?? []);
      onUpdateModel(nextEnts, 'Create Stair by Component');
      onFinishDrawing([], '');
      setStairTool((prev) => ({ ...prev, draftRuns: [], draftLandings: [] }));
      onSelectIds([newStair.id]);
      onSelectTool?.('select');
      onLog(
        `STAIR created: ${totalRisers} Risers @ ${riserHeight}" | ${runs.length} Run(s), ${landings.length} Automatic Landing(s).`,
        'result'
      );
    },
    [
      stairTool,
      stairLevels,
      stairCalc,
      viewTransform.panX,
      viewTransform.panY,
      viewTransform.zoom,
      handlePlaceTemplateStairAt,
      model.entities,
      model.levels,
      onUpdateModel,
      onFinishDrawing,
      onSelectIds,
      onSelectTool,
      onLog,
    ]
  );

  // Live Ghost Stair Preview (both One-Click Template & Interactive Multi-Run with Auto-Landing)
  const stairGhostPreview = useMemo(() => {
    if (activeTool !== 'stair') return null;

    if (stairTool.mode === 'template') {
      const ghostStair = createStairFromTemplate({
        id: 'ghost-stair-template',
        origin: cursorWorld,
        shape: stairTool.template,
        baseLevelId: stairLevels.baseLvl.id,
        topLevelId: stairLevels.topLvl.id,
        baseElevation: stairLevels.baseLvl.elevation,
        topElevation: stairLevels.topLvl.elevation,
        width: stairTool.width,
        treadDepth: stairTool.treadDepth,
        maxRiserHeight: stairTool.maxRiserHeight,
        landingDepth: stairTool.landingDepth,
        wellGap: stairTool.wellGap,
        constructionStyle: stairTool.constructionStyle,
        landingStructure: stairTool.landingStructure,
        railingStyle: stairTool.railingStyle,
        railingSide: stairTool.railingSide,
        cutFloorAbove: stairTool.cutFloorAbove,
      });
      return {
        geo: computeFullStairPlanGeometry(ghostStair, model.levels ?? [], activeLevelId),
        statusText: `${ghostStair.numRisers} Risers @ ${ghostStair.riserHeight.toFixed(2)}" · Click to place`,
      };
    }

    // Interactive Multi-Run Mode
    const createdSoFar = stairTool.draftRuns.reduce((s, r) => s + r.numRisers, 0);
    const remaining = Math.max(0, stairCalc.numRisers - createdSoFar);

    if (drawingPoints.length >= 1) {
      const p0 = drawingPoints[0];
      const rawLen = dist(p0, cursorWorld);
      if (stairTool.draftRuns.length === 0) {
        const treads = Math.max(2, Math.min(stairCalc.numRisers - 1, Math.round(rawLen / stairTool.treadDepth)));
        const risersInFlight = treads + 1;
        const dir = rawLen > 0.5 ? normalize(sub(cursorWorld, p0)) : { x: 1, y: 0 };
        const endPt = add(p0, scale(dir, treads * stairTool.treadDepth));
        const run1 = {
          id: 'ghost-run-1',
          start: p0,
          end: endPt,
          width: stairTool.width,
          numRisers: risersInFlight,
          treadDepth: stairTool.treadDepth,
          startRiserIndex: 1,
          baseElevationOffset: 0,
          topElevationOffset: risersInFlight * stairCalc.riserHeight,
        };
        const ghostStair: StairEntity = {
          id: 'ghost-stair-interactive',
          type: 'stair',
          layer: 'A-STRS',
          levelId: stairLevels.baseLvl.id,
          start: p0,
          end: endPt,
          width: stairTool.width,
          baseLevelId: stairLevels.baseLvl.id,
          topLevelId: stairLevels.topLvl.id,
          numRisers: risersInFlight,
          desiredRisers: stairCalc.numRisers,
          riserHeight: stairCalc.riserHeight,
          treadDepth: stairTool.treadDepth,
          runs: [run1],
          landings: [],
        };
        const rem = Math.max(0, stairCalc.numRisers - risersInFlight);
        return {
          geo: computeFullStairPlanGeometry(ghostStair, model.levels ?? [], activeLevelId),
          statusText: `${risersInFlight} risers created, ${rem} remaining`,
        };
      } else {
        const prevRun = stairTool.draftRuns[stairTool.draftRuns.length - 1];
        const { run2, landing } = snapSecondRunWithAutoLanding(
          prevRun,
          p0,
          cursorWorld,
          Math.max(2, remaining),
          stairCalc.riserHeight,
          {
            depth: stairTool.landingDepth,
            wellGap: stairTool.wellGap,
            structure: stairTool.landingStructure,
          }
        );
        const nextRuns = [...stairTool.draftRuns, run2];
        const nextLandings = [...stairTool.draftLandings, landing];
        const totalNow = createdSoFar + run2.numRisers;
        const ghostStair: StairEntity = {
          id: 'ghost-stair-interactive',
          type: 'stair',
          layer: 'A-STRS',
          levelId: stairLevels.baseLvl.id,
          start: nextRuns[0].start,
          end: run2.end,
          width: stairTool.width,
          baseLevelId: stairLevels.baseLvl.id,
          topLevelId: stairLevels.topLvl.id,
          numRisers: totalNow,
          desiredRisers: stairCalc.numRisers,
          riserHeight: stairCalc.riserHeight,
          treadDepth: stairTool.treadDepth,
          runs: nextRuns,
          landings: nextLandings,
        };
        return {
          geo: computeFullStairPlanGeometry(ghostStair, model.levels ?? [], activeLevelId),
          statusText: `${totalNow} risers created, ${Math.max(0, stairCalc.numRisers - totalNow)} remaining (Auto-Landing)`,
        };
      }
    }

    if (stairTool.draftRuns.length > 0) {
      const ghostStair: StairEntity = {
        id: 'ghost-stair-draft',
        type: 'stair',
        layer: 'A-STRS',
        levelId: stairLevels.baseLvl.id,
        start: stairTool.draftRuns[0].start,
        end: stairTool.draftRuns[stairTool.draftRuns.length - 1].end,
        width: stairTool.width,
        baseLevelId: stairLevels.baseLvl.id,
        topLevelId: stairLevels.topLvl.id,
        numRisers: createdSoFar,
        desiredRisers: stairCalc.numRisers,
        riserHeight: stairCalc.riserHeight,
        treadDepth: stairTool.treadDepth,
        runs: stairTool.draftRuns,
        landings: stairTool.draftLandings,
      };
      return {
        geo: computeFullStairPlanGeometry(ghostStair, model.levels ?? [], activeLevelId),
        statusText: `${createdSoFar} risers created, ${remaining} remaining — Click start of Run ${stairTool.draftRuns.length + 1}`,
      };
    }

    return null;
  }, [
    activeTool,
    stairTool,
    stairLevels,
    stairCalc,
    cursorWorld,
    drawingPoints,
    activeLevelId,
    model.levels,
  ]);

  // Adaptive grid step calculation based on zoom
  const baseGrid = model.settings.gridSize;
  const minorGrid =
    viewTransform.zoom < 0.5
      ? baseGrid * 4
      : viewTransform.zoom < 1.2
      ? baseGrid * 2
      : baseGrid;
  const majorGrid = minorGrid * 5;

  // Compute grips for selected entities
  const activeGrips: GripPoint[] = useMemo(() => {
    if (activeTool !== 'select' || selectedIds.length === 0) return [];
    const list: GripPoint[] = [];
    for (const id of selectedIds) {
      const ent = entities.find((el) => el.id === id);
      if (ent) {
        list.push(...getEntityGrips(ent, entities));
      }
    }
    return list;
  }, [activeTool, selectedIds, entities]);

  // Live DR / WN / WO placement: snapped into the wall under the cursor (frozen while a dimension is typed)
  const openingPlacement = useMemo(() => {
    if (!isOpeningTool(activeTool)) return null;
    if (editingDim && !editingDim.openingId) {
      const w = walls.find((x) => x.id === editingDim.wallId);
      if (!w) return null;
      const f = openingFrame(w);
      const at = { x: f.start.x + f.dir.x * editingDim.s + f.normal.x * (f.center + editingDim.cursorSide), y: f.start.y + f.dir.y * editingDim.s + f.normal.y * (f.center + editingDim.cursorSide) };
      return computeOpeningPlacement(model, entities, activeTool, { ...openingTool, snapCenter: false, snapEq: false }, at, viewTransform.zoom, activeLevelId, w.id);
    }
    return computeOpeningPlacement(model, entities, activeTool, openingTool, rawCursorWorld, viewTransform.zoom, activeLevelId);
  }, [activeTool, editingDim, walls, model, entities, openingTool, rawCursorWorld, viewTransform.zoom, activeLevelId]);

  /** Places a new opening on wall `wallId` at station `s` (validated; red previews are refused). */
  const placeOpeningAt = (wallId: string, s: number, cursorSide: number) => {
    if (!isOpeningTool(activeTool)) return;
    const w = walls.find((x) => x.id === wallId);
    if (!w) return;
    const f = openingFrame(w);
    const at = { x: f.start.x + f.dir.x * s + f.normal.x * (f.center + cursorSide), y: f.start.y + f.dir.y * s + f.normal.y * (f.center + cursorSide) };
    const pl = computeOpeningPlacement(model, entities, activeTool, { ...openingTool, snapCenter: false, snapEq: false }, at, viewTransform.zoom, activeLevelId, w.id);
    if (!pl) return;
    const label = activeTool === 'door' ? 'Door' : activeTool === 'window' ? 'Window' : 'Wall Opening';
    if (!pl.ok) {
      onLog(`${label.toUpperCase()}: cannot place here — ${issueText(pl.issues)}. Move along the wall or pick a smaller type.`, 'error');
      return;
    }
    const ent = buildOpeningEntity(model, activeTool, openingTool, pl.wall, pl.s, pl.cursorSide, activeLevelId, `${activeTool === 'wallopening' ? 'wo' : activeTool === 'door' ? 'door' : 'win'}-${Date.now()}`);
    onFinishDrawing([ent], `Place ${label}`); // the tool stays active to place more (Esc to finish)
  };

  // Live hover preview for AutoCAD 2021+ TRIM and EXTEND
  const trimExtendHoverPreview = useMemo(() => {
    if (activeTool !== 'trim' && activeTool !== 'extend') return null;
    if (trimEraseSubMode) return null;

    let effectiveTool = activeTool;
    if (activeTool === 'trim' && shiftPressed) effectiveTool = 'extend';
    else if (activeTool === 'extend' && shiftPressed) effectiveTool = 'trim';

    const candidate = findTrimExtendCandidate(
      rawCursorWorld,
      entities,
      28 / viewTransform.zoom
    );
    if (!candidate) return null;

    const layerObj = model.layers.find((l) => l.id === candidate.layer);
    if (layerObj?.locked) return null;

    if (effectiveTool === 'trim') {
      const mode = trimMode;
      let edges: ArchEntity[];
      if (mode === 'quick' || cuttingEdgeIds.length === 0) {
        edges = entities.filter((e) => e.id !== candidate.id);
      } else {
        edges = entities.filter((e) => cuttingEdgeIds.includes(e.id) && e.id !== candidate.id);
      }

      const res = trimAt(candidate, rawCursorWorld, edges, mode, entities, {
        edge: edgeMode,
        implied: edgeMode === 'extend',
      });

      if (res.action === 'deleted') {
        return { kind: 'delete-entity' as const, entity: candidate };
      }
      if (res.action === 'replaced' && res.removedPiece) {
        return { kind: 'removed-piece' as const, piece: res.removedPiece, entity: candidate };
      }
      return null;
    }

    if (effectiveTool === 'extend') {
      if (candidate.type === 'circle') return null;
      const mode = trimMode;
      let boundaries: ArchEntity[];
      if (mode === 'quick' || boundaryEdgeIds.length === 0) {
        boundaries = entities.filter((e) => e.id !== candidate.id);
      } else {
        boundaries = entities.filter((e) => boundaryEdgeIds.includes(e.id) && e.id !== candidate.id);
      }

      const res = extendAt(candidate, rawCursorWorld, boundaries, mode, edgeMode);
      if (res.extensionSegment) {
        return { kind: 'extension-segment' as const, segment: res.extensionSegment, entity: candidate };
      }
      return null;
    }

    return null;
  }, [
    activeTool,
    shiftPressed,
    trimEraseSubMode,
    trimMode,
    edgeMode,
    rawCursorWorld,
    entities,
    viewTransform.zoom,
    model.layers,
    cuttingEdgeIds,
    boundaryEdgeIds,
  ]);

  const refPoint =
    drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : null;

  const activeLevelObj =
    (model.levels ?? []).find((l) => l.id === activeLevelId) ?? {
      id: 'level-1',
      name: 'Level 1',
      elevation: 0,
    };

  // Single selected entity for Quick Properties Popup near cursor/entity
  const singleSelectedEntity = useMemo(() => {
    if (
      activeTool !== 'select' ||
      selectedIds.length !== 1 ||
      draggingGrip !== null ||
      boxSelectStart !== null
    ) {
      return null;
    }
    return entities.find((e) => e.id === selectedIds[0]) ?? null;
  }, [activeTool, selectedIds, draggingGrip, boxSelectStart, entities]);

  const quickPropsScreenPos = useMemo(() => {
    if (!singleSelectedEntity) return null;
    const anchor = getEntityAnchorPoint(singleSelectedEntity, entities);
    return {
      x: anchor.x * viewTransform.zoom + viewTransform.panX + 18,
      y: anchor.y * viewTransform.zoom + viewTransform.panY - 18,
    };
  }, [singleSelectedEntity, entities, viewTransform.zoom, viewTransform.panX, viewTransform.panY]);

  const handleUpdateQuickEntity = useCallback(
    (updated: ArchEntity, label: string) => {
      const next = syncHostedBimEntities(
        model.entities.map((ent) => (ent.id === updated.id ? updated : ent))
      );
      onUpdateModel(next, label);
    },
    [model.entities, onUpdateModel]
  );

  // Memoize static SVG entities so pointer movement never re-renders unchanged SVG elements
  const staticEntitiesSvg = useMemo(
    () => (
      <>
        {/* 0.5 STRUCTURAL GRIDS (GR) WITH BUBBLES (A, B, C / 1, 2, 3) */}
        {grids.map((g) => {
          const isSelected = selectedIdsSet.has(g.id);
          const dir = normalize(sub(g.end, g.start));
          const bubbleR = 12;
          const bubbleCenter = add(g.start, scale(dir, -bubbleR));
          const col = isSelected ? '#d97706' : '#0891b2';
          return (
            <g
              key={g.id}
              onClick={(e) => handleEntityClickStable(e, g)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, g)}
              className="cursor-pointer"
            >
              <line
                x1={g.start.x}
                y1={g.start.y}
                x2={g.end.x}
                y2={g.end.y}
                stroke={col}
                strokeWidth={(isSelected ? 1.8 : 1.1) / viewTransform.zoom}
                strokeDasharray={`${12 / viewTransform.zoom},${4 / viewTransform.zoom},${2 / viewTransform.zoom},${4 / viewTransform.zoom}`}
              />
              <circle
                cx={bubbleCenter.x}
                cy={bubbleCenter.y}
                r={bubbleR}
                fill={darkMode ? '#083344' : '#ecfeff'}
                stroke={col}
                strokeWidth={1.5 / viewTransform.zoom}
              />
              <text
                x={bubbleCenter.x}
                y={bubbleCenter.y + 3.5}
                textAnchor="middle"
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fontWeight={700}
                fill={col}
              >
                {g.label}
              </text>
            </g>
          );
        })}

        {/* Grid Intersection Snap Markers when Column (CL) or Grid (GR) tool is active */}
        {(activeTool === 'column' || activeTool === 'grid') &&
          gridIntersections.map((gi, idx) => (
            <g
              key={`gi-${idx}`}
              transform={`translate(${gi.point.x}, ${gi.point.y})`}
              pointerEvents="none"
            >
              <circle
                cx={0}
                cy={0}
                r={5 / viewTransform.zoom}
                fill="rgba(8, 145, 178, 0.25)"
                stroke="#0891b2"
                strokeWidth={1.5 / viewTransform.zoom}
              />
            </g>
          ))}

        {/* 0.8 FLOORS (SB) + STAIRWELL OPENINGS */}
        {floors.map((fl) => {
          const isSelected = selectedIdsSet.has(fl.id);
          let pathD = '';
          if (fl.polygon.length > 0) {
            pathD +=
              `M ${fl.polygon[0].x} ${fl.polygon[0].y} ` +
              fl.polygon
                .slice(1)
                .map((p) => `L ${p.x} ${p.y}`)
                .join(' ') +
              ' Z ';
          }
          if (fl.openings && fl.openings.length > 0) {
            for (const hole of fl.openings) {
              if (hole.length > 0) {
                pathD +=
                  `M ${hole[0].x} ${hole[0].y} ` +
                  hole
                    .slice(1)
                    .map((p) => `L ${p.x} ${p.y}`)
                    .join(' ') +
                  ' Z ';
              }
            }
          }
          return (
            <g
              key={fl.id}
              onClick={(e) => handleEntityClickStable(e, fl)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, fl)}
              className="cursor-pointer"
            >
              <path
                d={pathD}
                fillRule="evenodd"
                fill={
                  isSelected
                    ? 'rgba(217, 119, 6, 0.2)'
                    : darkMode
                    ? 'rgba(120, 113, 108, 0.16)'
                    : 'rgba(214, 211, 209, 0.38)'
                }
                stroke={isSelected ? '#d97706' : darkMode ? '#78716c' : '#a8a29e'}
                strokeWidth={(isSelected ? 2.2 : 1.2) / viewTransform.zoom}
              />
              {/* Architectural Stairwell Opening Outline & Diagonal Cross Lines */}
              {fl.openings?.map((hole, hIdx) => {
                if (hole.length < 3) return null;
                return (
                  <g key={`hole-${hIdx}`} pointerEvents="none">
                    <polygon
                      points={hole.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#d97706"
                      strokeWidth={1.2 / viewTransform.zoom}
                      strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
                    />
                    {hole.length >= 4 && (
                      <>
                        <line
                          x1={hole[0].x}
                          y1={hole[0].y}
                          x2={hole[2].x}
                          y2={hole[2].y}
                          stroke={darkMode ? '#78716c' : '#a8a29e'}
                          strokeWidth={0.75 / viewTransform.zoom}
                          strokeDasharray={`${4 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        />
                        <line
                          x1={hole[1].x}
                          y1={hole[1].y}
                          x2={hole[3].x}
                          y2={hole[3].y}
                          stroke={darkMode ? '#78716c' : '#a8a29e'}
                          strokeWidth={0.75 / viewTransform.zoom}
                          strokeDasharray={`${4 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        />
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* 1. ROOMS (Floor Fill + Room Label & Area Tag) */}
        {entities.map((ent) => {
          if (ent.type !== 'room') return null;
          const isSelected = selectedIdsSet.has(ent.id);
          const ptsStr = ent.polygon.map((p) => `${p.x},${p.y}`).join(' ');
          const areaText = formatArea(
            polygonArea(ent.polygon),
            model.settings.units
          );

          return (
            <g
              key={ent.id}
              onClick={(e) => handleEntityClickStable(e, ent)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
              className="cursor-pointer"
            >
              <polygon
                points={ptsStr}
                fill={
                  isSelected
                    ? 'rgba(217, 119, 6, 0.18)'
                    : darkMode
                    ? 'rgba(21, 128, 61, 0.12)'
                    : 'rgba(245, 158, 11, 0.08)'
                }
                stroke={isSelected ? '#d97706' : 'none'}
                strokeWidth={2 / viewTransform.zoom}
              />
              {/* Room Tag Label */}
              <g transform={`translate(${ent.labelPos.x}, ${ent.labelPos.y})`}>
                <rect
                  x={-42}
                  y={-14}
                  width={84}
                  height={28}
                  rx={3}
                  fill={
                    darkMode
                      ? 'rgba(28, 25, 23, 0.88)'
                      : 'rgba(255, 255, 255, 0.92)'
                  }
                  stroke={isSelected ? '#d97706' : '#a8a29e'}
                  strokeWidth={1 / viewTransform.zoom}
                />
                <text
                  x={0}
                  y={-2}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill={darkMode ? '#f5f5f4' : '#1c1917'}
                >
                  {ent.name}
                </text>
                <text
                  x={0}
                  y={9}
                  textAnchor="middle"
                  fontSize={7.5}
                  fontFamily="JetBrains Mono, monospace"
                  fill={darkMode ? '#a8a29e' : '#57534e'}
                >
                  {areaText}
                </text>
              </g>
            </g>
          );
        })}

        {/* 1.5 HATCHES (Architectural Pattern Fills) */}
        {entities.map((ent) => {
          if (ent.type !== 'hatch') return null;
          const isSelected = selectedIdsSet.has(ent.id);
          const ptsStr = ent.polygon.map((p) => `${p.x},${p.y}`).join(' ');
          const fillVal =
            ent.pattern === 'solid'
              ? darkMode
                ? 'rgba(168, 162, 158, 0.28)'
                : 'rgba(120, 113, 108, 0.22)'
              : `url(#hatch-pat-${ent.id})`;

          return (
            <g
              key={ent.id}
              onClick={(e) => handleEntityClickStable(e, ent)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
              className="cursor-pointer"
            >
              <polygon
                points={ptsStr}
                fill={fillVal}
                stroke={isSelected ? '#d97706' : darkMode ? '#57534e' : '#a8a29e'}
                strokeWidth={(isSelected ? 2 : 0.8) / viewTransform.zoom}
              />
            </g>
          );
        })}

        {/* 2. 2D CAD ENTITIES (Memoized per entity so unchanged SVG elements never re-render) */}
        {entities.map((ent) => {
          if (
            ent.type !== 'line' &&
            ent.type !== 'polyline' &&
            ent.type !== 'rectangle' &&
            ent.type !== 'circle' &&
            ent.type !== 'arc'
          ) {
            return null;
          }
          const layer = visibleLayers.get(ent.layer);
          if (!layer?.visible) return null;
          const isSelected = selectedIdsSet.has(ent.id);
          const strokeColor = isSelected
            ? '#d97706'
            : darkMode && layer.color === '#1c1917'
            ? '#e7e5e4'
            : layer.color;

          return (
            <MemoizedCadPrimitiveItem
              key={ent.id}
              ent={ent}
              isSelected={isSelected}
              strokeColor={strokeColor}
              zoom={viewTransform.zoom}
              onEntityClick={handleEntityClickStable}
              onEntityContextMenu={handleEntityContextMenuStable}
            />
          );
        })}

        {/* 3. ARCHITECTURAL WALLS — Revit-style cleanup: joined pieces are filled without seams and every
            group of joined walls (same type) is outlined by ONE continuous contour (wallJoins.ts) */}
        {walls.map((wall) => {
          const isSelected = selectedIdsSet.has(wall.id);
          const wallType = (model.wallTypes ?? []).find((wt) => wt.id === wall.wallTypeId);
          const isGlass = Boolean(wallType?.isCurtainOrGlass || wall.wallTypeId === 'wt-glass');
          const polygons = wallPieces.get(wall.id) || [];
          const fillColor = isSelected ? '#f59e0b' : isGlass ? 'rgba(56, 189, 248, 0.35)' : darkMode ? '#57534e' : '#44403c';
          const showCompoundLayers = viewTransform.zoom >= 0.75 && wallType && wallType.layers.length > 1 && !isSelected;
          const layerBands = showCompoundLayers && wallType ? computeWallLayerBands(wall, wallType, hostedOpenings, walls, model.wallTypes ?? []) : [];
          return (
            <g key={wall.id} onClick={(e) => handleEntityClickStable(e, wall)} onContextMenu={(e) => handleEntityContextMenuStable(e, wall)} className="cursor-pointer" data-wall-id={wall.id}>
              {showCompoundLayers && layerBands.length > 0 ? (
                <>
                  {/* invisible hit area */}
                  {polygons.map((poly, idx) => (
                    <polygon key={`hit-${idx}`} points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="transparent" stroke="none" />
                  ))}
                  {layerBands.map((band, bIdx) =>
                    band.polygons.map((bPoly, pIdx) => (
                      <polygon key={`band-${bIdx}-${pIdx}`} points={bPoly.map((p) => `${p.x},${p.y}`).join(' ')} fill={band.layer.color} stroke={band.layer.color} strokeWidth={0.4 / viewTransform.zoom} />
                    ))
                  )}
                  {layerBands.map((band, bIdx) =>
                    (band.dividerLine || []).map((d, dIdx) => (
                      <line key={`div-${bIdx}-${dIdx}`} x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} stroke={darkMode ? '#292524' : '#57534e'} strokeWidth={0.45 / viewTransform.zoom} pointerEvents="none" />
                    ))
                  )}
                </>
              ) : (
                polygons.map((poly, idx) => (
                  // fill with a hairline of the same colour so neighbouring pieces show no seam
                  <polygon key={idx} points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill={fillColor} stroke={isGlass ? '#0284c7' : fillColor} strokeWidth={(isGlass ? 1.3 : 0.6) / viewTransform.zoom} strokeLinejoin="miter" />
                ))
              )}
              {isSelected &&
                polygons.map((poly, idx) => (
                  <polygon key={`sel-${idx}`} points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#b45309" strokeWidth={1.6 / viewTransform.zoom} pointerEvents="none" />
                ))}
            </g>
          );
        })}
        {/* star-join hubs (3+ walls meeting at one point) */}
        {wallHubs.map((h) => (
          <polygon key={h.key} points={h.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill={darkMode ? '#57534e' : '#44403c'} stroke={darkMode ? '#57534e' : '#44403c'} strokeWidth={0.6 / viewTransform.zoom} pointerEvents="none" />
        ))}
        {/* one continuous contour per group of joined walls: no seam lines at corners / T / X junctions */}
        <g pointerEvents="none" data-testid="wall-outlines">
          {wallOutlines.map((loop, i) => (
            <polygon key={i} points={loop.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={darkMode ? '#e7e5e4' : '#1c1917'} strokeWidth={1.3 / viewTransform.zoom} strokeLinejoin="miter" />
          ))}
        </g>

        {/* 3.5 STRUCTURAL COLUMNS (CL) are drawn by the structural layer (profile-aware, material patterns) */}

        {/* 3.6 STAIRS (ST — Multi-Run, Landings, Cut-Break Line, Riser Numbers, Walk-Line & Dimensions) */}
        {stairs.map((st) => {
          const isSelected = selectedIdsSet.has(st.id);
          const geo = computeFullStairPlanGeometry(st, model.levels ?? [], activeLevelId);
          const strokeCol = isSelected
            ? '#d97706'
            : darkMode
            ? '#d6d3d1'
            : '#44403c';
          const fillCol = isSelected
            ? 'rgba(217, 119, 6, 0.22)'
            : darkMode
            ? 'rgba(68, 64, 60, 0.55)'
            : 'rgba(231, 229, 228, 0.85)';
          const landingFillCol = isSelected
            ? 'rgba(245, 158, 11, 0.28)'
            : darkMode
            ? 'rgba(87, 83, 78, 0.65)'
            : 'rgba(214, 211, 209, 0.9)';
          const dashAbove = `${5 / viewTransform.zoom},${3.5 / viewTransform.zoom}`;

          return (
            <g
              key={st.id}
              data-testid={`stair-entity-${st.id}`}
              onClick={(e) => handleEntityClickStable(e, st)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, st)}
              className="cursor-pointer"
            >
              {/* 1. Landing Platforms */}
              {geo.landingPolygons.map((lp, lIdx) => (
                <g key={`landing-${lIdx}`}>
                  <polygon
                    points={lp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={landingFillCol}
                    stroke={strokeCol}
                    strokeWidth={1.6 / viewTransform.zoom}
                    strokeDasharray={lp.aboveCut ? dashAbove : undefined}
                  />
                  {lp.intermediateStepLine && (
                    <line
                      x1={lp.intermediateStepLine[0].x}
                      y1={lp.intermediateStepLine[0].y}
                      x2={lp.intermediateStepLine[1].x}
                      y2={lp.intermediateStepLine[1].y}
                      stroke={strokeCol}
                      strokeWidth={1.2 / viewTransform.zoom}
                      strokeDasharray={lp.aboveCut ? dashAbove : undefined}
                    />
                  )}
                </g>
              ))}

              {/* 2. Flight Run Outlines (or Overall Outline for Spiral) */}
              {geo.runPolygons.length > 0 ? (
                geo.runPolygons.map((rp, rIdx) => (
                  <polygon
                    key={`run-${rIdx}`}
                    points={rp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={fillCol}
                    stroke={strokeCol}
                    strokeWidth={1.6 / viewTransform.zoom}
                  />
                ))
              ) : (
                <polygon
                  points={geo.outline.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={fillCol}
                  stroke={strokeCol}
                  strokeWidth={1.6 / viewTransform.zoom}
                />
              )}

              {/* 3. Winder / Spiral Pie Treads */}
              {geo.winderPolygons.map((wp, wIdx) => (
                <polygon
                  key={`winder-${wIdx}`}
                  points={wp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={fillCol}
                  stroke={strokeCol}
                  strokeWidth={1 / viewTransform.zoom}
                  strokeDasharray={wp.aboveCut ? dashAbove : undefined}
                />
              ))}

              {/* 4. Tread / Riser Lines (Solid below 4'-0" cut plane, Dashed above) */}
              {geo.treadLines.map((tl, idx) => (
                <line
                  key={`tread-${idx}`}
                  x1={tl.a.x}
                  y1={tl.a.y}
                  x2={tl.b.x}
                  y2={tl.b.y}
                  stroke={strokeCol}
                  strokeWidth={(tl.aboveCut ? 0.85 : 1.05) / viewTransform.zoom}
                  strokeDasharray={tl.aboveCut ? dashAbove : undefined}
                  opacity={tl.aboveCut ? 0.72 : 1}
                />
              ))}

              {/* 5. Architectural Cut-Break Line (~4'-0" above floor) with Zigzag Symbol */}
              {geo.cutBreakLine && (
                <polyline
                  points={geo.cutBreakLine.zigzag.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={isSelected ? '#d97706' : darkMode ? '#fbbf24' : '#b45309'}
                  strokeWidth={1.5 / viewTransform.zoom}
                />
              )}

              {/* 6. Riser Numbers (1..N) */}
              {viewTransform.zoom >= 0.65 &&
                geo.riserLabels.map((rl, rIdx) => (
                  <text
                    key={`rnum-${rIdx}`}
                    x={rl.position.x}
                    y={rl.position.y + 2}
                    textAnchor="middle"
                    fontSize={5.2}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                    fill={
                      isSelected
                        ? '#d97706'
                        : rl.aboveCut
                        ? darkMode
                          ? '#78716c'
                          : '#a8a29e'
                        : darkMode
                        ? '#d6d3d1'
                        : '#57534e'
                    }
                  >
                    {rl.text}
                  </text>
                ))}

              {/* 7. Continuous Walk-Line Path + Start Circle + Arrowhead */}
              {geo.walkPath.length >= 2 && (
                <polyline
                  points={geo.walkPath.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth={1.45 / viewTransform.zoom}
                />
              )}
              <circle
                cx={geo.walkStartCircle.x}
                cy={geo.walkStartCircle.y}
                r={2.5 / viewTransform.zoom}
                fill={darkMode ? '#1c1917' : '#ffffff'}
                stroke="#d97706"
                strokeWidth={1.3 / viewTransform.zoom}
              />
              <polyline
                points={`${geo.walkArrowHead[0].x},${geo.walkArrowHead[0].y} ${geo.walkArrowHead[1].x},${geo.walkArrowHead[1].y} ${geo.walkArrowHead[2].x},${geo.walkArrowHead[2].y}`}
                fill="none"
                stroke="#d97706"
                strokeWidth={1.65 / viewTransform.zoom}
              />

              {/* 8. UP / DN Walk Label */}
              <text
                x={geo.walkLabel.position.x}
                y={geo.walkLabel.position.y}
                textAnchor="middle"
                fontSize={7.5}
                fontFamily="JetBrains Mono, monospace"
                fontWeight={700}
                fill={isSelected ? '#d97706' : darkMode ? '#f5f5f4' : '#1c1917'}
              >
                {geo.walkLabel.text} ({geo.walkLabel.detail})
              </text>

              {/* 9. Temporary / Permanent Dimensions when Selected (Run Width, Tread Depth, Landing Size) */}
              {isSelected &&
                geo.dimensions.map((dm, dIdx) => (
                  <g key={`sdim-${dIdx}`} pointerEvents="none">
                    <line
                      x1={dm.p1.x}
                      y1={dm.p1.y}
                      x2={dm.p2.x}
                      y2={dm.p2.y}
                      stroke="#0284c7"
                      strokeWidth={1.1 / viewTransform.zoom}
                      strokeDasharray={`${3 / viewTransform.zoom},${2 / viewTransform.zoom}`}
                    />
                    <g transform={`translate(${dm.labelPos.x}, ${dm.labelPos.y})`}>
                      <rect
                        x={-26}
                        y={-5.5}
                        width={52}
                        height={11}
                        rx={2}
                        fill={darkMode ? 'rgba(12, 74, 110, 0.92)' : 'rgba(240, 249, 255, 0.94)'}
                        stroke="#0284c7"
                        strokeWidth={0.8 / viewTransform.zoom}
                      />
                      <text
                        x={0}
                        y={2.5}
                        textAnchor="middle"
                        fontSize={6.2}
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight={700}
                        fill={darkMode ? '#7dd3fc' : '#0369a1'}
                      >
                        {formatLength(dm.value, model.settings.units)}
                      </text>
                    </g>
                  </g>
                ))}
            </g>
          );
        })}

        {/* 3.7 ROOFS (dashed above the cut plane, ridge/hip/valley lines, slope arrows),
            SKYLIGHTS, DORMERS, BALCONIES, RAILINGS and CURTAIN-WALL MULLIONS */}
        {walls
          .filter((w) => w.curtain || w.wallTypeId === 'wt-curtain')
          .map((w) => (
            <g key={`cw-${w.id}`} pointerEvents="none">
              <PrimsWorld prims={curtainWallPlanPrims(w)} zoom={viewTransform.zoom} />
            </g>
          ))}
        {roofFacadeEntities.map((ent) => {
          const isSelected = selectedIdsSet.has(ent.id);
          const prims = buildRoofFacadePlanPrims(model, ent, viewTransform.zoom / SCREEN_PX_PER_MM, {
            color: isSelected ? '#d97706' : ent.type === 'roof' ? '#92400e' : undefined,
          });
          return (
            <g
              key={ent.id}
              onClick={(e) => handleEntityClickStable(e, ent)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
              className="cursor-pointer"
            >
              <PrimsWorld prims={prims} zoom={viewTransform.zoom} onPrimClick={() => undefined} />
            </g>
          );
        })}
        {/* ROOF tool (pick mode): picked walls + preview of the resulting eave outline */}
        {activeTool === 'roof' && roofTool && roofTool.mode !== 'sketch' && roofTool.pickedWallIds.length > 0 && (() => {
          const picked = walls.filter((w) => roofTool.pickedWallIds.includes(w.id));
          const fp = footprintFromWalls(picked);
          return (
            <g pointerEvents="none">
              {picked.map((w) => (
                <line key={`pick-${w.id}`} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke="#22C55E" strokeOpacity={0.7} strokeWidth={Math.max(w.thickness, 6 / viewTransform.zoom)} strokeLinecap="round" />
              ))}
              {fp.length >= 3 && (
                <polygon
                  points={offsetPolygon(normalizeFootprint(fp).polygon, roofTool.style === 'flat' ? 6 : 18).map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(34,197,94,0.08)"
                  stroke="#16a34a"
                  strokeWidth={1.5 / viewTransform.zoom}
                  strokeDasharray={`${6 / viewTransform.zoom} ${4 / viewTransform.zoom}`}
                />
              )}
            </g>
          );
        })()}

        {/* 4–5. HOSTED OPENINGS (doors, windows, wall openings): frame at the depth position, leaf + swing,
            hosting warnings, temporary dimensions / flip controls and the live placement preview */}
        <OpeningsPlanLayer
          model={model}
          entities={entities}
          walls={walls}
          selectedIds={selectedIdsSet}
          zoom={viewTransform.zoom}
          darkMode={darkMode}
          activeTool={activeTool}
          placement={null}
          part="static"
          onEntityClick={handleEntityClickStable}
          onEntityContextMenu={handleEntityContextMenuStable}
          onEditDim={(dim, at, ctx) => {
            if (ctx.openingId) {
              const o = model.entities.find((e) => e.id === ctx.openingId);
              if (!o || !isHostedOpening(o)) return;
              const w = walls.find((x) => x.id === o.wallId);
              if (!w) return;
              setEditingDim({ dim, at, text: '', openingId: o.id, wallId: w.id, s: o.offset * dist(w.start, w.end), width: o.width, cursorSide: 0 });
            } else if (openingPlacement) {
              setEditingDim({ dim, at, text: '', wallId: openingPlacement.wall.id, s: openingPlacement.s, width: openingPlacement.entity.width, cursorSide: openingPlacement.cursorSide * 4 });
            }
          }}
          onFlip={(id, what) => {
            const next = model.entities.map((e) => {
              if (e.id !== id) return e;
              if (e.type === 'door') {
                const [hand, face] = e.swing.split('-');
                return what === 'hand'
                  ? { ...e, swing: `${hand === 'left' ? 'right' : 'left'}-${face}` as DoorEntity['swing'] }
                  : { ...e, swing: `${hand}-${face === 'in' ? 'out' : 'in'}` as DoorEntity['swing'] };
              }
              if (e.type === 'window') return { ...e, flipFacing: !e.flipFacing };
              return e;
            });
            onUpdateModel(next, what === 'hand' ? 'Flip Door Hand' : 'Flip Opening Facing');
          }}
        />

        {/* 5.5 CUSTOM REGISTERED ELEMENTS (e.g. TestBox) */}
        {entities.map((ent) => {
          if (ent.type !== 'custom') return null;
          const isSelected = selectedIdsSet.has(ent.id);
          const cat = getElementCategory(ent.customCategory);
          if (!cat?.renderPlan2D) return null;
          const res = cat.renderPlan2D(ent, {
            units: model.settings.units,
            levelElevations: new Map(),
            activeLevelId,
            detailLevel: model.viewDetailLevel || 'medium',
            visualStyle: model.viewVisualStyle || 'shaded',
            isHovered: false,
            isSelected,
            zoom: viewTransform.zoom,
            allEntities: entities,
          });

          return (
            <g
              key={ent.id}
              onClick={(e) => handleEntityClickStable(e, ent)}
              onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
              className="cursor-pointer"
            >
              {res.paths.map((p, idx) => (
                <path
                  key={idx}
                  d={p.d}
                  stroke={p.stroke || '#6366f1'}
                  fill={p.fill || 'none'}
                  strokeWidth={(p.strokeWidth || 1.5) / viewTransform.zoom}
                  strokeDasharray={p.strokeDasharray}
                />
              ))}
              {res.texts?.map((t, idx) => (
                <text
                  key={idx}
                  x={t.x}
                  y={t.y}
                  fontSize={t.fontSize || 8}
                  fill={t.fill || '#6366f1'}
                  textAnchor="middle"
                >
                  {t.text}
                </text>
              ))}
            </g>
          );
        })}

        {/* 5.8 STRUCTURE: columns, foundations, framing, rebar, joints, loads, sections (+ Structural veil) */}
        <StructurePlanLayer
          model={model}
          entities={entities}
          levelId={activeLevelId}
          discipline={discipline}
          analytical={analytical}
          viewRebar={viewRebar}
          selectedIds={selectedIdsSet}
          zoom={viewTransform.zoom}
          darkMode={darkMode}
          activeTool={activeTool}
          drawingPoints={drawingPoints}
          cursor={cursorWorld}
          onEntityClick={handleEntityClickStable}
          onEntityContextMenu={handleEntityContextMenuStable}
          onOpenSection={onOpenSection}
        />

        {/* 6. ANNOTATIONS (Dimensions, Leaders, Category Tags & Text Notes) */}
        {entities.map((ent) => {
          const layer = visibleLayers.get(ent.layer);
          if (!layer?.visible) return null;
          const isSelected = selectedIdsSet.has(ent.id);
          const dimStyle = model.settings.dimStyle ?? DEFAULT_DIM_STYLE;
          const fontH = dimStyle.textHeight || 8;
          const arrowType = dimStyle.arrowType || 'tick';
          const col = isSelected
            ? '#d97706'
            : darkMode
            ? '#a8a29e'
            : '#57534e';

          if (ent.type === 'dimension') {
            const dimType = ent.dimType ?? 'aligned';

            if (dimType === 'angular' && ent.center) {
              const r = ent.radius ?? Math.max(24, Math.abs(ent.offset));
              const sAng = ent.startAngle ?? angleDegRaw(ent.center, ent.p1);
              const eAng = ent.endAngle ?? angleDegRaw(ent.center, ent.p2);
              const sweep = ent.sweepAngle ?? 45;
              const arcPath = describeSvgArc(ent.center, r, sAng, eAng);
              const midAngRad = (((sAng + eAng) / 2) * Math.PI) / 180;
              const labelPos = {
                x: ent.center.x + (r + 12) * Math.cos(midAngRad),
                y: ent.center.y + (r + 12) * Math.sin(midAngRad),
              };
              const label = ent.textOverride || `${sweep.toFixed(1)}°`;
              return (
                <g
                  key={ent.id}
                  onClick={(e) => handleEntityClickStable(e, ent)}
                  onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                  className="cursor-pointer"
                >
                  <path
                    d={arcPath}
                    fill="none"
                    stroke={col}
                    strokeWidth={1.4 / viewTransform.zoom}
                  />
                  <g transform={`translate(${labelPos.x}, ${labelPos.y})`}>
                    <rect
                      x={-24}
                      y={-7}
                      width={48}
                      height={14}
                      rx={2}
                      fill={darkMode ? '#1c1917' : '#f8f7f4'}
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      fontSize={fontH}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={600}
                      fill={col}
                    >
                      {label}
                    </text>
                  </g>
                </g>
              );
            }

            if ((dimType === 'radius' || dimType === 'diameter') && ent.center && ent.radius) {
              const radGeo = computeRadialDimGeometry(ent.center, ent.radius, ent.p2);
              const valInches = dimType === 'diameter' ? ent.radius * 2 : ent.radius;
              const prefix = dimType === 'diameter' ? 'Ø ' : 'R ';
              const label =
                ent.textOverride ||
                `${prefix}${formatLength(valInches, model.settings.units)}`;
              const isRight = radGeo.landingPoint.x >= radGeo.kneePoint.x;
              return (
                <g
                  key={ent.id}
                  onClick={(e) => handleEntityClickStable(e, ent)}
                  onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                  className="cursor-pointer"
                >
                  <polyline
                    points={`${ent.center.x},${ent.center.y} ${radGeo.arrowPoint.x},${radGeo.arrowPoint.y} ${radGeo.kneePoint.x},${radGeo.kneePoint.y} ${radGeo.landingPoint.x},${radGeo.landingPoint.y}`}
                    fill="none"
                    stroke={col}
                    strokeWidth={1.3 / viewTransform.zoom}
                  />
                  <circle
                    cx={radGeo.arrowPoint.x}
                    cy={radGeo.arrowPoint.y}
                    r={2.5 / viewTransform.zoom}
                    fill="#d97706"
                  />
                  <text
                    x={radGeo.landingPoint.x + (isRight ? 4 : -4)}
                    y={radGeo.landingPoint.y + 3}
                    textAnchor={isRight ? 'start' : 'end'}
                    fontSize={fontH}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                    fill={col}
                  >
                    {label}
                  </text>
                </g>
              );
            }

            // Linear or Aligned Dimension
            let d1: Point;
            let d2: Point;
            let dir: Point;
            let norm: Point;
            let measuredDist: number;

            if (dimType === 'linear') {
              const orient = ent.linearOrientation ?? 'horizontal';
              if (orient === 'horizontal') {
                const y = midpoint(ent.p1, ent.p2).y + ent.offset;
                d1 = { x: ent.p1.x, y };
                d2 = { x: ent.p2.x, y };
                dir = { x: d2.x >= d1.x ? 1 : -1, y: 0 };
                norm = { x: 0, y: ent.offset >= 0 ? 1 : -1 };
                measuredDist = Math.abs(ent.p2.x - ent.p1.x);
              } else {
                const x = midpoint(ent.p1, ent.p2).x + ent.offset;
                d1 = { x, y: ent.p1.y };
                d2 = { x, y: ent.p2.y };
                dir = { x: 0, y: d2.y >= d1.y ? 1 : -1 };
                norm = { x: ent.offset >= 0 ? 1 : -1, y: 0 };
                measuredDist = Math.abs(ent.p2.y - ent.p1.y);
              }
            } else {
              dir = normalize(sub(ent.p2, ent.p1));
              norm = perpLeft(dir);
              d1 = add(ent.p1, scale(norm, ent.offset));
              d2 = add(ent.p2, scale(norm, ent.offset));
              measuredDist = dist(ent.p1, ent.p2);
            }

            const mid = midpoint(d1, d2);
            const label =
              ent.textOverride || formatLength(measuredDist, model.settings.units);
            const tickLen = 4;
            const tickVec = normalize(add(dir, norm));

            return (
              <g
                key={ent.id}
                onClick={(e) => handleEntityClickStable(e, ent)}
                onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                className="cursor-pointer"
              >
                {/* Extension lines */}
                <line
                  x1={ent.p1.x}
                  y1={ent.p1.y}
                  x2={d1.x}
                  y2={d1.y}
                  stroke={col}
                  strokeWidth={1 / viewTransform.zoom}
                  strokeDasharray={`${3 / viewTransform.zoom},${
                    2 / viewTransform.zoom
                  }`}
                />
                <line
                  x1={ent.p2.x}
                  y1={ent.p2.y}
                  x2={d2.x}
                  y2={d2.y}
                  stroke={col}
                  strokeWidth={1 / viewTransform.zoom}
                  strokeDasharray={`${3 / viewTransform.zoom},${
                    2 / viewTransform.zoom
                  }`}
                />
                {/* Dimension line */}
                <line
                  x1={d1.x}
                  y1={d1.y}
                  x2={d2.x}
                  y2={d2.y}
                  stroke={col}
                  strokeWidth={1.25 / viewTransform.zoom}
                />
                {/* Terminators (Ticks / Arrows / Dots) */}
                {arrowType === 'tick' && (
                  <>
                    <line
                      x1={d1.x - tickVec.x * tickLen}
                      y1={d1.y - tickVec.y * tickLen}
                      x2={d1.x + tickVec.x * tickLen}
                      y2={d1.y + tickVec.y * tickLen}
                      stroke={col}
                      strokeWidth={1.8 / viewTransform.zoom}
                    />
                    <line
                      x1={d2.x - tickVec.x * tickLen}
                      y1={d2.y - tickVec.y * tickLen}
                      x2={d2.x + tickVec.x * tickLen}
                      y2={d2.y + tickVec.y * tickLen}
                      stroke={col}
                      strokeWidth={1.8 / viewTransform.zoom}
                    />
                  </>
                )}
                {(arrowType === 'arrow' || arrowType === 'open-arrow') && (
                  <>
                    <circle cx={d1.x} cy={d1.y} r={2.5} fill={col} />
                    <circle cx={d2.x} cy={d2.y} r={2.5} fill={col} />
                  </>
                )}
                {arrowType === 'dot' && (
                  <>
                    <circle cx={d1.x} cy={d1.y} r={3} fill={col} />
                    <circle cx={d2.x} cy={d2.y} r={3} fill={col} />
                  </>
                )}
                {/* Dimension Text Pill */}
                <g transform={`translate(${mid.x}, ${mid.y})`}>
                  <rect
                    x={-28}
                    y={-7}
                    width={56}
                    height={14}
                    rx={2}
                    fill={darkMode ? '#1c1917' : '#f8f7f4'}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fontSize={fontH}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                    fill={col}
                  >
                    {label}
                  </text>
                </g>
              </g>
            );
          }

          if (ent.type === 'leader') {
            const dir = normalize(sub(ent.kneePoint, ent.arrowPoint));
            const perp = perpLeft(dir);
            const tip = ent.arrowPoint;
            const b1 = add(add(tip, scale(dir, 7)), scale(perp, 3));
            const b2 = add(add(tip, scale(dir, 7)), scale(perp, -3));
            const isRight = ent.landingPoint.x >= ent.kneePoint.x;
            return (
              <g
                key={ent.id}
                onClick={(e) => handleEntityClickStable(e, ent)}
                onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                className="cursor-pointer"
              >
                <polyline
                  points={`${ent.arrowPoint.x},${ent.arrowPoint.y} ${ent.kneePoint.x},${ent.kneePoint.y} ${ent.landingPoint.x},${ent.landingPoint.y}`}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.4 / viewTransform.zoom}
                />
                <polygon
                  points={`${tip.x},${tip.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`}
                  fill={col}
                />
                <text
                  x={ent.landingPoint.x + (isRight ? 4 : -4)}
                  y={ent.landingPoint.y + 3}
                  textAnchor={isRight ? 'start' : 'end'}
                  fontSize={ent.fontSize}
                  fontWeight={600}
                  fill={isSelected ? '#d97706' : darkMode ? '#f5f5f4' : '#1c1917'}
                >
                  {ent.text}
                </text>
              </g>
            );
          }

          if (ent.type === 'tag') {
            const tagStroke = isSelected
              ? '#d97706'
              : ent.targetType === 'door'
              ? '#b45309'
              : ent.targetType === 'window'
              ? '#0284c7'
              : '#15803d';
            return (
              <g
                key={ent.id}
                transform={`translate(${ent.position.x}, ${ent.position.y})`}
                onClick={(e) => handleEntityClickStable(e, ent)}
                onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                className="cursor-pointer"
              >
                {ent.shape === 'pill' && (
                  <rect
                    x={-14}
                    y={-9}
                    width={28}
                    height={18}
                    rx={9}
                    fill={darkMode ? '#1c1917' : '#ffffff'}
                    stroke={tagStroke}
                    strokeWidth={1.5 / viewTransform.zoom}
                  />
                )}
                {ent.shape === 'hexagon' && (
                  <polygon
                    points="-14,0 -8,-10 8,-10 14,0 8,10 -8,10"
                    fill={darkMode ? '#1c1917' : '#ffffff'}
                    stroke={tagStroke}
                    strokeWidth={1.5 / viewTransform.zoom}
                  />
                )}
                {ent.shape === 'rectangle' && (
                  <rect
                    x={-36}
                    y={-11}
                    width={72}
                    height={22}
                    rx={3}
                    fill={darkMode ? '#1c1917' : '#ffffff'}
                    stroke={tagStroke}
                    strokeWidth={1.5 / viewTransform.zoom}
                  />
                )}
                <text
                  x={0}
                  y={3.5}
                  textAnchor="middle"
                  fontSize={8}
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight={700}
                  fill={tagStroke}
                >
                  {ent.shape === 'rectangle' ? `${ent.tagNumber}: ${ent.label}` : ent.tagNumber}
                </text>
              </g>
            );
          }

          if (ent.type === 'text') {
            const anchor =
              ent.alignment === 'center'
                ? 'middle'
                : ent.alignment === 'right'
                ? 'end'
                : 'start';
            const lines = ent.text.split('\n');
            return (
              <text
                key={ent.id}
                x={ent.position.x}
                y={ent.position.y}
                textAnchor={anchor}
                transform={`rotate(${ent.rotation}, ${ent.position.x}, ${ent.position.y})`}
                fontSize={ent.fontSize}
                fontWeight={600}
                fill={
                  isSelected
                    ? '#d97706'
                    : darkMode
                    ? '#f5f5f4'
                    : layer.color
                }
                onClick={(e) => handleEntityClickStable(e, ent)}
                onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                className="cursor-pointer"
              >
                {lines.map((ln, idx) => (
                  <tspan
                    key={idx}
                    x={ent.position.x}
                    dy={idx === 0 ? 0 : ent.fontSize * 1.25}
                  >
                    {ln}
                  </tspan>
                ))}
              </text>
            );
          }

          if (ent.type === 'block') {
            const blockDef = (model.blocks ?? []).find(
              (b) => b.id === ent.blockId
            );
            const prims = blockDef
              ? getBlockWorldPrimitives(ent, blockDef)
              : null;
            const strokeCol = isSelected
              ? '#d97706'
              : ent.color || layer.color;
            const fillCol = isSelected
              ? 'rgba(217, 119, 6, 0.16)'
              : `${ent.color || layer.color}22`;
            const sw = (isSelected ? 2.2 : 1.5) / viewTransform.zoom;

            return (
              <g
                key={ent.id}
                onClick={(e) => handleEntityClickStable(e, ent)}
                onContextMenu={(e) => handleEntityContextMenuStable(e, ent)}
                className="cursor-pointer"
              >
                {prims && prims.length > 0 ? (
                  <>
                    {prims.map((p) => {
                      if (p.type === 'rectangle') {
                        const rx = Math.min(p.p1.x, p.p2.x);
                        const ry = Math.min(p.p1.y, p.p2.y);
                        const rw = Math.abs(p.p2.x - p.p1.x);
                        const rh = Math.abs(p.p2.y - p.p1.y);
                        return (
                          <rect
                            key={p.id}
                            x={rx}
                            y={ry}
                            width={rw}
                            height={rh}
                            fill={fillCol}
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'polyline') {
                        return p.closed ? (
                          <polygon
                            key={p.id}
                            points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                            fill={fillCol}
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        ) : (
                          <polyline
                            key={p.id}
                            points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                            fill="none"
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'circle') {
                        return (
                          <circle
                            key={p.id}
                            cx={p.center.x}
                            cy={p.center.y}
                            r={p.radius}
                            fill={fillCol}
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'arc') {
                        return (
                          <path
                            key={p.id}
                            d={describeSvgArc(
                              p.center,
                              p.radius,
                              p.startAngle,
                              p.endAngle
                            )}
                            fill="none"
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'line') {
                        return (
                          <line
                            key={p.id}
                            x1={p.start.x}
                            y1={p.start.y}
                            x2={p.end.x}
                            y2={p.end.y}
                            stroke={strokeCol}
                            strokeWidth={sw}
                          />
                        );
                      }
                      return null;
                    })}
                  </>
                ) : (
                  <rect
                    x={ent.position.x - (ent.width * ent.scale) / 2}
                    y={ent.position.y - (ent.depth * ent.scale) / 2}
                    width={ent.width * ent.scale}
                    height={ent.depth * ent.scale}
                    transform={`rotate(${-ent.rotation}, ${ent.position.x}, ${ent.position.y})`}
                    fill={fillCol}
                    stroke={strokeCol}
                    strokeWidth={sw}
                  />
                )}
              </g>
            );
          }

          return null;
        })}
      </>
    ),
    [
      grids,
      gridIntersections,
      activeTool,
      floors,
      entities,
      selectedIdsSet,
      viewTransform.zoom,
      darkMode,
      visibleLayers,
      walls,
      doors,
      windows,
      columns,
      stairs,
      roofs,
      activeLevelId,
      model.levels,
      model.wallTypes,
      model.blocks,
      model.settings.units,
      model.settings.dimStyle,
      handleEntityClickStable,
      handleEntityContextMenuStable,
    ]
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${
        darkMode ? 'bg-stone-950' : 'bg-[#f8f7f4]'
      }`}
    >
      {/* VIEWCUBE (plan): static TOP cube — click a face, edge, corner or compass letter to open 3D there */}
      {viewCube && onPlanViewCube && (
        <ViewCube
          plan
          darkMode={darkMode}
          frontOffset={loadViewCubeSettings().frontOffset}
          projection={loadViewCubeSettings().projection}
          onHotspot={(h) => onPlanViewCube({ kind: 'hotspot', h })}
          onCardinal={(c) => onPlanViewCube({ kind: 'cardinal', c })}
          onHome={() => onPlanViewCube({ kind: 'home' })}
          onSetProjection={(p) => {
            saveViewCubeSettings({ projection: p });
            onLog(`ViewCube: ${p} projection for the 3D view.`, 'info');
          }}
        />
      )}
      {/* Contextual Stair by Component Options Bar when STAIR (ST) tool is active */}
      {activeTool === 'stair' && (
        <div className="absolute top-0 left-0 right-0 z-30 shadow-sm">
          <StairOptionsBar
            toolState={stairTool}
            onChangeToolState={(patch) => setStairTool((prev) => ({ ...prev, ...patch }))}
            levels={model.levels ?? []}
            units={model.settings.units}
            risersCreatedSoFar={stairTool.draftRuns.reduce((s, r) => s + r.numRisers, 0)}
            onPlaceTemplateNow={(tpl) => {
              const centerWorld = {
                x: Math.round((450 - viewTransform.panX) / viewTransform.zoom / 12) * 12,
                y: Math.round((300 - viewTransform.panY) / viewTransform.zoom / 12) * 12,
              };
              handlePlaceTemplateStairAt(centerWorld, tpl);
            }}
            onFinishInteractive={() => handleFinishInteractiveStair()}
            onCancelInteractive={() => {
              setStairTool((prev) => ({ ...prev, draftRuns: [], draftLandings: [] }));
              onFinishDrawing([], '');
              onCancelCommand?.();
            }}
          />
        </div>
      )}

      {/* Top-Left Level & Temporary Hide/Isolate HUD Badge */}
      <div className={`absolute ${activeTool === 'stair' ? 'top-14' : 'top-2.5'} left-3 z-20 flex flex-col items-start gap-1.5 pointer-events-none`}>
      <div className="flex items-center gap-2 pointer-events-auto">
        <div
          className={`px-2 py-1 rounded border text-[11px] font-mono font-medium shadow-xs ${
            darkMode
              ? 'bg-stone-900/90 border-stone-800 text-stone-300'
              : 'bg-white/90 border-stone-300 text-stone-700'
          }`}
        >
          Plan: <span className="font-bold text-amber-600 dark:text-amber-400">{activeLevelObj.name}</span> (Elev {formatLength(activeLevelObj.elevation, model.settings.units)})
        </div>
      </div>
        {onUnderlayChoiceChange && (
          <div
            data-testid="underlay-control"
            className={`pointer-events-auto flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] shadow-xs ${darkMode ? 'bg-stone-900/90 border-stone-800 text-stone-300' : 'bg-white/90 border-stone-300 text-stone-700'}`}
            title="Underlay: another level drawn in light gray beneath this plan (hold U to show it while it is off)"
          >
            <span className="font-semibold">Underlay</span>
            <select
              aria-label="Underlay"
              value={underlayChoice}
              onChange={(e) => onUnderlayChoiceChange(e.target.value)}
              className={`px-1 py-0.5 rounded border text-[11px] cursor-pointer ${darkMode ? 'bg-stone-900 border-stone-700' : 'bg-white border-stone-300'}`}
            >
              <option value="none">None</option>
              <option value="below">Level below{resolveUnderlay('below', model.levels ?? [], activeLevelId).kind === 'none' ? ' (none)' : ''}</option>
              <option value="foundation">Foundation</option>
              {(model.levels ?? [])
                .filter((l) => l.id !== activeLevelId)
                .map((l) => (
                  <option key={l.id} value={`level:${l.id}`}>
                    {l.name}
                  </option>
                ))}
            </select>
            {underlayHeld && underlayChoice === 'none' && <span className="text-amber-600 font-semibold">(held)</span>}
            {onUnderlayMismatchChange && (
              <label className="flex items-center gap-1 cursor-pointer" title="Outline in orange the load-bearing walls (marked Structural) and columns that have nothing under them in the underlay">
                <input type="checkbox" aria-label="Check supports" checked={underlayMismatch} onChange={(e) => onUnderlayMismatchChange(e.target.checked)} />
                Check supports
                {underlayMismatch && underlay.kind !== 'none' && (
                  <span data-testid="mismatch-count" className={`ml-0.5 px-1 rounded font-mono font-bold ${mismatches.length ? 'bg-orange-500 text-white' : 'bg-green-600 text-white'}`}>
                    {mismatches.length}
                  </span>
                )}
              </label>
            )}
          </div>
        )}
        {(tempHiddenIds.length > 0 || tempIsolatedIds.length > 0) && (
          <div className="pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-950/90 text-cyan-200 text-[11px] font-mono shadow-sm">
            <span>
              {tempIsolatedIds.length > 0
                ? `ISOLATED (${tempIsolatedIds.length})`
                : `HIDDEN (${tempHiddenIds.length})`}
            </span>
            {onResetTempHideIsolate && (
              <button
                type="button"
                aria-label="Reset Temporary Hide or Isolate (HR)"
                onClick={onResetTempHideIsolate}
                className="px-1.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-sans font-semibold text-[10px]"
              >
                Reset (HR)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Typing into a temporary dimension (Revit): Enter moves / places the opening, Esc cancels */}
      {editingDim && (
        <div
          className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
          style={{ left: editingDim.at.x * viewTransform.zoom + viewTransform.panX, top: editingDim.at.y * viewTransform.zoom + viewTransform.panY }}
        >
          <input
            autoFocus
            data-testid="temp-dim-input"
            aria-label="Exact distance"
            placeholder={formatLength(editingDim.dim.value, model.settings.units)}
            value={editingDim.text}
            onChange={(e) => setEditingDim({ ...editingDim, text: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitEditingDim();
              if (e.key === 'Escape') setEditingDim(null);
            }}
            onBlur={() => setTimeout(() => setEditingDim((cur) => (cur && cur.text === '' ? null : cur)), 150)}
            className="w-24 px-1.5 py-0.5 text-xs font-mono font-bold rounded border-2 border-sky-500 bg-sky-50 text-sky-900 shadow-lg outline-none"
          />
        </div>
      )}

      {/* Beginner Mode Floating Step Hint Banner at Top-Center of Canvas */}
      {uiMode === 'beginner' && hintText && (
        <div
          data-testid="beginner-canvas-hint"
          className={`absolute top-2.5 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-lg border shadow-sm text-xs flex items-center gap-2 pointer-events-none max-w-md ${
            darkMode
              ? 'bg-stone-900/95 border-amber-500/40 text-stone-100'
              : 'bg-white/95 border-amber-500/50 text-stone-800'
          }`}
        >
          <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shrink-0">
            Step Hint
          </span>
          <span className="truncate font-medium">{hintText}</span>
        </div>
      )}

      <svg
        ref={svgRef}
        data-testid="cad-2d-svg"
        onWheel={handleWheel}
        onPointerDown={(e) => {
          if (contextMenu) setContextMenu(null);
          handlePointerDown(e);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleSvgContextMenu}
        className={`w-full h-full block ${
          isPanning || spacePressed
            ? 'cursor-grab active:cursor-grabbing'
            : activeTool === 'select'
            ? 'cursor-default'
            : 'cursor-crosshair'
        }`}
      >
        <defs>
          {model.settings.gridVisible && (
            <>
              <pattern
                id="arch-minor-grid"
                width={minorGrid * viewTransform.zoom}
                height={minorGrid * viewTransform.zoom}
                patternUnits="userSpaceOnUse"
                x={viewTransform.panX}
                y={viewTransform.panY}
              >
                <path
                  d={`M ${minorGrid * viewTransform.zoom} 0 L 0 0 0 ${
                    minorGrid * viewTransform.zoom
                  }`}
                  fill="none"
                  stroke={darkMode ? '#292524' : '#e7e5e4'}
                  strokeWidth="0.75"
                />
              </pattern>
              <pattern
                id="arch-major-grid"
                width={majorGrid * viewTransform.zoom}
                height={majorGrid * viewTransform.zoom}
                patternUnits="userSpaceOnUse"
                x={viewTransform.panX}
                y={viewTransform.panY}
              >
                <rect
                  width={majorGrid * viewTransform.zoom}
                  height={majorGrid * viewTransform.zoom}
                  fill="url(#arch-minor-grid)"
                />
                <path
                  d={`M ${majorGrid * viewTransform.zoom} 0 L 0 0 0 ${
                    majorGrid * viewTransform.zoom
                  }`}
                  fill="none"
                  stroke={darkMode ? '#44403c' : '#d6d3d1'}
                  strokeWidth="1.1"
                />
              </pattern>
            </>
          )}
          {/* Dynamic Hatch Patterns */}
          {entities.map((ent) => {
            if (ent.type !== 'hatch' || ent.pattern === 'solid') return null;
            const patStroke = darkMode ? '#a8a29e' : '#57534e';
            const sc = Math.max(0.2, ent.scale || 1);
            const xform = `rotate(${ent.angle || 0}) scale(${sc})`;
            if (ent.pattern === 'diagonal') {
              return (
                <pattern
                  key={`pat-${ent.id}`}
                  id={`hatch-pat-${ent.id}`}
                  width={12}
                  height={12}
                  patternUnits="userSpaceOnUse"
                  patternTransform={xform}
                >
                  <line
                    x1={0}
                    y1={12}
                    x2={12}
                    y2={0}
                    stroke={patStroke}
                    strokeWidth={0.9}
                  />
                </pattern>
              );
            }
            if (ent.pattern === 'crosshatch') {
              return (
                <pattern
                  key={`pat-${ent.id}`}
                  id={`hatch-pat-${ent.id}`}
                  width={12}
                  height={12}
                  patternUnits="userSpaceOnUse"
                  patternTransform={xform}
                >
                  <line x1={0} y1={12} x2={12} y2={0} stroke={patStroke} strokeWidth={0.8} />
                  <line x1={0} y1={0} x2={12} y2={12} stroke={patStroke} strokeWidth={0.8} />
                </pattern>
              );
            }
            if (ent.pattern === 'brick') {
              return (
                <pattern
                  key={`pat-${ent.id}`}
                  id={`hatch-pat-${ent.id}`}
                  width={24}
                  height={12}
                  patternUnits="userSpaceOnUse"
                  patternTransform={xform}
                >
                  <line x1={0} y1={0} x2={24} y2={0} stroke={patStroke} strokeWidth={0.8} />
                  <line x1={0} y1={6} x2={24} y2={6} stroke={patStroke} strokeWidth={0.8} />
                  <line x1={12} y1={0} x2={12} y2={6} stroke={patStroke} strokeWidth={0.8} />
                  <line x1={0} y1={6} x2={0} y2={12} stroke={patStroke} strokeWidth={0.8} />
                </pattern>
              );
            }
            if (ent.pattern === 'concrete') {
              return (
                <pattern
                  key={`pat-${ent.id}`}
                  id={`hatch-pat-${ent.id}`}
                  width={24}
                  height={24}
                  patternUnits="userSpaceOnUse"
                  patternTransform={xform}
                >
                  <polygon
                    points="4,6 8,4 7,9"
                    fill="none"
                    stroke={patStroke}
                    strokeWidth={0.75}
                  />
                  <polygon
                    points="15,17 20,15 18,21"
                    fill="none"
                    stroke={patStroke}
                    strokeWidth={0.75}
                  />
                  <circle cx={14} cy={7} r={0.8} fill={patStroke} />
                  <circle cx={6} cy={18} r={0.8} fill={patStroke} />
                  <circle cx={20} cy={9} r={0.6} fill={patStroke} />
                  <circle cx={11} cy={13} r={0.6} fill={patStroke} />
                </pattern>
              );
            }
            if (ent.pattern === 'insulation') {
              return (
                <pattern
                  key={`pat-${ent.id}`}
                  id={`hatch-pat-${ent.id}`}
                  width={16}
                  height={12}
                  patternUnits="userSpaceOnUse"
                  patternTransform={xform}
                >
                  <path
                    d="M 0,6 Q 4,0 8,6 T 16,6"
                    fill="none"
                    stroke={patStroke}
                    strokeWidth={0.9}
                  />
                </pattern>
              );
            }
            return null;
          })}
        </defs>

        {/* Background Grid */}
        {model.settings.gridVisible && (
          <rect width="100%" height="100%" fill="url(#arch-major-grid)" opacity={model.settings.gridOpacity ?? 1} pointerEvents="none" />
        )}

        {/* World Coordinate Group */}
        <g
          transform={`translate(${viewTransform.panX}, ${viewTransform.panY}) scale(${viewTransform.zoom})`}
        >
          {/* Origin Axes Crosshair (0,0) */}
          <g opacity="0.45">
            <line
              x1={-24 / viewTransform.zoom}
              y1={0}
              x2={24 / viewTransform.zoom}
              y2={0}
              stroke="#dc2626"
              strokeWidth={1.2 / viewTransform.zoom}
            />
            <line
              x1={0}
              y1={-24 / viewTransform.zoom}
              x2={0}
              y2={24 / viewTransform.zoom}
              stroke="#16a34a"
              strokeWidth={1.2 / viewTransform.zoom}
            />
          </g>

          {/* UNDERLAY: chosen level / foundation in halftone, beneath the current plan */}
          {underlayPrims.length > 0 && (
            <g pointerEvents="none" data-testid="plan-underlay" opacity={0.85}>
              <PrimsWorld prims={underlayPrims} zoom={viewTransform.zoom} />
            </g>
          )}

          {/* Memoized Static World Entities (Skip re-render on pointer move) */}
          {staticEntitiesSvg}

          {/* UNDERLAY MISMATCH: load-bearing elements with nothing below them */}
          {mismatches.length > 0 && (
            <g pointerEvents="none" data-testid="underlay-mismatch">
              {mismatches.map((mm) => (
                <g key={mm.entityId}>
                  <polygon
                    points={mm.outline.map((q) => `${q.x},${q.y}`).join(' ')}
                    fill="rgba(249,115,22,0.08)"
                    stroke="#f97316"
                    strokeOpacity={mm.kind === 'wall' ? 0.55 : 1}
                    strokeWidth={(mm.kind === 'wall' ? 1.2 : 2) / viewTransform.zoom}
                    strokeDasharray={mm.kind === 'wall' ? `${6 / viewTransform.zoom} ${4 / viewTransform.zoom}` : undefined}
                  />
                  {mm.segments.map(([a, b], i) => (
                    <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f97316" strokeWidth={6 / viewTransform.zoom} strokeLinecap="round" opacity={0.85} />
                  ))}
                </g>
              ))}
            </g>
          )}

          {/* Wall Face Detection Highlight Line */}
          {detectedWallFace && (
            <g pointerEvents="none">
              {(() => {
                const faces = computeWallFaces(detectedWallFace.wall);
                const seg = faces[detectedWallFace.face];
                return (
                  <>
                    <line
                      x1={seg.start.x}
                      y1={seg.start.y}
                      x2={seg.end.x}
                      y2={seg.end.y}
                      stroke="#0284c7"
                      strokeWidth={2.5 / viewTransform.zoom}
                      strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
                    />
                    <circle
                      cx={detectedWallFace.pointOnFace.x}
                      cy={detectedWallFace.pointOnFace.y}
                      r={4 / viewTransform.zoom}
                      fill="#0284c7"
                    />
                  </>
                );
              })()}
            </g>
          )}

          {/* 7. RUBBER-BAND DRAWING PREVIEWS */}
          {drawingPoints.length > 0 && (
            <g pointerEvents="none">
              {/* Chained points so far (for polyline / wall / floor / roof) */}
              {drawingPoints.length > 1 &&
                (activeTool === 'polyline' ||
                  activeTool === 'wall' ||
                  activeTool === 'curtainwall' ||
                  activeTool === 'railing' ||
                  activeTool === 'floor' ||
                  activeTool === 'roof') && (
                  <polyline
                    points={drawingPoints
                      .map((p) => `${p.x},${p.y}`)
                      .join(' ')}
                    fill="none"
                    stroke={activeTool === 'curtainwall' ? '#0284c7' : '#d97706'}
                    strokeWidth={
                      activeTool === 'wall'
                        ? activeWallType
                          ? getWallTypeTotalThickness(activeWallType)
                          : 6
                        : activeTool === 'curtainwall'
                        ? 4
                        : 2 / viewTransform.zoom
                    }
                    opacity={0.75}
                  />
                )}

              {/* Current active rubber-band segment */}
              {(activeTool === 'line' ||
                activeTool === 'polyline' ||
                activeTool === 'wall' ||
                activeTool === 'curtainwall' ||
                activeTool === 'railing' ||
                activeTool === 'floor' ||
                activeTool === 'roof' ||
                activeTool === 'stair' ||
                activeTool === 'grid' ||
                activeTool === 'dist' ||
                activeTool === 'move' ||
                activeTool === 'copy' ||
                activeTool === 'rotate') &&
                refPoint && (
                  <line
                    x1={refPoint.x}
                    y1={refPoint.y}
                    x2={cursorWorld.x}
                    y2={cursorWorld.y}
                    stroke="#d97706"
                    strokeWidth={
                      activeTool === 'wall'
                        ? activeWallType
                          ? getWallTypeTotalThickness(activeWallType)
                          : 6
                        : activeTool === 'stair'
                        ? 36
                        : 1.8 / viewTransform.zoom
                    }
                    strokeDasharray={`${5 / viewTransform.zoom},${
                      3 / viewTransform.zoom
                    }`}
                    opacity={activeTool === 'stair' ? 0.35 : 1}
                  />
                )}

              {/* Rectangle rubber-band */}
              {activeTool === 'rectangle' && refPoint && (
                <rect
                  x={Math.min(refPoint.x, cursorWorld.x)}
                  y={Math.min(refPoint.y, cursorWorld.y)}
                  width={Math.abs(cursorWorld.x - refPoint.x)}
                  height={Math.abs(cursorWorld.y - refPoint.y)}
                  fill="rgba(217, 119, 6, 0.08)"
                  stroke="#d97706"
                  strokeWidth={1.8 / viewTransform.zoom}
                  strokeDasharray={`${5 / viewTransform.zoom},${
                    3 / viewTransform.zoom
                  }`}
                />
              )}

              {/* Circle rubber-band */}
              {activeTool === 'circle' && refPoint && (
                <circle
                  cx={refPoint.x}
                  cy={refPoint.y}
                  r={dist(refPoint, cursorWorld)}
                  fill="rgba(217, 119, 6, 0.06)"
                  stroke="#d97706"
                  strokeWidth={1.8 / viewTransform.zoom}
                  strokeDasharray={`${5 / viewTransform.zoom},${
                    3 / viewTransform.zoom
                  }`}
                />
              )}

              {/* Arc rubber-band */}
              {activeTool === 'arc' && drawingPoints.length === 2 && (
                (() => {
                  const previewArc = circleFromThreePoints(
                    drawingPoints[0],
                    drawingPoints[1],
                    cursorWorld
                  );
                  if (!previewArc) return null;
                  return (
                    <path
                      d={describeSvgArc(
                        previewArc.center,
                        previewArc.radius,
                        previewArc.startAngle,
                        previewArc.endAngle
                      )}
                      fill="none"
                      stroke="#d97706"
                      strokeWidth={1.8 / viewTransform.zoom}
                      strokeDasharray={`${5 / viewTransform.zoom},${
                        3 / viewTransform.zoom
                      }`}
                    />
                  );
                })()
              )}

              {/* Dimension rubber-band */}
              {activeTool === 'dimension' &&
                drawingPoints.length >= 1 && (
                  <line
                    x1={drawingPoints[0].x}
                    y1={drawingPoints[0].y}
                    x2={
                      drawingPoints.length === 2
                        ? drawingPoints[1].x
                        : cursorWorld.x
                    }
                    y2={
                      drawingPoints.length === 2
                        ? drawingPoints[1].y
                        : cursorWorld.y
                    }
                    stroke="#d97706"
                    strokeWidth={1.8 / viewTransform.zoom}
                    strokeDasharray={`${4 / viewTransform.zoom},${
                      3 / viewTransform.zoom
                    }`}
                  />
                )}

              {/* Mirror line rubber-band */}
              {activeTool === 'mirror' && drawingPoints.length === 1 && (
                <line
                  x1={drawingPoints[0].x}
                  y1={drawingPoints[0].y}
                  x2={cursorWorld.x}
                  y2={cursorWorld.y}
                  stroke="#f59e0b"
                  strokeWidth={2 / viewTransform.zoom}
                  strokeDasharray={`${6 / viewTransform.zoom},${
                    4 / viewTransform.zoom
                  }`}
                />
              )}

              {/* Stretch crossing box rubber-band */}
              {activeTool === 'stretch' && drawingPoints.length === 1 && (
                <rect
                  x={Math.min(drawingPoints[0].x, cursorWorld.x)}
                  y={Math.min(drawingPoints[0].y, cursorWorld.y)}
                  width={Math.abs(cursorWorld.x - drawingPoints[0].x)}
                  height={Math.abs(cursorWorld.y - drawingPoints[0].y)}
                  fill="rgba(34, 197, 94, 0.15)"
                  stroke="#16a34a"
                  strokeWidth={1.5 / viewTransform.zoom}
                  strokeDasharray={`${5 / viewTransform.zoom},${
                    3 / viewTransform.zoom
                  }`}
                />
              )}

              {/* Highlight Picked Entity for Modify Operations */}
              {pickedEntityId &&
                (() => {
                  const ent = entities.find((e) => e.id === pickedEntityId);
                  if (!ent) return null;
                  if (ent.type === 'line' || ent.type === 'wall') {
                    return (
                      <line
                        x1={ent.start.x}
                        y1={ent.start.y}
                        x2={ent.end.x}
                        y2={ent.end.y}
                        stroke="#0284c7"
                        strokeWidth={4 / viewTransform.zoom}
                        strokeDasharray={`${6 / viewTransform.zoom},${
                          4 / viewTransform.zoom
                        }`}
                        pointerEvents="none"
                      />
                    );
                  }
                  if (ent.type === 'circle') {
                    return (
                      <circle
                        cx={ent.center.x}
                        cy={ent.center.y}
                        r={ent.radius}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={4 / viewTransform.zoom}
                        strokeDasharray={`${6 / viewTransform.zoom},${
                          4 / viewTransform.zoom
                        }`}
                        pointerEvents="none"
                      />
                    );
                  }
                  return null;
                })()}

              {/* Highlight Cutting / Boundary Edges */}
              {cuttingEdgeIds.map((id) => {
                const ent = entities.find((e) => e.id === id);
                if (!ent || (ent.type !== 'line' && ent.type !== 'wall'))
                  return null;
                return (
                  <line
                    key={`cut-${id}`}
                    x1={ent.start.x}
                    y1={ent.start.y}
                    x2={ent.end.x}
                    y2={ent.end.y}
                    stroke="#f59e0b"
                    strokeWidth={3.5 / viewTransform.zoom}
                    strokeDasharray={`${5 / viewTransform.zoom},${
                      3 / viewTransform.zoom
                    }`}
                    pointerEvents="none"
                  />
                );
              })}
              {boundaryEdgeIds.map((id) => {
                const ent = entities.find((e) => e.id === id);
                if (!ent || (ent.type !== 'line' && ent.type !== 'wall'))
                  return null;
                return (
                  <line
                    key={`bound-${id}`}
                    x1={ent.start.x}
                    y1={ent.start.y}
                    x2={ent.end.x}
                    y2={ent.end.y}
                    stroke="#06b6d4"
                    strokeWidth={3.5 / viewTransform.zoom}
                    strokeDasharray={`${5 / viewTransform.zoom},${
                      3 / viewTransform.zoom
                    }`}
                    pointerEvents="none"
                  />
                );
              })}

              {/* Live Polar Tracking Dashed Line */}
              {activePolarSnap && refPoint && (
                <line
                  x1={refPoint.x}
                  y1={refPoint.y}
                  x2={
                    refPoint.x +
                    10000 * Math.cos((activePolarSnap.angleDeg * Math.PI) / 180)
                  }
                  y2={
                    refPoint.y -
                    10000 * Math.sin((activePolarSnap.angleDeg * Math.PI) / 180)
                  }
                  stroke="#10b981"
                  strokeWidth={1.5 / viewTransform.zoom}
                  strokeDasharray={`${6 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                  pointerEvents="none"
                />
              )}

              {/* Live Length & Angle Tooltip Next to Cursor */}
              {refPoint && dist(refPoint, cursorWorld) > 0.5 && (
                <g
                  transform={`translate(${
                    cursorWorld.x + 14 / viewTransform.zoom
                  }, ${cursorWorld.y - 14 / viewTransform.zoom}) scale(${
                    1 / viewTransform.zoom
                  })`}
                >
                  <rect
                    x={0}
                    y={-22}
                    width={activePolarSnap ? 164 : 136}
                    height={22}
                    rx={4}
                    fill="#1c1917"
                    stroke={activePolarSnap ? '#10b981' : '#d97706'}
                    strokeWidth={1}
                  />
                  <text
                    x={activePolarSnap ? 82 : 68}
                    y={-7}
                    textAnchor="middle"
                    fontSize={11}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                    fill={activePolarSnap ? '#34d399' : '#fbbf24'}
                  >
                    {formatLength(
                      dist(refPoint, cursorWorld),
                      model.settings.units
                    )}{' '}
                    ∠ {activePolarSnap ? activePolarSnap.angleDeg : angleDegCad(refPoint, cursorWorld).toFixed(0)}°
                    {activePolarSnap ? ' (Polar)' : ''}
                  </text>
                </g>
              )}
            </g>
          )}

          {/* ELEVATION MARKERS (Revit-style): click to open that elevation */}
          {onOpenElevation &&
            walls.length > 0 &&
            elevationMarkerPositions(model, activeLevelId).map((mk) => {
              const ang = (Math.atan2(mk.pointing.y, mk.pointing.x) * 180) / Math.PI;
              const letter = mk.dir[0].toUpperCase();
              return (
                <g
                  key={`elev-mk-${mk.dir}`}
                  transform={`translate(${mk.at.x}, ${mk.at.y}) scale(${1 / viewTransform.zoom})`}
                  className="cursor-pointer"
                  role="button"
                  aria-label={`Open ${mk.dir} elevation`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenElevation(mk.dir);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <title>{`${mk.dir[0].toUpperCase()}${mk.dir.slice(1)} Elevation — click to open`}</title>
                  <g transform={`rotate(${ang})`}>
                    <path d="M 22 0 L 9 -11 L 9 11 Z" fill={darkMode ? '#e7e5e4' : '#1c1917'} />
                  </g>
                  <circle r={11} fill={darkMode ? '#1c1917' : '#ffffff'} stroke={darkMode ? '#e7e5e4' : '#1c1917'} strokeWidth={1.6} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={darkMode ? '#e7e5e4' : '#1c1917'} fontFamily="Helvetica, Arial, sans-serif">
                    {letter}
                  </text>
                </g>
              );
            })}

          {/* SMART ALIGNMENT GUIDES (TRACK / F11): green dotted guides, reference highlights,
              "=" equal-length ticks, the snapped-point "x" and the reason label */}
          {activeInference && (
            <g pointerEvents="none">
              {activeInference.highlight.map((h, idx) => (
                <line
                  key={`sg-hl-${idx}`}
                  x1={h.a.x}
                  y1={h.a.y}
                  x2={h.b.x}
                  y2={h.b.y}
                  stroke="#22C55E"
                  strokeOpacity={0.55}
                  strokeWidth={5 / viewTransform.zoom}
                  strokeLinecap="round"
                />
              ))}
              {activeInference.guides.slice(0, 2).map((g, idx) => {
                // extend a little past the snapped point so the guide reads as a line, not a stub
                const len = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y);
                const ux = len > 1e-9 ? (g.to.x - g.from.x) / len : g.dir.x;
                const uy = len > 1e-9 ? (g.to.y - g.from.y) / len : g.dir.y;
                const over = 24 / viewTransform.zoom;
                return (
                  <line
                    key={`sg-guide-${idx}`}
                    x1={g.from.x}
                    y1={g.from.y}
                    x2={g.to.x + ux * over}
                    y2={g.to.y + uy * over}
                    stroke="#22C55E"
                    strokeWidth={1.5 / viewTransform.zoom}
                    strokeDasharray={`${4 / viewTransform.zoom} ${4 / viewTransform.zoom}`}
                  />
                );
              })}
              {activeInference.equalMarks.map((m, idx) => {
                const mid = midpoint(m.a, m.b);
                const L = Math.max(1e-9, dist(m.a, m.b));
                const ang = (Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180) / Math.PI;
                return (
                  <g
                    key={`sg-eq-${idx}`}
                    transform={`translate(${mid.x}, ${mid.y}) rotate(${ang}) scale(${1 / viewTransform.zoom})`}
                  >
                    {L > 0 && (
                      <>
                        <line x1={-2.5} y1={-6} x2={-2.5} y2={6} stroke="#22C55E" strokeWidth={2} />
                        <line x1={2.5} y1={-6} x2={2.5} y2={6} stroke="#22C55E" strokeWidth={2} />
                      </>
                    )}
                  </g>
                );
              })}
              <g transform={`translate(${activeInference.point.x}, ${activeInference.point.y}) scale(${1 / viewTransform.zoom})`}>
                <line x1={-5} y1={-5} x2={5} y2={5} stroke="#22C55E" strokeWidth={2} />
                <line x1={-5} y1={5} x2={5} y2={-5} stroke="#22C55E" strokeWidth={2} />
                {activeInference.label && (
                  <g transform={`translate(${-(activeInference.label.length * 6.4 + 12) - 12}, 12)`}>
                    <rect
                      x={0}
                      y={0}
                      rx={4}
                      width={activeInference.label.length * 6.4 + 12}
                      height={18}
                      fill="#052e16"
                      fillOpacity={0.88}
                      stroke="#22C55E"
                      strokeWidth={1}
                    />
                    <text
                      x={6}
                      y={12.5}
                      fontSize={11}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={600}
                      fill="#4ADE80"
                    >
                      {activeInference.label}
                    </text>
                  </g>
                )}
              </g>
            </g>
          )}

          {/* AREA / FLOOR / ROOF Tool: Live Polygon Preview */}
          {(activeTool === 'area' || activeTool === 'floor' || activeTool === 'roof') &&
            drawingPoints.length > 0 && (
              <g pointerEvents="none">
                <polygon
                  points={[...drawingPoints, cursorWorld]
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="rgba(217, 119, 6, 0.18)"
                  stroke="#d97706"
                  strokeWidth={2 / viewTransform.zoom}
                  strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
                />
                {[...drawingPoints, cursorWorld].map((p, i) => (
                  <circle
                    key={`poly-preview-pt-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={3.5 / viewTransform.zoom}
                    fill="#d97706"
                    stroke="#ffffff"
                    strokeWidth={1 / viewTransform.zoom}
                  />
                ))}
              </g>
            )}

          {/* CAMERA (CAM): camera icons + view wedges (plan only) and the live placement wedge */}
          <CameraPlanLayer
            cameras={entities.filter((e): e is CameraEntity => e.type === 'camera')}
            selectedIds={selectedIdsSet}
            zoom={viewTransform.zoom}
            darkMode={darkMode}
            draft={cameraDraft}
            idleCursor={activeTool === 'camera' && drawingPoints.length === 0 ? { at: rawCursorWorld, fov: cameraFov } : null}
            onEntityClick={handleEntityClickStable}
            onEntityContextMenu={handleEntityContextMenuStable}
            onOpenCamera={onOpenCamera}
          />

          {/* WALL JOIN (WJ) hover: highlight the corner under the cursor with its current join */}
          {activeTool === 'walljoin' && (() => {
            const ends = wallEndsNear(rawCursorWorld, walls, 18 / viewTransform.zoom + 6);
            if (!ends.length) return null;
            const P = ends[0].P;
            const idx = joinStateIndex(walls, ends);
            const label = ends.length === 1 ? (idx === 3 ? 'Disallowed' : 'Join (T)') : JOIN_CYCLE[idx].label;
            const r = 14 / viewTransform.zoom;
            return (
              <g pointerEvents="none" data-testid="walljoin-hover">
                <circle cx={P.x} cy={P.y} r={r} fill="rgba(14,165,233,0.15)" stroke="#0ea5e9" strokeWidth={1.6 / viewTransform.zoom} />
                <text x={P.x + r * 1.3} y={P.y - r * 1.1} fontSize={11 / viewTransform.zoom} fill="#0369a1" fontWeight={700} fontFamily="JetBrains Mono, monospace">
                  {label} · click to cycle
                </text>
              </g>
            );
          })()}

          {/* Live DR / WN / WO placement preview, temporary dimensions and flip controls */}
          <OpeningsPlanLayer
          part="live"
          model={model}
          entities={entities}
          walls={walls}
          selectedIds={selectedIdsSet}
          zoom={viewTransform.zoom}
          darkMode={darkMode}
          activeTool={activeTool}
          placement={openingPlacement}
          onEntityClick={handleEntityClickStable}
          onEntityContextMenu={handleEntityContextMenuStable}
          onEditDim={(dim, at, ctx) => {
            if (ctx.openingId) {
              const o = model.entities.find((e) => e.id === ctx.openingId);
              if (!o || !isHostedOpening(o)) return;
              const w = walls.find((x) => x.id === o.wallId);
              if (!w) return;
              setEditingDim({ dim, at, text: '', openingId: o.id, wallId: w.id, s: o.offset * dist(w.start, w.end), width: o.width, cursorSide: 0 });
            } else if (openingPlacement) {
              setEditingDim({ dim, at, text: '', wallId: openingPlacement.wall.id, s: openingPlacement.s, width: openingPlacement.entity.width, cursorSide: openingPlacement.cursorSide * 4 });
            }
          }}
          onFlip={(id, what) => {
            const next = model.entities.map((e) => {
              if (e.id !== id) return e;
              if (e.type === 'door') {
                const [hand, face] = e.swing.split('-');
                return what === 'hand'
                  ? { ...e, swing: `${hand === 'left' ? 'right' : 'left'}-${face}` as DoorEntity['swing'] }
                  : { ...e, swing: `${hand}-${face === 'in' ? 'out' : 'in'}` as DoorEntity['swing'] };
              }
              if (e.type === 'window') return { ...e, flipFacing: !e.flipFacing };
              return e;
            });
            onUpdateModel(next, what === 'hand' ? 'Flip Door Hand' : 'Flip Opening Facing');
          }}
        />

          {/* Live AutoCAD 2021+ TRIM and EXTEND Hover Previews */}
          {trimExtendHoverPreview && (
            <g pointerEvents="none" data-testid="trim-extend-preview">
              {trimExtendHoverPreview.kind === 'removed-piece' && (
                (() => {
                  const piece = trimExtendHoverPreview.piece;
                  if (piece.type === 'line' && piece.start && piece.end) {
                    return (
                      <line
                        x1={piece.start.x}
                        y1={piece.start.y}
                        x2={piece.end.x}
                        y2={piece.end.y}
                        stroke="#9ca3af"
                        strokeWidth={3.5 / viewTransform.zoom}
                        strokeDasharray={`${6 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                    );
                  }
                  if (
                    piece.type === 'arc' &&
                    piece.center &&
                    piece.radius &&
                    piece.startAngle !== undefined &&
                    piece.endAngle !== undefined
                  ) {
                    return (
                      <path
                        d={describeSvgArc(
                          piece.center,
                          piece.radius,
                          piece.startAngle,
                          piece.endAngle
                        )}
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth={3.5 / viewTransform.zoom}
                        strokeDasharray={`${6 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                    );
                  }
                  return null;
                })()
              )}

              {trimExtendHoverPreview.kind === 'delete-entity' && (
                (() => {
                  const ent = trimExtendHoverPreview.entity;
                  if (ent.type === 'line' || ent.type === 'wall') {
                    return (
                      <line
                        x1={ent.start.x}
                        y1={ent.start.y}
                        x2={ent.end.x}
                        y2={ent.end.y}
                        stroke="#ef4444"
                        strokeWidth={3.5 / viewTransform.zoom}
                        strokeDasharray={`${5 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        opacity={0.8}
                      />
                    );
                  }
                  if (ent.type === 'circle') {
                    return (
                      <circle
                        cx={ent.center.x}
                        cy={ent.center.y}
                        r={ent.radius}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth={3 / viewTransform.zoom}
                        strokeDasharray={`${5 / viewTransform.zoom},${4 / viewTransform.zoom}`}
                        opacity={0.8}
                      />
                    );
                  }
                  return null;
                })()
              )}

              {trimExtendHoverPreview.kind === 'extension-segment' && (
                (() => {
                  const seg = trimExtendHoverPreview.segment;
                  if (seg.type === 'line' && seg.start && seg.end) {
                    return (
                      <line
                        x1={seg.start.x}
                        y1={seg.start.y}
                        x2={seg.end.x}
                        y2={seg.end.y}
                        stroke="#38bdf8"
                        strokeWidth={2.5 / viewTransform.zoom}
                        strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                    );
                  }
                  if (
                    seg.type === 'arc' &&
                    seg.center &&
                    seg.radius &&
                    seg.startAngle !== undefined &&
                    seg.endAngle !== undefined
                  ) {
                    return (
                      <path
                        d={describeSvgArc(
                          seg.center,
                          seg.radius,
                          seg.startAngle,
                          seg.endAngle
                        )}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={2.5 / viewTransform.zoom}
                        strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                    );
                  }
                  return null;
                })()
              )}
            </g>
          )}

          {/* Active Freehand Drag Fence & 2-point Fence */}
          {fencePath.length >= 2 && (
            <polyline
              points={fencePath.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2 / viewTransform.zoom}
              strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}

          {twoPointFenceStart && (
            <g pointerEvents="none">
              <line
                x1={twoPointFenceStart.x}
                y1={twoPointFenceStart.y}
                x2={rawCursorWorld.x}
                y2={rawCursorWorld.y}
                stroke="#f59e0b"
                strokeWidth={2 / viewTransform.zoom}
                strokeDasharray={`${5 / viewTransform.zoom},${3 / viewTransform.zoom}`}
              />
              <circle
                cx={twoPointFenceStart.x}
                cy={twoPointFenceStart.y}
                r={4 / viewTransform.zoom}
                fill="#f59e0b"
              />
            </g>
          )}

          {/* Column Ghost Preview */}
          {activeTool === 'column' && (
            <g
              transform={`translate(${cursorWorld.x}, ${cursorWorld.y}) rotate(${-columnRotation})`}
              pointerEvents="none"
              opacity={0.75}
            >
              {activeColumnType?.shape === 'round' ? (
                <circle
                  cx={0}
                  cy={0}
                  r={(activeColumnType?.width ?? 12) / 2}
                  fill="rgba(217, 119, 6, 0.25)"
                  stroke="#d97706"
                  strokeWidth={2 / viewTransform.zoom}
                />
              ) : (
                <rect
                  x={-(activeColumnType?.width ?? 12) / 2}
                  y={-(activeColumnType?.depth ?? 12) / 2}
                  width={activeColumnType?.width ?? 12}
                  height={activeColumnType?.depth ?? 12}
                  fill="rgba(217, 119, 6, 0.25)"
                  stroke="#d97706"
                  strokeWidth={2 / viewTransform.zoom}
                />
              )}
            </g>
          )}

          {/* STAIR (ST) Live Ghost Preview (Interactive Multi-Run + Auto-Landing & One-Click Templates) */}
          {activeTool === 'stair' && stairGhostPreview && (
            <g pointerEvents="none" opacity={0.82} data-testid="stair-ghost-preview">
              {stairGhostPreview.geo.landingPolygons.map((lp, idx) => (
                <polygon
                  key={`ghost-land-${idx}`}
                  points={lp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(16, 185, 129, 0.22)"
                  stroke="#10b981"
                  strokeWidth={1.8 / viewTransform.zoom}
                />
              ))}
              {stairGhostPreview.geo.runPolygons.length > 0 ? (
                stairGhostPreview.geo.runPolygons.map((rp, idx) => (
                  <polygon
                    key={`ghost-run-${idx}`}
                    points={rp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="rgba(217, 119, 6, 0.18)"
                    stroke="#d97706"
                    strokeWidth={1.6 / viewTransform.zoom}
                  />
                ))
              ) : (
                <polygon
                  points={stairGhostPreview.geo.outline.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(217, 119, 6, 0.18)"
                  stroke="#d97706"
                  strokeWidth={1.6 / viewTransform.zoom}
                />
              )}
              {stairGhostPreview.geo.winderPolygons.map((wp, idx) => (
                <polygon
                  key={`ghost-winder-${idx}`}
                  points={wp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(217, 119, 6, 0.18)"
                  stroke="#d97706"
                  strokeWidth={1.1 / viewTransform.zoom}
                />
              ))}
              {stairGhostPreview.geo.treadLines.map((tl, idx) => (
                <line
                  key={`ghost-tread-${idx}`}
                  x1={tl.a.x}
                  y1={tl.a.y}
                  x2={tl.b.x}
                  y2={tl.b.y}
                  stroke="#d97706"
                  strokeWidth={1 / viewTransform.zoom}
                />
              ))}
              {stairGhostPreview.geo.walkPath.length >= 2 && (
                <polyline
                  points={stairGhostPreview.geo.walkPath.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={1.5 / viewTransform.zoom}
                />
              )}
              {/* Live Riser Counter Badge near Cursor */}
              <g
                transform={`translate(${cursorWorld.x + 16 / viewTransform.zoom}, ${
                  cursorWorld.y + 22 / viewTransform.zoom
                }) scale(${1 / viewTransform.zoom})`}
              >
                <rect
                  x={0}
                  y={-16}
                  width={stairGhostPreview.statusText.length * 6.5 + 16}
                  height={22}
                  rx={4}
                  fill="#064e3b"
                  stroke="#10b981"
                  strokeWidth={1.2}
                />
                <text
                  x={8}
                  y={-1}
                  fontSize={11}
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight={700}
                  fill="#6ee7b7"
                >
                  {stairGhostPreview.statusText}
                </text>
              </g>
            </g>
          )}

          {/* Live Ghost Preview for INSERT / Component Placement */}
          {activeTool === 'insert' && activeInsertBlock && (
            <g pointerEvents="none" opacity={0.78}>
              {(() => {
                const ghostInst: BlockInstanceEntity = {
                  id: 'ghost-insert',
                  type: 'block',
                  layer: 'A-FURN',
                  blockId: activeInsertBlock.id,
                  name: activeInsertBlock.name,
                  position: cursorWorld,
                  rotation: insertRotation,
                  scale: insertScale,
                  width: activeInsertBlock.width,
                  depth: activeInsertBlock.depth,
                  height: activeInsertBlock.height,
                  color: activeInsertBlock.color,
                };
                const prims = getBlockWorldPrimitives(
                  ghostInst,
                  activeInsertBlock
                );
                const sw = 1.8 / viewTransform.zoom;
                return (
                  <>
                    {prims.map((p) => {
                      if (p.type === 'rectangle') {
                        const rx = Math.min(p.p1.x, p.p2.x);
                        const ry = Math.min(p.p1.y, p.p2.y);
                        const rw = Math.abs(p.p2.x - p.p1.x);
                        const rh = Math.abs(p.p2.y - p.p1.y);
                        return (
                          <rect
                            key={p.id}
                            x={rx}
                            y={ry}
                            width={rw}
                            height={rh}
                            fill="rgba(217, 119, 6, 0.14)"
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'polyline') {
                        return p.closed ? (
                          <polygon
                            key={p.id}
                            points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                            fill="rgba(217, 119, 6, 0.14)"
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        ) : (
                          <polyline
                            key={p.id}
                            points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                            fill="none"
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'circle') {
                        return (
                          <circle
                            key={p.id}
                            cx={p.center.x}
                            cy={p.center.y}
                            r={p.radius}
                            fill="rgba(217, 119, 6, 0.14)"
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'arc') {
                        return (
                          <path
                            key={p.id}
                            d={describeSvgArc(
                              p.center,
                              p.radius,
                              p.startAngle,
                              p.endAngle
                            )}
                            fill="none"
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        );
                      }
                      if (p.type === 'line') {
                        return (
                          <line
                            key={p.id}
                            x1={p.start.x}
                            y1={p.start.y}
                            x2={p.end.x}
                            y2={p.end.y}
                            stroke="#d97706"
                            strokeWidth={sw}
                          />
                        );
                      }
                      return null;
                    })}
                  </>
                );
              })()}
            </g>
          )}

          {/* 8. SELECTION GRIPS (Small Blue Squares at Endpoints/Midpoints/Centers) */}
          {activeGrips.map((g) => {
            const size = 7 / viewTransform.zoom;
            return (
              <rect
                key={`${g.entityId}-${g.gripIndex}`}
                x={g.point.x - size / 2}
                y={g.point.y - size / 2}
                width={size}
                height={size}
                fill={g.kind === 'midpoint' ? '#38bdf8' : '#2563eb'}
                stroke="#ffffff"
                strokeWidth={1.2 / viewTransform.zoom}
                className="cursor-move"
              />
            );
          })}

          {/* 9. OBJECT SNAP (OSNAP) MARKER & LABEL */}
          {activeOsnap && (
            <g
              transform={`translate(${activeOsnap.point.x}, ${activeOsnap.point.y}) scale(${
                1 / viewTransform.zoom
              })`}
              pointerEvents="none"
            >
              {activeOsnap.type === 'Endpoint' && (
                <rect
                  x={-5}
                  y={-5}
                  width={10}
                  height={10}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={2}
                />
              )}
              {activeOsnap.type === 'Midpoint' && (
                <polygon
                  points="0,-6 6,5 -6,5"
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth={2}
                />
              )}
              {activeOsnap.type === 'Center' && (
                <circle
                  cx={0}
                  cy={0}
                  r={5.5}
                  fill="none"
                  stroke="#9333ea"
                  strokeWidth={2}
                />
              )}
              {activeOsnap.type === 'Intersection' && (
                <g stroke="#dc2626" strokeWidth={2}>
                  <line x1={-5} y1={-5} x2={5} y2={5} />
                  <line x1={-5} y1={5} x2={5} y2={-5} />
                </g>
              )}
              {activeOsnap.type === 'Quadrant' && (
                <polygon
                  points="0,-6 6,0 0,6 -6,0"
                  fill="none"
                  stroke="#eab308"
                  strokeWidth={2}
                />
              )}
              {activeOsnap.type === 'Tangent' && (
                <g stroke="#06b6d4" strokeWidth={1.8} fill="none">
                  <circle cx={0} cy={1} r={5} />
                  <line x1={-6} y1={-4} x2={6} y2={-4} />
                </g>
              )}
              {activeOsnap.type === 'Extension' && (
                <g stroke="#ec4899" strokeWidth={1.8}>
                  <line x1={-6} y1={0} x2={6} y2={0} />
                  <line x1={0} y1={-6} x2={0} y2={6} />
                  <circle cx={0} cy={0} r={4.5} fill="none" strokeDasharray="2,2" />
                </g>
              )}
              {(activeOsnap.type === 'Perpendicular' ||
                activeOsnap.type === 'Nearest') && (
                <circle
                  cx={0}
                  cy={0}
                  r={4.5}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth={2}
                />
              )}
              <rect
                x={8}
                y={8}
                width={activeOsnap.type.length * 6.5 + 10}
                height={18}
                rx={3}
                fill="#1c1917"
                opacity={0.9}
              />
              <text
                x={13}
                y={20}
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fontWeight={600}
                fill="#4ade80"
              >
                {activeOsnap.type}
              </text>
            </g>
          )}

          {/* 10. BOX SELECTION RECTANGLE (Left→Right = Window Blue, Right→Left = Crossing Green Dashed) */}
          {boxSelectStart && boxSelectEnd && (
            <rect
              x={Math.min(boxSelectStart.x, boxSelectEnd.x)}
              y={Math.min(boxSelectStart.y, boxSelectEnd.y)}
              width={Math.abs(boxSelectEnd.x - boxSelectStart.x)}
              height={Math.abs(boxSelectEnd.y - boxSelectStart.y)}
              fill={
                boxSelectEnd.x >= boxSelectStart.x
                  ? 'rgba(37, 99, 235, 0.12)'
                  : 'rgba(22, 163, 74, 0.12)'
              }
              stroke={
                boxSelectEnd.x >= boxSelectStart.x ? '#2563eb' : '#16a34a'
              }
              strokeWidth={1.2 / viewTransform.zoom}
              strokeDasharray={
                boxSelectEnd.x < boxSelectStart.x
                  ? `${4 / viewTransform.zoom},${3 / viewTransform.zoom}`
                  : undefined
              }
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {/* Dynamic Input (F12) Floating Overlay near Cursor */}
      {model.settings.dynamicInput && drawingPoints.length > 0 && (
        <div
          data-testid="dynamic-input-hud"
          style={{
            position: 'absolute',
            left: `${screenCursor.x + 18}px`,
            top: `${screenCursor.y + 18}px`,
            zIndex: 40,
          }}
          className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-md shadow-lg border border-stone-300 dark:border-stone-700 bg-white/95 dark:bg-stone-900/95 text-xs font-mono backdrop-blur-xs select-none"
        >
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-stone-400 font-semibold uppercase">L:</span>
            <input
              ref={dynLengthRef}
              type="text"
              value={dynLength}
              onFocus={() => setDynEditingField('length')}
              onBlur={() => setDynEditingField(null)}
              onChange={(e) => setDynLength(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  dynAngleRef.current?.focus();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommitDynamicInput();
                } else if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
              className="w-20 px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500"
              placeholder="Length"
              title="Length (Tab to switch to Angle, Enter to place)"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-stone-400 font-semibold uppercase">∠:</span>
            <input
              ref={dynAngleRef}
              type="text"
              value={dynAngle}
              onFocus={() => setDynEditingField('angle')}
              onBlur={() => setDynEditingField(null)}
              onChange={(e) => setDynAngle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  dynLengthRef.current?.focus();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommitDynamicInput();
                } else if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
              className="w-14 px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500"
              placeholder="Angle°"
              title="Angle in degrees (Tab to switch to Length, Enter to place)"
            />
          </div>
        </div>
      )}

      {/* Quick Properties Popup near selected object */}
      {singleSelectedEntity && quickPropsScreenPos && !contextMenu && (
        <QuickPropertiesPopup
          entity={singleSelectedEntity}
          layers={model.layers}
          wallTypes={model.wallTypes ?? []}
          units={model.settings.units}
          screenPosition={quickPropsScreenPos}
          screenPos={quickPropsScreenPos}
          onUpdateEntity={handleUpdateQuickEntity}
          onOpenFullProperties={() => onFocusProperties?.()}
          onMove={() => onSelectTool?.('move')}
          onCopy={() => onSelectTool?.('copy')}
          onRotate={() => onSelectTool?.('rotate')}
          onDelete={() => onDeleteSelection?.()}
          onClose={() => onSelectIds([])}
          darkMode={darkMode}
        />
      )}

      {/* CAMERA: live 3D preview while placing, or for the selected camera (updates as grips move) */}
      {previewCamera && !cameraPreviewHidden && (
        <div
          data-testid="camera-live-preview"
          className={`absolute right-3 bottom-3 z-30 rounded-lg border shadow-xl overflow-hidden ${darkMode ? 'border-stone-700 bg-stone-900' : 'border-stone-300 bg-white'}`}
          style={{ width: 320 }}
        >
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold">
            <span>
              {previewCamera.id === 'camera-draft' ? 'Live preview' : 'Preview'} · {previewCamera.name}
              <span className="ml-1 font-mono font-normal text-stone-500">{fovLabel(previewCamera.fov)}</span>
            </span>
            <span className="flex items-center gap-1">
              {previewCamera.id !== 'camera-draft' && onOpenCamera && (
                <button type="button" aria-label="Open camera view" className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] cursor-pointer" onClick={() => onOpenCamera(previewCamera.id)}>
                  Open
                </button>
              )}
              <button type="button" aria-label="Hide camera preview" className="px-1 text-stone-500 cursor-pointer" onClick={() => setCameraPreviewHidden(true)}>
                ✕
              </button>
            </span>
          </div>
          <div style={{ width: 320, height: Math.round(320 / aspectRatio(previewCamera.aspect)) }} className="pointer-events-none">
            <Canvas3D model={model} selectedIds={[]} onSelectIds={() => undefined} darkMode={darkMode} discipline={discipline} cameraView={previewCamera} preview />
          </div>
        </div>
      )}

      {/* Right-click Canvas Context Menu */}
      {contextMenu && (
        <CanvasContextMenu
          position={contextMenu}
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedIds.length}
          lastCommandAlias={lastCommandAlias}
          onClose={() => setContextMenu(null)}
          onRepeatLastCommand={() => onRepeatLastCommand?.()}
          onCancel={() => onCancelCommand?.()}
          onUndo={() => onUndo?.()}
          onZoomExtents={() => onZoomExtents?.()}
          onOpenProperties={() => onFocusProperties?.()}
          onMoveSelected={() => onSelectTool?.('move')}
          onCopySelected={() => onSelectTool?.('copy')}
          onRotateSelected={() => onSelectTool?.('rotate')}
          onDeleteSelected={() => onDeleteSelection?.()}
          darkMode={darkMode}
        />
      )}
    </div>
  );
};

