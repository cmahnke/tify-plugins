import type Tify from 'tify';

/** Common contract for all plugins in this repo. */
export interface TifyPlugin {
  destroy(): void;
}

export type TifyPluginFactory<TOptions = Record<string, never>> = (
  tify: Tify,
  options: TOptions,
) => TifyPlugin | Promise<TifyPlugin>;

export const COOKBOOK_MANIFEST = 'https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json';

/** TIFY translations for the npm build (avoids bundling dist/translations). */
export const TIFY_TRANSLATIONS_URL = 'https://cdn.jsdelivr.net/npm/tify@0.36.2/dist/translations';

export async function waitReady(tify: Tify): Promise<void> {
  await tify.ready;
}

/** Current 1-based pages shown by the viewer (may include 0/-1 placeholders). */
export function getPages(tify: Tify): number[] {
  const pages = tify.options?.pages;
  return Array.isArray(pages) ? [...pages] : [];
}

export function getPageCount(tify: Tify): number {
  const viewer = tify.viewer as { world?: { getItemCount?: () => number } } | undefined;
  // Page count is not exposed directly; derive from OSD items as a fallback.
  const items = viewer?.world?.getItemCount?.() ?? 0;
  return items;
}

/**
 * TIFY emits no page/view change events, so watch `tify.options.pages` by
 * polling (cheap) and re-check on DOM mutations inside the container.
 * Returns an unsubscribe function.
 */
export function onPagesChange(
  tify: Tify,
  callback: (pages: number[]) => void,
  intervalMs = 500,
): () => void {
  let last = JSON.stringify(getPages(tify));
  let stopped = false;

  const check = (): void => {
    if (stopped) return;
    const current = JSON.stringify(getPages(tify));
    if (current !== last) {
      last = current;
      callback(getPages(tify));
    }
  };

  const timer = window.setInterval(check, intervalMs);

  const root = document.querySelector(
    typeof tify.options?.container === 'string' ? (tify.options.container as string) : '.tify',
  );
  const observer = new MutationObserver(check);
  if (root) observer.observe(root, { childList: true, subtree: true });

  return () => {
    stopped = true;
    window.clearInterval(timer);
    observer.disconnect();
  };
}

export interface SidePanel {
  root: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
}

/** Fill a host element with a titled panel skeleton; returns sections to render into. */
export function createSidePanel(host: HTMLElement, title: string): SidePanel {
  host.classList.add('tify-plugin-panel');
  // Focusable so badge clicks / fallback scrolls can move focus to the panel.
  host.tabIndex = -1;
  host.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const status = document.createElement('p');
  status.className = 'tify-plugin-status';
  // Live region: status changes ("Viewing page 2", "Loading…") are spoken
  // while the panel is open (WCAG 4.1.3 Status Messages).
  status.setAttribute('role', 'status');
  const body = document.createElement('div');
  body.className = 'tify-plugin-body';
  host.append(heading, status, body);
  return { root: host, body, status };
}

/**
 * Panel skeleton without a home in the page: lets plugins keep their render
 * code unguarded when the caller disabled the panel (`panelEl: null`) —
 * writes land in a detached DOM that is never shown.
 */
export function detachedSidePanel(): SidePanel {
  return createSidePanel(document.createElement('aside'), '');
}

/** Result of panel host resolution. */
export interface PanelHost {
  /** The host element, or null when the caller disabled the panel. */
  host: HTMLElement | null;
  /** True when the host was auto-created and must be removed on destroy(). */
  owned: boolean;
}

/** Viewer container element, if resolvable from tify.options. */
function viewerContainer(tify: Tify): Element | null {
  const container = tify.options?.container;
  if (typeof container === 'string') return document.querySelector(container);
  return container instanceof Element ? container : null;
}

/**
 * Resolve a plugin's panel host: a supplied element stays page-owned, `null`
 * disables the panel, and omitting it lets the plugin create its own host —
 * no page markup required. The auto host is appended right after the viewer
 * container (after hosts created by earlier plugins, keeping panel order =
 * init order). That spot only matters for sidecar mode (`dock: false` /
 * unrecognized DOM): docking re-parents the element into the viewer chrome
 * within the same task, before anything is painted.
 */
export function resolvePanelHost(
  tify: Tify,
  id: string,
  panelEl: null,
): PanelHost & { host: null; owned: false };
export function resolvePanelHost(
  tify: Tify,
  id: string,
  panelEl?: HTMLElement,
): PanelHost & { host: HTMLElement };
export function resolvePanelHost(tify: Tify, id: string, panelEl?: HTMLElement | null): PanelHost;
export function resolvePanelHost(tify: Tify, id: string, panelEl?: HTMLElement | null): PanelHost {
  if (panelEl === null) return { host: null, owned: false };
  if (panelEl) return { host: panelEl, owned: false };
  const host = document.createElement('aside');
  host.className = `tify-plugin-panel tify-plugin-panel-${id} tify-plugin-panel-auto`;
  const container = viewerContainer(tify);
  if (container) {
    let anchor: Element = container;
    let next = container.nextElementSibling;
    while (next instanceof Element && next.classList.contains('tify-plugin-panel-auto')) {
      anchor = next;
      next = next.nextElementSibling;
    }
    anchor.after(host);
  } else {
    // No container resolvable: dock mode will decide anyway; keep the sidecar
    // fallback visible instead of dropping the element on the floor.
    document.body.append(host);
  }
  return { host, owned: true };
}

/** Small fetch helper with timeout, for manifest/info.json/C2PA-adjacent reads. */
export async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return (await response.json()) as unknown;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Same as fetchJson, but for text documents (MusicXML, TEI, …). */
export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.text();
  } finally {
    window.clearTimeout(timer);
  }
}
