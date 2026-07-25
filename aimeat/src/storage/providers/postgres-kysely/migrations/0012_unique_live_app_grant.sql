-- 0012_unique_live_app_grant.sql
-- Enforce the one-live-grant-per-(owner, app) invariant at the DB layer.
--
-- The authorization_code exchange (POST /v1/app-grants/token) used to INSERT a grant unconditionally
-- while the silent SSO bridge upserted, so every pass through the consent flow stacked another row.
-- The consent page auto-approves an owner's OWN app with no visible prompt, so this happened silently:
-- one account reached 86 grants with the same app repeated many times. The real damage is not the
-- cluttered list — only the newest row keeps a live refresh hash, so the stale ones sat at
-- revoked = false and the Access tab presented dead grants as active access to the owner's data.
--
-- Dedupe BEFORE adding the unique index, in the same transaction, or the index creation would abort
-- node boot. Per (owner, app) keep the freshest live row (most recently used, then most recently
-- created) and revoke the losers exactly the way DELETE /v1/app-grants/:id does: revoked with the
-- refresh hash nulled, so nothing that held one of those tokens can still refresh it.
UPDATE "AppGrant" SET "revoked" = true, "refreshTokenHash" = NULL
WHERE "revoked" = false
  AND "grantId" NOT IN (
    SELECT "grantId" FROM (
      SELECT "grantId",
             ROW_NUMBER() OVER (
               PARTITION BY "owner", "app"
               ORDER BY "lastUsedAt" DESC NULLS LAST, "createdAt" DESC, "grantId" DESC
             ) AS rn
      FROM "AppGrant" WHERE "revoked" = false
    ) ranked WHERE ranked.rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ux_app_grants_owner_app"
  ON "AppGrant" ("owner", "app") WHERE "revoked" = false;
