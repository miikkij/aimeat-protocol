/**
 * @file src/storage/providers/sqlite/repos/agent.ts
 * @description SQLite (better-sqlite3) repository for agent (GAII) records — CRUD plus
 *   morsel-balance debit, with JSON (de)serialization of capabilities/scopes/webhook/platform fields.
 *
 * @structure
 *   - deserializeAgent: maps a DB row to an AgentRecord (parses JSON columns, coerces int flags)
 *   - createAgent / getAgent / getAgentsByOwner / listAgents: inserts and reads (NAME_TAKEN on unique clash)
 *   - updateAgent: full-row update merged over existing record
 *   - deleteAgent: transactional cascade delete of agent-owned data + the agent row
 *   - debitBalance: conditional morselBalance decrement
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { AgentRecord } from '../../../interface.js';
import { cascadeDeleteAgentData } from './owner.js';

function deserializeAgent(row: Record<string, unknown>): AgentRecord {
  const record: AgentRecord = {
    gaii: row.gaii as string,
    name: row.name as string,
    owner: row.owner as string,
    capabilities: JSON.parse(row.capabilities as string) as string[],
    publicKey: row.publicKey as string,
    trustScore: row.trustScore as number,
    morselBalance: row.morselBalance as number,
    createdAt: row.createdAt as string,
    lastSeen: row.lastSeen as string,
  };
  if (row.displayName) record.displayName = row.displayName as string;
  if (row.description) record.description = row.description as string;
  if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
  if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
  if (row.defaultScopes) record.defaultScopes = JSON.parse(row.defaultScopes as string);
  record.federate = (row as any).federate === 1;
  if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
  if (row.webhookSecret) record.webhookSecret = row.webhookSecret as string;
  record.webhookEnabled = (row as any).webhookEnabled === 1;
  if (row.webhookLastSuccess) record.webhookLastSuccess = row.webhookLastSuccess as string;
  if (row.webhookLastFailure) record.webhookLastFailure = row.webhookLastFailure as string;
  record.webhookFailCount = (row.webhookFailCount as number) ?? 0;
  if (row.platform) record.platform = row.platform as string;
  if (row.platformVersion) record.platformVersion = row.platformVersion as string;
  if (row.platformDetectedBy) record.platformDetectedBy = row.platformDetectedBy as 'auto' | 'self_report' | 'message_reply';
  if (row.tags) record.tags = JSON.parse(row.tags as string);
  return record;
}

export function createAgent(db: Database.Database, agent: AgentRecord): AgentRecord {
  try {
    db.prepare(
      `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins, defaultScopes, federate,
       webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount, platform, platformVersion, platformDetectedBy, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agent.gaii, agent.name, agent.owner,
      agent.displayName ?? null, agent.description ?? null,
      JSON.stringify(agent.capabilities), agent.publicKey,
      agent.trustScore, agent.morselBalance,
      agent.createdAt, agent.lastSeen,
      agent.semantic ? JSON.stringify(agent.semantic) : null,
      agent.allowedOrigins ? JSON.stringify(agent.allowedOrigins) : null,
      agent.defaultScopes ? JSON.stringify(agent.defaultScopes) : null,
      agent.federate ? 1 : 0,
      agent.webhookUrl ?? null, agent.webhookSecret ?? null, agent.webhookEnabled ? 1 : 0,
      agent.webhookLastSuccess ?? null, agent.webhookLastFailure ?? null, agent.webhookFailCount ?? 0,
      agent.platform ?? null, agent.platformVersion ?? null, agent.platformDetectedBy ?? null,
      agent.tags ? JSON.stringify(agent.tags) : null,
    );
    return agent;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
    throw err;
  }
}

export function getAgent(db: Database.Database, gaii: string): AgentRecord | null {
  const row = db.prepare('SELECT * FROM agents WHERE gaii = ?').get(gaii) as Record<string, unknown> | undefined;
  return row ? deserializeAgent(row) : null;
}

export function getAgentsByOwner(db: Database.Database, owner: string): AgentRecord[] {
  const rows = db.prepare('SELECT * FROM agents WHERE owner = ?').all(owner) as Record<string, unknown>[];
  return rows.map(r => deserializeAgent(r));
}

export function updateAgent(db: Database.Database, gaii: string, updates: Partial<AgentRecord>): AgentRecord | null {
  const existing = getAgent(db, gaii);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(
    `UPDATE agents SET name = ?, owner = ?, displayName = ?, description = ?, capabilities = ?,
     publicKey = ?, trustScore = ?, morselBalance = ?, createdAt = ?, lastSeen = ?, semantic = ?,
     allowedOrigins = ?, defaultScopes = ?, federate = ?,
     webhookUrl = ?, webhookSecret = ?, webhookEnabled = ?, webhookLastSuccess = ?, webhookLastFailure = ?, webhookFailCount = ?,
     platform = ?, platformVersion = ?, platformDetectedBy = ?, tags = ?
     WHERE gaii = ?`
  ).run(
    updated.name, updated.owner,
    updated.displayName ?? null, updated.description ?? null,
    JSON.stringify(updated.capabilities), updated.publicKey,
    updated.trustScore, updated.morselBalance,
    updated.createdAt, updated.lastSeen,
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
    updated.defaultScopes ? JSON.stringify(updated.defaultScopes) : null,
    updated.federate ? 1 : 0,
    updated.webhookUrl ?? null, updated.webhookSecret ?? null, updated.webhookEnabled ? 1 : 0,
    updated.webhookLastSuccess ?? null, updated.webhookLastFailure ?? null, updated.webhookFailCount ?? 0,
    updated.platform ?? null, updated.platformVersion ?? null, updated.platformDetectedBy ?? null,
    updated.tags ? JSON.stringify(updated.tags) : null,
    gaii,
  );
  return updated;
}

export function deleteAgent(db: Database.Database, gaii: string): boolean {
  const txn = db.transaction(() => {
    cascadeDeleteAgentData(db, gaii);
    const result = db.prepare('DELETE FROM agents WHERE gaii = ?').run(gaii);
    return result.changes > 0;
  });
  return txn();
}

export function listAgents(db: Database.Database): AgentRecord[] {
  const rows = db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
  return rows.map(r => deserializeAgent(r));
}

export function debitBalance(db: Database.Database, gaii: string, amount: number): boolean {
  const result = db.prepare(
    `UPDATE agents SET morselBalance = morselBalance - ? WHERE gaii = ? AND morselBalance >= ?`
  ).run(amount, gaii, amount);
  return result.changes > 0;
}

export function creditBalance(db: Database.Database, gaii: string, amount: number): boolean {
  const result = db.prepare(
    `UPDATE agents SET morselBalance = morselBalance + ? WHERE gaii = ?`
  ).run(amount, gaii);
  return result.changes > 0;
}

export function creditBalanceCapped(db: Database.Database, gaii: string, amount: number, cap: number): number {
  const txn = db.transaction(() => {
    const row = db.prepare('SELECT morselBalance FROM agents WHERE gaii = ?').get(gaii) as Record<string, unknown> | undefined;
    if (!row) return 0;
    const oldBalance = row.morselBalance as number;
    if (oldBalance >= cap) return 0;
    const actualCredit = Math.min(amount, cap - oldBalance);
    if (actualCredit <= 0) return 0;
    db.prepare('UPDATE agents SET morselBalance = morselBalance + ? WHERE gaii = ?').run(actualCredit, gaii);
    return actualCredit;
  });
  return txn();
}

export function transferBalance(db: Database.Database, fromGaii: string, toGaii: string, amount: number): boolean {
  const txn = db.transaction(() => {
    const debit = db.prepare(
      `UPDATE agents SET morselBalance = morselBalance - ? WHERE gaii = ? AND morselBalance >= ?`
    ).run(amount, fromGaii, amount);
    if (debit.changes === 0) return false;

    db.prepare(
      `UPDATE agents SET morselBalance = morselBalance + ? WHERE gaii = ?`
    ).run(amount, toGaii);
    return true;
  });
  return txn();
}
