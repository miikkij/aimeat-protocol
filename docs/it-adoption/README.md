# AIMEAT IT adoption package

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see "How this package stays current" below.

What an organisation's IT and information security need to evaluate, approve, install and run AIMEAT as their own internal system. AIMEAT is open-source software (MIT) that the organisation runs on its own server: people and their AI agents keep their knowledge there and share it through MCP, the protocol that AI tools such as Claude, Claude Code, Codex, Cursor and VS Code connect with, without a migration between AI vendors. Nothing here is specific to one organisation. Every claim names its source in the repository (a file, a setting or an MCP tool), and what the repository does not answer is listed under [Open questions](#open-questions). The limits are stated as plainly as the features: [16 Known limitations](16-known-limitations.md) collects them.

The package answers three questions:

1. **Is it safe by default?** Partly, and the pages say which defaults an organisation node must change: [07 Security](07-security.md) lists the secure defaults, [16 Known limitations](16-known-limitations.md) the open ones, and [09 Hardening guide](09-hardening-guide.md) what to set.
2. **Who is responsible for what?** [03 Shared responsibility](03-shared-responsibility.md): the software, the operator (IT), the admins of each shared group and the users.
3. **Can every claim be checked?** Each one carries its source, and `pnpm check:it-adoption` refuses a page whose sources changed since it was read (below).

## Reading order for IT and security

Read these five first: they decide whether the rest is worth reading.

| Order | Page | What it answers |
|---|---|---|
| 1 | [03 Shared responsibility](03-shared-responsibility.md) | What AIMEAT provides, what the operator does, what group admins and users do |
| 2 | [07 Security](07-security.md) | The security model, the secure defaults, sessions, secrets, dependencies, vulnerability reporting |
| 3 | [08 Threat model](08-threat-model.md) | The main threats, the control for each, the residual risk, what the organisation must do |
| 4 | [09 Hardening guide](09-hardening-guide.md) | The production checklist on top of the defaults |
| 5 | [16 Known limitations](16-known-limitations.md) | Every limitation in one place |

Then the go-live checklist, which is the work itself, and the rest by topic.

| Page | What it answers |
|---|---|
| [00 Go-live checklist](00-go-live-checklist.md) | Everything to do when a node goes online, in order: the domain (passkeys are bound to it), DNS and TLS, secrets, the first start, email (SPF, DKIM, DMARC), sign-in (Entra, Google, SAML, SCIM, passkeys), AI, search engines, compliance settings, and the checks before users arrive |
| [01 Overview](01-overview.md) | What AIMEAT is and is not, licence, versions, maintenance model, who it fits |
| [02 Architecture](02-architecture.md) | Components, data flows, inbound traffic, the outbound traffic as an egress allowlist, resources |
| [04 Identity and access](04-identity-access.md) | SSO, provisioning and leavers, MFA, the role model, agent identities, tokens |
| [05 Data protection](05-data-protection.md) | Data inventory, encryption, classification, retention and deletion, GDPR export, data location |
| [06 AI and models](06-ai-and-models.md) | Model sources, what is sent to a model, local-only data, budgets, AI Act transparency, and what IT prepares for Azure, AWS Bedrock, OpenRouter, its own GPU servers or a direct provider |
| [10 Logging and monitoring](10-logging-monitoring.md) | What is logged, retention, SIEM, health checks, alerts, compliance reports |
| [11 Backup and recovery](11-backup-recovery.md) | What to back up, restore, proposed RTO and RPO, the restore test |
| [12 Updates and releases](12-updates-releases.md) | Releases, integrity, updating, rollback, security fixes |
| [13 Apps, agents and endpoints](13-apps-agents-endpoints.md) | Who publishes apps, the connector on workstations, MCP connections from AI chats |
| [14 Compliance mapping](14-compliance-mapping.md) | GDPR, EU AI Act, ISO/IEC 27001 Annex A and NIS2, with AIMEAT's support and the organisation's part |
| [15 Operations runbook](15-operations-runbook.md) | Installation, the settings to decide, routines, troubleshooting, RACI |
| [17 Exit plan](17-exit-plan.md) | Export, shutdown, data destruction, running without a vendor |

## Templates the organisation fills in

Pre-filled with what AIMEAT can state about itself; the organisation's own fields are marked `[ORGANIZATION]`.

| Template | For |
|---|---|
| [Organisation profile](templates/organization-profile.md) | The operator, contacts, environment, identity provider, model provider, classification scheme, regulations |
| [Application register entry](templates/application-register-entry.md) | The usual fields of an application register or ISMS form |
| [Risk assessment](templates/risk-assessment.md) | Confidentiality, integrity, availability and AI risks, pre-filled from the threat model |
| [Record of processing (GDPR Article 30)](templates/processing-record.md) | Pre-filled from the node's own register drafts |
| [Approval checklist](templates/approval-checklist.md) | IT and security sign-off before production |
| [Regulated-sector addendum](templates/regulated-sector-addendum.md) | Medical devices, finance, public sector: GAMP, electronic records and signatures, quality systems, SOUP |

## With the operator's AI

An operator who works through an AI chat connected over MCP does not have to read the go-live checklist alone. Every node serves the skill `aimeat-node-operations`, and its section "Before the node goes online" walks the same checks with the node's own admin tools (`aimeat_admin_security_overview`, `aimeat_admin_config`, `aimeat_admin_sso_list`, `aimeat_ai_providers`, `aimeat_seo_status` and others) and reports what is ready, what is missing and who provides it (`aimeat/src/data/builtin-skills.runbooks.ts`). The AI needs the operator's `operator:admin` permission for those tools.

## How this package stays current

The pages describe the code, so they are kept with it. The rule is in the repository's instructions for every change: a change to a setting, a default, a sign-in method, an outbound connection, a security control or a limit corrects the page that states it in the same commit (`CLAUDE.md`, `.claude/rules/feature-documentation.md`). A gate holds it:

- `pnpm check:it-adoption` fails when a file a page watches changes after the page was last read, when a setting (`AIMEAT_*`) or an MCP tool (`aimeat_*`) a page names no longer exists, when a page is older than 180 days, when a page's major version is not the code's, and when an open question of a page is missing from the list below. The watched files per page are in `aimeat/security/it-adoption-reviews.json`; the reasoning is in `aimeat/scripts/check-it-adoption.ts`.
- `pnpm check:docs` fails on a dead link or a repository path that no longer exists.
- After reading a page against a change: `pnpm check:it-adoption --record <page>` stamps the date and the commit in the page's first line.

The "Checked against" line at the top of each page says which version and commit it was last read against.

## Open questions

What the repository does not answer. Each one names who can answer it; most are for the maintainer named in `.github/SECURITY.md`. When one is answered, the page changes and the line leaves this list.

### [01 Overview](01-overview.md)

- OPEN: Does any party offer a commercial support contract or service level for self-hosted AIMEAT nodes, and on what terms? The maintainer named in `.github/SECURITY.md` can answer.

### [02 Architecture](02-architecture.md)

- OPEN: What are the minimum and recommended CPU, memory and disk sizes for a node of a given number of people and agents? The maintainer named in `.github/SECURITY.md` can answer; no sizing test is in the repository.
- OPEN: Does the node work through an outbound HTTP proxy, for example with Node's `NODE_USE_ENV_PROXY` and `HTTPS_PROXY`? Nothing in the repository shows a test; the maintainer can answer.
- OPEN: Is a high-availability pattern (for example an active-passive pair on PostgreSQL with one node process at a time) tested by the project? The maintainer can answer.

### [03 Shared responsibility](03-shared-responsibility.md)

- OPEN: Is there a supported procedure to rotate the node's Ed25519 key (`AIMEAT_NODE_KEY_PATH`) without breaking every issued token and every federation peer? The maintainer named in `.github/SECURITY.md` can answer.

### [04 Identity and access](04-identity-access.md)

- OPEN: Is there a supported way to stop an SSO-managed account from signing in with an emailed sign-in link, so that it signs in only through its identity provider? `AIMEAT_PASSWORD_SIGN_IN` covers the password; the link has no switch. The maintainer named in `.github/SECURITY.md` can answer.
- OPEN: What is the supported recovery when the only operator of a node loses both the TOTP device and the backup codes? The maintainer can answer.
- OPEN: Which scopes does a new agent created on the MCP OAuth consent page start with when the owner keeps the preselected choice: `AIMEAT_DEFAULT_AGENT_SCOPES` or another set? The maintainer can answer; `aimeat/public/oauth-consent.html` holds the page.
- OPEN: Can an organisation's IdP group membership be mapped to organism membership or to the operator role in any way other than one organism per SSO connection? The maintainer can answer.

### [05 Data protection](05-data-protection.md)

- OPEN: Does the node-postgres driver used here honour `sslmode=require` and `sslrootcert` in `DATABASE_URL`, and has the project run against a TLS-only PostgreSQL? The maintainer named in `.github/SECURITY.md` can answer.
- OPEN: Is there an expiry sweep for `Session` rows past their lifetime, or do expired sessions stay until account deletion? The maintainer can answer.
- OPEN: How does an operator prune `AccountEventArchive` (a command, a route, or SQL by hand)? The maintainer can answer.

### [06 AI and models](06-ai-and-models.md)

- OPEN: Does an Azure OpenAI v1 endpoint accept an Azure API key sent as `Authorization: Bearer` from a plain HTTP client, and does it serve AIMEAT's chat completions, embeddings and transcription calls? IT of the adopting organisation can answer with one test call; the maintainer named in `.github/SECURITY.md` can say whether an `api-key` header option is planned.
- OPEN: Is support for refreshing credentials (Entra ID tokens, short-term Bedrock keys) or SigV4 planned? The maintainer can answer.
- OPEN: Does the node send any OpenRouter request field for data collection or zero data retention, and can an operator require it? The maintainer can answer.
- OPEN: Which statement is current: `aimeat_admin_usage`'s description that no chat turn is metered (`aimeat/src/tool-catalog/definitions/discovery-work-boards.ts`), or `aimeat/.env.example`, which says chat is metered unless the shared chat key is set? The maintainer decides.
- OPEN: What does a call that needs vision do when neither the person nor the operator set a vision model: refuse, or use the text model? The maintainer can answer.
- OPEN: Has the project measured a `local` provider on another host with vLLM or TGI under concurrent load (streaming, tool calls, embeddings)? The maintainer can answer.

### [07 Security](07-security.md)

- OPEN: What is the date and scope of the most recent outside penetration test, if any? The repository records internal audits and probe sessions only. (the maintainer)

### [08 Threat model](08-threat-model.md)

- OPEN: Does the maintainer have a formal threat model (for example STRIDE per component) beyond `docs/security/threat-model.md`, and is it shareable under NDA? (the maintainer named in `.github/SECURITY.md`)
- OPEN: What exactly can an organism owner see and change in a member's content that is shared into the organism, as a role-by-role table? (the maintainer)
- OPEN: Can the connector's local daemon be reached by other local users on a shared multi-user computer, and what authenticates them? (the maintainer)

### [09 Hardening guide](09-hardening-guide.md)

- OPEN: Can an operator block `/v1/federation/` at the reverse proxy on a node that must never federate, without breaking any other feature? (the maintainer named in `.github/SECURITY.md`)
- OPEN: Should `aimeat/deploy/aimeat.service` set `NODE_ENV=production`? (the maintainer)

### [10 Logging and monitoring](10-logging-monitoring.md)

- OPEN: Is a push export of the usage trail and operator actions (syslog, OTLP or a webhook stream) planned? (the maintainer named in `.github/SECURITY.md`)
- OPEN: Are human (non-AI) reads of Confidential content recorded anywhere the operator can export? (the maintainer)
- OPEN: How long does the account event archive keep entries, and does an account erasure remove them? (the maintainer)

### [11 Backup and recovery](11-backup-recovery.md)

- OPEN: Has a restore been timed on a PostgreSQL database of production size, and what did it take? (the maintainer named in `.github/SECURITY.md`)

### [12 Updates and releases](12-updates-releases.md)

- OPEN: Are fixed vulnerabilities published as GitHub security advisories or CVE records, and is there a list that operators can subscribe to? The maintainer named in `.github/SECURITY.md` can answer.
- OPEN: Are the `v*` release tags signed, and with which key? The maintainer can answer.
- OPEN: Will npm releases be published from CI with provenance attestations, and will the SBOM be attached to each release? The maintainer can answer.
- OPEN: How much notice does an operator get before a release that removes something (a major version)? The repository shows the removal table per major version but no notice period; the maintainer can answer.

### [13 Apps, agents and endpoints](13-apps-agents-endpoints.md)

- OPEN: Which source address ranges do the cloud-hosted MCP clients of each AI vendor use, so that an inbound allowlist in front of `/v1/mcp` can be written? Each vendor's documentation answers; the repository does not.
- OPEN: Does the connector need any file outside the connector folder, `~/.config/aimeat/` and the npm cache (for example a shell profile or a local AI tool's settings file written by `aimeat connect client`) to be removed for a full uninstall? The maintainer named in `.github/SECURITY.md` can answer.
- OPEN: Is there an operator-level switch that limits which outside MCP server addresses people may attach to their own accounts, beyond the SSRF guard? The maintainer can answer.
- OPEN: Can an operator review or block one app's code before it is published, or only hide it afterwards? The maintainer can answer.

### [14 Compliance mapping](14-compliance-mapping.md)

- OPEN: Has any organisation completed a DPIA or an ISO 27001 statement of applicability for an AIMEAT deployment that the project can reference? The maintainer can answer.
- OPEN: Is a notice to recipients planned for a rectification, and for an erasure outside federation (GDPR Art. 19)? Federation peers already receive a retraction for a deleted or erased record. The maintainer can answer.

### [15 Operations runbook](15-operations-runbook.md)

- OPEN: Can a proxy that rewrites `Host` cause a sign-in loop, or only the wrong-family symptom that production-deployment.md describes? No test or document in the repository shows a loop. The maintainer named in `.github/SECURITY.md` can answer.

### [17 Exit plan](17-exit-plan.md)

- OPEN: Which personal data does the node log, and for how long, so that log destruction can be scoped? See [10 Logging and monitoring](10-logging-monitoring.md); if that page leaves it open, the maintainer can answer.
- OPEN: Is there a documented way to migrate a whole node (all accounts) to another AIMEAT node other than restoring its database there? The maintainer can answer.

### [Template: record of processing activities (GDPR Article 30)](templates/processing-record.md)

- OPEN: How long does the node keep the sign-in and security log and the AI usage ledger in its database, and is either one pruned by a scheduled job? The node's drafts for `node-security-log` and `node-ai-usage` state no retention (`aimeat/src/services/compliance-derived.ts`). The maintainer named in `.github/SECURITY.md` can answer.
