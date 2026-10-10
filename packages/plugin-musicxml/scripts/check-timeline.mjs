// Regression check for the MusicXML timeline parser: runs the real
// parseMusicXML() headlessly with a linkedom DOMParser against the score
// fixtures (a rich multi-system page and a rest-only edge case).
// Needs Node >= 22.6 (TypeScript type-stripping for the .ts import).
import { strict as assert } from 'node:assert';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.log(
    `test:timeline skipped (node ${process.versions.node} cannot import TypeScript, need >= 22.6)`,
  );
  process.exit(0);
}

const { readFile } = await import('node:fs/promises');
const { DOMParser } = await import('linkedom');

globalThis.DOMParser = DOMParser;

const { parseMusicXML } = await import('../src/musicxml-timeline.ts');

// Rich page: 8+ measures across 3 systems, real homr OMR output.
const page006 = parseMusicXML(await readFile('./test-fixtures/page006.musicxml', 'utf8'));
assert.ok(page006.measures.length >= 8, `measures: ${page006.measures.length}`);
assert.equal(page006.systemCount, 3, `systems: ${page006.systemCount}`);
assert.ok(page006.divisions >= 1, `divisions: ${page006.divisions}`);
assert.ok(page006.notes.length > 10, `notes: ${page006.notes.length}`);
assert.equal(page006.measures[0].clef1, 'G', 'first measure treble clef');
const numbers = new Set(page006.measures.map((m) => m.number));
for (const note of page006.notes) {
  assert.ok(Number.isFinite(note.beatStart) && note.beatStart >= 0, `beatStart: ${note.beatStart}`);
  assert.ok('CDEFGAB'.includes(note.step), `step: ${note.step}`);
  assert.ok(note.staff >= 1, `staff: ${note.staff}`);
  assert.ok(numbers.has(note.measureNumber), `measure ref: ${note.measureNumber}`);
  assert.ok(note.system >= 0 && note.system < page006.systemCount, `system: ${note.system}`);
}

// Rest-only edge case: valid timeline, no sounding notes.
const page033 = parseMusicXML(await readFile('./test-fixtures/page033.musicxml', 'utf8'));
assert.equal(page033.measures.length, 1, 'single measure');
assert.equal(page033.systemCount, 1, 'single system');
assert.equal(page033.notes.length, 0, 'no sounding notes');

console.log(
  `timeline fixtures OK (${page006.notes.length} notes, ${page006.measures.length} measures, ${page006.systemCount} systems; rest-only edge case clean)`,
);
