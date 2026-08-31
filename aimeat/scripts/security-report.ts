/**
 * @file security-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One command that answers "is this safe to ship, and what is inside it" — the
 *   question a release asks itself and the question a company's security review asks you. It runs
 *   both vulnerability databases, the licence gate, the outdated-and-deprecated list and the SBOM,
 *   and writes a single dated report plus the machine-readable files a reviewer feeds to their own
 *   scanner.
 *
 *   WHY ONE COMMAND. The pieces existed and nobody would run five of them in order before a
 *   release. Worse, four of the five answer about the npm tree only, so running them all and
 *   finding nothing would have been a confident wrong answer: on 2026-08-31 that combination
 *   reported zero while a HIGH-severity arbitrary code execution sat in the PDF reader this node
 *   hands to every browser.
 *
 *   WHAT IT WRITES, all at the repository root and all gitignored, because a report is a snapshot
 *   of a moment and the moment passes:
 *     security-report.md   — the readable one, for a person
 *     sbom.cdx.json        — CycloneDX 1.6, for Trivy / Grype / Dependency-Track
 *     security-report.json — the same findings as data, for a pipeline
 * @structure section builders (vulnerabilities, licences, freshness), then main() → run, render,
 *   write, and exit non-zero when something needs a person
 * @usage
 *   pnpm audit:security              # write the three files
 *   pnpm audit:security -- --dev     # include the build toolchain in the scan
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: both scanners, the licence gate, deprecations and the SBOM.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIMEAT_ROOT, REPO_ROOT, npmComponents, vendoredComponents } from './lib/license-inventory.js';
import { scanComponents, type Finding } from './lib/osv-scan.js';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'MEDIUM', 'LOW'];

/** Run a pnpm script and return its output, treating a non-zero exit as data rather than a crash. */
function run(command: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execSync(command, { cwd: AIMEAT_ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message };
  }
}

interface AuditMeta { vulnerabilities?: Record<string, number>; totalDependencies?: number }

/** `pnpm audit --json`: GitHub's npm advisory database, npm tree only. */
function pnpmAudit(): { counts: Record<string, number>; total: number; raw: string } {
  const { out } = run('pnpm audit --json');
  try {
    const parsed = JSON.parse(out) as { metadata?: AuditMeta };
    return {
      counts: parsed.metadata?.vulnerabilities ?? {},
      total: parsed.metadata?.totalDependencies ?? 0,
      raw: out,
    };
  } catch {
    return { counts: {}, total: 0, raw: out.slice(0, 2000) };
  }
}

interface OutdatedEntry { current?: string; latest?: string; isDeprecated?: boolean; dependencyType?: string }

function outdated(): Record<string, OutdatedEntry> {
  const { out } = run('pnpm outdated --format json');
  try {
    return JSON.parse(out) as Record<string, OutdatedEntry>;
  } catch {
    return {};
  }
}

/**
 * Why each deprecated package was deprecated, straight from the registry. `execSync` rather than
 * `execFileSync(..., { shell: true })`, which Node deprecated in DEP0190 because arguments are
 * concatenated rather than escaped. The name and version come from `pnpm outdated`'s own output,
 * but the safe call is the same length as the unsafe one.
 */
function deprecationReason(name: string, version: string): string {
  if (!/^[@a-z0-9._/-]+$/i.test(name) || !/^[a-z0-9.+-]+$/i.test(version)) {
    return '(deprecated; package name not in a shape worth shelling out for)';
  }
  const { ok, out } = run(`npm view ${name}@${version} deprecated`);
  return ok && out.trim() ? out.trim() : '(deprecated, reason could not be read)';
}

function bySeverity(a: Finding, b: Finding): number {
  const rank = (s: string) => {
    const at = SEVERITY_ORDER.indexOf(s.toUpperCase());
    return at === -1 ? SEVERITY_ORDER.length : at;
  };
  return rank(a.severity) - rank(b.severity);
}

function main(): void {
  const withDev = process.argv.includes('--dev');
  const stamp = new Date().toISOString().slice(0, 10);

  const served = vendoredComponents().filter(c => c.id !== 'aimeat');
  const npm = npmComponents({ dev: withDev });
  const version = (JSON.parse(run('node -p "JSON.stringify(require(\'./package.json\'))"').out) as { version: string }).version;

  console.log('Running the licence gate…');
  const licences = run('pnpm -s check:licenses');

  console.log('Running pnpm audit (npm advisory database)…');
  const audit = pnpmAudit();

  console.log('Running the OSV scan (npm tree + served browser libraries)…');
  void (async () => {
    const scan = await scanComponents([...npm, ...served]);

    console.log('Reading the outdated and deprecated list…');
    const stale = outdated();
    const deprecated = Object.entries(stale).filter(([, v]) => v.isDeprecated === true);
    const majors = Object.entries(stale).filter(([, v]) =>
      v.isDeprecated !== true && (v.current ?? '').split('.')[0] !== (v.latest ?? '').split('.')[0]);
    const minors = Object.entries(stale).filter(([, v]) =>
      v.isDeprecated !== true && (v.current ?? '').split('.')[0] === (v.latest ?? '').split('.')[0]
      && v.current !== v.latest);

    console.log('Writing the SBOM…');
    run('pnpm -s sbom');

    const auditTotal = Object.values(audit.counts).reduce((a, b) => a + b, 0);
    const md: string[] = [];
    md.push(`# AIMEAT security report`);
    md.push('');
    md.push(`Version ${version} · ${stamp}`);
    md.push('');
    md.push('Generated by `pnpm audit:security`. Alongside this file: `sbom.cdx.json` (CycloneDX 1.6,');
    md.push('feed it to Trivy, Grype or Dependency-Track) and `security-report.json` (the findings as data).');
    md.push('');

    md.push('## Verdict');
    md.push('');
    const needsPerson = scan.findings.length > 0 || auditTotal > 0 || !licences.ok;
    md.push(needsPerson
      ? '**Something needs a person.** See the sections below.'
      : '**Nothing outstanding.** No known vulnerability in either database, licences accounted for.');
    md.push('');
    md.push(`| Check | Result |`);
    md.push('|---|---|');
    md.push(`| OSV.dev — npm tree **and** browser libraries | ${scan.findings.length === 0 ? `clean, ${scan.scanned} component versions` : `**${scan.findings.length} finding(s)**`} |`);
    md.push(`| pnpm audit — npm advisory database | ${auditTotal === 0 ? `clean, ${audit.total} packages` : `**${auditTotal} advisory(ies)**`} |`);
    md.push(`| Licences allowed, every served file claimed | ${licences.ok ? 'pass' : '**fail**'} |`);
    md.push(`| Deprecated upstream | ${deprecated.length} |`);
    md.push(`| Behind latest (major / minor-patch) | ${majors.length} / ${minors.length} |`);
    md.push('');

    md.push('## What was scanned');
    md.push('');
    md.push(`- **${npm.length}** npm ${withDev ? 'dependencies, production and build toolchain' : 'production dependencies'}`);
    md.push(`- **${served.length}** libraries this node serves to browsers from \`/lib/\`, which no manifest-reading tool can see. They have no package.json above them; \`public/lib/licenses.json\` gives each one a package URL so a vulnerability feed can match it.`);
    md.push('');

    md.push('## Vulnerabilities');
    md.push('');
    if (scan.findings.length === 0 && auditTotal === 0) {
      md.push('Neither database knows of anything affecting this tree.');
    } else {
      if (auditTotal > 0) {
        md.push(`\`pnpm audit\`: ${Object.entries(audit.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')}. Run \`pnpm audit\` for the detail.`);
        md.push('');
      }
      if (scan.findings.length > 0) {
        md.push('| Component | Where | Advisory | Severity | Fixed in |');
        md.push('|---|---|---|---|---|');
        for (const f of [...scan.findings].sort(bySeverity)) {
          md.push(`| \`${f.component}\` | ${f.where} | ${f.id} | ${f.severity} | ${f.fixed} |`);
        }
        md.push('');
        for (const f of [...scan.findings].sort(bySeverity)) {
          md.push(`- **${f.id}** (${f.component}): ${f.summary}`);
        }
      }
    }
    md.push('');

    md.push('## Licences');
    md.push('');
    md.push('```text');
    md.push(licences.out.trim());
    md.push('```');
    md.push('');
    md.push('The full inventory with every copyright holder and licence text is `THIRD-PARTY-NOTICES.md`.');
    md.push('');

    md.push('## Freshness');
    md.push('');
    if (deprecated.length > 0) {
      md.push('### Deprecated upstream');
      md.push('');
      md.push('| Package | Version | What upstream says |');
      md.push('|---|---|---|');
      for (const [name, v] of deprecated) {
        md.push(`| \`${name}\` | ${v.current ?? '?'} | ${deprecationReason(name, v.current ?? '').replace(/\|/g, '\\|')} |`);
      }
      md.push('');
    }
    if (majors.length > 0) {
      md.push('### A major version behind — each one is a decision, not a bump');
      md.push('');
      for (const [name, v] of majors) md.push(`- \`${name}\` ${v.current} → ${v.latest} (${v.dependencyType === 'dependencies' ? 'production' : 'toolchain'})`);
      md.push('');
    }
    if (minors.length > 0) {
      md.push('### Minor or patch behind — `pnpm update` moves these');
      md.push('');
      for (const [name, v] of minors) md.push(`- \`${name}\` ${v.current} → ${v.latest}`);
      md.push('');
    }

    const mdFile = join(REPO_ROOT, 'security-report.md');
    const jsonFile = join(REPO_ROOT, 'security-report.json');
    writeFileSync(mdFile, md.join('\n') + '\n', 'utf-8');
    writeFileSync(jsonFile, JSON.stringify({
      version, date: stamp, scanned: scan.scanned, osv: scan.findings,
      pnpmAudit: audit.counts, licencesPass: licences.ok,
      deprecated: deprecated.map(([name, v]) => ({ name, version: v.current })),
      major: majors.map(([name, v]) => ({ name, current: v.current, latest: v.latest })),
      minor: minors.map(([name, v]) => ({ name, current: v.current, latest: v.latest })),
    }, null, 2) + '\n', 'utf-8');

    console.log(`\n✓ ${mdFile}`);
    console.log(`✓ ${jsonFile}`);
    console.log(`✓ ${join(REPO_ROOT, 'sbom.cdx.json')}`);
    console.log(needsPerson
      ? '\n✗ Something needs a person — read the Verdict section.'
      : '\n✓ Nothing outstanding.');
    if (needsPerson) process.exitCode = 1;
  })().catch(err => {
    console.error(`security-report: ${(err as Error).message}`);
    process.exit(2);
  });
}

main();
