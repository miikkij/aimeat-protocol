-- 0062_agent_v2_migrate_grant.sql
--
-- Agent v2, post-audit item 4: an enrolment grant says what it is FOR.
--
-- The enrolment route requires `identityVersion = 2` on every agent a card names, because the
-- basic-agents button creates them that way a moment before offering them. Migrating an EXISTING v1
-- agent is the same machinery pointed at a row that is still v1, and the route has to be told that
-- on purpose rather than inferring it — inferring would mean the create path silently accepting a
-- v1 agent whose name happened to collide.
--
-- 'create' is the default and is what every grant written before today is. Nothing re-reads old
-- rows, and nothing about the create path changes.
--
-- WHY THE FLAG AND NOT A PRE-WRITE. The alternative was marking the agents v2 first and enrolling
-- after, which leaves a half-migrated agent behind whenever the daemon fails: v2 with no key, so
-- the v2 token door refuses it and the owner has to be told to run something to undo it. With the
-- flag the whole migration is one `updateAgent` per agent, after every card has verified, so a
-- failure writes nothing and the agent is exactly what it was.

ALTER TABLE "AgentEnrolmentGrant" ADD COLUMN IF NOT EXISTS "kind" TEXT;
