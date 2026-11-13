# Template: application register entry

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see the README for how.

## How to use

Copy the rows into your application register, CMDB or ISMS form; most such forms ask the same questions under different names. The "Answer" column is pre-filled with what AIMEAT itself determines, with its source, so your register states facts the code supports. A field marked `[ORGANIZATION]` depends on your installation and your decisions; the italic line says what to write. Fill the [organisation profile](organization-profile.md) first, because several answers here repeat it.

## Identification

| Field | Answer | Source |
|---|---|---|
| Application name | AIMEAT node | `aimeat/package.json` |
| Version | 4.2.0 at the time of checking; the running version is in `GET /v1/build` | `aimeat/package.json`, [upgrading](../../operations/upgrading.md) |
| Short description | A self-hosted store for the knowledge people and their AI agents bring and own: records, files, shared workspaces, small web apps and agents, used mainly through AI chat over MCP and through a web control room | [01 Overview](../01-overview.md) |
| Purpose in this organisation | [ORGANIZATION] *The business use, e.g. "shared knowledge base for project teams, used through their own AI assistants".* | |
| Business owner | [ORGANIZATION] *Person and unit accountable for the use.* | |
| System owner | [ORGANIZATION] *Person accountable for operation and security.* | |
| Users | [ORGANIZATION] *Who and roughly how many: staff, partners, AI agents.* | Three principal types: people, AI agents, ecosystem apps (`docs/coding-guidelines/identity-model.md`) |

## Supplier and licence

| Field | Answer | Source |
|---|---|---|
| Supplier type | Open source software, operated internally; no vendor holds the data | [03 Shared responsibility](../03-shared-responsibility.md) |
| Licence | MIT | `LICENSE` |
| Third-party components | Listed with their licences | `THIRD-PARTY-NOTICES.md` |
| Upstream maintainer | The maintainer named in `.github/SECURITY.md` | `.github/SECURITY.md` |
| Support contract | [ORGANIZATION] *Internal team, a partner, or none. The open-source project gives no service level.* | |
| Vulnerability reporting for AIMEAT itself | Per the project's security policy | `.github/SECURITY.md` |

## Service location and access

| Field | Answer | Source |
|---|---|---|
| Service location | [ORGANIZATION] *Data centre or cloud region and country.* | |
| Deployment form | One Node.js 24 process on port 40050 behind your reverse proxy, which holds TLS; PostgreSQL (production) or SQLite database | [02 Architecture](../02-architecture.md), [production deployment](../../operations/production-deployment.md) |
| Access paths | Web UI (`aimeat/public/spa.html`), REST API (`openapi.yaml`), MCP endpoint `/v1/mcp`, command line `aimeat` | `openapi.yaml`, [13 Apps, agents and endpoints](../13-apps-agents-endpoints.md) |
| Reachable from | [ORGANIZATION] *Internal network only, VPN, or the internet.* | Set `AIMEAT_SECURITY_PROFILE` to match |
| Sign-in | Password, emailed sign-in link, passkey, TOTP second factor; optional, each off by default: Microsoft Entra ID (OIDC), Google, Casdoor (OIDC), Finnish bank ID (FTN), and SAML 2.0 with SCIM | `aimeat/src/routes/passkeys.ts`, `aimeat/src/services/totp.ts`, `aimeat/src/config.ts` (`AIMEAT_GOOGLE_OAUTH_ENABLED`, `AIMEAT_CASDOOR_OAUTH_ENABLED`, `AIMEAT_FTN_ENABLED`, `AIMEAT_ENTRA_OAUTH_ENABLED`, `AIMEAT_SSO_ENABLED`), [organisation node sign-in](../../organisation-node-sign-in.md) |
| Identity provider used | [ORGANIZATION] *As in the organisation profile, section 4.* | |

## Data content and classification

| Field | Answer | Source |
|---|---|---|
| Data held | Accounts and profiles; people's memory records and files; shared workspaces; published apps and their data; agents and their tokens; messages; consent ledger; AI usage ledger; sign-in and security log | `aimeat/src/services/compliance/derived.ts` (`nodeRegistersDraft`), [data ownership](../../data-ownership.md) |
| Where data is stored | In the database; stored files too (`StorageFile` table), unless `AIMEAT_FILE_STORE` puts their bytes in an S3 bucket or an Azure container [ORGANIZATION] *say which* | [Backup and restore](../../operations/backup-and-restore.md#what-a-node-is) |
| Secrets at rest | AI keys, vault entries, TOTP secrets and attached MCP server tokens are encrypted with `AIMEAT_ENCRYPTION_KEY`; the node key with `AIMEAT_KEY_PASSPHRASE` | [Backup and restore](../../operations/backup-and-restore.md) |
| Highest confidentiality class allowed | [ORGANIZATION] *e.g. "Confidential; no TL-classified material".* | Classification is off by default (`AIMEAT_CLASSIFICATION`); [data classification](../../data-classification.md) |
| Special categories of personal data | [ORGANIZATION] *Allowed or not; if allowed, which, and the DPIA reference.* | Regulated data domains and their floors: `aimeat/src/data/compliance-domains.ts` |

## Business impact and continuity

| Field | Answer | Source |
|---|---|---|
| Criticality | [ORGANIZATION] *Your scale, e.g. low, medium, high, critical.* | |
| Impact of loss of confidentiality | [ORGANIZATION] *What leaks if the database leaks.* | |
| Impact of loss of integrity | [ORGANIZATION] *What decisions rest on its content.* | |
| Impact of loss of availability | [ORGANIZATION] *What stops if the node is down for a day.* | |
| RTO | [ORGANIZATION] *Maximum tolerable time to restore service.* | Proposals: [11 Backup and recovery](../11-backup-recovery.md) |
| RPO | [ORGANIZATION] *Maximum tolerable data loss, which sets the backup interval.* | Proposals: [11 Backup and recovery](../11-backup-recovery.md) |
| What a backup must contain | The database, the secrets (`.env`) and the node key file, taken together | [Backup and restore](../../operations/backup-and-restore.md) |
| Backup method and schedule | [ORGANIZATION] *pg_dump or SQLite online backup, interval, retention, off-site encrypted copy.* | [Backup and restore](../../operations/backup-and-restore.md) |
| Restore test | [ORGANIZATION] *Date of last test and result; the guide proposes monthly.* | [Backup and restore](../../operations/backup-and-restore.md), "Test the restore" |
| The admin export is not a backup | `GET /v1/admin/backup` exports accounts, agents, actions, boards and each agent's own records and transactions; not people's own records, organisms, workspaces, apps or files | [Backup and restore](../../operations/backup-and-restore.md), "What is not a backup"; `aimeat/src/routes/admin/monitoring.ts` |

## Personal data and transfers

| Field | Answer | Source |
|---|---|---|
| Processes personal data | Yes: at least accounts, the sign-in and security log, the consent ledger, the AI usage ledger and people's own content | `aimeat/src/services/compliance/derived.ts` (`nodeRegistersDraft`) |
| Records of processing | The node drafts its own registers and each app's; review and store them on the admin Compliance page | `aimeat_compliance_register_read` (part `registers_draft`), [data classification](../../data-classification.md), template: [processing record](processing-record.md) |
| Processors | AI providers whose prompts leave the server, the SMTP relay and the hosting, as configured; you add contract, country and transfer basis | `aimeat/src/services/compliance/derived.ts` (`derivedProcessors`) |
| Data location | [ORGANIZATION] *Country of the server and of its backups.* | |
| Transfers outside the EU/EEA | Depends on the model provider. On the node's OpenRouter key: region `eu` processes prompts in the EU/EEA, the United Kingdom or Switzerland (adequacy); `us` and `any` rest on the SCC in OpenRouter's agreement; OpenRouter keeps account and billing records in the United States whatever the region. A local model sends nothing out | [OpenRouter region](../../operations/openrouter-region.md), `aimeat/src/services/compliance/derived.ts` |
| Region chosen | [ORGANIZATION] *eu, us or any, fallback, and whether people may choose.* | `AIMEAT_AI_OPENROUTER_REGION`, `AIMEAT_AI_OPENROUTER_REGION_FALLBACK` |
| Federation peers | Not processors and not recorded as transfers: a copy for another node is stopped only when its label may not leave the organism; content without such a label, which is all content while classification is off, goes to peers unrecorded | `aimeat/src/services/compliance/processing.ts` (limit `federation-peers-not-processors`) |
| DPIA | [ORGANIZATION] *Reference, or the reason none is needed.* The node keeps impact assessments (part `dpias`) and reports a missing one as a gap for data domains that need it | `aimeat/src/data/compliance-domains.ts`, [data classification](../../data-classification.md) |
| Transfer impact assessment | [ORGANIZATION] *Reference for each processor outside the EU/EEA.* The node lists those processors as transfers | `aimeat/src/services/compliance/derived.ts` (`transfersOf`) |
| Data subject rights | Account export and erasure are built in; requests are logged with a one-month deadline | [Data ownership](../../data-ownership.md), [data classification](../../data-classification.md) |

## User, permission and administrator management

| Field | Answer | Source |
|---|---|---|
| Account creation | `AIMEAT_REGISTRATION_MODE`: `open` (default), `oauth`, `invite` or `closed` | `aimeat/.env.example` |
| Joiner and leaver process | [ORGANIZATION] *SCIM from the IdP, or the manual steps and who does them.* | SCIM per SSO connection (`aimeat_admin_sso_scim_token`) |
| Disabling an account | An operator disables an owner | `aimeat_admin_owner_disable` |
| AI agents | An agent connects by device authorization: the owner approves it and picks its permissions; the owner sees and removes every agent; an agent passes on only permissions it holds | `aimeat/src/routes/agents/device-auth.ts`, `aimeat/src/services/agent/scope-add.ts`, `aimeat_agents_list` |
| Administrator accounts | The first operator is created either in the setup wizard (`/v1/setup/wizard`, `POST /v1/setup/init`; on a node whose address is not loopback, with the one-time setup code from the start log) or at `POST /v1/admin/setup/register` with `AIMEAT_ADMIN_PASSWORD` (or the generated secret in the `admin-setup-secret` file, mode 0600) and the same setup code; further operators are granted on the admin Owners page | `aimeat/.env.example`, `aimeat/src/routes/setup.ts`, `aimeat/src/routes/admin/setup-register.ts`, `aimeat/src/services/admin-setup-secret.ts` |
| Named administrators | [ORGANIZATION] *Names of everyone with the operator role, and of everyone with shell or database access.* | Operator role and host access are separate trust boundaries ([threat model](../../security/threat-model.md)) |
| Second factor for administrators | [ORGANIZATION] *Your rule.* The deployment checklist asks for TOTP on operator accounts; `AIMEAT_TWO_STEP_REQUIRED=operators` makes the node enforce it | [Deployment checklist](../../security/deployment-checklist.md), `aimeat/src/services/sign-in-policy.ts` |
| Access review | [ORGANIZATION] *Interval and who reviews operators, agents and SSO connections.* | `aimeat_admin_agents`, `aimeat_admin_sso_list` |

## Server management and updates

| Field | Answer | Source |
|---|---|---|
| Server administration | [ORGANIZATION] *Team, access method, and privileged access management.* | The supplied unit runs the node as user `aimeat` (`aimeat/deploy/aimeat.service`) |
| Application updates | Stop, install, start; database migrations run by themselves at start, in order, each once; going back means restoring the backup taken before the update | [Upgrading](../../operations/upgrading.md) |
| Update notices | The node asks `registry.npmjs.org` and `unpkg.com` for a newer version and shows operators a notice; `AIMEAT_UPDATE_CHECK` turns the check off, and `AIMEAT_UPDATE_CHECK_SOURCE` points it at a mirror | `aimeat_admin_node_update`, `aimeat/src/services/node-update-check.ts`, [upgrading](../../operations/upgrading.md) |
| Update window and approver | [ORGANIZATION] *When updates are applied and who approves them.* | [12 Updates and releases](../12-updates-releases.md) |
| Operating system patching | [ORGANIZATION] *Patch process and interval.* | Not part of AIMEAT |
| Database patching | [ORGANIZATION] *Patch process for PostgreSQL.* | Not part of AIMEAT |
| Node.js runtime patching | [ORGANIZATION] *Who updates Node.js within the 24 line.* | `aimeat/package.json` (`engines`) |
| Logs | Application log level `AIMEAT_LOG_LEVEL`; refused requests in a rotating refusal log; metrics at `/v1/metrics` when switched on | `aimeat/src/services/auth-audit.ts`, [observability guide](../../../aimeat/docs/observability-guide.md), [10 Logging and monitoring](../10-logging-monitoring.md) |
| Log forwarding | [ORGANIZATION] *SIEM or log platform, and retention.* | |
| Exit plan | Data leaves through account exports and a database dump | [17 Exit plan](../17-exit-plan.md) |
