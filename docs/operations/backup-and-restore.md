# Backup and restore

What to back up so a node can be brought back as the same node, how to restore it on each storage
backend, and how to prove a backup works before you need it. The short list is also in
[Build and operate a node](../coding-guidelines/getting-started.md#what-to-back-up).

## What a node is

A node is three things together. Back up all three, at the same time, and keep them together.

| Part | Where | Why it matters |
|---|---|---|
| **The database** | SQLite: the file `AIMEAT_SQLITE_PATH` names (and its `-wal` and `-shm` files beside it). PostgreSQL: the database `DATABASE_URL` names | every account, record, workspace, app and setting. **Stored files are inside the database** (the `StorageFile` table), not in a folder, so the database backup carries them |
| **The secrets** | `.env`, or wherever the process manager sets the variables | `AIMEAT_ENCRYPTION_KEY` (or `AIMEAT_TOTP_ENCRYPTION_KEY` when the first is not set) encrypts every stored secret: AI keys, vault entries, two-step sign-in secrets, attached MCP server tokens. `AIMEAT_KEY_PASSPHRASE` protects the node's key |
| **The node's key** | `~/.aimeat/nodes/<node id>/node-key.json`, or the file `AIMEAT_NODE_KEY_PATH` names | the node's identity: the key every token and federation message is signed with. The database holds a sealed copy too, which opens only with the same secrets |

Never change the encryption key or the key passphrase on a running node, and never restore a
database under different values. A different encryption key leaves every stored secret unreadable.
A node whose sealed key copy does not open, and that finds no key file with the same identity,
refuses to start and names the variable; it never makes a new identity, because that would break
every issued token and every peer that pinned it.

Docker: the compose files keep the database on a volume but **not the key directory**. Put the key
file on a volume (`AIMEAT_NODE_KEY_PATH`), and back that volume up with the database.

## What is not a backup

- **`GET /v1/admin/backup`** (and the backup on the admin Maintenance tab) writes a JSON export of accounts,
  agents, actions, boards and each agent's memory and transactions. It carries no credential, and it
  does **not** carry the records people keep under their own accounts, organisms, workspaces, apps or
  files. Use it to move account and agent rows, never as the node's backup. `POST /v1/admin/restore`
  reads the same shape. Its answer counts, per kind, the rows it imported, the rows it skipped
  because they already exist (`skipped_duplicates`) and the rows that failed for any other reason
  (`failed`, with the first errors in `failures`); `restored` is `true` only when nothing failed.
- **`aimeat backup` and `aimeat restore`** call those two routes with a personal access token of an
  operator account: `--token <token>` or `AIMEAT_OP_TOKEN`. An operator creates one at
  `<node>/v1/profile?tab=access` with the level "Run the whole server", or with
  `POST /v1/access/tokens` and `grant_operator: true`. `--url <node>` reaches a running node; without
  it the command starts a node in its own process on the configured database. Without a token, or
  when the node refuses it, the command prints the node's code and message, writes no file and exits
  1. `aimeat restore` also exits 1 when any row failed for a reason other than already being there.
  The export is still the partial one above.
- **A person's own export** (their account export, memory export, apps backup) is theirs to take; it is
  described in the [data ownership guide](../data-ownership.md). It is not a node backup either.

## SQLite

The node runs SQLite in write-ahead mode, so recent writes may sit in the `-wal` file beside the
database.

**Back up, node stopped** (the simplest form, and the one exercised below):

```bash
systemctl stop aimeat                                   # or however the node runs
cp /var/lib/aimeat/aimeat.db*  /backup/aimeat-$(date +%F)/   # the .db, .db-wal and .db-shm together
cp /opt/aimeat/aimeat/.env     /backup/aimeat-$(date +%F)/
cp ~aimeat/.aimeat/nodes/<node id>/node-key.json /backup/aimeat-$(date +%F)/
systemctl start aimeat
```

**Back up, node running:** copy the database with SQLite's own online backup, which writes one
consistent file, for example `sqlite3 /var/lib/aimeat/aimeat.db ".backup '/backup/aimeat.db'"`. Do not
copy the live `.db` file alone: it can miss what is still in the `-wal` file. (The online form is
standard SQLite and was not exercised on a node for this guide.)

**Restore:** stop the node, put the database files (all of those you backed up), `.env` and the key
file back in their places, and start it.

## PostgreSQL

**Back up, node running:**

```bash
pg_dump --format=custom --file=/backup/aimeat-$(date +%F).dump "$DATABASE_URL"
```

plus `.env` and the key file, as above.

**Restore** into an empty database of the same name, or a new one that `DATABASE_URL` then names:

```bash
systemctl stop aimeat
createdb aimeat_restored
pg_restore --no-owner --dbname=aimeat_restored /backup/aimeat-2026-10-12.dump
# set DATABASE_URL to the restored database, then
systemctl start aimeat
```

At start the node applies any migration the backup does not have yet, in order, each once; so a
backup taken on an older version restores onto a newer one. Restoring a newer backup onto an older
version is not supported. (This procedure was not exercised on a node for this guide: the machine it
was written on has no PostgreSQL client tools.)

## Test the restore

A backup is proven only by a restore. Once a month, and after every change to how the node is
installed:

1. Restore the backup onto a separate machine, or the same machine on another port with
   `AIMEAT_PORT`, using the same `.env` values and the same key file.
2. `GET /v1/health` answers `status: healthy`, with `subsystems.storage.healthy: true`.
3. `GET /v1/build` shows the version you expect.
4. Sign in as an operator and read a record you know was written before the backup.
5. Stop the test node. Do not let it run beside the real one with the same identity and the same
   federation peers.

**Exercised on 2026-10-12** on SQLite, with a sandbox node: a record was written, the node stopped and
its database files copied, the record deleted, the node stopped again, the copied files put back, and
the node started. The record read back as written:

```
WRITE  ops.restore-probe -> HTTP 201
READ   ops.restore-probe -> HTTP 200 {"note":"restore probe written before the backup"}
(stop, copy sandbox-40602.db, .db-wal and .db-shm aside, start)
DELETE ops.restore-probe -> HTTP 200 {"deleted":true,"restorable_until":"2026-10-18T21:32:28.822Z"}
READ   ops.restore-probe -> HTTP 404 NOT_FOUND
(stop, copy the three files back, start)
READ   ops.restore-probe -> HTTP 200 {"note":"restore probe written before the backup"}
```

## How often, and how long

- Take a backup before every update (the update procedure in [upgrading](upgrading.md) says so) and on
  a schedule that matches how much work you can afford to lose.
- Keep backups off the machine, encrypted: the database holds people's data and the `.env` holds the
  key to their secrets. Keep the two in separate places or encrypt the set.
- A record a person deleted, or an account a person erased, leaves the node but stays in every older
  backup until that backup is thrown away. Decide how long you keep backups, say it in your privacy
  notice, and remember it when you restore: a restore brings back what was erased after the backup.
