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
--     requester go back with an escrow_return line in the requester's ledger;
--   - their finished work stays for the other side, with their side under a random `erased:`
--     pseudonym, one per person; their callback address goes, and so does their name in a dispute
--     on it. The dispute log's hashes stay as they were stored.
-- A copy of another node's action (id `<node>:<id>`, tag `federated:<node>`) names a person of that
-- node and is left as it is.
--
-- Mirrors sqlite/schema-identity-backfill.ts, which SQLite runs on every open.

-- 1. Actions of an account that held the name when they were written, to that account's GHII.
WITH target AS (
    SELECT a."id", a."actionId",
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS ghii
    FROM "Action" a
    JOIN "Owner" o ON o."name" = a."providerGaii" AND o."createdAt" <= a."createdAt"
    WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0
      AND strpos(a."actionId", ':') = 0
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
)
UPDATE "Action" a SET "providerGaii" = t.ghii
FROM target t
WHERE a."id" = t."id" AND t.ghii IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Action" x WHERE x."providerGaii" = t.ghii AND x."actionId" = t."actionId");

-- 2. The actions of an account that is gone.
DELETE FROM "Action" a
WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0
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
    WHERE strpos(w2."providerGaii", '@') = 0 AND strpos(w2."providerGaii", '#') = 0
) t
WHERE w."id" = t."id" AND t.ghii IS NOT NULL;

UPDATE "Work" w SET "requesterGaii" = t.ghii
FROM (
    SELECT w2."id",
           (SELECT g."ghii" FROM "Ghii" g WHERE g."ownerName" = o."name" ORDER BY g."createdAt" LIMIT 1) AS ghii
    FROM "Work" w2
    JOIN "Owner" o ON o."name" = w2."requesterGaii" AND o."createdAt" <= w2."createdAt"
    WHERE strpos(w2."requesterGaii", '@') = 0 AND strpos(w2."requesterGaii", '#') = 0
) t
WHERE w."id" = t."id" AND t.ghii IS NOT NULL;

-- 4. What is left under a bare name belonged to an account that is gone: every row when nobody holds
--    the name now, the rows older than the account when somebody does. Settled the way a deletion
--    settles it.
DO $$
DECLARE
    person RECORD;
    w RECORD;
    cutoff TIMESTAMP(3);
    pseudonym TEXT;
    payer TEXT;
    provider_gone BOOLEAN;
    requester_gone BOOLEAN;
    is_open BOOLEAN;
BEGIN
    FOR person IN
        SELECT "providerGaii" AS name FROM "Work" WHERE strpos("providerGaii", '@') = 0 AND strpos("providerGaii", '#') = 0
        UNION
        SELECT "requesterGaii" FROM "Work" WHERE strpos("requesterGaii", '@') = 0 AND strpos("requesterGaii", '#') = 0
    LOOP
        cutoff := (SELECT o."createdAt" FROM "Owner" o WHERE o."name" = person.name);
        pseudonym := 'erased:' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
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
END $$;
