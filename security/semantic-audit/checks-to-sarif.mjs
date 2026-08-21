/**
 * Run the existing audit-gate ratchets and the MCP surface-parity checks, and turn each result into
 * a SARIF finding, so all of the audit signals land on the same GitHub Security tab as the ast-grep
 * rules — one pane for "what is checked and what is currently regressed", not twelve log tails.
 *
 * These checks already gate CI in ci.yml (they fail the build on a NEW violation). This adapter does
 * not replace that; it makes their state VISIBLE and tracked alongside the semantic rules. A failing
 * check becomes an error-level result; a passing one is recorded as a note so the tool's coverage is
 * legible even when everything is green.
 *
 * Usage (from aimeat/):  node ../security/semantic-audit/checks-to-sarif.mjs > audit-gates.sarif
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Each entry: the pnpm script, and the invariant / concern it guards (shown in the alert).
const CHECKS = [
  ['check:route-scopes', 'inv 4 — every mutating route has an explicit scope/role gate'],
  ['check:denial-coverage', 'inv 9 — cross-owner / cross-scope denial tests exist'],
  ['check:outbound-fetch', 'inv 3 — non-constant outbound HTTP goes through safeFetch'],
  ['check:trusted-keys', 'inv 2 — server-read keys are unreachable by scoped principals'],
  ['check:storage-parity', 'new data types/fields exist on both storage backends'],
  ['check:ext-entrypoints', 'extension entrypoints are declared, not inferred'],
  ['check:shared-impl', 'one capability, one implementation — no tool writes storage directly'],
  ['check:sse-parity', 'the SSE surface matches its REST counterpart'],
  ['check:copied-logic', 'a security decision is not written out twice'],
  ['check:liaison-surface', 'the pypi liaison package matches the node schema'],
  ['check:mcp-tools', 'MCP tool NAMES match across node / connector / CLI surfaces'],
  ['check:mcp-schemas', 'MCP tool PARAMETERS match across the surfaces'],
];

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
  results.push({
    ruleId: script,
    level: ok ? 'note' : 'error',
    message: {
      text: ok
        ? `${script} passes — ${concern}`
        : `${script} REGRESSED — ${concern}. Run \`pnpm ${script}\` locally. ${detail}`,
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
