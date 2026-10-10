# @projektemacher/tify-plugin-musicxml

> **Note:** This code was generated with AI assistance — [opencode](https://opencode.ai), powered by GLM (Z.ai).

MusicXML score rendering and playback for the [TIFY](https://tify.rocks/) IIIF
viewer: renders a page's MusicXML notation
([OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)) as an overlay
aligned onto the scan, with Web Audio playback (tempo, tracks, instruments)
and note/staff highlights that follow the performance.

```ts
import { musicxmlPlugin } from '@projektemacher/tify-plugin-musicxml';
import '@projektemacher/tify-plugin-core/style.css';
import '@projektemacher/tify-plugin-musicxml/musicxml.css';

const plugin = await musicxmlPlugin(tify, {
  panelEl: document.querySelector('#panel'),
});
```

Options: `panelEl` (required, sidecar unless docked), `dock?: boolean | 'auto'`
(default `'auto'`), `musicxml?: string` (absolute URL or raw XML — overrides
the manifest discovery below), `showScoreOverlay?` (default `true`),
`showHighlights?` (default `true`).

## Manifest format

Per canvas, the MusicXML document is discovered via the canvas `rendering`
entries (format `application/vnd.recordare.musicxml+xml`, or an id ending in
`.musicxml`), resolved against the manifest URL. Staff geometry comes from
describing annotations whose `#xywh` target is the staff region and whose body
carries the staff grid as JSON (`staffGrid`, `staffLineCount`):

```json
{
  "type": "Annotation",
  "motivation": "describing",
  "body": {
    "type": "TextualBody",
    "format": "application/json",
    "value": "{\"staffGrid\": [{\"x\": 50, \"y\": [100, 112, 124, 136, 148]}], \"staffLineCount\": 5}"
  },
  "target": "https://example.org/canvas/p1#xywh=50,100,650,140"
}
```

Without staff data the score falls back to a whole-page letterbox layout.
Without a MusicXML reference the panel reports that the page has no score;
playback needs no image at all (an explicit `musicxml` URL or XML string
suffices).

## Playback details

- The MusicXML is parsed into a note timeline, tracking `<print new-system>`
  to assign notes to physical staff systems.
- A played note maps to page coordinates using the staff grid: X by the
  note's time position across the system, Y by pitch mapped onto the staff
  lines (clef-aware). The marker radius scales with the detected staff line
  spacing so it matches note-head size on the scan.
- Audio is synthesized with the Web Audio API, so no soundfont files are
  required. Notes schedule on the exact musical grid; the firing timer only
  drives the UI callbacks, so audio stays on the beat under main-thread
  jitter.
- OSMD's playback cursor advances one voice entry (onset) per step,
  including rests, which are not in the timeline.

## Sanitizing invalid MusicXML

Some transcriptions contain `<note>` elements carrying both `<chord />` and
`<rest />` — invalid MusicXML (a rest cannot be a chord member). OSMD builds
a pitchless chord note for those and crashes during layout with
`Cannot read properties of undefined (reading 'getHalfTone')`, failing the
whole page render. The plugin strips `<chord />` from any note containing a
rest before rendering; the playback parser already ignores pitchless rests.

## Manifest generation

Score data (MusicXML + staff grids) is produced by the
[homr OMR pipeline](https://github.com/cmahnke/Blogs/tree/main/kinderbuecher)
(optical music recognition with staff detection), not by an image tiler:
image services themselves can be generated with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/)
([`generate`](https://github.com/cmahnke/fliiifenleger#generate),
`--iiif-version V3` recommended).

## Example

`example/` — manifest URL box with the score panel beside the viewer (plus an
optional `?musicxml=` override to try the player without authoring a
manifest). Run `npm run dev` at the repo root and open
`/packages/plugin-musicxml/example/`.

## Development

```sh
npm run build       # dist/ (ESM + declarations)
npm run typecheck
npm run test:i18n   # catalogue coverage for src/ + example/
npm run test:timeline  # headless regression check for the MusicXML parser
npm run lint
```

License: AGPL-3.0-or-later.
