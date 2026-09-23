-- 0081_ai_decision_providers.sql
-- A decision learns which DECISION PROVIDER answered it (services/decide/providers.ts). Until
-- 2026-09-23 there was one, TypeSafe's Jev; since then a provider is a record, and a local model on
-- the owner's machine is one of them.
--
-- "provider" is the provider's id and "providerKind" is 'hosted' or 'local'. Columns rather than
-- document fields, because the quality numbers group by provider in SQL. Rows written before this
-- migration have neither; the reader falls back to the document's `provider` ('typesafe') and to
-- 'hosted', which is what every one of them was. Mirrors the SQLite columns added in schema.ts.
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "provider"     TEXT;
ALTER TABLE "AiDecision" ADD COLUMN IF NOT EXISTS "providerKind" TEXT;

CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_provider_createdAt_idx" ON "AiDecision"("ownerGhii", "provider", "createdAt");
