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

  const render = async (): Promise<void> => {
    const pages = getPages(tify).filter((page) => page > 0);
    panel.status.textContent =
      pages.length === 0
        ? t('Loading…')
        : t(pages.length > 1 ? 'Viewing pages {pages}' : 'Viewing page {pages}', {
            pages: pages.join(', '),
          });
  };

  // Manifest summary (best effort; panel works without it).
  try {
    const url = tify.options?.manifestUrl as string | undefined;
    if (url) {
      const response = await fetch(url);
      const manifest = (await response.json()) as unknown;
      const canvases =
        (manifest as any)?.items?.length ??
        (manifest as any)?.sequences?.[0]?.canvases?.length ??
        '?';
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

  const nav = document.createElement('p');
  const prev = document.createElement('button');
  prev.textContent = t('← Previous');
  prev.addEventListener('click', () => {
    const pages = getPages(tify).filter((p) => p > 0);
    if (pages.length > 0 && pages[0] > 1) tify.setPage(pages[0] - 1);
  });
  const next = document.createElement('button');
  next.textContent = t('Next →');
  next.addEventListener('click', () => {
    const pages = getPages(tify).filter((p) => p > 0);
    if (pages.length > 0) tify.setPage(pages[0] + 1);
  });
  const thumbs = document.createElement('button');
  thumbs.textContent = t('Thumbnails');
  thumbs.addEventListener('click', () => {
    tify.setView(tify.options?.view === 'thumbnails' ? null : 'thumbnails');
  });
  nav.append(prev, ' ', next, ' ', thumbs);
  panel.body.append(nav);

  const unsubscribe = onPagesChange(tify, () => void render());
  await render();

  return {
    destroy() {
      unsubscribe();
      dock?.destroy();
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
