/**
 * @file src/services/extension-lifecycle.ts
 * @description The write half of an extension's life: storing an install or a redeploy, switching one
 *   on, switching it off, and removing it together with everything it left behind.
 *
 *   Two doors do all four. Over HTTP that is POST/PUT /v1/extensions plus the activate, deactivate
 *   and DELETE routes in routes/extensions/crud.ts; over MCP it is the aimeat_extension_* tools in
 *   mcp/extensions.ts. Manifest validation was already shared (routes/extensions/manifest.ts) and the
 *   in-place code swap was already shared (extension-upsert.ts). Everything around those two stayed
 *   copied, and the copies had stopped being the same code:
 *
 *   - Deleting over MCP removed the row and nothing else. The HTTP door removes the extension's
 *     scheduled jobs first, then empties its `ext:{name}` namespace and every `ext:{name}.{instance}`
 *     namespace beside it. So an extension uninstalled by an agent left cron jobs registered against
 *     a name that no longer resolved, and left its stored data unreachable while it still counted
 *     against the node.
 *   - Activating over MCP wrote the status field. The HTTP door also registers the schedules the
 *     manifest declares and runs the extension's `@activate` jobs, which is what makes a scheduled
 *     extension start running at all. Switched on by an agent, it never started its clock.
 *   - Deactivating over MCP wrote the status field and left the scheduled jobs registered, so a
 *     switched-off extension kept firing on its cron.
 *   - Installing over MCP prepared secrets with prepareSecretConfigForWrite, which carries a stored
 *     secret forward when the new manifest omits its value; PUT called encryptSecretFields directly,
 *     which does not. The same redeploy kept a secret through one door and erased it through the
 *     other.
 *
 *   None of those failed loudly. That is the shape of this class of bug: the surface answers with the
 *   record it wrote, and the part that did not happen stays invisible until somebody asks why the
 *   schedule stopped or where the data went.
 * @structure
 *   - writeExtensionRecord() — create or upsert: quota, secret preparation, idempotency, projection
 *   - activateExtension() — status, schedule registration from the manifest, @activate jobs
 *   - deactivateExtension() — status, schedule removal
 *   - uninstallExtension() — schedules, `ext:` and instance memory, then the row
 * @usage
 *   const out = await writeExtensionRecord({ storage, config, scheduler }, record,
 *     { existing, ownerName, actor, isOperator });
 *   if (!out.ok) return refuse(out.code, out.message);
 * @version-history
 *   v1.1.0 — 2026-08-16 — Schedule registration moved to services/extension-schedules.ts, shared with
 *     the redeploy and the two install routes. The copy here stamped no `ownerScope`, and since
 *     2026-08-15 the executor reads the owner off the job.
 *   v1.0.0 — 2026-08-11 — Extracted in the August 2026 one-capability-one-implementation audit,
 *     after the MCP tools were found writing extensions through storage directly.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import { upsertExtensionInPlace } from './extension-upsert.js';
import { recordAccountEvent } from './account-events.js';
import { registerExtensionSchedules } from './extension-schedules.js';
import { reconcileAfterExtensionWrite } from './exchange-projection.js';
import { extensionInstallRefusal } from './install-quotas.js';
import { prepareSecretConfigForWrite, decryptSecretFields, getExtSecretKeys } from './extension-secrets.js';
import { getEncryptionKey } from './encryption.js';
import { emitChange } from './event-bus.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';

export interface ExtensionLifecycleDeps {
    storage: Storage;
    config: AimeatConfig;
    /** Absent on a door with no scheduler wired; then schedules are neither registered nor removed. */
    scheduler?: Scheduler | null;
}

export interface ExtensionWriteContext {
    /**
     * The stored record this write lands on, or null for a fresh install. Both doors already read it
     * to decide whether the caller may write here, so it is passed in rather than read twice: the
     * permission decision and the write must be made about the same row.
     */
    existing: ExtensionRecord | null;
    /** The bare owner name of the caller, for the per-owner install ceiling. */
    ownerName: string;
    /** Who is recorded as having created re-registered schedule jobs. */
    actor: string;
    /** Operators bypass the per-owner ceiling and not the node-wide one. */
    isOperator: boolean;
}

export type ExtensionWriteOutcome =
    | { ok: true; record: ExtensionRecord; action: 'installed' | 'updated' | 'unchanged'; reinitialized: boolean }
    | { ok: false; status: number; code: string; message: string };

/**
 * What the stored record MEANS, for deciding whether a redeploy changes anything.
 *
 * stableStringify rather than JSON.stringify: config/actions/limits/federation/instances are Json
 * columns, and PostgreSQL jsonb does not preserve object key order, so a naive stringify reads
 * identical data as changed. Compared on plaintext config (decrypt the stored secrets, drop the
 * __secretKeys marker) because secret ciphertext takes a fresh IV on every call and would otherwise
 * make every redeploy look different.
 */
function recordSignature(r: ExtensionRecord, encKey: Buffer | null): string {
    return stableStringify({
        version: r.version, description: r.description, author: r.author,
        requiredApis: r.requiredApis, actions: r.actions,
        config: decryptSecretFields(r.config, getExtSecretKeys(r), encKey),
        limits: r.limits, federation: r.federation, instances: r.instances ?? null,
    });
}

/**
 * Store a validated extension record: create it, or replace an installed one in place.
 *
 * The caller owns the policy above this — whether an existing name may be replaced at all (POST
 * refuses, PUT allows, the MCP tool wants `update: true`) and who is allowed to write here. This owns
 * what happens once that is settled: the install ceilings, secret handling, the no-op shortcut, the
 * swap and the EXCHANGE re-projection.
 *
 * Mutates `record.config` in place with the storage-ready value, as both doors always have.
 */
export async function writeExtensionRecord(
    deps: ExtensionLifecycleDeps,
    record: ExtensionRecord,
    ctx: ExtensionWriteContext,
): Promise<ExtensionWriteOutcome> {
    const { storage, config, scheduler } = deps;
    const { existing } = ctx;
    const name = record.name;
    const encKey = getEncryptionKey(config);

    // The listing belongs to whoever installed the extension, not to whoever is redeploying it. On
    // every ordinary write those are the same principal, because managing an extension requires
    // being its installer; they part company when an operator writes on somebody else's behalf.
    const listingOwner = existing ? existing.installedBy : record.installedBy;

    if (!existing) {
        // Both ceilings, node-wide and per-owner, from services/install-quotas.ts. Only a new name
        // counts: replacing your own extension in place adds nothing to either number.
        const overQuota = await extensionInstallRefusal({ storage, config }, ctx.ownerName, ctx.isOperator);
        if (overQuota) return { ok: false, ...overQuota };

        const prepared = prepareSecretConfigForWrite(record.config, undefined, encKey);
        if (prepared === null) return encryptionRefusal();
        record.config = prepared;

        const created = await storage.createExtension(record);
        // TARGET-050: an action flagged `commercial.exchange` is projected onto the market from here.
        await reconcileAfterExtensionWrite(storage, listingOwner, config.nodeId, created.name);
        emitChange('extensions');
        // Installed only. Replacing an extension's code in place is ordinary maintenance; arriving
        // in the account for the first time is a new thing that can act there.
        void recordAccountEvent(storage, {
            ownerGhii: `${ctx.ownerName}@${config.nodeId}`,
            kind: 'extension_installed',
            actorGaii: ctx.actor,
            subject: created.name,
            link: '/v1/profile?tab=extensions',
            data: { name: created.name },
        }, config);
        return { ok: true, record: created, action: 'installed', reinitialized: false };
    }

    // Identical derived bytes are a safe no-op, and a no-op must not re-run the extension's
    // @activate work or re-register its schedules.
    if (recordSignature(record, encKey) === recordSignature(existing, encKey)) {
        return { ok: true, record: existing, action: 'unchanged', reinitialized: false };
    }

    // Carry forward the encrypted secrets this manifest omitted, then encrypt the plaintext ones. A
    // manifest that declares a secret field without repeating its value must not wipe what is stored.
    const prepared = prepareSecretConfigForWrite(record.config, existing.config, encKey);
    if (prepared === null) return encryptionRefusal();
    record.config = prepared;

    const upserted = await upsertExtensionInPlace({ storage, config, scheduler }, name, record, {
        ownerName: listingOwner,
        actor: ctx.actor,
        wasActive: existing.status === 'active',
    });
    // Never answer a write that did not apply with the record we WANTED to store: that looks exactly
    // like proof the deploy worked, while the database still holds the old code.
    if (!upserted.record) {
        logger.error(`Extension upsert wrote nothing: ${name}`, { by: ctx.actor });
        return {
            ok: false, status: 500, code: 'WRITE_NOT_APPLIED',
            message: `Extension "${name}" was NOT updated — the storage write did not apply, and the installed version is unchanged. Nothing was deployed.`,
        };
    }
    emitChange('extensions');
    return { ok: true, record: upserted.record, action: 'updated', reinitialized: upserted.reinitialized };
}

function encryptionRefusal(): ExtensionWriteOutcome {
    return {
        ok: false, status: 503, code: 'ENCRYPTION_NOT_CONFIGURED',
        message: 'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to install extensions with secret config.',
    };
}

/**
 * Switch an extension on.
 *
 * Three things, not one: the status field, the schedules the manifest declares, and the `@activate`
 * jobs that do an extension's first run. An extension whose status says active but whose schedules
 * were never registered looks installed and working and does nothing on its clock.
 *
 * `ext` is the record as stored BEFORE the update, because its config carries the `__schedules` this
 * reads. Returns the updated record, or null when the row went away underneath.
 */
export async function activateExtension(
    deps: ExtensionLifecycleDeps,
    ext: ExtensionRecord,
    actor: string,
): Promise<ExtensionRecord | null> {
    const { storage, scheduler } = deps;
    const name = ext.name;

    const updated = await storage.updateExtension(name, {
        status: 'active',
        activatedAt: new Date().toISOString(),
    });

    await registerExtensionSchedules({ storage, config: deps.config, scheduler }, ext, actor);

    // The extension's first run, once it is on. Deliberately not awaited: an @activate job may be
    // long, and activation has already happened.
    if (scheduler) {
        scheduler.runActivateJobs(name).catch(err =>
            logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));
    }

    emitChange('extensions');
    return updated;
}

/** Switch an extension off, and stop its clock with it. */
export async function deactivateExtension(
    deps: ExtensionLifecycleDeps,
    name: string,
): Promise<ExtensionRecord | null> {
    const updated = await deps.storage.updateExtension(name, { status: 'inactive' });
    await removeExtensionSchedules(deps, name);
    emitChange('extensions');
    return updated;
}

/**
 * Remove an extension and everything it accumulated: its scheduled jobs, its `ext:{name}` memory, and
 * the `ext:{name}.{instanceId}` memory of each of its instances.
 *
 * The row alone is not the extension. A job left registered fires against a name that no longer
 * resolves, and a namespace left behind is data nobody can reach and nobody can list.
 */
export async function uninstallExtension(
    deps: ExtensionLifecycleDeps,
    name: string,
): Promise<boolean> {
    const { storage } = deps;

    await removeExtensionSchedules(deps, name);

    const extNamespace = `ext:${name}`;
    const extMemoryRecords = await storage.listMemory(extNamespace);
    for (const record of extMemoryRecords) {
        await storage.deleteMemory(extNamespace, record.key);
    }
    if (extMemoryRecords.length > 0) {
        logger.info(`Cleaned ${extMemoryRecords.length} memory keys from namespace: ${extNamespace}`);
    }

    const instances = await storage.listExtensionInstances(name);
    for (const inst of instances) {
        const instNamespace = `ext:${name}.${inst.id}`;
        const instMemory = await storage.listMemory(instNamespace);
        for (const record of instMemory) {
            await storage.deleteMemory(instNamespace, record.key);
        }
        if (instMemory.length > 0) {
            logger.info(`Cleaned ${instMemory.length} memory keys from instance namespace: ${instNamespace}`);
        }
    }

    const deleted = await storage.deleteExtension(name);
    emitChange('extensions');
    return deleted;
}

/** Drop every scheduled job registered for this extension, from the scheduler and from storage. */
async function removeExtensionSchedules(deps: ExtensionLifecycleDeps, name: string): Promise<void> {
    const { storage, scheduler } = deps;
    if (!scheduler) return;
    const jobs = await storage.listScheduledJobs({ extensionName: name });
    for (const job of jobs) {
        scheduler.removeJob(job.id);
        await storage.deleteScheduledJob(job.id);
    }
    if (jobs.length > 0) {
        logger.info(`Removed ${jobs.length} scheduled jobs for extension: ${name}`);
    }
}
