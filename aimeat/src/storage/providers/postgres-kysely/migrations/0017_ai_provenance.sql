-- 0017_ai_provenance.sql
-- AI provenance records (TARGET-058, EU AI Act Article 50 transparency).
--
-- TWO LAYERS, DELIBERATELY. The Code of Practice asks for an in-band mark AND an out-of-band one,
-- and picking only one is the expensive mistake:
--   * ADDRESSABLE — the "AiProvenance" table below. A third party can ask about content they hold
--     without us having given them an identifier, because the join key is the CONTENT HASH.
--   * ATTACHED    — "Memory"."aiProvenanceId". The statement travels with the item, so stripping
--     the served document does not strip the provenance.
--
-- APPEND-ONLY. A provenance record is an attributable statement about a specific set of bytes.
-- Correcting one means minting a NEW record about the NEW bytes, never editing the old statement.
-- There is no UPDATE or DELETE path in the repository, by design.
--
-- "record" (jsonb) holds the canonical aimeat.provenance/v1 document and is the single source of
-- truth for every field of the spec. The columns beside it are AIMEAT's own authorization and
-- lookup metadata and are NOT part of the spec: "ownerGhii" decides who may resolve a private
-- record, "visibility" decides whether an anonymous reader may, and "contentHash" is projected out
-- of the document on write so the two cannot disagree.
--
-- "contentHash" is deliberately NOT unique. The same bytes can honestly be generated twice, and the
-- second statement does not invalidate the first — the hash lookup returns a LIST.
CREATE TABLE IF NOT EXISTS "AiProvenance" (
    "id"          TEXT NOT NULL,
    "ownerGhii"   TEXT NOT NULL,
    "principal"   TEXT NOT NULL,
    "contentHash" TEXT,
    "visibility"  TEXT NOT NULL DEFAULT 'private',
    "generatedAt" TEXT NOT NULL,
    "createdAt"   TEXT NOT NULL,
    "record"      JSONB NOT NULL,

    CONSTRAINT "AiProvenance_pkey" PRIMARY KEY ("id")
);

-- The detection lookup ("did this node produce these exact bytes?") is hash-keyed, public and
-- unauthenticated, so it is the one query that must stay index-backed under anonymous traffic.
CREATE INDEX IF NOT EXISTS "AiProvenance_contentHash_idx" ON "AiProvenance"("contentHash");
CREATE INDEX IF NOT EXISTS "AiProvenance_ownerGhii_generatedAt_idx" ON "AiProvenance"("ownerGhii", "generatedAt");

-- The attached half. NULL = UNSTATED, which is not the same as "a human wrote it".
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;

-- The other direction of the join: which provenance record a metered LLM call produced, so
-- "what did this money buy?" is one join rather than a guess. Cost stays OUT of the provenance
-- record (it is this table's job) and prompt text stays out of both.
ALTER TABLE "AgentUsageEvent" ADD COLUMN IF NOT EXISTS "provenanceId" TEXT;
