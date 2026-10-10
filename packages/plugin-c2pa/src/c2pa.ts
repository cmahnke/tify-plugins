// C2PA provenance plugin for TIFY (display-only).
//
// Samples the OpenSeadragon tiles in the current viewport ("viewport tiles
// live"), fetches their bytes, and validates embedded manifests with
// @contentauth/c2pa-web. Trust anchors are configurable by URL (PEM bundle)
// via a form inside the panel. The dock button carries the validity tint.
import type Tify from 'tify';
import {
  aggregateValid,
  configureTrust,
  DEFAULT_TRUST_ANCHORS_URL,
  readTileStatus,
  trustInfo,
  type TileC2paStatus,
} from './c2pa-lib';
import { createTranslator, type TranslateFn } from '@projektemacher/tify-plugin-core';
import {
  createSidePanel,
  getInfoJsonForCurrentPage,
  onPagesChange,
  serviceSupports,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';

/** Placeholder URI used in info.json `profile[].supports` to signal C2PA. */
export const C2PA_PROFILE_URI = 'https://christianmahnke.de/iiif/c2pa/';

/** True if the image service advertises C2PA via the placeholder profile URI. */
export function infoAdvertisesC2pa(infoJson: any): boolean {
  return serviceSupports(infoJson).includes(C2PA_PROFILE_URI);
}

export interface TrustAnchorsConfig {
  /**
   * PEM-bundle URL for the C2PA trust root.
   * null, undefined or '' = internal default (SDK defaults, nothing fetched).
   */
  url?: string | null;
  /** Show the URL in the panel. Default: true. */
  show?: boolean;
  /**
   * Change the URL via the panel form. Default: true.
   * Forced to false when show === false (no form to edit).
   */
  editable?: boolean;
}

export interface C2paOptions {
  /** Panel content host (sidecar unless docked into the viewer). */
  panelEl: HTMLElement;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  dock?: boolean | 'auto';
  /**
   * Trust-anchor setup. String/null shorthand preserves the classic call:
   * shown and editable. Use the object form to hide or lock the URL:
   * `{ show: false }` (internal default, nothing shown),
   * `{ url, show: false }` (URL set, not shown),
   * `{ url, editable: false }` (URL shown, locked),
   * `{ url: '' }` (shown, editable, defaults until typed).
   */
  trustAnchors?: string | null | TrustAnchorsConfig;
  /** Max viewport tiles checked per refresh. */
  maxTiles?: number;
}

interface ResolvedTrustAnchors {
  url: string | null;
  show: boolean;
  editable: boolean;
}

function resolveTrustAnchors(
  raw: string | null | TrustAnchorsConfig | undefined,
): ResolvedTrustAnchors {
  const normalized = (url: string | null | undefined): string | null => {
    const trimmed = url?.trim() ?? '';
    return trimmed === '' ? null : trimmed;
  };
  if (typeof raw === 'string' || raw == null) {
    return { url: normalized(raw), show: true, editable: true };
  }
  const show = raw.show ?? true;
  return { url: normalized(raw.url), show, editable: show ? (raw.editable ?? true) : false };
}

export interface C2paPlugin extends TifyPlugin {
  setTrustAnchorsUrl(url: string | null): Promise<void>;
  refresh(): void;
}

interface SampledTile {
  key: string;
  url: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pick the pyramid level whose pixels roughly match screen pixels:
 * at home zoom the whole image (width Iw) fits the container (width W), so
 * level ≈ maxLevel − log2(Iw / W), adjusted by the current zoom factor.
 * Approximation is fine — tiles are only samples for provenance checks.
 */
function pickLevel(viewer: any, tiledImage: any): number {
  const source = tiledImage.source;
  const maxLevel = source.maxLevel as number;
  const zoom = viewer.viewport.getZoom(true) as number;
  const homeZoom = viewer.viewport.getHomeZoom() as number;
  const contentSize = tiledImage.getContentSize() as { x: number; y: number };
  const containerSize = viewer.viewport.getContainerSize() as { x: number; y: number };
  const ratio = Math.max(1, contentSize.x / Math.max(1, containerSize.x));
  const level = Math.round(
    maxLevel - Math.log2(ratio) + Math.log2(Math.max(1e-6, zoom / Math.max(1e-9, homeZoom))),
  );
  return clamp(level, 0, maxLevel);
}

/** Tile URLs intersecting the viewport for the first world item. */
function sampleViewportTiles(viewer: any, maxTiles: number): SampledTile[] {
  const world = viewer.world;
  if (!world || world.getItemCount() === 0) return [];
  const tiledImage = world.getItemAt(0);
  const source = tiledImage.source;
  if (typeof source?.getTileUrl !== 'function') return [];

  const level = pickLevel(viewer, tiledImage);
  const bounds = viewer.viewport.getBounds(true) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  const tileW = (
    typeof source.getTileWidth === 'function' ? source.getTileWidth(level) : 512
  ) as number;
  const tileH = (
    typeof source.getTileHeight === 'function' ? source.getTileHeight(level) : 512
  ) as number;
  const numTiles = source.getNumTiles(level) as { x: number; y: number };

  // Map viewport bounds to tile indices via the item's content size.
  const contentSize = tiledImage.getContentSize() as { x: number; y: number };
  const levelScale = Math.pow(0.5, (source.maxLevel as number) - level);
  const levelW = contentSize.x * levelScale;
  const levelH = contentSize.y * levelScale;
  const homeBounds = tiledImage.getBounds(true) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const fracX0 = clamp((bounds.x - homeBounds.x) / homeBounds.width, 0, 1);
  const fracY0 = clamp((bounds.y - homeBounds.y) / homeBounds.height, 0, 1);
  const fracX1 = clamp((bounds.x + bounds.width - homeBounds.x) / homeBounds.width, 0, 1);
  const fracY1 = clamp((bounds.y + bounds.height - homeBounds.y) / homeBounds.height, 0, 1);

  const x0 = clamp(Math.floor((fracX0 * levelW) / tileW), 0, numTiles.x - 1);
  const x1 = clamp(Math.floor((fracX1 * levelW) / tileW), 0, numTiles.x - 1);
  const y0 = clamp(Math.floor((fracY0 * levelH) / tileH), 0, numTiles.y - 1);
  const y1 = clamp(Math.floor((fracY1 * levelH) / tileH), 0, numTiles.y - 1);

  const tiles: Array<SampledTile & { dist: number }> = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      let url: string;
      try {
        url = source.getTileUrl(level, x, y) as string;
      } catch {
        continue;
      }
      if (!url) continue;
      const cx = (x + 0.5 - (x0 + x1 + 1) / 2) ** 2 + (y + 0.5 - (y0 + y1 + 1) / 2) ** 2;
      tiles.push({ key: `L${level} ${x},${y}`, url, dist: cx });
    }
  }
  tiles.sort((a, b) => a.dist - b.dist);
  return tiles.slice(0, Math.max(1, maxTiles));
}

/** Signer names stay raw; the detail sentence is translated. */
function renderDetail(t: TranslateFn, status: TileC2paStatus): string {
  return [status.signer, t(status.detailKey, status.detailVars ?? {})].filter(Boolean).join(' — ');
}

export async function c2paPlugin(tify: Tify, options: C2paOptions): Promise<C2paPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  const maxTiles = options.maxTiles ?? 8;
  const trust = resolveTrustAnchors(options.trustAnchors);
  const panel: SidePanel = createSidePanel(options.panelEl, t('Provenance'));

  let disposed = false;
  let runId = 0;
  let aborter: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;

  const dock: DockHandle | null = dockPanel({
    tify,
    id: 'provenance',
    label: t('Provenance'),
    iconSvg: DOCK_ICONS.shield,
    contentEl: options.panelEl,
    mode: options.dock,
  });

  const paintBadge = (valid: boolean | null, title: string): void => {
    if (!dock) return;
    dock.setTint(valid === true ? 'ok' : valid === false ? 'bad' : 'neutral');
    dock.setTitle(title);
  };

  const renderTrustLine = (): void => {
    const info = trustInfo();
    const parts = [t('Trust root: {value}', { value: anchorLabel(info.anchorsUrl) })];
    if (info.certCount != null) parts.push(t('{count} certs', { count: info.certCount }));
    if (info.errorKey) parts.push(t(info.errorKey, info.errorVars ?? {}));
    panel.status.textContent = parts.join(' · ');
  };

  /** Display value for the effective trust root; masks the URL when hidden. */
  const anchorLabel = (anchorsUrl: string | null): string => {
    if (anchorsUrl === null || anchorsUrl === '') return t('(SDK defaults)');
    return trust.show ? anchorsUrl : t('(not shown)');
  };

  const applyTrustUrl = async (url: string | null): Promise<void> => {
    const normalized = url?.trim() ? url.trim() : null;
    await configureTrust(normalized);
    // Keep shareable links working (?trustAnchors=).
    try {
      const next = new URL(window.location.href);
      if (normalized) next.searchParams.set('trustAnchors', normalized);
      else next.searchParams.delete('trustAnchors');
      window.history.replaceState({}, '', next);
    } catch {
      // Non-browser or opaque origins: validation still applies.
    }
    renderTrustLine();
    refresh();
  };

  // Trust-anchor input lives in the panel (only when configured visible).
  // It is disabled without Apply button when configured read-only.
  let trustInput: HTMLInputElement | null = null;
  if (trust.show) {
    const form = document.createElement('form');
    form.className = 'tify-plugin-trust-form';
    const trustLabel = document.createElement('label');
    trustLabel.textContent = t('Trust anchors PEM URL');
    const input = document.createElement('input');
    input.type = 'url';
    input.value = trust.url ?? '';
    input.placeholder = DEFAULT_TRUST_ANCHORS_URL;
    input.setAttribute('aria-label', t('Trust anchors PEM URL'));
    trustLabel.append(input);
    form.append(trustLabel);
    if (trust.editable) {
      const trustApply = document.createElement('button');
      trustApply.type = 'submit';
      trustApply.textContent = t('Apply trust root');
      form.append(trustApply);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        void applyTrustUrl(value === '' ? null : value);
      });
    } else {
      input.disabled = true;
    }
    trustInput = input;
    panel.body.append(form);
  }

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.append(tbody);
  panel.body.append(table);

  const serviceLine = document.createElement('p');
  serviceLine.className = 'tify-plugin-service-line';
  serviceLine.textContent = t('Image service advertises C2PA: {value}', { value: t('unknown') });
  panel.body.append(serviceLine);

  const updateServiceLine = async (): Promise<void> => {
    let value = t('unknown');
    try {
      const current = await getInfoJsonForCurrentPage(tify);
      if (current) value = t(infoAdvertisesC2pa(current.info) ? 'yes' : 'no');
    } catch {
      value = t('unknown');
    }
    if (disposed) return;
    serviceLine.textContent = t('Image service advertises C2PA: {value}', { value });
  };

  const renderRows = (tiles: SampledTile[], statuses: Map<string, TileC2paStatus>): void => {
    tbody.innerHTML = '';
    if (tiles.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.textContent = t('No tiles in viewport (viewer not ready?)');
      row.append(cell);
      tbody.append(row);
      return;
    }
    for (const tile of tiles) {
      const status = statuses.get(tile.url);
      const row = document.createElement('tr');
      const keyCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = tile.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = tile.key;
      keyCell.append(link);
      const stateCell = document.createElement('td');
      const pill = document.createElement('span');
      const state = status?.state ?? 'unknown';
      pill.className = `pill ${state === 'valid' ? 'is-valid' : state === 'invalid' ? 'is-invalid' : `is-${state}`}`;
      if (state === 'valid') pill.textContent = t('valid');
      else if (state === 'invalid') pill.textContent = t('invalid');
      else if (state === 'unsigned') pill.textContent = t('unsigned');
      else pill.textContent = t('unknown');
      pill.title = status ? t(status.detailKey, status.detailVars ?? {}) : t('pending…');
      stateCell.append(pill);
      const detailCell = document.createElement('td');
      detailCell.textContent = status ? renderDetail(t, status) : t('checking…');
      row.append(keyCell, stateCell, detailCell);
      tbody.append(row);
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    const id = (runId += 1);
    aborter?.abort();
    aborter = new AbortController();
    const signal = aborter.signal;
    paintBadge(null, t('Checking viewport tiles…'));

    const viewer = tify.viewer;
    if (!viewer) {
      paintBadge(null, t('Viewer not ready'));
      return;
    }
    let tiles: SampledTile[] = [];
    try {
      tiles = sampleViewportTiles(viewer, maxTiles);
    } catch (error) {
      paintBadge(null, t('Tile sampling failed: {error}', { error: String(error) }));
      return;
    }
    const statuses = new Map<string, TileC2paStatus>();
    renderRows(tiles, statuses);

    const updateBadge = (): void => {
      if (id !== runId || disposed) return;
      const done = tiles.every((tile) => statuses.has(tile.url));
      const valid = aggregateValid([...statuses.values()]);
      const info = trustInfo();
      const anchor = t('Trust root: {value}', { value: anchorLabel(info.anchorsUrl) });
      if (valid) {
        paintBadge(
          true,
          `${t('At least one viewport tile has a valid C2PA manifest')} · ${anchor}`,
        );
      } else if (done) {
        paintBadge(
          false,
          `${t('No valid C2PA manifest in {count} sampled tiles', { count: tiles.length })} · ${anchor}`,
        );
      } else {
        paintBadge(false, `${t('Checking {count} tiles…', { count: tiles.length })} · ${anchor}`);
      }
      renderRows(tiles, statuses);
    };

    updateBadge();
    // Limited concurrency so a pan across a pyramid stays responsive.
    const queue = [...tiles];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0 && id === runId && !signal.aborted) {
        const tile = queue.shift() as SampledTile;
        try {
          const status = await readTileStatus(tile.url, signal);
          statuses.set(tile.url, status);
        } catch {
          // Aborted: a newer run took over.
          return;
        }
        updateBadge();
      }
    });
    void Promise.all(workers).then(() => {
      if (id === runId && !disposed) updateBadge();
    });
  };

  const debouncedRefresh = (() => {
    let timer = 0;
    return () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refresh(), 400);
    };
  })();

  // ---- boot -----------------------------------------------------------------
  await configureTrust(trust.url).catch(() => undefined);
  renderTrustLine();
  tify.viewer?.addHandler?.('animation-finish', debouncedRefresh);
  unsubscribe = onPagesChange(tify, () => {
    refresh();
    void updateServiceLine();
  });
  refresh();
  void updateServiceLine();

  return {
    async setTrustAnchorsUrl(url: string | null): Promise<void> {
      if (trustInput) trustInput.value = url ?? '';
      await applyTrustUrl(url);
    },
    refresh,
    destroy() {
      disposed = true;
      runId += 1;
      aborter?.abort();
      unsubscribe?.();
      dock?.destroy();
      try {
        tify.viewer?.removeHandler?.('animation-finish', debouncedRefresh);
      } catch {
        // Ignore teardown races.
      }
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
