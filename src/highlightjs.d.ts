// Ambient types for the untyped per-language modules of highlight.js
// (examples import only the TypeScript and XML grammars to keep bundles small).
declare module 'highlight.js/lib/languages/typescript' {
  import type { LanguageFn } from 'highlight.js';

  const typescript: LanguageFn;
  export default typescript;
}

declare module 'highlight.js/lib/languages/xml' {
  import type { LanguageFn } from 'highlight.js';

  const xml: LanguageFn;
  export default xml;
}
