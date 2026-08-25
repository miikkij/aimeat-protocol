-- 0051_app_seo_operator_block.sql — the operator's per-app search-visibility block.
--
-- An app owner's own switch (manifest.seo.index) decides whether their app is findable in a search
-- engine. This is the operator's override, and it is deliberately NARROWER than "operatorHidden":
-- a blocked app stays published, listed, usable and shareable by link, and merely stops being
-- findable through a search engine. That is the proportionate answer to somebody using an app
-- origin to farm keywords on the operator's domain. Taking the app away from its users is not.
--
-- Columns on "App" rather than a field in the manifest JSON, and that is the whole point: the
-- OWNER writes the manifest and rewrites it on every publish, so a block living there is one the
-- blocked party can lift by pressing publish again. Same reasoning, same table and same shape as
-- the operatorHidden columns beside them, so an operator reading either one finds the same three
-- audit answers: who, when, and why.
--
--   operatorSeoBlocked      — false (the owner's switch decides) until an operator sets it
--   operatorSeoBlockedBy    — operator owner name. Audit, not auth.
--   operatorSeoBlockedAt    — when
--   operatorSeoBlockReason  — optional, and shown to the OWNER: a block whose reason the owner
--                             cannot read is one they cannot fix.

ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "operatorSeoBlocked" boolean NOT NULL DEFAULT false;
ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "operatorSeoBlockedBy" text;
ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "operatorSeoBlockedAt" timestamptz;
ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "operatorSeoBlockReason" text;

-- The sitemap index walks every published app on every build and asks which of them are
-- search-visible. Blocked rows are the rare case, so a partial index keeps the common answer
-- cheap without carrying a row per app.
CREATE INDEX IF NOT EXISTS "App_operatorSeoBlocked_idx"
  ON "App" ("operatorSeoBlocked") WHERE "operatorSeoBlocked" = true;
