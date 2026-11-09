import React from 'react';
import { LIBRARY_CATEGORIES, searchBlocks } from '../engine/componentLibrary';
import {
  Anchor,
  RectangleHorizontal,
  Tally4,
  SquareDashed,
  AlignVerticalSpaceAround,
  Link2,
  ArrowDownToLine,
  Slash,
  Grid2x2,
  ScanLine,
  Rows4,
  MousePointer,
  Minus,
  Waypoints,
  Square,
  Circle,
  Spline,
  BrickWall,
  DoorOpen,
  AppWindow,
  LayoutGrid,
  Move,
  Copy,
  RotateCw,
  Trash2,
  Ruler,
  Type,
  UnfoldHorizontal,
  Scissors,
  ArrowUpRight,
  CornerDownRight,
  Maximize2,
  FlipHorizontal,
  Scale,
  BoxSelect,
  Grid3X3,
  Split,
  Boxes,
  Ungroup,
  AlignVerticalJustifyCenter,
  Paintbrush,
  Shapes,
  Tag as TagIcon,
  PaintBucket,
  Compass,
  CircleDot,
  Milestone,
  PackagePlus,
  Sofa,
  PencilRuler,
  Wrench,
  Layers,
  Home,
  Columns3,
  Hash,
  TrendingUp,
  Grid3x3,
  SquareSplitVertical,
  SeparatorHorizontal,
  Rows3,
  Fence,
  Sun,
  Tent,
  PanelTop,
  Frame,
  Merge,
  Triangle,
  Warehouse,
  Camera,
  Box as BoxIcon3d,
} from 'lucide-react';
import { BlockDefinition, ToolId, UnitSystem } from '../types/model';
import { describeSvgArc, formatLength } from '../engine/geometry';

interface LeftToolbarProps {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onDeleteAction: () => void;
  leftTab: 'tools' | 'library';
  onChangeLeftTab: (tab: 'tools' | 'library') => void;
  blocks: BlockDefinition[];
  activeInsertBlockId: string;
  onSelectInsertBlock: (blockId: string) => void;
  insertRotation: number;
  onChangeInsertRotation: (deg: number) => void;
  insertScale: number;
  onChangeInsertScale: (scale: number) => void;
  onOpenBlockEditor: (blockId?: string) => void;
  units: UnitSystem;
  darkMode: boolean;
  uiMode?: 'beginner' | 'pro';
  /** VIEW / NAVIGATION: ViewCube on / off (NAVVCUBE) */
  viewCubeOn?: boolean;
  onToggleViewCube?: () => void;
}

interface ToolButtonConfig {
  id: ToolId;
  label: string;
  alias: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
  isImmediateErase?: boolean;
  customAction?: 'open-library' | 'open-bedit';
}

const TOOL_GROUPS: Array<{
  heading: string;
  tools: ToolButtonConfig[];
  more?: ToolButtonConfig[];
}> = [
  {
    heading: 'Draw',
    tools: [
      {
        id: 'line',
        label: 'Line',
        alias: 'L',
        tooltip: 'Line (L / LINE) — Draw straight line segment',
        icon: Minus,
      },
      {
        id: 'polyline',
        label: 'Polyline',
        alias: 'PL',
        tooltip: 'Polyline (PL / PLINE) — Draw connected multi-segment line',
        icon: Waypoints,
      },
      {
        id: 'rectangle',
        label: 'Rectangle',
        alias: 'REC',
        tooltip: 'Rectangle (REC / RECTANG) — Draw rectangle by two corners',
        icon: Square,
      },
      {
        id: 'circle',
        label: 'Circle',
        alias: 'C',
        tooltip: 'Circle (C / CIRCLE) — Draw circle by center and radius',
        icon: Circle,
      },
      {
        id: 'arc',
        label: 'Arc',
        alias: 'A',
        tooltip: 'Arc (A / ARC) — Draw 3-point circular arc',
        icon: Spline,
      },
    ],
  },
  {
    heading: 'Build',
    tools: [
      {
        id: 'wall',
        label: 'Wall',
        alias: 'WA',
        tooltip: 'Wall (WA) — Draw 2D/3D architectural wall with compound layers & corner auto-join',
        icon: BrickWall,
      },
      {
        id: 'door',
        label: 'Door',
        alias: 'DR',
        tooltip: 'Door (DR) — Embedded in a wall: snaps in, cuts the wall in plan & 3D, moves with it. SPACE flips, blue dimensions are editable',
        icon: DoorOpen,
      },
      {
        id: 'window',
        label: 'Window',
        alias: 'WN',
        tooltip: 'Window (WN) — Embedded in a wall: real hole with frame, glass & sill at Ext / Center / Int depth. SPACE flips the exterior side',
        icon: AppWindow,
      },
      {
        id: 'wallopening',
        label: 'Opening',
        alias: 'WO',
        tooltip: 'Wall Opening (WO) — Empty rectangular or arched hole through a wall (no frame); hosted like a door',
        icon: Frame,
      },
      {
        id: 'walljoin',
        label: 'Wall Join',
        alias: 'WJ',
        tooltip: 'Wall Join (WJ) — Click a corner to cycle Miter / Butt / Square off / Disallow join (seam). Shift+click swaps the through wall',
        icon: Merge,
      },
      {
        id: 'room',
        label: 'Room',
        alias: 'RM',
        tooltip: 'Room (RM) — Click inside enclosed walls to tag room & area',
        icon: LayoutGrid,
      },
      {
        id: 'floor',
        label: 'Floor',
        alias: 'SB',
        tooltip: 'Floor Slab (SB / FLOOR) — Sketch boundary or pick enclosed walls to create a structural slab',
        icon: Layers,
      },
      {
        id: 'roof',
        label: 'Roof',
        alias: 'RF',
        tooltip: 'Roof by Footprint (RF / ROOF) — Flat, Shed, Gable, Hip or Mansard roof: pick walls (Tab = chain) or sketch; edges define slope',
        icon: Home,
      },
      {
        id: 'stair',
        label: 'Stair',
        alias: 'ST',
        tooltip: 'Stairs (ST / STAIR) — Straight run between two levels with automatic riser/tread calculation',
        icon: TrendingUp,
      },
      {
        id: 'column',
        label: 'Column',
        alias: 'CL',
        tooltip: 'Column (CL / COLUMN) — Concrete (rectangle / round), steel (W, HSS) or wood (6x6, 8x8, glulam); snaps to grid intersections; top can attach to a level or a beam',
        icon: Columns3,
      },
      {
        id: 'grid',
        label: 'Grid',
        alias: 'GR',
        tooltip: 'Grid (GR / GRID) — Draw datum grid lines with auto A, B, C / 1, 2, 3 bubbles',
        icon: Hash,
      },
      {
        id: 'insert',
        label: 'Component',
        alias: 'CM',
        tooltip: 'Place a Component (CM / I / INSERT) — Open Library & place 2D/3D furniture, fixtures, stairs, or trees',
        icon: Sofa,
        customAction: 'open-library',
      },
      {
        id: 'block',
        label: 'Make Block',
        alias: 'B',
        tooltip: 'Make Block (B / BLOCK) — Select objects + base point to save as a named block',
        icon: PackagePlus,
      },
      {
        id: 'bedit',
        label: 'Edit Block',
        alias: 'BE',
        tooltip: 'Edit Block (BE / BEDIT) — Edit a block definition; all placed instances update',
        icon: PencilRuler,
        customAction: 'open-bedit',
      },
      {
        id: 'camera',
        label: 'Camera',
        alias: 'CAM',
        tooltip: 'Camera (CAM) — Click a position, aim, then widen the view: saves a 3D perspective view (Camera 1, 2…). Wheel = FOV; live preview while placing',
        icon: Camera,
      },
    ],
  },
  {
    heading: 'Facade',
    tools: [
      {
        id: 'paint',
        label: 'Paint',
        alias: 'PT',
        tooltip: 'Paint (PT) — Apply an exterior finish (Brick, Siding, Stucco, Stone…) to a wall face in elevation, 3D or plan',
        icon: Paintbrush,
      },
      {
        id: 'curtainwall',
        label: 'Curtain Wall',
        alias: 'CW',
        tooltip: 'Curtain Wall (CW) — Glass grid wall with mullions; click cells in elevation to change Glass / Solid / Door',
        icon: Grid3x3,
      },
    ],
    more: [
      {
        id: 'splitface',
        label: 'Split Face',
        alias: 'SF',
        tooltip: 'Split Face (SF) — Divide a facade horizontally (e.g. stone base + siding above) in an elevation',
        icon: SquareSplitVertical,
      },
      {
        id: 'sweep',
        label: 'Sweep',
        alias: 'SWP',
        tooltip: 'Sweep (SWP) — Horizontal trim band, cornice or base along a wall at a chosen height',
        icon: SeparatorHorizontal,
      },
      {
        id: 'reveal',
        label: 'Reveal',
        alias: 'RVL',
        tooltip: 'Reveal (RVL) — Recessed horizontal groove along a wall',
        icon: Rows3,
      },
      {
        id: 'balcony',
        label: 'Balcony',
        alias: 'BAL',
        tooltip: 'Balcony (BAL) — Slab with railing attached to a wall at a level',
        icon: PanelTop,
      },
      {
        id: 'railing',
        label: 'Railing',
        alias: 'RAIL',
        tooltip: 'Railing (RAIL) — Pick a path; top rail with balusters or glass panels',
        icon: Fence,
      },
      {
        id: 'skylight',
        label: 'Skylight',
        alias: 'SKY',
        tooltip: 'Skylight (SKY) — Place a skylight on a roof face (cuts the roof in 3D)',
        icon: Sun,
      },
      {
        id: 'dormer',
        label: 'Dormer',
        alias: 'DMR',
        tooltip: 'Dormer (DMR) — Gable dormer with a window on a sloped roof face',
        icon: Tent,
      },
    ],
  },
  {
    heading: 'Structure',
    tools: [
      {
        id: 'footing',
        label: 'Footing',
        alias: 'FT',
        tooltip: 'Isolated Footing (FT) — Pad under a column (click a column, or select columns / a grid line first); shown dashed in plan',
        icon: Anchor,
      },
      {
        id: 'beam',
        label: 'Beam',
        alias: 'BM',
        tooltip: 'Beam (BM) — Draw column to column or grid to grid; snaps to column centres and wall tops. Steel W / C / L, concrete or wood',
        icon: RectangleHorizontal,
      },
      {
        id: 'rebar',
        label: 'Rebar',
        alias: 'RB',
        tooltip: 'Rebar (RB) — Click a concrete footing, column, beam, slab or wall to add bars (or use a Quick Preset in Properties)',
        icon: Tally4,
      },
    ],
    more: [
      {
        id: 'wallfooting',
        label: 'Wall Footing',
        alias: 'WF',
        tooltip: 'Wall Footing (WF) — Strip footing under a wall (click walls, or select walls first); follows the wall',
        icon: Rows4,
      },
      {
        id: 'foundationslab',
        label: 'Fdn. Slab',
        alias: 'FS',
        tooltip: 'Foundation Slab / Slab on Grade (FS) — Click inside walls or sketch a boundary; thickened edges, vapor barrier',
        icon: SquareDashed,
      },
      {
        id: 'pilecap',
        label: 'Pile Cap',
        alias: 'PC',
        tooltip: 'Pile Cap + Piles (PC) — Cap under a column with 1–9 piles (count, diameter, length)',
        icon: CircleDot,
      },
      {
        id: 'beamsystem',
        label: 'Beam System',
        alias: 'BS',
        tooltip: 'Beam System (BS) — Click inside a bay bounded by beams or walls to fill it with joists at a spacing',
        icon: AlignVerticalSpaceAround,
      },
      {
        id: 'brace',
        label: 'Brace',
        alias: 'BRC',
        tooltip: 'Brace (BRC) — Diagonal brace between two points; start / end heights in the options bar',
        icon: Slash,
      },
      {
        id: 'areareinf',
        label: 'Area Reinf.',
        alias: 'ARN',
        tooltip: 'Area Reinforcement (ARN) — Top / bottom mats in two directions for a slab, wall or footing (e.g. #4 @ 12" EW T&B)',
        icon: Grid2x2,
      },
      {
        id: 'connection',
        label: 'Connection',
        alias: 'CN',
        tooltip: 'Steel Connection (CN) — Select two members (or click near a beam end): shear plate, end plate, clip angle or base plate',
        icon: Link2,
      },
      {
        id: 'sjoint',
        label: 'Joint',
        alias: 'CJ',
        tooltip: 'Construction / Control / Expansion Joint (CJ) — Two clicks across a slab; expansion joints split the slab in 3D',
        icon: ScanLine,
      },
      {
        id: 'load',
        label: 'Load',
        alias: 'LD',
        tooltip: 'Load (LD) — Point, line or area load with a value (kip, kip/ft, psf or kN units)',
        icon: ArrowDownToLine,
      },
      {
        id: 'section',
        label: 'Section',
        alias: 'SEC',
        tooltip: 'Structural Section (SEC) — Draw a cut line in plan; opens a section view with members and rebar',
        icon: Scissors,
      },
      {
        id: 'truss',
        label: 'Truss',
        alias: 'TRS',
        tooltip: 'Timber Truss (TRS) — King Post / Queen Post / Hammerbeam / Scissor; one click inside a room spans it',
        icon: Triangle,
      },
      {
        id: 'kneebrace',
        label: 'Knee Brace',
        alias: 'KB',
        tooltip: 'Knee Brace (KB) — Straight or curved timber braces between a post and its beams',
        icon: CornerDownRight,
      },
      {
        id: 'roofframing',
        label: 'Roof Framing',
        alias: 'TRF',
        tooltip: 'Timber Roof Framing (TRF) — Exposed ridge beam, purlins and rafters with decorative tails under a roof',
        icon: Warehouse,
      },
    ],
  },
  {
    heading: 'Edit',
    tools: [
      {
        id: 'select',
        label: 'Select',
        alias: 'ESC',
        tooltip: 'Select (SELECT / Esc) — Click or box-select objects & drag grips',
        icon: MousePointer,
      },
      {
        id: 'move',
        label: 'Move',
        alias: 'M',
        tooltip: 'Move (M / MV) — Move objects from base point to target point',
        icon: Move,
      },
      {
        id: 'copy',
        label: 'Copy',
        alias: 'CO',
        tooltip: 'Copy (CO) — Duplicate selected objects to one or more points',
        icon: Copy,
      },
      {
        id: 'rotate',
        label: 'Rotate',
        alias: 'RO',
        tooltip: 'Rotate (RO) — Rotate objects around a base point',
        icon: RotateCw,
      },
      {
        id: 'offset',
        label: 'Offset',
        alias: 'O',
        tooltip: 'Offset (O) — Parallel copy of line, wall, arc, or concentric circle',
        icon: UnfoldHorizontal,
      },
      {
        id: 'trim',
        label: 'Trim',
        alias: 'TR',
        tooltip: 'Trim (TR) — Cut objects cleanly at intersecting cutting edges',
        icon: Scissors,
      },
      {
        id: 'extend',
        label: 'Extend',
        alias: 'EX',
        tooltip: 'Extend (EX) — Extend lines or walls to meet boundary edges',
        icon: ArrowUpRight,
      },
      {
        id: 'fillet',
        label: 'Fillet',
        alias: 'F',
        tooltip: 'Fillet (F) — Connect lines or walls with arc or clean corner (R=0)',
        icon: CornerDownRight,
      },
      {
        id: 'chamfer',
        label: 'Chamfer',
        alias: 'CHA',
        tooltip: 'Chamfer (CHA) — Bevel the corner between two lines or walls',
        icon: Maximize2,
      },
      {
        id: 'mirror',
        label: 'Mirror',
        alias: 'MI',
        tooltip: 'Mirror (MI) — Reflect objects across a 2-point axis line',
        icon: FlipHorizontal,
      },
      {
        id: 'scale',
        label: 'Scale',
        alias: 'SC',
        tooltip: 'Scale (SC) — Enlarge or shrink objects by factor from base point',
        icon: Scale,
      },
      {
        id: 'stretch',
        label: 'Stretch',
        alias: 'S',
        tooltip: 'Stretch (S) — Displace endpoints inside a crossing window',
        icon: BoxSelect,
      },
      {
        id: 'array',
        label: 'Array',
        alias: 'AR',
        tooltip: 'Array (AR) — Duplicate objects in rectangular grid or polar pattern',
        icon: Grid3X3,
      },
      {
        id: 'break',
        label: 'Break',
        alias: 'BR',
        tooltip: 'Break (BR) — Split object at point or cut out segment',
        icon: Split,
      },
      {
        id: 'join',
        label: 'Join',
        alias: 'J',
        tooltip: 'Join (J) — Merge collinear lines/walls or connect into polyline',
        icon: Boxes,
      },
      {
        id: 'explode',
        label: 'Explode',
        alias: 'X',
        tooltip: 'Explode (X) — Break block, polyline, wall, or rectangle into lines',
        icon: Ungroup,
      },
      {
        id: 'align',
        label: 'Align',
        alias: 'AL',
        tooltip: 'Align (AL) — Move and rotate object to match reference line',
        icon: AlignVerticalJustifyCenter,
      },
      {
        id: 'matchprop',
        label: 'Match',
        alias: 'MA',
        tooltip: 'Match Properties (MA / MATCHPROP) — Copy properties to objects',
        icon: Paintbrush,
      },
      {
        id: 'erase',
        label: 'Delete',
        alias: 'E',
        tooltip: 'Delete (E / DE / Del) — Erase selected objects or pick to erase',
        icon: Trash2,
        isImmediateErase: true,
      },
    ],
  },
  {
    heading: 'Annotate',
    tools: [
      {
        id: 'dimension',
        label: 'Aligned',
        alias: 'DAL',
        tooltip: 'Aligned Dimension (DAL / DI) — Aligned dimension (Tab cycles wall face)',
        icon: Ruler,
      },
      {
        id: 'dli',
        label: 'Linear',
        alias: 'DLI',
        tooltip: 'Linear Dimension (DLI) — Horizontal / vertical dimension',
        icon: Ruler,
      },
      {
        id: 'dan',
        label: 'Angular',
        alias: 'DAN',
        tooltip: 'Angular Dimension (DAN) — Angle between lines/vertices',
        icon: Compass,
      },
      {
        id: 'dra',
        label: 'Radius',
        alias: 'DRA',
        tooltip: 'Radius Dimension (DRA) — Radial callout on arc or circle',
        icon: CircleDot,
      },
      {
        id: 'ddi',
        label: 'Diameter',
        alias: 'DDI',
        tooltip: 'Diameter Dimension (DDI) — Diameter across circle or arc',
        icon: Circle,
      },
      {
        id: 'dco',
        label: 'Continue',
        alias: 'DCO',
        tooltip: 'Continue Dimension (DCO) — Chained dimension string',
        icon: Milestone,
      },
      {
        id: 'dba',
        label: 'Baseline',
        alias: 'DBA',
        tooltip: 'Baseline Dimension (DBA) — Stacked baseline dimensions',
        icon: Milestone,
      },
      {
        id: 'leader',
        label: 'Leader',
        alias: 'LE',
        tooltip: 'Leader Note (LE / MLEADER) — Arrowhead with landing shelf note',
        icon: ArrowUpRight,
      },
      {
        id: 'hatch',
        label: 'Hatch',
        alias: 'H',
        tooltip: 'Hatch (H) — Fill enclosed area with architectural pattern',
        icon: PaintBucket,
      },
      {
        id: 'tag',
        label: 'Tag',
        alias: 'TG',
        tooltip: 'Tag by Category (TG) — Tag doors (D1), windows (W1), rooms',
        icon: TagIcon,
      },
      {
        id: 'text',
        label: 'Text Note',
        alias: 'TX',
        tooltip: 'Text Note (TX / T / MTEXT) — Place text note with alignment',
        icon: Type,
      },
      {
        id: 'dist',
        label: 'Distance',
        alias: 'DIST',
        tooltip: 'Distance (DIST) — Measure distance between two points',
        icon: Ruler,
      },
      {
        id: 'area',
        label: 'Area',
        alias: 'AA',
        tooltip: 'Area (AA) — Measure area and perimeter of polygon or object',
        icon: Shapes,
      },
    ],
  },
];

const BlockSvgThumbnail: React.FC<{ block: BlockDefinition }> = ({ block }) => {
  const halfSpan = Math.max(block.width, block.depth, 24) * 0.62;
  const sw = halfSpan * 0.055;
  return (
    <svg
      viewBox={`${-halfSpan} ${-halfSpan} ${halfSpan * 2} ${halfSpan * 2}`}
      className="w-10 h-10 shrink-0 rounded border border-stone-200 dark:border-stone-700 bg-[#f8f7f4] dark:bg-stone-950 p-0.5"
    >
      {block.entities.map((ent) => {
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
              fill={`${block.color}26`}
              stroke={block.color}
              strokeWidth={sw}
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
              stroke={block.color}
              strokeWidth={sw}
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
              fill={`${block.color}24`}
              stroke={block.color}
              strokeWidth={sw}
            />
          );
        }
        if (ent.type === 'polyline') {
          return <polyline key={ent.id} points={ent.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={ent.closed ? `${block.color}24` : 'none'} stroke={block.color} strokeWidth={sw} />;
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
              stroke={block.color}
              strokeWidth={sw}
            />
          );
        }
        return null;
      })}
    </svg>
  );
};

export const LeftToolbar: React.FC<LeftToolbarProps> = ({
  activeTool,
  onSelectTool,
  onDeleteAction,
  leftTab,
  onChangeLeftTab,
  blocks,
  activeInsertBlockId,
  onSelectInsertBlock,
  insertRotation,
  onChangeInsertRotation,
  insertScale,
  onChangeInsertScale,
  onOpenBlockEditor,
  units,
  darkMode,
  uiMode = 'beginner',
  viewCubeOn = true,
  onToggleViewCube,
}) => {
  const [openMore, setOpenMore] = React.useState<Record<string, boolean>>({});
  const isPro = uiMode === 'pro';
  const [libQuery, setLibQuery] = React.useState('');
  const [libCat, setLibCat] = React.useState('All');
  const shownBlocks = React.useMemo(() => {
    const order = LIBRARY_CATEGORIES;
    return searchBlocks(blocks, libQuery, libCat).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  }, [blocks, libQuery, libCat]);

  return (
    <aside
      aria-label="CAD Tools and Component Library"
      className={`${
        leftTab === 'library'
          ? 'w-52 sm:w-56'
          : isPro
          ? 'w-28 sm:w-32'
          : 'w-40 sm:w-44'
      } border-r flex flex-col py-2 px-2 gap-2 overflow-y-auto select-none shrink-0 z-20 transition-all ${
        darkMode
          ? 'bg-stone-900 border-stone-800 text-stone-200'
          : 'bg-white border-stone-200 text-stone-800'
      }`}
    >
      {/* Segmented Tab Switcher: Tools vs Library */}
      <div
        className={`grid grid-cols-2 p-0.5 rounded-lg border text-[11px] font-semibold shrink-0 ${
          darkMode
            ? 'bg-stone-950 border-stone-800'
            : 'bg-stone-100 border-stone-200'
        }`}
      >
        <button
          type="button"
          onClick={() => onChangeLeftTab('tools')}
          aria-label="Show Drafting, Modify and Annotation Tools"
          aria-pressed={leftTab === 'tools'}
          className={`flex items-center justify-center gap-1 py-1 rounded-md transition-colors cursor-pointer ${
            leftTab === 'tools'
              ? darkMode
                ? 'bg-stone-800 text-amber-400 shadow-xs'
                : 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
          }`}
          title="Drafting, Modify & Annotation Tools"
        >
          <Wrench className="w-3 h-3" />
          <span>Tools</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onChangeLeftTab('library');
            onSelectTool('insert');
          }}
          aria-label="Show Component and Block Library"
          aria-pressed={leftTab === 'library'}
          className={`flex items-center justify-center gap-1 py-1 rounded-md transition-colors cursor-pointer ${
            leftTab === 'library'
              ? darkMode
                ? 'bg-stone-800 text-amber-400 shadow-xs'
                : 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
          }`}
          title="Component & Block Library (I / INSERT / CM)"
        >
          <Sofa className="w-3 h-3" />
          <span>Library</span>
        </button>
      </div>

      {/* TAB 1: TOOLS */}
      {leftTab === 'tools' &&
        TOOL_GROUPS.map((group, gIdx) => (
          <div key={group.heading} className="flex flex-col gap-1">
            {gIdx > 0 && (
              <div
                className={`h-px mb-1 ${
                  darkMode ? 'bg-stone-800' : 'bg-stone-200'
                }`}
              />
            )}
            <div className="px-1 text-[11px] font-semibold tracking-tight text-stone-500 dark:text-stone-400">
              {group.heading}
            </div>
            <div
              className={
                isPro
                  ? 'grid grid-cols-3 gap-1'
                  : 'grid grid-cols-2 gap-1'
              }
            >
              {[...group.tools, ...(group.more && openMore[group.heading] ? group.more : [])].map((tool) => {
                const Icon = tool.icon;
                const isActive = activeTool === tool.id;
                return (
                  <button
                    key={`${tool.id}-${tool.alias}`}
                    type="button"
                    onClick={() => {
                      if (tool.isImmediateErase) {
                        onDeleteAction();
                      } else if (tool.customAction === 'open-library') {
                        onChangeLeftTab('library');
                        onSelectTool('insert');
                      } else if (tool.customAction === 'open-bedit') {
                        onOpenBlockEditor(activeInsertBlockId);
                      } else {
                        onSelectTool(tool.id);
                      }
                    }}
                    title={tool.tooltip}
                    aria-label={tool.tooltip}
                    aria-pressed={isActive}
                    className={
                      isPro
                        ? `group relative flex items-center justify-center p-2 rounded-md transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-amber-600 text-white shadow-xs'
                              : darkMode
                              ? 'hover:bg-stone-800 text-stone-300'
                              : 'hover:bg-stone-100 text-stone-700'
                          }`
                        : `group relative flex flex-col items-center justify-center px-1.5 py-1.5 rounded-md text-center transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-amber-600 text-white shadow-xs'
                              : darkMode
                              ? 'hover:bg-stone-800 text-stone-200'
                              : 'hover:bg-stone-100 text-stone-700'
                          }`
                    }
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive
                          ? 'text-white'
                          : 'text-stone-600 dark:text-stone-300 group-hover:text-amber-600 dark:group-hover:text-amber-400'
                      }`}
                    />
                    {!isPro && (
                      <>
                        <span className="truncate w-full text-[10px] font-medium leading-tight mt-1">
                          {tool.label}
                        </span>
                        <span
                          className={`text-[9px] font-mono leading-none mt-0.5 ${
                            isActive
                              ? 'text-amber-100'
                              : 'text-stone-500 dark:text-stone-400'
                          }`}
                        >
                          {tool.alias}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
            {group.more && (
              <button
                type="button"
                onClick={() => setOpenMore((m) => ({ ...m, [group.heading]: !m[group.heading] }))}
                aria-expanded={!!openMore[group.heading]}
                className="self-start px-1 text-[11px] font-semibold text-amber-600 hover:underline cursor-pointer"
                title={`More ${group.heading.toLowerCase()} tools: ${group.more.map((t) => `${t.label} (${t.alias})`).join(', ')}`}
              >
                {openMore[group.heading] ? 'Less' : `More… (${group.more.length})`}
              </button>
            )}
          </div>
        ))}

      {/* VIEW / NAVIGATION: ViewCube toggle */}
      {leftTab === 'tools' && onToggleViewCube && (
        <div className="flex flex-col gap-1">
          <div className={`h-px mb-1 ${darkMode ? 'bg-stone-800' : 'bg-stone-200'}`} />
          <div className="px-1 text-[11px] font-semibold tracking-tight text-stone-500 dark:text-stone-400">View / Navigation</div>
          <button
            type="button"
            aria-label="ViewCube"
            aria-pressed={!!viewCubeOn}
            onClick={onToggleViewCube}
            title={`ViewCube (NAVVCUBE / CUBE) — ${viewCubeOn ? 'ON: click to hide it' : 'OFF: click to show it'} in the 3D view and the plan`}
            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] font-semibold cursor-pointer ${
              darkMode ? 'bg-stone-950 border-stone-800 text-stone-200 hover:border-amber-600' : 'bg-stone-50 border-stone-200 text-stone-800 hover:border-amber-600'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <BoxIcon3d className="w-3.5 h-3.5" />
              ViewCube
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${viewCubeOn ? 'bg-green-600 text-white' : darkMode ? 'bg-stone-700 text-stone-300' : 'bg-stone-300 text-stone-700'}`} data-testid="viewcube-toggle-state">
              {viewCubeOn ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      )}

      {/* TAB 2: COMPONENT & BLOCK LIBRARY */}
      {leftTab === 'library' && (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0">
          {/* Block Actions (B / BE) */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onSelectTool('block')}
              aria-label="Make Block (B)"
              title="Make Block (B / BLOCK) — Select objects on canvas + base point to save a custom block"
              className={`px-2 py-1.5 rounded-md border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                activeTool === 'block'
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : darkMode
                  ? 'bg-stone-950 border-stone-800 hover:border-amber-600 text-stone-200'
                  : 'bg-stone-50 border-stone-200 hover:border-amber-600 text-stone-800'
              }`}
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>New (B)</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenBlockEditor(activeInsertBlockId)}
              aria-label="Edit Block Definition (BE)"
              title="Block Editor (BE / BEDIT) — Edit block definition and update all instances"
              className={`px-2 py-1.5 rounded-md border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                darkMode
                  ? 'bg-stone-950 border-stone-800 hover:border-amber-600 text-stone-200'
                  : 'bg-stone-50 border-stone-200 hover:border-amber-600 text-stone-800'
              }`}
            >
              <PencilRuler className="w-3.5 h-3.5" />
              <span>Edit (BE)</span>
            </button>
          </div>

          {/* Placement Rotation & Scale Controls */}
          <div
            className={`p-2 rounded-lg border space-y-2 ${
              darkMode
                ? 'bg-stone-950/70 border-stone-800'
                : 'bg-stone-50 border-stone-200/90'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Insert Options (I)
              </span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                Press R to rotate
              </span>
            </div>

            <div className="flex items-center justify-between gap-1">
              <label className="text-[11px] text-stone-600 dark:text-stone-400">
                Angle
              </label>
              <div className="flex items-center gap-0.5">
                {[0, 90, 180, 270].map((ang) => (
                  <button
                    key={ang}
                    type="button"
                    aria-label={`Set insert angle to ${ang} degrees`}
                    onClick={() => onChangeInsertRotation(ang)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                      insertRotation === ang
                        ? 'bg-amber-600 border-amber-600 text-white font-bold'
                        : darkMode
                        ? 'border-stone-800 hover:bg-stone-800 text-stone-300'
                        : 'border-stone-200 hover:bg-stone-100 text-stone-700'
                    }`}
                  >
                    {ang}°
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-stone-600 dark:text-stone-400">
                Scale
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                aria-label="Component insert scale"
                value={insertScale}
                onChange={(e) =>
                  onChangeInsertScale(
                    Math.max(0.1, parseFloat(e.target.value) || 1)
                  )
                }
                className={`w-20 px-2 py-0.5 text-xs font-mono text-right rounded border ${
                  darkMode
                    ? 'bg-stone-900 border-stone-700 text-stone-100'
                    : 'bg-white border-stone-300 text-stone-900'
                }`}
              />
            </div>
          </div>

          {/* Search + category filter */}
          <input
            type="search"
            aria-label="Search components"
            placeholder="Search: fireplace, tub, stair, pine…"
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            className={`w-full px-2 py-1 text-xs rounded-md border ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'}`}
          />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Component categories">
            {LIBRARY_CATEGORIES.filter((c) => c === 'All' || blocks.some((b) => b.category === c)).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setLibCat(c)}
                aria-pressed={libCat === c}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${libCat === c ? 'bg-amber-600 border-amber-600 text-white' : darkMode ? 'border-stone-700 text-stone-300' : 'border-stone-300 text-stone-600'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="text-[11px] font-semibold tracking-tight text-stone-500 dark:text-stone-400 px-0.5">
            Components ({shownBlocks.length} of {blocks.length})
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {shownBlocks.map((block, i) => {
              const head = i === 0 || shownBlocks[i - 1].category !== block.category;
              const isSelected =
                activeTool === 'insert' && activeInsertBlockId === block.id;
              return (
                <React.Fragment key={block.id}>
                {head && <div className="pt-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">{block.category}</div>}
                <div
                  onClick={() => {
                    onSelectInsertBlock(block.id);
                    onSelectTool('insert');
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Insert component ${block.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectInsertBlock(block.id);
                      onSelectTool('insert');
                    }
                  }}
                  title={`Insert "${block.name}" (${formatLength(
                    block.width,
                    units
                  )} × ${formatLength(block.depth, units)})`}
                  className={`p-1.5 rounded-lg border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? darkMode
                        ? 'bg-amber-950/40 border-amber-500 ring-1 ring-amber-500/40'
                        : 'bg-amber-50/90 border-amber-500 ring-1 ring-amber-500/30'
                      : darkMode
                      ? 'bg-stone-950/50 border-stone-800 hover:border-stone-700'
                      : 'bg-stone-50/70 border-stone-200 hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <BlockSvgThumbnail block={block} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">
                        {block.name}
                      </div>
                      <div className="text-[10px] font-mono text-stone-500 dark:text-stone-400 truncate">
                        {formatLength(block.width, units)} ×{' '}
                        {formatLength(block.depth, units)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Edit ${block.name} block definition`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBlockEditor(block.id);
                    }}
                    title={`Edit "${block.name}" block definition (BE)`}
                    className={`p-1 rounded text-[10px] font-mono border shrink-0 cursor-pointer ${
                      darkMode
                        ? 'border-stone-700 hover:bg-stone-800 text-stone-400 hover:text-amber-400'
                        : 'border-stone-200 hover:bg-stone-200/70 text-stone-600 hover:text-amber-700'
                    }`}
                  >
                    BE
                  </button>
                </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};

