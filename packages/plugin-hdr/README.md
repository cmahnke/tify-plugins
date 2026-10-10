# @projektemacher/tify-plugin-hdr

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

HDR status panel for the [TIFY](https://tify.rocks/) IIIF viewer: device and
canvas HDR capability, plus whether the current IIIF image service advertises
HDR support. The dock button carries the capability tint.

Chunk `enableHdrCanvasOnce()` **before** `new Tify(...)` — TIFY creates its
OpenSeadragon canvas lazily after mount:

```ts
import { enableHdrCanvasOnce, hdrPlugin } from '@projektemacher/tify-plugin-hdr';
import '@projektemacher/tify-plugin-core/style.css';

enableHdrCanvasOnce();
const tify = new Tify({ container: '#tify', manifestUrl });
await tify.ready;
const plugin = await hdrPlugin(tify, {
  panelEl: document.querySelector('#panel'),
});
```

## Notes

- Requires a Chromium browser with `enable-experimental-web-platform-features`
  enabled and an HDR-capable display. The plugin detects this and explains the
  setup state (flag hint, SDR fallback) in the panel.
- `hdr-canvas` must hook `getContext` **before** TIFY creates its OpenSeadragon
  canvas, hence `enableHdrCanvasOnce()` before `new Tify(...)`.
- HDR is signalled by the placeholder URI `https://christianmahnke.de/iiif/hdr/`
  in the image service `profile[].supports`.
- The panel reports an Image API service summary per page (version, profile,
  capability fields, HDR verdict).

## Example

`example/` — HDR canvas status and image service check. Run `npm run dev` at
the repo root and open `/packages/plugin-hdr/example/`. The example defaults
to the wallpaper UltraHDR manifest
(`https://christianmahnke.de/post/hdr-iiif/manifest.json`, single canvas, no
text annotations — an empty text view is expected); any manifest URL works via
the input box.

## Manifest generation

Generate HDR-capable image services with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/): UltraHDR JPEGs
tiled with [`--source ultrahdr --sink ultrahdr`](https://github.com/cmahnke/fliiifenleger#ultrahdr-gain-map-tiling)
advertise exactly the `https://christianmahnke.de/iiif/hdr/` service entry
this plugin checks:

```sh
java -jar cli/target/fliiifenleger-cli.jar generate \
  --source ultrahdr \
  --sink ultrahdr \
  --sink-opt quality=90 --sink-opt gainmap-quality=85 \
  -o ./hdr-iiif /path/to/ultrahdr.jpg
```

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run lint
```

License: AGPL-3.0-or-later.
