// Side-panel plugin: renders manifest metadata + page controls. Docks into
// TIFY's viewer chrome when recognized, otherwise renders into panelEl
// beside the viewer (TIFY's `views` option only supports built-in views).
import type Tify from 'tify';
import {
  createSidePanel,
  getPages,
  onPagesChange,
  waitReady,
} from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';
import { createTranslator } from '@projektemacher/tify-plugin-core';
import type { TifyPlugin } from '@projektemacher/tify-plugin-core';

export interface SidePanelOptions {
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

function getManifestLabel(manifest: any): string {
  const label = manifest?.label;
  if (!label) return '(untitled)';
  if (typeof label === 'string') return label;
  const first = label.en?.[0] ?? label.none?.[0] ?? Object.values(label)[0];
  return String(Array.isArray(first) ? first[0] : (first ?? '(untitled)'));
}

export async function sidePanelPlugin(tify: Tify, options: SidePanelOptions): Promise<TifyPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  const panel = createSidePanel(options.panelEl, t('Document'));
  const dock: DockHandle | null = dockPanel({
    tify,
    id: 'document',
    label: t('Document'),
    iconSvg: DOCK_ICONS.list,
    contentEl: options.panelEl,
    mode: options.dock,
  });
  if (options.autoOpen !== false) dock?.open();

  const render = async (): Promise<void> => {
    const pages = getPages(tify).filter((page) => page > 0);
    panel.status.textContent =
      pages.length === 0
        ? t('Loading…')
        : t(pages.length > 1 ? 'Viewing pages {pages}' : 'Viewing page {pages}', {
            pages: pages.join(', '),
          });
  };

  // Manifest summary (best effort; panel works without it). The canvas
  // count doubles as the upper pagination bound (null while unknown).
  let canvasCount: number | null = null;
  try {
    const url = tify.options?.manifestUrl as string | undefined;
    if (url) {
      const response = await fetch(url);
      const manifest = (await response.json()) as unknown;
      const canvases =
        (manifest as any)?.items?.length ??
        (manifest as any)?.sequences?.[0]?.canvases?.length ??
        '?';
      if (typeof canvases === 'number') canvasCount = canvases;
      const title = document.createElement('p');
      title.innerHTML = `<strong></strong> <span></span>`;
      (title.querySelector('strong') as HTMLElement).textContent = getManifestLabel(manifest);
      (title.querySelector('span') as HTMLElement).textContent =
        `— ${t('{canvases} canvases', { canvases: String(canvases) })}`;
      panel.body.append(title);
    }
  } catch {
    // Panel stays useful without manifest metadata.
  }

  const nav = document.createElement('nav');
  nav.className = 'tify-plugin-page-nav';
  nav.setAttribute('aria-label', t('Document navigation'));
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = t('← Previous');
  prev.addEventListener('click', () => {
    const pages = getPages(tify).filter((p) => p > 0);
    if (pages.length > 0 && pages[0] > 1) tify.setPage(pages[0] - 1);
  });
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = t('Next →');
  next.addEventListener('click', () => {
    const pages = getPages(tify).filter((p) => p > 0);
    if (pages.length > 0) tify.setPage(pages[0] + 1);
  });
  const thumbs = document.createElement('button');
  thumbs.type = 'button';
  thumbs.textContent = t('Thumbnails');
  // Toggle state for assistive tech; kept in sync below, since TIFY emits
  // no view-change events (same polling pattern as the dock helper).
  const paintThumbs = (): void => {
    thumbs.setAttribute('aria-pressed', String(tify.options?.view === 'thumbnails'));
  };
  thumbs.addEventListener('click', () => {
    tify.setView(tify.options?.view === 'thumbnails' ? null : 'thumbnails');
    paintThumbs();
  });
  nav.append(prev, ' ', next, ' ', thumbs);
  panel.body.append(nav);

  // Disable pagination at the bounds (silent no-ops otherwise). The upper
  // bound comes from the manifest's canvas count; unknown while it loads,
  // in which case Next stays enabled (the click handler no-ops anyway).
  const paintNav = (): void => {
    const pages = getPages(tify).filter((p) => p > 0);
    prev.disabled = pages.length > 0 && pages[0] <= 1;
    next.disabled = pages.length > 0 && canvasCount !== null && pages[0] >= canvasCount;
  };
  const unsubscribe = onPagesChange(tify, () => {
    void render();
    paintNav();
    paintThumbs();
  });
  await render();
  paintNav();
  paintThumbs();

  return {
    destroy() {
      unsubscribe();
      dock?.destroy();
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
