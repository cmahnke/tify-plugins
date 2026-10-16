// MusicXML score plugin for TIFY.
//
// Renders a page's MusicXML notation (OpenSheetMusicDisplay) as an overlay
// aligned onto the scan, with Web Audio playback, tempo/track/instrument
// controls, and note/staff highlights that follow the performance.
//
// Data contract (per canvas): the score data comes from the homr pipeline's
// TEI document, discovered via the canvas `rendering` entries (format
// `application/tei+xml` or an `.tei.xml` id, resolved against the manifest
// URL) — the TEI carries the staff geometry (<zone type="staff">) and the
// embedded MusicXML in one document. Without a TEI the plain MusicXML
// rendering (format `application/vnd.recordare.musicxml+xml` or an
// `.musicxml` id) is used as a fallback: playback works, but nothing is
// mapped onto the scan (no aligned score, no staff regions). Without any
// score reference the panel reports that the page has no score; playback
// needs no image at all.
import type Tify from 'tify';
import {
  canvasesOf,
  createSidePanel,
  fetchText,
  getManifest,
  getVisiblePages,
  onPagesChange,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from '@projektemacher/tify-plugin-core';
import { createTranslator, registerPlugin } from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';
import { MusicPlayer, type Instrument, type TrackConfig } from './audio';
import { noteCoordOnStaff, type StaffEntry } from './note-map';
import { parseMusicXML, type MusicTimeline, type ParsedNote } from './musicxml-timeline';
import { OsmdRenderer, type ScorePiece } from './osmd-renderer';
import { parseTei } from './tei';
import { transportIconSvg, type TransportIcon } from './icons';
import './musicxml.css';

export interface RegionOverlayOptions {
  /** Show the staff regions on the scan (default false). */
  enabled?: boolean;
  /** Region fill/border color, hex '#rrggbb' (default '#ff6400'). */
  color?: string;
  /** Region fill/border alpha 0–1 (default 0.25); editable in the panel. */
  opacity?: number;
}

export interface MusicXmlOptions {
  /** Panel content host (sidecar unless docked into the viewer). */
  panelEl: HTMLElement;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  dock?: boolean | 'auto';
  /** Open the docked panel after init (default true). */
  autoOpen?: boolean;
  /** TEI override: absolute URL or raw TEI XML. Defaults to the canvas `rendering`. */
  tei?: string;
  /** MusicXML override: absolute URL or raw XML. Wins over the TEI-embedded score. */
  musicxml?: string;
  /** Render the aligned score onto the scan (default true, runtime toggle in the panel). */
  showScoreOverlay?: boolean;
  /** Staff band, note marker and playhead highlights (default true). */
  showHighlights?: boolean;
  /** Persistent staff-region overlay on the scan (default on, #ff6400, 25% fill). */
  regionOverlay?: RegionOverlayOptions;
}

export interface MusicXmlPlugin extends TifyPlugin {
  refresh(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MUSICXML_FORMAT = 'application/vnd.recordare.musicxml+xml';
const TEI_FORMAT = 'application/tei+xml';
const DEFAULT_REGION_COLOR = '#ff6400';
const DEFAULT_REGION_OPACITY = 0.25;

/** '#rrggbb' (with or without '#') -> [r, g, b]; null when malformed. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function rgbaString(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb.join(', ')}, ${alpha})`;
}

let scoreMountSeq = 0;

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Resolves once `el` is attached to the document. Overlays added while the
 * tile source is still loading only enter the DOM after OSD's first draw.
 */
function waitConnected(el: Element): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (el.isConnected) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Point on TIFY's bundled OpenSeadragon's prototype chain (see image-overlays). */
function makePoint(viewer: any, x: number, y: number): { x: number; y: number } | null {
  const center = viewer?.viewport?.getCenter?.();
  if (typeof center?.rotate !== 'function') return null;
  return Object.assign(Object.create(Object.getPrototypeOf(center)), { x, y });
}

/** Add a page-pixel-space element as a viewport overlay (after the image opens). */
function addViewportOverlay(
  viewer: any,
  element: Element,
  x: number,
  y: number,
  width: number,
  height: number,
): () => void {
  const place = (): void => {
    const tiledImage = viewer?.world?.getItemAt?.(0);
    if (typeof tiledImage?.imageToViewportRectangle !== 'function') return;
    const rect = tiledImage.imageToViewportRectangle(x, y, width, height);
    const location = makePoint(viewer, rect.x, rect.y);
    if (!location) return;
    try {
      viewer.addOverlay({ element, location, width: rect.width, height: rect.height });
    } catch {
      // Viewer may be gone during teardown.
    }
  };
  // Re-place on every open (TIFY re-opens on page changes); removed on teardown.
  const onOpen = (): void => place();
  if (viewer?.world?.getItemCount?.() > 0) {
    place();
  }
  viewer?.addHandler?.('open', onOpen);
  return () => {
    viewer?.removeHandler?.('open', onOpen);
    try {
      viewer?.removeOverlay?.(element);
    } catch {
      // Ignore teardown races.
    }
    element.remove();
  };
}

/**
 * Mounts the rendered OSMD score into the page-space overlay SVG: the OSMD
 * svg itself goes into <defs> (kept live so the playback cursor propagates),
 * and every mapped piece is drawn as a nested <svg> whose viewBox maps the
 * system's OSMD-space ink rect onto the staff region of the scan.
 */
function mountScore(root: SVGSVGElement, renderer: OsmdRenderer): void {
  const layout = renderer.getLayout();
  const src = renderer.getScoreSvg();
  if (!layout || !src || !root.isConnected) return;
  const id = `osmd-src-${String(++scoreMountSeq)}`;
  src.setAttribute('id', id);
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.appendChild(src);
  root.appendChild(defs);
  for (const piece of layout.pieces) {
    mountPiece(root, id, piece);
  }
}

function mountPiece(root: SVGSVGElement, srcId: string, piece: ScorePiece): void {
  const nested = svgEl('svg', {
    x: String(piece.x),
    y: String(piece.y),
    width: String(piece.width),
    height: String(piece.height),
    viewBox: `${String(piece.sx)} ${String(piece.sy)} ${String(piece.sw)} ${String(piece.sh)}`,
    preserveAspectRatio: piece.fit,
    class: 'score-system',
  });
  const bg = svgEl('rect', {
    x: String(piece.sx),
    y: String(piece.sy),
    width: String(piece.sw),
    height: String(piece.sh),
    class: 'score-system-bg',
  });
  const use = svgEl('use', { href: `#${srcId}` });
  nested.append(bg, use);
  root.appendChild(nested);
}

/**
 * Drops staff-highlight rects that no score piece covers: the score mapping
 * deliberately ignores spurious OMR detections, and a stray highlight over
 * an unaligned region would only read as a bug.
 */
function pruneUnmatchedRects(overlay: SVGSVGElement | null, pieces: ScorePiece[]): void {
  if (!overlay || pieces.length === 0) return;
  for (const rect of Array.from(overlay.querySelectorAll('rect'))) {
    const x = Number(rect.getAttribute('x') ?? 0);
    const y = Number(rect.getAttribute('y') ?? 0);
    const w = Number(rect.getAttribute('width') ?? 0);
    const h = Number(rect.getAttribute('height') ?? 0);
    const TOL = 4;
    const hit = pieces.some(
      (p) =>
        x < p.x + p.width + TOL &&
        x + w > p.x - TOL &&
        y < p.y + p.height + TOL &&
        y + h > p.y - TOL,
    );
    if (!hit) rect.remove();
  }
}

/**
 * Maps a position in the OSMD score svg's user units onto page pixel space
 * through a piece, honoring the letterboxing ('xMidYMid meet') of pieces
 * whose aspect ratio diverges from the scan's.
 */
function osmdToPage(piece: ScorePiece, pos: { x: number; y: number }): { x: number; y: number } {
  if (piece.fit === 'xMidYMid meet') {
    const scale = Math.min(piece.width / piece.sw, piece.height / piece.sh);
    const ox = (piece.width - piece.sw * scale) / 2;
    const oy = (piece.height - piece.sh * scale) / 2;
    return {
      x: piece.x + ox + (pos.x - piece.sx) * scale,
      y: piece.y + oy + (pos.y - piece.sy) * scale,
    };
  }
  return {
    x: piece.x + (pos.x - piece.sx) * (piece.width / piece.sw),
    y: piece.y + (pos.y - piece.sy) * (piece.height / piece.sh),
  };
}

interface PageScore {
  width: number;
  height: number;
  /** homr TEI document: staff geometry + embedded MusicXML */
  teiUrl: string | null;
  /** plain MusicXML fallback (score only, letterbox layout) */
  musicxmlUrl: string | null;
}

function resolveUrl(id: string | undefined, base: string): string | null {
  if (!id) return null;
  try {
    return new URL(id, base).toString();
  } catch {
    return null;
  }
}

/** First matching canvas `rendering` entry, resolved against the manifest URL. */
function renderingUrl(
  renderings: any[],
  manifestUrl: string,
  match: (id: string, format: string) => boolean,
): string | null {
  for (const rendering of renderings) {
    const id = typeof rendering === 'string' ? rendering : (rendering?.id ?? rendering?.['@id']);
    const format = typeof rendering === 'object' ? String(rendering?.format ?? '') : '';
    if (typeof id === 'string' && match(id, format)) return resolveUrl(id, manifestUrl);
  }
  return null;
}

/** Score references of one canvas (staff geometry comes from the TEI only). */
function pageScore(manifest: any, manifestUrl: string, page: number): PageScore | null {
  const canvas = canvasesOf(manifest)[page - 1];
  if (!canvas) return null;
  const width = Number(canvas?.width ?? 0);
  const height = Number(canvas?.height ?? 0);
  if (!(width > 0) || !(height > 0)) return null;

  const renderings = Array.isArray(canvas?.rendering)
    ? canvas.rendering
    : canvas?.rendering
      ? [canvas.rendering]
      : [];
  return {
    width,
    height,
    teiUrl: renderingUrl(
      renderings,
      manifestUrl,
      (id, format) => format === TEI_FORMAT || id.endsWith('.tei.xml'),
    ),
    musicxmlUrl: renderingUrl(
      renderings,
      manifestUrl,
      (id, format) => format === MUSICXML_FORMAT || id.endsWith('.musicxml'),
    ),
  };
}

export async function musicxmlPlugin(
  tify: Tify,
  options: MusicXmlOptions,
): Promise<MusicXmlPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  // Silence core's missing-plugin warning for the features this plugin owns.
  const unregister = registerPlugin('musicxml');
  const panel: SidePanel = createSidePanel(options.panelEl, t('Score'));
  const showScoreOverlay = options.showScoreOverlay ?? true;
  const showHighlights = options.showHighlights ?? true;

  const dock: DockHandle | null = dockPanel({
    tify,
    id: 'score',
    label: t('Score'),
    iconSvg: DOCK_ICONS.music,
    contentEl: options.panelEl,
    mode: options.dock,
  });
  if (options.autoOpen !== false) dock?.open();

  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let teardown: (() => void) | null = null;
  let drawToken = 0;

  const clear = (): void => {
    teardown?.();
    teardown = null;
    panel.body.innerHTML = '';
    panel.status.textContent = '';
  };

  const sync = async (token: number): Promise<void> => {
    if (disposed || token !== drawToken) return;
    clear();
    const pages = getVisiblePages(tify);
    if (pages.length === 0) return;
    try {
      const manifestUrl = String(tify.options?.manifestUrl ?? '');
      if (manifestUrl === '') {
        panel.status.textContent = t('No score on this page');
        return;
      }
      const manifest = await getManifest(tify);
      if (disposed || token !== drawToken) return;
      const pageData = pageScore(manifest, manifestUrl, pages[0]);
      // The TEI is one fetch carrying both the staff geometry and the score.
      const teiSource = options.tei ?? pageData?.teiUrl ?? null;
      let staves: StaffEntry[] = [];
      let teiMusicxml: string | null = null;
      if (teiSource) {
        panel.status.textContent = t('Loading score…');
        const trimmedTei = teiSource.trimStart();
        const teiText =
          trimmedTei.startsWith('<') || trimmedTei.startsWith('<?xml')
            ? teiSource
            : await fetchText(teiSource);
        if (disposed || token !== drawToken) return;
        const parsed = parseTei(teiText);
        if (parsed) {
          staves = parsed.staves;
          teiMusicxml = parsed.musicxmlText;
        }
      }
      // Explicit MusicXML override wins over the TEI-embedded copy; the loose
      // MusicXML rendering is the fallback when there is no usable TEI.
      const source = options.musicxml ?? teiMusicxml ?? pageData?.musicxmlUrl ?? null;
      if (!source) {
        panel.status.textContent = t('No score on this page');
        return;
      }
      panel.status.textContent = t('Loading score…');
      const trimmed = source.trimStart();
      const xmlText =
        trimmed.startsWith('<') || trimmed.startsWith('<?xml') ? source : await fetchText(source);
      if (disposed || token !== drawToken) return;
      if (xmlText.trim() === '') {
        panel.status.textContent = t('No score on this page');
        return;
      }
      setupScore(
        {
          width: pageData?.width ?? 0,
          height: pageData?.height ?? 0,
          staves,
        },
        xmlText,
        token,
      );
    } catch (error) {
      if (disposed || token !== drawToken) return;
      panel.status.textContent = t('Player unavailable: {error}', { error: String(error) });
    }
  };

  interface ScoreDims {
    width: number;
    height: number;
    staves: StaffEntry[];
  }

  const setupScore = (score: ScoreDims, xmlText: string, token: number): void => {
    const timeline: MusicTimeline = parseMusicXML(xmlText);
    const staffEntries = score.staves;
    const regionOpts = options.regionOverlay ?? {};

    // Transport buttons: icon on top, label below, centered as a row. The
    // tempo/track/instrument controls live in a second row beneath.
    const transport = document.createElement('div');
    transport.className = 'player-controls player-transport';

    const makeTransportButton = (icon: TransportIcon, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-btn';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'player-btn-label';
      labelSpan.textContent = label;
      btn.append(transportIconSvg(document, icon), labelSpan);
      return btn;
    };

    const playBtn = makeTransportButton('play', t('Play'));
    const pauseBtn = makeTransportButton('pause', t('Pause'));
    const stopBtn = makeTransportButton('stop', t('Stop'));
    transport.append(playBtn, pauseBtn, stopBtn);

    // Transport state machine (the player exposes only isPlaying; paused is
    // tracked locally). Disabled states replace silent no-op clicks so
    // keyboard and screen-reader users see which actions exist (WCAG
    // 2.1.1/4.1.2): stopped → only Play, playing → Pause/Stop,
    // paused → Play (resume) and Stop.
    let transportState: 'stopped' | 'playing' | 'paused' = 'stopped';
    const paintTransport = (): void => {
      playBtn.disabled = transportState === 'playing';
      pauseBtn.disabled = transportState !== 'playing';
      stopBtn.disabled = transportState === 'stopped';
    };
    paintTransport();

    const controls = document.createElement('div');
    controls.className = 'player-controls';

    const tempoLabel = document.createElement('span');
    tempoLabel.className = 'player-tempo';

    const tempo = document.createElement('input');
    tempo.type = 'range';
    tempo.min = '60';
    tempo.max = '180';
    tempo.value = '120';
    tempo.title = t('Playback tempo');
    tempo.setAttribute('aria-label', t('Playback tempo'));
    const paintTempo = (): void => {
      tempoLabel.textContent = t('Tempo: {value}', { value: tempo.value });
    };
    paintTempo();
    controls.append(tempoLabel, tempo);

    // One row per staff found in the score: a playing checkbox (all on by
    // default — the page sounds as written) plus that staff's own
    // instrument. The audio engine schedules any number of tracks; the
    // OSMD cursor follows the lowest-numbered playing staff.
    const presentStaffs = [...new Set(timeline.notes.map((n) => n.staff))].sort((a, b) => a - b);
    const selectedStaves = new Set<number>(presentStaffs);
    const staffInstruments = new Map<number, Instrument>();
    const primaryStaff = (): number => [...selectedStaves].sort((a, b) => a - b)[0] ?? 1;

    const makeInstrumentSelect = (): HTMLSelectElement => {
      const select = document.createElement('select');
      select.className = 'player-instrument';
      // Static literal keys so the i18n coverage check sees every string.
      const labels: Array<[Instrument, string]> = [
        ['piano', t('Piano')],
        ['organ', t('Organ')],
        ['strings', t('Strings')],
        ['flute', t('Flute')],
        ['synth', t('Synth')],
      ];
      for (const [id, label] of labels) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = label;
        select.appendChild(opt);
      }
      return select;
    };

    const staffRows: HTMLDivElement[] = [];
    for (const staff of presentStaffs) {
      const row = document.createElement('div');
      row.className = 'player-staff-row';
      row.dataset.staff = String(staff);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'player-staff-toggle';
      box.id = `player-staff-${String(staff)}`;
      box.checked = true;
      box.title = t('Play this staff');
      box.setAttribute('aria-label', t('Play this staff'));
      const label = document.createElement('label');
      label.className = 'player-tempo';
      label.htmlFor = box.id;
      label.textContent = t('Staff {n}', { n: staff });
      const instrument = makeInstrumentSelect();
      instrument.title = t('Instrument for this staff');
      instrument.setAttribute('aria-label', t('Instrument for this staff'));
      instrument.addEventListener('change', () => {
        staffInstruments.set(staff, instrument.value as Instrument);
        applyTracks();
      });
      box.addEventListener('change', () => {
        if (box.checked) selectedStaves.add(staff);
        else selectedStaves.delete(staff);
        applyTracks();
      });
      row.append(box, label, instrument);
      staffRows.push(row);
    }

    // Region overlay state: one persistent rect per detected staff region,
    // filled and outlined with a configurable rgba color, styled live by the
    // panel's rgba selector (added to the DOM below). Off by default.
    let showRegions = regionOpts.enabled ?? false;
    let regionRgb = hexToRgb(regionOpts.color ?? DEFAULT_REGION_COLOR) ?? [255, 100, 0];
    let regionAlpha = regionOpts.opacity ?? DEFAULT_REGION_OPACITY;
    let regionRgba = rgbaString(regionRgb, regionAlpha);
    const regionSvg =
      staffEntries.length > 0 && score.width > 0 && score.height > 0
        ? document.createElementNS(SVG_NS, 'svg')
        : null;
    if (regionSvg) {
      regionSvg.setAttribute('viewBox', `0 0 ${String(score.width)} ${String(score.height)}`);
      regionSvg.classList.add('staff-overlay', 'region-overlay');
      // Purely decorative visualization, driven by the panel controls.
      regionSvg.setAttribute('aria-hidden', 'true');
      for (const staff of staffEntries) {
        const [x0, y0, x1, y1] = staff.bbox;
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('class', 'staff-region');
        rect.setAttribute('x', String(x0));
        rect.setAttribute('y', String(y0));
        rect.setAttribute('width', String(Math.max(0, x1 - x0)));
        rect.setAttribute('height', String(Math.max(0, y1 - y0)));
        rect.setAttribute('fill', regionRgba);
        rect.setAttribute('stroke', regionRgba);
        rect.setAttribute('stroke-width', '3');
        regionSvg.appendChild(rect);
      }
    }
    const applyRegionStyle = (): void => {
      if (!regionSvg) return;
      for (const rect of Array.from(regionSvg.querySelectorAll('rect'))) {
        rect.setAttribute('fill', regionRgba);
        rect.setAttribute('stroke', regionRgba);
      }
    };
    const applyRegionVisibility = (): void => {
      if (!regionSvg) return;
      for (const rect of Array.from(regionSvg.querySelectorAll('rect'))) {
        rect.setAttribute('visibility', showRegions ? 'visible' : 'hidden');
      }
    };

    let regionBox: HTMLInputElement | null = null;
    let togglesRow: HTMLDivElement | null = null;
    if (regionSvg) {
      // Toggles row: Score + Regions switches plus the composite rgba
      // selector (native color picker for the RGB part with an integrated
      // alpha slider), centered like the transport row.
      togglesRow = document.createElement('div');
      togglesRow.className = 'player-controls region-controls';

      const scoreBox = document.createElement('input');
      scoreBox.type = 'checkbox';
      scoreBox.className = 'player-score';
      scoreBox.id = 'player-score-toggle';
      scoreBox.checked = showScoreOverlay;
      scoreBox.title = t('Show the rendered score on the scan');
      scoreBox.setAttribute('aria-label', t('Show the rendered score on the scan'));
      const scoreLabel = document.createElement('label');
      scoreLabel.className = 'player-tempo';
      scoreLabel.htmlFor = 'player-score-toggle';
      scoreLabel.textContent = t('Score');
      togglesRow.append(scoreLabel, scoreBox);

      const regionLabel = document.createElement('label');
      regionLabel.className = 'player-tempo';
      regionLabel.htmlFor = 'player-region-toggle';
      regionLabel.textContent = t('Regions');
      regionBox = document.createElement('input');
      regionBox.type = 'checkbox';
      regionBox.className = 'player-regions';
      regionBox.id = 'player-region-toggle';
      regionBox.checked = showRegions;
      regionBox.title = t('Show the staff regions on the scan');
      regionBox.setAttribute('aria-label', t('Show the staff regions on the scan'));

      const rgba = document.createElement('span');
      rgba.className = 'player-region-rgba';
      rgba.title = t('Region color and opacity');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'player-region-color';
      colorInput.value = rgbToHex(regionRgb);
      colorInput.setAttribute('aria-label', t('Region color and opacity'));
      const alphaWrap = document.createElement('span');
      alphaWrap.className = 'player-region-alpha-wrap';
      const alphaInput = document.createElement('input');
      alphaInput.type = 'range';
      alphaInput.className = 'player-region-alpha';
      alphaInput.min = '0';
      alphaInput.max = '100';
      alphaInput.step = '5';
      alphaInput.value = String(Math.round(regionAlpha * 100));
      alphaInput.setAttribute('aria-label', t('Opacity'));
      alphaInput.title = t('Opacity');
      // Speak the value as a percentage, matching the visible readout.
      const paintAlphaText = (): void => {
        alphaInput.setAttribute('aria-valuetext', `${alphaInput.value}%`);
      };
      paintAlphaText();
      // JS-positioned current-position marker (independent of native range
      // thumb styling quirks) plus a numeric readout.
      const alphaIndicator = document.createElement('span');
      alphaIndicator.className = 'player-region-alpha-indicator';
      const alphaValue = document.createElement('span');
      alphaValue.className = 'player-region-alpha-value';
      alphaWrap.append(alphaInput, alphaIndicator);
      rgba.append(colorInput, alphaWrap, alphaValue);
      togglesRow.append(regionLabel, regionBox, rgba);

      const paintAlpha = (): void => {
        const pct = Math.round(regionAlpha * 100);
        rgba.style.setProperty('--region-alpha-pos', `${String(pct)}%`);
        rgba.style.setProperty('--region-rgb-full', `rgb(${regionRgb.join(', ')})`);
        alphaValue.textContent = `${String(pct)}%`;
      };
      const updateRgba = (): void => {
        regionRgba = rgbaString(regionRgb, regionAlpha);
        paintAlpha();
        applyRegionStyle();
      };
      regionBox.addEventListener('change', () => {
        showRegions = regionBox?.checked ?? false;
        applyRegionVisibility();
      });
      colorInput.addEventListener('input', () => {
        regionRgb = hexToRgb(colorInput.value) ?? regionRgb;
        updateRgba();
      });
      alphaInput.addEventListener('input', () => {
        regionAlpha = (Number.parseInt(alphaInput.value, 10) || 0) / 100;
        paintAlphaText();
        updateRgba();
      });
      // seed the indicator and track gradient with the initial color
      updateRgba();
      applyRegionVisibility();

      scoreBox.addEventListener('change', () => {
        showScore = scoreBox.checked;
        if (showScore) {
          ensureRendered();
          updateScoreOverlay();
        } else if (scoreOverlayAdded && removeScoreOverlay) {
          removeScoreOverlay();
          removeScoreOverlay = null;
          scoreOverlayAdded = false;
        }
      });
    }

    panel.body.append(transport);
    panel.body.append(controls);
    for (const row of staffRows) panel.body.append(row);
    if (togglesRow) panel.body.append(togglesRow);

    // The rendered score lives in a page-pixel-space SVG overlay, so
    // OpenSeadragon scales it with pan/zoom. After OSMD renders, every system
    // (or sub-staff of a grand staff system) is affine-mapped onto the
    // detected staff region of the scan. The render keeps running while
    // anything consumes its alignment data (piece rects, system-entry
    // mapping, cursor position for the playhead); the rendered overlay
    // itself is only mounted while the Score toggle is on.
    const needsOsmd = showScoreOverlay || showHighlights;
    const scoreSvg =
      score.width > 0 && score.height > 0 ? document.createElementNS(SVG_NS, 'svg') : null;
    if (scoreSvg) {
      scoreSvg.setAttribute('viewBox', `0 0 ${String(score.width)} ${String(score.height)}`);
      scoreSvg.classList.add('staff-overlay', 'score-overlay');
      // Visual mirror of the score (the panel carries the semantics).
      scoreSvg.setAttribute('aria-hidden', 'true');
    }

    const overlaySvg: SVGSVGElement | null =
      showHighlights && score.width > 0 && score.height > 0
        ? document.createElementNS(SVG_NS, 'svg')
        : null;
    if (overlaySvg) {
      overlaySvg.setAttribute('viewBox', `0 0 ${String(score.width)} ${String(score.height)}`);
      overlaySvg.classList.add('staff-overlay');
      // Decorative playback highlights (playhead, note marker).
      overlaySvg.setAttribute('aria-hidden', 'true');
    }

    const renderer = new OsmdRenderer();
    const viewer = tify.viewer;
    const removeOverlays: Array<() => void> = [];

    // The score content is mounted at most once; the Score toggle only
    // adds/removes the overlay itself.
    let showScore = showScoreOverlay;
    let scoreOverlayAdded = false;
    let scoreContentMounted = false;
    let removeScoreOverlay: (() => void) | null = null;
    const updateScoreOverlay = (): void => {
      // Without a layout (no staff data to align to) there is nothing to
      // show — the overlay stays unmounted.
      if (!scoreSvg || !showScore || !renderer.getLayout()) return;
      if (!scoreOverlayAdded) {
        removeScoreOverlay = addViewportOverlay(viewer, scoreSvg, 0, 0, score.width, score.height);
        scoreOverlayAdded = true;
      }
      if (!scoreContentMounted) {
        void waitConnected(scoreSvg)
          .catch(() => undefined)
          .then(() => {
            if (disposed || token !== drawToken || scoreContentMounted || !showScore) return;
            mountScore(scoreSvg, renderer);
            scoreContentMounted = true;
          });
      }
    };
    let rendered: Promise<void> | null = null;
    const ensureRendered = (): void => {
      if (rendered) return;
      rendered = renderer.render(xmlText, staffEntries);
      void rendered
        .then(() => {
          if (disposed || token !== drawToken) return;
          updateScoreOverlay();
          pruneUnmatchedRects(overlaySvg, renderer.getLayout()?.pieces ?? []);
        })
        .catch((error: unknown) => {
          console.error('OSMD render failed:', error);
        });
    };
    if (needsOsmd) ensureRendered();

    const mountOverlays = (): void => {
      if (disposed || token !== drawToken) return;
      if (score.width <= 0 || score.height <= 0) return;
      if (overlaySvg) {
        removeOverlays.push(
          addViewportOverlay(viewer, overlaySvg, 0, 0, score.width, score.height),
        );
      }
      if (regionSvg) {
        removeOverlays.push(addViewportOverlay(viewer, regionSvg, 0, 0, score.width, score.height));
      }
    };
    mountOverlays();

    const player = new MusicPlayer(timeline);

    const trackConfigs = (): TrackConfig[] =>
      [...selectedStaves]
        .sort((a, b) => a - b)
        .map((staff) => ({ staff, instrument: staffInstruments.get(staff) ?? 'piano' }));
    player.setTracks(trackConfigs());

    // Maps an index into timeline.notes to its position within the primary
    // track (the lowest-numbered playing staff; -1 for other staves), so the
    // score cursor follows the primary track only.
    let trackIndex: Int32Array = new Int32Array(0);
    function rebuildTrackIndex(): void {
      const primary = primaryStaff();
      trackIndex = new Int32Array(timeline.notes.length);
      let k = 0;
      for (let i = 0; i < timeline.notes.length; i++) {
        trackIndex[i] = timeline.notes[i].staff === primary ? k++ : -1;
      }
    }
    rebuildTrackIndex();
    void trackIndex;

    // OSMD's playback cursor advances one voice entry (onset) per step —
    // including rests, which are not in timeline.notes. Compute the number of
    // onsets of the played staff strictly before a note, in performance order.
    function osmdStepsBefore(note: ParsedNote, staff: number): number {
      let k = 0;
      for (const m of timeline.measures) {
        if (m.number === note.measureNumber && m.system === note.system) {
          const onsets = new Set<number>();
          for (const n of m.notes) {
            if (n.staff === staff && !n.grace) onsets.add(n.beatStart);
          }
          const sorted = [...onsets].sort((a, b) => a - b);
          return k + sorted.filter((o) => o < note.beatStart).length;
        }
        const onsets = new Set<number>();
        for (const n of m.notes) {
          if (n.staff === staff && !n.grace) onsets.add(n.beatStart);
        }
        k += onsets.size;
      }
      return k;
    }

    interface HighlightSet {
      staffRect: SVGRectElement | null;
      noteMarker: SVGCircleElement | null;
      posLine: SVGLineElement | null;
    }
    const highlightSets = new Map<number, HighlightSet>();
    function highlightsFor(staff: number): HighlightSet {
      let set = highlightSets.get(staff);
      if (!set) {
        set = { staffRect: null, noteMarker: null, posLine: null };
        highlightSets.set(staff, set);
      }
      return set;
    }

    function clearHighlights(): void {
      for (const set of highlightSets.values()) {
        if (set.staffRect) {
          set.staffRect.setAttribute('visibility', 'hidden');
          set.staffRect.setAttribute('width', '0');
          set.staffRect.setAttribute('height', '0');
        }
        if (set.noteMarker) set.noteMarker.setAttribute('visibility', 'hidden');
        if (set.posLine) set.posLine.setAttribute('visibility', 'hidden');
      }
    }

    /** The staff entry a MusicXML system was aligned to (-1 when unknown). */
    function entryForSystem(system: number): number {
      const layout = renderer.getLayout();
      if (!layout) return system;
      return layout.systemEntry[system] ?? -1;
    }

    function pieceFor(entry: number, staff: number): ScorePiece | null {
      const pieces = renderer.getLayout()?.pieces ?? [];
      return (
        pieces.find((p) => p.entry === entry && p.subStaff === staff) ??
        pieces.find((p) => p.entry === entry) ??
        null
      );
    }

    function highlightStaff(system: number, staff: number): void {
      if (!overlaySvg || !showHighlights) return;
      const set = highlightsFor(staff);
      const entry = entryForSystem(system);
      // Prefer the aligned piece rect: it marks exactly the sub-staff region
      // the score was mapped to, not the whole (possibly two-staff) entry.
      const piece = entry >= 0 ? pieceFor(entry, staff) : null;
      let box: [number, number, number, number] | null = piece
        ? [piece.x, piece.y, piece.x + piece.width, piece.y + piece.height]
        : null;
      if (!box) {
        const st = staffEntries[entry >= 0 ? entry : system];
        box = st ? st.bbox : null;
      }
      if (!box) {
        clearHighlights();
        return;
      }
      const [x0, y0, x1, y1] = box;
      if (!set.staffRect) {
        set.staffRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        set.staffRect.setAttribute('class', 'staff-current');
        set.staffRect.setAttribute('visibility', 'hidden');
        overlaySvg.appendChild(set.staffRect);
      }
      set.staffRect.setAttribute('x', String(x0));
      set.staffRect.setAttribute('y', String(y0));
      set.staffRect.setAttribute('width', String(x1 - x0));
      set.staffRect.setAttribute('height', String(y1 - y0));
      set.staffRect.setAttribute('visibility', 'visible');
      // The position line spans the current staff region; its extent is set
      // per note in highlightNote (a bold vertical playhead).
      if (!set.posLine) {
        set.posLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        set.posLine.setAttribute('class', 'play-pos');
        set.posLine.setAttribute('visibility', 'hidden');
        overlaySvg.appendChild(set.posLine);
      }
      set.posLine.setAttribute('x1', String(x0));
      set.posLine.setAttribute('x2', String(x0));
      set.posLine.setAttribute('y1', String(y0));
      set.posLine.setAttribute('y2', String(y1));
      set.posLine.setAttribute('stroke-width', String(Math.max(6, (y1 - y0) * 0.1)));
    }

    function highlightNote(index: number): void {
      const note = timeline.notes[index];
      if (!note) return;
      highlightStaff(note.system, note.staff);
      if (!overlaySvg) return;
      const set = highlightsFor(note.staff);
      const entry = entryForSystem(note.system);
      const coord = noteCoordOnStaff(
        timeline,
        note,
        staffEntries[entry >= 0 ? entry : note.system],
      );
      if (!coord) return;
      // Refine the marker's x with OSMD's playback cursor position when it is
      // available and plausibly inside the aligned piece: the beat-proportional
      // fallback drifts from the actual note positions, but a grossly diverging
      // cursor (e.g. when OSMD's voice-entry order differs) would be worse.
      let x = coord.x;
      const piece = entry >= 0 ? pieceFor(entry, note.staff) : null;
      const cursor = renderer.getCursorUserPos();
      if (piece && cursor && cursor.x >= piece.sx - 10 && cursor.x <= piece.sx + piece.sw + 10) {
        const refined = osmdToPage(piece, cursor).x;
        if (Math.abs(refined - coord.x) < piece.width * 0.2) x = refined;
      }
      if (!set.noteMarker) {
        set.noteMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        set.noteMarker.setAttribute('class', 'note-marker');
        set.noteMarker.setAttribute('visibility', 'hidden');
        overlaySvg.appendChild(set.noteMarker);
      }
      set.noteMarker.setAttribute('r', String(coord.r));
      set.noteMarker.setAttribute('cx', String(x));
      set.noteMarker.setAttribute('cy', String(coord.y));
      set.noteMarker.setAttribute('stroke-width', String(Math.max(4, coord.unit * 0.3)));
      set.noteMarker.setAttribute('visibility', 'visible');
      // A bold vertical playhead at the same x: at fit zoom the page is shown
      // at a fraction of its pixel size, so a note-sized dot alone is nearly
      // invisible — the line carries the position.
      if (set.posLine) {
        set.posLine.setAttribute('x1', String(x));
        set.posLine.setAttribute('x2', String(x));
        set.posLine.setAttribute('visibility', 'visible');
      }
    }

    player.setCallbacks({
      onNote: (note, index) => {
        if (!showHighlights) return;
        // Each playing staff drives its own highlight set, so multi-track
        // playback shows the current position on every playing staff; notes
        // of muted staves are ignored. OSMD's single cursor still follows
        // the primary (lowest-numbered playing) staff only.
        if (!selectedStaves.has(note.staff)) return;
        if (note.staff === primaryStaff()) {
          // Advance the OSMD cursor first so the marker reads the fresh position.
          renderer.highlightNote(osmdStepsBefore(note, primaryStaff()));
        }
        highlightNote(index);
      },
      onEnd: () => {
        clearHighlights();
        renderer.clearHighlight();
        transportState = 'stopped';
        paintTransport();
      },
    });

    function applyTracks(): void {
      player.setTracks(trackConfigs());
      rebuildTrackIndex();
      renderer.clearHighlight();
      if (player.isPlaying) {
        player.stop();
        player.play();
      }
    }

    playBtn.addEventListener('click', () => {
      if (player.isPlaying) return;
      player.setTempo(parseInt(tempo.value, 10) || 120);
      player.play();
      transportState = 'playing';
      paintTransport();
    });

    pauseBtn.addEventListener('click', () => {
      if (!player.isPlaying) return;
      player.pause();
      transportState = 'paused';
      paintTransport();
    });

    stopBtn.addEventListener('click', () => {
      if (transportState === 'stopped') return;
      player.stop();
      clearHighlights();
      renderer.clearHighlight();
      transportState = 'stopped';
      paintTransport();
    });

    tempo.addEventListener('input', () => {
      player.setTempo(parseInt(tempo.value, 10) || 120);
      paintTempo();
    });

    panel.status.textContent = '';
    teardown = () => {
      player.dispose();
      renderer.dispose();
      for (const remove of removeOverlays) remove();
      removeScoreOverlay?.();
      scoreSvg?.remove();
      overlaySvg?.remove();
      regionSvg?.remove();
    };
  };

  const refresh = (): void => {
    if (disposed) return;
    drawToken += 1;
    void sync(drawToken);
  };

  unsubscribe = onPagesChange(tify, refresh);
  drawToken += 1;
  await sync(drawToken);

  return {
    refresh,
    destroy() {
      disposed = true;
      unregister();
      drawToken += 1;
      unsubscribe?.();
      dock?.destroy();
      clear();
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
