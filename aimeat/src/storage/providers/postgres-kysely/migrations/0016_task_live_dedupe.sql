-- 0016_task_live_dedupe.sql
-- One live commission per (agent, fingerprint) — the server-side half of "one click, one run".
--
-- The browser SDK collapses repeat clicks within a page, but a reload or a second tab starts with an
-- empty in-flight map, so the same job could still be queued twice. Each duplicate is a real agent
-- run the owner pays for, in money and in the agent's time.
--
-- dedupeKey is the commission fingerprint (caller-supplied Idempotency-Key, or derived from
-- agent + title + description). The UNIQUE index is PARTIAL on two counts: it ignores rows without
-- a key (every pre-existing row, and every task the workflow engine creates directly through
-- storage), and it covers only OPEN statuses — a finished, failed or stalled task falls out of the
-- index, so the same work can be commissioned again tomorrow without any time-window bookkeeping.
--
-- No dedupe pass is needed before creating the index: existing rows all have dedupeKey = NULL and
-- are therefore outside it.
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ux_agent_tasks_live_dedupe"
  ON "AgentTask" ("agentGaii", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL
    AND "status" IN ('draft', 'queued', 'revision_requested', 'active', 'paused');
