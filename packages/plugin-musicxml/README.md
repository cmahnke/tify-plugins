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
(default `'auto'`), `tei?: string` (absolute TEI URL or raw TEI XML — overrides
the manifest discovery below), `musicxml?: string` (absolute URL or raw XML —
wins over the TEI-embedded score), `showScoreOverlay?` (default `true`),
`showHighlights?` (default `true`), `regionOverlay?: { enabled?, color?,
opacity? }` (default on, `#ff6400`, 25% fill).

The panel mirrors the
[score-page viewer](https://github.com/cmahnke/Blogs/tree/main/kinderbuecher)'s
player: play/pause/stop, tempo, track and instrument selectors, a **Dual**
toggle (on by default whenever the score carries two note streams), a **Score**
toggle for the rendered overlay, and a **Regions** group (on/off, color,
transparency) for the persistent staff-region overlay drawn from the TEI.

## Manifest format

Per canvas, the score data is discovered via the canvas `rendering` entry
with format `application/tei+xml` (or an id ending in `.tei.xml`), resolved
against the manifest URL. That one document (the homr pipeline's per-page
TEI, see the [homr TEI customization](https://github.com/cmahnke/Blogs/tree/main/kinderbuecher/Source%20Files/Experiments/homr/schema/homr-tei.odd))
carries everything:

- the staff geometry — `<facsimile>/<surface>/<zone type="staff">` with the
  bounding box (`@ulx/@uly/@lrx/@lry`) and one `<path points="x,y …">`
  polyline per staff line (the staff grid);
- the MusicXML embedded verbatim under `<div type="score">`;
- the OMR run outcome on `<application ident="homr" status="…"
confidence="…">`.

Without a TEI rendering, the plain MusicXML rendering (format
`application/vnd.recordare.musicxml+xml`, or an id ending in `.musicxml`) is
used as a fallback: playback works, but nothing is mapped onto the scan (no
aligned score, no staff regions). Without any score reference the panel
reports that the page has no score; playback needs no image at all (an
explicit `musicxml` URL or XML string suffices).

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

Score data (staff TEI + MusicXML) is produced by the
[homr OMR pipeline](https://github.com/cmahnke/Blogs/tree/main/kinderbuecher)
(optical music recognition with staff detection), not by an image tiler:
image services themselves can be generated with
[fliiifenleger](https://github.com/cmahnke/fliiifenleger/)
([`generate`](https://github.com/cmahnke/fliiifenleger#generate),
`--iiif-version V3` recommended).

## Example

`example/` — manifest URL box with the score panel beside the viewer (plus
optional `?tei=` / `?musicxml=` overrides to try the player without authoring
a manifest). Run `npm run dev` at the repo root and open
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
