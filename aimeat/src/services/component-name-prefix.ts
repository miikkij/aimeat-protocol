/**
 * @file src/services/component-name-prefix.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension and cortex names that start with `aimeat-` belong to what the node ships.
 *
 *   WHY. The node ships extensions and cortexes under bare names that apps and node features call
 *   (BUILTIN_EXTENSIONS, public/cortex-bundled). The repository is public, so a name a coming release
 *   adds is visible before the release reaches a node, and an account could install under it first.
 *   The seeders no longer adopt such a record (builtin-extension-seeder.ts BUILTIN_EXTENSION_NAME_HELD,
 *   cortex-seeder.ts BUNDLED_CORTEX_NAME_HELD), but the account still held the name the release needed.
 *   The developer's decision (2026-10-29, secaudit2026oct26 round 8c): what the node ships from now on
 *   takes a name that starts with `aimeat-`, and an account does not install a NEW extension or cortex
 *   under such a name. The operator may (an operator redeploys what the node ships). A record an
 *   account already holds keeps working: only a new record is asked, and a bare name the account
 *   released itself is taken back as before (component-address.ts installNameFor `reclaimed`).
 *
 *   The prefix is read from the short name, so `<owner>/aimeat-x` is asked too: a namespaced copy of a
 *   shipped short name can be reached by the bare address while the shipped record is missing.
 *
 *   The two built-in extensions shipped before this rule (living-hooks, vocab-finto) keep their names;
 *   test/unit/component-name-prefix.test.ts checks that every name shipped after them carries the prefix.
 * @structure NODE_NAME_PREFIX · hasNodePrefix · nodePrefixRefusal
 * @usage
 *   const refused = await nodePrefixRefusal(storage, 'extension', record.name, { ownerName, isOperator });
 *   if (refused) return { ok: false, ...refused };
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, extensions-02,
 *     routes/extensions/crud.ts:install-accepts-builtin-extension-name).
 */
import type { Storage } from '../storage/interface.js';
import type { ComponentKind } from '../storage/types/component-versions.js';
import { isNamespacedName, shortNameOf } from './component-address.js';

/** The prefix of every extension and cortex name the node ships from 2026-10-29 on. */
export const NODE_NAME_PREFIX = 'aimeat-';

/** Does this stored or manifest name carry the node's prefix in its short name? */
export function hasNodePrefix(name: string): boolean {
    return shortNameOf(name).startsWith(NODE_NAME_PREFIX);
}

/** The refusal a door answers as it answers its other refusals: status, code and plain words. */
export interface NodePrefixRefusal { status: 409; code: 'NAME_RESERVED'; message: string }

/**
 * The refusal for a NEW extension or cortex under a name with the node's prefix, or null. Asked only
 * where no record exists under the name yet; an update of a record the account holds never asks it.
 */
export async function nodePrefixRefusal(
    storage: Storage, kind: ComponentKind, name: string, caller: { ownerName: string; isOperator: boolean },
): Promise<NodePrefixRefusal | null> {
    if (caller.isOperator || !hasNodePrefix(name)) return null;
    // A bare name this account released itself is its own to take back, as component-address.ts says.
    if (!isNamespacedName(name) && typeof storage.getReleasedComponentName === 'function') {
        const released = await storage.getReleasedComponentName(kind, name);
        if (released?.holder === caller.ownerName) return null;
    }
    const rest = shortNameOf(name).slice(NODE_NAME_PREFIX.length) || 'addon';
    return {
        status: 409, code: 'NAME_RESERVED',
        message: `Names that start with "${NODE_NAME_PREFIX}" belong to what this node ships. `
            + `Give your add-on another name, for example "${caller.ownerName}-${rest}".`,
    };
}
