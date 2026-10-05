/**
 * @file services/packages/compose/package-withdrawals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Withdrawing a bad version of a package from the nodes that have it (T6 of
 *   docs/specs/package-sale-design.md, section 5; phase 5).
 *
 *   WHAT A WITHDRAWAL IS. The package's author or an operator marks one version `withdrawn`, with a
 *   reason. From then on nothing serves it: install, the repository's channel and every pull read only
 *   published (and beta) versions. The reason is kept in one record per package group, in the system
 *   namespace `package-withdrawals` that no principal can address.
 *
 *   WHAT HAPPENS TO THE COPIES. Each installed copy of that version is told once, and the extensions it
 *   installed are switched off, because an extension is the part that runs by itself. Apps, records and
 *   skills stay as they are: switching them off would take the person's own data with them, and the
 *   owner decides. A copy on this node is reached at once; a copy on a customer node is reached by that
 *   node's daily check, which reads `withdrawn` on the repository's listing (package-upstream-refresh.ts).
 *
 *   ONE WAY. A withdrawn version is not published again; the author publishes a fixed version, which a
 *   managed copy then receives as an ordinary update.
 * @structure NS_PACKAGE_WITHDRAWALS · withdrawnVersions() · withdrawVersion() · actOnWithdrawn()
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 5).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, PackageInstanceRecord } from '../../../storage/interface.js';
import type { Scheduler } from '../../scheduler.js';
import { deactivateExtension } from '../../extension-lifecycle.js';
import { firstNoticeFor } from './package-notices.js';
import { notify } from '../../notify.js';
import { emitChange } from '../../event-bus.js';
import { resolveGhii } from '../../../utils/ghii-resolver.js';
import { logger } from '../../../utils/logger.js';

export const NS_PACKAGE_WITHDRAWALS = 'package-withdrawals';

export interface Withdrawal { version: string; reason: string; by: string; at: string }

const key = (groupId: string) => `withdrawn.${groupId}`;
type Fail = { ok: false; status: number; code: string; message: string };

/** The withdrawn versions of a group, by version. */
export async function withdrawnVersions(storage: Storage, groupId: string): Promise<Record<string, Withdrawal>> {
    const rec = await storage.getMemory(NS_PACKAGE_WITHDRAWALS, key(groupId));
    const v = (rec?.value as { versions?: Record<string, Withdrawal> } | undefined)?.versions;
    return v && typeof v === 'object' ? v : {};
}

type Deps = { storage: Storage; config: AimeatConfig; scheduler?: Scheduler | null };

/**
 * Withdraw one version: mark it, keep the reason, and act on every copy of it on this node. The
 * package's author or an operator.
 */
export async function withdrawVersion(
    deps: Deps, caller: { owner: string; isOperator: boolean }, input: { groupId: string; version: string; reason: unknown },
): Promise<{ ok: true; withdrawal: Withdrawal; copies_here: number } | Fail> {
    const { storage } = deps;
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10 || reason.length > 1000) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'reason says why the version is withdrawn, in 10 to 1000 characters: every owner who has it reads it.' };
    }
    const pkg = await storage.getPackageByGroupAndVersion(input.groupId, input.version);
    if (!pkg) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Version ${input.version} not found for package ${input.groupId}` };
    if (pkg.author !== caller.owner && !caller.isOperator) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the package\'s author or an operator withdraws a version.' };
    }
    if (pkg.status === 'withdrawn') return { ok: false, status: 409, code: 'ALREADY_WITHDRAWN', message: `Version ${input.version} was withdrawn already.` };
    const now = new Date().toISOString();
    await storage.updatePackage(pkg.id, { status: 'withdrawn', updatedAt: now });
    const withdrawal: Withdrawal = { version: input.version, reason, by: caller.owner, at: now };
    const prev = await storage.getMemory(NS_PACKAGE_WITHDRAWALS, key(input.groupId));
    const versions = { ...(await withdrawnVersions(storage, input.groupId)), [input.version]: withdrawal };
    await storage.setMemory({
        key: key(input.groupId), ownerGaii: NS_PACKAGE_WITHDRAWALS, value: { groupId: input.groupId, versions },
        visibility: 'private', tags: ['package-withdrawal'], ttlHours: null,
        version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
    emitChange('packages');
    const { instances } = await storage.listInstances({ packageGroupId: input.groupId, status: 'installed', limit: 1000 });
    let copies = 0;
    for (const inst of instances.filter(i => i.packageVersion === input.version && !i.forkedAt)) {
        await actOnWithdrawn(deps, inst, withdrawal);
        copies++;
    }
    return { ok: true, withdrawal, copies_here: copies };
}

/**
 * One installed copy of a withdrawn version: its extensions off, and its owner told once. Never
 * throws; a failure is logged and the next daily check tries again.
 */
export async function actOnWithdrawn(deps: Deps, inst: PackageInstanceRecord, w: { version: string; reason: string }): Promise<void> {
    try {
        if (!await firstNoticeFor(deps.storage, `${inst.id}:withdrawn`, w.version)) return;
        const off: string[] = [];
        for (const c of inst.installedComponents.filter(x => x.type === 'extension')) {
            if (await deactivateExtension({ storage: deps.storage, config: deps.config, scheduler: deps.scheduler ?? null }, c.registeredAs)) off.push(c.registeredAs);
        }
        const ownerGhii = await resolveGhii(deps.storage, inst.owner, deps.config);
        await notify(deps.storage, ownerGhii, {
            type: 'package_version_withdrawn',
            title: `The version of ${inst.label} you have was withdrawn`,
            body: `Its author withdrew version ${w.version}: ${w.reason}${off.length ? ` Its extensions were switched off: ${off.join(', ')}.` : ''} Your apps and records stay as they are.`,
            link: '/v1/profile?tab=packages',
            i18n: { key: 'package_version_withdrawn', vars: { label: inst.label, version: w.version, reason: w.reason } },
        });
        emitChange('notifications', ownerGhii);
    } catch (err) {
        logger.warn('package-withdrawals: acting on one copy failed', { instance: inst.id, error: String(err) });
    }
}
