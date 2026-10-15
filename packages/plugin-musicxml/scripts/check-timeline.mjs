// Regression check for the MusicXML timeline parser: runs the real
// parseMusicXML() headlessly with a linkedom DOMParser against the score
// fixtures (a rich multi-system page and a rest-only edge case), plus the
// TEI parser (parseTei) against a real homr page TEI.
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

// linkedom ships no XMLSerializer; parseTei only serializes the extracted
// MusicXML tree (elements, attributes, text), so a minimal walker suffices.
class XMLSerializer {
  serializeToString(node) {
    const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const walk = (n) => {
      if (n.nodeType === 3) return escText(n.data ?? '');
      if (n.nodeType === 8) return `<!--${n.data ?? ''}-->`;
      if (n.nodeType !== 1) return '';
      let out = `<${n.tagName}`;
      for (const attr of n.attributes ?? []) out += ` ${attr.name}="${escAttr(attr.value)}"`;
      out += '>';
      for (const child of n.childNodes ?? []) out += walk(child);
      return out + `</${n.tagName}>`;
    };
    return walk(node);
  }
}
globalThis.XMLSerializer = XMLSerializer;

const { parseMusicXML } = await import('../src/musicxml-timeline.ts');
const { parseTei } = await import('../src/tei.ts');

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

// TEI round-trip: the real homr page TEI must yield the same score timeline
// as the loose MusicXML fixture, plus the staff geometry.
const tei = parseTei(await readFile('./test-fixtures/page006.tei.xml', 'utf8'));
assert.ok(tei, 'TEI parses');
assert.ok(tei.staves.length >= 1, `staves: ${tei.staves.length}`);
const staff = tei.staves[0];
assert.ok(staff.grid && staff.grid.length > 1, 'staff grid samples');
assert.ok(staff.grid[0].y.length >= 5, `staff lines: ${staff.grid[0].y.length}`);
assert.equal(staff.lineCount, 5, 'five lines per sub-staff');
assert.ok(staff.bbox[2] > staff.bbox[0] && staff.bbox[3] > staff.bbox[1], 'sane bbox');
assert.equal(tei.omr?.status, 'ok', 'homr OMR status');
assert.ok(Number.isFinite(tei.omr?.confidence), 'homr confidence');
assert.ok(tei.musicxmlText, 'embedded MusicXML extracted');
const fromTei = parseMusicXML(tei.musicxmlText);
const fromLoose = parseMusicXML(await readFile('./test-fixtures/page006.musicxml', 'utf8'));
assert.equal(fromTei.measures.length, fromLoose.measures.length, 'same measures as loose fixture');
assert.equal(fromTei.notes.length, fromLoose.notes.length, 'same notes as loose fixture');
assert.equal(fromTei.systemCount, fromLoose.systemCount, 'same systems as loose fixture');

console.log(
  `timeline fixtures OK (${page006.notes.length} notes, ${page006.measures.length} measures, ${page006.systemCount} systems; rest-only edge case clean; TEI round-trip: ${tei.staves.length} staff(es), ${fromTei.notes.length} notes)`,
);
