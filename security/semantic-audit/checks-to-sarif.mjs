/**
 * Run the existing audit-gate ratchets and the MCP surface-parity checks, and turn each result into
 * a SARIF finding, so all of the audit signals land on the same GitHub Security tab as the ast-grep
 * rules — one pane for "what is checked and what is currently regressed", not twelve log tails.
 *
 * These checks already gate CI in ci.yml (they fail the build on a NEW violation). This adapter does
 * not replace that; it makes their state VISIBLE and tracked alongside the semantic rules. A failing
 * check becomes an error-level result; a passing one is NOT uploaded (a note still counts as an open
 * alert on the Security tab, so twelve green gates read as "12 open" and bury the real signal —
 * coverage-when-green lives in the local `pnpm audit:report` instead). Historic note: passing gates
 * legible even when everything is green.
 *
 * Usage (from aimeat/):  node ../security/semantic-audit/checks-to-sarif.mjs > audit-gates.sarif
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { AUDIT_CHECKS } from '../../aimeat/scripts/lib/check-registry.mjs';

// Each entry: the pnpm script, and the invariant / concern it guards (shown in the alert).
const CHECKS = AUDIT_CHECKS.map(({ script, label }) => [script, label]);

const results = [];
const rules = [];
for (const [script, concern] of CHECKS) {
  let ok = true;
  let detail = '';
  try {
    execSync(`pnpm ${script}`, { stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    ok = false;
    detail = String(err.stdout || err.message || '').split('\n').slice(-6).join(' ').slice(0, 400);
  }
  rules.push({ id: script, shortDescription: { text: concern } });
  // Only a REGRESSED gate becomes a Security-tab alert. A passing gate is not uploaded: a note-level
  // result still counts as an open alert in GitHub's tally, so twelve always-green gates read as
  // "12 open" on the tab and drown the real signal. Coverage-when-green is legible in the local
  // `pnpm audit:report` (the "12/12 checks green" row) instead; the tab shows only what regressed.
  if (ok) continue;
  results.push({
    ruleId: script,
    level: 'error',
    message: {
      text: `${script} REGRESSED — ${concern}. Run \`pnpm ${script}\` locally. ${detail}`,
    },
    // No source location: these are project-wide gate states, anchored to the config that defines them.
    locations: [{
      physicalLocation: { artifactLocation: { uri: 'aimeat/package.json' }, region: { startLine: 1 } },
    }],
  });
}

const sarif = {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'aimeat-audit-gates', rules } }, results }],
};

const failed = results.filter(r => r.level === 'error').length;
writeFileSync(process.argv[2] || 'audit-gates.sarif', JSON.stringify(sarif, null, 2));
console.error(`audit-gates: ${CHECKS.length} checks, ${failed} regressed`);
