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
 *   The page reads the trail by day (today, yesterday, earlier) and opens one day's groups on demand,
 *   so the buckets carry the counts per accessor and the groups stay on the server until asked.
 * @structure targetOf(key) · groupConsentAudit(entries) · auditWithin(entries, from, to) ·
 *   bucketConsentAudit(entries, todayFrom, yesterdayFrom) · organismIdsIn(consents, entries)
 * @usage const groups = groupConsentAudit(entries);
 * @version-history
 *   v1.1.0 — 2026-11-09 — The day buckets (bucketConsentAudit) and the time window (auditWithin), for
 *     the Data Wallet trail read by day.
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

/** One day bucket of the trail: today, yesterday or earlier, in the reader's own day boundaries. */
export interface AuditBucket {
  id: 'today' | 'yesterday' | 'earlier';
  /** The bucket's bounds, ISO; `from` null on earlier (the window's start), `to` null on today. */
  from: string | null;
  to: string | null;
  count: number;
  denied: number;
  first: string | null;
  last: string | null;
  /** The distinct UTC dates the bucket's rows fall on. */
  day_count: number;
  group_count: number;
  /** The accessors with the most rows, at most WHO_PER_BUCKET; `accessor_total` says how many there are. */
  who: Array<{ accessor_gaii: string; count: number; denied: number }>;
  accessor_total: number;
}

const WHO_PER_BUCKET = 5;
/** Grants and revocations are read off the permissions' own timestamps on the page, never off the trail. */
const isMutation = (action: string) => action === 'grant' || action === 'revoke';

/** The rows whose timestamp lies in [from, to); either bound may be empty. */
export function auditWithin<T extends AuditRowLike>(entries: T[], from?: string | null, to?: string | null): T[] {
  if (!from && !to) return entries;
  return entries.filter(e => (!from || e.timestamp >= from) && (!to || e.timestamp < to));
}

/**
 * The trail in three day buckets, split at the reader's own midnights (`todayFrom`, `yesterdayFrom`,
 * ISO), with the rows and the refusals per accessor. Grant and revoke rows are left out, as on the page.
 */
export function bucketConsentAudit(entries: AuditRowLike[], todayFrom: string, yesterdayFrom: string): AuditBucket[] {
  const shapes: Array<{ id: AuditBucket['id']; from: string | null; to: string | null }> = [
    { id: 'today', from: todayFrom, to: null },
    { id: 'yesterday', from: yesterdayFrom, to: todayFrom },
    { id: 'earlier', from: null, to: yesterdayFrom },
  ];
  return shapes.map(({ id, from, to }) => {
    const rows = auditWithin(entries, from, to).filter(e => !isMutation(e.action));
    const by = new Map<string, { accessor_gaii: string; count: number; denied: number }>();
    const days = new Set<string>();
    let denied = 0;
    let first: string | null = null;
    let last: string | null = null;
    for (const e of rows) {
      const w = by.get(e.accessorGaii) ?? { accessor_gaii: e.accessorGaii, count: 0, denied: 0 };
      w.count += 1;
      if (!e.allowed) { w.denied += 1; denied += 1; }
      by.set(e.accessorGaii, w);
      days.add(e.timestamp.slice(0, 10));
      if (!first || e.timestamp < first) first = e.timestamp;
      if (!last || e.timestamp > last) last = e.timestamp;
    }
    const who = [...by.values()].sort((a, b) => b.count - a.count || a.accessor_gaii.localeCompare(b.accessor_gaii));
    return {
      id, from, to, count: rows.length, denied, first, last, day_count: days.size,
      group_count: groupConsentAudit(rows).length,
      who: who.slice(0, WHO_PER_BUCKET), accessor_total: who.length,
    };
  });
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
