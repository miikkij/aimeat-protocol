/**
 * @file services/install-set-trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which package repositories this node takes packages from because an install set named
 *   them, whether or not package federation is on.
 *
 *   WHY. Package federation (AIMEAT_PACKAGE_FEDERATION_ENABLED) is off by default: a pulled extension
 *   runs code in the sandbox and a pulled app gets an address, so an operator switches the exchange on
 *   deliberately. A customer node set up from an install set was therefore refused its own bundle
 *   unless whoever created it also remembered to switch federation on, which the shop's end-to-end
 *   run found on 2026-09-29. The install set is that deliberate decision already: it names the
 *   repository. Jouni approved on 2026-09-29 that the named repository is always allowed, and nothing
 *   else is.
 *
 *   WHERE IT IS READ. The apply's own pulls say so explicitly (package-pull.ts `installSet`); a later
 *   pull from the same repository, the daily update check among them, is allowed when an applied
 *   install set on this node names that repository (the records in the system namespace below).
 * @structure NS_INSTALL_SETS · installSetRepositories() · rememberClaimedRepository()
 * @version-history
 *   v1.2.1 — 2026-10-05 — The applying account's operator role is read with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.2.0 — 2026-10-05 — Only an install set an operator applied names a trusted repository; an
 *     owner's own bundle record no longer does (secaudit 2026-10, PKG-9).
 *   v1.1.0 — 2026-10-02 — A repository the operator redeemed a package claim at is trusted the same way
 *     (package sale design, phase 3).
 *   v1.0.0 — 2026-09-29 — Initial (install packages: the named repository needs no federation switch).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { isOperatorAccount } from '../utils/operator-account.js';

/** The system namespace of the applied install set records (install-set-apply.ts). */
export const NS_INSTALL_SETS = 'install-sets';

/** The record of the repositories this node's operator redeemed a package claim at. */
const CLAIMED_KEY = 'claimed-repositories';

/**
 * The repositories the install sets an OPERATOR applied on this node name, and those its operator
 * claimed a package at. An owner with packages:write writes an install-set record too (an owner's own
 * bundle, install-bundle-owner.ts), and every record used to count, so a non-operator added a node to
 * the sources this node takes packages from with package federation switched off (secaudit 2026-10,
 * PKG-9). A record counts when the account that applied it is an operator.
 */
export async function installSetRepositories(storage: Storage): Promise<Set<string>> {
    const rows = await storage.listMemory(NS_INSTALL_SETS, { prefix: 'install-sets.' });
    const out = new Set<string>();
    const operator = new Map<string, boolean>();
    for (const row of rows) {
        const value = row.value as { bundle?: { node_id?: unknown }; applied_by?: unknown } | undefined;
        const node = value?.bundle?.node_id;
        if (typeof node !== 'string' || !node || typeof value?.applied_by !== 'string') continue;
        // 'startup': the set the operator configured for this node, applied when it starts
        // (install-set-startup.ts).
        if (value.applied_by === 'startup') { out.add(node); continue; }
        const account = localAccountName(value.applied_by);
        if (!operator.has(account)) operator.set(account, isOperatorAccount(await storage.getOwner(account)));
        if (operator.get(account)) out.add(node);
    }
    const claimed = (await storage.getMemory(NS_INSTALL_SETS, CLAIMED_KEY))?.value as { nodes?: unknown } | undefined;
    for (const n of Array.isArray(claimed?.nodes) ? claimed!.nodes as unknown[] : []) if (typeof n === 'string' && n) out.add(n);
    return out;
}

/**
 * Trust a repository the operator redeemed a claim at (package-claims.ts), as an applied install set
 * does: redeeming a code for this node is the same deliberate decision to take packages from it.
 */
export async function rememberClaimedRepository(storage: Storage, nodeId: string): Promise<void> {
    const prev = await storage.getMemory(NS_INSTALL_SETS, CLAIMED_KEY);
    const nodes = new Set(((prev?.value as { nodes?: string[] } | undefined)?.nodes) ?? []);
    if (nodes.has(nodeId)) return;
    nodes.add(nodeId);
    const now = new Date().toISOString();
    await storage.setMemory({
        key: CLAIMED_KEY, ownerGaii: NS_INSTALL_SETS, value: { nodes: [...nodes] },
        visibility: 'private', tags: ['claimed-repositories'], ttlHours: null,
        version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
}
