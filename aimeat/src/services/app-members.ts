/**
 * @file app-members.ts
 * @description The roster for an app's OWN members, owned by the node rather than by each app.
 *
 *   Six apps on this node grew their own copy of this and disagreed six ways, but the deciding
 *   reason to move it here is not tidiness. Three of the things a roster must do cannot be done from
 *   an app at all: telling the approved person they were approved (the sandbox notify reaches the
 *   CALLER, so an approval notifies the approver), keeping the list off the public internet (an
 *   `ext:` namespace is world-readable by default and every fork that stored a roster there served
 *   it to anyone who asked), and taking the free access away in the same breath as the role. So the
 *   node keeps WHO is a member and what follows from a change; the extension keeps WHAT a member may
 *   do, because a capability vocabulary is genuinely per-app and a browser can never enforce it.
 *
 *   Storage follows the metered-entitlement pattern: platform-owned records under a synthetic
 *   namespace, written PRIVATE, listed by prefix. No new table, so nothing has to be added to two
 *   storage backends, and the roster cannot be read by the world because it never lives in an app's
 *   own namespace.
 * @structure NS · slugOf/memberKey/requestKey · listMembers/getMember/putMember/removeMember ·
 *   listRequests/putRequest/removeRequest · AppMemberRecord/AppMemberRequest
 * @usage const roster = await listMembers(storage, 'alice/app.html');
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2): the roster becomes a platform capability.
 */
import type { Storage } from '../storage/interface.js';

/** Platform-owned namespaces. Never an `ext:` one: that is the namespace the world can read. */
const NS_MEMBER = 'app-member';
const NS_REQUEST = 'app-member-request';
const NS_PLAN = 'app-member-plan';

/** One approved member of one app. `level` is BBS-ordinal, LOWER is more power, as everywhere else. */
export interface AppMemberRecord {
  appId: string;
  /** Bare account name, lowercased — the PERSON, so their agents are covered by this one row. */
  owner: string;
  role: string;
  level: number | null;
  since: string;
  updatedAt: string;
  /** Free text the owner kept with the decision. */
  note: string;
  /** Who approved them, for the audit trail nobody had. */
  approvedBy: string;
  /** Offering ids the approval carries, so a demotion knows what to take back. */
  offerings: string[];
  /**
   * When this membership lapses, or null for one that does not. An expired row stops counting the
   * moment it lapses — resolution checks the clock rather than waiting for a sweep — because a
   * membership that outlives its term by however long the sweep interval is, is a membership the
   * owner did not sell.
   */
  expiresAt: string | null;
  /** How the term is meant to continue. Descriptive: nothing here charges anybody. */
  renewal: 'manual' | 'self-serve' | 'none' | null;
}

/** A row is live if it has no term, or its term has not run out yet. */
export function isLive(rec: AppMemberRecord | null, now: Date = new Date()): boolean {
  if (!rec) return false;
  if (!rec.expiresAt) return true;
  return new Date(rec.expiresAt).getTime() > now.getTime();
}

/** Somebody asking to be let in. */
export interface AppMemberRequest {
  appId: string;
  owner: string;
  note: string;
  at: string;
  state: 'pending' | 'approved' | 'declined';
}

/**
 * An app id (`alice/app.html`) as a key segment. Slashes and dots are the separators this key space
 * already uses, so they are folded away rather than escaped.
 */
export function slugOf(appId: string): string {
  return String(appId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The bare account name behind any principal (`alice`, `alice@node`, `bot#alice@node`). */
export function accountOf(principal: string): string {
  const s = String(principal || '');
  const afterHash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  return afterHash.split('@')[0].toLowerCase();
}

export const memberKey = (appId: string, account: string) => `appmember.${slugOf(appId)}.${accountOf(account)}`;
export const requestKey = (appId: string, account: string) => `appmemreq.${slugOf(appId)}.${accountOf(account)}`;

/** Every approved member of one app. */
export async function listMembers(storage: Storage, appId: string): Promise<AppMemberRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: `appmember.${slugOf(appId)}.`, limit: 2000 });
  return items
    .map(r => r.value as AppMemberRecord)
    .filter(v => v && v.appId === appId)
    .sort((a, b) => a.owner.localeCompare(b.owner));
}

/** One member, or null. Reads the PERSON's row, so any of their agents resolves to the same answer. */
export async function getMember(storage: Storage, appId: string, principal: string): Promise<AppMemberRecord | null> {
  const rec = await storage.getMemory(NS_MEMBER, memberKey(appId, principal));
  const v = rec?.value as AppMemberRecord | undefined;
  if (!v || v.appId !== appId) return null;
  // The clock decides, not the sweep. A lapsed member stops reaching the app at the moment their
  // term runs out; the sweep exists to take the GRANTS back, which is the part money depends on.
  return isLive(v) ? v : null;
}

/** The raw row including a lapsed one, for the owner's panel and the sweep. */
export async function getMemberRow(storage: Storage, appId: string, principal: string): Promise<AppMemberRecord | null> {
  const rec = await storage.getMemory(NS_MEMBER, memberKey(appId, principal));
  const v = rec?.value as AppMemberRecord | undefined;
  return v && v.appId === appId ? v : null;
}

/** Approve someone, or change what their role is. Idempotent: `since` survives a role change. */
export async function putMember(
  storage: Storage,
  input: { appId: string; account: string; role: string; level?: number | null; note?: string;
    approvedBy: string; offerings?: string[]; expiresAt?: string | null; renewal?: AppMemberRecord['renewal'] },
): Promise<AppMemberRecord> {
  const account = accountOf(input.account);
  // The RAW row, so re-approving somebody whose term lapsed renews them rather than treating them
  // as brand new and losing when they first joined.
  const prev = await getMemberRow(storage, input.appId, account);
  const now = new Date().toISOString();
  const rec: AppMemberRecord = {
    appId: input.appId,
    owner: account,
    role: input.role,
    level: input.level ?? prev?.level ?? null,
    since: prev?.since ?? now,
    updatedAt: now,
    note: input.note ?? prev?.note ?? '',
    approvedBy: input.approvedBy,
    offerings: input.offerings ?? prev?.offerings ?? [],
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : (prev?.expiresAt ?? null),
    renewal: input.renewal !== undefined ? input.renewal : (prev?.renewal ?? null),
  };
  await write(storage, NS_MEMBER, memberKey(input.appId, account), rec, prev ? undefined : now);
  return rec;
}

/**
 * What each role is CARRIED on: the offerings an approval issues a zero-priced grant over.
 *
 * Without this an approval made from the panel sets a role and carries nothing, because the caller
 * has no way to say which listings a member calls free — and a member who holds the role but not the
 * grants is billed at list price on every call while the panel shows them approved. That reads as a
 * platform lie rather than as a configuration gap, so the plan is declared once per app and applied
 * on every approval after it.
 */
export interface AppCarryPlan {
  appId: string;
  /** role key → offering ids carried for that role. A role that is absent carries nothing. */
  roles: Record<string, string[]>;
  /**
   * Who may read the roster. `owner` (default) is right for a paid service, where the customer list
   * is nobody else's business. `members` is right where seeing each other IS the product — a club
   * board renders by reading each member's own posts, so a roster only the owner can read leaves
   * every member looking at an empty board.
   *
   * Even under `members` a member sees names, roles and join dates only. The note somebody wrote when
   * they asked, who approved them and what they are carried on stay the owner's.
   */
  rosterVisibility: 'owner' | 'members';
  /**
   * How many members a role may hold at once. A role that is absent is uncapped. A seat count is a
   * product decision with teeth: an approval past the last seat is REFUSED and says how many are
   * taken, rather than quietly making the eleventh member of a ten-seat plan.
   */
  seats: Record<string, number>;
  /**
   * How long a role lasts, in days, and how it is meant to continue. `days` absent means the
   * membership does not lapse. `renewal` is descriptive: `manual` means the owner re-approves,
   * `self-serve` means the member is expected to buy another term, `none` means it simply ends.
   *
   * NOTHING here charges anybody. A monthly subscription is expressed as `{ days: 30, renewal:
   * 'self-serve' }` plus whatever the app already uses to take money; the node enforces the TERM,
   * not the payment, and saying otherwise would be a promise it cannot keep.
   */
  terms: Record<string, { days?: number; renewal?: 'manual' | 'self-serve' | 'none' }>;
  updatedAt: string;
  setBy: string;
}

/** Everyone on one app's roster whose term has run out. The sweep's input. */
export async function listLapsed(storage: Storage, now: Date = new Date()): Promise<AppMemberRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: 'appmember.', limit: 5000 });
  return items
    .map(r => r.value as AppMemberRecord)
    .filter(v => v && v.expiresAt && !isLive(v, now));
}

/** How many members currently hold a role, counting only live ones. */
export async function seatsTaken(storage: Storage, appId: string, role: string): Promise<number> {
  const rows = await listMembers(storage, appId);
  return rows.filter(m => m.role === role && isLive(m)).length;
}

export const planKey = (appId: string) => `appmemplan.${slugOf(appId)}`;

/** The app's carry plan, or null if the owner has not declared one. */
export async function getCarryPlan(storage: Storage, appId: string): Promise<AppCarryPlan | null> {
  const rec = await storage.getMemory(NS_PLAN, planKey(appId));
  const v = rec?.value as AppCarryPlan | undefined;
  return v && v.appId === appId ? v : null;
}

/** Declare (or replace) it. Roles are taken as given: the node has no opinion about their names. */
export async function putCarryPlan(
  storage: Storage,
  input: { appId: string; roles: Record<string, string[]>; rosterVisibility?: 'owner' | 'members';
    seats?: Record<string, number>; terms?: AppCarryPlan['terms']; setBy: string },
): Promise<AppCarryPlan> {
  const roles: Record<string, string[]> = {};
  for (const [role, ids] of Object.entries(input.roles || {})) {
    if (!Array.isArray(ids)) continue;
    roles[String(role)] = [...new Set(ids.filter(x => typeof x === 'string' && x))];
  }
  const seats: Record<string, number> = {};
  for (const [role, n] of Object.entries(input.seats || {})) {
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) seats[String(role)] = Math.floor(n);
  }
  const terms: AppCarryPlan['terms'] = {};
  for (const [role, t] of Object.entries(input.terms || {})) {
    if (!t || typeof t !== 'object') continue;
    const days = typeof t.days === 'number' && t.days > 0 ? Math.floor(t.days) : undefined;
    const renewal = t.renewal === 'manual' || t.renewal === 'self-serve' || t.renewal === 'none' ? t.renewal : undefined;
    if (days !== undefined || renewal !== undefined) terms[String(role)] = { ...(days !== undefined ? { days } : {}), ...(renewal ? { renewal } : {}) };
  }
  const rec: AppCarryPlan = {
    appId: input.appId, roles, seats, terms,
    rosterVisibility: input.rosterVisibility === 'members' ? 'members' : 'owner',
    updatedAt: new Date().toISOString(), setBy: input.setBy,
  };
  await write(storage, NS_PLAN, planKey(input.appId), rec);
  return rec;
}

/** Remove a member. Returns whether there was one. */
export async function removeMember(storage: Storage, appId: string, principal: string): Promise<AppMemberRecord | null> {
  // The RAW row: a lapsed membership is exactly the one the sweep needs to remove, and reading it
  // through getMember — which hides lapsed rows — left the sweep revoking the grants and then
  // finding nothing to delete, so the dead row stayed on the roster and kept holding a seat.
  const prev = await getMemberRow(storage, appId, principal);
  if (!prev) return null;
  await storage.deleteMemory(NS_MEMBER, memberKey(appId, principal));
  return prev;
}

/** Everyone who has asked and not yet been decided on. */
export async function listRequests(storage: Storage, appId: string, state: 'pending' | 'all' = 'pending'): Promise<AppMemberRequest[]> {
  const { items } = await storage.listAllMemory({ prefix: `appmemreq.${slugOf(appId)}.`, limit: 2000 });
  return items
    .map(r => r.value as AppMemberRequest)
    .filter(v => v && v.appId === appId && (state === 'all' || v.state === 'pending'))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Ask to be let in, or update the note on an ask already made. */
export async function putRequest(
  storage: Storage,
  input: { appId: string; account: string; note?: string; state?: AppMemberRequest['state'] },
): Promise<AppMemberRequest> {
  const account = accountOf(input.account);
  const existing = await storage.getMemory(NS_REQUEST, requestKey(input.appId, account));
  const prev = existing?.value as AppMemberRequest | undefined;
  const rec: AppMemberRequest = {
    appId: input.appId,
    owner: account,
    note: input.note ?? prev?.note ?? '',
    at: prev?.at ?? new Date().toISOString(),
    state: input.state ?? 'pending',
  };
  await write(storage, NS_REQUEST, requestKey(input.appId, account), rec, prev ? undefined : rec.at);
  return rec;
}

/** Drop an ask entirely (the owner declining and forgetting, or an approval consuming it). */
export async function removeRequest(storage: Storage, appId: string, principal: string): Promise<void> {
  await storage.deleteMemory(NS_REQUEST, requestKey(appId, principal));
}

/** One private write, in the shape the memory substrate expects. */
async function write(storage: Storage, ns: string, key: string, value: unknown, createdAt?: string): Promise<void> {
  const existing = await storage.getMemory(ns, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: ns,
    value,
    // PRIVATE, always. Who is a member is personal data about someone else, and the reason this
    // moved off the app side is that the default there was the opposite.
    visibility: 'private',
    tags: ['app-member'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? createdAt ?? now,
    updatedAt: now,
  });
}
