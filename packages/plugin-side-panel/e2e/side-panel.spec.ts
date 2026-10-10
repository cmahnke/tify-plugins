import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-side-panel/example/';

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 3 }) });
});

test('docks a Document panel and reports the page status', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toContainText('Document');
  // Docked panels start closed; the status is still in the DOM.
  await expect(page.locator('.tify-plugin-status')).toHaveText('Viewing page 1');
  await expect(page.locator('#panel')).toContainText('Mock Book');
});

test('dock button opens and closes the panel', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'false');
});

test('prev/next buttons navigate pages', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await page.locator('.tify-plugin-dock-btn').click();
  const status = page.locator('.tify-plugin-status');
  await expect(status).toHaveText('Viewing page 1');
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(status).toHaveText('Viewing page 2');
  await page.getByRole('button', { name: '← Previous' }).click();
  await expect(status).toHaveText('Viewing page 1');
});

test('thumbnails button hands the view back to TIFY and closes the dock', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(dock).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 });
});

test('german example chrome and plugin strings (?lang=de)', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?lang=de&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await expect(page.locator('main.example > h1')).toHaveText('Seitenleiste');
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toContainText('Dokument');
  await expect(page.locator('.tify-plugin-status')).toHaveText('Seite 1 wird angezeigt');
});
