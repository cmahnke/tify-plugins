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
  await expect(page.locator('#panel')).toHaveAttribute('data-shapes', 'off');
  await expect(page.locator('#panel')).toContainText('Shapes not rendered (WebGL unavailable)');
  // List still renders, as plain rows (no canvas shapes, no select buttons).
  // NB: annotorious may leave an orphan (non-functional) GL canvas element
  // behind after its init throws — the panel flag is the source of truth.
  await expect(page.locator('#panel tbody tr')).toHaveCount(2);
  await expect(page.locator('#panel .tify-plugin-anno-link')).toHaveCount(0);
});
