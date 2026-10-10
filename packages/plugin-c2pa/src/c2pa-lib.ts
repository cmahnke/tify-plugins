// C2PA provenance checks for individual IIIF tiles via @contentauth/c2pa-web.
// Trust anchors are configurable by URL (PEM bundle). Changing the URL
// re-creates the c2pa instance and invalidates the tile-status cache.

// The inline entry bundles the WASM binary (base64) instead of loading it
// from a separate URL: the only option that keeps working once this package
// is installed as a dependency (a library cannot assume the host serves its
// internal asset paths). Adds ~11MB (4MB gzipped) to the bundle.
import { createC2pa } from '@contentauth/c2pa-web/inline';

export const DEFAULT_TRUST_ANCHORS_URL = 'https://contentcredentials.org/trust/anchors.pem';

export type TileC2paState = 'valid' | 'invalid' | 'unsigned' | 'unknown';

export interface TileC2paStatus {
  state: TileC2paState;
  /** English-source i18n key for the detail (placeholders in `detailVars`). */
  detailKey: string;
  detailVars?: Record<string, string | number>;
  signer?: string;
  manifestLabel?: string;
}

interface C2paSingleton {
  anchorsUrl: string | null;
  certCount: number | null;
  ready: boolean;
  /** English-source i18n key (plus vars) when trust setup degraded. */
  errorKey: string | null;
  errorVars?: Record<string, string | number>;
}

// The SDK instance type is intentionally loose: exact settings key casing
// (trustAnchors vs trust_anchors) is verified against the installed version
// at runtime via a fallback chain below.

let c2pa: any = null;
const singleton: C2paSingleton = {
  anchorsUrl: null,
  certCount: null,
  ready: false,
  errorKey: null,
  errorVars: {},
};

const statusCache = new Map<string, TileC2paStatus>();

export function trustInfo(): C2paSingleton {
  return { ...singleton };
}

function countCerts(pem: string): number {
  return (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
}

async function fetchPem(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('URL did not return a PEM certificate bundle');
    }
    return text;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * (Re)create the c2pa instance. Pass a PEM-bundle URL to validate against a
 * custom trust root, or null to use the SDK defaults. On fetch failure the
 * SDK defaults are used and `trustInfo().error` explains why. Engine init is
 * bounded: if the SDK never settles (observed with blob-backed WASM on
 * WebKit), the plugin degrades to status reporting instead of hanging boot.
 */
const INIT_TIMEOUT_MS = 15000;

async function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let cancel: (() => void) | undefined;
  const timeout = new Promise<null>((resolve) => {
    const id = setTimeout(() => resolve(null), INIT_TIMEOUT_MS);
    cancel = () => clearTimeout(id);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    cancel?.();
  }
}

export async function configureTrust(anchorsUrl: string | null): Promise<C2paSingleton> {
  statusCache.clear();
  c2pa = null;
  singleton.anchorsUrl = anchorsUrl;
  singleton.certCount = null;
  singleton.errorKey = null;
  singleton.errorVars = {};
  singleton.ready = false;

  let pem: string | null = null;
  if (anchorsUrl) {
    try {
      pem = await fetchPem(anchorsUrl);
      singleton.certCount = countCerts(pem);
    } catch (error) {
      console.debug('[tify-plugins] Could not load trust anchors:', anchorsUrl, error);
      singleton.errorKey = 'Could not load trust anchors from {url}. Using SDK defaults.';
      singleton.errorVars = { url: anchorsUrl };
    }
  }

  const attempts: Array<() => Promise<unknown>> = [];
  if (pem) {
    // c2pa-web mirrors c2pa-rs settings; key casing differs across versions,
    // so try camelCase first, then snake_case, then defaults.
    attempts.push(() =>
      createC2pa({
        settings: { trust: { trustAnchors: pem }, cawgTrust: { trustAnchors: pem } },
      } as unknown as never),
    );
    attempts.push(() =>
      createC2pa({
        settings: { trust: { trust_anchors: pem }, cawg_trust: { trust_anchors: pem } },
      } as unknown as never),
    );
  }
  attempts.push(() => createC2pa());

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const created = await withTimeout(attempt());
      if (created === null) break; // engine init timed out: degrade below
      c2pa = created;
      singleton.ready = true;
      return trustInfo();
    } catch (error) {
      lastError = error;
    }
  }
  console.debug('[tify-plugins] Could not initialise c2pa-web:', lastError);
  singleton.errorKey = 'Could not initialise c2pa-web.';
  singleton.errorVars = {};
  return trustInfo();
}

/** Aggregate verdict for the header badge: true only if ≥1 tile is `valid`. */
export function aggregateValid(statuses: TileC2paStatus[]): boolean {
  return statuses.some((status) => status.state === 'valid');
}

async function readBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { mode: 'cors', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.blob();
}

/**
 * Read + validate C2PA data for one tile URL. Results are cached by URL
 * (cache is cleared when the trust root changes). Unsigned tiles are
 * `unsigned`, CORS/network failures are `unknown` — both expected in the wild.
 */
export async function readTileStatus(
  tileUrl: string,
  signal?: AbortSignal,
): Promise<TileC2paStatus> {
  const cached = statusCache.get(tileUrl);
  if (cached) return cached;

  const status: TileC2paStatus = { state: 'unknown', detailKey: 'not checked' };
  statusCache.set(tileUrl, status);

  try {
    const blob = await readBlob(tileUrl, signal ?? new AbortController().signal);
    // Lazy engine init covers direct readTileStatus() calls; a recorded
    // engine failure is final (no per-tile retry storms).
    if (!c2pa && !trustInfo().errorKey) {
      await configureTrust(singleton.anchorsUrl ?? DEFAULT_TRUST_ANCHORS_URL);
    }
    if (!c2pa) {
      status.state = 'unknown';
      status.detailKey = 'C2PA engine unavailable';
      return status;
    }
    const reader = await c2pa.reader.fromBlob(blob.type || 'image/jpeg', blob);
    if (!reader) {
      // No readable manifest store: the tile is unsigned, not broken.
      status.state = 'unsigned';
      status.detailKey = 'Tile carries no C2PA manifest';
      return status;
    }
    try {
      const store = await reader.manifestStore();
      const active = store?.activeManifest;
      if (!active) {
        status.state = 'unsigned';
        status.detailKey = 'Tile carries no C2PA manifest';
        return status;
      }
      status.manifestLabel = active.label ?? undefined;
      const claimGenerator =
        active.claimGeneratorInfo?.[0]?.name ?? active.claimGenerator ?? undefined;
      if (claimGenerator) status.signer = String(claimGenerator);
      const failing = (active.validationStatus ?? []).filter(
        (entry: { success?: boolean | null }) => entry.success === false,
      );
      if (failing.length > 0) {
        status.state = 'invalid';
        status.detailKey = 'Failing checks: {codes}';
        const codes = failing.map((entry: { code?: string }) => entry.code ?? '?').join(', ');
        status.detailVars = { codes };
      } else if (status.signer) {
        status.state = 'valid';
        status.detailKey = 'Signed by {signer}, checks passed';
        status.detailVars = { signer: status.signer };
      } else {
        status.state = 'valid';
        status.detailKey = 'Manifest present, checks passed';
      }
      return status;
    } finally {
      await reader.free?.();
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      statusCache.delete(tileUrl);
      throw error;
    }
    const message = String(error);
    if (/fetch|CORS|NetworkError|Load failed/i.test(message)) {
      status.state = 'unknown';
      status.detailKey = 'Tile bytes unreachable (CORS or network)';
    } else if (/no (c2pa|manifest|jumbf)|not.*c2pa|parse/i.test(message)) {
      status.state = 'unsigned';
      status.detailKey = 'No readable C2PA manifest in tile';
    } else {
      // Never leak technical error text into the UI; diagnostics go to the console.
      console.debug('[tify-plugins] C2PA tile check failed:', tileUrl, error);
      status.state = 'unknown';
      status.detailKey = 'This tile could not be checked';
    }
    return status;
  }
}

export function clearTileCache(): void {
  statusCache.clear();
}
