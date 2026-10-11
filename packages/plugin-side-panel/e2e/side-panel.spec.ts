import { expect, test } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-side-panel/example/';

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 3 }) });
});

test('docks a Document panel and reports the page status', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toContainText('Document');
  // Panels auto-open after init: the plugin UI is visible out of the box.
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.tify-plugin-status')).toHaveText('Viewing page 1');
  await expect(page.locator('#panel')).toContainText('Mock Book');
  // The example documents how the panel contents are constructed.
  await expect(page.locator('main.example > h1 + p')).toContainText(
    'sidePanelPlugin renders the panel',
  );
});

test('docks its button into the view group and shows a code example', async ({ page }) => {
  // Wide viewer: TIFY lays the -view group out inline (the -toggle group is
  // display:none), so the dock button belongs there as its last element.
  await page.setViewportSize({ width: 2400, height: 900 });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const button = page.locator('.tify-plugin-dock-btn');
  await expect(button).toHaveCount(1);
  // Poll: the placement settles once TIFY's header has finished rendering and
  // the container-query layout has been applied.
  await expect
    .poll(async () =>
      button.evaluate((el) => ({
        parentClass: el.parentElement?.className ?? '',
        isLastChild: el.parentElement?.lastElementChild === el,
        groupHasOtherButtons: (el.parentElement?.childElementCount ?? 0) > 1,
        visible: (el as HTMLElement).offsetParent !== null,
      })),
    )
    .toMatchObject({
      parentClass: expect.stringContaining('-view'),
      isLastChild: true,
      groupHasOtherButtons: true,
      visible: true,
    });

  // Narrow viewer: TIFY's container query hides the -view group (it sits
  // inside the view dropdown) and shows -toggle — the button must follow.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () =>
      button.evaluate((el) => ({
        parentClass: el.parentElement?.className ?? '',
        visible: (el as HTMLElement).offsetParent !== null,
      })),
    )
    .toMatchObject({ parentClass: expect.stringContaining('-toggle'), visible: true });

  // The button toggles the docked panel.
  await expect(page.locator('#panel')).toBeVisible();
  await button.click();
  await expect(page.locator('#panel')).toBeHidden();
  await button.click();
  await expect(page.locator('#panel')).toBeVisible();

  // Code example below the viewer, with a link to the rendered plugin docs.
  const code = page.locator('details.code-example');
  await expect(code).toBeVisible();
  await expect(code).toContainText('sidePanelPlugin');
  // The snippet shows the panel contents built programmatically.
  await expect(code).toContainText('createSidePanel');
  await expect(code).toContainText('panel.body.append');
  // The snippet is syntax-highlighted (highlight.js runs on page load,
  // even while the details element is still collapsed).
  await expect(code.locator('code span.hljs-keyword').first()).toBeAttached();
  await expect(code.locator('code span.hljs-string').first()).toBeAttached();
  // The host markup block shows where #panel comes from, highlighted as XML.
  await expect(code).toContainText('<aside id="panel">');
  await expect(code.locator('code.language-xml span.hljs-name').first()).toHaveText('div');
  const docsLink = code.locator('a[href="../../../docs/plugin-side-panel.html"]');
  await expect(docsLink).toBeAttached();
  await code.locator('summary').click(); // expand → link becomes visible
  await expect(docsLink).toBeVisible();
});

test('dock button closes and reopens the panel', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#panel')).toBeHidden();
  await dock.click();
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeVisible();
});

test('prev/next buttons navigate pages', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const status = page.locator('.tify-plugin-status');
  await expect(status).toHaveText('Viewing page 1');
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(status).toHaveText('Viewing page 2');
  await page.getByRole('button', { name: '← Previous' }).click();
  await expect(status).toHaveText('Viewing page 1');
});

test('thumbnails button hands the view back to TIFY and closes the dock', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(dock).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 });
});

test('german example chrome and plugin strings (?lang=de)', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?lang=de&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await expect(page.locator('main.example > h1')).toHaveText('Seitenleiste');
  await expect(page.locator('main.example > h1 + p')).toContainText(
    'sidePanelPlugin rendert das Panel',
  );
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toContainText('Dokument');
  await expect(page.locator('.tify-plugin-status')).toHaveText('Seite 1 wird angezeigt');
});
