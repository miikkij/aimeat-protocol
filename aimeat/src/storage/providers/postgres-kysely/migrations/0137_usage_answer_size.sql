-- 0137_usage_answer_size.sql
-- The size of a call's answer (2026-11-24). Mirrors SQLite schema-tables-4.ts and schema.ts.
--
-- An MCP tool answer that grows with the caller's data passes the limit a client accepts, and the
-- node had no record of it: a tool's answer was measured for its duration and its outcome, not its
-- size. "answerChars" is the characters of text one call answered with (0 where the code path does
-- not measure it). The rollup keeps its sum, its maximum and the count of answers over the tool
-- answer budget (src/models/answer-budget.ts), per tool and day, so the usage report names the tool
-- whose answers grow before a client refuses one.
--
-- Columns and not a "meta" key: the rollup aggregates them (0036: anything the rollup aggregates
-- gets a column). NOT NULL with a constant default is a catalog change in PostgreSQL 11 and later,
-- so it does not rewrite the tables, whatever their size.
--
-- It goes stale with the rows it sits on: the archive sweep moves and prunes the calls, and the
-- hour-grain rollups are pruned with them.

ALTER TABLE "UsageCall"        ADD COLUMN IF NOT EXISTS "answerChars" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "UsageCallArchive" ADD COLUMN IF NOT EXISTS "answerChars" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "UsageRollup" ADD COLUMN IF NOT EXISTS "answerCharsSum"    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "UsageRollup" ADD COLUMN IF NOT EXISTS "answerCharsMax"    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "UsageRollup" ADD COLUMN IF NOT EXISTS "answersOverBudget" BIGINT NOT NULL DEFAULT 0;
