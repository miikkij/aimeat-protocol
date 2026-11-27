-- 0138_package_author_after_erasure.sql
-- A package's author after its account was erased (2026-11-27). Mirrors SQLite schema.ts.
--
-- An account name is released for reuse when its account is erased (decision 2026-08-10). The erasure
-- rewrote "Package"."authorGhii" to the erasure's pseudonym and left "Package"."author", the bare
-- name, as it was, and every decision on a package (reading a private one, a new version, status,
-- grants, price, sales, refunds) compares "author" with the caller's account name. So the next person
-- to register the name became the author of the erased person's packages and could publish a version
-- that the nodes the erased author granted are served (secaudit2026nov26). From this release the
-- erasure rewrites "author" too (src/storage/erased-account-records.ts).
--
-- POSITIVE EVIDENCE ONLY. A row whose "authorGhii" holds the erasure's pseudonym ('erased:' prefix,
-- src/storage/erased-party.ts) was written by an erasure, so its author is gone; such a row takes the
-- same pseudonym in "author". A row without that pseudonym is not touched. Running it twice changes
-- nothing.

UPDATE "Package" SET "author" = "authorGhii"
 WHERE "authorGhii" LIKE 'erased:%' AND "author" NOT LIKE 'erased:%';
