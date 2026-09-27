-- precheck-0085-full-identity.sql
-- A read-only diagnostic for the developer: what the move to the full identity does, or did, to a
-- Postgres database. Nothing here writes: every statement is a SELECT, inside a READ ONLY
-- transaction that ends in ROLLBACK.
--
-- THE DEPLOY NEEDS NO MANUAL STEP, and this is not one. The move runs by itself when the node starts
-- (migrations/0086_full_identity_on_evidence.sql, which replaces 0085 through migrate.ts SUPERSEDED),
-- it acts only on positive evidence, and the node always starts. What it cannot place stays as it is
-- and becomes one incident on the operator's Security page, where the operator decides each name
-- (services/held-account-names.ts). Run this only to see, before or after a start, what the move
-- does with a copy of a database:
--   psql "$DATABASE_URL" -X -f aimeat/scripts/precheck-0085-full-identity.sql
--
-- What the move does, in short. A row stored under a bare account name (an action a person published
-- in person, a side of work, a line of the person's own ledger):
--   - moves to the GHII of the account that holds the name, when the row is not older than it;
--   - is settled as a deleted account's when NO account holds the name now: actions deleted, open
--     work cancelled (held morsels back only to an account that existed when the row was written),
--     finished work and the lines naming the account under one pseudonym, its own lines deleted;
--   - stays as it is, and is listed on the Security page, when an account holds the name but the row
--     is older than that account: it may be that person's, or a previous holder's.
-- On a database where 0085 already ran, the rows it settled stay settled; 0086 gives the lines that
-- still name a deleted account the pseudonym its work carries.

BEGIN TRANSACTION READ ONLY;

-- 1. Every name that has rows under its bare form, and what the move does with them.
--    `no account holds the name`: settled as a deleted account's.
--    `older than the account that holds the name`: left as they are, listed on the Security page.
--    `the account holds the name, not older`: moved to its GHII (or left and listed, when the account
--    has no GHII to move them to).
SELECT kind, name,
       CASE WHEN account_created IS NULL THEN 'no account holds the name: settled as a deleted account''s'
            WHEN newest_row < account_created THEN 'older than the account that holds the name: left, and listed on the Security page'
            WHEN oldest_row < account_created THEN 'partly older: the older rows are left and listed, the rest move'
            ELSE 'the account holds the name, not older: moved to its GHII' END AS what_happens,
       account_created, oldest_row, newest_row, row_count
  FROM (
    SELECT 'Action' AS kind, a."providerGaii" AS name, o."createdAt" AS account_created,
           min(a."createdAt") AS oldest_row, max(a."createdAt") AS newest_row, count(*) AS row_count
      FROM "Action" a
      LEFT JOIN "Owner" o ON o."name" = a."providerGaii"
     WHERE strpos(a."providerGaii", '@') = 0 AND strpos(a."providerGaii", '#') = 0
       AND left(a."providerGaii", 7) <> 'erased:'
       AND strpos(a."actionId", ':') = 0
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(a."tags", ARRAY[]::text[])) AS t(tag) WHERE t.tag LIKE 'federated:%')
     GROUP BY a."providerGaii", o."createdAt"
    UNION ALL
    SELECT 'Work', x.name, o."createdAt", min(x."createdAt"), max(x."createdAt"), count(*)
      FROM (SELECT "providerGaii" AS name, "createdAt" FROM "Work"
            UNION ALL
            SELECT "requesterGaii", "createdAt" FROM "Work") x
      LEFT JOIN "Owner" o ON o."name" = x.name
     WHERE strpos(x.name, '@') = 0 AND strpos(x.name, '#') = 0
       AND left(x.name, 7) <> 'erased:'
     GROUP BY x.name, o."createdAt"
    UNION ALL
    SELECT 'own ledger line', t."gaii", o."createdAt", min(t."timestamp"), max(t."timestamp"), count(*)
      FROM "Transaction" t
      LEFT JOIN "Owner" o ON o."name" = t."gaii"
     WHERE strpos(t."gaii", '@') = 0 AND strpos(t."gaii", '#') = 0
       AND left(t."gaii", 7) <> 'erased:'
     GROUP BY t."gaii", o."createdAt"
  ) r
 ORDER BY 2, 1;

-- 1b. The lines in other people's ledgers that name an account of this node by its bare name, its
--    GHII or an agent or app of it, and are older than the account that holds the name now, or name
--    an account nobody holds. A line counts once, whichever of its two columns names the account.
--    `no account holds the name`: the lines take the account's pseudonym when something ties the
--    name to a person (it stands bare where a person stands, it is named in its full form, or a line
--    is about work whose one side carries a pseudonym); a bare value nothing ties to a person stays,
--    and is listed on the Security page.
--    `older than the account that holds the name`: left as they are, listed on the Security page.
SELECT p.acct AS name,
       CASE WHEN o."name" IS NULL THEN 'no account holds the name' ELSE 'older than the account that holds the name' END AS state,
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

-- 2. Pseudonyms an erasure, or an earlier run of the move, has already written into Work.
--    Information only: the move leaves every value that starts with `erased:` as it is.
SELECT count(*) AS pseudonyms_in_work
  FROM "Work"
 WHERE left("providerGaii", 7) = 'erased:' OR left("requesterGaii", 7) = 'erased:';

-- 3a. The stored hook bindings, as they are stored.
-- 3b. The same, one row per reference, with what the start does with it. A reference `id#<name>`
--    names an action a person published in person. It moves to `id#<GHII>` only when the move puts
--    that action under the GHII: the account holds the name, the action is not older than it, and the
--    GHII does not publish that id already. Otherwise it stays as it is, and the Security page lists
--    it: with the name when the name is left for the operator, or as naming nothing when the action is
--    a deleted account's, where a gate (a `pre_` moment) lets everything pass until it is bound again.
--    A value that is not a JSON list is ignored at start; 3b reads it as an empty list.
SELECT "key", "value"
  FROM "SystemSetting"
 WHERE "key" LIKE 'config:hooks.%'
 ORDER BY "key";

SELECT s."key", r.ref,
       CASE
         WHEN strpos(r.ref, '#') = 0 THEN 'bare id: pinned to id#provider, or taken off, at the first start'
         WHEN strpos(ref_name.name, '@') > 0 OR strpos(ref_name.name, '#') > 0 THEN 'id#<full identity>: stays as it is'
         WHEN a."id" IS NULL THEN 'id#<account name> whose action does not exist: names nothing; listed on the Security page'
         WHEN o."name" IS NULL THEN 'id#<account name> of a deleted account: its action is deleted, so it names nothing; listed on the Security page'
         WHEN a."createdAt" < o."createdAt" OR g.ghii IS NULL THEN 'id#<account name> left for the operator: listed with the name on the Security page'
         WHEN EXISTS (SELECT 1 FROM "Action" x WHERE x."providerGaii" = g.ghii AND x."actionId" = a."actionId" AND x."id" <> a."id")
           THEN 'id#<account name>: its GHII already publishes this id, so it moves to that one'
         ELSE 'id#<account name>: moves to id#<GHII> at the first start'
       END AS what_happens
  FROM "SystemSetting" s
 CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN s."value" ~ '^\s*\[.*\]\s*$' THEN s."value"::jsonb ELSE '[]'::jsonb END) AS r(ref)
 CROSS JOIN LATERAL (SELECT substr(r.ref, strpos(r.ref, '#') + 1) AS name, split_part(r.ref, '#', 1) AS id) ref_name
  LEFT JOIN "Action" a ON a."providerGaii" = ref_name.name AND a."actionId" = ref_name.id
  LEFT JOIN "Owner" o ON o."name" = ref_name.name
  LEFT JOIN LATERAL (SELECT gh."ghii" FROM "Ghii" gh WHERE gh."ownerName" = o."name" ORDER BY gh."createdAt" LIMIT 1) g ON true
 WHERE s."key" LIKE 'config:hooks.%'
 ORDER BY s."key", r.ref;

ROLLBACK;
