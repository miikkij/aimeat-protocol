/**
 * @file scripts/lib/osv-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OSV.dev query, shared by the two tools that need it: `pnpm scan:vulns`, which
 *   prints it, and `pnpm audit:security`, which files it in a report. One implementation, because
 *   this repo gates on the same decision being written out twice (check:copied-logic) and because
 *   the version-splitting rule below is the kind of detail that drifts when it is copied.
 *
 *   WHAT IT SCANS. Both populations: the npm tree, and the browser libraries under public/lib/ that
 *   have no manifest above them and that no dependency tool can see. The second half is the reason
 *   this exists — its first run found a HIGH-severity arbitrary code execution in PDF.js while
 *   `pnpm audit` reported zero across 730 packages.
 * @structure queriesFor() → one query per component VERSION; scanComponents() → batch, then the
 *   full record for each hit
 * @usage  imported by scan-vulns.ts and security-report.ts
 * @version-history
 *   v1.0.0 — 2026-08-31 — Extracted from scan-vulns.ts when the security report needed the same query.
 */
import type { Component } from './license-inventory.js';

const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns/';
const CHUNK = 100;

export interface Finding {
  /** `name@version`, the thing to upgrade. */
  component: string;
  /** npm dependency, or a library served straight to browsers. */
  where: 'npm dependency' | 'served to browsers (public/lib)';
  id: string;
  severity: string;
  summary: string;
  /** The versions OSV says carry the fix, or a note that none is published. */
  fixed: string;
}

interface Query { package: { name: string; ecosystem: string }; version: string }
interface Target { query: Query; component: Component }

/** `pkg:npm/%40scope/name@1.2.3` → the name and version OSV wants. */
function fromPurl(purl: string): { name: string; version: string } | null {
  const match = /^pkg:npm\/(.+)@([^@]+)$/.exec(purl);
  if (match === null) return null;
  return { name: decodeURIComponent(match[1]), version: match[2] };
}

/**
 * One query per component VERSION. A pnpm tree can hold two versions of the same package and only
 * one of them may be affected, so collapsing them would answer the wrong question.
 */
export function queriesFor(components: Component[]): Target[] {
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

interface Vuln {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
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

export interface ScanResult { scanned: number; findings: Finding[] }

export async function scanComponents(components: Component[]): Promise<ScanResult> {
  const targets = queriesFor(components);
  const hits = new Map<string, Set<string>>();

  for (let at = 0; at < targets.length; at += CHUNK) {
    const slice = targets.slice(at, at + CHUNK);
    const res = await fetch(OSV_BATCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: slice.map(t => t.query) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch → HTTP ${res.status}`);
    const body = await res.json() as { results?: Array<{ vulns?: Array<{ id: string }> }> };
    const results = body.results ?? [];
    for (let i = 0; i < slice.length; i++) {
      const ids = (results[i]?.vulns ?? []).map(v => v.id);
      if (ids.length === 0) continue;
      const key = `${slice[i].query.package.name}@${slice[i].query.version}`;
      const set = hits.get(key) ?? new Set<string>();
      for (const id of ids) set.add(id);
      hits.set(key, set);
    }
  }

  const findings: Finding[] = [];
  for (const [key, ids] of hits) {
    const target = targets.find(t => `${t.query.package.name}@${t.query.version}` === key);
    for (const id of ids) {
      const res = await fetch(`${OSV_VULN}${id}`);
      const vuln: Vuln = res.ok
        ? await res.json() as Vuln
        : { id, summary: `(could not read ${id}: HTTP ${res.status})` };
      findings.push({
        component: key,
        where: target?.component.origin === 'vendored'
          ? 'served to browsers (public/lib)'
          : 'npm dependency',
        id,
        severity: vuln.database_specific?.severity ?? vuln.severity?.[0]?.score ?? 'unrated',
        summary: vuln.summary ?? '(no summary)',
        fixed: fixedIn(vuln),
      });
    }
  }

  return { scanned: targets.length, findings };
}
