-- 0068_passkeys.sql
--
-- Passkeys: one WebAuthn credential, on one device, for one account.
--
-- WHY A TABLE. Everything else a person owns lives in their memory namespace, read through an
-- authenticated path. This is read BEFORE anyone is signed in: the login door is handed a credential
-- id by the browser and has to find which account it belongs to, across every account on the node,
-- with no session to scope the read. In the discoverable flow the id is ALL it has. The signature
-- counter is also a value the node writes and the person must not, which a namespace they own
-- cannot express.
--
-- THE ID IS THE PRIMARY KEY because that is the shape of the pre-authentication lookup. The owner
-- index serves the other read, which is the person's own list of devices.
--
--   publicKey   base64url COSE, the public half. The private half never leaves the device.
--   counter     signature counter as last seen. Many authenticators (Apple's among them) always
--               report 0; that is not a failure, it means "this device does not count". Only a
--               counter that HAS moved and then stops is evidence of a clone.
--   transports  JSON array: internal, usb, nfc, ble, hybrid. Passed back to the browser as a hint.
--   backedUp    the key is synced to a cloud keychain rather than living on this one device.
--   label       what the person calls this device. Theirs to change.

CREATE TABLE IF NOT EXISTS "Passkey" (
  "id"         TEXT PRIMARY KEY,
  "ghii"       TEXT NOT NULL,
  "owner"      TEXT NOT NULL,
  "publicKey"  TEXT NOT NULL,
  "counter"    BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT NOT NULL DEFAULT '[]',
  "label"      TEXT NOT NULL DEFAULT '',
  "aaguid"     TEXT NOT NULL DEFAULT '',
  "backedUp"   BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"  TEXT NOT NULL,
  "lastUsedAt" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_passkey_owner" ON "Passkey" ("owner");
