-- 0060_agent_v2_tasks.sql
--
-- Agent v2, V5: the handle a caller holds while work runs.
--
-- THE NODE ALREADY HAS TASKS AND THEY STAY. "AgentTask" is the owner's dashboard work item: a
-- title, todos, an approval flow, an SLA, a rating, and a whole profile tab built on it. Nothing
-- here touches it. What it cannot be is the other thing — the handle a caller holds while a long
-- tool call runs, polls until it settles, and cancels if it changes its mind. That handle has a
-- shape now (MCP's task augmentation), a second protocol reads it (A2A Task), and both arrive at
-- this node's door in V6.
--
-- THE STATUS IS THE MCP WORD, ALWAYS. MCP says working / input_required / completed / failed /
-- cancelled; A2A says working / input-required / completed / failed / canceled. One hyphen and one
-- L apart, which is precisely the kind of difference that produces a silent mismatch at a border.
-- So one vocabulary is stored and the other is DERIVED by one function, and no caller ever writes
-- an A2A state. A2A's four extra states map in: submitted → working with startedAt still null,
-- rejected → failed with error.code REJECTED, auth-required → input_required with error.code
-- AUTH_REQUIRED, and unknown is never stored because a task this node holds is in a state it knows.

CREATE TABLE IF NOT EXISTS "AgentV2Task" (
  "taskId"         TEXT NOT NULL,
  -- One of the five MCP statuses. Three of them are terminal, and a terminal task never moves
  -- again — that is what lets a caller stop polling on the first settled read it sees.
  "status"         TEXT NOT NULL,
  "statusMessage"  TEXT,
  -- The exchange this work belongs to. A v2 message carrying the same contextId is part of the same
  -- conversation, which is how the turns and the work stay one thing rather than two.
  "contextId"      TEXT NOT NULL,
  -- Bare owner name. Both principals sit under it, and every read is fenced on it.
  "owner"          TEXT NOT NULL,
  "createdBy"      TEXT NOT NULL,
  "assignedTo"     TEXT NOT NULL,
  -- What was asked and what came back, as message parts: the same shape a turn carries, so a task
  -- and the conversation around it speak one language.
  "input"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "result"         JSONB,
  "error"          JSONB,
  "createdAt"      TEXT NOT NULL,
  "lastUpdatedAt"  TEXT NOT NULL,
  -- When somebody picked it up. NULL while nobody has, which is the distinction A2A calls
  -- `submitted` and MCP has no status for.
  "startedAt"      TEXT,
  "completedAt"    TEXT,
  -- MCP's own two advisory fields. This node reports them and enforces neither: it does not delete
  -- on the TTL, it says when a client should stop expecting an answer.
  "ttlMs"          INTEGER,
  "pollIntervalMs" INTEGER,
  "metadata"       JSONB,
  CONSTRAINT "AgentV2Task_pkey" PRIMARY KEY ("taskId")
);

-- The roster read a worker does on a timer: what is assigned to me and still open.
CREATE INDEX IF NOT EXISTS "AgentV2Task_owner_assigned_idx" ON "AgentV2Task"("owner", "assignedTo", "status");
-- The caller's own view of what it asked for.
CREATE INDEX IF NOT EXISTS "AgentV2Task_owner_creator_idx" ON "AgentV2Task"("owner", "createdBy", "createdAt");
-- The work belonging to one conversation.
CREATE INDEX IF NOT EXISTS "AgentV2Task_context_idx" ON "AgentV2Task"("contextId");
