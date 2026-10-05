-- 0095_company_description_provenance.sql
--
-- The AI-provenance record of a company's current description. The description is the sentence the
-- front page and the company tools show, and an agent can write it, so a reader can ask how it was
-- made, as for a board post or a memory record. Set by services/company/company-service.ts through
-- provenanceForWrite; NULL = no description, a description the owner wrote in person, or one written
-- before this column existed.
--
-- Mirrors the SQLite column added in sqlite/schema.ts.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "descriptionProvenanceId" TEXT;
