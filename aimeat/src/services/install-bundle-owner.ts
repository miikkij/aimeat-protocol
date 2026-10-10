/**
 * @file services/install-bundle-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person installs a set they bought, for themselves (docs/specs/package-sale-design.md,
 *   section 4, "The install side needs one split"). The owner part of an install set: the bundle's
 *   packages, its organisms and workspaces under the person's own names, and each app told where its
 *   workspace is. No account is made and nobody else is brought in: that is node work, which stays
 *   the operator's install set (install-set-apply.ts) and calls the same parts.
 *
 *   ONE DOOR. Installing a package that carries an install bundle runs this instead of registering the
 *   bundle record as a memory part (POST /v1/packages/:groupId/install and aimeat_package_install), so
 *   a person's own AI installs a set the way it installs a package.
 *
 *   THE SAME RULES AS A PACKAGE. Each package installs through installOrRequest with the caller's own
 *   session, so a package with code waits for the owner when an agent lacks packages:install-code, and
 *   a part that writes the owner's memory asks what the memory door asks. A set that makes organisms
 *   asks organism:write of an agent, the word POST /v1/organisms asks. A step that waits for the owner
 *   stops the install there; installing the set again continues, and creates nothing twice, because
 *   what was made is kept in the same record an install set keeps.
 * @structure bundleInstallOf() · installSetForOwner()
 * @version-history
 *   v1.2.0 — 2026-10-10 — The record's applied_by is the owner's GHII, and the set's pulls no longer
 *     say they are an install set's, so with package federation off an owner's set install cannot pull
 *     from a peer (secaudit 2026-10-10, I18).
 *   v1.1.1 — 2026-10-05 — The owner test is isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.1.0 — 2026-10-04 — `grantApps` passes to each package's install, whose answer the record keeps
 *     in `app_grants`; the plan names each package's apps and whether the install approves them.
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 4).
 */
import type { InstallBundle } from './install-set-spec.js';
import { bundleOfComponents } from './install-set-spec.js';
import { getPackageFor } from './packages/compose/package-read.js';
import { installOrRequest, type PackageActCaller } from './packages/install/package-install-requests.js';
import { installPackage } from './packages/install/package-install.js';
import { checkWorkspaceManifest } from './workspace-provision.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import {
    reach, localGroupOf, installedInstanceOf, readRecord, writeRecord, appliedRecordKey,
    newAppliedRecord, createOrganisms, linkAppsToWorkspaces, type ApplyDeps, type AppliedRecord,
} from './install-set-apply.js';

export interface SetInstallInput {
    groupId: string;
    /** Config per package group, then per component id, over the bundle's defaults. */
    config?: unknown;
    /** The person's own organism names, by the bundle's organism key. */
    organismNames?: unknown;
    dryRun?: boolean;
    /** Approve the set's apps at install; absent: each package's own default (installOrRequest). */
    grantApps?: unknown;
}

export type SetInstallResult =
    | { ok: true; kind: 'set-plan'; plan: Record<string, unknown> }
    | { ok: true; kind: 'set-installed'; record: AppliedRecord; warnings: string[]; agents_proposed: unknown[] }
    | { ok: true; kind: 'set-waiting'; record: AppliedRecord; requests: Array<{ group_id: string; request_id: string }> }
    | { ok: false; status: number; code: string; message: string; problems?: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The bundle a package carries, for a caller who may read it; null when it is an ordinary package. */
export async function bundleInstallOf(deps: ApplyDeps, groupId: string, owner: string): Promise<{ bundle: InstallBundle; remote: string | null } | { error: string } | null> {
    const pkg = await getPackageFor(deps.storage, groupId, owner);
    if (!pkg) return null;
    const parsed = bundleOfComponents(pkg.components);
    if (!parsed) return null;
    if (!parsed.ok) return { error: parsed.message };
    return { bundle: parsed.value, remote: pkg.upstream?.node ?? null };
}

/** Install (or with dryRun, plan) the set `groupId` carries, for the caller's owner. */
export async function installSetForOwner(deps: ApplyDeps, caller: PackageActCaller, input: SetInstallInput): Promise<SetInstallResult> {
    const { storage } = deps;
    const found = await bundleInstallOf(deps, input.groupId, caller.owner);
    if (!found) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Package not found: ${input.groupId}` };
    if ('error' in found) return { ok: false, status: 400, code: 'INVALID_BUNDLE', message: found.error };
    const { bundle } = found;
    const remote = found.remote ? { nodeId: found.remote } : null;
    const owner = caller.owner;
    const names = isObj(input.organismNames) ? input.organismNames : {};
    const setConfig = isObj(input.config) ? input.config : {};
    for (const g of Object.keys(setConfig)) {
        if (!bundle.packages.some(p => p.groupId === g)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `config names package "${g}", which the set does not list.` };
    }
    if (bundle.organisms.length && !isOwnerInPerson(caller) && !scopeIsCovered(caller.scopes, 'organism:write')) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: 'This set makes organisms for your owner, which needs organism:write. Ask your owner to grant it, or to install the set themselves.' };
    }

    const problems: string[] = [];
    const planned: Array<{ group_id: string; local_group_id: string; result: string; apps?: unknown; app_approval?: unknown }> = [];
    for (const org of bundle.organisms) {
        for (const ws of org.workspaces) {
            const why = await checkWorkspaceManifest(storage, 'set-install-check', ws.name, ws.manifest);
            if (why) problems.push(`Workspace "${org.key}/${ws.key}": ${why}`);
        }
    }
    const configOf = (groupId: string, defaults: Record<string, Record<string, unknown>>) => {
        const out: Record<string, Record<string, unknown>> = {};
        const given = isObj(setConfig[groupId]) ? setConfig[groupId] as Record<string, unknown> : {};
        for (const layer of [defaults, given]) {
            for (const [component, values] of Object.entries(layer)) if (isObj(values)) out[component] = { ...(out[component] ?? {}), ...values };
        }
        return out;
    };
    for (const pkg of bundle.packages) {
        const local = localGroupOf(pkg.groupId, owner, !!remote);
        if (await installedInstanceOf(storage, owner, local)) { planned.push({ group_id: pkg.groupId, local_group_id: local, result: 'present' }); continue; }
        // No `installSet`: the owner's pulls meet the package federation switch (secaudit 2026-10-10, I18).
        const got = await reach(deps, owner, remote, pkg.groupId, { preview: true, installSet: false });
        if (!got.ok) { problems.push(got.message); continue; }
        if (!got.local) { planned.push({ group_id: pkg.groupId, local_group_id: local, result: 'would_pull' }); continue; }
        const dry = await installPackage(deps, caller, { groupId: local, mode: pkg.mode, config: configOf(pkg.groupId, pkg.config), dryRun: true });
        if (!dry.ok) problems.push(`${pkg.groupId}: ${dry.code}: ${dry.message}`);
        else if (dry.kind === 'dry-run') {
            for (const e of dry.preview.config) {
                const missing = (e.missing as Array<{ field: string }> | undefined) ?? [];
                if (missing.length) problems.push(`${pkg.groupId}: CONFIG_REQUIRED: ${String(e.component_id)} needs ${missing.map(m => m.field).join(', ')}`);
            }
        }
        // What each app will ask for, and whether the install approves it by itself: what the person
        // decides on with `grant_apps`.
        const preview = dry.ok && dry.kind === 'dry-run' ? dry.preview : null;
        planned.push({ group_id: pkg.groupId, local_group_id: local, result: 'would_install',
            ...(preview?.app_approval ? { apps: preview.capabilities.apps, app_approval: preview.app_approval } : {}) });
    }
    if (input.dryRun) {
        return {
            ok: true, kind: 'set-plan', plan: {
                bundle: { group_id: input.groupId, name: bundle.name },
                packages: planned,
                organisms: bundle.organisms.map(o => ({ key: o.key, name: typeof names[o.key] === 'string' ? names[o.key] : o.name, workspaces: o.workspaces.map(w => w.key) })),
                agents: bundle.agents.map(a => ({ group_id: a.groupId, app: a.app, agent: a.agent })),
                problems,
            },
        };
    }
    if (problems.length) return { ok: false, status: 409, code: 'CANNOT_INSTALL_SET', message: 'The set was not installed, and nothing was made. Each problem names its package.', problems };

    // applied_by is the owner's GHII, never the bare account name: the bare name "startup" read as the
    // start-up apply's record in install-set-trust.ts (secaudit 2026-10-10, I18).
    const key = appliedRecordKey(owner, input.groupId);
    const record = (await readRecord(storage, key)) ?? newAppliedRecord(owner, { group_id: input.groupId, local_group_id: input.groupId, node_id: remote?.nodeId ?? null, version: '', name: bundle.name }, caller.ownerGhii);
    record.applied_by = caller.ownerGhii;
    record.applied_at = new Date().toISOString();
    record.runs += 1;
    const warnings: string[] = [];
    const proposed: unknown[] = [];
    const requests: Array<{ group_id: string; request_id: string }> = [];
    try {
        for (const pkg of bundle.packages) {
            const local = localGroupOf(pkg.groupId, owner, !!remote);
            const present = await installedInstanceOf(storage, owner, local);
            if (present) { record.packages[pkg.groupId] = { group_id: pkg.groupId, local_group_id: local, instance_id: present.id, result: 'present', mode: present.mode ?? 'editable' }; continue; }
            const got = await reach(deps, owner, remote, pkg.groupId, { preview: false, installSet: false });
            if (!got.ok) throw new Error(got.message);
            const out = await installOrRequest(deps, caller, { groupId: local, mode: pkg.mode, config: configOf(pkg.groupId, pkg.config), label: bundle.name, grantApps: input.grantApps });
            if (!out.ok) throw new Error(`${pkg.groupId}: ${out.code}: ${out.message}`);
            if (out.kind === 'requested') { requests.push({ group_id: pkg.groupId, request_id: out.request.id }); continue; }
            if (out.kind !== 'installed') continue;
            if (out.appGrants) record.app_grants = { ...(record.app_grants ?? {}), ...out.appGrants };
            warnings.push(...out.warnings.map(w => `${pkg.groupId}: ${w}`));
            proposed.push(...(out.agentsProposed ?? []));
            record.packages[pkg.groupId] = { group_id: pkg.groupId, local_group_id: local, instance_id: out.instance.id, result: 'installed', mode: pkg.mode, ...(out.warnings.length ? { warnings: out.warnings } : {}) };
        }
        if (requests.length) {
            await writeRecord(storage, key, record);
            return { ok: true, kind: 'set-waiting', record, requests };
        }
        await createOrganisms(deps, owner, names as Record<string, string>, bundle, record);
        await linkAppsToWorkspaces(deps, owner, bundle, record);
    } catch (err) {
        await writeRecord(storage, key, record);
        return { ok: false, status: 500, code: 'SET_INSTALL_FAILED', message: `The set was installed in part: ${err instanceof Error ? err.message : String(err)}. What was made is recorded, and installing the set again continues from there.` };
    }
    await writeRecord(storage, key, record);
    return { ok: true, kind: 'set-installed', record, warnings, agents_proposed: proposed };
}
