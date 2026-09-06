-- 0071_owner_secrets.sql
--
-- The owner's secrets vault: named credentials an account holds so the things acting in its name
-- can USE them without ever HOLDING them.
--
-- WRITE-ONLY BY DESIGN. A value goes in through PUT /v1/secrets/:name and comes back out of no API
-- at all — not the list, not a read route, not an export. The only reader is the node itself,
-- resolving {{secret:NAME}} in an outbound header inside ctx.fetch, after the sandbox has already
-- handed the request over. So a sandboxed extension script can send a credential and cannot learn
-- one, which is the whole point: the script is written by an AI and read by whoever opens the
-- document it lives in.
--
-- WHY A TABLE AND NOT A MEMORY RECORD. Memory's contract is that the owner (and whoever they let
-- read that namespace) can read it back. A credential must be readable by nobody, and there is no
-- visibility value that says so. The extension config already stored secrets in this envelope
-- (services/extension-secrets.ts); what it could not express is a secret belonging to the PERSON
-- rather than to one installed extension.
--
-- NO PLAINTEXT COLUMN EXISTS. "ciphertext" is iv:authTag:ct (hex, AES-256-GCM) from
-- services/encryption.ts under the node key. A node with no key refuses the write; it never falls
-- back to storing the value in the clear.
--
--   ownerGaii   the OWNER's GHII, always — an agent's write lands under the human it acts for.
--               Named ownerGaii rather than ownerGhii because that is the column name
--               scripts/check-storage-parity.ts can see, and this table must never fall out of the
--               deletion cascade: a deleted username is released for reuse, and a surviving row
--               here would hand the next registrant somebody else's live credential.
--   usedBy      JSON { "<extension name>": "<ISO timestamp>" }. The only answer this node can give
--               to "what breaks if I delete this", because nothing else can see a secret named
--               inside a document, a config or a workflow. Written as it happens; the list route
--               projects the last 30 days.
--
-- The primary key is (ownerGaii, name): one name, one value, per account. Replacing is the same
-- write, and it keeps "setAt" so "since when do I hold this" survives a rotation.

CREATE TABLE IF NOT EXISTS "Secret" (
  "ownerGaii"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "setAt"      TEXT NOT NULL,
  "updatedAt"  TEXT NOT NULL,
  "usedBy"     TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY ("ownerGaii", "name")
);

CREATE INDEX IF NOT EXISTS "idx_secret_owner" ON "Secret" ("ownerGaii");
