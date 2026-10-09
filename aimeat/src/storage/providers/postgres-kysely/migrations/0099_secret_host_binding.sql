-- 0099_secret_host_binding.sql
--
-- Who bound a vault secret to its host, and how.
--
-- WHY. A vault secret is bound to the host of its first use (0078), and nothing recorded which of
-- the owner's agents or apps made that first use, so the owner could not tell whether the host it
-- went to was one they chose. The owner may now also set the host when storing the secret, and the
-- list shows which of the two happened (secrets audit 2026-10-09, item 10).
--
--   hostBinding  JSON text, NULL until the secret is bound:
--                { "how": "set" | "first-use", "by": "<principal>", "extension"?: "<name>", "at": "<ISO>" }
--                Storing the value again clears it with the hosts, unless that store sets a host.

ALTER TABLE "Secret" ADD COLUMN IF NOT EXISTS "hostBinding" TEXT;
