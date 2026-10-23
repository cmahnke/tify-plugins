# tify-plugins

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

Plugins for [TIFY](https://tify.rocks/) (`tify@0.36.2`), the slim IIIF document viewer,
published as individual npm modules under `@projektemacher/tify-plugin-*` from
this monorepo.
TIFY has no formal plugin registry, so plugins here are wrapper modules around a live
`Tify` instance: `(tify, options) => { destroy() }`, using the
[instance API](https://github.com/tify-iiif-viewer/tify/blob/main/doc/api.md)
(`ready`, `setPage`, `setView`, …) plus the exposed OpenSeadragon viewer (`tify.viewer`).

## Packages

Each workspace is independently publishable: it carries its own `package.json`,
README, example, and translations; `npm publish --workspace …` ships only
`dist/` (plus core's stylesheets) — examples and sources stay dev-only.

| Package                                                                      | npm name                                     | What it does                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| [`packages/core`](packages/core/README.md)                                   | `@projektemacher/tify-plugin-core`           | Plugin contract, i18n, IIIF/dock helpers, panel styles    |
| [`packages/plugin-side-panel`](packages/plugin-side-panel/README.md)         | `@projektemacher/tify-plugin-side-panel`     | Custom metadata panel beside the viewer                   |
| [`packages/plugin-image-overlays`](packages/plugin-image-overlays/README.md) | `@projektemacher/tify-plugin-image-overlays` | OpenSeadragon overlays synced to pages (TEI word boxes)   |
| [`packages/plugin-hdr`](packages/plugin-hdr/README.md)                       | `@projektemacher/tify-plugin-hdr`            | HDR canvas status + image service check                   |
| [`packages/plugin-c2pa`](packages/plugin-c2pa/README.md)                     | `@projektemacher/tify-plugin-c2pa`           | Per-tile C2PA provenance with trust anchors               |
| [`packages/plugin-annotorious`](packages/plugin-annotorious/README.md)       | `@projektemacher/tify-plugin-annotorious`    | Display-only Annotorious annotations from the manifest    |
| [`packages/plugin-musicxml`](packages/plugin-musicxml/README.md)             | `@projektemacher/tify-plugin-musicxml`       | Rendered MusicXML score with playback (from the homr TEI) |

Rules that keep this shippable: `tify` (and `openseadragon` where imported
directly) are `peerDependencies` — the viewer must exist exactly once.
Third-party runtime deps (`hdr-canvas`, `c2pa-web`, `@annotorious/openseadragon`,
`opensheetmusicdisplay`)
are bundled into their plugin. Consumers need `skipLibCheck` (TIFY itself
ships no types; each package documents this). The C2PA package embeds the WASM
binary (~11MB, ~4MB gzipped) via c2pa-web's `inline` entry — the only option
that survives installation as a dependency, since a library cannot assume the
host serves its internal asset paths.

## Generating IIIF images

The Image API side (tiles + `info.json`) consumed by the examples and plugins
can be generated with [fliiifenleger](https://github.com/cmahnke/fliiifenleger/),
a static Java IIIF tiler. The wrapping Presentation manifest — what the
examples actually load — is authored separately (IIIF Cookbook style).

| Package                    | fliiifenleger settings                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| side-panel, basic examples | [`generate`](https://github.com/cmahnke/fliiifenleger#generate) with `--iiif-version V3` — any plain image service works                                                                                                        |
| image-overlays             | same as above; the TEI transcription linked via canvas `seeAlso` is authored separately (not a fliiifenleger feature)                                                                                                           |
| hdr                        | [`--source ultrahdr --sink ultrahdr`](https://github.com/cmahnke/fliiifenleger#ultrahdr-gain-map-tiling) — UltraHDR tiles advertise exactly the `https://christianmahnke.de/iiif/hdr/` service this plugin detects              |
| c2pa                       | [`--sink c2pa`](https://github.com/cmahnke/fliiifenleger#c2pa-content-credentials) with `--iiif-version V3`; `--sink-opt trust-anchor=…` advertises the `trustAnchor` URI this plugin's `trustAnchors` option validates against |
| annotorious                | default `generate`; the `xywh` annotations are added afterwards at the Presentation-manifest level                                                                                                                              |
| musicxml                   | score data (staff TEI + embedded MusicXML) comes from the [homr OMR pipeline](https://github.com/cmahnke/Blogs/tree/main/kinderbuecher); image services themselves are plain `generate` output                                  |

## Examples

Every workspace ships its own example under `packages/*/example/` — the six
plugin packages plus core's info panel. The root demo (`index.html`) is a
catalog linking them all:

```sh
npm run dev      # http://localhost:5173/  (catalog)
                 # /packages/plugin-side-panel/example/, /packages/core/example/, …
```

Examples always run against the workspace sources (dev aliases); production
builds use the packages' built `dist/` output, exactly like an external
consumer. Append `?lang=de` to any example URL to check the German strings.

## Develop

```sh
npm install
npm run dev            # catalog + all package examples (dev aliases → src)
npm run typecheck      # root demo + all packages/examples (via tsconfig paths)
npm run lint           # eslint + stylelint + prettier --check (repo-wide)
npm run lint:fix       # auto-fix + prettier --write
npm run test:i18n      # root demo + every package's own catalogue coverage
npm run test:e2e       # Playwright catalog suite (all browsers; E2E_PREVIEW=1 for the built app)
npm run test:e2e --workspaces --if-present  # per-package example suites
npm run test:e2e --workspace @projektemacher/tify-plugin-musicxml  # one package's suite
# …or from inside the workspace itself:
cd packages/plugin-musicxml && npm run test:e2e  # same suite, shared root server
npm run build          # core → plugins → catalog + examples (dist)
npm run preview
```

Per-module checks (as in CI, each with its own status check):

```sh
npm run lint --workspace @projektemacher/tify-plugin-hdr
npm run test:i18n --workspace @projektemacher/tify-plugin-hdr
npm run test:tei --workspace @projektemacher/tify-plugin-image-overlays
```

Use one of the plugins standalone:

```sh
npm install @projektemacher/tify-plugin-side-panel
```

```ts
import { sidePanelPlugin } from '@projektemacher/tify-plugin-side-panel';
import '@projektemacher/tify-plugin-core/style.css';
```

The same packages are also published to GitHub Packages under the
`@cmahnke` scope (`@cmahnke/tify-plugin-*`, mirroring the npmjs releases).
Releases run the `Publish` workflow ([`publish.yml`](.github/workflows/publish.yml):
publishing a GitHub Release, or manually from the Actions tab), which gates
on the full CI run and publishes only the packages whose version changed
since the previous release tag — so re-running is a no-op.
Installing from there needs authentication — add to `.npmrc`:

```
@cmahnke:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<personal-access-token>
```

then `npm install @cmahnke/tify-plugin-side-panel`. The inter-package
dependency (`@projektemacher/tify-plugin-core`) still resolves from npmjs,
so no extra registry configuration is needed for it.

## Plugin translations (English + German)

English source strings are the keys; each workspace owns its catalogue at
`src/i18n/translations/de.json` (`$language` first, keys sorted). Lookup
precedence mirrors TIFY: per-instance `tify.options.translations[lang][key]`
override → catalogue → English. The language follows `tify.options.language`
(so `tify.setLanguage('de')` switches plugin UI too), then `?lang=de`, then
the browser language.
Every workspace's `npm run test:i18n` scans its own static `t('…')` /
`data-i18n` keys and fails on missing, unused, empty, or mis-sorted catalogue
entries (`scripts/check-i18n.js <dir>`).

## Citing

This project is citable via [Citation File Format](https://citation-file-format.github.io/)
(`CITATION.cff`, which GitHub renders in the sidebar) and
[Codemeta](https://codemeta.org/) (`codemeta.json`, JSON-LD for software
metadata exchange). Both name the author, license (AGPL-3.0-or-later), the
repository, and TIFY as the wrapped viewer.

Version bumps must update both files' `version` (and `date-released` /
`dateModified`) — the publish guard (`npm run test:citation`) fails otherwise,
before any release.

```sh
node scripts/ci-publish-guard.mjs --metadata
```

## License

AGPL-3.0-or-later, see `LICENSE` (matches TIFY's license; each package carries a copy).
