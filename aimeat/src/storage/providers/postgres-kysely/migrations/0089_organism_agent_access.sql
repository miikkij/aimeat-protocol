-- 0089_organism_agent_access.sql
--
-- Which of its members' agents an organism admits.
--
-- A member's agents inherit the member's access: every agent of every member can read and write
-- where its owner can. An organism that brings in outside people (a customer's area) needs to say
-- "only these agents", because an owner with 29 agents otherwise brings all 29 into a customer's
-- space, and the member list shows every one of them to the customer.
--
--   agentAccess — NULL or 'all': every member's agents act with their owner's rights (the behaviour
--                 before this column). 'listed': only the agents on agentGaiis do; any other agent
--                 is treated as a non-member (services/organism-agent-access.ts).
--
-- No backfill: NULL reads as 'all', so every existing organism keeps the behaviour it had.

ALTER TABLE "Organism" ADD COLUMN IF NOT EXISTS "agentAccess" TEXT;
