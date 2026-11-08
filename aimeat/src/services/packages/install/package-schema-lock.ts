/**
 * @file src/services/packages/install/package-schema-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The schema lock rule (services/schema-lock-rule.ts) for a package's cortex schema
 *   parts, asked by the install and the migration before anything is written.
 *
 *   WHY. A lock is found by its key pattern alone and governs every account's writes to a matching
 *   key. PUT /v1/memory/:key/schema and the cortex activation ask the rule; a package install and a
 *   package migration registered a cortex's locks through services/component-registrar.ts, which
 *   asked only whether the same pattern was already held by somebody else
 *   (package-component-collisions.ts). So an account's own package set a node-wide lock (`**`), a lock
 *   over another organism's records, or a lock under another account's lock (secaudit2026nov08
 *   round 14, package-cortex-schema-lock-skips-schema-lock-rule).
 *
 *   The caller is the one who installs: the owner in person, the owner's agent, or the owner's own
 *   update job (roles ['owner']). The operator passes as everywhere the rule is asked; an update job
 *   of the operator's own account passes too, since its stored account is the operator.
 * @structure PackageLockActor · packageLockCaller() · ownerLockCaller() · cortexLockRuleRefusal()
 * @usage
 *   const lockCaller = await packageLockCaller(storage, caller);
 *   const refusal = await cortexLockRuleRefusal({ storage, config }, lockCaller, comp.content, comp.id);
 *   if (refusal) return { ok: false, status: refusal.status, code: refusal.code, message: refusal.message };
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import { schemaLockRefusal, type SchemaLockCaller } from '../../schema-lock-rule.js';
import { cortexComponentsOf } from '../compose/package-component-collisions.js';
import { isOperatorCaller } from '../../operator-override.js';
import { isOperatorAccount } from '../../../utils/operator-account.js';
import { isOwnerInPerson } from '../../../utils/gaii.js';

/** Who installs or migrates, as package-install.ts and package-migrate.ts carry it. */
export interface PackageLockActor {
    owner: string;
    ownerGhii: string;
    sub: string;
    roles: string[];
    scopes: string[];
    federated?: boolean;
}

/** The lock rule's caller for an install or a migration by `actor`. */
export async function packageLockCaller(storage: Storage, actor: PackageLockActor): Promise<SchemaLockCaller> {
    const inPerson = isOwnerInPerson(actor);
    const isOperator = await isOperatorCaller(storage, actor)
        || (inPerson && isOperatorAccount(await storage.getOwner(actor.owner)));
    return { principal: inPerson ? actor.ownerGhii : actor.sub, owner: actor.owner, roles: actor.roles, scopes: actor.scopes, isOperator };
}

/** The caller a registration with no installer named is asked as: the owner in person, not the operator. */
export function ownerLockCaller(owner: string, ownerGhii: string): SchemaLockCaller {
    return { principal: ownerGhii, owner, roles: ['owner'], isOperator: false };
}

/**
 * The first schema part of a cortex component the rule refuses, as the registrar's `CODE: message`
 * error and as a status and code, or null. Reads only.
 */
export async function cortexLockRuleRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    caller: SchemaLockCaller,
    content: string,
    componentId: string,
): Promise<{ status: number; code: string; message: string; error: string } | null> {
    for (const c of cortexComponentsOf(content).components) {
        if (c.type !== 'schema' || typeof c.key_pattern !== 'string' || !c.key_pattern) continue;
        const applyTo = c.apply_to === 'exact' ? 'exact' : 'prefix';
        const ruled = await schemaLockRefusal(deps, caller, c.key_pattern, applyTo, async () => caller.isOperator);
        if (ruled) {
            const message = `Component "${componentId}" would lock "${c.key_pattern}". ${ruled.message}`;
            return { status: ruled.status, code: ruled.code, message, error: `${ruled.code}: ${message}` };
        }
    }
    return null;
}
