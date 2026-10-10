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
  // Panels auto-open after init: the plugin UI is visible out of the box.
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.tify-plugin-status')).toHaveText('Viewing page 1');
  await expect(page.locator('#panel')).toContainText('Mock Book');
});

test('shows a code example with the panel toggle and docs link', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  // In-viewer toggle for the docked panel, carrying the plugin glyph.
  const toggle = page.locator('#toggle-panel');
  await expect(toggle).toBeVisible();
  await expect(toggle.locator('svg')).toBeAttached();
  // Toggle hides and re-shows the docked panel.
  await expect(page.locator('#panel')).toBeVisible();
  await toggle.click();
  await expect(page.locator('#panel')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#panel')).toBeVisible();
  // Code example below the viewer, with a link to the rendered plugin docs.
  const code = page.locator('details.code-example');
  await expect(code).toBeVisible();
  await expect(code).toContainText('sidePanelPlugin');
  const docsLink = code.locator('a[href="../../../docs/plugin-side-panel.html"]');
  await expect(docsLink).toBeAttached();
  await code.locator('summary').click(); // expand → link becomes visible
  await expect(docsLink).toBeVisible();
});

test('dock button closes and reopens the panel', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#panel')).toBeHidden();
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
});

test('prev/next buttons navigate pages', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
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
