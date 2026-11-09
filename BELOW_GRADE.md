# Checking Below Grade

These tools let you look at, cut into and check what's under the building: foundations, footings, slab undersides, piles, rebar and beams under floors. They work in 3D and in the plan underlay.

Grade (finished ground) is the project datum, at elevation 0. The navigation, clipping and check math is in `src/engine/view.ts` (pure functions, tested in `view.test.ts`).

## 3D: going below the ground

### Orbit and pan

- **Orbit:** there is no ground stop. The polar angle runs from 0.001 to π − 0.001, so you can orbit under the grid and look up.
- **Pan:** pans move in screen space, including straight down through the ground. The orbit target can go below elevation 0.

| Action | Result |
|---|---|
| Middle-drag, or Space + drag | Screen-space pan |
| Right-drag | Pan |
| Shift + middle-drag | Move the view straight up or down (`verticalPan`) |
| PgUp / PgDn | Move one 3D grid step (2'-0") up or down (`stepVertical`) |

### What changes below grade

`groundAppearance` handles this. Nothing is rebuilt; only material properties change:

- The ground fades to **15%** (or less, if you chose less) and becomes visible from both sides.
- The grid becomes thin, faded lines. The grid never writes depth and is drawn after the ground with a polygon offset, so it doesn't flicker.
- A dashed **GRADE** outline with a `GRADE ±0'-0"` label appears.
- A badge shows the eye height, for example **Below grade -4'-6"**.

Everything returns to normal when the camera goes back above grade.

### Ground control

Open **Ground ▾** in the 3D view bar for:

- **Ground opacity:** 0–100%. **Auto** is 35% when foundations are modelled, otherwise opaque.
- **Hide ground.**
- **X-ray** (also `XR`): everything above grade is drawn at 25% opacity, so foundations and structure stand out. It swaps materials only.

### Bottom view

The **Bottom** button, or the amber BOTTOM face of the new view cube, looks straight up at the underside. The cube's other faces are Top, Front, Back, Left and Right.

### Section box (`BX`)

The alias is BX, not SB, because SB is the structural floor.

- **Clipping:** the box uses six `THREE.Plane`s on `renderer.clippingPlanes`; `renderer.localClippingEnabled` is on.
- **Handles:** six blue handles move each face along its axis (`dragSectionBoxFace`, `axisValueFromRay`). They draw in an overlay scene that is never clipped, and keep a constant on-screen size.
- **Slicing:** drag the top handle down to slice the building and look into the foundations from above. Drag the bottom handle up to cut them off.
- **Cut surfaces:** they show a hatched solid colour. After the normal pass, the back faces of the meshes the box actually cuts are drawn with a screen-space hatch material. World bounds are cached per mesh, so dragging doesn't recompute any geometry.

Camera views, PNG exports and walkthroughs are never clipped.

### Hover readout

Hover over any surface to see what it is and its elevation:

- `Top of footing  -0'-6"`
- `Bottom of slab on grade  -0'-5"`
- `Column face  2'-6"`

The readout is limited to the section box. In X-ray it reads through the see-through parts.

### Issues (`belowGradeChecks`)

| Check | When |
|---|---|
| Column without footing | column base at the bottom of the building, no footing under it |
| Gap at column base / base overlaps footing | column base more than 3/4" above or below the footing top |
| Bearing wall without footing | **Structural** wall at the bottom of the building with no wall footing |
| Slab not supported | non-foundation slab whose bottom doesn't sit on beams, walls or columns; a slab on grade more than 1'-0" above grade |
| Floating element | upper-level column or wall with nothing under it |

- **Issues popover:** the Issues button shows the count; its popover lists the counts by kind and every issue.
- **Markers:** orange markers show while you're below grade, in X-ray, with the section box on, or with the Issues list open. Clicking a marker or a list line zooms there and selects the element.

> The sample project's steel and concrete columns now bear on their footing tops (base offset −6"), so the sample checks out clean.

## 2D: underlay

**Underlay** (top-left of every plan) can be **None**, **Level below** (the default), **Foundation**, or any other level.

- **Drawing:** the chosen level draws in halftone gray *beneath* the current plan, and pans and zooms with it.
  - For a level, this is the plan primitives of its walls, doors, windows, columns, floors, stairs and beams.
  - For Foundation, this is the foundation plan of the lowest level.
- **Check supports:** outlines in orange the **Structural** walls and the columns that have nothing under them in the underlay (`supportMismatches`). The unsupported runs are drawn thick, and a badge counts them.
- **Hold U:** with the underlay off, holding U shows the level below (or the foundation) temporarily. A quick tap of U still goes to the command line.
- **Grid:** the background grid always draws behind lines and fills. Its opacity is **Plan grid opacity** in **VV**.

## Commands

| Alias | Command |
|---|---|
| `BX` / `SECTIONBOX` | Section box on / off (switches to 3D) |
| `XR` / `XRAY` | X-ray on / off (switches to 3D) |

Help → **Checking below grade** has step-by-step instructions.
