-- 0131_help_questions.sql
-- Ask someone who knows (types/help.ts, 2026-11-14): a member asks a question, the node finds one or
-- two members whose chosen topics match, and the question arrives in their inbox as a direct message
-- thread. They answer themselves or their AI answers within the level they allowed. Same node only.
--
-- "HelpParticipant" is one member's choices: may others ask them ("helper"), may they ask ("asker",
-- NULL means the node's default), their topics, who may ask them, how often, their status and what
-- their AI may do. "topics" and "autoTopics" are JSON arrays in TEXT columns.
-- "HelpQuestion" is one question: its text, topics, attachments (storage keys, JSON), state, who
-- answered, the thanks and the reward, and whether the answer is kept for others ("saved"). It is
-- replaced by ONE UPDATE conditional on "version", so two writers on the same question cannot both win.
-- "HelpRoute" is one helper a question was sent to: the thread it lives in, what the helper did, and
-- the draft their AI wrote ("draft", JSON or NULL), their answer as sent, and whether they allow it
-- to be kept for others ("keepAllowed").
--
-- Times are ISO-8601 strings from the caller's clock, all written by Date.toISOString(), so a TEXT
-- comparison orders them. Owner columns are "ownerGhii" and "helperGhii". Mirrors applyHelpSchema in
-- providers/sqlite/schema-help.ts. This file only adds.

CREATE TABLE IF NOT EXISTS "HelpParticipant" (
  "ownerGhii"    TEXT PRIMARY KEY,
  "helper"       BOOLEAN NOT NULL DEFAULT FALSE,
  "asker"        BOOLEAN,
  "topics"       TEXT NOT NULL DEFAULT '[]',
  "audience"     TEXT NOT NULL DEFAULT 'node',
  "capPerWeek"   INTEGER NOT NULL DEFAULT 2,
  "status"       TEXT NOT NULL DEFAULT 'available',
  "statusUntil"  TEXT,
  "aiMode"       TEXT NOT NULL DEFAULT 'draft',
  "autoTopics"   TEXT NOT NULL DEFAULT '[]',
  "aiMaySend"    BOOLEAN NOT NULL DEFAULT FALSE,
  "agentsMayAsk" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"    TEXT NOT NULL,
  "updatedAt"    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "HelpParticipant_helper_idx" ON "HelpParticipant" ("helper");

CREATE TABLE IF NOT EXISTS "HelpQuestion" (
  "id"               TEXT PRIMARY KEY,
  "ownerGhii"        TEXT NOT NULL,
  "askedBy"          TEXT NOT NULL,
  "subject"          TEXT NOT NULL,
  "question"         TEXT NOT NULL,
  "tried"            TEXT NOT NULL DEFAULT '',
  "topics"           TEXT NOT NULL DEFAULT '[]',
  "attachments"      TEXT NOT NULL DEFAULT '[]',
  "audience"         TEXT NOT NULL,
  "state"            TEXT NOT NULL,
  "answeredBy"       TEXT,
  "answeredByAi"     BOOLEAN NOT NULL DEFAULT FALSE,
  "answer"           TEXT NOT NULL DEFAULT '',
  "thanks"           TEXT NOT NULL DEFAULT '',
  "rewardMorsels"    INTEGER NOT NULL DEFAULT 0,
  "saved"            BOOLEAN NOT NULL DEFAULT FALSE,
  "savedConfirmedAt" TEXT,
  "stale"            BOOLEAN NOT NULL DEFAULT FALSE,
  "deadline"         TEXT NOT NULL,
  "remindedAt"       TEXT,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "createdAt"        TEXT NOT NULL,
  "updatedAt"        TEXT NOT NULL,
  "closedAt"         TEXT
);
CREATE INDEX IF NOT EXISTS "HelpQuestion_ownerGhii_createdAt_idx" ON "HelpQuestion" ("ownerGhii", "createdAt");
CREATE INDEX IF NOT EXISTS "HelpQuestion_state_deadline_idx" ON "HelpQuestion" ("state", "deadline");
CREATE INDEX IF NOT EXISTS "HelpQuestion_saved_idx" ON "HelpQuestion" ("saved");
CREATE INDEX IF NOT EXISTS "HelpQuestion_createdAt_idx" ON "HelpQuestion" ("createdAt");

CREATE TABLE IF NOT EXISTS "HelpRoute" (
  "id"             TEXT PRIMARY KEY,
  "questionId"     TEXT NOT NULL,
  "helperGhii"     TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "routedAt"       TEXT NOT NULL,
  "outcome"        TEXT NOT NULL,
  "outcomeAt"      TEXT,
  "referredTo"     TEXT,
  "draft"          TEXT,
  "answer"         TEXT NOT NULL DEFAULT '',
  "answeredByAi"   BOOLEAN NOT NULL DEFAULT FALSE,
  "keepAllowed"    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS "HelpRoute_questionId_idx" ON "HelpRoute" ("questionId");
CREATE INDEX IF NOT EXISTS "HelpRoute_helperGhii_routedAt_idx" ON "HelpRoute" ("helperGhii", "routedAt");
CREATE INDEX IF NOT EXISTS "HelpRoute_conversationId_idx" ON "HelpRoute" ("conversationId");
CREATE INDEX IF NOT EXISTS "HelpRoute_outcome_routedAt_idx" ON "HelpRoute" ("outcome", "routedAt");
