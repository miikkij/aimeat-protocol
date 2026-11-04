# 18 Scope and deployment patterns

> Checked against AIMEAT node 4.2.0 (commit 0fc46b7c9) on 2026-11-04. Maintained with the code: see the README for how.

This page is for the architect, IT and the system owner of the adopting organisation. It says what an AIMEAT node is built to do and what it leaves to other systems, and the deployment patterns that follow from that: one node, several node processes on one database, many separate nodes, a node of one's own, and the services that run beside a node. It then states availability and operator access from that architecture. Read it before [02 Architecture](02-architecture.md) when the question is "how big must this be, and how many".

## What a node is for

A node is the place where people and their agents keep the knowledge they have refined, and share it. It is a source of record for that knowledge and a place for the apps that show its state. It is a small system on purpose.

| A node holds and does | What that means | Source |
|---|---|---|
| Knowledge people and agents bring and own | Memory records, workspace documents and rows, stored files. Everything an agent writes belongs to its owner, and a person can take all of it out | [Data ownership](../data-ownership.md) |
| Identity | People (GHII, `alice@node-id`), agents that act for one person with scoped permissions (GAII), and outside applications onboarded with a scope allowlist (GEAI) | [Identity model](../coding-guidelines/identity-model.md) |
| Consent and provenance | Who may read what, and who wrote each record and with which AI | [Data ownership, section 4](../data-ownership.md#4-every-record-can-say-who-wrote-it), [AI transparency](../ai-transparency.md) |
| Agents as users | An agent connects through device authorization (RFC 8628) and the owner approves it and picks its scopes; a CrewAI crew connects through the `aimeat-crewai` package | `aimeat/src/routes/agents/device-auth.ts`, `python/aimeat-crewai/README.md`, [Building an agent](../building-an-aimeat-compatible-agent.md) |
| Sharing between people whose AIs come from different vendors | AI clients from any vendor connect over MCP; people share in organisms (a group with members) and workspaces (a shared space inside an organism) | [01 Overview](01-overview.md), [13 Apps, agents and endpoints](13-apps-agents-endpoints.md) |
| Apps that show the state | Single-file web apps published on the node, each on its own origin | [13 Apps, agents and endpoints](13-apps-agents-endpoints.md) |

### What a node is not built for

High-volume data processing, high-throughput transactions, bulk data lakes and analytics over large raw data sets. The storage limits show the intended size of what one identity keeps: by default 1024 kB per value (`AIMEAT_MEMORY_MAX_VALUE_SIZE_KB`), 1000 keys (`AIMEAT_MEMORY_MAX_KEYS`) and 10 MB (`AIMEAT_MEMORY_QUOTA_MB`) per identity, and 50 000 rows per workspace (`AIMEAT_WS_ROWS_MAX_PER_WORKSPACE`) (`aimeat/src/config.ts`, `aimeat/.env.example`). There is no message queue, no search cluster and no shared cache; the cache is a map in the process (`aimeat/src/services/cache.ts`).

Heavy work runs as separate services that read from and write to the node: model inference at an AI provider or on the organisation's own model servers, and the organisation's own processing as its own APIs, agents or extensions. The section [Services around a node](#services-around-a-node) lists the ways in.

## The patterns at a glance

```mermaid
flowchart LR
  subgraph A[One organisation node]
    LB[Load balancer] --> P1[Node process]
    LB -.-> P2[Standby process<br/>optional]
    P1 --> DB[(PostgreSQL)]
    P2 -.-> DB
  end
  T[Team or unit node<br/>own database] <-- federation --> A
  PN[Partner node<br/>own operator] <-- federation --> A
  L[Personal node<br/>own machine] <-. federation .-> A
  S[Organisation's own services:<br/>APIs, agents, crews] -- REST / MCP --> A
  A -- extensions, MCP, webhooks --> X[Outside APIs and<br/>MCP servers]
  A -- AI calls --> M[AI providers or<br/>own model servers]
  A -.-> F[(S3-compatible or<br/>Azure file store)]
```

Each box with its own database is a separate node with its own data, its own operator and its own settings. Lines marked federation are signed traffic between nodes whose operators approved each other; they do not copy one node's private data into another.

| Pattern | Use it when | Section |
|---|---|---|
| One node | One organisation, one operator, one set of rules | [One node for an organisation](#one-node-for-an-organisation) |
| One active process and a standby on one database | One node must survive the loss of one process or host | [Several node processes on one database](#several-node-processes-on-one-database) |
| Many nodes | Units, partners or people need their own data, operator or rules | [Many nodes](#many-nodes) |
| A node of one's own | A person or a small team needs content no other operator can read | [A personal or local node](#a-personal-or-local-node) |
| Services around a node | The work is heavy, or belongs to a system the organisation already runs | [Services around a node](#services-around-a-node) |

## One node for an organisation

**When.** One organisation with one IT function and one set of sign-in, classification and AI rules.

**What it gives.** One node process behind a reverse proxy, on PostgreSQL, with the organisation's identity provider ([02 Architecture](02-architecture.md), [Organisation node sign-in](../organisation-node-sign-in.md)). The process manager restarts the process after a crash (`aimeat/deploy/aimeat.service`: restart after 5 s). Every feature works in this shape, and it is the shape the guides describe ([Production deployment](../operations/production-deployment.md)).

**What it does not give.** A host or database failure is an outage until the process runs again or the database is restored ([11 Backup and recovery](11-backup-recovery.md)). Every team on the node shares one operator and one set of node settings.

## Several node processes on one database

**What is supported.** One active process and a standby: the load balancer sends all traffic to one process, and a second process with the same `.env` waits on a second host and takes the traffic when the first stops. **More than one active process is not supported yet**: the state in the table below stays in each process, and the project has not moved it to the database. The maintainer ruled this on 2026-11-04, and the code says the same (`docs/coding-guidelines/architecture.md`, read-cache layer). Every new piece of per-process state or timer in the code is counted by `pnpm check:process-local` against `aimeat/security/process-local-baseline.json`, which asks each new one what breaks with a second process.

Several processes of one node can run against one PostgreSQL database with the same settings, and they see the same data. The code records that aimeat.io has run two processes on one database: the same workflow fire started twice, 1 ms and 15 ms apart, on 2026-10-02 and 2026-10-03, and the scheduler claim below was written for it (`aimeat/src/services/scheduler-fire-claim.ts`, `aimeat/src/services/once-only-step.ts`).

**What every process must share.** The same `.env`: the same `AIMEAT_NODE_ID`, `AIMEAT_BASE_URL`, `DATABASE_URL`, `AIMEAT_ENCRYPTION_KEY` and `AIMEAT_KEY_PASSPHRASE`. A process reads the node key from the database copy first, and that copy opens with `AIMEAT_KEY_PASSPHRASE` or `AIMEAT_ENCRYPTION_KEY`, so a process on a second host takes the same identity without a copy of the key file (`aimeat/src/auth/node-keys.ts`). Use PostgreSQL: SQLite is one file on one machine (`aimeat/src/storage/storage-factory.ts`).

### What holds across processes

| Held in the database | Source |
|---|---|
| Every record, account, setting row, app, workflow run and job record | `aimeat/src/storage/interface.ts` |
| A cron fire of a scheduled job runs once: each process claims the fire in the database before it runs it, and the process that loses skips it | `aimeat/src/services/scheduler-fire-claim.ts` |
| A fire missed while the node was down is caught up once, under the same claim | `aimeat/src/services/scheduler-catch-up.ts` |
| A once-per-node start step runs in one process only | `aimeat/src/services/once-only-step.ts` |
| The node key: two processes that start without a key file adopt one key | `aimeat/src/auth/node-keys.ts` |
| Sign-in through an outside identity provider (the OIDC login round is a stored nonce), device authorization requests, MCP OAuth clients, refresh tokens and approvals, spent upload tokens, spent agent return proofs | `aimeat/src/routes/oauth-login.ts`, `aimeat/src/routes/agents/device-auth.ts`, `aimeat/src/mcp/oauth.ts`, `aimeat/src/routes/upload.ts`, `aimeat/src/services/device-return-proof.ts` |
| Messages and tasks for an agent wait in storage and go out with the backlog when the agent's tunnel connects | `aimeat/src/services/connect-tunnel-push.ts` |
| Processes that start together migrate and seed one after the other: the boot lock is a PostgreSQL advisory lock, and a process waits for it up to 60 s | `aimeat/src/storage/providers/postgres-kysely/migrate.ts`, `aimeat/src/server-bootstrap/boot-seed-lock.ts` |
| Maintenance mode: a stop switched on by `aimeat maintenance on` or through another process reaches every process within 5 s | `aimeat/src/services/maintenance-cache.ts` |
| The pages' build stamp names the code, so a page whose live stream reaches the standby does not reload | `aimeat/src/utils/build-stamp.ts` |
| A stop drains: `GET /v1/health/ready` answers 503, new connections are refused, requests in flight get 5 s, and the process exits 0, so the load balancer moves to the standby | `aimeat/src/server-bootstrap/drain.ts`, `aimeat/src/routes/health.ts` |
| A webhook or mail whose first attempt failed keeps its retries in a stored outbox, each attempt claimed on the record's version, so a restart resumes it and two processes send it once | `aimeat/src/services/outbox.ts`, `aimeat/src/services/email-outbox.ts` |
| The notification digest and the held pushes claim before they send: the digest bookmark and the held marks move on their version first, so two processes send one digest | `aimeat/src/services/notification-sweeps.ts` |
| Consent and classification audit rows are written within 1 s of the decision, and at a stop | `aimeat/src/services/consent-audit-buffer.ts`, `aimeat/src/services/classification/audit.ts` |

### What stays in each process, and what follows

| Held in one process | What follows | What to do | Source |
|---|---|---|---|
| The live update bus. A change reaches only the browsers (SSE) and agent tunnels connected to the process that made the write | A person or agent connected to another process sees the change at its next read, not live. Live pushes and capability calls to an agent go only through the process that holds its tunnel | Session affinity at the load balancer keeps one client's own requests and stream on one process, so its own changes show live. Changes made through another process still arrive at the next read | `aimeat/src/services/event-bus.ts`, `aimeat/src/services/connect-tunnel.ts`, `aimeat/src/services/personal-tunnel.ts` |
| The read cache, cleared by that bus | A process can serve a cached value another process has changed, until the entry's time limit passes | Accept short staleness, or keep reads on one process | `aimeat/src/services/cache.ts` |
| Rate limits, the sign-in tarpit and the hold on the node's AI key | Each process counts on its own, so N processes allow up to N times the configured rate, N tarpits, and N calls side by side on the node's AI key | Divide the limits by the number of processes, or limit at the load balancer | `aimeat/src/middleware/rate-limit.ts`, `aimeat/src/middleware/login-tarpit.ts`, `aimeat/src/services/ai/node-key-hold.ts` |
| Short sign-in steps: MCP OAuth authorization codes (`/v1/mcp/authorize`, `/v1/mcp/authorize-consent` then `/v1/mcp/token`), app grant codes and pending requests (`/v1/app-grants/*`), passkey ceremonies (`/v1/ghii/login/passkey/*`, `/v1/ghii/passkeys/register/*`), the key-sign-in challenge (`/v1/auth/challenge`), WebSocket tickets (60 s), and the replay cache of signed requests | The second step of a flow that lands on another process is refused (`invalid_grant`, an unknown ceremony or ticket). The MCP token exchange comes from the AI client's server and the consent from the person's browser, so affinity by cookie or by client address does not keep the two together | Route these paths to one process, or run one active process. The code says the OAuth codes and the replay cache must move to storage together before several processes can serve without such routing | `aimeat/src/mcp/oauth.ts`, `aimeat/src/routes/app-grants.ts`, `aimeat/src/services/passkeys.ts`, `aimeat/src/routes/auth.ts`, `aimeat/src/auth/ws-upgrade.ts`, `aimeat/src/auth/signed-request.ts` |
| MCP sessions of the 2025-era protocol (one transport per session). The 2026-07-28 code path is stateless | A request with a session id that another process opened gets 404, and the client starts a new session | Affinity on the `Mcp-Session-Id` header | `aimeat/src/mcp/legacy-sessions.ts`, `aimeat/src/mcp/modern-endpoint.ts` |
| The token revocation cache, 60 s | A revoked token is refused at once by the process that revoked it, and by the others within 60 s | Count on 60 s for a revocation to reach every process | `aimeat/src/auth/jwt.ts` |
| A setting changed on the admin Config page | The change applies at once in the process that took it, and in the others at their next start, when the stored values are applied again | Restart every process after a change, or set the value in `.env` and seal it with `AIMEAT_SEALED_CONFIG_KEYS` | `aimeat/src/services/config-apply.ts`, `aimeat/src/config-overrides.ts` |
| Idempotency keys | A retried request with the same `Idempotency-Key` that lands on another process runs again | Affinity, or retry against the same process | `aimeat/src/middleware/idempotency.ts` |
| The setup code of a node without an operator | Each process prints its own code | Run the first setup with one process | `aimeat/src/services/setup-code.ts` |
| AI jobs and workflow runs in flight. At start, a process treats every AI job left `running` as left behind by a restart and fails it, except a job that a stopping process marked at SIGTERM, which it queues again once; it starts again every `queued` one; the workflow engine clears the open model calls of every run. The per-run lock is in the process, and the run record is written without a version check. A job cancelled through another process is marked cancelled in storage while its own process keeps it running | Starting or restarting one process fails the AI jobs the others are running (`node_restarted`), can run a queued job in two processes, and two processes can advance one workflow run at the same moment | Start and restart all processes together, outside working hours; or run one active process and keep the second as a standby | `aimeat/src/services/ai-jobs/service.ts`, `aimeat/src/server-bootstrap/background-jobs.ts`, `aimeat/src/services/workflow/engine.ts` |
| The retry sweep of cross-node messages runs in every process, without a claim | Two processes can try the same delivery at the same moment | Accept a possible repeat delivery to a peer, or run one active process | `aimeat/src/services/message-delivery.ts` |
| The tickets of the live stream (`POST /v1/events/ticket`, then `GET /v1/events?ticket=`), the replay cache of signed requests between nodes, and the short handle of a presigned upload (`upload_url`) | A ticket or handle minted on one process is refused on another, and a signed request between nodes can be replayed once per process within its 5 minutes | Run one active process | `aimeat/src/routes/sse.ts`, `aimeat/src/services/request-nonce.ts`, `aimeat/src/services/upload-token.ts` |
| The list of federation peers and the apps open to the internet on a closed node, loaded at start | An emergency removal of a peer, or a closed internet opening, reaches only the process that made it; another process keeps the old list until it starts again | Run one active process; a standby that takes over loads the lists from the database at its start | `aimeat/src/services/federation-peer-remove.ts`, `aimeat/src/services/internet-opening/opening-registry.ts` |
| Realtime rooms, chunked uploads in progress, the stop handle of a chat turn, who is online, and the watch list of tracked responses | A room, an upload or a chat turn exists only in the process that opened it; presence counts only that process's streams; a tracked response is watched by the process that created it until the reconciler finds it | Run one active process; a takeover loses rooms and unfinished uploads, and the clients start them again | `aimeat/src/services/realtime-manager.ts`, `aimeat/src/storage/chunked-upload-store.ts`, `aimeat/src/routes/chat.ts`, `aimeat/src/services/presence.ts`, `aimeat/src/services/track-registry.ts` |
| The per-account limits (mail, invitations, AI calls), the per-owner ceiling of queued AI jobs and the extension run slots | Each process counts on its own | Run one active process | `aimeat/src/services/account-limits.ts`, `aimeat/src/services/ai-jobs/service.ts`, `aimeat/src/services/extension-run-slots.ts` |
| Jobs scheduled `@activate` run at every start of every process, without a claim | A standby that starts runs them again | Write `@activate` work so a second run changes nothing | `aimeat/src/services/scheduler.ts` |

The code's own design notes state one process per node: "a node is one process" and the platform "grows by there being more nodes, each its own, federated" (`aimeat/src/services/passkeys.ts`), and the AI key hold is "per process, like every limiter here: a node runs one process" (`aimeat/src/services/ai/node-key-hold.ts`). The database claims above are the parts that already hold when two processes run.

### Two ways to use it

| Shape | What it gives | What it does not |
|---|---|---|
| **One active process and a standby (supported).** The load balancer sends all traffic to one process and reads `GET /v1/health/ready`; a second host has the same `.env` and its process takes the traffic when the first one's readiness fails. A stop drains the active process first (readiness 503, new connections refused, requests in flight finished), so a planned switch loses no request | Recovery from the loss of a host in the time it takes a process to start, with none of the per-process effects above, because one process serves at a time. A standby process that runs while it waits also runs the background work and the start reconciliation; a stopped standby does not | Protection against the loss of the database: use PostgreSQL's own standby for that ([11 Backup and recovery](11-backup-recovery.md)) |
| **Several active processes (not supported yet).** Traffic spread over the processes, with affinity per client, the sign-in paths routed to one process, and the limits divided | Capacity beyond one process, and service through the loss of one process | Everything in the table above: live updates across processes, sign-in steps, peer and opening lists, limits, and AI jobs that survive the start of another process |

The project records no test of either shape behind a load balancer; the database claims are covered by unit tests (`aimeat/test/unit/scheduler-fire-claim.test.ts`, `aimeat/test/unit/scheduler-catch-up.test.ts`, `aimeat/test/unit/once-only-keep-steps.test.ts`, `aimeat/test/unit/node-key-path.test.ts`).

## Many nodes

**When.** A unit, a partner, a customer project or a person needs its own data, its own operator, its own sign-in or classification rules, or its own outage boundary. There can be as many nodes as the organisation runs: each is a full node with its own database.

**What it gives.**

- **Separation.** Each node has its own database, its own settings, its own operator and its own node key. An outage, a wrong setting or a breach on one node stays on that node.
- **Federation between nodes.** Two operators approve each other as peers; the peer's tier decides how far it reaches: `contact` (messages only), `visiting` (catalogue, messages, broadcasts, settlement), `member` (also replication and routing) and `genesis` ([Running federation](../operations/federation.md)). Every request between nodes is signed with the sending node's key, carries its audience and is accepted once.
- **Identity stays at home.** A person keeps one home node, and their identity names it (`alice@home-node`). Cross-node sign-in, off by default, lets a person sign in on a peer as `alice@home-node`: the peer asks the home node, which answers yes only when the person allowed that node, the link between the nodes carries sign-ins, and the peer's operator accepts them (`AIMEAT_FEDERATION_AUTH_POLICY`, [Feature list](../AIMEAT-Feature-List.md)). Such a session is a visitor on the peer, named by its home identity (`aimeat/src/routes/federation-auth.ts`, [Identity model](../coding-guidelines/identity-model.md)).
- **What crosses.** Messages between people, the directory and catalogues, records a person published with federation consent, and settlements. A message to a node that is down waits at the sender and is tried again for `AIMEAT_MESSAGE_RETRY_TTL_HOURS` (168 hours by default) (`aimeat/src/config.ts`, `aimeat/src/services/message-delivery.ts`).
- **The same apps and tools on every node.** One node can serve its packages to other nodes, which take updates from it (`AIMEAT_PACKAGE_FEDERATION_ENABLED`, [Feature list](../AIMEAT-Feature-List.md)). Consul can hold the configuration of a fleet of nodes (`AIMEAT_CONSUL_ENABLED`, `aimeat/src/config-consul.ts`).
- **One AI client, several nodes.** A person who works on two nodes connects their AI client to the MCP endpoint of each, as two connections ([13 Apps, agents and endpoints](13-apps-agents-endpoints.md)).

**What it does not give.** Twenty nodes are twenty separate nodes, not replicas of one. Federation does not copy private records, does not fail one node over to another, and does not merge two nodes' accounts. An organism and its workspaces live on one node; moving one is an export and an import, which does not bring its membership or its board (`aimeat_organism_export`, `aimeat_organism_import`, [17 Exit plan](17-exit-plan.md)). The `relay` and `mirror` node types are accepted by configuration, but working replication, stateless operation and a tested resource budget are not established for them ([Environment examples](../coding-guidelines/environment-configs.md#relay-and-mirror-types)).

## A personal or local node

**When.** A person or a small team needs content that no other operator can read, or needs to work without a network.

**What it gives.** A node on the person's own machine: node type `personal` (`AIMEAT_NODE_TYPE`) on SQLite, or the packaged desktop app (`aimeat-desktop/package.json`). The person is its operator. With a private or loopback base URL, or node type `personal`, and `AIMEAT_BIND_HOST` empty or a loopback address, the node takes the `local` security profile when none is set (`aimeat/src/config-private-host.ts`, [Environment examples](../coding-guidelines/environment-configs.md#personal-node)). It can federate with the organisation's node like any other node, and it can anchor to an operator node through a tunnel, which keeps an offline mailbox for it while it is away ([Feature list](../AIMEAT-Feature-List.md)).

**What it does not give.** Mail held in that mailbox sits on the operator node. A remote MCP connector in a vendor's cloud cannot reach a node on a private machine; local AI clients can ([13 Apps, agents and endpoints](13-apps-agents-endpoints.md)). The person backs it up. Exposing it on a network needs the `public` profile, set and checked by hand ([01 Overview](01-overview.md#node-types)).

## Services around a node

The organisation's heavy or specialised work runs in its own services, and the node is where their results become shared, owned and attributed knowledge.

| Way in | What it is for | Example in this repository | Source |
|---|---|---|---|
| REST API | The organisation's own service reads and writes records with an agent token or a personal access token | The documented contract | `openapi.yaml` |
| MCP | AI clients and agents use the node's tools | `/v1/mcp` | `aimeat/src/mcp/index.ts` |
| Agents | A program that acts for one person, approved by that person with the scopes it may use | A CrewAI crew with the liaison agent, run on the organisation's own machines | `python/aimeat-crewai/README.md`, [Building an agent](../building-an-aimeat-compatible-agent.md) |
| The connector on a workstation | Programs on a person's computer that the person allowed, reached from the node through the connector tunnel | `aimeat connect` | [13 Apps, agents and endpoints](13-apps-agents-endpoints.md), [Connector forward tunnel](../connector-forward-tunnel.md) |
| Ecosystem apps (GEAI) | An outside service (a support desk, a table store, an editor) joins with hello, approve and token, and writes in its own namespace | The developer specification | [Building an ecosystem app](../building-an-aimeat-compatible-ecosystem-app.md) |
| Sandboxed extensions | Small actions that run inside the node in a QuickJS WASM sandbox with no Node.js globals, and call outside APIs through the SSRF guard, live or on a schedule | `rest-connector`, a reference connector with an encrypted per-instance API key and a scheduled sync; the built-in `vocab-finto`, which calls `api.finto.fi` | `aimeat/src/services/extension-runtime.ts`, [rest-connector](../extensions/rest-connector/README.md), `aimeat/src/data/builtin-extensions/vocab-finto.ts` |
| App tools | An app's tools, each bound to a capability that runs at once or to an agent of the owner that receives the work as a task | `aimeat_app_tools_publish` | `aimeat/src/tool-catalog/definitions/commerce.ts` |
| Capability webhooks | A capability in the registry that calls the organisation's own endpoint | `AIMEAT_CAPABILITY_WEBHOOKS`, disabled by default | `aimeat/src/services/capability-invoke.ts` |
| Outside MCP servers | The node calls another MCP server that a person, a group or the operator attached | `aimeat_mcp_attach` | `aimeat/src/services/mcp-client/transport.ts` |
| Webhooks and operator hooks | The node tells the organisation's services about events | `aimeat_admin_hook_set` | `aimeat/src/services/webhook-dispatcher.ts`, `aimeat/src/services/hooks.ts` |
| AI models | Inference at a provider, or on the organisation's own model servers (`AIMEAT_AI_PROVIDER_EGRESS`); typed decisions at a separate decision service, also a local one without a key | The decision provider client | [06 AI and models](06-ai-and-models.md), `aimeat/src/services/decide/systemone-client.ts` |
| File bytes | Stored files in an S3-compatible service or Azure Blob instead of the database | `AIMEAT_FILE_STORE` | `aimeat/src/storage/blob/s3-client.ts`, `aimeat/src/storage/blob/azure-client.ts` |

Every outbound call these make is listed, with its setting, on [02 Architecture](02-architecture.md#outbound-traffic-the-egress-allowlist).

## Availability

| Question | Answer from this architecture | Source |
|---|---|---|
| What does an outage of one node stop? | The people and agents of that node lose the web UI, MCP and REST of that node, and its apps. Stored data is not touched. Peers keep working, and messages to the node wait at the senders. Scheduled jobs wait: at the next start a daily or longer core job runs once to catch up, and a person's missed schedule is written to its run log as skipped | `aimeat/src/services/scheduler-catch-up.ts`, `aimeat/src/services/message-delivery.ts` |
| Why does the node stay small? | It holds refined knowledge and the state that apps show. Model inference and heavy processing run in other services, so a heavy job cannot take the knowledge store down with it, and a node outage does not stop those services' own work | [Services around a node](#services-around-a-node) |
| How is one host's loss covered? | One active process with a standby on a second host; several active processes are not supported yet | [Several node processes on one database](#several-node-processes-on-one-database) |
| How is the blast radius kept small? | Separate nodes for units, partners or people: an outage, a setting or a breach on one node stays on it | [Many nodes](#many-nodes) |
| How is the database covered? | PostgreSQL's own standby and WAL archiving, and backups with a tested restore; the RTO and RPO tiers are on page 11 | [11 Backup and recovery](11-backup-recovery.md#proposed-rto-and-rpo) |

## Operator access is a design decision

The operator answers for what the node holds: the organisation is the controller of the personal data on it, and the operator is its technical arm, who runs exports and erasures, answers data subject requests and handles incidents ([03 Shared responsibility](03-shared-responsibility.md)). To do that, the operator keeps the last access to the content of the node. Application permissions also cannot hide content from whoever runs the host or the database ([threat model](../security/threat-model.md#threats-to-test)).

What the node does with that access is record it:

- An operator's read, search, delete, restore or export of another person's records writes two records: a usage row in the operator's own stream that names the account, and a line on that person's account feed, both written before the answer is sent (`aimeat/src/services/operator-access-audit.ts`, [Data ownership, section 8](../data-ownership.md#8-the-operator-is-accountable)).
- An operator's other acts in a person's account write the same trail (`operator_acted`), and an operator's change to a node setting writes a usage row and a log line (`aimeat/src/services/operator-access-audit.ts`).
- An operator's agent acts as operator only for the permission words the operator gives it, such as `operator:admin` (`aimeat/src/services/operator-principal.ts`).

What the organisation decides: who holds the operator role, how operator duties are separated, how often the trail is reviewed, and what the privacy notice tells people about operator access ([14 Compliance mapping](14-compliance-mapping.md)).

Content that must stay out of every other operator's reach belongs on a node its owner runs: a personal node or a team node with its own operator ([A personal or local node](#a-personal-or-local-node), [Many nodes](#many-nodes)). The architecture allows any number of them, and federation lets them share what their owners choose.

## Limits

- More than one active process is not supported yet. One active process with a standby is.
- The project records no test of several node processes behind a load balancer, and no failover test of a standby process. Two processes starting together on one empty database are tested (`aimeat/test/e2e-boot-lock.ts`), and so is the drain of a stop (`aimeat/test/e2e-graceful-shutdown.ts`); the database claims for scheduled work, start steps and the node key are covered by unit tests.
- With several processes: live updates, the read cache, rate limits and the per-account limits, the sign-in tarpit, the AI key hold, short sign-in steps, live stream tickets, the replay caches, presigned upload handles, the peer and internet-opening lists, realtime rooms, chunked uploads, 2025-era MCP sessions, idempotency keys and the setup code stay in one process; a Config page change reaches the other processes at their next start; the start of a process fails the AI jobs the others run; and the workflow run lock is per process (table above).
- The `relay` and `mirror` node types are not established for replication or redundancy ([Environment examples](../coding-guidelines/environment-configs.md#relay-and-mirror-types)).
- Federation does not fail one node over to another and does not copy private records. An organism lives on one node.
- The operator of a node can read the records of the people on it; the node records each read and does not prevent it.
- The repository gives no sizing figures for a node of a given number of people and agents (see the open question on [02 Architecture](02-architecture.md#open-questions)).

## Open questions

- OPEN: Has the project run one node as an active process with a standby, under load, and with which load balancer rules? The maintainer named in `.github/SECURITY.md` can answer.
- OPEN: Will the short sign-in steps (MCP OAuth codes, app grant codes, passkey ceremonies, WebSocket tickets), the replay cache and the start-up reconciliation of AI jobs and workflow runs move to the database, so that several processes can serve without routing the sign-in paths to one process? The maintainer can answer.
- OPEN: Can a person signed in from a peer node through cross-node sign-in be a member of an organism on this node, and which workspace operations are open to such a member? The maintainer can answer.
