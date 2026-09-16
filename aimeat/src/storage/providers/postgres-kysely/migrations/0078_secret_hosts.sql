-- 0078_secret_hosts.sql
--
-- The hosts a vault secret may be sent to.
--
-- WHY. The address of an outbound call is chosen by the extension's script, and the node filled a
-- person's vault secret into that call's header whatever the address was. Any extension a person
-- ran could therefore send their credential to its author's own server, and a server that echoes
-- request headers handed the value back to the script. A secret is now bound to the host of its
-- first use, and a call to any other host is refused before anything is sent.
--
--   hosts  JSON array of "host[:port]" strings, in a text column like "usedBy" beside it. Empty
--          until the first use. Storing the value again empties it, because a new value is the
--          owner's own act and the natural moment to point it somewhere else.

ALTER TABLE "Secret" ADD COLUMN IF NOT EXISTS "hosts" TEXT NOT NULL DEFAULT '[]';
