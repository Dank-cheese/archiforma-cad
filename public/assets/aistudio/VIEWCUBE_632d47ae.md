# ViewCube (`NAVVCUBE` / `CUBE`)

The ViewCube is an AutoCAD-style navigation widget. It sits in the top-right corner of the 3D view. In the plan it appears as a static TOP cube.

| File | Contents |
|---|---|
| `src/engine/viewCube.ts` | Orientation math: hotspots → camera angles, face frames and CSS matrices, aligned face, adjacent faces, roll, compass, projection, settings. Pure functions. |
| `src/engine/viewCube.test.ts` | Tests for face vectors, the 8 isometric corners, the 12 edges, the compass azimuth, front offset, arrows and roll, and NAVVCUBE answers. |
| `src/components/ViewCube.tsx` | The widget: CSS 3D cube, compass ring, Home, menu and arrows. |
| `src/components/Canvas3D.tsx` | Smooth pose animation, roll, orthographic camera, Home and Front. |

## Look and behaviour

- **Opacity:** 50% when idle, 100% on hover or while dragging, so it never hides the drawing.
- **Rotation:** the cube turns with the camera on every rendered frame. It is updated from the render loop with no React re-render.
- **Shape:** a CSS 3D cube with six faces. Each face is a 3 × 3 grid of hotspots:
  - the centre cell is the face itself;
  - the side cells are edges;
  - the corner cells are corners.
- **Hover:** a hotspot that appears on several faces lights up on all of them, and its name shows under the cube (e.g. `SE Iso`, `TOP · FRONT`).

## Hotspots

| Hotspot | Count | View |
|---|---|---|
| Face | 6 | Straight at TOP, BOTTOM, FRONT (south), BACK, LEFT or RIGHT. TOP and BOTTOM keep the current heading, snapped to a quarter turn. |
| Edge | 12 | The 45° view between the two faces. |
| Corner | 8 | Isometric views at 35.26° elevation: SE / SW / NE / NW Iso from above, and the same four from below. |

- **Transitions:** every view change glides: eased over 450 ms along the shortest arc, keeping the orbit centre and distance. The 3D view bar presets (Top, Bottom, Front, Iso, Fit) glide too.
- **Face-on views:** when you're looking straight at a face (within 0.6°), arrows appear around the cube:
  - **▲ ▼ ◀ ▶** turn to the adjacent face in that screen direction (`adjacentFace`).
  - The **curved arrows** roll the view 90°. On TOP and BOTTOM this is a turn about the vertical. On side faces it's a screen roll (`rollStep`). A left-drag orbit in the viewport cancels the roll.
- **Dragging the cube** orbits the model (θ −= dx·0.012, φ −= dy·0.012).

## Compass

The compass ring lies in the horizontal plane under the cube. It has ticks every 15° and red **N**.

- The N / E / S / W letters are screen-facing buttons placed on the ring every frame, so they can always be clicked. They're slightly faded when on the far side.
- **Clicking a letter** views the model from that side (`CARDINAL_THETA`: S = 0, E = 90°, N = 180°, W = −90°).
- **Dragging the ring** turns the view about the vertical (`rotateAzimuth`). The direction is mirrored when the camera is below grade.

## Home and menu

- **Home (house, top-left):** glides to the Home view, which defaults to the standard iso.
- **Menu:** right-click Home, or click **▾**, for:
  - Go Home;
  - **Orthographic**, **Perspective**, or **Perspective with Ortho Faces**, which draws orthographic only while looking straight at a face;
  - **Set Current View as Home**;
  - **Set Current View as Front:** the cube turns so FRONT looks from the current direction. The compass keeps true north;
  - **Reset Front**.
- **Orthographic projection** uses an `OrthographicCamera` that copies the perspective camera's pose. Its frustum is matched at the orbit target, so the mouse wheel still zooms. Picking, hover, issue markers and section-box handles all use the camera that is drawing. Camera views, PNG exports and walkthroughs stay in perspective.

## On / off

- **Toolbar:** the left toolbar has **View / Navigation → ViewCube**, which shows ON or OFF.
- **Command:** `NAVVCUBE` (aliases `CUBE`, `VIEWCUBE`) prompts `Enter an option [ON/OFF] <ON>:` on the command line.
  - Type ON or OFF, or click a chip in the prompt.
  - Enter alone keeps the current setting; Esc cancels.
  - The prompt mechanism is generic (`cmdPrompt` in `App.tsx`) and can be reused by other option prompts.
- **Saved settings:** on / off, projection, Home and Front are stored in `localStorage` (`archiforma_viewcube_v1`).

## Plan

In 2D plans the cube is drawn from the TOP, with the compass. Clicking a face, edge, corner, compass letter or Home opens the 3D view at that orientation.
