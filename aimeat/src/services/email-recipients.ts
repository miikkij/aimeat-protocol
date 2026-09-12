/**
 * @file src/services/email-recipients.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a group email would actually reach on this node: the accounts that carry a
 *   notification address, and which of those belong to an operator. One read, used by both the
 *   admin email status route (which prints the counts before anything is sent) and the group send
 *   itself (which needs the addresses), so the number on the button and the number of messages
 *   that go out cannot drift apart.
 *
 * @structure
 *   - EmailReach: the two lists and the two totals they came from
 *   - emailReach(storage): one pass over the GHII records and the owner roles
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Extracted from routes/admin-features.ts, where the group send counted
 *     recipients inline and no other surface could see the number until after it had sent.
 */
import type { Storage } from '../storage/interface.js';

export interface EmailReach {
    /** GHII records on the node, whether or not they carry an address. */
    accounts: number;
    /** Owners holding the operator role, whether or not they carry an address. */
    operatorAccounts: number;
    /** Every notification address on the node. */
    all: string[];
    /** The subset belonging to an operator. */
    operators: string[];
}

/**
 * Read the node's notification addresses once.
 *
 * A person is reachable only through the notification address on their GHII record; an account
 * without one is silently skipped by every group send, which is why the counts are returned beside
 * the totals rather than on their own.
 */
export async function emailReach(storage: Storage): Promise<EmailReach> {
    const ghiis = await storage.listGHIIs();
    const owners = await storage.listOwners();
    const operatorNames = new Set(owners.filter(o => o.roles.includes('operator')).map(o => o.name));

    const all: string[] = [];
    const operators: string[] = [];
    for (const g of ghiis) {
        if (!g.notificationEmail) continue;
        all.push(g.notificationEmail);
        if (operatorNames.has(g.ownerName ?? '')) operators.push(g.notificationEmail);
    }
    return { accounts: ghiis.length, operatorAccounts: operatorNames.size, all, operators };
}
