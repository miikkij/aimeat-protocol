/**
 * @file check-no-max-tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pre-commit / CI guard: fails if a hardcoded `max_tokens` / `maxTokens` cap appears on an
 *   AI call anywhere in the shipped app (src/ + public/). A token cap silently truncates model output and
 *   breaks long generations (workspace manifests, strategy JSON, etc.) — the project rule is to leave
 *   output UNCAPPED, and the cap kept creeping back in. This catches it before it lands.
 * @structure
 *   - FORBIDDEN: `(max_tokens|maxTokens)` followed by `:` or `=` then a NUMERIC literal — i.e. a baked-in
 *     cap like `max_tokens: 3000`. Variable/property forms (`max_tokens: opts.x`, `prefs.max_tokens`) and
 *     budget keys (`max_tokens_per_task`) are intentionally NOT matched — they are pass-through plumbing
 *     and spend-budget config, a different concept.
 *   - Scans src/ + public/ (the shipped app). Separate tooling (tools/synthtraces, the calibrator UI) and
 *     the OpenRouter settings prefs are out of scope by design.
 * @usage  pnpm check:no-max-tokens   (exits non-zero if any baked-in cap is found)
 * @version-history
 *   v1.0.0 — 2026-06-29 — Initial guard: block hardcoded max_tokens caps on AI calls in src/ + public/.
 */
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..'); // aimeat/

// Directories to scan (the shipped app surface).
const SCAN_DIRS = ['src', 'public'];
// Vendored / generated / separate-tool trees are not the app's AI-call surface.
const IGNORE = ['/lib/', '/cortex-bundled/', '/samples/', '/generated/', 'scripts/check-no-max-tokens'];

// A baked-in token cap on an AI call: `max_tokens: 3000`, `maxTokens = 500`. The numeric literal is the
// tell — variable/property forms and `max_tokens_per_task` (budget) never match (no `:`/`=` + digit right
// after the bare key).
const FORBIDDEN = /(max_tokens|maxTokens)\s*[:=]\s*-?\d/;

const offenders: Array<{ file: string; line: number; text: string }> = [];

for (const dir of SCAN_DIRS) {
  const cwd = join(root, dir);
  let files: string[] = [];
  for (const pat of ['**/*.ts', '**/*.js', '**/*.html']) {
    try { files = files.concat(globSync(pat, { cwd })); } catch { /* dir may not exist */ }
  }
  for (const rel of files) {
    const full = join(cwd, rel);
    const posix = full.replace(/\\/g, '/');
    if (IGNORE.some((ig) => posix.includes(ig))) continue;
    let src: string;
    try { src = readFileSync(full, 'utf8'); } catch { continue; }
    if (!FORBIDDEN.test(src)) continue;
    src.split('\n').forEach((text, i) => {
      if (FORBIDDEN.test(text)) offenders.push({ file: `aimeat/${dir}/${rel.replace(/\\/g, '/')}`, line: i + 1, text: text.trim().slice(0, 140) });
    });
  }
}

if (offenders.length) {
  console.error(`\n✖ ${offenders.length} hardcoded max_tokens cap(s) found on AI call(s):\n`);
  for (const o of offenders) console.error(`  ${o.file}:${o.line}\n      ${o.text}`);
  console.error('\n  AIMEAT rule: never cap token output on AI calls — it truncates long generations.');
  console.error('  Remove the max_tokens literal (let it run uncapped). Pass-through forms');
  console.error('  (max_tokens: someVar) and budget keys (max_tokens_per_task) are fine.\n');
  process.exit(1);
}

console.log('✓ no hardcoded max_tokens caps on AI calls (src/ + public/)');
