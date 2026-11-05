# 15 Operations runbook

> Checked against AIMEAT node 4.2.0 (commit f36018fcd) on 2026-11-05. Maintained with the code: see the README for how.

How an AIMEAT node is installed, configured and run day to day, what to do when a common symptom appears, and who is responsible for what. It is for the operator (the account with the node's admin role, `docs/coding-guidelines/identity-model.md`) and for the IT and security staff behind that account. The order of first-time steps is on [00 Go-live checklist](00-go-live-checklist.md); this page is what comes after, plus the short install sequence.

Day-to-day operation is done from the admin page (`/v1/admin`) or by the operator's own AI through the `aimeat_admin_*` MCP tools; the built-in skill `aimeat-node-operations` teaches an AI those tools ([operating a node](../operations/README.md)).

## Installation

The full procedure is in [build and operate a node](../coding-guidelines/getting-started.md#build-and-operate-a-node) and [production deployment](../operations/production-deployment.md). The short sequence:

1. Prepare the host: Node.js 24, PostgreSQL (or a SQLite file location), a reverse proxy with TLS, and the DNS names from [00 Go-live checklist, phase 2](00-go-live-checklist.md#phase-2-dns-and-tls).
2. Install one of three ways: the npm package (`npx aimeat init`, then `npx aimeat start`), a source build (`pnpm build`, `pnpm start` in `aimeat/`), or Docker (`aimeat/Dockerfile` with `aimeat/docker-compose.yml` for PostgreSQL or `aimeat/docker-compose.sqlite.yml` for SQLite).
3. Write `.env` (or the process manager's environment) with the decisions from [00 Go-live checklist, phases 1 and 3](00-go-live-checklist.md#phase-1-decide-before-install). `aimeat init` generates the keys; never run it again on an existing node, because it writes a new configuration ([upgrading](../operations/upgrading.md#the-update)).
4. Run under a process manager: `aimeat/deploy/aimeat.service` for systemd carries the restart policy, memory limits and stop timeout. On Docker, put the key directory on a volume (`AIMEAT_NODE_KEY_PATH`); the image's `HEALTHCHECK` calls `/v1/health/ready` on 127.0.0.1, so a node bound to another address (`AIMEAT_BIND_HOST`) needs its own ([production deployment, process manager](../operations/production-deployment.md#process-manager)).
5. Run `aimeat validate`, start the node, copy the setup code from the start log, create the operator account ([00 Go-live checklist, phase 4](00-go-live-checklist.md#phase-4-first-start)).
6. Take the first backup and test the restore before anyone else signs up ([backup and restore](../operations/backup-and-restore.md)).

A fresh node installs its bundled example packages by itself at start ([getting started](../coding-guidelines/getting-started.md#build-and-operate-a-node)).

## Configuration an organisation must decide

Every setting is in `aimeat/.env.example` and in the [configuration reference](../b-config.md). Many are also editable at runtime on the admin Config page (`/v1/admin?tab=config`) or with `aimeat_admin_config_set`; a value saved there is stored in the database and wins over `.env` (`aimeat/.env.example`, the 2026-10-25 block). The rows below are the ones whose default does not fit an organisation node, or that have no default.

| Variable | Default | Recommendation for an organisation node | Source |
|---|---|---|---|
| `AIMEAT_BASE_URL` | `http://localhost:<port>` | The final HTTPS address. Immutable at runtime; it fixes the passkey RP ID | `aimeat/src/services/config-schema.ts` |
| `AIMEAT_NODE_ID` | `aimeat-local-001-dev` | A unique id, set before the first start and never changed | `aimeat/.env.example`, [pitfalls §87](../pitfalls.md#87-a-node-that-changed-its-id-stops-receiving-its-own-seeded-upgrades) |
| `AIMEAT_STORAGE` | `memory` (data lost at restart) | `postgres-kysely` | `aimeat/src/config.ts` |
| `AIMEAT_SECURITY_PROFILE` | inferred: `public` when `AIMEAT_BIND_HOST` names an address beyond loopback. Otherwise `local` for a localhost, loopback, RFC 1918, link-local or IPv6 unique-local base URL or a personal node, and `public` for any other base URL | `public`, always, also on an internal network | `aimeat/src/config-private-host.ts` |
| `AIMEAT_REGISTRATION_MODE` | `open` | `oauth` (IdP sign-in creates accounts) or `invite` | [organisation node sign-in](../organisation-node-sign-in.md#1-two-gates-and-why-one-is-not-enough) |
| `AIMEAT_CONTENT_ACCESS` | `open` | `signed-in` for an internal node | `aimeat/.env.example` |
| `AIMEAT_PUBLISH_GATE` | `off` (code default; `aimeat init` writes `agents-and-apps`) | `agents-and-apps`: an agent or app asks the owner before it makes anything public | `aimeat/.env.example` |
| `AIMEAT_SEO_INDEXING` | `on` | `off` for an internal node | `aimeat/src/middleware/robots-header.ts` |
| `AIMEAT_ENCRYPTION_KEY` | none. The node then uses `AIMEAT_TOTP_ENCRYPTION_KEY`, which `aimeat init` generates. With neither, the features that store a secret answer 503 | 64 hex characters, kept in the secrets store, never changed. On a node installed with `aimeat init`, `AIMEAT_TOTP_ENCRYPTION_KEY` is the data key; keep and back up that one too. Added later, `AIMEAT_ENCRYPTION_KEY` becomes the data key for new secrets, and the ones stored before keep opening with the TOTP key, so keep that key set too ([11 Backup and recovery](11-backup-recovery.md#what-must-be-backed-up)) | `aimeat/.env.example`, `aimeat/src/services/encryption.ts` |
| `AIMEAT_KEY_PASSPHRASE` | none | Set; kept with the data key | `aimeat/.env.example` |
| `AIMEAT_ADMIN_PASSWORD` | generated per start, written to `admin-setup-secret` while no owner exists | Set a long random value, or leave unset and protect the file | `aimeat/.env.example` |
| `AIMEAT_TRUST_PROXY` | loopback trusted when the base URL is not localhost | A hop count (`1`) or the proxy's subnet; not `true` unless the outer proxy overwrites forwarded headers | [production deployment](../operations/production-deployment.md#what-the-proxy-must-pass-through) |
| `AIMEAT_APP_ORIGIN_ENABLED`, `AIMEAT_APP_HOST` | on with the public profile; host `apps.<base host>` | On, with wildcard DNS and certificate in place | `aimeat/.env.example` |
| `AIMEAT_PAGE_HOST` | empty (HTML pages shown as text) | A separate host if workspace HTML pages are used | [the page host](../operations/production-deployment.md#the-page-host) |
| `AIMEAT_SMTP_*` | no host (mail disabled); From `AIMEAT <noreply@localhost>` | The organisation's relay and a From address on a domain with SPF, DKIM and DMARC | `aimeat/src/config-smtp.ts` |
| `AIMEAT_EMAIL_CONFIRMATION_REQUIRED` | `false` | `true` when accounts are created by password | `aimeat/src/config-smtp.ts` |
| `AIMEAT_ENTRA_ALLOWED_TENANTS` | empty | The organisation's tenant GUID and approved partners | [organisation node sign-in](../organisation-node-sign-in.md#4-configure-the-node) |
| `AIMEAT_GOOGLE_OAUTH_ENABLED` | `false` | Keep off on an organisation node: no domain gate | [organisation node sign-in, section 6](../organisation-node-sign-in.md#6-what-the-gate-does-not-cover) |
| `AIMEAT_SSO_ENABLED` | `false` | On when SAML or SCIM is used | [organisation node sign-in, section 7](../organisation-node-sign-in.md#7-saml-and-scim-the-organisations-own-identity-provider-br-04) |
| `AIMEAT_TWO_STEP_REQUIRED` | `off` (required for nobody) | `operators`, or `everyone` when local accounts must also have two-step sign-in; keep `AIMEAT_TOTP_ENABLED` on | `aimeat/src/services/sign-in-policy.ts` |
| `AIMEAT_PASSWORD_SIGN_IN` | `on` (every account) | `operators` with an IdP; `off` only when every operator has a passkey or an IdP link | `aimeat/src/services/sign-in-policy.ts` |
| `AIMEAT_AI_PROVIDER_ALLOWLIST` | empty (any host) | The provider hosts in use, for example `openrouter.ai` | `aimeat/src/config-posture.ts` |
| `AIMEAT_AI_OPENROUTER_REGION`, `AIMEAT_AI_OPENROUTER_REGION_FALLBACK` | `any`, `us` | The region the DPO approved, and fallback `off` if no other region is acceptable | [where AI calls are processed](../operations/openrouter-region.md#the-four-settings) |
| `AIMEAT_EXT_INSTALL_ROLE` | `owner` (any account installs extensions) | `operator` | `aimeat/src/config-posture.ts` |
| `AIMEAT_STATS_ACCESS` | `public` in code (`operator` in the example file) | `operator` | `aimeat/src/config.ts` |
| `AIMEAT_METRICS_ENABLED`, `AIMEAT_METRICS_ACCESS` | `false`, `operator` | On, `operator`, scraped by the monitoring system | [observability guide](../../aimeat/docs/observability-guide.md) |
| `AIMEAT_CLASSIFICATION` | `off` | `owner` or `all` if the organisation classifies data | [data classification](../data-classification.md#the-switch) |
| `AIMEAT_COOKIE_CONSENT_ENABLED` | `false` | On if analytics tags are allowed on pages | [cookie banner](../data-classification.md#the-cookie-consent-banner) |
| `AIMEAT_OPERATOR_*` | none (privacy and terms pages answer 503) | The controller's details, filled by the DPO | `aimeat/.env.example`, Operator info |
| `AIMEAT_AI_SUPERVISORY_NAME`, `AIMEAT_AI_SUPERVISORY_URL` | empty (reported as unstated) | The AI Act market-surveillance authority | `aimeat/.env.example` |
| `AIMEAT_FEDERATION_ROLE` | `standalone` | `standalone` unless the node joins a federation | [running federation](../operations/federation.md#the-settings-that-decide-it) |
| `AIMEAT_UPDATE_CHECK` | on (asks the npm registry) | Off on a node without internet egress | `aimeat/src/config-update-check.ts` |
| `AIMEAT_SEALED_CONFIG_KEYS` | empty | The paths the hosting party fixes, when host and operator differ | [environment examples, host-sealed settings](../coding-guidelines/environment-configs.md#host-sealed-settings) |
| `AIMEAT_LOG_LEVEL` | `info` | `info` or `warn` | `aimeat/src/config-runtime.ts` |

## Routines

| When | What | How | Source |
|---|---|---|---|
| Daily | Health | `GET /v1/health`, reading `status` (it answers 200 when degraded); `GET /v1/build` after any restart | [health checks](../operations/production-deployment.md#health-checks) |
| Daily | Security page | Open incidents, test switches, refusals in the last 24 hours with their zone, walled addresses | `/v1/admin?tab=security`, `aimeat_admin_security_overview`; `aimeat/src/services/security-overview.ts` |
| Daily | Backup ran | The database, `.env` and key file were copied off the machine | [backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| Weekly | Updates | The header notice, or `aimeat_admin_node_update`, shows the newest version and the install-specific steps; only the newest release receives security fixes (`.github/SECURITY.md`) | [upgrading](../operations/upgrading.md#find-out-what-is-available) |
| Weekly | Agents | Who has agents, their scopes, last activity; disable what is unused | `/v1/admin?tab=agents`, `aimeat_admin_agents` |
| Weekly | App openings | On a signed-in-only node, which apps are open to the internet, why, and until when; openings close after their maximum days | `/v1/admin?tab=internet`, `aimeat_admin_internet_openings`, `AIMEAT_APP_INTERNET_OPENING` |
| Monthly | Restore test | Restore on a separate machine or port with the same `.env` and key file, check health, build, and a known record. The backup guide sets once a month and after every change to the installation | [test the restore](../operations/backup-and-restore.md#test-the-restore) |
| Monthly | Compliance snapshot | The node writes a monthly report on the first of each month; the operator reads it and keeps a manual one for audits | `aimeat_compliance_snapshot`, `aimeat_compliance_report`, `/v1/admin?tab=compliance` |
| Monthly | Accounts and operators | Operator list, deactivated accounts, accounts with two-step sign-in on | `aimeat_admin_security_overview` (accounts block) |
| Monthly | Dependencies (source installs) | `pnpm audit` | [deployment checklist](../security/deployment-checklist.md#pre-deployment) |
| After each update | Incidents | A database change that cannot place data on evidence opens one incident; decide each case | `aimeat_admin_incident_resolve`; [upgrading](../operations/upgrading.md#the-update) |
| Every 180 days | This package | Re-read the pages against the running version | README of this package |

## Troubleshooting

| Symptom | Likely cause | What to do | Source |
|---|---|---|---|
| Every app address answers 502 | The response headers outgrew the proxy's header buffer (nginx default 4 kB); an earlier version listed every app origin | Raise the proxy's response-header buffer (`proxy_buffer_size`), and run the current version | [production deployment, response header size](../operations/production-deployment.md#what-the-proxy-must-pass-through) |
| App addresses answer 301 to a host that does not resolve | App origin isolation is on (default with the public profile) and the wildcard DNS or certificate is missing | Create the records and certificate, or set `AIMEAT_APP_ORIGIN_ENABLED=false` until they exist | `aimeat/.env.example`, App Origin Isolation |
| The node goes off the air after an app name or certificate was created | The node's name answered only through a parent wildcard record | Give the node's name its own record | [the wildcard trap](../operations/production-deployment.md#names-and-certificates) |
| App, portfolio or company addresses show the node's own site | The proxy rewrites `Host` to an internal name; the node decides the family from the raw `Host` | `proxy_set_header Host $host`; the node does not read `X-Forwarded-Host` | [what the proxy must pass through](../operations/production-deployment.md#what-the-proxy-must-pass-through) |
| IdP sign-in fails or returns to the sign-in page | The redirect URI registered at the IdP differs from the one the node sends. The node computes it from `AIMEAT_BASE_URL` unless `AIMEAT_ENTRA_OAUTH_REDIRECT_URI` or `AIMEAT_GOOGLE_OAUTH_REDIRECT_URI` sets it (`aimeat/src/services/oidc-providers.ts`). Or people reach the node by another address than the base URL | Register exactly `<base>/v1/ghii/login/entra/callback` or `<base>/v1/ghii/login/google/callback`; publish one address | [organisation node sign-in, section 5](../organisation-node-sign-in.md#5-check-that-it-works) |
| Client addresses in logs are all the proxy's, or rate limits hit everyone at once | `AIMEAT_TRUST_PROXY` does not match the proxy path | Set the hop count or subnet | [deployment checklist, network security](../security/deployment-checklist.md#network-security) |
| Sign-in links and codes land in spam | The From domain has no SPF, DKIM or DMARC alignment; the node does not DKIM-sign | Publish the records at the mail provider, send through a relay that signs, test from the admin Email tab | [00 Go-live checklist, phase 5](00-go-live-checklist.md#phase-5-email) |
| No mail at all, the Email tab says disabled | `AIMEAT_SMTP_HOST` is not set | Set the SMTP settings | `aimeat/src/config-smtp.ts` |
| Passkeys stop working after a domain change | A passkey is bound to the RP ID, which is the old host | People register new passkeys on the new domain; to keep old ones, the RP ID must stay the old registrable domain (`AIMEAT_PASSKEY_RP_ID`) and the new origin must be under it | `aimeat/src/services/config-schema.ts`, [W3C WebAuthn, RP ID](https://www.w3.org/TR/webauthn-3/#relying-party-identifier) |
| Chat answers, live updates or MCP sessions stop after some seconds | The proxy buffers or times out streams | Turn buffering off for the stream paths (the node sends `X-Accel-Buffering: no`, which nginx honours) and set a long read timeout | [what the proxy must pass through, streams](../operations/production-deployment.md#what-the-proxy-must-pass-through) |
| Uploads fail with the proxy's 413, not the node's `QUOTA_EXCEEDED` | The proxy's body limit is below the node's | Raise `client_max_body_size` to at least the largest node limit | [body size](../operations/production-deployment.md#what-the-proxy-must-pass-through) |
| The node refuses to start and names a key variable | The data key or key passphrase differs from the one the database was written with, and no matching key file exists | Restore the original values; the node never makes a new identity | [backup and restore, what a node is](../operations/backup-and-restore.md#what-a-node-is) |
| AI keys, vault secrets or two-step sign-in stop working after a restore | The restore used a different data key: `AIMEAT_ENCRYPTION_KEY`, or `AIMEAT_TOTP_ENCRYPTION_KEY` when the first is not set | Restore with the original key | [backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| The first account is refused with `SETUP_CODE_REQUIRED` or `SETUP_CODE_INVALID` | The node has no operator and wants the code from its start log | Copy the line that starts with `Setup code:`; a restart issues a new one | `aimeat/src/services/setup-code.ts` |
| Health answers 200 but the monitoring says healthy while storage is down | The check reads the HTTP code only | Read `status` and `subsystems.storage` | [health checks](../operations/production-deployment.md#health-checks) |
| A browser feature works from a shell and fails under systemd | The unit's environment (`LD_PRELOAD`, `NODE_OPTIONS`) reaches child processes | Compare `systemctl show aimeat -p Environment` | [pitfalls §12](../pitfalls.md#12-deploy-release--node-hosted-apps) |
| After an update, connected agents no longer see tools they used before | A tool gained a permission word; the node registers a tool only for sessions that hold every word | Check the Security page for the migration incident; re-approve the agent with the word | [pitfalls §119](../pitfalls.md#119-after-a-deploy-agents-no-longer-see-tools-they-used-yesterday-every-test-is-green) |
| On a signed-in-only node, a signed-in person gets `401 SIGN_IN_REQUIRED` on a picture, link or stream | A browser request that carries no credential reached the content gate; this is a defect in the node | Report it with the address to the maintainer | [pitfalls §124](../pitfalls.md#124-signed-in-and-a-page-picture-link-or-stream-answers-401-on-a-signed-in-only-node) |

Security incidents follow [incident response](../security/incident-response.md).

## Responsibilities (RACI)

R responsible, A accountable, C consulted, I informed. An organism is AIMEAT's shared space for a group of people and their agents, holding workspaces of documents and records; its admins manage its members ([03 Shared responsibility](03-shared-responsibility.md)).

| Activity | Operator | IT security | DPO | Organism admins | Users |
|---|---|---|---|---|---|
| Install, configure, update the node | R/A | C | I | I | I |
| DNS, TLS, proxy, firewall | R | A | | | |
| Secrets (data key, passphrase, admin password) | R | A | | | |
| Backup and restore test | R/A | C | I | | |
| Security page review, incidents | R | A | I | I | |
| Incident response | R | A | C (personal data breach) | I | I |
| Sign-in methods, registration mode, tenant allowlist | R | A | C | | I |
| AI providers, region, egress allowlist | R | C | A | I | I |
| Operator details, privacy notice, supervisory authorities | C | | R/A | | I |
| Records of processing, compliance register | C | C | R/A | C (their organism's) | |
| Data classification policy | R | C | A | R (their organism's) | I |
| Agents' scopes and review | C | C | | C | R/A (their own agents) |
| Organism membership and workspace sharing | I | | C | R/A | C |
| App openings to the internet | R/A (approves) | C | C | | R (asks) |
| A person's own data: export, delete, leave | I | | C | | R/A |

## Limits
- The operations guides describe one node process per database, which is the default (`AIMEAT_NODE_PROCESSES=single`). Several processes on one PostgreSQL database are supported, as a standby or as more active processes, with `AIMEAT_NODE_PROCESSES=multiple` on every process, and what stays per process is listed on [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md#several-node-processes-on-one-database); the project records no test of several processes behind a load balancer.
- The compose files keep no volume for the node's key directory; that is the installer's job. The image's health check asks `/v1/health/ready` on 127.0.0.1 ([production deployment, process manager](../operations/production-deployment.md#process-manager)).
- Logs go to standard output only (one console transport in `aimeat/src/utils/logger.ts`), as JSON when `NODE_ENV=production` (set in `aimeat/Dockerfile`, not in `aimeat/deploy/aimeat.service`). There is no built-in SIEM or syslog forwarder; the process manager or a log shipper must carry them.
- `aimeat backup` and the admin backup are partial JSON exports, not node backups; the real backup is the database, `.env` and the key file ([backup and restore](../operations/backup-and-restore.md#what-is-not-a-backup)).
- Going back to an older version needs the backup taken before the update; an older version does not undo database changes ([upgrading](../operations/upgrading.md#the-update)).
- Only the newest release receives security fixes; there is no long-term support line (`.github/SECURITY.md`).
- The node asks the npm registry for updates by default, an outbound connection an isolated network must turn off (`AIMEAT_UPDATE_CHECK`).
- `AIMEAT_STATS_ACCESS` defaults to `public` in code although the example file sets `operator`; a node that does not copy the example exposes statistics (`aimeat/src/config.ts`).

## Open questions
- OPEN: Can a proxy that rewrites `Host` cause a sign-in loop, or only the wrong-family symptom that production-deployment.md describes? No test or document in the repository shows a loop. The maintainer named in `.github/SECURITY.md` can answer.
