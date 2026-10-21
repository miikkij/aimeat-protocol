-- 0111_conversation_invited.sql
--
-- Group chat: the people invited to a group thread who have not answered yet.
--
-- A person may add someone to a group directly only when that someone's contact book already accepts
-- them (Jouni, 2026-10-21). Everyone else is INVITED: they read nothing and receive nothing until they
-- accept, and then they move into "participants". So an invitee is not a participant, and the two
-- lists are separate columns rather than one list with a status per entry, which would change the
-- meaning of "participants" for every reader that exists today.
--
-- NULL means nobody is invited, which is every row that exists before this migration. Nothing is
-- backfilled and nothing existing changes.

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "invited" jsonb;
