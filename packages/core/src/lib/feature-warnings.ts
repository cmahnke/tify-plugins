// Missing-plugin warnings: when a manifest or image service advertises a
// feature (TEI, annotations, score, HDR, C2PA) but the plugin that handles
// it was never loaded, say so in the console.
//
// The check runs on core's load path (getManifest/getInfoJson), so it fires
// for every consumer — any plugin package or the host itself. Plugins
// register themselves to silence their own warning; the registry is
// refcounted because plugins are destroyed and re-created on reloads.
import { canvasesOf } from './iiif';
import { describeCanvas, describeImageFeatures } from './features';

/** Plugin packages that consume a detected feature (npm name suffix). */
export type PluginId = 'image-overlays' | 'annotorious' | 'musicxml' | 'hdr' | 'c2pa';

const MODULE_OF: Record<PluginId, string> = {
  'image-overlays': '@projektemacher/tify-plugin-image-overlays',
  annotorious: '@projektemacher/tify-plugin-annotorious',
  musicxml: '@projektemacher/tify-plugin-musicxml',
  hdr: '@projektemacher/tify-plugin-hdr',
  c2pa: '@projektemacher/tify-plugin-c2pa',
};

/** What each plugin handles, for the warning text. */
const HANDLES: Record<PluginId, string> = {
  'image-overlays': 'TEI transcription',
  annotorious: 'annotations',
  musicxml: 'MusicXML score',
  hdr: 'HDR',
  c2pa: 'C2PA provenance',
};

const refcount = new Map<PluginId, number>();

/** Warn nothing before the first check; hosts may disable it entirely. */
let enabled = true;

/** Register a plugin instance. Returns a disposer for `destroy()`. */
export function registerPlugin(id: PluginId): () => void {
  refcount.set(id, (refcount.get(id) ?? 0) + 1);
  return () => unregisterPlugin(id);
}

export function unregisterPlugin(id: PluginId): void {
  const count = refcount.get(id) ?? 0;
  if (count <= 1) refcount.delete(id);
  else refcount.set(id, count - 1);
}

/** Currently registered plugins (at least one live instance). */
export function activePlugins(): PluginId[] {
  return [...refcount.keys()];
}

/**
 * Master switch for hosts that deliberately ship without a plugin for a
 * feature. Defaults to on: warnings are dev-facing diagnostics, and the
 * console is where a missing plugin is actually actionable.
 */
export function setFeatureWarnings(value: boolean): void {
  enabled = value;
}

/** Warned source+plugin pairs, so repeated loads stay silent. */
const warned = new Set<string>();

function warn(id: PluginId, sourceUrl: string, detail: string): void {
  const key = `${id}@${sourceUrl}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[tify-plugins] ${sourceUrl} advertises ${HANDLES[id]} (${detail}), but ${MODULE_OF[id]} is not loaded`,
  );
}

/** Which feature plugins a manifest needs but has no owner. */
export function missingPluginsForManifest(manifest: any): Array<[PluginId, string]> {
  const missing: Array<[PluginId, string]> = [];
  const wanted: Record<string, string[]> = {};
  const canvases = canvasesOf(manifest);
  // Scan every canvas, not just the visible one: features are manifest-wide.
  for (let page = 1; page <= canvases.length; page += 1) {
    let features: ReturnType<typeof describeCanvas>;
    try {
      features = describeCanvas(manifest, page);
    } catch {
      continue;
    }
    if (features.tei !== 'none') {
      (wanted['image-overlays'] ??= []).push(`page ${page}`);
      if (features.tei === 'manifest') break; // manifest-wide, no further pages
    }
    if (features.annotations !== 'none') (wanted.annotorious ??= []).push(`page ${page}`);
    if (features.musicXml) (wanted.musicxml ??= []).push(`page ${page}`);
  }
  for (const [id, pages] of Object.entries(wanted)) {
    if (refcount.has(id as PluginId)) continue;
    const detail = pages.length > 2 ? `pages ${pages.length}` : pages.join(', ');
    missing.push([id as PluginId, detail]);
  }
  return missing;
}

/** Which feature plugins an image service needs but has no owner. */
export function missingPluginsForImage(infoJson: any): PluginId[] {
  const missing: PluginId[] = [];
  let features: ReturnType<typeof describeImageFeatures>;
  try {
    features = describeImageFeatures(infoJson);
  } catch {
    return missing;
  }
  if (features.hdrAdvertised) missing.push('hdr');
  if (features.c2paAdvertised) missing.push('c2pa');
  return missing.filter((id) => !refcount.has(id));
}

/**
 * Called from core's load path after a manifest fetch. Never throws: a
 * diagnostic must not break the caller's manifest load.
 */
export function checkManifestFeatures(url: string, manifest: any): void {
  if (!enabled) return;
  try {
    for (const [id, detail] of missingPluginsForManifest(manifest)) warn(id, url, detail);
  } catch {
    // Feature sniffing stays best-effort.
  }
}

/** Called from core's load path after an info.json fetch. Never throws. */
export function checkImageFeatures(serviceId: string, infoJson: any): void {
  if (!enabled) return;
  try {
    for (const id of missingPluginsForImage(infoJson)) warn(id, serviceId, 'service advertised');
  } catch {
    // Feature sniffing stays best-effort.
  }
}
