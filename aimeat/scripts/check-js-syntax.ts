/**
 * @file check-js-syntax.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A JavaScript syntax check that FAILS CLOSED — for the one job `node --check` was
 *   being recommended for and is not safe at: verifying an app's inline script before it is
 *   republished over a live app.
 *
 *   WHAT WENT WRONG, MEASURED ON NODE 24.12.0 (2026-08-01). `node --check <broken file>` does exit 1
 *   — the parser is fine. What is not fine is what happens when the FILENAME is empty:
 *
 *     $ node --check bad.js        → exit 1   (correct)
 *     $ FILE=; node --check $FILE  → exit 0, and prints nothing at all
 *     $ node --check "$UNSET_VAR"  → exit 0, and prints nothing at all
 *
 *   With no path argument `node --check` reads stdin, which in a non-interactive shell is empty,
 *   and empty input is valid JavaScript. So an unset variable, a `cd` that short-circuited, or a
 *   filename that never got substituted turns the gate into a silent no-op that LOOKS like a pass.
 *   That is how "SYNTAX OK" came to be reported for files nobody had parsed. A gate that fails open
 *   is worse than no gate, because it ends the investigation.
 *
 *   THE TWO RULES THIS SCRIPT IS BUILT ON:
 *     1. **No input is an error.** Zero paths, or a path that does not resolve, exits non-zero.
 *        There is no argument list that makes this print a pass without having parsed something.
 *     2. **It proves itself before it trusts itself.** Sentinel sources that MUST fail to parse are
 *        run on EVERY invocation, before the caller's files. If a future runtime, bundler or flag
 *        ever makes them parse, this exits non-zero and says so, instead of quietly blessing
 *        everything it is handed.
 * @structure
 *   - the parser core lives in src/utils/inline-script-parse.ts (SENTINELS + selfTest, parseSource,
 *     extractInlineScripts) and is re-exported here
 *   - CLI: check-js-syntax [--module] [--html] <file...>
 * @usage
 *   pnpm check:js-syntax path/to/app.js
 *   pnpm check:js-syntax --html path/to/app.html      # every inline <script> body
 *   pnpm check:js-syntax --module src/static/sdk-libs/ai/index.js
 * @version-history
 *   v1.1.0 — 2026-08-11 — The parser core moved to src/utils/inline-script-parse.ts so the
 *     publish-time artifact check (services/app-artifact-lint.ts) and this CLI parse an app with
 *     the SAME code and the same sentinels. Pure extraction: this file is now the CLI around it,
 *     and re-exports the core so existing importers keep working.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0b.
 */
import { readFileSync } from 'node:fs';
import {
  SENTINELS, extractInlineScripts, parseSource, selfTest, type ParseGoal,
} from '../src/utils/inline-script-parse.js';

// Re-exported so callers (and the unit test) can keep importing the checker by its CLI name.
export { SENTINELS, extractInlineScripts, parseSource, selfTest, type ParseGoal } from '../src/utils/inline-script-parse.js';

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function main(argv: string[]): number {
  const goal: ParseGoal = argv.includes('--module') ? 'module' : 'script';
  const html = argv.includes('--html');
  const files = argv.filter((a) => !a.startsWith('--'));

  try {
    selfTest();
  } catch (err) {
    console.error(`\n✖ ${(err as Error).message}\n`);
    return 2;
  }

  // THE failure mode this script exists for. `node --check` answers 0 here; this answers 1.
  if (files.length === 0) {
    console.error('\n✖ nothing to check — pass one or more file paths.\n');
    console.error('  This is deliberately an ERROR. `node --check` with an empty or unset filename');
    console.error('  reads empty stdin, parses it happily and exits 0 with no output, which reads as');
    console.error('  a pass for a file nobody looked at.\n');
    console.error('  Usage: pnpm check:js-syntax [--module] [--html] <file...>\n');
    return 1;
  }

  let failures = 0;
  let checked = 0;
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`✖ ${file}: cannot read — ${(err as Error).message}`);
      failures += 1;
      continue;
    }

    const units: Array<{ label: string; source: string; goal: ParseGoal }> = html || /\.html?$/i.test(file)
      ? extractInlineScripts(source).map((s) => ({ label: `${file} <script #${s.index}>`, source: s.source, goal: s.goal }))
      : [{ label: file, source, goal }];

    if (units.length === 0) {
      // An HTML file with no inline script is not a pass — it is very likely the wrong file, and
      // reporting it as OK is the same class of false comfort as the empty-stdin case.
      console.error(`✖ ${file}: no inline <script> blocks found — is this the file you meant?`);
      failures += 1;
      continue;
    }

    for (const unit of units) {
      checked += 1;
      try {
        parseSource(unit.source, unit.label, unit.goal);
        console.log(`✓ ${unit.label} (${unit.goal})`);
      } catch (err) {
        failures += 1;
        console.error(`✖ ${unit.label} (${unit.goal}): ${(err as Error).message}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n✖ ${failures} of ${checked} unit(s) failed to parse.\n`);
    return 1;
  }
  console.log(`\n✓ ${checked} unit(s) parsed, after ${SENTINELS.length} sentinels were confirmed to fail.\n`);
  return 0;
}

// Only run as a CLI, so the unit tests can import selfTest/parseSource without exiting the process.
if (process.argv[1] && /check-js-syntax\.[tj]s$/.test(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
