-- 0011_unique_verified_email.sql
-- Enforce the one-email-per-account-per-node invariant at the DB layer: an email hash may belong to at
-- most ONE account. Email-or-handle connect (device-auth --owner) and the email→owner resolver rely on
-- this being impossible to violate rather than merely conventionally true.
--
-- Historic data can hold duplicate emailHashes (the register-web path used to stamp an UNVERIFIED hash at
-- account creation without an EMAIL_TAKEN guard). Dedupe BEFORE adding the unique index, in the same
-- transaction, or the index creation would abort node boot. Keep the best row per hash — a verified
-- binding wins over an unverified one, oldest wins the tie — and null the emailHash on the losers (their
-- accounts are untouched; only the ambiguous email pointer is cleared).
UPDATE "Ghii" SET "emailHash" = NULL
WHERE "emailHash" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "emailHash"
               ORDER BY ("emailVerifiedAt" IS NOT NULL) DESC, "createdAt" ASC, "id" ASC
             ) AS rn
      FROM "Ghii" WHERE "emailHash" IS NOT NULL
    ) ranked WHERE ranked.rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ux_ghii_emailHash"
  ON "Ghii" ("emailHash") WHERE "emailHash" IS NOT NULL;
