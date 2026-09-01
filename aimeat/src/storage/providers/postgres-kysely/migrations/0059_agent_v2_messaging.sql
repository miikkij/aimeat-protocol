-- 0059_agent_v2_messaging.sql
--
-- Agent v2, V4: a turn between two principals, and somewhere to reach a principal that is absent.
--
-- THIS NODE ALREADY HAS FIVE MESSAGE KINDS AND NONE OF THEM IS THIS ONE. Agent messages are an
-- agent and its own owner in a dashboard thread. Direct messages are a person and another person,
-- across nodes, behind a consent gate. Notifications are one-directional and self-targeted. Web
-- push is a transport for those. Boards are posted once and read by many. What is missing is a turn
-- between two PRINCIPALS about one piece of work, carrying text and a file and a structured payload
-- together, grouped by what it is about rather than by who is in the room. Every one of the five
-- stays exactly as it is; nothing here touches them.
--
-- THE SHAPE IS A2A's, DELIBERATELY. role + parts + messageId + contextId + taskId is the A2A
-- message, and AgentV2PushConfig is its PushNotificationConfig field for field. V6a projects this
-- outward, and a near-miss of our own would mean a translation layer at the border and a permanent
-- argument about which side is right.

CREATE TABLE IF NOT EXISTS "AgentV2Message" (
  "messageId"     TEXT NOT NULL,
  -- 'user' is whoever is asking, 'agent' is whoever is answering. NOT a principal type: an agent
  -- asking another agent sends 'user', and that is the correct reading of the turn.
  "role"          TEXT NOT NULL,
  -- Ordered list of MessagePart. A file part holds a URI, never bytes: the record stays small and
  -- the file keeps one home.
  "parts"         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- What the exchange is about. The only thing needed to read it back.
  "contextId"     TEXT NOT NULL,
  -- Null until V5 gives a turn a task.
  "taskId"        TEXT,
  "fromPrincipal" TEXT NOT NULL,
  "toPrincipal"   TEXT NOT NULL,
  -- Bare owner name. Every read is fenced on THIS.
  "owner"         TEXT NOT NULL,
  "createdAt"     TEXT NOT NULL,
  "metadata"      JSONB,
  CONSTRAINT "AgentV2Message_pkey" PRIMARY KEY ("messageId")
);

-- The read that happens on every catch-up: one owner's one exchange, oldest first.
CREATE INDEX IF NOT EXISTS "AgentV2Message_owner_context_idx" ON "AgentV2Message"("owner", "contextId", "createdAt");
-- "what arrived for me while I was gone", which is the other read this table exists for.
CREATE INDEX IF NOT EXISTS "AgentV2Message_owner_to_idx" ON "AgentV2Message"("owner", "toPrincipal", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentV2Message_task_idx" ON "AgentV2Message"("taskId");

-- Where to reach a principal that is not connected.
--
-- "authCredentials" IS WRITE-ONLY. It is a secret this node sends OUTWARD on the owner's behalf. No
-- read returns it: a read answers with the schemes, so a person can see what is configured, and the
-- secret leaves only in an Authorization header to the URL that was registered for it. "token" is
-- different and IS returned, because it is the receiver's own string echoed back to it.
CREATE TABLE IF NOT EXISTS "AgentV2PushConfig" (
  "id"              TEXT NOT NULL,
  -- The principal these deliveries are FOR.
  "principal"       TEXT NOT NULL,
  -- Bare owner name. The fence on every read, write and delete.
  "owner"           TEXT NOT NULL,
  -- http(s) only, and every delivery goes through safeFetch.
  "url"             TEXT NOT NULL,
  "token"           TEXT,
  "authSchemes"     TEXT[] NOT NULL DEFAULT '{}',
  "authCredentials" TEXT,
  "createdAt"       TEXT NOT NULL,
  "updatedAt"       TEXT NOT NULL,
  "lastSuccessAt"   TEXT,
  "lastFailureAt"   TEXT,
  -- Consecutive failures. Reset by a success, and by re-registering.
  "failCount"       INTEGER NOT NULL DEFAULT 0,
  -- Set when the node stopped trying. A person re-registers to clear it.
  "disabledAt"      TEXT,
  CONSTRAINT "AgentV2PushConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentV2PushConfig_owner_principal_idx" ON "AgentV2PushConfig"("owner", "principal");
