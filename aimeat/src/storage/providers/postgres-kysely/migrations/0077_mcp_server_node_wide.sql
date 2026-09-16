-- 0077_mcp_server_node_wide.sql
--
-- The operator's registry: a remote MCP server the NODE attaches once, offered to the owners on it,
-- and priced if the operator wants it priced.
--
-- WHY THE OPERATOR WANTS THIS. A licensed server — market data, a legal database, an internal
-- knowledge base — is bought per organisation, not per person. Without this every owner who wanted
-- it would need their own subscription and their own token, which is the situation this whole
-- feature exists to end. With it the operator attaches it once, decides who may reach it, and
-- charges per call through the same chokepoint that already prices app tools.
--
-- THREE COLUMNS, AND ALL THREE ARE NULL ON AN OWNER'S OWN SERVER, because none of the questions
-- applies to it: a person does not allowlist themselves and does not bill themselves.
--
--   availability  'all-owners' or 'allowlist'. Absent means the server is not node-wide at all.
--   allowlist     the owner GHIIs named, when availability is 'allowlist'. An EMPTY list means
--                 nobody but the operator, which is the safe reading: an operator who switches to
--                 allowlist and has not yet named anybody has closed the door rather than opened it.
--   price         {unit, perCall, currency?}. NULL is free to whoever availability admits. `money`
--                 is integer 6-decimal MICRO-units and `morsels` is whole morsels, and the two are
--                 never conflated — which is why the unit travels with the number rather than
--                 being inferred somewhere downstream.
--
-- Added rather than defaulted into 0076 because 0076 shipped: migrations here are append-only, and
-- a node that already ran it must reach this state by moving forward.

ALTER TABLE "McpServer" ADD COLUMN IF NOT EXISTS "availability" TEXT;
ALTER TABLE "McpServer" ADD COLUMN IF NOT EXISTS "allowlist" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "McpServer" ADD COLUMN IF NOT EXISTS "price" JSONB;

-- The operator's own listing: "what has this node attached, and who can reach it". Partial, because
-- node-wide servers are a handful beside however many every owner attaches for themselves.
CREATE INDEX IF NOT EXISTS "idx_mcp_server_node_wide"
  ON "McpServer" ("availability") WHERE "ownership" = 'node';
