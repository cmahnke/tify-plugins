// Shared IIIF test double: every external request (manifest, Image API
// service, TEI files, TIFY's CDN translations) is fulfilled via page.route,
// so the suite is deterministic and fully offline.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/** Fake origin all synthetic manifests/services live under. */
export const MOCK_BASE = 'https://mock-iiif.test';

const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures');

/** Minimal valid JPEG (1x1 px, unsigned) served for every tile/image request. */
const TILE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkIDRENDg8RDxAQCgsSExIRDxAREhP/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);

/** The gottingen example service referenced by the TEI fixture manifest. */
const TEI_IMAGE_SERVICE =
  'https://iiif.io/api/image/3.0/example/reference/918ecd18c2592080851777620de9bcb5-gottingen';

export interface MockOptions {
  /**
   * Manifest to serve at `${MOCK_BASE}/manifest.json`:
   * a buildManifest() object, or 'tei-fixture' for the repo's TEI fixture
   * (self-referencing URLs rewritten to ${MOCK_BASE}/tei/, image service left
   * intact so the TEI <graphic> still matches the painting body).
   */
  manifest: object | 'tei-fixture';
  /** Image API info.json for `${MOCK_BASE}/image` (HDR/C2PA signalling). */
  info?: object;
}

/** Manifest URLs the examples load when no `?manifest=` is given. */
const DEFAULT_MANIFEST_URLS = [
  'https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json',
  'https://iiif.io/api/cookbook/recipe/0021-tagging/manifest.json',
  'https://christianmahnke.de/post/hdr-iiif/manifest.json',
];

/**
 * Intercept all network traffic the examples need. Register BEFORE page.goto.
 * The examples' default manifests are intercepted too, so no test ever hits
 * the live network — even when booting without `?manifest=`.
 */
export async function mockIiif(page: Page, options: MockOptions): Promise<void> {
  const { manifest, info } = options;

  const manifestBody =
    manifest === 'tei-fixture'
      ? JSON.parse(
          readFileSync(path.join(FIXTURE_DIR, 'tei-manifest.json'), 'utf8').replaceAll(
            'http://localhost:5173/packages/plugin-image-overlays/example/tei-fixture',
            `${MOCK_BASE}/tei`,
          ),
        )
      : manifest;
  for (const url of DEFAULT_MANIFEST_URLS) {
    await page.route(url, (route) => route.fulfill({ json: manifestBody }));
  }
  await page.route(`${MOCK_BASE}/manifest.json`, (route) => route.fulfill({ json: manifestBody }));

  if (manifest === 'tei-fixture') {
    // The fixture's relative seeAlso ("tei.xml") resolves against the
    // manifest URL; serve it for both plausible resolutions.
    await page.route(`${MOCK_BASE}/tei/tei.xml`, (route) =>
      route.fulfill({
        body: readFileSync(path.join(FIXTURE_DIR, 'tei.xml'), 'utf8'),
        contentType: 'application/xml',
      }),
    );
    await page.route(`${MOCK_BASE}/tei.xml`, (route) =>
      route.fulfill({
        body: readFileSync(path.join(FIXTURE_DIR, 'tei.xml'), 'utf8'),
        contentType: 'application/xml',
      }),
    );
    await page.route(`${TEI_IMAGE_SERVICE}/**`, (route) => {
      const url = route.request().url();
      if (url.endsWith('/info.json')) {
        return route.fulfill({ json: buildInfo() });
      }
      return route.fulfill({ body: TILE_JPEG, contentType: 'image/jpeg' });
    });
    return;
  }

  await page.route(`${MOCK_BASE}/image/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/info.json') || url.replace(/\/$/, '') === `${MOCK_BASE}/image`) {
      return route.fulfill({ json: info ?? buildInfo() });
    }
    return route.fulfill({ body: TILE_JPEG, contentType: 'image/jpeg' });
  });

  // TIFY translations live on the CDN in the examples; degrade to an empty
  // catalogue so no test depends on the network.
  await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({ json: {} }));
}

interface ManifestOptions {
  /** Number of canvases (default 3). */
  canvases?: number;
  /** `xywh` annotations attached to canvas 1 (default 0). */
  annotations?: number;
}

/** Cookbook-style Presentation 3 manifest with an Image API 3 service. */
export function buildManifest({ canvases = 3, annotations = 0 }: ManifestOptions = {}): object {
  const items = Array.from({ length: canvases }, (_, index) => {
    const page = index + 1;
    const canvas: Record<string, unknown> = {
      id: `${MOCK_BASE}/canvas/p${page}`,
      type: 'Canvas',
      label: { en: [`Page ${page}`] },
      width: 750,
      height: 1000,
      items: [
        {
          id: `${MOCK_BASE}/page/p${page}/1`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${MOCK_BASE}/annotation/p${page}-image`,
              type: 'Annotation',
              motivation: 'painting',
              body: {
                id: `${MOCK_BASE}/image/full/750,1000/0/default.jpg`,
                type: 'Image',
                format: 'image/jpeg',
                width: 750,
                height: 1000,
                service: [{ id: `${MOCK_BASE}/image`, type: 'ImageService3', profile: 'level2' }],
              },
              target: `${MOCK_BASE}/canvas/p${page}`,
            },
          ],
        },
      ],
    };
    if (page === 1 && annotations > 0) {
      canvas.annotations = [
        {
          id: `${MOCK_BASE}/annotations/p1.json`,
          type: 'AnnotationPage',
          items: Array.from({ length: annotations }, (_, a) => ({
            id: `${MOCK_BASE}/annotation/anno-${a + 1}`,
            type: 'Annotation',
            motivation: 'tagging',
            body: { type: 'TextualBody', value: `Note ${a + 1}`, format: 'text/plain' },
            target: `${MOCK_BASE}/canvas/p1#xywh=${50 + a * 300},100,200,150`,
          })),
        },
      ];
    }
    if (page === 2 && annotations > 0) {
      // Facing-page annotations for spread tests (same style, canvas 2).
      canvas.annotations = [
        {
          id: `${MOCK_BASE}/annotations/p2.json`,
          type: 'AnnotationPage',
          items: Array.from({ length: annotations }, (_, a) => ({
            id: `${MOCK_BASE}/annotation/anno-p2-${a + 1}`,
            type: 'Annotation',
            motivation: 'tagging',
            body: { type: 'TextualBody', value: `Page 2 Note ${a + 1}`, format: 'text/plain' },
            target: `${MOCK_BASE}/canvas/p2#xywh=${50 + a * 300},100,200,150`,
          })),
        },
      ];
    }
    if (page === 3 && annotations > 0) {
      canvas.annotations = [
        {
          id: `${MOCK_BASE}/annotations/p3.json`,
          type: 'AnnotationPage',
          items: Array.from({ length: annotations }, (_, a) => ({
            id: `${MOCK_BASE}/annotation/anno-p3-${a + 1}`,
            type: 'Annotation',
            motivation: 'tagging',
            body: { type: 'TextualBody', value: `Page 3 Note ${a + 1}`, format: 'text/plain' },
            target: `${MOCK_BASE}/canvas/p3#xywh=${50 + a * 300},100,200,150`,
          })),
        },
      ];
    }
    return canvas;
  });
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${MOCK_BASE}/manifest.json`,
    type: 'Manifest',
    label: { en: ['Mock Book'] },
    items,
  };
}

/**
 * Image API 3 info.json; `hdr`/`c2pa` advertise the placeholder capability
 * URIs via `extraFeatures` (where core's serviceSupports() looks for them).
 */
export function buildInfo({ hdr = false, c2pa = false }: { hdr?: boolean; c2pa?: boolean } = {}) {
  const extraFeatures: string[] = [];
  if (hdr) extraFeatures.push('https://christianmahnke.de/iiif/hdr/');
  if (c2pa) extraFeatures.push('https://christianmahnke.de/iiif/c2pa/');
  return {
    '@context': 'http://iiif.io/api/image/3/context.json',
    id: `${MOCK_BASE}/image`,
    type: 'ImageService3',
    // OpenSeadragon identifies IIIF services via the protocol field; the
    // extra* arrays mirror what real services ship.
    protocol: 'http://iiif.io/api/image',
    profile: 'level2',
    width: 750,
    height: 1000,
    tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4] }],
    extraFormats: ['jpg', 'png'],
    extraQualities: ['default', 'color', 'gray'],
    extraFeatures,
  };
}
