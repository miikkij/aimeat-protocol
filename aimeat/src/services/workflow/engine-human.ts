/**
 * @file src/services/workflow/engine-human.ts
 * @description Human-input step completion helpers — answer validation against the PINNED question
 *   and answer application (memory write + step green). Pure of engine state: the engine calls these
 *   under the run lock (onHumanAnswer / the sweep's on_timeout='default' path) and ticks afterwards.
 *   Extracted from engine.ts to satisfy max-file-lines.
 * @usage import { validateHumanAnswer, applyHumanAnswer } from './engine-human.js';
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: validateHumanAnswer + applyHumanAnswer (human-input steps).
 */
import type { Storage } from '../../storage/interface.js';
import { template } from './engine-util.js';
import type { WorkflowRun, WorkflowHumanQuestion } from '../../models/workflow-schemas.js';

export interface HumanAnswerValue {
  picks: string[];
  pick: string;
  other?: string;
  by: string;
}

/**
 * Validate an incoming answer against the question PINNED at ask time (not the current def — a
 * mid-run def edit can't change what was answered). Returns an error string, or null when valid.
 */
export function validateHumanAnswer(q: WorkflowHumanQuestion, answer: { picks: string[]; other?: string }): string | null {
  const ids = new Set(q.options.map(o => o.id));
  for (const p of answer.picks) if (!ids.has(p)) return `unknown option id "${p}"`;
  if (!q.multiSelect && answer.picks.length > 1) return 'this question accepts a single pick';
  if (answer.other !== undefined && q.allowOther === false) return 'free-text "other" is not allowed for this question';
  if (answer.picks.length === 0 && !answer.other) return 'pick at least one option (or provide "other")';
  return null;
}

/**
 * Record a human answer on a parked step: pin it into the run, write the answer JSON to the step's
 * answer_to_key (templated + keyPrefix'd — sandbox runs never clobber prod keys), and green the
 * step. Caller holds the run lock and ticks/persists afterwards.
 */
export async function applyHumanAnswer(
  storage: Storage, ownerGhii: string, run: WorkflowRun, stepId: string, ans: HumanAnswerValue,
): Promise<void> {
  const rs = run.steps[stepId];
  const step = run.defSnapshot.steps.find(s => s.id === stepId);
  const action = step?.action?.kind === 'human-input' ? step.action : undefined;
  const now = new Date().toISOString();
  rs.human = { ...rs.human!, answeredAt: now, answer: ans };
  if (action?.answer_to_key) {
    const key = (run.keyPrefix ?? '') + template(action.answer_to_key, run.vars);
    const existing = await storage.getMemory(ownerGhii, key);
    await storage.setMemory({
      key, ownerGaii: ownerGhii, value: { ...ans, answeredAt: now },
      visibility: 'private', tags: ['workflow-human-answer'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    rs.writes = [...new Set([...rs.writes, key])];
  }
  rs.state = 'green'; rs.endedAt = now;
}
