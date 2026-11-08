/**
 * @file src/services/ai-jobs/run-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the runner asks before it spends anything on a job (service.ts run), whichever
 *   way the job reached it: a start in this process, a restart that queued it again, or a process
 *   that took it over from one that ended (reclaim.ts).
 *
 *   runGate: the job's ACCOUNT and its STARTER as they are now, not as they were at the start.
 *     - A deactivated account's job waits. It stays queued with a sentence that names the deactivation
 *       (`waiting`), nothing is paid and nothing is written, and it runs after the operator reactivates
 *       the account, as a schedule of that account waits (services/account-deactivated.ts). Until
 *       2026-11-08 a restart or a takeover ran such a job, paid the provider and wrote its answer.
 *     - A job an agent (or a scoped access token) started runs with the starter's CURRENT permissions:
 *       a starter that is gone ends the job with a reason before the provider is called, and a starter
 *       the owner narrowed runs with the narrower list (the token is the ceiling and the record the
 *       current permission, as auth/effective-scopes.ts withCurrentScopes decides for a request). The
 *       job stored its starter's permissions at the start (starter.ts), and a job re-run later used
 *       them as they were then. The owner in person, an app, an ecosystem app, a visitor from another
 *       node and a job with no starter recorded are not asked, as before.
 *
 *   stillHeld: with several processes per node, the process that runs a job checks before each paid
 *   or side-effecting step that it still holds the job's entry in the node-wide index and that the
 *   stored job is still live. A cancel taken by another process, or a process that took the job over
 *   because this one's lease looked expired, stops it here, so a job is paid for and its on_done runs
 *   at most once. With one process per node (the default) nothing is read and the answer is yes.
 * @structure RunGate · runGate(deps, job) · stillHeld(deps, job)
 * @usage
 *   const gate = await runGate(deps, entry.job);
 *   if (gate.action === 'wait') ...; if (gate.action === 'end') ...; entry.job = gate.job;
 *   if (!await stillHeld(deps, entry.job)) ...stop without paying...
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14: reclaimJobs:restarts-deactivated-account-job,
 *     service.ts:run/no-fencing-on-active-index-claim, and the older item O4, a job keeps its stored starter).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { credentialKind } from '../caller-facts.js';
import { intersectScopes } from '../../auth/effective-scopes.js';
import { deactivatedAccountOf } from '../account-deactivated.js';
import { saverAuthority } from '../workflow/trigger-authority.js';
import { singleProcess, sameProcess, thisProcess } from '../process-lease.js';
import { starterMayInvokeExtensions, onDoneScopeRefusal } from './starter.js';
import { readJob, readActiveIndex } from './store.js';
import type { AiJobRecord, AiJobStartedBy } from './types.js';

type GateDeps = { storage: Storage; config: AimeatConfig };

export type RunGate =
    /** Run it. `job` carries the starter's current permissions; `narrowed` says they changed, so the
     *  caller builds the prompt again with them. */
    | { action: 'run'; job: AiJobRecord; narrowed: boolean }
    /** Do not run it yet: the account is deactivated. The job stays queued. */
    | { action: 'wait'; reason: string }
    /** Do not run it: end it failed with this error, before anything is paid. */
    | { action: 'end'; error: { code: string; message: string; status: number } };

/**
 * Whether the starter is an agent or a scoped access token of this node: the principals whose
 * permissions live in a record the owner edits. Everyone else keeps the list the job stored.
 */
function isAgentStarter(s: AiJobStartedBy): boolean {
    return credentialKind(s) === 'agent' && !s.app && s.principal.includes('#');
}

/** Same members in the same order: the stored list is unchanged. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((s, i) => s === b[i]);
}

export async function runGate(deps: GateDeps, job: AiJobRecord): Promise<RunGate> {
    // A failed read runs the job as before, with a log line: the gate never turns a storage hiccup
    // into a refusal.
    const off = await deactivatedAccountOf(deps.storage, job.owner).catch((err: unknown) => {
        logger.warn('[ai-jobs] the account state could not be read; the job runs', { jobId: job.id, error: String(err) });
        return null;
    });
    if (off) {
        return {
            action: 'wait',
            reason: `The account "${off.name}" was deactivated on ${off.since}, so this job waits in the queue and nothing is spent. `
                + 'Nothing is deleted: it runs after the operator reactivates the account.',
        };
    }

    const s = job.started_by;
    if (!s || !isAgentStarter(s)) return { action: 'run', job, narrowed: false };
    const now = await saverAuthority(deps.storage, { kind: 'agent', id: s.principal }).catch((err: unknown) => {
        logger.warn('[ai-jobs] the starter could not be read; the job runs on its stored permissions', { jobId: job.id, error: String(err) });
        return null;
    });
    if (!now) return { action: 'run', job, narrowed: false };
    if (now.gone) {
        return {
            action: 'end',
            error: {
                code: 'AI_JOB_STARTER_GONE', status: 403,
                message: `This job was started by ${now.name}, which is no longer connected to this account, so it was not run and nothing was spent. `
                    + 'Start it again yourself, or from an agent that is connected.',
            },
        };
    }
    const scopes = intersectScopes(s.scopes, now.scopes);
    if (sameList(scopes, s.scopes)) return { action: 'run', job, narrowed: false };
    const narrowedJob: AiJobRecord = { ...job, started_by: { ...s, scopes } };
    // on_done costs ext:invoke for an agent (starter.ts), asked at the start; the narrower list asks it again.
    if (narrowedJob.on_done && !starterMayInvokeExtensions(narrowedJob.started_by)) {
        return { action: 'end', error: { code: 'SCOPE_DENIED', status: 403, message: onDoneScopeRefusal(narrowedJob.started_by) } };
    }
    logger.info('[ai-jobs] the job runs with its starter\'s current permissions', {
        jobId: job.id, starter: s.principal, stored: s.scopes.join(','), now: scopes.join(','),
    });
    return { action: 'run', job: narrowedJob, narrowed: true };
}

/**
 * Whether this process may still take a paid or side-effecting step on `job`: it holds the job's
 * entry in the node-wide index and the stored job is queued or running. Always true with one process
 * per node, where the cancel reaches the runner in its own live map and no process takes a job over.
 * A failed read answers true, as before this check, with a log line.
 */
export async function stillHeld(deps: GateDeps, job: Pick<AiJobRecord, 'id' | 'owner'>): Promise<boolean> {
    if (singleProcess(deps.config)) return true;
    try {
        const [stored, refs] = await Promise.all([readJob(deps.storage, job.owner, job.id), readActiveIndex(deps.storage, deps.config.nodeId)]);
        const live = !!stored && (stored.state === 'queued' || stored.state === 'running');
        const ref = refs.find(r => r.jobId === job.id);
        const held = live && !!ref && sameProcess(ref.by, thisProcess(deps.config));
        if (!held) {
            logger.info(`[ai-jobs] ${job.id}: stopped in this process, which no longer runs it`, {
                stored: stored?.state ?? 'gone', heldBy: ref?.by?.name ?? 'nobody',
            });
        }
        return held;
    } catch (err) {
        logger.warn('[ai-jobs] whether this process still runs the job could not be read; it goes on', { jobId: job.id, error: String(err) });
        return true;
    }
}
