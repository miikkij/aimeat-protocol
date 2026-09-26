-- 0084_app_grant_owner_added_scopes.sql — the words the owner added to an app's grant by hand.
-- A refresh and a silent sign-in bring a grant down to what the app declares in its
-- <meta name="aimeat-scopes">. A word the owner added themselves (connections:read-through, through
-- POST /v1/app-grants/:grantId/read-through) is not in that declaration, so it would be gone at the
-- next refresh. This column names those words, and the narrowing keeps them until the owner takes
-- them away. NULL on every existing row, which reads as none. Mirrors the SQLite column in schema.ts.
ALTER TABLE "AppGrant" ADD COLUMN IF NOT EXISTS "ownerAddedScopes" TEXT[];
