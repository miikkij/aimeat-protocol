/**
 * @file src/services/name-bound-grants-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account erasure's step for three records that name a person by `name@node` and
 *   that other people or the operator keep, so the erased person's own memory does not hold them:
 *     - the operator's beneficiary approval (commerce/beneficiary-release.ts): deleted, it attests to
 *       that person only;
 *     - the accountant grants other owners gave the person (finance/accountant-access.ts): the person
 *       is taken off every client's list;
 *     - the data processing agreements that name the person's account as the counterparty's
 *       (compliance-agreements.ts): the agreement stays, as the operator's legal record, without the
 *       account.
 *   A deleted account name is released for reuse (decision 2026-08-10), so each of these made the next
 *   person to register the name payable, a reader of someone's books, or a party to an agreement
 *   (secaudit2026oct26). The entries an older erasure left are refused at the time of use instead
 *   (services/account-instance.ts heldSince).
 * @structure eraseNameBoundGrants(storage, nodeId, name)
 * @usage const c = await eraseNameBoundGrants(storage, nodeId, name);   // services/owner-erasure.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26: beneficiary-release, accountant-access and
 *     compliance-agreements counterparty name reuse).
 */
import type { Storage } from '../storage/interface.js';
import { deleteApprovalOf } from '../commerce/beneficiary-release.js';
import { removeAccountantEverywhere } from './finance/accountant-access.js';
import { releaseCounterpartyAccount } from './compliance-agreements.js';

/** Clear the three records for the erased `name`. Answers what changed, per kind. */
export async function eraseNameBoundGrants(
  storage: Storage, nodeId: string, name: string,
): Promise<{ approvals: number; accountantLists: number; agreements: number }> {
  const ghii = `${name}@${nodeId}`;
  const approvals = await deleteApprovalOf(storage, ghii) ? 1 : 0;
  const accountantLists = await removeAccountantEverywhere(storage, ghii);
  const agreements = await releaseCounterpartyAccount(storage, nodeId, ghii);
  return { approvals, accountantLists, agreements };
}
