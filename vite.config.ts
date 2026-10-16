import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

// Workspace packages, resolved to source during dev so examples always run
// against the latest code. Production builds use the built dist output,
// exactly like an external consumer would.
const scope = '@projektemacher';
const workspaceAliases: Array<[string, string]> = [
  [`${scope}/tify-plugin-core`, 'packages/core/src/index.ts'],
  [`${scope}/tify-plugin-side-panel`, 'packages/plugin-side-panel/src/index.ts'],
  [`${scope}/tify-plugin-image-overlays`, 'packages/plugin-image-overlays/src/index.ts'],
  [`${scope}/tify-plugin-hdr`, 'packages/plugin-hdr/src/index.ts'],
  [`${scope}/tify-plugin-c2pa`, 'packages/plugin-c2pa/src/index.ts'],
  [`${scope}/tify-plugin-annotorious`, 'packages/plugin-annotorious/src/index.ts'],
  [`${scope}/tify-plugin-musicxml`, 'packages/plugin-musicxml/src/index.ts'],
];

// Each workspace ships its own example under packages/*/example/.
const exampleInputs: Record<string, string> = {};
for (const dir of readdirSync(resolve(root, 'packages'))) {
  const entry = resolve(root, 'packages', dir, 'example', 'index.html');
  if (existsSync(entry)) exampleInputs[`example-${dir}`] = entry;
}

export default defineConfig(({ command }) => ({
  // GitHub Pages deploys set VITE_BASE=/&lt;repo&gt;/; local dev/preview serves at root.
  base: process.env.VITE_BASE || '/',
  resolve:
    command === 'serve'
      ? {
          alias: [
            {
              find: `${scope}/tify-plugin-core/style.css`,
              replacement: resolve(root, 'packages/core/style.css'),
            },
            {
              find: `${scope}/tify-plugin-musicxml/musicxml.css`,
              replacement: resolve(root, 'packages/plugin-musicxml/src/musicxml.css'),
            },
            ...workspaceAliases.map(([find, replacement]) => ({
              find,
              replacement: resolve(root, replacement),
            })),
          ],
        }
      : {},
  build: {
    outDir: 'dist',
    // ES2022 for top-level await in example entries (mods are ESM-only).
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        ...exampleInputs,
      },
    },
  },
  server: {
    port: 5173,
  },
}));
