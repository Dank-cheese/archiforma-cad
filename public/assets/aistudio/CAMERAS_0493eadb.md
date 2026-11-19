# Camera Views (`CAM`)

The Camera tool saves 3D perspective views from points on the site, like the Camera tool in AutoCAD or Revit.

## Placing a camera

Placement happens in the 2D plan or split view. If you run `CAM` from 3D, the app switches to the plan.

| Step | Action | Result |
|---|---|---|
| 1 | Click the position | A camera icon appears. The eye is **5'-6" (1.7 m)** above the ground under it. The model has no site terrain yet, so the ground is the active level's elevation. `groundElevationAt()` takes a terrain sampler for when terrain is added. |
| 2 | Move to aim, then click | A see-through blue wedge points from the camera to the cursor. The cursor's distance sets the target/far distance. Clicking locks the direction. |
| 3 | Move sideways, then click | The two wedge edges pass through the cursor. Further from the centre line gives a wider view, from 20° to 100°. The view is shown live (e.g. `FOV 62° · ≈ 30 mm`). Clicking creates **Camera 1** (then 2, 3, …) and opens its view. |

### Other ways to set values

- **Mouse wheel:** changes the FOV at any step, 2° per notch. Ctrl/⌘ + wheel still zooms the plan.
- **Typed values:**
  - In step 2, a length such as `30'` sets the target distance along the current aim and locks the direction.
  - In step 3, a number (`62`) sets the angle; a lens (`35mm`) sets the equivalent angle.
  - Before step 3, a number or lens sets the starting FOV.
- **Live preview:** a window in the bottom-right corner of the plan shows the real 3D perspective and updates as you move the mouse. It stays up while a single camera is selected, so grip drags and property changes show live too.

## Editing a camera

### In plan

Select a camera to see four grips:

- Position
- Target
- The two wedge edges (drag to change the FOV)

Move, rotate and copy work as they do for other elements.

### Properties

- **Eye height** and **target height**.
- **FOV** slider, or a **lens** preset (18 mm ultra-wide, 24, 35, 50, 85 mm).
- **Crop:** 16:9, 4:3, 1:1 or A3 landscape.
- **Two-point perspective:** keeps verticals vertical. The camera stays level and the image is shifted like a shift lens.
- **Near / far clip** and **sun**, under **More…**.

Every change updates the view live. Each slider drag is a single undo step: consecutive edits with the same `…` label coalesce within 2 seconds.

### Inside a camera view

The view is letterboxed to the crop.

- **Looking and moving:**
  - Drag to look around.
  - ↑ / ↓ walk, ← / → turn.
  - Shift + ← / → sidesteps; Shift + ↑ / ↓ takes bigger steps.
  - PgUp / PgDn raise or lower the eye.
- **Save view** writes the new pose back into the camera. **Reset** returns to the saved pose.
- A "moved — not saved" chip shows while the view differs from the saved camera.

## Views, sun and export

### Views list

The Views list sits in the right panel, above Layers. It shows every camera with a thumbnail.

- Click a camera to open it.
- Double-click to rename it.
- Use the trash icon to delete it (undoable).

Cameras show only in plan. They are hidden in 3D, elevations, sections, DXF, IFC and schedules.

### Sun

Click **Sun** in a camera view to set:

- On / off
- Date
- Time of day (slider)
- Latitude, under More…

Shadows update live. Plan north is up, and the time is local solar time.

### PNG export

Use **PNG ▾** in a camera view. The long side of the image is:

| Scale | Long side |
|---|---|
| 1× | 1600 px |
| 2× | 3200 px |
| 4× | 6400 px |

Images are clamped to the graphics card's maximum size.

### Sheets

Each camera is listed with **+ Place** (or drag it onto the sheet). The placed viewport is sized to the camera's crop and prints in the sheet PDF.

Images are re-rendered when a camera changes. They are also re-rendered when you open the Sheets view after the model has changed.

### Walkthrough

You need two or more cameras. In the Views list:

- **Walkthrough** flies through the cameras in list order. It uses a Catmull-Rom path through every eye and target, with even speed and a gentle ease at each camera.
- **WebM** records the same fly-through. It uses `MediaRecorder` on the canvas stream and downloads the video.

## Implementation

- **`src/engine/camera.ts`** holds the camera math as pure functions:
  - `fovFromCursor`, `wedgePoints`
  - `focalToFov` / `fovToFocal` (full-frame 36 mm sensor, so 35 mm ≈ 54.4°)
  - `horizontalToVerticalFov`: `THREE.PerspectiveCamera.fov` is vertical, so `vfov = 2·atan(tan(hfov/2)/aspect)`
  - `cameraEye3D` / `cameraFromEye3D`, `twoPointShift`
  - `sunPosition`, `walkthroughPose`
  - Grips
- **`src/engine/camera.test.ts`** covers:
  - FOV from the cursor offset
  - 35 mm ≈ 54° on full frame
  - Wedge points
  - Grips, the 3D eye and the save round trip
  - Sun direction
  - Walkthrough interpolation
- **`CameraEntity`** (type `camera`, layer `A-CAMR`) stores the FOV **horizontally**.
- **`Canvas3D`** has the camera view:
  - Crop and letterbox, two-point projection, and walk keys
  - Sun lighting with shadows
  - `renderCameraImage()`, used for thumbnails, sheet images and PNG export
  - `playWalkthrough()`
