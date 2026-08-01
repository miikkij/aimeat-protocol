/**
 * @file check-js-syntax.ts
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
 *   - SENTINELS — sources that must not parse; the self-test
 *   - parseSource(source, filename, goal) — vm.Script (script goal) / vm.SourceTextModule (module)
 *   - extractInlineScripts(html) — the <script> bodies of a single-file app
 *   - CLI: check-js-syntax [--module] [--html] <file...>
 * @usage
 *   pnpm check:js-syntax path/to/app.js
 *   pnpm check:js-syntax --html path/to/app.html      # every inline <script> body
 *   pnpm check:js-syntax --module src/static/sdk-libs/ai/index.js
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0b.
 */
import { readFileSync } from 'node:fs';
import * as vm from 'node:vm';

/** Parse goal. A single-file app's inline `<script>` is a CLASSIC script; an SDK lib is a module. */
export type ParseGoal = 'script' | 'module';

/**
 * Sources that MUST NOT parse. Run before every real check, so the checker cannot silently become a
 * no-op. The first two are the pair the Phase 6 audit used; the third catches a module-goal-only
 * mistake that a script-goal parse would happily accept as a label.
 */
const SENTINELS: Array<{ name: string; source: string; goal: ParseGoal }> = [
  { name: 'unterminated string', source: "var x = 'a's b'", goal: 'script' },
  { name: 'stray parenthesis', source: 'var x = ( ;', goal: 'script' },
  { name: 'reserved word as binding', source: 'var function = 1;', goal: 'script' },
];

/**
 * Parse one source in the given goal, throwing on a syntax error.
 *
 * Module goal needs `vm.SourceTextModule`, which only exists under `--experimental-vm-modules`. When
 * it is missing this THROWS rather than falling back to a script-goal parse: a script-goal parse of
 * module source rejects `import`/`export` outright, so a silent fallback would report a syntax error
 * for correct code, and any looser fallback would report a pass it had not earned. Fail closed, and
 * say which flag is missing.
 */
export function parseSource(source: string, filename: string, goal: ParseGoal = 'script'): void {
  if (goal === 'module') {
    // `SourceTextModule` exists on the vm namespace only under --experimental-vm-modules, and
    // @types/node does not declare it, so it is reached through an explicitly typed lookup.
    const SourceTextModule = (vm as unknown as {
      SourceTextModule?: new (src: string, opts?: { identifier?: string }) => unknown;
    }).SourceTextModule;
    if (typeof SourceTextModule !== 'function') {
      throw new Error(
        'module-goal parsing needs node --experimental-vm-modules; re-run with that flag rather than '
        + 'accepting an unchecked file');
    }
    // Constructing it parses the source. Nothing is linked or evaluated: this must never run code.
    new SourceTextModule(source, { identifier: filename });
    return;
  }
  // Constructing a vm.Script parses without executing anything.
  new vm.Script(source, { filename });
}

/**
 * The `<script>` bodies of a single-file app, in document order.
 *
 * Blocks carrying a `src` or a non-JavaScript `type` (`application/ld+json`, an import map, a
 * template) are skipped — parsing those as JavaScript would be a false failure, which trains people
 * to ignore the checker.
 */
export function extractInlineScripts(html: string): Array<{ index: number; source: string; goal: ParseGoal }> {
  const out: Array<{ index: number; source: string; goal: ParseGoal }> = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(html)) !== null) {
    n += 1;
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    // The block states its own goal. Parsing a `type="module"` body in script goal rejects its
    // `import` line and reports a syntax error for perfectly good code — a false failure, which is
    // the fastest way to teach people to ignore a checker.
    out.push({ index: n, source: m[2] ?? '', goal: type === 'module' ? 'module' : 'script' });
  }
  return out;
}

/** Run the sentinels. Throws when one of them PARSES, which would mean the checker checks nothing. */
export function selfTest(): void {
  for (const s of SENTINELS) {
    let threw = false;
    try { parseSource(s.source, `<sentinel:${s.name}>`, s.goal); } catch { threw = true; }
    if (!threw) {
      throw new Error(
        `check-js-syntax self-test FAILED: the sentinel "${s.name}" parsed without error, so this `
        + 'checker is not checking anything. Do not trust any pass it has reported.');
    }
  }
}

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
