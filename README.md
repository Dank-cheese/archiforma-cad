# ARCHIFORMA — 2D/3D Architectural CAD & Light BIM

A browser-based 2D/3D architectural CAD and light BIM tool with AutoCAD- and Revit-style commands and shortcuts.

## Run locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Publish on GitHub Pages

ARCHIFORMA is already pre-compiled into static HTML, JavaScript, and CSS (`index.html` and `assets/`), so it works with **both** GitHub Pages deployment methods out of the box:

### Option A: Deploy from a branch (Quickest & Easiest — No build step required!)

1. Push this repository to GitHub (or upload the files to your repository).
2. On GitHub, navigate to **Settings → Pages**.
3. Under **Build and deployment → Source**, keep or select **Deploy from a branch**.
4. Select the **main** (or **master**) branch and folder **/ (root)** (or **/docs**).
5. Click **Save**.
6. GitHub Pages will publish the app immediately. Open your URL (`https://<your-username>.github.io/<repo-name>/`) and the CAD/BIM studio will launch directly!

### Option B: Deploy via GitHub Actions

If you want GitHub to automatically run `npm run build` whenever you push code changes:
1. In your repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) will build and publish automatically on every push.

### Other hosts (Vercel / Netlify / Cloudflare Pages)

- **Build command:** `npm run build`
- **Output directory:** `dist`
