# Key rotation

What each of the node's keys protects, what the node does today when one of them changes, and the
steps an operator follows to replace one. Read it with [Backup and restore](backup-and-restore.md):
every step below starts with a backup of the database, `.env` and the node key file together.

## The keys

| Key | Setting | What it protects | Can it be replaced today |
|---|---|---|---|
| Data key | `AIMEAT_ENCRYPTION_KEY`, and `AIMEAT_TOTP_ENCRYPTION_KEY` on a node set up by `aimeat init`; `AIMEAT_ENCRYPTION_KEY_1` and `AIMEAT_ENCRYPTION_KEY_CURRENT` during a replacement | Every stored secret: AI provider keys, the secrets vault, extension and MCP server secrets, connected accounts, payment provider secrets, file store credentials, two-step sign-in secrets, secret Config settings, the node key's database copy when no passphrase is set, mail waiting to be sent, a first sign-in's password waiting for a verified address, app watermarks | Yes, with a second key and the re-encrypt job ("Replacing the data key" below). Also adding `AIMEAT_ENCRYPTION_KEY` to a node that ran on the TOTP key |
| Key passphrase | `AIMEAT_KEY_PASSPHRASE` | The node key file, and the node key's copy in the database | No procedure. Keep it as it is |
| Node key | `AIMEAT_NODE_KEY_PATH` (Ed25519) | The node's federation identity, and, through the token keys derived from it, every token the node issues | No. A new node key is a new identity for every peer and ends every issued token |

## The data key

### What is stored

Each stored secret is sealed with AES-256-GCM (`aimeat/src/utils/aes-gcm.ts`, through
`aimeat/src/services/encryption.ts`). The node holds its data keys in a key ring: key 0 is the key
the node had before key ids existed, and a value sealed under any later key starts with that key's
number (`v3:<kid>:` for a value bound to its place, `v3u:<kid>:` for the others). A value with no key
id is key 0's.

A node has a ring of one key, key 0, until the operator sets a second one. With one key it writes the
same forms it wrote before the ring existed (`iv:tag:ciphertext` and `v2:iv:tag:ciphertext`), so
nothing stored changes and an older release still reads everything a newer one wrote.

| Setting | What it is |
|---|---|
| `AIMEAT_ENCRYPTION_KEY` | Key 0 |
| `AIMEAT_ENCRYPTION_KEY_1` | Key 1, the second data key. Unset on a node with one key |
| `AIMEAT_ENCRYPTION_KEY_CURRENT` | The key new secrets are sealed with: `0` (default) or `1`. A value already stored always opens with the key its id names, whatever this says |

All three are set in the environment of every process, like the first key. The node never accepts a
key over a request, an MCP tool, the CLI or chat, and never shows or logs one; the admin Config page
(group Node) shows only whether each key is set and which one is current.

### Adding AIMEAT_ENCRYPTION_KEY to a node that runs on the TOTP key

This is supported and needs no other step. New secrets are written under `AIMEAT_ENCRYPTION_KEY`, and a
secret written before still opens because the node tries `AIMEAT_TOTP_ENCRYPTION_KEY` when the data key
does not open a value. Keep `AIMEAT_TOTP_ENCRYPTION_KEY` set and backed up for as long as those older
secrets are in use ([11 Backup and recovery](../it-adoption/11-backup-recovery.md)).

### Replacing the data key

Never change the value of `AIMEAT_ENCRYPTION_KEY` itself on a node that has stored secrets: every
secret sealed under the old value stops opening. Replace it with a second key instead. Nothing
changes until you set the second key and start the job; each step below can be stopped and every
secret keeps opening at every step.

1. Back up the database, `.env` and the node key file together.
2. Generate the new key (64 hex characters): `openssl rand -hex 32`.
3. Set `AIMEAT_ENCRYPTION_KEY_1` to it on every process of the node and restart them. Leave
   `AIMEAT_ENCRYPTION_KEY_CURRENT` unset (0). Each process now holds both keys and still seals with
   key 0, so nothing stored or written changes yet.
4. Set `AIMEAT_ENCRYPTION_KEY_CURRENT=1` on every process and restart them. New secrets are now sealed
   with key 1 (`v3:1:` and `v3u:1:`); every secret stored before keeps opening with key 0. Step 3
   comes first so that no process ever meets a value sealed with a key it does not hold.
5. Start the re-encrypt job: the button on the admin Config page, group Node; or
   `aimeat_admin_key_reencrypt { action: "start" }`; or `POST /v1/admin/encryption/reencrypt`. The job
   reads each stored secret, opens it, seals it again with key 1 and writes it back only over the
   value it read, a batch at a time. It runs in the background, one process at a time, and a restarted
   process takes it up again from the last batch it finished. Every secret opens while it runs. The
   places it covers are listed in `aimeat/src/services/key-reencrypt/sources.ts`, and a unit test fails
   when code that stores a sealed value is not on that list.
6. Read its status (the same page, `aimeat_admin_key_reencrypt`, or `GET
   /v1/admin/encryption/reencrypt`). A value that opens with neither key is never changed or deleted:
   the job counts it and names its place (`unreadable_at`), so you can decide about it while the old
   key is still at hand. A value that changed while the job ran is counted too; start the job again to
   check it.
7. Remove key 0 only when the status says `old_key_removable: true` (the last finished run left no
   value under key 0). Unset `AIMEAT_ENCRYPTION_KEY` on every process and restart them. Key 1 is then
   the only key, whatever `AIMEAT_ENCRYPTION_KEY_CURRENT` says. Keep a copy of the old key with the
   backups taken before the job: they still need it. If `AIMEAT_TOTP_ENCRYPTION_KEY` is set, the job
   moved the secrets that opened only with it too, so it is no longer needed to read them.

What the job does not move, and what it means for removing the old key:

- A sign-in round in progress (the OAuth round of a connected account or an MCP server, a two-step
  setup ticket) lives 10 to 15 minutes and opens with either key while it lives. One that is in
  progress when the old key is removed fails, and the person starts it again.
- An app's watermark is sealed into the copy a person downloads, not stored on the node. Reading the
  watermark of a copy made before the replacement needs the old key: keep it with the backups.
- A memory record in the bin keeps the value it had when it was deleted, and the node refuses to
  restore a record that holds a secret.

The node key's database copy, when `AIMEAT_KEY_PASSPHRASE` is not set, is sealed with the data key
and moved by the job like the rest. With the passphrase set, the data key is not used for it.

After step 4 the node writes values with a key id, which a release from before 2026-11-04 cannot read.
Do not move such a node back to an older release. To go back to key 0 before removing it, set
`AIMEAT_ENCRYPTION_KEY_CURRENT=0` and start the job again: it moves every value to the current key,
whichever that is.

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
