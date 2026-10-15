// Parser for the homr pipeline's per-page TEI score documents.
//
// A TEI rendering (canvas `rendering` entry, format `application/tei+xml`)
// is the single source of a page's score data: the detected staff geometry
// lives in <facsimile>/<surface>/<zone type="staff"> (bounding box plus one
// <path points="x,y …"> polyline per staff line — the staff grid), and the
// OMR-produced MusicXML is embedded verbatim under <div type="score"> as a
// namespace-free <score-partwise> document. The <application ident="homr">
// header element carries the machine-readable OMR run outcome (@status,
// @confidence).

import type { StaffEntry, StaffGridPoint } from './note-map';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';

export interface TeiOmr {
  status?: string;
  confidence?: number;
}

export interface TeiScore {
  /** staff regions (bboxes + line polylines) in page pixels */
  staves: StaffEntry[];
  /** the embedded MusicXML as a standalone XML string, or null */
  musicxmlText: string | null;
  /** the OMR run outcome from the <application ident="homr"> header */
  omr?: TeiOmr;
}

/** "1427,2231 1460,2231 …" -> [{x, y}, …]; skips malformed pairs. */
function parsePoints(value: string | null): Array<{ x: number; y: number }> {
  if (!value) return [];
  const points: Array<{ x: number; y: number }> = [];
  for (const pair of value.trim().split(/\s+/)) {
    const [xs, ys] = pair.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

function intAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Rebuild a StaffEntry from a <zone type="staff">: the bbox from the zone
 * coordinates, the staff grid from the <path> polylines (one per staff
 * line — generate_tei.py writes them in line order, top to bottom).
 */
function zoneToStaff(zone: Element): StaffEntry | null {
  const x0 = intAttr(zone, 'ulx');
  const y0 = intAttr(zone, 'uly');
  const x1 = intAttr(zone, 'lrx');
  const y1 = intAttr(zone, 'lry');
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;

  const lines = Array.from(zone.getElementsByTagNameNS(TEI_NS, 'path'))
    .map((path) => parsePoints(path.getAttribute('points')))
    .filter((points) => points.length > 0);
  if (lines.length === 0) return null;
  const sampleCount = Math.min(...lines.map((points) => points.length));

  const grid: StaffGridPoint[] = [];
  for (let j = 0; j < sampleCount; j++) {
    const x = lines[0][j].x;
    const y = lines.map((points) => (points[j] ? points[j].y : points[0].y));
    grid.push({ x, y });
  }
  return {
    bbox: [x0, y0, x1, y1],
    // same convention as the pipeline: lines per sub-staff (grand staff: 5)
    lineCount: Math.max(1, Math.floor(lines.length / 2)),
    grid,
  };
}

/**
 * Parse a homr page TEI document: staff zones become StaffEntry values and
 * the embedded <score-partwise> is serialized back into a standalone
 * MusicXML string for OSMD/playback. Returns null when the document carries
 * no staff geometry and no embedded score. OSMD requires an XML declaration
 * at the start of a loaded string, so it is re-emitted on extraction.
 */
export function parseTei(text: string): TeiScore | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  const zones = Array.from(doc.getElementsByTagNameNS(TEI_NS, 'zone')).filter(
    (zone) => zone.getAttribute('type') === 'staff',
  );
  const staves: StaffEntry[] = [];
  for (const zone of zones) {
    const staff = zoneToStaff(zone);
    if (staff) staves.push(staff);
  }

  // OMR run info: machine-readable on the homr application element
  // (generate_tei.py); optional for hand-made documents
  const omr: TeiOmr = {};
  for (const app of Array.from(doc.getElementsByTagNameNS(TEI_NS, 'application'))) {
    if (app.getAttribute('ident') !== 'homr') continue;
    const status = app.getAttribute('status');
    if (status) omr.status = status;
    const confidence = Number.parseFloat(app.getAttribute('confidence') ?? '');
    if (Number.isFinite(confidence)) omr.confidence = confidence;
  }

  // MusicXML is namespace-free (xmlns="" on the embedded root), so the
  // plain tag lookup finds it; serializing keeps the fragment in the same
  // namespace-free form OSMD and the playback parser expect.
  const scores = doc.getElementsByTagName('score-partwise');
  let musicxmlText: string | null = null;
  if (scores.length > 0) {
    musicxmlText = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(scores[0])}`;
  }

  if (staves.length === 0 && !musicxmlText) return null;
  return { staves, musicxmlText, omr };
}
