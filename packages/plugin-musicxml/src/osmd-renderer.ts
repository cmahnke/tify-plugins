import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { StaffEntry } from './note-map';

export interface ScorePiece {
  /** target rect in page pixel coordinates (includes pad for content beyond the staff lines) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** source rect in the OSMD svg's user units */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 'none' maps source onto target exactly; 'meet' letterboxes when the
   * aspect ratios diverge too much (avoids gross distortion). */
  fit: 'none' | 'xMidYMid meet';
  /** index of the OMR staff entry this piece is aligned to (-1 for the
   * whole-page fallback layout); the scan highlight uses this to follow the
   * played staff instead of assuming pieces match staff entries 1:1. */
  entry: number;
  /** sub-staff of the entry (1-based) the piece is aligned to */
  subStaff: 1 | 2;
}

export interface ScoreLayout {
  /** intrinsic OSMD svg size in user units */
  width: number;
  height: number;
  pieces: ScorePiece[];
  /** per MusicXML system: index of the OMR staff entry its first sub-staff
   * is aligned to (-1 when unknown). OMR may detect spurious staves, so this
   * is not the identity mapping. */
  systemEntry: number[];
}

interface Span {
  y0: number;
  y1: number;
}

interface Ink {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** OSMD page margins in user units (EngravingRules.Page{Left,Right}Margin × 10). */
const OSMD_H_MARGINS = 100;

function bboxOf(el: SVGGraphicsElement): Ink {
  const b = el.getBBox();
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}

interface StaffSeg extends Span {
  x0: number;
  x1: number;
}

/**
 * Collects the drawn staff line segments: horizontal strokes (height ≤ 2
 * user units, reasonably wide). Barlines/stems are too narrow, noteheads and
 * glyphs too tall, so this reliably yields exactly the staff lines.
 */
function collectStaffSegments(svg: SVGSVGElement): StaffSeg[] {
  const segs: StaffSeg[] = [];
  for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>('path, rect, line'))) {
    let b: DOMRect;
    try {
      b = el.getBBox();
    } catch {
      continue;
    }
    if (b.height > 2 || b.width < 50) continue;
    segs.push({ y0: b.y, y1: b.y + b.height, x0: b.x, x1: b.x + b.width });
  }
  return segs;
}

/**
 * Clusters staff line segments into sub-staffs (5 consecutive lines, ~1 staff
 * space apart) and returns their line spans plus horizontal extent, in
 * drawing order (top to bottom).
 */
function clusterSubStaffs(segs: StaffSeg[]): Array<Span & { x0: number; x1: number }> {
  const sorted = [...segs].sort((a, b) => a.y0 - b.y0);
  const clusters: Array<Span & { x0: number; x1: number }> = [];
  const spacing = 15; // > 1 staff space (1 unit = 10 px), < intra-staff gaps
  let cur: StaffSeg[] = [];
  let lastY = Number.NaN;
  const flush = (): void => {
    if (cur.length === 0) return;
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    for (const s of cur) {
      x0 = Math.min(x0, s.x0);
      x1 = Math.max(x1, s.x1);
    }
    clusters.push({
      y0: Math.min(...cur.map((s) => s.y0)),
      y1: Math.max(...cur.map((s) => s.y1)),
      x0,
      x1,
    });
    cur = [];
  };
  for (const s of sorted) {
    if (Number.isNaN(lastY) || s.y0 - lastY > spacing) flush();
    cur.push(s);
    lastY = s.y0;
  }
  flush();
  return clusters;
}

/** Split a staff's line Y positions into sub-staff chunks (grand staff = 2). */
function chunkLineIndices(ys: number[]): Array<[number, number]> {
  if (ys.length < 2) return [[0, ys.length - 1]];
  const diffs = ys.slice(1).map((v, i) => v - ys[i]);
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const chunks: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] > median * 1.6) {
      chunks.push([start, i]);
      start = i + 1;
    }
  }
  chunks.push([start, ys.length - 1]);
  return chunks;
}

/** Target sub-staff line span in page pixels (min/max over the warped grid). */
function chunkTargetY(entry: StaffEntry, chunk: [number, number]): Span | null {
  if (!entry.grid || entry.grid.length === 0) return null;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const pt of entry.grid) {
    const a = pt.y[chunk[0]];
    const b = pt.y[chunk[1]];
    if (a === undefined || b === undefined) return null;
    y0 = Math.min(y0, a);
    y1 = Math.max(y1, b);
  }
  return y1 > y0 ? { y0, y1 } : null;
}

/**
 * Drops invalid <chord/> elements from rest notes: OSMD builds a pitchless
 * chord note for them and crashes with "reading 'getHalfTone'".
 */
function sanitizeMusicXml(xmlText: string): string {
  return xmlText.replace(/<note(?:\s[^>]*)?>[\s\S]*?<\/note>/g, (note) => {
    if (!/<\s*rest/.test(note) || !/<\s*chord/.test(note)) return note;
    return note.replace(/<chord\s*\/>\s*/g, '');
  });
}

interface ScanChunk {
  /** target staff-line span in page pixels */
  target: Span;
  /** target horizontal span in page pixels (the owning staff entry's bbox) */
  targetX: { x0: number; x1: number };
  /** index of the owning staff entry within the page's staff list */
  entry: number;
  /** sub-staff of the entry this chunk spans (1-based) */
  subStaff: 1 | 2;
}

/**
 * Monotone assignment of OSMD sub-staffs (in y order) to scan chunks (in y
 * order): every sub-staff gets the next unused chunk, but chunks may be
 * skipped so spurious OMR detections (e.g. ruled illustrations) do not
 * break the mapping. The cost prefers pairs whose page-to-OSMD scale matches
 * the page median, since the scan's engraving scale is uniform; each skipped
 * chunk pays a fixed penalty.
 */
function alignSubStaffs(subStaffs: Span[], chunks: ScanChunk[]): Array<[number, number]> | null {
  const n = subStaffs.length;
  const m = chunks.length;
  if (n === 0 || m < n) return null;
  const hOsmd = subStaffs.map((s) => s.y1 - s.y0);
  const hChunk = chunks.map((s) => s.target.y1 - s.target.y0);
  const ratio = (i: number, e: number): number => hChunk[e] / hOsmd[i];

  const feas: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let e = i; e <= m - n + i; e++) feas.push(ratio(i, e));
  }
  feas.sort((a, b) => a - b);
  const scale = feas[Math.floor(feas.length / 2)] ?? Number.NaN;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const SKIP = 0.5;
  const pairCost = (i: number, e: number): number => {
    const v = Math.abs(Math.log(ratio(i, e) / scale));
    return Number.isFinite(v) ? Math.min(v, 3) : Number.POSITIVE_INFINITY;
  };

  // dp[i][e]: best cost of assigning sub-staffs 0..i with sub-staff i on
  // chunk e; back[i][e]: the chunk used by sub-staff i-1.
  const dp: number[][] = [];
  const back: number[][] = [];
  dp[0] = [];
  back[0] = [];
  for (let e = 0; e <= m - n; e++) {
    dp[0][e] = SKIP * e + pairCost(0, e);
    back[0][e] = -1;
  }
  for (let i = 1; i < n; i++) {
    dp[i] = [];
    back[i] = [];
    for (let e = i; e <= m - n + i; e++) {
      let best = Number.POSITIVE_INFINITY;
      let bestE = -1;
      for (let pe = i - 1; pe < e; pe++) {
        const c = dp[i - 1][pe] + SKIP * (e - pe - 1) + pairCost(i, e);
        if (c < best) {
          best = c;
          bestE = pe;
        }
      }
      dp[i][e] = best;
      back[i][e] = bestE;
    }
  }
  let endE = -1;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (let e = n - 1; e < m; e++) {
    const total = dp[n - 1][e] + SKIP * (m - 1 - e);
    if (total < bestTotal) {
      bestTotal = total;
      endE = e;
    }
  }
  if (endE < 0 || !Number.isFinite(bestTotal)) return null;
  const pairs: Array<[number, number]> = [];
  let e = endE;
  for (let i = n - 1; i >= 0; i--) {
    pairs[i] = [i, e];
    e = back[i][e];
    if (e < 0 && i > 0) return null;
  }
  return pairs;
}

/**
 * Assign every drawn element of the OSMD svg to the nearest band (by vertical
 * distance of the element's center to the band's line span) and return the
 * union ink bounding box per band.
 */
function clusterInk(svg: SVGSVGElement, bands: Span[]): Ink[] {
  const ink: Ink[] = bands.map(() => ({
    x0: Number.POSITIVE_INFINITY,
    y0: Number.POSITIVE_INFINITY,
    x1: Number.NEGATIVE_INFINITY,
    y1: Number.NEGATIVE_INFINITY,
  }));
  const graphic = new Set([
    'g',
    'path',
    'rect',
    'line',
    'text',
    'tspan',
    'polygon',
    'polyline',
    'ellipse',
    'circle',
  ]);
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'defs') continue;
      visit(child);
    }
    if (el === svg || !graphic.has(el.tagName)) return;
    let box: Ink;
    try {
      box = bboxOf(el as SVGGraphicsElement);
    } catch {
      return;
    }
    if (box.x1 - box.x0 <= 0 && box.y1 - box.y0 <= 0) return;
    const cy = (box.y0 + box.y1) / 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < bands.length; i++) {
      const d = cy < bands[i].y0 ? bands[i].y0 - cy : cy > bands[i].y1 ? cy - bands[i].y1 : 0;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    ink[best] = unionInk(ink[best], box);
  };
  visit(svg);
  return ink;
}

function unionInk(a: Ink, b: Ink): Ink {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

interface PieceGeometry {
  /** staff-line span in OSMD units */
  lines: Span;
  /** ink span used for the vertical pads (may extend beyond the staff lines) */
  ink: Ink;
  /** horizontal ink span of the whole system (shared by its sub-staffs) */
  sysInkX: { x0: number; x1: number };
  /** vertical bounds of the neighboring bands (pad caps) */
  boundAbove: number;
  boundBelow: number;
  /** target staff-line span in page pixels */
  target: Span;
  /** target horizontal span in page pixels */
  targetX: { x0: number; x1: number };
}

function pieceFromGeometry(g: PieceGeometry, scalesOut: number[]): ScorePiece | null {
  const { lines, ink, sysInkX, boundAbove, boundBelow, target, targetX } = g;
  if (!(lines.y1 > lines.y0) || !(target.y1 > target.y0) || !(targetX.x1 > targetX.x0)) return null;

  // Pads cover ink beyond the staff lines (slurs above, lyrics below) and are
  // capped by the distance to the neighboring band so pieces never overlap.
  // The pad fraction is applied to source and target alike, so the staff
  // lines still map exactly onto the scan's staff lines.
  const padTopCap = Math.max(0, (lines.y0 - boundAbove) * 0.45);
  const padBottomCap = Math.max(0, (boundBelow - lines.y1) * 0.45);
  const padTop = Math.max(0, Math.min(lines.y0 - ink.y0, padTopCap));
  const padBottom = Math.max(0, Math.min(ink.y1 - lines.y1, padBottomCap));

  const sw = sysInkX.x1 - sysInkX.x0;
  if (!(sw > 0)) return null;
  const scaleY = (target.y1 - target.y0) / (lines.y1 - lines.y0);
  const sx0 = sysInkX.x0;
  const sy0 = lines.y0 - padTop;
  const sh = lines.y1 - lines.y0 + padTop + padBottom;
  const ty0 = target.y0 - padTop * scaleY;
  const th = target.y1 - target.y0 + (padTop + padBottom) * scaleY;
  if (!(sh > 0) || !(th > 0)) return null;
  const scaleX = (targetX.x1 - targetX.x0) / sw;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;
  scalesOut.push(scaleY);

  // When the aspect ratios diverge too much, letterbox instead of distorting.
  const distorted = Math.abs(Math.log(scaleX / scaleY)) > 0.4;
  return {
    x: targetX.x0,
    y: ty0,
    width: targetX.x1 - targetX.x0,
    height: th,
    sx: sx0,
    sy: sy0,
    sw,
    sh,
    fit: distorted ? 'xMidYMid meet' : 'none',
    entry: 0,
    subStaff: 1,
  };
}

/**
 * Renders a page's MusicXML with OpenSheetMusicDisplay and provides a cursor
 * that highlights the currently-playing note on the rendered score.
 *
 * The score is rendered once into a hidden fixed-width container, then mapped
 * onto the scan: every OSMD system (or sub-staff of a grand staff system) is
 * affine-mapped onto the OMR-detected staff region of the scan, so the
 * rendered notation sits exactly on the recognized staves of the scan.
 */
export class OsmdRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private container: HTMLDivElement | null = null;
  private scoreSvg: SVGSVGElement | null = null;
  private layout: ScoreLayout | null = null;
  private scales: number[] = [];
  private lastIndex = -1;
  private disposed = false;

  /** The rendered OSMD svg (user units = OSMD layout space). */
  getScoreSvg(): SVGSVGElement | null {
    return this.scoreSvg;
  }

  /** Per-system/sub-staff source rects mapped onto the page staff regions. */
  getLayout(): ScoreLayout | null {
    return this.layout;
  }

  async render(xmlText: string, staves: StaffEntry[] = []): Promise<void> {
    // Two passes: the first measures the vertical scale between OSMD layout
    // and the scanned staves; the second re-renders at a container width that
    // makes the horizontal scale match, so glyphs are not stretched.
    const xml = sanitizeMusicXml(xmlText);
    let width = 1600;
    for (let pass = 0; pass < 2; pass++) {
      this.disposeInstance();
      await this.renderOnce(xml, width);
      this.layout = this.buildLayout(staves);
      const next = pass === 0 ? this.suggestWidth(staves) : null;
      if (next === null || Math.abs(next - width) < width * 0.12) break;
      width = next;
    }
  }

  /** Advance the cursor to highlight the note at the given timeline index. */
  highlightNote(index: number): void {
    if (!this.osmd || this.disposed) return;
    try {
      if (index < 0) {
        this.osmd.cursor.reset();
        this.lastIndex = -1;
        return;
      }
      if (index < this.lastIndex) {
        this.osmd.cursor.reset();
        this.lastIndex = -1;
      }
      const steps = index - this.lastIndex;
      for (let i = 0; i < steps; i++) {
        this.osmd.cursor.next();
      }
      this.osmd.cursor.show();
      this.lastIndex = index;
    } catch {
      // cursor navigation is best-effort
    }
  }

  clearHighlight(): void {
    if (!this.osmd || this.disposed) return;
    try {
      this.osmd.cursor.reset();
      this.lastIndex = -1;
    } catch {
      /* ignore */
    }
  }

  /**
   * Position of OSMD's playback cursor in the score svg's user units.
   * OSMD renders its cursor as an absolutely positioned <img> inside the
   * render container, so its pixel position must be converted with the
   * container-to-viewBox scale before the score pieces can map it onto the
   * scan. Returns null while the cursor is not on a note.
   */
  getCursorUserPos(): { x: number; y: number } | null {
    const container = this.container;
    const layout = this.layout;
    if (!this.osmd || !container || !layout) return null;
    const img = (this.osmd as unknown as { cursor?: { cursorElement?: HTMLImageElement } }).cursor
      ?.cursorElement;
    if (!img || img.style.visibility === 'hidden') return null;
    const left = parseFloat(img.style.left);
    const top = parseFloat(img.style.top);
    const w = container.offsetWidth;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !(w > 0)) return null;
    // The score svg keeps its aspect ratio and fills the container width, so
    // container pixels scale to svg user units with a single factor for both
    // axes (the container's height is 0 because its svg lives in <defs>).
    const factor = layout.width / w;
    return { x: left * factor, y: top * factor };
  }

  dispose(): void {
    this.disposed = true;
    this.disposeInstance();
  }

  private disposeInstance(): void {
    this.osmd = null;
    this.scoreSvg = null;
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  private async renderOnce(xmlText: string, width: number): Promise<void> {
    const container = document.createElement('div');
    // The container must have a real width for OSMD's layout (it reads
    // offsetWidth) but must stay invisible; visibility (not display:none)
    // keeps offsetWidth non-zero offscreen.
    container.style.cssText = `position:fixed;left:-99999px;top:0;width:${String(width)}px;visibility:hidden;`;
    // visibility:hidden already drops the render tree from the accessibility
    // tree; aria-hidden makes that intent explicit (lyrics/text in the score
    // must never reach screen readers).
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    this.container = container;

    const osmd = new OpenSheetMusicDisplay(container, {
      backend: 'svg',
      autoResize: false,
      // Honor <print new-system> so OSMD's systems correspond 1:1 to the
      // scanned staves instead of re-breaking lines by width.
      newSystemFromXML: true,
      // The scan's last system also spans the full staff width.
      stretchLastSystemLine: true,
      // The scan already shows title/credits; the overlay must not duplicate
      // them, and measure numbers do not exist in the engraving either.
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: false,
    });
    this.osmd = osmd;
    await osmd.load(xmlText);
    await osmd.render();
    this.scoreSvg = container.querySelector('svg');
  }

  /** Container width that makes the horizontal scale match the vertical one. */
  private suggestWidth(staves: StaffEntry[]): number | null {
    const meaningful = this.scales.filter((s) => Number.isFinite(s) && s > 0);
    if (meaningful.length === 0 || staves.length === 0) return null;
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    for (const s of staves) {
      x0 = Math.min(x0, s.bbox[0]);
      x1 = Math.max(x1, s.bbox[2]);
    }
    if (!(x1 > x0)) return null;
    const avg = meaningful.reduce((a, b) => a + b, 0) / meaningful.length;
    return Math.max(800, Math.min(12000, Math.round((x1 - x0) / avg + OSMD_H_MARGINS)));
  }

  private buildLayout(staves: StaffEntry[]): ScoreLayout | null {
    const svg = this.scoreSvg;
    if (!svg || !this.osmd) return null;
    const vb = svg.viewBox.baseVal;
    const width = vb.width || 1;
    const height = vb.height || 1;
    if (staves.length === 0) return null;

    const subStaffs = clusterSubStaffs(collectStaffSegments(svg));
    if (subStaffs.length === 0) return this.globalLayout(svg, staves, width, height);

    // Group the sub-staffs into systems using OSMD's layout model.
    type ModelSystem = { staffLines?: unknown[] };
    type ModelPage = { MusicSystems?: ModelSystem[] };
    const osmdLike = this.osmd as unknown as { graphic?: { MusicPages?: ModelPage[] } };
    const modelSystems = osmdLike.graphic?.MusicPages?.[0]?.MusicSystems ?? [];
    const counts = modelSystems.map((s) => (Array.isArray(s.staffLines) ? s.staffLines.length : 0));
    const total = counts.reduce((a, b) => a + b, 0);
    if (counts.length === 0 || total !== subStaffs.length) {
      return this.globalLayout(svg, staves, width, height);
    }

    const systems: Array<Span & { x0: number; x1: number }>[] = [];
    let k = 0;
    for (const n of counts) {
      systems.push(subStaffs.slice(k, k + n));
      k += n;
    }

    // Scan chunks: sub-staff line spans from the staff grids, flattened in
    // y-order. OMR may detect spurious staves, so the assignment below may
    // skip chunks instead of forcing a 1:1 match.
    const chunks: ScanChunk[] = [];
    for (const [entryIdx, entry] of staves.entries()) {
      const ys = entry.grid?.[0]?.y ?? [];
      const idxs = ys.length >= 2 ? chunkLineIndices(ys) : [];
      for (const idx of idxs) {
        const target = chunkTargetY(entry, idx);
        if (target)
          chunks.push({
            target,
            targetX: { x0: entry.bbox[0], x1: entry.bbox[2] },
            entry: entryIdx,
            subStaff: (idx[0] === 0 ? 1 : 2) as 1 | 2,
          });
      }
    }
    chunks.sort((a, b) => a.target.y0 - b.target.y0);

    const flat = systems.flat();
    const sysOf: number[] = [];
    const sysStart: number[] = [];
    systems.forEach((lines, si) => {
      sysStart.push(sysOf.length);
      for (let j = 0; j < lines.length; j++) sysOf.push(si);
    });
    const pairs = alignSubStaffs(flat, chunks);
    if (!pairs) return this.globalLayout(svg, staves, width, height);

    const ink = clusterInk(
      svg,
      flat.map((l) => ({ y0: l.y0, y1: l.y1 })),
    );
    const pieces: ScorePiece[] = [];
    this.scales = [];
    for (const [i, e] of pairs) {
      const si = sysOf[i];
      const sysLines = systems[si];
      const j = i - sysStart[si];
      // The drawn staff lines span the full system width; use them (not the
      // ink) as the horizontal source span so barlines line up with the scan.
      const piece = pieceFromGeometry(
        {
          lines: flat[i],
          ink: ink[i],
          sysInkX: {
            x0: Math.min(...sysLines.map((l) => l.x0)),
            x1: Math.max(...sysLines.map((l) => l.x1)),
          },
          boundAbove:
            j > 0
              ? sysLines[j - 1].y1
              : si > 0
                ? systems[si - 1][systems[si - 1].length - 1].y1
                : 0,
          boundBelow:
            j < sysLines.length - 1
              ? sysLines[j + 1].y0
              : si < systems.length - 1
                ? systems[si + 1][0].y0
                : height,
          target: chunks[e].target,
          targetX: chunks[e].targetX,
        },
        this.scales,
      );
      if (piece) {
        piece.entry = chunks[e].entry;
        piece.subStaff = chunks[e].subStaff;
        pieces.push(piece);
      }
    }
    if (pieces.length === 0) return this.globalLayout(svg, staves, width, height);
    const systemEntry = systems.map((_lines, si) => {
      const first = sysStart[si];
      const e = pairs.find(([osmdIdx]) => osmdIdx === first)?.[1];
      return e === undefined ? -1 : chunks[e].entry;
    });
    return { width, height, pieces, systemEntry };
  }

  private globalLayout(
    svg: SVGSVGElement,
    staves: StaffEntry[],
    width: number,
    height: number,
  ): ScoreLayout | null {
    void height;
    let box: Ink;
    try {
      box = bboxOf(svg);
    } catch {
      return null;
    }
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const s of staves) {
      x0 = Math.min(x0, s.bbox[0]);
      x1 = Math.max(x1, s.bbox[2]);
      y0 = Math.min(y0, s.bbox[1]);
      y1 = Math.max(y1, s.bbox[3]);
    }
    if (!(x1 > x0) || !(y1 > y0) || !(box.x1 > box.x0) || !(box.y1 > box.y0)) return null;
    this.scales = [(y1 - y0) / (box.y1 - box.y0)];
    return {
      width,
      height,
      pieces: [
        {
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          sx: box.x0,
          sy: box.y0,
          sw: box.x1 - box.x0,
          sh: box.y1 - box.y0,
          fit: 'xMidYMid meet',
          entry: -1,
          subStaff: 1,
        },
      ],
      systemEntry: [],
    };
  }
}
