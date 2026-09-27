-- precheck-0085-full-identity.sql
-- Read-only checks for the production database, for the deploy that brings migration
-- 0085_actions_work_full_identity.sql (src/storage/providers/postgres-kysely/migrations/). Nothing
-- here writes: every statement is a SELECT, inside a READ ONLY transaction that ends in ROLLBACK.
--
-- WHEN TO RUN IT: once, on the production database, before the deploy, while the node still runs the
-- version before 0085. 0085 runs at the first start of the new version, and a restart does not undo it.
--   psql "$DATABASE_URL" -X -f aimeat/scripts/precheck-0085-full-identity.sql
-- IF A RESULT IS WRONG: do not deploy. Keep the node on the version it runs, and take the output to
-- the developer. Each check below says what its right result is and what a wrong one means.
--
-- What 0085 does, in short: an action a person published in person, the work on it and a request a
-- person made move from the bare account name to the person's GHII, but only to an account that
-- existed when the row was written. A row older than the account that holds its name now is taken
-- as a deleted account's: its actions are deleted, its open work is cancelled, and its finished work
-- is kept under an `erased:` pseudonym. The lines in other people's ledgers that name a deleted
-- account take the same pseudonym. So everything depends on "Owner"."createdAt" being the time each
-- account was really created.

BEGIN TRANSACTION READ ONLY;

-- 1. The rows 0085 would take as a deleted account's although an account holds the name now: rows
--    stored under a bare account name that are older than the account holding that name.
--    RIGHT RESULT: no rows, or only names that really were deleted and registered again, each with
--    `account_created` later than `newest_row`, the person who holds the name now being somebody
--    else than the one who wrote the rows.
--    WRONG RESULT: a name whose person never deleted their account. Their account's createdAt is then
--    later than their own rows, and 0085 would delete their actions, cancel their open work and put
--    their finished work under a pseudonym. Do not deploy.
SELECT 'Action' AS kind, a."providerGaii" AS name, o."createdAt" AS account_created,
       min(a."createdAt") AS oldest_row, max(a."createdAt") AS newest_row, count(*) AS row_count
  FROM "Action" a
  JOIN "Owner" o ON o."name" = a."providerGaii"
 WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0
   AND left(a."providerGaii", 7) <> 'erased:'
   AND strpos(a."actionId", ':') = 0
   AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
   AND a."createdAt" < o."createdAt"
 GROUP BY a."providerGaii", o."createdAt"
UNION ALL
SELECT 'Work', x.name, o."createdAt", min(x."createdAt"), max(x."createdAt"), count(*)
  FROM (SELECT "providerGaii" AS name, "createdAt" FROM "Work"
        UNION ALL
        SELECT "requesterGaii", "createdAt" FROM "Work") x
  JOIN "Owner" o ON o."name" = x.name
 WHERE strpos(x.name, '@') = 0 AND strpos(x.name, '#') = 0
   AND left(x.name, 7) <> 'erased:'
   AND x."createdAt" < o."createdAt"
 GROUP BY x.name, o."createdAt"
 ORDER BY 2, 1;

-- 1b. The lines in other people's ledgers that 0085 gives a deleted account's pseudonym, by account
--    name: the lines whose counterparty, or the one who acted, names the account by its bare name, its
--    GHII or an agent or app of it, and are older than the account that holds the name now, or have
--    no account holding it. A line counts once, whichever of its two columns names the account.
--    RIGHT RESULT: only accounts that were deleted: `no account holds the name` for a name nobody took
--    again, `registered again` with `account_created` later than `newest_line` for a name somebody
--    took later. No rows when no account that had ledger lines was ever deleted.
--    WRONG RESULT: a name that is not a deleted account: a person who still has their account (their
--    createdAt is then later than lines that name them), a node, or a name this node uses for itself.
--    0085 would write a pseudonym over it in other people's ledgers. Do not deploy.
SELECT p.acct AS name,
       CASE WHEN o."name" IS NULL THEN 'no account holds the name' ELSE 'registered again' END AS state,
       o."createdAt" AS account_created,
       count(DISTINCT t."id") AS line_count, min(t."timestamp") AS oldest_line, max(t."timestamp") AS newest_line
  FROM "Transaction" t
 CROSS JOIN LATERAL (VALUES (t."counterpartyGaii"), (t."initiatorGaii")) AS c(val)
 CROSS JOIN LATERAL (
       SELECT CASE WHEN strpos(c.val, '#') > 0 THEN split_part(split_part(c.val, '#', 2), '@', 1)
                   WHEN strpos(c.val, '@') > 0 THEN split_part(c.val, '@', 1)
                   ELSE c.val END AS acct,
              NULLIF(split_part(c.val, '@', 2), '') AS node) p
  LEFT JOIN "Owner" o ON o."name" = p.acct
 WHERE c.val IS NOT NULL
   AND t."type" NOT IN ('relay_fee', 'federation_settlement')
   AND left(c.val, 7) <> 'erased:'
   AND (strpos(c.val, '#') = 0 OR strpos(c.val, '@') > strpos(c.val, '#'))
   AND p.acct <> ''
   AND CASE WHEN p.node IS NULL
            THEN NOT EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = c.val)
             AND NOT EXISTS (SELECT 1 FROM "FederationPeer" f WHERE f."nodeId" = c.val)
            ELSE EXISTS (SELECT 1 FROM "Ghii" g WHERE g."nodeId" = p.node) END
   AND (o."name" IS NULL OR t."timestamp" < o."createdAt")
 GROUP BY p.acct, o."name", o."createdAt"
 ORDER BY 1;

-- 2. Pseudonyms an erasure has already written into Work.
--    RIGHT RESULT: 0 is what a node on 3.18.0 shows, because that version writes no pseudonym into
--    Work. Any other number is also safe: 0085 leaves every value that starts with `erased:` as it
--    is, so no pseudonym already written changes. A number above 0 says only that this database has
--    run a version that settles work when an account is deleted.
SELECT count(*) AS pseudonyms_in_work
  FROM "Work"
 WHERE left("providerGaii", 7) = 'erased:' OR left("requesterGaii", 7) = 'erased:';

-- 3a. The stored hook bindings, as they are stored.
-- 3b. The same, one row per reference, with the form each reference is in.
--    RIGHT RESULT: any list. A reference in the form `id#<account name>` names an action a person
--    published in person. At the first start of the new version, after 0085 has moved that action to
--    the person's GHII, the node stores the reference as `id#<GHII>`, once. Such a reference whose
--    action 0085 does not move (see check 1) stays as it is, and the Hooks page shows it as naming no
--    published action: bind that moment again after the deploy.
--    WRONG RESULT: 3b fails with a JSON error while 3a lists the values. One stored value is not a
--    JSON list, and the node ignores it at start. Not a reason to stop the deploy; show it to the
--    developer.
SELECT "key", "value"
  FROM "SystemSetting"
 WHERE "key" LIKE 'config:hooks.%'
 ORDER BY "key";

SELECT s."key", r.ref,
       CASE
         WHEN strpos(r.ref, '#') = 0 THEN 'bare id: pinned to id#provider, or taken off, at the first start'
         WHEN strpos(substr(r.ref, strpos(r.ref, '#') + 1), '@') = 0
          AND strpos(substr(r.ref, strpos(r.ref, '#') + 1), '#') = 0 THEN 'id#<account name>: moved to id#<GHII> at the first start'
         ELSE 'id#<full identity>: stays as it is'
       END AS form
  FROM "SystemSetting" s
 CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN s."value" ~ '^\s*\[.*\]\s*$' THEN s."value"::jsonb ELSE '[]'::jsonb END) AS r(ref)
 WHERE s."key" LIKE 'config:hooks.%'
 ORDER BY s."key", r.ref;

ROLLBACK;
