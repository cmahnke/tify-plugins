import { expect, test } from '@playwright/test';

test('catalog lists every example plus the docs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main.catalog')).toBeVisible();
  for (const pkg of [
    'core',
    'plugin-side-panel',
    'plugin-image-overlays',
    'plugin-annotorious',
    'plugin-hdr',
    'plugin-c2pa',
  ]) {
    await expect(page.locator(`a[href="./packages/${pkg}/example/"]`)).toBeVisible();
  }
  await expect(page.locator('a[href="./docs/"]')).toBeVisible();
});

test('example links resolve to their example page', async ({ page }) => {
  await page.goto('/');
  await page.click('a[href="./packages/core/example/"]');
  await expect(page).toHaveURL(/\/packages\/core\/example\//);
  await expect(page.locator('main.example h1')).toBeVisible();
});
