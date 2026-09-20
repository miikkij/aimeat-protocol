-- 0080_ai_decision_rules.sql
-- A decision learns the rule that made it. A DECISION RULE is an owner's named set of questions,
-- thresholds and bands (memory record decide.rules.<id>); running one produces a decision row.
--
-- "rule" and "ruleVersion" say which definition ran (the version is bumped on every question
-- change, so a tuned rule's old and new decisions can be told apart). "outcome" is what the rule's
-- bands made of the answers: act, ask or stop. "keyScope" says whose key paid: the agent's own, the
-- owner's own, or the node's. It is a column as well as a field of "record", because the quality
-- view counts by it; rows written before this migration keep it in the document only, and the
-- reader falls back to that.
--
-- Columns rather than document fields, because the quality view (decisions, gate stops, overrides,
-- cost, per rule and per agent) is counted in SQL. Mirrors the SQLite columns added in schema.ts.
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "rule"        TEXT;
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "ruleVersion" INTEGER;
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "outcome"     TEXT;
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "keyScope"    TEXT;

CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_rule_createdAt_idx" ON "AiDecision"("ownerGhii", "rule", "createdAt");
CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_principal_createdAt_idx" ON "AiDecision"("ownerGhii", "principal", "createdAt");
