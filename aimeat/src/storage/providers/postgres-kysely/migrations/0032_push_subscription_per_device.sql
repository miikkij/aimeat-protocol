-- 0032_push_subscription_per_device.sql
--
-- A web-push subscription belongs to a DEVICE, not to a person.
--
-- The table was unique on "ownerName", and the provider upserted on that column, so registering a
-- subscription REPLACED whatever the owner already had. Two consequences, and the second is the
-- reason this is an audit item (H-8): the person's laptop went silent the moment their phone
-- subscribed, and anything holding a token for the account could point the owner's entire
-- notification stream at a destination of its choosing by subscribing once.
--
-- The identity of a subscription is therefore (ownerName, endpoint). A second device inserts beside
-- the first; the same device subscribing again refreshes its keys. Sending fans out over every row
-- an owner has, and a push service answering 404/410 prunes that one row rather than all of them.
--
-- SAFE ON EXISTING ROWS. "PushSubscription_ownerName_key" made a duplicate (ownerName, endpoint)
-- impossible, so the new unique index cannot fail on today's data. The dedupe below runs anyway,
-- because CREATE UNIQUE INDEX on data that violates it is a failed migration and therefore a node
-- that will not boot; a database whose old index had been dropped by hand is worth the four lines.
-- It keeps the most recently used row per (ownerName, endpoint).
--
-- "id" is untouched. Old rows carry id = ownerName, new ones get the gen_random_uuid() default from
-- migration 0003. Nothing reads the column; the record type has no id field.

DELETE FROM "PushSubscription" a
      USING "PushSubscription" b
      WHERE a."ownerName" = b."ownerName"
        AND a."endpoint" = b."endpoint"
        AND (a."lastUsedAt", a."id") < (b."lastUsedAt", b."id");

DROP INDEX IF EXISTS "PushSubscription_ownerName_key";

-- ownerName leads the index, so "every device of this owner" (the fan-out read) stays index-backed
-- and no separate ownerName index is needed.
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_ownerName_endpoint_key"
    ON "PushSubscription"("ownerName", "endpoint");
