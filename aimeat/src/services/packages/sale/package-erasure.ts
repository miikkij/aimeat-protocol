/**
 * @file src/services/packages/sale/package-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an account erasure does to the package sale records that name the person by their
 *   account name. Called by the erasure cascade (services/owner/erasure.ts, step `package_records`).
 *
 *   WHY. An account name is released for reuse when its account is erased (decision 2026-08-10,
 *   storage/erased-account-records.ts). These records name a person by the bare name and keep no
 *   account id, so the next person to register the name was the author of the erased person's sales
 *   and the buyer of their purchases (secaudit2026nov26). The package rows' author column is
 *   pseudonymised by the storage rule list on both backends; this is the half in memory records.
 *
 *   THE RULE, per record:
 *   - an account sale (package-account-sales, `sale.<groupId>`): the author and, on each purchase, the
 *     buyer, the seller's GHII and who completed the checkout take the erasure's pseudonym. The record
 *     stays: the other party's purchases keep their access, and the author's sales history keeps the
 *     other buyers;
 *   - the person's seller list (package-entitlements, `sellers.<name>`): deleted. It names which nodes
 *     sell the person's packages, and nobody may change it after them;
 *   - the person's node subscriptions (package-sales, `subscriptions.<name>`): deleted. They hold the
 *     automatic renewal and the saved payment reference of the person's own card;
 *   - the node holders (package-sales, `holders`): an entry the person holds is released, so the
 *     node's grant at the repository stays and another buyer may renew it;
 *   - the sale requests (package-sales, `requests`): a waiting request of the person is dropped, and a
 *     settled one names the pseudonym, so the selling node's history stays.
 *   The node's grants at a repository (package-entitlements, keyed by group and node) stay: a customer
 *   node keeps the versions it was given.
 * @structure PackageErasure · erasePackageRecordsOf(storage, person, pseudonym)
 * @usage const c = await erasePackageRecordsOf(storage, { name, identities: [ghii, ...agentGaiis] }, pseudonym);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (secaudit2026nov26, package records keyed by a released name).
 */
import type { Storage } from '../../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';
import { NS_PACKAGE_ACCOUNT_SALES, parseSale, type AccountSale } from './package-account-entitlement.js';
import { NS_PACKAGE_ENTITLEMENTS } from './package-grant-shards.js';
import { NS_PACKAGE_SALES, type SaleRequest } from './package-sale-catalogue.js';

export interface PackageErasure { sales: number; purchases: number; sellerLists: number; subscriptions: number; holders: number; requests: number }

type Holders = { nodes: Record<string, string> };
type Requests = { requests: Record<string, SaleRequest> };
const parseHolders = (v: unknown): Holders => ({ nodes: { ...((v as Partial<Holders> | null | undefined)?.nodes ?? {}) } });
const parseRequests = (v: unknown): Requests => ({ requests: { ...((v as Partial<Requests> | null | undefined)?.requests ?? {}) } });

/**
 * Pseudonymise or remove every package sale record that names the person. `identities` are the
 * person's GHII and the identities of their agents and apps, beside the bare `name`.
 */
export async function erasePackageRecordsOf(
  storage: Storage, person: { name: string; identities: string[] }, pseudonym: string,
): Promise<PackageErasure> {
  const mine = new Set([person.name, ...person.identities]);
  const out: PackageErasure = { sales: 0, purchases: 0, sellerLists: 0, subscriptions: 0, holders: 0, requests: 0 };
  const swap = (v: string | undefined): string | undefined => (v !== undefined && mine.has(v) ? pseudonym : v);

  // Account sales: the person as the author, and as a buyer on someone else's sale.
  for (const row of await storage.listMemory(NS_PACKAGE_ACCOUNT_SALES, { prefix: 'sale.' })) {
    const before = parseSale(row.value);
    if (!before) continue;
    const asAuthor = mine.has(before.author);
    const asBuyer = before.purchases.filter(p => mine.has(p.buyer) || mine.has(p.sellerGhii) || (p.boughtBy !== undefined && mine.has(p.boughtBy))).length;
    if (!asAuthor && !asBuyer) continue;
    await updateRecord<AccountSale | null>(storage, NS_PACKAGE_ACCOUNT_SALES, row.key, parseSale, cur => {
      if (!cur) return UNCHANGED;
      return {
        ...cur,
        author: swap(cur.author)!,
        purchases: cur.purchases.map(p => ({ ...p, buyer: swap(p.buyer)!, sellerGhii: swap(p.sellerGhii)!, ...(p.boughtBy !== undefined ? { boughtBy: swap(p.boughtBy) } : {}) })),
      };
    }, { tag: 'package-account-sale' });
    if (asAuthor) out.sales++;
    out.purchases += asBuyer;
  }

  // The person's own seller list and node subscriptions.
  if (await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, `sellers.${person.name}`)) {
    await storage.deleteMemory(NS_PACKAGE_ENTITLEMENTS, `sellers.${person.name}`);
    out.sellerLists++;
  }
  if (await storage.getMemory(NS_PACKAGE_SALES, `subscriptions.${person.name}`)) {
    await storage.deleteMemory(NS_PACKAGE_SALES, `subscriptions.${person.name}`);
    out.subscriptions++;
  }

  // The nodes the person holds, and their sale requests.
  const held = parseHolders((await storage.getMemory(NS_PACKAGE_SALES, 'holders'))?.value);
  out.holders = Object.values(held.nodes).filter(b => mine.has(b)).length;
  if (out.holders) {
    await updateRecord(storage, NS_PACKAGE_SALES, 'holders', parseHolders, cur => {
      const nodes = Object.fromEntries(Object.entries(cur.nodes).filter(([, buyer]) => !mine.has(buyer)));
      return Object.keys(nodes).length === Object.keys(cur.nodes).length ? UNCHANGED : { nodes };
    }, { tag: 'package-sales-holders' });
  }
  const asked = parseRequests((await storage.getMemory(NS_PACKAGE_SALES, 'requests'))?.value);
  out.requests = Object.values(asked.requests).filter(r => mine.has(r.buyer)).length;
  if (out.requests) {
    await updateRecord(storage, NS_PACKAGE_SALES, 'requests', parseRequests, cur => {
      const requests: Record<string, SaleRequest> = {};
      for (const [id, r] of Object.entries(cur.requests)) {
        if (!mine.has(r.buyer)) requests[id] = r;
        else if (r.state !== 'waiting') requests[id] = { ...r, buyer: pseudonym };
      }
      return { requests };
    }, { tag: 'package-sales-requests' });
  }
  return out;
}
