-- 0055_drop_match.sql
--
-- Drop the matching engine's table. The engine is gone: it required a consent whose purpose was the
-- exact string 'matching', and that string was written nowhere in the product — no UI, no locale
-- string, no MCP tool, no documentation — so no round could ever score a profile and GET /v1/matches
-- could never return a row. It had no agent surface, no user-facing view, no E2E suite and no entry
-- in openapi.yaml, and it still rebuilt the directory index and scanned 10 000 entries every 24 h.
--
-- Nothing else reads this table: the directory keeps its own scheduler (services/directory.ts) and
-- its boot rebuild (server-bootstrap/service-init.ts), so removing the engine leaves it untouched.
-- Matchmaking between profiles is an application on this platform: the directory is readable through
-- the API, scoring is an AI call, and the result is a memory record under a key prefix.
--
-- Any rows here were unreachable by every read path, so dropping them loses nothing a person could
-- see. Removed 2026-08-29 with the developer's explicit go-ahead.

DROP TABLE IF EXISTS "Match";
