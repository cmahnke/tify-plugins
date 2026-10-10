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
  const items = manifest?.items ?? manifest?.sequences?.[0]?.canvases ?? [];
  for (const canvas of items) {
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
  const items = manifest?.items ?? manifest?.sequences?.[0]?.canvases ?? [];
  const canvas = items[page - 1];
  if (!canvas) return [];
  const annotations = canvas?.annotations ?? [];
  return (annotations as any[]).flatMap((entry): AnnotationRef[] => {
    if (Array.isArray(entry?.items)) return [{ items: entry.items }];
    const id = entry?.id ?? entry?.['@id'];
    if (typeof id === 'string') return [{ id }];
    return [];
  });
}

async function fetchPageItems(ref: AnnotationRef): Promise<any[]> {
  if (ref.items) return ref.items;
  if (!ref.id) return [];
  const cached = annotationCache.get(ref.id);
  if (cached) return cached;
  const doc = await fetchJson(ref.id);
  // Direct AnnotationPage, or a Collection of pages (one level, v1 scope).
  let items: any[] = [];
  if (Array.isArray(doc?.items)) {
    const nested = doc.items.filter((entry: any) => entry?.type === 'AnnotationPage');
    if (doc?.type === 'AnnotationPage' || nested.length === 0) {
      items = doc.items;
    } else {
      const pages = await Promise.all(
        nested.slice(0, 5).map(async (entry: any) => {
          try {
            const sub = await fetchJson(entry.id ?? entry['@id']);
            return Array.isArray(sub?.items) ? sub.items : [];
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
  const items = manifest?.items ?? manifest?.sequences?.[0]?.canvases ?? [];
  const canvas = items[page - 1];
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
      if (motivations.includes('painting')) continue;
      if (xywhFragmentOf(entry.target) === null) continue;
      collected.push(entry);
    }
  }
  return { canvasId, annotations: collected };
}

/** Short human-readable summary of W3C bodies for list rows. */
export function summarizeBodies(annotation: any, fallback: string): string {
  const bodies =
    annotation?.body === undefined
      ? []
      : Array.isArray(annotation.body)
        ? annotation.body
        : [annotation.body];
  const texts: string[] = [];
  for (const body of bodies) {
    if (!body) continue;
    if (typeof body === 'string') {
      texts.push(body);
      continue;
    }
    if (typeof body.value === 'string' && body.value.trim() !== '') {
      texts.push(body.value);
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
