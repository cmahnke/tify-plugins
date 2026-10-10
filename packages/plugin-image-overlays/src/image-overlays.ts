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
import { getManifest, getPages, onPagesChange, waitReady } from '@projektemacher/tify-plugin-core';
import { createTranslator } from '@projektemacher/tify-plugin-core';
import type { TifyPlugin } from '@projektemacher/tify-plugin-core';
import { fetchTeiPageCached, type TeiOptions, type TeiWordBox } from './tei';

export interface ImageOverlaysOptions {
  /** Number of demo markers spread across the visible image. */
  markers?: number;
  /** TEI word boxes; `false` disables TEI and always shows demo markers. */
  tei?: false | TeiOptions;
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
  };

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
      viewer.addOverlay({ element, location });
      elements.push(element);
    }
  };

  const drawTeiBoxes = (boxes: TeiWordBox[]): void => {
    const viewer = tify.viewer;
    const tiledImage = viewer?.world?.getItemAt?.(0);
    if (!viewer || typeof tiledImage?.imageToViewportRectangle !== 'function') return;
    for (const box of boxes) {
      const element = document.createElement('div');
      element.className = 'tify-plugin-tei-word';
      element.title = box.text;
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
            return;
          }
        }
      } catch {
        // Fall through to demo markers.
      }
      if (token !== drawToken || disposed) return;
    }
    drawMarkers(pages);
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
      clear();
    },
  };
}
