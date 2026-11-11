import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, type Plugin } from 'vite';

const devEntrySwitcher: Plugin = {
  name: 'dev-entry-switcher',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html
        .replace(/<!-- PROD_HEAD_START -->[\s\S]*?<!-- PROD_HEAD_END -->/, '')
        .replace(
          /<!-- PROD_BODY_START -->[\s\S]*?<!-- PROD_BODY_END -->/,
          '<script type="module" src="/src/main.tsx"></script>'
        );
    },
  },
  closeBundle() {
    try {
      if (fs.existsSync('dist/assets')) {
        if (!fs.existsSync('assets')) {
          fs.mkdirSync('assets', { recursive: true });
        }
        fs.cpSync('dist/assets', 'assets', { recursive: true });
      }
      if (fs.existsSync('dist')) {
        if (!fs.existsSync('docs')) {
          fs.mkdirSync('docs', { recursive: true });
        }
        fs.cpSync('dist', 'docs', { recursive: true });
      }
      if (!fs.existsSync('.nojekyll')) {
        fs.writeFileSync('.nojekyll', '');
      }
      if (!fs.existsSync('docs/.nojekyll')) {
        fs.writeFileSync('docs/.nojekyll', '');
      }
    } catch (e) {
      console.warn('Failed to sync production assets:', e);
    }
  },
};

export default defineConfig(() => {
  return {
    base: './',
    plugins: [devEntrySwitcher, react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
