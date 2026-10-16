/**
 * @file src/services/admin-restore.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The import behind POST /v1/admin/restore: writes the owners, agents, actions, boards,
 *   agents' memory records and wallet transactions of an `aimeat backup` file, and reports per kind
 *   how many were imported, how many were skipped because the record already exists, and how many
 *   failed for any other reason. `restored` is true only when nothing failed.
 * @structure restoreBackup(storage, body) · RestoreOutcome
 * @usage const outcome = await restoreBackup(storage, req.body);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Extracted from routes/admin-monitoring.ts. Every create error was logged as
 *     "skip duplicates" at warn level and the answer always said `restored: true`; a duplicate is now
 *     told apart from any other failure (the record with the same key exists afterwards), other
 *     failures are counted and logged at error level, and `restored` is false when any occurred
 *     (QA audit P6-07).
 */
import type { Storage, MemoryRecord, WalletTransaction } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

type Kind = 'owners' | 'agents' | 'actions' | 'boards' | 'memories' | 'transactions';
type Counts = Record<Kind, number>;

/** The most failure lines the answer carries; the log has every one. */
const MAX_FAILURE_LINES = 20;

export interface RestoreFailure { kind: Kind; key: string; error: string }

export interface RestoreOutcome {
  /** True only when every record was imported or already existed. */
  restored: boolean;
  imported: Counts;
  /** Records skipped because a record with the same key already exists on this node. */
  skipped_duplicates: Counts;
  /** Records that were not written for any other reason. */
  failed: Counts;
  /** The first failures, with the record's key and the storage error. */
  failures: RestoreFailure[];
}

const zero = (): Counts => ({ owners: 0, agents: 0, actions: 0, boards: 0, memories: 0, transactions: 0 });

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * A primary-key or unique violation: Postgres SQLSTATE 23505, better-sqlite3 SQLITE_CONSTRAINT_*.
 * Used for transactions, which have no getter by id to ask instead. The same test as
 * routes/agent-tasks/dedupe.ts isUniqueViolation, which a service may not import.
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '23505') return true;
  if (typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) return true;
  return /unique constraint|UNIQUE constraint failed|duplicate key/i.test(e.message || '');
}

/**
 * Import a backup body. Owners, agents, actions and boards are created; a create that throws is a
 * duplicate when the record with that key exists afterwards, and a failure otherwise. Memory records
 * are written with setMemory (an existing key is replaced, as before) and transactions appended.
 */
export async function restoreBackup(storage: Storage, body: unknown): Promise<RestoreOutcome> {
  const b = (body ?? {}) as {
    owners?: unknown[]; agents?: unknown[]; actions?: unknown[]; boards?: unknown[];
    agent_data?: Record<string, { memories?: MemoryRecord[]; transactions?: WalletTransaction[] }>;
  };
  const out: RestoreOutcome = { restored: true, imported: zero(), skipped_duplicates: zero(), failed: zero(), failures: [] };

  const fail = (kind: Kind, key: string, err: unknown): void => {
    out.failed[kind]++;
    const error = errorText(err);
    logger.error('POST /v1/admin/restore: a record was not imported', { kind, key, error });
    if (out.failures.length < MAX_FAILURE_LINES) out.failures.push({ kind, key, error });
  };

  /** Create one record; on a throw, ask storage whether the key exists to tell a duplicate apart. */
  const createOne = async <T>(kind: Kind, rec: T, key: string, create: (r: T) => Promise<unknown>,
    exists: () => Promise<unknown> | null): Promise<void> => {
    try {
      await create(rec);
      out.imported[kind]++;
    } catch (err) {
      let present = false;
      try { present = !!(await exists()); } catch (probeErr) {
        logger.error('POST /v1/admin/restore: the duplicate check failed', { kind, key, error: errorText(probeErr) });
      }
      if (present) out.skipped_duplicates[kind]++;
      else fail(kind, key, err);
    }
  };

  for (const o of (b.owners ?? []) as Array<{ name?: string }>) {
    const name = String(o?.name ?? '');
    await createOne('owners', o as never, name, r => storage.createOwner(r), () => name ? storage.getOwner(name) : null);
  }
  for (const a of (b.agents ?? []) as Array<{ gaii?: string }>) {
    const gaii = String(a?.gaii ?? '');
    await createOne('agents', a as never, gaii, r => storage.createAgent(r), () => gaii ? storage.getAgent(gaii) : null);
  }
  for (const a of (b.actions ?? []) as Array<{ id?: string; providerGaii?: string }>) {
    const id = String(a?.id ?? '');
    const provider = String(a?.providerGaii ?? '');
    await createOne('actions', a as never, `${provider}/${id}`, r => storage.createAction(r),
      () => id && provider ? storage.getAction(id, provider) : null);
  }
  for (const bd of (b.boards ?? []) as Array<{ id?: string }>) {
    const id = String(bd?.id ?? '');
    await createOne('boards', bd as never, id, r => storage.createBoard(r), () => id ? storage.getBoard(id) : null);
  }
  for (const [gaii, data] of Object.entries(b.agent_data ?? {})) {
    for (const m of data?.memories ?? []) {
      try { await storage.setMemory(m); out.imported.memories++; } catch (err) { fail('memories', `${gaii}/${m?.key ?? ''}`, err); }
    }
    for (const tx of data?.transactions ?? []) {
      try { await storage.addTransaction(tx); out.imported.transactions++; } catch (err) {
        if (isUniqueViolation(err)) out.skipped_duplicates.transactions++;
        else fail('transactions', `${gaii}/${(tx as { id?: string })?.id ?? ''}`, err);
      }
    }
  }

  out.restored = Object.values(out.failed).every(n => n === 0);
  return out;
}
