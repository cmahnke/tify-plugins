# @projektemacher/tify-plugin-side-panel

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

Custom metadata side panel for the [TIFY](https://tify.rocks/) IIIF viewer:
document title, page status, and prev/next/thumbnails controls. Docks into
TIFY's viewer chrome when recognized, otherwise renders into the given host
element.

```ts
import { sidePanelPlugin } from '@projektemacher/tify-plugin-side-panel';
import '@projektemacher/tify-plugin-core/style.css';

const plugin = await sidePanelPlugin(tify, { panelEl: document.querySelector('#panel') });
```

## Example

`example/` — manifest URL box with the panel beside the viewer. Run
`npm run dev` at the repo root and open
`/packages/plugin-side-panel/example/`.

## Manifest generation

Any plain image service works. Generate one with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/)
([`generate`](https://github.com/cmahnke/fliiifenleger#generate),
`--iiif-version V3` recommended):

```sh
java -jar cli/target/fliiifenleger-cli.jar generate --iiif-version V3 \
  -o ./my-iiif-images /path/to/image.jpg
```

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run lint
```

License: AGPL-3.0-or-later.
