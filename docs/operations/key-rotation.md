# Key rotation

What each of the node's keys protects, what the node does today when one of them changes, and the
steps an operator follows to replace one. Read it with [Backup and restore](backup-and-restore.md):
every step below starts with a backup of the database, `.env` and the node key file together.

## The keys

| Key | Setting | What it protects | Can it be replaced today |
|---|---|---|---|
| Data key | `AIMEAT_ENCRYPTION_KEY`, and `AIMEAT_TOTP_ENCRYPTION_KEY` on a node set up by `aimeat init` | Every stored secret: AI provider keys, the secrets vault, extension and MCP server secrets, connected accounts, payment provider secrets, file store credentials, two-step sign-in secrets, secret Config settings, app watermarks | Only in one direction: adding `AIMEAT_ENCRYPTION_KEY` to a node that ran on the TOTP key (below). A second data key needs the release step described under "Replacing the data key" |
| Key passphrase | `AIMEAT_KEY_PASSPHRASE` | The node key file, and the node key's copy in the database | No procedure. Keep it as it is |
| Node key | `AIMEAT_NODE_KEY_PATH` (Ed25519) | The node's federation identity, and the signatures on every token the node issues | No. A new node key is a new identity for every peer |

## The data key

### What is stored

Each stored secret is sealed with AES-256-GCM (`aimeat/src/utils/aes-gcm.ts`, through
`aimeat/src/services/encryption.ts`). The node holds its data keys in a key ring: key 0 is the key
the node had before key ids existed, and a value sealed under any later key starts with that key's
number (`v3:<kid>:` for a value bound to its place, `v3u:<kid>:` for the others). A value with no key
id is key 0's.

Every node today has a ring of one key, key 0. It writes the same forms it wrote before the ring
existed (`iv:tag:ciphertext` and `v2:iv:tag:ciphertext`), so nothing stored changes and an older
release still reads everything a newer one wrote.

### Adding AIMEAT_ENCRYPTION_KEY to a node that runs on the TOTP key

This is supported and needs no other step. New secrets are written under `AIMEAT_ENCRYPTION_KEY`, and a
secret written before still opens because the node tries `AIMEAT_TOTP_ENCRYPTION_KEY` when the data key
does not open a value. Keep `AIMEAT_TOTP_ENCRYPTION_KEY` set and backed up for as long as those older
secrets are in use ([11 Backup and recovery](../it-adoption/11-backup-recovery.md)).

### Replacing the data key

The ring and the key id are in place; the setting that adds a second key to the ring is not. Until it
ships, do not change `AIMEAT_ENCRYPTION_KEY` on a node that has stored secrets: every secret sealed
under the old key stops opening.

When the setting ships, a rotation takes these steps:

1. Back up the database, `.env` and the node key file together.
2. Generate the new key (64 hex characters): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Add it to the ring as the next number and make it current, keeping every older key in the ring.
   Start every process of the node with the same ring before any of them takes traffic: a process that
   does not hold the new key cannot open a value another process sealed with it.
4. Let the re-encrypt step seal each stored secret again under the current key, and read its count of
   values left under older keys.
5. Remove an older key from the ring only when that count is zero, and keep a copy of it with the
   backups from before the rotation, which still need it.

After step 3 the node writes values with a key id, which a release from before 2026-11-04 cannot read.
Do not move such a node back to an older release.

## Who to ask

A question about a step on this page goes to the maintainer named in `.github/SECURITY.md`.
