# 10 Logging and monitoring

> Checked against AIMEAT node 4.2.0 (commit 5ec62c24a) on 2026-11-01. Maintained with the code: see the README for how.

This page is for the sysadmin and the SOC that must watch a node. It lists what the node records, where each record lives and how long it is kept, what the process log looks like and what it masks, how to get the records into a SIEM, which health and metrics endpoints exist, what to alert on, and which compliance reports the node keeps. The operator's own monitoring guide is [aimeat/docs/observability-guide.md](../../aimeat/docs/observability-guide.md); health checks are in [Production deployment](../operations/production-deployment.md#health-checks).

## What is recorded

| Record | What one entry holds | Where it is stored | How to read it | Source |
|---|---|---|---|---|
| **Process log** | Timestamp, level, message, `node_id`, and the request id and caller identity of the request it ran under | stdout (journald under systemd, the container log under Docker) | `journalctl -u aimeat`, the container log | `aimeat/src/utils/logger.ts`, `aimeat/deploy/aimeat.service` |
| **Refusal log** | One JSON line per 401 and 403, whichever route answered, and per wrong reset code (400): time, route, source address, credential kind, a truncated digest of the credential, the code the caller got. Never the credential itself | File `AIMEAT_AUTH_LOG_PATH` (default data/auth-failures.log under the working directory) | The file, `GET /v1/admin/auth-refusals`, the admin Security page | `aimeat/src/services/auth-audit.ts`, `aimeat/src/routes/admin-security.ts` |
| **Trail of changes** | Each MCP tool call, and each authenticated REST change (POST, PUT, PATCH, DELETE): when, who (person, their AI, agent, app, operator), what, on which target | Usage tables in the database | `aimeat_trail_list` (per account); `GET /v1/admin/usage/calls` for operators | `aimeat/src/middleware/trail-recorder.ts`, `aimeat/src/services/place-trail.ts`, `aimeat/src/routes/admin-usage.ts` |
| **Operator actions** | An operator's read or act in another person's account: a usage row in the operator's own stream naming the account, and an event on that account. A node setting change is a usage row `config.set` | Usage tables and account events | `GET /v1/admin/usage/calls?surface=operator`; the person's account events | `aimeat/src/services/operator-access-audit.ts`, [Incident response](../security/incident-response.md) |
| **Account events** | What happened on one account that its holder should know: agent connected or removed, password changed, two-step sign-in armed or reset by an operator, passkey added, reused sign-in token, operator access, consent granted or revoked, app granted, AI key changed, and more | Database, per account | The person's "what has happened" view | `aimeat/src/services/account-events.ts`, `aimeat/src/storage/types/account-events.ts`, `aimeat/src/routes/account-events.ts` |
| **Consent audit** | Each refused read and each consent grant or revoke. Allowed reads are not audited | Database, written within a second of the event | Consent views; `aimeat_consent_list` | [Security practices](../coding-guidelines/security.md), `aimeat/src/services/access-guard.ts`, `aimeat/src/services/consent-audit-buffer.ts` |
| **Classification audit** | Content with an audited label shown to or used by an AI (who, item, label, capability, model); every refusal, label change and exception | Database, written within a second of the event, the same reader, item and action in one minute as one row with a count | `GET /v1/classification/audit`, `aimeat_classification` | `aimeat/src/services/classification/audit.ts`, [Data classification](../data-classification.md) |
| **AI usage** | Spend per model, app, agent and day; which tools were called and which refused or failed | Usage tables | `aimeat_usage_report` (per owner), `aimeat_admin_usage` (operator) | `aimeat/src/services/ai/usage-record.ts`, `aimeat/src/services/ai/usage-admin.ts` |
| **Agent activity** | An agent's own counters and daily history | Database | `aimeat_agent_activity` (the agent itself); the owner reads the trail | `aimeat/src/routes/agent-activity.ts` |
| **App audit log** | Per app, its own audit entries | Database; old entries move to one archive record per app per year | App page; `aimeat_app_manage` | `aimeat/src/services/app-audit.ts`, `AIMEAT_APP_AUDIT_KEEP` |
| **Security incidents** | Data a start-time migration or check could not place, kept and quarantined for a decision | Database | Admin Security page, `aimeat_admin_security_overview`, `aimeat_admin_incident_resolve` | `aimeat/src/routes/admin-security.ts` |
| **Hook calls** | Each call to a bound hook and what came back | Database | `aimeat_admin_hooks`, admin Hooks tab | `aimeat/src/services/hooks.ts` |
| **Rate limit hits** | Counted per tier; the caller gets 429. Not written as a log line per hit | Counters | `/v1/metrics`, `/v1/stats` | `aimeat/src/middleware/rate-limit.ts`, [observability guide](../../aimeat/docs/observability-guide.md) |
| **Sign-in guessing** | Tarpit delays and blocks are written to the refusal log; reaching the block threshold writes a warning to the process log; counters `login_tarpit_delayed_total`, `login_tarpit_blocked_total` | Refusal log, process log, counters | as above | `aimeat/src/middleware/login-tarpit.ts`, [Incident response](../security/incident-response.md) |

Faults: an MCP tool that failed inside the node logs `[mcp-fault]`, a REST request that failed inside the node logs `[500]`, each with the request id the caller was shown ([Incident response](../security/incident-response.md)).

## Retention

| Record | Default | Setting | Source |
|---|---|---|---|
| Process log | whatever journald or the container runtime keeps | outside the node | `aimeat/deploy/aimeat.service` |
| Refusal log | rotates at 5 MiB and keeps one older generation | `AIMEAT_AUTH_LOG_MAX_BYTES` | `aimeat/src/config-security.ts` |
| Consent audit | 365 days | `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS` (1 to 3650) | `aimeat/src/config-data-access.ts` |
| Classification audit | 365 days, or none (keep all) | the classification policy's audit retention | `aimeat/src/services/core-jobs.ts` |
| Account events | the newest 100 per account in the live window; older ones are archived, not deleted | `AIMEAT_ACCOUNT_EVENT_WINDOW` | `aimeat/src/services/account-events.ts` |
| Usage rows (trail, AI usage, operator actions) | 90 days in the report tables, then moved to the archive. No scheduled job deletes them; an operator deletes archived rows before a chosen date with `POST /v1/admin/usage/archive/prune`. Hourly figures are kept 30 days | `AIMEAT_USAGE_HOT_DAYS`, `AIMEAT_USAGE_HOUR_ROLLUP_DAYS` | `aimeat/.env.example`, `aimeat/src/services/config-schema-runtime.ts`, `aimeat/src/routes/admin-usage.ts` |
| AI job logs | 30 days | `AIMEAT_AI_JOB_LOG_RETENTION_DAYS` | `aimeat/.env.example` |
| Workflow and action run log | 30 days | `AIMEAT_EXECUTION_LOG_RETENTION_DAYS` | `aimeat/src/config-data-access.ts` |
| Decision records | 365 days | `AIMEAT_DECIDE_RETENTION_DAYS` | `aimeat/.env.example` |
| App audit log | keep all, older entries archived per year | `AIMEAT_APP_AUDIT_KEEP` (0 keeps all) | `aimeat/.env.example` |
| Kept compliance reports | stored as records with their version history; the monthly job prunes nothing | none found | `aimeat/src/services/compliance/monthly-job.ts` |

Records in the database are in every database backup, so the backup retention in [11 Backup and recovery](11-backup-recovery.md) extends these periods.

## The process log

- **Logger:** Winston with one console transport (`aimeat/src/utils/logger.ts`).
- **Format:** JSON, one object per line, when `NODE_ENV=production`. Otherwise coloured text. The Docker image sets `NODE_ENV=production` (`aimeat/Dockerfile`); the shipped systemd unit does not (`aimeat/deploy/aimeat.service`), so add it there before shipping the log to a SIEM.
- **Level:** `AIMEAT_LOG_LEVEL` (default `info`) for the first lines; then `node.log_level` from the admin Config tab, changeable without a restart (`aimeat/src/utils/logger.ts`). Run `info` or `warn` in production ([Deployment checklist](../security/deployment-checklist.md)).
- **Masking:** a field whose name is a credential's (any case, any depth, including `Authorization` and `client_secret`) is masked, and key-shaped text inside every string, a stack included, is replaced (`aimeat/src/utils/logger.ts`).
- **Context:** each line written during a request carries `requestId` and the caller's identity (`gaii`), so a line can be joined to the trail and to the error the caller saw.

## Export to a SIEM

The node has no syslog, OTLP or SIEM-specific exporter; a search of the node source found none. What exists to build an export on:

| Source | How to collect | Notes |
|---|---|---|
| Process log | journald forwarding or the container log driver | Set `NODE_ENV=production` first so lines are JSON |
| Refusal log | a file shipper tailing `AIMEAT_AUTH_LOG_PATH` | JSON lines; rotates by rename, so the shipper must follow renames |
| Metrics | Prometheus scrape of `GET /v1/metrics` with an operator token (`AIMEAT_METRICS_ENABLED=true`) | [observability guide](../../aimeat/docs/observability-guide.md) |
| Statistics | `GET /v1/stats` JSON | `AIMEAT_STATS_ACCESS=operator` |
| Operator and usage trail | poll `GET /v1/admin/usage/calls` with an operator token | No push; polling interval is the export delay |
| Refusals | poll `GET /v1/admin/auth-refusals` | Same data as the file |
| Lifecycle hooks | `aimeat_admin_hook_set` binds a published action's webhook to one of ten live moments: owner and agent registration (before and after), agent rekey, work request, work delivery, settlement, board post, federation peer request. `owner_recovery` is still listed, but nothing fires it | These are lifecycle moments, not security events. A `pre_` hook is a gate: if its address stops answering it refuses everything it guards (`aimeat/src/services/hooks.ts`) |

## Health and metrics endpoints

| Endpoint | Use | Note | Source |
|---|---|---|---|
| `GET /v1/health/live` | liveness | 200 while the process runs; no storage read | [Production deployment](../operations/production-deployment.md#health-checks), `aimeat/src/routes/health.ts` |
| `GET /v1/health/ready` | readiness | 503 `NOT_READY` while booting, while draining after a stop signal, and when one storage read fails or takes over 2 s | [Production deployment](../operations/production-deployment.md#health-checks), `aimeat/src/routes/health.ts` |
| `GET /v1/health` | the node's state for a person or a monitor | answers 200 also when `status` is `degraded`: read `status` and `subsystems.storage.healthy` | [Production deployment](../operations/production-deployment.md#health-checks), `aimeat/src/routes/health.ts` |
| `GET /v1/build` | which version and commit run, and since when | never cached | [Production deployment](../operations/production-deployment.md#health-checks) |
| `GET /v1/metrics` | Prometheus text format: HTTP requests and duration, tunnels, mailbox, the counters aimeat_auth_failures_total, aimeat_rate_limit_hits_total and aimeat_scope_denials_total, Node.js process metrics | off by default | `aimeat/src/services/prometheus.ts`, [observability guide](../../aimeat/docs/observability-guide.md) |
| `GET /v1/stats` | JSON snapshot with daily history | `public` by default in code | [observability guide](../../aimeat/docs/observability-guide.md) |

## What to alert on

| Event | Signal | Suggested trigger |
|---|---|---|
| Node down or degraded | `/v1/health` `status` | any `degraded` or no answer for 2 checks |
| Unexpected version | `/v1/build` commit | differs from the approved release |
| Credential guessing | metric aimeat_auth_failures_total, tarpit warning line, refusal log grouped by source | the thresholds in the [observability guide](../../aimeat/docs/observability-guide.md) (warning above 10 per hour, critical above 50) |
| One dead token retried, or many tokens tried | refusal log credential digest | many lines with one digest, or many digests from one source |
| Rate limiting | metric aimeat_rate_limit_hits_total | warning above 20 per hour ([observability guide](../../aimeat/docs/observability-guide.md)) |
| Scope denials | metric aimeat_scope_denials_total | sudden rise: an agent tries what it was not granted |
| Startup posture | `SECURITY:` lines in the start log (`aimeat/src/config-posture.ts`) | any, on every start |
| Internal faults | `[mcp-fault]` and `[500]` in the process log | any rise |
| Operator access to a person's data | operator usage rows, `memory_accessed_by_operator` account events | every occurrence, reviewed |
| Two-step sign-in reset by an operator | `two_factor_reset_by_operator` account event | every occurrence |
| Reused refresh token | `session_token_reused` account event | every occurrence: possible stolen session |
| Security incident opened | admin Security page open count | any |
| Federation peer offline or relay refused | federation heartbeat log lines | per [Federation](../operations/federation.md) |
| Failing hook gate | `failing` in `aimeat_admin_hooks` | any |

## Compliance reports and monthly snapshots

| Tool | What it gives | Source |
|---|---|---|
| `aimeat_compliance_report` | The live report: AI activity against the written record of what AI is used for, and the gaps; with `scope="node"` it also gives the records of processing, processors, transfers and data intermediation findings, with the list of shared data packages behind them (name, owner, audience, licence, readers in 30 days, freshness; a named recipient is counted, never named, and no row of data is in it); that scope needs `compliance:read` and an operator account. The default `scope="mine"` is the owner's own slice, which an agent reads with `wallet:read` | `aimeat/src/tool-catalog/definitions/compliance.ts` |
| `aimeat_compliance_snapshot` | Reports the node has kept: `monthly` (written on the first of each month by a scheduled job) or `manual`. A kept report never changes. Operator-only. Over REST, reading needs `compliance:read` and saving needs `compliance:write`. On the node MCP the tool is offered only to an agent that holds `compliance:write` | `aimeat/src/tool-catalog/definitions/compliance.ts`, `aimeat/src/services/core-jobs.ts` |
| `aimeat_exposure_report` | Per person, everything of theirs that someone else can read, and how to close it | `aimeat/src/tool-catalog/definitions/exposure.ts` |

The compliance register and records of processing are described in [Data classification](../data-classification.md); the regulatory mapping is in [14 Compliance mapping](14-compliance-mapping.md).

## Limits

- No native syslog, OTLP or SIEM exporter. The usage trail and operator actions reach a SIEM only by polling admin routes.
- The shipped systemd unit does not set `NODE_ENV=production`, so the process log is not JSON under it until the operator adds the variable.
- The refusal log keeps one older generation after 5 MiB; under a long attack the oldest refusals are lost.
- The consent audit and the classification audit wait in memory for up to one second before they are written. A stop of the node (a deploy, SIGTERM) writes them first; a process that ends without stopping (a kill, a crash) loses at most that last second. A failed database write is tried again every 60 s.
- Rate limit hits are counters only; there is no per-hit log line that names the caller.
- Allowed reads of records are not audited by the consent audit. The classification audit records shows and uses only for labels with audit on, and only while classification is on (off by default).
- Every record listed is stored on the node itself, where an operator with host or database access can change it. Tamper resistance needs an export to a store outside the operator's reach.
- No scheduled job deletes usage rows, so watch their growth. The operator deletes archived rows before a chosen date with `POST /v1/admin/usage/archive/prune` (`aimeat/src/routes/admin-usage.ts`). When to do that is the organisation's decision.
- `/v1/health` answers 200 when degraded; a check that reads only the status code misses it. `/v1/health/ready` answers 503 instead, but it checks only that the process takes requests and reaches its database.
- No job was found that prunes kept compliance reports; they accumulate.

## Open questions

- OPEN: Is a push export of the usage trail and operator actions (syslog, OTLP or a webhook stream) planned? (the maintainer named in `.github/SECURITY.md`)
- OPEN: Are human (non-AI) reads of Confidential content recorded anywhere the operator can export? (the maintainer)
- OPEN: How long does the account event archive keep entries, and does an account erasure remove them? (the maintainer)
