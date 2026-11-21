/**
 * @file src/routes/agent-tasks/dedupe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-live-commission guard for POST /v1/agents/:name/tasks — the server-side half
 *   of "one click, one run". The browser SDK collapses repeat clicks inside a page; this catches the
 *   cases it cannot see (a reload, a second tab, a retrying script), where each duplicate would be a
 *   real agent run the owner pays for. Builds the commission fingerprint, recognises the unique-index
 *   violation that a genuine race produces, and renders the "you already have this one running"
 *   response — 200 with the existing task plus `deduplicated`, so a caller that ignores the flag
 *   still gets a usable task and nothing breaks.
 * @structure respondDeduplicated() · commissionFingerprint() and isUniqueViolation(), re-exported
 * @usage import { respondDeduplicated } from './dedupe.js';
 * @version-history
 *   2026-11-21 — The deduplicated answer names `ignored_fields` too.
 *   2026-11-13 — commissionFingerprint and isUniqueViolation moved unchanged to
 *     services/agent-tasks/commission-dedupe.ts and are re-exported here, so the task write service
 *     no longer imports a route file (structure programme 2026-11, unit 4).
 *   v1.0.0 — 2026-07-31 — Initial: fingerprint + conflict detection + the deduplicated response.
 */

import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { AgentTaskRecord } from '../../storage/interface.js';
import { success } from '../../middleware/envelope.js';

export { commissionFingerprint, isUniqueViolation } from '../../services/agent-tasks/commission-dedupe.js';

/**
 * The answer to "I ordered this already": 200 (not 201 — nothing was created) with the task the
 * owner already has, and the flag that lets a UI say so instead of pretending it queued a new run.
 * `task` stays exactly where it was, so a caller written before this existed reads it unchanged.
 */
export function respondDeduplicated(
  res: Response, config: AimeatConfig, agentName: string, existing: AgentTaskRecord, ignoredFields?: string[],
): void {
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 1000));
  res.status(200).json(success(config.nodeId, {
    task: existing,
    deduplicated: true,
    existing_task_id: existing.id,
    deduplicated_reason: `an identical commission for '${agentName}' is already ${existing.status}`
      + ` (created ${ageSeconds}s ago) — it was not queued a second time`,
    // The request's fields the task takes nowhere (services/agent/task-write.ts ignoredCreateFields).
    ...(ignoredFields?.length ? { ignored_fields: ignoredFields } : {}),
  }, [
    { description: 'View the running task', method: 'GET', url: `/v1/agents/${agentName}/tasks/${existing.id}` },
    { description: 'Cancel it', method: 'DELETE', url: `/v1/agents/${agentName}/tasks/${existing.id}` },
    { description: 'Commission it anyway', method: 'POST', url: `/v1/agents/${agentName}/tasks` },
  ]));
}
