import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildInfo, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/core/example/';

function row(page: Page, label: string) {
  return page.locator(`#panel tr:has(th:text-is("${label}"))`);
}

test('lists manifest and image features of a plain v3 book', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel')).toContainText('Viewing page 1');
  await expect(row(page, 'Presentation version')).toContainText('3');
  await expect(row(page, 'Canvases')).toContainText('1');
  await expect(row(page, 'TEI transcription')).toContainText('no');
  await expect(row(page, 'Annotations')).toContainText('no');
  await expect(row(page, 'MusicXML score')).toContainText('no');
  await expect(row(page, 'API version')).toContainText('3');
  await expect(row(page, 'HDR advertised')).toContainText('no');
  await expect(row(page, 'C2PA advertised')).toContainText('no');
});

function featureManifest(): object {
  const painting = {
    id: `${MOCK_BASE}/annotation/p1-image`,
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
    target: `${MOCK_BASE}/canvas/p1`,
  };
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${MOCK_BASE}/manifest.json`,
    type: 'Manifest',
    label: { en: ['Mock Features'] },
    items: [
      {
        id: `${MOCK_BASE}/canvas/p1`,
        type: 'Canvas',
        label: { en: ['Page 1'] },
        width: 750,
        height: 1000,
        items: [{ id: `${MOCK_BASE}/page/p1/1`, type: 'AnnotationPage', items: [painting] }],
        seeAlso: [
          {
            id: `${MOCK_BASE}/tei.xml`,
            type: 'Text',
            format: 'application/tei+xml',
            label: { en: ['Transcription'] },
          },
        ],
        annotations: [
          {
            id: `${MOCK_BASE}/annotations/p1`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${MOCK_BASE}/annotation/anno-1`,
                type: 'Annotation',
                motivation: 'tagging',
                body: { type: 'TextualBody', value: 'Note 1', format: 'text/plain' },
                target: `${MOCK_BASE}/canvas/p1#xywh=50,100,200,150`,
              },
            ],
          },
        ],
        rendering: [
          {
            id: `${MOCK_BASE}/score.musicxml`,
            type: 'Text',
            format: 'application/vnd.recordare.musicxml+xml',
            label: { en: ['Score'] },
          },
        ],
      },
    ],
  };
}

test('detects canvas-level TEI, embedded annotations, and a score', async ({ page }) => {
  await mockIiif(page, { manifest: featureManifest() });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(row(page, 'TEI transcription')).toContainText('yes (canvas)');
  await expect(row(page, 'Annotations')).toContainText('embedded');
  await expect(row(page, 'MusicXML score')).toContainText('yes');
});

test('detects manifest-level TEI and by-reference annotations', async ({ page }) => {
  const manifest = featureManifest() as any;
  const canvas = manifest.items[0];
  delete canvas.seeAlso;
  canvas.annotations = [{ id: `${MOCK_BASE}/annotations/p1.json`, type: 'AnnotationPage' }];
  delete canvas.rendering;
  manifest.seeAlso = [{ id: `${MOCK_BASE}/tei.xml`, type: 'Text', format: 'application/tei+xml' }];
  await mockIiif(page, { manifest });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(row(page, 'TEI transcription')).toContainText('yes (manifest)');
  await expect(row(page, 'Annotations')).toContainText('by reference');
  await expect(row(page, 'MusicXML score')).toContainText('no');
});

function v2Manifest(): object {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': `${MOCK_BASE}/manifest.json`,
    '@type': 'sc:Manifest',
    label: 'Mock V2',
    sequences: [
      {
        '@id': `${MOCK_BASE}/sequence/1`,
        '@type': 'sc:Sequence',
        canvases: [
          {
            '@id': `${MOCK_BASE}/canvas/p1`,
            '@type': 'sc:Canvas',
            label: 'Page 1',
            width: 750,
            height: 1000,
            images: [
              {
                '@id': `${MOCK_BASE}/annotation/p1-image`,
                '@type': 'oa:Annotation',
                motivation: 'sc:painting',
                resource: {
                  '@id': `${MOCK_BASE}/image/full/full/0/default.jpg`,
                  '@type': 'dctypes:Image',
                  format: 'image/jpeg',
                  width: 750,
                  height: 1000,
                  service: {
                    '@context': 'http://iiif.io/api/image/2/context.json',
                    '@id': `${MOCK_BASE}/image`,
                    profile: 'http://iiif.io/api/image/2/level2.json',
                  },
                },
                on: `${MOCK_BASE}/canvas/p1`,
              },
            ],
            rendering: [
              {
                '@id': `${MOCK_BASE}/score.musicxml`,
                format: 'application/vnd.recordare.musicxml+xml',
                label: 'Score',
              },
            ],
            otherContent: [
              {
                '@id': `${MOCK_BASE}/annotations/p1.json`,
                '@type': 'sc:AnnotationList',
                resources: [
                  {
                    '@id': `${MOCK_BASE}/annotation/anno-1`,
                    '@type': 'oa:Annotation',
                    motivation: 'oa:commenting',
                    resource: { '@type': 'cnt:ContentAsText', chars: 'Note 1' },
                    on: `${MOCK_BASE}/canvas/p1#xywh=50,100,200,150`,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function v2Info(): object {
  return {
    '@context': 'http://iiif.io/api/image/2/context.json',
    '@id': `${MOCK_BASE}/image`,
    protocol: 'http://iiif.io/api/image',
    width: 750,
    height: 1000,
    sizes: [{ width: 750, height: 1000 }],
    tiles: [{ width: 512, scaleFactors: [1, 2, 4] }],
    profile: [
      'http://iiif.io/api/image/2/level2.json',
      {
        formats: ['jpg', 'png'],
        qualities: ['default', 'color'],
        supports: ['cors', 'sizeByWhListed'],
      },
    ],
  };
}

test('reads a Presentation 2 manifest with an Image API 2 service', async ({ page }) => {
  await mockIiif(page, { manifest: v2Manifest(), info: v2Info() });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(row(page, 'Presentation version')).toContainText('2');
  await expect(row(page, 'Canvases')).toContainText('1');
  await expect(row(page, 'Annotations')).toContainText('embedded');
  await expect(row(page, 'MusicXML score')).toContainText('yes');
  await expect(row(page, 'API version')).toContainText('2');
});

function v4Manifest(): object {
  const manifest = buildManifest({ canvases: 1 }) as any;
  manifest['@context'] = 'http://iiif.io/api/presentation/4/context.json';
  manifest.label = { en: ['Mock V4'] };
  return manifest;
}

test('reads a Presentation 4 manifest like v3 (2D subset)', async ({ page }) => {
  await mockIiif(page, { manifest: v4Manifest() });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(row(page, 'Presentation version')).toContainText('4');
  await expect(row(page, 'Canvases')).toContainText('1');
  await expect(row(page, 'API version')).toContainText('3');
});

test('lists advertised HDR and C2PA capabilities', async ({ page }) => {
  await mockIiif(page, {
    manifest: buildManifest({ canvases: 1 }),
    info: buildInfo({ hdr: true, c2pa: true }),
  });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(row(page, 'HDR advertised')).toContainText('yes');
  await expect(row(page, 'C2PA advertised')).toContainText('yes');
});

test('german panel chrome (?lang=de)', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(
    `${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}&lang=de`,
  );
  await expect(page.locator('#panel')).toContainText('Bilddienst');
  await expect(row(page, 'TEI-Transkription')).toContainText('nein');
});

test('double-page spread lists both facing pages', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 3 }) });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel')).toContainText('Viewing page 1');
  await page.locator('button[title="Toggle double-page"]').click();
  await page.locator('button[title="Next page"] >> nth=0').click();
  await expect(page.locator('#panel')).toContainText('Viewing pages 2, 3', { timeout: 15_000 });
  // Per-page sections: one manifest table and one image-service table each.
  await expect(page.locator('#panel h3').filter({ hasText: /^Page [23]$/ })).toHaveCount(2);
  await expect(page.locator('#panel h3').filter({ hasText: 'Image service (page' })).toHaveCount(2);
  // Each page's canvas features come from its own canvas.
  await expect(page.locator('#panel')).toContainText('Image service (page 2)');
  await expect(page.locator('#panel')).toContainText('Image service (page 3)');
});
