/**
 * @file src/utils/relative-modules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first-party modules the shell's importmap does not name but a relative import
 *   reaches, so the shell can name them too and each gets its content tag (performance work 2026-11,
 *   architecture item 5).
 *
 *   WHY. An importmap entry is served under its content tag and the browser keeps it for good
 *   (routes/portal-spa.ts stampAssets, server-bootstrap/static-files.ts). A module reached by a
 *   relative import (`./rows.js`) had no tag, was served `no-cache`, and cost one revalidation per
 *   page load, level after level of the import graph: 555 such modules, 150 to 240 of them on a
 *   Settings page.
 *
 *   HOW. An importmap's URL-like keys match a relative import too: the browser resolves `./rows.js`
 *   against the importing module's URL first and then looks the result up in the map. So an entry
 *   `"/views/profile/data-wallet/rows.js"` maps every road to that file (a relative import, an
 *   absolute one, a computed `import()`) to one tagged address, and the module keeps one instance.
 *   The scan reads every .js file under public/ (third-party `lib/`, `cortex-bundled/` and `vendor/`
 *   left out) for `from './…'`, `import './…'` and `import('./…')` and resolves each against its file.
 *   A match inside a comment adds an entry for a file that may not exist; such a path is dropped.
 * @structure relativeModulePaths(publicDir) · addModulesToImportmap(html, paths)
 * @usage html = addModulesToImportmap(html, relativeModulePaths(publicDir));
 * @version-history
 *   2026-11-11 — addModulesToImportmap finds the map's closing line with one forward scan instead of
 *     a lazy regex that was quadratic in a run of blank lines (CodeQL js/polynomial-redos); same output.
 *   2026-11-10 — Initial.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

const SKIPPED_DIRS = new Set(['lib', 'cortex-bundled', 'vendor', 'node_modules']);
const RELATIVE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.\.?\/[^'"\s]+\.m?js)['"]/g;

/** Every module under `publicDir` that a relative import reaches, as a URL path ("/views/…/x.js"). */
export function relativeModulePaths(publicDir: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!SKIPPED_DIRS.has(name)) walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const urlPath = '/' + relative(publicDir, full).split(sep).join('/');
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(RELATIVE_IMPORT)) {
        const target = posix.normalize(posix.join(posix.dirname(urlPath), m[1]));
        if (target.startsWith('/') && existsSync(join(publicDir, ...target.slice(1).split('/')))) found.add(target);
      }
    }
  };
  walk(publicDir);
  return [...found].sort();
}

/**
 * The shell's importmap with an identity entry ("/x.js": "/x.js") for each path it does not name
 * yet; stampAssets then tags every entry, these with the rest.
 */
export function addModulesToImportmap(html: string, paths: readonly string[]): string {
  const head = /"imports"\s*:\s*\{/.exec(html);
  if (!head) return html;
  const start = head.index + head[0].length;
  const end = closingLineOf(html, start);
  if (end < 0) return html;
  const entries = html.slice(start, end);
  const named = new Set([...entries.matchAll(/"([^"]+)"\s*:/g)].map(m => m[1]));
  const extra = paths.filter(p => !named.has(p)).map(p => `      ${JSON.stringify(p)}: ${JSON.stringify(p)}`);
  if (!extra.length) return html;
  const body = entries.trimEnd();
  return `${html.slice(0, start)}${body}${body.trim() ? ',' : ''}\n${extra.join(',\n')}${html.slice(end)}`;
}

/**
 * The index of the first newline at or after `from` that only whitespace separates from a `}`, or
 * -1: where `[\s\S]*?(\n\s*\})` started its closing group. Written as one forward scan because the lazy
 * pattern retried every newline and scanned the whitespace after each one, quadratic in a long run
 * of blank lines (CodeQL js/polynomial-redos). A whitespace run that ends in anything but `}` is
 * skipped whole: every newline inside it reaches the same character.
 */
function closingLineOf(text: string, from: number): number {
  let i = text.indexOf('\n', from);
  while (i !== -1) {
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === '}') return i;
    i = text.indexOf('\n', j);
  }
  return -1;
}
