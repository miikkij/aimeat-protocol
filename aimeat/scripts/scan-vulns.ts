/**
 * @file scan-vulns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Queries OSV.dev for every component this node ships — the npm tree AND the browser
 *   libraries it serves — and prints what is known about each hit.
 *
 *   WHY NOT JUST `pnpm audit`. Two gaps, and the second is the one that matters here. `pnpm audit`
 *   reads GitHub's npm advisory database only, so an advisory that lands in OSV, the Go database or
 *   a distribution tracker first is invisible to it for as long as it takes to be mirrored. And it
 *   walks the lockfile, which means the twenty-three libraries under public/lib/ — Phaser, PixiJS,
 *   PDF.js, DuckDB, p5, the ffmpeg build — are not scanned by anything at all. They are committed
 *   files with no package.json above them, they run in the browsers of everyone who opens an app on
 *   this node, and until this script they were the least-watched code here. `licenses.json` gives
 *   each one a real package URL, which is exactly what a vulnerability feed matches on.
 *
 *   OSV is the aggregator: GitHub advisories, the npm registry, CVE records and about twenty other
 *   sources in one query, and no account or token to run it. `pnpm audit` still runs beside this,
 *   because two databases disagreeing is information.
 * @structure queriesFor() → one OSV query per component version; batch() → the querybatch endpoint
 *   in chunks; detailsFor() → the full record for a hit; main() → report, exit non-zero on a hit
 * @usage
 *   pnpm scan:vulns            # everything that ships: npm production tree + served libraries
 *   pnpm scan:vulns -- --dev   # add the build toolchain (it runs on the machine that cuts releases)
 *   pnpm scan:vulns -- --json  # machine-readable, for CI
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: OSV over both populations, the served libraries included.
 */
import { npmComponents, vendoredComponents, type Component } from './lib/license-inventory.js';

const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns/';
const CHUNK = 100;

interface Query { package: { name: string; ecosystem: string }; version: string }
interface Target { query: Query; component: Component }

/** `pkg:npm/%40scope/name@1.2.3` → the name and version OSV wants. */
function fromPurl(purl: string): { name: string; version: string } | null {
  const match = /^pkg:npm\/(.+)@([^@]+)$/.exec(purl);
  if (match === null) return null;
  return { name: decodeURIComponent(match[1]), version: match[2] };
}

/**
 * One query per component VERSION. A pnpm tree can hold two versions of the same package, and only
 * one of them may be affected, so collapsing them would answer the wrong question.
 */
function queriesFor(components: Component[]): Target[] {
  const out: Target[] = [];
  for (const c of components) {
    if (c.origin === 'npm') {
      for (const version of c.version.split(',').map(v => v.trim()).filter(Boolean)) {
        out.push({ query: { package: { name: c.name, ecosystem: 'npm' }, version }, component: c });
      }
      continue;
    }
    const parsed = c.purl === undefined ? null : fromPurl(c.purl);
    if (parsed === null) continue;
    out.push({
      query: { package: { name: parsed.name, ecosystem: 'npm' }, version: parsed.version },
      component: c,
    });
  }
  return out;
}

interface BatchResult { vulns?: Array<{ id: string }> }

async function batch(targets: Target[]): Promise<Map<string, Set<string>>> {
  const byComponent = new Map<string, Set<string>>();
  for (let at = 0; at < targets.length; at += CHUNK) {
    const slice = targets.slice(at, at + CHUNK);
    const res = await fetch(OSV_BATCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: slice.map(t => t.query) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch → HTTP ${res.status}`);
    const body = await res.json() as { results?: BatchResult[] };
    const results = body.results ?? [];
    for (let i = 0; i < slice.length; i++) {
      const ids = (results[i]?.vulns ?? []).map(v => v.id);
      if (ids.length === 0) continue;
      const key = `${slice[i].query.package.name}@${slice[i].query.version}`;
      const set = byComponent.get(key) ?? new Set<string>();
      for (const id of ids) set.add(id);
      byComponent.set(key, set);
    }
  }
  return byComponent;
}

interface Vuln {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
}

async function detailsFor(id: string): Promise<Vuln> {
  const res = await fetch(`${OSV_VULN}${id}`);
  if (!res.ok) return { id, summary: `(could not read ${id}: HTTP ${res.status})` };
  return await res.json() as Vuln;
}

/** The first fixed version OSV names, which is the thing a person actually needs. */
function fixedIn(vuln: Vuln): string {
  const fixes = new Set<string>();
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixes.add(event.fixed);
      }
    }
  }
  return fixes.size === 0 ? 'no fixed version published' : [...fixes].join(', ');
}

function severityOf(vuln: Vuln): string {
  return vuln.database_specific?.severity ?? vuln.severity?.[0]?.score ?? 'unrated';
}

async function main(): Promise<void> {
  const withDev = process.argv.includes('--dev');
  const asJson = process.argv.includes('--json');

  const served = vendoredComponents().filter(c => c.id !== 'aimeat');
  const npm = npmComponents({ dev: withDev });
  const targets = queriesFor([...npm, ...served]);

  if (!asJson) {
    console.log(`Scanning ${targets.length} component versions against OSV.dev`);
    console.log(`  ${npm.length} npm ${withDev ? 'dependencies (production + build toolchain)' : 'production dependencies'}`);
    console.log(`  ${served.filter(c => c.purl?.startsWith('pkg:npm/')).length} served browser libraries — the half pnpm audit never sees`);
  }

  const hits = await batch(targets);
  if (hits.size === 0) {
    if (asJson) console.log(JSON.stringify({ scanned: targets.length, findings: [] }, null, 2));
    else console.log(`\n✓ OSV knows of nothing affecting any of the ${targets.length} component versions.`);
    return;
  }

  const findings: Array<{ component: string; where: string; id: string; severity: string; summary: string; fixed: string }> = [];
  for (const [key, ids] of hits) {
    const target = targets.find(t => `${t.query.package.name}@${t.query.version}` === key);
    for (const id of ids) {
      const vuln = await detailsFor(id);
      findings.push({
        component: key,
        where: target?.component.origin === 'vendored' ? 'served to browsers (public/lib)' : 'npm dependency',
        id,
        severity: severityOf(vuln),
        summary: vuln.summary ?? '(no summary)',
        fixed: fixedIn(vuln),
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ scanned: targets.length, findings }, null, 2));
  } else {
    console.log(`\n✗ ${findings.length} finding(s) across ${hits.size} component version(s):\n`);
    for (const f of findings) {
      console.log(`  ${f.component}  [${f.where}]`);
      console.log(`    ${f.id}  severity ${f.severity}`);
      console.log(`    ${f.summary}`);
      console.log(`    fixed in: ${f.fixed}\n`);
    }
    console.log('Cross-check with `pnpm audit`: the two databases do not always agree, and a');
    console.log('disagreement is worth reading rather than averaging.');
  }
  process.exitCode = 1;
}

main().catch(err => {
  console.error(`scan-vulns: ${(err as Error).message}`);
  process.exit(2);
});
