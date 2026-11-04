# 16 Known limitations

> Checked against AIMEAT node 4.2.0 (commit a463a1e3b) on 2026-11-03. Maintained with the code: see the README for how.

Every known limitation of AIMEAT in one place, for the IT, security and data protection staff deciding whether to run it. Each row says what the limitation is, what follows from it, what the organisation can do about it, and where it is recorded. A limitation that has a setting is listed with that setting; "off by default" means the protection exists and the organisation must turn it on. The pages of this package carry their own `## Limits`; those the tables do not already carry are in the section "From the other pages" below.

## Assurance and the project

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| No commissioned external security audit, penetration test or certification is recorded in the repository. An adopting organisation's own security team has tested its production node; the organisation is not named and its report is not published | Security claims rest on the code, the project's own tests, the project's own probe sessions and that adopter's testing | Commission an independent review or penetration test against a throwaway node; re-run the listed probes | [verification matrix](../security/verification-matrix.md#how-to-re-run), [AI transparency, what we do not claim](../ai-transparency.md#8-what-we-do-not-claim) |
| The standing security verification is the project's own guard E2E tier, and the dated probe results live in a development notes workspace on the project's node, not in the repository | An outside reader can run the tests but cannot read the raw probe output from the repository | Run `pnpm test:e2e:guards:postgres-kysely` and the listed scanners yourself | [verification matrix](../security/verification-matrix.md#standing-verification-runs-on-every-merge) |
| Historical measurements apply to their stated date and commit | A measurement may no longer describe the running version | Re-run current checks before relying on a security claim | [threat model, current limitations](../security/threat-model.md#current-limitations) |
| One maintainer. The commit history has one human author, and the security policy names one maintaining company and one contact address | Review capacity and response time of the project depend on one party. The response timeline (acknowledge within 48 hours, assess within a week, fix within two weeks) is an aim, not a contract | Operate it yourselves, as organisations operate Linux, PostgreSQL or nginx without a support contract. The node is built for that: `aimeat validate`, the start-time security check, the [15 Operations runbook](15-operations-runbook.md), and the node-operations skill the organisation's own AI reads over MCP (`aimeat/src/data/builtin-skills.runbooks.ts`). A support contract is an option, not a precondition. Continue it yourselves when needed. The MIT licence lets the organisation fork the repository and maintain its own copy, also internally, with a team of any size. The repository carries what a new team needs to continue from the same point: the working rules (`CLAUDE.md`, `.claude/rules/`), the coding guidelines and the catalogue of traps already met (`docs/coding-guidelines/`, `docs/pitfalls.md`), the checks that run locally (`pnpm gate`, `aimeat/scripts/gate.ts`, `aimeat/scripts/lib/check-registry.mjs`, the hooks in `.githooks/`), the E2E suites on both databases with the security guard tier (`aimeat/test/`, `pnpm test:e2e:guards:postgres-kysely`), and the CI workflows (`.github/workflows/`). The steps are on [17 Exit plan, continue it yourselves](17-exit-plan.md#continue-it-yourselves) | `.github/SECURITY.md`, `LICENSE`, `CLAUDE.md` |
| Only the newest release receives security fixes; there is no long-term support line | An organisation must follow releases to stay patched | Budget for regular updates ([12 Updates and releases](12-updates-releases.md)) | `.github/SECURITY.md` |
| No signed releases of the node. The npm package is published with `npm publish` from the maintainer's machine through the `prepublishOnly` script; no workflow publishes it with a provenance attestation, and the node's release tags in the repository are lightweight and unsigned | The organisation cannot verify cryptographically that a package or tag came from the maintainer | Build from source at a reviewed commit, or pin an exact version and compare it with the source; `GET /v1/build` reports the running commit and whether the build matches its source | `aimeat/package.json`, `aimeat/scripts/release-ready.mjs`, [production deployment, health checks](../operations/production-deployment.md#health-checks) |
| The desktop app's updater files are signed, but the installers are not code-signed for Windows or macOS, by decision | The operating system warns at install | Not relevant for a server node; for desktop use, decide whether the warning is acceptable | `.github/workflows/release-desktop.yml` |

## Security controls

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| Application permissions do not protect against unrestricted access to the host or the database | Whoever has root on the server or direct database access can read everything that is not encrypted | Restrict host and database access; treat them as a separate trust boundary | [threat model](../security/threat-model.md#threats-to-test) |
| The node encrypts stored secrets only (AI keys, vault entries, two-step secrets, MCP server tokens). Records and stored files are kept as written, in the database or, with an outside file store, in the bucket | A database dump, a bucket copy or a disk image contains people's content in readable form | Encrypt the database volume, the bucket and the backups at the host or provider level | [data ownership, secrets](../data-ownership.md#7-secrets-stay-secret), [backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| The node's own pages and API send no `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy` or `Cross-Origin-Resource-Policy`, and no response sends `X-Permitted-Cross-Domain-Policies`. The exceptions: the HTML page host sends `Permissions-Policy` and `Cross-Origin-Resource-Policy`, and publicly readable stored files and agent avatars send `Cross-Origin-Resource-Policy: cross-origin` | Info-level hardening gaps; adding the cross-origin headers can break app embedding | Add them at the proxy only after testing the app viewer in a browser | [verification matrix, open items](../security/verification-matrix.md#open-items-info-level-hardening-no-live-risk), `aimeat/src/routes/page-host.ts`, `aimeat/src/routes/storage-files.ts`, `aimeat/src/services/agent-avatar.ts` |
| Bearer-token paths reflect any `Origin` with credentials, by design; the cookie paths are fenced to listed origins, which stays safe only while the list of cookie paths is complete | A new cookie-reading route missing from the list would be exposed cross-origin | Keep `AIMEAT_CORS_ALLOWED_ORIGINS` narrowed if the organisation's own app origins are known; watch for this in release notes | [verification matrix](../security/verification-matrix.md#what-the-probe-sessions-established), `aimeat/src/middleware/cors.ts` |
| The start-time self-check warns and never refuses | A node with unsafe settings starts and runs | Treat every `SECURITY` line in the start log as a finding; read the Security page | `aimeat/src/config-posture.ts` |
| A node with a private-IP base URL (or node type `personal`), no explicit profile, and `AIMEAT_BIND_HOST` empty or a loopback address runs the `local` profile, which allows loopback egress, turns app origin isolation off, and logs none of the public-profile warnings; only the test-only switches are still reported | An internal node can run with development defaults without saying so | Set `AIMEAT_SECURITY_PROFILE=public` | `aimeat/src/config-private-host.ts`, `aimeat/src/config-posture.ts` |
| Protections off by default: data classification (`AIMEAT_CLASSIFICATION`), SAML and SCIM (`AIMEAT_SSO_ENABLED`), cookie banner (`AIMEAT_COOKIE_CONSENT_ENABLED`), metrics (`AIMEAT_METRICS_ENABLED`), publish gate (`AIMEAT_PUBLISH_GATE`, code default), email confirmation (`AIMEAT_EMAIL_CONFIRMATION_REQUIRED`) | The node starts without them | Turn on the ones the organisation needs ([00 Go-live checklist](00-go-live-checklist.md)) | `aimeat/.env.example` |
| Defaults that are open: storage `memory`, registration `open`, content access `open`, indexing `on`, AI provider allowlist empty, extension installs by any owner (`AIMEAT_EXT_INSTALL_ROLE`), statistics `public` in code (`AIMEAT_STATS_ACCESS`), CORS `*` | A node started from defaults loses data at restart and is open to registration and reading | Set each one ([15 Operations runbook, configuration](15-operations-runbook.md#configuration-an-organisation-must-decide)) | `aimeat/src/config.ts`, `aimeat/.env.example` |
| The Security page's refusal statistics read at most the last megabyte of each of the two generations of a log that rotates at `AIMEAT_AUTH_LOG_MAX_BYTES` (5 MiB by default) | Long-range trends are not available from the node | Ship logs to the organisation's own log store | `aimeat/src/services/security-overview.ts`, `aimeat/src/services/auth-audit.ts`, `aimeat/src/config-security.ts` |
| The application log goes to standard output only, and the refusal log to a local file (`AIMEAT_AUTH_LOG_PATH`, `./data/auth-failures.log` by default); there is no built-in SIEM or syslog forwarder | Log retention and correlation are the host's job | Collect standard output and the refusal log file with the process manager or a log shipper | `aimeat/src/utils/logger.ts`, `aimeat/src/config-security.ts` |
| EUDIW (EU Digital Identity Wallet) verification is blocked at start until holder binding and replay defences are implemented | Wallet-based identity verification is not available | None today | [threat model](../security/threat-model.md#current-limitations), [EUDIW status](../aimeat-eudiw-integration.md) |

## Identity and sign-in

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| Two-step sign-in is required for nobody, and password sign-in is on for everyone, until the operator sets `AIMEAT_TWO_STEP_REQUIRED` and `AIMEAT_PASSWORD_SIGN_IN` | A node started from defaults accepts an account with only a password | Set `AIMEAT_TWO_STEP_REQUIRED=operators` (or `everyone`) and `AIMEAT_PASSWORD_SIGN_IN=operators` ([09 Hardening guide](09-hardening-guide.md)); prefer IdP sign-in with the IdP's own MFA policy | `aimeat/src/config-types-account-security.ts`, `aimeat/src/services/sign-in-policy.ts` |
| Google sign-in has no tenant or domain gate | Under registration mode `oauth`, any Google account can create an account | Keep `AIMEAT_GOOGLE_OAUTH_ENABLED` off on an organisation node | [organisation node sign-in, section 6](../organisation-node-sign-in.md#6-what-the-gate-does-not-cover) |
| Guests in the organisation's Entra tenant carry its tenant id and pass the allowlist | Anyone the Entra admins invite as a guest can sign in | Decide guest policy in Entra | [organisation node sign-in, section 6](../organisation-node-sign-in.md#6-what-the-gate-does-not-cover) |
| Under `oauth` and `invite`, any member can mint an invitation, and the invited person gets an account from any tenant or none (with a password while `AIMEAT_PASSWORD_SIGN_IN` is `on`) | Members can bring in outsiders | Use organism roles to limit who invites | [organisation node sign-in, section 6](../organisation-node-sign-in.md#6-what-the-gate-does-not-cover) |
| The sign-in dialog shows the registration form under every mode; the endpoint behind it refuses | People see a form that does not work | Tell users | [organisation node sign-in, section 6](../organisation-node-sign-in.md#6-what-the-gate-does-not-cover) |
| A passkey is bound to the node's domain, and the RP ID is immutable at runtime | A domain change invalidates every passkey | Fix the domain before the first passkey | `aimeat/src/services/config-schema.ts` |

## Data protection and data lifecycle

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| A deleted record or erased account stays in every older backup until that backup is discarded; a restore brings it back | Erasure is complete only when the backups age out | Set a backup retention period and state it in the privacy notice | [backup and restore](../operations/backup-and-restore.md#how-often-and-how-long) |
| Workspace rows, whole workspaces, organisms, stored files, apps, agents and accounts skip the deletion bin and are removed at once | No undo for those deletes | Rely on backups for recovery of these | [data ownership, section 3](../data-ownership.md#3-a-delete-can-be-taken-back-for-a-while) |
| The admin JSON backup and `aimeat backup` are partial exports | They cannot restore people's records, organisms, apps or files | Back up the database, `.env` and key file | [backup and restore, what is not a backup](../operations/backup-and-restore.md#what-is-not-a-backup) |
| With the cookie banner off, analytics tags a person adds load at once | Analytics without consent on those pages | Turn the banner on, or restrict tags with `AIMEAT_ANALYTICS_TAGS` | [cookie banner](../data-classification.md#the-cookie-consent-banner) |
| By design, the operator can read the records of the people on the node: the operator answers for what the node holds and must be able to act on it. Each read, search, delete, restore or export of another person's records is recorded in the operator's usage stream and on that person's account feed | People on an organisation node share it with that node's operator. Content that must stay out of every other operator's reach needs a node its owner runs | Say in the privacy notice that the operator can read records and that each read is recorded; give the operator role to few people and separate their duties; review the trail; offer a personal or team node where full privacy is needed ([18 Scope and deployment patterns](18-scope-and-deployment-patterns.md#operator-access-is-a-design-decision)) | [data ownership, section 8](../data-ownership.md#8-the-operator-is-accountable), `aimeat/src/services/operator-access-audit.ts` |

## AI

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| AI use outside AIMEAT is not covered. The node records and marks only what passes through it or what a principal declares | People who paste data into an AI service directly are not seen, logged or classified | Keep a separate AI use policy for tools outside the node | [AI transparency, what it cannot do](../ai-transparency.md#2-what-it-cannot-do-for-you) |
| The node does not watermark model output, and a text mark is lost when text is copied | Provenance survives in the node's records, not in copied text | Use the provenance record (`GET /v1/ai-transparency` and the per-record data) as the evidence | [AI transparency, what it cannot do](../ai-transparency.md#2-what-it-cannot-do-for-you) |
| Running the node does not make the organisation AI Act compliant | Deployer duties stay with the organisation | Map duties on [14 Compliance mapping](14-compliance-mapping.md) | [AI transparency, section 3](../ai-transparency.md#3-which-hat-are-you-wearing) |
| What an agent reports about itself is recorded and never checked. `aimeat_agent_runtime_report` stores the agent's claim about the code it runs and where its model calls go (`llm`, for example `"local"`); the node does not run that process and cannot read its disk | A claim that model calls stay local is a statement, not evidence | Verify agent hosts by the organisation's own means; treat the report as a declaration | `aimeat/src/tool-catalog/definitions/agent-messaging.ts` |
| A principal that tells the node something false is recorded as having said it | Provenance is attribution, not truth | Review agent declarations | [AI transparency, what it cannot do](../ai-transparency.md#2-what-it-cannot-do-for-you) |
| The OpenRouter region fallback defaults to `us` | With region `eu`, a model the EU region lacks is sent to the United States | Set `AIMEAT_AI_OPENROUTER_REGION_FALLBACK=off` | [where AI calls are processed](../operations/openrouter-region.md#the-four-settings) |
| Content an AI reads is sent to the chosen provider and processed there under that provider's terms | The node cannot control provider-side retention | Choose the provider and region with the DPO ([06 AI and models](06-ai-and-models.md)) | [where AI calls are processed](../operations/openrouter-region.md) |
| An EU Code of Practice signature is configuration, empty by default | A node reports `signatory: false` until its own operator signs and sets it | Set `AIMEAT_AI_COP_SECTIONS` only after the AI Office confirms | [AI transparency, section 8](../ai-transparency.md#8-what-we-do-not-claim) |

## Operations

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| One active process with a standby on one PostgreSQL database is supported; more than one active process is not supported yet. Scheduled work, start steps, the node key, migrations and the boot seeding are claimed in the database, and the short sign-in steps (MCP OAuth codes, passkey ceremonies, live stream tickets), the replay caches and the per-account limits are kept there. Live updates, request rate limits, the peer and internet-opening lists, 2025-era MCP sessions and Config page changes stay in one process, and the start of a process fails the AI jobs the others run. The project records no test of a standby taking over behind a load balancer | With several active processes, the request rate limits multiply by the number of processes and live updates reach only the clients of the process that made the write. A lost database host is an outage until the database is restored or its standby takes over | Choose a pattern on [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md): one process with a process manager restart, one active process with a standby, several active processes with the sign-in paths routed to one of them, or separate nodes to keep one outage small. Plan RTO and RPO around the database ([11 Backup and recovery](11-backup-recovery.md)) | `aimeat/src/services/scheduler-fire-claim.ts`, `aimeat/src/services/event-bus.ts`, `aimeat/src/mcp/oauth.ts`, [18](18-scope-and-deployment-patterns.md#several-node-processes-on-one-database) |
| The compose files keep no volume for the node's key | A new container without the key file takes the identity from the database copy, which is encrypted only with `AIMEAT_KEY_PASSPHRASE` or `AIMEAT_ENCRYPTION_KEY`; if neither the copy nor a key file opens, the node refuses to start. The shipped compose files set neither, so there the copy is stored unencrypted in the database | Mount the key path on a volume and set `AIMEAT_KEY_PASSPHRASE`. The image's health check asks `/v1/health/ready` on 127.0.0.1; a node bound to another address needs its own | [production deployment, process manager](../operations/production-deployment.md#process-manager), `aimeat/src/auth/node-keys.ts`, `aimeat/docker-compose.sqlite.yml` |
| Going back to an older version needs the backup taken before the update | No in-place downgrade | Always back up before an update | [upgrading](../operations/upgrading.md#the-update) |
| The node makes outbound connections by default: the update check to `registry.npmjs.org` and `unpkg.com`, signature checks to the EU trusted lists and to certificate issuers (OCSP, CRL, missing issuer certificates), and with `AIMEAT_SCREENSHOT_AUTO` and no system Edge or Chrome a Chromium download from `cdn.playwright.dev` | An isolated network sees refused connections | Turn off `AIMEAT_UPDATE_CHECK` or point `AIMEAT_UPDATE_CHECK_SOURCE` at a mirror; turn off `AIMEAT_DOCSIGN_ONLINE_CHECKS`; keep `AIMEAT_SCREENSHOT_AUTO` off | `aimeat/src/config-update-check.ts`, `aimeat/src/services/node-update-check.ts`, `aimeat/src/services/config-schema-docsign.ts`, `aimeat/.env.example` |

## Federation and protocol

| Limitation | Consequence | What the organisation can do | Source |
|---|---|---|---|
| Relay-fee shares on a multi-hop settlement are computed and paid to nobody (GAP-001, low) | A node that forwards settlements earns nothing for it | Not relevant for a standalone node | [known gaps](../known_gaps.md#gap-001-relay-fee-shares-on-a-multi-hop-settlement-are-computed-and-paid-to-nobody) |
| The `relay` and `mirror` node types are accepted, but working replication, stateless operation and a tested resource budget are not established | Do not rely on them for redundancy | Use `full` | [environment examples](../coding-guidelines/environment-configs.md#relay-and-mirror-types) |

## From the other pages

Every page of the package ends with its own `## Limits`. The ones the tables above do not already
carry are below, grouped by topic, each with the page that explains it.

### Identity and sign-in ([04](04-identity-access.md), [03](03-shared-responsibility.md), [00](00-go-live-checklist.md))

- The emailed sign-in link has no node-wide switch; `AIMEAT_PASSWORD_SIGN_IN=off` turns off the password, not the link.
- After the first linked OIDC or SAML sign-in the node asks no TOTP code, and such a sign-in satisfies required two-step sign-in: on that path, MFA is the identity provider's. Passkey sign-in skips TOTP by design.
- SAML has no Single Logout, no signed AuthnRequests and no encrypted assertions. SCIM provisions Users only, no Groups, so roles and organism membership are not mapped from directory groups.
- The password rule is fixed in code and not checked against breached-password lists.
- A personal access token has no expiry unless its owner sets one, and may carry full owner or operator access. Agent and ecosystem app tokens last 90 days by default.
- `AIMEAT_SAME_OWNER_AUTO_APPROVE` is on by default: an owner's agent can register a sibling agent within its own scopes without a second approval.
- An operator cannot reset their own TOTP. A node with one operator who has lost both the device and the backup codes has no reset path in the product.
- A revoked token is refused at once by the process that revoked it; another node process can take up to 60 seconds.
- An operator's agent holding `operator:admin` can do what the operator can on the admin routes, including granting the operator role.
- No procedure rotates the node's signing key. A leaked key signs tokens the node accepts until the key is replaced.
- The setup code lives in process memory; a restart before setup issues a new one.

### Security controls ([07](07-security.md), [09](09-hardening-guide.md), [02](02-architecture.md))

- `aimeat validate` does not read the security profile, so it does not report the posture warnings the start log reports.
- The default agent scopes include memory write and delete-to-bin, message sending and file storage; a minimal list is the operator's to set.
- No setting removes the federation routes. A standalone node still answers introductions, which wait for the operator's approval.
- The node sends no HSTS `preload` directive.
- The node has no outbound HTTP proxy support; egress is controlled only by firewall destinations.
- With `AIMEAT_BIND_HOST` empty the node listens on every address.
- Link previews let a signed-in person make the node fetch any public address, and the node reads the `client_id` address an MCP client presents, so a host-only egress allowlist breaks those features for unlisted hosts.
- On by default, outbound: the weekly model catalogue refresh, and browsers are handed Google's STUN server (`AIMEAT_STUN_SERVERS`).
- Calls to OpenRouter carry the software's name in `HTTP-Referer` and `X-Title`.
- The audit reports with exploit detail are not public; an outside reviewer verifies the fixes through the tests and the code.

### Apps, agents and endpoints ([13](13-apps-agents-endpoints.md))

- Any account can publish an app, and with the code defaults (`AIMEAT_APP_DEFAULT_ACCESS=anyone`, `AIMEAT_APP_DEFAULT_LISTING=listed`) a new app is open to anyone and listed. No operator reviews an app's code before it is published.
- `AIMEAT_APP_ORIGIN_SIGN_IN_REFUSE` is off by default: a sign-in request from an app origin is logged, not refused.
- An extension's own namespace `ext:<name>` is readable by anyone without sign-in.
- Installing a package is the owner's decision; IT has no approval step for it.
- An agent holding `agent:write` can allow a program on the owner's computer that the computer already holds, without the owner in person. On the first start after an update the connector adopts the commands it already had, and a command whose files kept old timestamps can be adopted the same way.
- The connector reports the computer's host name unless `AIMEAT_INSTALL_NAME` is set. On Windows its folder inherits the parent folder's access list; the connector warns and does not fix it.
- An AI chat that runs in a vendor's cloud can connect only to a node reachable from the internet.
- A node-wide outside MCP server with a price refuses its calls, because a proxied call cannot take payment yet.

### Data protection and data lifecycle ([05](05-data-protection.md), [14](14-compliance-mapping.md), [17](17-exit-plan.md))

- The node has no setting for TLS to PostgreSQL; it is the operator's connection string and server configuration.
- Account deletion is immediate, with no grace period and no undo. It continues past a clean-up step that fails, logs the failed step, and leaves that subsystem's data in place.
- AI provenance records, workspace rows, finance records and other shared records survive account deletion under a pseudonym.
- An outside file store with no folder prefix is never swept, so its objects stay after their rows are gone.
- The account export lists files as metadata, not bytes. The account export, the memory export and account erasure have no MCP tool.
- The per-day AI usage records (`ai-usage.<account>.<day>`, written with no time limit) and the account event archive are never pruned by a job, and no tool prunes them (`aimeat/src/services/ai-usage-record.ts`). The archived usage call and event rows have an operator route, `POST /v1/admin/usage/archive/prune`, which removes rows before a date the operator gives; no MCP tool does this (`aimeat/src/routes/admin-usage.ts`).
- No automatic retention was found for workspace rows and their revisions, AI provenance, agent activity or direct messages.
- Content written while classification is off carries no label until a rule, a scan or a person gives it one.
- A provider the operator configures at an internal origin listed in `AIMEAT_AI_PROVIDER_EGRESS` counts as `local` for classified content, although the data crosses the network to it.
- No per-person switch restricts processing (GDPR Article 18); disabling the whole account is an operator action. Nothing tells recipients about a rectification or erasure (Article 19), and no objection mechanism exists (Article 21).
- There is no whole-node export besides the database itself. Moving to another node is an export there and an import here, by hand, and an organism import does not restore its membership or its board.
- Records already replicated to federation peers are retracted by request; a peer under another operator decides whether it deletes, and a closed node sends no retraction.
- The organism export over MCP is size-capped; a large organism downloads over REST or from the page.

### AI and models ([06](06-ai-and-models.md))

- A provider record cannot send an `api-key` header, a custom header, a refreshing token or a SigV4 signature: every OpenAI-compatible call carries `Authorization: Bearer <key>` or nothing. So Azure OpenAI with Microsoft Entra ID authentication is not supported, and AWS Bedrock works only with a long-term Bedrock API key on its Chat Completions endpoint.
- AIMEAT calls Chat Completions, not the Responses API.
- The project has not tested Azure, Bedrock, vLLM, TGI, Ollama, LM Studio or llama.cpp against the real service.
- Ordinary model calls send the caller's prompt as given. The decision provider and the classification judgement replace known identifier patterns (e-mail, phone, identity codes, IBAN, street address, the owner's contacts' names) first; other personal data in the content still goes to the provider.
- AI calls happen without a button press: schedules, agents, the refinery, the classification queue and AI jobs.
- The decision provider is on by default and points at a hosted service in the United States; it sends nothing until a key is set.
- AIMEAT has no per-provider rate or concurrency limit; the provider's own quota refuses.
- A missing transcription, image, speech or embedding model refuses that feature; only text has a fallback, and only on the node's key.
- The node sends no data-retention parameter to OpenRouter.
- The cost of a direct provider's call is the catalogue's estimate, and a call with an unknown price is recorded as zero.

### Logging and monitoring ([10](10-logging-monitoring.md), [15](15-operations-runbook.md))

- No native syslog, OTLP or SIEM exporter. The usage trail and operator actions reach a SIEM only by polling admin routes.
- The shipped systemd unit does not set `NODE_ENV=production`, so its log is text, not JSON, until the operator adds it.
- The refusal log keeps one older generation after 5 MiB; under a long attack the oldest refusals are lost. Rate limit hits are counters, with no line naming the caller.
- Allowed reads are not audited by the consent audit; the classification audit records only labels with audit on, and only while classification is on.
- Every record the node keeps of its own operation can be changed by someone with host or database access. Tamper resistance needs an export to a store outside the operator's reach.
- `/v1/health` answers 200 when degraded; a check must read `status`.
- Kept compliance reports and archived usage rows accumulate; no job prunes them. The archived usage rows can be removed by hand with `POST /v1/admin/usage/archive/prune` (`aimeat/src/services/usage/archive-job.ts`, `aimeat/src/routes/admin-usage.ts`).

### Backup, updates and releases ([11](11-backup-recovery.md), [12](12-updates-releases.md))

- The node has no backup scheduler; the schedule, encryption and off-site copy are the operator's. With a bucket file store, turn on object versioning: after a restore of an older database, objects written after that backup are no longer named and the daily sweep can remove them.
- The node never re-encrypts its stored secrets. After `AIMEAT_ENCRYPTION_KEY` is added to a node that ran on `AIMEAT_TOTP_ENCRYPTION_KEY` (as `aimeat init` sets up), the secrets stored before open only while the TOTP key stays set (`aimeat/src/services/encryption.ts`).
- Restoring a newer backup onto an older node version is not supported. Losing `AIMEAT_ENCRYPTION_KEY` makes every stored secret unreadable; losing both the key passphrase and the key file stops the node from starting as the same node.
- No restore-time figure at production size exists, and PostgreSQL WAL archiving and standby replication are not covered by the guides or tests.
- The SBOM is not attached to a release. The upgrade test covers one step, from the previous release to the new build. The repository describes no process for publishing security advisories or CVE identifiers. No Docker image is published.

### Compliance and regulated use ([14](14-compliance-mapping.md), [regulated-sector addendum](templates/regulated-sector-addendum.md))

- The node checks compliance documents against its own records only, and every verdict says it is not legal advice. The risk questionnaire and framework sets are aids; the classification is the organisation's own.
- Nothing in the node covers AI literacy (AI Act Article 4) or staff training (NIS2 Article 21(2)(g)).
- The processors list the node derives does not name the decision provider or an outside file store; the operator adds them by hand.
- For regulated records: no single audit trail keeps every earlier value, no field records the reason for a change, no hash chain makes audit records tamper-evident, and a workspace row keeps at most 20 revisions, and only when a writer of another owner replaces it. A signature carries no field for its meaning, and an AIMEAT signature is not a qualified signature.
- An operator can change many settings at runtime on the Config page, outside the organisation's change process, unless they are pinned with `AIMEAT_SEALED_CONFIG_KEYS`.
- No validation package and no supplier quality system come with the software.

## Limits

This page is the list.

## Open questions

None of its own. Every open question of the package is in the [README](README.md#open-questions).
