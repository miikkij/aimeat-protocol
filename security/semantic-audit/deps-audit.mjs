/**
 * @file deps-audit.mjs
 * @description Dependency vulnerability section of the audit report: runs `pnpm audit --json` in
 * aimeat/ and returns a structured summary (severity counts + per-advisory rows) so the report can
 * show known CVEs in the dependency tree next to the code-level guards.
 * @version-history
 *  - 1.0.0 (2026-08-23): first version.
 */
import { execSync } from 'node:child_process';

/** Runs pnpm audit in the given package dir. Tolerates the nonzero exit that vulnerabilities cause. */
export function runDepsAudit(pkgDir) {
  let raw = '';
  try {
    raw = execSync('pnpm audit --json', { cwd: pkgDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    raw = String(err.stdout || '');
  }
  let data;
  try { data = JSON.parse(raw); } catch {
    return { ok: false, error: 'pnpm audit ei tuottanut luettavaa tulosta.' };
  }
  const counts = data.metadata?.vulnerabilities || {};
  const advisories = Object.values(data.advisories || {}).map(a => ({
    module: a.module_name,
    severity: a.severity,
    title: a.title,
    range: a.vulnerable_versions,
    fixed: a.patched_versions && a.patched_versions !== '<0.0.0' ? a.patched_versions : null,
    url: a.url,
  }));
  const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  advisories.sort((x, y) => (order[x.severity] ?? 9) - (order[y.severity] ?? 9));
  return {
    ok: true,
    totalDeps: data.metadata?.totalDependencies ?? null,
    counts: {
      critical: counts.critical || 0,
      high: counts.high || 0,
      moderate: counts.moderate || 0,
      low: counts.low || 0,
      info: counts.info || 0,
    },
    advisories,
  };
}
