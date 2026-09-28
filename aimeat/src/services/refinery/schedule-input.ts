/**
 * @file src/services/refinery/schedule-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a `refinery` schedule's input must be before it is stored, and who the schedule
 *   runs as. A leaf: services/schedule-write.ts imports it, and the batch itself (runs.ts,
 *   pipeline.ts) reaches back into the scheduler's neighbours, so the check lives apart from it.
 *
 *   IT RUNS AS WHOEVER MADE IT. A schedule the owner (or one of their apps) made reads the owner's
 *   mailbox; a schedule an agent made reads only a mailbox that agent connected, because a connection
 *   belongs to the principal that made it (mcp/connections.ts).
 * @structure REFINERY_PREFIX_RE · refineryRunAs · checkRefineryScheduleInput
 * @usage const bad = await checkRefineryScheduleInput(storage, ownerScope, refineryRunAs(job), input);
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import { requireOwnConnection } from '../connections/access.js';

/** A refinery definition's name: the `<prefix>` of `<prefix>.config`. */
export const REFINERY_PREFIX_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

/** Who a refinery schedule runs as: its maker when an agent made it, else the owner. */
export function refineryRunAs(job: Pick<ScheduledJobRecord, 'createdByAgent' | 'createdBy' | 'ownerScope'>): string {
  return job.createdByAgent && job.createdBy ? job.createdBy : (job.ownerScope ?? '');
}

/**
 * Everything about a refinery schedule's input that can be checked before it fires: the prefix,
 * that the definition exists, and that its mailbox is one the schedule's runner holds. Shared by
 * create and edit, so an edit cannot walk around it.
 */
export async function checkRefineryScheduleInput(
  storage: Storage, ownerScope: string, runAs: string, raw: unknown,
): Promise<{ status: number; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string } | null> {
  const given = (raw as { prefix?: unknown } | null)?.prefix;
  const prefix = typeof given === 'string' ? given.trim() : '';
  if (!REFINERY_PREFIX_RE.test(prefix)) {
    return { status: 400, code: 'INVALID_INPUT', message: 'input.prefix names the refinery definition: lowercase letters, digits, - or _ (the definition is <prefix>.config).' };
  }
  const rec = await storage.getMemory(ownerScope, `${prefix}.config`);
  if (!rec) return { status: 404, code: 'NOT_FOUND', message: `There is no refinery definition at ${prefix}.config.` };
  const conn = rec.value && typeof rec.value === 'object' ? String((rec.value as { connectionId?: unknown }).connectionId ?? '') : '';
  if (!conn || !(await requireOwnConnection(storage, runAs, conn))) {
    return { status: 404, code: 'NOT_FOUND', message: `The mailbox ${prefix}.config names is not one of the schedule's runner's connections. An agent schedules a definition whose mailbox it connected itself.` };
  }
  return null;
}
