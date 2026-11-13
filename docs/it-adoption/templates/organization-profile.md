# Template: organisation profile

> Checked against AIMEAT node 4.2.0 (commit 959664aab) on 2026-11-02. Maintained with the code: see the README for how.

## How to use

Fill this profile first: the other templates and the numbered pages refer to it. A field marked `[ORGANIZATION]` is yours to answer; the italic line after it says what to write. Every other value is what AIMEAT itself determines, with its source, so you check it rather than write it. Where a field names an environment variable, the answer you give here is also the value you set in the node's `.env` (format and defaults in [`.env.example`](../../../aimeat/.env.example) and [configuration reference](../../b-config.md)); several of them are published by the node on its privacy page and in the records of processing, so a wrong value here becomes a wrong statement to the people who use the node.

## 1. Organisation and legal entities

| Field | Answer | Source or note |
|---|---|---|
| Organisation (legal name) | [ORGANIZATION] *Name as in the trade register, e.g. "Example Ltd".* | Goes into `AIMEAT_OPERATOR_NAME` |
| Business ID | [ORGANIZATION] *Company number or VAT id; empty only for a natural person.* | `AIMEAT_OPERATOR_BUSINESS_ID` |
| Operator type | [ORGANIZATION] *One of natural_person, company, organisation, association.* | `AIMEAT_OPERATOR_TYPE` |
| Registered address and country | [ORGANIZATION] *Street, postcode, city, country.* | `AIMEAT_OPERATOR_ADDRESS`, `AIMEAT_OPERATOR_COUNTRY` |
| Other legal entities whose people use the node | [ORGANIZATION] *Each subsidiary or partner, and whether it signs a data processing agreement with the operator.* | Template: [data processing agreement](../../data-processing-agreement-template.md); the node also generates one (`aimeat_compliance_agreement`) |
| Role of the operator under GDPR | [ORGANIZATION] *Controller for your own staff; processor when another entity brings its people.* | [Data processing agreement template](../../data-processing-agreement-template.md), "Why this exists" |

## 2. Operator and contacts

| Field | Answer | Source or note |
|---|---|---|
| System owner | [ORGANIZATION] *Person accountable for the service, with role and email.* | |
| Technical administrator(s) | [ORGANIZATION] *Who holds the operator role on the node and shell access to the server.* | The operator role: [04 Identity and access](../04-identity-access.md) |
| Privacy contact | [ORGANIZATION] *Mailbox the node publishes for data protection questions.* | `AIMEAT_OPERATOR_EMAIL` |
| Data protection officer | [ORGANIZATION] *"Name, email", or "not appointed".* | `AIMEAT_OPERATOR_DPO_CONTACT` |
| Security contact | [ORGANIZATION] *Mailbox for security reports about this installation; defaults to the privacy contact.* | `AIMEAT_OPERATOR_SECURITY_EMAIL` |
| Signer of data processing agreements | [ORGANIZATION] *Name and role, e.g. "CEO".* | `AIMEAT_OPERATOR_SIGNER_NAME`, `AIMEAT_OPERATOR_SIGNER_ROLE` |
| Supervisory authority | [ORGANIZATION] *Name and URL of the data protection authority for the operator.* | `AIMEAT_OPERATOR_SUPERVISORY_NAME`, `AIMEAT_OPERATOR_SUPERVISORY_URL` |
| Upstream project security contact | Fixed: the maintainer named in `.github/SECURITY.md` | Reports about AIMEAT itself, not about your installation |

The operator name and email feed the controller field of the node's own register drafts (`aimeat/src/services/compliance/derived.ts`).

## 3. Installation environment

| Field | Answer | AIMEAT fact and source |
|---|---|---|
| Hosting model | [ORGANIZATION] *On-premises, private cloud or public cloud, and the provider.* | AIMEAT needs no vendor-hosted component; it is one Node.js process ([02 Architecture](../02-architecture.md)) |
| Hosting provider and location | [ORGANIZATION] *Provider name and country, e.g. "own data centre, Finland".* | `AIMEAT_OPERATOR_HOSTING_NAME`, `AIMEAT_OPERATOR_HOSTING_LOCATION`; the node lists the hosting as a processor when set (`aimeat/src/services/compliance/derived.ts`) |
| Installation method | [ORGANIZATION] *npm package, from source, Docker, or systemd unit.* | npm, source and Docker: [upgrading](../../operations/upgrading.md); unit file `aimeat/deploy/aimeat.service`; images `aimeat/Dockerfile`, `aimeat/docker-compose.yml` |
| Operating system | [ORGANIZATION] *Distribution and version, e.g. "Ubuntu 24.04 LTS".* | The unit file assumes Linux with systemd and libjemalloc2 (`aimeat/deploy/aimeat.service`) |
| Node.js runtime | [ORGANIZATION] *Installed version; must satisfy the engines field.* | Node.js 24.22.1 or newer (`aimeat/package.json`, `engines`) |
| Database | [ORGANIZATION] *PostgreSQL version and where it runs, or SQLite file path.* | `AIMEAT_STORAGE` is `postgres-kysely` (production) or `sqlite`; never the in-memory store in production ([deployment checklist](../../security/deployment-checklist.md)). PostgreSQL via `DATABASE_URL`, SQLite via `AIMEAT_SQLITE_PATH`. Stored files are inside the database unless `AIMEAT_FILE_STORE` names an S3 bucket or an Azure container ([backup and restore](../../operations/backup-and-restore.md#what-a-node-is)) |
| Public address | [ORGANIZATION] *HTTPS URL people use, e.g. https://aimeat.example.com.* | `AIMEAT_BASE_URL` |
| App host (wildcard name) | [ORGANIZATION] *apps.<your domain>, with a wildcard DNS record and certificate, or "apps not served on own origin".* | `AIMEAT_APP_HOST`, `AIMEAT_APP_ORIGIN_ENABLED`; [production deployment](../../operations/production-deployment.md) |
| Reverse proxy and TLS | [ORGANIZATION] *Product (nginx, Caddy, a load balancer) and who manages the certificate.* | The node speaks plain HTTP on port 40050 behind the proxy; set `AIMEAT_TRUST_PROXY` for the real proxy path ([deployment checklist](../../security/deployment-checklist.md)) |
| Security profile | [ORGANIZATION] *public for anything reachable from outside the organisation's network; local otherwise.* | `AIMEAT_SECURITY_PROFILE`; on `public` the node logs a warning for each unsafe setting at start (`aimeat/.env.example`, "Startup self-check") |
| Where the secrets are kept | [ORGANIZATION] *`.env` file, process manager, or secret store; who can read it.* | `AIMEAT_ENCRYPTION_KEY`, `AIMEAT_KEY_PASSPHRASE`, node key at `AIMEAT_NODE_KEY_PATH` ([backup and restore](../../operations/backup-and-restore.md)) |
| Federation with other nodes | [ORGANIZATION] *standalone (no other nodes), or which peers and why.* | `AIMEAT_FEDERATION_ROLE`, `standalone` in `aimeat/.env.example`; [federation](../../operations/federation.md) |
| Outbound network allowed | [ORGANIZATION] *Egress allowlist: model provider, SMTP relay, registry.npmjs.org and unpkg.com for the update check, the EU trusted lists and certificate issuers (OCSP, CRL, issuer certificates) for signature checks.* | Update check `AIMEAT_UPDATE_CHECK`, or a mirror with `AIMEAT_UPDATE_CHECK_SOURCE` (`aimeat/src/services/node-update-check.ts`); signature checks fetch online `AIMEAT_DOCSIGN_ONLINE_CHECKS`, on by default (`aimeat/src/services/config/schema-docsign.ts`, [document signing](../../document-signing.md)); private-address egress off `AIMEAT_ALLOW_PRIVATE_EGRESS` |

## 4. Identity provider and sign-in

| Field | Answer | AIMEAT fact and source |
|---|---|---|
| Who may get a new account | [ORGANIZATION] *open, oauth, invite or closed. An organisation node usually takes oauth or invite.* | `AIMEAT_REGISTRATION_MODE`, default `open` (`aimeat/.env.example`) |
| Identity provider | [ORGANIZATION] *Microsoft Entra ID (OIDC), a SAML 2.0 IdP, or local accounts only.* | Entra: `AIMEAT_ENTRA_OAUTH_ENABLED`, off by default. SAML and SCIM: `AIMEAT_SSO_ENABLED`, off by default. [Organisation node sign-in](../../organisation-node-sign-in.md) |
| Allowed Entra tenants | [ORGANIZATION] *Directory (tenant) GUIDs of your organisation and approved partners.* | `AIMEAT_ENTRA_ALLOWED_TENANTS`, `AIMEAT_ENTRA_LINK_DOMAINS` |
| Provisioning and deprovisioning | [ORGANIZATION] *SCIM from the IdP, or a manual leaver process.* | SCIM token per SSO connection: `aimeat_admin_sso_scim_token` |
| Second factor for local accounts | [ORGANIZATION] *Policy: TOTP or passkey required for operators and for everyone.* | TOTP `AIMEAT_TOTP_ENABLED` (`aimeat/src/services/totp.ts`); passkeys, on unless `AIMEAT_PASSKEY_ENABLED` is false, with the relying party ID from `AIMEAT_PASSKEY_RP_ID` or the host of the public address (`aimeat/src/config/types-account-security.ts`). `AIMEAT_TWO_STEP_REQUIRED` (`off`, `operators`, `everyone`) makes the node require it; a passkey or an IdP sign-in satisfies it, and the IdP's MFA is enforced in the IdP. `AIMEAT_PASSWORD_SIGN_IN` (`on`, `operators`, `off`) decides who may use a password (`aimeat/src/services/sign-in-policy.ts`) |
| Do people see each other by default | [ORGANIZATION] *true on a company node where everyone is a colleague; false otherwise.* | `AIMEAT_MEMBERS_SEE_EACH_OTHER`, default false |

## 5. Model providers

| Field | Answer | AIMEAT fact and source |
|---|---|---|
| Who pays for AI | [ORGANIZATION] *The node's own key, each person's own key, or both.* | Node key `AIMEAT_OPENROUTER_INSTANCE_KEY`, empty by default; with it empty everyone brings their own key (`aimeat/.env.example`) |
| Region of the node's OpenRouter key | [ORGANIZATION] *eu, us or any, and the fallback.* | `AIMEAT_AI_OPENROUTER_REGION` (default `any`), `AIMEAT_AI_OPENROUTER_REGION_FALLBACK` (default `us`); `AIMEAT_AI_REGION_MODE` overrides both; [OpenRouter region](../../operations/openrouter-region.md) |
| Other providers | [ORGANIZATION] *Each provider, its base URL and its data processing agreement.* | Operator records `AIMEAT_AI_PROVIDERS`; vendor types reach only fixed addresses, narrowed with `AIMEAT_AI_PROVIDER_TYPES` (`aimeat/src/services/ai/providers.ts`) |
| Local models on the server | [ORGANIZATION] *lmstudio, ollama, llamacpp, or none.* | `AIMEAT_AI_BUILTIN_PROVIDERS`; a provider counts as local at a loopback address, or, for a provider the operator configures, at an internal origin listed in `AIMEAT_AI_PROVIDER_EGRESS`, although the data then crosses the network (`aimeat/src/services/ai/providers.ts`) |
| Hosts an AI base URL may point at | [ORGANIZATION] *Comma-separated host allowlist.* | `AIMEAT_AI_PROVIDER_ALLOWLIST`; empty triggers a startup warning on a public node (`aimeat/.env.example`) |
| Email relay | [ORGANIZATION] *SMTP host, port, and whether it is an outside provider.* | `AIMEAT_SMTP_HOST`; listed as a processor when set (`aimeat/src/services/compliance/derived.ts`); [bookkeeping, email delivery](../../operations/bookkeeping.md) |

Detail and the transfer consequences: [06 AI and models](../06-ai-and-models.md).

## 6. Classification scheme

Classification is off on a new node (`AIMEAT_CLASSIFICATION`, values `off`, `owner`, `all`; [data classification](../../data-classification.md)). Mark the scheme your organisation will use.

| Scheme | In use | AIMEAT fact and source |
|---|---|---|
| AIMEAT's four levels: Public, Internal, Confidential, Highly confidential | [ORGANIZATION] *yes or no; map each of your own classes to one level.* | Levels and what each allows: [data classification](../../data-classification.md), "Levels"; defaults `aimeat/src/services/classification/defaults.ts` |
| Your own labels inside those levels | [ORGANIZATION] *Label names, the level each sits in, and who may read it.* | Labels with an audience and detection rules, at node, owner or organism level (`aimeat/src/services/classification/levels.ts`) |
| Finnish security classes (TL IV to TL I) | [ORGANIZATION] *yes or no, and the highest class switched on (upTo).* | Pack `tl` (`aimeat/src/data/classification-packs.ts`) |
| NATO classes (NATO RESTRICTED to COSMIC TOP SECRET) | [ORGANIZATION] *yes or no, and the highest class switched on.* | Pack `nato` (`aimeat/src/data/classification-packs.ts`) |
| Accreditation of this installation | [ORGANIZATION] *Accreditation decision and authority, or "not accredited".* | The packs mark and restrict content; they do not make the node an accredited system (`aimeat/src/services/compliance/processing.ts`, limit `not-accredited`) |

## 7. Applicable regulations

The node carries question sets for eight of the regulations below (GDPR, NIS2, DORA, Cyber Resilience Act, European Accessibility Act, Digital Services Act, HIPAA, export control) and reads an unanswered set as unclassified, never as "does not apply" (`aimeat/src/data/compliance-frameworks.ts`). The AI Act row belongs to the AI use-case register (`aimeat_compliance_register_read`, part `usecases`); sector rules and national law have no question set. Mark each one and keep the answers on the admin Compliance page (`aimeat_compliance_register_write`, part `frameworks`).

| Regulation | Applies | Who decided, and when |
|---|---|---|
| GDPR (Regulation (EU) 2016/679) | [ORGANIZATION] *yes or no, and whether a DPO is required.* | [ORGANIZATION] *Name, date.* |
| NIS2 and national implementation | [ORGANIZATION] *not in scope, important entity or essential entity.* | [ORGANIZATION] *Name, date.* |
| DORA (Regulation (EU) 2022/2554) | [ORGANIZATION] *not in scope, financial entity, or ICT third-party provider.* | [ORGANIZATION] *Name, date.* |
| Cyber Resilience Act | [ORGANIZATION] *Usually relevant only if you place AIMEAT on the market as a product.* | [ORGANIZATION] *Name, date.* |
| European Accessibility Act | [ORGANIZATION] *yes if the node offers a covered service to consumers.* | [ORGANIZATION] *Name, date.* |
| Digital Services Act | [ORGANIZATION] *yes if the node hosts content for the public.* | [ORGANIZATION] *Name, date.* |
| EU AI Act (Regulation (EU) 2024/1689), Article 50 transparency | [ORGANIZATION] *yes if AI-generated content is published.* | Platform mechanism: [AI transparency](../../ai-transparency.md) |
| HIPAA (United States) | [ORGANIZATION] *yes or no.* | [ORGANIZATION] *Name, date.* |
| Export control (ITAR, EAR, EU dual-use) | [ORGANIZATION] *yes or no.* | [ORGANIZATION] *Name, date.* |
| Sector rules (medical devices, GMP, finance, public sector) | [ORGANIZATION] *List them; then fill the [regulated-sector addendum](regulated-sector-addendum.md).* | [ORGANIZATION] *Name, date.* |
| National law on public-sector information management | [ORGANIZATION] *For a Finnish public body: Act 906/2019 and its classification decree.* | [ORGANIZATION] *Name, date.* |
