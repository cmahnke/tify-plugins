import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/core/example/';

test('minimal embed mounts the viewer with the mocked manifest', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify').first()).toBeVisible();
});

test('manifest URL box reloads with the entered manifest', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(EXAMPLE);
  // Wait for the example module (and its listeners) to boot before interacting.
  await expect(page.locator('.tify').first()).toBeVisible();
  await page.fill('#manifest', `${MOCK_BASE}/manifest.json`);
  // Dispatch directly: under parallel load TIFY's layout shifts can move the
  // button between hit-test and dispatch; this test covers the reload flow.
  await page.locator('#load').dispatchEvent('click');
  await expect(page).toHaveURL(/manifest=/);
  await expect(page.locator('.tify').first()).toBeVisible();
});
