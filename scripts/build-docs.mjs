// Renders the workspace READMEs into static docs pages for GitHub Pages.
// Sources: root README (docs index/overview) + each package README. Relative
// links between READMEs become internal docs links; every other relative .md
// link points at the GitHub source. Usage:
//   node scripts/build-docs.mjs [outDir]   (default: dist/docs)
import fs from 'node:fs';
import path from 'node:path';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const REPO_BLOB = 'https://github.com/cmahnke/tify-plugins/blob/main';

const pages = [
  { id: 'index', title: 'tify-plugins', file: 'README.md' },
  { id: 'core', title: 'tify-plugin-core', file: 'packages/core/README.md' },
  {
    id: 'plugin-side-panel',
    title: 'tify-plugin-side-panel',
    file: 'packages/plugin-side-panel/README.md',
  },
  {
    id: 'plugin-image-overlays',
    title: 'tify-plugin-image-overlays',
    file: 'packages/plugin-image-overlays/README.md',
  },
  { id: 'plugin-hdr', title: 'tify-plugin-hdr', file: 'packages/plugin-hdr/README.md' },
  { id: 'plugin-c2pa', title: 'tify-plugin-c2pa', file: 'packages/plugin-c2pa/README.md' },
  {
    id: 'plugin-annotorious',
    title: 'tify-plugin-annotorious',
    file: 'packages/plugin-annotorious/README.md',
  },
  {
    id: 'plugin-musicxml',
    title: 'tify-plugin-musicxml',
    file: 'packages/plugin-musicxml/README.md',
  },
];

const docsTargets = new Map(pages.map((page) => [page.file, `${page.id}.html`]));

/** Rewrite relative README links: internal docs pages stay local, other .md files go to GitHub. */
function rewriteLinks(markdown, sourceFile) {
  const baseDir = path.posix.dirname(sourceFile);
  return markdown.replace(
    /\]\((?!https?:\/\/|#|\/|data:)([^)#\s]+\.md)(#[^)\s]*)?\)/g,
    (match, href, hash = '') => {
      const resolved = baseDir === '.' ? href : `${baseDir}/${href}`;
      const local = docsTargets.get(resolved);
      if (local) return `](${local}${hash})`;
      return `](${REPO_BLOB}/${resolved}${hash})`;
    },
  );
}

const style = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    margin: 0;
    padding: 1rem;
    line-height: 1.5;
  }
  .docs { max-width: 48rem; margin: 0 auto; }
  .docs .crumbs { font-size: 0.85rem; margin-bottom: 1.5rem; }
  .docs nav { margin-top: 2.5rem; font-size: 0.85rem; }
  .docs code {
    background: #8883;
    border-radius: 0.25rem;
    padding: 0.05rem 0.3rem;
    font-size: 0.85em;
    overflow-wrap: anywhere;
  }
  .docs pre { padding: 0.8rem; border: 1px solid #8883; border-radius: 0.4rem; overflow: auto; }
  .docs pre code { background: none; padding: 0; }
  .docs .hljs-keyword { color: light-dark(#06b, #4c9aff); }
  .docs .hljs-string, .docs .hljs-regexp { color: light-dark(#1a7f37, #4ade80); }
  .docs .hljs-number { color: light-dark(#0550ae, #79c0ff); }
  .docs .hljs-title, .docs .hljs-title.class_, .docs .hljs-title.function_ { color: light-dark(#0b5fff, #7aa8ff); }
  .docs .hljs-built_in, .docs .hljs-literal { color: light-dark(#8250df, #d2a8ff); }
  .docs .hljs-attr { color: light-dark(#0550ae, #79c0ff); }
  .docs .hljs-comment { color: light-dark(#59636e, #9198a1); font-style: italic; }
  .docs .hljs-tag { color: light-dark(#59636e, #9198a1); }
  .docs .hljs-name { color: light-dark(#06b, #4c9aff); }
  .docs table { border-collapse: collapse; }
  .docs th, .docs td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #8883; }
  .docs img { max-width: 100%; }
`;

function renderPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — tify-plugins docs</title>
    <style>${style}</style>
  </head>
  <body>
    <main class="docs">
      <p class="crumbs"><a href="../">← demo catalog</a> · <a href="./">docs</a></p>
      ${bodyHtml}
      <nav>
        Docs:
        ${pages.map((page) => `<a href="./${page.id}.html">${page.title}</a>`).join(' · ')}
      </nav>
    </main>
  </body>
</html>
`;
}

const outDir = path.resolve(process.argv[2] ?? 'dist/docs');
fs.mkdirSync(outDir, { recursive: true });

for (const page of pages) {
  const source = fs.readFileSync(page.file, 'utf8');
  const html = marked.parse(rewriteLinks(source, page.file), { async: false });
  fs.writeFileSync(path.join(outDir, `${page.id}.html`), renderPage(page.title, html));
  console.log(`docs: ${page.file} -> ${path.join(path.relative('.', outDir), `${page.id}.html`)}`);
}
