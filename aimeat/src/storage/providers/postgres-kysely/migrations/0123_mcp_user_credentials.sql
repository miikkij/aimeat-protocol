-- 0123_mcp_user_credentials.sql
--
-- Personal sign-in on a shared MCP server (wish-henkil-kohtainen-kirjautuminen-jaettuun-mcp-palvelimeen).
--
-- WHY THIS EXISTS. A node-wide or organism server attached with OAuth held ONE credential on its
-- "McpServer" row, and every person the server admitted spent it. The far side (Atlassian, a company
-- wiki) then saw every call as one person: its own permissions did not apply and its audit named the
-- wrong human. "McpServer"."auth" = 'per-user-oauth' already named the other mode; this table holds
-- what it needs, one sealed credential per person per server.
--
-- WHY A TABLE AND NOT A MEMORY RECORD. The row holds a live OAuth token. A memory key is
-- principal-writable and readable by the person's agents and apps; a credential is read by the node's
-- MCP client code path only, ciphertext under the node key, exactly as "McpServer"."credential" is.
--
--   "status"            active | needs_reauth. One person's dead token parks that person's row and
--                       never the server, which other people are still using.
--   "refreshClaimedAt"  single-flight refresh per person, for the reason "McpServer" has one.
--
-- Mirrors applyMcpUserCredentialSchema in providers/sqlite/schema-mcp-user-credentials.ts.

CREATE TABLE IF NOT EXISTS "McpUserCredential" (
  "serverId"         TEXT NOT NULL,
  "ownerGhii"        TEXT NOT NULL,
  "credential"       TEXT NOT NULL,
  "expiresAt"        TEXT,
  "status"           TEXT NOT NULL DEFAULT 'active',
  "lastError"        TEXT,
  "refreshClaimedAt" TEXT,
  "createdAt"        TEXT NOT NULL,
  "updatedAt"        TEXT NOT NULL,
  PRIMARY KEY ("serverId", "ownerGhii")
);

CREATE INDEX IF NOT EXISTS "idx_mcp_user_credential_owner" ON "McpUserCredential" ("ownerGhii");
