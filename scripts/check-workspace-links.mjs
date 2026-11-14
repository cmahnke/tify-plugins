#!/usr/bin/env node
// Workspace-link guard: every dependency of one workspace package on another
// must declare a range satisfied by the workspace's current version AND
// resolve to the workspace link, not an installed published copy.
//
// npm silently installs a published copy into a nested node_modules when the
// declared range no longer matches the workspace (a caret on 0.x pins the
// minor), which then feeds stale types/behavior to builds — e.g. navplace
// building against published core@0.2.2 while core source was 0.3.0. This
// check turns that drift into a loud, actionable failure.
//
// Usage: node scripts/check-workspace-links.mjs  (also `npm run test:links`)
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const root = path.resolve(import.meta.dirname, '..');
const PREFIX = '[workspace-links]';

/** Workspace package dirs from the root package.json (`packages/*`), sorted. */
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

const problems = [];
let links = 0;

const workspaces = new Map();
for (const dir of workspaceDirs()) {
  const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  workspaces.set(pkg.name, { dir, version: pkg.version });
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

for (const { dir } of workspaces.values()) {
  const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  for (const field of DEP_FIELDS) {
    for (const [depName, range] of Object.entries(pkg[field] ?? {})) {
      const dep = workspaces.get(depName);
      if (!dep) continue;
      // `workspace:` specs never reach here on npm (unsupported inside
      // workspaces); treat them as satisfied so the check stays forward-
      // compatible.
      if (String(range).startsWith('workspace:')) continue;
      if (!semver.satisfies(dep.version, range)) {
        problems.push(
          `${dir}/package.json: ${field}["${depName}"] = "${range}" does not match the workspace version ${dep.version} — update the range so npm links the workspace instead of installing a published copy`,
        );
        continue;
      }
      // Resolve like Node would: the nearest node_modules/<name>, walking up
      // from the package dir. It must be a symlink into the dep's workspace.
      let entry = null;
      let cursor = path.join(root, dir);
      while (true) {
        const candidate = path.join(cursor, 'node_modules', depName);
        if (existsSync(candidate)) {
          entry = candidate;
          break;
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      if (!entry) {
        problems.push(
          `${dir}: ${depName} is not installed (no node_modules/${depName}) — run npm install`,
        );
        continue;
      }
      let real = null;
      try {
        real = realpathSync(entry);
      } catch {
        // Broken symlink falls through to the is-own-workspace check below.
      }
      const expected = realpathSync(path.join(root, dep.dir));
      if (!real || real !== expected) {
        problems.push(
          `${dir}: ${depName} resolves to ${real ?? entry} instead of the workspace at ${expected} — a published copy was installed; fix the range or rerun npm install`,
        );
        continue;
      }
      links++;
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`${PREFIX} ${problem}`);
  console.error(`${PREFIX} ${problems.length} problem(s) found`);
  process.exit(1);
}
console.error(`${PREFIX} ${links} workspace dependency link(s) verified`);
