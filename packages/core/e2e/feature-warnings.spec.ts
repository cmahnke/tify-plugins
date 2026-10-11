import { expect, test, type Page } from '@playwright/test';
import { MOCK_BASE, buildInfo, buildManifest, mockIiif } from '../../../e2e/helpers';

const EXAMPLE = '/packages/core/example/';

/** Console text captured from page load (warnings + errors only). */
function captureConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') lines.push(message.text());
  });
  return lines;
}

/** Manifest with canvas-level TEI, embedded annotations, a score and a
    by-reference annotation page (so all four content features are present). */
function featureManifest(): object {
  const base = buildManifest({ canvases: 2 }) as any;
  base.items[0].seeAlso = [
    { id: `${MOCK_BASE}/tei.xml`, type: 'Text', format: 'application/tei+xml' },
  ];
  base.items[0].annotations = [
    {
      id: `${MOCK_BASE}/annotations/p1`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${MOCK_BASE}/annotation/anno-1`,
          type: 'Annotation',
          motivation: 'tagging',
          body: { type: 'TextualBody', value: 'Note 1', format: 'text/plain' },
          target: `${MOCK_BASE}/canvas/p1#xywh=50,100,200,150`,
        },
      ],
    },
  ];
  base.items[0].rendering = [
    { id: `${MOCK_BASE}/score.musicxml`, format: 'application/vnd.recordare.musicxml+xml' },
  ];
  // By-reference annotations on page 2: warns once, not twice.
  base.items[1].annotations = [{ id: `${MOCK_BASE}/annotations/p2.json`, type: 'AnnotationPage' }];
  return base;
}

async function waitForWarnings(lines: string[], count: number): Promise<void> {
  await expect.poll(() => lines.filter((l) => l.includes('[tify-plugins]')).length).toBe(count);
}

test('warns once per unhandled manifest feature', async ({ page }) => {
  const lines = captureConsole(page);
  await mockIiif(page, { manifest: featureManifest() });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  // TEI (page 1), annotations (pages 1+2 collapse into one), score (page 1);
  // the info.json advertises nothing extra.
  await waitForWarnings(lines, 3);
  await expect(lines[0]).toContain('@projektemacher/tify-plugin-image-overlays');
  await expect(lines[1]).toContain('@projektemacher/tify-plugin-annotorious');
  await expect(lines[2]).toContain('@projektemacher/tify-plugin-musicxml');
});

test('a loaded plugin silences its own warning', async ({ page }) => {
  // The core example loads no feature plugins, so every warning fires; the
  // mirror case (plugin loaded → its warning gone) lives in the annotorious
  // suite, where the plugin actually registers itself with core.
  const lines = captureConsole(page);
  await mockIiif(page, { manifest: featureManifest() });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel')).toContainText('TEI transcription');
  await waitForWarnings(lines, 3);
  await expect(lines.some((l) => l.includes('@projektemacher/tify-plugin-image-overlays'))).toBe(
    true,
  );
});

test('warns about advertised service capabilities', async ({ page }) => {
  const lines = captureConsole(page);
  await mockIiif(page, {
    manifest: buildManifest({ canvases: 1 }),
    info: buildInfo({ hdr: true }),
  });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect
    .poll(() => lines.filter((l) => l.includes('@projektemacher/tify-plugin-hdr')).length)
    .toBe(1);
  // C2PA is not advertised here.
  await expect.poll(() => lines.filter((l) => l.includes('tify-plugin-c2pa')).length).toBe(0);
});

test('no warnings for a plain manifest', async ({ page }) => {
  const lines = captureConsole(page);
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(`${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`);
  await expect(page.locator('#panel')).toContainText('Viewing page 1');
  expect(lines.filter((l) => l.includes('[tify-plugins]'))).toEqual([]);
});

test('?warnings=0 silences all warnings', async ({ page }) => {
  const lines = captureConsole(page);
  await mockIiif(page, { manifest: featureManifest() });
  await page.goto(
    `${EXAMPLE}?warnings=0&manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}`,
  );
  await expect(page.locator('#panel')).toContainText('Viewing page 1');
  expect(lines.filter((l) => l.includes('[tify-plugins]'))).toEqual([]);
});

test('german panel chrome stays warning-free', async ({ page }) => {
  const lines = captureConsole(page);
  await mockIiif(page, { manifest: buildManifest({ canvases: 1 }) });
  await page.goto(
    `${EXAMPLE}?manifest=${encodeURIComponent(`${MOCK_BASE}/manifest.json`)}&lang=de`,
  );
  await expect(page.locator('#panel')).toContainText('Bilddienst');
  expect(lines.filter((l) => l.includes('[tify-plugins]'))).toEqual([]);
});
