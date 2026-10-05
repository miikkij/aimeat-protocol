/**
 * @file src/services/workflow/ai-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a workflow run's AI calls run as: its ai steps and the judge of its `llm` signals.
 *
 *   A run acts for somebody. A run a principal starts acts for that principal (step-authority.ts
 *   checks its words); a run the workflow's own trigger starts acts for whoever saved the workflow
 *   (trigger-authority.ts checks that saver at every start); "Run as me" acts for the owner. The AI
 *   calls of the run go out as the same principal, so the owner's rules for that agent or that app
 *   apply to them: the per-agent and per-app model lists, the policy switch for apps and agents, an
 *   agent's daily cap. Until 2026-10-05 every one of them was planned as the owner in person, so an
 *   agent the owner had capped could spend past its cap by saving and running a workflow (secaudit
 *   2026-10, AI-3).
 *
 *   The answer is decided once, when the run starts, and kept on the run (`aiCaller`). A run started
 *   before this file existed has none, and its saver stands in.
 * @structure aiCallerForStart(storage, def, caller) · workflowAiCaller(storage, run)
 * @usage
 *   run.aiCaller = await aiCallerForStart(storage, def, opts.caller);
 *   const who = await workflowAiCaller(storage, run);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, AI-3).
 */
import type { Storage } from '../../storage/interface.js';
import type { WorkflowDef, WorkflowRun, WorkflowSaver } from '../../models/workflow-schemas.js';
import type { WorkflowCaller } from './step-authority.js';
import { saverOfDef } from './trigger-authority.js';
import { aiCallerOfPrincipal, OWNER_CALLER, type AiCallerContext } from '../ai/caller-context.js';

/** The AI caller of a saver: an app by its grant's app, an agent or an ecosystem app by its identity, else the owner. */
async function ofSaver(storage: Storage, saver: WorkflowSaver): Promise<AiCallerContext> {
  if (saver.kind === 'app') {
    const grant = saver.id ? await storage.getAppGrant(saver.id) : null;
    // A grant that is gone cannot start a trigger's run (trigger-authority.ts); a run already going
    // keeps the app's class, with no app to apply rules for, so the owner's rule for apps applies.
    return grant ? { caller: 'app', verifiedApp: grant.app } : { caller: 'app' };
  }
  if (saver.kind === 'owner') return { ...OWNER_CALLER };
  return aiCallerOfPrincipal(saver.id);
}

/**
 * The AI caller of a run about to start. `caller` is the principal starting it (a person at the
 * screen, an agent, an app); absent, the trigger started it and the saver answers.
 */
export async function aiCallerForStart(storage: Storage, def: WorkflowDef, caller: WorkflowCaller | undefined): Promise<AiCallerContext> {
  if (!caller) return ofSaver(storage, saverOfDef(def));
  if (caller.roles.includes('app')) {
    const grant = caller.appGrant ? await storage.getAppGrant(caller.appGrant) : null;
    return grant ? { caller: 'app', verifiedApp: grant.app } : { caller: 'app' };
  }
  if (caller.principal) return aiCallerOfPrincipal(caller.principal);
  // A caller with no principal named is the owner in person ("Run as me", the owner's own session).
  return { ...OWNER_CALLER };
}

/** The AI caller of a run in flight: what its start decided, or for an older run, its saver. */
export async function workflowAiCaller(storage: Storage, run: Pick<WorkflowRun, 'aiCaller' | 'defSnapshot'>): Promise<AiCallerContext> {
  return run.aiCaller ?? ofSaver(storage, saverOfDef(run.defSnapshot));
}
