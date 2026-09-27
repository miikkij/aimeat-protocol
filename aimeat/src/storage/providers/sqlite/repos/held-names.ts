/**
 * @file src/storage/providers/sqlite/repos/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for what the move to the full identity and the start step for the cortexes
 *   and ecosystem apps of deleted accounts left for the operator: the records (system_settings keys
 *   HELD_NAMES_RECORD_KEY and HELD_INSTALLS_RECORD_KEY), the start step, and the operator's decision
 *   on one held name. The boot half of the move (schema-identity-backfill.ts) writes its record and
 *   uses payerWhenWritten; methods/held-names.ts calls the rest. A free function over the connection,
 *   like the other erasure repos, so it runs before a provider instance exists; the per-identity
 *   cascade is handed in by the caller, which owns it. The Postgres twin is methods/held-names.ts in
 *   its provider.
 * @structure
 *   - payerWhenWritten(db, identity, writtenAt) — whose balance a held request goes back to
 *   - readHeldNamesRecord(db, key) / writeHeldNamesRecord(db, record, key)
 *   - settleInstallsIn(db, input, cascade) — the start step, in the caller's transaction
 *   - resolveHeldNameIn(db, input, cascade) — the decision on one name, in the caller's transaction
 * @version-history
 *   v1.1.0 — 2026-09-26 — settleInstallsIn, the start step for the cortexes and ecosystem apps of
 *     deleted accounts; a 'previous' decision deletes the cortexes and apps older than the account that
 *     holds the name, and `rows` / `installs` say which kinds a decision covers. The record functions
 *     take the key.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type Database from 'better-sqlite3';
import { erasedPartyPseudonym, erasedAccountParty, leavingAppsParty, ERASED_PARTY_PREFIX } from '../../../erased-party.js';
import { HELD_NAMES_RECORD_KEY, HELD_INSTALLS_RECORD_KEY } from '../../../repositories/held-names.repository.js';
import {
  emptyHeldNameOutcome, type HeldAccountName, type HeldNamesRecord, type HeldNameOutcome, type HeldNameResolution,
} from '../../../types/held-names.js';
import { settleErasedPartyWork, settleLeavingPartyWork, type WorkErasureResult } from './work-erasure.js';
import { pseudonymiseLedgerParty } from './ledger-erasure.js';
import { deleteEcosystemApps } from './eco-app-erasure.js';
import { deleteInstalledCortexes } from './cortex-erasure.js';
import { resolveGhiiIn } from './ghii-resolve.js';
import { validateOwnerName } from '../../../../utils/gaii.js';

/** An action of this node rather than a copy of another node's (id `<node>:<id>`, tag `federated:<node>`). */
export const LOCAL_ACTION = `instr(actions.id, ':') = 0 AND actions.tags NOT LIKE '%"federated:%'`;

/** A bare account name: no node, no agent, and not a pseudonym an erasure wrote. */
export const bare = (column: string): string =>
  `instr(${column}, '@') = 0 AND instr(${column}, '#') = 0`
  + ` AND substr(${column}, 1, ${ERASED_PARTY_PREFIX.length}) <> '${ERASED_PARTY_PREFIX}'`;

/** The per-identity cascade the caller owns (SqliteStorage.cascadeDeleteAgentData). */
export type IdentityCascade = (identity: string) => void;

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

/** A record (by default the move's), or null when it recorded nothing. A value that does not parse throws. */
export function readHeldNamesRecord(db: Database.Database, key: string = HELD_NAMES_RECORD_KEY): HeldNamesRecord | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as HeldNamesRecord;
  } catch (err) {
    throw new Error(`The record ${key} does not parse: ${(err as Error).message}`, { cause: err });
  }
}

export function writeHeldNamesRecord(db: Database.Database, record: HeldNamesRecord, key: string = HELD_NAMES_RECORD_KEY): void {
  db.prepare(
    `INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')`,
  ).run(key, JSON.stringify(record));
}

/** The GHII an account named `name` has or had here: one per node id a GHII row carries, and this node's. */
function ghiiForms(db: Database.Database, name: string, nodeId?: string): string[] {
  const nodes = (db.prepare('SELECT DISTINCT nodeId FROM ghiis').all() as { nodeId: string }[]).map(r => r.nodeId);
  return [...new Set([...(nodeId ? [nodeId] : []), ...nodes])].map(node => `${name}@${node}`);
}

/**
 * Ecosystem apps that leave without their account, as the account deletion takes them: the work each
 * one is a side of is settled by the erasure's rule under `pseudonym` (held morsels back only to an
 * account that existed when the row was written), then each app goes with what it holds, its record
 * and its recipes (deleteEcosystemApps; `everyRecipe` as there), and the lines in other people's
 * ledgers that name it take the pseudonym.
 */
function eraseEcosystemApps(
  db: Database.Database, owner: string, geais: string[], pseudonym: string, cascade: IdentityCascade,
  opts: { everyRecipe?: boolean } = {},
): { apps: number; work: WorkErasureResult; lines: number } {
  if (geais.length === 0) return { apps: 0, work: { cancelled: 0, returned: 0, kept: 0, deleted: 0 }, lines: 0 };
  const party = leavingAppsParty(geais, pseudonym);
  const work = settleLeavingPartyWork(db, party, (id, writtenAt) => payerWhenWritten(db, id, writtenAt));
  const apps = deleteEcosystemApps(db, owner, geais, cascade, opts);
  const lines = pseudonymiseLedgerParty(db, party);
  return { apps, work, lines };
}

/**
 * The start step, in the caller's transaction. The rule is written on the repository
 * (HeldAccountNameRepository.settleInstallsOfDeletedAccounts); in short, for each name a cortex was
 * installed under or an ecosystem app connected under: no account holds it, and they go as the account
 * deletion takes them; an account holds it and a row is older than that account, and the row stays
 * and is recorded; otherwise nothing. Returns the record it wrote, or null when it ran before.
 */
export function settleInstallsIn(db: Database.Database, input: { nodeId: string }, cascade: IdentityCascade): HeldNamesRecord | null {
  if (db.prepare('SELECT 1 FROM system_settings WHERE key = ?').get(HELD_INSTALLS_RECORD_KEY)) return null;
  // Only a value an account can be registered under names an account. The node's own installs
  // (`system@<node>`) and a reserved word are nobody's account, and stay as they are.
  const names = [...new Set([
    ...(db.prepare('SELECT DISTINCT installedBy AS name FROM cortex_extensions').all() as { name: string }[]).map(r => r.name),
    ...(db.prepare('SELECT DISTINCT owner AS name FROM ecosystem_apps').all() as { name: string }[]).map(r => r.name),
  ])].filter(n => validateOwnerName(n) === null).sort();

  const held: HeldAccountName[] = [];
  const deleted = { names: 0, cortexes: 0, ecosystem_apps: 0 };
  for (const name of names) {
    const holder = db.prepare('SELECT createdAt FROM owners WHERE name = ?').get(name) as { createdAt: string } | undefined;
    if (!holder) {
      // No account holds the name: what is stored under it is a deleted account's, and goes as the
      // account deletion takes an account's apps and cortexes, under one new pseudonym for the name.
      const geais = (db.prepare('SELECT geai FROM ecosystem_apps WHERE owner = ?').all(name) as { geai: string }[]).map(r => r.geai);
      const apps = eraseEcosystemApps(db, name, geais, erasedPartyPseudonym(), cascade, { everyRecipe: true });
      const cortexes = deleteInstalledCortexes(db, name, ghiiForms(db, name, input.nodeId));
      if (apps.apps || cortexes) deleted.names++;
      deleted.ecosystem_apps += apps.apps;
      deleted.cortexes += cortexes;
      continue;
    }
    // An account holds the name: a row older than that account may be a previous holder's.
    const cortexes = (db.prepare('SELECT COUNT(*) AS n FROM cortex_extensions WHERE installedBy = ? AND installedAt < ?')
      .get(name, holder.createdAt) as { n: number }).n;
    const apps = (db.prepare('SELECT COUNT(*) AS n FROM ecosystem_apps WHERE owner = ? AND createdAt < ?')
      .get(name, holder.createdAt) as { n: number }).n;
    if (cortexes === 0 && apps === 0) continue;
    const ghii = db.prepare('SELECT ghii FROM ghiis WHERE ownerName = ?').get(name) as { ghii: string } | undefined;
    held.push({
      name, holder_since: holder.createdAt, holder_ghii: ghii?.ghii ?? null,
      actions: 0, work: 0, own_lines: 0, naming_lines: 0, cortexes, ecosystem_apps: apps,
    });
  }
  const record: HeldNamesRecord = { at: new Date().toISOString(), held, untied: [], deleted };
  db.prepare("INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))")
    .run(HELD_INSTALLS_RECORD_KEY, JSON.stringify(record));
  return record;
}

/**
 * The operator's decision on one held name, in the caller's transaction. The rule is written on the
 * repository (HeldAccountNameRepository.resolveHeldAccountName); in short:
 *   - 'holder': the bare name's local actions, work sides and own lines move to the holder's GHII, and
 *     the cortexes and ecosystem apps older than the holder's account stay;
 *   - 'previous': they are settled as deleting a previous holder's account would have settled them,
 *     the older lines in other people's ledgers that name the account take the same pseudonym, and the
 *     older cortexes and apps go as the start step takes a deleted account's.
 * Everything under the bare name is what the move left: every route writes the full identity now.
 */
export function resolveHeldNameIn(db: Database.Database, input: {
  name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
  nodeId?: string; rows?: boolean; installs?: boolean;
}, cascade: IdentityCascade): HeldNameOutcome {
  const { name } = input;
  const rows = input.rows !== false;
  const installs = input.installs !== false;
  const out = emptyHeldNameOutcome();
  const actions = rows ? db.prepare(`SELECT id FROM actions WHERE providerGaii = ? AND ${LOCAL_ACTION}`).all(name) as { id: string }[] : [];

  if (input.resolution === 'holder') {
    // The cortexes and ecosystem apps older than the holder's account are the holder's: they stay.
    if (!rows) return out;
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
  // The lines in other people's ledgers name the account by the bare name, its GHII or an agent or app
  // of it on this node, and only the ones older than the account that holds the name now were held.
  const forms = ghiiForms(db, name, input.nodeId);
  if (rows) {
    const del = db.prepare('DELETE FROM actions WHERE id = ? AND providerGaii = ?');
    for (const { id } of actions) out.actions_deleted += del.run(id, name).changes;
    const work = settleErasedPartyWork(db, name, [], pseudonym, (id, writtenAt) => payerWhenWritten(db, id, writtenAt));
    out.work_cancelled = work.cancelled;
    out.work_returned = work.returned;
    out.work_kept = work.kept;
    out.work_deleted = work.deleted;
    out.own_lines_deleted = db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(name).changes;
    out.naming_lines = pseudonymiseLedgerParty(db, erasedAccountParty(name, forms, pseudonym), { before: input.namingBefore });
  }
  if (installs) {
    // The ecosystem apps and cortexes older than the holder's account, as the start step takes a
    // deleted account's.
    const geais = (db.prepare('SELECT geai FROM ecosystem_apps WHERE owner = ? AND createdAt < ?')
      .all(name, input.namingBefore) as { geai: string }[]).map(r => r.geai);
    const apps = eraseEcosystemApps(db, name, geais, pseudonym, cascade);
    out.ecosystem_apps_deleted = apps.apps;
    out.work_cancelled += apps.work.cancelled;
    out.work_returned += apps.work.returned;
    out.work_kept += apps.work.kept;
    out.work_deleted += apps.work.deleted;
    out.naming_lines += apps.lines;
    const cortexNames = (db.prepare('SELECT name FROM cortex_extensions WHERE installedBy = ? AND installedAt < ?')
      .all(name, input.namingBefore) as { name: string }[]).map(r => r.name);
    out.cortexes_deleted = deleteInstalledCortexes(db, name, forms, { names: cortexNames });
  }
  return out;
}
