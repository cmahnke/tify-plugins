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

test('opens with the live TEI demo by default', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  // No ?manifest=: the bundled demo manifest + TEI load for real
  // (same-origin static files, served in dev and preview).
  await page.goto(EXAMPLE);
  await expect(page.locator('#manifest')).toHaveValue(/demo\/tei\/manifest\.json$/);
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(2);
  await expect(words.first()).toHaveAttribute('title', 'Gänseliesel');
  await expect(words.nth(1)).toHaveAttribute('title', 'Brunnen');
  // Word text renders inside the boxes and fits them at any zoom.
  await expect(words.first()).toContainText('Gänseliesel');
  await expect(words.nth(1)).toContainText('Brunnen');
  await expect
    .poll(() =>
      words.evaluateAll((els) =>
        els.every(
          (el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
        ),
      ),
    )
    .toBe(true);
});

test('clicking a word box shows its text in the sidebar', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(EXAMPLE);
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(2);
  await words.first().click();
  await expect(words.first()).toHaveClass(/is-selected/);
  await expect(page.locator('#panel .tify-plugin-note')).toHaveText('Selected: Gänseliesel');
});

test('sidebar toggles annotations and outlines', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(EXAMPLE);
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Show outlines' }).uncheck();
  await expect
    .poll(() => words.first().evaluate((el) => getComputedStyle(el).outlineStyle))
    .toBe('none');
  // The fill stays on while the frame is hidden.
  await expect
    .poll(() => words.first().evaluate((el) => getComputedStyle(el).backgroundColor))
    .toMatch(/rgba\(11, 95, 255, 0\.12\)/);
  await page.getByRole('checkbox', { name: 'Show annotations' }).uncheck();
  await expect(words.first()).toBeHidden();
  await expect(words.nth(1)).toBeHidden();
});

test('fill color and opacity restyle the boxes', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(EXAMPLE);
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(2);
  await page.locator('#panel input[type="color"]').fill('#ff0000');
  await page.locator('#panel input[type="range"]').fill('0.5');
  await expect
    .poll(() => words.first().evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgba(255, 0, 0, 0.5)');
});

test('opacity slider stays visible when docked inside TIFY', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(EXAMPLE);
  const slider = page.locator('#panel input[type="range"]');
  await expect(slider).toBeVisible();
  // TIFY skins every [type=range] under .tify as its own scan slider
  // (~6px stump, invisible thumb); ours must render taller than that.
  // Engine-agnostic: pseudo-element computed styles aren't queryable everywhere.
  const box = await slider.boundingBox();
  expect(box?.height).toBeGreaterThan(6);
});

test('URL params initialize rendering state via the API', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(
    `${EXAMPLE}?annotations=0&outlines=0&fill=${encodeURIComponent('#ff0000')}&opacity=0.5`,
  );
  const words = page.locator('.tify-plugin-tei-word');
  await expect(words).toHaveCount(2);
  await expect
    .poll(() => words.first().evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgba(255, 0, 0, 0.5)');
  await expect(page.locator('#panel input[type="color"]')).toHaveValue('#ff0000');
  await expect(page.locator('#panel input[type="range"]')).toHaveValue('0.5');
  await expect(page.getByRole('checkbox', { name: 'Show annotations' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Show outlines' })).not.toBeChecked();
});
