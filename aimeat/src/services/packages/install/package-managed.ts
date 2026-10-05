/**
 * @file services/packages/install/package-managed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The lock on a managed package install, and the fork that releases it.
 *
 *   WHAT MANAGED MEANS. A package installed with `mode: 'managed'` takes the code and the layout of
 *   every component from the package, and the package is where they change: an update replaces them.
 *   The owner still changes the settings. Ruled by Jouni on 2026-09-28 (wish
 *   wish-asennuspaketit-uusille-nodeille-ja-keskitetty-pakettireposit, decisions 2 and 9): code and
 *   layout are the product; name, description, access code, parking, search visibility and legal
 *   texts are the customer's. The lock is on code, never on data: nothing here touches a record an
 *   app wrote.
 *
 *   ONE CHECK FOR EVERY CODE PATH. An app's bytes change through publishApp and the draft slot, its
 *   layout through PUT .../ui, its bundled crews and cortex list through PATCH, a cortex through its
 *   upsert and an extension through PUT and the per-action script PATCH. Each of them asks
 *   managedChangeRefusal() with the component's type and registered name, so the answer and its
 *   wording are written once.
 *
 *   THE INSTANCE IS ASKED, NOT A STAMP ON THE COMPONENT. The lock is read from the owner's installed
 *   instances rather than from a field on the app manifest, the cortex record or the extension
 *   record. Three reasons: a cortex and an extension have no manifest field to carry it; a stamp is
 *   copied by every mechanism that copies a manifest (an app fork, a backup restore) and would lock
 *   the copy; and a fork of the install flips one instance record instead of rewriting every
 *   component. An owner has a handful of instances, so the lookup is one indexed query on `owner`.
 *
 *   THE FORK RELEASES IT IN PLACE. Forking a managed install makes that same instance editable and
 *   records when. Every address, every record the apps wrote and every schedule stays where it is;
 *   what the owner gives up is the updates. The alternative, copying each app to a new address, loses
 *   the data an app keeps under its own id and breaks every link the owner has handed out.
 * @structure
 *   - ManagedChange — what the caller is about to change
 *   - ManagedLock / managedLockFor() — is this component part of a managed install?
 *   - managedChangeRefusal() — the refusal every code path returns, or null
 *   - forkPackageInstance() — release the lock: managed → editable, updates stop
 *   - setPackageInstance() — the owner's label and auto-update choice
 *   - forkedUpdateRefusal() — a forked install takes no updates
 * @usage
 *   const refused = await managedChangeRefusal(storage, ownerName, 'app', filename, 'code');
 *   if (refused) return { refusal: refused };
 * @version-history
 *   v1.2.0 — 2026-10-05 — setPackageInstance: turning automatic updates on takes the owner in person or
 *     packages:install-code (secaudit 2026-10, PKG-12).
 *   v1.1.1 — 2026-09-30 — The refusal has a word for a `skill` component.
 *   v1.1.0 — 2026-09-28 — setPackageInstance(): label and auto-update (install packages, phase 3).
 *   v1.0.0 — 2026-09-28 — Initial: managed installs (install packages, phase 1).
 */
import type { Storage, PackageComponentType, PackageInstanceRecord } from '../../../storage/interface.js';
import { emitChange } from '../../event-bus.js';
import { INSTALL_CODE_SCOPE } from './package-approvals.js';

/** What a caller is about to change. Both are locked; the word goes into the refusal. */
export type ManagedChange = 'code' | 'layout';

/** The install a component belongs to, when that install is managed. */
export interface ManagedLock {
    instanceId: string;
    packageGroupId: string;
    packageVersion: string;
    label: string;
    componentId: string;
}

/** A refusal in the shape the routes and publishApp already return. */
export interface ManagedRefusal {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
}

/**
 * The managed install `registeredAs` belongs to, or null when it belongs to none.
 *
 * `owner` is the bare account name, which is what an instance record is keyed by
 * (services/packages/install/package-install.ts writes `caller.owner`). An instance that was removed does not lock
 * anything; a paused one still does, because pausing is not a decision to take the code over.
 */
export async function managedLockFor(
    storage: Storage, owner: string, type: PackageComponentType, registeredAs: string,
): Promise<ManagedLock | null> {
    const { instances } = await storage.listInstances({ owner, limit: 1000 });
    for (const inst of instances) {
        if (inst.mode !== 'managed' || inst.status === 'removed') continue;
        const comp = inst.installedComponents.find(c => c.type === type && c.registeredAs === registeredAs);
        if (comp) {
            return {
                instanceId: inst.id,
                packageGroupId: inst.packageGroupId,
                packageVersion: inst.packageVersion,
                label: inst.label,
                componentId: comp.componentId,
            };
        }
    }
    return null;
}

const NOUN: Record<PackageComponentType, string> = {
    app: 'app', cortex: 'library', extension: 'extension', csm: 'schema', msm: 'schema',
    memory: 'record set', translation: 'translation', skill: 'skill',
};

/**
 * The refusal for changing the code or layout of a component a managed install owns, or null when
 * the change may go ahead.
 *
 * 409, because the request is well formed and the caller may otherwise make it: what stands in the
 * way is the state of the install, and the message names the one act that changes that state.
 */
export async function managedChangeRefusal(
    storage: Storage, owner: string, type: PackageComponentType, registeredAs: string, change: ManagedChange,
): Promise<ManagedRefusal | null> {
    const lock = await managedLockFor(storage, owner, type, registeredAs);
    if (!lock) return null;
    const what = change === 'layout' ? 'layout' : 'code';
    return {
        status: 409,
        code: 'MANAGED_BY_PACKAGE',
        message: `This ${NOUN[type]} is part of the managed install "${lock.label}" of package ${lock.packageGroupId}, `
            + `so its ${what} comes from the package and changes only when the package updates. `
            + 'Its settings (name, description, access code, parking, search visibility, legal texts) are yours to change. '
            + `To change the ${what} yourself, fork the install: POST /v1/instances/${lock.instanceId}/fork, `
            + 'or the aimeat_package_fork MCP tool. A fork keeps every address and every record, and it receives no further updates.',
        details: {
            instance_id: lock.instanceId,
            package_group_id: lock.packageGroupId,
            package_version: lock.packageVersion,
            component_id: lock.componentId,
            change: what,
        },
    };
}

export type ForkResult =
    | { ok: true; instance: PackageInstanceRecord }
    | { ok: false; status: number; code: string; message: string };

/**
 * Fork a managed install: it becomes editable in place and stops receiving updates.
 *
 * Only the instance's owner may fork it. Forking an install that is already editable is refused
 * rather than answered as a success, so a caller that expected a lock learns there was none.
 */
export async function forkPackageInstance(
    storage: Storage, caller: { owner: string }, instanceId: string,
): Promise<ForkResult> {
    const instance = await storage.getInstance(instanceId);
    if (!instance || instance.status === 'removed') {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    }
    if (instance.owner !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the instance owner can fork it' };
    }
    if (instance.mode !== 'managed') {
        return {
            ok: false, status: 409, code: 'NOT_MANAGED',
            message: instance.forkedAt
                ? `This install was already forked on ${instance.forkedAt}. It is yours to edit and receives no updates.`
                : 'This install is not managed: it is already yours to edit, so there is nothing to fork.',
        };
    }
    const now = new Date().toISOString();
    const updated = await storage.updateInstance(instanceId, { mode: 'editable', forkedAt: now, updatedAt: now });
    if (!updated) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    }
    emitChange('instances');
    return { ok: true, instance: updated };
}

/**
 * Change what the owner may change about an install itself: its label, and whether the daily package
 * check updates it by itself. Only the instance's owner.
 */
export async function setPackageInstance(
    storage: Storage,
    /** `mayInstallCode`: the owner in person, or an agent holding packages:install-code. */
    caller: { owner: string; mayInstallCode: boolean },
    instanceId: string, input: { label?: unknown; autoUpdate?: unknown },
): Promise<ForkResult> {
    const instance = await storage.getInstance(instanceId);
    if (!instance || instance.status === 'removed') {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    }
    if (instance.owner !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the instance owner can change it' };
    }
    const updates: Partial<PackageInstanceRecord> = {};
    if (input.label !== undefined) {
        if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200) {
            return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'label is a name of 1 to 200 characters.' };
        }
        updates.label = input.label.trim();
    }
    if (input.autoUpdate !== undefined) {
        if (typeof input.autoUpdate !== 'boolean') {
            return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'auto_update is true or false.' };
        }
        // On means later versions install with nobody watching, which an agent may start only with
        // the word that lets it install code (secaudit 2026-10, PKG-12). Off is always allowed.
        if (input.autoUpdate && !caller.mayInstallCode) {
            return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `Turning automatic updates on lets new versions install by themselves. The owner turns it on in person, or gives this agent ${INSTALL_CODE_SCOPE}.` };
        }
        updates.autoUpdate = input.autoUpdate;
    }
    if (Object.keys(updates).length === 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Name what to change: label, auto_update.' };
    }
    const updated = await storage.updateInstance(instanceId, { ...updates, updatedAt: new Date().toISOString() });
    if (!updated) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Instance not found: ${instanceId}` };
    emitChange('instances');
    return { ok: true, instance: updated };
}

/**
 * The refusal for updating a forked install, or null. A fork is the owner's own copy; the package
 * it came from no longer reaches it (decision 2).
 */
export function forkedUpdateRefusal(
    instance: PackageInstanceRecord,
): { ok: false; status: number; code: string; message: string } | null {
    if (!instance.forkedAt) return null;
    return {
        ok: false, status: 409, code: 'FORKED',
        message: `This install was forked on ${instance.forkedAt}, so it receives no updates from package ${instance.packageGroupId}. `
            + 'To get the package\'s newer version, install it again alongside this one.',
    };
}
