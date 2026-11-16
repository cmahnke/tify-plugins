// navPlace map plugin for TIFY.
//
// Renders the places a manifest advertises via the IIIF navPlace extension
// (https://iiif.io/api/extension/navplace/) on a vector-tile map. The
// manifest-level FeatureCollection is always shown; canvases may carry
// their own navPlace, whose features appear while the page is visible.
// The basemap is a MapLibre GL JS vector-tile style, configurable via the
// `style` option and defaulting to OpenFreeMap (https://openfreemap.org/).
//
// The map viewer is lazy: this entry only builds panel DOM (and syncs
// place data from the cached manifest); MapLibre, its CSS and its worker
// load in a separate chunk the first time the map becomes visible — an
// opened dock or, in sidecar mode, the panel entering the viewport.
import type Tify from 'tify';
import type { StyleSpecification } from 'maplibre-gl';
import {
  canvasesOf,
  createSidePanel,
  detachedSidePanel,
  fetchJson,
  getManifest,
  getVisiblePages,
  onPagesChange,
  resolvePanelHost,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from '@projektemacher/tify-plugin-core';
import { createTranslator, registerPlugin } from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';
import {
  boundsOfFeatures,
  centerOf,
  formatPosition,
  type NavPlaceCollection,
  type NavPlaceFeature,
  type NavPlacePosition,
} from './geometry';
import type { PlaceMap } from './map-viewer';
import './navplace.css';

export interface NavPlaceOptions {
  /**
   * Panel content host (sidecar unless docked into the viewer). Omit to let
   * the plugin create its own host next to the viewer — no page markup
   * required. `null` disables the panel (plugin becomes a no-op).
   */
  panelEl?: HTMLElement | null;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  dock?: boolean | 'auto';
  /** Open the docked panel after init (default true). */
  autoOpen?: boolean;
  /**
   * Basemap style: MapLibre style URL or inline style object.
   * Default: https://tiles.openfreemap.org/styles/liberty (OpenFreeMap).
   */
  style?: string | StyleSpecification;
  /**
   * navPlace override: an embedded FeatureCollection object, or a URL to
   * one. Without it the manifest (plus visible canvases) is the source.
   */
  navPlace?: NavPlaceCollection | string;
  /** Explicit initial camera; both parts default to fitting the features. */
  center?: [number, number];
  zoom?: number;
  /** fitBounds padding in px (default 40). */
  fitBoundsPadding?: number;
}

export interface NavPlacePlugin extends TifyPlugin {
  refresh(): void;
  /** The live map viewer, or null while it is not (yet) loaded. */
  getMap(): Promise<PlaceMap | null>;
}

/** One mappable place, with its label resolved for the current language. */
export interface PlaceEntry {
  /** Stable id for map data diffing (synthetic when the feature has none). */
  id: string;
  feature: NavPlaceFeature;
  label: string;
}

/** First string of an IIIF language map value / array / plain string. */
function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  return null;
}

/** Resolves a feature label: IIIF language map, GeoJSON name/title, index. */
function labelOf(properties: unknown, lang: 'de' | 'en'): string | null {
  if (!properties || typeof properties !== 'object') return null;
  const record = properties as Record<string, unknown>;
  const map = record.label;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const languageMap = map as Record<string, unknown>;
    const found = firstString(languageMap[lang]) ?? firstString(languageMap.en);
    if (found) return found;
  }
  return firstString(map) ?? firstString(record.name) ?? firstString(record.title);
}

/** The collection itself, or the referenced one fetched by id (spec §2.1). */
async function dereferenceCollection(value: unknown): Promise<NavPlaceCollection> {
  if (!value || typeof value !== 'object') return { type: 'FeatureCollection', features: [] };
  const collection = value as NavPlaceCollection;
  if (Array.isArray(collection.features)) return collection;
  if (typeof collection.id === 'string') return await fetchJson(collection.id);
  return { ...collection, features: [] };
}

/**
 * All features the plugin should show: the option override, else the
 * manifest navPlace plus the visible pages' canvas navPlace features.
 */
async function collectFeatures(tify: Tify, options: NavPlaceOptions): Promise<NavPlaceFeature[]> {
  const override = options.navPlace;
  if (override != null) {
    const collection = typeof override === 'string' ? await fetchJson(override) : override;
    return [...((await dereferenceCollection(collection)).features ?? [])];
  }
  const manifest = await getManifest(tify);
  const features: NavPlaceFeature[] = [
    ...((await dereferenceCollection(manifest?.navPlace)).features ?? []),
  ];
  for (const page of getVisiblePages(tify)) {
    const navPlace = canvasesOf(manifest)[page - 1]?.navPlace;
    if (!navPlace) continue;
    features.push(...((await dereferenceCollection(navPlace)).features ?? []));
  }
  return features;
}

/** Map-source copy of a place: the resolved label rides on properties. */
function sourceFeatureOf(entry: PlaceEntry): NavPlaceFeature {
  return {
    ...entry.feature,
    properties: { ...entry.feature.properties, label: entry.label },
  };
}

/** Is the map host laid out right now (never inside a hidden panel)? */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

export async function navPlacePlugin(
  tify: Tify,
  options: NavPlaceOptions,
): Promise<NavPlacePlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { lang, t } = await createTranslator(tify, { de });
  // Silence core's missing-plugin warning for the features this plugin owns.
  const unregister = registerPlugin('navplace');
  const { host, owned } = resolvePanelHost(tify, 'navplace', options.panelEl);
  const panel: SidePanel = host ? createSidePanel(host, t('Places')) : detachedSidePanel();

  const mapEl = document.createElement('div');
  mapEl.className = 'navplace-map';
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute('aria-label', t('Places map'));
  const list = document.createElement('ul');
  list.className = 'navplace-list';
  panel.body.append(mapEl, list);

  let disposed = false;
  let syncToken = 0;
  let unsubscribe: (() => void) | null = null;
  let currentEntries: PlaceEntry[] = [];
  let viewer: PlaceMap | null = null;
  let viewerPromise: Promise<PlaceMap | null> | null = null;
  let io: IntersectionObserver | null = null;

  /** Loads the lazy map chunk and creates the viewer (once, on demand). */
  const ensureMap = (): void => {
    if (viewerPromise || disposed) return;
    panel.status.textContent = t('Loading map…');
    viewerPromise = (async () => {
      const { createPlaceMap } = await import('./map-viewer');
      if (disposed) return null;
      return createPlaceMap({
        container: mapEl,
        style: options.style,
        center: options.center,
        zoom: options.zoom,
        fitBoundsPadding: options.fitBoundsPadding,
        initialFeatures: currentEntries.map(sourceFeatureOf),
      });
    })();
    void viewerPromise
      .then((placeMap) => {
        if (disposed) {
          placeMap?.destroy();
          return;
        }
        if (!placeMap) return;
        viewer = placeMap;
        panel.status.textContent = '';
        void viewer.update(currentEntries.map(sourceFeatureOf));
      })
      .catch((error: unknown) => {
        if (disposed) return;
        panel.status.textContent = t('Map unavailable: {error}', { error: String(error) });
      });
  };

  const renderList = (): void => {
    list.replaceChildren();
    currentEntries.forEach((entry, index) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'navplace-row';
      button.title = t('Fly to this place');
      const label = document.createElement('span');
      label.className = 'navplace-row-label';
      label.textContent = entry.label;
      button.append(label);
      const position: NavPlacePosition | null = centerOf(entry.feature.geometry);
      if (position) {
        const coords = document.createElement('span');
        coords.className = 'navplace-row-coords';
        coords.textContent = formatPosition(position);
        button.append(coords);
      }
      button.addEventListener('click', () => {
        viewer?.flyToPlace(index);
      });
      row.append(button);
      list.append(row);
    });
  };

  const sync = async (): Promise<void> => {
    syncToken += 1;
    const token = syncToken;
    list.replaceChildren();
    panel.status.textContent = t('Loading places…');
    try {
      const features = await collectFeatures(tify, options);
      if (disposed || token !== syncToken) return;
      currentEntries = [];
      features.forEach((feature, index) => {
        if (boundsOfFeatures([feature]) === null) return; // unlocated (null geometry)
        const label = labelOf(feature.properties, lang) ?? t('Place {n}', { n: index + 1 });
        currentEntries.push({
          id: String(feature.id ?? `place-${index + 1}`),
          feature,
          label,
        });
      });
      renderList();
      panel.status.textContent = currentEntries.length === 0 ? t('No places in this manifest') : '';
      // Load the map only when it can actually be seen: the dock opens the
      // panel (onToggle), the sidecar loads when it enters the viewport.
      if (viewerPromise || currentEntries.length === 0) return;
      if (dock ? dock.isOpen() : isVisible(mapEl)) ensureMap();
    } catch (error) {
      if (disposed || token !== syncToken) return;
      panel.status.textContent = t('Places unavailable: {error}', { error: String(error) });
    }
  };

  const dock: DockHandle | null = host
    ? dockPanel({
        tify,
        id: 'navplace',
        label: t('Places'),
        iconSvg: DOCK_ICONS.globe,
        contentEl: host,
        contentOwned: owned,
        mode: options.dock,
        onToggle: (open) => {
          if (open && currentEntries.length > 0) ensureMap();
        },
      })
    : null;
  if (options.autoOpen !== false) dock?.open();

  // Sidecar fallback: load the map when the panel scrolls into view.
  if (host && !dock && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (currentEntries.length === 0 || viewerPromise) return;
      ensureMap();
      io?.disconnect();
    });
    io.observe(mapEl);
  }

  unsubscribe = onPagesChange(tify, () => {
    void sync();
  });
  await sync();

  return {
    refresh(): void {
      if (disposed) return;
      void sync();
    },
    async getMap(): Promise<PlaceMap | null> {
      return viewer ?? (await viewerPromise) ?? null;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      syncToken += 1;
      io?.disconnect();
      unsubscribe?.();
      viewer?.destroy();
      void viewerPromise?.then((placeMap) => placeMap?.destroy()).catch(() => undefined);
      unregister();
      dock?.destroy();
      if (host) {
        host.classList.remove('tify-plugin-panel');
        host.innerHTML = '';
        if (owned) host.remove();
      }
    },
  };
}
