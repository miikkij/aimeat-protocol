/**
 * @file app-member-roster.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The roster as GET /v1/apps/:owner/:filename/members answers it: the members, the
 *   people waiting, the visitors and the open invitations, each searched by `q`, paged, and named
 *   with the public display name of the account. Also the bounded read of roles behind the
 *   one-click approval a request notification offers.
 *
 *   DISPLAY NAMES. The public profile name (GHIIRecord.displayName, what GET /v1/ghii/:ghii serves to
 *   anyone), looked up for the accounts on the page only, or for every account when the caller
 *   searches, since a search by name needs the names. An identity of another node has none here.
 * @structure displayNamesOf · sampleRoles · RosterView · rosterView · memberRowView
 * @usage const view = await rosterView(storage, appId, parseRosterPaging(req.query), { invites: true });
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2, A1 and A5).
 */
import type { Storage } from '../storage/interface.js';
import {
  NS_MEMBER, slugOf, sameApp, isLive, listMembers, listRequests, listVisits,
  type AppMemberRecord, type AppMemberRequest, type AppMemberVisit,
} from './app-members.js';
import { listInvites, inviteView, type AppMemberInvite } from './app-member-invites.js';
import { matchesQuery, pageRows, type RosterPaging } from './app-member-rules.js';

/** How many lookups run at once when names are read for a page. */
const NAME_BATCH = 50;

/**
 * The public display name of each account, or null when it has none or is not an account of this
 * node. One lookup per distinct account, NAME_BATCH at a time.
 */
export async function displayNamesOf(storage: Storage, accounts: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const todo = [...new Set(accounts.filter(Boolean))];
  for (let i = 0; i < todo.length; i += NAME_BATCH) {
    const batch = todo.slice(i, i + NAME_BATCH);
    const found = await Promise.all(batch.map(a => (a.includes('@') ? Promise.resolve(null) : storage.getGHIIByOwner(a))));
    batch.forEach((a, j) => out.set(a, found[j]?.displayName ?? null));
  }
  return out;
}

/** How many member rows the one-click role suggestion reads at most. */
export const ROLE_SAMPLE = 200;

/**
 * The roles of up to ROLE_SAMPLE live members of the app, read as one page of the roster rather than
 * the whole of it: the request path runs for every ask, and a roster has no upper bound.
 */
export async function sampleRoles(storage: Storage, appId: string): Promise<Array<{ role: string }>> {
  const page = await storage.listAllMemory({ ownerPrefix: NS_MEMBER, prefix: `appmember.${slugOf(appId)}.`, limit: ROLE_SAMPLE, offset: 0 });
  return page.items
    .filter(r => r.ownerGaii === NS_MEMBER)
    .map(r => r.value as AppMemberRecord)
    .filter(v => v && sameApp(v.appId, appId) && isLive(v))
    .map(v => ({ role: v.role }));
}

/** A row with the person's display name on it. */
type Named<T> = T & { displayName: string | null };

export interface RosterView {
  members: Array<Named<AppMemberRecord>>;
  requests: Array<Named<AppMemberRequest>>;
  seen: Array<Named<AppMemberVisit>>;
  invites: Array<Omit<AppMemberInvite, 'emailHash'>>;
  total: { members: number; requests: number; seen: number; invites: number };
}

/** The member row a fellow member may see under rosterVisibility `members`. */
export function memberRowView(m: AppMemberRecord): Pick<AppMemberRecord, 'appId' | 'owner' | 'role' | 'level' | 'since'> {
  return { appId: m.appId, owner: m.owner, role: m.role, level: m.level, since: m.since };
}

/**
 * The roster for the owner and the managers: every list searched by `q` (account or display name;
 * an invitation by its address), paged by `limit` and `offset`, with `total` per list after the
 * search. A person appears in one list only: a member, waiting, or a visitor who is neither.
 */
export async function rosterView(storage: Storage, appId: string, paging: RosterPaging): Promise<RosterView> {
  const [members, requests, seen, invites] = await Promise.all([
    listMembers(storage, appId), listRequests(storage, appId), listVisits(storage, appId), listInvites(storage, appId),
  ]);
  const decided = new Set([...members.map(m => m.owner), ...requests.map(r => r.owner)]);
  const guests = seen.filter(v => !decided.has(v.owner));

  const names = new Map<string, string | null>();
  const need = async (accounts: string[]) => {
    const missing = accounts.filter(a => !names.has(a));
    if (missing.length) for (const [k, v] of await displayNamesOf(storage, missing)) names.set(k, v);
  };
  if (paging.q) await need([...members, ...requests, ...guests].map(r => r.owner));
  const hit = <T extends { owner: string }>(rows: T[]) => rows.filter(r => matchesQuery(paging.q, r.owner, names.get(r.owner)));

  const m = pageRows(hit(members), paging);
  const r = pageRows(hit(requests), paging);
  const s = pageRows(hit(guests), paging);
  const i = pageRows(invites.filter(inv => matchesQuery(paging.q, inv.emailShown)), paging);
  await need([...m.items, ...r.items, ...s.items].map(x => x.owner));
  const named = <T extends { owner: string }>(rows: T[]) => rows.map(x => ({ ...x, displayName: names.get(x.owner) ?? null }));
  return {
    members: named(m.items), requests: named(r.items), seen: named(s.items), invites: i.items.map(inviteView),
    total: { members: m.total, requests: r.total, seen: s.total, invites: i.total },
  };
}

/**
 * The roster a member reads when the app shows it to its members: names, roles and join dates of the
 * members only, searched and paged the same way.
 */
export async function memberRosterView(
  storage: Storage, appId: string, paging: RosterPaging,
): Promise<{ members: Array<Named<ReturnType<typeof memberRowView>>>; total: number }> {
  const members = await listMembers(storage, appId);
  const names = paging.q ? await displayNamesOf(storage, members.map(x => x.owner)) : new Map<string, string | null>();
  const page = pageRows(members.filter(x => matchesQuery(paging.q, x.owner, names.get(x.owner))), paging);
  if (!paging.q) for (const [k, v] of await displayNamesOf(storage, page.items.map(x => x.owner))) names.set(k, v);
  return { members: page.items.map(x => ({ ...memberRowView(x), displayName: names.get(x.owner) ?? null })), total: page.total };
}
