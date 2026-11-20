/**
 * @file check-partial-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses zod's `.partial()` in the node's code (src/ and public/). Under zod 4, `.partial()`
 *   keeps each field's `.default()`, so a partial update that leaves a field out gets the default during
 *   the parse, and the merge onto the stored record resets that field. The answer is 200 and a test that
 *   reads back only the field it sent is green. It hit the data processing agreements (4ffe9bc0f) and
 *   then the customer due diligence cards, settings and suspicion drafts (01ecf5cc0, b0d85b737).
 *   Whether a schema carries a default somewhere in what it was built from cannot be read from one
 *   line, so the rule is simple: every partial-update schema is `patchOf(schema)` from
 *   src/utils/zod-patch.ts, which removes the defaults, and `.partial()` appears nowhere else.
 * @structure scan src/ and public/ (.ts, .js, .mjs), comments removed · refuse `.partial(`
 * @usage pnpm check:partial-defaults   (exits non-zero on any .partial( outside src/utils/zod-patch.ts)
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial; replaces docs/pitfalls.md §127.
 */
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // aimeat/

const SCAN_DIRS = ['src', 'public'];
/** Vendored and generated trees are not the node's own schemas; zod-patch.ts is the one allowed caller. */
const IGNORE = ['/lib/', '/node_modules/', '/generated/', '/cortex-bundled/', 'src/utils/zod-patch.ts'];
const PARTIAL = /\.partial\s*\(/;

/** The source with block and line comments blanked, line numbers kept. */
function withoutComments(src: string): string[] {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return blanked.split('\n').map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'));
}

const offenders: Array<{ file: string; line: number; text: string }> = [];
for (const dir of SCAN_DIRS) {
  const cwd = join(root, dir);
  for (const rel of globSync(['**/*.ts', '**/*.js', '**/*.mjs'], { cwd })) {
    const posix = `${dir}/${rel.replace(/\\/g, '/')}`;
    if (IGNORE.some((ig) => `/${posix}`.includes(ig))) continue;
    const src = readFileSync(join(cwd, rel), 'utf8');
    if (!PARTIAL.test(src)) continue;
    const raw = src.split('\n');
    withoutComments(src).forEach((code, i) => {
      if (PARTIAL.test(code)) offenders.push({ file: `aimeat/${posix}`, line: i + 1, text: raw[i].trim().slice(0, 140) });
    });
  }
}

if (offenders.length) {
  console.error(`\n✖ ${offenders.length} zod .partial() call(s):\n`);
  for (const o of offenders) console.error(`  ${o.file}:${o.line}\n      ${o.text}`);
  console.error('\n  Under zod 4, .partial() keeps every .default(), so a partial update that leaves a field out');
  console.error('  resets it to the default. Use patchOf(schema) from src/utils/zod-patch.ts instead.\n');
  process.exit(1);
}
console.log('✓ no zod .partial() outside patchOf (src/ + public/)');
