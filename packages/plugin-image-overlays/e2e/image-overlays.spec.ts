import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-image-overlays/example/';

test('renders TEI word boxes from the seeAlso fixture', async ({ page }) => {
  await mockIiif(page, { manifest: 'tei-fixture' });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(5);
  await expect(words.first()).toHaveAttribute('title', 'Gänseliesel');
});

test('falls back to demo markers that advance the page on click', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 3 }) });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const markers = page.locator('.tify-plugin-marker');
  await expect(markers).toHaveCount(3);
  await expect(markers.first()).toHaveText('P1·1');
  await markers.first().click();
  await expect(markers.first()).toHaveText('P2·1');
});
