// Shared Vite library build for the workspace packages: ESM-only output
// plus type declarations. Third-party runtime deps are bundled; peers
// (tify, openseadragon) and the workspace core stay external.
import { defineConfig, type PluginOption } from 'vite';
import dts from 'vite-plugin-dts';

export function defineLib(entry: string, external: (string | RegExp)[] = []) {
  return defineConfig({
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
    plugins: [
      // Don't ship declarations for the translation JSON modules (dts emits
      // orphan .d.ts files for resolveJsonModule imports otherwise).
      dts({ entryRoot: 'src', exclude: ['src/i18n/**'] }) as PluginOption,
    ],
  });
}
