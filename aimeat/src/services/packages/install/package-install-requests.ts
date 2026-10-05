/**
 * @file src/services/packages/install/package-install-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package installs by agents: an install, an update or a migration the caller cannot
 *   finish alone becomes a request the owner answers, instead of a refusal.
 *
 *   WHY. A package installs under the OWNER whoever presses install, so a memory part writes into the
 *   owner's memory, and the memory door asks an agent memory:write and memory:write-as-owner for that
 *   (an app grant memory:write). Most agents hold packages:write and not those two, so an agent asked
 *   to take a package into use could only answer "I may not". Jouni's words: "When an agent lacks it,
 *   the install becomes a request that the owner approves with one tap. It never simply fails."
 *
 *   ONE IMPLEMENTATION, EVERY DOOR. The HTTP doors (install, update, apply-migration, the request
 *   doors) and the MCP tools call these functions; neither decides anything the other does not.
 *
 *   THE ASK. installOrRequest / updateOrRequest / migrateOrRequest run the ordinary act first. Only a
 *   refusal for missing memory words from an agent or an app grant turns into a request, and only
 *   after every other check has passed, so the owner is never asked to approve something the node
 *   would then refuse. Every other refusal is returned as it was.
 *
 *   THE ANSWER. decideInstallRequest: who may decide is package-install-request-policy.ts (the owner
 *   in person; an agent of theirs that did not ask and holds the words). Then the request is
 *   re-validated (still waiting, not expired, the package version and the installed copy are what
 *   they were when it was asked) and the act runs AS THE OWNER, through the same install and
 *   migration code, all or nothing where that code is. A request that can no longer be carried out
 *   as asked is settled `outdated` and never approved into something else.
 * @structure PackageActCaller · RequestedAnswer · requestedBody · installOrRequest · updateOrRequest ·
 *   migrateOrRequest · listRequestsFor · readRequestFor · decideInstallRequest
 * @usage
 *   const out = await installOrRequest({ storage, config, scheduler }, caller, { groupId, label });
 *   if (out.ok && out.kind === 'requested') res.status(202).json(success(nodeId, requestedBody(out)));
 * @version-history
 *   v1.4.1 — 2026-10-05 — The owner test is isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.4.0 — 2026-10-04 — An install records the owner's grant for the apps it registered when the
 *     installer chose `grantApps`, or did not say and the package is the owner's own; an agent grants
 *     no app a scope it lacks. A request keeps the choice, and the owner's approval applies it.
 *   v1.3.0 — 2026-10-02 — A request records what the package version can do (`capabilities`), so a
 *     request about code shows the owner what they approve (package sale design, T1).
 *   v1.2.0 — 2026-09-30 — A skill component is one of the `memory_parts` the owner is asked about:
 *     it writes their skill registry, and it costs memory:write (package-memory-component.ts).
 *   v1.1.0 — 2026-09-28 — An install request keeps the `mode` and the `config` it asked for, and the
 *     approval installs with them. An install carrying a secret config value files no request.
 *   v1.0.0 — 2026-09-25 — Initial: package installs by agents become requests.
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../../config.js';
import type { Storage, PackageRecord, PackageInstanceRecord } from '../../../storage/interface.js';
import type { Scheduler } from '../../scheduler.js';
import { installPackage, type PackageInstallCaller, type PackageInstallInput, type PackageInstallResult } from './package-install.js';
import { planPackageConfig } from '../compose/package-config.js';
import { packageCapabilities } from './package-capabilities.js';
import {
    applyInstanceMigration, updateInstanceToLatest, MIGRATION_ACTIONS,
    type MigrationRequest, type PackageMigrateInput, type PackageMigrateResult, type InstanceUpdateResult,
} from './package-migrate.js';
import { fetchComponentContent } from '../../component-registrar.js';
import { recordAccountEvent } from '../../account-events.js';
import { emitChange } from '../../event-bus.js';
import { resolveGhii } from '../../../utils/ghii-resolver.js';
import { callerPrincipal, isForeignPrincipal, isOwnerInPerson } from '../../../utils/gaii.js';
import { scopeIsCovered } from '../../../utils/scope-coverage.js';
import { grantAppsOfInstance, type AppGrantStep } from '../../install-set-grants.js';
import { stableStringify } from '../../../utils/stable-json.js';
import { decisionRefusal, requestExpired, type InstallRequestDecider } from './package-install-request-policy.js';
import {
    fileInstallRequest, settleInstallRequest, readInstallRequest, listInstallRequests, summarizeRequest,
    packageDigest, requesterName, inRequestQueue,
    type InstallRequester, type InstallRequestAct, type InstallRequestFail, type PackageInstallRequest,
} from './package-install-request-store.js';

export interface RequestDeps { storage: Storage; config: AimeatConfig; scheduler?: Scheduler }

/** Who is asking: the install caller plus what names an app grant and an MCP client. */
export interface PackageActCaller extends PackageInstallCaller {
    /** `owner/filename` of an app grant. */
    app?: string;
    /** The app grant's id. */
    grant?: string;
    /** The MCP client the session came through. */
    client?: string;
}

export type RequestedAnswer = { ok: true; kind: 'requested'; request: PackageInstallRequest; alreadyWaiting: boolean };

const fail = (status: number, code: string, message: string): InstallRequestFail => ({ ok: false, status, code, message });
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The requester's full identity, or null for a caller that may not ask (it gets the refusal). */
function requesterOf(caller: PackageActCaller, nodeId: string): InstallRequester | null {
    const roles = caller.roles ?? [];
    if (isForeignPrincipal(caller) || roles.includes('ecosystem')) return null;
    const extra = {
        ...(caller.app ? { app: caller.app } : {}),
        ...(caller.grant ? { grant: caller.grant } : {}),
        ...(caller.client ? { client: caller.client } : {}),
    };
    if (roles.includes('app')) {
        return { principal: callerPrincipal({ sub: caller.sub, owner: caller.owner, roles, app: caller.app }, nodeId), kind: 'app', sub: caller.sub, ...extra };
    }
    if (roles.includes('agent')) return { principal: caller.sub, kind: 'agent', sub: caller.sub, ...extra };
    return null;
}

/** What a door answers for a filed request, the same on REST and on MCP. */
export function requestedBody(out: RequestedAnswer) {
    const r = out.request;
    const words = r.missing.map(w => `"${w}"`).join(' and ');
    return {
        request_id: r.id,
        status: 'awaiting_owner' as const,
        act: r.act,
        missing: r.missing,
        expires_at: r.expires_at,
        already_waiting: out.alreadyWaiting,
        next_step: `Nothing was ${r.act === 'install' ? 'installed' : 'changed'} yet. `
            + (r.missing.includes('packages:install-code')
                ? `It brings code the owner has not approved, which takes ${words}, `
                : `It writes into the owner's memory, which takes ${words}, `)
            + `and this session does not hold ${r.missing.length === 1 ? 'it' : 'them'}, so it waits for the owner: they approve or decline it from their notifications. `
            + 'An agent of theirs that holds the words may approve it with aimeat_package_install_requests. '
            + `You are told when it is decided; until then read it at GET /v1/package-install-requests/${r.id}. It expires ${r.expires_at}.`,
    };
}

/** The current content of the parts a migration replaces, as one hash: "nothing changed underneath". */
async function contentDigest(storage: Storage, instance: PackageInstanceRecord, ownerGhii: string, componentIds: string[]): Promise<string | null> {
    if (componentIds.length === 0) return null;
    const parts: Array<{ id: string; content: string | null }> = [];
    for (const id of [...new Set(componentIds)].sort()) {
        const ic = instance.installedComponents.find(c => c.componentId === id);
        const content = ic ? await fetchComponentContent(storage, ic.type, ic.registeredAs, ownerGhii) : null;
        parts.push({ id, content: content === null ? null : sha256(content) });
    }
    return sha256(stableStringify(parts));
}

const replacedBy = (actions: MigrationRequest[]): string[] =>
    actions.filter(a => a.action === 'replace' || a.action === 'custom').map(a => a.componentId);

async function fileFrom(
    deps: RequestDeps, caller: PackageActCaller, act: InstallRequestAct, requester: InstallRequester, missing: string[],
    target: PackageRecord, instance: PackageInstanceRecord | null,
    options: PackageInstallRequest['options'], memoryParts: string[],
): Promise<RequestedAnswer | InstallRequestFail> {
    const actions = options.actions ?? [];
    // What the version can do, so the owner approves the same list the install records.
    const caps = packageCapabilities(target.components, deps.config, caller.owner);
    const filed = await fileInstallRequest(deps, caller.ownerGhii, {
        capabilities: { hash: caps.hash, items: caps.items },
        act,
        package: { group_id: target.packageGroupId, name: target.name, version: target.version, record_id: target.id, digest: packageDigest(target) },
        instance: instance ? {
            id: instance.id, version: instance.packageVersion, record_id: instance.packageRecordId,
            content_digest: act === 'migrate' ? await contentDigest(deps.storage, instance, caller.ownerGhii, replacedBy(actions)) : null,
        } : null,
        options,
        memory_parts: memoryParts,
        requested_by: requester,
        missing,
    });
    if (!filed.ok) return filed;
    return { ok: true, kind: 'requested', request: filed.request, alreadyWaiting: filed.alreadyWaiting };
}

/** The parts that write into the owner's memory: record sets, and skills (the skill registry is memory). */
const writesMemory = (type: string | undefined): boolean => type === 'memory' || type === 'skill';
const memoryIdsOf = (pkg: PackageRecord): string[] => pkg.components.filter(c => writesMemory(c.type)).map(c => c.id);

/** Install, or file a request for the owner when the only thing missing is the caller's words. */
export async function installOrRequest(
    deps: RequestDeps, caller: PackageActCaller, input: PackageInstallInput,
): Promise<PackageInstallResult | RequestedAnswer | InstallRequestFail> {
    const out = await installPackage(deps, caller, input);
    if (out.ok && out.kind === 'installed') return withAppGrants(deps, caller, out, input.grantApps);
    if (out.ok || !out.missing?.length || !out.target) return out;
    const requester = requesterOf(caller, deps.config.nodeId);
    if (!requester) return out;
    // A request is a record in the owner's memory, so the install config rides in it, and a secret
    // never does: an install that carries one is left refused, and the owner installs it themselves.
    const plan = planPackageConfig(out.target.components, [], input.config, { config: deps.config, owner: caller.owner });
    const secretGiven = plan.ok && plan.entries.some(e => e.type === 'extension' && e.secretFields.some(k => e.values[k] !== undefined && e.values[k] !== ''));
    if (secretGiven) {
        return { ...out, message: `${out.message} The install carries a secret config value, which is never stored in a request, so no request was filed: your owner installs it, or grants memory:write and memory:write-as-owner.` };
    }
    const options: PackageInstallRequest['options'] = {
        ...(typeof input.label === 'string' && input.label ? { label: input.label } : {}),
        ...(input.mode === 'managed' ? { mode: 'managed' as const } : {}),
        ...(input.config && typeof input.config === 'object' ? { config: input.config as Record<string, unknown> } : {}),
        ...(typeof input.grantApps === 'boolean' ? { grantApps: input.grantApps } : {}),
    };
    return fileFrom(deps, caller, 'install', requester, out.missing, out.target, null, options, memoryIdsOf(out.target));
}

/**
 * After an install: record the owner's grant for the apps it registered, when the installer chose to
 * (`grantApps`), or did not say and the package is the owner's own (Jouni, 2026-10-04: installing it
 * is approving it; for someone else's package the person sees what the apps need and chooses). An
 * agent approves no app a scope it does not hold itself (install-set-grants.ts grantAppsOfInstance).
 */
async function withAppGrants<T extends { instance: PackageInstanceRecord; ownPackage: boolean; appGrants?: Record<string, AppGrantStep> }>(
    deps: RequestDeps, caller: PackageInstallCaller, out: T, grantApps: unknown,
): Promise<T> {
    const approve = typeof grantApps === 'boolean' ? grantApps : out.ownPackage;
    if (!approve) return out;
    const mayGrant = isOwnerInPerson(caller) ? null : (s: string) => scopeIsCovered(caller.scopes, s);
    const appGrants = await grantAppsOfInstance(deps.storage, deps.config, caller.owner, out.instance, {}, mayGrant);
    return Object.keys(appGrants).length ? { ...out, appGrants } : out;
}

/** Update a whole installed copy, or file a request when the new version needs words the caller lacks. */
export async function updateOrRequest(
    deps: RequestDeps, caller: PackageActCaller, input: { instanceId: string; dryRun?: boolean },
): Promise<InstanceUpdateResult | RequestedAnswer | InstallRequestFail> {
    const out = await updateInstanceToLatest(deps, caller, input);
    if (out.ok || !out.missing?.length || !out.target || !out.instance) return out;
    const requester = requesterOf(caller, deps.config.nodeId);
    if (!requester) return out;
    return fileFrom(deps, caller, 'update', requester, out.missing, out.target, out.instance, {}, memoryIdsOf(out.target));
}

/** Apply a migration, or file a request carrying its actions when it needs words the caller lacks. */
export async function migrateOrRequest(
    deps: RequestDeps, caller: PackageActCaller, input: PackageMigrateInput,
): Promise<PackageMigrateResult | RequestedAnswer | InstallRequestFail> {
    const out = await applyInstanceMigration(deps, caller, input);
    if (out.ok || !out.missing?.length || !out.target || !out.instance) return out;
    const requester = requesterOf(caller, deps.config.nodeId);
    if (!requester) return out;
    // Exactly what was asked, and nothing else: the approval replays these actions.
    const actions: MigrationRequest[] = input.actions
        .filter(a => a && typeof a.componentId === 'string' && (MIGRATION_ACTIONS as readonly string[]).includes(a.action))
        .map(a => ({ componentId: a.componentId, action: a.action, ...(typeof a.content === 'string' ? { content: a.content } : {}) }));
    const types = new Map([...out.instance.installedComponents.map(c => [c.componentId, c.type] as const), ...out.target.components.map(c => [c.id, c.type] as const)]);
    const memoryParts = actions.filter(a => a.action !== 'skip' && writesMemory(types.get(a.componentId))).map(a => a.componentId);
    return fileFrom(deps, caller, 'migrate', requester, out.missing, out.target, out.instance, { actions }, memoryParts);
}

// ── Reading them ─────────────────────────────────────────────────────────────────────────────

/** A request reader: the owner and their agents read every request, an app only the ones it filed. */
export interface RequestViewer extends InstallRequestDecider { app?: string }

function viewRefusal(viewer: RequestViewer): InstallRequestFail | null {
    if (isForeignPrincipal(viewer) || (viewer.roles ?? []).includes('ecosystem')) {
        return fail(403, 'ACCESS_DENIED', 'Install requests are read by the account holder, their agents, and the app that asked.');
    }
    return null;
}

const visibleTo = (viewer: RequestViewer) => (r: PackageInstallRequest): boolean =>
    !(viewer.roles ?? []).includes('app') || (r.requested_by.kind === 'app' && !!viewer.app && r.requested_by.app === viewer.app);

export async function listRequestsFor(deps: RequestDeps, viewer: RequestViewer) {
    const refusal = viewRefusal(viewer);
    if (refusal) return refusal;
    const ownerGhii = await resolveGhii(deps.storage, viewer.owner, deps.config);
    const now = Date.now();
    const requests = (await listInstallRequests(deps.storage, ownerGhii)).filter(visibleTo(viewer)).map(r => summarizeRequest(r, now));
    return { ok: true as const, requests, waiting: requests.filter(r => r.state === 'awaiting_owner').length };
}

export async function readRequestFor(deps: RequestDeps, viewer: RequestViewer, id: string) {
    const refusal = viewRefusal(viewer);
    if (refusal) return refusal;
    const ownerGhii = await resolveGhii(deps.storage, viewer.owner, deps.config);
    const request = await readInstallRequest(deps.storage, ownerGhii, id);
    if (!request || !visibleTo(viewer)(request)) return fail(404, 'NOT_FOUND', 'No such install request on this account.');
    return { ok: true as const, request: summarizeRequest(request) };
}

// ── Deciding them ────────────────────────────────────────────────────────────────────────────

/**
 * Why this request can no longer be carried out as asked, or null when nothing it depends on moved.
 * The owner approved THAT version into THAT copy; anything else is a different request.
 */
async function changedUnderneath(storage: Storage, owner: string, ownerGhii: string, request: PackageInstallRequest): Promise<string | null> {
    const { group_id: group, name, version } = request.package;
    const pkg = await storage.getPackageByGroupAndVersion(group, version);
    if (!pkg || pkg.id !== request.package.record_id) return `Version ${version} of ${name} is no longer there`;
    if (pkg.status === 'archived' || (request.act !== 'migrate' && pkg.status !== 'published')) return `Version ${version} of ${name} was withdrawn`;
    if (pkg.visibility === 'private' && pkg.author !== owner) return `${name} is no longer available to this account`;
    if (packageDigest(pkg) !== request.package.digest) return `Version ${version} of ${name} changed after the request`;
    if (request.act === 'update') {
        const latest = await storage.getLatestPublished(group);
        if (!latest || latest.id !== pkg.id) return `A different version of ${name} is the latest now`;
    }
    if (request.instance) {
        const inst = await storage.getInstance(request.instance.id);
        if (!inst || inst.owner !== owner || inst.status === 'removed') return 'The installed copy is gone';
        if (inst.packageRecordId !== request.instance.record_id || inst.packageVersion !== request.instance.version) {
            return 'The installed copy moved to another version after the request';
        }
        if (request.instance.content_digest !== null
            && await contentDigest(storage, inst, ownerGhii, replacedBy(request.options.actions ?? [])) !== request.instance.content_digest) {
            return 'A part this migration replaces was edited after the request';
        }
    }
    return null;
}

type Performed = { ok: true; outcome: { instance_id: string; version: string }; result: Record<string, unknown> };

/** The act the request asked for, as the owner, through the code the ordinary doors run. */
async function perform(deps: RequestDeps, owner: string, ownerGhii: string, request: PackageInstallRequest): Promise<Performed | InstallRequestFail> {
    // The owner's authority (the words are theirs); the requester stays the actor of record, so the
    // result is what the requester's own install would have made had it held the words.
    const caller = { owner, ownerGhii, sub: request.requested_by.sub, roles: ['owner'], scopes: [] as string[] };
    if (request.act === 'install') {
        const out = await installPackage(deps, caller, {
            groupId: request.package.group_id, version: request.package.version, ...(request.options.label ? { label: request.options.label } : {}),
            ...(request.options.mode ? { mode: request.options.mode } : {}),
            ...(request.options.config ? { config: request.options.config } : {}),
        });
        if (!out.ok) return fail(out.status, out.code, out.message);
        if (out.kind !== 'installed') return fail(500, 'INSTALL_FAILED', 'The install answered a preview instead of installing.');
        // The owner approved the request, so the apps are approved as the requester chose (the owner's
        // own package when it did not say), with the owner's authority.
        const granted = await withAppGrants(deps, caller, out, request.options.grantApps);
        return { ok: true, outcome: { instance_id: out.instance.id, version: out.instance.packageVersion }, result: { instance: out.instance, ...(granted.appGrants ? { app_grants: granted.appGrants } : {}) } };
    }
    const instanceId = request.instance?.id ?? '';
    if (request.act === 'update') {
        const out = await updateInstanceToLatest(deps, caller, { instanceId });
        if (!out.ok) return fail(out.status, out.code, out.message);
        return { ok: true, outcome: { instance_id: instanceId, version: out.answer.applied?.newVersion ?? out.answer.currentVersion }, result: { update: out.answer } };
    }
    const out = await applyInstanceMigration(deps, caller, { instanceId, targetVersion: request.package.version, actions: request.options.actions ?? [] });
    if (!out.ok) return fail(out.status, out.code, out.message);
    return { ok: true, outcome: { instance_id: instanceId, version: out.outcome.newVersion }, result: { migration: out.outcome } };
}

export type DecisionAnswer = { ok: true; decision: 'approve' | 'decline'; request: ReturnType<typeof summarizeRequest>; result?: Record<string, unknown> };

/**
 * Approve or decline one request. The owner in person, or an agent of theirs under the policy.
 * A failed act leaves the request waiting: nothing moved, and it can be tried again or declined.
 */
export async function decideInstallRequest(
    deps: RequestDeps, decider: InstallRequestDecider, id: string, decision: unknown,
): Promise<DecisionAnswer | InstallRequestFail> {
    if (decision !== 'approve' && decision !== 'decline') return fail(400, 'INVALID_INPUT', "decision is 'approve' or 'decline'.");
    const { storage } = deps;
    const ownerGhii = await resolveGhii(storage, decider.owner, deps.config);
    return inRequestQueue(ownerGhii, async () => {
        const request = await readInstallRequest(storage, ownerGhii, id);
        if (!request) return fail(404, 'NOT_FOUND', 'No such install request on this account.');
        const refusal = decisionRefusal(decider, request, decision);
        if (refusal) return fail(refusal.status, refusal.code, refusal.message);
        if (request.state !== 'awaiting_owner') return fail(409, 'ALREADY_SETTLED', `This request was already ${request.state}.`);

        const by = isOwnerInPerson(decider) ? ownerGhii : decider.sub;
        // Fails closed: an expiry that cannot be read is an expired request.
        if (requestExpired(request, Date.now())) {
            await settleInstallRequest(deps, ownerGhii, request, 'expired', { by: null });
            return fail(410, 'EXPIRED', `This request expired at ${request.expires_at || 'an unknown time'} before anyone decided it. Nothing was installed. The one who asked has been told and can ask again.`);
        }
        if (decision === 'decline') {
            const settled = await settleInstallRequest(deps, ownerGhii, request, 'declined', { by });
            return { ok: true, decision, request: summarizeRequest(settled) };
        }

        const changed = await changedUnderneath(storage, decider.owner, ownerGhii, request);
        if (changed) {
            await settleInstallRequest(deps, ownerGhii, request, 'outdated', { by, outcome: { reason: changed } });
            return fail(409, 'OUTDATED', `${changed}, so this request cannot be approved as it was asked. Nothing was installed. The one who asked has been told and can ask again.`);
        }

        const done = await perform(deps, decider.owner, ownerGhii, request);
        if (!done.ok) return done;
        const settled = await settleInstallRequest(deps, ownerGhii, request, 'approved', { by, outcome: done.outcome });
        void recordAccountEvent(storage, {
            ownerGhii, kind: 'package_installed', actorGaii: by, subject: request.id, link: '/v1/profile?tab=packages',
            data: { name: request.package.name, act: request.act, who: requesterName(request.requested_by) },
        }, deps.config);
        emitChange('instances', ownerGhii);
        return { ok: true, decision, request: summarizeRequest(settled), result: done.result };
    });
}
