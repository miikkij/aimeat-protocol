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
  return v && v.appId === appId ? v : null;
}

/** Approve someone, or change what their role is. Idempotent: `since` survives a role change. */
export async function putMember(
  storage: Storage,
  input: { appId: string; account: string; role: string; level?: number | null; note?: string; approvedBy: string; offerings?: string[] },
): Promise<AppMemberRecord> {
  const account = accountOf(input.account);
  const prev = await getMember(storage, input.appId, account);
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
  };
  await write(storage, NS_MEMBER, memberKey(input.appId, account), rec, prev ? undefined : now);
  return rec;
}

/** Remove a member. Returns whether there was one. */
export async function removeMember(storage: Storage, appId: string, principal: string): Promise<AppMemberRecord | null> {
  const prev = await getMember(storage, appId, principal);
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
