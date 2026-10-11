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
  (`sequences`/`@id`) and 3 (`items`/`id`) are both accepted wherever cheap.
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

Core itself bundles no UI strings: every workspace owns its catalogue at
`src/i18n/translations/{lang}.json` (`$language` first, keys sorted), lazily
imports it next to its code, and passes it to the translator:

```ts
const de = (await import('./i18n/translations/de.json')).default;
const { t } = await createTranslator(tify, { de });
```

`npm run test:i18n` (per workspace) scans the package's static `t('…')` /
`data-i18n` keys against its catalogue (`scripts/check-i18n.js <dir>` at the
repo root): fails on missing, unused, empty, or mis-sorted entries.

Peer dependency: `tify` (the viewer provides the single instance).

## Examples using core

Core is a library with no page of its own; the plugin examples exercise
its panel, dock, i18n, and IIIF helpers. `packages/plugin-side-panel`
is the smallest one to start from.

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
