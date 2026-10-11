// Shared IIIF helpers: manifest fetching, canvas listing, and annotation
// retrieval. Presentation 2 (`sequences`/`@id`) and 3 (`items`/`id`) are both
// accepted wherever cheap to do so.
import { fetchJson, getPages } from './tify-plugin';
import type Tify from 'tify';

export interface CanvasRef {
  id: string;
  label: string;
  serviceId: string | null;
}

const manifestCache = new Map<string, any>();
const infoCache = new Map<string, any>();
const annotationCache = new Map<string, any[]>();

/** v2 type names that are never canvases (Presentation 4 containers). */
function isScene(entry: any): boolean {
  const type = entry?.type ?? entry?.['@type'];
  return type === 'Scene' || type === 'Timeline';
}

/**
 * Canvases in display order: v3/v4 `items` (minus Scene containers),
 * v2 `sequences[0].canvases`. Shared by every page-indexed lookup so page
 * numbers stay aligned across API versions.
 */
export function canvasesOf(manifest: any): any[] {
  const items = manifest?.items ?? manifest?.sequences?.[0]?.canvases ?? [];
  if (!Array.isArray(items)) return [];
  return items.filter((entry) => !isScene(entry));
}

export async function getManifest(tify: Tify): Promise<any> {
  const url = tify.options?.manifestUrl as string | undefined;
  if (!url) throw new Error('No manifestUrl set on TIFY instance');
  const cached = manifestCache.get(url);
  if (cached) return cached;
  const manifest = await fetchJson(url);
  manifestCache.set(url, manifest);
  return manifest;
}

/** Flat canvas list in display order (1-based pages). */
export function listCanvases(manifest: any): CanvasRef[] {
  const canvases: CanvasRef[] = [];
  for (const canvas of canvasesOf(manifest)) {
    let serviceId: string | null;
    try {
      const body = canvas?.items?.[0]?.items?.[0]?.body ?? canvas?.images?.[0]?.resource;
      const service = body?.service ?? body?.service?.[0];
      const svc = Array.isArray(service) ? service[0] : service;
      serviceId = (svc?.id ?? svc?.['@id'] ?? null) as string | null;
    } catch {
      serviceId = null;
    }
    const label =
      typeof canvas?.label === 'string'
        ? canvas.label
        : JSON.stringify(canvas?.label ?? canvas?.['@id'] ?? canvas?.id ?? '?');
    canvases.push({ id: String(canvas?.id ?? canvas?.['@id'] ?? ''), label, serviceId });
  }
  return canvases;
}

export async function getInfoJson(serviceId: string): Promise<any> {
  const cached = infoCache.get(serviceId);
  if (cached) return cached;
  const base = serviceId.endsWith('/') ? serviceId : `${serviceId}/`;
  const info = await fetchJson(`${base}info.json`);
  infoCache.set(serviceId, info);
  return info;
}

/** info.json for the first currently visible page (via manifest parsing). */
export async function getInfoJsonForCurrentPage(
  tify: Tify,
): Promise<{ info: any; page: number; serviceId: string } | null> {
  const pages = getPages(tify).filter((page) => page > 0);
  if (pages.length === 0) return null;
  const manifest = await getManifest(tify);
  const canvases = listCanvases(manifest);
  const canvas = canvases[pages[0] - 1];
  if (!canvas?.serviceId) return null;
  const info = await getInfoJson(canvas.serviceId);
  return { info, page: pages[0], serviceId: canvas.serviceId };
}

/**
 * Capability URIs a service claims: v2 `profile[].supports` plus v3
 * `extraFeatures`, deduplicated. This is where placeholder URIs for
 * non-standardized features (HDR, C2PA, …) live.
 */
export function serviceSupports(infoJson: any): string[] {
  const supports: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && !supports.includes(value)) supports.push(value);
  };
  const profile = infoJson?.profile;
  if (Array.isArray(profile)) {
    for (const entry of profile) {
      if (entry && typeof entry === 'object' && Array.isArray(entry.supports)) {
        entry.supports.forEach(add);
      }
    }
  }
  if (Array.isArray(infoJson?.extraFeatures)) infoJson.extraFeatures.forEach(add);
  return supports;
}

interface AnnotationRef {
  id?: string;
  items?: any[];
}

/** Raw annotation refs of a 1-based page (embedded items or page IDs). */
export function getAnnotationRefs(manifest: any, page: number): AnnotationRef[] {
  const canvas = canvasesOf(manifest)[page - 1];
  if (!canvas) return [];
  // v3 `annotations`, v2 `otherContent` (embedded lists or bare-URI refs).
  const annotations = [...asList(canvas?.annotations), ...asList(canvas?.otherContent)];
  return (annotations as any[]).flatMap((entry): AnnotationRef[] => {
    if (typeof entry === 'string') return [{ id: entry }];
    if (Array.isArray(entry?.items)) return [{ items: entry.items }];
    if (Array.isArray(entry?.resources)) return [{ items: entry.resources }];
    const id = entry?.id ?? entry?.['@id'];
    if (typeof id === 'string') return [{ id }];
    return [];
  });
}

function asList(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

async function fetchPageItems(ref: AnnotationRef): Promise<any[]> {
  if (ref.items) return ref.items;
  if (!ref.id) return [];
  const cached = annotationCache.get(ref.id);
  if (cached) return cached;
  const doc = await fetchJson(ref.id);
  // Direct AnnotationPage (W3C `items`, OA `resources`), or a Collection
  // of pages (one level, v1 scope).
  let items: any[] = [];
  const docItems = Array.isArray(doc?.items) ? doc.items : (doc?.resources ?? []);
  if (Array.isArray(docItems)) {
    const nested = docItems.filter((entry: any) => entry?.type === 'AnnotationPage');
    if (doc?.type === 'AnnotationPage' || nested.length === 0) {
      items = docItems;
    } else {
      const pages = await Promise.all(
        nested.slice(0, 5).map(async (entry: any) => {
          try {
            const sub = await fetchJson(entry.id ?? entry['@id']);
            return Array.isArray(sub?.items) ? sub.items : (sub?.resources ?? []);
          } catch {
            return [];
          }
        }),
      );
      items = pages.flat();
    }
  }
  annotationCache.set(ref.id, items);
  return items;
}

/** Extract an `xywh=` fragment from the many W3C target shapes. */
export function xywhFragmentOf(target: unknown): string | null {
  if (typeof target === 'string') {
    const index = target.indexOf('#xywh=');
    return index >= 0 ? target.slice(index + 1) : null;
  }
  if (Array.isArray(target)) {
    for (const entry of target) {
      const found = xywhFragmentOf(entry);
      if (found) return found;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    const node = target as Record<string, any>;
    if (node.selector !== undefined) {
      const found = xywhFragmentOf(node.selector);
      if (found) return found;
    }
    const selector = node.selector;
    if (selector && typeof selector === 'object') {
      if (typeof selector.value === 'string' && selector.value.startsWith('xywh=')) {
        return selector.value as string;
      }
    }
    for (const key of ['source', 'id']) {
      if (typeof node[key] === 'string' && (node[key] as string).includes('#xywh=')) {
        return xywhFragmentOf(node[key]);
      }
    }
  }
  return null;
}

/**
 * Annotatable items of a 1-based page: non-painting annotations whose target
 * resolves to an `xywh` fragment (whole-canvas targets and SVG selectors are
 * out of scope for v1).
 */
export async function getXywhAnnotations(
  manifest: any,
  page: number,
): Promise<{ canvasId: string; annotations: any[] }> {
  const canvas = canvasesOf(manifest)[page - 1];
  const canvasId = String(canvas?.id ?? canvas?.['@id'] ?? '');
  const refs = getAnnotationRefs(manifest, page);
  const collected: any[] = [];
  for (const ref of refs) {
    let entries: any[];
    try {
      entries = await fetchPageItems(ref);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const motivations =
        entry.motivation === undefined
          ? []
          : Array.isArray(entry.motivation)
            ? entry.motivation
            : [entry.motivation];
      // v2 prefixes (`sc:painting`, `oa:commenting`) alongside bare v3 names.
      const bare = motivations.map((m: unknown) => String(m).split(':').pop());
      if (bare.includes('painting')) continue;
      // v2 targets live in `on` and ids in `@id`; normalize so downstream
      // W3C logic (fragment parsing, selection) applies unchanged.
      const needsTarget = entry.target === undefined && entry.on !== undefined;
      const needsId = entry.id === undefined && typeof entry['@id'] === 'string';
      const normalized =
        needsTarget || needsId
          ? {
              ...entry,
              ...(needsTarget ? { target: entry.on } : null),
              ...(needsId ? { id: entry['@id'] } : null),
            }
          : entry;
      if (xywhFragmentOf(normalized.target) === null) continue;
      collected.push(normalized);
    }
  }
  return { canvasId, annotations: collected };
}

/** Short human-readable summary of annotation bodies for list rows. */
export function summarizeBodies(annotation: any, fallback: string): string {
  // v3 `body`, v2 OA `resource`.
  const raw = annotation?.body ?? annotation?.resource;
  const bodies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const texts: string[] = [];
  for (const body of bodies) {
    if (!body) continue;
    if (typeof body === 'string') {
      texts.push(body);
      continue;
    }
    // v3 `value`, v2 OA `chars`.
    const text = body.value ?? body.chars;
    if (typeof text === 'string' && text.trim() !== '') {
      texts.push(text);
      continue;
    }
    if (typeof body.label === 'string' && body.label.trim() !== '') {
      texts.push(body.label);
    }
  }
  return texts.length > 0 ? texts.join(' — ') : fallback;
}

/** Current 1-based visible pages (positive only). */
export function getVisiblePages(tify: Tify): number[] {
  return getPages(tify).filter((page) => page > 0);
}
