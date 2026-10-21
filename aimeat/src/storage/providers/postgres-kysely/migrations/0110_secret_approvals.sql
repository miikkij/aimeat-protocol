-- 0110_secret_approvals.sql
--
-- Which extensions the owner allowed to send a vault secret to which host, and the requests still
-- waiting for the owner's answer.
--
-- WHY. A secret with no host is bound on its first use, and some first uses are refused: through an
-- extension another account installed, to a host the extension did not declare, or by code an
-- agent without secrets:manage wrote (secaudit 2026-10, v58 and v59). Each refusal files a request
-- the owner answers with one press, and the answer is kept on the secret.
--
--   approvals  JSON text, '[]' when none:
--              [{ "extension", "installer", "host", "why"?, "requestedAt", "requestedBy",
--                 "approvedAt"?, "approvedBy"? }]
--              An entry without approvedAt waits for the owner. Storing the value again empties it.

ALTER TABLE "Secret" ADD COLUMN IF NOT EXISTS "approvals" TEXT NOT NULL DEFAULT '[]';
