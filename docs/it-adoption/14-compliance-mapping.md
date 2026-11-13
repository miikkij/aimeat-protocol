# 14 Compliance mapping

> Checked against AIMEAT node 4.2.0 (commit e2be032fb) on 2026-11-04. Maintained with the code: see the README for how.

This page is for the DPO, the compliance officer and the auditor. It maps GDPR, the EU AI Act, ISO/IEC 27001:2022 Annex A and NIS2 Article 21 to what the AIMEAT node does, and says what stays with the organisation. AIMEAT is not certified, and the repository holds no external audit or attestation. "Yes" below means the node has the mechanism; it never means the organisation is compliant by running it. The node's own compliance features say the same: every risk or framework verdict is served with a not-legal-advice note (`aimeat/src/data/compliance-questionnaire.ts`).

## The node's compliance features

| Feature | What it holds | Tools and routes | Source |
|---|---|---|---|
| Records of processing (GDPR Art. 30) | one register per processing: type, purpose, role, legal basis, subjects, data categories, data domains, recipients, processors, transfers, retention, review date; at node, organism and app level. Drafts for the node's own registers (accounts, sign-in and security log, consent ledger, AI usage ledger) | `aimeat_compliance_register_read`, `aimeat_compliance_register_write`, `GET /v1/compliance/draft`, `GET /v1/compliance/gaps` | `aimeat/src/services/compliance/docs.ts`, `aimeat/src/services/compliance/draft.ts`, [Data classification](../data-classification.md) |
| Processors | contract, country, transfer basis per processor; the node lists the AI providers whose prompts leave the machine, mail and hosting itself | same tools, `part: "processors"` | `aimeat/src/services/compliance/derived.ts`, `aimeat/src/services/compliance/processing.ts` |
| Data subject requests | requests with a one-month deadline; the account export and the erasure log themselves | same tools, `requests` | `aimeat/src/services/compliance/docs.ts` |
| Breaches | personal data breaches with the 72-hour clock | same tools, `breaches` | `aimeat/src/services/compliance/docs.ts` |
| DPIAs (Art. 35) | impact assessments; a data domain that needs one makes a missing one a gap | same tools, `dpias` | `aimeat/src/data/compliance-domains.ts` |
| Framework question sets | GDPR, NIS2, DORA, CRA, EAA, DSA, HIPAA, export control; an unanswered set reads unclassified, never "does not apply" | same tools, `frameworks` | `aimeat/src/data/compliance-frameworks.ts` |
| Register of AI uses and risk classification | use cases with systems, models, purpose and data subjects, classified by a questionnaire (prohibited, high, limited, minimal; unanswered reads unclassified). The question set is a record the operator edits | `aimeat_compliance_register_read`, `aimeat_compliance_register_write`, admin Compliance page | `aimeat/src/services/compliance/register.ts`, `aimeat/src/data/compliance-questionnaire.ts` |
| Compliance report | joins the register to what the node logged (provenance, consent, AI usage) and lists the gaps and what the report does not cover; a monthly job stores the previous month | `aimeat_compliance_report`, `aimeat_compliance_snapshot` | `aimeat/src/services/compliance/report.ts`, `aimeat/src/services/compliance/monthly-job.ts` |
| Data processing agreements | agreements with versions, notices and signing; a processor entry's `agreement` slot | `aimeat_compliance_agreement` | `aimeat/src/services/compliance/agreements.ts`, [DPA template](../data-processing-agreement-template.md) |
| Controller identity | the operator as controller on `/v1/privacy`; the page answers 503 until the required fields are set | Required: `AIMEAT_OPERATOR_NAME`, `AIMEAT_OPERATOR_COUNTRY`, `AIMEAT_OPERATOR_EMAIL`, `AIMEAT_OPERATOR_HOSTING_NAME`, `AIMEAT_OPERATOR_HOSTING_LOCATION`, `AIMEAT_OPERATOR_SUPERVISORY_NAME`, `AIMEAT_OPERATOR_SUPERVISORY_URL`, `AIMEAT_OPERATOR_EFFECTIVE_DATE`, and `AIMEAT_OPERATOR_ADDRESS` when `AIMEAT_OPERATOR_TYPE` is `company`, `organisation` or `association`. `AIMEAT_OPERATOR_TYPE` defaults to `natural_person`, so an organisation must set it. Optional: `AIMEAT_OPERATOR_BUSINESS_ID`, `AIMEAT_OPERATOR_DPO_CONTACT`, `AIMEAT_OPERATOR_SECURITY_EMAIL`, `AIMEAT_OPERATOR_SIGNER_NAME`, `AIMEAT_OPERATOR_SIGNER_ROLE` | `aimeat/.env.example`, `aimeat/src/config/operator.ts` |

The admin Compliance page is `<node>/v1/admin?tab=compliance`. Routes need `compliance:read` or `compliance:write` for anything acting for a person.

## GDPR

Regulation (EU) 2016/679 ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj)).

| Requirement | AIMEAT support | How (source) | Organisation's responsibility |
|---|---|---|---|
| Art. 5 principles: lawfulness, purpose limitation, minimisation, accuracy, storage limitation, integrity, accountability | partial | registers record purpose, legal basis and retention (`aimeat/src/services/compliance/docs.ts`); retention settings and sweeps ([05 Data protection](05-data-protection.md)); classification limits reads and exits ([Data classification](../data-classification.md)) | decide purposes and legal bases; set retention; several data kinds have no automatic retention |
| Art. 25 data protection by design and by default | partial | classification off by default but available; AI providers absent by default; federation and outside mail off by default; agents get scopes the person grants ([04 Identity and access](04-identity-access.md)) | choose defaults for the organisation, turn classification on |
| Art. 28 processor | partial | DPA template and agreement records (`aimeat_compliance_agreement`, [DPA template](../data-processing-agreement-template.md)); processors register | sign DPAs with the hosting provider, model providers, mail relay; AIMEAT the software is not a processor, the operator is |
| Art. 30 records of processing | yes | registers with drafts for the node's own processing (`aimeat/src/services/compliance/draft.ts`) | complete and review them |
| Art. 32 security of processing | partial | secrets encrypted with AES-256-GCM, scrypt passwords, TOTP and passkeys, SSO, scopes, audit feeds ([07 Security](07-security.md)) | TLS, disk and database encryption, backups, network, patching; content at rest is not encrypted by the node |
| Art. 33 breach notification | partial | breach register with the 72-hour clock (`aimeat/src/services/compliance/docs.ts`); [Incident response](../security/incident-response.md) | detect, assess and notify the authority |
| Art. 35 DPIA | partial | DPIA register; data domains that need one make a missing one a gap (`aimeat/src/data/compliance-domains.ts`) | carry out the assessment |
| Art. 15 access | yes | `GET /v1/owners/:name/export` (`aimeat/src/routes/owners/export.ts`) | answer within a month; files come as metadata, not bytes |
| Art. 16 rectification | yes | the person edits their own records and profile | handle requests for data the person cannot edit |
| Art. 17 erasure | yes | `DELETE /v1/owners/:name`, immediate (`aimeat/src/services/owner-erasure.ts`) | backups; shared records kept under a pseudonym; outside file store sweep |
| Art. 18 restriction | partial | an operator can disable an account (`aimeat_admin_owner_disable`) | a finer restriction per processing is manual |
| Art. 19 notification of recipients | partial | a delete or an erasure of a record replicated to federation peers sends a signed retraction to each peer that holds it (`POST /v1/federation/retract`, `aimeat/src/services/memory-replication.ts`). No mechanism was found that tells a peer about a rectification, or that tells the people a record was shared with | notify recipients of rectifications, and of erasures outside federation |
| Art. 20 portability | yes | the export is JSON; `aimeat_organism_export` for an organism | |
| Art. 21 objection | no | no objection mechanism found | handle objections |
| Art. 22 automated decisions | partial | decision runs are recorded and reviewable (`aimeat_decision_review`, `aimeat/src/services/decide/service.ts`); the AI use questionnaire asks whether a use decides about a person | decide whether any use falls under Art. 22 and provide human review |

## EU AI Act

Regulation (EU) 2024/1689 ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)). The organisation running the node is a deployer by default; it becomes a provider when it puts its own name on a generative system ([AI transparency](../ai-transparency.md), section 3).

| Requirement | AIMEAT support | How (source) | Organisation's responsibility |
|---|---|---|---|
| Art. 4 AI literacy | no | none in the node | train staff who use and run AI |
| Art. 26 deployer of a high-risk system | partial | the register classifies each use; AI usage records keep every call (raw for 90 days, then archived, never deleted by a job) (`aimeat/src/services/usage/archive-job.ts`); provenance records | decide whether any use is high risk; human oversight, input data, monitoring, informing workers |
| Art. 50 transparency | yes | provenance records and visible labels, public detection by hash, `GET /v1/ai-transparency` ([AI transparency](../ai-transparency.md)); `AIMEAT_AI_PROVENANCE`, `AIMEAT_AI_LABEL_PUBLIC` | name the market surveillance authority (`AIMEAT_AI_SUPERVISORY_NAME`); set `AIMEAT_AI_COP_SECTIONS` only for the sections the organisation signed |
| Register of AI uses | yes | `compliance.usecases` with the questionnaire (`aimeat/src/services/compliance/register.ts`) | fill it in; the report lists models and apps that no use names |
| Risk classification | partial | questionnaire on Article 5 and Annex III, editable as data; unanswered reads unclassified (`aimeat/src/data/compliance-questionnaire.ts`) | the classification is the organisation's own determination |

## ISO/IEC 27001:2022 Annex A

Controls the node touches ([ISO/IEC 27001:2022](https://www.iso.org/standard/27001)). Controls not listed are the organisation's alone.

| Control | AIMEAT support | How (source) | Organisation's responsibility |
|---|---|---|---|
| 5.15 Access control | yes | scopes on every route and MCP tool, consent for agents and apps, organism and workspace membership ([04 Identity and access](04-identity-access.md)) | access policy, review of grants |
| 5.17 Authentication information | yes | scrypt passwords (`aimeat/src/services/password.ts`), TOTP secrets and keys encrypted, tokens stored as hashes | password policy at the identity provider |
| 5.23 Information security for cloud services | partial | processors register lists AI providers, mail and hosting (`aimeat/src/services/compliance/processing.ts`) | select and contract cloud and model providers |
| 5.34 Privacy and protection of PII | partial | export, erasure, registers, classification ([05 Data protection](05-data-protection.md)) | privacy programme |
| 8.2 Privileged access rights | partial | operator role. An AI credential cannot turn the classification switch off or from `all` to `owner`, and cannot weaken `auth.two_step_required` or `auth.password_sign_in` (403 `PERSON_REQUIRED`). An operator's agent holding `operator:admin` can change every other setting, including ones that weaken protection (`aimeat/src/services/config/admin-view.ts`, `aimeat_admin_config_set`). Each setting change writes the operator trail, without values (`aimeat/src/routes/admin/config.ts`) | who holds the operator role, review |
| 8.5 Secure authentication | yes, once set | passkeys, TOTP, OIDC and SAML sign-in, SCIM (`aimeat/src/services/passkeys.ts`, `aimeat/src/services/totp.ts`, `aimeat/src/services/saml-sp.ts`, [Organisation node sign-in](../organisation-node-sign-in.md)); two-step sign-in can be required for operators or everyone (`AIMEAT_TWO_STEP_REQUIRED`, default `off`) and password sign-in limited to operators or turned off (`AIMEAT_PASSWORD_SIGN_IN`) (`aimeat/src/services/sign-in-policy.ts`). On an IdP sign-in the MFA is the IdP's, and the node does not check it ([04 Identity and access](04-identity-access.md)) | set both settings; enforce MFA at the identity provider |
| 8.8 Technical vulnerabilities | partial | `.github/SECURITY.md`, dependency review and vulnerability scan workflows (`.github/workflows/vulnerability-scan.yml`, `.github/workflows/dependency-review.yml`) | patch the node, its host and dependencies ([12 Updates and releases](12-updates-releases.md)) |
| 8.9 Configuration management | partial | settings schema, start-up posture check that warns on unsafe settings (`aimeat/src/config/posture.ts`), settings changes in the operator trail without values | keep `.env` under change control |
| 8.12 Data leakage prevention | partial | classification exits, AI provider allowlist and type list, egress guard on server-side fetches ([06 AI and models](06-ai-and-models.md)) | network egress control |
| 8.13 Information backup | no | the node makes no backups ([Backup and restore](../operations/backup-and-restore.md)) | back up database, `.env` and key file; test restores |
| 8.15 Logging | partial | account events, classification audit, consent audit, AI usage, provenance, security incidents (`aimeat/src/services/security-incident.ts`, [10 Logging and monitoring](10-logging-monitoring.md)) | central log collection and retention |
| 8.16 Monitoring activities | partial | metrics endpoint (`aimeat/src/middleware/metrics.ts`, `AIMEAT_METRICS_ACCESS`), admin Security page ([Observability guide](../../aimeat/docs/observability-guide.md)) | SIEM, alerting |
| 8.24 Use of cryptography | partial | AES-256-GCM for secrets (`aimeat/src/services/encryption.ts`), Ed25519 signatures for federation and tokens (`aimeat/src/auth/node-keys.ts`) | TLS, key custody, disk encryption |
| 8.25 Secure development life cycle | partial | security invariants ([Security DNA](../coding-guidelines/security-development-dna.md)), gates before merge | own acceptance of releases |
| 8.26 Application security requirements | partial | [Threat model](../security/threat-model.md), [Verification matrix](../security/verification-matrix.md) | requirements for the organisation's apps on the node |
| 8.27 Secure architecture | partial | node processes behind a proxy, storage interface, egress guard, separate nodes per unit or partner ([02 Architecture](02-architecture.md), [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md)) | network zoning ([DMZ architecture](../aimeat-dmz-architecture.md)) |
| 8.28 Secure coding | partial | CodeQL (`.github/workflows/codeql.yml`), security ratchet files such as `aimeat/security/route-scope-exemptions.json` | review of own extensions and apps |

## NIS2 Article 21 risk management measures

Directive (EU) 2022/2555, Article 21(2) ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2022/2555/oj)). The node can answer the NIS2 scope questions as a framework set (`aimeat/src/data/compliance-frameworks.ts`).

| Measure | AIMEAT support | How (source) | Organisation's responsibility |
|---|---|---|---|
| (a) risk analysis and information system security policies | partial | [Threat model](../security/threat-model.md), [08 Threat model](08-threat-model.md) | own risk analysis ([risk assessment template](templates/risk-assessment.md)) |
| (b) incident handling | partial | security incidents on the admin Security page, breach register ([Incident response](../security/incident-response.md)) | incident process, reporting to the CSIRT |
| (c) business continuity, backup, disaster recovery, crisis management | no | the node makes no backups | backups, DR, RTO and RPO ([11 Backup and recovery](11-backup-recovery.md)) |
| (d) supply chain security | partial | `THIRD-PARTY-NOTICES.md`, dependency review workflow; processors register for model providers | supplier assessment, including the model providers |
| (e) security in acquisition, development and maintenance, vulnerability handling and disclosure | partial | `.github/SECURITY.md`, CodeQL, vulnerability scan | patching ([12 Updates and releases](12-updates-releases.md)) |
| (f) assessing the effectiveness of measures | partial | compliance report with gaps, [Verification matrix](../security/verification-matrix.md) | internal audit |
| (g) cyber hygiene and training | no | none in the node | training |
| (h) cryptography and encryption | partial | AES-256-GCM for secrets, Ed25519 signatures | TLS, disk and database encryption |
| (i) human resources security, access control, asset management | partial | roles, scopes, SCIM deprovisioning ([Organisation node sign-in](../organisation-node-sign-in.md)) | joiner, mover and leaver process |
| (j) multi-factor authentication, secured communications, emergency communications | partial | TOTP and passkeys, SSO; MFA can be required on the node itself (`AIMEAT_TWO_STEP_REQUIRED`, default `off`; `aimeat/src/services/sign-in-policy.ts`). Nothing in the node covers emergency communications | set `AIMEAT_TWO_STEP_REQUIRED`; enforce MFA at the identity provider; emergency channels |

## What the operator fills in at adoption

| Item | Where in AIMEAT | What to record | Template |
|---|---|---|---|
| Controller identity | `AIMEAT_OPERATOR_*` variables in `aimeat/.env.example`; `/v1/privacy` answers 503 until set | the legal entity, the operator type (`AIMEAT_OPERATOR_TYPE`, default `natural_person`), business ID, DPO contact, data protection authority (`AIMEAT_OPERATOR_SUPERVISORY_NAME`) | [Organisation profile](templates/organization-profile.md) |
| AI Act authority and Code of Practice | `AIMEAT_AI_SUPERVISORY_NAME`, `AIMEAT_AI_SUPERVISORY_URL`, `AIMEAT_AI_COP_SECTIONS`, `AIMEAT_AI_COP_SIGNED_ON` | the market surveillance authority, which differs from the data protection authority; the sections signed | |
| Records of processing | admin Compliance page, `aimeat_compliance_register_write` | complete the drafts; add each organism's and app's processing | [Processing record](templates/processing-record.md) |
| Processors and sub-processors | `processors` part | hosting, database and object store provider, mail relay, each AI model provider and region, the decision provider; contract, country, transfer basis, DPA | |
| DPIAs | `dpias` part | for every data domain or AI use that needs one | [Risk assessment](templates/risk-assessment.md) |
| Transfers outside the EU | `processors` and the register's `transfers` | OpenRouter: the `eu` region still keeps account, billing and security records in the United States (SCC); `us` and `any` need SCC ([OpenRouter region](../operations/openrouter-region.md)). Each direct model provider's region. The decision provider's default address is in the United States (`AIMEAT_DECIDE_BASE_URL`) | |
| AI uses | register of AI uses | each use case, answered questionnaire, reviewed result | [Application register entry](templates/application-register-entry.md) |
| Framework answers | `frameworks` part | GDPR, NIS2 and others that apply | [Regulated sector addendum](templates/regulated-sector-addendum.md) |

## Limits

- AIMEAT is not certified against any standard and the repository holds no external audit or attestation.
- The node checks compliance documents against its own records only; it cannot check them against the world, and every verdict says it is not legal advice.
- The risk questionnaire and framework sets are engineering aids; the classification is the organisation's own determination.
- No mechanism was found for GDPR Art. 21 (objection). For Art. 19, the node takes erased or deleted records back from federation peers, but no notice for a rectification was found (`aimeat/src/services/memory-replication.ts`).
- Restriction of processing (Art. 18) is limited to an operator disabling the whole account.
- Nothing in the node covers AI literacy (AI Act Art. 4) or staff training (NIS2 21(2)(g)).
- The node makes no backups, so ISO 8.13 and NIS2 21(2)(c) are entirely the organisation's.
- Multi-factor authentication on the node itself is mandatory only once `AIMEAT_TWO_STEP_REQUIRED` is set; the default is `off`. On an IdP sign-in the node relies on the IdP's MFA and does not check it (`aimeat/src/services/sign-in-policy.ts`).
- Memory records, workspace content, messages and files are not encrypted at rest by the node.
- The processors list the node derives names the node's own AI providers (one per OpenRouter region), people's own OpenRouter keys, the SMTP host and the hosting provider; it does not name the decision provider (System 1) or an outside file store, which the operator adds by hand (`aimeat/src/services/compliance/derived.ts`).

## Open questions

- OPEN: Has any organisation completed a DPIA or an ISO 27001 statement of applicability for an AIMEAT deployment that the project can reference? The maintainer can answer.
- OPEN: Is a notice to recipients planned for a rectification, and for an erasure outside federation (GDPR Art. 19)? Federation peers already receive a retraction for a deleted or erased record. The maintainer can answer.
