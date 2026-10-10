import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildInfo, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-c2pa/example/';

test.beforeEach(async ({ page }) => {
  await mockIiif(page, {
    manifest: buildManifest({ canvases: 1 }),
    info: buildInfo({ c2pa: true }),
  });
});

// `trustAnchors=` (empty) keeps the boot hermetic: no live trust-anchor
// fetch. c2pa-web's WASM cannot initialise on WebKit (blob: URLs fail), so
// tile verdicts are only asserted where the engine runs.
test(`checks viewport tiles and reports unsigned provenance`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(
    `${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}&trustAnchors=`,
  );
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toContainText('Provenance');
  await dock.click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#panel h2')).toHaveText('Provenance');
  await expect(page.locator('.tify-plugin-service-line')).toHaveText(
    'Image service advertises C2PA: yes',
    { timeout: 30_000 },
  );
  await expect(page.locator('#panel input[type="url"]')).toBeVisible();
  const rows = page.locator('#panel tbody tr');
  await expect(rows.first()).toBeVisible();
  if (testInfo.project.name === 'webkit') return; // no WASM engine: tiles stay unknown
  await expect(rows.first().locator('.pill')).toHaveText('unsigned', { timeout: 60_000 });
  await expect(rows.first()).toContainText('Tile carries no C2PA manifest');
});
