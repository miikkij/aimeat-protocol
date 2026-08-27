/**
 * @file src/services/workflow/engine-ai-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `ai` step: run a prompt on the OWNER'S OWN model, here on the node, and land the
 *   answer in their namespace. Extracted from engine-steps.ts to satisfy max-file-lines; a pure move.
 * @structure dispatchAiStep(deps, ownerGhii, run, step, action, onPushTerminal)
 * @usage  imported by engine-steps.ts dispatchStep() for `action.kind === 'ai'`
 * @version-history
 *   v1.0.0 — 2026-08-28 — A step that only turns text into text needed an agent, because there was
 *     no other kind of step. That cost a round trip through another repository and a fleet restart
 *     for every change to a sentence of prompt.
 */
import type { StepDeps, OnPushTerminal } from './engine-steps.js';
import type { WorkflowRun, WorkflowStep } from '../../models/workflow-schemas.js';
import { completeForOwner } from '../ai-completion.js';
import { getOwnerScopeMemory } from '../owner-memory.js';
import { template } from './engine-util.js';
import { logger } from '../../utils/logger.js';

/**
 * Run a prompt on the owner's own model and land the answer in their namespace.
 *
 * Modelled on dispatchExtensionStep and finishing through the same onPushTerminal path, so an ai
 * step is green or red for the same reason every other step is: its success_signal, asked of what
 * it actually wrote. `completeForOwner` is the same call the `llm` signal judge already makes, so
 * the key, the budget and the provenance are the owner's, resolved the one way they are everywhere.
 *
 * NO TOKEN CAP is passed. This project forbids one (scripts/check-no-max-tokens.ts): a cap
 * truncates a long generation silently, and a long generation is the whole point of this step.
 */
export function dispatchAiStep(
  deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep,
  action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'ai' }>,
  onPushTerminal: OnPushTerminal,
): void {
  const { workflowId, runId } = run;
  const stepId = step.id;

  const fire = async (): Promise<void> => {
    // The prompt comes from a record when one is named, so changing it is a memory write. The
    // record's own text is templated too: a prompt that names {ref} means the same thing here as a
    // key that does.
    let prompt = action.prompt ? template(action.prompt, run.vars) : '';
    if (action.prompt_key) {
      const key = template(action.prompt_key, run.vars);
      const rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, ownerGhii.split('@')[0], key);
      const val = rec?.value as unknown;
      const fromRecord = typeof val === 'string' ? val : (val && typeof val === 'object' && typeof (val as { prompt?: unknown }).prompt === 'string'
        ? (val as { prompt: string }).prompt : '');
      if (!fromRecord) throw new Error(`prompt_key "${key}" holds no prompt text`);
      prompt = template(fromRecord, run.vars);
    }
    if (!prompt) throw new Error('an ai step needs prompt or prompt_key');

    const r = await completeForOwner(deps.storage, deps.config, ownerGhii, {
      prompt,
      ...(action.model ? { model: action.model } : {}),
      appId: `workflow:${workflowId}`,
    });

    if (action.result_to_key) {
      const key = (run.keyPrefix ?? '') + template(action.result_to_key, run.vars);
      // Parsed when the step asks for JSON, so a malformed answer fails HERE rather than becoming a
      // string that every downstream reader has to re-parse and none of them validates.
      let value: unknown = r.content;
      if (action.json) {
        const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(r.content);
        if (!m) throw new Error('ai step asked for json and the answer contained none');
        value = JSON.parse(m[0]);
      }
      const existing = await deps.storage.getMemory(ownerGhii, key);
      const now = new Date().toISOString();
      await deps.storage.setMemory({
        key, ownerGaii: ownerGhii, value,
        visibility: 'owner', tags: ['workflow-ai-result'], ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
    }
  };

  fire()
    .then(() => onPushTerminal(ownerGhii, workflowId, runId, stepId, true))
    .catch(err => {
      logger.warn(`workflow ${workflowId} run ${runId}: ai step "${stepId}" failed`, { error: String(err) });
      return onPushTerminal(ownerGhii, workflowId, runId, stepId, false);
    });
}
