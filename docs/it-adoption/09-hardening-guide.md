# 09 Hardening guide

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see the README for how.

This page is the organisation-level hardening checklist for the sysadmin and the security officer who take a node into production. The node-level checklist that every deployment runs first is [docs/security/deployment-checklist.md](../security/deployment-checklist.md); the proxy, TLS and health-check detail is in [Production deployment](../operations/production-deployment.md). This page adds the decisions an organisation makes on top of those, and says for each item whether the shipped default already does it or the operator must change something. The reasons behind each default are in [07 Security](07-security.md); the threats they answer are in [08 Threat model](08-threat-model.md).

Marks used below:

- **[default]** the shipped default does this; check that nobody turned it off.
- **[change]** the operator must set or do something.
- **[decide]** a choice the organisation makes; the default may be right for some nodes.

## 0. Before the checklist

- [ ] **[change]** Run [docs/security/deployment-checklist.md](../security/deployment-checklist.md) in full. It covers dev mode, the storage backend, the admin password, the base URL, the encryption keys, the key passphrase, the security profile, the app origin, `pnpm audit`, proxy trust, rate limits and log level.
- [ ] **[change]** Set the storage backend: `AIMEAT_STORAGE=postgres-kysely` (production) or `sqlite`. Why: the default is `memory`, which loses all data at restart (`aimeat/.env.example`).
- [ ] **[change]** Set `AIMEAT_SECURITY_PROFILE=public` on any node more than one person reaches, even on an internal network. Why: a node with a private LAN address resolves to `local` by default, which allows loopback egress and does not arm the self-check (`aimeat/src/config.ts`).

## 1. Network

- [ ] **[change]** TLS at the reverse proxy, with a certificate that also covers the app names (`apps.<host>` and `*.apps.<host>`). Why: the node speaks plain HTTP only ([Production deployment](../operations/production-deployment.md)).
- [ ] **[default]** HSTS. The node sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `AIMEAT_BASE_URL` starts with `https://` (`aimeat/src/server-bootstrap/static-files.ts`). Do not add a second copy at the proxy. **[decide]** HSTS preload: the node does not send `preload`; add it only after checking every subdomain.
- [ ] **[change]** Pass `Host` unchanged and set `AIMEAT_TRUST_PROXY` to the hop count or proxy subnet. Why: the node routes apps by `Host`, and a wrong trust setting lets a client choose its own address in the logs and rate limits ([Production deployment](../operations/production-deployment.md)).
- [ ] **[change]** Firewall: only the proxy reaches the node port (`AIMEAT_PORT`, 40050). Bind the node to loopback with `AIMEAT_BIND_HOST=127.0.0.1` when the proxy runs on the same machine (`aimeat/.env.example`).
- [ ] **[change]** Egress allowlist at the firewall. The node has no outbound proxy setting, so restrict by destination. Destinations the node may call, each only when its feature is used: the AI providers you approve; your IdP (Entra ID, Google, Casdoor or SAML IdP); SMTP; the S3 or Azure file store (`AIMEAT_FILE_STORE`); federation peers; webhook and hook targets; `registry.npmjs.org` and `unpkg.com` for the version check (`AIMEAT_UPDATE_CHECK`, on by default); `models.dev`, `openrouter.ai` and `raw.githubusercontent.com` for the weekly model catalogue refresh (`AIMEAT_AI_CATALOG_REFRESH`, on by default); `cdn.playwright.dev` when app screenshots are on (`AIMEAT_SCREENSHOT_AUTO`) (`aimeat/.env.example`). Why: the SSRF guard blocks private addresses, but only the firewall limits which public hosts data can reach.
- [ ] **[decide]** If the node must not call the internet on its own, turn off both the version check (`AIMEAT_UPDATE_CHECK=false`) and the weekly model catalogue refresh from `models.dev`, `openrouter.ai` and `raw.githubusercontent.com` (`AIMEAT_AI_CATALOG_REFRESH=off`, `aimeat/src/services/ai/catalog/sources.ts`). The version check sends nothing about the node (`aimeat/.env.example`); [12 Updates and releases](12-updates-releases.md) says how to learn of releases instead.
- [ ] **[change]** Clock synchronisation (NTP) on the host. Why: TOTP codes and signed federation requests are checked against time, and a federation request outside a five-minute window is refused ([Federation](../operations/federation.md)).
- [ ] **[decide]** WAF or rate limiting at the proxy for a node reachable from the internet. Why: the node's rate limits are per process ([Security practices](../coding-guidelines/security.md)).

## 2. Identity and sign-in

- [ ] **[change]** Connect the organisation's IdP: Entra ID over OIDC with a tenant allowlist (`AIMEAT_ENTRA_OAUTH_ENABLED`, `AIMEAT_ENTRA_ALLOWED_TENANTS`), or a SAML and SCIM connection (`aimeat_admin_sso_create`, then `AIMEAT_SSO_ENABLED=true`) ([Organisation node sign-in](../organisation-node-sign-in.md)). Why: the IdP brings your MFA, conditional access and leaver process.
- [ ] **[change]** Make SSO the only way to get an account: `AIMEAT_REGISTRATION_MODE=oauth` (accounts come from the IdP or an invitation) or `invite` (`aimeat/src/config.ts`). Why: the default `open` lets anyone register.
- [ ] **[change]** Turn off every sign-in provider you do not use. Why: each enabled provider is another front door, and under `oauth` it creates accounts too ([Organisation node sign-in](../organisation-node-sign-in.md), section 6).
- [ ] **[change]** Require two-step sign-in: `AIMEAT_TWO_STEP_REQUIRED=operators` on an organisation node, or `everyone` when local accounts must also have it (Config `auth.two_step_required`). Keep `AIMEAT_TOTP_ENABLED` on; the node refuses to save the two together otherwise (`TWO_STEP_NEEDS_TOTP`). Why: the default `off` requires it for nobody. A covered account without TOTP then sets it up at its next password or emailed-link sign-in, and a passkey or an IdP sign-in satisfies the rule (`aimeat/src/services/sign-in-policy.ts`, `aimeat/src/services/config-admin-view.ts`). Check who uses two-step sign-in on the Security page (`aimeat_admin_security_overview`).
- [ ] **[change]** Limit password sign-in: `AIMEAT_PASSWORD_SIGN_IN=operators` on an organisation node with an IdP, so that the password stays only as the operators' way in when the IdP fails (Config `auth.password_sign_in`). Set `off` only when every operator has a passkey or an IdP link; the node refuses to save `off` while no operator has one (`OPERATOR_LOCKOUT`). Why: the default `on` lets every account sign in with a password even when SSO is on; `operators` and `off` also refuse password registration, invitations with a password, code keys and password resets for the accounts they cover (`aimeat/src/services/sign-in-policy.ts`).
- [ ] **[change]** Deprovision through SCIM. Why: SCIM `active: false` ends every session and token of a leaver at once ([Organisation node sign-in](../organisation-node-sign-in.md), section 7).
- [ ] **[decide]** Freeze sign-in settings against operator sessions with `AIMEAT_SEALED_CONFIG_KEYS` (`aimeat/.env.example`). `sso.enabled,sso.connections_locked` freezes the SAML and SCIM setup only; to freeze who may sign in, also seal `registration.mode`, `auth.google_enabled`, `auth.entra_enabled`, `auth.entra_tenant` and `auth.entra_link_domains` (`aimeat/src/services/config-schema-access.ts`). Why: changing who may sign in then takes a deploy.
- [ ] **[decide]** `AIMEAT_CONTENT_ACCESS=signed-in` for an internal-only node. Why: the default `open` serves published apps, public files and shared pages to anyone (`aimeat/.env.example`).

## 3. Data and AI

- [ ] **[change]** Classification on: `AIMEAT_CLASSIFICATION=all` (on for every owner, nobody can switch it off) or `owner` (`aimeat/src/config-data-access.ts`). Why: with the default `off`, no read, write, AI call or export is limited by sensitivity ([Data classification](../data-classification.md)).
- [ ] **[change]** Decide which levels may go to an outside model, and set refusal on those that may not ([Data classification](../data-classification.md), Levels). Why: the four shipped levels let an AI read Confidential content with a warning.
- [ ] **[change]** `AIMEAT_AI_PROVIDER_ALLOWLIST` with only the approved provider hosts. Why: empty means a stored AI key and its prompts may go to any host; the self-check warns about it (`aimeat/src/config-posture.ts`).
- [ ] **[decide]** OpenRouter region `eu` if the node uses its own OpenRouter key ([OpenRouter region](../operations/openrouter-region.md)).
- [ ] **[default]** Consent layer on (`AIMEAT_CONSENT_ENABLED` unset or `true`; `aimeat/src/config-data-access.ts`).
- [ ] **[default]** AI provenance recorded; a `public` node refuses to switch it off ([AI transparency](../ai-transparency.md)).

## 4. Agents, apps and extensions

- [ ] **[change]** Default agent permissions: set `AIMEAT_DEFAULT_AGENT_SCOPES` to a minimal list, for example `memory:read,catalogue:read` as the Security DNA advises for a public node ([Security DNA](../coding-guidelines/security-development-dna.md), section 3). Why: the shipped default also allows memory writes, delete to the bin, sending messages and storing files (`aimeat/src/config.ts`). Owners still grant more per agent.
- [ ] **[change]** Default agent clearance: `AIMEAT_AGENT_CLEARANCE_DEFAULT=sisainen` (Internal) or another level id, once classification is on. Why: empty means a new agent may read every level (`aimeat/.env.example`).
- [ ] **[change]** `AIMEAT_EXT_INSTALL_ROLE=operator`. Why: the default `owner` lets every account holder install sandboxed extensions; the self-check warns about it (`aimeat/src/config-posture.ts`).
- [ ] **[default]** App origin isolation on with the `public` profile (`AIMEAT_APP_ORIGIN_ENABLED`). **[change]** Provide the wildcard DNS and certificate first, or apps get a redirect to a host that does not resolve ([Production deployment](../operations/production-deployment.md)).
- [ ] **[default]** Internet openings behind operator approval: `AIMEAT_APP_INTERNET_OPENING=operator`, at most `AIMEAT_APP_INTERNET_OPENING_MAX_DAYS` (90) per opening. Applies with `AIMEAT_CONTENT_ACCESS=signed-in`. Review open ones with `aimeat_admin_internet_openings` (`aimeat/src/config-visibility.ts`).
- [ ] **[default]** Anonymous mode off (`AIMEAT_ANONYMOUS`).
- [ ] **[decide]** Hooks: bind a `pre_` gate hook only to a service you monitor, because a gate that stops answering refuses everything it guards (`aimeat_admin_hooks`).

## 5. Federation

- [ ] **[default]** Federation off in practice: role `standalone`, open join off, federated sign-in `disabled` (`AIMEAT_FEDERATION_ROLE`, `AIMEAT_FEDERATION_OPEN_JOIN`, `AIMEAT_FEDERATION_AUTH_POLICY`; `aimeat/src/config.ts`). Peering requests wait for an operator.
- [ ] **[decide]** If the node must never federate, keep the defaults and decline every peering request on the admin Federation tab (`aimeat_admin_federation`). There is no setting that removes the federation routes; see Open questions about blocking them at the proxy.
- [ ] **[decide]** `AIMEAT_CROSS_FEDERATION_ENABLED` is `true` by default; set `false` when the node has no genesis peer ([Federation](../operations/federation.md)).

## 6. Operator surface

- [ ] **[change]** `AIMEAT_STATS_ACCESS=operator`. Why: the code default is `public`; only the shipped `.env.example` sets `operator` (`aimeat/src/config.ts`).
- [ ] **[default]** Metrics off; when on, `AIMEAT_METRICS_ACCESS=operator` (`aimeat/.env.example`).
- [ ] **[default]** First operator through the one-time setup code printed in the start log (`aimeat/src/services/setup-code.ts`). **[decide]** `AIMEAT_SETUP_ALLOWED_IPS` to limit the wizard further.
- [ ] **[default]** Admin setup closes after the first operator (`AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR=false`).
- [ ] **[decide]** CORS: the default `*` is by design for Bearer routes. Narrow `AIMEAT_CORS_ALLOWED_ORIGINS` only together with the app origins and `null`, or apps break (`aimeat/.env.example`). Inspect with `aimeat_admin_cors_overview`.

## 7. Logging, backup and checks

- [ ] **[change]** Set `NODE_ENV=production` in the process environment so the log is JSON, one object per line. Why: the logger writes JSON only under `NODE_ENV=production` (`aimeat/src/utils/logger.ts`); the Docker image sets it (`aimeat/Dockerfile`), the systemd unit does not (`aimeat/deploy/aimeat.service`).
- [ ] **[change]** Log export to the SIEM: ship the process log (journald or the container log) and the refusal log file `AIMEAT_AUTH_LOG_PATH`, and scrape `/v1/metrics`. Details and alert rules: [10 Logging and monitoring](10-logging-monitoring.md).
- [ ] **[change]** Backups of the database, the `.env` and the node key, off the machine and encrypted; a restore tested once a month ([11 Backup and recovery](11-backup-recovery.md); [Backup and restore](../operations/backup-and-restore.md)).
- [ ] **[change]** Run `aimeat validate` before every start after a configuration change. It checks the environment offline and exits 1 on an error, for example an invalid storage type, an app origin without a host, or neither `AIMEAT_ENCRYPTION_KEY` nor `AIMEAT_TOTP_ENCRYPTION_KEY` set. Dev mode, `http://` on a public host and a short admin password are warnings and do not change the exit code; read them too (`aimeat/src/utils/env-validator.ts`, dispatched from `aimeat/src/index.ts`).
- [ ] **[change]** Read the startup self-check after every start: each `SECURITY:` line in the start log names one unsafe setting (`aimeat/src/config-posture.ts`).
- [ ] **[change]** Open the admin Security page after every start and every update: `<node>/v1/admin?tab=security`, or ask an operator's AI with `aimeat_admin_security_overview`. Resolve open incidents (`aimeat_admin_incident_resolve`) ([Deployment checklist](../security/deployment-checklist.md)).
- [ ] **[change]** Health check in the process manager or load balancer that reads `status` from `GET /v1/health`, not only the HTTP code ([Production deployment](../operations/production-deployment.md)).

## Limits

- The emailed sign-in link has no node-wide switch; `AIMEAT_PASSWORD_SIGN_IN=off` leaves it on (`aimeat/src/services/login-link.ts`).
- A passkey or an IdP sign-in satisfies required two-step sign-in without the node's TOTP code, by design; on the IdP path MFA is the IdP's (`aimeat/src/services/sign-in-policy.ts`).
- The node has no outbound proxy setting; egress is controlled only by firewall destinations.
- The shipped systemd unit does not set `NODE_ENV=production`, so its log is coloured text, not JSON, until the operator adds it.
- There is no setting that removes the federation routes.
- `aimeat validate` does not read the security profile and does not report the posture warnings the start log reports.
- The node does not send an HSTS `preload` directive.

## Open questions

- OPEN: Can an operator block `/v1/federation/` at the reverse proxy on a node that must never federate, without breaking any other feature? (the maintainer named in `.github/SECURITY.md`)
- OPEN: Should `aimeat/deploy/aimeat.service` set `NODE_ENV=production`? (the maintainer)
