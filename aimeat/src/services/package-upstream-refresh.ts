/**
 * @file services/package-upstream-refresh.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The customer node's side of a package repository: bring every installed copy whose
 *   package came from another node up to what that node now serves.
 *
 *   WHAT IT DOES, PER INSTALL. An install whose package was pulled from another node (the package
 *   record carries `upstream`) and that was not forked:
 *     1. the package is refreshed from its source under the pinned key (pullPackage, fromUpstream):
 *        a newer version becomes a new local version of the package, an older or equal one nothing;
 *     2. when the install is behind the newest local version, and its `autoUpdate` is on, it is
 *        updated as its owner (updateInstanceToLatest, the same act as the Update button), and a
 *        part the owner edited is left alone and reported, as an update always does;
 *     3. and when `autoUpdate` is off, the owner is told once per new version, with an Update
 *        button.
 *   A source that answers UPDATES_ENDED (the repository's monthly fee has run out) is recorded and
 *   the install is left as it is: Jouni's decision 10 of 2026-09-28, the install stays and receives
 *   no updates.
 *
 *   WHO RUNS IT. The daily core job `package-upstream-check` for every owner, and
 *   POST /v1/instances/check-updates (aimeat_package_check_updates) for the caller's own installs, which
 *   does the same without the notification: the person asking is already looking at the answer.
 * @structure RefreshOutcome · refreshInstalledPackages(deps, filter, opts)
 * @usage
 *   const outcomes = await refreshInstalledPackages({ storage, config, peers }, { owner }, { notify: false });
 * @version-history
 *   v1.2.0 — 2026-10-02 — An install with auto-update on is not updated to a version that can do more
 *     than the owner approved: the owner is told once (package_update_needs_approval) and the outcome is
 *     needs_owner (package sale design, T7).
 *   v1.1.0 — 2026-09-30 — The end of updates is said for the owner (UPDATES_ENDED_SENTENCE) and, from
 *     the daily check, notified once (package_updates_ended); the owner read the repository's words.
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageInstanceRecord } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { pullPackage } from './package-pull.js';
import { updateInstanceToLatest } from './package-migrate.js';
import { packageCapabilities, widenedItems } from './package-capabilities.js';
import { approvedItems } from './package-approvals.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { logger } from '../utils/logger.js';

/** Where the owner was last told about a version, per install: one record per install, system namespace. */
const NS_UPDATE_NOTICES = 'package-update-notices';

/** What the owner reads when the update service has ended. */
export const UPDATES_ENDED_SENTENCE = 'The update service for this package has ended. The app keeps working as it is. Renew the update service to get new versions.';
/** The notice slot for the end of updates, so the owner is told once, not every night. */
const UPDATES_ENDED_NOTICE = 'updates-ended';

export interface RefreshOutcome {
    instance_id: string;
    owner: string;
    package: string;
    /** A newer version arrived from the source in this run. */
    pulled: boolean;
    /** The version the install is on after this run. */
    version: string;
    /** The newest version this node holds of the package. */
    latest: string;
    /** 'updated' | 'needs_owner' (parts the owner edited) | 'notified' | 'current' | 'updates_ended' | 'error' */
    result: 'updated' | 'needs_owner' | 'notified' | 'current' | 'updates_ended' | 'error';
    detail?: string;
}

export interface RefreshDeps { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> }

/** Run the refresh over the installs `filter` names: one owner's, or every owner's. */
export async function refreshInstalledPackages(
    deps: RefreshDeps, filter: { owner?: string }, opts: { notify: boolean },
): Promise<RefreshOutcome[]> {
    const { storage, config } = deps;
    const { instances } = await storage.listInstances({ ...(filter.owner ? { owner: filter.owner } : {}), status: 'installed', limit: 1000 });
    const outcomes: RefreshOutcome[] = [];
    for (const inst of instances) {
        if (inst.forkedAt) continue;
        const current = await storage.getPackage(inst.packageRecordId);
        const up = current?.upstream ?? (await storage.getLatestPublished(inst.packageGroupId))?.upstream;
        if (!up) continue;
        try {
            outcomes.push(await refreshOne(deps, inst, up.groupId, opts));
        } catch (err) {
            logger.warn('package-upstream-refresh: one install failed, continuing', { instance: inst.id, error: String(err) });
            outcomes.push({ instance_id: inst.id, owner: inst.owner, package: inst.packageGroupId, pulled: false,
                version: inst.packageVersion, latest: inst.packageVersion, result: 'error', detail: String(err) });
        }
    }
    if (outcomes.some(o => o.pulled || o.result === 'updated')) emitChange('instances');
    void config;
    return outcomes;
}

async function refreshOne(
    deps: RefreshDeps, inst: PackageInstanceRecord, upstreamGroupId: string, opts: { notify: boolean },
): Promise<RefreshOutcome> {
    const { storage, config } = deps;
    const base = { instance_id: inst.id, owner: inst.owner, package: inst.packageGroupId };

    const pulled = await pullPackage(deps, { owner: inst.owner, isOperator: false }, { groupId: upstreamGroupId, fromUpstream: true });
    if (!pulled.ok && pulled.code === 'UPDATES_ENDED') {
        // Said for the owner, not in the repository's words: the moment the update service ends is
        // the moment they decide whether to renew it, and "answered 403" told them nothing.
        if (opts.notify && await firstNoticeFor(storage, inst.id, UPDATES_ENDED_NOTICE)) {
            const ownerGhii = await resolveGhii(storage, inst.owner, config);
            await notify(storage, ownerGhii, {
                type: 'package_updates_ended',
                title: `The update service for ${inst.label} has ended`,
                body: `${inst.label} keeps working as it is. New versions come again when you renew the update service.`,
                link: '/v1/profile?tab=packages',
                i18n: { key: 'package_updates_ended', vars: { label: inst.label } },
            });
            emitChange('notifications', ownerGhii);
        }
        return { ...base, pulled: false, version: inst.packageVersion, latest: inst.packageVersion, result: 'updates_ended', detail: UPDATES_ENDED_SENTENCE };
    }
    if (!pulled.ok) {
        return { ...base, pulled: false, version: inst.packageVersion, latest: inst.packageVersion, result: 'error', detail: `${pulled.code}: ${pulled.message}` };
    }
    const didPull = pulled.applied === true;

    const latest = await storage.getLatestPublished(inst.packageGroupId);
    if (!latest || latest.version === inst.packageVersion) {
        return { ...base, pulled: didPull, version: inst.packageVersion, latest: latest?.version ?? inst.packageVersion, result: 'current' };
    }

    if (inst.autoUpdate) {
        const ownerGhii = await resolveGhii(storage, inst.owner, config);
        // A version that can do more than the owner approved is not applied by a job nobody watches
        // (package sale design, T7). The owner is told once, and applies it with the Update button,
        // which is them approving it.
        const widened = widenedItems(await approvedItems(storage, config, inst), packageCapabilities(latest.components, config, inst.owner).items);
        if (widened.length > 0) {
            if (opts.notify && await firstNoticeFor(storage, inst.id, `approval:${latest.version}`)) {
                await notify(storage, ownerGhii, {
                    type: 'package_update_needs_approval',
                    title: `The update of ${inst.label} waits for you`,
                    body: `Version ${latest.version} of ${latest.name} can do more than you approved before. It is not installed until you update it yourself.`,
                    link: '/v1/profile?tab=packages',
                    i18n: { key: 'package_update_needs_approval', vars: { label: inst.label, version: latest.version, name: latest.name } },
                    actions: [{ id: 'update', label: 'Update', kind: 'api', method: 'POST', endpoint: `/v1/instances/${inst.id}/update`, body: {}, style: 'primary' }],
                });
                emitChange('notifications', ownerGhii);
            }
            return {
                ...base, pulled: didPull, version: inst.packageVersion, latest: latest.version, result: 'needs_owner',
                detail: `The new version can do more than the owner approved (${widened.slice(0, 6).join(', ')}${widened.length > 6 ? ', …' : ''}), so it waits for them.`,
            };
        }
        const out = await updateInstanceToLatest({ storage, config },
            { owner: inst.owner, ownerGhii, sub: ownerGhii, roles: ['owner'], scopes: [] }, { instanceId: inst.id });
        if (!out.ok) return { ...base, pulled: didPull, version: inst.packageVersion, latest: latest.version, result: 'error', detail: `${out.code}: ${out.message}` };
        const after = await storage.getInstance(inst.id);
        const needsOwner = out.answer.needsYou.length > 0;
        return {
            ...base, pulled: didPull, version: after?.packageVersion ?? inst.packageVersion, latest: latest.version,
            result: needsOwner ? 'needs_owner' : 'updated',
            ...(needsOwner ? { detail: `Left for the owner, because they edited them: ${out.answer.needsYou.map(n => n.componentId).join(', ')}` } : {}),
        };
    }

    if (opts.notify && await firstNoticeFor(storage, inst.id, latest.version)) {
        const ownerGhii = await resolveGhii(storage, inst.owner, config);
        await notify(storage, ownerGhii, {
            type: 'package_update_available',
            title: `An update is ready for ${inst.label}`,
            body: `Version ${latest.version} of ${latest.name} is here. Your install is on ${inst.packageVersion}. Updating keeps every part you edited as it is.`,
            link: '/v1/profile?tab=packages',
            i18n: { key: 'package_update_available', vars: { label: inst.label, version: latest.version, name: latest.name, current: inst.packageVersion } },
            actions: [{ id: 'update', label: 'Update', kind: 'api', method: 'POST', endpoint: `/v1/instances/${inst.id}/update`, body: {}, style: 'primary' }],
        });
        emitChange('notifications', ownerGhii);
        return { ...base, pulled: didPull, version: inst.packageVersion, latest: latest.version, result: 'notified' };
    }
    return { ...base, pulled: didPull, version: inst.packageVersion, latest: latest.version, result: 'current', detail: 'An update is ready; auto-update is off.' };
}

/** True the first time this install is told about this version; false every time after. */
async function firstNoticeFor(storage: Storage, instanceId: string, version: string): Promise<boolean> {
    const prev = await storage.getMemory(NS_UPDATE_NOTICES, instanceId);
    if ((prev?.value as { version?: string } | undefined)?.version === version) return false;
    const now = new Date().toISOString();
    await storage.setMemory({
        key: instanceId, ownerGaii: NS_UPDATE_NOTICES, value: { version, noticedAt: now },
        visibility: 'private', tags: ['package-update-notice'], ttlHours: null,
        version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
    return true;
}
