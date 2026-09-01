-- 0061_agent_v2_push_task.sql
--
-- Agent v2, V6a: a delivery target may belong to ONE task.
--
-- A2A binds a push-notification config to a task; V4 bound it to a principal, because "tell me
-- about anything addressed to me" is what an agent actually wants and A2A has no way to say it.
-- Both fit on one row: NULL is every task of that principal, which stays the default and is what
-- every existing row means, and a task id narrows it to one.
--
-- Nothing else changes. The V4 doors never set this column and never will; the A2A door does.

ALTER TABLE "AgentV2PushConfig" ADD COLUMN IF NOT EXISTS "taskId" TEXT;

-- The delivery read: everything registered for this principal, narrowed by task where the target
-- named one.
CREATE INDEX IF NOT EXISTS "AgentV2PushConfig_task_idx" ON "AgentV2PushConfig"("owner", "taskId");
