-- 0010_agent_model.sql — AppDev KB Phase 3: model attribution on agents.
-- The primary LLM model driving the agent (self-reported via identify_platform;
-- indicative, not audited — coding platforms delegate to subagents on other models).
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "modelDetectedBy" TEXT;
