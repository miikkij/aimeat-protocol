-- 0086_full_identity_on_evidence.sql
-- The move to the full identity, on positive evidence only. It replaces 0085 (migrate.ts SUPERSEDED):
-- a database that has not applied 0085 never runs it, and a database that did is brought here to the
-- same end state, as far as its data allows. Mirrors sqlite/schema-identity-backfill.ts.
--
-- WHAT MOVES. An action a person published in person, the work on it, a request a person made, and a
-- line of a person's own ledger were stored under the bare account name: the raw `sub` of an owner
-- session, and for a ledger line until 2026-08-16 (7d421d94a). Every route reads the full identity
-- (GHII) now. A row under a bare name moves to the GHII of the account that holds the name, when the
-- row is not older than that account.
--
-- POSITIVE EVIDENCE ONLY. A deleted username is released for reuse, so a row older than the account
-- that holds its name now may be that person's, or a previous holder's. Owner."createdAt" alone cannot
-- tell which: a copy or a restore of the database can move it. So:
--   - NO ACCOUNT HOLDS THE NAME NOW: the rows are a deleted account's, settled the way deleting an
--     account settles them (settleErasedPartyWorkDb in methods/owner-cascade.ts). Its actions go. Its
--     open work is cancelled, and what was held from the requester goes back only to an account that
--     existed when the row was written. Its finished work and a dispute on it stay for the other side
--     under one random `erased:` pseudonym, and its callback address goes. Its own ledger lines go.
--     The lines in other people's ledgers that name it take the same pseudonym.
--   - AN ACCOUNT HOLDS THE NAME, and the row is older than that account, or the account has no GHII
--     to move it to: HELD. The row stays exactly as it is, and the name is recorded with its counts.
--     At start the node opens one incident on the operator's Security page for what is recorded
--     (services/held-account-names.ts), and the operator decides each name there.
--
-- OTHER PEOPLE'S LEDGERS. A value in "counterpartyGaii" or "initiatorGaii" names an account of this
-- node by its bare name, by its GHII `name@node`, or by an agent or app of it `…#name@node`, where
-- `node` is one this node's accounts are under ("Ghii"."nodeId"). The rule above decides it by the
-- line's time: a line older than the account that holds the name now is held; a line of that account
-- stays as it is. A name no account holds is settled only when something ties it to a person: the
-- name stands bare where a person stands (an action, a side of work, the owner of a ledger line), a
-- line names the account in its full form, or a line naming it is about work whose one side already
-- carries a pseudonym. A value nothing ties to a person stays as it is, and is recorded.
-- Left out, as 0085 left them out: a pseudonym (`erased:`), a person of another node, a node's id,
-- and the two line types that name a node (relay_fee in services/morsel.ts, federation_settlement in
-- routes/federation-settlements.ts).
--
-- A DATABASE WHERE 0085 RAN keeps what 0085 did; nothing here can tell it apart from what an erasure
-- did. A line that still names a deleted account takes the pseudonym the work it is about already
-- carries, found by its tracking code, so the line and the work agree, and the other lines naming that
-- account take the same one. Every step here is idempotent: a second run changes nothing.
--
-- A BARE NAME has no `@` and no `#`, and does not start with `erased:`, the prefix of every pseudonym
-- an erasure writes (storage/erased-party.ts). No pseudonym is ever read as an account name.
--
-- WHAT IT RECORDS: "SystemSetting" `migration:0086:held`, the JSON
--   { at, held: [{ name, holder_since, holder_ghii, actions, work, own_lines, naming_lines }],
--     untied: [{ value, lines }] }
-- Times are this backend's stored wall-clock times, written without a zone, as every timestamp here
-- is read. Nothing in this file throws on data.

DO $$
DECLARE
    acc RECORD;
    w RECORD;
    v_pseudonym TEXT;
    v_payer TEXT;
    v_provider_gone BOOLEAN;
    v_requester_gone BOOLEAN;
    v_open BOOLEAN;
BEGIN
    -- 1. The names that stand bare where a person stands.
    CREATE TEMP TABLE m86_place ON COMMIT DROP AS
    SELECT DISTINCT f.name AS acct FROM (
        SELECT a."providerGaii" AS name FROM "Action" a
         WHERE strpos(a."actionId", ':') = 0
           AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
        UNION ALL SELECT "providerGaii" FROM "Work"
        UNION ALL SELECT "requesterGaii" FROM "Work"
        UNION ALL SELECT "gaii" FROM "Transaction"
    ) f
    WHERE f.name <> '' AND strpos(f.name, '@') = 0 AND strpos(f.name, '#') = 0 AND left(f.name, 7) <> 'erased:';

    -- 2. The values in other people's ledgers that name an account of this node.
    CREATE TEMP TABLE m86_value ON COMMIT DROP AS
    SELECT p.val, p.acct, p.node IS NOT NULL AS full_form
      FROM (
        SELECT x.val,
               CASE WHEN strpos(x.val, '#') > 0 THEN split_part(split_part(x.val, '#', 2), '@', 1)
                    WHEN strpos(x.val, '@') > 0 THEN split_part(x.val, '@', 1)
                    ELSE x.val END AS acct,
               NULLIF(split_part(x.val, '@', 2), '') AS node
          FROM (SELECT "counterpartyGaii" AS val FROM "Transaction"
                 WHERE "counterpartyGaii" IS NOT NULL AND "type" NOT IN ('relay_fee', 'federation_settlement')
                UNION
                SELECT "initiatorGaii" FROM "Transaction"
                 WHERE "initiatorGaii" IS NOT NULL AND "type" NOT IN ('relay_fee', 'federation_settlement')) x
         WHERE left(x.val, 7) <> 'erased:'
           AND (strpos(x.val, '#') = 0 OR strpos(x.val, '@') > strpos(x.val, '#'))
      ) p
     WHERE p.acct <> ''
       AND CASE WHEN p.node IS NULL
                THEN NOT EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = p.val)
                 AND NOT EXISTS (SELECT 1 FROM "FederationPeer" f WHERE f."nodeId" = p.val)
                ELSE EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = p.node) END;
    CREATE INDEX ON m86_value (val);

    -- 3. Every account named in either place, with the account that holds the name now. `tied` is the
    --    evidence that a name no account holds belonged to a person.
    CREATE TEMP TABLE m86_account ON COMMIT DROP AS
    SELECT n.acct,
           o."createdAt" AS holder_since,
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS holder_ghii,
           o."name" IS NOT NULL AS has_holder,
           (EXISTS (SELECT 1 FROM m86_place pl WHERE pl.acct = n.acct)
             OR EXISTS (SELECT 1 FROM m86_value v WHERE v.acct = n.acct AND v.full_form)) AS tied,
           NULL::text AS pseudonym
      FROM (SELECT acct FROM m86_place UNION SELECT acct FROM m86_value) n
      LEFT JOIN "Owner" o ON o."name" = n.acct;
    CREATE INDEX ON m86_account (acct);

    -- 4. What the account holding a name wrote, not before it existed: to its GHII. An action whose id
    --    that GHII already publishes stays where it is.
    UPDATE "Action" a SET "providerGaii" = m.holder_ghii
      FROM m86_account m
     WHERE a."providerGaii" = m.acct AND m.holder_ghii IS NOT NULL AND a."createdAt" >= m.holder_since
       AND strpos(a."actionId", ':') = 0
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
       AND NOT EXISTS (SELECT 1 FROM "Action" x WHERE x."providerGaii" = m.holder_ghii AND x."actionId" = a."actionId");
    UPDATE "Work" wr SET "providerGaii" = m.holder_ghii
      FROM m86_account m
     WHERE wr."providerGaii" = m.acct AND m.holder_ghii IS NOT NULL AND wr."createdAt" >= m.holder_since;
    UPDATE "Work" wr SET "requesterGaii" = m.holder_ghii
      FROM m86_account m
     WHERE wr."requesterGaii" = m.acct AND m.holder_ghii IS NOT NULL AND wr."createdAt" >= m.holder_since;
    UPDATE "Transaction" t SET "gaii" = m.holder_ghii
      FROM m86_account m
     WHERE t."gaii" = m.acct AND m.holder_ghii IS NOT NULL AND t."timestamp" >= m.holder_since;

    -- 5. A name no account holds is a deleted account's: its actions and its own ledger lines go.
    DELETE FROM "Action" a
     USING m86_account m
     WHERE a."providerGaii" = m.acct AND NOT m.has_holder
       AND strpos(a."actionId", ':') = 0
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%');
    DELETE FROM "Transaction" t
     USING m86_account m
     WHERE t."gaii" = m.acct AND NOT m.has_holder;

    -- 6. Its work, settled the way a deletion settles it, under one pseudonym for the account.
    FOR acc IN
        SELECT m.acct FROM m86_account m
         WHERE NOT m.has_holder
           AND (EXISTS (SELECT 1 FROM "Work" x WHERE x."providerGaii" = m.acct)
                OR EXISTS (SELECT 1 FROM "Work" x WHERE x."requesterGaii" = m.acct))
         ORDER BY m.acct
    LOOP
        v_pseudonym := 'erased:' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
        UPDATE m86_account SET pseudonym = v_pseudonym WHERE acct = acc.acct;
        FOR w IN SELECT * FROM "Work" WHERE "providerGaii" = acc.acct OR "requesterGaii" = acc.acct LOOP
            v_provider_gone := w."providerGaii" = acc.acct;
            v_requester_gone := w."requesterGaii" = acc.acct;
            IF v_provider_gone AND v_requester_gone THEN
                DELETE FROM "DisputeAudit" WHERE "disputeId" IN (SELECT "disputeId" FROM "Dispute" WHERE "trackingCode" = w."trackingCode");
                DELETE FROM "Dispute" WHERE "trackingCode" = w."trackingCode";
                DELETE FROM "Work" WHERE "id" = w."id";
                CONTINUE;
            END IF;

            v_open := w."status" IN ('pending', 'accepted', 'in_progress');
            IF v_open AND v_provider_gone AND w."costTotal" > 0 THEN
                -- The balance the morsels were held from: the requester's own GHII, or the GHII of the
                -- person an agent or an app acts for, found the way every balance op finds it, and only
                -- when that account existed when the row was written. An account registered later under
                -- the requester's name is somebody else, and nothing goes back.
                v_payer := CASE
                    WHEN strpos(w."requesterGaii", '#') > 0 THEN
                        (SELECT g."ghii" FROM "Ghii" g WHERE g."username" = split_part(split_part(w."requesterGaii", '#', 2), '@', 1) LIMIT 1)
                    WHEN strpos(w."requesterGaii", '@') > 0 THEN w."requesterGaii"
                    ELSE (SELECT g."ghii" FROM "Ghii" g WHERE g."username" = w."requesterGaii" LIMIT 1)
                END;
                IF v_payer IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM "Ghii" g JOIN "Owner" o ON o."name" = g."ownerName"
                     WHERE g."ghii" = v_payer AND o."createdAt" <= w."createdAt"
                ) THEN
                    v_payer := NULL;
                END IF;
                IF v_payer IS NOT NULL THEN
                    UPDATE "Ghii" SET "morselBalance" = COALESCE("morselBalance", 0) + w."costTotal" WHERE "ghii" = v_payer;
                    IF FOUND THEN
                        INSERT INTO "Transaction" ("txId", "gaii", "type", "amount", "counterpartyGaii", "trackingCode", "initiatorGaii", "timestamp")
                        VALUES ('tx-' || gen_random_uuid()::text, v_payer, 'escrow_return', w."costTotal", v_pseudonym, w."trackingCode",
                                CASE WHEN v_payer <> w."requesterGaii" THEN w."requesterGaii" END, LOCALTIMESTAMP);
                    END IF;
                END IF;
            END IF;

            UPDATE "Work" SET
                "status" = CASE WHEN v_open THEN 'cancelled' ELSE "status" END,
                "providerGaii" = CASE WHEN v_provider_gone THEN v_pseudonym ELSE "providerGaii" END,
                "requesterGaii" = CASE WHEN v_requester_gone THEN v_pseudonym ELSE "requesterGaii" END,
                "callbackUrl" = CASE WHEN v_requester_gone THEN NULL ELSE "callbackUrl" END,
                "updatedAt" = CASE WHEN v_open THEN LOCALTIMESTAMP ELSE "updatedAt" END
             WHERE "id" = w."id";
            UPDATE "Dispute" SET "openedBy" = v_pseudonym
             WHERE "trackingCode" = w."trackingCode" AND "openedBy" = acc.acct;
            UPDATE "DisputeAudit" SET "actor" = v_pseudonym
             WHERE "disputeId" IN (SELECT "disputeId" FROM "Dispute" WHERE "trackingCode" = w."trackingCode")
               AND "actor" = acc.acct;
        END LOOP;
    END LOOP;

    -- 7. The lines in other people's ledgers that this step decides: every line that names an account
    --    nobody holds, and every line older than the account that holds the name it names (held).
    --    `work_side` is the pseudonym the work a line is about already carries, when exactly one side of
    --    that work carries one.
    CREATE TEMP TABLE m86_line ON COMMIT DROP AS
    SELECT t."id" AS line_id, c.col, v.acct, t."trackingCode" AS tc, NULL::text AS work_side
      FROM "Transaction" t
     CROSS JOIN LATERAL (VALUES ('counterparty', t."counterpartyGaii"), ('initiator', t."initiatorGaii")) AS c(col, val)
      JOIN m86_value v ON v.val = c.val
      JOIN m86_account m ON m.acct = v.acct
     WHERE t."type" NOT IN ('relay_fee', 'federation_settlement')
       AND (NOT m.has_holder OR t."timestamp" < m.holder_since);
    UPDATE m86_line l
       SET work_side = CASE WHEN left(wk."providerGaii", 7) = 'erased:' THEN wk."providerGaii" ELSE wk."requesterGaii" END
      FROM "Work" wk, m86_account m
     WHERE wk."trackingCode" = l.tc AND m.acct = l.acct AND NOT m.has_holder
       AND (left(wk."providerGaii", 7) = 'erased:') <> (left(wk."requesterGaii", 7) = 'erased:');
    UPDATE m86_account m SET tied = true
     WHERE NOT m.has_holder AND NOT m.tied
       AND EXISTS (SELECT 1 FROM m86_line l WHERE l.acct = m.acct AND l.work_side IS NOT NULL);
    -- The account's pseudonym: the one its work took above, else the one its work already carries,
    -- else a new one.
    UPDATE m86_account m SET pseudonym = (SELECT min(l.work_side) FROM m86_line l WHERE l.acct = m.acct)
     WHERE NOT m.has_holder AND m.tied AND m.pseudonym IS NULL;
    UPDATE m86_account SET pseudonym = 'erased:' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)
     WHERE NOT has_holder AND tied AND pseudonym IS NULL;
    UPDATE "Transaction" t SET "counterpartyGaii" = COALESCE(l.work_side, m.pseudonym)
      FROM m86_line l JOIN m86_account m ON m.acct = l.acct
     WHERE t."id" = l.line_id AND l.col = 'counterparty' AND NOT m.has_holder AND m.tied;
    UPDATE "Transaction" t SET "initiatorGaii" = COALESCE(l.work_side, m.pseudonym)
      FROM m86_line l JOIN m86_account m ON m.acct = l.acct
     WHERE t."id" = l.line_id AND l.col = 'initiator' AND NOT m.has_holder AND m.tied;

    -- 8. What stays, recorded for the operator: each name an account holds that still has rows under
    --    its bare name, or older lines that name it, with the counts; and each value nothing ties to a
    --    person, with the lines that name it.
    INSERT INTO "SystemSetting" ("key", "value")
    SELECT 'migration:0086:held', jsonb_build_object(
        'at', to_char(LOCALTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
        'held', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'name', h.acct,
                       'holder_since', to_char(h.holder_since, 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
                       'holder_ghii', h.holder_ghii,
                       'actions', h.actions, 'work', h.work, 'own_lines', h.own_lines, 'naming_lines', h.naming_lines
                   ) ORDER BY h.acct)
              FROM (
                SELECT m.acct, m.holder_since, m.holder_ghii,
                       COALESCE(ca.n, 0) AS actions, COALESCE(cw.n, 0) AS work,
                       COALESCE(co.n, 0) AS own_lines, COALESCE(cl.n, 0) AS naming_lines
                  FROM m86_account m
                  LEFT JOIN (SELECT a."providerGaii" AS acct, count(*) AS n FROM "Action" a
                              WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0
                                AND strpos(a."actionId", ':') = 0
                                AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
                              GROUP BY 1) ca ON ca.acct = m.acct
                  LEFT JOIN (SELECT s.acct, count(DISTINCT s.id) AS n FROM (
                                SELECT "id", "providerGaii" AS acct FROM "Work" WHERE strpos("providerGaii", '@') = 0 AND strpos("providerGaii", '#') = 0
                                UNION ALL
                                SELECT "id", "requesterGaii" FROM "Work" WHERE strpos("requesterGaii", '@') = 0 AND strpos("requesterGaii", '#') = 0) s
                              GROUP BY 1) cw ON cw.acct = m.acct
                  LEFT JOIN (SELECT "gaii" AS acct, count(*) AS n FROM "Transaction"
                              WHERE strpos("gaii", '@') = 0 AND strpos("gaii", '#') = 0
                              GROUP BY 1) co ON co.acct = m.acct
                  LEFT JOIN (SELECT l.acct, count(DISTINCT l.line_id) AS n FROM m86_line l GROUP BY 1) cl ON cl.acct = m.acct
                 WHERE m.has_holder
              ) h
             WHERE h.actions + h.work + h.own_lines + h.naming_lines > 0), '[]'::jsonb),
        'untied', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('value', u.acct, 'lines', u.lines) ORDER BY u.acct)
              FROM (SELECT m.acct, count(DISTINCT l.line_id) AS lines
                      FROM m86_account m JOIN m86_line l ON l.acct = m.acct
                     WHERE NOT m.has_holder AND NOT m.tied
                     GROUP BY m.acct) u), '[]'::jsonb)
    )::text
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
END $$;
