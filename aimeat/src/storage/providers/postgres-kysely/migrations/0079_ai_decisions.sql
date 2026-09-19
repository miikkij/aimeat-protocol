-- 0079_ai_decisions.sql
-- AI decision rows (TARGET-080, AIMEAT.decide). A sibling of "AiProvenance": provenance records
-- what AI MADE, a decision row records what AI DECIDED. One row per call to the decision model,
-- not one per question.
--
-- "record" (jsonb) holds the aimeat.decision/v1 document. The columns beside it are AIMEAT's own
-- authorization and lookup metadata: "ownerGhii" decides who may read the row, "cacheKey" finds an
-- earlier identical call, "subject" lists the decisions about one thing.
--
-- Unlike provenance, rows AGE OUT (deleteAiDecisionsBefore), and after the write only
-- "record"->'review' changes. Mirrors the SQLite table ai_decisions in schema-tables-3.ts.
CREATE TABLE IF NOT EXISTS "AiDecision" (
    "id"        TEXT NOT NULL,
    "ownerGhii" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "appId"     TEXT,
    "subject"   TEXT,
    "cacheKey"  TEXT NOT NULL,
    "model"     TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "record"    JSONB NOT NULL,

    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_createdAt_idx" ON "AiDecision"("ownerGhii", "createdAt");
CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_cacheKey_createdAt_idx" ON "AiDecision"("ownerGhii", "cacheKey", "createdAt");
CREATE INDEX IF NOT EXISTS "AiDecision_ownerGhii_subject_createdAt_idx" ON "AiDecision"("ownerGhii", "subject", "createdAt");
-- The nightly retention prune deletes across all owners by age.
CREATE INDEX IF NOT EXISTS "AiDecision_createdAt_idx" ON "AiDecision"("createdAt");
