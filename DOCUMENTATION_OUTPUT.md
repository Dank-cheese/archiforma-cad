# Documentation output: what changed

## Schedules (Schedules tab)
- Door, Window and Room schedules. The Room schedule shows number, name, level, area, perimeter and finish.
- Cells edit the model. A cell commits once when you press Enter or Tab or leave the cell, so each
  edit is one undo step. Escape cancels. Lengths accept the project's units (`3'-6"`, `42"`,
  `2'-6 1/2"`, or `900` mm in metric). Invalid or out-of-range values are rejected with a
  message instead of being clamped.
- CSV export follows RFC 4180 and is saved as UTF-8 with a BOM, so Excel shows ×, ² and Ø correctly.

## Sheets + PDF
- A3, Tabloid and A1 sheets with a title block (project name, sheet number, date, scale).
- Drag plan, 3D and schedule views onto a sheet. Each move or resize is one undo step.
- Plans plot at the viewport's exact scale (1/2", 1/4", 3/16", 1/8" = 1'-0", 1:50, 1:100, 1:200).
  If a plan doesn't fit, it is clipped and flagged "CLIPPED AT THIS SCALE", and the inspector
  offers the largest scale that fits. The scale is never changed silently.
- The on-screen sheet and the PDF are drawn from the same plan primitives
  (`engine/planPrimitives.ts`): walls, doors and swings, windows, stairs, columns, grids, rooms,
  hatches, blocks, linework, text, leaders, tags and dimensions. Layer and V/G visibility are respected.
- The multi-page PDF is made with jsPDF, one page per sheet at that sheet's paper size. Schedule
  tables shrink to fit and report any rows that are hidden. 3D snapshots keep their aspect ratio.

## DXF export (`engine/dxfExport.ts`)
- AutoCAD R2000 (AC1015) with the full table, handle and owner structure. Validated with the ezdxf
  strict reader and auditor: 0 errors.
- One DXF layer per app layer, with nearest ACI colour, on/off and locked state.
- Aligned and linear dimensions are native DIMENSION entities with their `*D` geometry blocks.
  Radius, diameter and angular dimensions are written as lines + text.
- Hatches are native HATCH entities with a polyline boundary, using pattern lines or SOLID fill.
- Blocks are written once in BLOCKS and placed with INSERT. Rotation and X/Y scale were checked
  and match the app exactly.
- Imperial projects are written in inches ($INSUNITS 1, architectural units). Metric projects
  are written in millimetres ($INSUNITS 4).
- The Export menu offers the current level, or all levels stacked at their elevations.

## DXF import (`engine/dxfImport.ts`, uses dxf-parser)
- LINE, LWPOLYLINE/POLYLINE, CIRCLE, ARC, TEXT and MTEXT become editable objects. Polyline
  bulges become true arcs.
- Reads $INSUNITS (in, ft, mm, cm, m, …). Unitless files are read in the project's units.
- Adds only the layers that imported objects use. Skipped types (INSERT, DIMENSION, …) are
  reported in the command log.

## IFC4 export (`engine/ifcExport.ts`)
- Exports the IfcProject → Site → Building → Storeys structure.
- IfcWall uses the wall's joined footprint.
- IfcDoor and IfcWindow each get an IfcOpeningElement that cuts the full wall thickness.
- IfcSlab for floors, and IfcSpace for rooms with area and perimeter quantities.
- GlobalIds are valid and stable between exports, and strings use ISO 10303-21 encoding.
  IfcOpenShell validation: 0 issues.

## Tests
`npx tsx --test src/engine/engine.test.ts` runs 58 tests, 7 of them new for this work.
