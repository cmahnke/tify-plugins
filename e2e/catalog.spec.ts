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
    'plugin-musicxml',
  ]) {
    await expect(page.locator(`a[href="./packages/${pkg}/example/"]`)).toBeVisible();
  }
  await expect(page.locator('a[href="./docs/"]')).toBeVisible();
});

test('every example card carries a description', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(8);
  for (const card of await cards.all()) {
    const heading = card.locator('h2');
    await expect(heading).not.toBeEmpty();
    await expect(card.locator('p')).not.toBeEmpty();
  }
});

test('example links resolve to their example page', async ({ page }) => {
  await page.goto('/');
  await page.click('a[href="./packages/core/example/"]');
  await expect(page).toHaveURL(/\/packages\/core\/example\//);
  await expect(page.locator('main.example h1')).toBeVisible();
});

test('language switcher toggles EN/DE live', async ({ page }) => {
  await page.goto('/');
  const switcher = page.locator('.lang-switch');
  await expect(switcher).toBeVisible();
  // Default (no ?lang=, en-US browser locale): English.
  await expect(page.locator('main.catalog > header h1')).toHaveText('tify-plugins');
  await expect(page.locator('.card a h2').first()).toHaveText('Basic embed');
  await expect(page.locator('.lang-btn[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.lang-btn[data-lang="de"]').click();
  await expect(page).toHaveURL(/lang=de/);
  await expect(page.locator('.card a h2').first()).toHaveText('Einfache Einbettung');
  await expect(page.locator('.lang-btn[data-lang="de"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lang-btn[data-lang="en"]')).toHaveAttribute('aria-pressed', 'false');
  // <html lang> follows the switch.
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.locator('.lang-btn[data-lang="en"]').click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page.locator('.card a h2').first()).toHaveText('Basic embed');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
