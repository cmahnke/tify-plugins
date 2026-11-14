// GeoJSON (navPlace) types and geometry helpers shared by the plugin and
// the lazy map module. Coordinates are WGS84 [lng, lat] per the navPlace
// extension (RFC 7946); navPlace adopts GeoJSON unchanged.
export type NavPlacePosition = [number, number, ...number[]];

export type NavPlaceGeometry =
  | { type: 'Point'; coordinates: NavPlacePosition }
  | { type: 'MultiPoint'; coordinates: NavPlacePosition[] }
  | { type: 'LineString'; coordinates: NavPlacePosition[] }
  | { type: 'MultiLineString'; coordinates: NavPlacePosition[][] }
  | { type: 'Polygon'; coordinates: NavPlacePosition[][] }
  | { type: 'MultiPolygon'; coordinates: NavPlacePosition[][][] }
  | { type: 'GeometryCollection'; geometries: NavPlaceGeometry[] };

export interface NavPlaceFeature {
  id?: string | number;
  type: 'Feature';
  geometry?: NavPlaceGeometry | null;
  properties?: Record<string, unknown>;
}

export interface NavPlaceCollection {
  id?: string;
  type: 'FeatureCollection';
  features?: NavPlaceFeature[];
}

export interface NavPlaceFeatureCollection {
  type: 'FeatureCollection';
  features: NavPlaceFeature[];
}

/**
 * Default basemap style: OpenFreeMap (https://openfreemap.org/) — free
 * vector tiles, no API key, attribution carried by the style itself.
 */
export const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Every position of a geometry; GeometryCollections flatten recursively. */
export function positionsOf(geometry: NavPlaceGeometry | null | undefined): NavPlacePosition[] {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries ?? []).flatMap((entry) => positionsOf(entry));
  }
  return collectPositions(geometry.coordinates);
}

function collectPositions(node: unknown): NavPlacePosition[] {
  if (!Array.isArray(node) || node.length === 0) return [];
  if (typeof node[0] === 'number') return [node as NavPlacePosition];
  return node.flatMap((entry) => collectPositions(entry));
}

/** [minLng, minLat, maxLng, maxLat] of a geometry; null when unlocated. */
export function boundsOf(
  geometry: NavPlaceGeometry | null | undefined,
): [number, number, number, number] | null {
  const positions = positionsOf(geometry);
  if (positions.length === 0) return null;
  let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of positions) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Center of a geometry's bounding box; null when unlocated. */
export function centerOf(geometry: NavPlaceGeometry | null | undefined): NavPlacePosition | null {
  const bounds = boundsOf(geometry);
  if (!bounds) return null;
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

/** Union bounds over many features (or null when none is located). */
export function boundsOfFeatures(
  features: NavPlaceFeature[],
): [number, number, number, number] | null {
  let bounds: [number, number, number, number] | null = null;
  for (const feature of features) {
    const featureBounds = boundsOf(feature.geometry);
    if (!featureBounds) continue;
    if (!bounds) {
      bounds = featureBounds;
      continue;
    }
    bounds = [
      Math.min(bounds[0], featureBounds[0]),
      Math.min(bounds[1], featureBounds[1]),
      Math.max(bounds[2], featureBounds[2]),
      Math.max(bounds[3], featureBounds[3]),
    ];
  }
  return bounds;
}

/** `lng, lat` with fixed precision, for list rows and popups. */
export function formatPosition(position: NavPlacePosition): string {
  return `${position[0].toFixed(4)}, ${position[1].toFixed(4)}`;
}
