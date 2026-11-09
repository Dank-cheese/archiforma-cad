import { ToolId } from '../types/model';

export interface CommandContext {
  activateTool: (tool: ToolId) => void;
  deleteSelectionOrStartErase: () => void;
  undo: () => void;
  redo: () => void;
  zoomExtents: () => void;
  openLayersPanel: () => void;
  openPropertiesPanel: () => void;
  openHelpModal: () => void;
  selectAll: () => void;
  logMessage: (text: string, kind?: 'input' | 'info' | 'error' | 'result') => void;
  isRevitStyleDI: boolean;
  openDimStyleModal?: () => void;
  openLibraryTab?: () => void;
  openBlockEditor?: (blockId?: string) => void;
  openLevelManager?: () => void;
  openLevelModal?: () => void;
  openVisibilityModal?: () => void;
  hideSelectedElements?: () => void;
  isolateSelectedElements?: () => void;
  resetTemporaryHideIsolate?: () => void;
  tempHideSelected?: () => void;
  tempIsolateSelected?: () => void;
  tempResetHideIsolate?: () => void;
  openSchedulesView?: () => void;
  openSheetsView?: () => void;
  exportDxf?: () => void;
  exportIfc?: () => void;
  exportPdf?: () => void;
  openShortcutCheatSheet?: () => void;
  startGuidedTour?: () => void;
  loadStressTest?: () => void;
  openElevation?: (dir: 'north' | 'south' | 'east' | 'west') => void;
  openRoofPlan?: () => void;
  attachSelectedWallsToRoof?: () => void;
  detachSelectedWalls?: () => void;
  openStructuralView?: (kind: 'foundationplan' | 'framingplan' | 'stsection') => void;
  setDiscipline?: (d: 'architectural' | 'structural' | 'combined') => void;
  toggleAnalytical?: () => void;
  toggleViewRebar?: () => void;
  toggleSectionBox?: () => void;
  navViewCube?: () => void;
  toggleXray?: () => void;
  structureJoin?: (action: 'join' | 'unjoin' | 'switch') => void;
  attachColumnTopToBeam?: () => void;
  applyRebarPresetToSelection?: () => void;
  equalizeOpenings?: () => void;
}

export interface CommandDefinition {
  id: string;
  name: string;
  aliases: string[];
  category: 'Draw' | 'Build (BIM)' | 'Roofs & Facades' | 'Structure' | 'Edit' | 'Annotate & Measure' | 'View & Panels';
  primaryAlias: string;
  description: string;
  conflictNote?: string;
  howToUse: string[];
  run: (ctx: CommandContext) => void;
}

export const COMMAND_REGISTRY: CommandDefinition[] = [
  // --- DRAW (2D CAD) ---
  {
    id: 'line',
    name: 'Line',
    primaryAlias: 'L',
    aliases: ['L', 'LINE'],
    category: 'Draw',
    description: 'Draws straight 2D line segments from point to point.',
    howToUse: [
      'Type L or LINE and press Enter (or click Line in the toolbar).',
      'Click the start point on the canvas or type x,y coordinates.',
      'Click the end point or type @dx,dy / @length<angle / length.',
    ],
    run: (ctx) => ctx.activateTool('line'),
  },
  {
    id: 'polyline',
    name: 'Polyline',
    primaryAlias: 'PL',
    aliases: ['PL', 'PLINE', 'POLYLINE'],
    category: 'Draw',
    description: 'Draws a connected sequence of line segments as a single object.',
    howToUse: [
      'Type PL or PLINE and press Enter.',
      'Click each vertex in sequence (or type coordinates/distances).',
      'Press Enter to finish an open polyline, or type C and Enter to close it.',
    ],
    run: (ctx) => ctx.activateTool('polyline'),
  },
  {
    id: 'rectangle',
    name: 'Rectangle',
    primaryAlias: 'REC',
    aliases: ['REC', 'RECTANG', 'RECT', 'RECTANGLE'],
    category: 'Draw',
    description: 'Draws a rectangle defined by two opposite corner points.',
    howToUse: [
      'Type REC or RECTANG and press Enter.',
      'Click the first corner point.',
      'Click the opposite corner point or type @width,height.',
    ],
    run: (ctx) => ctx.activateTool('rectangle'),
  },
  {
    id: 'circle',
    name: 'Circle',
    primaryAlias: 'C',
    aliases: ['C', 'CIRCLE'],
    category: 'Draw',
    description: 'Draws a circle by center point and radius.',
    howToUse: [
      'Type C or CIRCLE and press Enter.',
      'Click the center point.',
      'Move cursor and click to set radius, or type the exact radius and press Enter.',
    ],
    run: (ctx) => ctx.activateTool('circle'),
  },
  {
    id: 'arc',
    name: 'Arc (3-Point)',
    primaryAlias: 'A',
    aliases: ['A', 'ARC'],
    category: 'Draw',
    description: 'Draws a circular arc passing through three points.',
    howToUse: [
      'Type A or ARC and press Enter.',
      'Click the start point of the arc.',
      'Click a second point along the curve, then click the end point.',
    ],
    run: (ctx) => ctx.activateTool('arc'),
  },

  // --- BUILD (BIM) ---
  {
    id: 'wall',
    name: 'Wall',
    primaryAlias: 'WA',
    aliases: ['WA', 'WALL'],
    category: 'Build (BIM)',
    description: 'Draws parametric 2D/3D architectural walls that auto-join at corners.',
    howToUse: [
      'Type WA or WALL and press Enter.',
      'Click the wall start point, then click consecutive points to chain walls.',
      'Press Enter or Esc to finish chaining walls. Edit thickness/height in Properties.',
    ],
    run: (ctx) => ctx.activateTool('wall'),
  },
  {
    id: 'door',
    name: 'Door',
    primaryAlias: 'DR',
    aliases: ['DR', 'DOOR'],
    category: 'Build (BIM)',
    description: 'Places a door embedded in a wall: it cuts the wall in plan and 3D and moves with the wall.',
    howToUse: [
      'Type DR or DOOR and press Enter. Pick a type in the options bar (30–36" singles, double, sliding glass, garage).',
      'Hover a wall: the door snaps into it, centred in the thickness. Red means it does not fit (overlap or past the wall end).',
      'It swings toward the side your cursor is on. SPACE flips the swing; Shift+Space flips the hinge.',
      'Light-blue temporary dimensions show the distance to the wall ends, neighbours and grids. Click a number and type a value.',
      'Click to place. The tool stays active for more doors; Esc to finish.',
    ],
    run: (ctx) => ctx.activateTool('door'),
  },
  {
    id: 'window',
    name: 'Window',
    primaryAlias: 'WN',
    aliases: ['WN', 'WINDOW', 'WIN'],
    category: 'Build (BIM)',
    description: 'Places a window embedded in a wall: a real hole with frame, glass and sill at the chosen depth.',
    howToUse: [
      'Type WN or WINDOW and press Enter. Pick a type (sliders, fixed picture, casement, double-hung, awning).',
      'Choose Depth: Ext / Center / Int (custom offset under More…).',
      'Hover a wall to preview, snapping to Center and EQ (equal spacing). SPACE flips the exterior side.',
      'Click a light-blue dimension to type an exact distance, or click to place. Esc to finish.',
    ],
    run: (ctx) => ctx.activateTool('window'),
  },
  {
    id: 'wallopening',
    name: 'Wall Opening',
    primaryAlias: 'WO',
    aliases: ['WO', 'OPENING', 'WALLOPENING'],
    category: 'Build (BIM)',
    description: 'Cuts an empty rectangular or arched hole through a wall (no frame).',
    howToUse: [
      'Type WO and press Enter. Choose Rectangular or Arched, plus width and height, in the options bar (sill under More…).',
      'Hover a wall and click to cut the opening. Temporary dimensions work as they do for doors.',
      'It is hosted like a door: it moves with the wall, and you can drag it along or onto another wall.',
    ],
    run: (ctx) => ctx.activateTool('wallopening'),
  },
  {
    id: 'walljoin',
    name: 'Wall Join',
    primaryAlias: 'WJ',
    aliases: ['WJ', 'WALLJOIN', 'JOINWALLS'],
    category: 'Build (BIM)',
    description: 'Controls wall cleanup at a corner: Miter, Butt, Square off, or Disallow join (keep a visible seam).',
    howToUse: [
      'Type WJ and press Enter, then click near a wall corner. Each click cycles Miter → Butt → Square off → Disallow join.',
      'Shift+click a Butt / Square-off corner to swap which wall runs through.',
      'Click a T-junction to allow or disallow the clean T. Walls of the same type that line up end-to-end heal into one wall automatically (unless the join is disallowed).',
    ],
    run: (ctx) => ctx.activateTool('walljoin'),
  },
  {
    id: 'camera',
    name: 'Camera',
    primaryAlias: 'CAM',
    aliases: ['CAM', 'CAMERA', '3DCAMERA'],
    category: 'View & Panels',
    description: 'Places a camera in plan and creates a saved 3D perspective view (Camera 1, 2, 3…).',
    howToUse: [
      'Type CAM and press Enter. Click the camera position — the eye is 5\'-6" above the ground under it.',
      'Move the mouse to aim: the blue wedge points at the cursor; its distance is the target distance. Click to lock the direction.',
      'Move sideways to widen or narrow the view (20°–100°; FOV and lens are shown live), then click to finish. The view opens.',
      'Mouse wheel changes the FOV at any step; type a number to set an exact distance (step 2) or angle (step 3), or e.g. 35mm for a lens.',
      'A live 3D preview follows the mouse in the corner while you place it. Open cameras from the Views list in the right panel.',
    ],
    run: (ctx) => ctx.activateTool('camera'),
  },
  {
    id: 'equalize-openings',
    name: 'Equal Spacing (Openings)',
    primaryAlias: 'EQ',
    aliases: ['EQ', 'EQUALIZE'],
    category: 'Build (BIM)',
    description: 'Spaces the selected doors / windows on a wall equally (equal clear gaps, wall ends included).',
    howToUse: [
      'Select two or more openings on the same wall, or select a wall to space all of its openings.',
      'Type EQ and press Enter.',
    ],
    run: (ctx) => (ctx.equalizeOpenings ? ctx.equalizeOpenings() : ctx.logMessage('EQ is available in the plan view.', 'error')),
  },
  {
    id: 'room',
    name: 'Room',
    primaryAlias: 'RM',
    aliases: ['RM', 'ROOM'],
    category: 'Build (BIM)',
    description: 'Creates a room with automatic boundary detection, floor slab, and live area tag.',
    howToUse: [
      'Type RM or ROOM and press Enter.',
      'Click inside any area enclosed by walls.',
      'ARCHIFORMA automatically detects the room boundary, computes sq ft / m², and adds a 3D floor slab.',
    ],
    run: (ctx) => ctx.activateTool('room'),
  },
  {
    id: 'block',
    name: 'Create Block',
    primaryAlias: 'B',
    aliases: ['B', 'BLOCK', 'WBLOCK', 'WB'],
    category: 'Build (BIM)',
    description:
      'Saves selected objects and a base point as a reusable named block in the Library.',
    howToUse: [
      'Select objects on the canvas, then type B or BLOCK and press Enter.',
      'Click the insertion base point for the block (or press Enter for center).',
      'Enter a name for the block in the command line (or dialog) and press Enter.',
    ],
    run: (ctx) => ctx.activateTool('block'),
  },
  {
    id: 'insert',
    name: 'Insert Block',
    primaryAlias: 'I',
    aliases: ['I', 'INSERT', 'INS'],
    category: 'Build (BIM)',
    description:
      'Places a block from the left-side Library tab onto the plan with rotation and scale.',
    howToUse: [
      'Type I or INSERT and press Enter (opens the Library tab on the left).',
      'Pick a component/block thumbnail, set rotation or scale (or press R to rotate 90°), and click on the plan to place.',
    ],
    run: (ctx) => {
      if (ctx.openLibraryTab) ctx.openLibraryTab();
      ctx.activateTool('insert');
    },
  },
  {
    id: 'component',
    name: 'Place a Component (Revit)',
    primaryAlias: 'CM',
    aliases: ['CM', 'COMPONENT'],
    category: 'Build (BIM)',
    description:
      'Opens the Component Library tab to place 2D/3D architectural components (bed, sofa, toilet, sink, stairs, tree, etc.).',
    howToUse: [
      'Type CM and press Enter to open the Component Library tab.',
      'Click any component thumbnail and click on the canvas to place it in 2D and 3D.',
    ],
    run: (ctx) => {
      if (ctx.openLibraryTab) ctx.openLibraryTab();
      ctx.activateTool('insert');
    },
  },
  {
    id: 'bedit',
    name: 'Block Editor',
    primaryAlias: 'BE',
    aliases: ['BE', 'BEDIT', 'REFEDIT'],
    category: 'Build (BIM)',
    description:
      'Edits a block definition (geometry, default sizes, and material color); all instances in the project update automatically.',
    howToUse: [
      'Select a placed block (or type BE / BEDIT directly and press Enter).',
      'Modify the block geometry, dimensions (width, depth, height), or color in the Block Editor.',
      'Click Save Block Definition to update all instances across 2D and 3D.',
    ],
    run: (ctx) => {
      if (ctx.openBlockEditor) {
        ctx.openBlockEditor();
      } else {
        ctx.activateTool('bedit');
      }
    },
  },
  {
    id: 'floor',
    name: 'Floor Slab',
    primaryAlias: 'SB',
    aliases: ['SB', 'FLOOR', 'SLAB'],
    category: 'Build (BIM)',
    description:
      'Creates a structural or architectural floor slab by sketching a boundary polygon or picking enclosed walls.',
    howToUse: [
      'Type SB or FLOOR and press Enter.',
      'Press W (or click inside enclosed walls) to create a floor from walls, or click boundary vertices and press Enter to finish.',
      'Edit floor thickness and Floor Type in the Properties panel.',
    ],
    run: (ctx) => ctx.activateTool('floor'),
  },
  {
    id: 'roof',
    name: 'Roof by Footprint',
    primaryAlias: 'RF',
    aliases: ['RF', 'ROOF'],
    category: 'Roofs & Facades',
    description:
      'Creates a Flat, Shed, Gable, Hip or Mansard roof by picking walls (Tab = whole connected chain) or sketching the outline. Works on rectangles and L-, T-, U-shaped footprints; each edge can define slope (gable ends when it does not).',
    howToUse: [
      'Type RF (or click Roof in the Build toolbar). Choose the roof type and slope (4:12 or degrees) in the options bar.',
      'Pick walls: click walls one by one, or hover a wall and press Tab to pick its whole connected chain. Or switch to Sketch and click the outline corners.',
      'Press Enter (or Finish ✓). In Properties, untick "Defines slope" on an edge to make it a gable end; set overhang, thickness, fascia, gutter and material.',
      'Select gable-end walls and click "Attach to roof" (AT) so they grow up to the roof underside. Drag the overhang or ridge-height grips to adjust.',
    ],
    run: (ctx) => ctx.activateTool('roof'),
  },
  {
    id: 'skylight',
    name: 'Skylight',
    primaryAlias: 'SKY',
    aliases: ['SKY', 'SKYLIGHT'],
    category: 'Roofs & Facades',
    description: 'Places a skylight on a sloped roof face. It cuts the roof in 3D.',
    howToUse: ['Type SKY. Set width and length (along the slope) in the options bar.', 'Click on a sloped roof face. Drag its grip to move it; edit size in Properties.'],
    run: (ctx) => ctx.activateTool('skylight'),
  },
  {
    id: 'dormer',
    name: 'Dormer',
    primaryAlias: 'DMR',
    aliases: ['DMR', 'DORMER'],
    category: 'Roofs & Facades',
    description: 'Adds a simple gable dormer with a window on a sloped roof face.',
    howToUse: ['Type DMR. Set width and height in the options bar.', 'Click on a sloped roof face where the dormer front should be.', 'Edit window size and dormer slope in Properties.'],
    run: (ctx) => ctx.activateTool('dormer'),
  },
  {
    id: 'attachtop',
    name: 'Attach Walls to Roof',
    primaryAlias: 'AT',
    aliases: ['AT', 'ATTACH'],
    category: 'Roofs & Facades',
    description: 'Revit "Attach Top/Base": selected walls grow up to meet the roof underside (gable ends). Detach with DTR.',
    howToUse: ['Select one or more walls under a roof.', 'Type AT (or click "Attach to roof" in Properties). Changing the roof slope updates the walls.'],
    run: (ctx) => ctx.attachSelectedWallsToRoof?.(),
  },
  {
    id: 'detachtop',
    name: 'Detach Walls from Roof',
    primaryAlias: 'DTR',
    aliases: ['DTR', 'DETACH'],
    category: 'Roofs & Facades',
    description: 'Restores the flat top of walls that were attached to a roof (DTR — DT is TEXT).',
    howToUse: ['Select attached walls and type DTR (or click "Detach" in Properties).'],
    run: (ctx) => ctx.detachSelectedWalls?.(),
  },
  {
    id: 'curtainwall',
    name: 'Curtain Wall',
    primaryAlias: 'CW',
    aliases: ['CW', 'CURTAINWALL'],
    category: 'Roofs & Facades',
    description: 'Draws a curtain wall: a glass grid with mullions. Each cell can be Glass, Solid or Door.',
    howToUse: [
      'Type CW, set grid spacing in the options bar, then click wall points like WALL; press Enter to finish.',
      'In an elevation, click a cell to cycle Glass → Solid → Door → Window. Set spacing, mullion size and colour in Properties.',
    ],
    run: (ctx) => ctx.activateTool('curtainwall'),
  },
  {
    id: 'paint',
    name: 'Paint Finish',
    primaryAlias: 'PT',
    aliases: ['PT', 'PAINT'],
    category: 'Roofs & Facades',
    description: 'Applies an exterior finish (Brick, Lap Siding, Board & Batten, Stucco, Stone, Wood, Fiber-Cement, Concrete) to a wall face — like Revit Paint.',
    howToUse: ['Type PT and choose the finish in the options bar.', 'Click a wall face in an elevation or 3D (or a wall in plan). Split faces are painted band by band.'],
    run: (ctx) => ctx.activateTool('paint'),
  },
  {
    id: 'splitface',
    name: 'Split Face',
    primaryAlias: 'SF',
    aliases: ['SF', 'SPLITFACE'],
    category: 'Roofs & Facades',
    description: 'Divides a wall\'s exterior face horizontally (e.g. stone base + siding above) so each part gets its own finish.',
    howToUse: ['Open an elevation (Elevations ▾), type SF.', 'Click a wall face at the height of the split. Then use PAINT (PT) on each part.'],
    run: (ctx) => ctx.activateTool('splitface'),
  },
  {
    id: 'sweep',
    name: 'Wall Sweep',
    primaryAlias: 'SWP',
    aliases: ['SWP', 'SWEEP'],
    category: 'Roofs & Facades',
    description: 'Adds a horizontal trim band, cornice or base along a wall\'s exterior at a chosen height.',
    howToUse: ['Type SWP, choose Band / Cornice / Base and the height in the options bar.', 'Click a wall. Edit height, size and colour in Properties.'],
    run: (ctx) => ctx.activateTool('sweep'),
  },
  {
    id: 'reveal',
    name: 'Wall Reveal',
    primaryAlias: 'RVL',
    aliases: ['RVL', 'REVEAL'],
    category: 'Roofs & Facades',
    description: 'Adds a recessed horizontal groove along a wall\'s exterior.',
    howToUse: ['Type RVL, set the height in the options bar.', 'Click a wall.'],
    run: (ctx) => ctx.activateTool('reveal'),
  },
  {
    id: 'balcony',
    name: 'Balcony',
    primaryAlias: 'BAL',
    aliases: ['BAL', 'BALCONY'],
    category: 'Roofs & Facades',
    description: 'A slab with a railing attached to a wall\'s exterior at a level.',
    howToUse: ['Type BAL. Set width, depth and railing style in the options bar (floor height under More…).', 'Click an exterior wall where the balcony should be centred.'],
    run: (ctx) => ctx.activateTool('balcony'),
  },
  {
    id: 'railing',
    name: 'Railing',
    primaryAlias: 'RAIL',
    aliases: ['RAIL', 'RAILING'],
    category: 'Roofs & Facades',
    description: 'A railing along a picked path: top rail with balusters or glass panels.',
    howToUse: ['Type RAIL and choose Balusters or Glass panels.', 'Click the path points, then press Enter.'],
    run: (ctx) => ctx.activateTool('railing'),
  },
  {
    id: 'elevations',
    name: 'Elevations',
    primaryAlias: 'EL',
    aliases: ['EL', 'ELEV', 'ELEVATION'],
    category: 'Roofs & Facades',
    description: 'Opens the live North / South / East / West elevations (also: click an elevation marker in plan).',
    howToUse: ['Type EL (opens the South elevation) or use Elevations ▾ in the top bar.', 'Switch direction with the tabs; toggle shading and shadows; export PNG; place the view on a sheet.'],
    run: (ctx) => ctx.openElevation?.('south'),
  },
  {
    id: 'roofplan',
    name: 'Roof Plan',
    primaryAlias: 'RP',
    aliases: ['RP', 'ROOFPLAN'],
    category: 'Roofs & Facades',
    description: 'Shows all roofs from above with ridges, hips, valleys and slope arrows.',
    howToUse: ['Type RP or choose Roof Plan under Elevations ▾.'],
    run: (ctx) => ctx.openRoofPlan?.(),
  },
  // ---------------------------------------------------------------------------------------------
  // STRUCTURE — for design visualization and coordination only (not engineering)
  // ---------------------------------------------------------------------------------------------
  {
    id: 'footing',
    name: 'Isolated Footing',
    primaryAlias: 'FT',
    aliases: ['FT', 'FOOTING'],
    category: 'Structure',
    description: 'Pad footing under a column (width, length, thickness, top elevation). Shown dashed in plan, below grade in 3D, strong in the Foundation Plan.',
    howToUse: [
      'Select columns (or a grid line) and type FT to place one footing under each of them — or type FT and click columns.',
      'Auto-size from the column, or turn it off in the options bar to set length / width; thickness and top elevation under More….',
      'The footing follows its column when the column moves. Add bars with a Quick Preset in Properties (#5 @ 10" EW bottom).',
    ],
    run: (ctx) => ctx.activateTool('footing'),
  },
  {
    id: 'wallfooting',
    name: 'Wall Footing',
    primaryAlias: 'WF',
    aliases: ['WF', 'WALLFOOTING'],
    category: 'Structure',
    description: 'Strip footing under walls (width, thickness, offset from the wall centre); follows the wall.',
    howToUse: ['Select walls and type WF, or type WF and click walls.', 'Edit width, thickness and offset in Properties.'],
    run: (ctx) => ctx.activateTool('wallfooting'),
  },
  {
    id: 'foundationslab',
    name: 'Foundation Slab / Slab on Grade',
    primaryAlias: 'FS',
    aliases: ['FS', 'SOG', 'FOUNDATIONSLAB'],
    category: 'Structure',
    description: 'Slab on grade from walls or a sketched boundary: thickness, thickened edges, vapor barrier on/off.',
    howToUse: ['Type FS, then click inside an area enclosed by walls — or click boundary points and press Enter.', 'Thickened edge and vapor barrier are in the options bar / Properties.'],
    run: (ctx) => ctx.activateTool('foundationslab'),
  },
  {
    id: 'pilecap',
    name: 'Pile Cap + Piles',
    primaryAlias: 'PC',
    aliases: ['PC', 'PILECAP'],
    category: 'Structure',
    description: 'Pile cap under a column with 1–9 piles (count, diameter, length) — piles show dashed in plan and below grade in 3D.',
    howToUse: ['Type PC and click a column (or select columns first).', 'Set pile count, diameter and length in the options bar (More…) or Properties.'],
    run: (ctx) => ctx.activateTool('pilecap'),
  },
  {
    id: 'beam',
    name: 'Beam',
    primaryAlias: 'BM',
    aliases: ['BM', 'BEAM'],
    category: 'Structure',
    description: 'Beam column-to-column or grid-to-grid: steel W / C / L, concrete rectangle, wood (2x, LVL, glulam). Snaps to column centres and wall tops; cut back at column faces automatically.',
    howToUse: [
      'Type BM, choose material and section in the options bar (top offset and justification under More…).',
      'Click the start and end — beams chain from the last end. Press Esc or Enter to stop.',
      'Properties: top offset, start / end offsets, rotation, justification (top / center / bottom).',
    ],
    run: (ctx) => ctx.activateTool('beam'),
  },
  {
    id: 'beamsystem',
    name: 'Beam System (Joists)',
    primaryAlias: 'BS',
    aliases: ['BS', 'BEAMSYSTEM', 'JOISTS'],
    category: 'Structure',
    description: 'Fills a bay bounded by beams or walls with joists at a spacing (e.g. 2x10 @ 16" o.c.) and direction.',
    howToUse: ['Type BS, pick the joist section and spacing.', 'Click inside a bay. Change direction / spacing in Properties.'],
    run: (ctx) => ctx.activateTool('beamsystem'),
  },
  {
    id: 'brace',
    name: 'Brace',
    primaryAlias: 'BRC',
    aliases: ['BRC', 'BRACE'],
    category: 'Structure',
    description: 'Diagonal brace between two points with start / end heights (BR is BREAK).',
    howToUse: ['Type BRC, set start / end heights in the options bar.', 'Click the start and end points in plan; edit heights in Properties.'],
    run: (ctx) => ctx.activateTool('brace'),
  },
  {
    id: 'rebar',
    name: 'Rebar',
    primaryAlias: 'RB',
    aliases: ['RB', 'REBAR'],
    category: 'Structure',
    description: 'Bars in any concrete host (footing, column, beam, slab, wall): sizes #3–#11 / 10M–35M; straight, hooks, U, stirrup / tie, L; single, number, max spacing or number + spacing. Always inside host minus cover — updates when the host is resized.',
    howToUse: [
      'Type RB, pick size, placement and layout in the options bar (shape under More…).',
      'Click a concrete host. Cover per host in its Properties; override per bar set under More….',
      'Quick presets: select a beam / column / footing / slab and click the preset in Properties (or type RBP).',
    ],
    run: (ctx) => ctx.activateTool('rebar'),
  },
  {
    id: 'areareinf',
    name: 'Area Reinforcement',
    primaryAlias: 'ARN',
    aliases: ['ARN', 'AREAREINF'],
    category: 'Structure',
    description: 'Top / bottom mats in two directions for slabs, walls and footings, e.g. "#4 @ 12" EW T&B" (AR is ARRAY).',
    howToUse: ['Type ARN, set bar size, spacing and mats.', 'Click a slab, wall or footing.'],
    run: (ctx) => ctx.activateTool('areareinf'),
  },
  {
    id: 'rebarpreset',
    name: 'Rebar Quick Preset',
    primaryAlias: 'RBP',
    aliases: ['RBP', 'REBARPRESET'],
    category: 'Structure',
    description: 'Adds the standard preset to each selected host: beam 4 #6 bottom, 2 #5 top, #3 stirrups @ 6"; column 8 #8 + #3 ties @ 12"; footing #5 @ 10" EW bottom; slab #4 @ 12" EW.',
    howToUse: ['Select concrete hosts, type RBP.'],
    run: (ctx) => ctx.applyRebarPresetToSelection?.(),
  },
  {
    id: 'connection',
    name: 'Steel Connection',
    primaryAlias: 'CN',
    aliases: ['CN', 'CONNECTION'],
    category: 'Structure',
    description: 'Shear plate, end plate, clip angle or base plate — simplified plates and bolts in 3D, a small symbol in plan.',
    howToUse: ['Select a beam and its supporting column / beam and type CN — or type CN and click near a beam end.', 'Choose the type in the options bar or Properties.'],
    run: (ctx) => ctx.activateTool('connection'),
  },
  {
    id: 'sjoint',
    name: 'Construction / Control / Expansion Joint',
    primaryAlias: 'CJ',
    aliases: ['CJ', 'JOINT'],
    category: 'Structure',
    description: 'Joint line on a slab or wall with its standard symbol; expansion joints (with gap width) split the slab in 3D.',
    howToUse: ['Type CJ, choose the joint type.', 'Click two points across the slab.'],
    run: (ctx) => ctx.activateTool('sjoint'),
  },
  {
    id: 'load',
    name: 'Load',
    primaryAlias: 'LD',
    aliases: ['LD', 'LOAD'],
    category: 'Structure',
    description: 'Point, line or area load with a value (kip, kip/ft, psf / kN, kN/m, kPa) — arrows and hatched areas; shown in the analytical view.',
    howToUse: ['Type LD, choose point / line / area and the value.', 'Point = 1 click, line = 2 clicks, area = sketch + Enter.'],
    run: (ctx) => ctx.activateTool('load'),
  },
  {
    id: 'section',
    name: 'Structural Section',
    primaryAlias: 'SEC',
    aliases: ['SEC', 'SECTION'],
    category: 'Structure',
    description: 'Draw a cut line in plan to open a section view showing members, materials and rebar (dots where bars cross the cut).',
    howToUse: ['Type SEC and click the two ends of the cut line — the view looks to the left of start → end.', 'Double-click the section head in plan (or use Elevations ▾) to reopen it. Place it on a sheet.'],
    run: (ctx) => ctx.activateTool('section'),
  },
  {
    id: 'truss',
    name: 'Timber Truss',
    primaryAlias: 'TRS',
    aliases: ['TRS', 'TRUSS'],
    category: 'Structure',
    conflictNote: 'TR is TRIM (AutoCAD), so trusses use TRS.',
    description: 'Places parametric timber trusses: King Post, Queen Post, Hammerbeam or Scissor (span, pitch, timber size).',
    howToUse: [
      'Type TRS. Pick a style, pitch (rise per 12) and timber size in the options bar; set Count + spacing for a row of trusses.',
      'Click inside a room: one click puts a truss across its short span, bearing on the wall tops. Or click the two bearing points.',
      'Top chords overhang the walls with decorative tails (More…).',
    ],
    run: (ctx) => ctx.activateTool('truss'),
  },
  {
    id: 'kneebrace',
    name: 'Knee Brace / Corbel',
    primaryAlias: 'KB',
    aliases: ['KB', 'KNEEBRACE', 'CORBEL'],
    category: 'Structure',
    description: 'Adds straight or curved mortise-and-tenon knee braces between a timber post and the beams framing into it.',
    howToUse: ['Type KB, choose the leg length and Straight / Curved, then click a post. One brace is added on each side where a beam continues.'],
    run: (ctx) => ctx.activateTool('kneebrace'),
  },
  {
    id: 'roofframing',
    name: 'Timber Roof Framing',
    primaryAlias: 'TRF',
    aliases: ['TRF', 'RIDGEBEAM', 'PURLINS', 'RAFTERS'],
    category: 'Structure',
    description: 'Exposed ridge beam, purlins (canted to the roof pitch) and rafters with decorative tails (plumb, square, bevel, scrolled) under a roof — for vaulted cabin ceilings.',
    howToUse: ['Type TRF, pick the species, members and tail cut (sizes and spacing under More…), then click a roof.'],
    run: (ctx) => ctx.activateTool('roofframing'),
  },
  {
    id: 'joingeometry',
    name: 'Join Geometry',
    primaryAlias: 'JG',
    aliases: ['JG', 'JOINGEOMETRY'],
    category: 'Structure',
    description: 'Joins two selected structural elements so concrete merges cleanly and beams cut back at column faces (on by default).',
    howToUse: ['Select two elements, type JG.'],
    run: (ctx) => ctx.structureJoin?.('join'),
  },
  {
    id: 'unjoin',
    name: 'Unjoin Geometry',
    primaryAlias: 'UJ',
    aliases: ['UJ', 'UNJOIN'],
    category: 'Structure',
    description: 'Turns the automatic join off for two selected elements (e.g. the beam runs through to the column centre).',
    howToUse: ['Select two elements, type UJ.'],
    run: (ctx) => ctx.structureJoin?.('unjoin'),
  },
  {
    id: 'switchjoin',
    name: 'Switch Join Order',
    primaryAlias: 'SWJ',
    aliases: ['SWJ', 'SWITCHJOIN'],
    category: 'Structure',
    description: 'Chooses which element cuts the other (beam cuts column instead of column cuts beam).',
    howToUse: ['Select two joined elements, type SWJ.'],
    run: (ctx) => ctx.structureJoin?.('switch'),
  },
  {
    id: 'attachcolumntop',
    name: 'Attach Column Top to Beam',
    primaryAlias: 'ATB',
    aliases: ['ATB'],
    category: 'Structure',
    description: 'Selected columns stop at the underside of the selected beam (top follows the beam).',
    howToUse: ['Select columns and one beam, type ATB.'],
    run: (ctx) => ctx.attachColumnTopToBeam?.(),
  },
  {
    id: 'foundationplan',
    name: 'Foundation Plan',
    primaryAlias: 'FP',
    aliases: ['FP', 'FOUNDATIONPLAN'],
    category: 'Structure',
    description: 'Foundation plan of the lowest level: footings, piles, slab on grade, rebar, columns and grids.',
    howToUse: ['Type FP or choose it under Elevations ▾ → Structural. Place it on a sheet.'],
    run: (ctx) => ctx.openStructuralView?.('foundationplan'),
  },
  {
    id: 'framingplan',
    name: 'Framing Plan',
    primaryAlias: 'FRP',
    aliases: ['FRP', 'FRAMINGPLAN'],
    category: 'Structure',
    description: 'Framing plan per level: beams with sizes, joists, braces, connections, slabs with span arrows, warnings; optional analytical overlay.',
    howToUse: ['Type FRP or choose it under Elevations ▾ → Structural; pick the level in the view.'],
    run: (ctx) => ctx.openStructuralView?.('framingplan'),
  },
  {
    id: 'analytical',
    name: 'Analytical View',
    primaryAlias: 'AN',
    aliases: ['AN', 'ANALYTICAL'],
    category: 'Structure',
    description: 'Toggles analytical centrelines, nodes, support symbols and loads (plan, framing plan, 3D). Simple warnings only — no structural calculation.',
    howToUse: ['Type AN (or use the Analytical button in the framing plan / 3D view).'],
    run: (ctx) => ctx.toggleAnalytical?.(),
  },
  {
    id: 'navvcube',
    name: 'ViewCube On / Off',
    primaryAlias: 'NAVVCUBE',
    aliases: ['NAVVCUBE', 'CUBE', 'VIEWCUBE'],
    category: 'View & Panels',
    description: 'Shows or hides the ViewCube (top-right of the 3D view and the plan). The setting is remembered in this browser.',
    howToUse: [
      'Type NAVVCUBE (or CUBE) and press Enter.',
      'At "Enter an option [ON/OFF] <ON>:" type ON or OFF and press Enter — or click ON / OFF in the prompt. Enter alone keeps the current setting.',
      'Or click "ViewCube" under View in the left toolbar.',
    ],
    run: (ctx) => ctx.navViewCube?.(),
  },
  {
    id: 'sectionbox',
    name: 'Section Box',
    primaryAlias: 'BX',
    aliases: ['BX', 'SECTIONBOX', '3DBOX'],
    category: 'View & Panels',
    description: 'Cuts the 3D model with a box (six drag handles). Pull the top face down to slice the building and look into the foundations; cut surfaces show a hatched solid colour. (SB is the structural floor, so the alias is BX.)',
    howToUse: [
      'Type BX and press Enter (or click "Section box" in the 3D view bar). The app switches to 3D.',
      'Drag a blue handle: each one moves one side of the box along its axis.',
      'Drag the top handle down to slice through the building; drag the bottom up to cut off the foundations.',
      'Type BX again to remove the box.',
    ],
    run: (ctx) => ctx.toggleSectionBox?.(),
  },
  {
    id: 'xray',
    name: 'X-ray (Below Grade)',
    primaryAlias: 'XR',
    aliases: ['XR', 'XRAY'],
    category: 'View & Panels',
    description: 'In 3D, everything above grade turns 25% see-through so foundations and structure stand out.',
    howToUse: ['Type XR (or open Ground ▾ in the 3D view bar and tick X-ray).', 'Orbit under the grid to look up at footings, piles and slab bottoms.'],
    run: (ctx) => ctx.toggleXray?.(),
  },
  {
    id: 'viewrebar',
    name: 'View Rebar',
    primaryAlias: 'VR',
    aliases: ['VR', 'VIEWREBAR'],
    category: 'Structure',
    description: 'In 3D, concrete hosts turn semi-transparent and bars show as solid rods coloured by size; in plan all bars are drawn.',
    howToUse: ['Type VR (or click "View rebar" in the 3D view bar).'],
    run: (ctx) => ctx.toggleViewRebar?.(),
  },
  {
    id: 'discipline-structural',
    name: 'Discipline: Structural',
    primaryAlias: 'DSS',
    aliases: ['DSS', 'STRUCTURAL'],
    category: 'Structure',
    description: 'Architectural finishes fade to light gray; structure is shown strongly. (Also: DSA = Architectural, DSC = Combined, or the switch in the top bar.)',
    howToUse: ['Type DSS / DSA / DSC or use the Arch | Struct | Combined switch in the top bar.'],
    run: (ctx) => ctx.setDiscipline?.('structural'),
  },
  {
    id: 'discipline-architectural',
    name: 'Discipline: Architectural',
    primaryAlias: 'DSA',
    aliases: ['DSA', 'ARCHITECTURAL'],
    category: 'Structure',
    description: 'Hides structural-only elements (footings, beams, rebar, loads, connections).',
    howToUse: ['Type DSA.'],
    run: (ctx) => ctx.setDiscipline?.('architectural'),
  },
  {
    id: 'discipline-combined',
    name: 'Discipline: Combined',
    primaryAlias: 'DSC',
    aliases: ['DSC', 'COMBINED'],
    category: 'Structure',
    description: 'Shows architecture and structure together.',
    howToUse: ['Type DSC.'],
    run: (ctx) => ctx.setDiscipline?.('combined'),
  },
  {
    id: 'stair',
    name: 'Stairs (Level-to-Level)',
    primaryAlias: 'ST',
    aliases: ['ST', 'STAIR', 'STAIRS'],
    category: 'Build (BIM)',
    description:
      'Draws a straight stair run between two building levels with automatic riser and tread calculation.',
    howToUse: [
      'Type ST or STAIR and press Enter.',
      'Click the start of the stair run (bottom), then click the end of the run (top).',
      'ARCHIFORMA automatically computes risers (≤ 7") and treads (11") from the base and top level elevations.',
    ],
    run: (ctx) => ctx.activateTool('stair'),
  },
  {
    id: 'column',
    name: 'Column',
    primaryAlias: 'CL',
    aliases: ['CL', 'COLUMN', 'COL'],
    category: 'Build (BIM)',
    description:
      'Places architectural or structural columns (rectangular or round) that snap automatically to structural grid intersections.',
    howToUse: [
      'Type CL or COLUMN and press Enter.',
      'Hover near any structural grid intersection (or click anywhere on the plan) to place a column.',
      'Change Column Type (Concrete 12"×12", Round Steel Ø10", Timber 8"×8") in the Properties panel.',
    ],
    run: (ctx) => ctx.activateTool('column'),
  },
  {
    id: 'grid',
    name: 'Structural Grid',
    primaryAlias: 'GR',
    aliases: ['GR', 'GRID'],
    category: 'Build (BIM)',
    description:
      'Draws structural datum grid lines with automatic letter/number bubbles (A, B, C / 1, 2, 3) across all levels.',
    howToUse: [
      'Type GR or GRID and press Enter.',
      'Click the start point and end point of the grid line.',
      'Vertical grids auto-number 1, 2, 3… and horizontal grids auto-letter A, B, C…',
    ],
    run: (ctx) => ctx.activateTool('grid'),
  },
  {
    id: 'level',
    name: 'Levels Manager',
    primaryAlias: 'LL',
    aliases: ['LL', 'LEVEL', 'LEVELS'],
    category: 'Build (BIM)',
    description:
      'Opens the Building Levels dialog to switch levels, add stories, and edit floor-to-floor elevations (Level 1, Level 2, Roof).',
    howToUse: [
      'Type LL or LEVEL and press Enter (or use the Level switcher in the top bar).',
      'Add, rename, or adjust elevations for Level 1, Level 2, Roof, etc. 3D view stacks all levels automatically.',
    ],
    run: (ctx) => {
      if (ctx.openLevelManager) {
        ctx.openLevelManager();
      } else {
        ctx.logMessage('Opened Levels Manager (LL).', 'info');
      }
    },
  },

  // --- EDIT ---
  {
    id: 'select',
    name: 'Select',
    primaryAlias: 'SEL',
    aliases: ['SEL', 'SELECT'],
    category: 'Edit',
    description: 'Selects objects by clicking, Shift+clicking, or dragging a window/crossing box.',
    howToUse: [
      'Click any object to select it, or Shift+click to add/remove from selection.',
      'Drag left-to-right for Window selection (fully inside) or right-to-left for Crossing selection.',
      'Drag blue grip squares on selected objects to reshape them directly.',
    ],
    run: (ctx) => ctx.activateTool('select'),
  },
  {
    id: 'move',
    name: 'Move',
    primaryAlias: 'M / MV',
    aliases: ['M', 'MV', 'MOVE'],
    category: 'Edit',
    description: 'Moves selected objects from a base point to a target point (AutoCAD M / Revit MV).',
    howToUse: [
      'Select one or more objects (or run M / MV first, then click an object).',
      'Click the base point for the move.',
      'Click the destination point or type @dx,dy / distance.',
    ],
    run: (ctx) => ctx.activateTool('move'),
  },
  {
    id: 'copy',
    name: 'Copy',
    primaryAlias: 'CO',
    aliases: ['CO', 'CP', 'COPY'],
    category: 'Edit',
    description: 'Copies selected objects from a base point to one or more target points.',
    conflictNote: 'Shared alias: CO works identically in both AutoCAD and Revit.',
    howToUse: [
      'Select objects to copy, then type CO or COPY and press Enter.',
      'Click the base point.',
      'Click target point(s) to place copies; press Enter or Esc when done.',
    ],
    run: (ctx) => ctx.activateTool('copy'),
  },
  {
    id: 'rotate',
    name: 'Rotate',
    primaryAlias: 'RO',
    aliases: ['RO', 'ROTATE'],
    category: 'Edit',
    description: 'Rotates selected objects around a base point by cursor or exact degree angle.',
    conflictNote: 'Shared alias: RO works identically in both AutoCAD and Revit.',
    howToUse: [
      'Select objects to rotate, then type RO or ROTATE and press Enter.',
      'Click the center (base point) of rotation.',
      'Move the mouse and click, or type an angle in degrees (e.g. 90) and press Enter.',
    ],
    run: (ctx) => ctx.activateTool('rotate'),
  },
  {
    id: 'erase',
    name: 'Delete / Erase',
    primaryAlias: 'E / DE',
    aliases: ['E', 'DE', 'ERASE', 'DELETE', 'DEL'],
    category: 'Edit',
    description: 'Deletes selected objects immediately, or enters pick-to-erase mode (AutoCAD E / Revit DE).',
    howToUse: [
      'Select objects and press E, DE, or Delete key to erase them immediately.',
      'If nothing is selected, running E or DE lets you click any object to erase it.',
    ],
    run: (ctx) => ctx.deleteSelectionOrStartErase(),
  },
  {
    id: 'offset',
    name: 'Offset',
    primaryAlias: 'O',
    aliases: ['O', 'OFFSET', 'OF'],
    category: 'Edit',
    description: 'Offsets concentric circles, parallel lines, walls, or polylines by distance or through point.',
    howToUse: [
      'Type O or OFFSET and press Enter.',
      'Specify offset distance (e.g. 12" or 300) or press Enter to accept current distance (type T for Through point).',
      'Select object to offset (line, wall, arc, circle, polyline, rectangle).',
      'Click on the side where the offset copy should be placed.',
    ],
    run: (ctx) => ctx.activateTool('offset'),
  },
  {
    id: 'trim',
    name: 'Trim (AutoCAD 2021+)',
    primaryAlias: 'TR',
    aliases: ['TR', 'TRIM'],
    category: 'Edit',
    description:
      'AutoCAD 2021+ Quick TRIM: Every object is an auto-cutting edge. Click or fence to remove parts; Shift+click to extend.',
    howToUse: [
      'Type TR or TRIM and press Enter (defaults to Quick mode where every object acts as a cutting edge).',
      'Hover over any object to see a live gray dashed preview of the exact piece to be removed.',
      'Click to trim the piece between intersections. If an object crosses nothing, it is deleted.',
      'Press-and-drag for a freehand fence, or click two empty points for a straight crossing fence line.',
      'Shift+click any object to extend it instead.',
      'Type or click options: T (cuTting edges), C (Crossing), O (mOde Quick/Standard), R (eRase), U (Undo), P (Project).',
      'In Standard mode, press E to toggle Edge implied intersection extension (Extend / No extend).',
    ],
    run: (ctx) => ctx.activateTool('trim'),
  },
  {
    id: 'extend',
    name: 'Extend (AutoCAD 2021+)',
    primaryAlias: 'EX',
    aliases: ['EX', 'EXTEND'],
    category: 'Edit',
    description:
      'AutoCAD 2021+ Quick EXTEND: Every object is an auto-boundary. Click near an endpoint or fence to extend; Shift+click to trim.',
    howToUse: [
      'Type EX or EXTEND and press Enter (defaults to Quick mode where every object is a boundary).',
      'Hover near an endpoint to see a live dashed preview extending to the nearest boundary edge ahead.',
      'Click near an endpoint to lengthen it. Clicking again extends it to the next boundary.',
      'Press-and-drag for a freehand fence, or click two empty points for a crossing fence line.',
      'Shift+click any object to trim it instead.',
      'Type or click options: B (Boundary edges), C (Crossing), O (mOde Quick/Standard), U (Undo), P (Project).',
    ],
    run: (ctx) => ctx.activateTool('extend'),
  },
  {
    id: 'corner',
    name: 'Trim / Extend to Corner (Revit TC)',
    primaryAlias: 'TC',
    aliases: ['TC', 'CORNER', 'TRIMCORNER'],
    category: 'Edit',
    description:
      'Trims or extends two lines or walls to meet in a clean mitered corner, keeping the parts that were clicked.',
    howToUse: [
      'Type TC or CORNER and press Enter.',
      'Click the first line or wall on the side you want to keep.',
      'Click the second line or wall on the side you want to keep.',
      'Both elements trim or extend to their intersection and join in a clean corner.',
    ],
    run: (ctx) => ctx.activateTool('corner'),
  },
  {
    id: 'fillet',
    name: 'Fillet',
    primaryAlias: 'F',
    aliases: ['F', 'FILLET'],
    category: 'Edit',
    description: 'Rounds or corners the edges of two lines or walls (radius 0 joins clean mitered corner).',
    howToUse: [
      'Type F or FILLET and press Enter.',
      'Type R to set the fillet radius (radius 0 connects lines/walls into a clean corner).',
      'Select the first line or wall, then select the second line or wall.',
    ],
    run: (ctx) => ctx.activateTool('fillet'),
  },
  {
    id: 'chamfer',
    name: 'Chamfer',
    primaryAlias: 'CHA',
    aliases: ['CHA', 'CHAMFER'],
    category: 'Edit',
    description: 'Bevels the corner between two intersecting or non-parallel lines or walls.',
    howToUse: [
      'Type CHA or CHAMFER and press Enter.',
      'Type D to set the two chamfer distances (e.g. 12, 12).',
      'Click the first line/wall, then click the second line/wall.',
    ],
    run: (ctx) => ctx.activateTool('chamfer'),
  },
  {
    id: 'mirror',
    name: 'Mirror',
    primaryAlias: 'MI',
    aliases: ['MI', 'MIRROR', 'MM'],
    category: 'Edit',
    description: 'Creates a reversed mirrored copy of selected objects across a specified reflection line.',
    howToUse: [
      'Select objects to mirror, then type MI or MIRROR and press Enter.',
      'Click the first point of the mirror line axis.',
      'Click the second point of the mirror axis.',
      'Type Y to delete the source objects, or press Enter / type N to keep both.',
    ],
    run: (ctx) => ctx.activateTool('mirror'),
  },
  {
    id: 'array',
    name: 'Array',
    primaryAlias: 'AR',
    aliases: ['AR', 'ARRAY'],
    category: 'Edit',
    description: 'Creates multiple copies of objects in a rectangular grid or circular polar pattern.',
    howToUse: [
      'Select objects, then type AR or ARRAY and press Enter.',
      'Choose Rectangular (R) or Polar (P).',
      'For Rectangular: specify rows, columns, and spacing. For Polar: click center point, count, and angle.',
    ],
    run: (ctx) => ctx.activateTool('array'),
  },
  {
    id: 'scale',
    name: 'Scale',
    primaryAlias: 'SC',
    aliases: ['SC', 'SCALE'],
    category: 'Edit',
    description: 'Enlarges or shrinks selected objects proportionally around a base point.',
    howToUse: [
      'Select objects to scale, then type SC or SCALE and press Enter.',
      'Click the base point for scaling.',
      'Type a scale factor (e.g. 1.5, 0.5) or type R for reference length, and press Enter.',
    ],
    run: (ctx) => ctx.activateTool('scale'),
  },
  {
    id: 'stretch',
    name: 'Stretch',
    primaryAlias: 'S',
    aliases: ['S', 'STRETCH'],
    category: 'Edit',
    description: 'Stretches lines, walls, and polylines crossed by a selection window while keeping other ends fixed.',
    howToUse: [
      'Type S or STRETCH and press Enter.',
      'Drag a crossing window (right-to-left) across the endpoints you wish to stretch.',
      'Click base point, then click new displacement point or type @dx,dy.',
    ],
    run: (ctx) => ctx.activateTool('stretch'),
  },
  {
    id: 'break',
    name: 'Break',
    primaryAlias: 'BR',
    aliases: ['BR', 'BREAK'],
    category: 'Edit',
    description: 'Breaks the selected object between two points, or splits it into two pieces at a point.',
    howToUse: [
      'Type BR or BREAK and press Enter.',
      'Click the object at the first break point.',
      'Click the second break point to remove the segment, or click the same point to split.',
    ],
    run: (ctx) => ctx.activateTool('break'),
  },
  {
    id: 'join',
    name: 'Join',
    primaryAlias: 'J',
    aliases: ['J', 'JOIN'],
    category: 'Edit',
    description: 'Joins collinear lines/walls into a single entity, or connects touching lines into a polyline.',
    howToUse: [
      'Select collinear lines/walls or connected segments, then type J and press Enter.',
      'Collinear lines merge into one longer line; connected lines merge into a polyline.',
    ],
    run: (ctx) => ctx.activateTool('join'),
  },
  {
    id: 'explode',
    name: 'Explode',
    primaryAlias: 'X',
    aliases: ['X', 'EXPLODE'],
    category: 'Edit',
    description:
      'Breaks a compound object (block instance, polyline, rectangle, wall) into its individual component primitives.',
    howToUse: [
      'Select a block, polyline, rectangle, or wall, then type X or EXPLODE and press Enter.',
      'The block or compound object is disassembled into independent 2D primitives.',
    ],
    run: (ctx) => ctx.activateTool('explode'),
  },
  {
    id: 'align',
    name: 'Align',
    primaryAlias: 'AL',
    aliases: ['AL', 'ALIGN'],
    category: 'Edit',
    description: 'Aligns an object to another reference line by moving and rotating it (Revit / AutoCAD Align).',
    howToUse: [
      'Type AL or ALIGN and press Enter.',
      'Select the object to align (or click source edge).',
      'Click the reference line to align it with.',
    ],
    run: (ctx) => ctx.activateTool('align'),
  },
  {
    id: 'matchprop',
    name: 'Match Properties',
    primaryAlias: 'MA',
    aliases: ['MA', 'MATCHPROP', 'MATCH'],
    category: 'Edit',
    description:
      'Copies properties (layer, wall thickness, height, justification, text size) from a source entity to destination entities.',
    howToUse: [
      'Type MA or MATCHPROP and press Enter.',
      'Click the source object whose properties you want to copy.',
      'Click one or more destination objects to apply properties to (press Esc to finish).',
    ],
    run: (ctx) => ctx.activateTool('matchprop'),
  },

  // --- ANNOTATE & MEASURE ---
  {
    id: 'dli',
    name: 'Linear Dimension',
    primaryAlias: 'DLI',
    aliases: ['DLI', 'DIMLINEAR', 'DIMLIN'],
    category: 'Annotate & Measure',
    description: 'Places a strictly horizontal or vertical dimension measuring delta X or delta Y.',
    howToUse: [
      'Type DLI or DIMLINEAR and press Enter.',
      'Click the first extension point, then click the second extension point.',
      'Move cursor above/below for horizontal or left/right for vertical, then click to place.',
    ],
    run: (ctx) => ctx.activateTool('dli'),
  },
  {
    id: 'dimension',
    name: 'Aligned Dimension',
    primaryAlias: 'DAL / DI',
    aliases: ['DAL', 'DI', 'DIM', 'DIMALIGNED'],
    category: 'Annotate & Measure',
    description: 'Places an associative aligned dimension parallel to the measured line or wall face.',
    conflictNote:
      'Conflict Note: In Revit, DI places an Aligned Dimension (default architectural behavior). In AutoCAD, DI is DIST (measure). Use DAL or toggle DI mode in Settings.',
    howToUse: [
      'Type DAL, DI, or DIM and press Enter.',
      'Click the first extension point, then click the second extension point.',
      'When dimensioning walls, press Tab to cycle between Interior, Centerline, and Exterior face.',
      'Move cursor perpendicular to the line and click to place the dimension bar.',
    ],
    run: (ctx) => {
      if (ctx.isRevitStyleDI) {
        ctx.activateTool('dimension');
      } else {
        ctx.activateTool('dist');
      }
    },
  },
  {
    id: 'dan',
    name: 'Angular Dimension',
    primaryAlias: 'DAN',
    aliases: ['DAN', 'DIMANGULAR', 'DIMANG'],
    category: 'Annotate & Measure',
    description: 'Measures the exact angle between two lines or across three vertices with an arc dimension line.',
    howToUse: [
      'Type DAN or DIMANGULAR and press Enter.',
      'Click the vertex / intersection point.',
      'Click the first leg endpoint, then click the second leg endpoint.',
      'Move cursor and click to position the dimension arc.',
    ],
    run: (ctx) => ctx.activateTool('dan'),
  },
  {
    id: 'dra',
    name: 'Radius Dimension',
    primaryAlias: 'DRA',
    aliases: ['DRA', 'DIMRADIUS', 'DIMRAD'],
    category: 'Annotate & Measure',
    description: 'Measures the radius of a circular arc or circle with an architectural leader line.',
    howToUse: [
      'Type DRA or DIMRADIUS and press Enter.',
      'Click any arc or circle.',
      'Move cursor and click to place the radius callout (e.g. R 4\'-0").',
    ],
    run: (ctx) => ctx.activateTool('dra'),
  },
  {
    id: 'ddi',
    name: 'Diameter Dimension',
    primaryAlias: 'DDI',
    aliases: ['DDI', 'DIMDIAMETER', 'DIMDIA'],
    category: 'Annotate & Measure',
    description: 'Measures the full diameter of a circle or arc with a diametrical dimension line.',
    howToUse: [
      'Type DDI or DIMDIAMETER and press Enter.',
      'Click any circle or arc.',
      'Move cursor and click to position the diameter text (e.g. Ø 8\'-0").',
    ],
    run: (ctx) => ctx.activateTool('ddi'),
  },
  {
    id: 'dco',
    name: 'Continue Dimension',
    primaryAlias: 'DCO',
    aliases: ['DCO', 'DIMCONTINUE', 'DIMCONT'],
    category: 'Annotate & Measure',
    description: 'Chains continuous dimensions starting from the second extension line of the previous dimension.',
    howToUse: [
      'Type DCO or DIMCONTINUE and press Enter.',
      'Click next extension points in sequence to create aligned chained dimensions.',
      'Press Enter or Esc when finished.',
    ],
    run: (ctx) => ctx.activateTool('dco'),
  },
  {
    id: 'dba',
    name: 'Baseline Dimension',
    primaryAlias: 'DBA',
    aliases: ['DBA', 'DIMBASELINE', 'DIMBASE'],
    category: 'Annotate & Measure',
    description: 'Creates stacked baseline dimensions starting from the same first extension line with automatic spacing.',
    howToUse: [
      'Type DBA or DIMBASELINE and press Enter.',
      'Click subsequent points to create stacked baseline dimensions.',
      'Press Enter or Esc when finished.',
    ],
    run: (ctx) => ctx.activateTool('dba'),
  },
  {
    id: 'leader',
    name: 'Leader Arrow',
    primaryAlias: 'LE',
    aliases: ['LE', 'LEADER', 'MLD', 'MLEADER'],
    category: 'Annotate & Measure',
    description: 'Places an architectural leader arrow with an elbow, horizontal landing shelf, and text note.',
    howToUse: [
      'Type LE or MLEADER and press Enter.',
      'Click the arrowhead point (pointing to detail or wall).',
      'Click the knee/elbow point.',
      'Click the landing shelf end point, then enter text in the command line.',
    ],
    run: (ctx) => ctx.activateTool('leader'),
  },
  {
    id: 'hatch',
    name: 'Hatch Pattern',
    primaryAlias: 'H',
    aliases: ['H', 'HATCH', 'BH', 'BHATCH'],
    category: 'Annotate & Measure',
    description:
      'Fills a closed area (room, closed polyline, rectangle) with architectural patterns: Solid, Diagonal, Crosshatch, Brick, Concrete, Insulation.',
    howToUse: [
      'Type H or HATCH and press Enter.',
      'Click inside any enclosed room, rectangle, or closed polyline to fill it.',
      'Adjust pattern, scale, and angle in the Properties panel.',
    ],
    run: (ctx) => ctx.activateTool('hatch'),
  },
  {
    id: 'tag',
    name: 'Tag by Category',
    primaryAlias: 'TG',
    aliases: ['TG', 'TAG'],
    category: 'Annotate & Measure',
    description: 'Tags doors (D1, D2…), windows (W1, W2…), or rooms (name + area) with associative category callouts.',
    howToUse: [
      'Type TG or TAG and press Enter.',
      'Click any door to place a Door Tag (e.g. D1).',
      'Click any window to place a Window Tag (e.g. W1).',
      'Click any room to place an associative Room Tag with area.',
    ],
    run: (ctx) => ctx.activateTool('tag'),
  },
  {
    id: 'dimstyle',
    name: 'Dimension Style',
    primaryAlias: 'D',
    aliases: ['D', 'DIMSTYLE', 'DST', 'DDIM'],
    category: 'Annotate & Measure',
    description: 'Opens Dimension Style settings: text height, arrow type (tick/arrow/dot), and units precision.',
    howToUse: [
      'Type D or DIMSTYLE and press Enter.',
      'Choose arrow style (Architectural Tick, Closed Arrow, Dot), text height, and precision.',
      'Preview updates live in the style dialog.',
    ],
    run: (ctx) => {
      if (ctx.openDimStyleModal) {
        ctx.openDimStyleModal();
      } else {
        ctx.logMessage('Dimension Style settings dialog opened.', 'info');
      }
    },
  },
  {
    id: 'dist',
    name: 'Measure Distance',
    primaryAlias: 'DIST',
    aliases: ['DIST', 'MEASURE'],
    category: 'Annotate & Measure',
    description: 'Measures exact distance, delta X/Y, and angle between two points without creating an object.',
    conflictNote: 'AutoCAD DIST command. Also triggered by DI when AutoCAD DI mode is enabled.',
    howToUse: [
      'Type DIST and press Enter.',
      'Click the first point, then hover or click the second point.',
      'Read the exact distance, angle, ΔX, and ΔY in the command history.',
    ],
    run: (ctx) => ctx.activateTool('dist'),
  },
  {
    id: 'area',
    name: 'Measure Area',
    primaryAlias: 'AA',
    aliases: ['AA', 'AREA'],
    category: 'Annotate & Measure',
    description:
      'Calculates and displays the exact area and perimeter of an object or closed polygon picked on screen.',
    howToUse: [
      'Type AA or AREA and press Enter.',
      'Click consecutive corner points to define an area polygon, or click an existing object (room, circle, rectangle, polyline).',
      'Press Enter when finished to calculate and log the exact area and perimeter.',
    ],
    run: (ctx) => ctx.activateTool('area'),
  },
  {
    id: 'text',
    name: 'Text Note',
    primaryAlias: 'TX',
    aliases: ['TX', 'TEXT', 'T', 'DT', 'MTEXT'],
    category: 'Annotate & Measure',
    description: 'Places an architectural text note or multiline MText label with rotation and alignment.',
    howToUse: [
      'Type TX, T, or MTEXT and press Enter.',
      'Click on the canvas where the label should be placed.',
      'Type the label text in the command line or dynamic input and press Enter.',
    ],
    run: (ctx) => ctx.activateTool('text'),
  },

  // --- VIEW, LAYERS & HISTORY ---
  {
    id: 'zoom',
    name: 'Zoom Extents',
    primaryAlias: 'Z / ZE',
    aliases: ['Z', 'ZOOM', 'ZE', 'ZF'],
    category: 'View & Panels',
    description: 'Centers and fits the entire drawing inside the viewport (AutoCAD Z E / Revit ZE, ZF).',
    howToUse: [
      'Type ZE, ZF, or Z and press Enter.',
      'When using Z, you can also type E and Enter (AutoCAD Zoom -> Extents) or press Enter to fit immediately.',
    ],
    run: (ctx) => ctx.zoomExtents(),
  },
  {
    id: 'undo',
    name: 'Undo',
    primaryAlias: 'U',
    aliases: ['U', 'UNDO'],
    category: 'View & Panels',
    description: 'Reverses the most recent change to the model (up to 120 steps).',
    howToUse: ['Type U or UNDO and press Enter, or press Ctrl+Z.'],
    run: (ctx) => ctx.undo(),
  },
  {
    id: 'redo',
    name: 'Redo',
    primaryAlias: 'REDO',
    aliases: ['REDO', 'MREDO'],
    category: 'View & Panels',
    description: 'Re-applies the last undone action.',
    howToUse: ['Type REDO and press Enter, or press Ctrl+Y.'],
    run: (ctx) => ctx.redo(),
  },
  {
    id: 'layer',
    name: 'Layers Panel',
    primaryAlias: 'LA',
    aliases: ['LA', 'LAYER', 'LAYERS'],
    category: 'View & Panels',
    description: 'Opens and expands the Layers list in the right panel.',
    howToUse: ['Type LA or LAYER and press Enter to expand and focus the Layers manager.'],
    run: (ctx) => ctx.openLayersPanel(),
  },
  {
    id: 'visibility',
    name: 'Visibility / Graphics',
    primaryAlias: 'VV / VG',
    aliases: ['VV', 'VG', 'VISIBILITY'],
    category: 'View & Panels',
    description:
      'Opens Revit-style Visibility/Graphics overrides to show or hide categories (walls, doors, furniture, annotations, grids, roofs) per view.',
    howToUse: [
      'Type VV or VG and press Enter.',
      'Toggle category checkboxes independently for the 2D Plan view and 3D View.',
    ],
    run: (ctx) => {
      if (ctx.openVisibilityModal) {
        ctx.openVisibilityModal();
      } else {
        ctx.openLayersPanel();
      }
    },
  },
  {
    id: 'hide-element',
    name: 'Hide Element (Temporary)',
    primaryAlias: 'HH',
    aliases: ['HH', 'HIDE'],
    category: 'View & Panels',
    description: 'Temporarily hides the currently selected element(s) in the active viewport.',
    howToUse: [
      'Select one or more objects, then type HH and press Enter.',
      'Type HR at any time to restore all temporarily hidden or isolated elements.',
    ],
    run: (ctx) => {
      if (ctx.hideSelectedElements) ctx.hideSelectedElements();
    },
  },
  {
    id: 'isolate-element',
    name: 'Isolate Element (Temporary)',
    primaryAlias: 'HI',
    aliases: ['HI', 'ISOLATE'],
    category: 'View & Panels',
    description:
      'Temporarily isolates the selected element(s), hiding all other objects until reset with HR.',
    howToUse: [
      'Select one or more objects, then type HI and press Enter.',
      'Only the isolated objects remain visible. Type HR to reset temporary hide/isolate.',
    ],
    run: (ctx) => {
      if (ctx.isolateSelectedElements) ctx.isolateSelectedElements();
    },
  },
  {
    id: 'reset-hide',
    name: 'Reset Temporary Hide/Isolate',
    primaryAlias: 'HR',
    aliases: ['HR', 'UNHIDE', 'RESETISOLATE'],
    category: 'View & Panels',
    description: 'Resets temporary Hide (HH) or Isolate (HI) mode and restores all elements.',
    howToUse: ['Type HR and press Enter to clear all temporary hide/isolate overrides.'],
    run: (ctx) => {
      if (ctx.resetTemporaryHideIsolate) ctx.resetTemporaryHideIsolate();
    },
  },
  {
    id: 'properties',
    name: 'Properties Panel',
    primaryAlias: 'PR',
    aliases: ['PR', 'PROPERTIES', 'PROP', 'CH', 'MO'],
    category: 'View & Panels',
    description: 'Opens and focuses the Properties inspector in the right panel.',
    howToUse: ['Type PR or PROPERTIES and press Enter to inspect or edit the selected element.'],
    run: (ctx) => ctx.openPropertiesPanel(),
  },
  {
    id: 'schedules',
    name: 'Schedules (Door, Window, Room)',
    primaryAlias: 'SCH',
    aliases: ['SCH', 'SCHEDULE', 'SCHEDULES'],
    category: 'View & Panels',
    description:
      'Opens the interactive BIM Schedules tab for Doors, Windows, and Rooms with editable cells and CSV export.',
    howToUse: [
      'Type SCH or SCHEDULE and press Enter (or click Schedules in the top bar).',
      'Edit any cell to update the 2D plan and 3D model live, or click Export CSV.',
    ],
    run: (ctx) => {
      if (ctx.openSchedulesView) ctx.openSchedulesView();
    },
  },
  {
    id: 'sheets',
    name: 'Architectural Sheets & Title Block',
    primaryAlias: 'SH',
    aliases: ['SH', 'SHEET', 'SHEETS', 'LAYOUT'],
    category: 'View & Panels',
    description:
      'Opens the Sheets workspace (A3 / Tabloid / A1) with title block, drag-and-drop views/schedules, scales, and multi-page PDF export.',
    howToUse: [
      'Type SH or SHEET and press Enter (or click Sheets in the top bar).',
      'Drag Floor Plans, 3D Views, and Schedules onto the sheet, set viewport scale (1/4" = 1\'-0", 1:50, etc.), and export multi-page PDF.',
    ],
    run: (ctx) => {
      if (ctx.openSheetsView) ctx.openSheetsView();
    },
  },
  {
    id: 'plot-pdf',
    name: 'Export Multi-Page PDF',
    primaryAlias: 'PLOT / PDF',
    aliases: ['PLOT', 'PDF', 'EXPORTPDF', 'PRINT'],
    category: 'View & Panels',
    description:
      'Exports all architectural sheets (A3 / Tabloid / A1) as a multi-page vector PDF using jsPDF.',
    howToUse: ['Type PLOT or PDF and press Enter to download the multi-page PDF sheet set.'],
    run: (ctx) => {
      if (ctx.exportPdf) ctx.exportPdf();
    },
  },
  {
    id: 'export-dxf',
    name: 'Export DXF',
    primaryAlias: 'DXFOUT',
    aliases: ['DXFOUT', 'DXF'],
    category: 'View & Panels',
    description:
      'Exports the drawing to ASCII DXF including layers, dimensions, hatches, and blocks.',
    howToUse: ['Type DXFOUT and press Enter to download a .dxf file.'],
    run: (ctx) => {
      if (ctx.exportDxf) ctx.exportDxf();
    },
  },
  {
    id: 'export-ifc',
    name: 'Export IFC4 BIM Model',
    primaryAlias: 'IFC / IFCOUT',
    aliases: ['IFC', 'IFCOUT', 'EXPORTIFC'],
    category: 'View & Panels',
    description:
      'Exports an IFC4 STEP model (.ifc) with walls, doors, windows, slabs, and spaces for FreeCAD and BlenderBIM.',
    howToUse: ['Type IFC or IFCOUT and press Enter to download an .ifc file.'],
    run: (ctx) => {
      if (ctx.exportIfc) ctx.exportIfc();
    },
  },
  {
    id: 'shortcuts',
    name: 'Keyboard Shortcut Cheat Sheet',
    primaryAlias: 'KS',
    aliases: ['KS', 'SHORTCUTS', 'CHEATSHEET', 'HOTKEYS'],
    category: 'View & Panels',
    description:
      'Opens the Keyboard Shortcut Cheat Sheet modal (Ctrl+/) with one-page scannable shortcuts.',
    howToUse: ['Press Ctrl+/ (or Cmd+/) or type KS and press Enter.'],
    run: (ctx) => {
      if (ctx.openShortcutCheatSheet) ctx.openShortcutCheatSheet();
    },
  },
  {
    id: 'tour',
    name: 'Replay 5-Step Guided Tour',
    primaryAlias: 'TOUR',
    aliases: ['TOUR', 'ONBOARDING', 'GUIDE'],
    category: 'View & Panels',
    description:
      'Starts the 5-step interactive beginner guided tour explaining tools, command bar, snaps, 3D/BIM, and exports.',
    howToUse: ['Type TOUR and press Enter, or click Tour in the top bar or Help dialog.'],
    run: (ctx) => {
      if (ctx.startGuidedTour) ctx.startGuidedTour();
    },
  },
  {
    id: 'benchmark',
    name: 'Load 2,000-Object Performance Benchmark',
    primaryAlias: 'BENCHMARK',
    aliases: ['BENCHMARK', 'STRESSTEST', 'PERF2000'],
    category: 'View & Panels',
    description:
      'Generates 2,000 architectural & CAD objects on the canvas to verify smooth 60fps 2D SVG memoization and incremental 3D updates.',
    howToUse: ['Type BENCHMARK and press Enter, or click 2,000-Obj Test in the Help modal.'],
    run: (ctx) => {
      if (ctx.loadStressTest) ctx.loadStressTest();
    },
  },
  {
    id: 'help',
    name: 'Command Reference & Help',
    primaryAlias: '?',
    aliases: ['HELP', '?'],
    category: 'View & Panels',
    description: 'Opens the searchable AutoCAD & Revit command reference guide (F1).',
    howToUse: ['Press F1, click the ? button in the top bar, or type HELP / ? and press Enter.'],
    run: (ctx) => ctx.openHelpModal(),
  },
];

export function findCommandByAlias(input: string): CommandDefinition | undefined {
  const normalized = input.trim().toUpperCase();
  if (!normalized) return undefined;
  return COMMAND_REGISTRY.find(
    (cmd) =>
      cmd.id.toUpperCase() === normalized ||
      cmd.name.toUpperCase() === normalized ||
      cmd.aliases.some((a) => a.toUpperCase() === normalized)
  );
}

export function searchCommands(query: string): CommandDefinition[] {
  const q = query.trim().toUpperCase();
  if (!q) return COMMAND_REGISTRY;
  return COMMAND_REGISTRY.filter(
    (cmd) =>
      cmd.aliases.some((a) => a.toUpperCase().startsWith(q)) ||
      cmd.name.toUpperCase().includes(q) ||
      cmd.description.toUpperCase().includes(q)
  ).sort((a, b) => {
    const aExact = a.aliases.some((al) => al.toUpperCase() === q) ? 0 : 1;
    const bExact = b.aliases.some((al) => al.toUpperCase() === q) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = a.aliases.some((al) => al.toUpperCase().startsWith(q)) ? 0 : 1;
    const bStarts = b.aliases.some((al) => al.toUpperCase().startsWith(q)) ? 0 : 1;
    return aStarts - bStarts;
  });
}

export function getToolStepHint(
  tool: ToolId,
  step: number,
  selectedCount: number
): string {
  switch (tool) {
    case 'select':
      return selectedCount > 0
        ? `SELECT: ${selectedCount} object(s) selected — drag blue grips to reshape, or run Move (M), Copy (CO), Rotate (RO), Delete (E)`
        : 'SELECT: Click an object, Shift+click to add, or drag a box (Left→Right = Window, Right→Left = Crossing)';
    case 'line':
      return step === 0
        ? 'LINE (L): Click start point (or type x,y coordinates)'
        : 'LINE (L): Click end point, or type @dx,dy / @length<angle / length (Esc to cancel)';
    case 'polyline':
      return step === 0
        ? 'POLYLINE (PL): Click start point (or type x,y)'
        : 'POLYLINE (PL): Click next point, type C + Enter to close, or press Enter to finish';
    case 'rectangle':
      return step === 0
        ? 'RECTANGLE (REC): Click first corner point (or type x,y)'
        : 'RECTANGLE (REC): Click opposite corner point (or type @width,height)';
    case 'circle':
      return step === 0
        ? 'CIRCLE (C): Click center point (or type x,y)'
        : 'CIRCLE (C): Click point on circle or type exact radius and press Enter';
    case 'arc':
      if (step === 0) return 'ARC (A): Click start point of arc';
      if (step === 1) return 'ARC (A): Click second point along the arc curve';
      return 'ARC (A): Click end point of arc';
    case 'wall':
      return step === 0
        ? 'WALL (WA): Click wall start point (or type x,y)'
        : 'WALL (WA): Click next corner point (or type length), or press Enter to finish wall chain';
    case 'door':
      return 'DOOR (DR): Hover a wall — the door snaps into it (red = does not fit). SPACE flips the swing, click a blue dimension to type a distance, click to place. Esc to finish.';
    case 'window':
      return 'WINDOW (WN): Hover a wall — the window snaps into it (red = does not fit). SPACE flips the exterior side, click a blue dimension to type a distance, click to place. Esc to finish.';
    case 'camera':
      if (step === 0) return 'CAMERA (CAM): Click the camera position (eye height 5\'-6" above the ground). Wheel = FOV.';
      if (step === 1) return 'CAMERA (CAM): Move to aim — the wedge points at the cursor. Click to lock the direction, or type a target distance. Wheel = FOV.';
      return 'CAMERA (CAM): Move sideways to widen / narrow the view (20°–100°), click to finish — or type an angle (62) or lens (35mm). Esc cancels.';
    case 'walljoin':
      return 'WALL JOIN (WJ): Click a wall corner to cycle Miter → Butt → Square off → Disallow join. Shift+click a Butt corner to swap the through wall. Click a T-junction to allow / disallow it.';
    case 'wallopening':
      return 'WALL OPENING (WO): Hover a wall and click to cut an empty rectangular or arched hole (no frame). Click a blue dimension to type a distance. Esc to finish.';
    case 'room':
      return 'ROOM (RM): Click inside an area enclosed by walls to create a room with automatic area calculation';
    case 'block':
      if (selectedCount === 0) {
        return 'BLOCK (B): Select objects to include in the block first, or click objects to add them';
      }
      if (step === 0) {
        return 'BLOCK (B): Click insertion base point on the canvas (or press Enter to use selection center)';
      }
      return 'BLOCK (B): Type a name for the new block in the command bar below and press Enter';
    case 'insert':
      return 'INSERT (I / CM): Click on the canvas to place the active library block (press R or type angle to rotate)';
    case 'bedit':
      return 'BEDIT (BE): Click a block instance to edit its definition, or choose a block in the Block Editor';
    case 'dimension':
      if (step === 0) return 'ALIGNED DIM (DAL): Click first point (hover wall & press Tab to cycle face: Interior/Center/Exterior)';
      if (step === 1) return 'ALIGNED DIM (DAL): Click second point';
      return 'ALIGNED DIM (DAL): Move cursor to position dimension line and click';
    case 'dli':
      if (step === 0) return 'LINEAR DIM (DLI): Click first extension point (press Tab to cycle wall face)';
      if (step === 1) return 'LINEAR DIM (DLI): Click second extension point';
      return 'LINEAR DIM (DLI): Move cursor above/below for horizontal or left/right for vertical, then click';
    case 'dan':
      if (step === 0) return 'ANGULAR DIM (DAN): Click vertex / corner point of the angle';
      if (step === 1) return 'ANGULAR DIM (DAN): Click first angle leg endpoint';
      if (step === 2) return 'ANGULAR DIM (DAN): Click second angle leg endpoint';
      return 'ANGULAR DIM (DAN): Move cursor and click to place dimension arc';
    case 'dra':
      if (step === 0) return 'RADIUS DIM (DRA): Click arc or circle to measure';
      return 'RADIUS DIM (DRA): Click placement point for radius callout';
    case 'ddi':
      if (step === 0) return 'DIAMETER DIM (DDI): Click circle or arc to measure';
      return 'DIAMETER DIM (DDI): Click placement point for diameter dimension line';
    case 'dco':
      return 'CONTINUE DIM (DCO): Click next extension point to chain aligned dimension (Esc to finish)';
    case 'dba':
      return 'BASELINE DIM (DBA): Click point to create stacked baseline dimension (Esc to finish)';
    case 'leader':
      if (step === 0) return 'LEADER (LE): Click arrowhead point (pointing to object or detail)';
      if (step === 1) return 'LEADER (LE): Click knee / elbow point';
      return 'LEADER (LE): Click landing shelf endpoint, then enter note text';
    case 'hatch':
      return 'HATCH (H): Click inside an enclosed room, rectangle, or closed polyline to apply pattern';
    case 'tag':
      return 'TAG (TG): Click any door (D1), window (W1), or room to place an associative category tag';
    case 'dist':
      return step === 0
        ? 'MEASURE (DIST): Click first point to measure from'
        : 'MEASURE (DIST): Click second point to record distance, ΔX, ΔY, and angle';
    case 'text':
      return step === 0
        ? 'TEXT (TX): Click insertion point for the text note'
        : 'TEXT (TX): Type label text in command bar or dynamic input and press Enter';
    case 'move':
      if (selectedCount === 0) return 'MOVE (M / MV): Click an object to move';
      return step === 0
        ? 'MOVE (M / MV): Click base point for move'
        : 'MOVE (M / MV): Click second point or type @dx,dy / distance';
    case 'copy':
      if (selectedCount === 0) return 'COPY (CO): Click an object to copy';
      return step === 0
        ? 'COPY (CO): Click base point for copy'
        : 'COPY (CO): Click target point to place copy (press Enter or Esc to finish)';
    case 'rotate':
      if (selectedCount === 0) return 'ROTATE (RO): Click an object to rotate';
      return step === 0
        ? 'ROTATE (RO): Click base point (center of rotation)'
        : 'ROTATE (RO): Move cursor and click, or type rotation angle in degrees and press Enter';
    case 'erase':
      return 'DELETE (E / DE): Click any object on the canvas to erase it (Esc to finish)';
    case 'offset':
      if (step === 0) {
        return 'OFFSET (O): Type distance (e.g. 12" or 300) or press Enter to accept current, or type T for Through point';
      }
      if (step === 1) {
        return 'OFFSET (O): Select object to offset (line, wall, arc, circle, polyline, rectangle)';
      }
      return 'OFFSET (O): Click point on side to offset (or Esc to finish)';
    case 'trim':
      if (step === 1) {
        return 'Select cutting edges… Select objects or <select all>:';
      }
      return 'Select object to trim or shift-select to extend or [cuTting edges/Crossing/mOde/Project/eRase/Undo]:';
    case 'extend':
      if (step === 1) {
        return 'Select boundary edges… Select objects or <select all>:';
      }
      return 'Select object to extend or shift-select to trim or [Boundary edges/Crossing/mOde/Project/Undo]:';
    case 'corner':
      return step === 0
        ? 'CORNER (TC): Select first line or wall to connect to a corner'
        : 'CORNER (TC): Select second line or wall (sides clicked will be kept)';
    case 'fillet':
      return step === 0
        ? 'FILLET (F): Select first line or wall (or type R to change radius; radius 0 makes clean corner)'
        : 'FILLET (F): Select second line or wall to connect';
    case 'chamfer':
      return step === 0
        ? 'CHAMFER (CHA): Select first line or wall (or type D to set two distances)'
        : 'CHAMFER (CHA): Select second line or wall to chamfer';
    case 'mirror':
      if (selectedCount === 0) {
        return 'MIRROR (MI): Click an object to mirror (or select objects first, then run MI)';
      }
      if (step === 0) {
        return 'MIRROR (MI): Click first point of mirror reflection line';
      }
      if (step === 1) {
        return 'MIRROR (MI): Click second point of mirror reflection line';
      }
      return 'MIRROR (MI): Erase source objects? Type Y (Yes) or N (No) in command bar below and press Enter';
    case 'array':
      if (selectedCount === 0) {
        return 'ARRAY (AR): Select objects to array first, then run AR';
      }
      if (step === 0) {
        return 'ARRAY (AR): Choose array type — Type R for Rectangular or P for Polar and press Enter';
      }
      return 'ARRAY (AR): Set rows, cols, spacing (or click center point for polar)';
    case 'scale':
      if (selectedCount === 0) {
        return 'SCALE (SC): Select objects to scale first, then run SC';
      }
      if (step === 0) {
        return 'SCALE (SC): Click base point for scale';
      }
      return 'SCALE (SC): Type scale factor (e.g. 1.5, 0.5) or type R for reference length, and press Enter';
    case 'stretch':
      if (step === 0) {
        return 'STRETCH (S): Click first corner of crossing window (green box) across endpoints to stretch';
      }
      if (step === 1) {
        return 'STRETCH (S): Click opposite corner of crossing window';
      }
      if (step === 2) {
        return 'STRETCH (S): Click base point for stretch';
      }
      return 'STRETCH (S): Click second point or type @dx,dy / distance to displace endpoints';
    case 'break':
      return step === 0
        ? 'BREAK (BR): Click object to break at first break point'
        : 'BREAK (BR): Click second break point (click same point to split, or different point to remove segment)';
    case 'join':
      return 'JOIN (J): Select collinear lines/walls or connected segments and press Enter to join';
    case 'explode':
      return 'EXPLODE (X): Select a block, polyline, rectangle, or wall to explode into individual primitives';
    case 'align':
      if (step === 0) {
        return 'ALIGN (AL): Select object to align (or click source edge)';
      }
      if (step === 1) {
        return 'ALIGN (AL): Click first destination reference point';
      }
      return 'ALIGN (AL): Click second destination point along reference direction';
    case 'matchprop':
      return step === 0
        ? 'MATCHPROP (MA): Click source object to copy properties from'
        : 'MATCHPROP (MA): Click destination object(s) to apply properties to (Esc to finish)';
    case 'area':
      return step === 0
        ? 'AREA (AA): Click first corner point of area polygon, or click an object'
        : 'AREA (AA): Click next point (press Enter to calculate enclosed area and perimeter)';
    case 'floor':
      return step === 0
        ? 'FLOOR (SB): Click inside enclosed walls, press W + Enter to use level walls, or click first boundary corner'
        : 'FLOOR (SB): Click next boundary corner, or press Enter to finish floor slab';
    case 'roof':
      return step === 0
        ? 'ROOF (RF): Click walls to pick them (Tab = whole connected chain) or switch to Sketch — then press Enter / Finish ✓'
        : 'ROOF (RF): Click the next outline corner, click the first corner (or Enter) to finish';
    case 'skylight':
      return 'SKYLIGHT (SKY): Click on a sloped roof face to place the skylight';
    case 'dormer':
      return 'DORMER (DMR): Click on a sloped roof face where the dormer front should be';
    case 'curtainwall':
      return step === 0 ? 'CURTAIN WALL (CW): Click the start point' : 'CURTAIN WALL (CW): Click the next point, or press Enter to finish';
    case 'paint':
      return 'PAINT (PT): Pick a finish in the options bar, then click a wall face (elevation / 3D) or a wall (plan)';
    case 'splitface':
      return 'SPLIT FACE (SF): In an elevation, click a wall face at the height of the split';
    case 'sweep':
      return 'SWEEP (SWP): Choose profile and height in the options bar, then click a wall';
    case 'reveal':
      return 'REVEAL (RVL): Set the height in the options bar, then click a wall';
    case 'balcony':
      return 'BALCONY (BAL): Click an exterior wall where the balcony should be centred';
    case 'footing':
      return 'FOOTING (FT): Click a column to place a pad under it — or select columns / a grid line and run FT';
    case 'wallfooting':
      return 'WALL FOOTING (WF): Click a wall to add a strip footing under it';
    case 'foundationslab':
      return step === 0 ? 'FOUNDATION SLAB (FS): Click inside walls, or click the first boundary point' : 'FOUNDATION SLAB (FS): Click the next point · click the first point or press Enter to close';
    case 'pilecap':
      return 'PILE CAP (PC): Click a column — pile count / diameter / length under More…';
    case 'beam':
      return step === 0 ? 'BEAM (BM): Click the start (snaps to column centres and wall tops)' : 'BEAM (BM): Click the end · beams chain from here · Esc / Enter to stop';
    case 'beamsystem':
      return 'BEAM SYSTEM (BS): Click inside a bay bounded by beams or walls';
    case 'brace':
      return step === 0 ? 'BRACE (BRC): Click the start point' : 'BRACE (BRC): Click the end point';
    case 'rebar':
      return 'REBAR (RB): Click a concrete footing, column, beam, slab or wall';
    case 'areareinf':
      return 'AREA REINFORCEMENT (ARN): Click a slab, wall or footing';
    case 'connection':
      return 'CONNECTION (CN): Click near a beam end (or select two members first)';
    case 'sjoint':
      return step === 0 ? 'JOINT (CJ): Click the first point across the slab' : 'JOINT (CJ): Click the second point';
    case 'load':
      return 'LOAD (LD): Point = click · line = 2 clicks · area = sketch + Enter';
    case 'section':
      return step === 0 ? 'SECTION (SEC): Click the start of the cut line' : 'SECTION (SEC): Click the end — the view looks to the left';
    case 'truss':
      return step === 0
        ? 'TRUSS (TR): Click inside a room for a truss across its short span — or click the first bearing point'
        : 'TRUSS (TR): Click the second bearing point (style, pitch and timber size in the options bar)';
    case 'kneebrace':
      return 'KNEE BRACE (KB): Click a timber post where beams frame in — braces are added on each side (straight or curved)';
    case 'roofframing':
      return 'TIMBER ROOF FRAMING (TRF): Click a roof — adds an exposed ridge beam, purlins (canted to the pitch) and rafters with decorative tails';
    case 'railing':
      return step === 0 ? 'RAILING (RAIL): Click the first path point' : 'RAILING (RAIL): Click the next path point, or press Enter to finish';
    case 'stair':
      return step === 0
        ? 'STAIR (ST): Click start point of straight stair run (base level)'
        : 'STAIR (ST): Move cursor to set run direction and click end point (risers/treads auto-calculated)';
    case 'column':
      return 'COLUMN (CL): Click to place column (snaps automatically to structural grid intersections; press R to rotate)';
    case 'grid':
      return step === 0
        ? 'GRID (GR): Click start point of structural grid line'
        : 'GRID (GR): Click end point of grid line (bubble label A, B, C / 1, 2, 3 assigned automatically)';
  }
}
