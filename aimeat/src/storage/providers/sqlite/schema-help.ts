/**
 * @file src/storage/providers/sqlite/schema-help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0131_help_questions.sql: Ask someone who knows,
 *   its participants, questions and routes (types/help.ts). JSON fields are TEXT, times are ISO
 *   strings, booleans are INTEGER 0/1 (asker NULL means the node's default). Called at the end of
 *   applySchemaTables4; idempotent on every boot.
 * @structure applyHelpSchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
import type Database from 'better-sqlite3';

export function applyHelpSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS help_participants (
      ownerGhii    TEXT PRIMARY KEY,
      helper       INTEGER NOT NULL DEFAULT 0,
      asker        INTEGER,
      topics       TEXT NOT NULL DEFAULT '[]',
      audience     TEXT NOT NULL DEFAULT 'node',
      capPerWeek   INTEGER NOT NULL DEFAULT 2,
      status       TEXT NOT NULL DEFAULT 'available',
      statusUntil  TEXT,
      aiMode       TEXT NOT NULL DEFAULT 'draft',
      autoTopics   TEXT NOT NULL DEFAULT '[]',
      aiMaySend    INTEGER NOT NULL DEFAULT 0,
      agentsMayAsk INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_help_participants_helper ON help_participants(helper);

    CREATE TABLE IF NOT EXISTS help_questions (
      id               TEXT PRIMARY KEY,
      ownerGhii        TEXT NOT NULL,
      askedBy          TEXT NOT NULL,
      subject          TEXT NOT NULL,
      question         TEXT NOT NULL,
      tried            TEXT NOT NULL DEFAULT '',
      topics           TEXT NOT NULL DEFAULT '[]',
      attachments      TEXT NOT NULL DEFAULT '[]',
      audience         TEXT NOT NULL,
      state            TEXT NOT NULL,
      answeredBy       TEXT,
      answeredByAi     INTEGER NOT NULL DEFAULT 0,
      answer           TEXT NOT NULL DEFAULT '',
      thanks           TEXT NOT NULL DEFAULT '',
      rewardMorsels    INTEGER NOT NULL DEFAULT 0,
      saved            INTEGER NOT NULL DEFAULT 0,
      savedConfirmedAt TEXT,
      stale            INTEGER NOT NULL DEFAULT 0,
      deadline         TEXT NOT NULL,
      remindedAt       TEXT,
      version          INTEGER NOT NULL DEFAULT 1,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      closedAt         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_help_questions_owner ON help_questions(ownerGhii, createdAt);
    CREATE INDEX IF NOT EXISTS idx_help_questions_state_deadline ON help_questions(state, deadline);
    CREATE INDEX IF NOT EXISTS idx_help_questions_saved ON help_questions(saved);
    CREATE INDEX IF NOT EXISTS idx_help_questions_created ON help_questions(createdAt);

    CREATE TABLE IF NOT EXISTS help_routes (
      id             TEXT PRIMARY KEY,
      questionId     TEXT NOT NULL,
      helperGhii     TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      routedAt       TEXT NOT NULL,
      outcome        TEXT NOT NULL,
      outcomeAt      TEXT,
      referredTo     TEXT,
      draft          TEXT,
      answer         TEXT NOT NULL DEFAULT '',
      answeredByAi   INTEGER NOT NULL DEFAULT 0,
      keepAllowed    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_help_routes_question ON help_routes(questionId);
    CREATE INDEX IF NOT EXISTS idx_help_routes_helper ON help_routes(helperGhii, routedAt);
    CREATE INDEX IF NOT EXISTS idx_help_routes_conversation ON help_routes(conversationId);
    CREATE INDEX IF NOT EXISTS idx_help_routes_outcome ON help_routes(outcome, routedAt);
  `);
}
