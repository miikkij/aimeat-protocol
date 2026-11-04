/**
 * @file scripts/deps-baseline-shrink.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shrinks the dependency-cruiser baseline (.dependency-cruiser-known-violations.json)
 *   to the violations the code still produces, and admits nothing new.
 *
 *   WHY NOT `depcruise --baseline --baseline-mode shrink-only`. dependency-cruiser decides two things
 *   about a baseline entry with two different comparisons. Whether a violation is KNOWN (and so not
 *   reported) uses is-same-violation, which takes a cycle as a set of modules, whichever edge it is
 *   reported from. Whether an entry is STALE uses an exact comparison that includes the edge the
 *   cycle is reported from. A cycle is reported once, from the alphabetically first edge whose path
 *   covers it, so when an unrelated fix changes which edge that is, the old entry counts as stale
 *   AND still hides the cycle. Since 2026-11-04 a stale entry fails `check:deps`, and the built-in
 *   shrink-only mode would then drop the entry and report the same cycle as new. On 2026-11-04 one
 *   of the 18 entries it called stale was this case.
 *
 *   WHAT IT DOES. It runs the cruise with no baseline applied, keeps every current violation that
 *   dependency-cruiser's own known-violation matcher (copied below, is-same-violation.mjs in
 *   dependency-cruiser 18.7.0) matches to an entry of the current baseline, and writes those in the
 *   order and format `depcruise --baseline` writes. A violation no entry matches is printed and left
 *   out: admitting one is a decision (`pnpm deps:baseline` rewrites the whole list; docs/pitfalls.md
 *   section 89).
 * @structure isSameViolation(a, b) · main()
 * @usage
 *   cd aimeat && pnpm deps:baseline:shrink     # after a fix, when check:deps names stale entries
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item D-a).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, '.dependency-cruiser-known-violations.json');
const DEPCRUISE = path.join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

interface Violation {
  from: string;
  to: string;
  rule: { name: string; severity: string };
  cycle?: { name: string }[];
  via?: { name: string }[];
}

/** dependency-cruiser 18.7.0, src/analyze/summarize/is-same-violation.mjs, unchanged in meaning. */
function isSameViolation(left: Violation, right: Violation): boolean {
  if (left.rule.name !== right.rule.name) return false;
  if (left.cycle && right.cycle) {
    const rightNames = right.cycle.map(c => c.name);
    return left.cycle.length === right.cycle.length && left.cycle.every(c => rightNames.includes(c.name));
  }
  if (left.via && right.via) {
    const rightNames = right.via.map(c => c.name);
    return left.from === right.from && left.to === right.to
      && left.via.length === right.via.length && left.via.every(c => rightNames.includes(c.name));
  }
  return left.from === right.from && left.to === right.to;
}

function main(): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'deps-shrink-'));
  const out = path.join(dir, 'cruise.json');
  try {
    const run = spawnSync(process.execPath, [
      DEPCRUISE, 'src', '--config', '.dependency-cruiser.cjs', '--no-ignore-known',
      '--output-type', 'json', '--output-to', out,
    ], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    // The cruise exits non-zero whenever an error-severity violation exists, which is the normal
    // case here (the baseline is what holds them); only a missing result is a failure.
    let current: Violation[];
    try {
      current = (JSON.parse(readFileSync(out, 'utf8')) as { summary: { violations: Violation[] } }).summary.violations;
    } catch {
      console.error(`✗ dependency-cruiser produced no result (exit ${run.status}).`);
      process.exit(1);
    }
    const known = JSON.parse(readFileSync(BASELINE, 'utf8')) as Violation[];
    const kept = current.filter(v => known.some(k => isSameViolation(k, v)));
    const fixed = known.filter(k => !current.some(v => isSameViolation(k, v)));
    const outside = current.filter(v => !known.some(k => isSameViolation(k, v)));
    writeFileSync(BASELINE, JSON.stringify(kept, null, 2) + '\n', 'utf8');
    console.log(`baseline: ${known.length} → ${kept.length} entries`);
    for (const k of fixed) console.log(`  removed (fixed): ${k.rule.name} ${k.from} → ${k.to}`);
    for (const v of outside) console.log(`  not admitted (${v.rule.severity}): ${v.rule.name} ${v.from} → ${v.to}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
