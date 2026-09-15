-- 0075 — a push subscription remembers which app's origin it came from.
--
-- A subscription belongs to an ORIGIN, not to a site. A person who installs a published app from its
-- own subdomain and allows notifications there registers a second, separate endpoint, and what
-- arrives on it wears that app's name and icon instead of the node's. On iOS that is the only way an
-- app's notification wears its own face at all, because Safari ignores the icon in the payload.
--
-- NULL means the node's own pages, which is every row written before this migration and every row a
-- person's ordinary browser writes afterwards. Nothing changes for them: a notification with no app
-- behind it goes to the node-level rows exactly as before.
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "appId" TEXT;

-- The send path asks "which of this owner's devices belong to this app", so the owner is the leading
-- column and the app narrows it.
CREATE INDEX IF NOT EXISTS "PushSubscription_ownerName_appId_idx"
  ON "PushSubscription"("ownerName", "appId");
