# @projektemacher/tify-plugin-c2pa

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

C2PA provenance panel for the [TIFY](https://tify.rocks/) IIIF viewer: checks
the tiles in the current viewport for embedded C2PA manifests and validates
them against configurable trust anchors. The dock button carries the validity
tint.

```ts
import { c2paPlugin } from '@projektemacher/tify-plugin-c2pa';
import '@projektemacher/tify-plugin-core/style.css';

const plugin = await c2paPlugin(tify, {
  panelEl: document.querySelector('#panel'),
  trustAnchors: { url: 'https://contentcredentials.org/trust/anchors.pem' },
});
```

## Notes

- C2PA checks fetch tile bytes and parse them with `@contentauth/c2pa-web`
  (WASM, embedded via the `inline` entry). Tile servers without CORS headers
  yield `unknown (blocked)` — expected.
- Signalling: there is no standard way yet to mark C2PA support in the IIIF
  Image API — see the [proposal](iiif-c2pa.md) to list
  `https://christianmahnke.de/iiif/c2pa/` in `info.json` `supports`. The panel
  reports per page whether the image service advertises it.
- Trust anchors are configured at plugin init via `trustAnchors` (string/null
  shorthand = shown + editable, preserving the classic call). The object form
  controls the URL and its panel visibility:

  | Config                     | Behavior                                                        |
  | -------------------------- | --------------------------------------------------------------- |
  | `{ show: false }`          | Internal default, nothing shown                                 |
  | `{ url, show: false }`     | URL set, not shown (masked as `(not shown)` in status/tooltips) |
  | `{ url, editable: false }` | URL shown read-only (disabled input, no Apply button)           |
  | `{ url }` / `{ url: '' }`  | Shown and editable (`''` = defaults until typed)                |

  `show: false` forces `editable: false`; `''` normalizes to `null` (SDK
  defaults). Visibility is init-only; `setTrustAnchorsUrl()` still works
  programmatically at runtime. The example exposes both flags as checkboxes
  (session-only; the URL itself stays link-shareable via `?trustAnchors=`).

## Example

`example/` — per-tile provenance for the live viewport with a trust-anchor
form inside the panel. Run `npm run dev` at the repo root and open
`/packages/plugin-c2pa/example/`.

## Manifest generation

Generate C2PA-signed image services with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/): the
[`--sink c2pa`](https://github.com/cmahnke/fliiifenleger#c2pa-content-credentials)
sink signs every tile and advertises the
`https://christianmahnke.de/iiif/c2pa/` service entry. Use
`--iiif-version V3` — and pass `--sink-opt trust-anchor=<url>` to advertise
the `trustAnchor` URI that this plugin's `trustAnchors` option validates
against (requires Image API 3; generation fails with V2):

```sh
java -jar cli/target/fliiifenleger-cli.jar generate \
  --iiif-version V3 \
  --sink c2pa \
  --sink-opt cert-name=fliiifenleger \
  --sink-opt trust-anchor=https://example.com/anchors.pem \
  -o ./signed-iiif /path/to/image.jpg
```

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run lint
```

License: AGPL-3.0-or-later.
