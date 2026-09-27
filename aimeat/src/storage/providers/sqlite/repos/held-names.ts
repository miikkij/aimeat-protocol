/**
 * @file src/storage/providers/sqlite/repos/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for what the move to the full identity left for the operator: the record
 *   (system_settings key HELD_NAMES_RECORD_KEY) and the operator's decision on one held name. The
 *   boot half of the move (schema-identity-backfill.ts) writes the record and uses payerWhenWritten;
 *   methods/held-names.ts calls the rest. A free function over the connection, like the other
 *   erasure repos, so it runs before a provider instance exists. The Postgres twin is
 *   methods/held-names.ts in its provider.
 * @structure
 *   - payerWhenWritten(db, identity, writtenAt) — whose balance a held request goes back to
 *   - readHeldNamesRecord(db) / writeHeldNamesRecord(db, record)
 *   - resolveHeldNameIn(db, input) — the decision on one name, in the caller's transaction
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type Database from 'better-sqlite3';
import { erasedPartyPseudonym, erasedAccountParty, ERASED_PARTY_PREFIX } from '../../../erased-party.js';
import { HELD_NAMES_RECORD_KEY } from '../../../repositories/held-names.repository.js';
import { emptyHeldNameOutcome, type HeldNamesRecord, type HeldNameOutcome, type HeldNameResolution } from '../../../types/held-names.js';
import { settleErasedPartyWork } from './work-erasure.js';
import { pseudonymiseLedgerParty } from './ledger-erasure.js';
import { resolveGhiiIn } from './ghii-resolve.js';

/** An action of this node rather than a copy of another node's (id `<node>:<id>`, tag `federated:<node>`). */
export const LOCAL_ACTION = `instr(actions.id, ':') = 0 AND actions.tags NOT LIKE '%"federated:%'`;

/** A bare account name: no node, no agent, and not a pseudonym an erasure wrote. */
export const bare = (column: string): string =>
  `instr(${column}, '@') = 0 AND instr(${column}, '#') = 0`
  + ` AND substr(${column}, 1, ${ERASED_PARTY_PREFIX.length}) <> '${ERASED_PARTY_PREFIX}'`;

/**
 * The balance a held request goes back to: the requester's GHII, found the way every balance op finds
 * it, when that account already existed when the row was written. A name is released for reuse, so
 * an account registered later under the requester's name is somebody else, and nothing goes back, as
 * for a requester whose account is gone.
 */
export function payerWhenWritten(db: Database.Database, identity: string, writtenAt: string): string | null {
  const ghii = resolveGhiiIn(db, identity);
  if (!ghii) return null;
  const existed = db.prepare(
    'SELECT 1 FROM ghiis g JOIN owners o ON o.name = g.ownerName WHERE g.ghii = ? AND o.createdAt <= ?',
  ).get(ghii, writtenAt);
  return existed ? ghii : null;
}

/** The record, or null when the move recorded nothing. A value that does not parse reads as none. */
export function readHeldNamesRecord(db: Database.Database): HeldNamesRecord | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(HELD_NAMES_RECORD_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as HeldNamesRecord;
  } catch (err) {
    throw new Error(`The record ${HELD_NAMES_RECORD_KEY} does not parse: ${(err as Error).message}`, { cause: err });
  }
}

export function writeHeldNamesRecord(db: Database.Database, record: HeldNamesRecord): void {
  db.prepare(
    `INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')`,
  ).run(HELD_NAMES_RECORD_KEY, JSON.stringify(record));
}

/**
 * The operator's decision on one held name, in the caller's transaction. The rule is written on the
 * repository (HeldAccountNameRepository.resolveHeldAccountName); in short:
 *   - 'holder': the bare name's local actions, work sides and own lines move to the holder's GHII;
 *   - 'previous': they are settled as deleting a previous holder's account would have settled them,
 *     and the older lines in other people's ledgers that name the account take the same pseudonym.
 * Everything under the bare name is what the move left: every route writes the full identity now.
 */
export function resolveHeldNameIn(db: Database.Database, input: {
  name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
}): HeldNameOutcome {
  const { name } = input;
  const out = emptyHeldNameOutcome();
  const actions = db.prepare(`SELECT id FROM actions WHERE providerGaii = ? AND ${LOCAL_ACTION}`).all(name) as { id: string }[];

  if (input.resolution === 'holder') {
    const ghii = input.holderGhii;
    if (!ghii) throw new Error('A held name is moved to its holder only when the holder has a full identity.');
    const taken = db.prepare('SELECT 1 FROM actions WHERE id = ? AND providerGaii = ?');
    const move = db.prepare('UPDATE actions SET providerGaii = ? WHERE id = ? AND providerGaii = ?');
    for (const { id } of actions) {
      if (taken.get(id, ghii)) { out.actions_left++; continue; }
      move.run(ghii, id, name);
      out.actions_moved++;
    }
    const sides = db.prepare('SELECT trackingCode FROM work WHERE providerGaii = ? OR requesterGaii = ?').all(name, name) as { trackingCode: string }[];
    db.prepare('UPDATE work SET providerGaii = ? WHERE providerGaii = ?').run(ghii, name);
    db.prepare('UPDATE work SET requesterGaii = ? WHERE requesterGaii = ?').run(ghii, name);
    out.work_moved = sides.length;
    out.own_lines_moved = db.prepare('UPDATE wallet_transactions SET gaii = ? WHERE gaii = ?').run(ghii, name).changes;
    return out;
  }

  // A previous holder's: one new pseudonym for the rows this decision settles.
  const pseudonym = erasedPartyPseudonym();
  const del = db.prepare('DELETE FROM actions WHERE id = ? AND providerGaii = ?');
  for (const { id } of actions) out.actions_deleted += del.run(id, name).changes;
  const work = settleErasedPartyWork(db, name, [], pseudonym, (id, writtenAt) => payerWhenWritten(db, id, writtenAt));
  out.work_cancelled = work.cancelled;
  out.work_returned = work.returned;
  out.work_kept = work.kept;
  out.work_deleted = work.deleted;
  out.own_lines_deleted = db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(name).changes;
  // The lines in other people's ledgers name the account by the bare name, its GHII or an agent of
  // it on this node, and only the ones older than the account that holds the name now were held.
  const nodes = (db.prepare('SELECT DISTINCT nodeId FROM ghiis').all() as { nodeId: string }[]).map(r => r.nodeId);
  const forms = nodes.map(node => `${name}@${node}`);
  out.naming_lines = pseudonymiseLedgerParty(db, erasedAccountParty(name, forms, pseudonym), { before: input.namingBefore });
  return out;
}
