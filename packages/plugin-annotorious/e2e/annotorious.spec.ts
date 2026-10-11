import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-annotorious/example/';
// Fixture: 750x1000 image, annotation 1 at xywh=50,100,200,150
// (center image point 150,175).
const IMAGE = { width: 750, height: 1000 };
const ANNO_CENTER = { x: 150, y: 175 };

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 2, annotations: 2 }) });
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
