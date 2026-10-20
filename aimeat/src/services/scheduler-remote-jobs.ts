/**
 * @file src/services/scheduler-remote-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Scheduled `workflow` and `eco-capability` job executors — the non-extension,
 *   non-core, non-agent_task kinds the Scheduler dispatches directly. Extracted from scheduler.ts
 *   to satisfy max-file-lines. The `ai` kind lived here until 2026-10-20 and is now
 *   services/scheduler-ai-job.ts, registered at boot; that file says why.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from scheduler.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — Security audit C-2: an `ai` job refuses an input namespace outside its
 *     owner. The namespace came from the create body and went straight into the raw composite-key
 *     lookup, so any registered account could read another owner's private memory verbatim through
 *     a prompt. The routes refuse it now too; this covers jobs stored before that gate existed.
 *   v1.2.0 — 2026-09-09 — A workflow job whose start was skipped (a run already in flight) records
 *     a skip with the reason, not a write naming the other run as if this job had started it.
 *   v1.3.0 — 2026-09-25 — A workflow job whose start was refused (the saver no longer holds what the
 *     steps need) records a skip with the refusal's reason.
 *   v1.4.1 — 2026-09-26 — The workflow and eco-capability jobs take the owner's account name from
 *     localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never
 *     names the local namesake (secaudit 2026-09, F-1).
 *   v1.4.0 — 2026-09-26 — An `ai` job whose input or output key names a record the node keeps for
 *     itself fails before anything is read, sent or written (services/ai-job-keys.ts). The create
 *     and edit doors refuse it, and this covers schedules stored earlier (secaudit 2026-09: A6-1,
 *     573704db10ed).
 *   v1.5.0 — 2026-09-29 — An `ai` job reads its inputs through readAiRecords (services/ai-inputs.ts):
 *     the credential mask it lacked, and the classification check (TARGET-082).
 *   v1.6.0 — 2026-09-29 — An `ai` job reads its inputs as an unattended AI run (ai-jobs/starter.ts
 *     unattendedReader), not as the node's own reader (TARGET-082 V4).
 *   v1.7.0 — 2026-10-05 — An `ai` job's model call runs as whoever made the schedule, asked at the
 *     fire (services/schedule-actor.ts): gone, or without ai:use, it does not run (secaudit 2026-10, AI-3).
 *   v1.8.0 — 2026-10-20 — An `eco-capability` job asks scheduleActor like the other kinds: a maker
 *     that is gone, or that no longer holds work:request, does not fire, and the invoke frame
 *     carries the maker's identity as caller instead of the owner's (secaudit 2026-10). The `ai`
 *     job moved to services/scheduler-ai-job.ts, where it can write through the shared memory write
 *     service without a module cycle.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import type { JobRunResult } from './scheduler.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { buildGEAI, localAccountName } from '../utils/gaii.js';
import { scheduleActor } from './schedule-actor.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/**
 * `workflow` kind: fire one Agent Workflow run. The schedule is just the trigger; the deterministic
 * engine owns the run loop (dispatch + two-sided signal checks + advance). `input.workflowId`
 * names the workflow; `ownerScope` is the owner GHII it belongs to.
 */
export async function runWorkflowJob(job: ScheduledJobRecord): Promise<JobRunResult> {
  const owner = job.ownerScope;
  const workflowId = (job.input as { workflowId?: string } | undefined)?.workflowId;
  if (!owner || !workflowId) throw new Error(`workflow job "${job.id}" missing ownerScope/workflowId`);
  const engine = getActiveWorkflowEngine();
  if (!engine) return { reads: [], writes: [], skipped: true, skipReason: 'workflow engine not started' };
  const result = await engine.startRun(owner, localAccountName(owner), workflowId, { mode: 'full-live' });
  if ('error' in result) throw new Error(`workflow run failed to start: ${result.error.join('; ')}`);
  // Refused, not failed: whoever saved the workflow no longer holds what its steps need, the refusal
  // is on the workflow's run list, and the owner was told. Nothing to retry until they act.
  if (result.refused) return { reads: [], writes: [], skipped: true, skipReason: result.refused };
  if (result.skipped) {
    return { reads: [], writes: [], skipped: true, skipReason: `a run of "${workflowId}" is already in flight (${result.runId}); set parallel: true on the workflow to let runs overlap` };
  }
  return { reads: [], writes: [`workflows.run.${workflowId}.${result.runId}`] };
}

/**
 * `eco-capability` kind: invoke a connected ecosystem app's (GEAI) capability over the
 * connect-tunnel on each fire. `input` is `{ app, capability_id, input? }`; `ownerScope` is the
 * owner GHII whose binding to drive. The ecosystem enforces its OWN ACL on top. When the GEAI is
 * offline at fire time the run is SKIPPED (not an error) so it does not hot-loop — the next
 * scheduled fire retries.
 *
 * WHO THE INVOKE COMES FROM. The schedule acts as its maker, asked again here
 * (services/schedule-actor.ts), exactly as the `ai` kind does: a maker that is gone does not fire,
 * a maker that no longer holds `work:request` does not fire, and the frame names the maker rather
 * than the owner. Until 2026-10-20 it hard-coded the owner's GHII as caller, so an agent's schedule
 * reached a connected app with the owner's whole identity and went on doing it after the owner
 * deleted the agent (secaudit 2026-10). The direct route POST /v1/capabilities/:id/invoke passes
 * the caller's own identity and asks the same word.
 */
export async function runEcoCapabilityJob(
  storage: Storage, config: AimeatConfig, job: ScheduledJobRecord,
): Promise<JobRunResult> {
  const owner = job.ownerScope;
  if (!owner) throw new Error(`eco-capability job "${job.id}" missing ownerScope`);
  const cfg = (job.input ?? {}) as { app?: string; capability_id?: string; input?: Record<string, unknown> };
  const app = cfg.app;
  const capabilityId = cfg.capability_id;
  if (!app || !capabilityId) {
    throw new Error(`eco-capability job "${job.id}" missing app/capability_id in input`);
  }

  const actor = await scheduleActor(storage, job);
  if (!actor.ok) throw new Error(actor.reason);
  if (!actor.isOwner && !scopeIsCovered(actor.scopes, 'work:request')) {
    throw new Error('What made this schedule no longer holds work:request, so it does not run. Approve it again, or delete this schedule.');
  }

  const ownerName = localAccountName(owner);
  const geai = buildGEAI(app, ownerName, config.nodeId);
  const caller = actor.isOwner ? `${ownerName}@${config.nodeId}` : actor.principal;

  const mgr = getActiveConnectTunnelManager();
  if (!mgr) {
    // No tunnel server running — skip rather than error (nothing to invoke against).
    return { reads: [], writes: [], skipped: true, skipReason: 'connect-tunnel unavailable' };
  }

  try {
    const reply = await mgr.invokeOnPrincipal(geai, { capability: capabilityId, input: cfg.input ?? {}, caller });
    if (!reply.ok) {
      throw new Error(`Ecosystem app "${app}" refused or failed capability "${capabilityId}"`);
    }
    return { reads: [], writes: [`eco.${app}.${capabilityId}`] };
  } catch (err) {
    // The GEAI being offline at fire time is a SKIP, not an error — don't hot-loop; retry next fire.
    const code = (err as { code?: string }).code;
    if (code === 'ECOSYSTEM_OFFLINE') {
      return { reads: [], writes: [], skipped: true, skipReason: `app "${app}" offline` };
    }
    throw err;
  }
}
