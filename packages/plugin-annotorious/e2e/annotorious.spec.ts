import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-annotorious/example/';
// Fixture: 750x1000 image, annotation 1 at xywh=50,100,200,150
// (center image point 150,175).
const IMAGE = { width: 750, height: 1000 };
const ANNO_CENTER = { x: 150, y: 175 };

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 3, annotations: 2 }) });
});

/**
 * Headless Firefox without software GL cannot create the WebGL context
 * annotorious draws on; the plugin then runs in panel-only mode. The canvas
 * tests skip there (same pattern as hdr.spec's engine gate).
 */
async function webglAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  });
}

/** Element point of an image point, assuming the home view (fit by the long side). */
async function imageToElement(
  page: Page,
  imageX: number,
  imageY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas.a9s-gl-canvas').boundingBox();
  if (!box) throw new Error('annotorious display canvas missing');
  const scale = Math.min(box.width / IMAGE.width, box.height / IMAGE.height);
  const offsetX = (box.width - IMAGE.width * scale) / 2;
  const offsetY = (box.height - IMAGE.height * scale) / 2;
  return { x: box.x + offsetX + imageX * scale, y: box.y + offsetY + imageY * scale };
}

test('imports manifest annotations into the panel', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('#panel tbody tr')).toHaveCount(2);
  await expect(page.locator('#panel tbody tr').first()).toContainText('Note 1');
  // Panel-only degradation is visible and flagged (WebGL-less environments).
  const shapesMode = await page.locator('#panel').getAttribute('data-shapes');
  expect(['on', 'off']).toContain(shapesMode);
});

test('clicking a canvas shape highlights its list row', async ({ page }) => {
  test.setTimeout(90_000);
  if (!(await webglAvailable(page))) {
    test.skip(true, 'no WebGL: annotorious cannot draw shapes');
  }
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('#panel tbody tr')).toHaveCount(2);
  const row = page.locator('#panel tbody tr').first();
  // Let the tile world settle first: the annotorious draw needs a loaded
  // world item, and TIFY veils the viewer while tiles are still loading.
  await expect(page.locator('.tify-loading')).toBeHidden({ timeout: 15_000 });
  // Recompute the click point on every iteration: layout can still shift
  // while tiles load, which would strand a one-shot coordinate off-target.
  // Annotorious only fires clickAnnotation when hover already registered the
  // shape, so traverse to the point in steps (like a real pointer) and let
  // hover settle before pressing — under parallel load the hit-testing can
  // lag well behind the events.
  await expect
    .poll(
      async () => {
        const point = await imageToElement(page, ANNO_CENTER.x, ANNO_CENTER.y);
        await page.mouse.move(point.x, point.y, { steps: 5 });
        await page.waitForTimeout(1500);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(500);
        return row.evaluate((element) => element.className);
      },
      { timeout: 60_000 },
    )
    .toContain('is-active');
});

test('clicking a shape reopens a manually closed panel', async ({ page }) => {
  test.setTimeout(90_000);
  if (!(await webglAvailable(page))) {
    test.skip(true, 'no WebGL: annotorious cannot draw shapes');
  }
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  // Panels auto-open; close it manually, then the shape must bring it back.
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await dock.click();
  await expect(page.locator('#panel')).toBeHidden();
  const row = page.locator('#panel tbody tr').first();
  await expect(page.locator('.tify-loading')).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const point = await imageToElement(page, ANNO_CENTER.x, ANNO_CENTER.y);
        await page.mouse.move(point.x, point.y, { steps: 5 });
        await page.waitForTimeout(1000);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(500);
        return row.evaluate((element) => element.className);
      },
      { timeout: 60_000 },
    )
    .toContain('is-active');
  // The click reopens the dock so the highlight is actually visible.
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
});

test('clicking a list row zooms the viewer to the annotation', async ({ page }) => {
  if (!(await webglAvailable(page))) {
    test.skip(true, 'no WebGL: annotorious cannot draw shapes');
  }
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  const transform = page.locator('.a9s-annotationlayer > g').first();
  await expect(transform).toBeAttached();
  const before = await transform.getAttribute('transform');
  // Panels auto-open after init — no dock click needed.
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#panel tbody tr button').first().click();
  await expect
    .poll(async () => transform.getAttribute('transform'), { timeout: 8000 })
    .not.toBe(before);
});

test('preset dropdown fills the manifest input and loads', async ({ page }) => {
  // Stub the cookbook host so the test stays hermetic; the stubbed
  // manifest points at the mocked image service.
  await page.route('https://iiif.io/api/cookbook/**', (route) =>
    route.fulfill({ json: buildManifest({ canvases: 2, annotations: 2 }) }),
  );
  await page.goto(EXAMPLE);
  const select = page.locator('#manifest-preset');
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(4);
  await expect(select).toHaveValue(
    'https://iiif.io/api/cookbook/recipe/0021-tagging/manifest.json',
  );
  await select.selectOption(
    'https://iiif.io/api/cookbook/recipe/0258-tagging-external-resource/manifest.json',
  );
  await expect(page.locator('#manifest')).toHaveValue(
    'https://iiif.io/api/cookbook/recipe/0258-tagging-external-resource/manifest.json',
  );
  await expect(page).toHaveURL(/manifest=.*0258-tagging-external-resource/);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
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
            otherContent: [
              {
                '@id': `${MOCK_BASE}/annotations/p1.json`,
                '@type': 'sc:AnnotationList',
                resources: [
                  {
                    '@id': `${MOCK_BASE}/annotation/anno-1`,
                    '@type': 'oa:Annotation',
                    motivation: 'oa:commenting',
                    resource: {
                      '@type': 'cnt:ContentAsText',
                      chars: 'Note 1',
                      format: 'text/plain',
                    },
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

test('imports v2 otherContent annotations into the panel', async ({ page }) => {
  // Registered after beforeEach: the later route wins for the manifest URL.
  await page.route(`${MOCK_BASE}/manifest.json`, (route) => route.fulfill({ json: v2Manifest() }));
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  // List rows require a parsed annotation, so this proves the OA entry
  // survived normalization and w3c.parse.
  await expect(page.locator('.tify-plugin-status')).toContainText('1 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('#panel tbody tr')).toHaveCount(1);
  await expect(page.locator('#panel tbody tr').first()).toContainText('Note 1');
});

test('a loaded plugin silences its own missing-plugin warning', async ({ page }) => {
  // Registered after beforeEach: the later route wins for the manifest URL.
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route(`${MOCK_BASE}/manifest.json`, (route) =>
    route.fulfill({ json: featureManifest() }),
  );
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  // The plugin runs, so core must not warn about a missing annotorious —
  // but the unhandled TEI/score features of that manifest still warn.
  await expect
    .poll(() => warnings.filter((l) => l.includes('tify-plugin-annotorious')).length)
    .toBe(0);
  await expect
    .poll(() => warnings.filter((l) => l.includes('tify-plugin-image-overlays')).length)
    .toBe(1);
});

/** Manifest with annotations plus TEI and score links other plugins own. */
function featureManifest(): object {
  const manifest = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${MOCK_BASE}/manifest.json`,
    type: 'Manifest',
    label: { en: ['Mock Book'] },
    items: [
      {
        id: `${MOCK_BASE}/canvas/p1`,
        type: 'Canvas',
        label: { en: ['Page 1'] },
        width: 750,
        height: 1000,
        items: [
          {
            id: `${MOCK_BASE}/page/p1/1`,
            type: 'AnnotationPage',
            items: [
              {
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
              },
            ],
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
        seeAlso: [{ id: `${MOCK_BASE}/tei.xml`, type: 'Text', format: 'application/tei+xml' }],
        rendering: [
          { id: `${MOCK_BASE}/score.musicxml`, format: 'application/vnd.recordare.musicxml+xml' },
        ],
      },
    ],
  };
  return manifest;
}

test('double-page spread shows annotations from both facing pages', async ({ page }) => {
  test.setTimeout(90_000);
  if (!(await webglAvailable(page))) {
    test.skip(true, 'no WebGL: annotorious cannot draw shapes');
  }
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  // buildManifest attaches 2 annotations to each canvas; single-page view
  // shows page 1's only.
  await page.locator('button[title="Toggle double-page"]').click();
  // Cover spread: only page 1 is real → still page 1's two annotations.
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  // Next: spread [2,3] — both facing pages contribute their own two
  // annotations ("Page 2/3 Note N").
  await page.locator('button[title="Next page"] >> nth=0').click();
  await expect(page.locator('.tify-plugin-status')).toContainText('4 annotations', {
    timeout: 15_000,
  });
  const rows = page.locator('#panel tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Page 2 Note 1');
  await expect(rows.nth(2)).toContainText('Page 3 Note 1');
  // The facing page's shapes are offset into the world's shared space:
  // clicking page 3's first shape (center at canvas px 150,175) selects its
  // row. Home view: the spread spans 2.005 × 1000/750 viewport units.
  await expect(page.locator('.tify-loading')).toBeHidden({ timeout: 15_000 });
  const SPREAD = { w: 2.005, h: 1000 / 750 };
  const point = async (): Promise<{ x: number; y: number }> => {
    const box = await page.locator('canvas.a9s-gl-canvas').boundingBox();
    if (!box) throw new Error('annotorious display canvas missing');
    const unit = Math.min(box.width / SPREAD.w, box.height / SPREAD.h);
    const ox = (box.width - SPREAD.w * unit) / 2;
    const oy = (box.height - SPREAD.h * unit) / 2;
    // Page 3 sits at layout x 1.005 (first-page units); annotation 1 at
    // canvas px 50,100,200,150 → center 150,175.
    return {
      x: box.x + ox + (1.005 + 150 / 750) * unit,
      y: box.y + oy + (175 / 750 / 1) * unit,
    };
  };
  await expect
    .poll(async () => {
      const p = await point();
      await page.mouse.move(p.x, p.y, { steps: 5 });
      await page.mouse.down();
      await page.mouse.up();
      return page.locator('#panel tbody tr').nth(2).getAttribute('aria-current');
    })
    .toBe('true');
});
