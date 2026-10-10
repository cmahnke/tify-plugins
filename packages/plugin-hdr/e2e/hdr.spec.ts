import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildInfo, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-hdr/example/';

// The HDR canvas hook is a Chromium-only feature; the capability rows degrade
// gracefully, but the meaningful assertions need the experimental flag.
test.skip(({ browserName }) => browserName !== 'chromium', 'HDR is Chromium-only');

test.use({ launchOptions: { args: ['--enable-experimental-web-platform-features'] } });

test.beforeEach(async ({ page }) => {
  await mockIiif(page, {
    manifest: buildManifest({ canvases: 1 }),
    info: buildInfo({ hdr: true }),
  });
});

test('reports capability status and an HDR-advertising image service', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toContainText('HDR');
  await expect(dock).toHaveAttribute('title', /Display HDR: (yes|no)/);
  await dock.click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#panel h2')).toHaveText('HDR');
  await expect(page.locator('#panel .pill')).toHaveText('HDR advertised');
  await expect(page.locator('#panel h3')).toHaveText('Image service');
  await expect(page.locator('#panel table')).toContainText('API version');
});
