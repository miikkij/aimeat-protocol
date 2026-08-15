/**
 * @file agent-task.ts
 * @description SQLite implementation for agent task CRUD, events, and stall detection
 * @version-history
 *   2026-08-15 — createdBy on insert and read (migration 0037).
 *   v1.3.0 -- 2026-07-31 -- Persist dedupeKey + findLiveTaskByDedupeKey (one live commission per agent+fingerprint)
 *   v1.2.0 -- 2026-06-15 -- Persist the `automation` field (ecosystem-app recipe provenance/routing, B5/B6)
 *   v1.1.0 -- 2026-06-05 -- deleteAgentTask now removes any non-active task (was draft/queued only)
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type Database from 'better-sqlite3';
import type { AgentTaskRecord, AgentTaskEventRecord } from '../../../interface.js';
import { LIVE_TASK_STATUSES } from '../../../interface.js';

// ── Helpers ──

function deserializeTask(row: Record<string, unknown>): AgentTaskRecord {
  const record: AgentTaskRecord = {
    id: row.id as string,
    agentGaii: row.agentGaii as string,
    ownerGaii: row.ownerGaii as string,
    createdBy: (row.createdBy as string) ?? null,
    title: row.title as string,
    description: row.description as string,
    scope: JSON.parse(row.scope as string),
    rules: JSON.parse(row.rules as string),
    verification: JSON.parse(row.verification as string),
    todos: JSON.parse(row.todos as string),
    status: row.status as AgentTaskRecord['status'],
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.dedupeKey) record.dedupeKey = row.dedupeKey as string;
  if (row.resources) record.resources = JSON.parse(row.resources as string);
  if (row.parentTaskId) record.parentTaskId = row.parentTaskId as string;
  if (row.workTrackingCode) record.workTrackingCode = row.workTrackingCode as string;
  if (row.telemetry) record.telemetry = JSON.parse(row.telemetry as string);
  if (row.lastEventAt) record.lastEventAt = row.lastEventAt as string;
  if (row.completedAt) record.completedAt = row.completedAt as string;
  if (row.deliverableKey) record.deliverableKey = row.deliverableKey as string;
  if (row.rating) record.rating = JSON.parse(row.rating as string);
  if (row.triage) record.triage = row.triage as AgentTaskRecord['triage'];
  if (row.automation) record.automation = JSON.parse(row.automation as string);
  return record;
}

function deserializeEvent(row: Record<string, unknown>): AgentTaskEventRecord {
  const record: AgentTaskEventRecord = {
    id: row.id as string,
    taskId: row.taskId as string,
    type: row.type as AgentTaskEventRecord['type'],
    message: row.message as string,
    timestamp: row.timestamp as string,
  };
  if (row.details) record.details = JSON.parse(row.details as string);
  return record;
}

// ── Agent Tasks ──

export function createAgentTask(db: Database.Database, record: AgentTaskRecord): AgentTaskRecord {
  db.prepare(
    `INSERT INTO agent_tasks
     (id, agentGaii, ownerGaii, title, description, scope, rules, verification,
      resources, todos, status, dedupeKey, parentTaskId, workTrackingCode, telemetry,
      lastEventAt, createdAt, updatedAt, completedAt, deliverableKey, rating, triage, automation, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.agentGaii,
    record.ownerGaii,
    record.title,
    record.description,
    JSON.stringify(record.scope),
    JSON.stringify(record.rules),
    JSON.stringify(record.verification),
    record.resources ? JSON.stringify(record.resources) : null,
    JSON.stringify(record.todos),
    record.status,
    record.dedupeKey ?? null,
    record.parentTaskId ?? null,
    record.workTrackingCode ?? null,
    record.telemetry ? JSON.stringify(record.telemetry) : null,
    record.lastEventAt ?? null,
    record.createdAt,
    record.updatedAt,
    record.completedAt ?? null,
    record.deliverableKey ?? null,
    record.rating ? JSON.stringify(record.rating) : null,
    record.triage ?? null,
    record.automation ? JSON.stringify(record.automation) : null,
    record.createdBy ?? null,
  );
  return record;
}

export function getAgentTask(db: Database.Database, id: string): AgentTaskRecord | null {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeTask(row) : null;
}

/** The open commission carrying this fingerprint, if the owner already has one running. */
export function findLiveTaskByDedupeKey(
  db: Database.Database, agentGaii: string, dedupeKey: string,
): AgentTaskRecord | null {
  const placeholders = LIVE_TASK_STATUSES.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT * FROM agent_tasks WHERE agentGaii = ? AND dedupeKey = ? AND status IN (${placeholders})
     ORDER BY createdAt DESC LIMIT 1`,
  ).get(agentGaii, dedupeKey, ...LIVE_TASK_STATUSES) as Record<string, unknown> | undefined;
  return row ? deserializeTask(row) : null;
}

export function listAgentTasks(
  db: Database.Database,
  agentGaii: string,
  opts?: { status?: string; page?: number; perPage?: number },
): { tasks: AgentTaskRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let whereSql = 'WHERE agentGaii = ?';
  const params: unknown[] = [agentGaii];

  if (opts?.status) {
    whereSql += ' AND status = ?';
    params.push(opts.status);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_tasks ${whereSql}`).get(...params) as { cnt: number }).cnt;

  const rows = db.prepare(
    `SELECT * FROM agent_tasks ${whereSql} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as Record<string, unknown>[];

  return { tasks: rows.map(deserializeTask), total };
}

export function listAgentTasksByOwner(
  db: Database.Database,
  ownerGaii: string,
  opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number },
): { tasks: AgentTaskRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let whereSql = 'WHERE ownerGaii = ?';
  const params: unknown[] = [ownerGaii];

  if (opts?.agentGaii) {
    whereSql += ' AND agentGaii = ?';
    params.push(opts.agentGaii);
  }
  if (opts?.status) {
    whereSql += ' AND status = ?';
    params.push(opts.status);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_tasks ${whereSql}`).get(...params) as { cnt: number }).cnt;

  const rows = db.prepare(
    `SELECT * FROM agent_tasks ${whereSql} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as Record<string, unknown>[];

  return { tasks: rows.map(deserializeTask), total };
}

export function updateAgentTask(
  db: Database.Database,
  id: string,
  updates: Partial<AgentTaskRecord>,
): AgentTaskRecord | null {
  const existing = getAgentTask(db, id);
  if (!existing) return null;

  const merged: AgentTaskRecord = {
    ...existing,
    ...updates,
    id: existing.id, // id is immutable
    agentGaii: existing.agentGaii, // agentGaii is immutable
    ownerGaii: existing.ownerGaii, // ownerGaii is immutable
    createdAt: existing.createdAt, // createdAt is immutable
  };

  db.prepare(
    `UPDATE agent_tasks SET
       title = ?, description = ?, scope = ?, rules = ?, verification = ?,
       resources = ?, todos = ?, status = ?, parentTaskId = ?,
       workTrackingCode = ?, telemetry = ?, lastEventAt = ?,
       updatedAt = ?, completedAt = ?, deliverableKey = ?, rating = ?, triage = ?,
       automation = ?
     WHERE id = ?`
  ).run(
    merged.title,
    merged.description,
    JSON.stringify(merged.scope),
    JSON.stringify(merged.rules),
    JSON.stringify(merged.verification),
    merged.resources ? JSON.stringify(merged.resources) : null,
    JSON.stringify(merged.todos),
    merged.status,
    merged.parentTaskId ?? null,
    merged.workTrackingCode ?? null,
    merged.telemetry ? JSON.stringify(merged.telemetry) : null,
    merged.lastEventAt ?? null,
    merged.updatedAt,
    merged.completedAt ?? null,
    merged.deliverableKey ?? null,
    merged.rating ? JSON.stringify(merged.rating) : null,
    merged.triage ?? null,
    merged.automation ? JSON.stringify(merged.automation) : null,
    id,
  );

  return merged;
}

export function deleteAgentTask(db: Database.Database, id: string): boolean {
  // Any non-active task is deletable; an active (running) task must be cancelled
  // or paused first so we never orphan a live runner mid-execution. The status
  // guard is also a race safety-net for the route-level check.
  const result = db.prepare(
    "DELETE FROM agent_tasks WHERE id = ? AND status != 'active'"
  ).run(id);
  if (result.changes > 0) {
    db.prepare('DELETE FROM agent_task_events WHERE taskId = ?').run(id);
    return true;
  }
  return false;
}

// ── Task Events ──

export function appendTaskEvent(db: Database.Database, event: AgentTaskEventRecord): AgentTaskEventRecord {
  db.prepare(
    `INSERT INTO agent_task_events (id, taskId, type, message, details, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.taskId,
    event.type,
    event.message,
    event.details ? JSON.stringify(event.details) : null,
    event.timestamp,
  );
  return event;
}

export function listTaskEvents(
  db: Database.Database,
  taskId: string,
  opts?: { page?: number; perPage?: number },
): { events: AgentTaskEventRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  const total = (db.prepare('SELECT COUNT(*) as cnt FROM agent_task_events WHERE taskId = ?').get(taskId) as { cnt: number }).cnt;

  const rows = db.prepare(
    'SELECT * FROM agent_task_events WHERE taskId = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
  ).all(taskId, perPage, offset) as Record<string, unknown>[];

  return { events: rows.map(deserializeEvent), total };
}

// ── Aggregation ──

export function countTasksByAgent(
  db: Database.Database,
  agentGaii: string,
): { queued: number; active: number; done: number; failed: number } {
  const rows = db.prepare(
    'SELECT status, COUNT(*) as cnt FROM agent_tasks WHERE agentGaii = ? GROUP BY status'
  ).all(agentGaii) as Array<{ status: string; cnt: number }>;

  const counts = { queued: 0, active: 0, done: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = row.cnt;
    }
  }
  return counts;
}

export function countTasksByOwner(
  db: Database.Database,
  ownerGaii: string,
): Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }> {
  const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const rows = db.prepare(
    `SELECT agentGaii,
       SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status='done'   THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status='done' AND completedAt >= ? THEN 1 ELSE 0 END) AS doneToday,
       MAX(updatedAt) AS lastTaskUpdateAt,
       MAX(CASE WHEN status='failed' THEN updatedAt END) AS lastFailedAt
     FROM agent_tasks WHERE ownerGaii = ? GROUP BY agentGaii`
  ).all(dayStart, ownerGaii) as Array<Record<string, unknown>>;

  const out: Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }> = {};
  for (const r of rows) {
    out[r.agentGaii as string] = {
      queued: (r.queued as number) ?? 0,
      active: (r.active as number) ?? 0,
      done: (r.done as number) ?? 0,
      failed: (r.failed as number) ?? 0,
      doneToday: (r.doneToday as number) ?? 0,
      lastTaskUpdateAt: (r.lastTaskUpdateAt as string) ?? null,
      lastFailedAt: (r.lastFailedAt as string) ?? null,
    };
  }
  return out;
}

export function findStalledTasks(
  db: Database.Database,
  thresholdMinutes: number,
): AgentTaskRecord[] {
  const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT * FROM agent_tasks
     WHERE status = 'active'
       AND lastEventAt IS NOT NULL
       AND lastEventAt < ?`
  ).all(threshold) as Record<string, unknown>[];

  return rows.map(deserializeTask);
}
