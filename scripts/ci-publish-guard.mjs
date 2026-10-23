#!/usr/bin/env node
// Publish guard for .github/workflows/publish.yml: decides which workspace
// packages actually need publishing — the ones whose version changed since
// the previous release tag.
//
// Tag-based rather than registry probes: it needs no token, runs offline,
// and expresses "what is unreleased" directly. First release (no previous
// tag) publishes everything; a deliberate partial bump publishes only the
// bumped packages, and re-running after a release publishes nothing.
//
// Usage: node scripts/ci-publish-guard.mjs [previousTag] [--out <file>]
//        node scripts/ci-publish-guard.mjs --metadata
// The default mode writes GITHUB_OUTPUT-style assignments (matrix/any/dirs)
// to --out, or to $GITHUB_OUTPUT when set, else stdout, and also checks the
// citation metadata. --metadata runs only that check (also used as a
// release-prep check via `npm run test:citation`): it fails when the version
// in CITATION.cff or
// codemeta.json no longer matches the workspace packages.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const metadataOnly = args.includes('--metadata');
const previousTag = args.find((arg) => !arg.startsWith('--')) ?? '';
const outFlag = args.indexOf('--out');

/** Workspace roots from the root package.json (`packages/*`), sorted. */
function workspaceDirs() {
  const { workspaces } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dirs = [];
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) continue; // only single-segment globs
    const base = path.join(root, path.dirname(pattern));
    if (!existsSync(base)) continue;
    const names = readdirSync(base, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(path.join(base, entry.name, 'package.json')),
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of names) dirs.push(`${path.dirname(pattern)}/${name}`);
  }
  return dirs;
}

/** Version of one package.json at a git rev, or null when it has none. */
function versionAt(tag, relative) {
  try {
    const text = execFileSync('git', ['show', `${tag}:${relative}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text).version ?? null;
  } catch {
    return null; // package added since the tag, or the tag is gone
  }
}

const packages = [];
for (const dir of workspaceDirs()) {
  const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  if (!pkg.name || pkg.private) continue;
  packages.push({ dir, name: pkg.name, version: pkg.version });
}

/** Version cited by CITATION.cff (top-level YAML key, no YAML parser). */
function citationVersion() {
  const text = readFileSync(path.join(root, 'CITATION.cff'), 'utf8');
  const match = /^version:\s*(.+)$/m.exec(text);
  return match ? match[1].trim() : null;
}

/** Version cited by codemeta.json. */
function codemetaVersion() {
  return JSON.parse(readFileSync(path.join(root, 'codemeta.json'), 'utf8')).version ?? null;
}

/**
 * Citation metadata must travel with the release: the version cited in
 * CITATION.cff and codemeta.json has to match the workspace packages (they
 * share one version). Exits 1 with an actionable message on a mismatch.
 */
function checkMetadata() {
  const versions = [...new Set(packages.map((pkg) => pkg.version))];
  if (versions.length > 1) {
    console.error(
      `[publish-guard] workspaces disagree on the version: ${versions.join(', ')} — release expects one shared version`,
    );
    process.exit(1);
  }
  const version = versions[0];
  const cited = { 'CITATION.cff': citationVersion(), 'codemeta.json': codemetaVersion() };
  const stale = Object.entries(cited).filter(([, value]) => value !== version);
  if (stale.length > 0) {
    for (const [file, value] of stale) {
      console.error(
        `[publish-guard] ${file} cites ${value ?? 'no version'}, but the packages are ${version} — bump it (version and date) before releasing`,
      );
    }
    process.exit(1);
  }
  console.error(`[publish-guard] citation metadata matches ${version}`);
}

if (metadataOnly) {
  checkMetadata();
  process.exit(0);
}

// Core first: plugins depend on it, so the registry must already have it.
packages.sort((a, b) => {
  if (a.name.endsWith('/tify-plugin-core')) return -1;
  if (b.name.endsWith('/tify-plugin-core')) return 1;
  return a.dir.localeCompare(b.dir);
});

const changed = packages.filter((pkg) =>
  previousTag ? pkg.version !== versionAt(previousTag, `${pkg.dir}/package.json`) : true,
);

// Publishing requires current citation metadata (no-op for --metadata, which
// exits above).
if (changed.length > 0) checkMetadata();

// `include` form: strategy.matrix must be a mapping, so a bare array would
// fail workflow parsing ("A sequence was not expected").
const lines = [
  `matrix=${JSON.stringify({ include: changed.map(({ dir, name }) => ({ dir, name })) })}`,
];
lines.push(`any=${changed.length > 0 ? 'true' : 'false'}`);
lines.push(`dirs=${changed.map((pkg) => pkg.dir).join(' ')}`);

const target = outFlag >= 0 ? args[outFlag + 1] : process.env.GITHUB_OUTPUT;
if (target) {
  appendFileSync(target, `${lines.join('\n')}\n`);
} else {
  console.log(lines.join('\n'));
}

if (changed.length === 0) {
  console.error(`[publish-guard] nothing to publish (all versions match ${previousTag || 'HEAD'})`);
} else {
  console.error(
    `[publish-guard] ${changed.length} package(s) to publish: ${changed
      .map((pkg) => `${pkg.name}@${pkg.version}`)
      .join(', ')}`,
  );
}
