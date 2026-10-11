// Info panel for TIFY: which plugin-relevant features the current manifest
// and image service advertise. Presence-only (see lib/features) — linked
// resources are never fetched, nothing is rendered or verified. Works with
// core alone; no sibling plugin package is required.
import type Tify from 'tify';
import {
  createSidePanel,
  getPages,
  onPagesChange,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from './tify-plugin';
import { getInfoJson, getManifest, listCanvases } from './iiif';
import { createTranslator, type TranslateFn } from './i18n';
import { DOCK_ICONS, dockPanel, type DockHandle } from './dock';
import {
  describeCanvas,
  describeImageFeatures,
  describeManifest,
  type AnnotationLink,
  type TeiLink,
} from './features';

export interface InfoPanelOptions {
  /** Panel content host (sidecar unless docked into the viewer). */
  panelEl: HTMLElement;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  dock?: boolean | 'auto';
  /** Open the docked panel after init (default true). */
  autoOpen?: boolean;
}

export interface InfoPlugin extends TifyPlugin {
  refresh(): void;
}

function addRow(tbody: HTMLTableSectionElement, label: string, value: string): void {
  const row = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = label;
  const td = document.createElement('td');
  td.textContent = value;
  row.append(th, td);
  tbody.append(row);
}

function teiValue(t: TranslateFn, tei: TeiLink): string {
  if (tei === 'canvas') return t('yes (canvas)');
  if (tei === 'manifest') return t('yes (manifest)');
  return t('no');
}

function annotationsValue(t: TranslateFn, annotations: AnnotationLink): string {
  if (annotations === 'embedded') return t('embedded');
  if (annotations === 'external') return t('by reference');
  return t('no');
}

function renderManifestTable(
  t: TranslateFn,
  host: HTMLElement,
  manifest: any | null,
  page: number,
): void {
  host.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = t('Manifest');
  host.append(heading);
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  if (!manifest) {
    addRow(tbody, t('Presentation version'), t('unknown'));
    addRow(tbody, t('Canvases'), t('unknown'));
    addRow(tbody, t('TEI transcription'), t('unknown'));
    addRow(tbody, t('Annotations'), t('unknown'));
    addRow(tbody, t('MusicXML score'), t('unknown'));
  } else {
    const described = describeManifest(manifest);
    const canvas = describeCanvas(manifest, page);
    addRow(
      tbody,
      t('Presentation version'),
      described.version === 'unknown' ? t('unknown') : described.version,
    );
    addRow(tbody, t('Canvases'), String(described.canvasCount));
    addRow(tbody, t('TEI transcription'), teiValue(t, canvas.tei));
    addRow(tbody, t('Annotations'), annotationsValue(t, canvas.annotations));
    addRow(tbody, t('MusicXML score'), t(canvas.musicXml ? 'yes' : 'no'));
  }
  table.append(tbody);
  host.append(table);
}

function renderImageFeatures(
  t: TranslateFn,
  host: HTMLElement,
  info: any | null,
  page: number | null,
): void {
  host.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent =
    page === null ? t('Image service') : t('Image service (page {page})', { page });
  host.append(heading);
  if (!info) {
    const note = document.createElement('p');
    note.className = 'tify-plugin-note';
    note.textContent = t('Image service: info.json unreachable (CORS?)');
    host.append(note);
    return;
  }
  const described = describeImageFeatures(info);
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  addRow(
    tbody,
    t('API version'),
    described.apiVersion === 'unknown' ? t('unknown') : described.apiVersion,
  );
  addRow(tbody, t('Profile'), described.profile === '' ? '–' : described.profile);
  addRow(tbody, t('HDR advertised'), t(described.hdrAdvertised ? 'yes' : 'no'));
  addRow(tbody, t('C2PA advertised'), t(described.c2paAdvertised ? 'yes' : 'no'));
  table.append(tbody);
  host.append(table);
}

export async function infoPanelPlugin(tify: Tify, options: InfoPanelOptions): Promise<InfoPlugin> {
  await waitReady(tify);
  const de = (
    (await import('../i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  const panel: SidePanel = createSidePanel(options.panelEl, t('Info'));
  const manifestBody = document.createElement('div');
  const imageBody = document.createElement('div');
  panel.body.append(manifestBody, imageBody);

  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  const dock: DockHandle | null = dockPanel({
    tify,
    id: 'info',
    label: t('Info'),
    iconSvg: DOCK_ICONS.list,
    contentEl: options.panelEl,
    mode: options.dock,
  });
  if (options.autoOpen !== false) dock?.open();

  const render = async (): Promise<void> => {
    if (disposed) return;
    const pages = getPages(tify).filter((page) => page > 0);
    panel.status.textContent =
      pages.length === 0
        ? t('Loading…')
        : t(pages.length > 1 ? 'Viewing pages {pages}' : 'Viewing page {pages}', {
            pages: pages.join(', '),
          });
    let manifest: any | null;
    try {
      manifest = await getManifest(tify);
    } catch {
      manifest = null;
    }
    if (!manifest) {
      panel.status.textContent = t('Manifest unreachable');
    }
    renderManifestTable(t, manifestBody, manifest, pages[0] ?? 1);
    if (!manifest || pages.length === 0) {
      renderImageFeatures(t, imageBody, null, null);
      return;
    }
    const canvases = listCanvases(manifest);
    const canvas = canvases[pages[0] - 1];
    if (!canvas?.serviceId) {
      renderImageFeatures(t, imageBody, null, pages[0]);
      return;
    }
    try {
      const info = await getInfoJson(canvas.serviceId);
      if (disposed) return;
      renderImageFeatures(t, imageBody, info, pages[0]);
    } catch {
      if (disposed) return;
      renderImageFeatures(t, imageBody, null, pages[0]);
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    void render().catch(() => undefined);
  };

  unsubscribe = onPagesChange(tify, refresh);
  refresh();

  return {
    refresh,
    destroy() {
      disposed = true;
      unsubscribe?.();
      dock?.destroy();
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
