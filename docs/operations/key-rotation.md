# Key rotation

What each of the node's keys protects, what the node does today when one of them changes, and the
steps an operator follows to replace one. Read it with [Backup and restore](backup-and-restore.md):
every step below starts with a backup of the database, `.env` and the node key file together.

## The keys

| Key | Setting | What it protects | Can it be replaced today |
|---|---|---|---|
| Data key | `AIMEAT_ENCRYPTION_KEY`, and `AIMEAT_TOTP_ENCRYPTION_KEY` on a node set up by `aimeat init` | Every stored secret: AI provider keys, the secrets vault, extension and MCP server secrets, connected accounts, payment provider secrets, file store credentials, two-step sign-in secrets, secret Config settings, app watermarks | Only in one direction: adding `AIMEAT_ENCRYPTION_KEY` to a node that ran on the TOTP key (below). A second data key needs the release step described under "Replacing the data key" |
| Key passphrase | `AIMEAT_KEY_PASSPHRASE` | The node key file, and the node key's copy in the database | No procedure. Keep it as it is |
| Node key | `AIMEAT_NODE_KEY_PATH` (Ed25519) | The node's federation identity, and, through the token keys derived from it, every token the node issues | No. A new node key is a new identity for every peer and ends every issued token |

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

The ring and the key id are in place, but no setting adds a second key to the ring yet. Until one
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

## The node key and the token keys

### What is signed with what

The node key (Ed25519) is the node's identity. It signs every federation message, and the tokens that
parties outside the node verify with the node's published key: a verifiable credential
(`aimeat/src/services/vc-issuer.ts`), the dataspace identity token (`aimeat/src/services/dataspace/identity.ts`)
and the signed agent card (`aimeat/src/routes/agents-v2/card.ts`).

Every token the node issues and checks itself is signed with a key of its own kind
(`aimeat/src/auth/node-signer.ts`): a session, a download address, an upload address, a share link, a
draft preview, a frame grant, an operator confirmation, an outside party's token, a page frame, a
Design Book preview, an app grant, an app screenshot grant, a page grant and a pending sign-up. Each
key is derived from the node key with HKDF-SHA256, with the kind's name as the label, and the token's
header names it (`kid`, for example `session.Ab3dE9xY`). A token of one kind does not verify as
another kind, whatever its claims say.

Every process of a node derives the same keys from the same node key, so a token signed by one process
verifies on another. A token issued before 2026-11-04 carries no `kid` and was signed with the node key
itself; the node verifies it with the node key until it expires, as before.

The other direction does not hold: a release from before 2026-11-04 verifies tokens with the node key
only, so it refuses every token a newer release issued. Update every process of a node together, as
[Upgrading](upgrading.md) describes. After going back to such a release, people sign in again and
agents connect again; nothing stored is lost.

### Replacing the node key

There is no procedure, and nothing above changes that. The token keys are derived from the node key,
so a new node key ends every token issued before it, and every federation peer that pinned the old
public key refuses the node. Keep the key file (`AIMEAT_NODE_KEY_PATH`) and `AIMEAT_KEY_PASSPHRASE`
backed up ([Backup and restore](backup-and-restore.md)). Because each token kind has its own key and
its own `kid`, a later release can rotate the token keys without touching the node's federation
identity; that release needs a decision on where the next generation of each key comes from.

## Who to ask

A question about a step on this page goes to the maintainer named in `.github/SECURITY.md`.
