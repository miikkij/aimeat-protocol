/**
 * @file agent-message.ts
 * @description SQLite implementation for agent message CRUD, inbox, and thread listing
 * @version-history
 *   v1.1.0 -- 2026-08-01 -- TARGET-058 Phase 9 step 0: `aiProvenanceId` written and read back, so an
 *     agent message the owner reads can render the label from the message itself rather than only
 *     being findable by content hash. Mirrors Postgres migration 0020.
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */

import type Database from 'better-sqlite3';
import type { AgentMessageRecord } from '../../../interface.js';

// ── Helpers ──

function deserializeMessage(row: Record<string, unknown>): AgentMessageRecord {
  const record: AgentMessageRecord = {
    id: row.id as string,
    agentGaii: row.agentGaii as string,
    threadId: row.threadId as string,
    direction: row.direction as AgentMessageRecord['direction'],
    senderGaii: row.senderGaii as string,
    content: row.content as string,
    status: row.status as AgentMessageRecord['status'],
    createdAt: row.createdAt as string,
  };
  if (row.linkedTaskId) record.linkedTaskId = row.linkedTaskId as string;
  if (row.metadata) record.metadata = JSON.parse(row.metadata as string);
  if (row.processedAt) record.processedAt = row.processedAt as string;
  if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
  return record;
}

// ── Agent Messages ──

export function createMessage(db: Database.Database, record: AgentMessageRecord): AgentMessageRecord {
  db.prepare(
    `INSERT INTO agent_messages
     (id, agentGaii, threadId, direction, senderGaii, content, status,
      linkedTaskId, metadata, createdAt, processedAt, aiProvenanceId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.agentGaii,
    record.threadId,
    record.direction,
    record.senderGaii,
    record.content,
    record.status,
    record.linkedTaskId ?? null,
    record.metadata ? JSON.stringify(record.metadata) : null,
    record.createdAt,
    record.processedAt ?? null,
    record.aiProvenanceId ?? null,
  );
  return record;
}

export function getMessage(db: Database.Database, id: string): AgentMessageRecord | null {
  const row = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeMessage(row) : null;
}

export function listMessages(
  db: Database.Database,
  agentGaii: string,
  opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number },
): { messages: AgentMessageRecord[]; total: number } {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let whereSql = 'WHERE agentGaii = ?';
  const params: unknown[] = [agentGaii];

  if (opts?.direction) {
    whereSql += ' AND direction = ?';
    params.push(opts.direction);
  }
  if (opts?.threadId) {
    whereSql += ' AND threadId = ?';
    params.push(opts.threadId);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM agent_messages ${whereSql}`).get(...params) as { cnt: number }).cnt;

  const rows = db.prepare(
    `SELECT * FROM agent_messages ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as Record<string, unknown>[];

  return { messages: rows.map(deserializeMessage), total };
}

export function listPendingMessages(db: Database.Database, agentGaii: string): AgentMessageRecord[] {
  const rows = db.prepare(
    `SELECT * FROM agent_messages WHERE agentGaii = ? AND status = 'pending' AND direction = 'inbound' ORDER BY createdAt ASC`
  ).all(agentGaii) as Record<string, unknown>[];

  return rows.map(deserializeMessage);
}

export function updateMessageStatus(
  db: Database.Database,
  id: string,
  status: string,
  processedAt?: string,
): AgentMessageRecord | null {
  const existing = getMessage(db, id);
  if (!existing) return null;

  if (processedAt) {
    db.prepare('UPDATE agent_messages SET status = ?, processedAt = ? WHERE id = ?').run(status, processedAt, id);
  } else {
    db.prepare('UPDATE agent_messages SET status = ? WHERE id = ?').run(status, id);
  }

  return getMessage(db, id);
}

export function listThreads(
  db: Database.Database,
  agentGaii: string,
): { threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[] {
  const rows = db.prepare(
    `SELECT
       threadId,
       COUNT(*) as messageCount,
       MAX(createdAt) as updatedAt
     FROM agent_messages
     WHERE agentGaii = ?
     GROUP BY threadId
     ORDER BY updatedAt DESC`
  ).all(agentGaii) as Array<{ threadId: string; messageCount: number; updatedAt: string }>;

  // Get the last message content for each thread
  return rows.map(row => {
    const lastMsg = db.prepare(
      `SELECT content FROM agent_messages WHERE agentGaii = ? AND threadId = ? ORDER BY createdAt DESC LIMIT 1`
    ).get(agentGaii, row.threadId) as { content: string } | undefined;

    return {
      threadId: row.threadId,
      lastMessage: lastMsg?.content ?? '',
      messageCount: row.messageCount,
      updatedAt: row.updatedAt,
    };
  });
}

export function countMessagesByAgents(
  db: Database.Database,
  agentGaiis: string[],
): Record<string, { total: number; lastMessageAt: string | null }> {
  const out: Record<string, { total: number; lastMessageAt: string | null }> = {};
  if (agentGaiis.length === 0) return out;
  const placeholders = agentGaiis.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT agentGaii, COUNT(*) AS total, MAX(createdAt) AS lastMessageAt
       FROM agent_messages
      WHERE agentGaii IN (${placeholders}) AND direction != 'inbound'
      GROUP BY agentGaii`
  ).all(...agentGaiis) as Array<{ agentGaii: string; total: number; lastMessageAt: string | null }>;
  for (const r of rows) {
    out[r.agentGaii] = { total: r.total, lastMessageAt: r.lastMessageAt ?? null };
  }
  return out;
}
