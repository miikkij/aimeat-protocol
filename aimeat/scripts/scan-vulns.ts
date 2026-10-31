/**
 * @file scan-vulns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Queries OSV.dev for every component this node ships — the npm tree AND the browser
 *   libraries it serves — and prints what is known about each hit.
 *
 *   WHY NOT JUST `pnpm audit`. Two gaps, and the second is the one that matters here. `pnpm audit`
 *   reads GitHub's npm advisory database only, so an advisory that lands in OSV, a CVE record or a
 *   distribution tracker first is invisible to it until it is mirrored. And it walks the lockfile,
 *   which means the twenty-three libraries under public/lib/ — Phaser, PixiJS, PDF.js, DuckDB, p5,
 *   the ffmpeg build — are not scanned by anything at all. They have no package.json above them:
 *   every dependency tool in the ecosystem starts from a manifest and walks down, and these are
 *   files in a directory. `licenses.json` gives each one a real package URL, which is exactly what
 *   a vulnerability feed matches on, so the licence work is what made this scan possible.
 *
 *   `pnpm audit` still runs beside this. Two databases disagreeing is information.
 * @structure the query lives in scripts/lib/osv-scan.ts, shared with `pnpm audit:security`;
 *   this file is the command-line face of it
 * @usage
 *   pnpm scan:vulns            # everything that ships: npm production tree + served libraries
 *   pnpm scan:vulns -- --dev   # add the build toolchain (it runs on the machine that cuts releases)
 *   pnpm scan:vulns -- --json  # machine-readable, for CI
 *
 *   THE ORDER IS THE PATCH ORDER. Each finding is printed with its priority from CISA KEV (used in
 *   attacks) and FIRST EPSS (likely to be used), scripts/lib/exploit-signals.ts, so the exploited one
 *   comes first whatever its severity label says.
 * @version-history
 *   v1.2.0 — 2026-10-31 — Findings in patch order, with KEV and EPSS per finding.
 *   v1.1.0 — 2026-08-31 — Query extracted to scripts/lib/osv-scan.ts so the security report shares it.
 *   v1.0.0 — 2026-08-31 — Initial: OSV over both populations, the served libraries included.
 */
import { npmComponents, vendoredComponents } from './lib/license-inventory.js';
import { scanComponents, type Finding } from './lib/osv-scan.js';
import { fetchSignals, priorityOf, rank } from './lib/exploit-signals.js';

async function main(): Promise<void> {
  const withDev = process.argv.includes('--dev');
  const asJson = process.argv.includes('--json');

  const served = vendoredComponents().filter(c => c.id !== 'aimeat');
  const npm = npmComponents({ dev: withDev });

  if (!asJson) {
    console.log('Scanning against OSV.dev');
    console.log(`  ${npm.length} npm ${withDev ? 'dependencies (production + build toolchain)' : 'production dependencies'}`);
    console.log(`  ${served.filter(c => c.purl?.startsWith('pkg:npm/')).length} served browser libraries — the half pnpm audit never sees`);
  }

  const { scanned, findings } = await scanComponents([...npm, ...served]);
  const signals = await fetchSignals(findings.flatMap(f => f.cves));
  const rankedOf = (f: Finding) => priorityOf(f.cves, signals);
  const ordered = rank(findings, rankedOf);

  if (asJson) {
    console.log(JSON.stringify({
      scanned,
      exploitSignals: { kevCatalog: signals.kevCatalog, epssDate: signals.epssDate, errors: signals.errors },
      findings: ordered.map(f => ({ ...f, ...rankedOf(f) })),
    }, null, 2));
    if (findings.length > 0) process.exitCode = 1;
    return;
  }

  if (findings.length === 0) {
    console.log(`\n✓ OSV knows of nothing affecting any of the ${scanned} component versions.`);
    return;
  }

  const affected = new Set(findings.map(f => f.component));
  console.log(`\n✗ ${findings.length} finding(s) across ${affected.size} component version(s), in the order to patch:\n`);
  for (const f of ordered) {
    const r = rankedOf(f);
    console.log(`  [${r.priority}]  ${f.component}  [${f.where}]`);
    console.log(`    ${f.id}${f.cves.length > 0 ? ` (${f.cves.join(', ')})` : ''}  severity ${f.severity}`);
    console.log(`    ${f.summary}`);
    console.log(`    why this priority: ${r.reason}`);
    console.log(`    fixed in: ${f.fixed}\n`);
  }
  console.log(`Exploitation signals: CISA KEV ${signals.kevCatalog ?? 'NOT READ'}, FIRST EPSS ${signals.epssDate ?? 'NOT READ'}.`);
  for (const e of signals.errors) console.log(`  could not read ${e}`);
  console.log('Cross-check with `pnpm audit`: the two databases do not always agree, and a');
  console.log('disagreement is worth reading rather than averaging.');
  process.exitCode = 1;
}

main().catch(err => {
  console.error(`scan-vulns: ${(err as Error).message}`);
  process.exit(2);
});
