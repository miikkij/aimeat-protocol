/**
 * @file src/services/workflow/dispatch-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The principal a run answers to, asked again before every step is dispatched.
 *
 *   A run's authority was decided once, when it started: the starting principal's permissions
 *   (step-authority.ts), or for a trigger's run its saver's (trigger-authority.ts). Every later
 *   dispatch (a retry after its backoff, a step an earlier one unblocked, the watchdog's re-tick, the
 *   resume after a restart, the tick after a human answer) went to the step code path with no check.
 *   So an agent the owner deleted, or whose permissions the owner narrowed, went on running the
 *   owner's extension actions, AI steps, package publishes and connected-app calls through a run it
 *   had started before (secaudit 2026-10, v64).
 *
 *   Now the run records its principal at start (`run.principal`), and the engine's tick asks it again
 *   before it dispatches each step: is the principal still there, and does it still hold the
 *   permissions that one step costs (stepKindScopes and the record reads, via missingStepScopes)?
 *   When it does not, the step is not dispatched, the run's open steps are skipped, and the run ends
 *   `refused` with `refusal.stoppedBefore` naming the step. The owner is told once, with the same two
 *   ways on as a refused trigger start ("Run as me", "Approve again"). The owner in person is not
 *   asked, as no endpoint asks them. A run started before this file has no principal and is not
 *   asked: it dispatches as it did before, until it ends.
 *
 *   The principal is resolved at most once per tick, and only when a step is about to dispatch, so a
 *   tick costs one lookup however many steps it dispatches.
 * @structure runPrincipalAtStart(def, caller, ownerGhii) · runPrincipal(run) · dispatchGate(storage, run)
 * @usage
 *   const gate = dispatchGate(storage, run);
 *   if (await gate.refuses(step, now)) { ...stop the tick, persist the run... }
 *   await gate.tell(deps, ownerGhii);   // after the refused run is saved
 * @version-history
 *   v1.0.1 — 2026-10-21 — A run with no recorded principal (started before v1.0.0) is not asked again
 *     and dispatches as before. The saver used to stand in for it, which refused, at its next step, a
 *     run the owner had started in person on a workflow an agent saved; no record asked for that.
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, v64).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { missingStepScopes, saverFromCaller, type WorkflowCaller } from './step-authority.js';
import { saverOfDef, saverAuthority, openInFlightRefusal, type SaverNow, type TriggerAuthorityDeps } from './trigger-authority.js';
import type { WorkflowDef, WorkflowRun, WorkflowSaver, WorkflowStep } from '../../models/workflow-schemas.js';

/** The principal a run about to start answers to: whoever starts it, or for a trigger's run the saver. */
export function runPrincipalAtStart(def: WorkflowDef, caller: WorkflowCaller | undefined, ownerGhii: string): WorkflowSaver {
  return caller ? saverFromCaller(caller, ownerGhii) : saverOfDef(def);
}

/**
 * The principal a run in flight answers to: what its start recorded. Null for a run started before
 * runs recorded one (2026-10-20). Such a run is not asked again: it dispatches as it did when it
 * started, because standing its saver in would refuse a run the OWNER started in person on a
 * workflow an agent saved. Every run started since carries its principal and keeps the check.
 */
export function runPrincipal(run: Pick<WorkflowRun, 'principal'>): WorkflowSaver | null {
  return run.principal ?? null;
}

/** What the run record says, in words: the step that did not start, who the run acts for, and the ways on. */
function stoppedReason(stepId: string, name: string, missing: string[], gone: boolean): string {
  const yourself = 'save the workflow yourself so it runs on your own permission';
  return gone
    ? `Stopped before step "${stepId}": this run acts for ${name}, which is no longer connected to this account, so the step was not started. `
      + `Run the workflow once as yourself, or ${yourself}.`
    : `Stopped before step "${stepId}": this run acts for ${name}, which no longer holds ${missing.map(w => `"${w}"`).join(', ')}, `
      + `so the step was not started. Run the workflow once as yourself, give ${name} the permission again, or ${yourself}.`;
}

/**
 * End the run refused before `stepId`. The steps not yet finished are skipped, as a cancel skips them:
 * a call or a task still running finds its step no longer waiting and ends there.
 */
function endRefused(run: WorkflowRun, principal: WorkflowSaver, now: SaverNow, missing: string[], stepId: string, nowIso: string): void {
  for (const rs of Object.values(run.steps)) {
    if (rs.state === 'pending' || rs.state === 'dispatched' || rs.state === 'waiting-human') {
      rs.state = 'skipped';
      rs.endedAt = nowIso;
      rs.notBefore = undefined;
    }
  }
  run.status = 'refused';
  run.endedAt = nowIso;
  run.reason = stoppedReason(stepId, now.name, missing, now.gone);
  run.refusal = { saver: principal, saverName: now.name, missing, gone: now.gone, attempts: 1, lastAttemptAt: nowIso, stoppedBefore: stepId };
}

export interface DispatchGate {
  /**
   * May `step` be dispatched now? False when it may. True when the principal is gone or lacks a word
   * the step costs: the run has then been ended `refused` in place, and the caller stops the tick and
   * saves the run.
   */
  refuses(step: WorkflowStep, nowIso: string): Promise<boolean>;
  /** After the refused run is saved: the refusal is opened and the owner told, once. A no-op otherwise. */
  tell(deps: TriggerAuthorityDeps, ownerGhii: string): Promise<void>;
}

/** The dispatch check for one tick of one run. The principal is resolved once, on the first dispatch. */
export function dispatchGate(storage: Storage, run: WorkflowRun): DispatchGate {
  const principal = runPrincipal(run);
  let held: Promise<SaverNow> | null = null;
  let refused: { now: SaverNow; missing: string[]; stepId: string } | null = null;
  return {
    async refuses(step, nowIso) {
      if (!principal || principal.kind === 'owner') return false;
      held ??= saverAuthority(storage, principal);
      const now = await held;
      const asCaller = { roles: [principal.kind === 'app' ? 'app' : 'agent'], scopes: now.scopes };
      const missing = now.gone ? [] : missingStepScopes({ steps: [step], authority: run.defSnapshot.authority }, asCaller, 'full').map(m => m.scope);
      if (!now.gone && missing.length === 0) return false;
      endRefused(run, principal, now, missing, step.id, nowIso);
      refused = { now, missing, stepId: step.id };
      return true;
    },
    async tell(deps, ownerGhii) {
      if (!refused) return;
      logger.warn(`workflow "${run.workflowId}" run ${run.runId}: refused before step "${refused.stepId}": ${run.reason}`);
      // The run is already saved as refused; a failure to tell the owner must not undo that.
      await openInFlightRefusal(deps, ownerGhii, run, refused.now, refused.missing, refused.stepId)
        .catch(err => logger.error('workflow in-flight refusal: the owner could not be told', { runId: run.runId, error: String(err) }));
    },
  };
}
