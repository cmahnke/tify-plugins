import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-annotorious/example/';

// Panel-only degradation, exercised for real: WebGL disabled via Firefox
// prefs (launchOptions need a top-level test.use — describe groups that
// force a new worker are rejected). Firefox-only: the prefs are Firefox's;
// the other engines ignore them, so their WebGL stays available.
test.use({ launchOptions: { firefoxUserPrefs: { 'webgl.disabled': true } } });

test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox prefs only');

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 2, annotations: 2 }) });
});

test('degrades to panel-only mode without WebGL', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('.tify-plugin-status')).toContainText('2 annotations', {
    timeout: 15_000,
  });
  await expect(page.locator('.tify-plugin-panel')).toHaveAttribute('data-shapes', 'off');
  await expect(page.locator('.tify-plugin-panel')).toContainText(
    'Shapes not rendered (WebGL unavailable)',
  );
  // List still renders, as plain rows (no canvas shapes, no select buttons).
  // Annotorious appends its GL canvas before creating the renderer, so a
  // failed init would leave a dead element behind — the plugin removes it.
  await expect(page.locator('canvas.a9s-gl-canvas')).toHaveCount(0);
  await expect(page.locator('.tify-plugin-panel tbody tr')).toHaveCount(2);
  await expect(page.locator('.tify-plugin-panel .tify-plugin-anno-link')).toHaveCount(0);
});
