-- 0096_storage_file_provenance.sql
--
-- The AI-provenance record of a stored file's bytes. A speech clip, a generated picture, a data
-- package descriptor or an uploaded file an agent declared can now name its record, and a PUBLIC
-- file makes that record publicly resolvable, as a public memory row, a served app or a post on a
-- public board does (methods/ai-provenance.ts publiclyLinked). The partial index serves that EXISTS.
--
-- NULL = no record: a file written before this column existed, or one nobody declared and no node
-- path minted for. Existing rows stay NULL; nothing here guesses a record for bytes it did not see.
--
-- Mirrors the SQLite column added in sqlite/schema.ts.
ALTER TABLE "StorageFile" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;
CREATE INDEX IF NOT EXISTS "StorageFile_aiProvenanceId_idx"
  ON "StorageFile"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;
