# 07 Security

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see the README for how.

This page is for the security officer and the architect who must approve AIMEAT. It says how the node separates principals, which settings are safe as shipped and which are not, how sign-in, input, CORS, secrets and dependencies are handled, how to report a vulnerability, and what security work has been done. The live state of one node is on its admin Security page; this page says what to look for there. Threats and their residual risk are in [08 Threat model](08-threat-model.md); the production checklist is in [09 Hardening guide](09-hardening-guide.md).

## The security model in brief

Every request runs as exactly one principal, and every check is made against that principal ([Security Development DNA](../coding-guidelines/security-development-dna.md), section 1).

| Principal | What it is | What it may touch | Source |
|---|---|---|---|
| Operator | A person (owner) who holds the `operator` role and runs the node | The admin surface, node settings, federation peers | [Security DNA](../coding-guidelines/security-development-dna.md) |
| Owner (GHII, a person's identity `alice@node`) | A person with an account | Their own data, agents and apps | [Identity model](../coding-guidelines/identity-model.md) |
| Agent (GAII, `agent#alice@node`) | An AI agent acting for one owner | Only the scopes the owner granted, in the owner's namespace | [Identity model](../coding-guidelines/identity-model.md) |
| Ecosystem app (GEAI, `eco:app#alice@node`) | An outside application onboarded by the owner | Its own `eco:` namespace and the data areas the owner granted | [Identity model](../coding-guidelines/identity-model.md) |
| App grant | A published app running in the owner's browser | The scopes the owner approved; never the owner's session | [Security DNA](../coding-guidelines/security-development-dna.md) |
| Federated visitor | A person signed in on another AIMEAT node | Role `federated` only, never the local account with the same name | `.claude/rules/security.md` |
| Anonymous | A shared identity, only when anonymous mode is on | Only `anonymous.*` records | [Security DNA](../coding-guidelines/security-development-dna.md) |

The walls that must hold:

1. **Cross-owner is a hard wall.** Owner B cannot read or write owner A's data. Three mechanisms enforce it: a composite-key lookup scoped to the resolved identity, the visibility and consent check in `aimeat/src/services/access-guard.ts`, and AES-256-GCM encryption of stored secrets in `aimeat/src/services/encryption.ts` ([Security DNA](../coding-guidelines/security-development-dna.md), section 1).
2. **Owner and their own agents is a scope boundary.** An agent writes into its owner's namespace, so the server never trusts security-relevant config from a namespace an agent can write. A reserved-key denylist is always on and has no setting ([Security DNA](../coding-guidelines/security-development-dna.md), invariant 2; `aimeat/.env.example`).
3. **Node to node is signature-gated.** Every inbound federation call that changes or discloses data verifies an Ed25519 signature from an approved peer, unconditionally ([Security DNA](../coding-guidelines/security-development-dna.md), invariant 5).
4. **Extensions and apps are isolated.** Extensions run in a QuickJS sandbox compiled to WASM with no file system and no Node.js APIs (`aimeat/src/services/extension-runtime.ts`). Published apps run on their own origin with a scoped grant token (`AIMEAT_APP_ORIGIN_ENABLED`).

The twenty invariants every code change must keep, with the per-change checklist, are in [Security Development DNA](../coding-guidelines/security-development-dna.md). The reference values (crypto functions, headers, rate limits, sandbox limits) are in [Security practices](../coding-guidelines/security.md).

### One codebase, two postures

The same code runs a single-user laptop node and a multi-user public node. The difference is configuration, never a code fork. `AIMEAT_SECURITY_PROFILE` is `local` or `public`. When it is unset, the node resolves `local` when the host of `AIMEAT_BASE_URL` is private (localhost, 127.0.0.1, an RFC 1918 address) or `AIMEAT_NODE_TYPE` is `personal`, and `public` otherwise (`aimeat/src/config.ts`). `AIMEAT_BIND_HOST=0.0.0.0` also makes the default profile `public` (`aimeat/.env.example`). The profile sets the default of two settings (`AIMEAT_ALLOW_PRIVATE_EGRESS`, `AIMEAT_APP_ORIGIN_ENABLED`) and arms the startup self-check. An explicit setting always wins over the profile.

**Startup self-check.** On a `public` node the start log has one `SECURITY:` warning for each unsafe setting: anonymous mode on, private egress on, open federation join, no `AIMEAT_ENCRYPTION_KEY`, `*` in CORS, public statistics or metrics, extension install by any owner, an empty AI provider allowlist, a powerful scope in the default agent scopes, and settings the node refused (`aimeat/src/config-posture.ts`, called from `aimeat/src/index-start.ts`). Dev mode, test mode and the test money handler are reported on any node whose public URL is not loopback. The check only warns: the node still starts.

## Secure defaults

"Default" is the value with nothing set. "Safe as shipped" says whether that default fits an organisation node without a change.

| Area | Setting | Default | Safe as shipped | Source |
|---|---|---|---|---|
| Dev mode | `AIMEAT_DEV_MODE` | off | yes. Reported in the start log on a non-loopback node when on | `aimeat/.env.example`, `aimeat/src/config-posture.ts` |
| Test mode | `AIMEAT_TEST_MODE` | off | yes. Reported the same way | `aimeat/.env.example` |
| Security profile | `AIMEAT_SECURITY_PROFILE` | derived from `AIMEAT_BASE_URL`, `AIMEAT_NODE_TYPE` and `AIMEAT_BIND_HOST` | set it explicitly. A node on a private LAN address resolves to `local` and is still reachable by other people | `aimeat/src/config.ts`, `aimeat/src/services/setup-code.ts` |
| App origin isolation | `AIMEAT_APP_ORIGIN_ENABLED` | on with the `public` profile, off with `local` | yes on `public`, but it needs wildcard DNS and a wildcard certificate. Without them apps get a redirect to a host that does not resolve | `aimeat/.env.example`, [Production deployment](../operations/production-deployment.md) |
| Federation | `AIMEAT_FEDERATION_ROLE`, `AIMEAT_FEDERATION_OPEN_JOIN`, `AIMEAT_FEDERATION_AUTH_POLICY` | `standalone`, off, `disabled` | yes. No peer exists until an operator approves one | `aimeat/src/config.ts`, [Federation](../operations/federation.md) |
| Classification | `AIMEAT_CLASSIFICATION` | `off` | no for regulated data. With it off, no read, write, AI call or export changes | `aimeat/.env.example`, [Data classification](../data-classification.md) |
| Agent clearance | `AIMEAT_AGENT_CLEARANCE_DEFAULT` | empty, no limit | decide it. Matters only while classification is on | `aimeat/.env.example` |
| Enterprise SSO (SAML, SCIM) | `AIMEAT_SSO_ENABLED` | off: the SAML, ACS, SCIM and metadata routes answer 503 | yes. Turn on after the connection is configured | `aimeat/.env.example`, [Organisation node sign-in](../organisation-node-sign-in.md) |
| OIDC sign-in providers | `AIMEAT_ENTRA_OAUTH_ENABLED`, `AIMEAT_GOOGLE_OAUTH_ENABLED`, `AIMEAT_CASDOOR_OAUTH_ENABLED` | off | yes | `aimeat/.env.example` |
| Registration | `AIMEAT_REGISTRATION_MODE` | `open`: anyone may create an account | **no** for an organisation node. Set `oauth`, `invite` or `closed` | `aimeat/src/config.ts`, [Organisation node sign-in](../organisation-node-sign-in.md) |
| Who sees content | `AIMEAT_CONTENT_ACCESS` | `open`: public content is served to anyone | decide it. `signed-in` serves nothing to people without an account here | `aimeat/.env.example` |
| Consent layer | `AIMEAT_CONSENT_ENABLED` | on (off only when set to `false`) | yes | `aimeat/src/config-data-access.ts` |
| First operator | setup code | a one-time code is printed in the start log while the node has no operator; every route that would create the first operator asks for it unless the request comes from loopback on a loopback base URL: the setup wizard, self-registration, an identity provider's first sign-in, and `POST /v1/admin/setup/register`, which asks for the admin password and the code (`aimeat/src/routes/admin/setup-register.ts`) | yes | `aimeat/src/services/setup-code.ts` |
| Setup wizard addresses | `AIMEAT_SETUP_ALLOWED_IPS` | empty, no address restriction | the setup code is the control; this is an extra | `aimeat/.env.example` |
| Admin setup after first operator | `AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR` | off: the setup route answers 410 once an operator exists | yes | `aimeat/.env.example` |
| SSRF guard | `AIMEAT_ALLOW_PRIVATE_EGRESS` | RFC 1918, link-local, CGNAT and cloud metadata addresses are always blocked; loopback is blocked on `public`, allowed on `local` | yes on `public` | `aimeat/src/utils/url-validator.ts`, `aimeat/.env.example` |
| AI provider hosts | `AIMEAT_AI_PROVIDER_ALLOWLIST` | empty: a stored AI key may be sent to any host | **no** on a multi-user node. Warned on `public` | `aimeat/.env.example`, `aimeat/src/config-posture.ts` |
| Apps opened to the internet | `AIMEAT_APP_INTERNET_OPENING` | `operator`: the owner asks with a reason, an operator approves; each opening ends after `AIMEAT_APP_INTERNET_OPENING_MAX_DAYS` (90) | yes. Applies only when `AIMEAT_CONTENT_ACCESS=signed-in` | `aimeat/src/config-visibility.ts` |
| CORS | `AIMEAT_CORS_ALLOWED_ORIGINS` | `*` for Bearer-token routes; cookie-authenticated paths are fenced to listed origins | acceptable by design, warned on `public` | `aimeat/src/middleware/cors.ts`, [Verification matrix](../security/verification-matrix.md) |
| Anonymous mode | `AIMEAT_ANONYMOUS` | off | yes | `aimeat/src/config.ts` |
| Statistics | `AIMEAT_STATS_ACCESS` | `public` in code; the shipped `.env.example` sets `operator` | set `operator` | `aimeat/src/config.ts`, `aimeat/.env.example` |
| Prometheus metrics | `AIMEAT_METRICS_ENABLED`, `AIMEAT_METRICS_ACCESS` | off, `operator` | yes | `aimeat/.env.example`, `aimeat/src/config.ts` |
| Extension install | `AIMEAT_EXT_INSTALL_ROLE` | `owner`: every account holder | **no** on a shared node. Set `operator` | `aimeat/src/config.ts` |
| Default agent scopes | `AIMEAT_DEFAULT_AGENT_SCOPES` | read, write and delete-to-bin of memory, catalogue, organism and agent read, send messages, store files. Powerful scopes (`ai:use`, `task:write`, `memory:purge`, `agent:delete`) are never in the default | decide it. A public node is advised to run a minimal list | `aimeat/src/config.ts`, `aimeat/src/config-posture.ts`, [Security DNA](../coding-guidelines/security-development-dna.md) section 3 |
| Storage backend | `AIMEAT_STORAGE` | `memory`: data is lost at restart | **no**. Set `postgres-kysely` or `sqlite` | `aimeat/src/config.ts`, `aimeat/.env.example` |
| Secret encryption key | `AIMEAT_ENCRYPTION_KEY` | unset. The node falls back to `AIMEAT_TOTP_ENCRYPTION_KEY`; with neither, features that store a secret answer 503 and store nothing | set it before the first start. `aimeat init` generates only the TOTP key; adding the data key later is safe while the TOTP key stays set, because secrets stored before still open with it ([11 Backup and recovery](11-backup-recovery.md)) | `aimeat/.env.example`, `aimeat/src/services/encryption.ts` |
| HSTS | (none) | `max-age=31536000; includeSubDomains` when `AIMEAT_BASE_URL` starts with `https://` | yes | `aimeat/src/server-bootstrap/static-files.ts` |
| Refusal log | `AIMEAT_AUTH_LOG_PATH` | on, file data/auth-failures.log under the working directory | yes | `aimeat/src/config-security.ts` |
| Sign-in tarpit | `AIMEAT_LOGIN_TARPIT_ENABLED` | on | yes | `aimeat/.env.example` |
| Two-step sign-in (TOTP) | `AIMEAT_TOTP_ENABLED` | available; each person turns it on | yes, to offer it | `aimeat/src/config-types-account-security.ts` |
| Required two-step sign-in | `AIMEAT_TWO_STEP_REQUIRED` | `off`: required for nobody | **no** on an organisation node. Set `operators`, or `everyone` | `aimeat/src/services/sign-in-policy.ts` |
| Password sign-in | `AIMEAT_PASSWORD_SIGN_IN` | `on`: every account may use a password | decide it. With an IdP, `operators` keeps the password as the operators' way in when the IdP fails | `aimeat/src/services/sign-in-policy.ts` |
| AI provenance | (none) | recorded; a `public` node refuses to switch it off | yes | `aimeat/src/config-posture.ts`, [AI transparency](../ai-transparency.md) |
| Version check | `AIMEAT_UPDATE_CHECK` | on: the node asks npm for a newer version when an operator opens a page | decide it. It sends nothing about the node | `aimeat/.env.example` |

`pnpm check:posture-defaults` (`aimeat/scripts/check-posture-defaults.ts`) holds the documented defaults against the code in CI.

## Authentication and sessions

| Topic | How it works | Source |
|---|---|---|
| People | Password (`POST /v1/ghii/login`), passkey (`AIMEAT_PASSKEY_ENABLED`, `AIMEAT_PASSKEY_RP_ID`), or an identity provider: Entra ID, Google or Casdoor over OIDC, or SAML through an SSO connection | [Organisation node sign-in](../organisation-node-sign-in.md), `aimeat/.env.example` |
| Second factor | TOTP with backup codes; wrong codes pause sign-in (`429 TOTP_LOCKED`) | [Security practices](../coding-guidelines/security.md) |
| Sign-in policy | `AIMEAT_TWO_STEP_REQUIRED` requires two-step sign-in for operators or everyone: a covered account without TOTP gets no session from a password or an emailed link and enrols first; a passkey or an IdP sign-in satisfies it. `AIMEAT_PASSWORD_SIGN_IN` limits password sign-in to operators or turns it off (403 `PASSWORD_SIGN_IN_OFF`). An AI credential may tighten either setting, not weaken it (403 `PERSON_REQUIRED`) | `aimeat/src/services/sign-in-policy.ts`, `aimeat/src/services/config-admin-view.ts`, [04 Identity and access](04-identity-access.md) |
| Owner sessions | A short access token (`AIMEAT_ACCESS_TTL`, 900 s) and a rotating httpOnly refresh cookie, `__Host-aimeat_rt` on https, idle limit `AIMEAT_REFRESH_IDLE_DAYS` (30), absolute limit `AIMEAT_REFRESH_ABSOLUTE_DAYS` (90) | `aimeat/.env.example`, `aimeat/src/services/owner-session.ts` |
| Tokens | Every access JWT the node issues is EdDSA, signed with the node's Ed25519 key (`jose`); personal access tokens, SCIM tokens and refresh tokens are opaque random values stored as SHA-256 hashes. Agent tokens last `AIMEAT_AGENT_JWT_TTL` (90 days), ecosystem app tokens `AIMEAT_ECO_JWT_TTL` (90 days), a person's access token `AIMEAT_ACCESS_TTL` (900 s), other node-issued JWTs `AIMEAT_JWT_TTL` (3600 s). A token with no `scopes` claim can do nothing. Revocation is stored per node and survives a restart | [Security practices](../coding-guidelines/security.md) |
| Agents | Device authorization (RFC 8628): the owner approves the agent and picks its scopes | [Identity model](../coding-guidelines/identity-model.md) |
| Guessing | Per-address tarpit in front of password, code and signature routes; account lockout after `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` (5) for `AIMEAT_PASSWORD_LOCKOUT_MINUTES` (15); a sign-in rate limit (`AIMEAT_LOGIN_RATE_LIMIT_MAX`) | `aimeat/src/middleware/login-tarpit.ts`, `aimeat/.env.example` |
| Rate limits | Per caller (`sub`) or per IP, per area, with role multipliers fixed in code; `AIMEAT_RL_GLOBAL` is the fallback | [Security practices](../coding-guidelines/security.md) |
| Deprovisioning | SCIM `active: false` or an operator's Deactivate ends every session, agent token, access token, app grant and connector tunnel of the person within the request; their data stays | [Organisation node sign-in](../organisation-node-sign-in.md) section 7 |
| Owner key | The Ed25519 owner key returned at registration signs no one in since 4.0.0 | [Security practices](../coding-guidelines/security.md) |

Sign-in policy in detail (tenant allowlist, registration modes, SAML, SCIM) is in [04 Identity and access](04-identity-access.md).

## Input handling and validation

- Request bodies are validated with Zod schemas; every string has a length limit chosen by what the field holds. `pnpm check:string-bounds` refuses an unbounded string and `pnpm check:write-validation` refuses a new writing route without a schema ([Security practices](../coding-guidelines/security.md)).
- A NUL character or a lone UTF-16 surrogate anywhere in the body, query or path is refused before any route runs ([Security practices](../coding-guidelines/security.md)).
- SQL goes through prepared statements (SQLite) or Kysely parameters (PostgreSQL) ([Security practices](../coding-guidelines/security.md)).
- A request path with a dotfile segment is refused with 403 before the static handlers, `.well-known` excepted (`aimeat/src/server-bootstrap/static-files.ts`, asserted by `aimeat/test/e2e-static-hardening.ts`).
- Every outbound HTTP call to a URL that is not a constant goes through `safeFetch`, which checks the address and every DNS answer, and re-checks every redirect hop (`aimeat/src/utils/url-validator.ts`).
- The node's own pages carry a CSP with a per-request nonce; published apps get their own CSP (`aimeat/src/routes/apps/read.ts`; [Security practices](../coding-guidelines/security.md)).
- JSON body limits: `AIMEAT_JSON_BODY_LIMIT_MB` (5) and a larger limit on app, extension, storage and MCP routes ([Production deployment](../operations/production-deployment.md)).

## CORS

The API is Bearer-token based, so the node reflects any `Origin` with credentials on Bearer paths by design; the cookie-authenticated paths are fenced to listed origins (invariant C-1 in `aimeat/src/middleware/cors.ts`; [Verification matrix](../security/verification-matrix.md)). An operator can narrow the default with `AIMEAT_CORS_ALLOWED_ORIGINS`, and can set a list for one person or one agent at runtime. A narrowed list must name the app origins and `null` (sandboxed app frames), or the node's own apps stop reaching it (`aimeat/.env.example`).

| Task | Tool or page | Source |
|---|---|---|
| Read the default list, the cookie paths, and every per-person and per-agent list | `aimeat_admin_cors_overview`, admin CORS tab | `aimeat/src/tool-catalog/definitions/discovery-work-boards.ts` |
| Set or clear a list for one person or agent | `aimeat_admin_cors_set` | `aimeat/src/tool-catalog/definitions/discovery-work-boards.ts` |

## Opening apps to the internet behind approval

On a node that serves content only to signed-in accounts (`AIMEAT_CONTENT_ACCESS=signed-in`), one app and the forms it declares can be opened to everyone, for example a campaign page with a consent form. `AIMEAT_APP_INTERNET_OPENING` decides who opens: `operator` (default: the owner asks with a reason and an operator approves), `self` (the owner opens and operators are told) or `off`. Every opening records who, why and when, and closes itself after `AIMEAT_APP_INTERNET_OPENING_MAX_DAYS` (`aimeat/src/config-visibility.ts`).

| Task | Tool | Source |
|---|---|---|
| An owner asks to open an app | `aimeat_app_internet_open` | `aimeat/src/tool-catalog/definitions/internet-opening.ts` |
| An operator lists openings and waiting requests | `aimeat_admin_internet_openings`, admin tab `internet-openings` | `aimeat/src/tool-catalog/definitions/internet-opening.ts` |
| An operator decides a request | `aimeat_admin_internet_opening_decide` | `aimeat/src/tool-catalog/definitions/internet-opening.ts` |
| An operator lets one owner open without approval, until a date | `aimeat_admin_internet_opener_set` | `aimeat/src/tool-catalog/definitions/internet-opening.ts` |

On a node with `AIMEAT_CONTENT_ACCESS=open` (the default) this approval does not apply: each owner decides what of theirs is public. `aimeat_exposure_report` lists what of a person's content others can read.

## Federation default state

A new node is `standalone`, with no peers, no open join and federated sign-in `disabled`. A peering request from another node waits for an operator's approval, and every federation message is verified against a signature from an approved peer. The audience field is required from 4.0.0 ([Federation](../operations/federation.md); `aimeat/src/config.ts`). There is no single switch that removes the federation routes; see Limits.

## Secret management

| Secret | Where it lives | Protection | Source |
|---|---|---|---|
| Data key `AIMEAT_ENCRYPTION_KEY` | The environment (`.env` or the process manager) | 32 bytes as 64 hex characters. Encrypts AI keys, the secrets vault, extension and MCP server secrets, TOTP secrets, secret Config settings. Never change it on a live node | `aimeat/.env.example` |
| Node identity key | `AIMEAT_NODE_KEY_PATH` (default under `~/.aimeat/nodes/`), plus a sealed copy in the database | `AIMEAT_KEY_PASSPHRASE` encrypts the file and the database copy | `aimeat/.env.example`, `aimeat/src/auth/node-keys.ts` |
| A person's secrets vault | The database, encrypted | A value goes in and never comes out: list returns names and times only. The only reader is the extension `ctx.fetch` path, which sends the secret without showing it to the script. A node with no key answers 503 and never stores plaintext | `aimeat/src/services/owner-secrets.ts`, `aimeat/src/routes/secrets.ts` |
| A secret going to a new address | Per-owner setting, on by default | The owner is asked with one press before a stored secret is sent to an address it has never gone to, unless the agent holds `secrets:manage`. Read or change with `aimeat_secret_host_ask` | `aimeat/src/services/secret-host-ask-setting.ts` |
| Admin setup password | `AIMEAT_ADMIN_PASSWORD`, or generated at each start and written to a mode 0600 file while the node has no owner | Never written to the log | `aimeat/.env.example` |
| Settings frozen against operators | `AIMEAT_SEALED_CONFIG_KEYS` | Named keys stay visible on the Config tab and no operator session can change them | `aimeat/.env.example` |

Logs mask credential fields at any depth and replace key-shaped text in every string (`aimeat/src/utils/logger.ts`). Details in [10 Logging and monitoring](10-logging-monitoring.md). Backup of the keys is in [11 Backup and recovery](11-backup-recovery.md).

## Dependencies and supply chain

| What | Where | When it runs |
|---|---|---|
| Licence notices for every shipped dependency | `THIRD-PARTY-NOTICES.md`, generated by `aimeat/scripts/gen-third-party-notices.ts` | regenerated with the code; the pre-commit hook checks it when the file is committed |
| CycloneDX SBOM | `aimeat/scripts/gen-sbom.ts` (`pnpm sbom`) | on demand and in the weekly scan |
| `pnpm audit` (npm advisory database), fails on high | `.github/workflows/vulnerability-scan.yml` | weekly, Mondays |
| OSV scan of the npm tree and the browser libraries served from the public lib folder (`pnpm scan:vulns`) | `aimeat/scripts/scan-vulns.ts` | weekly |
| Trivy, Grype and osv-scanner against the SBOM, pinned release binaries checked by SHA-256 | `.github/workflows/vulnerability-scan.yml`, `aimeat/scripts/security-report.ts` | weekly; the report names any scanner that did not run |
| CodeQL (JavaScript/TypeScript, Python, Actions) | `.github/workflows/codeql.yml` | every push and pull request to main, and weekly |
| ast-grep rules for the security invariants, and Semgrep taint rules | `.github/workflows/semantic-audit.yml` | every push and pull request to main; advisory |
| Dependency review: fails a pull request that adds a vulnerable or GPL/AGPL dependency | `.github/workflows/dependency-review.yml` | every pull request |
| OpenSSF Scorecard | `.github/workflows/scorecard.yml` | weekly |
| Guard E2E tier: cross-owner, scope, SSRF, path traversal, revocation, money and upload refusals on both backends | `.github/workflows/ci.yml` | every push |

GitHub Actions in these workflows are pinned by commit hash (`.github/workflows/vulnerability-scan.yml`). The licence is MIT (`LICENSE`); a GPL or AGPL dependency needs the maintainer's approval ([Dependency management](../coding-guidelines/dependency-management.md)).

## Vulnerability disclosure

Report privately, through GitHub private vulnerability reporting or by email to the maintainer named in `.github/SECURITY.md`. The stated aim is an acknowledgement within 48 hours, an assessment within a week and a fix within two weeks. Only the newest release receives security fixes ([Security policy](../../.github/SECURITY.md)). The node's own incident procedure (severity levels, containment commands) is in [Incident response](../security/incident-response.md).

## Security work done

What the repository records, without numbers it does not state:

- **Standing verification on every merge.** The guard E2E tier asserts the node's refusals on both storage backends: IDOR and scope enforcement, SSRF, path traversal, anonymous bypass, static-serving hardening, account endpoints, namespace isolation, MCP cross-owner and scope filtering, credential revocation, money paths and archive extraction ([Verification matrix](../security/verification-matrix.md)).
- **Audits that produced the invariants.** An audit of 2026-07-10 (invariants 1 to 10), the August and September 2026 audits (11 to 16) and the October 2026 audit of the AI, agent and data-isolation scope (17 to 19). Their exploit detail is kept outside the public repository ([Security DNA](../coding-guidelines/security-development-dna.md), section 5).
- **Probe session of 2026-08-21.** Established that dotfile paths are refused by the node itself, that no live credential is committed (gitleaks over the full history), and that CORS reflection is by design and depends on the cookie path list being complete ([Verification matrix](../security/verification-matrix.md)).
- **Open hardening items, none a vulnerability:** the node's own pages and API send no `Permissions-Policy`, `X-Permitted-Cross-Domain-Policies`, COOP, COEP or CORP, because the cross-origin headers can break app embedding; the HTML page host sends `Permissions-Policy` and CORP, and stored files send CORP (`aimeat/src/routes/page-host.ts`, `aimeat/src/routes/storage-files.ts`, [Verification matrix](../security/verification-matrix.md)).

## The live check

| Where | What it shows | Source |
|---|---|---|
| Admin Security page, `<node>/v1/admin?tab=security` | Refusals of the last 24 hours by endpoint, source and credential; the refusal log tail; open incidents; who holds the operator role; deactivated accounts and two-step sign-in use; how apps are kept apart from the sign-in; the access settings (rate limits, tarpit, lockout, TOTP, CORS, federation sign-in, body limits) | `aimeat/public/views/admin.js`, `aimeat/src/routes/admin-security.ts` |
| `aimeat_admin_security_overview` | The same data for an operator's AI | `aimeat/src/mcp/admin-security.ts` |
| Start log | The posture warnings and the setup code | `aimeat/src/index-start.ts` |
| `aimeat validate` | Offline check of the environment; exits 1 on an error | `aimeat/src/utils/env-validator.ts` |

## Limits

- Two-step sign-in is required for nobody and password sign-in is on for everyone until the operator sets `AIMEAT_TWO_STEP_REQUIRED` and `AIMEAT_PASSWORD_SIGN_IN` (`aimeat/src/config-types-account-security.ts`).
- A passkey or an IdP sign-in satisfies required two-step sign-in without the node's TOTP code, by design; the node does not check the IdP's MFA (`aimeat/src/services/sign-in-policy.ts`).
- The emailed sign-in link has no node-wide switch; `AIMEAT_PASSWORD_SIGN_IN=off` leaves it on (`aimeat/src/services/login-link.ts`, `aimeat/src/services/sign-in-policy.ts`).
- The startup self-check only warns. A `public` node with no `AIMEAT_ENCRYPTION_KEY`, `*` CORS or an empty AI provider allowlist still starts.
- `aimeat validate` does not read the security profile, so it does not report the posture warnings that the start log reports.
- The shipped default agent scopes include memory write and delete-to-bin, message sending and file storage. The Security DNA advises a minimal list on a public node; the operator must set it.
- `AIMEAT_STATS_ACCESS` defaults to `public` in code. Only the shipped `.env.example` sets `operator`; a node configured without that file exposes its statistics.
- `AIMEAT_EXT_INSTALL_ROLE` defaults to `owner`, so on a shared node every account holder may install a sandboxed extension until the operator sets `operator`.
- The default storage backend is `memory`, which loses all data at restart.
- There is no single setting that removes the federation routes. A standalone node still answers federation introductions, which wait for an operator's approval.
- CORS on Bearer routes reflects any origin by design. Its safety depends on every cookie-reading route being on the fenced list in `aimeat/src/middleware/cors.ts`.
- The node's own pages and API send no `Permissions-Policy`, COOP, COEP or CORP; only the HTML page host and stored files send some of them.
- Encryption at rest covers stored secrets, not the content of records and files. Disk or database encryption for content is the operator's job.
- The node does not terminate TLS; the reverse proxy must.
- EUDIW verification is blocked at startup until holder binding and replay defences exist ([Threat model](../security/threat-model.md)).
- The audit reports with exploit detail are not public, so an outside reviewer can verify the fixes only through the tests and the code.

## Open questions

- OPEN: What is the date and scope of the most recent outside penetration test, if any? The repository records internal audits and probe sessions only. (the maintainer)
