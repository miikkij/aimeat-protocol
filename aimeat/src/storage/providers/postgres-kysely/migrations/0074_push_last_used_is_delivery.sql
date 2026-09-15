-- 0074 — "never delivered" is a state a push subscription can be in, and it needs somewhere to say so.
--
-- lastUsedAt was written by BOTH the subscribe upsert and a successful send, so a fresh timestamp
-- meant "registered just now" or "received something just now" and nothing distinguished them. A peer
-- operator read one as proof of delivery while Apple had in fact refused every send with 403
-- BadJwtToken (reported 2026-09-15). The column now carries delivery only, and a device that has
-- never accepted anything holds NULL.
--
-- EXISTING ROWS ARE LEFT ALONE. Their value is a registration time or a delivery time and there is no
-- way to tell which from here; clearing them would destroy the real delivery times along with the
-- ambiguous ones. The meaning is correct from this migration forward, and an old row is as good as it
-- ever was.
ALTER TABLE "PushSubscription" ALTER COLUMN "lastUsedAt" DROP NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "lastUsedAt" DROP DEFAULT;
