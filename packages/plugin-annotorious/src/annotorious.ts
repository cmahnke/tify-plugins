// Display-only Annotorious module for TIFY.
//
// Attaches Annotorious v3 (@annotorious/openseadragon) to TIFY's viewer and
// feeds it annotations imported from the IIIF manifest (xywh fragment targets
// only). No drawing, no editor popup: clicks only select, bodies render in
// our (translated) side panel.
//
// Scope limits (v1):
// - Annotorious coordinates are relative to ONE base image: in TIFY book
//   view (double-page spread) the second page's annotations are offset into
//   the shared world space via the page layout, so both pages show shapes.
// - Whole-canvas targets, SVG selectors and non-xywh shapes are skipped.
// - Annotorious renders on WebGL: without a usable context (e.g. headless
//   browsers without software GL) the plugin degrades to panel-only mode —
//   the annotation list still works, no canvas shapes are drawn.
import {
  createOSDAnnotator,
  UserSelectAction,
  W3CImageFormat,
  type ImageAnnotation,
  type OpenSeadragonAnnotator,
} from '@annotorious/openseadragon';
import '@annotorious/openseadragon/annotorious-openseadragon.css';
import { shapeStyle } from './shape-style';
import type Tify from 'tify';
import {
  canvasesOf,
  getManifest,
  getVisiblePages,
  getXywhAnnotations,
  pageLayout,
  summarizeBodies,
  xywhOf,
} from '@projektemacher/tify-plugin-core';
import {
  createTranslator,
  registerPlugin,
  type TranslateFn,
} from '@projektemacher/tify-plugin-core';
import {
  createSidePanel,
  onPagesChange,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from '@projektemacher/tify-plugin-core';

import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';

export interface AnnotoriousOptions {
  /** Host element for the annotation list. Omit for overlay-only mode. */
  panelEl?: HTMLElement | null;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock. Ignored without panelEl.
   */
  dock?: boolean | 'auto';
  /** Open the docked panel after init (default true). */
  autoOpen?: boolean;
}

export interface AnnotoriousPlugin extends TifyPlugin {
  refresh(): void;
  count(): number;
  /** False when the canvas layer is unavailable (no WebGL): panel-only mode. */
  hasShapes(): boolean;
}

interface RowEntry {
  parsed: ImageAnnotation;
  summary: string;
  row: HTMLTableRowElement | null;
}

function renderRows(
  t: TranslateFn,
  tbody: HTMLTableSectionElement,
  entries: RowEntry[],
  anno: OpenSeadragonAnnotator | null,
): void {
  tbody.innerHTML = '';
  if (entries.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.textContent = t('No annotations on this page');
    row.append(cell);
    tbody.append(row);
    return;
  }
  entries.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.dataset.annotationId = entry.parsed.id;
    const indexCell = document.createElement('td');
    indexCell.textContent = String(index + 1);
    const textCell = document.createElement('td');
    if (anno) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tify-plugin-anno-link';
      button.textContent = entry.summary;
      button.addEventListener('click', () => {
        anno.setSelected(entry.parsed.id);
        try {
          anno.fitBounds(entry.parsed.id);
        } catch {
          // fitBounds is best effort (depends on shape type).
        }
      });
      textCell.append(button);
    } else {
      // Panel-only mode: no canvas layer, nothing to select or zoom.
      textCell.textContent = entry.summary;
    }
    row.append(indexCell, textCell);
    tbody.append(row);
    entry.row = row;
  });
}

function highlight(entries: RowEntry[], id: string | null): void {
  for (const entry of entries) {
    const active = entry.parsed.id === id;
    entry.row?.classList.toggle('is-active', active);
    // The tint alone is visual; aria-current carries the row-canvas
    // relationship to assistive tech.
    if (entry.row) {
      if (active) entry.row.setAttribute('aria-current', 'true');
      else entry.row.removeAttribute('aria-current');
      if (active) entry.row.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** The `xywh` numbers of a normalized W3C annotation target, if any. */
function targetFragmentOf(annotation: any): { x: number; y: number; w: number; h: number } | null {
  const raw = annotation?.target;
  if (typeof raw === 'string') return xywhOf(raw.slice(raw.indexOf('#xywh=') + 1));
  const value = raw?.selector?.value;
  if (typeof value === 'string') return xywhOf(value);
  return null;
}

/** Rewrites an annotation target's `xywh` fragment with new numbers. */
function withXywh(target: unknown, x: number, y: number, w: number, h: number): unknown {
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const replacement = `xywh=${round(x)},${round(y)},${round(w)},${round(h)}`;
  if (typeof target === 'string') {
    const at = target.indexOf('#xywh=');
    return at >= 0 ? `${target.slice(0, at)}#${replacement}` : target;
  }
  if (target && typeof target === 'object') {
    const node = target as Record<string, any>;
    const selector = node.selector;
    if (selector && typeof selector === 'object' && typeof selector.value === 'string') {
      return { ...node, selector: { ...selector, value: replacement } };
    }
    if (typeof node.source === 'string') {
      const at = node.source.indexOf('#xywh=');
      return {
        ...node,
        source: at >= 0 ? `${node.source.slice(0, at)}#${replacement}` : node.source,
      };
    }
  }
  return target;
}

export async function annotoriousPlugin(
  tify: Tify,
  options: AnnotoriousOptions = {},
): Promise<AnnotoriousPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  // Silence core's missing-plugin warning for the features this plugin owns.
  const unregister = registerPlugin('annotorious');
  const panel: SidePanel | null = options.panelEl
    ? createSidePanel(options.panelEl, t('Annotations'))
    : null;
  const dock: DockHandle | null =
    panel && options.panelEl
      ? dockPanel({
          tify,
          id: 'annotations',
          label: t('Annotations'),
          iconSvg: DOCK_ICONS.comment,
          contentEl: options.panelEl,
          mode: options.dock,
        })
      : null;
  if (options.autoOpen !== false) dock?.open();

  const viewer = tify.viewer;
  if (!viewer) throw new Error(t('Viewer not ready'));

  // Annotorious draws on a WebGL canvas; init fails hard without a usable
  // context (e.g. headless Firefox without software GL). Degrade to
  // panel-only mode instead of killing the whole plugin.
  let anno: OpenSeadragonAnnotator | null = null;
  try {
    anno = createOSDAnnotator(viewer, { drawingEnabled: false, style: shapeStyle });
    anno.setUserSelectAction(UserSelectAction.SELECT);
  } catch (error) {
    console.debug('[tify-plugins] Annotorious canvas unavailable:', error);
    anno = null;
  }
  // W3C adapter: parses IIIF xywh fragment targets into shapes natively.
  const w3c = W3CImageFormat('iiif');

  let disposed = false;
  let entries: RowEntry[] = [];
  let tbody: HTMLTableSectionElement | null = null;
  if (panel) {
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.className = 'tify-sr-only';
    caption.textContent = t('Annotations on this page');
    tbody = document.createElement('tbody');
    table.append(caption, tbody);
    panel.body.append(table);
    if (!anno) {
      // Make the degradation visible (and testable).
      const note = document.createElement('p');
      note.className = 'tify-plugin-note';
      note.textContent = t('Shapes not rendered (WebGL unavailable)');
      panel.body.append(note);
      panel.root.dataset.shapes = 'off';
    } else {
      panel.root.dataset.shapes = 'on';
    }
  }

  const sync = async (): Promise<void> => {
    if (disposed) return;
    const pages = getVisiblePages(tify);
    // Bail before touching rendered state: page polls can observe a
    // transient empty page list, which must not wipe the current view.
    if (pages.length === 0) return;
    if (panel) {
      panel.status.textContent = t('Loading annotations…');
    }
    try {
      const manifest = await getManifest(tify);
      if (disposed) return;
      // Both facing pages in a spread: annotations of the second page are
      // offset into the shared world space (Annotorious has one coordinate
      // space; TIFY lays the pages side by side).
      const loaded = await Promise.all(pages.map((page) => getXywhAnnotations(manifest, page)));
      if (disposed) return;
      const layouts = pageLayout(tify, manifest);
      // Annotorious's world space is in image pixels of the base content:
      // content units = viewport units * contentFactor, and contentFactor
      // equals the first page's canvas size along the layout axis (every
      // item spans width/firstSize viewport units).
      const first = layouts[0];
      const canvases = canvasesOf(manifest);
      const firstCanvas = canvases[(first?.page ?? 1) - 1];
      const factor = Number(firstCanvas?.width ?? 0) || 1;
      const parsed: ImageAnnotation[] = [];
      const next: RowEntry[] = [];
      loaded.forEach(({ annotations }, pageIndex) => {
        const page = pages[pageIndex];
        // First shown page sits at the world origin; later pages are offset
        // by their layout x/y converted to content pixels.
        const layout = layouts.find((entry) => entry.page === page);
        const pageCanvas = canvases[page - 1];
        const pageW = Number(pageCanvas?.width ?? 0) || 1;
        const pageH = Number(pageCanvas?.height ?? 0) || 1;
        const base =
          layout && first
            ? {
                x: (layout.x - first.x) * factor,
                y: (layout.y - first.y) * factor,
              }
            : { x: 0, y: 0 };
        const scaleX = factor / pageW;
        const scaleY = factor / pageH;
        annotations.forEach((w3cAnnotation, index) => {
          try {
            const fragment = targetFragmentOf(w3cAnnotation);
            if (!fragment) return;
            const offset = {
              ...w3cAnnotation,
              // Rewrite the fragment: shift x/y into the spread's shared
              // world space (content pixels) and rescale so the shape's
              // size matches the page's footprint in that space.
              target: withXywh(
                w3cAnnotation.target,
                base.x + fragment.x * scaleX,
                base.y + fragment.y * scaleY,
                fragment.w * scaleX,
                fragment.h * scaleY,
              ),
            };
            const result = w3c.parse(offset);
            if (!result.parsed) return;
            parsed.push(result.parsed);
            const summary = summarizeBodies(
              w3cAnnotation,
              t('Annotation {index}', { index: index + 1 }),
            );
            next.push({ parsed: result.parsed, summary, row: null });
          } catch {
            // Skip annotations the adapter cannot parse.
          }
        });
      });
      // Drop rendered state only once the replacement is ready. NB: the
      // silent sync path (below) also removes annotations that are gone, so
      // no clearAnnotations() call is needed here — clearing dispatches a
      // LOCAL-origin change, which crashes Annotorious' history reconciler
      // when the very first annotation event lands within its 250ms window
      // (upstream bug, still present in @annotorious/openseadragon 3.9.4).
      entries = next;
      anno?.setAnnotations(parsed, true);
      if (tbody) {
        tbody.innerHTML = '';
        renderRows(t, tbody, entries, anno);
      }
      if (panel) {
        panel.status.textContent = t('{count} annotations', { count: entries.length });
      }
    } catch {
      if (panel) panel.status.textContent = t('Could not load annotations');
    }
  };

  const onClick = (annotation: ImageAnnotation): void => {
    // Clicking a shape only gives visible feedback when the list panel is
    // open — reopen a manually closed dock so the highlight is seen.
    if (panel && dock && !dock.isOpen()) dock.open();
    highlight(entries, annotation?.id ?? null);
  };
  anno?.on('clickAnnotation', onClick);
  const unsubscribe = onPagesChange(tify, () => void sync());
  await sync();

  return {
    refresh: () => void sync(),
    count: () => entries.length,
    hasShapes: () => anno !== null,
    destroy() {
      disposed = true;
      unregister();
      unsubscribe();
      dock?.destroy();
      try {
        anno?.off('clickAnnotation', onClick);
      } catch {
        // Ignore teardown races.
      }
      try {
        anno?.destroy();
      } catch {
        // Viewer may already be gone.
      }
      if (options.panelEl) {
        options.panelEl.classList.remove('tify-plugin-panel');
        options.panelEl.innerHTML = '';
      }
    },
  };
}
