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
 *   - checkScheduleGate() — scope + cron, in that order, returning a refusal or null
 * @usage
 *   const bad = checkScheduleGate({ kind, cron, timezone }, caller);
 *   if (bad) return renderRefusal(bad);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B: shared gate, both doors).
 */
import { Cron } from 'croner';
import { logger } from '../utils/logger.js';

/** Every schedule kind this node knows. */
export type ScheduleKind = 'extension' | 'ai' | 'agent_task' | 'eco-capability' | 'connections-publish';

/**
 * The scope a caller needs for the capability the schedule DRIVES. A kind absent from this map needs
 * nothing beyond being allowed to make a schedule at all — which is what the tool's own scope says.
 */
export const SCHEDULE_KIND_SCOPE: Partial<Record<ScheduleKind, string>> = {
    ai: 'ai:use',
    agent_task: 'task:write',
    'connections-publish': 'connections:use',
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

const VALID_KINDS: ScheduleKind[] = ['extension', 'ai', 'agent_task', 'eco-capability', 'connections-publish'];

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

/** Does this session carry the scope, allowing for the wildcard forms the middleware accepts? */
function hasScope(scopes: string[], needed: string): boolean {
    if (scopes.includes('*') || scopes.includes(needed)) return true;
    return scopes.includes(`${needed.split(':')[0]}:*`);
}

/**
 * The three refusals, in the order the route has always applied them. Returns null when the caller
 * may proceed; the caller then builds and stores the record its own way.
 */
export function checkScheduleGate(input: ScheduleGateInput, caller: ScheduleCaller): ScheduleRefusal | null {
    if (!VALID_KINDS.includes(input.kind as ScheduleKind)) {
        return { status: 400, code: 'INVALID_KIND', message: `kind must be one of: ${VALID_KINDS.join(', ')}` };
    }

    const needed = SCHEDULE_KIND_SCOPE[input.kind as ScheduleKind];
    if (needed && !caller.isOwnerSession && !hasScope(caller.scopes, needed)) {
        return {
            status: 403, code: 'SCOPE_DENIED',
            message: `Creating a "${input.kind}" schedule requires the "${needed}" scope.`,
        };
    }

    if (!input.cron || !isValidCron(input.cron, input.timezone)) {
        return { status: 400, code: 'INVALID_CRON', message: 'cron is missing or invalid' };
    }

    return null;
}
