# @projektemacher/tify-plugin-core

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

Shared core for [TIFY](https://tify.rocks/) viewer plugins: plugin contract and
page watcher, English/German i18n (TIFY conventions), IIIF manifest/annotation
helpers, dock-into-viewer, and shared panel styles.

```ts
import { sidePanelPlugin } from '@projektemacher/tify-plugin-side-panel';
import '@projektemacher/tify-plugin-core/style.css';
```

## What's inside

- **Plugin contract** — `TifyPlugin` (`{ destroy() }`), `TifyPluginFactory`.
- **Page watching** — `waitReady`, `getPages`, `onPagesChange` (TIFY emits no
  page/view events, so options are polled cheaply and watched via DOM mutations).
- **IIIF helpers** — manifest fetching/caching, canvas + Image API service
  listing, `info.json` access, `xywh` annotation extraction; Presentation 2
  (`sequences`/`@id`, `otherContent`, OA `on`/`resources`) and 3
  (`items`/`id`) are both accepted wherever cheap, as is the Presentation 4
  2D subset (v4 adds 3D Scenes, out of scope).
- **Feature detection** — `describeManifest`, `describeCanvas`,
  `describeImageFeatures`: which plugin-relevant features the manifest and
  image service advertise (IIIF versions, TEI/annotation/score links, HDR/C2PA
  signals). Presence-only, no linked resources are fetched.
- **Missing-plugin warnings** — `registerPlugin` / `setFeatureWarnings`: the
  load path (`getManifest`, `getInfoJson`) warns when a detected feature has
  no loaded plugin; see below.
- **Info panel** — `infoPanelPlugin`: lists those features for the current
  page, docked or beside the viewer. Needs no sibling plugin package.
- **Dock** — `dockPanel()` with `DOCK_ICONS`; see below.
- **i18n** — `createTranslator`, `applyStaticTranslations`; see below.
- **Styles** — `@projektemacher/tify-plugin-core/style.css` (panel skeleton,
  dock buttons, markers, pills).

## Docked panels

TIFY cannot register custom views, so the dock helper imitates one: panels
dock into `.tify-main` beside the image with a native-looking header button
(icon over label, `aria-expanded`), exclusive with TIFY's own views (opening a
native view closes the dock and vice versa). If TIFY's DOM is not recognized
(future versions), docking falls back to rendering beside the viewer — each
plugin takes `dock: true | false | 'auto'` (default `'auto'`). Not portable:
number-key shortcuts and URL view state don't cover docked panels.

The button is appended as the **last element of the primary `-view` header
group**. That container is the one TIFY 0.36 keeps visible: on wide viewers it
sits inline with TIFY's own view buttons, on narrow viewers it lives inside
the view dropdown. Because the group is re-rendered by TIFY when the available
views change, a MutationObserver re-appends the button if TIFY drops it.

## i18n

TIFY conventions: English source strings are the keys; lookup precedence is
per-instance `tify.options.translations[lang][key]` override → catalogue →
English key with `[bracket hints]` stripped. The language follows
`tify.options.language` (so `tify.setLanguage('de')` switches plugin UI too),
then `?lang=`, then the browser language.

Core bundles UI strings only for the info panel: every workspace owns its
catalogue at `src/i18n/translations/{lang}.json` (`$language` first, keys
sorted), lazily imports it next to its code, and passes it to the translator:

```ts
const de = (await import('./i18n/translations/de.json')).default;
const { t } = await createTranslator(tify, { de });
```

`npm run test:i18n` (per workspace) scans the package's static `t('…')` /
`data-i18n` keys against its catalogue (`scripts/check-i18n.js <dir>` at the
repo root): fails on missing, unused, empty, or mis-sorted entries.

Peer dependency: `tify` (the viewer provides the single instance).

## Info panel

```ts
import { infoPanelPlugin } from '@projektemacher/tify-plugin-core';

const plugin = await infoPanelPlugin(tify, {
  panelEl: document.querySelector('#panel'),
});
```

Lists the plugin-relevant features of the current page: Presentation version
and canvas count, linked TEI transcriptions (canvas or manifest level),
annotations (embedded or by reference), MusicXML scores, plus the image
service's API version, profile, and HDR/C2PA advertisement. Presence-only:
linked files are never fetched and nothing is verified — the panel works
with core alone. The pure detectors are also exported for reuse
(`describeManifest`, `describeCanvas`, `describeImageFeatures`).
Presentation 2, 3, and the Presentation 4 2D subset are all covered
(Image API has no v4; 3D Scenes are out of scope).

## Missing-plugin warnings

A manifest that advertises a feature is useless without the plugin that
renders it. Core's load path (`getManifest`, `getInfoJson` — used by every
plugin and available to hosts) therefore checks each loaded manifest and
image service against the plugins that have registered themselves and warns
once per feature and source:

```
[tify-plugins] https://example.org/manifest.json advertises TEI
transcription (page 1), but @projektemacher/tify-plugin-image-overlays is
not loaded
```

Each plugin package self-registers on init, so loading it silences its own
warning; `activePlugins()` lists what is currently active. Hosts that
deliberately ship without a plugin can silence everything:

```ts
import { setFeatureWarnings } from '@projektemacher/tify-plugin-core';

setFeatureWarnings(false);
```

Detection is version-agnostic (Presentation 2/3/4-2D), and the checks never
throw — a diagnostic must not break a manifest load.

## Examples using core

`example/` — the info panel over any manifest. Run `npm run dev` at the
repo root and open `/packages/core/example/`; append `?lang=de` for German
strings. The plugin examples exercise the remaining helpers further;
`packages/plugin-side-panel` is the smallest one to start from.

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
npm run test:i18n
npm run lint
```

License: AGPL-3.0-or-later.
