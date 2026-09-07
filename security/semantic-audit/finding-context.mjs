/**
 * @file finding-context.mjs
 * @description Conservative approval scope: shipped source, policy and scanner definitions.
 * @version-history
 *  - 1.0.0 (2026-09-08): A3: line-only approvals cannot survive changes to authorization context.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A3: re-review dismissed occurrences too, but never attach old CI coordinates to new code. */
export function currentCodeScanningAlerts(alerts, head) {
  return alerts.filter(a => {
    const file = a.most_recent_instance?.location?.path;
    return a.state !== 'fixed' && a.most_recent_instance?.state !== 'fixed' && file
      && !/(^|\/)(test|tests)\//.test(file) && !/\/dist\//.test(file)
      && !/\.min\.js$/.test(file) && !file.startsWith('docs/');
  }).map(a => {
    if (a.most_recent_instance.commit_sha !== head) throw new Error('CI findings are not from the reviewed HEAD; wait for CI.');
    return a;
  });
}

/** Snapshot once per scan. Whole-source binding deliberately includes callers and dynamic wiring:
 * an import-only walk cannot prove which middleware, config or runtime registry guards a handler.
 * Existing approvals remain historical; no automatic migration grants approval to a new context.
 */
export function contextDigest(root) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'aimeat/src', 'python/aimeat-crewai', 'security/semantic-audit/ast-grep',
    'security/semantic-audit/semgrep', 'security/semantic-audit/sgconfig.yml',
    'docs/coding-guidelines/security-development-dna.md', '.github/workflows/codeql.yml',
    '.github/workflows/semantic-audit.yml', 'pnpm-lock.yaml', 'aimeat/pnpm-lock.yaml'],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  const digest = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    digest.update(path).update('\0');
    try { digest.update(readFileSync(resolve(root, path))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      digest.update('<deleted>');
    }
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function contextFingerprint(finding, context) {
  if (!context) throw new Error('An approval requires a source context digest');
  // Location distinguishes two identical sinks in different functions. Line drift deliberately
  // requires review too: convenience must not transfer a decision to a different occurrence.
  return createHash('sha256').update(JSON.stringify({ version: 2, context,
    rule: finding.ruleId, source: finding.source || 'ast-grep',
    file: String(finding.file).replace(/\\/g, '/'), line: finding.range?.start?.line,
    column: finding.range?.start?.column, text: finding.text, ruleVersion: finding.ruleVersion || null,
  })).digest('hex').slice(0, 32);
}
