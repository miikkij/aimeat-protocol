/**
 * @file lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps a workflow's TRIGGERS in sync with its definition — shared by the REST route
 *   and the MCP tools so both author workflows identically. A `schedule` trigger gets a backing
 *   type:'workflow' ScheduledJobRecord (the scheduler fires it → engine.startRun); an `event`
 *   trigger is registered in a system-namespace index the engine consults on memory writes / offer
 *   orders; `manual` has neither. All reversible (disable/remove, never silently strand). See
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md §1 (event triggers) + §9 (migration).
 * @structure
 *   - syncWorkflowTriggers(storage, scheduler, nodeId, def, ownerGhii, createdBy)
 *   - removeWorkflowTriggers(storage, scheduler, nodeId, workflowId, ownerGhii)
 *   - readEventTriggers(storage, nodeId) — the engine's roster of event-triggered workflows
 *   - EventTrigger type
 * @usage import { syncWorkflowTriggers, readEventTriggers } from './lifecycle.js';
 * @version-history
 *   v1.1.0 — 2026-10-13 — A workflow's triggers belong to its owner AND its id. The backing schedule
 *     was `wf-sched:<workflow id>` and the two event indexes were cleared by workflow id alone, so a
 *     second owner who saved or deleted a workflow with the same id took over, or removed, the first
 *     owner's schedule and event trigger. The schedule id now carries the owner (schedIdFor), a
 *     schedule under the old id is taken along only when it is this owner's, and an index entry is
 *     cleared only for its own owner. removeWorkflowTriggers takes the owner. An event trigger's
 *     `on` may be `workspace.rows`, and a deleted workflow's waiting events go with it.
 *   v1.0.0 — 2026-06-13 — Phase 8: extracted backing-schedule sync + added the event-trigger index.
 */
import { createHash } from 'node:crypto';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { Scheduler } from '../scheduler.js';
import type { WorkflowDef, WorkflowRun } from '../../models/workflow-schemas.js';
import { getRun } from './store.js';
import { dropWaitingEvents } from './engine-coalesce.js';

const EVENT_INDEX_KEY = 'workflows.eventindex';
const ECO_EVENT_INDEX_KEY = 'workflows.ecoeventindex';
const ACTIVE_KEY = 'workflows.active';
/** The backing schedule's id before 2026-10-13: the workflow id alone, shared by every owner. */
const legacySchedIdFor = (workflowId: string): string => `wf-sched:${workflowId}`;
/**
 * The backing schedule's id: the workflow id and a short hash of its owner. The hash, not the
 * identity, because the id goes into a URL (/v1/schedules/:id) and names nobody there.
 */
export const schedIdFor = (workflowId: string, ownerGhii: string): string =>
  `wf-sched:${workflowId}:${createHash('sha256').update(ownerGhii).digest('hex').slice(0, 12)}`;
const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;
const titleStr = (def: WorkflowDef): string => (typeof def.title === 'string' ? def.title : (def.title.en_US ?? def.id));

export interface EventTrigger {
  ownerGhii: string;
  workflowId: string;
  on: 'memory.write' | 'offer.ordered' | 'workspace.rows';
  match: Record<string, string>;
}

/** Sibling of EventTrigger for the `ecosystem.event` kind — keyed by {app, on, version}. */
export interface EcosystemEventTrigger {
  ownerGhii: string;
  workflowId: string;
  app: string;
  on: string;
  version: number;            // pinned MAJOR; engine fail-safe skips on a major mismatch
  match?: Record<string, string>;
}

export interface ActiveRun { ownerGhii: string; workflowId: string; runId: string; }

// ── active-run index (system namespace; the cross-owner roster the watchdog + resume + event
// triggers read — memory is per-owner, so an in-flight roster lives here). ──────────────────────
export async function readActiveRuns(storage: Storage, nodeId: string): Promise<ActiveRun[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), ACTIVE_KEY);
  const arr = rec?.value as ActiveRun[] | undefined;
  return Array.isArray(arr) ? arr : [];
}

async function writeActiveRuns(storage: Storage, nodeId: string, entries: ActiveRun[]): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, ACTIVE_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: ACTIVE_KEY, ownerGaii: systemGhii, value: entries,
    visibility: 'private', tags: ['workflow-index'], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Add/remove a run from the active-run index based on its status (in-flight ⇒ present). */
export async function reconcileActiveRun(storage: Storage, nodeId: string, ownerGhii: string, run: WorkflowRun): Promise<void> {
  const inFlight = run.status === 'running' || run.status === 'waiting-step';
  const entries = await readActiveRuns(storage, nodeId);
  const has = entries.some(e => e.runId === run.runId);
  if (inFlight && !has) await writeActiveRuns(storage, nodeId, [...entries, { ownerGhii, workflowId: run.workflowId, runId: run.runId }]);
  else if (!inFlight && has) await writeActiveRuns(storage, nodeId, entries.filter(e => e.runId !== run.runId));
}

// ── event-trigger index (system namespace; the engine's roster) ──────────────────
export async function readEventTriggers(storage: Storage, nodeId: string): Promise<EventTrigger[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), EVENT_INDEX_KEY);
  const arr = rec?.value as EventTrigger[] | undefined;
  return Array.isArray(arr) ? arr : [];
}

async function writeEventTriggers(storage: Storage, nodeId: string, entries: EventTrigger[]): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, EVENT_INDEX_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: EVENT_INDEX_KEY, ownerGaii: systemGhii, value: entries,
    visibility: 'private', tags: ['workflow-index'], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Drop this owner's event-index entries for a workflow (used before re-adding, and on delete). */
async function clearEventTrigger(storage: Storage, nodeId: string, workflowId: string, ownerGhii: string): Promise<EventTrigger[]> {
  const entries = await readEventTriggers(storage, nodeId);
  const next = entries.filter(e => !(e.workflowId === workflowId && e.ownerGhii === ownerGhii));
  if (next.length !== entries.length) await writeEventTriggers(storage, nodeId, next);
  return next;
}

// ── ecosystem-event-trigger index (system namespace; the engine's GEAI-event roster) ──────────────
export async function readEcosystemEventTriggers(storage: Storage, nodeId: string): Promise<EcosystemEventTrigger[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), ECO_EVENT_INDEX_KEY);
  const arr = rec?.value as EcosystemEventTrigger[] | undefined;
  return Array.isArray(arr) ? arr : [];
}

async function writeEcosystemEventTriggers(storage: Storage, nodeId: string, entries: EcosystemEventTrigger[]): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, ECO_EVENT_INDEX_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: ECO_EVENT_INDEX_KEY, ownerGaii: systemGhii, value: entries,
    visibility: 'private', tags: ['workflow-index'], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

async function clearEcosystemEventTrigger(storage: Storage, nodeId: string, workflowId: string, ownerGhii: string): Promise<EcosystemEventTrigger[]> {
  const entries = await readEcosystemEventTriggers(storage, nodeId);
  const next = entries.filter(e => !(e.workflowId === workflowId && e.ownerGhii === ownerGhii));
  if (next.length !== entries.length) await writeEcosystemEventTriggers(storage, nodeId, next);
  return next;
}

// ── sync on save ─────────────────────────────────────────────────────────────────
export async function syncWorkflowTriggers(
  storage: Storage, scheduler: Scheduler, nodeId: string, def: WorkflowDef, ownerGhii: string, createdBy: string,
): Promise<void> {
  await dropLegacySchedule(storage, scheduler, def.id, ownerGhii);
  const schedId = schedIdFor(def.id, ownerGhii);
  const existingSched = await storage.getScheduledJob(schedId);

  // 1. Backing cron schedule (schedule trigger only).
  if (def.trigger.kind === 'schedule') {
    const now = new Date().toISOString();
    const record: ScheduledJobRecord = {
      id: schedId, name: `workflow:${def.id}`, type: 'workflow',
      cron: def.trigger.cron, timezone: def.trigger.timezone, enabled: true,
      input: { workflowId: def.id }, ownerScope: ownerGhii,
      displayName: titleStr(def), createdBy,
      createdAt: existingSched?.createdAt ?? now, updatedAt: now,
    };
    if (existingSched) await storage.updateScheduledJob(schedId, record);
    else await storage.createScheduledJob(record);
    await scheduler.reschedule(schedId);
  } else if (existingSched) {
    scheduler.removeJob(schedId);
    await storage.deleteScheduledJob(schedId);
  }

  // 2. Event-trigger index (event trigger only).
  const entries = await clearEventTrigger(storage, nodeId, def.id, ownerGhii);
  if (def.trigger.kind === 'event') {
    entries.push({ ownerGhii, workflowId: def.id, on: def.trigger.on, match: def.trigger.match });
    await writeEventTriggers(storage, nodeId, entries);
  }

  // 3. Ecosystem-event-trigger index (ecosystem.event trigger only).
  const ecoEntries = await clearEcosystemEventTrigger(storage, nodeId, def.id, ownerGhii);
  if (def.trigger.kind === 'ecosystem.event') {
    ecoEntries.push({
      ownerGhii, workflowId: def.id,
      app: def.trigger.app, on: def.trigger.on, version: def.trigger.version, match: def.trigger.match,
    });
    await writeEcosystemEventTriggers(storage, nodeId, ecoEntries);
  }
}

// ── teardown on delete ─────────────────────────────────────────────────────────
export async function removeWorkflowTriggers(storage: Storage, scheduler: Scheduler, nodeId: string, workflowId: string, ownerGhii: string): Promise<void> {
  await dropLegacySchedule(storage, scheduler, workflowId, ownerGhii);
  const schedId = schedIdFor(workflowId, ownerGhii);
  if (await storage.getScheduledJob(schedId)) {
    scheduler.removeJob(schedId);
    await storage.deleteScheduledJob(schedId);
  }
  await clearEventTrigger(storage, nodeId, workflowId, ownerGhii);
  await clearEcosystemEventTrigger(storage, nodeId, workflowId, ownerGhii);
  await dropWaitingEvents(storage, nodeId, ownerGhii, workflowId);
}

/**
 * A schedule saved under the id every owner shared (before 2026-10-13) is removed when it is THIS
 * owner's; the caller then writes it again under the owner's own id, or not at all. One that
 * belongs to somebody else stays where it is and keeps running for them, until their own next save
 * moves it.
 */
async function dropLegacySchedule(storage: Storage, scheduler: Scheduler, workflowId: string, ownerGhii: string): Promise<void> {
  const legacyId = legacySchedIdFor(workflowId);
  const legacy = await storage.getScheduledJob(legacyId);
  if (!legacy || legacy.type !== 'workflow' || legacy.ownerScope !== ownerGhii) return;
  scheduler.removeJob(legacyId);
  await storage.deleteScheduledJob(legacyId);
}

/** One step waiting on a person, with everything either surface renders it from. */
export interface PendingHumanInput {
    workflowId: string;
    runId: string;
    stepId: string;
    workflowTitle: WorkflowDef['title'];
    mode: WorkflowRun['mode'];
    question: WorkflowRun['steps'][string]['human'] extends { question: infer Q } | undefined ? Q : unknown;
    askedAt: string;
    deadline: string;
}

/**
 * Every step across this owner's active runs that is waiting on a person.
 *
 * The walk existed twice — GET /v1/workflows/pending-inputs and aimeat_workflow_pending_inputs —
 * including the deadline arithmetic. A deadline computed two ways is a deadline: an agent told one
 * time and a dashboard showing another is worse than either being wrong on its own.
 *
 * Returns every field both surfaces need; each renders and names them its own way.
 */
export async function pendingHumanInputs(
    storage: Storage,
    nodeId: string,
    ownerGhii: string,
    humanTimeoutMinDefault: number,
): Promise<PendingHumanInput[]> {
    const active = (await readActiveRuns(storage, nodeId)).filter(a => a.ownerGhii === ownerGhii);
    const out: PendingHumanInput[] = [];
    for (const a of active) {
        const run = await getRun(storage, ownerGhii, a.workflowId, a.runId);
        if (!run) continue;
        for (const step of run.defSnapshot.steps) {
            const rs = run.steps[step.id];
            if (rs?.state !== 'waiting-human' || !rs.human) continue;
            out.push({
                workflowId: a.workflowId,
                runId: a.runId,
                stepId: step.id,
                workflowTitle: run.defSnapshot.title,
                mode: run.mode,
                question: rs.human.question,
                askedAt: rs.human.askedAt,
                deadline: new Date(new Date(rs.human.askedAt).getTime()
                    + (step.timeout_min ?? humanTimeoutMinDefault) * 60_000).toISOString(),
            });
        }
    }
    return out;
}
