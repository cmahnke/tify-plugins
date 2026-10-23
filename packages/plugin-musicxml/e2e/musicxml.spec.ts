import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_BASE, buildInfo, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-musicxml/example/';
const TEI_URL = `${MOCK_BASE}/page1.tei.xml`;
const SCORE_URL = `${MOCK_BASE}/score.musicxml`;

const here = path.dirname(fileURLToPath(import.meta.url));
const SCORE_XML = readFileSync(path.join(here, '..', 'test-fixtures', 'page006.musicxml'), 'utf8');
// The TEI embeds the MusicXML verbatim from the root element on (no XML
// declaration — generate_tei.py strips it on embedding).
const EMBEDDED_SCORE = SCORE_XML.replace(/^<\?xml[^>]*\?>\s*/, '');

/**
 * Synthetic homr page TEI: staff zones over 750×1000 canvas pixels, five
 * staff lines per zone (20 px apart, slight slope), homr application header,
 * and the fixture MusicXML embedded under <div type="score">. The staff
 * count is configurable so spreads can tell pages apart (region counts).
 */
function pageTei(staffCount = 1, title = 'Mock Score (page 1)'): string {
  const x0 = 50;
  const x1 = 700;
  const points = 8;
  const zones: string[] = [];
  for (let staff = 0; staff < staffCount; staff++) {
    const y0 = 100 + staff * 200;
    const paths = [];
    for (let k = 0; k < 5; k++) {
      const pts: string[] = [];
      for (let i = 0; i < points; i++) {
        const x = x0 + ((x1 - x0) * i) / (points - 1);
        pts.push(`${x},${y0 + k * 20 + 0.02 * (x - x0)}`);
      }
      paths.push(`        <path type="staff-line" points="${pts.join(' ')}"/>`);
    }
    zones.push(
      `      <zone xml:id="p1-staff-${staff + 1}" type="staff" ulx="${x0}" uly="${y0}" lrx="${x1}" lry="${y0 + 140}">\n${paths.join('\n')}\n      </zone>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>${title}</title></titleStmt>
      <publicationStmt><publisher>Mock</publisher></publicationStmt>
      <sourceDesc><bibl><title>Mock Score Book</title></bibl></sourceDesc>
    </fileDesc>
    <encodingDesc>
      <appInfo>
        <application version="1" ident="homr" status="ok" confidence="1.000">
          <label>homr</label>
          <p>Mock OMR run.</p>
        </application>
      </appInfo>
    </encodingDesc>
  </teiHeader>
  <facsimile>
    <surface ulx="0" uly="0" lrx="750" lry="1000">
      <graphic url="${MOCK_BASE}/image"/>
${zones.join('\n')}
    </surface>
  </facsimile>
  <text>
    <body>
      <div type="score">
${EMBEDDED_SCORE}
      </div>
    </body>
  </text>
</TEI>`;
}

function scoreManifest(): object {
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${MOCK_BASE}/manifest.json`,
    type: 'Manifest',
    label: { en: ['Mock Score Book'] },
    items: [
      {
        id: `${MOCK_BASE}/canvas/p1`,
        type: 'Canvas',
        label: { en: ['Page 1'] },
        width: 750,
        height: 1000,
        items: [
          {
            id: `${MOCK_BASE}/page/p1/1`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${MOCK_BASE}/annotation/p1-image`,
                type: 'Annotation',
                motivation: 'painting',
                body: {
                  id: `${MOCK_BASE}/image/full/750,1000/0/default.jpg`,
                  type: 'Image',
                  format: 'image/jpeg',
                  width: 750,
                  height: 1000,
                  service: [{ id: `${MOCK_BASE}/image`, type: 'ImageService3', profile: 'level2' }],
                },
                target: `${MOCK_BASE}/canvas/p1`,
              },
            ],
          },
        ],
        rendering: [
          {
            id: TEI_URL,
            type: 'Text',
            format: 'application/tei+xml',
            label: { en: ['TEI (staff regions + embedded MusicXML)'] },
          },
        ],
      },
    ],
  };
}

async function mockScore(page: Page): Promise<void> {
  await mockIiif(page, { manifest: scoreManifest(), info: buildInfo() });
  await page.route(TEI_URL, (route) =>
    route.fulfill({ body: pageTei(), contentType: 'application/xml' }),
  );
}

/** Three-canvas manifest; each canvas carries its own TEI rendering (per-page staff counts). */
function spreadManifest(): object {
  const canvas = (page: number): object => ({
    id: `${MOCK_BASE}/canvas/p${page}`,
    type: 'Canvas',
    label: { en: [`Page ${page}`] },
    width: 750,
    height: 1000,
    items: [
      {
        id: `${MOCK_BASE}/page/p${page}/1`,
        type: 'AnnotationPage',
        items: [
          {
            id: `${MOCK_BASE}/annotation/p${page}-image`,
            type: 'Annotation',
            motivation: 'painting',
            body: {
              id: `${MOCK_BASE}/image/full/750,1000/0/default.jpg`,
              type: 'Image',
              format: 'image/jpeg',
              width: 750,
              height: 1000,
              service: [{ id: `${MOCK_BASE}/image`, type: 'ImageService3', profile: 'level2' }],
            },
            target: `${MOCK_BASE}/canvas/p${page}`,
          },
        ],
      },
    ],
    rendering: [
      {
        id: `${MOCK_BASE}/page${page}.tei.xml`,
        type: 'Text',
        format: 'application/tei+xml',
        label: { en: ['TEI (staff regions + embedded MusicXML)'] },
      },
    ],
  });
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${MOCK_BASE}/manifest.json`,
    type: 'Manifest',
    label: { en: ['Mock Score Book'] },
    items: [1, 2, 3].map(canvas),
  };
}

/** Mock the spread manifest plus its three per-page TEI documents. */
async function mockSpread(page: Page): Promise<void> {
  await mockIiif(page, { manifest: spreadManifest(), info: buildInfo() });
  for (const page_ of [1, 2, 3]) {
    await page.route(`${MOCK_BASE}/page${page_}.tei.xml`, (route) =>
      route.fulfill({
        body: pageTei(page_, `Mock Score (page ${page_})`),
        contentType: 'application/xml',
      }),
    );
  }
}

/** Record every scheduled oscillator start (time + frequency + waveform). */
async function interceptOscillators(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const starts: Array<{ t: number; f: number; w: string }> = [];
    Object.assign(window, { __oscStarts: starts });
    const RealCtx = window.AudioContext;
    const WrappedCtx = class extends RealCtx {
      override createOscillator(): OscillatorNode {
        const osc = super.createOscillator();
        const realStart = osc.start.bind(osc);
        osc.start = (when?: number): void => {
          starts.push({ t: when ?? 0, f: osc.frequency.value, w: osc.type });
          realStart(when);
        };
        return osc;
      }
    };
    window.AudioContext = WrappedCtx as unknown as typeof AudioContext;
  });
}

async function oscStarts(page: Page): Promise<Array<{ t: number; f: number; w: string }>> {
  return page.evaluate(() =>
    (
      window as unknown as { __oscStarts: Array<{ t: number; f: number; w: string }> }
    ).__oscStarts.slice(),
  );
}

/** Ensure the docked panel is open (auto-open makes it open initially) and wait for the player controls. */
async function openPlayer(page: Page): Promise<void> {
  const dock = page.locator('.tify-plugin-dock-btn');
  if ((await dock.getAttribute('aria-expanded')) !== 'true') await dock.click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.player-controls').first()).toBeVisible({ timeout: 30_000 });
}

/** Set a control value and fire its input event (color inputs and ranges). */
async function setInputValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.beforeEach(async ({ page }) => {
  await mockScore(page);
});

test('docks a score panel and renders the aligned score overlay', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toContainText('Score');
  await openPlayer(page);
  await expect(page.locator('#panel h2')).toHaveText('Score');
  // OSMD systems mapped onto the scan as nested score pieces.
  await expect(page.locator('.score-overlay > svg.score-system').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('plays a single staff: monophonic onsets on the grid', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  // All staves play by default; mute Staff 2 so only Staff 1 plays and
  // onsets stay monophonic.
  await page.locator('#player-staff-2').uncheck();
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(2200);
  const starts = await oscStarts(page);
  expect(starts.length).toBeGreaterThanOrEqual(3);
  // Oscillators are scheduled on the exact musical grid (seconds), so stacked
  // staves would produce identical start times; successive notes at 120 bpm
  // are at least an eighth note (0.25 s) apart.
  const times = starts.map((s) => s.t).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    expect(times[i] - times[i - 1]).toBeGreaterThan(0.1);
  }
});

test('playback highlights staff, note marker and playhead', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  // NB: the *computed* visibility must be checked — a CSS visibility rule
  // would silently override the visibility ATTRIBUTE and hide the layers
  // without failing attribute assertions.
  // With all staves playing by default, each playing staff has its own
  // highlight set — assert on the first one.
  for (const selector of ['.staff-current', '.note-marker', '.play-pos']) {
    const layer = page.locator(selector).first();
    await expect(layer).toHaveAttribute('visibility', 'visible', { timeout: 15_000 });
    await expect(layer).toHaveCSS('visibility', 'visible');
  }
});

test('note marker is sized proportionally to the staff geometry', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  const marker = page.locator('.note-marker').first();
  await expect(marker).toHaveAttribute('visibility', 'visible', { timeout: 15_000 });
  const r = parseFloat((await marker.getAttribute('r')) ?? '0');
  // Grid unit is 20 px here; the marker radius tracks staff line spacing.
  expect(r).toBeGreaterThanOrEqual(0.2 * 20);
  expect(r).toBeLessThanOrEqual(0.5 * 20);
});

test('plays all staves simultaneously by default', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(2500);
  const starts = await oscStarts(page);
  expect(starts.length).toBeGreaterThanOrEqual(4);
  const byTime = new Map<string, number[]>();
  for (const s of starts) {
    const key = s.t.toFixed(3);
    byTime.set(key, [...(byTime.get(key) ?? []), s.f]);
  }
  const pairs = [...byTime.values()].filter((fs) => fs.length >= 2);
  expect(pairs.length).toBeGreaterThanOrEqual(2);
});

test('instrument selection reschedules playback with the new waveform', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(1800);
  const first = await oscStarts(page);
  expect(first.length).toBeGreaterThanOrEqual(2);
  expect(first[0].w).toBe('triangle'); // piano default
  // each staff has its own instrument select; Staff 1's row is first
  await page.locator('.player-staff-row[data-staff="1"] .player-instrument').selectOption('synth');
  await page.waitForTimeout(1500);
  const second = await oscStarts(page);
  expect(second.length).toBeGreaterThan(first.length);
  expect(second[first.length]).toBeTruthy();
  expect(second[first.length].w).toBe('square');
});

test('score toggle hides and restores the rendered overlay', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const scoreSystem = page.locator('.score-overlay > svg.score-system').first();
  await expect(scoreSystem).toBeVisible({ timeout: 30_000 });
  await page.locator('#player-score-toggle').uncheck();
  await expect(page.locator('.score-overlay > svg.score-system')).toHaveCount(0);
  await page.locator('#player-score-toggle').check();
  await expect(page.locator('.score-overlay > svg.score-system').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('transport buttons are centered with icons above labels', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const transport = page.locator('.player-transport');
  await expect(transport).toBeVisible();
  const buttons = transport.locator('.player-btn');
  await expect(buttons).toHaveCount(3);
  // icon on top, text in its own line below
  const first = buttons.first();
  await expect(first.locator('svg.player-btn-icon')).toBeVisible();
  await expect(first.locator('.player-btn-label')).toHaveText('Play');
  // centered horizontally: symmetric outer margins across the row
  const centered = await transport.evaluate((el) => {
    const row = el.getBoundingClientRect();
    const firstRect = el.querySelector('.player-btn')?.getBoundingClientRect();
    const lastRect = el.querySelector('.player-btn:last-of-type')?.getBoundingClientRect();
    if (!firstRect || !lastRect) return false;
    return Math.abs(firstRect.left - row.left - (row.right - lastRect.right)) < 4;
  });
  expect(centered).toBe(true);
});

test('region overlay defaults to hidden regions', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const region = page.locator('.region-overlay .staff-region').first();
  const toggle = page.locator('#player-region-toggle');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(toggle).not.toBeChecked();
  await expect(region).toHaveAttribute('visibility', 'hidden');
});

test('region overlay toggle and rgba selector apply live', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const region = page.locator('.region-overlay .staff-region').first();
  const toggle = page.locator('#player-region-toggle');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  // the selector must be big enough to grab: a content-shrunken widget would
  // render the alpha slider as an invisible sliver
  const widgetBox = await page.locator('.player-region-rgba').boundingBox();
  const sliderBox = await page.locator('.player-region-alpha').boundingBox();
  expect(widgetBox?.width).toBeGreaterThanOrEqual(100);
  expect(sliderBox?.width).toBeGreaterThanOrEqual(100);
  expect(sliderBox?.height).toBeGreaterThanOrEqual(12);
  // on: homr-orange at the default 0.25 alpha, fill and stroke alike
  await toggle.check();
  await expect(region).toHaveAttribute('visibility', 'visible');
  await expect(region).toHaveAttribute('fill', 'rgba(255, 100, 0, 0.25)');
  await expect(region).toHaveAttribute('stroke', 'rgba(255, 100, 0, 0.25)');
  // off
  await toggle.uncheck();
  await expect(region).toHaveAttribute('visibility', 'hidden');
  // on again, recolored and semi-opaque via the rgba selector
  await toggle.check();
  await setInputValue(page, '.player-region-color', '#008000');
  await setInputValue(page, '.player-region-alpha', '50');
  await expect(region).toHaveAttribute('fill', 'rgba(0, 128, 0, 0.5)');
  await expect(region).toHaveAttribute('stroke', 'rgba(0, 128, 0, 0.5)');
});

test('region controls are localized (?lang=de)', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?lang=de&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await openPlayer(page);
  await expect(page.locator('.region-controls label[for="player-region-toggle"]')).toHaveText(
    'Bereiche',
  );
});

test('falls back to the plain MusicXML rendering without a TEI', async ({ page }) => {
  const manifest = scoreManifest() as { items: Array<Record<string, unknown>> };
  const canvas = manifest.items[0] as Record<string, unknown>;
  canvas.rendering = [
    {
      id: SCORE_URL,
      type: 'Text',
      format: 'application/vnd.recordare.musicxml+xml',
      label: { en: ['MusicXML'] },
    },
  ];
  // Registered after beforeEach: the later route wins for the manifest URL
  // (the TEI route from mockScore stays as is but is never referenced).
  await page.route(`${MOCK_BASE}/manifest.json`, (route) => route.fulfill({ json: manifest }));
  await page.route(SCORE_URL, (route) =>
    route.fulfill({ body: SCORE_XML, contentType: 'application/xml' }),
  );
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  // Without staff data nothing is mapped onto the scan: no score overlay,
  // no region overlay — but the player itself works.
  await expect(page.locator('.score-overlay')).toHaveCount(0);
  await expect(page.locator('.region-overlay')).toHaveCount(0);
  await expect(page.locator('.player-btn').first()).toBeVisible();
});

test('german player chrome (?lang=de)', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?lang=de&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await expect(page.locator('main.example > h1')).toHaveText('Partitur');
  await openPlayer(page);
  await expect(page.locator('.player-btn').first()).toHaveText('Abspielen');
  await expect(page.locator('.tify-plugin-status')).toHaveText('');
});

function v2ScoreManifest(): object {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': `${MOCK_BASE}/manifest.json`,
    '@type': 'sc:Manifest',
    label: 'Mock V2 Score',
    sequences: [
      {
        '@id': `${MOCK_BASE}/sequence/1`,
        '@type': 'sc:Sequence',
        canvases: [
          {
            '@id': `${MOCK_BASE}/canvas/p1`,
            '@type': 'sc:Canvas',
            label: 'Page 1',
            width: 750,
            height: 1000,
            images: [
              {
                '@id': `${MOCK_BASE}/annotation/p1-image`,
                '@type': 'oa:Annotation',
                motivation: 'sc:painting',
                resource: {
                  '@id': `${MOCK_BASE}/image/full/full/0/default.jpg`,
                  '@type': 'dctypes:Image',
                  format: 'image/jpeg',
                  width: 750,
                  height: 1000,
                  service: {
                    '@context': 'http://iiif.io/api/image/2/context.json',
                    '@id': `${MOCK_BASE}/image`,
                    profile: 'http://iiif.io/api/image/2/level2.json',
                  },
                },
                on: `${MOCK_BASE}/canvas/p1`,
              },
            ],
            rendering: [
              {
                '@id': TEI_URL,
                '@type': 'dctypes:Text',
                format: 'application/tei+xml',
              },
            ],
          },
        ],
      },
    ],
  };
}

test('discovers a v2 TEI rendering', async ({ page }) => {
  // Registered after beforeEach: the later route wins for the manifest URL
  // (the TEI route from mockScore stays as is).
  await page.route(`${MOCK_BASE}/manifest.json`, (route) =>
    route.fulfill({ json: v2ScoreManifest() }),
  );
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  const dock = page.locator('.tify-plugin-dock-btn');
  await expect(dock).toHaveCount(1);
  await expect(dock).toContainText('Score');
  await openPlayer(page);
  await expect(page.locator('#panel h2')).toHaveText('Score');
  await expect(page.locator('.score-overlay > svg.score-system').first()).toBeVisible({
    timeout: 30_000,
  });
});

/** Viewport-space placement of an overlay wrapper relative to the viewer canvas. */
async function overlaySide(page: Page, selector: string): Promise<'left' | 'right'> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector('#tify canvas')?.getBoundingClientRect();
    // OSD 5 wraps overlays in a div whose id is "overlay-wrapper[–<el.id>]".
    const wrapper = Array.from(document.querySelectorAll('[id^="overlay-wrapper"]'))
      .find((el) => el.querySelector(sel))
      ?.getBoundingClientRect();
    if (!canvas || !wrapper) return 'left';
    return wrapper.left + wrapper.width / 2 > canvas.left + canvas.width / 2 ? 'right' : 'left';
  }, selector);
}

test('double-page spread: dropdown and tapping select which page plays', async ({ page }) => {
  const teiFetches: string[] = [];
  page.on('request', (request) => {
    if (/\/page\d\.tei\.xml$/.test(request.url())) teiFetches.push(request.url());
  });

  await mockSpread(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  // Single page: no page selector.
  await expect(page.locator('.player-page')).toHaveCount(0);
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(1, { timeout: 30_000 });

  // Cover spread (pages 0+1): still one playable page, so no selector —
  // and the cover's overlay sits on the filler's right side (LTR).
  await page.locator('button[title="Toggle double-page"]').click();
  await expect(page.locator('.player-page')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.region-overlay')).toBe('right');

  // Next page in double-page mode: spread [2, 3] — the selector appears.
  await page.locator('button[title="Next page"] >> nth=0').click();
  const select = page.locator('.player-page');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select).toHaveValue('2');
  // Page 2's TEI: two staff zones, overlay on the left (first) page.
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.region-overlay')).toBe('left');

  // Dropdown: play the facing page instead — its TEI loads, three regions,
  // and the overlay moves to the right half of the spread.
  await select.selectOption('3');
  await expect(page.locator('.player-page')).toHaveValue('3');
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(3, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.region-overlay')).toBe('right');

  // Click the left page: selects it (dropdown follows), overlay back left.
  await page
    .locator('#tify .openseadragon-canvas')
    .first()
    .click({ position: { x: 219, y: 100 } });
  await expect(page.locator('.player-page')).toHaveValue('2', { timeout: 30_000 });
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.region-overlay')).toBe('left');

  // Clicking the already-playing page re-syncs nothing (no fresh TEI fetch).
  const fetchCount = teiFetches.length;
  await page
    .locator('#tify .openseadragon-canvas')
    .first()
    .click({ position: { x: 219, y: 100 } });
  await page.waitForTimeout(1200);
  expect(teiFetches.length).toBe(fetchCount);
});

test.describe('double-page touch taps', () => {
  test.use({ hasTouch: true });

  test('tapping the facing page plays it', async ({ page }) => {
    await mockSpread(page);
    await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
    await openPlayer(page);
    await page.locator('button[title="Toggle double-page"]').click();
    await page.locator('button[title="Next page"] >> nth=0').click();
    const select = page.locator('.player-page');
    await expect(select).toBeVisible({ timeout: 30_000 });
    await expect(select).toHaveValue('2');
    // Undock first: the panel overlays the viewer's right side and would
    // swallow the tap.
    await page.locator('.tify-plugin-dock-btn').click();
    await page
      .locator('#tify .openseadragon-canvas')
      .first()
      .tap({ position: { x: 550, y: 100 } });
    await page.locator('.tify-plugin-dock-btn').click();
    await expect(select).toHaveValue('3', { timeout: 30_000 });
    await expect(page.locator('.region-overlay .staff-region')).toHaveCount(3, { timeout: 30_000 });
  });
});

test('clicking the facing page plays it (mouse)', async ({ page }) => {
  await mockSpread(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('button[title="Toggle double-page"]').click();
  await page.locator('button[title="Next page"] >> nth=0').click();
  const select = page.locator('.player-page');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await expect(select).toHaveValue('2');
  // Undock first: the panel overlays the viewer's right side and would
  // swallow the click.
  await page.locator('.tify-plugin-dock-btn').click();
  await page
    .locator('#tify .openseadragon-canvas')
    .first()
    .click({ position: { x: 550, y: 100 } });
  await page.locator('.tify-plugin-dock-btn').click();
  await expect(select).toHaveValue('3', { timeout: 30_000 });
  await expect(page.locator('.region-overlay .staff-region')).toHaveCount(3, { timeout: 30_000 });
});

test('tempo change during playback reschedules without restart', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(2000);
  const before = await oscStarts(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  // The fixture is uniform quarter notes, but both staves strike each onset
  // (identical start times by design) — dedupe simultaneous starts, then
  // take the median steady gap (the first gap after the change is a
  // transition fraction, so the median ignores it).
  const gaps = (starts: Array<{ t: number }>): number[] => {
    const times: number[] = [];
    for (const t of starts.map((s) => s.t).sort((a, b) => a - b)) {
      if (times.length === 0 || t - times[times.length - 1] > 0.01) times.push(t);
    }
    const out: number[] = [];
    for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
    return out.sort((a, b) => a - b);
  };
  const median = (values: number[]): number =>
    values.length === 0 ? 0 : values[Math.floor(values.length / 2)];
  const beforeGap = median(gaps(before));
  // 120 BPM: quarter-note onsets 0.5 s apart.
  expect(beforeGap).toBeGreaterThan(0.45);
  expect(beforeGap).toBeLessThan(0.55);
  // Live change: the slider's input event fires setTempo() mid-playback —
  // no restart, so the scheduled start times keep advancing from where they
  // were (not from 0) on the faster grid.
  await setInputValue(page, '#player-tempo', '180');
  await expect(page.locator('label[for="player-tempo"]')).toHaveText('Tempo: 180');
  await page.waitForTimeout(1800);
  const after = await oscStarts(page);
  expect(after.length).toBeGreaterThan(before.length);
  expect(after[before.length].t).toBeGreaterThanOrEqual(before[before.length - 1].t);
  // 180 BPM: quarter-note onsets 1/3 s apart (bounded for timing jitter).
  const afterGap = median(gaps(after.slice(before.length)));
  expect(afterGap).toBeGreaterThan(beforeGap * 0.5);
  expect(afterGap).toBeLessThan(beforeGap * 0.85);
});

test('resume continues from the paused position', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(2100);
  await page.locator('.player-btn').nth(1).click();
  const paused = await oscStarts(page);
  // Five onsets (beats 0–4) have sounded at 120 BPM; the pause froze the
  // schedule — no further starts while paused.
  expect(paused.length).toBeGreaterThanOrEqual(8);
  await page.waitForTimeout(1200);
  expect((await oscStarts(page)).length).toBe(paused.length);
  // Resume: playback continues from the paused beat — the first re-struck
  // onset is the grid beat after the pause (D4 293.66 Hz or A4 440 Hz,
  // depending on the exact pause moment), never the restart signature
  // (beat 0's 392 Hz), and the clock keeps advancing.
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(1500);
  const resumed = await oscStarts(page);
  expect(resumed.length).toBeGreaterThan(paused.length);
  const next = resumed[paused.length];
  const continued = Math.abs(next.f - 293.66) < 1 || Math.abs(next.f - 440.0) < 1;
  expect(continued).toBe(true);
  expect(next.t).toBeGreaterThan(paused[paused.length - 1].t);
});

test('plays on a virtual clock without a working AudioContext', async ({ page }) => {
  await page.addInitScript(() => {
    const Broken = class {
      constructor() {
        throw new Error('no audio device');
      }
    };
    Object.assign(window, { AudioContext: Broken });
  });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await expect(page.locator('.staff-current').first()).toHaveAttribute('visibility', 'visible', {
    timeout: 15_000,
  });
});

test('plays when the AudioContext never starts running', async ({ page }) => {
  // CI Firefox failure mode: the context constructs, but the audio backend is
  // dead — currentTime stays frozen and resume() never settles.
  await page.addInitScript(() => {
    const StuckCtx = class {
      state = 'suspended';
      currentTime = 0;
      sampleRate = 48000;
      destination = {};
      resume() {
        return new Promise<void>(() => {});
      }
      suspend() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
      createBiquadFilter() {
        return { type: '', frequency: { value: 0 }, connect() {} };
      }
      createOscillator() {
        return {
          type: '',
          frequency: { value: 0 },
          connect() {},
          start() {},
          stop() {},
          onended: null,
          disconnect() {},
        };
      }
    };
    Object.assign(window, { AudioContext: StuckCtx });
  });
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  await expect(page.locator('.staff-current').first()).toHaveAttribute('visibility', 'visible', {
    timeout: 15_000,
  });
  const starts = await oscStarts(page);
  expect(starts.length).toBeGreaterThanOrEqual(2);
  expect(starts[0].w).toBe('triangle');
});

test('resumes from the paused beat on a context that never starts running', async ({ page }) => {
  await page.addInitScript(() => {
    const StuckCtx = class {
      state = 'suspended';
      currentTime = 0;
      sampleRate = 48000;
      destination = {};
      resume() {
        return new Promise<void>(() => {});
      }
      suspend() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
      createBiquadFilter() {
        return { type: '', frequency: { value: 0 }, connect() {} };
      }
      createOscillator() {
        return {
          type: '',
          frequency: { value: 0 },
          connect() {},
          start() {},
          stop() {},
          onended: null,
          disconnect() {},
        };
      }
    };
    Object.assign(window, { AudioContext: StuckCtx });
  });
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  // Pause inside the window where a naive implementation still trusts the
  // frozen real clock: the paused beat must come from the virtual clock, so
  // resuming strikes beat 1 (G4 + B3), never re-strikes beat 0 (G4 + G3).
  await page.waitForTimeout(150);
  await page.locator('.player-btn').nth(1).click();
  await page.locator('.player-btn').first().click();
  await page.waitForTimeout(1500);
  const starts = await oscStarts(page);
  expect(starts.length).toBeGreaterThanOrEqual(4);
  expect(starts[0].f).toBeCloseTo(392, 0);
  expect(starts[1].f).toBeCloseTo(196, 0);
  expect(starts[2].f).toBeCloseTo(392, 0);
  expect(starts[3].f).toBeCloseTo(246.94, 0);
});

test('page border marks the playing page in double-page spreads only', async ({ page }) => {
  await mockSpread(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  // Single page: no border.
  await expect(page.locator('.player-page-border')).toHaveCount(0, { timeout: 30_000 });
  // Double-page spread [2, 3]: the border appears around the selected page
  // (left half of the spread).
  await page.locator('button[title="Toggle double-page"]').click();
  await page.locator('button[title="Next page"] >> nth=0').click();
  const select = page.locator('.player-page');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.player-page-border')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.player-page-border')).toBe('left');
  // Select the facing page: the border moves right with the selection.
  await select.selectOption('3');
  await expect(page.locator('.player-page-border')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => overlaySide(page, '.player-page-border')).toBe('right');
  // Back to single-page mode: the border is removed.
  await page.locator('button[title="Toggle double-page"]').click();
  await expect(page.locator('.player-page-border')).toHaveCount(0, { timeout: 15_000 });
});
