-- 0020_ai_provenance_board_post_agent_message.sql
-- TARGET-058 Phase 9 step 0: the ATTACHED half for the last two stamped surfaces.
--
-- WHY THIS IS THE FIRST THING PHASE 9 DOES. Phases 4 and 8b stamped a board post, a board reply and
-- an agent message — the records exist and are findable by content hash — but neither table had
-- anywhere to keep the id. A record joined only by hash answers "did this node produce these
-- bytes?"; it cannot answer "how was THIS post made?", because the reader has to already suspect
-- something to go looking. Phase 9 writes in public that a person sees a label wherever they read,
-- so the two surfaces that record provenance they cannot show had to be closed before that sentence
-- could be written.
--
-- NULL = UNSTATED, which is never the same as "a human wrote it".
ALTER TABLE "BoardPost"    ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;
ALTER TABLE "AgentMessage" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;

-- BOARD POSTS JOIN THE DERIVED-VISIBILITY RULE; AGENT MESSAGES DO NOT.
--
-- A post on a public board is served to anyone who asks (GET /v1/boards/:id/posts is unauthenticated),
-- so its provenance must resolve for that same anonymous reader — otherwise the label fails to appear
-- for precisely the visitor Article 50 protects. That makes "BoardPost" a publicly-linking container,
-- and PUBLICLY_LINKED in both providers gains a clause for it (enforced by pnpm check:ai-disclosure).
--
-- An agent message is the opposite: it is delivered inside one account's own chat with its agent and
-- is never public. It gets the column so the owner's own client can render the label, and stays OUT
-- of the public predicate — the same split direct messages got in 0019.
CREATE INDEX IF NOT EXISTS "BoardPost_aiProvenanceId_idx"
  ON "BoardPost"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "AgentMessage_aiProvenanceId_idx"
  ON "AgentMessage"("aiProvenanceId") WHERE "aiProvenanceId" IS NOT NULL;

-- The public predicate reaches BoardPost through Board.visibility, so that join has to be indexed on
-- the anonymous detection path for the same reason the id columns are.
CREATE INDEX IF NOT EXISTS "Board_visibility_idx" ON "Board"("visibility");
