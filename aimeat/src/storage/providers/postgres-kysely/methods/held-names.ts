/**
 * @file src/storage/providers/postgres-kysely/methods/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HeldAccountNameRepository on Postgres: the record migration 0086 wrote of what it left
 *   for the operator ("SystemSetting" key HELD_NAMES_RECORD_KEY), and the operator's decision on one
 *   name, in one transaction. The rule is written on the repository interface; the SQLite twin is
 *   repos/held-names.ts in that provider. A decision settles a previous holder's rows through the
 *   erasure's own functions (methods/owner-cascade.ts), so a deletion and a decision cannot drift.
 * @structure heldNameMethods — getHeldNamesRecord · saveHeldNamesRecord · resolveHeldAccountName
 * @usage Object.assign(PostgresKyselyStorage.prototype, heldNameMethods) in providers/postgres-kysely/index.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { HELD_NAMES_RECORD_KEY } from '../../../repositories/held-names.repository.js';
import { emptyHeldNameOutcome, type HeldNamesRecord, type HeldNameOutcome, type HeldNameResolution } from '../../../types/held-names.js';
import { erasedPartyPseudonym, erasedAccountParty } from '../../../erased-party.js';
import { settleLeavingPartyWorkDb, pseudonymiseLedgerPartyDb } from './work-ledger-erasure.js';

/**
 * What these methods use of the provider: its handle and its transaction. Named here rather than
 * importing the provider class, which imports this file (an import cycle, check:deps).
 */
interface ProviderHandle {
  readonly db: Kysely<DB>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** An action of this node rather than a copy of another node's (id `<node>:<id>`, tag `federated:<node>`). */
const isLocalAction = (a: { actionId: string; tags: string[] | null }): boolean =>
  !a.actionId.includes(':') && !(a.tags ?? []).some(t => t.startsWith('federated:'));

export const heldNameMethods = {
  async getHeldNamesRecord(this: ProviderHandle): Promise<HeldNamesRecord | null> {
    const row = await this.db.selectFrom('SystemSetting').select('value').where('key', '=', HELD_NAMES_RECORD_KEY).executeTakeFirst();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as HeldNamesRecord;
    } catch (err) {
      throw new Error(`The record ${HELD_NAMES_RECORD_KEY} does not parse: ${(err as Error).message}`, { cause: err });
    }
  },

  async saveHeldNamesRecord(this: ProviderHandle, record: HeldNamesRecord): Promise<void> {
    const value = JSON.stringify(record);
    await this.db.insertInto('SystemSetting').values({ key: HELD_NAMES_RECORD_KEY, value })
      .onConflict(oc => oc.column('key').doUpdateSet({ value })).execute();
  },

  async resolveHeldAccountName(this: ProviderHandle, input: {
    name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
  }): Promise<HeldNameOutcome> {
    return this.transaction(async () => {
      const db = this.db;
      const { name } = input;
      const out = emptyHeldNameOutcome();
      const actions = (await db.selectFrom('Action').select(['id', 'actionId', 'tags']).where('providerGaii', '=', name).execute())
        .filter(isLocalAction);

      if (input.resolution === 'holder') {
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
      // The lines in other people's ledgers name the account by the bare name, its GHII or an agent of
      // it on this node, and only the ones older than the account that holds the name now were held.
      const nodes = await db.selectFrom('Ghii').select('nodeId').distinct().execute();
      const forms = nodes.map(n => `${name}@${n.nodeId}`);
      out.naming_lines = await pseudonymiseLedgerPartyDb(db, erasedAccountParty(name, forms, pseudonym), { before: new Date(input.namingBefore) });
      return out;
    });
  },
};
