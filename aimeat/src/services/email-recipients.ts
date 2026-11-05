/**
 * @file src/services/email-recipients.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a group email would actually reach on this node: the accounts that carry a
 *   notification address they have verified, and which of those belong to an operator. One read,
 *   used by both the admin email status route (which prints the counts before anything is sent) and
 *   the group send itself (which needs the addresses), so the number on the button and the number of
 *   messages that go out cannot drift apart.
 *
 *   VERIFIED ADDRESSES ONLY. The group mail goes to an account's address on the same rule as every
 *   other mail to an account's own address (owner-mail-address.ts provenOwnerAddress): an address the
 *   account has not verified may be somebody else's. Accounts whose address is not verified are
 *   counted, so the operator's mail view says how many the send skips.
 *
 * @structure
 *   - EmailReach: the two lists, the totals they came from, and the unverified counts
 *   - emailReach(storage): one pass over the GHII records and the owner roles
 *
 * @version-history
 *   v1.1.0 — 2026-11-05 — Only verified addresses are listed; `unverified` and `operatorsUnverified`
 *     count the accounts whose address is skipped (codebase analysis 2026-11-03, decision 14a of 2026-11-05).
 *   v1.0.1 — 2026-10-05 — The operator accounts are found with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-09-12 — Extracted from routes/admin-features.ts, where the group send counted
 *     recipients inline and no other surface could see the number until after it had sent.
 */
import type { Storage } from '../storage/interface.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { provenOwnerAddress } from './owner-mail-address.js';

export interface EmailReach {
    /** GHII records on the node, whether or not they carry an address. */
    accounts: number;
    /** Owners holding the operator role, whether or not they carry an address. */
    operatorAccounts: number;
    /** Every verified notification address on the node. */
    all: string[];
    /** The subset belonging to an operator. */
    operators: string[];
    /** Accounts carrying an address they have not verified: a group send to everyone skips them. */
    unverified: number;
    /** The operators among them: a group send to the operators skips them. */
    operatorsUnverified: number;
}

/**
 * Read the node's verified notification addresses once.
 *
 * A person is reachable only through the notification address on their GHII record, and only once
 * they have verified it; an account without one is skipped by every group send, which is why the
 * counts are returned beside the totals rather than on their own.
 */
export async function emailReach(storage: Storage): Promise<EmailReach> {
    const ghiis = await storage.listGHIIs();
    const owners = await storage.listOwners();
    const operatorNames = new Set(owners.filter(isOperatorAccount).map(o => o.name));

    const all: string[] = [];
    const operators: string[] = [];
    let unverified = 0;
    let operatorsUnverified = 0;
    for (const g of ghiis) {
        if (!g.notificationEmail) continue;
        const isOperator = operatorNames.has(g.ownerName ?? '');
        const to = provenOwnerAddress(g);
        if (!to) {
            unverified++;
            if (isOperator) operatorsUnverified++;
            continue;
        }
        all.push(to);
        if (isOperator) operators.push(to);
    }
    return { accounts: ghiis.length, operatorAccounts: operatorNames.size, all, operators, unverified, operatorsUnverified };
}
