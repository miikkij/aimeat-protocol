/**
 * @file src/services/schedule-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a caller must hold before a schedule is created, for every surface that creates
 *   one.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/schedules` refuses three things the MCP tool did not refuse at
 *   all, and a schedule is the one record that keeps acting after the call that made it:
 *
 *     - THE PER-KIND SCOPE. A schedule drives a capability, so the caller has to hold the scope for
 *       what it drives, not merely for "making a schedule". Without this a memory:write-only app
 *       could cron the owner's AI budget (kind 'ai') or materialise tasks into the owner's agent
 *       queues (kind 'agent_task'). The route has enforced this since it was written; the MCP tool
 *       created any kind for any caller.
 *     - THE CRON EXPRESSION. The route validates it against the timezone. The MCP tool stored the
 *       string as given, so an unparseable expression became a job that either never fires or is
 *       rejected later by the scheduler, silently.
 *     - THE OWNER SESSION BYPASS. An owner acts for all of their own agents, so the scope check is
 *       skipped for them, exactly as `requireScope` skips it. A scoped principal — an app grant, a
 *       narrowly-scoped agent — is not an owner and does not get the bypass.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - SCHEDULE_KIND_SCOPE — which scope each kind of schedule requires
 *   - scheduleKindScopeRefusal() — the per-kind scope alone, for create, edit and run
 *   - checkScheduleGate() — scope + cron, in that order, returning a refusal or null
 * @usage
 *   const bad = checkScheduleGate({ kind, cron, timezone }, caller);
 *   if (bad) return renderRefusal(bad);   // each door renders its own way
 * @version-history
 *   2026-10-20 — The `extension` kind asks `ext:invoke`, the word POST /v1/ext/:ext/:action asks, on
 *     create, edit and run; the fire asks the maker again (services/scheduler-extension-job.ts)
 *     (secaudit 2026-10, SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke).
 *   2026-10-20 — The `eco-capability` kind asks `work:request`, the word POST /v1/capabilities/:id/invoke
 *     requires, on create, edit and run (secaudit 2026-10, runEcoCapabilityJob:owner-caller-no-scope-no-maker-check).
 *   2026-10-16 — scheduleKindScopeRefusal(): the per-kind scope as its own check, so editing and
 *     running a schedule ask it as creating does (QA audit F08a-02).
 *   v1.1.1 — 2026-10-05 — hasScope is scopeIsCovered (secaudit 2026-10, C3).
 *   v1.1.0 — 2026-09-29 — The `refinery` kind, which needs all four words a refinery batch spends; a
 *     kind's entry may name several words, and the caller holds every one.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B: shared gate, both doors).
 */
import { Cron } from 'croner';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/** Every schedule kind this node knows. */
export type ScheduleKind = 'extension' | 'ai' | 'agent_task' | 'eco-capability' | 'connections-publish' | 'refinery';

/**
 * The scope a caller needs for the capability the schedule DRIVES, or every scope when it drives
 * several. A kind absent from this map needs nothing beyond being allowed to make a schedule at
 * all — which is what the tool's own scope says.
 */
export const SCHEDULE_KIND_SCOPE: Partial<Record<ScheduleKind, string | readonly string[]>> = {
    // Running an installed extension's action with the input the schedule stores. POST
    // /v1/ext/:ext/:action, aimeat_extension_invoke and the workflow extension step ask this word,
    // so a task:write-only principal must not reach the same action through a schedule
    // (secaudit 2026-10, SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke).
    extension: 'ext:invoke',
    ai: 'ai:use',
    agent_task: 'task:write',
    // Invoking a connected ecosystem app's capability, which is what this kind does on every fire.
    // The direct route POST /v1/capabilities/:id/invoke asks the same word, and a schedule must not
    // be the cheaper way in (secaudit 2026-10).
    'eco-capability': 'work:request',
    'connections-publish': 'connections:use',
    // A refinery batch reads a mailbox, asks the models, writes rows and moves its cursor.
    refinery: ['connections:read-through', 'ai:use', 'organism:rows', 'memory:write'],
};

export interface ScheduleCaller {
    /** True for a session acting as the owner themselves — they act for all their own agents. */
    isOwnerSession: boolean;
    scopes: string[];
}

export interface ScheduleGateInput {
    kind: string;
    cron: string;
    timezone?: string;
}

export interface ScheduleRefusal {
    status: number;
    code: 'INVALID_KIND' | 'SCOPE_DENIED' | 'INVALID_CRON';
    message: string;
}

const VALID_KINDS: ScheduleKind[] = ['extension', 'ai', 'agent_task', 'eco-capability', 'connections-publish', 'refinery'];

/** Validate a cron expression (or the @activate sentinel) using croner. Moved here from
 *  routes/schedules.ts so both doors judge the same string the same way. */
export function isValidCron(cron: string, timezone?: string): boolean {
    if (cron === '@activate') return true;
    try {
        const opts: { timezone?: string; paused?: boolean } = { paused: true };
        if (timezone) opts.timezone = timezone;
        const c = new Cron(cron, opts);
        const ok = !!c.nextRun();
        c.stop();
        return ok;
    } catch (err) {
        logger.warn('schedule gate: unparseable cron, refusing', { error: String(err) });
        return false;
    }
}

/** Does this session carry the scope? scopeIsCovered, the rule requireScope applies (C3). */
const hasScope = (scopes: string[], needed: string): boolean => scopeIsCovered(scopes, needed);

/** What the caller is doing to a schedule, for the sentence a refusal says. */
export type ScheduleAct = 'create' | 'edit' | 'run';
const ACT_WORD: Record<ScheduleAct, string> = { create: 'Creating', edit: 'Editing', run: 'Running' };

/**
 * The per-kind scope, asked of the caller for any act that makes the schedule drive its capability:
 * creating it, editing it (a new input, prompt or cron is a new instruction) and running it now. The
 * schedule fires as its maker, so a caller without the word would otherwise spend the maker's
 * (QA audit F08a-02). The owner in person is never refused, as requireScope never refuses them.
 */
export function scheduleKindScopeRefusal(kind: string, caller: ScheduleCaller, act: ScheduleAct): ScheduleRefusal | null {
    const entry = SCHEDULE_KIND_SCOPE[kind as ScheduleKind];
    const needed = entry === undefined ? [] : typeof entry === 'string' ? [entry] : [...entry];
    const missing = caller.isOwnerSession ? [] : needed.filter(s => !hasScope(caller.scopes, s));
    if (!missing.length) return null;
    return {
        status: 403, code: 'SCOPE_DENIED',
        message: needed.length === 1
            ? `${ACT_WORD[act]} a "${kind}" schedule requires the "${needed[0]}" scope.`
            : `${ACT_WORD[act]} a "${kind}" schedule requires the ${needed.map(s => `"${s}"`).join(', ')} scopes; missing ${missing.map(s => `"${s}"`).join(', ')}.`,
    };
}

/**
 * The three refusals, in the order the route has always applied them. Returns null when the caller
 * may proceed; the caller then builds and stores the record its own way.
 */
export function checkScheduleGate(input: ScheduleGateInput, caller: ScheduleCaller): ScheduleRefusal | null {
    if (!VALID_KINDS.includes(input.kind as ScheduleKind)) {
        return { status: 400, code: 'INVALID_KIND', message: `kind must be one of: ${VALID_KINDS.join(', ')}` };
    }

    const scopeRefusal = scheduleKindScopeRefusal(input.kind, caller, 'create');
    if (scopeRefusal) return scopeRefusal;

    if (!input.cron || !isValidCron(input.cron, input.timezone)) {
        return { status: 400, code: 'INVALID_CRON', message: 'cron is missing or invalid' };
    }

    return null;
}
