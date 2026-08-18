/**
 * @file src/utils/inline-script-parse.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Parsing a single-file app's inline `<script>` bodies without running any of them —
 *   the shared core behind both the `pnpm check:js-syntax` CLI and the publish-time artifact check.
 *
 *   IT FAILS CLOSED, AND IT PROVES ITSELF FIRST. The behaviour this replaces was `node --check`,
 *   which exits 0 printing nothing when handed an empty filename: an unset variable turned the gate
 *   into a silent pass. So there is no input here that yields a pass without something having been
 *   parsed, and {@link selfTest} runs sentinel sources that MUST fail to parse before any caller's
 *   source is trusted. If a future runtime makes a sentinel parse, the checker says so rather than
 *   quietly blessing everything.
 *
 *   NOTHING IS EXECUTED. `new vm.Script(source)` compiles and stops; the compiled script is never
 *   run, and no context is created for it. That is the whole reason this is safe to call on bytes a
 *   stranger just uploaded.
 * @structure
 *   - ParseGoal — classic script vs module
 *   - parseSource(source, filename, goal) — throws on a syntax error
 *   - moduleGoalAvailable() — is `vm.SourceTextModule` reachable in this process?
 *   - extractInlineScripts(html) — the `<script>` bodies of a single-file app, in document order
 *   - SENTINELS / selfTest() — the checker's own proof that it still checks
 * @usage
 *   import { extractInlineScripts, parseSource, selfTest } from '../utils/inline-script-parse.js';
 *   selfTest();
 *   for (const s of extractInlineScripts(html)) parseSource(s.source, `<script #${s.index}>`, s.goal);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Pure extraction from scripts/check-js-syntax.ts (v1.0.0, 2026-08-01) so
 *     the publish-time artifact check and the CLI parse by the SAME code. A second parser would be
 *     a second answer to "does this app's script compile", which is the drift this repo keeps
 *     paying for elsewhere.
 */
import * as vm from 'node:vm';

/** Parse goal. A single-file app's inline `<script>` is a CLASSIC script; an SDK lib is a module. */
export type ParseGoal = 'script' | 'module';

/**
 * Sources that MUST NOT parse. Run before every real check, so the checker cannot silently become a
 * no-op. The first two are the pair the Phase 6 audit used; the third catches a module-goal-only
 * mistake that a script-goal parse would happily accept as a label.
 */
export const SENTINELS: Array<{ name: string; source: string; goal: ParseGoal }> = [
  { name: 'unterminated string', source: "var x = 'a's b'", goal: 'script' },
  { name: 'stray parenthesis', source: 'var x = ( ;', goal: 'script' },
  { name: 'reserved word as binding', source: 'var function = 1;', goal: 'script' },
];

/**
 * `vm.SourceTextModule` exists only under `--experimental-vm-modules`, and the server does not run
 * with that flag. A caller that cannot parse module goal must SKIP the block rather than fall back
 * to script goal, which would reject a perfectly good `import` line and report a syntax error for
 * correct code.
 */
export function moduleGoalAvailable(): boolean {
  return typeof (vm as unknown as { SourceTextModule?: unknown }).SourceTextModule === 'function';
}

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
 *
 * The body ends at the first `</script>`, exactly as the HTML parser ends it — so a literal closing
 * tag inside a string truncates the block here for the same reason it truncates it in the browser.
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
    // The throw IS the pass: a sentinel that fails to parse is the expected result and the reason
    // this loop exists. The failure worth surfacing is the opposite one, thrown two lines below.
    // eslint-disable-next-line aimeat/no-silent-catch -- the caught error is the expected outcome
    try { parseSource(s.source, `<sentinel:${s.name}>`, s.goal); } catch { threw = true; }
    if (!threw) {
      throw new Error(
        `check-js-syntax self-test FAILED: the sentinel "${s.name}" parsed without error, so this `
        + 'checker is not checking anything. Do not trust any pass it has reported.');
    }
  }
}
