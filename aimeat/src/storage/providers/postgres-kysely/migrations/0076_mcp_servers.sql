-- 0076_mcp_servers.sql
--
-- Remote MCP servers: an MCP server SOMEWHERE ELSE that this node connects out to, holds the
-- credential for, and hands back to whoever the owner allows.
--
-- WHY THIS EXISTS. The node has been an MCP server only — every SDK import in src/ was
-- sdk/server/*. So a person who uses AIMEAT and also uses four other MCP servers had to configure
-- all of them separately in every AI client they own, with a copy of every credential in each, and
-- nothing they attached could be reached by their agents, their apps, their crews or the node's own
-- chat. This table is the client half.
--
-- WHY NOT A ROW IN "Connection". That table (TARGET-057) holds an outbound ACCOUNT at a provider
-- from a CLOSED registry: eleven hand-written recipes, each with its own resource allowlist,
-- because a provider cannot describe itself. An MCP server is the opposite shape — an arbitrary
-- endpoint that describes its own tools over the protocol, and the node learns them by asking. A
-- registry key cannot hold that. The word matters too: "connection" already means the other thing
-- in three scope words and a settings panel, and one term must mean one thing.
--
-- WHAT IS BORROWED FROM "Connection" ON PURPOSE: the credential is ciphertext in the same format
-- from the same sealer, the refresh is the same single-flight claim, and the OAuth client may be
-- the node's or one the owner brought. Those problems were solved once.
--
-- THREE FIELDS CARRY THE CONFIGURABILITY, and collapsing any two of them produces a model that
-- cannot express a real case:
--   ownership       whose server it is: one owner's, the whole node's, or an organism's.
--   callerIdentity  whose CREDENTIAL is spent when an agent or app calls through. Separate from
--                   "auth" because "the node holds one token, everyone spends it" and "each person
--                   authorises separately" differ in who the far side bills and audits.
--   exposure        gateway (three fixed tools, tool list never grows) or flatten (every allowed
--                   tool listed with its real schema). Per server, because this node already
--                   publishes about 340 tools and the answer depends on how much it is used.
--
-- THE URL LIVES HERE AND IN NO RESPONSE. "transport" holds the endpoint, and PublicMcpServer omits
-- it for the same reason it omits the credential: a caller that learns the endpoint can call it
-- directly and leave every gate in this system behind. A caller names the slug; the node builds
-- the request.
--
--   slug             the handle a caller names INSTEAD OF A URL, and the prefix on a flattened
--                    tool (jira__create_issue). Immutable after attach: renaming it would silently
--                    break every grant that names it.
--   ownerGhii        NULL when ownership = 'node'. An operator's server belongs to nobody, which is
--                    what keeps it out of any one account's billing and out of its deletion cascade.
--   toolCache        the tool list as the far side described it. Cached rather than asked per call:
--                    an AI client asks us for every tool it can use on every session, and reaching
--                    eight remote servers first would make our own tools/list as slow as the
--                    slowest thing anyone attached.
--   refreshClaimedAt single-flight refresh, for the same reason Connection has one: several servers
--                    invalidate the old refresh token when they issue a new one, so two concurrent
--                    calls leave one working token and one server wrongly parked in needs_reauth —
--                    a failure caused entirely by our own concurrency.

CREATE TABLE IF NOT EXISTS "McpServer" (
  "id"               TEXT PRIMARY KEY,
  "slug"             TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "description"      TEXT NOT NULL DEFAULT '',
  "ownership"        TEXT NOT NULL DEFAULT 'owner',
  "ownerGhii"        TEXT,
  "organismId"       TEXT,
  "ws"               TEXT,
  "createdBy"        TEXT NOT NULL,
  "transport"        JSONB NOT NULL,
  "auth"             TEXT NOT NULL DEFAULT 'none',
  "credential"       TEXT,
  "credentialShape"  TEXT,
  -- NULL is a legitimate value, not a missing one: plenty of tokens never expire. Code that reads
  -- NULL as "expired" parks a working server.
  "expiresAt"        TEXT,
  "providerClientId" TEXT,
  "callerIdentity"   TEXT NOT NULL DEFAULT 'node-credential',
  "exposure"         TEXT NOT NULL DEFAULT 'gateway',
  "toolCache"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "toolCacheHash"    TEXT NOT NULL DEFAULT '',
  "lastListedAt"     TEXT,
  "directory"        JSONB NOT NULL DEFAULT '{"listed":false,"visibility":"private","tags":[]}'::jsonb,
  "enabled"          BOOLEAN NOT NULL DEFAULT TRUE,
  "status"           TEXT NOT NULL DEFAULT 'active',
  "lastOkAt"         TEXT,
  "lastError"        TEXT,
  "refreshClaimedAt" TEXT,
  "createdAt"        TEXT NOT NULL,
  "updatedAt"        TEXT NOT NULL
);

-- COALESCE, not the bare columns: NULL never equals NULL in a unique index, so without it an
-- operator could attach two node-wide servers called 'jira' and no lookup could say which one a
-- caller meant.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_server_slug"
  ON "McpServer" ("slug", "ownership", COALESCE("ownerGhii", ''), COALESCE("organismId", ''));

CREATE INDEX IF NOT EXISTS "idx_mcp_server_owner" ON "McpServer" ("ownerGhii", "status");
CREATE INDEX IF NOT EXISTS "idx_mcp_server_organism" ON "McpServer" ("organismId", "ws");
