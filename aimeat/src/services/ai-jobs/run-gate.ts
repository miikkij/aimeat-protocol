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
 *       them as they were then. The owner in person, a visitor from another node and a job with no
 *       starter recorded are not asked, as before.
 *     - Since round 15: an erased account's job is dropped (`drop`): no account holds the name and the
 *       job's own stored record went with the erasure, or the account that holds the name now was made
 *       after the job was queued (a previous holder's job, the rule services/schedule-actor.ts applies).
 *       Nothing is paid, folded or written under the erased identity. A starter that held ai:use and no
 *       longer does ends SCOPE_DENIED before the provider is called, with the page where the owner gives
 *       it back; an app whose grant the owner revoked and an ecosystem app the owner disconnected end
 *       AI_JOB_STARTER_GONE. An app and an ecosystem app that stand keep the list the job stored.
 *
 *   stillHeld: with several processes per node, the process that runs a job checks before each paid
 *   or side-effecting step that it still holds the job's entry in the node-wide index and that the
 *   stored job is still live. A cancel taken by another process, or a process that took the job over
 *   because this one's lease looked expired, stops it here, so a job is paid for and its on_done runs
 *   at most once. With one process per node (the default) nothing is read and the answer is yes.
 * @structure RunGate · runGate(deps, job) · stillHeld(deps, job) · accountGone · starterNow (module-private)
 * @usage
 *   const gate = await runGate(deps, entry.job);
 *   if (gate.action === 'wait') ...; if (gate.action === 'end') ...; if (gate.action === 'drop') ...; entry.job = gate.job;
 *   if (!await stillHeld(deps, entry.job)) ...stop without paying...
 * @version-history
 *   v1.1.0 -- 2026-11-08 -- `drop` for an erased account's job, ai:use asked again of the starter, and the
 *     liveness of an app-grant and an ecosystem-app starter (secaudit2026nov08b round 15:
 *     runGate:erased-account-runs-as-active, runGate:start-permission-not-reasked).
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14: reclaimJobs:restarts-deactivated-account-job,
 *     service.ts:run/no-fencing-on-active-index-claim, and the older item O4, a job keeps its stored starter).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { credentialKind } from '../caller-facts.js';
import { intersectScopes } from '../../auth/effective-scopes.js';
import { madeAfter, recordIssuedAt } from '../../auth/credential-age.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { localAccountOf } from '../../utils/gaii.js';
import { deactivatedAccountOf } from '../account-deactivated.js';
import { saverAuthority, type SaverNow } from '../workflow/trigger-authority.js';
import { allowAddressFor } from '../permission-ask.js';
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
    | { action: 'end'; error: { code: string; message: string; status: number } }
    /** Do not run it and write nothing: the job's account was erased. The caller lets the job go. */
    | { action: 'drop'; reason: string };

/**
 * Whether the starter is an agent or a scoped access token of this node: the principals whose
 * permissions live in a record the owner edits. Everyone else keeps the list the job stored.
 */
function isAgentStarter(s: AiJobStartedBy): boolean {
    return credentialKind(s) === 'agent' && !s.app && s.principal.includes('#');
}

type StarterKind = 'agent' | 'app' | 'ecosystem';

/**
 * Which starters are asked again: an agent or scoped access token, an app by its grant, and an
 * ecosystem app. The owner in person, a visitor from another node and a job with no starter are not.
 */
function starterKind(s: AiJobStartedBy): StarterKind | null {
    if (isAgentStarter(s)) return 'agent';
    // The kind is caller-facts.ts credentialKind's; an app is asked by the app its grant names, and an
    // ecosystem app by its GEAI.
    const kind = credentialKind(s);
    if (kind === 'app') return s.app ? kind : null;
    if (kind === 'ecosystem') return s.principal.includes('#') ? kind : null;
    return null;
}

/**
 * The starter as the node holds it now (workflow/trigger-authority.ts saverAuthority, which a
 * schedule's maker is asked through too). An app is found by the owner's live grant for it: the job
 * keeps the app's name (`owner/file.html`), not the grant id, and a revoked grant is no live grant.
 */
async function starterNow(deps: GateDeps, s: AiJobStartedBy, kind: StarterKind): Promise<SaverNow> {
    if (kind === 'app') {
        const grant = await deps.storage.getAppGrantByOwnerAndApp(s.owner, s.app!);
        if (!grant) return { name: s.app!, gone: true, scopes: [], approveLink: '/v1/profile?tab=access' };
        return saverAuthority(deps.storage, { kind: 'app', id: grant.grantId });
    }
    return saverAuthority(deps.storage, { kind, id: s.principal });
}

/**
 * Why the job's account no longer acts, or null while it does. Two kinds of positive evidence, never
 * the absence of a read alone: no account holds the name AND the job's own stored record is gone
 * (services/owner-erasure.ts deletes both), or the account that holds the name now was made after the
 * job was queued, so the job was left by a previous holder of the released name.
 */
async function accountGone(deps: GateDeps, job: AiJobRecord): Promise<string | null> {
    const name = localAccountOf(job.owner);
    if (!name) return null;
    const account = await deps.storage.getOwner(name);
    if (account) {
        return madeAfter(account.createdAt, recordIssuedAt(job.queued_at))
            ? `the account "${name}" was registered after this job was queued, by a new holder of the name`
            : null;
    }
    return await readJob(deps.storage, job.owner, job.id) ? null : `the account "${name}" was erased`;
}

/** The SCOPE_DENIED sentence for a starter that lost ai:use, with the page where the owner gives it back. */
function aiUseRefusal(deps: GateDeps, s: AiJobStartedBy, kind: StarterKind, now: SaverNow): string {
    const base = (deps.config.baseUrl ?? '').replace(/\/+$/, '');
    // An agent's own page, where ai:use has its tick (services/permission-ask.ts); a scoped access token,
    // an app grant and an ecosystem app are approved on their own tabs.
    const where = (kind === 'agent' && s.via !== 'pat' ? allowAddressFor(base, s.principal, ['ai:use'])?.allow_url : undefined)
        ?? `${base}${now.approveLink}`;
    return `This job was started by ${now.name}, which no longer has your permission to use AI ("ai:use"), so it was not run and nothing was spent. `
        + `Give it that permission again at ${where}, or start the job yourself.`;
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
    // Asked only of an account that is not deactivated; a failed read runs the job as before.
    const gone = await accountGone(deps, job).catch((err: unknown) => {
        logger.warn('[ai-jobs] whether the account still exists could not be read; the job runs', { jobId: job.id, error: String(err) });
        return null;
    });
    if (gone) return { action: 'drop', reason: gone };

    const s = job.started_by;
    const kind = s ? starterKind(s) : null;
    if (!s || !kind) return { action: 'run', job, narrowed: false };
    const now = await starterNow(deps, s, kind).catch((err: unknown) => {
        logger.warn('[ai-jobs] the starter could not be read; the job runs on its stored permissions', { jobId: job.id, error: String(err) });
        return null;
    });
    if (!now) return { action: 'run', job, narrowed: false };
    if (now.gone) {
        return {
            action: 'end',
            error: {
                code: 'AI_JOB_STARTER_GONE', status: 403,
                message: kind === 'app'
                    ? `This job was started by the app ${now.name}, which no longer holds your permission, so it was not run and nothing was spent. `
                        + 'Open the app and approve it again to start the job there, or start it yourself.'
                    : `This job was started by ${now.name}, which is no longer connected to this account, so it was not run and nothing was spent. `
                        + (kind === 'agent' ? 'Start it again yourself, or from an agent that is connected.' : 'Connect it again, or start the job yourself.'),
            },
        };
    }
    // ai:use is what a start costs every caller but the owner in person (auth/ai-gate.ts). A starter
    // that held it at the start and does not now could not start this job now, so nothing is paid.
    if (scopeIsCovered(s.scopes, 'ai:use') && !scopeIsCovered(now.scopes, 'ai:use')) {
        return { action: 'end', error: { code: 'SCOPE_DENIED', status: 403, message: aiUseRefusal(deps, s, kind, now) } };
    }
    // An app and an ecosystem app keep the list the job stored, as before.
    if (kind !== 'agent') return { action: 'run', job, narrowed: false };
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
