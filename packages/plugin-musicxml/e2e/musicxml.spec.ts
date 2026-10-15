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
 * Synthetic homr page TEI: one staff zone over 750×1000 canvas pixels, five
 * staff lines (20 px apart, slight slope), homr application header, and the
 * fixture MusicXML embedded under <div type="score">.
 */
function pageTei(): string {
  const x0 = 50;
  const y0 = 100;
  const x1 = 700;
  const points = 8;
  const paths = [];
  for (let k = 0; k < 5; k++) {
    const pts: string[] = [];
    for (let i = 0; i < points; i++) {
      const x = x0 + ((x1 - x0) * i) / (points - 1);
      pts.push(`${x},${y0 + k * 20 + 0.02 * (x - x0)}`);
    }
    paths.push(`        <path type="staff-line" points="${pts.join(' ')}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Mock Score (page 1)</title></titleStmt>
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
      <zone xml:id="p1-staff-1" type="staff" ulx="50" uly="100" lrx="700" lry="240">
${paths.join('\n')}
      </zone>
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

test('plays a single track: monophonic onsets on the grid', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  // Dual mode is on by default for two-staff scores; switch it off so only
  // one staff plays and onsets stay monophonic.
  await page.locator('.player-dual').uncheck();
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
  // In dual mode (on by default for two-staff scores) each playing staff has
  // its own highlight set — assert on the first one.
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

test('dual mode plays two tracks simultaneously', async ({ page }) => {
  await interceptOscillators(page);
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const dual = page.locator('.player-dual');
  if ((await dual.count()) === 0) test.skip(true, 'single staff score has no dual mode');
  await dual.check();
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
  await page.locator('.player-instrument-a').selectOption('synth');
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

test('region overlay defaults to visible homr-style regions', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const region = page.locator('.region-overlay .staff-region').first();
  await expect(region).toHaveAttribute('visibility', 'visible');
  await expect(region).toHaveAttribute('fill', '#ff6400');
  await expect(region).toHaveAttribute('fill-opacity', '0.25');
});

test('region overlay toggle, color and transparency controls apply live', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  const region = page.locator('.region-overlay .staff-region').first();
  await expect(region).toHaveAttribute('visibility', 'visible');
  // Off.
  await page.locator('#player-region-toggle').uncheck();
  await expect(region).toHaveAttribute('visibility', 'hidden');
  // On again.
  await page.locator('#player-region-toggle').check();
  await expect(region).toHaveAttribute('visibility', 'visible');
  // Color.
  await setInputValue(page, '.player-region-color', '#008000');
  await expect(region).toHaveAttribute('fill', '#008000');
  // Transparency: 50% transparency -> fill-opacity 0.5.
  await setInputValue(page, '.player-region-transparency', '50');
  await expect(region).toHaveAttribute('fill-opacity', '0.5');
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
