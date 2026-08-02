-- 0025_publish_metrics.sql
-- How a published item is actually doing (TARGET-057).
--
-- A TIME SERIES, not a column on the attempt. "How did that post do" is a question about a curve. A
-- field holding only the latest value can say a post has 40 likes and can never say whether that
-- took an hour or a month, which is the part that decides what to publish next.
--
-- APPEND-ONLY. A series that can be edited is not a record of anything. Corrections are new rows.
--
-- NULL IS NOT ZERO. A platform that does not report impressions to the author reports nothing, and
-- writing 0 there would invent a measurement nobody made. Every normalised column is nullable and
-- means "not reported" when null.
CREATE TABLE IF NOT EXISTS "PublishMetric" (
    "id"          TEXT NOT NULL,
    "attemptId"   TEXT NOT NULL,
    -- When THIS node asked. Not when the platform computed it, which is rarely knowable.
    "fetchedAt"   TEXT NOT NULL,
    "impressions" INTEGER,
    "likes"       INTEGER,
    "comments"    INTEGER,
    -- Reblogs, reposts, retweets, shares. Cousins rather than synonyms, named once so that a
    -- comparison across platforms is possible at all.
    "shares"      INTEGER,
    -- Exactly what the provider returned, so a wrong mapping stays discoverable instead of becoming
    -- the only surviving record.
    "raw"         JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "PublishMetric_pkey" PRIMARY KEY ("id")
);

-- The two reads this table exists for: the newest sample per attempt, and one attempt's whole curve.
CREATE INDEX IF NOT EXISTS "PublishMetric_attempt_time_idx"
    ON "PublishMetric"("attemptId", "fetchedAt" DESC);
