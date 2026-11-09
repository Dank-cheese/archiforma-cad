# Wall Joins, Timber Framing, Doors & Component Library

This file covers wall joins, timber framing, the door catalog and the component library.

## A — Seamless wall joins (`src/engine/wallJoins.ts`)

All of the join logic is pure functions. Plan, sheets, PDF, DXF and 3D all use the same functions.

### Join types

| Situation | Result |
|---|---|
| **L** (2 walls meet at their ends) | **Miter** by default: the two faces are cut at their intersection. Other styles: **Butt** (the primary wall runs through to the other wall's far face), **Square-off**, or **Disallow**. |
| **T** (an end lands on another wall) | The stem is trimmed at the main wall's **near face**. For multi-layer walls, the core runs to the main wall's core and the finishes stop at the main wall's finish. |
| **X** (two walls cross) | The thinner wall is split around the thicker one. On a tie, the later wall is split. There is no overlap. |
| **3+ arms** | If two of the arms are opposite each other, they run through and the rest T-trim. Otherwise the arms meet at a star **hub** polygon. |
| **Collinear, same type** | The walls **heal** into one wall when the model is committed. Hosted doors and windows keep their world positions and their tags are retargeted. Healing is skipped at a T, between different types, or when the joint is set to Disallow. |

### Plan output

- `wallPlanPieces` produces the pieces with fill only.
- `mergeOutlines` cancels the shared edges, so each joined group gets one contour with uninterrupted fill. Groups are keyed by level and wall type; curtain walls are kept separate.

### Wall Join tool (`WJ`)

- Click near a corner to cycle the join style: Miter → Butt → Square-off → Disallow.
- Click a free end to toggle Allow / Disallow.
- Shift+click swaps which wall is primary for Butt and Square-off.
- Every change is undoable.

### 3D

The same end cuts are applied to the core, the skins and the band joints. The result:

- Seam edges are dropped.
- Hubs are extruded.
- No end caps overlap, and walls do not z-fight.
- Wall tops are still sliced by the roof.

### Tests

`wallJoins.test.ts` checks that:

- An L gives a single closed 6-vertex polygon whose area equals the sum of its pieces.
- A T trims the stem at the near face.
- Two collinear walls heal and keep the door at x = 180.

It also covers X crossings, hubs and Disallow.

## B — Cabin & timber (`src/engine/timber.ts`, `structure.ts`)

### Profiles

| Group | Sizes |
|---|---|
| Hand-hewn heavy timber | HT 6x8, 8x8, 8x10, 8x12, 10x12, 12x12 (chamfered) |
| Round logs | LOG 8, 10, 12, 14″ |
| Glulam | 3-1/8x12, 5-1/8x15, 6-3/4x18, with optional camber |

### Species

- Douglas Fir
- Western Red Cedar
- White Pine
- Reclaimed Barn Oak
- Pine log and cedar log

### Roof Framing (`TRF`)

Click inside a roof. The tool places:

- Exposed ridge beams
- Purlins, sloped to the roof pitch
- Rafters with a tail cut: Square, Plumb, Bevel or Curved (scroll)

### Truss (`TRS`)

- Styles: King Post, Queen Post, Hammerbeam and Scissor.
- **Placement:** one click places the truss.
  - Under a roof, the truss spans square to the ridge and takes the roof's pitch.
  - Otherwise it spans the room's short side.
- **Rows:** set Count and Spacing to place a row of trusses.

### Knee Brace (`KB`)

- Click a column. A 45° brace is added on each side where a beam continues.
- Braces can be straight or curved, and are drawn with mortise-and-tenon pegs.

### Cabin wall types

| Wall type | Construction |
|---|---|
| Full-Scribe Round Log 10″ | Stacked logs; corners cross with a saddle-notch overhang |
| D-Log 8″ | Logs rounded outside, flat inside |
| Square-Chinked Appalachian | Hewn squares with white chinking bands |
| Cedar Board-and-Batten | Board-and-batten cedar cladding |
| Knotty Pine T&G lining | Interior lining |

## C — Doors & component library

### Door catalog (`src/engine/doorStyles.ts`)

The catalog is grouped as **Hinged**, **Sliding/Folding** and **Specialty**:

| Group | Doors |
|---|---|
| Hinged | Flush; 6-Panel Colonial; Craftsman 3-Lite; French (single and double); Rustic Plank with strap hinges; Dutch; Arched-Top Timber; Entry with Sidelights and Transom |
| Sliding/Folding | Pocket; Barn (single, and bypass on track); Patio (2/3/4-panel); Multi-slide; Bi-fold (3–6 leaf) |
| Specialty | Louvered closet bi-fold; Pivot; Roll-up garage; Carriage garage; Screen/Storm |

- **One layout for every view.** A single `doorLayout()` drives the 2D symbol, the elevation and the 3D model, so all three always agree.
- **Editable parameters:** size, frame, glazing, panel design, number of panels, sidelights, transom and screen door. These are in the door type editor, under **More…**.

### Component library (`CM` / Library tab)

The Library tab has search and category chips. Each component has a 2D symbol and a parametric 3D model.

- **Cabin & Living:**
  - Fireplace with a stone chimney that runs through the roof
  - Wood stove with flue
  - Antler and iron chandeliers
  - Live-edge table
  - Leather and log seating
  - Bunk beds, window seat and bookcase
- **Kitchen & Bath:**
  - Farmhouse sink and butcher-block island
  - Range hoods (copper, timber, stainless)
  - Clawfoot and soaking tubs
  - Glass shower and double vanity
  - Sauna
- **Stairs, Porches & Site:**
  - Stairs: straight, L, U, spiral and split-log
  - Porch posts
  - Railings: branch, cable and picket
  - Pergola and pavilion
  - Adirondack chair
  - Fire pit with stone seating
  - Firewood rack
  - Trees: pine, birch and cedar
  - Boulders

> Structural members are for design visualization and coordination only. They are not a substitute for engineering by a licensed structural engineer.
