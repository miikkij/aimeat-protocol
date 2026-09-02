-- 0063_agent_mcp_session.sql
--
-- Which AI tool an agent last spoke from over MCP, and when.
--
-- THE MCP PAGE LISTED TOOLS, NOT AGENTS. A connection row was one per tool (mcp-claude, mcp-grok),
-- upserted on every session, and its agent was whichever agent opened that tool's FIRST session:
-- on aimeat.io the Claude row named claude-home-mcp, an agent deleted months ago, while the agent
-- actually used every day (claude-desktop-home-mcp) had a lastSeen of 29.7. because the MCP door
-- never touched it. Nothing recorded, per agent, that it had ever opened an MCP session.
--
-- TWO COLUMNS ON THE AGENT, NOT A SECOND TABLE. They are properties of the agent and are read on
-- the same row every agent list already loads. Both are written together by the MCP door when a
-- session opens (services/agent-mcp-touch.ts, throttled like the REST lastSeen touch), and never by
-- anything else, so `mcpLastSeen IS NOT NULL` means exactly "this agent has spoken over MCP".
--
--   mcpClient    the tool as the MCP door names it from the client's registered name:
--                'claude', 'claude-code', 'claude-desktop', 'chatgpt', 'cursor', … or the raw
--                client name when none of those match, or 'unknown' when the client sent none.
--   mcpLastSeen  when the last MCP session opened or last spoke (ISO, TEXT like enrolledAt).
--
-- NULL FOR EVERY EXISTING ROW, and that is the correct reading: the node has not seen them over
-- MCP since this shipped. The MCP page shows the per-tool rows for those until the agent connects
-- again and earns its own row.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "mcpClient" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "mcpLastSeen" TEXT;
