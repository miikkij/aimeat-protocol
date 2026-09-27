/**
 * @file src/services/workflow/engine-human.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Human-input step completion helpers — answer validation against the PINNED question
 *   and answer application (memory write + step green). Pure of engine state: the engine calls these
 *   under the run lock (onHumanAnswer / the sweep's on_timeout='default' path) and ticks afterwards.
 *   Extracted from engine.ts to satisfy max-file-lines.
 * @usage import { validateHumanAnswer, applyHumanAnswer } from './engine-human.js';
 * @version-history
 *   v1.3.0 — 2026-09-26 — HUMAN_TIMEOUT_MIN_DEFAULT and sweepHumanStep, the watchdog's on_timeout
 *     policy for a waiting human-input step, moved here from engine.ts unchanged (max-file-lines).
 *     engine.ts exports the constant as before.
 *   v1.2.0 — 2026-08-15 — The upgrade requires a PERSON, which the paragraph guarding it always
 *     said and the code never asked. An agent could call aimeat_workflow_answer on the step holding
 *     its own draft and the node stamped that content 'editorial-control' with the note "reviewed
 *     by <the agent>", turning the public disclosure label from "no human editorial review" into
 *     the reviewed wording with nobody having read the bytes. `byIsHuman` is set by the door that
 *     knows the principal class and absent everywhere else, so agents keep answering and stop
 *     upgrading. E2E test-quality audit finding A18.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4: a human-input step that names `reviews_key` re-stamps
 *     the reviewed content with humanInvolvement 'editorial-control'. This is the ONLY place in
 *     the engine that may upgrade that field, and a watchdog timeout default never does — nobody
 *     read anything on that path. Takes `config` for the node id / label posture.
 *   v1.0.0 — 2026-07-16 — Initial: validateHumanAnswer + applyHumanAnswer (human-input steps).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { stampAutonomousOutput } from '../ai-provenance.js';
import { template } from './engine-util.js';
import { failDownstream } from './engine-readiness.js';
import type { WorkflowRun, WorkflowStep, WorkflowHumanQuestion } from '../../models/workflow-schemas.js';

/** Default wait for a human-input step's answer — humans sleep; 24h, not the agent-step 60 min. */
export const HUMAN_TIMEOUT_MIN_DEFAULT = 1440;

export interface HumanAnswerValue {
  picks: string[];
  pick: string;
  other?: string;
  by: string;
  /**
   * Was the answerer a PERSON? Absent means no, deliberately: the upgrade below is the one thing in
   * the engine that can turn "no human editorial review" into "reviewed by a person", so a caller
   * has to say so on purpose. `by` alone cannot answer it — an agent's GAII and a human's GHII are
   * both just strings here, and inferring humanness from their shape would break the moment a new
   * principal class arrives.
   */
  byIsHuman?: boolean;
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
  storage: Storage, config: AimeatConfig, ownerGhii: string, run: WorkflowRun, stepId: string, ans: HumanAnswerValue,
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

  // ── TARGET-058: the ONE place in the engine that may upgrade humanInvolvement ──
  //
  // ONLY A STEP WHERE A PERSON READS THE SUBSTANCE AND CAN REJECT IT UPGRADES humanInvolvement.
  // Clicking publish is not that step. A workflow human-input step that reviews substance MAY
  // upgrade it. Nothing else may.
  //
  // `reviews_key` is how a step says it is that kind of step: it names the content that was put in
  // front of the person. A step that asks "publish now?" without naming what was read sets nothing
  // here and the reviewed content keeps whatever record it already had.
  //
  // A TIMEOUT DEFAULT IS NOT REVIEW. When the watchdog synthesises an answer (`by: 'timeout-default'`)
  // nobody read anything, and upgrading on that path would manufacture editorial control out of
  // silence — which is the precise failure this whole design exists to prevent.
  //
  // AND NEITHER IS AN AGENT ANSWERING ITS OWN STEP. The paragraph above says "a person reads the
  // substance", and until 2026-08-15 nothing enforced the person: the very agent whose draft was
  // parked for review called aimeat_workflow_answer on it and the node stamped that content
  // `humanInvolvement: 'editorial-control'` with the note "reviewed by <the agent>", flipping the
  // public disclosure label from "no human editorial review" to the reviewed wording with nobody
  // having seen the bytes. That is a false statement about provenance, which is the one thing this
  // record exists to make true. `byIsHuman` is set by the door that knows the principal class; the
  // agent surface and the watchdog leave it unset, so both keep answering and neither upgrades.
  if (action?.reviews_key && ans.by && ans.by !== 'timeout-default' && ans.byIsHuman === true) {
    const reviewedKey = (run.keyPrefix ?? '') + template(action.reviews_key, run.vars);
    const reviewed = await storage.getMemory(ownerGhii, reviewedKey);
    if (reviewed) {
      // Re-stamped rather than edited: a provenance record is an append-only statement about a set
      // of bytes, so "a person has now reviewed this" is a NEW statement about the same bytes.
      const provenanceId = await stampAutonomousOutput(storage, {
        principal: ownerGhii,
        content: typeof reviewed.value === 'string' ? reviewed.value : JSON.stringify(reviewed.value ?? null),
        level: 'ai-generated',
        pipeline: `workflow:${run.defSnapshot.id}/${stepId}`,
        reviewedBy: { who: ans.by, step: stepId },
        surface: { visibility: reviewed.visibility, humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
      });
      if (provenanceId) {
        await storage.setMemory({ ...reviewed, aiProvenanceId: provenanceId, updatedAt: now });
        rs.writes = [...new Set([...rs.writes, reviewedKey])];
      }
    }
  }
  rs.state = 'green'; rs.endedAt = now;
}

/**
 * The watchdog's turn for a human-input step that waits for its answer: once timeout_min (default
 * HUMAN_TIMEOUT_MIN_DEFAULT) has passed since the question was asked, the step's on_timeout policy
 * applies (fail | skip | default). `onTimedOut` is the engine's alert for a failed step. Returns
 * whether the step changed. The caller holds the run lock, has checked that the step waits with its
 * question asked, and saves the run afterwards.
 */
export async function sweepHumanStep(
  storage: Storage, config: AimeatConfig, ownerGhii: string, r: WorkflowRun, step: WorkflowStep,
  now: number, nowIso: string, onTimedOut: () => Promise<void>,
): Promise<boolean> {
  const rs = r.steps[step.id];
  const action = step.action?.kind === 'human-input' ? step.action : undefined;
  const deadline = new Date(rs.human!.askedAt).getTime() + (step.timeout_min ?? HUMAN_TIMEOUT_MIN_DEFAULT) * 60_000;
  if (now < deadline) return false;
  const policy = action?.on_timeout ?? 'fail';
  if (policy === 'default' && action?.default_option) {
    await applyHumanAnswer(storage, config, ownerGhii, r, step.id, {
      picks: [action.default_option], pick: action.default_option, by: 'timeout-default',
    });
  } else if (policy === 'skip') {
    rs.state = 'skipped'; rs.endedAt = nowIso;
  } else {
    rs.state = 'timed-out'; rs.endedAt = nowIso;
    failDownstream(r, step.id);
    await onTimedOut();
  }
  return true;
}
