-- 0008_feedback.sql — Node Feedback Channel (principal → operator platform feedback threads).
-- Sender is the RESOLVED principal id (GHII/GAII/GEAI); messages is the sender↔operator reply
-- chain as a jsonb array (small, capped at the route layer).

CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "messages" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Feedback_sender_idx" ON "Feedback"("sender");
CREATE INDEX IF NOT EXISTS "Feedback_status_idx" ON "Feedback"("status");
CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt");
