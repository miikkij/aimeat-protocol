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
 *   v1.1.0 — 2026-08-13 — triggerScheduleRecord(): "run it now" joins the other three. It was the one
 *     schedule operation living in the router alone, which is why it existed on HTTP and nowhere else
 *     — and a chat that can create a morning job but cannot run it once has no way to prove the job
 *     works before the user is told it does.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8: the schedule WRITE, both doors).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ScheduleConstraint, AgentTaskScope, AgentRecord } from '../storage/interface.js';
import { buildGAII, isSameOwner } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { mergeConstraintDefaults, knownConstraintTypes } from './schedule-constraints.js';
import { checkScheduleGate, isValidCron, type ScheduleKind } from './schedule-gate.js';
import { getActiveScheduler, type Scheduler, type JobOutcome } from './scheduler.js';

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
}

export type ScheduleWriteErrorCode =
    | 'INVALID_KIND' | 'SCOPE_DENIED' | 'INVALID_CRON'
    | 'NOT_FOUND' | 'FORBIDDEN'
    | 'INVALID_INPUT' | 'CONNECTION_UNAVAILABLE' | 'NO_SUCH_FILE'
    | 'AGENT_NOT_FOUND' | 'AGENT_REQUIRED'
    | 'INVALID_EXTENSION_JOB' | 'EXTENSION_NOT_FOUND'
    | 'INVALID_AI_JOB' | 'NAMESPACE_DENIED'
    | 'INVALID_TASK_TEMPLATE'
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
export type ScheduleUpdateResult = { ok: true; schedule: ScheduledJobRecord | null } | ScheduleWriteRefusal;

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
 */
async function checkConnectionsPublishInput(
    storage: Storage, owner: string, raw: unknown,
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
    if (storageKey && !(await storage.getStorageFile(owner, storageKey))) {
        return { ok: false, status: 404, code: 'NO_SUCH_FILE', message: `you have no stored file named '${storageKey}'` };
    }
    return null;
}

/**
 * Owner manages every schedule they own; an agent only the ones it created. Exported because "run it
 * now" answers to the same rule as editing and cancelling, and a second copy of it in the router is
 * how the three would drift.
 */
export function canManageSchedule(caller: ScheduleWriteCaller, ownerScope: string, job: ScheduledJobRecord): boolean {
    if (job.ownerScope !== ownerScope) return false;
    if (caller.isOwnerSession) return true;
    return job.createdByAgent === true;
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
        const bad = await checkConnectionsPublishInput(storage, owner, body.input);
        if (bad) return bad;
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
        const ext = await storage.getExtension(extensionName);
        if (!ext) return { ok: false, status: 404, code: 'EXTENSION_NOT_FOUND', message: `Extension "${extensionName}" not found` };
        // Only the extension's own owner may put its actions on a clock. The scheduler runs an action as
        // a system caller — no paywall, no contract, no meter — so a cron on someone else's extension is
        // an unlimited standing call on their capability, their API keys and their quota, with no door
        // where a price could be asked. 404 rather than 403: which extensions exist is not a stranger's
        // business either.
        if (ext.installedBy !== caller.owner) {
            return { ok: false, status: 404, code: 'EXTENSION_NOT_FOUND', message: `Extension "${extensionName}" not found` };
        }
        base.extensionName = extensionName;
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
        // Invoke a connected ecosystem app's capability over the connect-tunnel on each fire.
        const app = typeof body.app === 'string' ? body.app : '';
        const capabilityId = typeof body.capability_id === 'string' ? body.capability_id : '';
        if (!app || !capabilityId) {
            return { ok: false, status: 400, code: 'INVALID_ECO_JOB', message: 'app and capability_id are required for eco-capability schedules' };
        }
        // The app must be connected under this owner.
        const ecoApp = await storage.getEcosystemAppByOwnerAndApp(caller.owner, app);
        if (!ecoApp) {
            return { ok: false, status: 404, code: 'ECO_APP_NOT_FOUND', message: `Ecosystem app "${app}" is not connected for this owner` };
        }
        // The named capability must be one the app actually declared at approval.
        const declared = (ecoApp.capabilities ?? []).map(c => c.id);
        if (!declared.includes(capabilityId)) {
            return { ok: false, status: 400, code: 'CAPABILITY_NOT_DECLARED', message: `Ecosystem app "${app}" does not declare capability "${capabilityId}"` };
        }
        base.input = {
            app,
            capability_id: capabilityId,
            input: (body.input && typeof body.input === 'object') ? body.input as Record<string, unknown> : {},
        };
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
            const bad = await checkConnectionsPublishInput(storage, ownerScope, patch.input);
            if (bad) return bad;
        }
        // Same rule as create for an `ai` job's input namespaces, and for the same reason: a gate that
        // only runs on create is walked around by editing the schedule afterwards.
        if (job.type === 'ai') {
            const p = patch.input as { inputNamespaces?: unknown; input_namespaces?: unknown };
            const foreign = foreignNamespace(job.ownerScope ?? ownerScope, p.inputNamespaces ?? p.input_namespaces);
            if (foreign) {
                return {
                    ok: false, status: 403, code: 'NAMESPACE_DENIED',
                    message: `input_namespaces may only name your own identities; "${foreign}" is not one of yours.`,
                };
            }
        }
        updates.input = patch.input as Record<string, unknown>;
    }

    const updated = await storage.updateScheduledJob(id, updates);
    await (deps.scheduler ?? getActiveScheduler())?.reschedule(id);
    emitChange('scheduler');
    return { ok: true, schedule: updated };
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
