// Shared Vite library build for the workspace packages: ESM-only output
// plus type declarations. Third-party runtime deps are bundled; peers
// (tify, openseadragon) and the workspace core stay external.
import { defineConfig, type PluginOption } from 'vite';
import dts from 'vite-plugin-dts';
import type { Diagnostic } from 'typescript';

export function defineLib(entry: string, external: (string | RegExp)[] = []) {
  return defineConfig({
    // Relative asset URLs: emitted worker/asset paths (plugin-navplace's
    // MapLibre worker) must resolve next to dist/index.js for installed
    // packages, not against the consuming site's origin root.
    base: './',
    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: true,
      lib: {
        entry,
        formats: ['es'],
        fileName: 'index',
      },
      rollupOptions: { external },
    },
    // ESM workers (plugin-navplace bundles the MapLibre worker via
    // `?worker&url`; an IIFE worker would fail on its ESM module graph).
    worker: { format: 'es' },
    plugins: [
      // Don't ship declarations for the translation JSON modules (dts emits
      // orphan .d.ts files for resolveJsonModule imports otherwise).
      dts({
        entryRoot: 'src',
        exclude: ['src/i18n/**'],
        // vite-plugin-dts only prints TS diagnostics; without this hook a
        // package build stays green despite type errors. Category 1 is
        // ts.DiagnosticCategory.Error (numeric to avoid importing ts at runtime).
        afterDiagnostic: (diagnostics: readonly Diagnostic[]) => {
          const errors = diagnostics.filter((diagnostic) => diagnostic.category === 1);
          if (errors.length === 0) return;
          const files = [
            ...new Set(errors.map((diagnostic) => diagnostic.file?.fileName).filter(Boolean)),
          ];
          throw new Error(
            `tify-plugins: ${errors.length} TypeScript error(s) during declaration build` +
              (files.length ? ` in ${files.join(', ')}` : '') +
              ' (see output above)',
          );
        },
      }) as PluginOption,
    ],
  });
}
