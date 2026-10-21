/**
 * @file src/services/schedule-fire-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an `extension` or `agent_task` schedule fires now, asked of its maker at every
 *   fire, and the sentence the owner reads when it does not.
 *
 *   THE RULE (services/schedule-actor.ts). A schedule acts as its maker, the maker is looked up again
 *   at every fire, and a maker that is gone does not fire. A maker that is not the owner in person
 *   also holds every word the kind costs (services/schedule-gate.ts SCHEDULE_KIND_SCOPE): ext:invoke
 *   for `extension`, task:write for `agent_task`. These two kinds never asked at the fire until
 *   2026-10-20 (secaudit 2026-10, runAgentTaskJob:fires-without-asking-maker and
 *   SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke).
 *
 *   WHAT KEEPS WORKING (capability-loss review, 2026-10-21: a use that worked keeps working):
 *     - A schedule an app made before 2026-10-05 names no grant (makerOf 'unknown-app'). These two
 *       kinds always ran it as the account itself, and still do; the same rule as an extension with
 *       no recorded code writer. A schedule that names its grant stops when the grant is revoked.
 *     - An app's `extension` schedule made before the kind asked ext:invoke, from a grant without the
 *       word, keeps firing when the once-only step kept it (services/schedule-extension-keep.ts).
 *     - An agent missing the word is refused, and the refusal is noted on the agent
 *       (services/agent-refusals.ts noteAgentRefusal), which asks the owner in the bell and by email:
 *       an Allow button for a word one press may give, the agent's page for a powerful word such as
 *       task:write (services/permission-ask-notice.ts). The sentence in the run log carries the same
 *       address. A deleted agent is not asked about: it is gone, and the plain sentence says so.
 * @structure FireRefusalContext · scheduleFireRefusal(storage, job, ctx)
 * @usage
 *   const refused = await scheduleFireRefusal(storage, job, { nodeId: config.nodeId, baseUrl: config.baseUrl });
 *   if (refused) throw new Error(refused);
 * @version-history
 *   v1.0.1 — 2026-10-21 — The refused maker is noted through agentSessionCaller, not a literal role.
 *   v1.0.0 — 2026-10-21 — Moved out of services/schedule-actor.ts (written there 2026-10-20), with
 *     the three keep-working rules above.
 */
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { noteAgentRefusal } from './agent-refusals.js';
import { agentSessionCaller } from './caller-context.js';
import { agentPageUrl, allowUrl, oneClickWords } from './permission-ask.js';
import { SCHEDULE_KIND_SCOPE, type ScheduleKind } from './schedule-gate.js';
import { makerOf, scheduleActor } from './schedule-actor.js';
import { isKeptExtensionSchedule } from './schedule-extension-keep.js';

/** What the sentence and the keep list need from the node: its id and its public address. */
export interface FireRefusalContext { nodeId: string; baseUrl: string }

/**
 * Why `job` does not fire now, or null when it does. The executor throws the sentence, and the
 * scheduler stores it as the run's error and tells the owner (services/scheduler-failures.ts).
 */
export async function scheduleFireRefusal(
  storage: Storage,
  job: Pick<ScheduledJobRecord, 'id' | 'type' | 'createdBy' | 'createdByAgent' | 'createdByApp' | 'ownerScope'>,
  ctx: FireRefusalContext,
): Promise<string | null> {
  const maker = makerOf(job);
  // An app's schedule from before 2026-10-05: these two kinds ran it as the account, and still do.
  if (maker === 'unknown-app') return null;
  const actor = await scheduleActor(storage, job);
  if (!actor.ok) return actor.reason;
  if (actor.isOwner) return null;
  const entry = SCHEDULE_KIND_SCOPE[job.type as ScheduleKind];
  const needed = entry === undefined ? [] : typeof entry === 'string' ? [entry] : [...entry];
  const missing = needed.filter(word => !scopeIsCovered(actor.scopes, word));
  if (!missing.length) return null;

  if (job.type === 'extension' && maker.kind !== 'agent' && await isKeptExtensionSchedule(storage, ctx.nodeId, job.id)) return null;

  if (maker.kind === 'agent') {
    const name = parseGaiiLoose(actor.principal).agent || actor.principal;
    // On the agent's card and in the owner's bell and email, once while the refusal stays open.
    // An empty owner lets agentSessionCaller derive it with localAccountName.
    const caller = agentSessionCaller(actor.principal, '', actor.scopes, ctx.nodeId, storage);
    noteAgentRefusal(caller.auth, missing, false, `schedule ${job.id}`);
    const where = oneClickWords(missing)
      ? `Allow it with one press: ${allowUrl(ctx.baseUrl, name, missing)}`
      : `Allow it on the agent's page: ${agentPageUrl(ctx.baseUrl, name)}`;
    return `${name}, which made this schedule, does not hold ${missing.join(', ')}, so the schedule does not run. ${where} Or delete this schedule.`;
  }
  return `What made this schedule no longer holds ${missing.join(', ')}, so it does not run. Approve it again, or delete this schedule.`;
}
