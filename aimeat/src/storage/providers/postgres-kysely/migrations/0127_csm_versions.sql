-- 0127_csm_versions.sql
-- A CSM (Community Service Manifest) has a visibility and a version (developer ruling 2026-11-07).
--
-- "visibility" says who reads the CSM on GET /v1/csm: 'public' (anyone), 'members' (any account of
-- this node), 'organism:<id>' (that organism's members) or 'private' (the registering account and its
-- agents and apps). Every row stored before this file reads as 'public', which is what it answered.
-- "version" is 1 at create and one up on every PUT /v1/csm/{name}; every existing row is version 1.
--
-- "CsmVersion" keeps each version a PUT replaced: the definition, the JSON Schema it compiled to, the
-- registering account and when it came into force. The current version stays on "Csm". Deleting a CSM
-- deletes its kept versions in the same call (methods/catalogue.ts deleteCsm). "registeredBy" is the
-- bare account name "Csm" already holds; a CSM is node-global, not part of the owner cascade.
-- Mirrors applyCsmVersionSchema in providers/sqlite/schema-csm-versions.ts. This file only adds.

ALTER TABLE "Csm" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "Csm" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "CsmVersion" (
  "name"         TEXT NOT NULL,
  "version"      INTEGER NOT NULL,
  "definition"   JSONB NOT NULL,
  "jsonSchema"   JSONB NOT NULL,
  "registeredBy" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("name", "version")
);
