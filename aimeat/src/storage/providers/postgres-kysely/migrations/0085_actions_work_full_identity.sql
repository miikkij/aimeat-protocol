-- 0085_actions_work_full_identity.sql
-- An action a person publishes is stored under their full identity (GHII), like an agent's under
-- its GAII, and so is the work on it and a request a person makes: every work door compares the
-- full identity (routes/actions.ts, routes/work.ts). Rows written before carry the bare account
-- name, and no door finds them under it. This moves them.
--
-- WHICH ACCOUNT. A row moves only to an account that existed when the row was written. A deleted
-- username is released for reuse, so a row older than the account holding its name now belonged to a
-- person whose account is gone. That person's rows are handled the way deleting their account
-- handles them (settleErasedPartyWorkDb in methods/owner-cascade.ts):
--   - their actions go;
--   - their open work is cancelled, and when they were the one to do it, the morsels held from the
--     requester go back with an escrow_return line in the requester's ledger, when the requester's
--     account existed when the row was written; to an account registered later, nothing goes back;
--   - their finished work stays for the other side, with their side under a random `erased:`
--     pseudonym, one per person; their callback address goes, and so does their name in a dispute
--     on it. The dispute log's hashes stay as they were stored;
--   - the lines in other people's ledgers that name them, by the bare name, the GHII or an agent or
--     app acting for them, as counterparty or as the one who acted, take the same pseudonym. A
--     ledger line carries no hash of its own.
-- A copy of another node's action (id `<node>:<id>`, tag `federated:<node>`) names a person of that
-- node and is left as it is.
--
-- A BARE NAME has no `@` and no `#`, and does not start with `erased:`. A value that starts with
-- `erased:` is a pseudonym an erasure wrote in place of a person (storage/erased-party.ts,
-- ERASED_PARTY_PREFIX). It has no `@` and no `#` either, so every step leaves it out by name, and
-- no pseudonym is ever read as an account name or changed.
--
-- Mirrors sqlite/schema-identity-backfill.ts, which SQLite runs once for each database and records
-- in system_settings, as this runner records this file in "_kysely_migrations".

-- 1. Actions of an account that held the name when they were written, to that account's GHII.
WITH target AS (
    SELECT a."id", a."actionId",
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS ghii
    FROM "Action" a
    JOIN "Owner" o ON o."name" = a."providerGaii" AND o."createdAt" <= a."createdAt"
    WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0 AND left(a."providerGaii", 7) <> 'erased:'
      AND strpos(a."actionId", ':') = 0
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
)
UPDATE "Action" a SET "providerGaii" = t.ghii
FROM target t
WHERE a."id" = t."id" AND t.ghii IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Action" x WHERE x."providerGaii" = t.ghii AND x."actionId" = t."actionId");

-- 2. The actions of an account that is gone.
DELETE FROM "Action" a
WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0 AND left(a."providerGaii", 7) <> 'erased:'
  AND strpos(a."actionId", ':') = 0
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
  AND NOT EXISTS (SELECT 1 FROM "Owner" o WHERE o."name" = a."providerGaii" AND o."createdAt" <= a."createdAt");

-- 3. Work, each side the same way.
UPDATE "Work" w SET "providerGaii" = t.ghii
FROM (
    SELECT w2."id",
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS ghii
    FROM "Work" w2
    JOIN "Owner" o ON o."name" = w2."providerGaii" AND o."createdAt" <= w2."createdAt"
    WHERE strpos(w2."providerGaii", '@') = 0 AND strpos(w2."providerGaii", '#') = 0 AND left(w2."providerGaii", 7) <> 'erased:'
) t
WHERE w."id" = t."id" AND t.ghii IS NOT NULL;

UPDATE "Work" w SET "requesterGaii" = t.ghii
FROM (
    SELECT w2."id",
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS ghii
    FROM "Work" w2
    JOIN "Owner" o ON o."name" = w2."requesterGaii" AND o."createdAt" <= w2."createdAt"
    WHERE strpos(w2."requesterGaii", '@') = 0 AND strpos(w2."requesterGaii", '#') = 0 AND left(w2."requesterGaii", 7) <> 'erased:'
) t
WHERE w."id" = t."id" AND t.ghii IS NOT NULL;

-- 4. What is left under a bare name belonged to an account that is gone: every row when nobody holds
--    the name now, the rows older than the account when somebody does. Settled the way a deletion
--    settles it.
-- 5. Then the lines in other people's ledgers that name such an account, with the same pseudonym.
DO $$
DECLARE
    person RECORD;
    w RECORD;
    a RECORD;
    cutoff TIMESTAMP(3);
    pseudonym TEXT;
    -- One pseudonym for each deleted account, by its account name: its work (4) and its ledger lines
    -- (5) name it by the same one.
    pseudonyms JSONB := '{}'::jsonb;
    payer TEXT;
    provider_gone BOOLEAN;
    requester_gone BOOLEAN;
    is_open BOOLEAN;
BEGIN
    FOR person IN
        SELECT "providerGaii" AS name FROM "Work"
        WHERE strpos("providerGaii", '@') = 0 AND strpos("providerGaii", '#') = 0 AND left("providerGaii", 7) <> 'erased:'
        UNION
        SELECT "requesterGaii" FROM "Work"
        WHERE strpos("requesterGaii", '@') = 0 AND strpos("requesterGaii", '#') = 0 AND left("requesterGaii", 7) <> 'erased:'
    LOOP
        cutoff := (SELECT o."createdAt" FROM "Owner" o WHERE o."name" = person.name);
        pseudonym := 'erased:' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
        pseudonyms := pseudonyms || jsonb_build_object(person.name, pseudonym);
        FOR w IN
            SELECT * FROM "Work"
            WHERE ("providerGaii" = person.name OR "requesterGaii" = person.name)
              AND (cutoff IS NULL OR "createdAt" < cutoff)
        LOOP
            provider_gone := w."providerGaii" = person.name;
            requester_gone := w."requesterGaii" = person.name;
            IF provider_gone AND requester_gone THEN
                DELETE FROM "DisputeAudit" WHERE "disputeId" IN (SELECT "disputeId" FROM "Dispute" WHERE "trackingCode" = w."trackingCode");
                DELETE FROM "Dispute" WHERE "trackingCode" = w."trackingCode";
                DELETE FROM "Work" WHERE "id" = w."id";
                CONTINUE;
            END IF;

            is_open := w."status" IN ('pending', 'accepted', 'in_progress');
            IF is_open AND provider_gone AND w."costTotal" > 0 THEN
                -- The balance the morsels were held from: the requester's own GHII, or the GHII of the
                -- person an agent or an app acts for, found the way every balance op finds it.
                payer := CASE
                    WHEN strpos(w."requesterGaii", '#') > 0 THEN
                        (SELECT g."ghii" FROM "Ghii" g WHERE g."username" = split_part(split_part(w."requesterGaii", '#', 2), '@', 1) LIMIT 1)
                    WHEN strpos(w."requesterGaii", '@') > 0 THEN w."requesterGaii"
                    ELSE (SELECT g."ghii" FROM "Ghii" g WHERE g."username" = w."requesterGaii" LIMIT 1)
                END;
                -- Only to an account that existed when the row was written. A name is released for
                -- reuse, so an account registered after the row under the requester's name is
                -- somebody else, and nothing goes back, as for a requester whose account is gone.
                IF payer IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM "Ghii" g JOIN "Owner" o ON o."name" = g."ownerName"
                    WHERE g."ghii" = payer AND o."createdAt" <= w."createdAt"
                ) THEN
                    payer := NULL;
                END IF;
                IF payer IS NOT NULL THEN
                    UPDATE "Ghii" SET "morselBalance" = COALESCE("morselBalance", 0) + w."costTotal" WHERE "ghii" = payer;
                    IF FOUND THEN
                        INSERT INTO "Transaction" ("txId", "gaii", "type", "amount", "counterpartyGaii", "trackingCode", "initiatorGaii", "timestamp")
                        VALUES ('tx-' || gen_random_uuid()::text, payer, 'escrow_return', w."costTotal", pseudonym, w."trackingCode",
                                CASE WHEN payer <> w."requesterGaii" THEN w."requesterGaii" END, LOCALTIMESTAMP);
                    END IF;
                END IF;
            END IF;

            UPDATE "Work" SET
                "status" = CASE WHEN is_open THEN 'cancelled' ELSE "status" END,
                "providerGaii" = CASE WHEN provider_gone THEN pseudonym ELSE "providerGaii" END,
                "requesterGaii" = CASE WHEN requester_gone THEN pseudonym ELSE "requesterGaii" END,
                "callbackUrl" = CASE WHEN requester_gone THEN NULL ELSE "callbackUrl" END,
                "updatedAt" = CASE WHEN is_open THEN LOCALTIMESTAMP ELSE "updatedAt" END
            WHERE "id" = w."id";
            UPDATE "Dispute" SET "openedBy" = pseudonym
            WHERE "trackingCode" = w."trackingCode" AND "openedBy" = person.name;
            UPDATE "DisputeAudit" SET "actor" = pseudonym
            WHERE "disputeId" IN (SELECT "disputeId" FROM "Dispute" WHERE "trackingCode" = w."trackingCode")
              AND "actor" = person.name;
        END LOOP;
    END LOOP;

    -- 5. Every value in "counterpartyGaii" or "initiatorGaii" that names an account of this node: a
    --    bare name, a GHII `name@node` or an agent or app `…#name@node`, where `node` is one this
    --    node's accounts are under ("Ghii"."nodeId"). Left out: a pseudonym (`erased:`), a person of
    --    another node, the two line types that name a node rather than a person (relay_fee in
    --    services/morsel.ts, federation_settlement in routes/federation-settlements.ts), and a bare
    --    value that is a node's id. The account counts as deleted for a line by the rule of step 4:
    --    nobody holds the name now, or the line is older than the account that does.
    CREATE TEMP TABLE erased_ledger_value ON COMMIT DROP AS
    SELECT p.val, p.acct, o."createdAt" AS holder_since, NULL::text AS given
      FROM (
        SELECT x.val,
               CASE WHEN strpos(x.val, '#') > 0 THEN split_part(split_part(x.val, '#', 2), '@', 1)
                    WHEN strpos(x.val, '@') > 0 THEN split_part(x.val, '@', 1)
                    ELSE x.val END AS acct,
               NULLIF(split_part(x.val, '@', 2), '') AS node
          FROM (
            SELECT "counterpartyGaii" AS val FROM "Transaction"
             WHERE "counterpartyGaii" IS NOT NULL AND "type" NOT IN ('relay_fee', 'federation_settlement')
            UNION
            SELECT "initiatorGaii" FROM "Transaction"
             WHERE "initiatorGaii" IS NOT NULL AND "type" NOT IN ('relay_fee', 'federation_settlement')
          ) x
         WHERE left(x.val, 7) <> 'erased:'
           AND (strpos(x.val, '#') = 0 OR strpos(x.val, '@') > strpos(x.val, '#'))
      ) p
      LEFT JOIN "Owner" o ON o."name" = p.acct
     WHERE p.acct <> ''
       AND CASE WHEN p.node IS NULL
                THEN NOT EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = p.val)
                 AND NOT EXISTS (SELECT 1 FROM "FederationPeer" f WHERE f."nodeId" = p.val)
                ELSE EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = p.node) END;

    -- One pseudonym for each account, whichever form names it: the one step 4 gave its work, or a
    -- new one when it had no work under its bare name.
    FOR a IN SELECT DISTINCT acct FROM erased_ledger_value LOOP
        pseudonym := COALESCE(pseudonyms ->> a.acct, 'erased:' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
        pseudonyms := pseudonyms || jsonb_build_object(a.acct, pseudonym);
        UPDATE erased_ledger_value SET given = pseudonym WHERE acct = a.acct;
    END LOOP;

    UPDATE "Transaction" t SET "counterpartyGaii" = e.given
      FROM erased_ledger_value e
     WHERE t."counterpartyGaii" = e.val
       AND t."type" NOT IN ('relay_fee', 'federation_settlement')
       AND (e.holder_since IS NULL OR t."timestamp" < e.holder_since);
    UPDATE "Transaction" t SET "initiatorGaii" = e.given
      FROM erased_ledger_value e
     WHERE t."initiatorGaii" = e.val
       AND t."type" NOT IN ('relay_fee', 'federation_settlement')
       AND (e.holder_since IS NULL OR t."timestamp" < e.holder_since);
END $$;
