-- 0033_drop_feedback.sql
--
-- Remove the Node Feedback Channel.
--
-- It was a second inbox: an authenticated principal opened a thread to the operator, and the
-- operator read it in an admin dashboard tab. The reports it collected were good — concrete ids,
-- time windows, repro steps, a suggested fix — and on this node not one of the seven was ever
-- answered or even triaged, because answering meant remembering that a separate queue existed.
--
-- Its job now belongs to `support@operators` (services/message-alias.ts): the same question arrives
-- as an ordinary group conversation, in Messages, where the operators already reply to people.
--
-- The table goes with the feature. Keeping it would leave a store nothing reads and nothing writes,
-- which is the kind of thing that survives three refactors and then confuses whoever finds it.

DROP TABLE IF EXISTS "Feedback";
