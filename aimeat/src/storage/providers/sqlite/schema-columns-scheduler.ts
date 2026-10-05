/**
 * @file sqlite/schema-columns-scheduler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduler's added columns for existing SQLite databases: scheduled_jobs,
 *   execution_log.taskId and agents.scheduleConstraintDefaults. Called by initializeSchema at the
 *   point where these ALTERs always ran.
 * @version-history
 *   v1.0.0 — 2026-10-04 — Moved out of schema.ts unchanged (max-file-lines), plus
 *     scheduled_jobs.lastFireAt: the last cron fire a node process claimed (claimScheduledFire,
 *     mirrors Postgres migration 0093).
 *   v1.1.0 — 2026-10-05 — scheduled_jobs.createdByApp: the app grant that made a schedule (mirrors
 *     Postgres migration 0094; secaudit 2026-10, AI-2).
 */

/** The ALTER helper initializeSchema owns: adds a column, and treats "duplicate column" as done. */
export type SafeAddColumn = (table: string, column: string, type: string) => void;

export function applySchedulerColumns(safeAddColumn: SafeAddColumn): void {
  // Agent Scheduler — recurring schedules (ai/agent_task kinds), owner scoping,
  // budget constraints, timezone. All additive/nullable; existing core/extension
  // rows read back unchanged.
  safeAddColumn('scheduled_jobs', 'ownerScope', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentGaii', 'TEXT');
  safeAddColumn('scheduled_jobs', 'createdByAgent', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('scheduled_jobs', 'displayName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'description', 'TEXT');
  safeAddColumn('scheduled_jobs', 'purpose', 'TEXT');
  safeAddColumn('scheduled_jobs', 'timezone', 'TEXT');
  safeAddColumn('scheduled_jobs', 'constraints', 'TEXT');
  safeAddColumn('scheduled_jobs', 'runCount', 'INTEGER NOT NULL DEFAULT 0');
  // The app grant that made a schedule (Postgres migration 0094; secaudit 2026-10, AI-2).
  safeAddColumn('scheduled_jobs', 'createdByApp', 'TEXT');
  safeAddColumn('execution_log', 'taskId', 'TEXT');
  safeAddColumn('agents', 'scheduleConstraintDefaults', 'TEXT');
  // The last cron fire a node process claimed (claimScheduledFire); mirrors postgres 0093. Only the
  // scheduler writes it, so two processes on one database file run each fire once.
  safeAddColumn('scheduled_jobs', 'lastFireAt', 'TEXT');
}
