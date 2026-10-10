// Regression check for the TEI overlay parser: runs the real fetchTeiPage()
// headlessly with stubbed fetch + linkedom DOM against the overlays fixture.
// Needs Node >= 22.6 (TypeScript type-stripping for the .ts import).
import { strict as assert } from 'node:assert';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.log(
    `test:tei skipped (node ${process.versions.node} cannot import TypeScript, need >= 22.6)`,
  );
  process.exit(0);
}

const { readFile } = await import('node:fs/promises');
const { DOMParser } = await import('linkedom');

globalThis.DOMParser = DOMParser;

const base = 'http://localhost:5173/packages/plugin-image-overlays/example/tei-fixture';
globalThis.fetch = async (url) => {
  const path = `./example/tei-fixture/${String(url).split('/').pop()?.split('#')[0] ?? ''}`;
  try {
    const text = await readFile(path, 'utf8');
    return { ok: true, text: async () => text };
  } catch {
    return { ok: false };
  }
};

const { fetchTeiPage } = await import('../src/tei.ts');
const manifest = JSON.parse(await readFile('./example/tei-fixture/manifest.json', 'utf8'));

const page = await fetchTeiPage(manifest, `${base}/manifest.json`, 1, {});
assert.ok(page, 'expected a TeiPage');
assert.equal(page.boxes.length, 5, 'unlinked word skipped, rest kept');
assert.deepEqual(
  page.boxes.map((box) => box.text),
  ['Gänseliesel', 'Brunnen', 'Göttingen', 'Marktplatz', 'Rathaus'],
);
// Surface 1000x745 -> canvas 4032x3024: z1 (66,164,124x46) scales accordingly.
const first = page.boxes[0];
assert.ok(Math.abs(first.x - 66 * 4.032) < 0.01, `x scaled: ${first.x}`);
assert.ok(Math.abs(first.y - 164 * (3024 / 745)) < 0.01, `y scaled: ${first.y}`);
assert.ok(Math.abs(first.w - 124 * 4.032) < 0.01, `w scaled: ${first.w}`);
// Points zone z5 (500,220,140x46) must equal its rect equivalent.
const last = page.boxes[4];
assert.ok(Math.abs(last.x - 500 * 4.032) < 0.01, `points x: ${last.x}`);

// Line level + unknown manifest fallbacks.
const lines = await fetchTeiPage(manifest, `${base}/manifest.json`, 1, { level: 'line' });
assert.ok(lines && lines.boxes.length === 5, 'no lines -> falls back to words');
assert.equal(lines.level, 'word');
const missing = await fetchTeiPage(manifest, `${base}/manifest.json`, 2, {});
assert.equal(missing, null, 'page without canvas -> null');

console.log('tei fixtures OK (5 word boxes scaled, points bbox, line/missing fallbacks)');
