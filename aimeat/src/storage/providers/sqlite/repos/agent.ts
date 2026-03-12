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
  return record;
}

export function createAgent(db: Database.Database, agent: AgentRecord): AgentRecord {
  try {
    db.prepare(
      `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agent.gaii, agent.name, agent.owner,
      agent.displayName ?? null, agent.description ?? null,
      JSON.stringify(agent.capabilities), agent.publicKey,
      agent.trustScore, agent.morselBalance,
      agent.createdAt, agent.lastSeen,
      agent.semantic ? JSON.stringify(agent.semantic) : null,
      agent.allowedOrigins ? JSON.stringify(agent.allowedOrigins) : null,
    );
    return agent;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN');
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
     allowedOrigins = ?
     WHERE gaii = ?`
  ).run(
    updated.name, updated.owner,
    updated.displayName ?? null, updated.description ?? null,
    JSON.stringify(updated.capabilities), updated.publicKey,
    updated.trustScore, updated.morselBalance,
    updated.createdAt, updated.lastSeen,
    updated.semantic ? JSON.stringify(updated.semantic) : null,
    updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
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
