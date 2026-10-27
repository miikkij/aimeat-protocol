/**
 * @file src/services/schedule-instruction-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A sibling agent changes what another agent's `ai` schedule asks, and the schedule reads
 *   with more reach than the editor has: the next fire waits for the owner's one press.
 *
 *   WHY. Any agent of an owner may edit an `ai` schedule another agent of that owner made (decision
 *   2026-10-12 Q4, kept). The fire reads its inputs as the maker (schedule-ai-read.ts), so an editor
 *   without memory:read-as-owner could change the prompt of a schedule whose maker holds that word and
 *   read the owner's private records back in the answer (secaudit2026oct26,
 *   schedule-write.ts:updateScheduleRecord:sibling-edit-fires-under-maker-reach). The developer's
 *   decision of 2026-10-27: editing stays allowed; only when the editor lacks a reach the fire uses for
 *   the maker does the next fire wait for the owner's approval, with the editor seeing it pending.
 *
 *   WHEN IT HOLDS. The edit changes the schedule's input or prompt; the editor is an agent and not the
 *   maker; the maker is an agent; the editor does not hold memory:read-as-owner; and the maker does, or
 *   the input names the maker's own namespace (records only the maker reads). The owner in person, an
 *   app, the maker itself and an editor that holds the word edit and fire exactly as before.
 *
 *   WHAT HAPPENS. The edit is stored as before. A request is filed for the owner under the approval
 *   standard (publish-requests, kind `schedule-instruction`), and the editor gets it back as
 *   `approval_request` (pending). Each fire meanwhile is skipped with a sentence that says it waits.
 *   Allow: the next fire runs with the new instruction. Don't allow, or no answer before the request
 *   expires: the next fire puts back the instruction the schedule had before the held edit and runs
 *   with it. Either way the editor hears the answer. A later edit by someone who holds the reach (the
 *   owner, the maker, an agent with the word) is a new instruction and ends the hold.
 *
 *   WHERE. One record per held schedule under `system@<nodeId>`: HOLD_PREFIX + id, value
 *   { request_id, by, at, input (fingerprint), previous_input }.
 * @structure HOLD_PREFIX · instructionHoldNeeded · holdInstruction · clearInstructionHold · instructionHoldAtFire
 * @usage
 *   const need = await instructionHoldNeeded(storage, caller, job, nextInput);   // schedule-write.ts
 *   const held = await instructionHoldAtFire({ storage, config }, job);           // scheduler-ai-job.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { scopeIsCovered, READ_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';
import { updateMemoryRecord } from './record-cas.js';
import { makerOf } from './schedule-actor.js';
import { aiScheduleInputFingerprint } from './schedule-ai-read.js';
import { saverAuthority } from './workflow/trigger-authority.js';
import { fileAsk, publishRequestedBody } from './publish-requests/ask.js';
import { readPublishRequest, type PublishRequester } from './publish-requests/store.js';
import { publishRequestExpired } from './publish-requests/policy.js';

/** Where a held schedule's record lives, under `system@<nodeId>`. */
export const HOLD_PREFIX = 'schedules.instruction-hold.';

interface HoldRecord { request_id: string; by: string; at: string; input: string; previous_input: Record<string, unknown> }

const holdNs = (nodeId: string) => `system@${nodeId}`;
const nameOf = (gaii: string) => parseGaiiLoose(gaii).agent || gaii;
const scheduleName = (job: Pick<ScheduledJobRecord, 'id' | 'displayName' | 'name'>) => job.displayName || job.name || job.id;

/** The input namespaces an `ai` schedule's input names, in both spellings an edit may use. */
function namespacesOf(input: Record<string, unknown>): string[] {
  return [input.inputNamespaces, input.input_namespaces].flatMap(v => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []));
}

/** Who edits, in the terms services/schedule-write.ts ScheduleWriteCaller carries. */
export interface HoldEditor {
  identity: string; isOwnerSession: boolean; scopes: string[]; isApp?: boolean; appGrant?: string; isEcosystem?: boolean;
}

/**
 * Does this edit of `job` to `nextInput` wait for the owner? The maker's agent id when it does, else
 * null. Asked only for an edit that changes the input or the prompt.
 */
export async function instructionHoldNeeded(
  storage: Storage, editor: HoldEditor, job: ScheduledJobRecord, nextInput: Record<string, unknown>,
): Promise<{ maker: string } | null> {
  if (job.type !== 'ai' || editor.isOwnerSession || editor.isApp || editor.appGrant || editor.isEcosystem) return null;
  if (scopeIsCovered(editor.scopes, READ_AS_OWNER_SCOPE)) return null;
  const maker = makerOf(job);
  if (maker === 'unknown-app' || maker.kind !== 'agent' || maker.id === editor.identity) return null;
  if (namespacesOf(nextInput).includes(maker.id)) return { maker: maker.id };
  const now = await saverAuthority(storage, maker);
  return !now.gone && scopeIsCovered(now.scopes, READ_AS_OWNER_SCOPE) ? { maker: maker.id } : null;
}

/**
 * File the owner's question for an edit instruction an editor gave, and hold the schedule's next fire
 * on it. `previousInput` is what the schedule had before this edit. Answers what the editor is told.
 */
export async function holdInstruction(
  ctx: { storage: Storage; config: AimeatConfig },
  args: { owner: string; requester: PublishRequester; job: ScheduledJobRecord; maker: string; previousInput: Record<string, unknown>; input: Record<string, unknown> },
): Promise<{ approval_request: ReturnType<typeof publishRequestedBody> } | { warnings: Array<{ code: 'APPROVAL_NOT_ASKED'; message: string }> }> {
  const { storage, config } = ctx;
  const editor = nameOf(args.requester.principal);
  const maker = nameOf(args.maker);
  const name = scheduleName(args.job);
  const fingerprint = aiScheduleInputFingerprint(args.input);
  // A chain of held edits goes back to the last instruction that ran, not to the previous held one.
  const prior = await storage.getMemory(holdNs(config.nodeId), HOLD_PREFIX + args.job.id);
  const previous = (prior?.value as HoldRecord | undefined)?.previous_input ?? args.previousInput;
  try {
    const filed = await fileAsk(ctx, args.owner, args.requester, {
      kind: 'schedule-instruction',
      target: { schedule: args.job.id, input: fingerprint },
      title: `the new instruction for the schedule "${name}"`,
      name,
      change: { field: 'schedule.input', from: null, to: 'changed' },
      approval: {
        approver: 'owner',
        asks: `let the schedule "${name}" run with the instruction ${editor} gave it`,
        why: `${editor} changed what the schedule ${maker} made asks the model. The schedule reads your records with ${maker}'s reach, `
          + `which includes records ${editor} may not read, so its next run waits for you. If you do not allow it, the schedule goes back to the instruction it had.`,
        approve_scope: READ_AS_OWNER_SCOPE,
        change: { link: '/v1/profile?tab=scheduler', key: 'approval_change.scheduler' },
        i18n: { key: 'approval_schedule_instruction', vars: { schedule: name, editor, maker } },
      },
    });
    if (!filed.ok) {
      // The fire must not read with the maker's reach on an instruction nobody was asked about.
      await writeHold(storage, config.nodeId, args.job.id, { request_id: '', by: args.requester.principal, at: new Date().toISOString(), input: fingerprint, previous_input: previous });
      return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `The edit is stored, and the schedule goes back to its earlier instruction at its next run, because the owner could not be asked: ${filed.message}` }] };
    }
    await writeHold(storage, config.nodeId, args.job.id, { request_id: filed.request.id, by: args.requester.principal, at: new Date().toISOString(), input: fingerprint, previous_input: previous });
    return { approval_request: publishRequestedBody(ctx, filed) };
  } catch (err) {
    logger.warn('schedule instruction hold: the question could not be filed', { id: args.job.id, error: String(err) });
    await writeHold(storage, config.nodeId, args.job.id, { request_id: '', by: args.requester.principal, at: new Date().toISOString(), input: fingerprint, previous_input: previous })
      .catch(e => logger.warn('schedule instruction hold: the hold could not be written', { id: args.job.id, error: String(e) }));
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: 'The edit is stored, and the schedule goes back to its earlier instruction at its next run, because the owner could not be asked. Try the edit again in a moment.' }] };
  }
}

/** Write the hold record on the version read. */
async function writeHold(storage: Storage, nodeId: string, jobId: string, hold: HoldRecord): Promise<void> {
  await updateMemoryRecord(storage, holdNs(nodeId), HOLD_PREFIX + jobId, () => ({ value: hold, visibility: 'private', tags: ['schedule-hold'] }));
}

/** A new instruction from someone who holds the reach ends a hold. Never throws. */
export async function clearInstructionHold(storage: Storage, nodeId: string, jobId: string): Promise<void> {
  await storage.deleteMemory(holdNs(nodeId), HOLD_PREFIX + jobId)
    .catch(err => logger.warn('schedule instruction hold: the hold could not be removed', { id: jobId, error: String(err) }));
}

/** The hold of `jobId`, or null when the schedule waits on nothing. */
export async function readInstructionHold(storage: Storage, nodeId: string, jobId: string): Promise<HoldRecord | null> {
  const rec = await storage.getMemory(holdNs(nodeId), HOLD_PREFIX + jobId);
  const v = rec?.value as HoldRecord | undefined;
  return v && typeof v.input === 'string' ? v : null;
}

/**
 * At a fire: wait (with the sentence for the run log), or run `job` (with the earlier instruction
 * put back when the owner did not allow the held one).
 */
export async function instructionHoldAtFire(
  ctx: { storage: Storage; config: AimeatConfig }, job: ScheduledJobRecord,
): Promise<{ wait: string } | { job: ScheduledJobRecord }> {
  const { storage, config } = ctx;
  const hold = await readInstructionHold(storage, config.nodeId, job.id);
  if (!hold) return { job };
  const editor = nameOf(hold.by);
  const request = hold.request_id && job.ownerScope ? await readPublishRequest(storage, job.ownerScope, hold.request_id) : null;
  if (request && request.state === 'awaiting_owner' && !publishRequestExpired(request, Date.now())) {
    return { wait: `Waiting for the owner: ${editor} changed this schedule's instruction, and the owner allows it before the schedule runs with it.` };
  }
  if (request?.state === 'approved') {
    await clearInstructionHold(storage, config.nodeId, job.id);
    return { job };
  }
  // Not allowed, expired, outdated or never asked: the instruction the schedule had before comes back.
  const restored = await storage.updateScheduledJob(job.id, { input: hold.previous_input, updatedAt: new Date().toISOString() });
  await clearInstructionHold(storage, config.nodeId, job.id);
  logger.info(`Schedule ${job.id}: the instruction ${editor} gave was not allowed, so the earlier one runs`);
  return { job: restored ?? { ...job, input: hold.previous_input } };
}
