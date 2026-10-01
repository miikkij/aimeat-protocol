/**
 * @file src/services/app-member-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-roster part of erasing an account: one step of eraseOwner
 *   (services/owner-erasure.ts).
 *
 *   WHY IT EXISTS. The roster records of services/app-members.ts and the blanket development rights
 *   of services/app-dev-grant.ts live in platform-owned namespaces (`app-member`, ...), keyed by the
 *   bare, lowercased account name. The storage cascade deletes by owner identity and never sees
 *   them, and an erased username is released for reuse. So without this step the next person to
 *   register the name inherited the previous person's memberships, roles, development rights,
 *   pending requests and visit history, and the previous person's apps kept a roster and a carry
 *   plan with nobody behind them.
 *
 *   WHAT GOES.
 *   - Every record that names the account as the member, requester, visitor or blanket grantee, on
 *     every app of the node.
 *   - Every record of every app the account OWNED: other people's member rows, requests and visits,
 *     the carry plan, and the blanket rights the account gave. The roster of an app goes with the app.
 *
 *   FOR GOOD, NOT TO THE BIN. storage.deleteMemory moves a row to the bin, where it can be restored by
 *   key until the sweeper runs. An erased person's records must not come back that way, so this uses
 *   bulkDeleteMemory (a hard delete on both providers) and also takes rows that an earlier removal
 *   already put in the bin. The per-key fallback runs only on a storage without bulkDeleteMemory,
 *   the same as purgeExceptions (services/classification/exceptions.ts).
 *
 *   NOT HERE: the zero-priced exchange grants an approval issued (services/grant-sync.ts). They live
 *   in the metered-grant namespace, keyed by a hash of the consumer's GHII; the step in
 *   services/entitlement-erasure.ts revokes them, together with the paid contracts.
 * @structure eraseAppMembership(storage, account) → AppMembershipErasure
 * @usage const counts = await eraseAppMembership(storage, 'bob');
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: account erasure left app-membership records behind for a reused name.
 */
import type { MemoryRecord, Storage } from '../storage/interface.js';
import { accountOf, NS_MEMBER, NS_REQUEST, NS_PLAN, NS_SEEN } from './app-members.js';

/**
 * The development rights' own namespace, as services/app-dev-grant.ts writes it. That module keeps the
 * constant private, so it is repeated here; a rename there that is not made here leaves the records
 * behind, which test/unit/app-member-erasure.test.ts detects.
 */
const NS_BLANKET = 'app-dev-blanket';

/** How many records of each kind the step deleted. */
export interface AppMembershipErasure {
  /** Member rows: the account's own on any app, and every row of the apps it owned. */
  members: number;
  /** Membership requests, by the same rule. */
  requests: number;
  /** Visit records, by the same rule. */
  visits: number;
  /** Carry plans of the apps the account owned. */
  plans: number;
  /** Blanket development rights the account gave or held. */
  blanketGrants: number;
}

/** A record address for bulkDeleteMemory. */
type Ref = { ownerGaii: string; key: string };

/**
 * Every record of one namespace under one key prefix, live rows and rows in the bin alike. Pinned to
 * the exact namespace, because `ownerPrefix: 'app-member'` also matches `app-member-request` and the
 * others.
 */
async function scan(storage: Storage, ns: string, prefix: string): Promise<MemoryRecord[]> {
  const rows: MemoryRecord[] = [];
  const readers = [
    (offset: number) => storage.listAllMemory({ ownerPrefix: ns, prefix, limit: 1000, offset }),
    (offset: number) => storage.listAllDeletedMemory({ ownerPrefix: ns, prefix, limit: 1000, offset }),
  ];
  for (const read of readers) {
    for (let offset = 0; ; ) {
      const page = await read(offset);
      rows.push(...page.items.filter(r => r.ownerGaii === ns));
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
  }
  return rows;
}

/**
 * The app-id segment and the account segment of a per-app key (`<prefix><segment>.<account>`). The
 * segment never holds a dot (app-record-keys.ts: `v2-<hex>`, or the legacy `[a-z0-9-]` slug), so the
 * first dot after the prefix ends it and the rest is the account, dots included.
 */
function splitKey(key: string, prefix: string): { segment: string; account: string } {
  const rest = key.slice(prefix.length);
  const dot = rest.indexOf('.');
  return dot < 0 ? { segment: rest, account: '' } : { segment: rest.slice(0, dot), account: rest.slice(dot + 1) };
}

/**
 * The owner account of the app a record belongs to, lowercased, or '' when it cannot be told. Read
 * from the record's `appId` (`owner/filename`), else decoded from a `v2-<hex>` key segment, which is
 * the canonical app id in hex. A legacy slug cannot be decoded, but legacy rows carry `appId`.
 */
function appOwnerOf(row: MemoryRecord, segment: string): string {
  const appId = (row.value as { appId?: unknown } | null)?.appId;
  let id = typeof appId === 'string' ? appId : '';
  // Buffer.from does not throw on bad hex; it stops at the first bad pair, and a result without a
  // slash is then rejected below.
  if (!id && segment.startsWith('v2-')) id = Buffer.from(segment.slice(3), 'hex').toString('utf8');
  const slash = id.indexOf('/');
  return slash > 0 ? accountOf(id.slice(0, slash)) : '';
}

/** Delete for good. Hard on both providers; the fallback is for a storage without the bulk call. */
async function hardDelete(storage: Storage, refs: Ref[]): Promise<number> {
  if (!refs.length) return 0;
  if (storage.bulkDeleteMemory) return storage.bulkDeleteMemory(refs);
  let n = 0;
  for (const r of refs) if (await storage.deleteMemory(r.ownerGaii, r.key)) n++;
  return n;
}

/**
 * Delete every app-roster record of an erased account: what it held on any app, and the whole roster,
 * carry plan and blanket rights of the apps it owned. Uses only Storage interface calls, so both
 * providers run the same code. Returns how many records of each kind went.
 *
 * @param storage the node storage; inside eraseOwner this runs in its transaction
 * @param account the erased account name, in any case (`bob`, `Bob`, `bob@node`)
 */
export async function eraseAppMembership(storage: Storage, account: string): Promise<AppMembershipErasure> {
  const who = accountOf(account);
  const result: AppMembershipErasure = { members: 0, requests: 0, visits: 0, plans: 0, blanketGrants: 0 };
  if (!who) return result;

  const perApp: Array<[keyof AppMembershipErasure, string, string]> = [
    ['members', NS_MEMBER, 'appmember.'],
    ['requests', NS_REQUEST, 'appmemreq.'],
    ['visits', NS_SEEN, 'appmemseen.'],
  ];
  for (const [kind, ns, prefix] of perApp) {
    const refs: Ref[] = [];
    for (const row of await scan(storage, ns, prefix)) {
      const { segment, account: rowAccount } = splitKey(row.key, prefix);
      if (rowAccount === who || appOwnerOf(row, segment) === who) refs.push({ ownerGaii: ns, key: row.key });
    }
    result[kind] = await hardDelete(storage, refs);
  }

  // The carry plan is one record per app (`appmemplan.<segment>`), so only the owner rule applies.
  const plans: Ref[] = [];
  for (const row of await scan(storage, NS_PLAN, 'appmemplan.')) {
    if (appOwnerOf(row, row.key.slice('appmemplan.'.length)) === who) plans.push({ ownerGaii: NS_PLAN, key: row.key });
  }
  result.plans = await hardDelete(storage, plans);

  // Blanket rights: `appdevall.<owner>.<grantee>`. An owner name holds no dot, so the first dot after
  // the prefix ends it; the record's own fields are read too, in case a key was written another way.
  const blanket: Ref[] = [];
  for (const row of await scan(storage, NS_BLANKET, 'appdevall.')) {
    const { segment: owner, account: grantee } = splitKey(row.key, 'appdevall.');
    const v = row.value as { owner?: unknown; grantee?: unknown } | null;
    if (owner === who || grantee === who || v?.owner === who || v?.grantee === who) {
      blanket.push({ ownerGaii: NS_BLANKET, key: row.key });
    }
  }
  result.blanketGrants = await hardDelete(storage, blanket);
  return result;
}
