// TEI word-coordinate support for image overlays.
//
// Best-practice wiring (TEI P5 ch. 12 + IIIF Presentation):
// - Geometry lives in TEI `<facsimile>` → `<surface lrx/lry>` (own pixel
//   space) → `<zone ulx/uly/lrx/lry>` (rectangles; `@points` for polygons),
//   linked from the transcription via `@facs` (`<w facs="#z1">`).
// - The TEI document is referenced page-level via canvas `seeAlso`
//   (`format: application/tei+xml`), falling back to manifest `seeAlso`.
//   Relative URLs resolve against the manifest URL. Static-file friendly:
//   everything is fetched and parsed in the browser, no server component.
//
// This module converts that into canvas-pixel boxes; rendering stays in
// image-overlays.ts. Book view keeps the repo-wide first-page-only limit.
import { canvasesOf } from '@projektemacher/tify-plugin-core';

export interface TeiWordBox {
  /** Word/line text (hover preview). */
  text: string;
  /** Canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TeiPage {
  canvasId: string;
  page: number;
  boxes: TeiWordBox[];
  level: 'word' | 'line';
}

export interface TeiOptions {
  /** Box granularity; falls back to the other level when empty. */
  level?: 'word' | 'line';
  /** Max boxes per page (default 2000). */
  maxWords?: number;
}

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const DEFAULT_MAX_WORDS = 2000;

/** Elements by local name, with or without the TEI namespace. */
function elsByLocal(root: ParentNode, name: string): Element[] {
  const node = root as ParentNode & {
    getElementsByTagNameNS?: (ns: string, qualifiedName: string) => HTMLCollectionOf<Element>;
    getElementsByTagName?: (qualifiedName: string) => HTMLCollectionOf<Element>;
  };
  if (typeof node.getElementsByTagNameNS === 'function') {
    const namespaced = Array.from(node.getElementsByTagNameNS(TEI_NS, name));
    if (namespaced.length > 0) return namespaced;
  }
  if (typeof node.getElementsByTagName === 'function') {
    return Array.from(node.getElementsByTagName(name)).filter(
      (el) => el.localName === name && el.namespaceURI !== TEI_NS,
    );
  }
  return [];
}

function num(value: string | null): number {
  if (value === null || value === '') return Number.NaN;
  return Number(value);
}

/** Bounding box of a TEI `@points` polygon ("x1,y1 x2,y2 ..."). */
function pointsBbox(points: string): { x: number; y: number; w: number; h: number } | null {
  const coords = points
    .trim()
    .split(/[\s,;]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (coords.length < 4 || coords.length % 2 !== 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    xs.push(coords[i]);
    ys.push(coords[i + 1]);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Strip IIIF Image API request suffixes so graphic URLs compare with canvas IDs. */
function stripIiifSuffix(url: string): string {
  return url
    .split('#')[0]
    .split('?')[0]
    .replace(/\/info\.json\/?$/, '')
    .replace(
      /\/(full|max|square|pct:[^/]+|[0-9.,]+)\/([^/]+)\/([0-9.]+|max|full)\/[^/]+\.[a-z0-9]+$/i,
      '',
    )
    .replace(/\/$/, '');
}

function sameImage(a: string, b: string): boolean {
  if (!a || !b) return false;
  const cleanA = stripIiifSuffix(a);
  const cleanB = stripIiifSuffix(b);
  return cleanA === cleanB || cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA);
}

function facsId(ref: string | null): string | null {
  if (!ref) return null;
  const first = ref.trim().split(/\s+/)[0];
  if (!first) return null;
  const hash = first.lastIndexOf('#');
  const id = (hash >= 0 ? first.slice(hash + 1) : first).trim();
  return id === '' ? null : id;
}

interface TeiRef {
  url: string;
}

function seeAlsoRefs(node: any): Array<{ id: string; format: string }> {
  const raw = node?.seeAlso;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const refs: Array<{ id: string; format: string }> = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      refs.push({ id: entry, format: '' });
    } else if (entry && typeof entry === 'object') {
      const id = entry.id ?? entry['@id'];
      if (typeof id === 'string') refs.push({ id, format: String(entry.format ?? '') });
    }
  }
  return refs;
}

function isTeiRef(ref: { id: string; format: string }): boolean {
  if (/tei/i.test(ref.format)) return true;
  const path = ref.id.split('#')[0].split('?')[0].toLowerCase();
  return path.endsWith('.xml') || path.endsWith('.tei');
}

/** Absolute TEI URL from canvas (preferred) or manifest `seeAlso`. */
function resolveTeiUrl(manifest: any, page: number, base: string): TeiRef | null {
  const canvas = canvasesOf(manifest)[page - 1];
  const candidates = [...(canvas ? seeAlsoRefs(canvas) : []), ...seeAlsoRefs(manifest)];
  for (const ref of candidates) {
    if (!isTeiRef(ref)) continue;
    try {
      // Strip XPointer fragments for fetching; a bare #id pre-selects a surface.
      const url = new URL(ref.id.split('#xpointer')[0], base).toString();
      return { url };
    } catch {
      continue;
    }
  }
  return null;
}

function paintingBodyId(canvas: any): string {
  const body = canvas?.items?.[0]?.items?.[0]?.body ?? canvas?.images?.[0]?.resource;
  const id = body?.id ?? body?.['@id'];
  return typeof id === 'string' ? id : '';
}

/**
 * Words (or lines) of one canvas in canvas pixels. Returns null when no TEI
 * is referenced, unparsable, or yields no boxes — callers fall back.
 */
export async function fetchTeiPage(
  manifest: any,
  manifestUrl: string,
  page: number,
  options: TeiOptions = {},
): Promise<TeiPage | null> {
  const level = options.level ?? 'word';
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;

  const canvas = canvasesOf(manifest)[page - 1];
  if (!canvas) return null;
  const canvasId = String(canvas?.id ?? canvas?.['@id'] ?? '');
  const canvasW = Number(canvas?.width ?? Number.NaN);
  const canvasH = Number(canvas?.height ?? Number.NaN);

  const teiRef = resolveTeiUrl(manifest, page, manifestUrl);
  if (!teiRef) {
    console.debug('[tify-plugins] image-overlays: no TEI seeAlso for page', page);
    return null;
  }

  let xml: Document;
  try {
    const response = await fetch(teiRef.url);
    if (!response.ok) return null;
    const text = await response.text();
    const parsed = new DOMParser().parseFromString(text, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length > 0) return null;
    xml = parsed;
  } catch {
    return null;
  }

  const surfaces = elsByLocal(xml, 'surface');
  if (surfaces.length === 0) {
    console.debug('[tify-plugins] image-overlays: TEI has no surfaces', teiRef.url);
    return null;
  }

  const imageUrl = paintingBodyId(canvas);
  let surface = surfaces.find((surfaceEl) => {
    const graphic = elsByLocal(surfaceEl, 'graphic')[0];
    const url = graphic?.getAttribute('url') ?? graphic?.getAttribute('src') ?? '';
    return sameImage(url, imageUrl);
  });

  if (!surface) {
    // Fallback: <pb facs> order, then positional (n-th surface ↔ n-th canvas).
    const pbs = elsByLocal(xml, 'pb');
    const pbSurfaceId = pbs[page - 1] ? facsId(pbs[page - 1].getAttribute('facs')) : null;
    surface =
      (pbSurfaceId && surfaces.find((el) => el.getAttribute('xml:id') === pbSurfaceId)) ||
      surfaces[Math.min(page - 1, surfaces.length - 1)];
    console.debug('[tify-plugins] image-overlays: surface matched by order, not graphic URL');
  }

  const lrx = num(surface.getAttribute('lrx'));
  const lry = num(surface.getAttribute('lry'));
  const scaleX = Number.isFinite(lrx) && lrx > 0 && Number.isFinite(canvasW) ? canvasW / lrx : 1;
  const scaleY = Number.isFinite(lry) && lry > 0 && Number.isFinite(canvasH) ? canvasH / lry : 1;

  const zones = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const zone of elsByLocal(surface, 'zone')) {
    const id = zone.getAttribute('xml:id');
    if (!id) continue;
    const ulx = num(zone.getAttribute('ulx'));
    const uly = num(zone.getAttribute('uly'));
    const zoneLrx = num(zone.getAttribute('lrx'));
    const zoneLry = num(zone.getAttribute('lry'));
    if ([ulx, uly, zoneLrx, zoneLry].every(Number.isFinite) && zoneLrx > ulx && zoneLry > uly) {
      zones.set(id, { x: ulx, y: uly, w: zoneLrx - ulx, h: zoneLry - uly });
      continue;
    }
    const bbox = zone.getAttribute('points')
      ? pointsBbox(zone.getAttribute('points') as string)
      : null;
    if (bbox && bbox.w > 0 && bbox.h > 0) zones.set(id, bbox);
  }

  const collect = (tagNames: string[]): TeiWordBox[] => {
    const boxes: TeiWordBox[] = [];
    for (const tag of tagNames) {
      for (const el of elsByLocal(xml, tag)) {
        if (boxes.length >= maxWords) return boxes;
        const zone = zones.get(facsId(el.getAttribute('facs')) ?? '');
        if (!zone) continue;
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (text === '') continue;
        boxes.push({
          text,
          x: zone.x * scaleX,
          y: zone.y * scaleY,
          w: zone.w * scaleX,
          h: zone.h * scaleY,
        });
      }
    }
    return boxes;
  };

  // Document scope: only the current surface's zones are in the map, and
  // words link to zones by id, so collection is inherently page-scoped.
  let boxes = level === 'word' ? collect(['w']) : collect(['l', 'line']);
  let usedLevel: 'word' | 'line' = level;
  if (boxes.length === 0) {
    usedLevel = level === 'word' ? 'line' : 'word';
    boxes = usedLevel === 'word' ? collect(['w']) : collect(['l', 'line']);
  }
  if (boxes.length === 0) {
    console.debug('[tify-plugins] image-overlays: TEI has no linkable words/lines', teiRef.url);
    return null;
  }
  return { canvasId, page, boxes, level: usedLevel };
}

const teiCache = new Map<string, Promise<TeiPage | null>>();

/** Cached per canvas; pass the same manifest object within a session. */
export function fetchTeiPageCached(
  manifest: any,
  manifestUrl: string,
  page: number,
  options: TeiOptions = {},
): Promise<TeiPage | null> {
  const key = `${manifestUrl}#page=${page}`;
  const cached = teiCache.get(key);
  if (cached) return cached;
  const pending = fetchTeiPage(manifest, manifestUrl, page, options).catch(() => null);
  teiCache.set(key, pending);
  return pending;
}
