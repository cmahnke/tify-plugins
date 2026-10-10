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

test('imports manifest annotations into panel and display layer', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('#panel tbody tr')).toHaveCount(2);
  await expect(page.locator('#panel tbody tr').first()).toContainText('Note 1');
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations');
  // Annotorious mounts its WebGL display layer over the viewer.
  const canvas = page.locator('canvas.a9s-gl-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
  await expect(page.locator('svg.a9s-annotationlayer')).toBeAttached();
});

test('clicking a canvas shape highlights its list row', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('#panel tbody tr')).toHaveCount(2);
  const point = await imageToElement(page, ANNO_CENTER.x, ANNO_CENTER.y);
  const row = page.locator('#panel tbody tr').first();
  // The annotorious display layer draws on its WebGL canvas asynchronously;
  // click until the shape hit-registers (proves end-to-end selectability).
  await expect
    .poll(
      async () => {
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(500);
        return row.evaluate((element) => element.className);
      },
      { timeout: 15_000 },
    )
    .toContain('is-active');
});

test('clicking a list row zooms the viewer to the annotation', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  const transform = page.locator('.a9s-annotationlayer > g').first();
  await expect(transform).toBeAttached();
  const before = await transform.getAttribute('transform');
  await page.locator('.tify-plugin-dock-btn').click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#panel tbody tr button').first().click();
  await expect
    .poll(async () => transform.getAttribute('transform'), { timeout: 8000 })
    .not.toBe(before);
});
