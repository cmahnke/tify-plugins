// Lazy MapLibre viewer for the navPlace plugin.
//
// Everything MapLibre-specific lives in this module so the eager plugin
// entry stays map-free: navplace.ts dynamically imports this file only
// when the panel/map first becomes visible. That splits maplibre-gl (plus
// its worker) into its own chunk, fetched on demand — the TIFY page itself
// never pays for the map viewer unless a place map is actually shown.
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import {
  DEFAULT_MAP_STYLE,
  boundsOfFeatures,
  centerOf,
  formatPosition,
  type NavPlaceFeature,
  type NavPlaceFeatureCollection,
} from './geometry';

type MapLibreModule = typeof import('maplibre-gl');

let mapLibrePromise: Promise<MapLibreModule> | null = null;

/** Loads maplibre-gl, its CSS and the worker URL exactly once (lazy path). */
export function loadMapLibre(): Promise<MapLibreModule> {
  mapLibrePromise ??= (async () => {
    const maplibregl = await import('maplibre-gl');
    await import('maplibre-gl/dist/maplibre-gl.css');
    // Vite bundles the worker and emits its URL next to this module, so an
    // installed package resolves it from its own dist/ directory.
    const { default: workerUrl } =
      await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
    maplibregl.setWorkerUrl(new URL(workerUrl, import.meta.url).toString());
    return maplibregl;
  })();
  mapLibrePromise.catch(() => {
    mapLibrePromise = null;
  });
  return mapLibrePromise;
}

export interface PlaceMapOptions {
  container: HTMLElement;
  /** MapLibre style URL or inline style; default: OpenFreeMap Liberty. */
  style?: string | StyleSpecification;
  /**
   * Explicit initial camera. When absent, the map fits the initial
   * features (single points are capped to a sane zoom).
   */
  center?: [number, number];
  zoom?: number;
  /** fitBounds padding in px (default 40). */
  fitBoundsPadding?: number;
  initialFeatures: NavPlaceFeature[];
}

export interface PlaceMap {
  /** Replace the shown places; re-fits the camera when the set changes. */
  update(features: NavPlaceFeature[]): Promise<void>;
  /** Camera flight to one feature (index into the last update() call). */
  flyToPlace(index: number): void;
  destroy(): void;
}

const SOURCE_ID = 'navplace';
const FILL_LAYER = 'navplace-fill';
const LINE_LAYER = 'navplace-line';
const POINT_LAYER = 'navplace-point';
const LAYER_IDS = [FILL_LAYER, LINE_LAYER, POINT_LAYER];
const ACCENT = '#005f9e';
const DEFAULT_PADDING = 40;
const LOAD_TIMEOUT_MS = 30_000;
/** Cap for zero-area bounds (single points) so they don't overzoom. */
const MAX_FIT_ZOOM = 12;

function collectionOf(features: NavPlaceFeature[]): NavPlaceFeatureCollection {
  return { type: 'FeatureCollection', features };
}

function fingerprintOf(features: NavPlaceFeature[]): string {
  return features.map((feature) => String(feature.id ?? '')).join('|');
}

/** Whether all bounds collapse to one point (zoom cap, plain flight). */
function isPointBounds(bounds: [number, number, number, number]): boolean {
  return bounds[0] === bounds[2] && bounds[1] === bounds[3];
}

/**
 * The map constructor throws on a zero-size container (hidden panels); the
 * dock unhides before this runs, so a few frames is plenty — 2 s backstop.
 */
async function waitLaidOut(container: HTMLElement): Promise<void> {
  const deadline = Date.now() + 2000;
  while (container.offsetWidth === 0 || container.offsetHeight === 0) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

export async function createPlaceMap(options: PlaceMapOptions): Promise<PlaceMap> {
  const maplibregl = await loadMapLibre();
  await waitLaidOut(options.container);

  const map = new maplibregl.Map({
    container: options.container,
    style: options.style ?? DEFAULT_MAP_STYLE,
    center: options.center ?? [0, 0],
    zoom: options.zoom ?? 1,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // Style load: resolve on 'load', reject on the first pre-load error
  // (unreachable style, missing WebGL) with a timeout backstop.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Map style did not load'));
    }, LOAD_TIMEOUT_MS);
    map.once('load', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    });
    map.on('error', (event) => {
      if (settled || !event?.error) return;
      settled = true;
      window.clearTimeout(timer);
      reject(event.error);
    });
  }).catch(async (error: unknown) => {
    try {
      map.remove();
    } catch {
      // Teardown races are irrelevant now.
    }
    throw error;
  });

  map.addSource(SOURCE_ID, { type: 'geojson', data: collectionOf(options.initialFeatures) });
  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    paint: { 'fill-color': ACCENT, 'fill-opacity': 0.15 },
  });
  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: SOURCE_ID,
    paint: { 'line-color': ACCENT, 'line-width': 2 },
  });
  map.addLayer({
    id: POINT_LAYER,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': 6,
      'circle-color': ACCENT,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  let features = options.initialFeatures;
  let fingerprint = fingerprintOf(features);
  const padding = options.fitBoundsPadding ?? DEFAULT_PADDING;

  const fitTo = (bounds: [number, number, number, number]): void => {
    if (isPointBounds(bounds)) {
      map.flyTo({ center: [bounds[0], bounds[1]], zoom: Math.max(map.getZoom(), MAX_FIT_ZOOM) });
      return;
    }
    map.fitBounds(bounds, { padding, maxZoom: MAX_FIT_ZOOM });
  };
  const initialBounds = boundsOfFeatures(features);
  if (initialBounds && options.center === undefined && options.zoom === undefined) {
    fitTo(initialBounds);
  }

  // Popups: label (resolved at sync time) plus a coordinates readout. The
  // content is built as DOM (no innerHTML) — feature labels come from the
  // manifest and must never be parsed as markup.
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '18rem' });
  const showPopup = (event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0] as NavPlaceFeature | undefined;
    if (!feature) return;
    const host = document.createElement('div');
    host.className = 'navplace-popup';
    const label = document.createElement('strong');
    label.textContent = String(feature.properties?.label ?? '');
    host.append(label);
    const position = centerOf(feature.geometry ?? null);
    if (position) {
      const coords = document.createElement('span');
      coords.className = 'navplace-popup-coords';
      coords.textContent = formatPosition(position);
      host.append(coords);
    }
    popup.setLngLat(event.lngLat).setDOMContent(host).addTo(map);
  };
  for (const id of LAYER_IDS) {
    map.on('mouseenter', id, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', id, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('click', id, showPopup);
  }

  let destroyed = false;
  const source = (): GeoJSONSource | undefined =>
    map.getSource(SOURCE_ID) as GeoJSONSource | undefined;

  return {
    async update(next: NavPlaceFeature[]): Promise<void> {
      if (destroyed) return;
      const nextFingerprint = fingerprintOf(next);
      const changed = nextFingerprint !== fingerprint;
      fingerprint = nextFingerprint;
      features = next;
      source()?.setData(collectionOf(next));
      if (changed) {
        const bounds = boundsOfFeatures(next);
        if (bounds) fitTo(bounds);
      }
    },
    flyToPlace(index: number): void {
      if (destroyed) return;
      const feature = features[index];
      if (!feature) return;
      const bounds = boundsOfFeatures([feature]);
      if (bounds) fitTo(bounds);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      popup.remove();
      map.remove();
    },
  };
}
