/**
 * @file src/services/install-quotas.ts
 * @description How many of a thing one node and one owner may hold.
 *
 *   Three ceilings, and each of them was written out twice for a while: once in the HTTP route and
 *   once in the MCP tool beside it. That is the failure the whole August 2026 audit exists to
 *   prevent, and it is easy to reintroduce while FIXING it — the tool was missing the cap, so the
 *   quickest repair is to paste the cap in, and now the number agrees today and diverges the next
 *   time either copy is touched.
 *
 *   Nobody notices a divergence here quickly. A ceiling is a thing that holds for years and then one
 *   day does not, and the person who raises the limit raises the copy in front of them.
 * @structure
 *   - extensionInstallRefusal() — the node-wide and per-owner extension ceilings
 *   - appQuotaRefusal() — the per-owner published-app ceiling
 *   - cortexInstallRefusal() — the node-wide cortex ceiling
 * @usage
 *   const refusal = await extensionInstallRefusal({ storage, config }, ownerName, isOperator);
 *   if (refusal) return fail(refusal.message);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the audit's own diff was checked for duplication and these
 *     three were found copied into the tool surface rather than shared.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export interface QuotaRefusal {
    status: number;
    code: 'LIMIT_EXCEEDED' | 'EXTENSION_LIMIT' | 'QUOTA_EXCEEDED';
    message: string;
}

/**
 * May this owner install one more extension?
 *
 * Two ceilings: the node holds at most `extensionMaxInstalled` in total, and one owner at most
 * `maxExtensionsPerOwner`. An operator bypasses the per-owner one and not the node one. Only a NEW
 * name counts against either — replacing your own extension in place adds nothing.
 */
export async function extensionInstallRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    ownerName: string,
    isOperator: boolean,
): Promise<QuotaRefusal | null> {
    const { storage, config } = deps;
    const installed = await storage.listExtensions();

    if (installed.length >= config.extensionMaxInstalled) {
        return { status: 409, code: 'LIMIT_EXCEEDED', message: `Maximum ${config.extensionMaxInstalled} extensions allowed` };
    }
    if (!isOperator) {
        const mine = installed.filter(e => e.installedBy === ownerName);
        if (mine.length >= config.maxExtensionsPerOwner) {
            return { status: 429, code: 'EXTENSION_LIMIT', message: `Maximum ${config.maxExtensionsPerOwner} extensions per owner` };
        }
    }
    return null;
}

/** May this principal publish or fork one more app? `maxAppsPerAgent` of 0 means no ceiling. */
export async function appQuotaRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    callerGhii: string,
): Promise<QuotaRefusal | null> {
    const { storage, config } = deps;
    if (config.maxAppsPerAgent <= 0) return null;
    const { total } = await storage.listApps({ ownerGaii: callerGhii, limit: 1 });
    if (total >= config.maxAppsPerAgent) {
        return { status: 429, code: 'QUOTA_EXCEEDED', message: `You have reached the maximum of ${config.maxAppsPerAgent} published apps` };
    }
    return null;
}

/** May this node hold one more cortex? Replacing an existing one adds nothing, so pass `isNew`. */
export async function cortexInstallRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    isNew: boolean,
): Promise<QuotaRefusal | null> {
    const { storage, config } = deps;
    if (!isNew) return null;
    const installed = await storage.listCortexExtensions();
    if (installed.length >= config.cortexMaxInstalled) {
        return {
            status: 413, code: 'QUOTA_EXCEEDED',
            message: `Maximum ${config.cortexMaxInstalled} cortex extensions allowed. Uninstall unused extensions first.`,
        };
    }
    return null;
}
