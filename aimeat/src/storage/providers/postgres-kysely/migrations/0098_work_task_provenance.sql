-- 0098_work_task_provenance.sql
--
-- The AI-provenance record of what an agent hands back as finished work: the output of a work-queue
-- item (POST /v1/work/:code/deliver, aimeat_work_deliver) and the result and closing status message
-- of an Agent v2 task, which is also what an A2A caller reads back. Both are text or data a person or
-- another agent acts on, and the node stamped neither, so "which model produced this answer" had no
-- answer on either surface. Set through provenanceForWrite when the work lands; NULL = delivered by a
-- person in person, settled without a result, or settled before this column existed.
--
-- Mirrors the SQLite columns added in sqlite/schema.ts.
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;
ALTER TABLE "AgentV2Task" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;
