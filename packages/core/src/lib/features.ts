// Feature detection over IIIF JSON: which plugin-relevant features a
// manifest and its image services advertise. Presence-only — linked
// resources (TEI, annotation pages, scores, tiles) are never fetched.
// Pure functions over JSON (no TIFY/DOM), so panels and tests share them.
//
// NOTE: the placeholder capability URIs below mirror the ones owned by
// plugin-hdr (`HDR_PROFILE_URI`) and plugin-c2pa (`C2PA_PROFILE_URI`).
// They are duplicated here (not imported) because core cannot depend on
// sibling plugin packages; keep the three copies in sync.
import { canvasesOf } from './iiif';

/** Placeholder URI used in info.json `profile[].supports` to signal HDR. */
export const HDR_PROFILE_URI = 'https://christianmahnke.de/iiif/hdr/';

/** Placeholder URI used in info.json `profile[].supports` to signal C2PA. */
export const C2PA_PROFILE_URI = 'https://christianmahnke.de/iiif/c2pa/';

export type PresentationVersion = '2' | '3' | '4' | 'unknown';

export interface ManifestDescription {
  version: PresentationVersion;
  /** Number of canvases in display order (Scene containers excluded). */
  canvasCount: number;
}

/** IIIF Presentation version + canvas count (best effort, never throws). */
export function describeManifest(manifest: any): ManifestDescription {
  if (!manifest || typeof manifest !== 'object') return { version: 'unknown', canvasCount: 0 };
  const context = JSON.stringify(manifest['@context'] ?? '');
  const items = manifest?.items;
  const sequences = manifest?.sequences;
  let version: PresentationVersion = 'unknown';
  if (Array.isArray(items) || context.includes('/presentation/4')) {
    // v4 reuses the v3 2D model (plus 3D Scenes, filtered in canvasesOf).
    version = context.includes('/presentation/4') ? '4' : '3';
  } else if (Array.isArray(sequences) || context.includes('/presentation/2')) {
    version = '2';
  }
  return { version, canvasCount: canvasesOf(manifest).length };
}

function asList(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** TEI references (`format` mentions TEI, or an `.xml`/`.tei` id). */
function isTeiRef(entry: any): boolean {
  const id = typeof entry === 'string' ? entry : (entry?.id ?? entry?.['@id']);
  if (typeof id !== 'string') return false;
  const format = typeof entry === 'object' ? String(entry?.format ?? '') : '';
  if (/tei/i.test(format)) return true;
  const path = id.split('#')[0].split('?')[0].toLowerCase();
  return path.endsWith('.xml') || path.endsWith('.tei');
}

/** MusicXML score references (format mentions musicxml, or an `.musicxml` id). */
function isMusicXmlRef(entry: any): boolean {
  const id = typeof entry === 'string' ? entry : (entry?.id ?? entry?.['@id']);
  if (typeof id !== 'string') return false;
  const format = typeof entry === 'object' ? String(entry?.format ?? '') : '';
  if (/musicxml/i.test(format)) return true;
  const path = id.split('#')[0].split('?')[0].toLowerCase();
  return path.endsWith('.musicxml');
}

export type TeiLink = 'canvas' | 'manifest' | 'none';
export type AnnotationLink = 'embedded' | 'external' | 'none';

export interface CanvasFeatures {
  /** TEI transcription linked from the canvas, the manifest, or not at all. */
  tei: TeiLink;
  /** Annotations with inline items, by reference only, or absent. */
  annotations: AnnotationLink;
  /** MusicXML score linked via canvas `rendering`. */
  musicXml: boolean;
}

/** Plugin-relevant features of a 1-based page's canvas (never throws). */
export function describeCanvas(manifest: any, page: number): CanvasFeatures {
  const result: CanvasFeatures = { tei: 'none', annotations: 'none', musicXml: false };
  try {
    const canvas = canvasesOf(manifest)[page - 1];
    if (!canvas || typeof canvas !== 'object') return result;
    if (asList(canvas?.seeAlso).some(isTeiRef)) {
      result.tei = 'canvas';
    } else if (asList(manifest?.seeAlso).some(isTeiRef)) {
      result.tei = 'manifest';
    }
    // v3 `annotations`, v2 `otherContent` (embedded lists or bare-URI refs).
    const refs = [...asList(canvas?.annotations), ...asList(canvas?.otherContent)];
    if (refs.some((entry) => Array.isArray(entry?.items) || Array.isArray(entry?.resources))) {
      result.annotations = 'embedded';
    } else if (
      refs.some(
        (entry) => typeof entry === 'string' || typeof (entry?.id ?? entry?.['@id']) === 'string',
      )
    ) {
      result.annotations = 'external';
    }
    if (asList(canvas?.rendering).some(isMusicXmlRef)) result.musicXml = true;
  } catch {
    // Presence sniffing stays best-effort.
  }
  return result;
}

export interface ImageFeatures {
  apiVersion: '2' | '3' | 'unknown';
  /** Level URI (v2) or level name (v3), '' when absent. */
  profile: string;
  hdrAdvertised: boolean;
  c2paAdvertised: boolean;
}

/**
 * Plugin-relevant features of an Image API service (never throws). Only the
 * advertisement signals — no tile verification, which stays in plugin-c2pa.
 */
export function describeImageFeatures(infoJson: any): ImageFeatures {
  const result: ImageFeatures = {
    apiVersion: 'unknown',
    profile: '',
    hdrAdvertised: false,
    c2paAdvertised: false,
  };
  if (!infoJson || typeof infoJson !== 'object') return result;
  try {
    const context = JSON.stringify(infoJson['@context'] ?? '');
    const type = String(infoJson.type ?? infoJson['@type'] ?? '');
    // NOTE: `protocol: http://iiif.io/api/image` appears in v2 responses
    // too, so @context/@type decide; profile shape is the tiebreak.
    if (type === 'ImageService3' || context.includes('/image/3/')) {
      result.apiVersion = '3';
    } else if (type === 'ImageService2' || context.includes('/image/2/')) {
      result.apiVersion = '2';
    } else if (typeof infoJson.profile === 'string' && /^level[0-2]$/.test(infoJson.profile)) {
      result.apiVersion = '3';
    }
    const profile = infoJson.profile;
    if (typeof profile === 'string') {
      result.profile = profile;
    } else if (Array.isArray(profile)) {
      const first = profile.find((entry) => typeof entry === 'string');
      if (typeof first === 'string') result.profile = first;
    }
    const supports: string[] = [];
    const add = (value: unknown): void => {
      if (typeof value === 'string' && !supports.includes(value)) supports.push(value);
    };
    if (Array.isArray(profile)) {
      for (const entry of profile) {
        if (entry && typeof entry === 'object' && Array.isArray(entry.supports)) {
          entry.supports.forEach(add);
        }
      }
    }
    if (Array.isArray(infoJson?.extraFeatures)) infoJson.extraFeatures.forEach(add);
    result.hdrAdvertised = supports.includes(HDR_PROFILE_URI);
    result.c2paAdvertised = supports.includes(C2PA_PROFILE_URI);
  } catch {
    // Presence sniffing stays best-effort.
  }
  return result;
}
