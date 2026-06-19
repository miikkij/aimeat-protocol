/**
 * @file check-importmap.ts
 * @description Verifies the spa.html importmap stays in sync with the frontend's absolute-path
 *   imports. Every first-party module imported by an absolute specifier (/js/…, /components/…,
 *   /views/…) needs an identity entry in the importmap so portal.ts can stamp it with
 *   ?v=BUILD_ID — without an entry the module still loads but is NOT cache-busted, so browsers
 *   serve a stale copy after a deploy. tsc (checkJs) does NOT catch this: it resolves the path to
 *   the real file regardless of the importmap. This check closes that gap.
 * @structure
 *   - parses the importmap JSON out of public/spa.html
 *   - scans every public JS source for static + dynamic absolute imports
 *   - reports: (a) imported-but-unmapped specifiers, (b) mapped-but-missing target files
 * @usage  pnpm check:importmap   (exits non-zero if any problem is found)
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial importmap ↔ import consistency check
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { globSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const spaPath = join(publicDir, 'spa.html');

// Vendored / generated trees are not first-party source — skip them.
const IGNORE = ['lib/', 'cortex-bundled/', 'samples/'];

/** Extract the `imports` object from the <script type="importmap"> block in spa.html. */
function parseImportmap(html: string): Record<string, string> {
  const m = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('No <script type="importmap"> block found in spa.html');
  const json = JSON.parse(m[1]);
  return json.imports || {};
}

/**
 * All absolute ("/…") import specifiers REALLY imported by a JS source — static `import … from
 * '/x'` / `import '/x'` and dynamic `import('/x')`. Scans line-by-line and skips comment lines so
 * `@usage import Foo from '/views/foo.js'` in a JSDoc header is not mistaken for a real import.
 */
function absoluteImports(src: string): string[] {
  const specs = new Set<string>();
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
    const staticImp = line.match(/^import\b[^\n]*?["'](\/[^"'?]+)["']/);
    if (staticImp) specs.add(staticImp[1]);
    for (const d of line.matchAll(/\bimport\s*\(\s*["'](\/[^"'?]+)["']/g)) specs.add(d[1]);
  }
  return [...specs];
}

const html = readFileSync(spaPath, 'utf-8');
const importmap = parseImportmap(html);
const mapped = new Set(Object.keys(importmap));

const files = globSync('**/*.js', { cwd: publicDir }).filter(
  (f) => !IGNORE.some((p) => f.replace(/\\/g, '/').startsWith(p)),
);

const unmapped = new Map<string, string[]>(); // specifier -> files that import it
for (const rel of files) {
  const src = readFileSync(join(publicDir, rel), 'utf-8');
  for (const spec of absoluteImports(src)) {
    // Only first-party module paths need importmap identity entries.
    if (!/^\/(?:js|components|views)\//.test(spec)) continue;
    if (!mapped.has(spec)) {
      if (!unmapped.has(spec)) unmapped.set(spec, []);
      unmapped.get(spec)!.push(rel.replace(/\\/g, '/'));
    }
  }
}

// Importmap entries whose target file no longer exists (dead entries).
const orphans: string[] = [];
for (const [key, value] of Object.entries(importmap)) {
  if (!value.startsWith('/')) continue; // bare specifier targets (e.g. /lib/preact.mjs) — skip non-/ checks below
  const target = value.split('?')[0];
  if (!existsSync(join(publicDir, target.replace(/^\//, '')))) orphans.push(`${key} -> ${value}`);
}

let failed = false;

if (unmapped.size > 0) {
  failed = true;
  console.error(`\n✖ ${unmapped.size} absolute import(s) missing an importmap entry in spa.html`);
  console.error('  (these modules load but are NOT cache-busted with ?v=BUILD_ID — stale after deploy)\n');
  for (const [spec, importers] of unmapped) {
    console.error(`  "${spec}": "${spec}",`);
    console.error(`      imported by: ${importers.slice(0, 5).join(', ')}${importers.length > 5 ? `, +${importers.length - 5} more` : ''}`);
  }
  console.error('\n  Fix: add the identity entries above to the importmap in public/spa.html.\n');
}

if (orphans.length > 0) {
  failed = true;
  console.error(`\n✖ ${orphans.length} importmap entr(y/ies) point to a file that does not exist:\n`);
  for (const o of orphans) console.error(`  ${o}`);
  console.error('\n  Fix: remove the dead entries from the importmap in public/spa.html.\n');
}

if (failed) {
  process.exit(1);
}
console.log(`✓ importmap in sync — ${mapped.size} entries, all absolute /js|/components|/views imports mapped.`);
