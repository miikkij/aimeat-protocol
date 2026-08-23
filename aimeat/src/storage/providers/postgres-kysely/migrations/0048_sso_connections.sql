-- 0048_sso_connections.sql — one organisation's identity provider on this node (BR-04).
--
-- A connection carries the SAML half (how the organisation's people sign in) and the SCIM half
-- (how its directory pushes them in and out). A TABLE rather than a memory record because it holds
-- server-trusted secrets — the SCIM token hash and the IdP's signing certificates — that no
-- principal-writable namespace may carry, and because two unauthenticated hot paths read it: the
-- ACS resolving which certificates verify a Response, and the SCIM door resolving a bearer hash.
--
-- "id" is a slug (validated ^[a-z][a-z0-9-]{1,30}$ at creation): it is a URL segment AND the key
-- inside GHII externalIdentities JSON, where SQLite would read a dot as a path expression.

CREATE TABLE IF NOT EXISTS "SsoConnection" (
  "id"                 text NOT NULL,
  "name"               text NOT NULL,
  "organismId"         text,
  "domains"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "saml"               jsonb,
  "allowIdpInitiated"  boolean NOT NULL DEFAULT false,
  "loginVisibility"    text NOT NULL DEFAULT 'listed',
  "scimTokenHash"      text,
  "scimTokenCreatedAt" timestamptz,
  "lastScimRequestAt"  timestamptz,
  "lastLoginAt"        timestamptz,
  "createdBy"          text NOT NULL,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- The SCIM door's auth read: presented bearer -> SHA-256 -> this index. Unique, because one token
-- resolving to two connections would make "which organisation is calling" a coin toss.
CREATE UNIQUE INDEX IF NOT EXISTS "SsoConnection_scimTokenHash_key"
  ON "SsoConnection" ("scimTokenHash") WHERE "scimTokenHash" IS NOT NULL;
