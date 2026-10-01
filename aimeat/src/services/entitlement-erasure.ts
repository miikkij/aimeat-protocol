/**
 * @file src/services/entitlement-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exchange part of erasing an account: one step of eraseOwner
 *   (services/owner-erasure.ts). Revokes the paid contracts and the free-access grants of
 *   services/metered-entitlements.ts that the erased account is a party to.
 *
 *   WHY IT EXISTS. Contracts (namespace `metered-entitlement`, keys `entitlement.<hash>`) and grants
 *   (namespace `metered-grant`, keys `entgrant.<hash>`) live in platform-owned namespaces, keyed by a
 *   hash of the consumer's owner GHII and the (ext, action) coordinate. The storage cascade deletes
 *   by owner identity and never sees them, and an erased account name is released for reuse. A person
 *   who registers the name later has the same GHII, so the hash resolves to the same key and
 *   readEntitlementForCall authorised them on the previous holder's contract or grant. On the
 *   provider side, a new holder who installs an extension of the same name would be paid for, or
 *   would carry, the previous holder's customers.
 *
 *   WHAT CHANGES. Every record in the two namespaces whose consumerGaii names the account (the person,
 *   any agent `name#account@node`, any ecosystem app `eco:app#account@node`), and every record whose
 *   providerGhii names it, goes to state 'revoked' with a new updatedAt. A record that is already
 *   'revoked' is not written. An identity of another node (`bob@other-node`) is a different person and
 *   is not touched: the account is read with localAccountOf, run as the erasing node.
 *
 *   REVOKED, NOT DELETED. The records are the other party's ledger: a customer's spend history with
 *   the erased provider, a provider's earnings from the erased customer, the carried cost of a grant.
 *   'revoked' stops authorisation on every read path (authorizeAndCharge, budgetAllows, the grant
 *   precedence in readEntitlementForCall) and keeps the numbers. The history namespace
 *   (`metered-entitlement-history`) is append-only and is not changed.
 *
 *   WRITTEN BACK UNDER THE ROW'S OWN KEY. persistEntitlement derives the key from the value, and rows
 *   minted before v1.7.0 of metered-entitlements.ts are keyed on the exact caller rather than the
 *   owner (services/entitlement-merge.ts: "a record does not know where it lives; the scan does").
 *   Through persistEntitlement such a row would stay active and a revoked copy would be written to the
 *   owner's key, over a contract that may be someone's live one. So the scan's key and namespace are
 *   used, with the record shape persistEntitlement writes.
 *
 *   NOT HERE: rows in the bin (storage.deleteMemory). entitlement-merge deletes caller-keyed sources
 *   that it folded into an owner-keyed survivor; such a row is keyed on a hash nothing computes any
 *   more, so it authorises nothing even if restored.
 * @structure revokeEntitlementsOfAccount(storage, account, nodeId?) → EntitlementErasure
 * @usage const { asConsumer, asProvider } = await revokeEntitlementsOfAccount(storage, 'bob', config.nodeId);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: account erasure left exchange contracts and grants active for a
 *     reused account name.
 */
import type { MemoryRecord, Storage } from '../storage/interface.js';
import { localAccountOf, runAsNode } from '../utils/gaii.js';
import { NS_ENTITLEMENT, NS_GRANT_PUBLIC, type MeteredEntitlement } from './metered-entitlements.js';

/** How many records the step revoked. A record where the account is both parties counts once, as consumer. */
export interface EntitlementErasure {
  /** Contracts and grants the account (or one of its agents or apps) held as the consumer. */
  asConsumer: number;
  /** Contracts customers held with the account, and grants it issued, as the provider. */
  asProvider: number;
}

/** The two live key spaces: bought contracts and provider-carried grants. History is left out on purpose. */
const SPACES: ReadonlyArray<readonly [string, string]> = [
  [NS_ENTITLEMENT, 'entitlement.'],
  [NS_GRANT_PUBLIC, 'entgrant.'],
];

/**
 * Every live record of one namespace under one key prefix, all pages. Pinned to the exact namespace,
 * because `ownerPrefix: 'metered-entitlement'` also matches `metered-entitlement-history`. Collected
 * in full before anything is written, so a write cannot move a row across a page boundary.
 */
async function scan(storage: Storage, ns: string, prefix: string): Promise<MemoryRecord[]> {
  const rows: MemoryRecord[] = [];
  for (let offset = 0; ; ) {
    const page = await storage.listAllMemory({ ownerPrefix: ns, prefix, limit: 1000, offset });
    rows.push(...page.items.filter(r => r.ownerGaii === ns));
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return rows;
}

/** The local account a principal names, lowercased (owner names are lowercase), or null for another node's. */
function accountOfPrincipal(principal: unknown): string | null {
  if (typeof principal !== 'string' || !principal) return null;
  const name = localAccountOf(principal);
  return name ? name.toLowerCase() : null;
}

async function revokeAll(storage: Storage, account: string): Promise<EntitlementErasure> {
  const result: EntitlementErasure = { asConsumer: 0, asProvider: 0 };
  const who = accountOfPrincipal(account);
  if (!who) return result;

  for (const [ns, prefix] of SPACES) {
    for (const row of await scan(storage, ns, prefix)) {
      const ent = row.value as MeteredEntitlement | null;
      if (!ent || typeof ent !== 'object' || ent.state === 'revoked') continue;
      const asConsumer = accountOfPrincipal(ent.consumerGaii) === who;
      const asProvider = !asConsumer && accountOfPrincipal(ent.providerGhii) === who;
      if (!asConsumer && !asProvider) continue;

      const now = new Date().toISOString();
      const value: MeteredEntitlement = { ...ent, state: 'revoked', updatedAt: now };
      await storage.setMemory({
        key: row.key,
        ownerGaii: ns,
        value,
        visibility: 'private',
        tags: ['metered-entitlement'],
        ttlHours: null,
        version: 1,
        createdAt: ent.createdAt || row.createdAt,
        updatedAt: now,
      });
      if (asConsumer) result.asConsumer++;
      else result.asProvider++;
    }
  }
  return result;
}

/**
 * Revoke every exchange contract and grant an erased account is a party to, as consumer or as
 * provider. Uses only Storage interface calls, so both providers run the same code.
 *
 * @param storage the node storage; inside eraseOwner this runs in its transaction
 * @param account the erased account name (`bob`, or its GHII `bob@node`)
 * @param nodeId the erasing node. When given, identities are read as this node, so `bob@other-node`
 *   is not the local `bob`. Without it, the node the code runs as applies (runAsNode, setThisNodeId);
 *   with neither, localAccountOf treats every identity as local.
 */
export async function revokeEntitlementsOfAccount(
  storage: Storage, account: string, nodeId?: string,
): Promise<EntitlementErasure> {
  return nodeId ? runAsNode(nodeId, () => revokeAll(storage, account)) : revokeAll(storage, account);
}
