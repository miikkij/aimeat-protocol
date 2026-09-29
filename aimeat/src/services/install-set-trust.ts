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
 * @structure NS_INSTALL_SETS · installSetRepositories()
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (install packages: the named repository needs no federation switch).
 */
import type { Storage } from '../storage/interface.js';

/** The system namespace of the applied install set records (install-set-apply.ts). */
export const NS_INSTALL_SETS = 'install-sets';

/** The repositories the applied install sets on this node name. */
export async function installSetRepositories(storage: Storage): Promise<Set<string>> {
    const rows = await storage.listMemory(NS_INSTALL_SETS, { prefix: 'install-sets.' });
    const out = new Set<string>();
    for (const row of rows) {
        const node = (row.value as { bundle?: { node_id?: unknown } } | undefined)?.bundle?.node_id;
        if (typeof node === 'string' && node) out.add(node);
    }
    return out;
}
