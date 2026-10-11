// Image-overlays plugin: OpenSeadragon overlays on top of TIFY.
//
// Two modes, kept in sync with page changes (overlays are per-TiledImage, so
// they must be re-added whenever TIFY opens new pages):
// - TEI mode (default): word/line boxes from a TEI transcription referenced
//   page-level via canvas `seeAlso` (see tei.ts). Display-only.
// - Demo markers: labelled markers advancing the page on click, used when
//   TEI is disabled or no TEI/boxes are found (set `tei: false` to force).
//
// NOTE on geometry: TIFY bundles its own OpenSeadragon, so overlay locations
// must be built from the viewer's own classes (see pointCtor below) —
// instances from a separately installed `openseadragon` copy fail the
// viewer-internal checks. TIFY's OSD build also resolves every overlay
// location through `pixelFromPoint()`, which requires a Point: rectangles
// are expressed as a top-left Point plus viewport-unit width/height.
import type Tify from 'tify';
import {
  createSidePanel,
  getManifest,
  getPages,
  onPagesChange,
  waitReady,
} from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';
import { createTranslator } from '@projektemacher/tify-plugin-core';
import type { SidePanel, TifyPlugin } from '@projektemacher/tify-plugin-core';
import { fetchTeiPageCached, type TeiOptions, type TeiWordBox } from './tei';

export interface ImageOverlaysOptions {
  /** Number of demo markers spread across the visible image. */
  markers?: number;
  /** TEI word boxes; `false` disables TEI and always shows demo markers. */
  tei?: false | TeiOptions;
  /** Host element for the overlay controls panel. Omit for overlay-only mode. */
  panelEl?: HTMLElement | null;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock. Ignored without panelEl.
   */
  dock?: boolean | 'auto';
  /** Open the docked panel after init (default true). */
  autoOpen?: boolean;
}

/** `#rrggbb` (or `#rgb`) plus alpha as an `rgba()` string. */
function rgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function imageOverlaysPlugin(
  tify: Tify,
  options: ImageOverlaysOptions = {},
): Promise<TifyPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  const count = options.markers ?? 3;
  const teiOpts = options.tei === false ? null : (options.tei ?? {});
  const panel: SidePanel | null = options.panelEl
    ? createSidePanel(options.panelEl, t('Overlays'))
    : null;
  const dock: DockHandle | null = options.panelEl
    ? dockPanel({
        tify,
        id: 'overlays',
        label: t('Overlays'),
        iconSvg: DOCK_ICONS.image,
        contentEl: options.panelEl,
        mode: options.dock,
      })
    : null;
  if (options.autoOpen !== false) dock?.open();
  if (panel) panel.status.textContent = t('Loading…');
  const elements: HTMLElement[] = [];
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let drawToken = 0;

  const clear = (): void => {
    try {
      tify.viewer?.clearOverlays?.();
    } catch {
      // Viewer may be gone during teardown.
    }
    for (const element of elements) element.remove();
    elements.length = 0;
    selected = null;
  };

  // Sidebar-controlled rendering state. Applied to every overlay at draw
  // time and re-applied to live elements when a control changes.
  let showAnnotations = true;
  let showOutlines = true;
  let fillColor = '#0b5fff';
  let fillOpacity = 0.12;
  let selected: { box: TeiWordBox; element: HTMLElement } | null = null;
  let pageHasBoxes = false;
  let readout: HTMLElement | null = null;

  const renderReadout = (): void => {
    if (!panel || !readout || disposed) return;
    readout.textContent = selected
      ? t('Selected: {word}', { word: selected.box.text })
      : pageHasBoxes
        ? t('Click a word box to show its text.')
        : t('No word boxes on this page.');
  };

  const applyWordStyle = (element: HTMLElement): void => {
    element.style.backgroundColor = rgba(fillColor, fillOpacity);
    element.classList.toggle('no-frame', !showOutlines);
    element.classList.toggle('is-hidden', !showAnnotations);
  };

  const restyle = (): void => {
    for (const element of elements) {
      if (element.classList.contains('tify-plugin-tei-word')) applyWordStyle(element);
      else element.classList.toggle('is-hidden', !showAnnotations);
    }
  };

  const select = (box: TeiWordBox, element: HTMLElement): void => {
    if (selected && selected.element === element) {
      element.classList.remove('is-selected');
      selected = null;
    } else {
      selected?.element.classList.remove('is-selected');
      element.classList.add('is-selected');
      selected = { box, element };
    }
    renderReadout();
  };

  /**
   * Tap (not drag) activation for overlays: the OSD canvas captures the
   * pointer stream for drag detection, so a DOM `click` never fires for
   * pointer input on overlays — pair pointerdown with a nearby pointerup
   * instead (drag-safe); keydown covers keyboard activation.
   */
  const onTap = (element: HTMLElement, handler: () => void): void => {
    element.addEventListener('pointerdown', (event) => {
      const startX = event.clientX;
      const startY = event.clientY;
      const onUp = (up: PointerEvent): void => {
        cleanup();
        if (Math.hypot(up.clientX - startX, up.clientY - startY) < 5) handler();
      };
      const onCancel = (): void => cleanup();
      const cleanup = (): void => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler();
      }
    });
  };

  if (panel) {
    const controls = document.createElement('div');
    controls.className = 'tify-plugin-controls';
    const layerLabel = document.createElement('label');
    const layerToggle = document.createElement('input');
    layerToggle.type = 'checkbox';
    layerToggle.checked = true;
    layerLabel.append(layerToggle, ' ', t('Show annotations'));
    layerToggle.addEventListener('change', () => {
      showAnnotations = layerToggle.checked;
      restyle();
    });
    const frameLabel = document.createElement('label');
    const frameToggle = document.createElement('input');
    frameToggle.type = 'checkbox';
    frameToggle.checked = true;
    frameLabel.append(frameToggle, ' ', t('Show outlines'));
    frameToggle.addEventListener('change', () => {
      showOutlines = frameToggle.checked;
      restyle();
    });
    const colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    const colorName = document.createElement('span');
    colorName.textContent = t('Fill color');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = fillColor;
    colorInput.setAttribute('aria-label', t('Fill color'));
    colorRow.append(colorName, colorInput);
    colorInput.addEventListener('input', () => {
      fillColor = colorInput.value;
      restyle();
    });
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.05';
    opacityInput.value = String(fillOpacity);
    opacityInput.setAttribute('aria-label', t('Fill opacity'));
    colorRow.append(opacityInput);
    opacityInput.addEventListener('input', () => {
      fillOpacity = Number(opacityInput.value);
      restyle();
    });
    controls.append(layerLabel, frameLabel, colorRow);
    readout = document.createElement('p');
    readout.className = 'tify-plugin-note';
    panel.body.append(controls, readout);
    renderReadout();
  }

  /**
   * Point on TIFY's bundled OpenSeadragon's prototype chain. The viewer's
   * returned geometry carries working methods but no usable constructor
   * (minified classes behind reactive proxies), so clone its prototype
   * instead of calling one. Instances from a separately installed npm
   * `openseadragon` copy fail the viewer-internal checks — never import one.
   */
  const makePoint = (viewer: any, x: number, y: number): { x: number; y: number } | null => {
    const center = viewer?.viewport?.getCenter?.();
    if (typeof center?.rotate !== 'function') return null;
    return Object.assign(Object.create(Object.getPrototypeOf(center)), { x, y });
  };

  const drawMarkers = (pages: number[]): void => {
    const viewer = tify.viewer;
    if (!viewer) return;
    // Demo markers at fractional positions of the first visible image; the
    // button keeps its natural size (no width/height override).
    const advance = (): void => {
      tify.setPage(pages[0] + 1);
    };
    for (let index = 0; index < count; index += 1) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'tify-plugin-marker';
      element.textContent = `P${pages[0]}·${index + 1}`;
      element.title = t('Demo marker {index} on page {page} (click to advance)', {
        index: index + 1,
        page: pages[0],
      });
      element.addEventListener('click', advance);
      // The OSD canvas captures the pointer stream for drag detection, so a
      // DOM `click` never fires for pointer input on overlays — pair
      // pointerdown with a nearby pointerup instead (drag-safe); `click`
      // still covers keyboard activation.
      element.addEventListener('pointerdown', (event) => {
        const startX = event.clientX;
        const startY = event.clientY;
        const onUp = (up: PointerEvent): void => {
          cleanup();
          if (Math.hypot(up.clientX - startX, up.clientY - startY) < 5) advance();
        };
        const onCancel = (): void => cleanup();
        const cleanup = (): void => {
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
        };
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
      });
      const x = 0.15 + (index * 0.7) / Math.max(1, count - 1);
      const location = makePoint(viewer, x, 0.12);
      if (!location) return;
      element.classList.toggle('is-hidden', !showAnnotations);
      viewer.addOverlay({ element, location });
      elements.push(element);
    }
  };

  const drawTeiBoxes = (boxes: TeiWordBox[]): void => {
    const viewer = tify.viewer;
    const tiledImage = viewer?.world?.getItemAt?.(0);
    if (!viewer || typeof tiledImage?.imageToViewportRectangle !== 'function') return;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    for (const box of boxes) {
      const element = document.createElement('div');
      element.className = 'tify-plugin-tei-word';
      element.title = box.text;
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', box.text);
      applyWordStyle(element);
      onTap(element, () => select(box, element));
      // Word text inside the box, force-fitted via SVG textLength: the
      // vector scales with the box, so the fit holds at every zoom
      // without listeners or measurement.
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', String(box.h * 0.8));
      label.setAttribute('font-size', String(box.h * 0.8));
      label.setAttribute('textLength', String(box.w));
      label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      label.textContent = box.text;
      svg.append(label);
      element.append(svg);
      const rect = tiledImage.imageToViewportRectangle(box.x, box.y, box.w, box.h);
      // Top-left anchored box: Point location + viewport-unit size.
      const location = makePoint(viewer, rect.x, rect.y);
      if (!location) return;
      viewer.addOverlay({
        element,
        location,
        width: rect.width,
        height: rect.height,
      });
      elements.push(element);
    }
  };

  const drawAsync = async (token: number): Promise<void> => {
    clear();
    const viewer = tify.viewer;
    if (!viewer) return;
    const pages = getPages(tify).filter((page) => page > 0);
    if (pages.length === 0) return;
    if (teiOpts) {
      try {
        const manifestUrl = String(tify.options?.manifestUrl ?? '');
        if (manifestUrl !== '') {
          const manifest = await getManifest(tify);
          if (token !== drawToken || disposed) return;
          const teiPage = await fetchTeiPageCached(manifest, manifestUrl, pages[0], teiOpts);
          if (token !== drawToken || disposed) return;
          if (teiPage && teiPage.boxes.length > 0) {
            drawTeiBoxes(teiPage.boxes);
            pageHasBoxes = true;
            if (panel) panel.status.textContent = t('TEI word boxes');
            renderReadout();
            return;
          }
        }
      } catch {
        // Fall through to demo markers.
      }
      if (token !== drawToken || disposed) return;
    }
    drawMarkers(pages);
    pageHasBoxes = false;
    if (panel) panel.status.textContent = t('Demo markers');
    renderReadout();
  };

  const draw = (): void => {
    drawToken += 1;
    void drawAsync(drawToken);
  };

  const onOpen = (): void => draw();
  tify.viewer?.addHandler?.('open', onOpen);
  unsubscribe = onPagesChange(tify, draw);
  draw();

  return {
    destroy() {
      disposed = true;
      unsubscribe?.();
      try {
        tify.viewer?.removeHandler?.('open', onOpen);
      } catch {
        // Ignore teardown races.
      }
      dock?.destroy();
      if (options.panelEl) {
        options.panelEl.classList.remove('tify-plugin-panel');
        options.panelEl.innerHTML = '';
      }
      clear();
    },
  };
}
