/**
 * @file app-member-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decisions of the app member roster that read no storage, kept apart so a unit
 *   test can hold each one without a node: who manages the roster, which roles a manager may not
 *   touch, the shape of a role name, the 7-day wait after a decline, the role a one-click approval
 *   offers, the search and paging of the roster lists, and the member rows of the app audit log.
 *
 *   The routes (routes/app-members.ts, routes/app-members-extra.ts) and the services
 *   (services/app-member-approve.ts, services/app-member-roster.ts) call these; nothing here
 *   touches a request, a response or storage.
 * @structure ROLE_RE · roleShapeError · REASK_WAIT_MS · reaskRetryAt · canManageRoster ·
 *   isManagerRole · suggestRole · parseRosterPaging · matchesQuery · pageRows ·
 *   MEMBER_AUDIT_ACTIONS · memberAuditRows
 * @usage if (!canManageRoster(plan, isOwner, callerMember)) return res.status(403)...
 * @version-history
 *   v1.1.0 — 2026-10-05 — sameSet, for the plan route's rule that the app's own token may not change
 *     who pays or who manages (secaudit 2026-10, APP-1). normalizeAccess is in app-members.ts, which
 *     reads the stored plan; here it closed an import cycle through app-audit.ts.
 *   v1.0.0 — 2026-10-01 — Initial: display names, approve by email, paging, managers, audit and the
 *     decline wait on the member roster (IAM round 2, items A1-A5 and B1-B4).
 */
import type { AppAuditEntry } from './app-audit.js';

/**
 * A role name is the app's own word, so the node does not judge its meaning, only its shape. `owner`
 * and `*` are refused: the browser library reads `owner` as the app's owner and `*` as every
 * capability, so a member holding either would be shown, and could reach, what only the owner may.
 */
/** Whether two lists of names hold the same names, order and repeats aside. */
export function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  const sa = new Set(a.map(String)), sb = new Set(b.map(String));
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

export const ROLE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
export const RESERVED_ROLES = new Set(['owner']);

/** The refusal text for a role of the wrong shape, or null when the shape is right. */
export function roleShapeError(role: string): string | null {
  if (ROLE_RE.test(role) && !RESERVED_ROLES.has(role.toLowerCase())) return null;
  return 'role must start with a letter and hold only letters, digits, ".", "_" or "-", at most 40 characters. '
    + '"owner" and "*" are not roles: the owner already reaches everything.';
}

/** How long a declined person waits before they may ask again. */
export const REASK_WAIT_MS = 7 * 86_400_000;

/**
 * When a person whose ask was declined may ask again, or null when they may ask now. Counts from the
 * decline (`decidedAt`); a declined ask stored before that field existed counts from when it was made.
 */
export function reaskRetryAt(
  request: { state: string; at?: string; decidedAt?: string } | null, now: Date = new Date(),
): string | null {
  if (!request || request.state !== 'declined') return null;
  const from = Date.parse(request.decidedAt ?? request.at ?? '');
  if (!Number.isFinite(from)) return null;
  const retry = from + REASK_WAIT_MS;
  return retry > now.getTime() ? new Date(retry).toISOString() : null;
}

/** Is this role one whose holders manage the roster? */
export function isManagerRole(plan: { manageRoles?: string[] } | null, role: string | null | undefined): boolean {
  return !!role && !!plan?.manageRoles?.includes(role);
}

/**
 * May this caller manage the roster: the owner, or a live member whose role the plan lists in
 * `manageRoles`. `member` is the caller's LIVE row (getMember), so a lapsed manager manages nothing.
 */
export function canManageRoster(
  plan: { manageRoles?: string[] } | null, isOwner: boolean, member: { role: string } | null,
): boolean {
  return isOwner || (!!member && isManagerRole(plan, member.role));
}

/**
 * The role a one-click approval in the owner's notification offers: the role most members hold in
 * `sample`, leaving out the manager roles, because one click must never make somebody a manager.
 * `member` when the sample holds no other role. The sample is a bounded page of the roster
 * (services/app-member-roster.ts sampleRoles), so the request path reads at most one page.
 */
export function suggestRole(sample: Array<{ role: string }>, manageRoles: string[] = []): string {
  const tally = new Map<string, number>();
  for (const m of sample) {
    if (!m.role || manageRoles.includes(m.role)) continue;
    tally.set(m.role, (tally.get(m.role) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'member';
}

export const ROSTER_PAGE_DEFAULT = 100;
export const ROSTER_PAGE_MAX = 500;

/** The search and paging of GET .../members: `q` (trimmed, lowercased, at most 100 characters), `limit`, `offset`. */
export interface RosterPaging { q: string; limit: number; offset: number }

/**
 * Read `q`, `limit` and `offset` from a query object. A limit that is not a positive whole number
 * reads as the default, one above the maximum as the maximum, and a bad offset as 0, so a page
 * request never fails on its paging.
 */
export function parseRosterPaging(query: Record<string, unknown>): RosterPaging {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const q = String(one(query.q) ?? '').trim().toLowerCase().slice(0, 100);
  const rawLimit = Number.parseInt(String(one(query.limit) ?? ''), 10);
  const rawOffset = Number.parseInt(String(one(query.offset) ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, ROSTER_PAGE_MAX) : ROSTER_PAGE_DEFAULT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { q, limit, offset };
}

/** Does a row match the search: `q` inside any of the given texts, case-insensitive. An empty `q` matches all. */
export function matchesQuery(q: string, ...texts: Array<string | null | undefined>): boolean {
  if (!q) return true;
  return texts.some(t => typeof t === 'string' && t.toLowerCase().includes(q));
}

/** One page of a list, and how many rows the whole list holds. */
export function pageRows<T>(rows: T[], paging: { limit: number; offset: number }): { items: T[]; total: number } {
  return { items: rows.slice(paging.offset, paging.offset + paging.limit), total: rows.length };
}

/** The audit actions that are about the roster. GET .../members/audit shows these and no others. */
export const MEMBER_AUDIT_ACTIONS = [
  'member.approved', 'member.role_changed', 'member.removed', 'request.declined', 'visitor.dismissed',
  'invite.sent', 'invite.cancelled', 'plan.changed', 'roster.swept',
] as const;
export type MemberAuditAction = typeof MEMBER_AUDIT_ACTIONS[number];

/** One row of GET .../members/audit. */
export interface MemberAuditRow {
  at: string;
  /** The principal that did it, as resolveIdentity named it (a GHII or an agent's GAII). */
  by: string;
  action: MemberAuditAction;
  /** The member, asker or visitor the act was about; null for an invitation, the plan and the sweep. */
  account: string | null;
  from?: string | null;
  to?: string | null;
  /** The rest of the entry's detail: an invitation id, a count, how a membership began. */
  detail?: Record<string, string | number | boolean | null>;
}

/**
 * The roster rows of an app's audit log, newest first: only the member actions, only those before
 * `before` (an ISO time) when it is given, at most `limit` (1 to 500, default 50). `total` counts the
 * member rows in the whole log, and `nextBefore` is the `before` that reads the next page.
 */
export function memberAuditRows(
  entries: AppAuditEntry[], opts: { limit?: unknown; before?: unknown } = {},
): { entries: MemberAuditRow[]; total: number; nextBefore: string | null } {
  const actions = new Set<string>(MEMBER_AUDIT_ACTIONS);
  const all = entries.filter(e => actions.has(e.action));
  const rawLimit = Number.parseInt(String(opts.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
  const before = typeof opts.before === 'string' && Number.isFinite(Date.parse(opts.before)) ? opts.before : null;
  const newest = [...all].reverse().filter(e => !before || e.at < before);
  const page = newest.slice(0, limit);
  const rows = page.map(e => {
    const { account, from, to, ...rest } = (e.detail ?? {}) as Record<string, string | number | boolean | null>;
    return {
      at: e.at, by: e.by, action: e.action as MemberAuditAction,
      account: typeof account === 'string' ? account : null,
      ...(from !== undefined ? { from: from === null ? null : String(from) } : {}),
      ...(to !== undefined ? { to: to === null ? null : String(to) } : {}),
      ...(Object.keys(rest).length ? { detail: rest } : {}),
    };
  });
  return { entries: rows, total: all.length, nextBefore: newest.length > limit ? (page[page.length - 1]?.at ?? null) : null };
}
