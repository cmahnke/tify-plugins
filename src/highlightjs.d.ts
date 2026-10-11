// Ambient types for the untyped per-language modules of highlight.js
// (examples import only the TypeScript grammar to keep bundles small).
declare module 'highlight.js/lib/languages/typescript' {
  import type { LanguageFn } from 'highlight.js';

  const typescript: LanguageFn;
  export default typescript;
}
