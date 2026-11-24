/**
 * @file scripts/ready-reach-probe.ts
 * @description Prints what pnpm ready would run for each commit since a base, and for all of them:
 *   the whole sweep (and why) or the picked E2E suites. A look, not a gate.
 * @usage cd aimeat && pnpm exec tsx scripts/ready-reach-probe.ts [base]
 * @version-history
 *   v1.0.0 — 2026-11-24 — Initial, with scripts/lib/ready-reach.ts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { codeReach } from './lib/ready-reach.js';
import { isTextOnly, readyScope } from './lib/ready-scope.js';

const repo = path.resolve(process.cwd(), '..');
const base = process.argv[2] ?? 'origin/main';
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
for (const c of git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean)) {
  const files = git('diff', '--name-only', `${c}~1`, c).split('\n').filter(Boolean);
  const code = files.filter(f => !isTextOnly(repo, `${c}~1`, f));
  const r = code.length ? codeReach(repo, code) : { full: null, suites: [] };
  console.log(`${git('log', '-1', '--format=%h %s', c)}\n  code files ${code.length}: ${r.full ? `FULL (${r.full})` : `${r.suites.length} suite(s) ${r.suites.slice(0, 40).join(', ')}`}`);
}
const all = readyScope(repo, base);
console.log(`ALL: ${all.full ? `FULL (${all.fullWhy ?? 'code'})` : `${all.suites.length} suite(s)`}`);
