-- 0018_ai_provenance_visibility.sql
-- TARGET-058 Phase 2: provenance visibility FOLLOWS THE CONTENT.
--
-- 0017 gave the record its own "visibility" column. That was a second visibility concept living
-- beside the platform's real one, and it could only ever be right by being kept in sync — which is
-- to say it would eventually be wrong. Worse, it was settable by the caller declaring the record,
-- which is a way to publish a statement about content nobody is allowed to read.
--
-- The rule is now: a provenance record is resolvable by anyone exactly when some item pointing at
-- it is itself publicly readable, and it stops being resolvable the moment that item stops being
-- public. Publishing content publishes its provenance; unpublishing takes it back to the identical
-- 404, with nothing to remember to do. The link direction is item -> record, so the two indexes
-- below are what keep that question cheap on the anonymous detection path.
ALTER TABLE "AiProvenance" DROP COLUMN IF EXISTS "visibility";

-- The ATTACHED half for apps, mirroring "Memory"."aiProvenanceId" from 0017. An app published by an
-- agent that declared nothing is stamped by the node (Mint-3); NULL = UNSTATED, which is not the
-- same as "a human wrote it".
ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;

-- Both directions of the derivation query. Without these, resolving a record means a sequential
-- scan of every memory row on an endpoint that answers anonymous callers.
CREATE INDEX IF NOT EXISTS "Memory_aiProvenanceId_idx" ON "Memory"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "App_aiProvenanceId_idx" ON "App"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;
