/**
 * @file pnpm-audit.mjs
 * @description Validate npm audit results for both security reports.
 * @version-history
 *  - 1.0.0 (2026-09-08): A1: scanner errors cannot become clean results.
 */
export function parsePnpmAudit(raw, exitCode) {
  const failure = error => ({ ok: false, status: 'error', error, counts: null, total: null, advisories: [] });
  let data;
  try { data = JSON.parse(raw); } catch { return failure('pnpm audit returned unreadable JSON'); }
  const counts = data?.metadata?.vulnerabilities;
  const total = data?.metadata?.totalDependencies;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (data?.error || !counts || !Number.isSafeInteger(total) || total < 0
    || severities.some(s => !Number.isSafeInteger(counts[s]) || counts[s] < 0)) {
    return failure('pnpm audit returned no valid vulnerability metadata');
  }
  const found = severities.reduce((n, s) => n + counts[s], 0);
  // npm audit uses exit 1 for findings. A signal/launch error is never an audit result.
  if (exitCode !== 0 && !(exitCode === 1 && found > 0)) return failure('pnpm audit did not complete successfully');
  return { ok: true, status: found > 0 ? 'findings' : 'clean', counts, total,
    advisories: Object.values(data.advisories || {}) };
}
