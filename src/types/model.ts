export type UnitSystem = 'imperial' | 'metric'; // Internal coordinate unit is always inches (1" = 25.4 mm)

export interface Point {
  x: number;
  y: number;
}

export type LayerId = string;

export interface Layer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export type WallJustification = 'center' | 'interior' | 'exterior';
export type DoorSwing = 'left-in' | 'right-in' | 'left-out' | 'right-out';

export interface WallAssemblyLayer {
  id: string;
  name: string;        // e.g. 'Gypsum 5/8"', 'Stud 3-1/2"', 'Sheathing 1/2"', 'Siding 3/4"'
  function: 'finish1' | 'structure' | 'substrate' | 'thermal' | 'finish2' | 'glazing';
  thickness: number;   // inches
  color: string;       // hex color for 2D plan layer hatching / 3D surface
}

export interface WallType {
  id: string;
  name: string;        // e.g. 'Interior 4-1/2"', 'Exterior 2x6', 'Concrete 8"', 'Glass Partition'
  layers: WallAssemblyLayer[];
  defaultHeight: number; // inches
  isCurtainOrGlass?: boolean;
  /** Log / timber walls: stacked courses in 3D and elevation, saddle-notch corner overhangs */
  log?: { profile: 'round' | 'd' | 'square'; course: number; chinking?: boolean; overhang?: number };
  /** default exterior / interior finish for walls of this type */
  exteriorFinish?: ExteriorFinish;
  interiorFinish?: InteriorFinish;
}

export interface FloorType {
  id: string;
  name: string;        // e.g. 'Concrete Slab 6"', 'Wood Joist 10" - Hardwood', 'Ceramic Tile Floor 8"'
  thickness: number;   // inches
  material: 'wood' | 'tile' | 'concrete' | 'stone';
  color: string;
}

export interface ColumnType {
  id: string;
  name: string;        // e.g. 'Rectangular Concrete 12" x 12"', 'Round Steel 10"', 'Timber Post 8" x 8"'
  shape: 'rectangular' | 'round';
  width: number;       // inches (diameter if round)
  depth: number;       // inches
  color: string;
  structuralMaterialId?: string; // structural material (concrete / steel / wood)
  profileId?: string;            // catalog section for steel and wood
}

/** How a door operates (drives its plan symbol, elevation and 3D leaf). */
export type DoorKind =
  | 'single'
  | 'double'
  | 'dutch'
  | 'pivot'
  | 'sliding'
  | 'multislide'
  | 'pocket'
  | 'barn'
  | 'barn-bypass'
  | 'bifold'
  | 'garage';
/** Leaf / panel design of a door type (elevation, 3D). */
export type DoorPanelStyle =
  | 'flush'
  | 'six-panel'
  | 'craftsman'
  | 'french'
  | 'plank'
  | 'arched'
  | 'louvered'
  | 'glass'
  | 'sectional'
  | 'roll-up'
  | 'carriage'
  | 'pivot-slab';
/** How a window operates (drives its plan symbol, elevation and 3D sashes). */
export type WindowOperation = 'fixed' | 'casement' | 'double-hung' | 'awning' | 'slider';
/** Frame material of a door / window type. */
export type FrameMaterial = 'vinyl' | 'wood' | 'aluminum' | 'fiberglass' | 'steel';
/**
 * Where an opening's frame sits within the wall thickness:
 * 'exterior' (flush toward the exterior face), 'center', 'interior', or a number =
 * custom offset in inches from the wall centre toward the exterior (negative = toward the interior).
 */
export type DepthPosition = 'exterior' | 'center' | 'interior' | number;

export interface DoorType {
  id: string;
  name: string;        // e.g. 'Single Flush 36" x 84"', 'Single Flush 30" x 84"', 'Double Glass 72" x 84"'
  width: number;       // inches
  height: number;      // inches
  kind?: DoorKind;             // default 'single'
  frameMaterial?: FrameMaterial;
  divisions?: WindowDivisions; // glass lites ('1x1' = solid slab)
  frameWidth?: number;         // inches
  panelStyle?: DoorPanelStyle; // leaf design (default from kind)
  panels?: number;             // leaves / panels (sliding, multi-slide, bi-fold)
  sidelights?: number;         // 0, 1 or 2 glass sidelights
  sidelightWidth?: number;     // inches
  transom?: number;            // transom height above the leaf (inches, 0 = none)
  screenDoor?: boolean;        // cabin screen / storm door on the exterior side
  category?: 'hinged' | 'sliding' | 'specialty';
}

export interface WindowType {
  id: string;
  name: string;        // e.g. 'Fixed Casement 48" x 48"', 'Picture Window 60" x 54"', 'Awning 36" x 36"'
  width: number;       // inches
  height: number;      // inches
  sillHeight: number;  // inches (default for new instances)
  operation?: WindowOperation; // default 'fixed'
  frameMaterial?: FrameMaterial;
  divisions?: WindowDivisions;
  frameWidth?: number;         // inches
}

export interface LevelDefinition {
  id: string;          // e.g. 'level-1', 'level-2', 'level-roof'
  name: string;        // e.g. 'Level 1', 'Level 2', 'Roof'
  elevation: number;   // inches above project datum (0", 108", 216", etc.)
  floorToFloorHeight?: number;
}

export interface BaseEntity {
  id: string;
  layer: LayerId;
  levelId?: string;    // Building level ID (defaults to 'level-1')
}

export interface LineEntity extends BaseEntity {
  type: 'line';
  start: Point;
  end: Point;
}

export interface PolylineEntity extends BaseEntity {
  type: 'polyline';
  points: Point[];
  closed: boolean;
}

export interface RectangleEntity extends BaseEntity {
  type: 'rectangle';
  p1: Point;
  p2: Point;
}

export interface CircleEntity extends BaseEntity {
  type: 'circle';
  center: Point;
  radius: number;
}

export interface ArcEntity extends BaseEntity {
  type: 'arc';
  center: Point;
  radius: number;
  startAngle: number; // degrees, 0 = +X, counter-clockwise in CAD or SVG math
  endAngle: number;   // degrees
}

export interface WallEntity extends BaseEntity {
  type: 'wall';
  wallTypeId?: string; // links to WallType (e.g. 'wt-int-45', 'wt-ext-2x6', 'wt-conc-8', 'wt-glass')
  start: Point;
  end: Point;
  thickness: number; // inches (computed from WallType layers if wallTypeId is set)
  height: number;    // inches (default 108" = 9'-0")
  baseOffset: number; // inches (default 0)
  justification: WallJustification;
  // ---- Facade ----
  exteriorFinish?: ExteriorFinish;     // finish on the exterior face (default from wall type)
  interiorFinish?: InteriorFinish;     // finish on the interior face (default 'paint')
  /** Split-face bands on the exterior face, bottom to top. Each band runs from the previous
   *  band's top (or 0) up to `upTo` inches above the wall base; the last band uses exteriorFinish. */
  finishBands?: FinishBand[];
  /** Which side of the wall line is the exterior: 'left' of start→end, 'right', or auto (away from the building centre). */
  exteriorSide?: 'left' | 'right' | 'auto';
  attachedRoofId?: string;             // Revit "Attach Top": wall top follows this roof's underside
  // ---- Structure ----
  structural?: boolean;                // load-bearing / structural wall (shown strongly in Structural discipline)
  structuralMaterialId?: string;       // e.g. 'conc-4000', 'cmu', 'spf2' (default from the wall type)
  cover?: RebarCover;                  // concrete cover for rebar hosted by this wall
  parapetHeight?: number;              // extra height above the wall top with a coping cap (inches)
  curtain?: CurtainGrid;               // present on curtain walls (wall type with isCurtainOrGlass)
  /** Wall-join overrides at each end (WJ tool): miter / butt / square-off, or disallow join */
  joins?: { start?: WallEndJoin; end?: WallEndJoin };
}

export type JoinStyle = 'miter' | 'butt' | 'squareoff';
export interface WallEndJoin {
  style?: JoinStyle;
  /** "Disallow Join": keep a visible seam / square end here */
  disallow?: boolean;
  /** BUTT / SQUARE-OFF: this wall runs through (the other one stops at it) */
  primary?: boolean;
}

export type ExteriorFinish =
  | 'brick'
  | 'lap-siding'
  | 'board-batten'
  | 'stucco'
  | 'stone'
  | 'wood-cladding'
  | 'fiber-cement'
  | 'concrete'
  | 'log-round'
  | 'log-d'
  | 'log-chinked'
  | 'cedar-bb';

export type InteriorFinish = 'paint' | 'plaster' | 'wood-panel' | 'tile' | 'exposed' | 'knotty-pine' | 'log-interior';

export interface FinishBand {
  upTo: number; // inches above wall base where this band ends
  finish: ExteriorFinish;
}

/** Curtain-wall panel: glass, solid spandrel, door panel (bottom row) or operable window (vent) panel. */
export type CurtainPanelType = 'glass' | 'solid' | 'door' | 'window';

export interface CurtainGrid {
  hSpacing: number;     // horizontal grid line spacing (vertical distance between horizontal mullions), inches
  vSpacing: number;     // vertical grid line spacing (distance between vertical mullions), inches
  mullionSize: number;  // mullion face width, inches
  mullionColor: string; // hex
  /** Panel type per cell, keyed "col,row" (col from wall start, row from bottom). Missing = glass. */
  panels?: Record<string, CurtainPanelType>;
}

export type WindowDivisions = '1x1' | '2x1' | '2x2' | '3x2';

export interface DoorEntity extends BaseEntity {
  type: 'door';
  mark?: string;       // e.g. 'D1', 'D2'
  doorTypeId?: string;
  wallId: string;
  offset: number; // parametric 0..1 along wall from start to end
  width: number;  // inches (default 36" = 3'-0")
  height: number; // inches (default 84" = 7'-0")
  swing: DoorSwing;
  comments?: string;
  frameWidth?: number;       // inches (default 2")
  divisions?: WindowDivisions; // glass lites (default '1x1' = solid slab door)
  glazed?: boolean;          // door slab has glass lites
  trim?: boolean;            // casing / head trim (default true)
  lintel?: LintelOverride;   // header over the opening (auto-sized unless overridden)
  kind?: DoorKind;           // copied from the type (single / double / sliding / garage / …)
  frameMaterial?: FrameMaterial;
  panelStyle?: DoorPanelStyle;
  panels?: number;
  sidelights?: number;
  sidelightWidth?: number;
  transom?: number;
  screenDoor?: boolean;
  depthPosition?: DepthPosition; // frame position within the wall thickness (default 'center')
}

export interface WindowEntity extends BaseEntity {
  type: 'window';
  mark?: string;       // e.g. 'W1', 'W2'
  windowTypeId?: string;
  wallId: string;
  offset: number; // parametric 0..1 along wall from start to end
  width: number;  // inches (default 48" = 4'-0")
  height: number; // inches (default 48" = 4'-0")
  sillHeight: number; // inches (default 36" = 3'-0")
  comments?: string;
  frameWidth?: number;         // inches (default 2.5")
  divisions?: WindowDivisions; // muntin grid (default '1x1')
  trim?: boolean;              // sill + head trim (default true)
  shutters?: boolean;          // pair of shutters (default false)
  lintel?: LintelOverride;
  operation?: WindowOperation; // copied from the type
  frameMaterial?: FrameMaterial;
  depthPosition?: DepthPosition; // frame position within the wall thickness (default 'center')
  flipFacing?: boolean;          // swaps which side of the wall is treated as the exterior
}

/** WALL OPENING (WO): an empty hole through a wall — rectangular or arched, no frame. */
export interface WallOpeningEntity extends BaseEntity {
  type: 'wallopening';
  mark?: string;
  wallId: string;
  offset: number;     // parametric 0..1 along the host wall (same hosting as doors / windows)
  width: number;      // inches
  height: number;     // inches (to the top of the arch for arched openings)
  sillHeight: number; // inches (0 = floor-level passage)
  shape: 'rect' | 'arch';
  comments?: string;
  lintel?: LintelOverride;
}

/** Override of the automatic lintel / header over a door or window. */
export interface LintelOverride {
  none?: boolean;
  label?: string;   // e.g. '2-2x10', 'LVL 3-1/2" x 11-7/8"', '8x16 precast'
  depth?: number;   // inches
  bearing?: number; // inches each side
}

export interface RoomEntity extends BaseEntity {
  type: 'room';
  mark?: string;       // e.g. '101', '102'
  name: string;
  wallIds: string[]; // IDs of bounding walls if hosted, or empty if custom polygon
  polygon: Point[];  // vertices in inches
  labelPos: Point;
  floorMaterial?: 'wood' | 'tile' | 'concrete' | 'stone';
  comments?: string;
}

export type DimensionType =
  | 'aligned'
  | 'linear'
  | 'angular'
  | 'radius'
  | 'diameter';

export type DimensionArrowType = 'tick' | 'arrow' | 'open-arrow' | 'dot';

export type WallFace = 'interior' | 'centerline' | 'exterior';

export interface DimensionAssociation {
  entityId1?: string;
  ref1?: 'start' | 'end' | 'center' | 'interior' | 'exterior' | 'centerline';
  offsetParam1?: number;
  entityId2?: string;
  ref2?: 'start' | 'end' | 'center' | 'interior' | 'exterior' | 'centerline';
  offsetParam2?: number;
}

export interface DimensionEntity extends BaseEntity {
  type: 'dimension';
  dimType?: DimensionType; // default 'aligned'
  p1: Point;
  p2: Point;
  offset: number; // perpendicular offset distance in inches (signed)
  linearOrientation?: 'horizontal' | 'vertical'; // for linear dimensions
  center?: Point;       // for angular, radius, diameter dimensions
  startAngle?: number;  // for angular dimensions (degrees)
  endAngle?: number;    // for angular dimensions (degrees)
  sweepAngle?: number;  // for angular dimensions (degrees)
  radius?: number;      // for radius / diameter / angular arc radius
  association?: DimensionAssociation;
  textOverride?: string;
}

export type TextAlignment = 'left' | 'center' | 'right';

export interface TextEntity extends BaseEntity {
  type: 'text';
  position: Point;
  text: string;
  fontSize: number; // height in inches (default 8")
  rotation: number; // degrees
  alignment?: TextAlignment;
}

export interface LeaderEntity extends BaseEntity {
  type: 'leader';
  arrowPoint: Point;    // Arrow tip location
  kneePoint: Point;     // Elbow shoulder point
  landingPoint: Point;  // Horizontal landing end point
  text: string;
  fontSize: number;
}

export type HatchPattern =
  | 'solid'
  | 'diagonal'
  | 'crosshatch'
  | 'brick'
  | 'concrete'
  | 'insulation';

export interface HatchEntity extends BaseEntity {
  type: 'hatch';
  polygon: Point[];
  pattern: HatchPattern;
  scale: number;        // default 1.0
  angle: number;        // degrees (default 0 or 45)
  color?: string;
  sourceEntityId?: string;
}

export interface TagEntity extends BaseEntity {
  type: 'tag';
  targetId: string;
  targetType: 'door' | 'window' | 'room' | 'wall';
  position: Point;
  tagNumber: string;    // e.g. "D1", "W1", "101"
  label: string;        // e.g. "Door 1", "36\" x 84\""
  subLabel?: string;
  shape: 'pill' | 'hexagon' | 'rectangle';
}

export type StarterComponentKind =
  | 'bed'
  | 'sofa'
  | 'table-chairs'
  | 'toilet'
  | 'sink'
  | 'bathtub'
  | 'kitchen-counter'
  | 'fridge'
  | 'stove'
  | 'stairs'
  | 'tree'
  | 'custom';

export type BlockCategory =
  | 'Furniture'
  | 'Plumbing'
  | 'Kitchen'
  | 'Architecture'
  | 'Site'
  | 'Custom'
  | 'Cabin & Living'
  | 'Kitchen & Bath'
  | 'Stairs, Porches & Site';

export interface BlockDefinition {
  id: string;
  name: string;
  category: BlockCategory;
  kind: StarterComponentKind;
  /** parametric 3D model from the component library (componentLibrary.ts / library3d.ts) */
  libKind?: string;
  /** search keywords */
  tags?: string[];
  /** where the 3D model sits: on the floor (default), hung from the ceiling, or high on a wall */
  mount?: 'floor' | 'ceiling' | 'wall-high';
  width: number;  // inches (X local span)
  depth: number;  // inches (Y local span)
  height: number; // inches (3D height)
  color: string;  // hex color for 3D material & 2D accent
  entities: ArchEntity[]; // 2D primitives in local coordinates centered around (0,0)
}

export interface BlockInstanceEntity extends BaseEntity {
  type: 'block';
  blockId: string;
  name: string;
  position: Point;
  rotation: number; // degrees
  scale: number;    // uniform scale factor (default 1)
  width: number;    // inches
  depth: number;    // inches
  height: number;   // inches (3D height)
  color: string;    // material color hex
}

export interface FloorEntity extends BaseEntity {
  type: 'floor';
  floorTypeId?: string;
  polygon: Point[];
  openings?: Point[][];   // Live cut openings / shafts through floor slab
  thickness: number;     // inches (default 250mm ~ 9.84")
  material: 'wood' | 'tile' | 'concrete' | 'stone';
  wallIds?: string[];    // if created by picking walls
  // ---- Structure ----
  structural?: boolean;          // structural floor (SB) — span arrow, rebar host
  foundation?: boolean;          // foundation slab / slab on grade (FS)
  spanAngle?: number;            // degrees, plan direction of the one-way span (arrow)
  structuralMaterialId?: string;
  thickenedEdge?: { width: number; depth: number } | null; // slab-on-grade turned-down edge (depth below slab bottom)
  vaporBarrier?: boolean;
  cover?: RebarCover;
}

export interface CustomEntity extends BaseEntity {
  type: 'custom';
  customCategory: string; // e.g. 'test-box'
  position: Point;
  width?: number;
  depth?: number;
  height?: number;
  elevationOffset?: number;
  [key: string]: any;
}

export type RoofStyle = 'flat' | 'shed' | 'gable' | 'hip' | 'mansard';

export type RoofMaterial =
  | 'asphalt-shingle'
  | 'standing-seam'
  | 'clay-tile'
  | 'slate'
  | 'membrane'
  | 'green-roof';

export interface RoofEntity extends BaseEntity {
  type: 'roof';
  /** Footprint at the wall line (eave support line). Legacy roofs (no roofVersion) stored the
   *  outline with the overhang already included and sat at their level's elevation. */
  polygon: Point[];
  roofStyle: RoofStyle;
  slope: number;         // pitch in degrees (e.g. 18.43° = 4:12); upper pitch for mansard
  thickness: number;     // roof assembly thickness in inches (default 8")
  overhang: number;      // eave overhang in inches (default 18" = 1'-6")
  ridgeAxis?: 'x' | 'y'; // preferred ridge direction for gable on square footprints
  color?: string;
  wallIds?: string[];
  roofVersion?: 2;
  /** Revit "Defines slope" per footprint edge (edge i = polygon[i] → polygon[i+1]). */
  edgeSlopes?: boolean[];
  baseOffset?: number;   // height of the wall line (plate) above the base level, inches
  fasciaDepth?: number;  // inches (default 8")
  gutter?: boolean;
  material?: RoofMaterial;
  parapetHeight?: number;      // flat roofs: parapet height above the roof (0 = none)
  mansardLowerSlope?: number;  // degrees (default 70°)
  mansardBreakInset?: number;  // horizontal inset of the mansard break from the wall line, inches
}

export interface SkylightEntity extends BaseEntity {
  type: 'skylight';
  roofId: string;
  position: Point;   // plan centre
  width: number;     // across the slope, inches
  length: number;    // along the slope, inches
}

export interface DormerEntity extends BaseEntity {
  type: 'dormer';
  roofId: string;
  position: Point;   // plan point of the dormer's front wall centre
  width: number;     // inches
  height: number;    // front wall height above the main roof surface to the dormer eave, inches
  slope?: number;    // dormer roof pitch, degrees (default = main roof slope)
  windowWidth?: number;
  windowHeight?: number;
}

export type SweepProfile = 'band' | 'cornice' | 'base' | 'reveal';

/** SWEEP / REVEAL: horizontal trim band (or recessed groove) along a wall's exterior face. */
export interface SweepEntity extends BaseEntity {
  type: 'sweep';
  wallId: string;
  profile: SweepProfile;
  height: number;    // bottom of the band above the wall base, inches
  size: number;      // band height, inches
  projection: number; // how far it projects (negative = recessed for reveals), inches
  color?: string;
}

export interface BalconyEntity extends BaseEntity {
  type: 'balcony';
  wallId: string;
  offset: number;          // 0..1 along wall (centre)
  width: number;           // along the wall, inches
  depth: number;           // projection from the exterior face, inches
  elevationOffset: number; // slab top above the wall's level, inches
  slabThickness: number;
  railingHeight: number;
  railingStyle: RailingStyle;
}

export type RailingStyle = 'balusters' | 'glass';

export interface RailingEntity extends BaseEntity {
  type: 'railing';
  path: Point[];
  height: number;          // inches (default 42")
  baseOffset: number;      // above level, inches
  style: RailingStyle;
  balusterSpacing: number; // inches (default 4")
}

export type ElevationAnnotationKind = 'dimension' | 'tag';

/** Annotation placed in an elevation view (coordinates: u along the view, z height, inches). */
export interface ElevationAnnotation {
  id: string;
  view: ElevationDirection;
  kind: ElevationAnnotationKind;
  p1: { u: number; z: number };
  p2?: { u: number; z: number };
  offset?: number;          // dimensions: perpendicular offset
  orientation?: 'horizontal' | 'vertical';
  targetWallId?: string;    // tags: wall whose finish is shown
  targetBand?: number;
}

export type StairTemplateShape =
  | 'straight'
  | 'straight-landing'
  | 'l-left'
  | 'l-right'
  | 'u-switchback'
  | 'u-3run'
  | 'winder-l'
  | 'winder-u'
  | 'spiral';

export type StairConstructionStyle =
  | 'closed-stringer'
  | 'open-stringer'
  | 'mono-stringer'
  | 'concrete-monolithic'
  | 'cabin-split-log';

export type StairLandingStructure =
  | 'monolithic'
  | 'timber-framed'
  | 'steel-cantilever';

export type StairRailingStyle =
  | 'wood-balusters'
  | 'steel-cable'
  | 'glass-panels'
  | 'cabin-peeled-log';

export type StairRailingSide = 'both' | 'left' | 'right' | 'none';

export type StairLocationLine = 'center' | 'left' | 'right';

export interface StairRun {
  id: string;
  start: Point;          // centerline start of this run in plan (inches)
  end: Point;            // centerline end of this run in plan (inches)
  width: number;         // run width in inches (default 42")
  numRisers: number;     // risers in this flight (>= 1)
  treadDepth: number;    // tread depth in inches (default 10" or 11")
  startRiserIndex: number; // 1-based riser index of first riser in this run
  baseElevationOffset: number; // elevation above stair base (inches) at bottom of run
  topElevationOffset: number;  // elevation above stair base (inches) at top of run
}

export interface StairLanding {
  id: string;
  afterRunIndex: number;   // 0 = between Run 1 and Run 2, 1 = between Run 2 and Run 3
  afterRiser: number;      // cumulative riser number where landing sits (e.g., 8)
  elevationOffset: number; // height above stair base elevation (e.g., 8 * riserHeight)
  polygon: Point[];        // closed 2D plan polygon connecting exit edge of Run i to entry edge of Run i+1
  depth: number;           // landing depth along primary turn/travel direction (default >= run width)
  width: number;           // landing width (for straight/L = run width; for U = 2 * run width + wellGap)
  thickness: number;       // landing structural thickness in inches (default 6")
  structure: StairLandingStructure;
  supportPosts?: boolean;  // optional support columns/posts down to the floor below
  cornerRadius?: number;   // optional curved outer corner radius (inches, 0 = square)
  intermediateStep?: boolean; // optional middle intermediate step on a U-landing
  customBoundary?: Point[];   // optional user-sketched/adjusted polygon override
}

export interface StairEntity extends BaseEntity {
  type: 'stair';
  start: Point;          // bottom of Run 1 (centerline start)
  end: Point;            // top of last run (centerline end)
  width: number;         // run width in inches (default 42")
  baseLevelId: string;   // e.g. 'level-1'
  topLevelId: string;    // e.g. 'level-2'
  numRisers: number;     // auto-calculated from level-to-level height
  desiredRisers?: number; // optional user override for desired riser count
  riserHeight: number;   // auto-calculated (inches)
  treadDepth: number;    // inches (default 11")
  baseOffset?: number;   // inches above base level (default 0)
  topOffset?: number;    // inches above top level (default 0)
  maxRiserHeight?: number; // building code max riser height (default 7.5")
  // ---- Multi-run, Landings, Templates, Styles & Floor Opening ----
  shape?: StairTemplateShape;
  runs?: StairRun[];
  landings?: StairLanding[];
  wellGap?: number;          // gap/well width between parallel U-stair flights (default 6")
  winderCount?: number;      // number of pie-shaped winder treads per 90° turn (default 3)
  spiralRadius?: number;     // outer radius for spiral stair (default 42")
  spiralInnerRadius?: number;// center column radius for spiral stair (default 4")
  spiralTurns?: number;      // total sweep degrees for spiral stair (default 360°)
  spiralClockwise?: boolean; // rotation direction for spiral stair
  constructionStyle?: StairConstructionStyle;
  landingStructure?: StairLandingStructure;
  landingThickness?: number;
  supportPosts?: boolean;
  railingStyle?: StairRailingStyle;
  railingSide?: StairRailingSide;
  railingHeight?: number;
  cutFloorAbove?: boolean;   // cuts matching stairwell opening in upper floor slab (default true)
  headroomTarget?: number;   // minimum headroom clearance in inches (default 80" = 6'-8")
  showRiserNumbers?: boolean;// show riser numbers 1..N in 2D plan (default true)
  showDimensions?: boolean;  // show permanent dimensions on stair
  locationLine?: StairLocationLine;
}

export interface ColumnEntity extends BaseEntity {
  type: 'column';
  columnTypeId?: string;
  position: Point;
  rotation: number;      // degrees
  shape: 'rectangular' | 'round';
  width: number;         // inches
  depth: number;         // inches
  height: number;        // inches (default 108")
  baseOffset?: number;   // inches (default 0)
  color?: string;
  // ---- Structure (upgrade of CL) ----
  structuralMaterialId?: string; // 'conc-4000', 'a992', 'glulam', ...
  profileId?: string;            // catalog profile for steel / wood ('W10x33', 'HSS6x6x3/8', '6x6', ...)
  topLevelId?: string;           // top attached to a level (height follows the level)
  topOffset?: number;            // inches above the top level
  topBeamId?: string;            // top attached to the underside of a beam
  cover?: RebarCover;
}

export interface GridEntity extends BaseEntity {
  type: 'grid';
  start: Point;          // bubble at start or end
  end: Point;
  label: string;         // e.g. 'A', 'B', 'C' or '1', '2', '3'
  showBubbleStart?: boolean;
  showBubbleEnd?: boolean;
}

// ============================================================================================
// STRUCTURE
// ============================================================================================

export interface RebarCover {
  top: number;    // inches
  bottom: number;
  sides: number;
}

export type FootingKind = 'isolated' | 'wall' | 'pilecap';

/** FOUNDATIONS: isolated pad (FT), strip under a wall (WF) or pile cap with piles (PC). */
export interface FootingEntity extends BaseEntity {
  type: 'footing';
  kind: FootingKind;
  position: Point;          // plan centre (isolated / pile cap); follows columnId when set
  rotation: number;         // degrees
  length: number;           // along local x (isolated / pile cap)
  width: number;            // along local y; strip width for wall footings
  thickness: number;
  topOffset: number;        // top of footing relative to the level (negative = below)
  columnId?: string;        // pad placed under this column (follows it)
  wallId?: string;          // strip footing under this wall (follows it)
  offset?: number;          // strip footing: offset of its centre from the wall centre line
  structuralMaterialId?: string;
  piles?: { count: number; diameter: number; length: number };
  cover?: RebarCover;
}

export type BeamUsage = 'beam' | 'brace' | 'joist' | 'ridge' | 'purlin' | 'rafter';
/** Decorative cut at the low (end) end of an exposed rafter tail / beam end. */
export type TailCut = 'square' | 'plumb' | 'bevel' | 'scroll';
export type TrussStyle = 'kingpost' | 'queenpost' | 'hammerbeam' | 'scissor';
export type BeamJustification = 'top' | 'center' | 'bottom';

/** BEAM (BM) / BRACE: a framing member along start→end. */
export interface BeamEntity extends BaseEntity {
  type: 'beam';
  usage: BeamUsage;
  start: Point;
  end: Point;
  structuralMaterialId: string;
  profileId?: string;       // steel / wood catalog profile
  width: number;            // concrete (or custom) section width
  depth: number;            // concrete (or custom) section depth
  topOffset: number;        // reference line height relative to the level (beam: top of steel at the level by default)
  startOffset: number;      // extension (+) / setback (−) at the start, along the axis
  endOffset: number;
  rotation: number;         // degrees about the member axis
  justification: BeamJustification;
  zStart?: number;          // brace / rafter: height of the start point above the level (sloped members)
  zEnd?: number;            // brace / rafter: height of the end point above the level
  cover?: RebarCover;
  /** exposed rafter tail / beam end decoration at the END of the member */
  tailCut?: TailCut;
  /** glulam camber at mid-span (inches, upward) */
  camber?: number;
  /** knee brace / corbel: curved (arched) instead of straight */
  curved?: boolean;
  /** knee brace: the post (column) and beam it connects (for mortise-and-tenon pegs in 3D) */
  kneeOf?: { columnId: string; beamId: string };
}

/** TIMBER TRUSS (TR): parametric king post / queen post / hammerbeam / scissor truss. */
export interface TrussEntity extends BaseEntity {
  type: 'truss';
  start: Point;             // bearing (heel) at one end, plan
  end: Point;               // bearing at the other end
  style: TrussStyle;
  pitch: number;            // degrees
  memberWidth: number;      // timber thickness (out of plane), inches
  memberDepth: number;      // timber depth (in plane), inches
  bearingZ: number;         // height of the bearing above the level (usually the wall top)
  overhang: number;         // top-chord overhang past each heel (plan), inches
  structuralMaterialId: string;
  tailCut?: TailCut;
}

/** BEAM SYSTEM (BS): joists filling a bay at a spacing and direction. */
export interface BeamSystemEntity extends BaseEntity {
  type: 'beamsystem';
  boundary: Point[];
  spacing: number;          // inches on centre
  angle: number;            // degrees: plan direction the joists run
  structuralMaterialId: string;
  profileId?: string;
  width: number;
  depth: number;
  topOffset: number;
}

export type RebarShape = 'straight' | 'hook90' | 'hook135' | 'ubar' | 'stirrup' | 'lbar';
export type RebarPlacement = 'bottom' | 'top' | 'side' | 'stirrup' | 'vertical' | 'tie' | 'x' | 'y';
export type RebarLayoutRule = 'single' | 'count' | 'maxSpacing' | 'countSpacing';

/** REBAR (RB): a set of bars in a concrete host. Geometry is always recomputed from the host. */
export interface RebarEntity extends BaseEntity {
  type: 'rebar';
  hostId: string;
  mark?: string;
  barSize: string;          // '#5', '15M', ...
  shape: RebarShape;
  placement: RebarPlacement;
  layout: { rule: RebarLayoutRule; count?: number; spacing?: number };
  cover?: Partial<RebarCover>; // per-bar override of the host cover
}

/** AREA REINFORCEMENT: top / bottom mats in two directions for slabs, walls and footings. */
export interface AreaReinforcementEntity extends BaseEntity {
  type: 'areareinf';
  hostId: string;
  mark?: string;
  barSize: string;
  spacing: number;
  topX: boolean;            // walls: "top" = exterior face, "bottom" = interior face; x = horizontal
  topY: boolean;
  bottomX: boolean;
  bottomY: boolean;
  angle?: number;           // degrees: major direction of the "x" bars (slabs)
  cover?: Partial<RebarCover>;
}

export type SteelConnectionKind = 'shear-plate' | 'end-plate' | 'clip-angle' | 'base-plate';

export interface ConnectionEntity extends BaseEntity {
  type: 'connection';
  kind: SteelConnectionKind;
  memberIds: string[];      // two members (beam + column / beam + beam), or a column for a base plate
  bolts?: number;
}

export type StructuralJointKind = 'control' | 'expansion' | 'construction';

/** Construction / control / expansion joint on a slab or wall. */
export interface StructuralJointEntity extends BaseEntity {
  type: 'sjoint';
  kind: StructuralJointKind;
  hostId: string;
  start: Point;
  end: Point;
  gap: number;              // expansion joint gap width, inches
}

export type LoadKind = 'point' | 'line' | 'area';

export interface LoadEntity extends BaseEntity {
  type: 'load';
  kind: LoadKind;
  points: Point[];
  value: number;
  unit: string;             // 'kip' | 'kip/ft' | 'psf' | 'kN' | 'kN/m' | 'kPa'
  zOffset?: number;         // height above the level the load acts at
}

/** SECTION: a cut line in plan; opens a structural section view. */
export interface SectionEntity extends BaseEntity {
  type: 'section';
  name: string;
  start: Point;
  end: Point;
  depth: number;            // view depth beyond the cut (inches), on the left of start→end
}

/** CAMERA (CAM): a saved 3D perspective view placed in plan. Hidden in 3D / elevations. */
export type CameraAspect = '16:9' | '4:3' | '1:1' | 'A3';
export interface CameraSun {
  enabled: boolean;
  month: number;            // 1–12
  day: number;              // 1–31
  hour: number;             // local solar time, 0–24 (decimal)
  latitude: number;         // degrees north (+) / south (−)
}
export interface CameraEntity extends BaseEntity {
  type: 'camera';
  name: string;
  position: Point;          // eye, in plan
  target: Point;            // look-at point in plan (its distance = target / far distance in plan)
  eyeHeight: number;        // inches above the ground under the camera (default 66" = 5'-6")
  targetHeight: number;     // inches above the same ground
  baseZ: number;            // absolute elevation of the ground under the camera (level / terrain)
  fov: number;              // HORIZONTAL field of view, degrees (20–100)
  near: number;             // clip distances, inches
  far: number;
  twoPoint?: boolean;       // keep verticals vertical (level camera + vertical lens shift)
  aspect: CameraAspect;     // crop
  sun?: CameraSun;
}

export type Discipline = 'architectural' | 'structural' | 'combined';

export interface StructureJoinSettings {
  unjoined: string[];       // pair keys 'idA|idB' (sorted) that must not join
  switched: string[];       // pair keys whose join order is switched (the default cut element cuts the other)
}

export type ArchEntity =
  | LineEntity
  | PolylineEntity
  | RectangleEntity
  | CircleEntity
  | ArcEntity
  | WallEntity
  | DoorEntity
  | WindowEntity
  | WallOpeningEntity
  | RoomEntity
  | DimensionEntity
  | TextEntity
  | LeaderEntity
  | HatchEntity
  | TagEntity
  | BlockInstanceEntity
  | FloorEntity
  | RoofEntity
  | SkylightEntity
  | DormerEntity
  | SweepEntity
  | BalconyEntity
  | RailingEntity
  | StairEntity
  | ColumnEntity
  | GridEntity
  | FootingEntity
  | BeamEntity
  | BeamSystemEntity
  | RebarEntity
  | AreaReinforcementEntity
  | ConnectionEntity
  | StructuralJointEntity
  | LoadEntity
  | SectionEntity
  | TrussEntity
  | CameraEntity
  | CustomEntity;

export type EntityType = ArchEntity['type'];

export type VisibilityCategory =
  | 'walls'
  | 'doors'
  | 'windows'
  | 'floors'
  | 'roofs'
  | 'stairs'
  | 'columns'
  | 'grids'
  | 'rooms'
  | 'furniture'
  | 'annotations'
  | 'lines'
  | 'structure';

export interface VisibilitySettings {
  plan2d: Record<VisibilityCategory, boolean>;
  view3d: Record<VisibilityCategory, boolean>;
}

export interface DimStyleSettings {
  textHeight: number;        // inches (e.g. 8")
  arrowType: DimensionArrowType; // 'tick' | 'arrow' | 'open-arrow' | 'dot'
  precision: number;         // 0 (1"), 1 (1/2" or 0.1"), 2 (1/4" or 0.01")
  baselineSpacing: number;   // inches between stacked baseline dimensions (default 18")
  extensionOvershoot: number;// inches (default 4")
  preferFace: 'auto' | WallFace;
}

/** Per-type switches for smart alignment guides (TRACK, F11). */
export interface SmartGuideSettings {
  alignment: boolean;     // horizontal / vertical alignment with endpoints & midpoints (+ guide crossings)
  extension: boolean;     // continuation past the end of existing lines / walls
  parallel: boolean;      // snap new segment exactly parallel to an existing one (±2°)
  perpendicular: boolean; // snap new segment exactly perpendicular to an existing one (±2°)
  equalLength: boolean;   // snap new segment length to exactly match an existing one
}

export interface ProjectSettings {
  units: UnitSystem;
  gridSize: number; // inches (e.g. 12" = 1'-0")
  snapSize: number; // inches (e.g. 6")
  gridVisible: boolean;
  snapEnabled: boolean;
  orthoEnabled: boolean;
  osnapEnabled: boolean;
  polarTracking: boolean; // F10
  polarIncrement: number; // 15, 30, 45, 90 degrees
  osnapTracking: boolean; // F11 — smart alignment guides (TRACK) on/off
  smartGuides?: SmartGuideSettings; // which guide types TRACK infers (default: all on)
  dynamicInput: boolean;  // F12
  enabledOsnaps: OsnapType[];
  revitStyleDI: boolean; // true = DI triggers Aligned Dimension; false = DI triggers Distance Measure
  dimStyle: DimStyleSettings;
  /** opacity of the background drawing grid in plans (0–1, default 1); it always draws behind the drawing */
  gridOpacity?: number;
  trimMode?: 'quick' | 'standard'; // AutoCAD 2021+ Quick vs Standard
  edgeMode?: 'extend' | 'noextend'; // Implied intersections setting in Standard mode
}

export type SheetSize = 'A3' | 'Tabloid' | 'A1';

export type SheetScalePreset =
  | '1/4" = 1\'-0"'
  | '1/8" = 1\'-0"'
  | '3/16" = 1\'-0"'
  | '1/2" = 1\'-0"'
  | '1:50'
  | '1:100'
  | '1:200';

export type SheetViewportKind =
  | 'plan'
  | '3d'
  | 'schedule-doors'
  | 'schedule-windows'
  | 'schedule-rooms'
  | 'elevation'
  | 'roofplan'
  | 'foundationplan'
  | 'framingplan'
  | 'section'
  | 'schedule-footings'
  | 'schedule-columns'
  | 'schedule-beams'
  | 'schedule-rebar'
  | 'camera';

export interface SheetViewport {
  id: string;
  kind: SheetViewportKind;
  title: string;
  levelId?: string;        // for 'plan' viewports
  elevationDir?: ElevationDirection; // for 'elevation' viewports
  sectionId?: string;      // for 'section' viewports
  cameraId?: string;       // for 'camera' viewports (rendered perspective image)
  scale: SheetScalePreset; // e.g. '1/4" = 1\'-0"' or '1:50'
  x: number;               // position in sheet mm from top-left
  y: number;               // position in sheet mm from top-left
  width: number;           // width in sheet mm
  height: number;          // height in sheet mm
}

export interface SheetDefinition {
  id: string;
  sheetNumber: string;     // e.g. 'A101', 'A102'
  title: string;           // e.g. 'Floor Plans & Schedules'
  size: SheetSize;         // 'A3' | 'Tabloid' | 'A1'
  date: string;            // e.g. '2025-05-15'
  scaleLabel: string;      // e.g. '1/4" = 1\'-0"' or 'As Noted'
  drawnBy?: string;
  checkedBy?: string;
  viewports: SheetViewport[];
}

export type DetailLevel = 'coarse' | 'medium' | 'fine';
export type VisualStyle = 'wireframe' | 'hidden-line' | 'shaded' | 'realistic';
export type ElevationDirection = 'north' | 'south' | 'east' | 'west';

export interface ArchModel {
  schemaVersion?: number;  // Versioned JSON schema (v2)
  projectName: string;
  layers: Layer[];
  activeLayer: LayerId;
  entities: ArchEntity[];
  blocks?: BlockDefinition[];
  levels?: LevelDefinition[];
  activeLevelId?: string;
  activeElevationDir?: ElevationDirection;
  sectionCutCoord?: number; // Section plane world coordinate (inches)
  viewDetailLevel?: DetailLevel;
  viewVisualStyle?: VisualStyle;
  viewScale?: SheetScalePreset;
  devMode?: boolean;       // Dev flag for experimental categories (TestBox)
  wallTypes?: WallType[];
  floorTypes?: FloorType[];
  columnTypes?: ColumnType[];
  doorTypes?: DoorType[];
  windowTypes?: WindowType[];
  visibility?: VisibilitySettings;
  sheets?: SheetDefinition[];
  activeSheetId?: string;
  elevationAnnotations?: ElevationAnnotation[];
  structureJoins?: StructureJoinSettings;
  settings: ProjectSettings;
}

export type ToolId =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'wall'
  | 'door'
  | 'window'
  | 'wallopening'
  | 'walljoin'
  | 'room'
  | 'floor'
  | 'roof'
  | 'skylight'
  | 'dormer'
  | 'curtainwall'
  | 'paint'
  | 'splitface'
  | 'sweep'
  | 'reveal'
  | 'balcony'
  | 'railing'
  | 'stair'
  | 'column'
  | 'grid'
  | 'block'
  | 'insert'
  | 'bedit'
  | 'dimension'
  | 'dli'
  | 'dan'
  | 'dra'
  | 'ddi'
  | 'dco'
  | 'dba'
  | 'dist'
  | 'area'
  | 'text'
  | 'leader'
  | 'hatch'
  | 'tag'
  | 'move'
  | 'copy'
  | 'rotate'
  | 'erase'
  | 'offset'
  | 'trim'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'mirror'
  | 'array'
  | 'scale'
  | 'stretch'
  | 'break'
  | 'join'
  | 'explode'
  | 'align'
  | 'matchprop'
  | 'corner'
  | 'footing'
  | 'wallfooting'
  | 'foundationslab'
  | 'pilecap'
  | 'beam'
  | 'beamsystem'
  | 'brace'
  | 'rebar'
  | 'areareinf'
  | 'connection'
  | 'sjoint'
  | 'load'
  | 'section'
  | 'truss'
  | 'kneebrace'
  | 'roofframing'
  | 'camera';

export type ViewMode = '2d' | '3d' | 'split' | 'schedules' | 'sheets' | 'elevation' | 'section' | 'roofplan' | 'foundationplan' | 'framingplan' | 'stsection';

export type OsnapType =
  | 'Endpoint'
  | 'Midpoint'
  | 'Center'
  | 'Intersection'
  | 'Perpendicular'
  | 'Nearest'
  | 'Quadrant'
  | 'Tangent'
  | 'Extension';

export interface OsnapResult {
  type: OsnapType;
  point: Point;
  entityId?: string;
}

export interface GripPoint {
  entityId: string;
  gripIndex: string; // e.g., 'start', 'end', 'mid', 'center', 'radius', 'p1', 'p2', 'offset', 'vertex-0'
  point: Point;
  kind: 'endpoint' | 'midpoint' | 'center';
}

export interface CommandLogEntry {
  id: string;
  timestamp: string;
  text: string;
  kind: 'input' | 'info' | 'error' | 'result';
}
