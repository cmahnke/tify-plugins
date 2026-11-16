// Panel host modes: the page-author-supplied element, the plugin-created
// auto host (no markup required), the disabled panel (panelEl: null), and
// the sidecar fallback — plus owned vs. page-owned cleanup on destroy().
import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const PAGE = '/packages/core/e2e/page/';

async function boot(page: Page, mode: string): Promise<void> {
  await mockIiif(page, { manifest: buildManifest({ canvases: 2, annotations: 2 }) });
  await page.goto(
    `${PAGE}?mode=${mode}&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
}

test('auto: plugin creates its own host and docks it into the viewer', async ({ page }) => {
  await boot(page, 'auto');
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  const panel = page.locator('.tify-plugin-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Mock Book');
  // The host lives inside the viewer chrome, not in the page layout.
  expect(await panel.evaluate((el) => Boolean(el.closest('.tify-main')))).toBe(true);
  // The auto host is plugin-owned: no aside with a stable page id.
  expect(await panel.evaluate((el) => el.classList.contains('tify-plugin-panel-auto'))).toBe(true);
  await dock.click();
  await expect(panel).toBeHidden();
  await dock.click();
  await expect(panel).toBeVisible();
});

test('auto: destroy removes the owned host', async ({ page }) => {
  await boot(page, 'auto');
  await expect(page.locator('.tify-plugin-panel')).toBeVisible();
  await page.locator('#destroy').click();
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
  await expect(page.locator('.tify-plugin-dock-btn')).toHaveCount(0);
});

test('explicit: page-owned host is used and kept on destroy', async ({ page }) => {
  await boot(page, 'explicit');
  const panel = page.locator('#host');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Mock Book');
  expect(await panel.evaluate((el) => Boolean(el.closest('.tify-main')))).toBe(true);
  await page.locator('#destroy').click();
  // The page-owned element stays in the DOM, emptied and de-classed.
  await expect(page.locator('#host')).toHaveCount(1);
  await expect(page.locator('#host .tify-plugin-body')).toHaveCount(0);
  expect(await panel.evaluate((el) => el.classList.contains('tify-plugin-panel'))).toBe(false);
});

test('none: panelEl null disables the panel completely', async ({ page }) => {
  await boot(page, 'none');
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
  await expect(page.locator('.tify-plugin-dock-btn')).toHaveCount(0);
  // Destroy is a no-op, not a crash.
  await page.locator('#destroy').click();
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
});

test('sidecar: dock false renders the auto host beside the viewer', async ({ page }) => {
  await boot(page, 'sidecar');
  const panel = page.locator('.tify-plugin-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Mock Book');
  expect(await panel.evaluate((el) => Boolean(el.closest('.tify-main')))).toBe(false);
  await expect(page.locator('.tify-plugin-dock-btn')).toHaveCount(0);
  await page.locator('#destroy').click();
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
});

test('overlays: annotorious with panelEl null keeps shapes, drops the panel', async ({ page }) => {
  await boot(page, 'overlays');
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
  await expect(page.locator('.tify-plugin-dock-btn')).toHaveCount(0);
  // Shapes need WebGL (headless Firefox may lack it); degrade silently,
  // exactly like the panel-only path minus the panel note.
  const webgl = await page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  });
  if (webgl) {
    await expect(page.locator('canvas.a9s-gl-canvas')).toBeAttached({ timeout: 15_000 });
  } else {
    await expect(page.locator('canvas.a9s-gl-canvas')).toHaveCount(0);
  }
  await page.locator('#destroy').click();
  await expect(page.locator('.tify-plugin-panel')).toHaveCount(0);
});
