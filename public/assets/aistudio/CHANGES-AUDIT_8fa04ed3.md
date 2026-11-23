# Audit fixes (console, commands, undo/redo)

## Bugs fixed
1. **TRIM (TR) / EXTEND (EX) crashed the app** — `intersections()` in `src/engine/trimExtend.ts` recursed forever when a line, wall, polyline or rectangle was tested against an object with no segments (room, door, text, dimension, block…). "Select all cutting edges" includes those, so TRIM/EXTEND crashed on almost every real drawing. Now returns no intersection for those pairs. Regression test added (`engine.test.ts`).
2. **Clicks swallowed by the Dynamic Input box (F12)** — the length/angle box trails the cursor 18 px down-right; moving toward a point down-right ran into it and the click was lost (ARC never finished; walls, lines, dimensions could miss points). Quick clicks on the box now go to the drawing; resting on it ~0.45 s still edits its fields (`Canvas2D.tsx`).
3. **ROOM (RM) did nothing on click** — the canvas had no click branch for the Room tool; rooms could only be made by typing coordinates. Added the branch. Clicking inside an existing room now selects it and says so instead of stacking a duplicate (`Canvas2D.tsx`, `App.tsx`).
4. **Shift+click multi-select blocked by the Quick Properties popup** — the popup opened over neighbouring objects (and was hard-capped at x ≤ 620 px / y ≤ 420 px, landing on top of the cursor on wide screens). It now measures the drawing area, flips left when there is no room on the right, and lets clicks through while Shift is held. This fixes JOIN (J), JOIN GEOMETRY (JG), UNJOIN (UJ), SWITCH JOIN (SWJ), ATTACH COLUMN TOP (ATB) and any Shift-selection (`OnboardingAndOverlays.tsx`).
5. **STAIR (ST): Enter threw the stair away** — Enter in the command line repeated the ST command and discarded the drafted runs. Enter now finishes the stair (same as Finish Stair), like it finishes walls and polylines (`Canvas2D.tsx`, `App.tsx`).
6. **LEADER (LE): note text was rejected** — after the landing click, typed text gave "Unknown command". The command line now asks for the note text (Enter applies it, Esc keeps "DETAIL NOTE") (`App.tsx`, `Canvas2D.tsx`).

## Clearer messages (no behaviour removed)
- DOOR / WINDOW / OPENING on a curtain wall: explains that curtain walls take doors/windows as panels instead of "hover a wall".
- FOUNDATION SLAB clicked inside an existing slab (or not inside walls): says it started a boundary sketch instead of doing so silently.

## Verified
- TypeScript: 0 errors. Browser console: no app errors across every view, modal, mode and command (only the sandbox's blocked Google Fonts request and headless-GPU warnings).
- All 120 registry commands exercised in a real browser with a scripted harness (see the table in the reply).
- Undo/Redo of the block features (new, edit, place, duplicate, delete with placed copies, import) via Ctrl+Z/Ctrl+Y, U/REDO and the toolbar button: 14/14 exact restores.
- 171 unit tests pass; `npm run build` and `npm run build:html` succeed.

## AI Studio console warnings (follow-up)
- **`THREE.WebGLShadowMap: PCFSoftShadowMap has been removed`** — the 3D view asked for a shadow mode removed in three.js r18x; it now uses `PCFShadowMap`, which three.js was already substituting (same look, no warning) (`Canvas3D.tsx`).
- **`THREE.WebGLProgram: Program Info Log … warning X4122 …`** — Direct3D shader-compiler precision notes from Chrome/Edge on Windows (ANGLE), harmless. A filter (`src/components/threeSetup.ts`) drops a Program Info Log only when every line is such a compiler warning; real shader errors and all other three.js messages still reach the console. Test added (`engine.test.ts`).

## Removed on request (3D block extras)
- Per-shape 3D settings (base height / height / color / 2D-only), the 3D preview in the Block Editor, the Top slab / 4 legs quick parts, and **Download 3D** (DXF / IFC / OBJ / STL export dialog and the library download buttons).
- Custom blocks are back to the original 3D look: rectangles and circles become full-height solids in the block color.
- Kept: shape move / resize, Copy, Mirror, Center, Fit size, New / Duplicate / Delete block, Share / Import, the description field.

## AI Studio zip
- The project zip now matches the layout AI Studio exports: source only, no `docs/` build (a 3.4 MB single-line file), no duplicate embedded zips, no `.github/` folder, and one lockfile (`bun.lock`, regenerated for the current dependencies). The GitHub Pages helpers (`deploy.yml`, `archiforma.html`) are separate downloads.

## New: SmartDraw-style floor-plan features
### 1. Trace a PDF or image plan (`TRACE`, `TRACESCALE`, `TRACEMOVE`)
- **Export & File ▸ Trace a PDF / Image Plan…** or type `TRACE` (also `IMAGEATTACH`, `PDFATTACH`, `IMPORTPLAN`). JPG / PNG / WebP / GIF, or any page of a PDF (pick the page and, if printed on the sheet, the drawing scale: 1/8", 3/16", 1/4", 3/8", 1/2" = 1'-0", 1:50, 1:100, 1:200 — then it lands at true size).
- **Set scale**: click both ends of a dimension you know, type its real length (e.g. `12'6"`, `3600mm`). The image scales about the first point. **Move**: base point → target point (the target snaps to drawn corners).
- Panel per image: show / hide, lock, fade slider, type an exact width, zoom to, delete. Images sit under the drawing (clicks go through to the walls you draw), are per level, saved with the project, never printed or exported, and Zoom Extents includes them. Everything is undoable.
- Files: `src/engine/traceImage.ts` (+ tests), `src/components/traceLoader.ts` (pdf.js loaded only when a PDF is opened; runs without a worker file so the single-file `archiforma.html` works too), `src/components/TraceImagePanel.tsx`, `Canvas2D.tsx`, `App.tsx`. New dependency: `pdfjs-dist`.
- Autosave: when a project with big scans no longer fits browser storage, you now get one warning toast (Save / Ctrl+S say so too) instead of silently losing autosave.

### 2. Template gallery (`TEMPLATE`)
- **Export & File ▸ New from Template…** or type `TEMPLATE`. Six starting points with previews and sizes: the two-room sample house, Small House (2 bed / 1 bath), Studio Apartment, Restaurant — Kitchen & Dining (range line, prep island, 3-compartment sink, reach-in, walk-in, dry storage, 2 restrooms, 50 seats), Small Office (20 desks, conference room for 10, 2 private offices, reception, break room, restroom, storage), and Blank.
- Each is real geometry built by the same engine as the AI sketch importer (walls, doors, windows, rooms, overall dimensions, furniture blocks); ten commercial / office blocks were added to the library with them. Ctrl+Z returns to the previous project.
- Unit tests check every template: all doors / windows / rooms land, and every furniture piece is inside a room, clear of walls, other furniture and doorways. Files: `src/engine/templates.ts` (+ tests), `src/components/TemplateGallery.tsx`.

### 3. Room-by-room builder (`RMB`, Room Builder button in the Build toolbar)
- Describe a room as a run of sides: each side has a length and Windows / Doors / Openings / Gaps (width + position, blank = centred) and turns right / left (90° or 45°) or goes straight. Quick start from a rectangle or L-shape; the panel previews the shape, shows whether it closes, and **Close room** fixes the last side.
- **Place on plan**, then click: a corner (orange dot — click another dot or press A to change it) snaps to wall ends and room corners; R rotates 90°. Any other command ends placing.
- Rooms snapped together **share walls**: sides that run along existing walls add only the missing stretch; doors / windows on a shared side are cut into the existing wall; a gap on a shared side opens the existing wall full-height. It never cuts through an existing door or window and refuses to stack a room on top of another (it says why).
- Files: `src/engine/roomBuilder.ts` (+ tests), `src/components/RoomBuilderPanel.tsx`, `Canvas2D.tsx` (live preview), `App.tsx`, `LeftToolbar.tsx`.

### Verified
- TypeScript 0 errors; 182 unit tests pass; browser runs of all three features (import image + PDF, calibrate, move, lock, delete, undo / redo, reload; every template in 2D and 3D, undo back; three rooms built and snapped together, gap cut, duplicate refused, undo / redo) with no console errors.

## New: AutoCAD-style ribbon, line types and plot styles
### Ribbon (default workspace)
- Tabs **Home · Build · Structure · Insert · Annotate · View · Manage · Output**, with panels laid out like AutoCAD: large buttons plus small buttons stacked three high, and a panel title bar. Home has Draw, Modify, Annotation, a **Layers** panel (current-layer list, Off / Isolate / All) and a **Properties** panel (Color / Linetype / Lineweight lists, plus Match).
- Every button runs the registry command (so it is undoable and logged like typing); view, library, import and save buttons call the same handlers as the menus. Double-click a tab or press ^ to minimize; clicking a tab then opens it temporarily.
- **Classic toolbar** switches back to the left toolbar (the choice is remembered); the **Ribbon** button in the top bar returns. In ribbon mode the left panel appears only for the Library / Insert.
- Verified: all 159 ribbon buttons produce a visible change (command, tool, dialog or view) with no console errors.
- Files: `src/components/Ribbon.tsx`, `App.tsx`, `TopBar.tsx`.

### Line types, lineweights and object colors
- Built-in acad.lin set (25 simple linetypes). Linetypes from `.lin` files can be loaded; complex ones with text or shapes are reported and skipped. Global `LTSCALE` (default 12) and per-object linetype scale.
- Layers gain **Linetype**, **Lineweight** and **Plot**. Lines, polylines, rectangles, circles and arcs gain ByLayer-or-own **color, linetype, linetype scale and lineweight**, plus current values (CECOLOR / CELTYPE / CELWEIGHT / CELTSCALE) for new drawing.
- Shown on screen (dashes at true scale; drawn solid when too dense), with **LWT** for on-screen lineweights. Printed in sheets / PDF (dash in paper mm, true lineweights).
- DXF export writes LTYPE records (inch or mm patterns), layer linetype / lineweight / plot flag, entity 6 / 62 / 420 / 370 / 48, and `$LTSCALE`. DXF import reads them back (the layer table is read directly, because the parser skips those codes). Checked with ezdxf: 0 audit errors.
- New commands: `LT`, `LTS` (LTSCALE), `LW`, `LWT`, `LP` (Layer Properties Manager).
- Files: `src/engine/lineStyles.ts` (+ tests), `src/components/LineStyleControls.tsx`, `src/components/DraftingModals.tsx`, `Canvas2D.tsx`, `planPrimitives.ts`, `dxfExport.ts`, `dxfImport.ts`, `RightPanel.tsx`, `CommandLine.tsx`.

### Plot style tables (.ctb)
- Built in: acad, monochrome, grayscale, ARCHIFORMA Pens (lineweight by color), Screening 25 / 50 / 75 %. "None" keeps ARCHIFORMA's own look, as before.
- Applied to every sheet viewport and the PDF. Lines and text take the pen's color, screening and lineweight. Area fills keep their shade, shown in gray when the pen has a fixed color, so monochrome never turns floors or wall poché solid black.
- Editor: copy a table, then edit pens by color (only the colors this drawing uses, or all 255). **Import / Export .ctb** uses the real AutoCAD binary format; files were cross-checked with ezdxf in both directions. Named (.stb) tables are refused with a message.
- `PLOTSTYLE` command, Manage / Output ribbon buttons, and a Plot style menu next to Export PDF in Sheets.
- Files: `src/engine/plotStyles.ts` (+ tests), `documentation.ts`, `SheetsView.tsx`.

### Verified (this round)
- TypeScript 0 errors; 190 unit tests pass (new: line styles, DXF round trip, plot styles, .ctb round trip).
- Browser checks covered:
  - Linetypes: the layer manager, linetype manager (.lin load, LTSCALE), LTS prompt and LWT.
  - Plot styles: choosing, copying and editing a table, then exporting and re-importing it as .ctb; a monochrome sheet PDF.
  - Ribbon: properties applied both to the current settings and to a selection, with Undo; tab collapse and peek; the library; the classic and ribbon toggle (which persists); dark mode.

## New: automatic tracing and AI renders

- **One AI layer for every feature** (`src/engine/aiEngine.ts`): Claude through the claude.ai artifact runtime (viewer's own account, image input, no key) or Gemini with the user's / AI Studio's key; *AI engine* setting in the AI bar. Sketch → plan now runs on either.
- **Automatic tracing** (`src/engine/autoTrace.ts`, `TRACEAUTO`, Trace panel button, ribbon Insert ▸ Reference): AI returns walls / openings / rooms / one readable dimension in image coordinates; walls are axis-snapped and moved onto the dark pixel band with thickness measured from the image; the image scale is set from the dimension when it was not calibrated; the result is placed exactly over the image through the AI-plan builder (one undo step). Cancel with Stop. Tests: `autoTrace.test.ts`.
- **AI renders** (`src/engine/renderLook.ts`, `src/components/RenderPanel.tsx`, `RENDER`, ribbon View ▸ Render): live look = equirectangular sky, haze, exposure, compass sun with shadows, ambient, ground and per-category materials (material swap only, coexists with X-ray); 7 presets + saved looks; AI restyle from a brief + screenshot; stills up to 4K (4096 shadow map during the shot, grid / grade helpers hidden; saved cameras keep their two-point projection); Gemini photoreal pass. Tests: `renderLook.test.ts`.
- **Downloads inside claude.ai** (`src/engine/artifactBridge.ts`): every `<a download>` of a blob / data URL goes through the artifact `downloads` capability (viewer confirms); formats outside its allowlist (DXF, CTB, …) are wrapped in a one-file .zip. Outside claude.ai nothing is patched.

## New: AF menu and saved projects
- The AF logo opens an application menu (`src/components/AppMenu.tsx`; `OPEN`, `SAVEAS`): file commands plus **Your projects**, a library of saved projects in IndexedDB (`src/engine/projectLibrary.ts`) with plan thumbnails, open / rename / duplicate / download / delete. Save and Ctrl+S now save into it as well as the quick autosave.
- The library id is stored in the model, so undo never points Save at the wrong project; opened files and downloads carry no id (Save adds them as new projects instead of overwriting).
- Loading a project (startup, open file, saved project) goes through one `normalizeModel`, so older files pick up newer catalogs the same way.
- Ribbon | Classic switch always in the top bar (`WORKSPACE`, `RIBBON`, `RIBBONCLOSE`); the top bar wraps on narrow screens instead of cutting off buttons. Properties panel docked left (dock icon swaps sides).
