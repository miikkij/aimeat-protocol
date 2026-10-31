/**
 * @file src/services/schedule-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Creating, editing and cancelling one schedule, once, for every surface that can do it.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/schedules` and `aimeat_schedule_create` each built a
 *   ScheduledJobRecord by hand and each called storage.createScheduledJob, and the two builds had
 *   drifted apart in ways nobody finds by reading either file on its own:
 *
 *     - `description` and `purpose` are cut to 2000 and 500 characters on the route and were stored
 *       whole by the tool, so an agent could park an unbounded string on the owner's schedule row.
 *     - the route validates a cron expression on EDIT as well as on create. The tool validated
 *       nothing on edit, so `aimeat_schedule_update` could turn a working schedule into one that
 *       never fires again, and the owner would learn it from the absence of a result.
 *     - the route 404s when the named target agent does not exist, whatever the kind. The tool
 *       checked that for `agent_task` only and stored a dangling agentGaii for the other kinds.
 *     - the route separates "no such schedule" (404) from "not yours to edit" (403); the tool gave
 *       one message for both.
 *
 *   Step 3 of the August 2026 audit moved the GATE (kind, per-kind scope, cron) into
 *   services/schedule-gate.ts. This is the other half: the per-kind input checks, the record build,
 *   the write, and the two side effects a schedule has beyond its row — registering it with the
 *   running Scheduler so it actually fires, and the `scheduler` change event the UI listens on.
 *
 *   A schedule is the one record that keeps acting after the call that made it, which is why the
 *   checks here are worth having in one place: a difference between the doors does not show up as a
 *   failed request, it shows up weeks later as a job that fires wrong or never fires at all.
 *
 *   WHAT IS NOT SHARED: how a request is parsed and how a refusal is rendered. The route answers in
 *   the success()/error() envelope, the tool answers in text, and neither belongs in a service.
 * @structure
 *   - ScheduleWriteDeps / ScheduleWriteCaller / ScheduleWriteResult — the contract
 *   - canManageSchedule() — who may edit, cancel or run one, shared with the trigger route
 *   - createScheduleRecord() — gate, per-kind checks, record build, store, register, emit
 *   - updateScheduleRecord() — manage check, patch validation, store, reschedule, emit
 *   - deleteScheduleRecord() — manage check, unregister, delete, emit
 *   - triggerScheduleRecord() — manage check, run once on the live clock, re-read, emit
 * @usage
 *   const out = await createScheduleRecord({ storage, config, scheduler }, caller, body);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   2026-10-31 — updateScheduleRecord writes a sibling's instruction hold before it stores the new
 *     instruction, and stores nothing when the hold cannot be written, so no fire between the two runs
 *     the instruction with the maker's reach (secaudit 2026-10-31 inv-27).
 *   2026-10-27 — A sibling agent's new prompt or input to an ai schedule that reads with more reach than
 *     the sibling has is stored and answered with a pending approval_request; the next fire waits for the
 *     owner (services/schedule-instruction-hold.ts; secaudit2026oct26, sibling-edit-fires-under-maker-reach).
 *   2026-10-25 — An extension schedule names the caller's own extension through
 *     services/component-address.ts (own first) and keeps its stored name (owner namespaces wish,
 *     secaudit2026oct22).
 *   2026-10-22 — An `ai` schedule's input may name no record of the owner or a sibling agent that the
 *     caller may not read itself (services/schedule-ai-read.ts aiScheduleInputRefusal), at create and
 *     at edit: 403 SCOPE_DENIED naming memory:read-as-owner. The owner in person and an app grant read
 *     every record, as before (secaudit 2026-10 wave 3, r49 the scheduled variant).
 *   2026-10-21 — triggerScheduleRecord: the app or ecosystem app that made an `extension` schedule on
 *     the once-only keep list (services/schedule-extension-keep.ts) may run it now without ext:invoke,
 *     as its fire runs; an edit by that app still asks the word.
 *   2026-10-20 — Four refusals from secaudit 2026-10, all on the same rule (a schedule acts as its
 *     maker, and a maker reaches no further through a schedule than it reaches directly):
 *     canManageSchedule names the caller's kind, so an ecosystem app manages only what it made and
 *     an agent manages no app-made or ecosystem-made schedule; an `ai` schedule's output_visibility
 *     is validated against the memory visibility vocabulary and the maker's organism membership at
 *     create AND at edit; the `eco-capability` input is checked by one helper on both paths; and a
 *     connections-publish schedule made by a non-owner may name only a file its maker can read,
 *     asked again at the fire (scheduleStorageFileRefusal).
 *   2026-10-16 — updateScheduleRecord and triggerScheduleRecord ask the per-kind scope of a caller
 *     who is not the owner in person, as create does (scheduleKindScopeRefusal); a pause or a rename
 *     asks none (QA audit F08a-02).
 *   2026-10-15 — canManageSchedule: an app manages only the schedule it made under its own grant, never
 *     an agent's; the comment says agents of the same owner manage each other's (feature-list audit #85).
 *   2026-10-05 — An app's schedule records its grant (`createdByApp`), so it fires as that app and
 *     stops with the grant (services/schedule-actor.ts; secaudit 2026-10, AI-2).
 *   2026-09-29 — The `refinery` kind: create and edit check input.prefix, the definition, and that its
 *     mailbox is the runner's own (services/refinery/schedule-input.ts); only the prefix is stored.
 *   2026-09-27 — An edit takes `prompt` and puts it where the kind keeps it (services/schedule-prompt.ts):
 *     an ai schedule's prompt, an agent_task schedule's task description. Other kinds refuse NO_PROMPT.
 *   v1.2.0 — 2026-09-26 — An `ai` schedule reads no record the node keeps for itself and writes its
 *     answer over none: create and edit refuse such an input or output key with 403 RESERVED_KEY
 *     (services/ai-job-keys.ts, the rule the AI job asks too). The fire asks again, for schedules
 *     stored earlier (secaudit 2026-09: A6-1, 573704db10ed).
 *   v1.1.0 — 2026-08-13 — triggerScheduleRecord(): "run it now" joins the other three. It was the one
 *     schedule operation living in the router alone, which is why it existed on HTTP and nowhere else
 *     — and a chat that can create a morning job but cannot run it once has no way to prove the job
 *     works before the user is told it does.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8: the schedule WRITE, both doors).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ScheduleConstraint, AgentTaskScope, AgentRecord } from '../storage/interface.js';
import { buildGAII, isGEAI, isSameOwner } from '../utils/gaii.js';
import { memoryWriteVisibilitySchema } from '../utils/visibility-words.js';
import { aiJobKeyRefusal } from './ai-job-keys.js';
import { readerForCaller } from './classification/reader.js';
import { emitChange } from './event-bus.js';
import type { FileRefAccessor } from './file-refs.js';
import { organismVisibilityRefusal } from './organism-visibility.js';
import { mergeConstraintDefaults, knownConstraintTypes } from './schedule-constraints.js';
import { scheduleFileDenial } from './schedule-file-access.js';
import { checkScheduleGate, isValidCron, scheduleKindScopeRefusal, type ScheduleKind } from './schedule-gate.js';
import { isKeptExtensionSchedule } from './schedule-extension-keep.js';
import { findExtension } from './component-address.js';
import { aiScheduleInputRefusal } from './schedule-ai-read.js';
import { instructionHoldNeeded, holdInstruction, clearInstructionHold } from './schedule-instruction-hold.js';
import { getActiveScheduler, type Scheduler, type JobOutcome } from './scheduler.js';
import { withSchedulePrompt } from './schedule-prompt.js';
import { checkRefineryScheduleInput, refineryRunAs } from './refinery/schedule-input.js';

/** Fields an edit may change without changing what the schedule does: no word is asked for these. */
const QUIET_EDIT_FIELDS: ReadonlySet<string> = new Set(['enabled', 'display_name', 'description', 'purpose']);

export interface ScheduleWriteDeps {
    storage: Storage;
    config: AimeatConfig;
    /**
     * The live clock, so a stored schedule starts firing without a restart. The HTTP router holds an
     * injected instance and passes it; a surface created per-request (MCP) omits this and gets the
     * process-wide active one. Null on a node running without a scheduler: the row is stored and
     * nothing is armed, which is what both doors already did.
     */
    scheduler?: Scheduler | null;
}

/** Who is asking, in the terms every surface can supply. */
export interface ScheduleWriteCaller {
    /** Bare owner name behind the session (`req.auth!.owner`, or the owner part of an agent GAII). */
    owner: string;
    /** Who created it, already resolved: resolveIdentity() on HTTP, the agent GAII over MCP. */
    identity: string;
    /** True only for a session acting as the owner themselves. Drives the scope bypass and canManage. */
    isOwnerSession: boolean;
    scopes: string[];
    /** The session's roles, for the reader a file-access check runs as (services/file-refs.ts). */
    roles?: string[];
    /** The app grant an app's token was issued under (`req.auth.app_grant`): the schedule fires as
     *  that app, while the grant is live (services/schedule-actor.ts). */
    appGrant?: string;
    /** True for an app's session (CallerContext kind 'app'): it manages only its own schedules. */
    isApp?: boolean;
    /**
     * True for an ecosystem app's session (CallerContext kind 'ecosystem'). A GEAI is a separately
     * consented third party, not one of the owner's agents, so it manages only what it made itself.
     * Without this flag it reached canManageSchedule's agent branch (secaudit 2026-10).
     */
    isEcosystem?: boolean;
}

/** The reader and identity a file-access check runs as, from the facts every door supplies. */
function accessorOf(
    deps: { storage: Storage; config: AimeatConfig }, caller: ScheduleWriteCaller,
): FileRefAccessor {
    const roles = caller.roles ?? [];
    return {
        gaii: caller.identity,
        sub: caller.identity,
        owner: caller.owner,
        reader: readerForCaller(deps, { gaii: caller.identity, owner: caller.owner, roles, scopes: caller.scopes }),
    };
}

export type ScheduleWriteErrorCode =
    | 'INVALID_KIND' | 'SCOPE_DENIED' | 'INVALID_CRON'
    | 'NOT_FOUND' | 'FORBIDDEN'
    | 'INVALID_INPUT' | 'CONNECTION_UNAVAILABLE' | 'NO_SUCH_FILE' | 'FILE_ACCESS_DENIED'
    | 'AGENT_NOT_FOUND' | 'AGENT_REQUIRED'
    | 'INVALID_EXTENSION_JOB' | 'EXTENSION_NOT_FOUND'
    | 'INVALID_AI_JOB' | 'NAMESPACE_DENIED' | 'RESERVED_KEY' | 'NOT_ORGANISM_MEMBER'
    | 'INVALID_TASK_TEMPLATE'
    // A prompt edit on a kind that runs with structured input (services/schedule-prompt.ts).
    | 'NO_PROMPT'
    | 'INVALID_ECO_JOB' | 'ECO_APP_NOT_FOUND' | 'CAPABILITY_NOT_DECLARED'
    | 'SCHEDULER_UNAVAILABLE' | 'TRIGGER_FAILED';

export interface ScheduleWriteRefusal {
    ok: false;
    status: number;
    code: ScheduleWriteErrorCode;
    message: string;
}

export type ScheduleWriteResult = { ok: true; schedule: ScheduledJobRecord } | ScheduleWriteRefusal;

/** updateScheduledJob answers null when the row vanished between the read and the write. */
export type ScheduleUpdateResult = { ok: true; schedule: ScheduledJobRecord | null } & Partial<HoldAnswer> | ScheduleWriteRefusal;
/** What an edit held for the owner adds to its answer: the pending request, or why none was filed. */
type HoldAnswer = { approval_request: unknown; warnings: Array<{ code: string; message: string }> };

/**
 * A manual run answers with what the clock actually did, not only that it was asked. `outcome.code`
 * separates "a task was queued" from "skipped, a previous run is still going" and from "it ran and
 * failed" — the three a caller must be able to tell apart before reporting success to anyone.
 */
export type ScheduleTriggerResult =
    { ok: true; schedule: ScheduledJobRecord | null; outcome: JobOutcome } | ScheduleWriteRefusal;

/** Normalise a constraints array from the request body (drop unknown types). */
function sanitizeConstraints(raw: unknown): ScheduleConstraint[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const known = new Set(knownConstraintTypes());
    const out: ScheduleConstraint[] = [];
    for (const c of raw) {
        if (!c || typeof c !== 'object') continue;
        const type = (c as { type?: string }).type;
        if (!type || !known.has(type)) continue;
        out.push({
            type,
            enabled: (c as { enabled?: boolean }).enabled === true,
            params: ((c as { params?: Record<string, unknown> }).params) ?? {},
            state: (c as { state?: Record<string, unknown> }).state,
        });
    }
    return out.length ? out : undefined;
}

/**
 * SECURITY (C-2): the first namespace in `input_namespaces` that does not belong to the job's owner,
 * or null when every entry is theirs. An `ai` job reads each namespace with the raw composite-key
 * lookup and pastes the value into the prompt, so an unchecked entry here is a verbatim read of
 * another owner's private memory. Owner GHII, the owner's agents (`bot#alice@node`) and their
 * ecosystem apps (`eco:app#alice@node`) all parse to the same owner and are allowed; anything else
 * is refused. A non-array or empty value is fine — the executor then defaults to the owner.
 */
function foreignNamespace(ownerIdentity: string, raw: unknown): string | null {
    if (!Array.isArray(raw)) return null;
    for (const entry of raw) {
        if (typeof entry !== 'string' || !entry) continue;   // falsy entries fall back to the owner
        if (!isSameOwner(entry, ownerIdentity)) return entry;
    }
    return null;
}

/**
 * Everything about a connections-publish input that can be checked BEFORE it fires.
 *
 * Shared by create AND edit, and that is the point: an edit replaces `input` wholesale, so a check
 * that only ran at create time would be a check anyone could walk around by editing afterwards.
 * The publish gate would still refuse a foreign connection — that is the wall — but a schedule
 * that is going to fail should be refused where somebody can see it, not at 07:00.
 *
 * `maker` is null for the owner in person and the accessor otherwise. The named file is read from
 * the OWNER's storage when the schedule fires and sent to an outside account, so a schedule made by
 * an agent, an app or an ecosystem app may name only a file that maker can read itself — the rule a
 * task attachment already follows (services/task-files.ts). Without it an agent that GET /v1/pub
 * answers 403 to published the owner's private file (secaudit 2026-10).
 */
async function checkConnectionsPublishInput(
    storage: Storage, config: AimeatConfig, owner: string, raw: unknown, maker: FileRefAccessor | null,
): Promise<ScheduleWriteRefusal | null> {
    const input = (raw ?? {}) as { connection_id?: unknown; storage_key?: unknown };
    const connectionId = typeof input.connection_id === 'string' ? input.connection_id : '';
    if (!connectionId) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'input.connection_id is required' };
    }
    const conn = await storage.getConnection(connectionId);
    // Absent and not-yours answer identically: a connection belongs to the person who attached it,
    // and the difference between the two answers would enumerate other people's accounts.
    if (!conn || conn.principal !== owner) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: 'no such connection of yours' };
    }
    if (conn.status !== 'active') {
        return {
            ok: false, status: 400, code: 'CONNECTION_UNAVAILABLE',
            message: 'that account needs to be reconnected before anything can be scheduled to it',
        };
    }
    const storageKey = typeof input.storage_key === 'string' ? input.storage_key : '';
    if (storageKey) {
        if (!(await storage.getStorageFile(owner, storageKey))) {
            return { ok: false, status: 404, code: 'NO_SUCH_FILE', message: `you have no stored file named '${storageKey}'` };
        }
        const denied = maker ? await scheduleFileDenial(storage, config, owner, storageKey, maker) : null;
        if (denied) return { ok: false, ...denied };
    }
    return null;
}

/**
 * The `ai` kind writes the model's answer into the owner's namespace at `output_visibility`, so the
 * word has to be one a memory write accepts, and an `organism:<id>` one has to name an organism the
 * maker's account is in. The fire writes through the memory write service, which asks both again;
 * this is the same question at save time, where somebody can read the answer. Nothing is checked
 * when no visibility is named: the fire then stores the record private.
 */
async function aiOutputVisibilityRefusal(
    storage: Storage, raw: unknown, callerIdentity: string,
): Promise<ScheduleWriteRefusal | null> {
    if (raw === undefined || raw === null) return null;
    if (!memoryWriteVisibilitySchema.safeParse(raw).success) {
        return {
            ok: false, status: 400, code: 'INVALID_AI_JOB',
            message: 'output_visibility must be private, owner, group, members, public or "organism:<organism id>".',
        };
    }
    const audience = await organismVisibilityRefusal(storage, raw, { identity: callerIdentity });
    return audience ? { ok: false, ...audience } : null;
}

/**
 * Everything about an `eco-capability` input that can be checked before it fires: the app is
 * connected under this owner and it declared the capability. Shared by create AND edit, because an
 * edit replaces `input` wholesale — until 2026-10-20 only create asked, so a PATCH stored a
 * capability the app never declared and the next fire sent it (secaudit 2026-10). The answer
 * carries the narrowed input, so only the three fields the executor reads are stored.
 */
async function checkEcoCapabilityInput(
    storage: Storage, ownerName: string, raw: unknown,
): Promise<{ ok: true; input: Record<string, unknown> } | ScheduleWriteRefusal> {
    const source = (raw ?? {}) as { app?: unknown; capability_id?: unknown; input?: unknown };
    const app = typeof source.app === 'string' ? source.app : '';
    const capabilityId = typeof source.capability_id === 'string' ? source.capability_id : '';
    if (!app || !capabilityId) {
        return { ok: false, status: 400, code: 'INVALID_ECO_JOB', message: 'app and capability_id are required for eco-capability schedules' };
    }
    const ecoApp = await storage.getEcosystemAppByOwnerAndApp(ownerName, app);
    if (!ecoApp) {
        return { ok: false, status: 404, code: 'ECO_APP_NOT_FOUND', message: `Ecosystem app "${app}" is not connected for this owner` };
    }
    const declared = (ecoApp.capabilities ?? []).map(c => c.id);
    if (!declared.includes(capabilityId)) {
        return { ok: false, status: 400, code: 'CAPABILITY_NOT_DECLARED', message: `Ecosystem app "${app}" does not declare capability "${capabilityId}"` };
    }
    return {
        ok: true,
        input: {
            app,
            capability_id: capabilityId,
            input: (source.input && typeof source.input === 'object') ? source.input as Record<string, unknown> : {},
        },
    };
}

/**
 * Who may edit, cancel or run one schedule. The owner manages every schedule they own. Any agent of
 * the same owner manages every schedule an agent of that owner made, its siblings' included (decision
 * "Core 2026-11 open questions", 2026-10-12, Q4). An app manages only the schedule it made under its
 * own grant: an app grant is limited to its own purpose, so it reaches no agent's schedule and no
 * other app's (feature-list audit #85). An ecosystem app manages only the schedule it made itself:
 * it is a separately consented third party with its own scope and data-area allowlist, not one of
 * the owner's agents. Exported because "run it now" answers to the same rule as editing and
 * cancelling, and a second copy of it in the router is how the three would drift.
 *
 * `createdByAgent` is set from `!isOwnerSession`, so it is true for an agent-made, an app-made AND
 * an ecosystem-made schedule. Reading it as "an agent made this" is what let an ecosystem app
 * delete the owner's agents' schedules and an agent edit an app's (secaudit 2026-10), so the agent
 * branch now also asks that no app grant and no GEAI made it.
 */
export function canManageSchedule(caller: ScheduleWriteCaller, ownerScope: string, job: ScheduledJobRecord): boolean {
    if (job.ownerScope !== ownerScope) return false;
    if (caller.isOwnerSession) return true;
    if (caller.isApp || caller.appGrant) return !!caller.appGrant && job.createdByApp === caller.appGrant;
    if (caller.isEcosystem) return job.createdBy === caller.identity;
    return job.createdByAgent === true && !job.createdByApp && !isGEAI(job.createdBy ?? '');
}

/**
 * Create one schedule from a create body.
 *
 * `body` is the loose shape both doors already speak: the route reads it off the request, the MCP
 * tool builds it from its own parameters. The field aliases (`target_agent`, `task_title`,
 * `extension_name` …) were added to the route so the same payload works either way, so there is
 * nothing to translate at the seam.
 */
export async function createScheduleRecord(
    deps: ScheduleWriteDeps,
    caller: ScheduleWriteCaller,
    body: Record<string, unknown>,
    forcedAgentName?: string,
): Promise<ScheduleWriteResult> {
    const { storage, config } = deps;
    const owner = `${caller.owner}@${config.nodeId}`;
    const kind = body.kind as ScheduleKind;

    // The gate (services/schedule-gate.ts): a schedule keeps acting after the call that made it, so
    // the caller has to hold the scope for the capability it DRIVES — a memory:write-only app must
    // not be able to cron the owner's AI budget. Owner sessions bypass, exactly as requireScope lets
    // them.
    const gateRefusal = checkScheduleGate(
        { kind, cron: typeof body.cron === 'string' ? body.cron : '', timezone: typeof body.timezone === 'string' ? body.timezone : undefined },
        { isOwnerSession: caller.isOwnerSession, scopes: caller.scopes },
    );
    if (gateRefusal) return { ok: false, ...gateRefusal };
    if (kind === 'connections-publish') {
        const bad = await checkConnectionsPublishInput(
            storage, config, owner, body.input,
            caller.isOwnerSession ? null : accessorOf({ storage, config }, caller),
        );
        if (bad) return bad;
    }
    if (kind === 'refinery') {
        const runAs = refineryRunAs({ createdByAgent: !caller.isOwnerSession, createdBy: caller.identity, ownerScope: owner });
        const bad = await checkRefineryScheduleInput(storage, owner, runAs, body.input);
        if (bad) return { ok: false, ...bad };
    }

    const cron = typeof body.cron === 'string' ? body.cron : '';
    const timezone = typeof body.timezone === 'string' ? body.timezone : undefined;
    // Kind, scope and cron were all checked by checkScheduleGate above.

    // Target agent = the forced name when the caller has one (the /v1/agents/:name/schedules path),
    // else a body field. Accept agent_name / target_agent / agent as aliases (target_agent mirrors
    // the MCP tool's field) so the same payload works across REST and MCP. The target is resolved
    // under the CALLER'S owner, so any same-owner agent can schedule any sibling agent — no
    // token-borrowing needed; createdBy still records the real creator.
    const bodyAgent = ['agent_name', 'target_agent', 'agent'].reduce(
        (acc, k) => acc ?? (typeof body[k] === 'string' ? (body[k] as string) : undefined),
        undefined as string | undefined,
    );
    const agentName = forcedAgentName ?? bodyAgent;
    let agentGaii: string | undefined;
    let agentRecord: AgentRecord | null = null;
    if (agentName) {
        agentGaii = buildGAII(agentName, caller.owner, config.nodeId);
        agentRecord = await storage.getAgent(agentGaii);
        if (!agentRecord) return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `Agent "${agentName}" not found` };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const displayName = (typeof body.display_name === 'string' && body.display_name.trim())
        || (typeof body.title === 'string' ? body.title : '') || `${kind} schedule`;

    const base: ScheduledJobRecord = {
        id,
        name: `schedule:${id}`,
        type: kind,
        cron,
        enabled: body.enabled !== false,
        createdBy: caller.identity,
        createdAt: now,
        updatedAt: now,
        ownerScope: owner,
        agentName,
        agentGaii,
        // True whenever a non-owner (agent) session created it — used by canManage so
        // the creating agent can manage its own schedules. Derived from session type
        // (not a literal 'agent' role, which agent tokens don't always carry).
        createdByAgent: !caller.isOwnerSession,
        // An app's schedule names its grant, so it fires as that app and stops with the grant
        // (services/schedule-actor.ts; secaudit 2026-10, AI-2).
        ...(caller.appGrant ? { createdByApp: caller.appGrant } : {}),
        displayName: displayName.slice(0, 200),
        description: typeof body.description === 'string' ? body.description.slice(0, 2000) : undefined,
        purpose: typeof body.purpose === 'string' ? body.purpose.slice(0, 500) : undefined,
        timezone,
        runCount: 0,
    };

    // Inherit the agent's default budget guards for any guard the body omits (reuse the record
    // already loaded above — no second getAgent).
    base.constraints = mergeConstraintDefaults(sanitizeConstraints(body.constraints), agentRecord?.scheduleConstraintDefaults);

    if (kind === 'extension') {
        const extensionName = typeof body.extension_name === 'string' ? body.extension_name : '';
        const actionId = typeof body.action_id === 'string' ? body.action_id : '';
        if (!extensionName || !actionId) {
            return { ok: false, status: 400, code: 'INVALID_EXTENSION_JOB', message: 'extension_name and action_id are required for extension schedules' };
        }
        // The caller's own first (services/component-address.ts); the job keeps the stored name.
        const ext = await findExtension(storage, extensionName, caller.owner, 'manage');
        if (!ext) return { ok: false, status: 404, code: 'EXTENSION_NOT_FOUND', message: `Extension "${extensionName}" not found` };
        // Only the extension's own owner may put its actions on a clock. The scheduler runs an action as
        // a system caller — no paywall, no contract, no meter — so a cron on someone else's extension is
        // an unlimited standing call on their capability, their API keys and their quota, with no door
        // where a price could be asked. 404 rather than 403: which extensions exist is not a stranger's
        // business either.
        if (ext.installedBy !== caller.owner) {
            return { ok: false, status: 404, code: 'EXTENSION_NOT_FOUND', message: `Extension "${extensionName}" not found` };
        }
        base.extensionName = ext.name;
        base.actionId = actionId;
        if (typeof body.instance_id === 'string') base.instanceId = body.instance_id;
        if (body.input && typeof body.input === 'object') base.input = body.input as Record<string, unknown>;
    } else if (kind === 'ai') {
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        if (!prompt) return { ok: false, status: 400, code: 'INVALID_AI_JOB', message: 'prompt is required for ai schedules' };
        const foreign = foreignNamespace(owner, body.input_namespaces);
        if (foreign) {
            return {
                ok: false, status: 403, code: 'NAMESPACE_DENIED',
                message: `input_namespaces may only name your own identities; "${foreign}" is not one of yours.`,
            };
        }
        // Every input goes to the model provider and the answer lands at output_key, so neither may
        // name a record the node keeps for itself. The fire asks again (scheduler-remote-jobs.ts).
        const kept = aiJobKeyRefusal({ inputKeys: body.input_keys, outputKey: body.output_key });
        if (kept) return { ok: false, ...kept };
        // The answer lands in the owner's namespace at this word, so it answers to memory's audience
        // rules here as well as at the fire (secaudit 2026-10).
        const badVisibility = await aiOutputVisibilityRefusal(storage, body.output_visibility, caller.identity);
        if (badVisibility) return badVisibility;
        // The schedule reads for its maker (services/schedule-ai-read.ts): no record of the owner or a
        // sibling that the maker may not read itself. The fire asks again, for records written later.
        const hidden = await aiScheduleInputRefusal(storage, caller, owner, { inputKeys: body.input_keys, inputNamespaces: body.input_namespaces });
        if (hidden) return { ok: false, ...hidden };
        base.input = {
            inputKeys: Array.isArray(body.input_keys) ? body.input_keys : [],
            inputNamespaces: Array.isArray(body.input_namespaces) ? body.input_namespaces : undefined,
            prompt,
            systemPrompt: typeof body.system_prompt === 'string' ? body.system_prompt : undefined,
            model: typeof body.model === 'string' ? body.model : undefined,
            outputKey: typeof body.output_key === 'string' ? body.output_key : undefined,
            outputVisibility: typeof body.output_visibility === 'string' ? body.output_visibility : 'private',
        };
    } else if (kind === 'agent_task') {
        if (!agentName || !agentGaii) {
            return { ok: false, status: 400, code: 'AGENT_REQUIRED', message: 'agent_name is required for agent_task schedules' };
        }
        // Accept either nested task_template.{title,description} or flat
        // task_title / task_description (mirrors the MCP tool's flat fields).
        const tmpl = body.task_template as Record<string, unknown> | undefined;
        const title = (tmpl && typeof tmpl.title === 'string' ? tmpl.title : '')
            || (typeof body.task_title === 'string' ? body.task_title : '');
        if (!title) return { ok: false, status: 400, code: 'INVALID_TASK_TEMPLATE', message: 'task_template.title (or task_title) is required for agent_task schedules' };
        const v = (tmpl?.verification ?? {}) as { user_expects?: string; technical_checks?: string[] };
        const flatDesc = typeof body.task_description === 'string' ? body.task_description : '';
        base.input = {
            taskTemplate: {
                title,
                description: typeof tmpl?.description === 'string' ? tmpl.description : flatDesc,
                scope: Array.isArray(tmpl?.scope) ? (tmpl!.scope as AgentTaskScope[]) : [],
                rules: Array.isArray(tmpl?.rules) ? tmpl!.rules : [],
                verification: {
                    userExpects: typeof v.user_expects === 'string' ? v.user_expects : '',
                    technicalChecks: Array.isArray(v.technical_checks) ? v.technical_checks : [],
                },
                resources: tmpl?.resources,
            },
        };
    } else if (kind === 'eco-capability') {
        // Invoke a connected ecosystem app's capability over the connect-tunnel on each fire. The
        // app must be connected under this owner and must have declared the capability at approval;
        // the edit path asks the same helper.
        const checked = await checkEcoCapabilityInput(storage, caller.owner, {
            app: body.app, capability_id: body.capability_id, input: body.input,
        });
        if (!checked.ok) return checked;
        base.input = checked.input;
    } else if (kind === 'connections-publish') {
        // Narrowed to the fields the executor reads. Copying the body wholesale would let a caller park
        // arbitrary JSON on the owner's schedule row, and `ref` is deliberately the ONLY free-form field
        // — stored and handed back, never parsed.
        const raw = (body.input ?? {}) as Record<string, unknown>;
        base.input = {
            connection_id: raw.connection_id,
            ...(typeof raw.caption === 'string' ? { caption: raw.caption } : {}),
            ...(typeof raw.storage_key === 'string' ? { storage_key: raw.storage_key } : {}),
            ...(raw.params && typeof raw.params === 'object' ? { params: raw.params } : {}),
            ...(typeof raw.ref === 'string' ? { ref: raw.ref.slice(0, 200) } : {}),
        };
    } else if (kind === 'refinery') {
        // Only the prefix: the definition lives in the owner's memory, where the app edits it.
        base.input = { prefix: String((body.input as { prefix?: unknown }).prefix).trim() };
    }

    const created = await storage.createScheduledJob(base);
    // Arming the live clock is part of creating a schedule, not a courtesy the door does afterwards:
    // a stored row nobody registered does nothing until the next restart.
    if (created.enabled) (deps.scheduler ?? getActiveScheduler())?.addJob(created);
    emitChange('scheduler');
    return { ok: true, schedule: created };
}

/**
 * Edit one schedule: pause, resume, re-time or replace its input.
 *
 * The two re-checks below are the reason edit is here rather than beside create. A gate that only
 * runs on create is walked around by editing the schedule afterwards, so `input` is judged by the
 * same rules on both paths.
 */
export async function updateScheduleRecord(
    deps: ScheduleWriteDeps,
    caller: ScheduleWriteCaller,
    id: string,
    patch: Record<string, unknown>,
): Promise<ScheduleUpdateResult> {
    const { storage, config } = deps;
    const ownerScope = `${caller.owner}@${config.nodeId}`;
    const job = await storage.getScheduledJob(id);
    if (!job) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Schedule "${id}" not found` };
    if (!canManageSchedule(caller, ownerScope, job)) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not allowed to edit this schedule' };
    }
    // The word for what the schedule drives, as on create: it fires as its maker, so a sibling
    // without ai:use would otherwise point the maker's AI schedule at new input and spend for it
    // (QA audit F08a-02). Pausing it, or renaming it, changes nothing it does and needs no word.
    const quietOnly = Object.entries(patch).every(([k, v]) => v === undefined || QUIET_EDIT_FIELDS.has(k))
        && patch.enabled !== true;
    if (!quietOnly) {
        const scopeRefusal = scheduleKindScopeRefusal(job.type, caller, 'edit');
        if (scopeRefusal) return { ok: false, ...scopeRefusal };
    }

    const updates: Partial<ScheduledJobRecord> = { updatedAt: new Date().toISOString() };
    if (typeof patch.enabled === 'boolean') updates.enabled = patch.enabled;
    if (typeof patch.cron === 'string') {
        const tz = typeof patch.timezone === 'string' ? patch.timezone : job.timezone;
        if (!isValidCron(patch.cron, tz)) return { ok: false, status: 400, code: 'INVALID_CRON', message: 'cron is invalid' };
        updates.cron = patch.cron;
    }
    if (typeof patch.timezone === 'string') updates.timezone = patch.timezone;
    if (typeof patch.display_name === 'string') updates.displayName = patch.display_name.slice(0, 200);
    if (typeof patch.description === 'string') updates.description = patch.description.slice(0, 2000);
    if (typeof patch.purpose === 'string') updates.purpose = patch.purpose.slice(0, 500);
    if (patch.constraints !== undefined) updates.constraints = sanitizeConstraints(patch.constraints);
    if (patch.input && typeof patch.input === 'object') {
        // A connections-publish edit is re-checked against the SAME rule the create used. Without this
        // the ownership check is create-only, and "edit the schedule afterwards" walks around it.
        if (job.type === 'connections-publish') {
            const bad = await checkConnectionsPublishInput(
                storage, config, job.ownerScope ?? ownerScope, patch.input,
                caller.isOwnerSession ? null : accessorOf({ storage, config }, caller),
            );
            if (bad) return bad;
        }
        // The eco-capability rule from create, on the input that replaces the old one. Without it a
        // PATCH stored a capability the app never declared and the next fire sent it.
        if (job.type === 'eco-capability') {
            const checked = await checkEcoCapabilityInput(storage, caller.owner, patch.input);
            if (!checked.ok) return checked;
            patch = { ...patch, input: checked.input };
        }
        if (job.type === 'refinery') {
            const bad = await checkRefineryScheduleInput(storage, job.ownerScope ?? ownerScope, refineryRunAs(job), patch.input);
            if (bad) return { ok: false, ...bad };
            patch = { ...patch, input: { prefix: String((patch.input as { prefix: string }).prefix).trim() } };
        }
        // Same rule as create for an `ai` job's input namespaces, and for the same reason: a gate that
        // only runs on create is walked around by editing the schedule afterwards.
        if (job.type === 'ai') {
            const p = patch.input as {
                inputNamespaces?: unknown; input_namespaces?: unknown;
                inputKeys?: unknown; input_keys?: unknown; outputKey?: unknown; output_key?: unknown;
                outputVisibility?: unknown; output_visibility?: unknown;
            };
            const foreign = foreignNamespace(job.ownerScope ?? ownerScope, p.inputNamespaces ?? p.input_namespaces);
            if (foreign) {
                return {
                    ok: false, status: 403, code: 'NAMESPACE_DENIED',
                    message: `input_namespaces may only name your own identities; "${foreign}" is not one of yours.`,
                };
            }
            // The create's rule about the records the node keeps, on the input that replaces the old
            // one. Both spellings, as the namespace check above reads both.
            const listed = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
            const kept = aiJobKeyRefusal({
                inputKeys: [...listed(p.inputKeys), ...listed(p.input_keys)],
                outputKey: p.outputKey ?? p.output_key,
            });
            if (kept) return { ok: false, ...kept };
            // And the create's rule about who the answer may be shown to. Both spellings, as above.
            const badVisibility = await aiOutputVisibilityRefusal(
                storage, p.outputVisibility ?? p.output_visibility, caller.identity,
            );
            if (badVisibility) return badVisibility;
            // And the create's rule about whose records it reads, asked of whoever gives the new input.
            const hidden = await aiScheduleInputRefusal(storage, caller, job.ownerScope ?? ownerScope, p as Record<string, unknown>);
            if (hidden) return { ok: false, ...hidden };
        }
        updates.input = patch.input as Record<string, unknown>;
    }
    // A new prompt goes where the kind keeps it (services/schedule-prompt.ts), on top of an input this
    // same patch replaced, else on the stored one; the rest of the input stays as it was.
    if (patch.prompt !== undefined) {
        const next = withSchedulePrompt({ type: job.type, input: updates.input ?? job.input }, patch.prompt);
        if (!next.ok) return next;
        updates.input = next.input;
    }

    // A new instruction to an ai schedule that reads with more reach than its editor has waits for the
    // owner's one press before it fires (services/schedule-instruction-hold.ts; secaudit2026oct26).
    const instructed = job.type === 'ai' && updates.input !== undefined;
    const hold = instructed ? await instructionHoldNeeded(storage, caller, job, updates.input!) : null;

    // The hold is written before the instruction is stored, so no fire in between runs it with the
    // maker's reach; a hold that cannot be written throws here and nothing is stored (secaudit
    // 2026-10-31 inv-27).
    let asked: Awaited<ReturnType<typeof holdInstruction>> | null = null;
    if (hold) {
        asked = await holdInstruction(deps, {
            owner: caller.owner, requester: { principal: caller.identity, kind: 'agent', sub: caller.identity },
            job, maker: hold.maker, previousInput: (job.input ?? {}) as Record<string, unknown>, input: updates.input!,
        });
    }
    const updated = await storage.updateScheduledJob(id, updates);
    if (!hold && instructed) await clearInstructionHold(storage, config.nodeId, id);
    await (deps.scheduler ?? getActiveScheduler())?.reschedule(id);
    emitChange('scheduler');
    return { ok: true, schedule: updated, ...(asked ?? {}) };
}

/** Cancel one schedule: off the clock first, then out of storage. */
export async function deleteScheduleRecord(
    deps: ScheduleWriteDeps,
    caller: ScheduleWriteCaller,
    id: string,
): Promise<ScheduleWriteResult> {
    const { storage, config } = deps;
    const ownerScope = `${caller.owner}@${config.nodeId}`;
    const job = await storage.getScheduledJob(id);
    if (!job) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Schedule "${id}" not found` };
    if (!canManageSchedule(caller, ownerScope, job)) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not allowed to delete this schedule' };
    }
    (deps.scheduler ?? getActiveScheduler())?.removeJob(id);
    await storage.deleteScheduledJob(id);
    emitChange('scheduler');
    return { ok: true, schedule: job };
}

/**
 * Run one schedule now, off its cron.
 *
 * This is how a schedule is PROVEN rather than assumed. A job that was created correctly and fires
 * at 07:00 tells you nothing until it has run once and written something, so whoever sets one up
 * runs it here and then reads the result key back. `outcome` is relayed rather than flattened into
 * a boolean: "skipped, a run is already going" and "ran and failed" are not success, and a caller
 * that cannot tell them apart will report a working morning job that never wrote a line.
 *
 * A node with no clock refuses instead of quietly doing nothing, because the whole point of the
 * call is that something happens while the caller is watching.
 */
export async function triggerScheduleRecord(
    deps: ScheduleWriteDeps,
    caller: ScheduleWriteCaller,
    id: string,
): Promise<ScheduleTriggerResult> {
    const { storage, config } = deps;
    const ownerScope = `${caller.owner}@${config.nodeId}`;
    const job = await storage.getScheduledJob(id);
    if (!job) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Schedule "${id}" not found` };
    if (!canManageSchedule(caller, ownerScope, job)) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not allowed to trigger this schedule' };
    }
    // Running it now spends what the schedule drives, so the caller holds that word (F08a-02). One
    // exception: the app (or ecosystem app) that made an `extension` schedule on the once-only keep
    // list runs it now as its fire runs it (services/schedule-extension-keep.ts). canManageSchedule
    // above has already said the caller is that app.
    const scopeRefusal = scheduleKindScopeRefusal(job.type, caller, 'run');
    const keptForThisApp = !!scopeRefusal && job.type === 'extension'
        && (caller.isApp || !!caller.appGrant || caller.isEcosystem === true)
        && await isKeptExtensionSchedule(storage, config.nodeId, job.id);
    if (scopeRefusal && !keptForThisApp) return { ok: false, ...scopeRefusal };
    const scheduler = deps.scheduler ?? getActiveScheduler();
    if (!scheduler) {
        return {
            ok: false, status: 503, code: 'SCHEDULER_UNAVAILABLE',
            message: 'This node is running without a scheduler, so nothing can be run on demand.',
        };
    }
    let outcome: JobOutcome;
    try {
        outcome = await scheduler.triggerNow(id);
    } catch (err) {
        return { ok: false, status: 500, code: 'TRIGGER_FAILED', message: `Run failed: ${(err as Error).message}` };
    }
    const updated = await storage.getScheduledJob(id);
    emitChange('scheduler');
    return { ok: true, schedule: updated, outcome };
}
