# Doors, windows & wall openings — embedded in walls

The existing hosted doors and windows were **upgraded in place**; there is no second system. Every opening is still a `door` / `window` entity hosted by `wallId` + `offset` (0..1 along the wall), so older projects load unchanged. The new **Wall Opening (WO)** uses the same hosting.

## Stored per opening
`{ wallId, offset (= positionAlongWall, 0..1), width, height, sillHeight (doors: 0), depthPosition }`

- `depthPosition` is where the frame sits in the wall thickness: `'exterior' | 'center' | 'interior' | number`. A number is a custom offset in inches from the wall centre toward the exterior.
- Windows have `flipFacing`, which swaps which side counts as the exterior. Doors keep `swing` (hand + facing).
- `mark` (D1, W1, O1…) is assigned automatically when an opening is placed. Tags follow it.

## Placing (DR · WN · WO)
- **Options bar:**
  - Type.
  - Depth: Ext / Center / Int, with a custom offset under **More…**.
  - ⇅ Flip.
  - Door hinge.
  - **Center** and **EQ** snaps.
  - For WO: Rectangular / Arched, W and H, and sill height under **More…**.
- **Hover a wall:** the preview snaps into it, centred in the thickness. It turns **red** when the opening would overlap another one or run past the wall end; clicking then explains why and places nothing.
- **Facing:**
  - Doors swing toward the side the cursor is on.
  - **SPACE** flips the swing (door) or the exterior side (window).
  - **Shift+Space** flips the door hinge.
- **Temporary dimensions (light blue):** they measure to the nearest wall ends, neighbouring openings and the nearest grid line. Click a number, type a value (e.g. `2'-6"`) and press Enter: the opening is placed exactly there.
- Click to place. The tool stays active; **Esc** finishes.

## Editing
- **Selecting an opening shows:**
  - Its temporary dimensions; typing into one moves the opening.
  - ⇅ facing and ⇆ hand flip buttons.
  - Three grips:
    - The middle grip slides the opening along its wall, clamped so it can never leave the wall. Dragging it onto another wall re-hosts it.
    - The two side grips change the width; the other jamb stays put.
- **Elevation:** select an opening; the blue top grip changes the head height, and the bottom grip changes the sill (windows and openings).
- **Properties:**
  - **Type** (Edit type… applies to every instance): width, height, operation, frame material, divisions/lites, default sill.
  - **Instance:** mark, sill, head (linked: head = sill + height), depth, flip, distance from the wall start.
  - **More…:** custom depth, instance size, frame width, trim, shutters, comments.
  - Hosting warnings appear at the top.
- **EQ** (command): spaces the selected openings, or all openings of a selected wall, with equal gaps.
- **Move / Copy / Array:**
  - Openings moved on their own slide along their wall, or re-host to the wall under them.
  - Copied walls bring their openings.
  - Copies of an opening stay on its wall.

## Hosting rules
- **Moving or rotating a wall** carries its openings (same parametric position).
- **Stretching a wall** (grips, STRETCH, TRIM/EXTEND, properties…): each opening keeps its distance from the fixed end. This is applied centrally on every model change (`reanchorHostedOpenings`).
- **Splitting a wall:** each opening is re-hosted onto the piece that contains it.
- **If a wall becomes too short:**
  - The opening is kept and gets a **yellow ⚠** in plan and a warning in Properties.
  - Warnings also cover past-the-end, overlap and taller-than-wall.
  - Openings are never deleted silently.
- **Deleting a wall** asks **"Also delete N hosted doors/windows?"** (Cancel keeps everything).

## Cutting the wall
- **Plan:**
  - The wall breaks at every door, window and wall opening, and jamb lines close each piece.
  - Windows draw frame jambs, head/sill frame lines and glass at the depth position. Sliders show two offset sashes, double-hung two glass lines, and casement a dashed swing. Sill and stool lines sit at the wall faces.
  - Doors draw jambs, the leaf and the swing arc from the frame face. Double doors show two leaves, sliding doors two panels, and garage doors a dashed overhead track.
  - Wall openings show dashed head lines.
  - Multi-layer walls return their face finish layers into the opening up to the frame; the core is notched back.
  - The same symbols are used on screen, on sheets/PDF and in DXF.
- **3D:**
  - Each wall face is a `THREE.Shape` with one hole per opening (doors and floor-level openings notch the base), extruded through the thickness. The cut faces form the reveal. No boolean library is used.
  - Frames, sashes, transparent reflective glass, exterior sill and interior stool sit at the depth position.
  - Doors get frames, leaves, a threshold and casing. Arched openings are true arches.
- **Elevations:** frames, divisions, operation marks (meeting rails, dashed swing triangles), trims, sills and shutters. Wall openings are drawn as dark recesses (arched or rectangular).
- **IFC4:**
  - Each door and window gets an IfcOpeningElement that voids the wall, and the door or window fills it, placed at the depth position. Operation enums are exported (single/double swing, sliding, rolling-up).
  - A WO exports as a void only.
  - Validated with IfcOpenShell: 0 schema issues and 0 geometry failures.

## Type catalog
- **Doors:**
  - Single 30×80, 32×80 and 36×80.
  - Double 60×80.
  - Sliding glass 72×80 and 96×80.
  - Garage 16'×7'.
  - The earlier 84" types are kept.
- **Windows:**
  - Sliders 24×36, 36×48, 48×60 and 72×48.
  - Fixed picture 60×54.
  - Casement 48×48.
  - Double-hung 36×60.
  - Awning 36×36.
- **Frame materials:** vinyl, wood, aluminum, fiberglass, steel.

## Extras
- **Curtain walls:** in an elevation, click a panel to cycle Glass → Solid → Door → Window. Doors are allowed in the bottom row only; Window is an operable vent panel.
- **Lintels / headers:** placed automatically over doors, windows and wall openings in structural walls (existing `computeLintels`), with a manual override in Properties.

## Engine (`src/engine/openings.ts`, pure)
- **Geometry and fit:** wall frame, opening span/z-range, fit and overlap checks (`checkOpeningFit`, `openingsOverlap`, `openingWarnings`).
- **Snaps and dimensions:** Center/EQ snapping, temporary dimensions plus applying a typed value.
- **Placement:** depth position, re-anchoring after wall edits, drag/re-host, side drag, equal spacing, move/copy with hosting.
- **Plan:** plan cut gaps, finish-layer returns, plan symbols.
- **3D:** wall elevation shape with holes.
- **Types and marks:** type→instance fields, marks.

Tests (`npm test`, 133 total across the project) include:
- Relative position when the wall is moved, rotated or stretched.
- Overlap detection.
- Hole count for N openings.
- Plan cut, snapping, temporary dimensions, drag/re-host, move/copy, depth/flip and layer returns.
