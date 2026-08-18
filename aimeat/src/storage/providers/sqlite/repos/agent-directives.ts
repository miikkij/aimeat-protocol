/**
 * @file agent-directives.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation for agent directives and owner-level agent defaults
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type Database from 'better-sqlite3';
import type { AgentDirectivesRecord, OwnerAgentDefaults } from '../../../interface.js';

// ── Helpers ──

function deserializeDirectives(row: Record<string, unknown>): AgentDirectivesRecord {
  const record: AgentDirectivesRecord = {
    agentGaii: row.agentGaii as string,
    purpose: row.purpose as string,
    rules: JSON.parse(row.rules as string),
    memoryAreas: JSON.parse(row.memoryAreas as string),
    resources: JSON.parse(row.resources as string),
    updatedAt: row.updatedAt as string,
  };
  if (row.budgetLimits) record.budgetLimits = JSON.parse(row.budgetLimits as string);
  return record;
}

function deserializeOwnerDefaults(row: Record<string, unknown>): OwnerAgentDefaults {
  const record: OwnerAgentDefaults = {
    ownerGaii: row.ownerGaii as string,
    rules: JSON.parse(row.rules as string),
    updatedAt: row.updatedAt as string,
  };
  if (row.defaultTokenBudget != null) record.defaultTokenBudget = row.defaultTokenBudget as number;
  if (row.defaultMemoryAreas) record.defaultMemoryAreas = JSON.parse(row.defaultMemoryAreas as string);
  return record;
}

// ── Agent Directives ──

export function getAgentDirectives(db: Database.Database, agentGaii: string): AgentDirectivesRecord | null {
  const row = db.prepare('SELECT * FROM agent_directives WHERE agentGaii = ?').get(agentGaii) as Record<string, unknown> | undefined;
  return row ? deserializeDirectives(row) : null;
}

export function upsertAgentDirectives(db: Database.Database, record: AgentDirectivesRecord): AgentDirectivesRecord {
  db.prepare(
    `INSERT INTO agent_directives (agentGaii, purpose, rules, memoryAreas, resources, budgetLimits, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agentGaii) DO UPDATE SET
       purpose = excluded.purpose,
       rules = excluded.rules,
       memoryAreas = excluded.memoryAreas,
       resources = excluded.resources,
       budgetLimits = excluded.budgetLimits,
       updatedAt = excluded.updatedAt`
  ).run(
    record.agentGaii,
    record.purpose,
    JSON.stringify(record.rules),
    JSON.stringify(record.memoryAreas),
    JSON.stringify(record.resources),
    record.budgetLimits ? JSON.stringify(record.budgetLimits) : null,
    record.updatedAt,
  );
  return record;
}

export function deleteAgentDirectives(db: Database.Database, agentGaii: string): boolean {
  const result = db.prepare('DELETE FROM agent_directives WHERE agentGaii = ?').run(agentGaii);
  return result.changes > 0;
}

// ── Owner Agent Defaults ──

export function getOwnerAgentDefaults(db: Database.Database, ownerGaii: string): OwnerAgentDefaults | null {
  const row = db.prepare('SELECT * FROM owner_agent_defaults WHERE ownerGaii = ?').get(ownerGaii) as Record<string, unknown> | undefined;
  return row ? deserializeOwnerDefaults(row) : null;
}

export function upsertOwnerAgentDefaults(db: Database.Database, record: OwnerAgentDefaults): OwnerAgentDefaults {
  db.prepare(
    `INSERT INTO owner_agent_defaults (ownerGaii, rules, defaultTokenBudget, defaultMemoryAreas, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ownerGaii) DO UPDATE SET
       rules = excluded.rules,
       defaultTokenBudget = excluded.defaultTokenBudget,
       defaultMemoryAreas = excluded.defaultMemoryAreas,
       updatedAt = excluded.updatedAt`
  ).run(
    record.ownerGaii,
    JSON.stringify(record.rules),
    record.defaultTokenBudget ?? null,
    record.defaultMemoryAreas ? JSON.stringify(record.defaultMemoryAreas) : '[]',
    record.updatedAt,
  );
  return record;
}
