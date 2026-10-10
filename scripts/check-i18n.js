// Coverage check for one workspace's plugin translations, mirroring TIFY's
// build/i18n.js: static English-source keys must exist in every catalogue
// (no concatenation, single line), catalogues must not carry unused/empty
// keys, and keys must be sorted ($language first).
//
// Scans `<dir>/src` + `<dir>/example` plus a top-level `index.html` when
// present (the root demo catalog); validates against
// `<dir>/src/i18n/translations/*.json`. Usage:
//   node scripts/check-i18n.js <dir>   (default: .)
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] ?? '.');
const translationsDir = path.join(rootDir, 'src', 'i18n', 'translations');

function findKeys() {
  const hits = new Map(); // key -> [{file, line}]
  const files = [];
  const indexHtml = path.join(rootDir, 'index.html');
  if (fs.existsSync(indexHtml)) files.push(indexHtml);
  for (const dir of ['src', 'example']) {
    const base = path.join(rootDir, dir);
    if (!fs.existsSync(base)) continue;
    const walk = (entry) => {
      for (const name of fs.readdirSync(entry)) {
        const full = path.join(entry, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (name === 'i18n' || name === 'dist' || name === 'node_modules') continue;
          walk(full);
        } else if (/\.(ts|html)$/.test(name)) {
          files.push(full);
        }
      }
    };
    walk(base);
  }

  // Direct calls t('key', ...) — outer and nested static keys alike.
  const callPattern = /\bt\(\s*(['"])((?:[^'"])*)\1/g;
  // Ternary calls t(cond ? 'A' : 'B', ...) — both branches are keys.
  const ternaryPattern = /\bt\(\s*[^?'"]*?\?\s*(['"])((?:[^'"])*)\1\s*:\s*(['"])((?:[^'"])*)\3/g;
  // Closed key sets assigned as data (translated at the render site via
  // t(status.detailKey, ...) and friends, which the scanner cannot resolve).
  const keyRefPattern = /\b(?:detailKey|errorKey|reasonKey)\s*[:=]\s*(['"])((?:[^'"])*)\1/g;
  const attrPattern = /data-i18n(?:-aria)?="([^"]+)"/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // Closed key sets assigned as data span lines after formatting, so scan
    // whole-file (translated at render sites the scanner cannot resolve).
    keyRefPattern.lastIndex = 0;
    let ref = keyRefPattern.exec(content);
    while (ref) {
      const key = ref[2];
      if (key && !key.includes('${')) {
        if (!hits.has(key)) hits.set(key, []);
        const before = content.slice(0, ref.index).split('\n');
        hits.get(key).push({ file: path.relative(rootDir, file), line: before.length });
      }
      ref = keyRefPattern.exec(content);
    }
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      // Skip comment-only lines (doc examples may mention key syntax).
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      const code = line;
      const record = (key) => {
        if (!key || key.includes('${')) return;
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push({ file: path.relative(rootDir, file), line: index + 1 });
      };
      const recordMatch = (pattern, match) => {
        if (pattern === ternaryPattern) {
          record(match[2]);
          record(match[4]);
        } else if (pattern === attrPattern) {
          record(match[1]);
        } else {
          record(match[2]);
        }
      };
      for (const pattern of [callPattern, ternaryPattern, attrPattern]) {
        pattern.lastIndex = 0;
        let match = pattern.exec(code);
        while (match) {
          // NOTE: t(key) with a bare identifier (applyStaticTranslations) is
          // intentionally skipped — those keys are covered by data-i18n.
          recordMatch(pattern, match);
          match = pattern.exec(code);
        }
      }
    });
  }
  return hits;
}

function sortedKeysOf(translation) {
  return Object.keys(translation)
    .filter((key) => key !== '$language')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

const used = findKeys();
if (used.size === 0) {
  console.log('No translatable strings found');
  process.exit(0);
}

let failed = false;
for (const file of fs.readdirSync(translationsDir)) {
  const full = `${translationsDir}/${file}`;
  const translation = JSON.parse(fs.readFileSync(full, 'utf8'));
  const lang = path.parse(file).name;
  const keys = Object.keys(translation).filter((key) => key !== '$language');

  for (const key of keys) {
    if (!translation[key]) {
      console.error(`${file}: empty translation for "${key}"`);
      failed = true;
    }
    if (!used.has(key)) {
      console.error(`${file}: unused key "${key}"`);
      failed = true;
    }
  }
  for (const key of used.keys()) {
    if (!keys.includes(key)) {
      console.error(`${file} (${lang}): missing key "${key}"`);
      failed = true;
    }
  }

  const actual = keys.join(',');
  const expected = sortedKeysOf(translation).join(',');
  if (actual !== expected) {
    if (process.argv.includes('--fix')) {
      const fixed = { $language: translation.$language };
      for (const key of sortedKeysOf(translation)) fixed[key] = translation[key];
      fs.writeFileSync(full, `${JSON.stringify(fixed, null, '  ')}\n`);
      console.log(`${file}: keys sorted`);
    } else {
      console.error(`${file}: keys not sorted ($language first, then case-insensitive)`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`i18n OK: ${used.size} keys covered`);
