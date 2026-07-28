-- 0015_app_grant_spend_cap.sql — how much of your money a connected app may spend.
-- The `contract:spend` scope answers whether an app may buy on your behalf. A yes/no is a poor answer
-- to that question; the useful one is an amount. Nullable cap = the scope alone, no ceiling.
ALTER TABLE "AppGrant" ADD COLUMN IF NOT EXISTS "spendCapMorsels" INTEGER;
ALTER TABLE "AppGrant" ADD COLUMN IF NOT EXISTS "spentMorsels" INTEGER NOT NULL DEFAULT 0;
