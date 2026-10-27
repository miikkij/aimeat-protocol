/**
 * @file src/services/publish-requests/apply-schedule-instruction.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed the instruction a sibling agent gave another agent's `ai` schedule
 *   (services/schedule-instruction-hold.ts filed it). The hold ends, and the next fire runs with that
 *   instruction. A schedule deleted since, or one whose instruction changed again after the request,
 *   ends the request `outdated`: the owner allowed what they saw, never something else.
 * @structure applyScheduleInstruction
 * @usage registered in appliers.ts under the kind 'schedule-instruction'
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26, sibling-edit-fires-under-maker-reach).
 */
import { aiScheduleInputFingerprint } from '../schedule-ai-read.js';
import { clearInstructionHold, readInstructionHold } from '../schedule-instruction-hold.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyScheduleInstruction(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const id = String(request.target.schedule ?? '');
  const job = id ? await ctx.storage.getScheduledJob(id) : null;
  if (!job || job.ownerScope !== ownerGhii) return { ok: false, reason: 'the schedule was deleted' };
  const hold = await readInstructionHold(ctx.storage, ctx.config.nodeId, id);
  if (!hold || hold.request_id !== request.id || hold.input !== aiScheduleInputFingerprint(job.input) || hold.input !== String(request.target.input ?? '')) {
    return { ok: false, reason: 'the schedule\'s instruction changed again after this was asked' };
  }
  await clearInstructionHold(ctx.storage, ctx.config.nodeId, id);
  return { ok: true };
}
