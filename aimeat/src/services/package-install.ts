/**
 * @file services/package-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installing a component package: resolve the version, plan the per-instance names,
 *   register every component in dependency order, and roll back in reverse when one fails.
 *
 *   WHY THIS IS A SERVICE AND NOT A ROUTE BODY. Installing was reachable over HTTP only, so the
 *   person's own chat — which holds a real MCP token against this node — could not install a
 *   package by name. Putting an MCP tool in front that POSTs to the route would have been a second
 *   implementation of the same gate; lifting the work here means the route and the tool run the
 *   same code, and a refusal reads the same on both doors.
 *
 *   REFUSALS ARE RETURNED, NOT THROWN. Each one carries the HTTP status the route already
 *   answered, so this extraction changed no status code and no message. The route maps the union
 *   to a response; the MCP tool renders the same fields as text.
 * @structure PackageInstallResult · installPackage(deps, caller, input) · sortByDependencies ·
 *   registeredNameFor
 * @usage
 *   import { installPackage } from '../services/package-install.js';
 *   const out = await installPackage({ storage, config, scheduler }, caller, { groupId });
 * @version-history
 *   v1.0.0 — 2026-08-23 — Pure extraction out of routes/instances/install.ts so the node's own MCP
 *     surface can install a package. Behaviour, status codes and messages unchanged.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
    Storage,
    PackageRecord,
    PackageComponent,
    PackageComponentType,
    PackageInstanceRecord,
    InstalledComponent,
    ExtensionRecord,
} from '../storage/interface.js';
import {
    registerComponent,
    deleteComponent,
    fetchComponentContent,
    computeHash,
} from './component-registrar.js';
import { registerExtensionSchedules } from './extension-schedules.js';
import { emitChange } from './event-bus.js';
import type { Scheduler } from './scheduler.js';
import { logger } from '../utils/logger.js';

export interface PackageInstallDeps {
    storage: Storage;
    config: AimeatConfig;
    scheduler?: Scheduler;
}

/**
 * Who is installing. `ownerGhii` is the resolved identity everything is registered under, and
 * `sub` is the raw principal, recorded as the actor on any schedule the package brings with it.
 */
export interface PackageInstallCaller {
    owner: string;
    sub: string;
    ownerGhii: string;
}

export interface PackageInstallInput {
    groupId: string;
    label?: unknown;
    version?: unknown;
    dryRun?: boolean;
}

export interface PackageInstallPreview {
    dry_run: true;
    packageGroupId: string;
    version: string;
    componentCount: number;
    installOrder: string[];
    components: Array<{
        componentId: string;
        type: PackageComponentType;
        registeredAs: string;
        contentSize: number;
        hasContent: boolean;
        dependencies: string[];
    }>;
    label: string;
}

export type PackageInstallResult =
    | { ok: true; kind: 'dry-run'; preview: PackageInstallPreview }
    | { ok: true; kind: 'installed'; instance: PackageInstanceRecord }
    | { ok: false; status: number; code: string; message: string };

/**
 * Topological sort by component dependencies (depth-first). A component that names another in its
 * `dependencies` registers after it, which is what lets the app case rewrite a cortex or extension
 * reference to the name that component was actually registered under.
 */
function sortByDependencies(components: PackageComponent[]): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const byId = new Map(components.map(c => [c.id, c]));

    const visit = (id: string): void => {
        if (visited.has(id)) return;
        visited.add(id);
        const comp = byId.get(id);
        if (!comp) return;
        for (const dep of comp.dependencies ?? []) visit(dep);
        order.push(id);
    };

    for (const comp of components) visit(comp.id);
    return order;
}

/**
 * `{packageName}-{owner}-{shortId}-{componentId}`, plus `.html` when the component is an app and
 * its id does not already carry it.
 *
 * AN APP COMPONENT'S ID IS ITS FILENAME. Nothing between here and storage adds a suffix: the
 * registrar writes `filename: registeredAs` verbatim. But two other places decide "is this an app"
 * by looking for `.html` on that filename — the publish-time subdomain provisioning
 * (`services/app-publish.ts`) and the app-host path form (`routes/subdomains.ts`) — so a component
 * named `app-admin` installs an app that skips both: no subdomain until something opens it through
 * the apex, and a 404 on the shared path form, which is exactly the address a listing hands out for
 * an app that has no subdomain yet. `app-publish.ts` records that this same symptom "reads as a
 * broken app rather than a missing mapping", and it had already been fixed once for ordinary apps.
 *
 * Appending here rather than asking package authors to remember: it repairs every package at once,
 * it cannot be forgotten, and it is idempotent, so a package that already writes `app-shop.html`
 * passes through untouched. The COMPONENT ID does not move — dependencies and migration prompts
 * address components by id — and `ensureAppSubdomain` strips the suffix before building a label, so
 * no subdomain changes either.
 *
 * Only NEW installs. An app already installed under a bare filename keeps it.
 */
function registeredNameFor(
    packageName: string, owner: string, shortId: string,
    comp: { id: string; type: PackageComponentType },
): string {
    const base = `${packageName}-${owner}-${shortId}-${comp.id}`;
    return comp.type === 'app' && !/\.html?$/i.test(base) ? `${base}.html` : base;
}

/**
 * Install one package version for one owner.
 *
 * Authorisation happened before this call — `packages:write` on the HTTP door and the same word on
 * the MCP tool. What is decided HERE is what an authorised caller may REACH: someone else's
 * private package answers 404, in the same shape the read doors use.
 */
export async function installPackage(
    deps: PackageInstallDeps,
    caller: PackageInstallCaller,
    input: PackageInstallInput,
): Promise<PackageInstallResult> {
    const { storage, config, scheduler } = deps;
    const { owner, ownerGhii } = caller;
    const ownerGaii = ownerGhii;
    const { groupId, label, version } = input;
    const isDryRun = input.dryRun === true;

    // Resolve the target PackageRecord
    let pkg: PackageRecord | null;
    if (version && typeof version === 'string') {
        pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    } else {
        pkg = await storage.getLatestPublished(groupId);
    }

    if (!pkg) {
        return {
            ok: false, status: 404, code: 'NOT_FOUND',
            message: `Package not found: ${groupId}${version ? ` version ${version}` : ''}`,
        };
    }

    if (pkg.status !== 'published') {
        return {
            ok: false, status: 400, code: 'NOT_PUBLISHED',
            message: 'Only published packages can be installed',
        };
    }

    // Private packages only visible to author — the same refusal the three read doors make
    // (routes/packages.ts:537, :580, :607), in the same 404 shape so this door does not confirm
    // that a package exists. Published is not public: a groupId is "{name}::{author}", so anyone
    // who can guess or has seen an author's package name could install their private one and get
    // its app, cortex and extension source registered under their own identity, while GET, versions
    // and export all answered them 404.
    if (pkg.visibility === 'private' && owner !== pkg.author) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Package not found: ${groupId}` };
    }

    // Sort components by dependency order for installation
    const componentOrder = sortByDependencies(pkg.components);
    const componentMap = new Map(pkg.components.map(c => [c.id, c]));

    // Generate unique component names: {packageName}-{ownerName}-{shortId}-{componentId}
    // Short ID prevents collision when same owner installs the same package multiple times
    const shortId = randomUUID().slice(0, 8);
    const plannedComponents: InstalledComponent[] = componentOrder.map(compId => {
        const comp = componentMap.get(compId)!;
        return {
            componentId: comp.id,
            type: comp.type,
            registeredAs: registeredNameFor(pkg!.name, owner, shortId, comp),
            originalHash: comp.contentHash,
            customized: false,
        };
    });

    const instanceLabel = (typeof label === 'string' && label) ? label : `${pkg.name} instance`;

    // ── Dry run: validate without registering ────────────────────────
    if (isDryRun) {
        const validationResults = plannedComponents.map(ic => {
            const comp = componentMap.get(ic.componentId)!;
            return {
                componentId: ic.componentId,
                type: ic.type,
                registeredAs: ic.registeredAs,
                contentSize: comp.content.length,
                hasContent: comp.content.length > 0,
                dependencies: comp.dependencies,
            };
        });

        return {
            ok: true,
            kind: 'dry-run',
            preview: {
                dry_run: true,
                packageGroupId: groupId,
                version: pkg.version,
                componentCount: plannedComponents.length,
                installOrder: componentOrder,
                components: validationResults,
                label: instanceLabel,
            },
        };
    }

    // ── Real install: register each component ────────────────────────
    const registeredComponents: { componentId: string; type: PackageComponentType; registeredAs: string }[] = [];
    // Maps populated as cortex/extension components register; passed to the
    // app case in registerComponent so it can rewrite hardcoded URLs like
    // /v1/cortex/comicland-v2/libs/...  →  /v1/cortex/<registeredAs>/libs/...
    const cortexNameMap = new Map<string, string>();
    const extensionNameMap = new Map<string, string>();

    for (const compId of componentOrder) {
        const comp = componentMap.get(compId)!;
        const planned = plannedComponents.find(p => p.componentId === comp.id)!;
        const registeredAs = planned.registeredAs;

        const result = await registerComponent(storage, {
            config,
            componentId: comp.id,
            type: comp.type,
            registeredAs,
            content: comp.content,
            label: comp.label,
            owner,
            ownerGaii,
            packageName: pkg.name,
            packageCategory: pkg.category,
            packageTags: pkg.tags,
            packageDescription: pkg.description,
            urlRewrites: { cortexNames: cortexNameMap, extensionNames: extensionNameMap },
        });

        if (result.success) {
            registeredComponents.push({ componentId: comp.id, type: comp.type, registeredAs });

            // Capture the source-manifest short name so any later 'app' component
            // can have its hardcoded /v1/cortex/<name>/ and /v1/ext/<name>/ URLs
            // rewritten to the per-instance registeredAs.
            if (result.originalShortName) {
                if (comp.type === 'cortex') cortexNameMap.set(result.originalShortName, registeredAs);
                else if (comp.type === 'extension') extensionNameMap.set(result.originalShortName, registeredAs);
            }

            // Register scheduled jobs AND fire @activate-cron jobs the same way
            // the manual /v1/extensions/:name/activate route does
            // (extensions.ts ~668–698). Two steps:
            //   1) Insert each manifest __schedules entry into the scheduled_jobs
            //      table so the scheduler (and runActivateJobs lookup) can find it
            //   2) runActivateJobs(name) — fires every job whose cron === '@activate'
            //
            // Without step 1, runActivateJobs sees an empty list and bails — which
            // is exactly the bug that left Comicland's init action unrun on package
            // install, leaving config.app / config.genres / config.init missing in
            // ext-namespace memory.
            if (comp.type === 'extension' && scheduler) {
                try {
                    const ext = await storage.getExtension(registeredAs) as ExtensionRecord | null;
                    if (ext) {
                        await registerExtensionSchedules({ storage, config, scheduler }, ext, caller.sub);
                    }
                    await scheduler.runActivateJobs(registeredAs);
                } catch (err) {
                    logger.error(`Failed to register or run @activate jobs for ${registeredAs}`, { error: String(err) });
                }
            }

            // Recompute originalHash from native storage to ensure status comparisons match
            const nativeContent = await fetchComponentContent(storage, comp.type, registeredAs, ownerGaii);
            if (nativeContent !== null) {
                const nativeHash = computeHash(nativeContent);
                const plannedEntry = plannedComponents.find(p => p.componentId === comp.id);
                if (plannedEntry) plannedEntry.originalHash = nativeHash;
            }
        } else {
            // ── Rollback: delete already-registered components in reverse ──
            const rollbackErrors: string[] = [];
            for (const reg of [...registeredComponents].reverse()) {
                const deleted = await deleteComponent(storage, reg.type, reg.registeredAs, ownerGaii);
                if (!deleted) rollbackErrors.push(reg.registeredAs);
            }

            const partialRollback = rollbackErrors.length > 0;
            return {
                ok: false, status: 500, code: 'INSTALL_FAILED',
                message: `Component "${comp.id}" failed: ${result.error}. `
                    + (partialRollback
                        ? `Partial rollback — orphaned components: ${rollbackErrors.join(', ')}`
                        : 'All previously registered components rolled back successfully.'),
            };
        }
    }

    // All components registered — create instance record
    const now = new Date().toISOString();
    const instanceRecord: PackageInstanceRecord = {
        id: randomUUID(),
        packageGroupId: groupId,
        packageVersion: pkg.version,
        packageRecordId: pkg.id,
        owner,
        ownerGhii,
        label: instanceLabel,
        installedComponents: plannedComponents,
        status: 'installed',
        installedAt: now,
        updatedAt: now,
    };

    try {
        const created = await storage.createInstance(instanceRecord);

        // Increment template install count if a listing exists
        try {
            const listing = await storage.getListingByPackage(groupId);
            if (listing) await storage.incrementInstallCount(listing.id);
        } catch (err) {
            // Non-critical — install succeeds even if counter update fails
            logger.warn('label: continuing after a suppressed failure', { error: String(err) });
        }

        emitChange('instances');
        return { ok: true, kind: 'installed', instance: created };
    } catch (e) {
        // Instance record creation failed — rollback all registered components
        for (const reg of [...registeredComponents].reverse()) {
            await deleteComponent(storage, reg.type, reg.registeredAs, ownerGaii);
        }
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 500, code: 'INSTALL_FAILED', message: msg || 'Failed to create instance' };
    }
}
