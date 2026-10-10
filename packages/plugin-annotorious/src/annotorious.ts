// Display-only Annotorious module for TIFY.
//
// Attaches Annotorious v3 (@annotorious/openseadragon) to TIFY's viewer and
// feeds it annotations imported from the IIIF manifest (xywh fragment targets
// only). No drawing, no editor popup: clicks only select, bodies render in
// our (translated) side panel.
//
// Scope limits (v1):
// - Annotorious coordinates are relative to ONE base image, so in TIFY book
//   view only the first visible page's annotations are shown (noted in panel).
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
  getManifest,
  getVisiblePages,
  getXywhAnnotations,
  summarizeBodies,
} from '@projektemacher/tify-plugin-core';
import { createTranslator, type TranslateFn } from '@projektemacher/tify-plugin-core';
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
    if (active) entry.row?.scrollIntoView({ block: 'nearest' });
  }
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
    tbody = document.createElement('tbody');
    table.append(tbody);
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
      const { annotations } = await getXywhAnnotations(manifest, pages[0]);
      if (disposed) return;
      const parsed: ImageAnnotation[] = [];
      const next: RowEntry[] = [];
      annotations.forEach((w3cAnnotation, index) => {
        try {
          const result = w3c.parse(w3cAnnotation);
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
      // Swap rendered state only once the replacement is ready.
      anno?.clearAnnotations();
      entries = next;
      anno?.setAnnotations(parsed, true);
      if (tbody) {
        tbody.innerHTML = '';
        renderRows(t, tbody, entries, anno);
      }
      if (panel) {
        const note =
          pages.length > 1 ? ` · ${t('Showing annotations for the first page only')}` : '';
        panel.status.textContent = `${t('{count} annotations', { count: entries.length })}${note}`;
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
