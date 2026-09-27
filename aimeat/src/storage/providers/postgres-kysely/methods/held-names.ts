/**
 * @file src/storage/providers/postgres-kysely/methods/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HeldAccountNameRepository on Postgres: the records of what migration 0086 and the start
 *   step for the cortexes and ecosystem apps of deleted accounts left for the operator ("SystemSetting"
 *   keys HELD_NAMES_RECORD_KEY and HELD_INSTALLS_RECORD_KEY), the start step itself, and the
 *   operator's decision on one name, each in one transaction. The rule is written on the repository
 *   interface; the SQLite twin is repos/held-names.ts in that provider. The start step and a decision
 *   settle a deleted or previous holder's rows through the erasure's own functions
 *   (work-ledger-erasure.ts, identity-erasure.ts), so a deletion, the start step and a decision cannot
 *   drift.
 * @structure heldNameMethods — getHeldNamesRecord · saveHeldNamesRecord · settleInstallsOfDeletedAccounts ·
 *   resolveHeldAccountName
 * @usage Object.assign(PostgresKyselyStorage.prototype, heldNameMethods) in providers/postgres-kysely/index.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — settleInstallsOfDeletedAccounts, the start step for the cortexes and
 *     ecosystem apps of deleted accounts; a 'previous' decision deletes the cortexes and apps older
 *     than the account that holds the name, and `rows` / `installs` say which kinds a decision covers.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { HELD_NAMES_RECORD_KEY, HELD_INSTALLS_RECORD_KEY } from '../../../repositories/held-names.repository.js';
import {
  emptyHeldNameOutcome, type HeldAccountName, type HeldNamesRecord, type HeldNameOutcome, type HeldNameResolution,
} from '../../../types/held-names.js';
import { erasedPartyPseudonym, erasedAccountParty, leavingAppsParty } from '../../../erased-party.js';
import { validateOwnerName } from '../../../../utils/gaii.js';
import { settleLeavingPartyWorkDb, pseudonymiseLedgerPartyDb } from './work-ledger-erasure.js';
import { deleteEcosystemAppsDb, deleteInstalledCortexesDb } from './identity-erasure.js';

/**
 * What these methods use of the provider: its handle and its transaction. Named here rather than
 * importing the provider class, which imports this file (an import cycle, check:deps).
 */
interface ProviderHandle {
  readonly db: Kysely<DB>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

type Db = Kysely<DB>;

/** An action of this node rather than a copy of another node's (id `<node>:<id>`, tag `federated:<node>`). */
const isLocalAction = (a: { actionId: string; tags: string[] | null }): boolean =>
  !a.actionId.includes(':') && !(a.tags ?? []).some(t => t.startsWith('federated:'));

/** A stored time as the move writes it: the wall-clock time without a zone (0086). */
const wallClock = (column: string) => sql<string>`to_char(${sql.ref(column)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`;

/** The GHII an account named `name` has or had here: one per node id a GHII row carries, and this node's. */
async function ghiiForms(db: Db, name: string, nodeId?: string): Promise<string[]> {
  const nodes = (await db.selectFrom('Ghii').select('nodeId').distinct().execute()).map(n => n.nodeId);
  return [...new Set([...(nodeId ? [nodeId] : []), ...nodes])].map(node => `${name}@${node}`);
}

/**
 * Ecosystem apps that leave without their account, as the account deletion takes them: the work each
 * one is a side of is settled by the erasure's rule under `pseudonym` (held morsels back only to an
 * account that existed when the row was written), then each app goes with what it holds, its record
 * and its recipes (deleteEcosystemAppsDb; `everyRecipe` as there), and the lines in other people's
 * ledgers that name it take the pseudonym.
 */
async function eraseEcosystemAppsDb(
  db: Db, owner: string, geais: string[], pseudonym: string, opts: { everyRecipe?: boolean } = {},
): Promise<{ apps: number; work: { cancelled: number; returned: number; kept: number; deleted: number }; lines: number }> {
  if (geais.length === 0) return { apps: 0, work: { cancelled: 0, returned: 0, kept: 0, deleted: 0 }, lines: 0 };
  const party = leavingAppsParty(geais, pseudonym);
  const work = await settleLeavingPartyWorkDb(db, party, { onlyToAccountsThen: true });
  const apps = await deleteEcosystemAppsDb(db, owner, geais, opts);
  const lines = await pseudonymiseLedgerPartyDb(db, party);
  return { apps, work, lines };
}

export const heldNameMethods = {
  async getHeldNamesRecord(this: ProviderHandle, key: string = HELD_NAMES_RECORD_KEY): Promise<HeldNamesRecord | null> {
    const row = await this.db.selectFrom('SystemSetting').select('value').where('key', '=', key).executeTakeFirst();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as HeldNamesRecord;
    } catch (err) {
      throw new Error(`The record ${key} does not parse: ${(err as Error).message}`, { cause: err });
    }
  },

  async saveHeldNamesRecord(this: ProviderHandle, record: HeldNamesRecord, key: string = HELD_NAMES_RECORD_KEY): Promise<void> {
    const value = JSON.stringify(record);
    await this.db.insertInto('SystemSetting').values({ key, value })
      .onConflict(oc => oc.column('key').doUpdateSet({ value })).execute();
  },

  async settleInstallsOfDeletedAccounts(this: ProviderHandle, input: { nodeId: string }): Promise<HeldNamesRecord | null> {
    return this.transaction(async () => {
      const db = this.db;
      // Two nodes that start on one database run it one after the other; the second finds the record.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${HELD_INSTALLS_RECORD_KEY}))`.execute(db);
      if (await db.selectFrom('SystemSetting').select('key').where('key', '=', HELD_INSTALLS_RECORD_KEY).executeTakeFirst()) return null;

      // Only a value an account can be registered under names an account. The node's own installs
      // (`system@<node>`) and a reserved word are nobody's account, and stay as they are.
      const names = [...new Set([
        ...(await db.selectFrom('CortexExtension').select('installedBy').distinct().execute()).map(r => r.installedBy),
        ...(await db.selectFrom('EcosystemApp').select('owner').distinct().execute()).map(r => r.owner),
      ])].filter(n => validateOwnerName(n) === null).sort();

      const held: HeldAccountName[] = [];
      const deleted = { names: 0, cortexes: 0, ecosystem_apps: 0 };
      for (const name of names) {
        const holder = await db.selectFrom('Owner').select(wallClock('createdAt').as('since'))
          .where('name', '=', name).executeTakeFirst();
        if (!holder) {
          // No account holds the name: what is stored under it is a deleted account's, and goes as the
          // account deletion takes an account's apps and cortexes, under one new pseudonym for the name.
          const geais = (await db.selectFrom('EcosystemApp').select('geai').where('owner', '=', name).execute()).map(r => r.geai);
          const apps = await eraseEcosystemAppsDb(db, name, geais, erasedPartyPseudonym(), { everyRecipe: true });
          const cortexes = await deleteInstalledCortexesDb(db, name, await ghiiForms(db, name, input.nodeId));
          if (apps.apps || cortexes) deleted.names++;
          deleted.ecosystem_apps += apps.apps;
          deleted.cortexes += cortexes;
          continue;
        }
        // An account holds the name: a row older than that account may be a previous holder's.
        const since = db.selectFrom('Owner').select('createdAt').where('name', '=', name);
        const cortexes = (await db.selectFrom('CortexExtension').select(eb => eb.fn.countAll<string>().as('n'))
          .where('installedBy', '=', name).where('installedAt', '<', since).executeTakeFirst())?.n ?? '0';
        const apps = (await db.selectFrom('EcosystemApp').select(eb => eb.fn.countAll<string>().as('n'))
          .where('owner', '=', name).where('createdAt', '<', since).executeTakeFirst())?.n ?? '0';
        if (Number(cortexes) === 0 && Number(apps) === 0) continue;
        const ghii = await db.selectFrom('Ghii').select('ghii').where('ownerName', '=', name).executeTakeFirst();
        held.push({
          name, holder_since: holder.since, holder_ghii: ghii?.ghii ?? null,
          actions: 0, work: 0, own_lines: 0, naming_lines: 0, cortexes: Number(cortexes), ecosystem_apps: Number(apps),
        });
      }

      const at = (await sql<{ at: string }>`SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS at`.execute(db)).rows[0].at;
      const record: HeldNamesRecord = { at, held, untied: [], deleted };
      await db.insertInto('SystemSetting').values({ key: HELD_INSTALLS_RECORD_KEY, value: JSON.stringify(record) }).execute();
      return record;
    });
  },

  async resolveHeldAccountName(this: ProviderHandle, input: {
    name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
    nodeId?: string; rows?: boolean; installs?: boolean;
  }): Promise<HeldNameOutcome> {
    return this.transaction(async () => {
      const db = this.db;
      const { name } = input;
      const rows = input.rows !== false;
      const installs = input.installs !== false;
      const out = emptyHeldNameOutcome();
      const actions = rows
        ? (await db.selectFrom('Action').select(['id', 'actionId', 'tags']).where('providerGaii', '=', name).execute()).filter(isLocalAction)
        : [];

      if (input.resolution === 'holder') {
        // The cortexes and ecosystem apps older than the holder's account are the holder's: they stay.
        if (!rows) return out;
        const ghii = input.holderGhii;
        if (!ghii) throw new Error('A held name is moved to its holder only when the holder has a full identity.');
        for (const a of actions) {
          const taken = await db.selectFrom('Action').select('id')
            .where('providerGaii', '=', ghii).where('actionId', '=', a.actionId).executeTakeFirst();
          if (taken) { out.actions_left++; continue; }
          await db.updateTable('Action').set({ providerGaii: ghii }).where('id', '=', a.id).execute();
          out.actions_moved++;
        }
        const sides = await db.selectFrom('Work').select('id')
          .where(eb => eb.or([eb('providerGaii', '=', name), eb('requesterGaii', '=', name)])).execute();
        await db.updateTable('Work').set({ providerGaii: ghii }).where('providerGaii', '=', name).execute();
        await db.updateTable('Work').set({ requesterGaii: ghii }).where('requesterGaii', '=', name).execute();
        out.work_moved = sides.length;
        const lines = await db.updateTable('Transaction').set({ gaii: ghii }).where('gaii', '=', name).executeTakeFirst();
        out.own_lines_moved = Number(lines.numUpdatedRows ?? 0);
        return out;
      }

      // A previous holder's: one new pseudonym for the rows this decision settles.
      const pseudonym = erasedPartyPseudonym();
      const before = new Date(input.namingBefore);
      // The lines in other people's ledgers name the account by the bare name, its GHII or an agent or
      // app of it on this node, and only the ones older than the account that holds the name now were held.
      const forms = await ghiiForms(db, name, input.nodeId);
      if (rows) {
        if (actions.length) {
          const gone = await db.deleteFrom('Action').where('id', 'in', actions.map(a => a.id)).executeTakeFirst();
          out.actions_deleted = Number(gone.numDeletedRows ?? 0);
        }
        const work = await settleLeavingPartyWorkDb(db, erasedAccountParty(name, [], pseudonym), { onlyToAccountsThen: true });
        out.work_cancelled = work.cancelled;
        out.work_returned = work.returned;
        out.work_kept = work.kept;
        out.work_deleted = work.deleted;
        const own = await db.deleteFrom('Transaction').where('gaii', '=', name).executeTakeFirst();
        out.own_lines_deleted = Number(own.numDeletedRows ?? 0);
        out.naming_lines = await pseudonymiseLedgerPartyDb(db, erasedAccountParty(name, forms, pseudonym), { before });
      }
      if (installs) {
        // The ecosystem apps and cortexes older than the holder's account, as the start step takes a
        // deleted account's.
        const geais = (await db.selectFrom('EcosystemApp').select('geai')
          .where('owner', '=', name).where('createdAt', '<', before).execute()).map(r => r.geai);
        const apps = await eraseEcosystemAppsDb(db, name, geais, pseudonym);
        out.ecosystem_apps_deleted = apps.apps;
        out.work_cancelled += apps.work.cancelled;
        out.work_returned += apps.work.returned;
        out.work_kept += apps.work.kept;
        out.work_deleted += apps.work.deleted;
        out.naming_lines += apps.lines;
        const cortexNames = (await db.selectFrom('CortexExtension').select('name')
          .where('installedBy', '=', name).where('installedAt', '<', before).execute()).map(r => r.name);
        out.cortexes_deleted = await deleteInstalledCortexesDb(db, name, forms, { names: cortexNames });
      }
      return out;
    });
  },
};
