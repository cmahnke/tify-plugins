# @projektemacher/tify-plugin-image-overlays

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

[OpenSeadragon](https://openseadragon.github.io/) overlays on top of the
[TIFY](https://tify.rocks/) IIIF viewer, re-drawn on page change.

```ts
import { imageOverlaysPlugin } from '@projektemacher/tify-plugin-image-overlays';

const plugin = await imageOverlaysPlugin(tify, { markers: 3 });
```

## TEI word boxes (default)

When the current canvas references a TEI transcription page-level via
`seeAlso` (`format: application/tei+xml`, manifest `seeAlso` as fallback),
word boxes from `<facsimile>` zones linked via `@facs` are drawn instead of
demo markers. Surface coordinates scale to canvas pixels automatically;
surfaces match canvases via `<graphic url>`, then `<pb>` order, then
position. Display-only (hover shows the word, no clicks).

```ts
const plugin = await imageOverlaysPlugin(tify, {
  tei: { level: 'word', maxWords: 2000 }, // or `tei: false` for markers only
});
```

## Overlay panel

Pass `panelEl` to get a sidebar with live rendering controls: show/hide
the annotation layer, show/hide the box outlines, box fill color and
opacity — plus the clicked word's text. Clicking a word box selects it;
clicking again deselects. The panel docks into the viewer header.

```ts
const plugin = await imageOverlaysPlugin(tify, {
  markers: 3,
  panelEl: document.querySelector('#panel'),
});
```

## Example

`example/` — TEI word boxes or demo markers, synced to pages. Run `npm run
dev` at the repo root and open `/packages/plugin-image-overlays/example/`;
it opens with the live TEI demo (`public/demo/tei/manifest.json` +
`tei.xml`: word boxes over cookbook tiles, also served from the built app).
The dev-only local fixture
`http://localhost:5173/packages/plugin-image-overlays/example/tei-fixture/manifest.json`
shows the same wiring.

## Manifest generation

Any plain image service works. Generate one with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/)
([`generate`](https://github.com/cmahnke/fliiifenleger#generate),
`--iiif-version V3` recommended):

```sh
java -jar cli/target/fliiifenleger-cli.jar generate --iiif-version V3 \
  -o ./my-iiif-images /path/to/image.jpg
```

The TEI transcription itself is authored separately and linked page-level via
canvas `seeAlso` — not a fliiifenleger feature.

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run test:tei    # headless regression check for the TEI parser
npm run lint
```

License: AGPL-3.0-or-later.
