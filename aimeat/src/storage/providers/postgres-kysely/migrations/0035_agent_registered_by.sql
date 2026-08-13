-- 0035_agent_registered_by.sql
--
-- Who asked for this agent.
--
-- The node has always recorded it — `approvedBy` on the device-authorization record — and always
-- thrown it away, because those records are swept when they expire. So half an hour after an agent
-- appears, nothing on the node can say whether a person approved it or a sibling did, and an owner
-- looking at forty agents has no way to find out where they came from.
--
-- It also fences agent-initiated deletion. A concierge in a fleet runtime must be able to end the
-- agents it created when its container is deprovisioned, and must not be able to end the ones it did
-- not: same owner is not a narrow enough test, or every agent an owner has could kill every sibling
-- it has never seen. The entry is written once, at creation, and never rewritten — re-approval is an
-- ordinary event and must not hand the right to delete an agent to whoever reconnected it last.
--
-- The value is the owner's bare name (a person approved) or the approving agent's GAII (a sibling
-- did). Null on every agent that existed before this column.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "registeredBy" TEXT;
