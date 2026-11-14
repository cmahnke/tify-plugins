# @projektemacher/tify-plugin-navplace

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

Places from the [navPlace extension](https://iiif.io/api/extension/navplace/)
on a vector-tile map, docked into the [TIFY](https://tify.rocks/) IIIF
viewer: the manifest's `navPlace` FeatureCollection (plus the visible
canvases' own `navPlace` features) renders as markers and shapes, with a
place list, popups and a camera that follows the places.

The basemap is [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/) with
[OpenFreeMap](https://openfreemap.org/) vector tiles by default — free, no
API key, attribution carried by the style.

```ts
import { navPlacePlugin } from '@projektemacher/tify-plugin-navplace';
import '@projektemacher/tify-plugin-core/style.css';
import '@projektemacher/tify-plugin-navplace/navplace.css';

const plugin = await navPlacePlugin(tify, {
  panelEl: document.querySelector('#panel'),
});
```

The map viewer is **lazy-loaded**: plugin init builds only panel DOM and
syncs place data from the (cached) manifest; MapLibre, its CSS and its
worker live in a separate chunk that loads the first time the map becomes
visible — an opened dock panel or, in sidecar mode, the panel entering the
viewport. A manifest without places never loads the map at all.

## Manifest format

The [navPlace extension](https://iiif.io/api/extension/navplace/) adds a
`navPlace` property to Presentation 3 resources. Its value is a GeoJSON
FeatureCollection — embedded (with `features`) or referenced (only `id` and
`type`; the plugin fetches it). The manifest needs the extension context
before the Presentation context:

```json
{
  "@context": [
    "http://iiif.io/api/extension/navplace/context.json",
    "http://iiif.io/api/presentation/3/context.json"
  ],
  "id": "https://example.org/manifest.json",
  "type": "Manifest",
  "navPlace": {
    "id": "https://example.org/feature-collection/1",
    "type": "FeatureCollection",
    "features": [
      {
        "id": "https://example.org/feature/1",
        "type": "Feature",
        "properties": { "label": { "en": ["Göttingen"] } },
        "geometry": { "type": "Point", "coordinates": [9.938, 51.533] }
      }
    ]
  }
}
```

Feature labels come from `properties.label` as an IIIF language map (the
plugin picks the viewer language, then English), with `properties.name` /
`properties.title` as GeoJSON-style fallbacks and a numbered `Place {n}` as
the last resort. Unlocated features (null geometry) are skipped. Canvases
may carry their own `navPlace`; those features appear while the page is
visible and re-sync on page changes (the camera refits when the feature set
changes).

## Options

- `panelEl` (required, sidecar unless docked), `dock?: boolean | 'auto'`
  (default `'auto'`), `autoOpen?: boolean` (default `true`).
- `style?: string | object` — MapLibre style URL or inline style object.
  Default: `https://tiles.openfreemap.org/styles/liberty`. Other OpenFreeMap
  styles: `.../styles/positron`, `.../styles/bright`.
- `navPlace?: FeatureCollection | url` — data override instead of manifest
  discovery (handy for collections without navPlace yet).
- `center?: [lng, lat]`, `zoom?: number` — explicit initial camera;
  without both, the map fits the places (points capped at zoom 12).
- `fitBoundsPadding?: number` — fit padding in px (default 40).

The panel lists the places (label plus coordinates); picking one flies the
map to it, clicking a marker opens a popup with label and coordinates.

## Example

`example/` — manifest URL box with the map panel beside the viewer,
defaulting to the repo's navPlace demo manifest
(`demo/navplace/manifest.json`, points around Göttingen and Berlin).
Optional `?style=` to try another basemap URL. Run `npm run dev` at the
repo root and open `/packages/plugin-navplace/example/`.

## Development

```sh
npm run build       # dist/ (ESM + declarations + lazy map chunk)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run test:e2e    # Playwright suite (offline; style requests are mocked)
npm run lint
```

`skipLibCheck: true` is required in the consumer's tsconfig (TIFY itself
ships no types; see the other packages). MapLibre is bundled into the
package; `tify` stays a peer dependency.

License: AGPL-3.0-or-later.
