# Database high availability

This guide is for the person who runs the PostgreSQL database under an AIMEAT node and wants the
node to survive the loss of the database host, or to recover to a point in time. It covers three
things: a streaming standby with automatic failover, WAL archiving with point-in-time recovery
(PITR), and a restore timed at production size. The everyday backup with `pg_dump` and its restore
test are in [Backup and restore](backup-and-restore.md), and the recovery targets an organisation
chooses from (RPO and RTO) are on [IT adoption page 11](../it-adoption/11-backup-recovery.md).

The node does not set any of this up. It is standard PostgreSQL operation, done with the tools the
PostgreSQL project and its ecosystem provide. This page says which shape works with the node, what
the node does during a failover, and how to prove the setup before you rely on it.

## What the node does during a failover

The node knows one database address, `DATABASE_URL`. It knows nothing of a standby or of replicas,
and it sends no read to a replica. What it does when that address stops answering and starts again:

| When | What the node does | Source |
|---|---|---|
| A statement is running when the primary goes away | A read built by the node's query builder, outside a transaction, is asked once more on a new connection, and the request answers as if nothing happened when the new primary is already up. Any write, any statement inside a transaction, and any statement written as raw SQL fails, and that request answers 500, as before. The node retries on connection errors (SQLSTATE class 08, 57P01, 57P02, 57P03, a reset socket) and on 40001, once | `aimeat/src/storage/providers/postgres-kysely/read-retry.ts` |
| A connection was lost | It leaves the pool and is not given to the next request; the pool opens new connections to `DATABASE_URL` as requests need them | `aimeat/src/storage/providers/postgres-kysely/read-retry.ts`, `aimeat/src/storage/providers/postgres-kysely/index.ts` |
| The database does not answer at all | A request waits at most 15 s for a connection, a statement at most 120 s, then fails. The process keeps running | `aimeat/src/storage/providers/postgres-kysely/pool-limits.ts` |
| The event bus between the node's processes lost its connection | The listening connection connects again after 1 s, then 2, 4 and up to 30 s between tries. When it listens again, the process reads the federation peers, the internet openings, maintenance mode and the stored settings again, because a change announced while it was down never arrives | `aimeat/src/storage/providers/postgres-kysely/bus-wire.ts`, `aimeat/src/server-bootstrap/bus-relay-start.ts` |
| A process starts while another one migrates or seeds | It waits for the boot lock up to 60 s. The lock is a transaction-scoped advisory lock, so it holds behind a connection pooler too | `aimeat/src/storage/providers/postgres-kysely/migrate.ts` |

So during a failover, people see failed writes and some failed reads for the length of the outage,
plus the time the new primary needs to accept connections. Nothing is retried for them after that:
a write that failed must be made again by whoever made it.

## Choose the shape

| Part | What to use | What it must give the node |
|---|---|---|
| Replication | Streaming replication to at least one standby | A standby that holds every committed transaction. With asynchronous replication a failover can lose the last transactions the primary had committed; with `synchronous_commit = on` and a synchronous standby it loses none, at the cost of write latency |
| Failover | Patroni, pg_auto_failover, or a managed PostgreSQL service with automatic failover | One standby promoted, and the old primary fenced so that it never accepts writes again |
| The address | One stable address that always reaches the current primary: a virtual IP (keepalived, vip-manager), a TCP proxy that health-checks the primary (HAProxy against Patroni's REST API), or the managed service's endpoint | `DATABASE_URL` names that address. node-postgres takes one host per connection string, so a list of hosts with `target_session_attrs` does not work here |
| Archiving | Continuous WAL archiving with base backups: pgBackRest, WAL-G, Barman, or the managed service's PITR | A restore to any moment inside the retention window |

### A connection pooler

The node keeps the two code constraints a pooler in transaction mode (PgBouncer) needs:
it takes no session-level advisory lock, and it listens for the event bus only on one connection of
its own outside its pool. `pnpm check:pooler-safe` refuses a change that breaks either.

A transaction-mode pooler in `DATABASE_URL` is still not supported, for three reasons in the code:

- The event bus listens on `DATABASE_URL` too. Through a transaction-mode pooler its `LISTEN` does
  not receive notifications, so with several processes the other processes would stop hearing
  changes. There is no setting for a separate direct address for that one connection.
- The pool sends session settings at connect time: `statement_timeout`, `lock_timeout`,
  `idle_in_transaction_session_timeout`, and `TimeZone=UTC` in the `options` parameter. PgBouncer
  refuses these startup parameters unless they are listed in `ignore_startup_parameters`, and then it
  does not apply them, so the session time zone the node relies on for timestamps would not be UTC.
- The request-path statement limit (`storage.request_statement_ms`), when an operator sets it to a
  value other than the pool's, is a session-level `SET` on a pooled connection.

A pooler in session mode works as a plain proxy, and is how to put PgBouncer in front of the node
today. A node needs at most 20 connections per process, plus one for the event bus on PostgreSQL.

## Set up a streaming standby with automatic failover

The steps below are the order of work. The commands belong to the tool you chose; follow its own
guide for them.

1. Prepare a second database host with the same PostgreSQL major version and the same
   configuration as the primary.
2. Set up the failover tool on both hosts (and on a third host or a distributed configuration store
   where the tool needs one for a quorum, as Patroni does with etcd).
3. Let the tool create the standby from a base backup of the primary and start streaming
   replication. Check `pg_stat_replication` on the primary: the standby is `streaming`.
4. Put the stable address in front: a virtual IP that moves with the primary role, or a proxy whose
   health check answers only on the primary.
5. Point `DATABASE_URL` in the node's `.env` at that address and restart the node. Every node
   process uses the same `.env` ([Production deployment](production-deployment.md)).
6. Decide on synchronous replication: set `synchronous_standby_names` and `synchronous_commit` if
   the organisation's RPO is zero.
7. Run the failover drill below before you count on it.

## Set up WAL archiving and point-in-time recovery

1. Choose the archive store: a disk on another host, or object storage with versioning and a
   retention rule. Keep it outside the database host.
2. Configure the archiving tool and set `archive_mode = on` and its `archive_command` (or the
   tool's own setting) on the primary and on every standby that can become primary.
3. Take a full base backup, then schedule base backups (weekly full, daily differential or
   incremental is a common start) and set the retention window to the RPO tier the organisation
   chose on [page 11](../it-adoption/11-backup-recovery.md#proposed-rto-and-rpo).
4. Check that WAL segments reach the archive: the tool's check command, or `pg_stat_archiver`
   (`failed_count` stays 0).
5. Keep backing up `.env` and the node key file as [Backup and restore](backup-and-restore.md)
   says. A database restored without the same `AIMEAT_ENCRYPTION_KEY` and `AIMEAT_KEY_PASSPHRASE`
   opens no stored secret.

To recover to a moment, for example just before a mistaken bulk delete: stop every node process,
restore the base backup with the tool and give it the target time (`recovery_target_time`), let
PostgreSQL replay the WAL up to it, promote, and start the node. The node applies any migration the
restored database lacks, as after any restore.

## Time a restore at production size

The repository holds no restore time measured at production size, so the RTO tiers on page 11 are
proposals until you measure your own. Measure both kinds of restore you may need, on a copy of the
production database:

1. Note the size: `SELECT pg_size_pretty(pg_database_size(current_database()));` and the row count of
   the largest tables (`"Memory"`, `"StorageFile"` when file bytes are kept in the database).
2. Dump restore: on a separate host, time `createdb` plus `pg_restore --jobs=<cores>` of the newest
   `pg_dump` file, then start a node against it with the same `.env` and key file on another
   `AIMEAT_PORT`, and time until `GET /v1/health/ready` answers 200.
3. PITR restore: time the archiving tool's restore of the newest base backup plus WAL replay to a
   target time one hour back, then the same node start and readiness check.
4. Run the checks of [Test the restore](backup-and-restore.md#test-the-restore): a record and a
   stored file written before the backup come back, and a stored secret opens.
5. Write down the size, both times and the date in the organisation's profile
   ([templates/organization-profile.md](../it-adoption/templates/organization-profile.md)). That is
   the measured RTO. Repeat when the database has grown by half.

Keep the test node away from the real one: block its outbound traffic or change its mail and
federation settings, as the restore test says.

## The failover drill

Run it on a staging copy first, then in a maintenance window on production.

1. Start a load script against the node that makes reads and writes and records, for every request,
   the time, the status and an id it wrote (for example a memory record key per write).
2. Fail the primary: stop it hard (power off the virtual machine, or kill PostgreSQL), not a clean
   switchover.
3. Watch the failover tool promote the standby and the stable address move.
4. Stop the load script after the node answers normally again. From its log, measure the error
   window: the time from the first failed request to the first success after it.
5. Check that every write that answered 2xx is present on the new primary. With asynchronous
   replication a few may be missing; that number is the measured RPO. With synchronous replication
   it must be zero.
6. Check the node's log for `bus: the connection to the other processes is back` on every process,
   and that `GET /v1/health/ready` answers 200 on each.
7. Bring the old primary back as a standby through the failover tool, never as a second primary.

## Limits

- The node knows one database address. It sends no read to a replica and has no setting for a list
  of hosts.
- During a failover, writes fail and are not retried by the node. A read is retried once, and only
  a query-builder read outside a transaction.
- A primary that disappears without closing its connections (a host that loses power behind a
  firewall that drops packets) leaves the node's statements waiting until their 120 s limit, because
  the pool does not set TCP keepalive.
- A transaction-mode connection pooler in `DATABASE_URL` is not supported (see the section above).
- The project records no failover drill and no timed restore at production size.
