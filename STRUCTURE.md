# Structure toolset

> **For design visualization and coordination only — not a substitute for engineering by a licensed structural engineer.**
> This note is shown in the Help panel, the structural views and Properties, and on exports: PDF sheets, schedule CSVs, the IFC header, DXF and PNG.
> Warnings are simple coordination checks; no structural calculation is performed.

## UI
- **Left toolbar → Structure:** Footing (FT), Beam (BM) and Rebar (RB) are visible. **More… (10)** reveals Wall Footing, Foundation Slab, Pile Cap, Beam System, Brace, Area Reinforcement, Connection, Joint, Load and Section.
- **Column (CL)** in Build was upgraded in place, not duplicated:
  - Concrete rectangle or round; steel W8x31, W10x33, W12x40, W14x48 and HSS square or round; wood 6x6, 8x8 and glulam.
  - Top attaches to a level or to a beam (ATB).
  - Steel columns get an automatic base plate with four anchor bolts.
- **Reuse:** levels, grids and columns from earlier steps are reused.
- **Top bar → Arch | Struct | Combined:**
  - *Architectural* hides structural-only elements.
  - *Structural* fades architecture to light gray and draws structure strongly.
  - *Combined* shows everything.
- **Elevations ▾ → Structural:** Foundation Plan, Framing Plan (per level) and every Section.
- **3D view bar:** **View rebar** makes concrete hosts semi-transparent and shows bars as rods colored by size. **Analytical** shows centerlines, nodes, supports and loads.
- **Properties:** a structural panel for every element, Quick Rebar Presets, cover settings (with per-bar-set overrides) and automatic lintels with manual override.

## Commands (all undoable; in Help → "Structure")
| Command | Alias | Notes |
|---|---|---|
| Isolated Footing | FT | Select columns or a grid line, then FT places a footing under each. Footings follow their column. |
| Wall Footing | WF | Strip footing under walls; follows the wall. |
| Foundation Slab / Slab on Grade | FS (SOG) | From walls or a sketch. Thickened edge and vapor barrier. |
| Pile Cap + Piles | PC | 1–9 piles; count, diameter and length. |
| Beam | BM | Snaps to column centers and wall tops. Cut back at column faces. Steel W/C/L, concrete, wood. |
| Beam System | BS | Joists in a bay bounded by beams or walls, at a spacing and direction. |
| Brace | BRC | Start and end heights. (BR is BREAK.) |
| Rebar | RB | Bar sizes #3–#11 or 10M–35M. Six shapes and four layout rules. Cover per host or per set. |
| Area Reinforcement | ARN | Top and bottom mats in each direction, e.g. "#4 @ 12" EW T&B". (AR is ARRAY.) |
| Rebar Quick Preset | RBP | Beam, column, footing, slab and wall presets. |
| Steel Connection | CN | Shear plate, end plate, clip angle or base plate. Plates and bolts in 3D, a symbol in plan. |
| Joint | CJ | Control, construction or expansion. Expansion joints split the slab in 3D. |
| Load | LD | Point, line or area: kip, kip/ft, psf or kN, kN/m, kPa. |
| Section | SEC | Cut line in plan opens a section view showing members, materials and rebar dots. |
| Join / Unjoin / Switch join order | JG / UJ / SWJ | Manual control of automatic joins. |
| Attach column top to beam | ATB | |
| Foundation Plan / Framing Plan | FP / FRP | |
| Analytical view / View rebar | AN / VR | |
| Discipline | DSA / DSS / DSC | |

Also fixed: **Detach Walls from Roof** is now `DTR`. `DT` had collided with AutoCAD's TEXT alias.

## Engine (pure functions, `src/engine/structure.ts`)
- **Catalogs:** materials (concrete f'c 3000/4000/5000 psi and C25/C30/C35; steel A992 and A36; wood SPF #2, Douglas Fir, LVL, glulam; CMU), each with a plan/section pattern. Steel W/C/L/HSS and wood profiles.
- **Geometry:** member profiles; column z-range (attached to a level or beam); beam axes with automatic cut-back at column faces (respecting JG/UJ/SWJ); footings that follow their host; pile layout.
- **Rebar:**
  - Layout: single, fixed number, maximum spacing, number + spacing.
  - Cover clipping: bars always stay inside the host minus cover, with openings dilated by cover.
  - Hooks, U-bars, L-bars, stirrups and ties; area reinforcement mats.
  - Recomputed from the host, so bars follow when the host is resized.
- **Joins and joints:** clean concrete outlines (edges hidden inside joined concrete); expansion-joint slab splitting.
- **Other:** lintels sized automatically from opening width and wall material; connection geometry; the analytical model; warnings (span/depth over a limit, column with no foundation, unsupported beam end).
- **Schedules:** footing, column, beam and rebar (mark, size, shape, count, length, total, weight in lb or kg).
- **Other modules:**
  - `structurePlan.ts` draws structure in plan, the Foundation Plan and the Framing Plan.
  - `structureSection.ts` draws the section cut.
  - `structureTools.ts` handles clicks and selection actions.
  - `components/struct3d.ts` builds the 3D geometry.
- **Tests:** `npm test` runs 92 tests. The structural ones cover rebar count from spacing, rebar clipped by cover, beam cut back at the column face, presets inside the host, column presets, clean joins, expansion joints, lintels, joists and warnings.

## Outputs
- **Schedules view:** Footing, Column, Beam and Rebar tabs (live; CSV).
- **Sheets:** Foundation Plan, Framing Plans, Sections and the four schedules can be placed on any sheet. A new starter sheet, **S101**, has them laid out.
- **IFC4:**
  - IfcFooting (pad, strip, pile cap) and IfcPile.
  - IfcColumn, IfcBeam, IfcMember (brace, joist) and IfcSlab (floor or base slab).
  - IfcReinforcingBar, swept along each bar's center line.
  - Materials attached; the disclaimer is in the file header.
  - Validated with IfcOpenShell: 0 schema issues, all geometry builds.
- **DXF:** structural plan linework on S-layers, plus the note.

## Sample project
- A 3 × 2 grid (A–B / 1–3).
- Steel W8x31 columns on grids 1–2 and concrete 16x16 columns on grid 3, each on a 4'-0" pad footing with #5 @ 10" EW bottom.
- W12x26 and W14x30 steel beams at Level 2, with one shear-plate connection.
- One 12x24 concrete beam with 4 #6 bottom, 2 #5 top and #3 stirrups @ 6".
- A 5" slab on grade with a thickened edge, vapor barrier and #4 @ 12" EW, plus one control joint.
- Two sections.
