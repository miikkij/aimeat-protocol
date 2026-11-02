# Template: approval checklist before production

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see the README for how.

## How to use

IT and information security go through this list once before the node takes production data, and again after a major update or a change in how the node is installed. Each row names what to check and where the check is described; the evidence column is for a link, a screenshot reference or a command output, because "done" without evidence does not survive an audit. A row that does not apply is marked "n/a" with the reason. The technical steps themselves are in the [go-live checklist](../00-go-live-checklist.md) and the [hardening guide](../09-hardening-guide.md); this list records that someone with authority checked them, and ends with the sign-off.

## Installation details

| Field | Answer |
|---|---|
| Installation | [ORGANIZATION] *Public address and environment, e.g. https://aimeat.example.com, production.* |
| AIMEAT version | [ORGANIZATION] *Version and commit from `GET /v1/build`.* |
| Organisation profile | [ORGANIZATION] *Link to the filled [organisation profile](organization-profile.md).* |

## A. Installation and hardening

| # | Check | How to check (source) | Responsible | Done: date and evidence |
|---|---|---|---|---|
| A1 | The go-live checklist is complete | [00 Go-live checklist](../00-go-live-checklist.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, link* |
| A2 | The hardening guide is applied | [09 Hardening guide](../09-hardening-guide.md), [deployment checklist](../../security/deployment-checklist.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, link* |
| A3 | The security profile is `public` for an installation reachable from outside, and the startup log shows no SECURITY warning left unexplained | `AIMEAT_SECURITY_PROFILE`; "Startup self-check" in `aimeat/.env.example` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, log excerpt* |
| A4 | Port 40050 is reachable only from the reverse proxy, TLS is on at the proxy, `AIMEAT_TRUST_PROXY` matches the real proxy path | [Production deployment](../../operations/production-deployment.md), [deployment checklist](../../security/deployment-checklist.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, scan result* |
| A5 | Hosted apps are served on their own origin with a wildcard name and certificate, or the decision not to is recorded | `AIMEAT_APP_HOST`, `AIMEAT_APP_ORIGIN_ENABLED`; [production deployment](../../operations/production-deployment.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, decision* |
| A6 | The data key (`AIMEAT_ENCRYPTION_KEY`, or `AIMEAT_TOTP_ENCRYPTION_KEY` on a node installed with `aimeat init`) and `AIMEAT_KEY_PASSPHRASE` are set and stored apart from the database backups; neither key is changed or removed on a node already holding secrets | [Backup and restore](../../operations/backup-and-restore.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, where kept* |
| A7 | The admin Security page lists no open incident | `aimeat_admin_security_overview`; [deployment checklist](../../security/deployment-checklist.md), "Updating a Running Node" | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, screenshot* |
| A8 | Outbound network is limited to what the node needs: model provider, SMTP relay, update check (registry.npmjs.org and unpkg.com), signature checks (EU trusted lists and certificate issuers) | [Organisation profile](organization-profile.md), section 3; `AIMEAT_UPDATE_CHECK`, `AIMEAT_UPDATE_CHECK_SOURCE`, `AIMEAT_DOCSIGN_ONLINE_CHECKS` (`aimeat/src/services/node-update-check.ts`, `aimeat/src/services/config-schema-docsign.ts`) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, firewall rule set* |

## B. Identity and access

| # | Check | How to check (source) | Responsible | Done: date and evidence |
|---|---|---|---|---|
| B1 | Single sign-on works with your IdP, and only your tenants or connections are admitted | [Organisation node sign-in](../../organisation-node-sign-in.md); `AIMEAT_ENTRA_ALLOWED_TENANTS` or `aimeat_admin_sso_list` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, test sign-in from an outside tenant refused* |
| B2 | Registration mode is set deliberately (`open` is the default) | `AIMEAT_REGISTRATION_MODE` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, value* |
| B3 | Deprovisioning works: a leaver in the IdP loses access | SCIM (`aimeat_admin_sso_scim_token`) or the manual procedure; [04 Identity and access](../04-identity-access.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, test account* |
| B4 | Every operator account has a second factor; the list of operators is approved | TOTP or passkey per account; `AIMEAT_TWO_STEP_REQUIRED=operators` makes the node enforce it (`aimeat/src/services/sign-in-policy.ts`, [deployment checklist](../../security/deployment-checklist.md)) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, operator list* |
| B5 | The first-operator setup is closed | `/v1/admin/setup/register` answers 410 once an operator exists unless `AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR` is true (`aimeat/.env.example`) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, response* |
| B6 | A rule for which permissions agents may hold, and a review interval | `AIMEAT_MAX_AGENT_SCOPES`, `AIMEAT_DEFAULT_AGENT_SCOPES`; `aimeat_admin_agents`; [13 Apps, agents and endpoints](../13-apps-agents-endpoints.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, rule* |
| B7 | A rule for the connector on workstations: who may install it, on which devices | [Connector forward tunnel](../../connector-forward-tunnel.md); [risk assessment](risk-assessment.md), C5 | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, rule* |

## C. Backup, logging and incidents

| # | Check | How to check (source) | Responsible | Done: date and evidence |
|---|---|---|---|---|
| C1 | Backups cover the database, `.env` and the node key file, on a schedule that meets the RPO | [Backup and restore](../../operations/backup-and-restore.md), [11 Backup and recovery](../11-backup-recovery.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, schedule* |
| C2 | A restore test passed on a separate machine: health is `healthy`, the version is right, a known record reads back | [Backup and restore](../../operations/backup-and-restore.md), "Test the restore" | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, test record* |
| C3 | Logs reach your log platform, and alerts exist for repeated sign-in failures and for the node being down | [10 Logging and monitoring](../10-logging-monitoring.md), [observability guide](../../../aimeat/docs/observability-guide.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, alert names* |
| C4 | The incident response procedure names who acts, and how a personal data breach is recorded | [Incident response](../../security/incident-response.md); the node keeps breaches with the 72-hour clock ([data classification](../../data-classification.md)) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, procedure link* |
| C5 | An update procedure and an owner for watching new releases | [Upgrading](../../operations/upgrading.md), [12 Updates and releases](../12-updates-releases.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, procedure link* |

## D. Data protection and AI

| # | Check | How to check (source) | Responsible | Done: date and evidence |
|---|---|---|---|---|
| D1 | The records of processing are reviewed and stored on the node | [Processing record](processing-record.md); `aimeat_compliance_register_read` with part `registers_draft` | [ORGANIZATION] *DPO or privacy lead* | [ORGANIZATION] *Date* |
| D2 | A DPIA is done, or the reason none is needed is recorded | The node reports a missing DPIA as a gap for domains that need one (`aimeat/src/data/compliance-domains.ts`) | [ORGANIZATION] *DPO* | [ORGANIZATION] *Date, reference* |
| D3 | A data processing agreement exists with the model provider and every other processor the node lists | Processors: `aimeat/src/services/compliance-derived.ts`; OpenRouter's agreement: [OpenRouter region](../../operations/openrouter-region.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, agreement references* |
| D4 | The AI region and fallback are chosen, and transfers outside the EU/EEA have a basis and an assessment | `AIMEAT_AI_OPENROUTER_REGION`, `AIMEAT_AI_OPENROUTER_REGION_FALLBACK`; [06 AI and models](../06-ai-and-models.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, values* |
| D5 | Classification is switched on, or the decision to leave it off is recorded | `AIMEAT_CLASSIFICATION` (off by default); [data classification](../../data-classification.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, decision* |
| D6 | The operator details on the privacy page are correct | `AIMEAT_OPERATOR_NAME`, `AIMEAT_OPERATOR_EMAIL`, `AIMEAT_OPERATOR_DPO_CONTACT`; page `/v1/privacy` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date* |
| D7 | Data processing agreements are in place with any other legal entity whose people use the node | [Data processing agreement template](../../data-processing-agreement-template.md); `aimeat_compliance_agreement` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, references* |
| D8 | AI use cases are entered in the compliance register with a risk class | [Data classification](../../data-classification.md), "The compliance register"; `aimeat_compliance_report` | [ORGANIZATION] *Role* | [ORGANIZATION] *Date* |

## E. People and exit

| # | Check | How to check (source) | Responsible | Done: date and evidence |
|---|---|---|---|---|
| E1 | Users are trained: what may be stored, which AI tools may connect, how to approve an agent, how to report a problem | [ORGANIZATION] *Your training material.* [Risk assessment](risk-assessment.md), AI1 | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, attendance* |
| E2 | Operators are trained on the admin pages, the update procedure and the restore | [15 Operations runbook](../15-operations-runbook.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date* |
| E3 | The exit plan is read and the data export path is tested | [17 Exit plan](../17-exit-plan.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date* |
| E4 | The known limitations are read and each one is accepted or treated | [16 Known limitations](../16-known-limitations.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date* |
| E5 | The risk assessment is accepted | [Risk assessment](risk-assessment.md) | [ORGANIZATION] *Risk owner* | [ORGANIZATION] *Date* |
| E6 | The application register entry is filed | [Application register entry](application-register-entry.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, register id* |
| E7 | For a regulated use, the sector addendum is filled | [Regulated-sector addendum](regulated-sector-addendum.md) | [ORGANIZATION] *Role* | [ORGANIZATION] *Date, or n/a* |

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| System owner | [ORGANIZATION] *Name* | [ORGANIZATION] *Date* | [ORGANIZATION] *Approved, approved with conditions (list them), or rejected* |
| IT operations | [ORGANIZATION] *Name* | [ORGANIZATION] *Date* | [ORGANIZATION] *Decision* |
| Information security | [ORGANIZATION] *Name* | [ORGANIZATION] *Date* | [ORGANIZATION] *Decision* |
| Data protection officer | [ORGANIZATION] *Name* | [ORGANIZATION] *Date* | [ORGANIZATION] *Decision* |
| Business owner | [ORGANIZATION] *Name* | [ORGANIZATION] *Date* | [ORGANIZATION] *Decision* |

Conditions and their due dates: [ORGANIZATION] *Each condition, its owner and its date.*
