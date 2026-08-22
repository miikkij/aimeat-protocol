/**
 * Make ast-grep's SARIF acceptable to GitHub code scanning.
 *
 * ast-grep emits a document whose top-level `version` is its OWN version string and carries no
 * `$schema`; GitHub's upload-sarif requires SARIF `version: "2.1.0"` and the schema URI. This
 * rewrites those two fields in place and leaves the results untouched.
 *
 * Usage: node security/semantic-audit/normalize-sarif.mjs <file.sarif>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: normalize-sarif.mjs <file.sarif>');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(path, 'utf8'));
doc.version = '2.1.0';
doc['$schema'] = 'https://json.schemastore.org/sarif-2.1.0.json';
for (const run of doc.runs ?? []) {
  run.tool ??= { driver: { name: 'ast-grep' } };
  run.tool.driver ??= { name: 'ast-grep' };
  run.tool.driver.name ||= 'ast-grep';
}
writeFileSync(path, JSON.stringify(doc, null, 2));
const n = (doc.runs?.[0]?.results ?? []).length;
console.log(`normalized ${path}: SARIF 2.1.0, ${n} result(s)`);
