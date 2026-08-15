-- 0037_task_created_by.sql
--
-- Who ordered this task.
--
-- The node knew it at write time on every door and stored it nowhere. That was harmless while a
-- task was something an owner gave their own agent, and stopped being harmless the moment one agent
-- started commissioning another: `aimeat_task_get` authorises against `agentGaii`, which is the
-- RECEIVER, so the party that placed a commission could not read it back.
--
-- The cost showed up on 2026-08-15. A chat ordered a build from a fleet concierge, the build
-- produced nothing and said nothing, and the only record of the attempt was invisible to the one
-- party waiting on it. A published guide's "watch the task until it completes" step was
-- unexecutable by anyone, and the failure could not be diagnosed from either side.
--
-- Null on every task that predates this column, which is why the read rule treats an absent value
-- as "not yours" rather than as a match.

ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
