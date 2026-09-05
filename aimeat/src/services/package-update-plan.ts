/**
 * @file services/package-update-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What updating one installed package would do: which components changed, which of
 *   them the owner has edited, and which are new or gone.
 *
 *   WHY THIS IS A SERVICE. The diff was written inside GET /v1/instances/:id/check-update, and the
 *   act that applies it needs exactly the same answer. Two copies would drift, and the copy that
 *   drifted would be the one deciding whether to overwrite somebody's work.
 *
 *   THE CUSTOMISATION FLAG IS RECOMPUTED, NOT READ. `InstalledComponent.customized` is only
 *   refreshed when somebody opens GET /v1/instances/:id/status, so a component the owner edited an
 *   hour ago still reads `customized: false` and the diff called it a safe overwrite. Anything built
 *   on that answer is a silent-overwrite button. The live content is hashed here, for the components
 *   whose bytes actually changed upstream, which is the only place the flag decides anything.
 * @structure ComponentDiff · UpdatePlan · UpdatePlanResult · planInstanceUpdate(deps, caller, id)
 * @usage
 *   import { planInstanceUpdate } from '../services/package-update-plan.js';
 *   const out = await planInstanceUpdate({ storage }, caller, instanceId);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/instances/manage.ts, plus the live-hash fix.
 */
import type {
    Storage, PackageComponentType, PackageInstanceRecord, PackageRecord,
} from '../storage/interface.js';
import { fetchComponentContent, computeHash } from './component-registrar.js';

export interface ComponentDiff {
    componentId: string;
    type: PackageComponentType;
    status: 'unchanged' | 'updated' | 'new' | 'removed';
    action: 'no_change' | 'safe_overwrite' | 'migration_needed' | 'install_new' | 'remove';
    customized?: boolean;
}

export interface UpdatePlan {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    changelog: string | null;
    componentDiffs: ComponentDiff[];
}

export type UpdatePlanResult =
    | { ok: true; plan: UpdatePlan; instance: PackageInstanceRecord; latest: PackageRecord }
    | { ok: false; status: number; code: string; message: string };

export interface UpdatePlanDeps { storage: Storage }

export interface UpdatePlanCaller { owner: string; ownerGhii: string }

/**
 * Read what an update would do. Writes nothing.
 *
 * Authorisation happened before this call; what is decided HERE is that only the instance's owner
 * may read its plan, in the same shape the route has always answered.
 */
export async function planInstanceUpdate(
    deps: UpdatePlanDeps,
    caller: UpdatePlanCaller,
    instanceId: string,
): Promise<UpdatePlanResult> {
    const { storage } = deps;

    const instance = await storage.getInstance(instanceId);
    if (!instance) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    }
    if (instance.owner !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the instance owner can check for updates' };
    }

    const latest = await storage.getLatestPublished(instance.packageGroupId);
    if (!latest) {
        return {
            ok: false, status: 404, code: 'NOT_FOUND',
            message: `No published version found for package ${instance.packageGroupId}`,
        };
    }

    const currentVersion = instance.packageVersion;
    const latestVersion = latest.version;

    if (currentVersion === latestVersion) {
        return {
            ok: true, instance, latest,
            plan: { currentVersion, latestVersion, updateAvailable: false, changelog: null, componentDiffs: [] },
        };
    }

    const currentPkg = await storage.getPackage(instance.packageRecordId);
    const oldComponents = new Map((currentPkg?.components ?? []).map(c => [c.id, c]));
    const newComponents = new Map(latest.components.map(c => [c.id, c]));
    const installedMap = new Map(instance.installedComponents.map(ic => [ic.componentId, ic]));

    const componentDiffs: ComponentDiff[] = [];

    for (const [compId, newComp] of newComponents) {
        const oldComp = oldComponents.get(compId);
        const installed = installedMap.get(compId);

        if (!oldComp) {
            componentDiffs.push({ componentId: compId, type: newComp.type, status: 'new', action: 'install_new' });
            continue;
        }
        if (oldComp.contentHash === newComp.contentHash) {
            componentDiffs.push({ componentId: compId, type: newComp.type, status: 'unchanged', action: 'no_change' });
            continue;
        }

        // The upstream bytes changed, so whether the owner also changed theirs decides between an
        // overwrite and a migration. Read it live rather than from the stored flag.
        let isCustomized = installed?.customized ?? false;
        if (installed) {
            const live = await fetchComponentContent(storage, installed.type, installed.registeredAs, caller.ownerGhii);
            // A component whose content cannot be read back tells us nothing; the stored flag stands,
            // and the migration path is the safe side of that uncertainty.
            if (live !== null) isCustomized = computeHash(live) !== installed.originalHash;
        }

        componentDiffs.push({
            componentId: compId,
            type: newComp.type,
            status: 'updated',
            action: isCustomized ? 'migration_needed' : 'safe_overwrite',
            customized: isCustomized,
        });
    }

    for (const [compId, oldComp] of oldComponents) {
        if (!newComponents.has(compId)) {
            componentDiffs.push({ componentId: compId, type: oldComp.type, status: 'removed', action: 'remove' });
        }
    }

    return {
        ok: true, instance, latest,
        plan: { currentVersion, latestVersion, updateAvailable: true, changelog: latest.changelog, componentDiffs },
    };
}
