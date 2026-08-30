-- 0057_board_rules.sql
--
-- A board's own rules. RFC v4.0 §27 (reinstated 2026-08-30) makes a board a notice board a person
-- keeps: who may publish on it, which categories a notice may carry, how long a notice lives, and
-- what a public post costs. Until now every one of those was the node's setting (the price
-- AIMEAT_BOARD_POST_BASE_COST for every public board alike, 168 hours for every notice, free-text
-- categories, posting decided by visibility alone), so a board could not be an announcements board
-- that only its keeper writes to, or a for-sale board whose notices last thirty days.
--
-- One jsonb column rather than four, because the rules are read together, written together and
-- optional together: NULL means "the node's defaults", which is what every existing board has.

ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "rules" JSONB;
