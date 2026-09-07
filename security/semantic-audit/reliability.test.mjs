/**
 * @file reliability.test.mjs
 * @description Regression checks for audit findings A1-A4, using isolated scanner failures.
 * @version-history
 *  - 1.0.0 (2026-09-08): audit reliability regression coverage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePnpmAudit } from '../../aimeat/scripts/lib/pnpm-audit.mjs';
import { reviewInvariantRange, reviewCoverage } from './invariant-review.mjs';
import { contextFingerprint, contextDigest, currentCodeScanningAlerts } from './finding-context.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_CHECKS, FAST_CHECKS } from '../../aimeat/scripts/lib/check-registry.mjs';
import { CHECKS } from './report-content.mjs';

const report = n => JSON.stringify({ metadata: { totalDependencies: 487,
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: n, critical: 0 } } });
test('A3: changed authorization, rule or occurrence invalidates approval', () => {
  const f = { ruleId: 'identity', file: 'route.ts', text: 'storage.get(req.auth.sub)', range: { start: { line: 10 } } };
  const approved = contextFingerprint(f, 'source-with-scope-check');
  assert.notEqual(approved, contextFingerprint(f, 'source-without-scope-check'));
  assert.notEqual(approved, contextFingerprint({ ...f, ruleVersion: 'v2' }, 'source-with-scope-check'));
  assert.notEqual(approved, contextFingerprint({ ...f, range: { start: { line: 20 } } }, 'source-with-scope-check'));
  assert.equal(approved, contextFingerprint(f, 'source-with-scope-check'));
});
test('A4: report includes every fast check and the shared compiler invariant run', () => {
  assert.deepEqual(CHECKS.map(c => c[0]), [...FAST_CHECKS.map(c => c.script), 'check:invariants']);
  assert.equal(new Set(AUDIT_CHECKS.map(c => c.script)).size, AUDIT_CHECKS.length);
  assert.ok(CHECKS.some(c => c[0] === 'check:scope-parity'));
});
test('A3: dismissed findings are reviewed again and stale CI coordinates are refused', () => {
  const alert = { state: 'dismissed', most_recent_instance: {
    state: 'dismissed', commit_sha: 'new-head', location: { path: 'aimeat/src/routes/work.ts' },
  } };
  assert.deepEqual(currentCodeScanningAlerts([alert], 'new-head'), [alert]);
  assert.throws(() => currentCodeScanningAlerts([alert], 'different-head'));
  assert.deepEqual(currentCodeScanningAlerts([{ ...alert, state: 'fixed' }], 'new-head'), []);
});
test('A3: changing middleware outside the matched file invalidates the real source snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'aimeat-audit-context-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    mkdirSync(join(root, 'aimeat/src/auth'), { recursive: true });
    const middleware = join(root, 'aimeat/src/auth/middleware.ts');
    writeFileSync(middleware, 'export const allowed = checkScope();');
    const before = contextDigest(root);
    writeFileSync(middleware, 'export const allowed = true;');
    assert.notEqual(contextDigest(root), before);
    mkdirSync(join(root, 'security/semantic-audit/ast-grep'), { recursive: true });
    const beforeRule = contextDigest(root);
    writeFileSync(join(root, 'security/semantic-audit/ast-grep/rule.yml'), 'rule: changed');
    assert.notEqual(contextDigest(root), beforeRule);
  } finally {
    // Only the directory returned by mkdtemp for this isolated test is removed.
    rmSync(root, { recursive: true, force: true });
  }
});
test('A1: errors stay errors and finding exit codes remain valid', () => {
  for (const raw of ['network failure', '{"error":{"code":"ECONNRESET"}}', '{}', 'null']) {
    assert.equal(parsePnpmAudit(raw, 1).status, 'error');
  }
  assert.equal(parsePnpmAudit(report(0), 1).status, 'error');
  assert.equal(parsePnpmAudit(report(0), null).status, 'error');
  assert.equal(parsePnpmAudit(report(0), 0).status, 'clean');
  assert.equal(parsePnpmAudit(report(2), 1).status, 'findings');
});

test('A2: failures and incomplete chunk responses preserve the checkpoint', () => {
  const store = { lastInvariantReviewCommit: 'abc123', invariantFindings: [] };
  const before = structuredClone(store);
  assert.throws(() => reviewInvariantRange({ store, head: 'def456', git: () => { throw Error('git failure'); } }));
  assert.deepEqual(store, before);
  let calls = 0;
  assert.throws(() => reviewInvariantRange({ store, head: 'def456', cap: 10,
    git: cmd => cmd.startsWith('diff ') ? 'a'.repeat(31) : '',
    ask: ({ id }) => ++calls === 2 ? {} : { reviewedChunk: id, findings: [] } }));
  assert.equal(calls, 2);
  assert.deepEqual(store, before);
  assert.equal(reviewCoverage(() => { throw Error('missing object'); }, 'abc123', 'def456').status, 'error');
});

test('A2: every diff character is covered and findings are never capped at twenty', () => {
  const store = { lastInvariantReviewCommit: null, invariantFindings: [] };
  const findings = Array.from({ length: 25 }, (_, n) => ({ invariant: 14, file: 'route.ts', note: `Concern ${n}` }));
  reviewInvariantRange({ store, head: 'def456', date: '2026-09-08', cap: 10,
    git: cmd => cmd.startsWith('diff --stat') ? 'route.ts' : 'x'.repeat(31),
    ask: ({ id }) => ({ reviewedChunk: id, findings }) });
  assert.equal(store.lastInvariantReviewCommit, 'def456');
  assert.equal(store.invariantFindings.length, 25);
  assert.deepEqual(store.invariantReviewCoverage.chunks.map(c => [c.from, c.to]), [[0, 10], [10, 20], [20, 30], [30, 31]]);
});
