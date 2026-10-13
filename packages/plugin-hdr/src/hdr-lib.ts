// HDR helpers built on the `hdr-canvas` npm module (alpha, Chromium-only).
// Must run BEFORE TIFY creates its OpenSeadragon canvas: TIFY builds the OSD
// viewer lazily after mount, so call enableHdrCanvasOnce() before `new Tify()`.

import {
  checkHDR,
  checkHDRBitDepth,
  checkHDRCanvas,
  defaultGetContextHDR,
  resetGetContext,
} from '@projektemacher/hdr-canvas';

import { getInfoJsonForCurrentPage, serviceSupports } from '@projektemacher/tify-plugin-core';

export { getInfoJsonForCurrentPage };

/** Placeholder URI used in info.json `profile[].supports` to signal HDR. */
export const HDR_PROFILE_URI = 'https://christianmahnke.de/iiif/hdr/';

let hdrEnabled = false;

export interface HdrSupport {
  hdrDisplay: boolean;
  hdrCanvas: boolean;
  bitDepthHdr: boolean;
  enabled: boolean;
  /** English-source i18n key explaining the result. */
  reasonKey: string;
  reasonVars?: Record<string, string | number>;
}

export function probeHdrSupport(): Omit<HdrSupport, 'enabled' | 'reasonKey' | 'reasonVars'> {
  let hdrDisplay: boolean;
  let hdrCanvas: boolean;
  let bitDepthHdr: boolean;
  try {
    hdrDisplay = checkHDR();
  } catch {
    hdrDisplay = false;
  }
  try {
    hdrCanvas = checkHDRCanvas();
  } catch {
    hdrCanvas = false;
  }
  try {
    bitDepthHdr = checkHDRBitDepth();
  } catch {
    bitDepthHdr = false;
  }
  return { hdrDisplay, hdrCanvas, bitDepthHdr };
}

/**
 * Wrap getContext so every 2D canvas (including TIFY's OSD canvas) is
 * HDR-capable. Safe to call multiple times; guarded by feature checks so
 * non-HDR browsers keep working (TIFY renders SDR as usual).
 */
export function enableHdrCanvasOnce(): HdrSupport {
  const probe = probeHdrSupport();
  if (hdrEnabled) {
    return { ...probe, enabled: true, reasonKey: 'HDR canvas is already enabled' };
  }
  if (!probe.hdrDisplay || !probe.hdrCanvas) {
    return {
      ...probe,
      enabled: false,
      reasonKey:
        'HDR canvas not available (needs Chromium with enable-experimental-web-platform-features and an HDR display)',
    };
  }
  try {
    defaultGetContextHDR();
    hdrEnabled = true;
    return { ...probe, enabled: true, reasonKey: 'HDR canvas enabled' };
  } catch (error) {
    return {
      ...probe,
      enabled: false,
      reasonKey: 'HDR canvas could not be enabled: {error}',
      reasonVars: { error: String(error) },
    };
  }
}

export function disableHdrCanvas(): void {
  if (!hdrEnabled) return;
  try {
    resetGetContext();
  } finally {
    hdrEnabled = false;
  }
}

/** True if the image service advertises HDR via the placeholder profile URI. */
export function infoAdvertisesHdr(infoJson: any): boolean {
  return serviceSupports(infoJson).includes(HDR_PROFILE_URI);
}

export interface ImageServiceDescription {
  apiVersion: '2' | '3' | 'unknown';
  /** Level URI (v2) or level name (v3), '' when absent. */
  profile: string;
  /** v2 capabilities from the profile object. */
  formats: string[];
  qualities: string[];
  supports: string[];
  /** v3 capabilities. */
  extraFormats: string[];
  extraQualities: string[];
  extraFeatures: string[];
  serviceId: string;
  /** The only definitive HDR signal: placeholder URI in the profile block. */
  hdrAdvertised: boolean;
}

function stringList(value: unknown, target: string[]): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === 'string' && !target.includes(entry)) target.push(entry);
  }
}

/**
 * Normalize an Image API 2 or 3 info.json into a report. Capability field
 * names are kept verbatim (spec identifiers, shown monospace in the panel).
 */
export function describeImageService(infoJson: any, serviceId = ''): ImageServiceDescription {
  const description: ImageServiceDescription = {
    apiVersion: 'unknown',
    profile: '',
    formats: [],
    qualities: [],
    supports: [],
    extraFormats: [],
    extraQualities: [],
    extraFeatures: [],
    serviceId,
    hdrAdvertised: false,
  };
  if (!infoJson || typeof infoJson !== 'object') return description;

  const context = JSON.stringify(infoJson['@context'] ?? '');
  const type = String(infoJson.type ?? infoJson['@type'] ?? '');
  // NOTE: `protocol: http://iiif.io/api/image` appears in v2 responses too,
  // so @context/@type decide; profile shape is the tiebreak.
  if (type === 'ImageService3' || context.includes('/image/3/')) {
    description.apiVersion = '3';
  } else if (type === 'ImageService2' || context.includes('/image/2/')) {
    description.apiVersion = '2';
  } else if (typeof infoJson.profile === 'string' && /^level[0-2]$/.test(infoJson.profile)) {
    description.apiVersion = '3';
  }

  const profile = infoJson.profile;
  if (typeof profile === 'string') {
    description.profile = profile;
  } else if (Array.isArray(profile)) {
    for (const entry of profile) {
      if (typeof entry === 'string') {
        if (!description.profile) description.profile = entry;
      } else if (entry && typeof entry === 'object') {
        stringList(entry.formats, description.formats);
        stringList(entry.qualities, description.qualities);
        stringList(entry.supports, description.supports);
      }
    }
  }
  stringList(infoJson.extraFormats, description.extraFormats);
  stringList(infoJson.extraQualities, description.extraQualities);
  stringList(infoJson.extraFeatures, description.extraFeatures);

  description.hdrAdvertised = infoAdvertisesHdr(infoJson);
  return description;
}
