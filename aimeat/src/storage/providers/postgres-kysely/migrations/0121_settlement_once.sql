-- 0121_settlement_once.sql
--
-- One federation settlement is recorded once (secaudit2026oct26 round 8c, federation-01,
-- settle:duplicate-check-not-atomic-with-credit).
--
-- POST /v1/federation/settle looked the tracking code up in the ledger, credited the balance, and then
-- wrote the ledger row. Two node processes that took two copies of one signed settlement at the same
-- moment both found no row and both credited. The route now writes the ledger row first and credits in
-- the same transaction, and this unique index makes the database refuse the second row, so the second
-- copy credits nothing and answers 409 as a later copy does.
--
-- The index covers the federation_settlement rows only, keyed on the identity the row is filed under
-- and the tracking code. Rows that already repeat a key are left as they are: they are kept out of the
-- index by id, every one but the oldest of each key, so the oldest row still stands for the key and a
-- new copy is refused. This file changes no row.
--
-- Mirrors settleOncePerTrackingCode in providers/sqlite/schema-settlement-once.ts.

DO $$
DECLARE
  repeated text;
BEGIN
  SELECT string_agg(quote_literal(d."id"), ', ') INTO repeated
    FROM (
      SELECT "id", row_number() OVER (PARTITION BY "gaii", "trackingCode" ORDER BY "timestamp", "id") AS n
        FROM "Transaction"
       WHERE "type" = 'federation_settlement' AND "trackingCode" IS NOT NULL
    ) d
   WHERE d.n > 1;

  IF repeated IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_settlement_once_key" ON "Transaction" ("gaii", "trackingCode") WHERE "type" = ''federation_settlement''';
  ELSE
    RAISE WARNING '0121_settlement_once: federation settlement rows that repeat a tracking code are kept out of the new unique index: %', repeated;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_settlement_once_key" ON "Transaction" ("gaii", "trackingCode") WHERE "type" = ''federation_settlement'' AND "id" NOT IN (' || repeated || ')';
  END IF;
END $$;
