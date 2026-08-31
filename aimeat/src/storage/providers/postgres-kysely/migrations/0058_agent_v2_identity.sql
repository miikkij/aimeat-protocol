-- 0058_agent_v2_identity.sql
--
-- Agent v2: the credential under the GAII changes, the GAII does not.
--
-- WHAT AN AGENT'S PROOF IS TODAY. A device-authorization round hands the agent a ninety-day JWT and
-- the connector writes it to a file. Everything follows from that one fact: a socket per agent, a
-- separate expiry per agent, a revocation dance, and a serve restart to add one agent. Measured on
-- 2026-08-31, a restart briefly cut 49 other agents on one production daemon.
--
-- WHAT IT BECOMES. The agent brings its own Ed25519 key. The node pins it the first time it sees it
-- (the same TOFU the ecosystem-app path has used since June, one principal class over), stores the
-- agent's own JWS-signed card beside it, and mints a short-lived token per use against a signed
-- assertion. Nothing long-lived on disk.
--
-- FIVE COLUMNS, NOT A SECOND TABLE. Every one of them is a property of the agent and is read on the
-- same row every other agent read already loads. A parallel table would mean a join on the hottest
-- identity read on the node to answer "which kind of credential is this".
--
--   runMode          how the agent is meant to be RUN. 'spawn' = data here until work arrives, the
--                    runtime starts a worker and it unwinds; 'resident' = keep it up. The node
--                    STORES and SHOWS this and never enforces it — the runtime is the only party
--                    that can honour it, which is the rule maxConcurrentTasks already follows.
--                    NULL means nobody has said, which is not the same as 'spawn'.
--   identityVersion  1/NULL = the device-auth agent above; 2 = key + card + short-lived tokens. The
--                    v1 path never reads it, and every v2 door refuses a row that is not 2. That is
--                    what lets both paths run side by side until the last agent has moved.
--   cardJws          the agent's card, compact JWS, signed by the agent's own key. Held verbatim so
--                    what is served at /v1/agents/:name/card is the exact bytes that were verified,
--                    not a re-serialisation of a parse of them.
--   cardIssuedAt     the card's own issued-at claim, projected out so the fleet view can show which
--                    cards are stale without parsing every JWS.
--   enrolledAt       when the key was pinned. NULL for every agent that has never enrolled, which
--                    on the day this ships is all of them.
--
-- NULL FOR EVERY EXISTING ROW, and that is the correct reading: no agent alive today has a card.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "runMode" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "identityVersion" INTEGER;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "cardJws" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "cardIssuedAt" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "enrolledAt" TEXT;

-- The single-use permission ONE button press produces.
--
-- The press is the human approval in this flow — there is no second consent screen, because the
-- person is already looking at the one surface that can create these agents and they are their own.
-- So the grant has to carry every fence the missing screen would have: it names the owner, it names
-- the exact agents, it expires in minutes, and it is spent once.
--
-- `usedAt` is the whole reason this is a row and not an in-memory map. Two daemons for one owner
-- (two machines, or one restarting) can both receive the enrolment offer, and the conditional update
-- on `usedAt IS NULL` is what makes exactly one of them win. An in-process map would also lose the
-- grant on a node restart mid-flow, which is a stuck button with no way to say why.

CREATE TABLE IF NOT EXISTS "AgentEnrolmentGrant" (
  "id"         TEXT NOT NULL,
  -- Bare owner name. Every check in the enrolment path compares against THIS, never the request.
  "owner"      TEXT NOT NULL,
  -- The exact agent names this grant covers. A card for anything else is refused.
  "agents"     TEXT[] NOT NULL DEFAULT '{}',
  -- The principal that pressed the button.
  "createdBy"  TEXT NOT NULL,
  "createdAt"  TEXT NOT NULL,
  "expiresAt"  TEXT NOT NULL,
  -- Set the moment the grant is spent; a second submit finds it here and is refused.
  "usedAt"     TEXT,
  -- The daemon principal (GAII) that spent it. "Who asked" and "who carried it out" are different
  -- questions and here the second one is a machine.
  "usedBy"     TEXT,
  CONSTRAINT "AgentEnrolmentGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentEnrolmentGrant_owner_idx" ON "AgentEnrolmentGrant"("owner");
-- The sweep. Grants are short-lived and numerous over time; nothing else orders by expiry.
CREATE INDEX IF NOT EXISTS "AgentEnrolmentGrant_expires_idx" ON "AgentEnrolmentGrant"("expiresAt");
