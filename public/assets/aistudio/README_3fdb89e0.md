# ARCHIFORMA

A simple, friendly 2D/3D architectural CAD and light BIM tool using AutoCAD and Revit commands and shortcuts.

View in AI Studio: https://ai.studio/apps/1773a4c3-f439-4b0f-b46c-54bc18f6da2c

## Your projects (AF menu)

Click the orange **AF** logo (or type `OPEN`) for the app menu: **New**, **New from template**, **Open file…**, **Save** (Ctrl+S), **Save as…** and **Download (.json)** on the left, and **Your projects** on the right — every project you have saved, with a plan thumbnail, when it was saved and its size.

- Click a project to open it. The drawing you have open is saved first (or you choose to open without saving); Ctrl+Z goes back.
- Rename, duplicate, download or delete a project with the icons on its row. The open project is marked **OPEN** and can't be deleted.
- Projects are kept in this browser (they survive reloads, and large projects with trace images fit). They don't sync between browsers or computers: use **Download (.json)** for a backup or to move a project.

## Design with AI (sketch → plan)

At the bottom of the 2D plan there is a **Design with AI** bar (or type `AI` in the command line).

1. Click **+** to attach a photo or scan of a hand sketch (JPG, PNG, WebP or PDF). You can also drag an image onto the bar or paste one.
2. Optionally type notes ("overall 40 ft wide", "make room 3 an office"), or skip the sketch and just describe the plan you want.
3. Press **Enter**. Gemini reads the sketch and ARCHIFORMA draws real walls, doors, windows, rooms and overall dimensions, which you can edit, view in 3D and export like anything else.
4. **Ctrl+Z** (or the Undo button on the result card) takes it back.

The menu under the bar chooses where the plan goes: a new project, replace everything on the current level, or add beside the current plan.

**Which AI:** opened as an artifact in claude.ai, ARCHIFORMA uses **Claude** through your own claude.ai account — no key needed. Anywhere else (GitHub Pages, AI Studio, locally) it uses **Gemini**. The settings icon on the bar has an *AI engine* choice (Auto / Claude / Gemini).

**API key (Gemini):** the first time, click the settings icon and paste a free Gemini API key from https://aistudio.google.com/apikey. It is saved only in that browser. Inside Google AI Studio the app uses AI Studio's own key automatically.
Never put your key in a `.env` file for a build you publish: `npm run build:html` always strips it, but `npm run build` does not.

## Ribbon, line types and plot styles

The ribbon is on by default. The **Ribbon | Classic** switch in the top bar changes between the ribbon and the classic left toolbar; you can also type `WORKSPACE` to swap, `RIBBON` or `RIBBONCLOSE`. The choice is remembered per browser. On narrower screens the top bar wraps onto a second row instead of cutting off buttons.

The **Properties** panel (with Views and Layers) sits on the left of the drawing; the small dock icon next to its title moves it to the right and back.

**Ribbon.** Commands are grouped on an AutoCAD-style ribbon: Home (Draw, Modify, Annotation, Layers, Block, Properties), Build, Structure, Insert, Annotate, View, Manage and Output. Every button runs the same command you could type, so the command line, step hints and Ctrl+Z work the same way. Double-click a tab (or the ^ button) to shrink the ribbon to its tabs. **Classic toolbar** (right end of the tab row) brings back the left toolbar; the **Ribbon** button in the top bar switches back.

**Line types and lineweights.** The standard acad.lin set is built in: Continuous, DASHED, HIDDEN, CENTER, PHANTOM, DOT, DASHDOT, BORDER and DIVIDE, each also at half size (…2) and double size (…X2).
- Give a layer a linetype and a lineweight in **Layer Properties** (`LP`). Give one line, polyline, rectangle, circle or arc its own color, linetype, linetype scale or lineweight in its Properties. Or set them on the ribbon's Properties panel: with objects selected it changes them, and with nothing selected it sets what new drawing gets.
- **Linetype Manager** (`LT`): set the current linetype, the global scale (`LTSCALE`, default 12) and load more linetypes from a `.lin` file. **Lineweights** (`LW`): set the current lineweight. **LWT** in the status bar shows lineweights on screen.
- Linetypes, lineweights and colors print in sheets and PDFs, and travel through DXF export and import.

**Plot styles.** `PLOTSTYLE` (or the Plot style menu in Sheets) chooses what each color prints as:
- **monochrome.ctb** prints everything black.
- **grayscale.ctb** prints in grays.
- **acad.ctb** prints in object colors.
- **Screening 25/50/75%** prints in lighter ink.
- **ARCHIFORMA Pens.ctb** prints black, with the lineweight set by color.

Use **Copy to edit** to change a table pen by pen (plot color, screening, gray, lineweight). **Import / Export .ctb** exchanges tables with AutoCAD. The layer **Plot** switch leaves a layer out of prints.

## AI renders

Type `RENDER` (View ▸ Render ▸ AI Render). The 3D view opens with the **AI Render** panel:

1. **Looks** — Daylight, Golden hour, Overcast, Dusk, Clay model, Modern concrete, Night. They change sky, sun, haze and materials live on the model; nothing in the drawing changes. **Save look** keeps your own.
2. **Restyle with AI** — describe the look ("Mediterranean villa at sunset, white lime render, terracotta roof"). The AI sees the current 3D view and sets sky, sun direction and height, exposure and a material per element (walls, roof, floors, doors, window frames, stairs, structure, furniture, railings). Fine-tune with the sliders and colour pickers; × on a material keeps the element's own finish.
3. **Render still** — orbit to the view (or open a saved camera), choose a size from HD to 4K / A3, and download the PNG.
4. **Photoreal** — sends the still to Gemini's image model, which repaints it as a photo while keeping the geometry and camera. Needs a Gemini API key (Claude does not make images); compare **3D still / Photoreal** and download either. AI photos can drift in small details — check before sharing.

**Model view** switches the look off.

## Start from a template

**Export & File ▸ New from Template…** (or type `TEMPLATE`) opens a gallery: the sample house, a small 2-bed house, a studio apartment, a restaurant kitchen & dining room, a small office, or a blank project. Everything in a template is ordinary, editable walls, doors, windows, rooms and furniture. Ctrl+Z takes you back to what you had.

## Trace over a PDF or image of a plan

1. **Export & File ▸ Trace a PDF / Image Plan…** (or type `TRACE`) and choose a JPG / PNG / WebP or a PDF. For a PDF pick the page and, if the sheet says so, the drawing scale (e.g. 1/4" = 1'-0") — it is then placed at true size.
2. **Set scale** (or `TRACESCALE`): click both ends of a dimension you know and type its real length, e.g. `12'6"`.
3. **Move** (or `TRACEMOVE`): click a point on the plan, then where it should go. Fade it with the slider, lock it, and draw walls, doors and windows over it.

### Automatic tracing

Press **Auto-trace walls, doors & rooms** on the image in the Trace panel (or type `TRACEAUTO`, Insert ▸ Reference ▸ Auto-trace). The AI reads the plan and ARCHIFORMA draws real walls, doors, windows and named rooms exactly on top of the image:

- each wall is snapped onto the dark line in the image and its thickness is measured from the pixels;
- if you have not set the scale, the image is scaled from a dimension the AI reads (e.g. `30'-0"`), so sizes come out right; set the scale yourself first for the most accurate result;
- the image fades to 35 % so you can check the result; fix anything with the normal tools, and **Ctrl+Z** removes the whole trace.

Trace images belong to a level, are saved with the project and never print or export. Large scans can be too big for the browser's autosave — use **Save Project (.json)** to keep them.

## Build room by room

Click **Room Builder** in the Build toolbar (or type `RMB`). Describe the room as a run of sides — each with a length and any windows, doors, openings or open gaps along it, turning right or left at the corners — or start from a rectangle / L-shape. Press **Place on plan** and click: a corner snaps to wall ends and corners of other rooms (R rotates, A changes the corner you hold). Rooms placed against each other share their walls instead of doubling them, and doors, windows and gaps on a shared side are cut into the existing wall. Lengths are measured along wall centrelines.

## Custom blocks

**Library tab → Blank** starts a new block; **BE** on any library card edits it.

- Move and resize shapes by typing sizes; **Copy** and **Mirror ↔ / ↕** duplicate them. **Center** and **Fit size** tidy up the insertion point and size.
- **New / Duplicate / Delete** blocks right in the Block Editor (Delete also removes placed copies; Ctrl+Z brings them back).
- **Share** saves your custom blocks to a `.archiblocks.json` file; **Import** brings them into another project (it never overwrites; renamed copies are added).

## Run locally

Prerequisite: Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build` (production build into `dist/`), `npm run build:html` (the whole app as one `docs/index.html`), `npm run preview` (serve the build), `npm test` (engine tests), `npm run lint` (type check).

## Publish on GitHub Pages

This is a Vite + React + TypeScript app, so it has to be **built** before a browser can run it.
If GitHub Pages serves the raw repository files you get a **blank white page**.
The two GitHub-only helpers are kept out of the AI Studio project (AI Studio does not need them) and are separate downloads:

**Option A — build automatically (recommended):** in your GitHub repo, add the file `.github/workflows/deploy.yml`
(Add file ▸ Create new file, paste the provided `deploy.yml`). Then **Settings → Pages → Source: GitHub Actions**.
Every push builds the app and publishes it to `https://<your-username>.github.io/<repo-name>/`.

**Option B — no build:** upload the provided `archiforma.html` to the repo as `docs/index.html`, then
**Settings → Pages → Deploy from a branch → main → /docs**. Regenerate it after changes with `npm run build:html`.

## Other hosts

Vercel, Netlify and Cloudflare Pages all work with: build command `npm run build`, output directory `dist`.
