/**
 * @file src/storage/providers/sqlite/schema-identity-backfill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite half of Postgres migration 0086: the move to the full identity, on positive
 *   evidence only. Actions a person published in person, the work on them, the requests a person made
 *   and the lines of a person's own ledger move from the bare account name to the person's GHII.
 *
 *   ONCE FOR EACH DATABASE. schema.ts calls it on every open, and it runs only when system_settings
 *   has no FULL_IDENTITY_RECORD row. It writes that row in the same IMMEDIATE transaction as the move,
 *   so a database is moved once, as the Postgres runner applies a file once. The half of 0085 that ran
 *   here before is gone: a database that has not run it never runs it, and a database that did is
 *   brought to the same end state by this one, as far as its data allows.
 *
 *   POSITIVE EVIDENCE ONLY. The rule, and why, is written in full on the Postgres file
 *   (migrations/0086_full_identity_on_evidence.sql); this mirrors it step for step:
 *   - a row not older than the account that holds its name now moves to that account's GHII;
 *   - a name no account holds is a deleted account's: its actions and its own lines go, its work is
 *     settled the way deleting it settles work (repos/work-erasure.ts), held morsels go back only to
 *     an account that existed when the row was written (payerWhenWritten), and the lines in other
 *     people's ledgers that name it take its one pseudonym, or the pseudonym the work a line is about
 *     already carries;
 *   - a row older than the account that holds its name now (or of an account with no GHII) is HELD:
 *     left exactly as it is, and recorded with its counts under HELD_NAMES_RECORD_KEY for the
 *     operator (services/held-account-names.ts opens the incident at start);
 *   - a ledger value no account holds and nothing ties to a person stays, and is recorded too.
 *
 *   A PSEUDONYM IS NEVER A NAME. A value that starts with ERASED_PARTY_PREFIX has no `@` and no `#`,
 *   like an account name, so the test for a bare name leaves it out by name.
 * @structure
 *   - FULL_IDENTITY_RECORD: the system_settings row that says a database has been moved
 *   - moveActionsAndWorkToFullIdentity(db): the move, once for each database
 * @usage moveActionsAndWorkToFullIdentity(db);   // from initializeSchema in schema.ts
 * @version-history
 *   v2.0.0 — 2026-09-26 — The half of 0086: the move acts on positive evidence only. A name no account
 *     holds is settled as a deleted account's; a row older than the account that holds its name now is
 *     left as it is and recorded for the operator; a line filed under the bare name moves or goes by
 *     the same rule; a line that still names a deleted account takes the pseudonym its work carries.
 *     Runs under its own record (FULL_IDENTITY_RECORD); the half of 0085 no longer runs.
 *   v1.3.0 — 2026-09-26 — The lines in other people's ledgers that name a deleted account take the
 *     pseudonym its work takes, as counterparty and as the one who acted (settleDeletedAccountsLedger).
 *     Mirrors step 5 of Postgres 0085.
 *   v1.2.0 — 2026-09-26 — Held morsels go back only to an account that existed when the row was
 *     written (payerWhenWritten; secaudit 2026-09: R3 7b). Mirrors Postgres 0085.
 *   v1.1.0 — 2026-09-26 — Runs once for each database and records that it ran
 *     (IDENTITY_BACKFILL_RECORD), and a value that starts with ERASED_PARTY_PREFIX is never read as an
 *     account name (secaudit 2026-09: R3 7a). Mirrors Postgres 0085.
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09: N6, F-1). Mirrors Postgres 0085.
 */
import type Database from 'better-sqlite3';
import { erasedPartyPseudonym, ERASED_PARTY_PREFIX } from '../../erased-party.js';
import type { HeldAccountName, UntiedLedgerValue } from '../../types/held-names.js';
import { settleErasedPartyWork } from './repos/work-erasure.js';
import { LOCAL_ACTION, bare, payerWhenWritten, writeHeldNamesRecord } from './repos/held-names.js';

/**
 * The system_settings row that says this database has been moved, named after the Postgres file
 * this mirrors. Outside the `config:` keys, so no config read sees it.
 */
export const FULL_IDENTITY_RECORD = 'migration:0086_full_identity_on_evidence.sql';

/**
 * The ledger line types whose counterparty is a node, never a person: relay_fee (services/morsel.ts)
 * and federation_settlement (routes/federation-settlements.ts).
 */
const NODE_LINE_TYPES = `('relay_fee', 'federation_settlement')`;

const ERASED = `'${ERASED_PARTY_PREFIX}'`;
const ERASED_LEN = ERASED_PARTY_PREFIX.length;

/** Steps 1-3: the names in play, each with the account that holds it now. Temp tables m86_*. */
function nameTheAccounts(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE m86_place AS
    SELECT DISTINCT name AS acct FROM (
      SELECT providerGaii AS name FROM actions WHERE ${LOCAL_ACTION}
      UNION ALL SELECT providerGaii FROM work
      UNION ALL SELECT requesterGaii FROM work
      UNION ALL SELECT gaii FROM wallet_transactions)
    WHERE name <> '' AND ${bare('name')};

    CREATE TEMP TABLE m86_value AS
    SELECT p.val AS val, p.acct AS acct, p.node IS NOT NULL AS fullForm FROM (
      SELECT x.val,
             CASE WHEN instr(x.val, '#') > 0 THEN substr(x.val, instr(x.val, '#') + 1, instr(x.val, '@') - instr(x.val, '#') - 1)
                  WHEN instr(x.val, '@') > 0 THEN substr(x.val, 1, instr(x.val, '@') - 1)
                  ELSE x.val END AS acct,
             CASE WHEN instr(x.val, '@') > 0 THEN substr(x.val, instr(x.val, '@') + 1) END AS node
        FROM (SELECT counterpartyGaii AS val FROM wallet_transactions
               WHERE counterpartyGaii IS NOT NULL AND type NOT IN ${NODE_LINE_TYPES}
              UNION
              SELECT initiatorGaii FROM wallet_transactions
               WHERE initiatorGaii IS NOT NULL AND type NOT IN ${NODE_LINE_TYPES}) x
       WHERE substr(x.val, 1, ${ERASED_LEN}) <> ${ERASED}
         AND (instr(x.val, '#') = 0 OR instr(x.val, '@') > instr(x.val, '#'))
    ) p
    WHERE p.acct <> ''
      AND CASE WHEN p.node IS NULL
               THEN NOT EXISTS (SELECT 1 FROM ghiis g WHERE g.nodeId = p.val)
                AND NOT EXISTS (SELECT 1 FROM federation_peers f WHERE f.nodeId = p.val)
               ELSE EXISTS (SELECT 1 FROM ghiis g WHERE g.nodeId = p.node) END;
    CREATE INDEX temp.m86_value_val ON m86_value (val);

    CREATE TEMP TABLE m86_account AS
    SELECT n.acct AS acct,
           o.createdAt AS holderSince,
           (SELECT g.ghii FROM ghiis g WHERE g.ownerName = o.name ORDER BY g.createdAt LIMIT 1) AS holderGhii,
           o.name IS NOT NULL AS hasHolder,
           (EXISTS (SELECT 1 FROM m86_place pl WHERE pl.acct = n.acct)
             OR EXISTS (SELECT 1 FROM m86_value v WHERE v.acct = n.acct AND v.fullForm)) AS tied,
           NULL AS pseudonym
      FROM (SELECT acct FROM m86_place UNION SELECT acct FROM m86_value) n
      LEFT JOIN owners o ON o.name = n.acct;
    CREATE INDEX temp.m86_account_acct ON m86_account (acct);
  `);
}

/** Step 4: what the account holding a name wrote, not before it existed, to its GHII. */
function moveToTheHolder(db: Database.Database): void {
  db.exec(`
    UPDATE actions SET providerGaii = m.holderGhii
      FROM m86_account m
     WHERE actions.providerGaii = m.acct AND m.holderGhii IS NOT NULL AND actions.createdAt >= m.holderSince
       AND ${LOCAL_ACTION}
       AND NOT EXISTS (SELECT 1 FROM actions x WHERE x.id = actions.id AND x.providerGaii = m.holderGhii);
    UPDATE work SET providerGaii = m.holderGhii
      FROM m86_account m
     WHERE work.providerGaii = m.acct AND m.holderGhii IS NOT NULL AND work.createdAt >= m.holderSince;
    UPDATE work SET requesterGaii = m.holderGhii
      FROM m86_account m
     WHERE work.requesterGaii = m.acct AND m.holderGhii IS NOT NULL AND work.createdAt >= m.holderSince;
    UPDATE wallet_transactions SET gaii = m.holderGhii
      FROM m86_account m
     WHERE wallet_transactions.gaii = m.acct AND m.holderGhii IS NOT NULL AND wallet_transactions.timestamp >= m.holderSince;
  `);
}

/** Steps 5-6: a name no account holds is a deleted account's. */
function settleTheDeleted(db: Database.Database): void {
  db.exec(`
    DELETE FROM actions WHERE ${LOCAL_ACTION} AND providerGaii IN (SELECT acct FROM m86_account WHERE NOT hasHolder);
    DELETE FROM wallet_transactions WHERE gaii IN (SELECT acct FROM m86_account WHERE NOT hasHolder);
  `);
  const withWork = db.prepare(
    `SELECT acct FROM m86_account m
      WHERE NOT hasHolder
        AND (EXISTS (SELECT 1 FROM work x WHERE x.providerGaii = m.acct) OR EXISTS (SELECT 1 FROM work x WHERE x.requesterGaii = m.acct))
      ORDER BY acct`,
  ).all() as { acct: string }[];
  const setPseudonym = db.prepare('UPDATE m86_account SET pseudonym = ? WHERE acct = ?');
  for (const { acct } of withWork) {
    const pseudonym = erasedPartyPseudonym();
    setPseudonym.run(pseudonym, acct);
    settleErasedPartyWork(db, acct, [], pseudonym, (id, writtenAt) => payerWhenWritten(db, id, writtenAt));
  }
}

/** Step 7: the lines in other people's ledgers that name a deleted account, and the held ones. */
function settleTheLedger(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE m86_line (lineId TEXT, col TEXT, acct TEXT, tc TEXT, workSide TEXT);
    INSERT INTO m86_line (lineId, col, acct, tc)
    SELECT t.id, 'counterparty', v.acct, t.trackingCode
      FROM wallet_transactions t JOIN m86_value v ON v.val = t.counterpartyGaii JOIN m86_account m ON m.acct = v.acct
     WHERE t.type NOT IN ${NODE_LINE_TYPES} AND (NOT m.hasHolder OR t.timestamp < m.holderSince);
    INSERT INTO m86_line (lineId, col, acct, tc)
    SELECT t.id, 'initiator', v.acct, t.trackingCode
      FROM wallet_transactions t JOIN m86_value v ON v.val = t.initiatorGaii JOIN m86_account m ON m.acct = v.acct
     WHERE t.type NOT IN ${NODE_LINE_TYPES} AND (NOT m.hasHolder OR t.timestamp < m.holderSince);
    UPDATE m86_line
       SET workSide = CASE WHEN substr(wk.providerGaii, 1, ${ERASED_LEN}) = ${ERASED} THEN wk.providerGaii ELSE wk.requesterGaii END
      FROM work wk, m86_account m
     WHERE wk.trackingCode = m86_line.tc AND m.acct = m86_line.acct AND NOT m.hasHolder
       AND (substr(wk.providerGaii, 1, ${ERASED_LEN}) = ${ERASED}) <> (substr(wk.requesterGaii, 1, ${ERASED_LEN}) = ${ERASED});
    UPDATE m86_account SET tied = 1
     WHERE NOT hasHolder AND NOT tied
       AND EXISTS (SELECT 1 FROM m86_line l WHERE l.acct = m86_account.acct AND l.workSide IS NOT NULL);
    UPDATE m86_account SET pseudonym = (SELECT min(l.workSide) FROM m86_line l WHERE l.acct = m86_account.acct)
     WHERE NOT hasHolder AND tied AND pseudonym IS NULL;
    UPDATE m86_account SET pseudonym = ${ERASED} || lower(hex(randomblob(12)))
     WHERE NOT hasHolder AND tied AND pseudonym IS NULL;
    UPDATE wallet_transactions SET counterpartyGaii = COALESCE(l.workSide, m.pseudonym)
      FROM m86_line l JOIN m86_account m ON m.acct = l.acct
     WHERE wallet_transactions.id = l.lineId AND l.col = 'counterparty' AND NOT m.hasHolder AND m.tied;
    UPDATE wallet_transactions SET initiatorGaii = COALESCE(l.workSide, m.pseudonym)
      FROM m86_line l JOIN m86_account m ON m.acct = l.acct
     WHERE wallet_transactions.id = l.lineId AND l.col = 'initiator' AND NOT m.hasHolder AND m.tied;
  `);
}

/** Step 8: what stays, for the operator. */
function whatStays(db: Database.Database): { held: HeldAccountName[]; untied: UntiedLedgerValue[] } {
  const held = db.prepare(`
    SELECT m.acct AS name, m.holderSince AS holder_since, m.holderGhii AS holder_ghii,
           COALESCE(ca.n, 0) AS actions, COALESCE(cw.n, 0) AS work, COALESCE(co.n, 0) AS own_lines, COALESCE(cl.n, 0) AS naming_lines
      FROM m86_account m
      LEFT JOIN (SELECT providerGaii AS acct, count(*) AS n FROM actions WHERE ${bare('providerGaii')} AND ${LOCAL_ACTION} GROUP BY providerGaii) ca ON ca.acct = m.acct
      LEFT JOIN (SELECT acct, count(DISTINCT tc) AS n FROM (
                   SELECT trackingCode AS tc, providerGaii AS acct FROM work WHERE ${bare('providerGaii')}
                   UNION ALL SELECT trackingCode, requesterGaii FROM work WHERE ${bare('requesterGaii')})
                 GROUP BY acct) cw ON cw.acct = m.acct
      LEFT JOIN (SELECT gaii AS acct, count(*) AS n FROM wallet_transactions WHERE ${bare('gaii')} GROUP BY gaii) co ON co.acct = m.acct
      LEFT JOIN (SELECT acct, count(DISTINCT lineId) AS n FROM m86_line GROUP BY acct) cl ON cl.acct = m.acct
     WHERE m.hasHolder
     ORDER BY m.acct
  `).all() as HeldAccountName[];
  const untied = db.prepare(`
    SELECT m.acct AS value, count(DISTINCT l.lineId) AS lines
      FROM m86_account m JOIN m86_line l ON l.acct = m.acct
     WHERE NOT m.hasHolder AND NOT m.tied
     GROUP BY m.acct ORDER BY m.acct
  `).all() as UntiedLedgerValue[];
  return { held: held.filter(h => h.actions + h.work + h.own_lines + h.naming_lines > 0), untied };
}

/**
 * The move to the full identity on positive evidence, once for each database. The row that says so
 * and the record of what it left are written in the same transaction as the move.
 */
export function moveActionsAndWorkToFullIdentity(db: Database.Database): void {
  const run = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM system_settings WHERE key = ?').get(FULL_IDENTITY_RECORD)) return;
    nameTheAccounts(db);
    moveToTheHolder(db);
    settleTheDeleted(db);
    settleTheLedger(db);
    const { held, untied } = whatStays(db);
    db.exec('DROP TABLE temp.m86_line; DROP TABLE temp.m86_account; DROP TABLE temp.m86_value; DROP TABLE temp.m86_place;');
    const now = new Date().toISOString();
    writeHeldNamesRecord(db, { at: now, held, untied });
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run(FULL_IDENTITY_RECORD, now);
  });
  // IMMEDIATE takes the write lock before the row is read, so two processes opening one file at the
  // same time do not both move it: the second waits (busy_timeout), then reads the row.
  run.immediate();
}
