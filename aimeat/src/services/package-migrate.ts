/**
 * @file services/package-migrate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moving one installed package onto another version: replace a component, keep the
 *   one the owner edited, take a merged version, install a part the new version adds.
 *
 *   WHY THIS IS A SERVICE. Two doors need it — the migration the owner drives component by
 *   component, and the one act that updates a whole instance — and a second copy of this loop is a
 *   second copy of the decision about whose bytes survive.
 *
 *   THREE THINGS THE EXTRACTION FIXED, each of which had produced a broken install in silence:
 *
 *   1. THE URL REWRITES WERE NOT REPEATED. An app component's source is rewritten at install time so
 *      `/v1/cortex/<author's name>/` points at THIS instance's copy. Every registerComponent call
 *      here was made without `urlRewrites`, so an updated app went back to the author's names and
 *      404ed its own library the moment it was updated. The map is rebuilt from the instance.
 *   2. A NEW COMPONENT GOT A NAME NOTHING COULD ADDRESS. `install_new` built
 *      `{package}-{owner}-{componentId}`, missing the instance's short id and the `.html` an app
 *      needs to be given an address at all. The instance's own short id is recovered from a name it
 *      already carries.
 *   3. A FAILED REGISTRATION WAS RECORDED AS A SUCCESS. `if (!result.success) {}` was an empty
 *      block, and the component was written into the instance either way — so a refused component
 *      left the instance claiming to hold something that is not there, with the old copy already
 *      deleted. A failure now keeps the previous entry and is reported.
 * @structure MigrationAction · MigrationRequest · MigrateOutcome · PackageMigrateResult ·
 *   applyInstanceMigration(deps, caller, input)
 * @usage
 *   import { applyInstanceMigration } from '../services/package-migrate.js';
 *   const out = await applyInstanceMigration({ storage, config }, caller, { instanceId, targetVersion, actions });
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/instances/migration.ts, plus the three fixes.
 */
import YAML from 'yaml';
import type { AimeatConfig } from '../config.js';
import type {
    Storage, InstalledComponent, PackageComponent, PackageComponentType, PackageRecord,
    PackageInstanceRecord,
} from '../storage/interface.js';
import {
    registerComponent, validateComponentContent, deleteComponent, computeHash,
} from './component-registrar.js';
import { registeredNameFor } from './package-install.js';
import { planInstanceUpdate } from './package-update-plan.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

export const MIGRATION_ACTIONS = ['replace', 'skip', 'custom', 'install_new'] as const;
export type MigrationAction = (typeof MIGRATION_ACTIONS)[number];

export interface MigrationRequest {
    componentId: string;
    action: MigrationAction;
    content?: string;
}

export interface MigrateOutcome {
    migrated: boolean;
    updatedComponents: string[];
    newComponents: string[];
    skippedComponents: string[];
    /** A component whose registration was refused. Its previous copy is left in place. */
    failedComponents: { componentId: string; error: string }[];
    newVersion: string;
}

export type PackageMigrateResult =
    | { ok: true; outcome: MigrateOutcome }
    | { ok: false; status: number; code: string; message: string };

/** One component the owner has edited, and the door that merges it. */
export interface NeedsYouEntry {
    componentId: string;
    type: PackageComponentType;
    reason: string;
    mergeWith: string;
}

export interface InstanceUpdateAnswer {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    changelog: string | null;
    dryRun: boolean;
    willUpdate: string[];
    needsYou: NeedsYouEntry[];
    /** Components the new version no longer has. Reported, never removed by this act. */
    removed: { componentId: string; type: PackageComponentType }[];
    applied: MigrateOutcome | null;
}

export type InstanceUpdateResult =
    | { ok: true; answer: InstanceUpdateAnswer }
    | { ok: false; status: number; code: string; message: string };

export interface PackageMigrateDeps { storage: Storage; config: AimeatConfig }
export interface PackageMigrateCaller { owner: string; ownerGhii: string; sub: string }

export interface PackageMigrateInput {
    instanceId: string;
    targetVersion: string;
    actions: MigrationRequest[];
}

/**
 * The instance's own short id, from a name it already carries.
 *
 * Every component of one instance was registered as `{package}-{owner}-{shortId}-{componentId}`, so
 * any of them will do. Returns null for an instance installed before that scheme, and the caller
 * then falls back to the older name shape rather than inventing an id that would not match its
 * siblings.
 */
function instanceShortId(instance: PackageInstanceRecord, packageName: string, owner: string): string | null {
    const prefix = `${packageName}-${owner}-`;
    for (const ic of instance.installedComponents) {
        if (!ic.registeredAs.startsWith(prefix)) continue;
        const rest = ic.registeredAs.slice(prefix.length);
        const candidate = rest.slice(0, 8);
        if (/^[0-9a-f]{8}$/.test(candidate) && rest.charAt(8) === '-') return candidate;
    }
    return null;
}

/**
 * The short name a cortex or extension component was published under.
 *
 * Read from `originalShortName` when the instance carries it. Instances installed before that field
 * existed fall back to the package's own manifest, which is where the registrar read it the first
 * time.
 */
function shortNameOf(installed: InstalledComponent, comp: PackageComponent | undefined): string | null {
    if (installed.originalShortName) return installed.originalShortName;
    if (!comp) return null;
    try {
        const parsed = JSON.parse(comp.content) as { manifest?: string };
        const manifestStr = parsed.manifest ?? comp.content;
        const meta = (YAML.parse(manifestStr) ?? {}) as Record<string, unknown>;
        const metadata = (meta.metadata ?? meta) as Record<string, unknown>;
        return (metadata.name as string) || null;
    } catch (err) {
        logger.warn('package-migrate: could not read a component short name, rewrites may be incomplete',
            { component: installed.componentId, error: String(err) });
        return null;
    }
}

/**
 * Rebuild the rewrite maps this instance's app components were installed with.
 *
 * Without these an updated app keeps the package author's cortex and extension names and 404s its
 * own library. The maps are keyed on the name the SOURCE uses and valued with what this instance
 * registered it as.
 */
function rewritesFor(
    instance: PackageInstanceRecord, pkg: PackageRecord,
): { cortexNames: Map<string, string>; extensionNames: Map<string, string> } {
    const byId = new Map(pkg.components.map(c => [c.id, c]));
    const cortexNames = new Map<string, string>();
    const extensionNames = new Map<string, string>();

    for (const ic of instance.installedComponents) {
        if (ic.type !== 'cortex' && ic.type !== 'extension') continue;
        const short = shortNameOf(ic, byId.get(ic.componentId));
        if (!short) continue;
        if (ic.type === 'cortex') cortexNames.set(short, ic.registeredAs);
        else extensionNames.set(short, ic.registeredAs);
    }
    return { cortexNames, extensionNames };
}

/**
 * Apply a set of per-component decisions and move the instance onto the target version.
 *
 * Authorisation happened before this call. What is decided HERE is that only the instance's owner
 * may migrate it, and that content the node would refuse is refused BEFORE the existing component
 * is deleted, which is the ordering the route has held since 2026-08-10.
 */
export async function applyInstanceMigration(
    deps: PackageMigrateDeps,
    caller: PackageMigrateCaller,
    input: PackageMigrateInput,
): Promise<PackageMigrateResult> {
    const { storage, config } = deps;
    const { owner, ownerGhii } = caller;
    const { instanceId, targetVersion, actions } = input;

    if (!targetVersion || typeof targetVersion !== 'string') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'targetVersion is required' };
    }
    if (!Array.isArray(actions) || actions.length === 0) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'components must be an array of { componentId, action, content? }',
        };
    }

    const instance = await storage.getInstance(instanceId);
    if (!instance) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    }
    if (instance.owner !== owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the instance owner can apply migrations' };
    }

    const targetPkg = await storage.getPackageByGroupAndVersion(instance.packageGroupId, targetVersion);
    if (!targetPkg) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Target version not found: ${targetVersion}` };
    }

    const installedPkg = await storage.getPackage(instance.packageRecordId);
    const targetCompMap = new Map(targetPkg.components.map(c => [c.id, c]));
    const existingMap = new Map(instance.installedComponents.map(ic => [ic.componentId, ic]));

    // Built once from the instance, and handed to every registration below.
    const urlRewrites = rewritesFor(instance, installedPkg ?? targetPkg);
    const shortId = instanceShortId(instance, targetPkg.name, owner);

    /** The name a component of THIS instance is registered under. */
    const nameFor = (compId: string, type: PackageComponentType): string => {
        const existing = existingMap.get(compId);
        if (existing) return existing.registeredAs;
        return shortId
            ? registeredNameFor(targetPkg.name, owner, shortId, { id: compId, type })
            : `${targetPkg.name}-${owner}-${compId}`;
    };

    const updatedComponents: string[] = [];
    const newComponents: string[] = [];
    const skippedComponents: string[] = [];
    const failedComponents: { componentId: string; error: string }[] = [];
    const newInstalledComponents: InstalledComponent[] = [];

    // Refuse content this node will not accept BEFORE anything is deleted. `replace` and `custom`
    // both delete the existing component and then register the new one.
    for (const action of actions) {
        const compId = action?.componentId;
        if (!compId || typeof compId !== 'string') continue;
        if (!(MIGRATION_ACTIONS as readonly string[]).includes(action.action)) {
            return {
                ok: false, status: 400, code: 'INVALID_INPUT',
                message: `Invalid action "${action.action}" for component "${compId}". Valid: ${MIGRATION_ACTIONS.join(', ')}`,
            };
        }
        if (action.action !== 'replace' && action.action !== 'custom') continue;

        const targetComp = targetCompMap.get(compId);
        const existingComp = existingMap.get(compId);
        const compType = targetComp?.type ?? existingComp?.type ?? 'csm';
        const proposed = action.content ?? targetComp?.content ?? '';
        const check = validateComponentContent(compType, proposed, nameFor(compId, compType), config, owner);
        if (!check.ok) {
            return {
                ok: false, status: 400, code: 'INVALID_COMPONENT',
                message: `Component "${compId}" was not applied: ${check.error}`,
            };
        }
    }

    for (const action of actions) {
        const compId = action?.componentId;
        if (!compId || typeof compId !== 'string') continue;

        const targetComp = targetCompMap.get(compId);
        const existing = existingMap.get(compId);
        const type = targetComp?.type ?? existing?.type ?? 'csm';

        switch (action.action) {
            case 'skip': {
                if (existing) newInstalledComponents.push({ ...existing });
                skippedComponents.push(compId);
                break;
            }

            case 'replace':
            case 'custom': {
                const isCustom = action.action === 'custom';
                const newContent = action.content ?? targetComp?.content ?? '';
                const registeredAs = nameFor(compId, type);

                if (existing) await deleteComponent(storage, existing.type, registeredAs, ownerGhii);

                const result = await registerComponent(storage, {
                    config,
                    componentId: compId,
                    type,
                    registeredAs,
                    content: newContent,
                    label: targetComp?.label ?? compId,
                    owner,
                    ownerGaii: ownerGhii,
                    packageName: targetPkg.name,
                    packageCategory: targetPkg.category,
                    packageTags: targetPkg.tags,
                    packageDescription: targetPkg.description,
                    meta: targetComp?.meta,
                    callerGaii: caller.sub,
                    urlRewrites,
                });

                if (!result.success) {
                    // The old copy was already deleted, so there is nothing to keep; saying so is the
                    // only honest answer, and the instance keeps no entry claiming it is there.
                    failedComponents.push({ componentId: compId, error: result.error ?? 'registration failed' });
                    break;
                }

                newInstalledComponents.push({
                    componentId: compId,
                    type,
                    registeredAs,
                    originalHash: targetComp?.contentHash ?? computeHash(newContent),
                    customized: isCustom && !!action.content,
                    ...(result.originalShortName ? { originalShortName: result.originalShortName } : {}),
                });
                updatedComponents.push(compId);
                break;
            }

            case 'install_new': {
                if (!targetComp) break;
                const registeredAs = nameFor(compId, targetComp.type);

                const result = await registerComponent(storage, {
                    config,
                    componentId: compId,
                    type: targetComp.type,
                    registeredAs,
                    content: targetComp.content,
                    label: targetComp.label,
                    owner,
                    ownerGaii: ownerGhii,
                    packageName: targetPkg.name,
                    packageCategory: targetPkg.category,
                    packageTags: targetPkg.tags,
                    packageDescription: targetPkg.description,
                    meta: targetComp.meta,
                    callerGaii: caller.sub,
                    urlRewrites,
                });

                if (!result.success) {
                    failedComponents.push({ componentId: compId, error: result.error ?? 'registration failed' });
                    break;
                }

                newInstalledComponents.push({
                    componentId: compId,
                    type: targetComp.type,
                    registeredAs,
                    originalHash: targetComp.contentHash,
                    customized: false,
                    ...(result.originalShortName ? { originalShortName: result.originalShortName } : {}),
                });
                newComponents.push(compId);
                break;
            }
        }
    }

    // Anything the actions did not mention keeps its entry untouched.
    for (const ic of instance.installedComponents) {
        if (!actions.some(a => a?.componentId === ic.componentId)) newInstalledComponents.push({ ...ic });
    }

    const updated = await storage.updateInstance(instanceId, {
        packageVersion: targetVersion,
        packageRecordId: targetPkg.id,
        installedComponents: newInstalledComponents,
        updatedAt: new Date().toISOString(),
    });

    if (!updated) {
        return { ok: false, status: 500, code: 'MIGRATION_FAILED', message: 'Failed to update instance record' };
    }

    emitChange('instances');

    return {
        ok: true,
        outcome: {
            migrated: true,
            updatedComponents,
            newComponents,
            skippedComponents,
            failedComponents,
            newVersion: targetVersion,
        },
    };
}

/**
 * Move a whole installed package onto its latest version in one act.
 *
 * WHAT IT WILL NOT DO IS THE FEATURE. A component the owner has edited is left exactly as it is and
 * reported in `needsYou` with the address of the prompt that merges it; a component the new version
 * DROPPED is reported and left alone, because deleting somebody's copy of something deserves to be
 * asked for rather than done as a side effect of pressing update. Everything else moves.
 *
 * `dryRun` answers the same shape and writes nothing, so a page or a chat can say "three update, one
 * needs you" before anybody commits to it.
 */
export async function updateInstanceToLatest(
    deps: PackageMigrateDeps,
    caller: PackageMigrateCaller,
    input: { instanceId: string; dryRun?: boolean },
): Promise<InstanceUpdateResult> {
    const { instanceId } = input;
    const dryRun = input.dryRun === true;

    const planned = await planInstanceUpdate(
        { storage: deps.storage }, { owner: caller.owner, ownerGhii: caller.ownerGhii }, instanceId,
    );
    if (!planned.ok) return planned;

    const { plan } = planned;

    const needsYou: NeedsYouEntry[] = plan.componentDiffs
        .filter(d => d.action === 'migration_needed')
        .map(d => ({
            componentId: d.componentId,
            type: d.type,
            reason: 'You have edited this one, so an update would overwrite your work.',
            mergeWith: `/v1/instances/${instanceId}/migration-prompt`,
        }));

    const removed = plan.componentDiffs
        .filter(d => d.action === 'remove')
        .map(d => ({ componentId: d.componentId, type: d.type }));

    const actions: MigrationRequest[] = plan.componentDiffs
        .filter(d => d.action === 'safe_overwrite' || d.action === 'install_new')
        .map(d => ({
            componentId: d.componentId,
            action: d.action === 'install_new' ? 'install_new' : 'replace',
        }));

    const answer: InstanceUpdateAnswer = {
        currentVersion: plan.currentVersion,
        latestVersion: plan.latestVersion,
        updateAvailable: plan.updateAvailable,
        changelog: plan.changelog,
        dryRun,
        willUpdate: actions.map(a => a.componentId),
        needsYou,
        removed,
        applied: null,
    };

    // Nothing is applied when there is nothing safe to apply. An instance whose every changed
    // component the owner edited answers here, with the list of what to merge.
    if (!plan.updateAvailable || dryRun || actions.length === 0) {
        return { ok: true, answer };
    }

    const out = await applyInstanceMigration(deps, caller, {
        instanceId, targetVersion: plan.latestVersion, actions,
    });
    if (!out.ok) return out;

    return { ok: true, answer: { ...answer, applied: out.outcome } };
}
