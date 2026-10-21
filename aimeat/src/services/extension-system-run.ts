/**
 * @file src/services/extension-system-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *
 *   THE NAMESPACE IS NOT THE READ AUTHORITY. `storageOwnerGhii` says where a produced file lands,
 *   and it is always the owner's, because a package made on a clock needs the same permanent
 *   address as one made from the app. It used to be handed to `ctx.files` as the accessor as well,
 *   and `authorizeRead` admits every private file of the account it names. So an agent holding only
 *   `ext:write` and `ext:invoke` installed an extension whose unattended action read the owner's
 *   private files and reported back what it found, while the same read through the attended invoke
 *   and through `GET /v1/pub` was refused it (secaudit 2026-10,
 *   extension-system-run:files-read-as-owner-ghii). The two questions are now separate, and which
 *   principal answers the second one is THE OWNER'S CHOICE per extension
 *   (`ExtensionRecord.unattendedReadAuthority`): 'owner' or absent keeps the reach every extension
 *   has always had, and 'installer' narrows the run to the principal that wrote the code, with the
 *   scopes that principal holds NOW.
 *
 *   THE DEFAULT IS THE OLD BEHAVIOUR, DELIBERATELY. Closing this read by default would stop working
 *   extensions on nodes whose owners never asked for the narrower rule, and an owner's agent acts
 *   for the owner: `ext:write` is that owner's own grant of the reach (Jouni, 2026-10-20). What the
 *   finding costs instead is visibility — the extension's page names the principal that installed
 *   it and what it may read unattended — plus one setting the owner can turn on.
 * @structure unattendedExtensionReader · SystemRunTarget · SystemRunPrincipal · runExtensionActionAsSystem
 * @usage
 *   const out = await runExtensionActionAsSystem({ storage, config, emailService }, {
 *     extensionName, actionId, instanceId, input,
 *     callerGaii: `scheduler@${config.nodeId}`, storageOwnerGhii: ownerGhii, ownerName,
 *     logLabel: 'scheduler',
 *   });
 * @version-history
 *   v1.7.1 — 2026-10-21 — The ctx it builds says `unattended: true`, so the code writer decides a
 *     vault secret's first host (secaudit 2026-10, v59).
 *   v1.7.0 — 2026-10-20 — The read authority is the owner's choice per extension, and its default is
 *     the behaviour every node already has (Jouni, 2026-10-20). unattendedReader is renamed
 *     unattendedExtensionReader: ai-jobs/starter.ts exports a different function under the old name.
 *   v1.6.0 — 2026-10-20 — ctx.files reads as the principal that wrote the extension's code, not as
 *     the owner whose namespace it writes into (secaudit 2026-10,
 *     extension-system-run:files-read-as-owner-ghii).
 *   v1.5.1 — 2026-10-09 — Secret config is decrypted for the field it is bound to (SecretBinding;
 *     secrets audit 2026-10-09, 1.1).
 *   v1.5.0 — 2026-10-08 — ctx.workspace with the two row calls only, when the manifest declares
 *     workspace.rows (services/extension-workspace.ts, buildUnattendedExtensionWorkspace).
 *   v1.4.0 — 2026-10-05 — The run passes the extension's capabilities to buildExtensionCtx (secaudit
 *     2026-10, PKG-3).
 *   v1.3.0 -- 2026-09-28 -- System 2 plan, V6: `providerCall` (passed to buildExtensionCtx) and
 *     `signal` (passed to executeExtensionAction), so the AI gateway can run an extension as a
 *     provider. The owner check below is unchanged and is what refuses another owner's extension.
 *   v1.2.0 -- 2026-09-05 -- Says, where the context is built, that no ctx.workspace is attached
 *     here: an unattended run has no caller whose workspace it could act on.
 *   v1.1.0 -- 2026-08-31 -- Optional `ai`, so a job's on_done callback can start the next job in its
 *     chain. Handed in rather than built here: which job is being continued is knowable only to the
 *     caller, and a continuation that did not know its parent could not report that the chain broke.
 *   v1.0.0 -- 2026-08-15 -- TARGET-063 A3: extracted from services/scheduler-extension-job.ts when
 *     the workflow engine gained an `extension` step and would otherwise have grown the second copy.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { isGEAI } from '../utils/gaii.js';
import { saverAuthority } from './workflow/trigger-authority.js';
import { executeExtensionAction } from './extension-runtime.js';
import { trackMemoryAccess } from './extension-runtime-tracking.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { buildExtensionCtx, buildExtensionNotify, buildExtensionEmail, sandboxLimits } from './extension-ctx.js';
import { capabilitiesOfRecord } from './extension-capability-declaration.js';
import type { ExtensionCtxDeps } from './extension-ctx.js';
import { makeExtensionFiles } from './extension-files.js';
import { buildUnattendedExtensionWorkspace } from './extension-workspace-rows.js';
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
    /**
     * Background AI jobs, when this road can offer them. Passed in rather than built here because
     * the CHAIN matters: an action fired as a job's `on_done` starts its next job as a continuation
     * of that job, and only the caller knows which job it is continuing.
     */
    ai?: ExtensionCtx['ai'];
    /**
     * Set when the extension runs as an AI provider (System 2 plan V6): ctx.fetch reaches only the
     * declared hosts, and the owner's provider key header is added outside the sandbox. Passed
     * through to buildExtensionCtx unchanged; see ExtensionCtxDeps.providerCall.
     */
    providerCall?: ExtensionCtxDeps['providerCall'];
    /** The caller's cancellation. When it aborts, the run rejects with `Extension run aborted`
     *  (services/extension-runtime.ts). */
    signal?: AbortSignal;
}

export interface SystemRunResult {
    result: unknown;
    reads: string[];
    writes: string[];
}

/** The principal an unattended run's file reads are judged against. */
export interface UnattendedReader {
    gaii: string;
    owner: string;
    roles: string[];
    scopes: string[];
}

/**
 * Who this run reads as.
 *
 * THE OWNER'S REACH IS THE DEFAULT, and it is what an absent setting means, so an extension that
 * works today keeps working after this deploy and after the migration. `unattendedReadAuthority`
 * reaches 'installer' only because the account holder in person set it there, and that is the whole
 * consent: the owner saw which principal installed the extension and chose the narrower rule.
 *
 * With 'installer' the reach is `installedByPrincipal`, which is `req.auth!.sub` as the install door
 * had it. A name with no `#` is the ACCOUNT — the account holder in person leaves `sub` as the bare
 * name, and an app grant carries the account's own GHII — so it still reads as the account holder,
 * because narrowing an extension the owner installed themselves would narrow it to the owner. A name
 * with a `#` is an agent or an ecosystem app, and its scopes are asked again here rather than
 * remembered, because the owner can narrow or remove it after the install; one that is gone reads
 * with no scopes at all.
 *
 * A record written before 2026-10-20 carries no principal. Setting 'installer' on one reads as the
 * account holder, which is what it already does: the field cannot be recovered afterwards, and the
 * next write of the extension's code stamps the real principal
 * (services/extension-lifecycle.ts). The extension's page says so, rather than reporting a narrowing
 * that is not in force.
 *
 * KNOWN RESIDUAL: an app grant's `sub` is the account's GHII, so an extension installed through an
 * app grant reads as the account holder even under 'installer'. Telling that apart needs the grant
 * id on the record, which is a wider change than this one.
 */
export async function unattendedExtensionReader(
    storage: Storage,
    ext: Pick<ExtensionRecord, 'installedByPrincipal' | 'unattendedReadAuthority'>,
    ownerName: string,
    ownerGhii: string,
): Promise<UnattendedReader> {
    const asOwner = { gaii: ownerGhii, owner: ownerName, roles: ['owner'], scopes: ['*'] };
    if (ext.unattendedReadAuthority !== 'installer') return asOwner;
    const principal = (ext.installedByPrincipal ?? '').trim();
    if (!principal.includes('#')) return asOwner;
    const kind = isGEAI(principal) ? 'ecosystem' as const : 'agent' as const;
    const now = await saverAuthority(storage, { kind, id: principal });
    return { gaii: principal, owner: ownerName, roles: [kind], scopes: now.gone ? [] : now.scopes };
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
    // Asked before the sandbox starts, and asked again on every run: the owner can narrow or remove
    // an agent after it installed the extension, and the next run must see that.
    const reader = await unattendedExtensionReader(storage, ext, ownerName, storageOwnerGhii);

    // An instance-scoped run gets the same bring-your-own-key config a live instance action would;
    // `type: 'secret'` fields are decrypted just before the VM (services/extension-secrets.ts).
    let instanceCtx: { id: string; config: Record<string, unknown> } | undefined;
    if (instanceId) {
        const inst = await storage.getExtensionInstance(ext.name, instanceId);
        instanceCtx = {
            id: instanceId,
            config: inst
                ? decryptSecretFields(inst.config, getInstanceSecretKeys(ext), encKey, { extension: ext.name, instance: instanceId })
                : (args.input ?? {}),
        };
    }

    const baseCtx: ExtensionCtx = buildExtensionCtx({
        config,
        storage,
        extMemoryOwner,
        extension: { name: ext.name, owner: ext.installedBy },
        capabilities: capabilitiesOfRecord(ext),
        // 'operator' is what the sandbox reads to decide no human is present. It is the role even
        // when `gaii` names the owner: a workflow step acts in the owner's name, it is not the owner
        // sitting at a screen, and an IAM gate that treats the two the same would let an unattended
        // run pass a door meant for a person.
        // No scopes, and that is the honest answer rather than a forgotten field: there is no
        // session here, so there is no list of words anybody granted. A script deciding what an
        // unattended run may do reads the 'operator' role, which says exactly that.
        caller: { gaii: callerGaii, owner: ownerName, roles: ['operator'], scopes: [] },
        // Nobody is present: the extension's code writer decides a vault secret's first host.
        unattended: true,
        extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), encKey, { extension: ext.name }),
        instance: instanceCtx,
        logPrefix: `[ext:${ext.name}:${logLabel}]`,
        // No wallet: see the file header. Of ctx.workspace, only the two row calls: the record and
        // document calls act on the CALLER's workspace as the caller, an unattended run has nobody
        // present to act as, and a schedule naming the owner would be the owner's authority on a
        // clock, which is what the scope guard on the attended code paths exists to refuse. The row
        // calls stand on the organism naming this extension in the space (row-service.ts,
        // authorizeExtension) and on the manifest's workspace.rows, never on the owner's session.
        workspace: buildUnattendedExtensionWorkspace({ config, storage, ext, ownerGhii: storageOwnerGhii }).workspace,
        // The owner's namespace for a write, and for a read whichever authority the owner chose. See
        // the file header: handing the namespace in as the accessor was the whole defect, and which
        // principal answers the read is `unattendedReadAuthority`.
        files: makeExtensionFiles({
            config, storage, extName: ext.name,
            callerGaii: storageOwnerGhii,
            callerOwner: ownerName,
            readerGaii: reader.gaii,
            readerOwner: reader.owner,
            readerRoles: reader.roles,
            readerScopes: reader.scopes,
            ...(reader.gaii === storageOwnerGhii ? {} : {
                narrowedNote: `This extension runs unattended with the reach of ${reader.gaii}, because you set it to read as its installer. Change it on the extension's page at /profile?tab=extensions.`,
            }),
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
        ...(args.ai ? { ai: args.ai } : {}),
        notify: buildExtensionNotify({
            storage, config, extName: ext.name,
            recipientGaii: ownerName, recipientOwner: ownerName,
        }),
        email: buildExtensionEmail({
            storage, config, extName: ext.name, extConfig: ext.config,
            ownerName, emailService,
        }),
        ...(args.providerCall ? { providerCall: args.providerCall } : {}),
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

    const result = await executeExtensionAction(action.scriptContent, ctx, input, sandboxLimits(ext.limits, config),
        args.signal ? { signal: args.signal } : undefined);
    return {
        result,
        reads: tracked?.accessLog.reads ?? [],
        writes: tracked?.accessLog.writes ?? [],
    };
}
