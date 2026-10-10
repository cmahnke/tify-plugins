# @projektemacher/tify-plugin-annotorious

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

Display-only [Annotorious](https://annotorious.dev/) annotations for the
[TIFY](https://tify.rocks/) IIIF viewer: imports `xywh` annotations from the
IIIF manifest and renders them as shapes with a translated list panel.

```ts
import { annotoriousPlugin } from '@projektemacher/tify-plugin-annotorious';
import '@projektemacher/tify-plugin-core/style.css';
import '@projektemacher/tify-plugin-annotorious/annotorious.css';

const plugin = await annotoriousPlugin(tify, {
  panelEl: document.querySelector('#panel'),
});
```

## Notes

- Display-only: `drawingEnabled: false` plus `UserSelectAction.SELECT`, so
  clicks select but never open Annotorious's (English) editor — bodies render
  in the translated side panel instead.
- Annotations are imported from the IIIF manifest (`xywh` fragment targets via
  `W3CImageFormat().parse()`, verified: `xywh=265,661,1260,1239` → exact
  rectangle). Whole-canvas targets, SVG selectors and painting annotations are
  skipped.
- Annotorious coordinates are relative to a single base image: in TIFY book
  view only the first visible page's annotations are shown (noted in the panel).

## Example

`example/` — display-only shapes from IIIF `xywh` annotations plus a list
panel. Run `npm run dev` at the repo root and open
`/packages/plugin-annotorious/example/` (defaults to the IIIF cookbook
tagging manifest).

## Manifest generation

The image side can be any plain image service — generate one with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/)
([`generate`](https://github.com/cmahnke/fliiifenleger#generate),
`--iiif-version V3` recommended):

```sh
java -jar cli/target/fliiifenleger-cli.jar generate --iiif-version V3 \
  -o ./my-iiif-images /path/to/image.jpg
```

The `xywh` tagging annotations themselves are added afterwards, at the
Presentation-manifest level.

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run lint
```

License: AGPL-3.0-or-later.
