import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-navplace/example/';

/**
 * Minimal MapLibre style: a background layer only, so no vector tiles and
 * no glyphs are fetched — the suite stays fully offline while still
 * exercising the real lazy-loading map boot (worker + style + canvas).
 */
const MOCK_STYLE = {
  version: 8,
  name: 'Mock basemap',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dddddd' } }],
};

/** Manifest-level navPlace plus a canvas-level one on page 2. */
function navPlaceManifest(): object {
  const manifest = buildManifest({ canvases: 3 }) as Record<string, any>;
  manifest.navPlace = {
    id: `${MOCK_BASE}/feature-collection`,
    type: 'FeatureCollection',
    features: [
      {
        id: `${MOCK_BASE}/feature/1`,
        type: 'Feature',
        properties: { label: { en: ['Göttingen'], de: ['Göttingen (Stadt)'] } },
        geometry: { type: 'Point', coordinates: [9.938, 51.533] },
      },
      {
        id: `${MOCK_BASE}/feature/2`,
        type: 'Feature',
        properties: { name: 'Berlin' },
        geometry: { type: 'Point', coordinates: [13.2807, 52.5059] },
      },
    ],
  };
  manifest.items[1].navPlace = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { label: { en: ['Hamburg'], de: ['Hamburg'] } },
        geometry: { type: 'Point', coordinates: [9.993, 53.551] },
      },
    ],
  };
  return manifest;
}

/** Counts requests matching a chunk pattern (dev and preview alike). */
function trackRequests(page: Page, pattern: RegExp): { count: () => number } {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (pattern.test(request.url())) urls.push(request.url());
  });
  return { count: () => urls.length };
}

/** Headless browsers without software GL cannot boot the map (WebGL2 only:
    MapLibre v6 does not fall back to WebGL 1). */
async function webgl2Available(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2'));
    } catch {
      return false;
    }
  });
}

test.beforeEach(async ({ page }) => {
  await mockIiif(page, { manifest: navPlaceManifest() });
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: MOCK_STYLE }),
  );
});

test('docks a places panel listing the manifest places', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-navplace');
  await expect(dock).toContainText('Places');
  // Panels auto-open after init.
  await expect(page.locator('#panel h2')).toHaveText('Places');
  await expect(page.locator('#panel .navplace-row')).toHaveCount(2);
  await expect(page.locator('.navplace-row-label').first()).toHaveText('Göttingen');
  await expect(page.locator('.navplace-row-label').nth(1)).toHaveText('Berlin');
  // With WebGL2 the map boots and the status clears; without it the plugin
  // degrades gracefully — the rows stay, the status explains the missing map.
  if (await webgl2Available(page)) {
    await expect(page.locator('#panel .tify-plugin-status')).toHaveText('');
    await expect(page.locator('.navplace-map .maplibregl-canvas')).toBeVisible({
      timeout: 20_000,
    });
  } else {
    await expect(page.locator('#panel .tify-plugin-status')).toContainText('Map unavailable');
  }
});

test('canvas places follow the visible page', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel .navplace-row')).toHaveCount(2);
  await page.locator('button[title="Next page"] >> nth=0').click();
  await expect(page.locator('#panel .navplace-row')).toHaveCount(3);
  await expect(page.locator('.navplace-row-label').nth(2)).toHaveText('Hamburg');
  // Back to a page without canvas places: the canvas feature disappears.
  await page.locator('button[title="Previous page"] >> nth=0').click();
  await expect(page.locator('#panel .navplace-row')).toHaveCount(2);
});

test('german labels come from the language map', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}&lang=de`,
  );
  await expect(page.locator('.tify-plugin-dock-navplace')).toContainText('Orte');
  await expect(page.locator('#panel .navplace-row')).toHaveCount(2);
  await expect(page.locator('.navplace-row-label').first()).toHaveText('Göttingen (Stadt)');
  await expect(page.locator('.navplace-row-label').nth(1)).toHaveText('Berlin');
  // TIFY's own chrome is un-translated in tests (CDN mocked away), so the
  // navigation button keeps its English title.
  await page.locator('button[title="Next page"] >> nth=0').click();
  await expect(page.locator('#panel .navplace-row')).toHaveCount(3);
  await expect(page.locator('.navplace-row-label').nth(2)).toHaveText('Hamburg');
});

test('the basemap style is configurable', async ({ page }) => {
  const custom = trackRequests(page, /maps\.example\.test\/style\.json/);
  const openfreemap = trackRequests(page, /tiles\.openfreemap\.org/);
  await page.route('https://maps.example.test/style.json', (route) =>
    route.fulfill({ json: MOCK_STYLE }),
  );
  await page.goto(
    `${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}` +
      `&style=${encodeURIComponent('https://maps.example.test/style.json')}`,
  );
  if (await webgl2Available(page)) {
    await expect(page.locator('.navplace-map .maplibregl-canvas')).toBeVisible({
      timeout: 20_000,
    });
  }
  // The custom style replaced the OpenFreeMap default (which the panel
  // would otherwise fetch once the map boots).
  if (await webgl2Available(page)) {
    await expect.poll(() => custom.count()).toBeGreaterThan(0);
    await expect.poll(() => openfreemap.count()).toBe(0);
  }
});

test('a manifest without navPlace never loads the map viewer', async ({ page }) => {
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  const mapChunks = trackRequests(page, /map-viewer|maplibre/);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel h2')).toHaveText('Places');
  await expect(page.locator('#panel .tify-plugin-status')).toContainText(
    'No places in this manifest',
  );
  await expect(page.locator('#panel .navplace-row')).toHaveCount(0);
  // Laziness: no map chunk is fetched when there is nothing to show.
  await page.waitForTimeout(1500);
  expect(mapChunks.count()).toBe(0);
});

/** Console text captured from page load (warnings + errors only). */
function captureConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') lines.push(message.text());
  });
  return lines;
}

test('a loaded navplace plugin silences its own feature warning', async ({ page }) => {
  // The manifest advertises navPlace (manifest-level + page 2), so without
  // the plugin core would warn about @projektemacher/tify-plugin-navplace.
  const lines = captureConsole(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel h2')).toHaveText('Places');
  await expect(page.locator('#panel .navplace-row')).toHaveCount(2);
  expect(lines.filter((l) => l.includes('[tify-plugins]'))).toEqual([]);
});
