/**
 * @file src/services/consent-audit-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The consent audit trail grouped the way a person reads it: who tried what, how many
 *   times, first and last. On aimeat.io on 2026-09-04 the trail held 5 081 rows in 90 days and every
 *   one of them was a denied read; 4 880 were one shape (a member's app asking every workspace's
 *   manifest and being refused the ones the member has no grant to), and 2 424 of those were one
 *   person and one organism. Rendered row by row that is a 169 534 px page; grouped it is 28 rows.
 *   A group is one accessor × one target family × one outcome, where the family of an organism key
 *   is the organism plus the tail after the workspace id (so the manifests of three workspaces are
 *   one group with three keys), and any other key is its own family. Pure functions, no I/O.
 * @structure targetOf(key) · groupConsentAudit(entries) · organismIdsIn(consents, entries)
 * @usage const groups = groupConsentAudit(entries);
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Tietolompakko-sivu", direction A).
 */

/** The audit row shape both the storage and the pending buffer produce. */
export interface AuditRowLike {
  id?: string;
  accessorGaii: string;
  memoryKey: string;
  action: string;
  timestamp: string;
  allowed: boolean;
}

export interface AuditTarget {
  /** 'ws' = one workspace of an organism, 'org' = an organism key outside a workspace, 'key' = anything else. */
  kind: 'ws' | 'org' | 'key';
  organism_id?: string;
  workspace_id?: string;
  /** What follows the organism (or workspace) id: 'meta.manifest', 'shared.public.roadmap.latest', … */
  rest?: string;
  key?: string;
}

export interface AuditGroup {
  accessor_gaii: string;
  target: AuditTarget;
  action: string;
  allowed: boolean;
  count: number;
  first: string;
  last: string;
  /** The distinct keys in the group, newest first, at most KEYS_PER_GROUP. */
  keys: string[];
  key_count: number;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WS_KEY = new RegExp(`^organism\\.(${UUID})\\.w\\.([A-Za-z0-9_-]+)\\.(.+)$`);
const ORG_KEY = new RegExp(`^organism\\.(${UUID})(?:\\.(.+))?$`);
const KEYS_PER_GROUP = 20;

/** Where a memory key points: a workspace, an organism, or a plain key. */
export function targetOf(key: string): AuditTarget {
  const k = String(key || '');
  const ws = WS_KEY.exec(k);
  if (ws) return { kind: 'ws', organism_id: ws[1], workspace_id: ws[2], rest: ws[3] };
  const org = ORG_KEY.exec(k);
  if (org) return { kind: 'org', organism_id: org[1], rest: org[2] ?? '' };
  return { kind: 'key', key: k };
}

/** The family a target groups under: an organism plus the tail after the workspace id, or the key itself. */
function familyOf(t: AuditTarget): string {
  if (t.kind === 'key') return `k|${t.key}`;
  return `o|${t.organism_id}|${t.rest}`;
}

/**
 * Group the rows by accessor × target family × action × outcome, biggest group first. The rows may
 * arrive in any order; first/last are computed, and the keys are listed newest first.
 */
export function groupConsentAudit(entries: AuditRowLike[]): AuditGroup[] {
  const groups = new Map<string, AuditGroup & { seen: Map<string, string> }>();
  for (const e of entries) {
    const t = targetOf(e.memoryKey);
    const id = `${e.accessorGaii}|${familyOf(t)}|${e.action}|${e.allowed ? 1 : 0}`;
    let g = groups.get(id);
    if (!g) {
      const target: AuditTarget = t.kind === 'key' ? { kind: 'key', key: t.key } : { kind: t.kind, organism_id: t.organism_id, rest: t.rest };
      g = { accessor_gaii: e.accessorGaii, target, action: e.action, allowed: !!e.allowed, count: 0, first: e.timestamp, last: e.timestamp, keys: [], key_count: 0, seen: new Map() };
      groups.set(id, g);
    }
    g.count += 1;
    if (e.timestamp < g.first) g.first = e.timestamp;
    if (e.timestamp > g.last) g.last = e.timestamp;
    const prev = g.seen.get(e.memoryKey);
    if (!prev || e.timestamp > prev) g.seen.set(e.memoryKey, e.timestamp);
  }
  return [...groups.values()]
    .map(({ seen, ...g }) => {
      const keys = [...seen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([k]) => k);
      return { ...g, keys: keys.slice(0, KEYS_PER_GROUP), key_count: keys.length };
    })
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

/** Every organism id a consent pattern, a consent recipient or an audit key points at. */
export function organismIdsIn(patterns: string[], keys: string[]): string[] {
  const ids = new Set<string>();
  for (const p of [...patterns, ...keys]) {
    const t = targetOf(p);
    if (t.organism_id) ids.add(t.organism_id);
  }
  return [...ids];
}
