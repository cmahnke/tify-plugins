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
// Writes GITHUB_OUTPUT-style assignments (matrix/any/dirs) to --out, or to
// $GITHUB_OUTPUT when set, else stdout.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
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

// Core first: plugins depend on it, so the registry must already have it.
packages.sort((a, b) => {
  if (a.name.endsWith('/tify-plugin-core')) return -1;
  if (b.name.endsWith('/tify-plugin-core')) return 1;
  return a.dir.localeCompare(b.dir);
});

const changed = packages.filter((pkg) =>
  previousTag ? pkg.version !== versionAt(previousTag, `${pkg.dir}/package.json`) : true,
);

const lines = [`matrix=${JSON.stringify(changed.map(({ dir, name }) => ({ dir, name })))}`];
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
