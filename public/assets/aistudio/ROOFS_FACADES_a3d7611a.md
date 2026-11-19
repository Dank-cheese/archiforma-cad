# Roofs & Facades

The basic roof from earlier phases was **upgraded in place**, not duplicated. Old roofs still load. Selecting one and editing it in Properties converts it to the new roof (`roofVersion: 2`).

## UI at a glance
- **Build → Roof (RF)** is the single roof tool. A floating options bar shows Pick walls / Sketch, a type picker with icons (Flat, Shed, Gable, Hip, Mansard) and slope. Fascia, gutter and mansard settings sit under **More…**.
- **Facade** toolbar group shows **Paint (PT)** and **Curtain Wall (CW)**. **More… (7)** reveals Split Face, Sweep, Reveal, Balcony, Railing, Skylight and Dormer.
- **Elevations ▾** sits next to 2D Plan / 3D / Split. It opens N/S/E/W elevations and the Roof Plan. Clicking an elevation marker in plan also opens its elevation.

## Commands (all undoable, all in Help → "Roofs & Facades")
| Command | Alias | What it does |
|---|---|---|
| Roof by Footprint | RF | Pick walls (Tab = connected chain) or sketch. Per-edge "Defines slope" setting. |
| Skylight | SKY | Hosted on a roof face; cuts the roof in 3D. |
| Dormer | DMR | Gable dormer with a window. |
| Attach / Detach | AT / DTR | Walls grow up to the roof underside; they follow slope changes. |
| Curtain Wall | CW | Glass grid. Click cells in elevation to cycle Glass → Solid → Door. |
| Paint | PT | Applies an exterior finish in elevation, 3D or plan. |
| Split Face | SF | Divides a facade horizontally into bands. |
| Sweep / Reveal | SWP / RVL | Band, Cornice or Base trim, or a recessed groove. |
| Balcony / Railing | BAL / RAIL | Slab with railing; railing along a picked path (balusters or glass). |
| Elevations / Roof Plan | EL / RP | Live views. |

## Engine (pure, tested)
- `src/engine/roof.ts`: straight skeleton (edge, split and spike events), roof faces and lines (ridge, hip, valley, eave, rake, break), gable ends, mansard split, slope parsing (`4:12` ⇄ degrees), wall attach profile, skylight and dormer geometry.
- `src/engine/facade.ts`: finishes, bands, paint and split, curtain grid, and elevation drawing (painter's algorithm with hit regions, hatches, shading, shadows, level lines, slope labels, dimensions, tags).
- `src/components/facade3d.ts`: three.js builders.
  - Roof: thickness, fascia, boxed soffit, gutter, material texture, skylight cut-outs.
  - Walls: roof-attached tops, per-band finish textures, styled windows and doors (frame, muntins, trim, shutters).
  - Also curtain walls, sweeps, balconies, railings and dormers.
- Tests: `npm test` runs 81 tests, including rectangle, L, T and U footprints, 24 irregular footprints, and DXF hidden-line removal.

## Export
- **Sheets**: elevations (any direction) and the Roof Plan can be dragged onto sheets at exact scale. The starter project now includes sheet **A201 — Exterior Elevations & Roof Plan**.
- **PDF**: uses the same vectors as the screen.
- **PNG**: export from the elevation view toolbar.
- **DXF**: Export & File → "Export CAD (.dxf) — plan + elevations" writes four elevations as hidden-line 2D linework below the plan. Layers are `A-ELEV`, `A-ELEV-HATC` and `A-ELEV-ANNO`. The file was validated with ezdxf.

## Sample project
- Hip roof, 5:12, 1'-6" overhang over the 2-room house.
- Stone base to 3'-0" with lap siding above.
- North-east wall is a curtain wall with one door cell.
