import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_BASE, buildInfo, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/plugin-musicxml/example/';
const SCORE_URL = `${MOCK_BASE}/score.musicxml`;

const here = path.dirname(fileURLToPath(import.meta.url));
const SCORE_XML = readFileSync(path.join(here, '..', 'test-fixtures', 'page006.musicxml'), 'utf8');

/** Synthetic staff grid: 5 lines with a slight slope across the staff bbox. */
function staffGrid(
  x0: number,
  y0: number,
  x1: number,
  lines = 5,
  points = 8,
): Array<{ x: number; y: number[] }> {
  const grid: Array<{ x: number; y: number[] }> = [];
  for (let i = 0; i < points; i++) {
    const x = x0 + ((x1 - x0) * i) / (points - 1);
    const y: number[] = [];
    for (let k = 0; k < lines; k++) y.push(y0 + k * 20 + 0.02 * (x - x0));
    grid.push({ x, y });
  }
  return grid;
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
            id: SCORE_URL,
            type: 'Text',
            format: 'application/vnd.recordare.musicxml+xml',
            label: { en: ['Score (MusicXML)'] },
          },
        ],
        annotations: [
          {
            id: `${MOCK_BASE}/annotations/p1.json`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${MOCK_BASE}/annotation/staff-1`,
                type: 'Annotation',
                motivation: 'describing',
                body: {
                  type: 'TextualBody',
                  format: 'application/json',
                  value: JSON.stringify({
                    staffGrid: staffGrid(50, 100, 700),
                    staffLineCount: 5,
                  }),
                },
                target: `${MOCK_BASE}/canvas/p1#xywh=50,100,650,140`,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function mockScore(page: Page): Promise<void> {
  await mockIiif(page, { manifest: scoreManifest(), info: buildInfo() });
  await page.route(SCORE_URL, (route) =>
    route.fulfill({ body: SCORE_XML, contentType: 'application/xml' }),
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
  await expect(page.locator('.player-controls')).toBeVisible({ timeout: 30_000 });
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
  for (const selector of ['.staff-current', '.note-marker', '.play-pos']) {
    const layer = page.locator(selector);
    await expect(layer).toHaveAttribute('visibility', 'visible', { timeout: 15_000 });
    await expect(layer).toHaveCSS('visibility', 'visible');
  }
});

test('note marker is sized proportionally to the staff geometry', async ({ page }) => {
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await openPlayer(page);
  await page.locator('.player-btn').first().click();
  const marker = page.locator('.note-marker');
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

test('german player chrome (?lang=de)', async ({ page }) => {
  await page.goto(
    `${EXAMPLE}?lang=de&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await expect(page.locator('main.example > h1')).toHaveText('Partitur');
  await openPlayer(page);
  await expect(page.locator('.player-btn').first()).toHaveText('Abspielen');
  await expect(page.locator('.tify-plugin-status')).toHaveText('');
});
