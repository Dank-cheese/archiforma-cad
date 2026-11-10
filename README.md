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

This is a Vite + React + TypeScript project. Browsers can't run `.tsx` files directly, so the site has to be **built** (`npm run build` → `dist/`) rather than served straight from the repository root.

The included workflow (`.github/workflows/deploy.yml`) builds the app and publishes the result automatically:

1. Push this repository to GitHub (onto the `main` or `master` branch).
2. In your repository on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions** (not *"Deploy from a branch"*).
4. Wait ~1 minute for the **Deploy to GitHub Pages** workflow in the **Actions** tab to finish, then open the URL shown there (`https://<your-username>.github.io/<repo-name>/`).

### Other hosts (Vercel / Netlify / Cloudflare Pages)

- **Build command:** `npm run build`
- **Output directory:** `dist`
