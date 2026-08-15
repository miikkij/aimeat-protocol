/**
 * @file src/services/extension-system-run.ts
 * @description Running one extension action with NOBODY PRESENT — the shared half of the two roads
 *   that do it: a schedule firing on a clock, and a workflow step reaching its turn.
 *
 *   WHY THIS IS ONE FUNCTION. The steps between "an id names an action" and "the sandbox starts" are
 *   seven, and every one of them is a place a road can be wrong differently: resolve the extension,
 *   refuse an inactive one, find the action, refuse a stranger's, decrypt the manifest secrets,
 *   resolve the instance and ITS secrets, build the context. The scheduler road had all seven; the
 *   workflow road was about to grow a second copy of them. This node has already paid for that shape
 *   once — four hand-built sandbox contexts, each missing a different guard, five findings in the
 *   August 2026 audit — which is why `services/extension-ctx.ts` exists and why the layer above it
 *   should not be re-derived either.
 *
 *   THE ONE RULE THAT MAKES AN UNATTENDED CALL SAFE: it must be the OWNER'S OWN EXTENSION. A system
 *   run has no paywall, no contract and no meter — there is no door where a price could be asked —
 *   so a clock or a workflow pointed at somebody else's extension is an unlimited standing call on
 *   their capability, their API keys and their quota. `POST /v1/schedules` has refused that since it
 *   was written (services/schedule-write.ts); here it is checked again at RUN time, because
 *   `installedBy` is decided at install and a saved schedule or workflow outlives the record it
 *   names. A create-time gate cannot see a delete-and-reinstall by a different owner.
 *
 *   WHAT A SYSTEM RUN DOES NOT GET: a wallet. Nobody's balance is available to spend when nobody is
 *   present, so `ctx.wallet` is the empty object it has always been on these roads, and a script that
 *   reaches for it gets `undefined` rather than someone else's money.
 * @structure SystemRunTarget · SystemRunPrincipal · runExtensionActionAsSystem
 * @usage
 *   const out = await runExtensionActionAsSystem({ storage, config, emailService }, {
 *     extensionName, actionId, instanceId, input,
 *     callerGaii: `scheduler@${config.nodeId}`, storageOwnerGhii: ownerGhii, ownerName,
 *     logLabel: 'scheduler',
 *   });
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- TARGET-063 A3: extracted from services/scheduler-extension-job.ts when
 *     the workflow engine gained an `extension` step and would otherwise have grown the second copy.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { executeExtensionAction, trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { buildExtensionCtx, buildExtensionNotify, buildExtensionEmail, sandboxLimits } from './extension-ctx.js';
import { makeExtensionFiles } from './extension-files.js';
import { makeExtensionDataPackage } from './datapackage/ext-capability.js';
import { getEncryptionKey } from './encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from './extension-secrets.js';
import type { EmailService } from './email.js';

export interface SystemRunDeps {
    storage: Storage;
    config: AimeatConfig;
    emailService?: EmailService;
}

export interface SystemRunArgs {
    extensionName: string;
    actionId: string;
    /** Instance-scoped run: its config (secrets decrypted) is handed to the sandbox as ctx.instance. */
    instanceId?: string;
    input?: Record<string, unknown>;
    /**
     * What the sandbox sees as `ctx.caller.gaii`. A schedule passes `scheduler@<node>` — there is
     * genuinely nobody — while a workflow step passes the run's owner GHII, because a workflow HAS
     * an owner and naming them is more honest than naming a machine.
     */
    callerGaii: string;
    /** Bare owner name: whose notifications, whose email consents, whose extension this must be. */
    ownerName: string;
    /**
     * The namespace `ctx.files` reads and writes. ALWAYS the owner's GHII on these roads, never the
     * caller — a data package produced on a clock has to sit at the same permanent
     * `/v1/pub/<owner>/…` address as the same package produced from the app or by an agent, and
     * `scheduler@<node>` owns no storage at all.
     */
    storageOwnerGhii: string;
    /** Distinguishes this road in the sandbox's log lines, e.g. 'scheduler' or 'wf:daily-scan'. */
    logLabel: string;
    /** What a data package produced on this road records as its producer. A clock and a workflow are
     *  different things to a consumer deciding whether to trust a cadence. */
    producerKind: 'extension' | 'workflow';
    /** The producer's own address — the schedule id or the workflow's `id/step` — so a consumer
     *  looking at a package can find the thing that makes it. */
    producerRef?: string;
    /** The cron the producer runs on, when it has one. This is what `updateFrequency` in the ODPS
     *  SLA block is projected from, so it is recorded rather than described. */
    producerSchedule?: string;
    /** Wrap the context in memory-access tracking and return the reads/writes (the scheduler logs them). */
    trackMemory?: boolean;
}

export interface SystemRunResult {
    result: unknown;
    reads: string[];
    writes: string[];
}

/**
 * Run one action with nobody present. Throws on every refusal rather than returning a shape the
 * caller has to remember to inspect: both roads treat a thrown error as a failed run that notifies
 * the owner, and a returned "not really" would be recorded as success by each of them.
 */
export async function runExtensionActionAsSystem(deps: SystemRunDeps, args: SystemRunArgs): Promise<SystemRunResult> {
    const { storage, config, emailService } = deps;
    const { extensionName, actionId, instanceId, ownerName, callerGaii, storageOwnerGhii, logLabel } = args;

    const ext = await storage.getExtension(extensionName);
    if (!ext) throw new Error(`Extension "${extensionName}" not found`);
    if (ext.status !== 'active') throw new Error(`Extension "${extensionName}" is not active`);
    // The fence. See the file header: an unattended call has no door where a price could be asked.
    if (ext.installedBy !== ownerName) {
        throw new Error(`Extension "${extensionName}" belongs to another owner — an unattended run may only call your own`);
    }
    const action = ext.actions.find(a => a.id === actionId);
    if (!action) throw new Error(`Action "${actionId}" not found in extension "${extensionName}"`);

    const encKey = getEncryptionKey(config);
    const extMemoryOwner = instanceId ? `ext:${ext.name}.${instanceId}` : `ext:${ext.name}`;

    // An instance-scoped run gets the same bring-your-own-key config a live instance action would;
    // `type: 'secret'` fields are decrypted just before the VM (services/extension-secrets.ts).
    let instanceCtx: { id: string; config: Record<string, unknown> } | undefined;
    if (instanceId) {
        const inst = await storage.getExtensionInstance(ext.name, instanceId);
        instanceCtx = {
            id: instanceId,
            config: inst
                ? decryptSecretFields(inst.config, getInstanceSecretKeys(ext), encKey)
                : (args.input ?? {}),
        };
    }

    const baseCtx: ExtensionCtx = buildExtensionCtx({
        config,
        storage,
        extMemoryOwner,
        // 'operator' is what the sandbox reads to decide no human is present. It is the role even
        // when `gaii` names the owner: a workflow step acts in the owner's name, it is not the owner
        // sitting at a screen, and an IAM gate that treats the two the same would let an unattended
        // run pass a door meant for a person.
        caller: { gaii: callerGaii, owner: ownerName, roles: ['operator'] },
        extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), encKey),
        instance: instanceCtx,
        logPrefix: `[ext:${ext.name}:${logLabel}]`,
        // No wallet: see the file header.
        files: makeExtensionFiles({
            config, storage, extName: ext.name,
            callerGaii: storageOwnerGhii,
            callerOwner: ownerName,
        }),
        // The deterministic producers live here, so this is the road ctx.datapackage exists for.
        // Owner namespace on both roads, and the producer block records WHICH unattended road it
        // was: a package a clock refreshes weekly and one a workflow rebuilds after a human approval
        // are different products, and a buyer choosing between them needs to see which is which.
        datapackage: makeExtensionDataPackage({
            config, storage,
            ownerGhii: storageOwnerGhii,
            producedBy: {
                gaii: callerGaii,
                kind: args.producerKind,
                ref: args.producerRef ?? `${ext.name}/${actionId}`,
                ...(args.producerSchedule ? { schedule: args.producerSchedule } : {}),
            },
        }),
        notify: buildExtensionNotify({
            storage, config, extName: ext.name,
            recipientGaii: ownerName, recipientOwner: ownerName,
        }),
        email: buildExtensionEmail({
            storage, config, extName: ext.name, extConfig: ext.config,
            ownerName, emailService,
        }),
    });

    const tracked = args.trackMemory ? trackMemoryAccess(baseCtx) : null;
    const ctx = tracked ? tracked.ctx : baseCtx;

    // Reject a non-serialisable input before the VM rather than inside it, where the failure reads
    // as a script bug.
    let input: Record<string, unknown>;
    try {
        input = JSON.parse(JSON.stringify(args.input ?? {})) as Record<string, unknown>;
    } catch {
        throw new Error(`Extension run "${extensionName}/${actionId}" has non-serializable input`);
    }

    const result = await executeExtensionAction(action.scriptContent, ctx, input, sandboxLimits(ext.limits, config));
    return {
        result,
        reads: tracked?.accessLog.reads ?? [],
        writes: tracked?.accessLog.writes ?? [],
    };
}
