-- 0034_agent_console_url.sql
--
-- Where an agent is managed by whatever HOSTS it.
--
-- An agent created from a chat runs somewhere the node has never heard of: an agent hatchery
-- instance, a CrewAI cockpit, a self-hosted daemon. The node knows the agent exists, what it may do
-- and whether it has been seen lately, and it has no way to send the person to the place where the
-- thing actually lives. So the person is told their agent is running and has nowhere to go and look
-- at it.
--
-- The node cannot derive this address and must not guess it. The host reports it once: the owner,
-- or a same-owner sibling such as the concierge agent that created this one, writes it through
-- PATCH /v1/agents/:name/console-url. Display only — the node links it and never fetches it, and
-- the http(s) check lives where it is written (services/agent-profile-write.ts).

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "consoleUrl" TEXT;
