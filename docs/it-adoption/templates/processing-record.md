# Template: record of processing activities (GDPR Article 30)

> Checked against AIMEAT node 4.2.0 (commit e2be032fb) on 2026-11-04. Maintained with the code: see the README for how.

## How to use

Article 30(1) of the GDPR lists what a controller's record must contain: the controller and its contacts, the purposes, the categories of data subjects and of personal data, the recipients, transfers to third countries with their safeguards, the time limits for erasure where possible, and a general description of the security measures ([Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). The node drafts most of this from what it holds: open the admin Compliance page (`/v1/admin?tab=compliance`) or ask an operator's AI for `aimeat_compliance_register_read` with part `registers_draft`, review each draft, and store it with `aimeat_compliance_register_write` ([data classification](../../data-classification.md), "Records of processing"). This template carries the same drafts so you can review them on paper first or keep the record in your own register; the stored version on the node is the one the node checks against its data maps, labels and deadlines. A field marked `[ORGANIZATION]` is a decision the node cannot make for you. The node checks the record against its own data and cannot check it against the world (`aimeat/src/services/compliance/processing.ts`, limit `registers-are-statements`).

## Part A: controller

| Article 30(1)(a) field | Answer | Source |
|---|---|---|
| Controller name and contact | [ORGANIZATION] *Legal name, address, privacy email; the node reads them from the operator settings.* | `AIMEAT_OPERATOR_NAME`, `AIMEAT_OPERATOR_EMAIL`, `aimeat/src/services/compliance/derived.ts` |
| Joint controller | [ORGANIZATION] *Name and contact, or "none".* | |
| Representative in the EU | [ORGANIZATION] *Only for a controller established outside the EU.* | |
| Data protection officer | [ORGANIZATION] *"Name, email", or "not appointed".* | `AIMEAT_OPERATOR_DPO_CONTACT` |
| When an organism or an app keeps its own record | An organism (a shared space with members and workspaces) keeps its record through its creator or an admin; an app through its owner; the operator reads all of them | [Data classification](../../data-classification.md), "Records of processing" |

## Part B: processing activities the node drafts on every installation

The five registers below are drafted for the installation with the operator as controller and a review every 12 months (`aimeat/src/services/compliance/derived.ts`, `nodeRegistersDraft`). Values marked "draft" are what the node fills; confirm or change each.

### B1. User accounts

| Field | Value | Source |
|---|---|---|
| Purpose | Running the service (draft) | `nodeRegistersDraft`, id `node-accounts` |
| Legal basis, Article 6(1) | Contract (draft) | same |
| Data subjects | Account holders (draft) | same |
| Personal data | Account name, email address, password hash, profile, sign-in methods (draft) | same |
| Source | The person, at registration (draft) | same |
| Recipients | [ORGANIZATION] *Usually none outside the operator; add the SMTP relay if sign-in emails go through an outside provider.* | Part C |
| Retention | Until the account is deleted; the person deletes it on their profile (draft) | same |
| Security measures | See Part D | |

### B2. Sign-in and security log

| Field | Value | Source |
|---|---|---|
| Purpose | Running the service (draft) | `nodeRegistersDraft`, id `node-security-log` |
| Legal basis | Legitimate interests (draft); [ORGANIZATION] *record the balancing test.* | same |
| Data subjects | Account holders; visitors who try to sign in (draft) | same |
| Personal data | Account name, IP address, time, refused requests (draft) | same |
| Source | The node, when a request is made (draft) | same |
| Retention | [ORGANIZATION] *The draft states none. The refusal log file rotates at a size ceiling and keeps one older generation (`aimeat/src/services/auth-audit.ts`); add your log platform's retention.* | Open question below |

### B3. Consent ledger

| Field | Value | Source |
|---|---|---|
| Purpose | Running the service (draft) | `nodeRegistersDraft`, id `node-consent` |
| Legal basis | Legal obligation (draft) | same |
| Data subjects | Account holders (draft) | same |
| Personal data | Who granted what to whom, when, when revoked (draft) | same |
| Retention | From `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS`, 365 days unless set (draft, in months) | `aimeat/src/config-data-access.ts` |

### B4. AI usage ledger

| Field | Value | Source |
|---|---|---|
| Purpose | Running the service (draft) | `nodeRegistersDraft`, id `node-ai-usage` |
| Legal basis | Contract (draft) | same |
| Data subjects | Account holders and their agents (draft) | same |
| Personal data | Who called which model, tokens, cost, time (draft) | same |
| Retention | [ORGANIZATION] *The draft states none.* | Open question below |

### B5. Content people keep in their own account

| Field | Value | Source |
|---|---|---|
| Purpose | Running the service (draft) | `nodeRegistersDraft`, id `node-user-content` |
| Legal basis | Contract (draft) | same |
| Data subjects | Account holders (draft) | same |
| Personal data | What the person writes, saves and generates in apps only they and their own agents can read (draft) | same |
| Special categories | [ORGANIZATION] *Whether people may store them; if yes, the Article 9(2) basis.* | Regulated domains: `aimeat/src/data/compliance-domains.ts` |
| Retention | Until the person deletes it or their account (draft). A deleted record stays restorable for `AIMEAT_MEMORY_DELETE_GRACE_DAYS` (7 unless set) and in older backups until they expire | same, `aimeat/.env.example`, [backup and restore](../../operations/backup-and-restore.md) |

## Part C: activities drafted per organism and per app

| Activity | What the node drafts | Source | Your part |
|---|---|---|---|
| Members of each organism | Controller role; contract; members and invited people; account name, role, membership status, invitations; kept while the membership lasts and until the organism is deleted; the organism itself as the one container (its workspaces are not listed) | `aimeat/src/services/compliance/derived.ts` (`organismRegisterDraft`) | [ORGANIZATION] *For each organism: who is controller (your organisation, a unit, a partner), and a register per workspace that holds personal data.* |
| Each app whose personal data someone other than its user can read, or that keeps regulated data | Purpose from the app's data map; the data families the map marks as personal; recipients from what the map says leaves; retention when the map says "until deleted"; regulated domains stated or proposed | `aimeat/src/services/compliance/derived.ts` (`appRegisterDraft`) | [ORGANIZATION] *The app owner confirms purpose, legal basis and retention. An app with no data map has no draft, and the report names it as a gap.* |
| People registered to an app without an account | Controller role; email address, display name, role in the app, what each person keeps in the app; kept until the person or the owner removes the registration | `aimeat/src/services/compliance/register-drafts.ts` (`appPartiesRegister`) | [ORGANIZATION] *Legal basis and the notice those people see.* |

The Compliance page counts the node's and each app's drafts beside the stored registers until each is reviewed and stored (`aimeat/src/services/compliance/register-drafts.ts`); an organism's draft is read with `aimeat_compliance_register_read`, scope `organism`, part `registers_draft` (`aimeat/src/services/compliance/docs-ops.ts`).

## Part D: recipients, processors and transfers

The node lists as processors the AI providers whose prompts leave the server, the SMTP relay and the hosting, from its configuration; you add the contract, the country and the transfer basis to each (`aimeat/src/services/compliance/derived.ts`, `derivedProcessors`). Every processor outside the EU/EEA, or with no country written, is listed as a transfer (`transfersOf`).

| Recipient | When it receives data | Node's draft | Your part |
|---|---|---|---|
| OpenRouter, region `eu` | Prompts and answers, when the node's own key sends there | Processor `ai-node-openrouter-eu`, country and basis `adequacy`: processing in the EU/EEA, or the United Kingdom or Switzerland under adequacy decisions; OpenRouter keeps account, billing and security records in the United States under the SCC in its agreement | [ORGANIZATION] *Agreement reference and date.* [OpenRouter region](../../operations/openrouter-region.md) |
| OpenRouter, region `us` | as above | Processor `ai-node-openrouter-us`, United States, basis `scc` | [ORGANIZATION] *Agreement reference; transfer impact assessment.* |
| OpenRouter, region `any` | as above | Processor `ai-node-openrouter`, any country, basis `scc` | [ORGANIZATION] *Agreement reference; transfer impact assessment.* |
| Each person's own OpenRouter key (region mode `own`) | Prompts and answers on that person's key | Processor `ai-person-openrouter`, under each person's own agreement | [ORGANIZATION] *Your position: whether staff may use their own keys for work data.* |
| Other model providers | Prompts and answers on providers the operator configured | One processor per provider, with its host | [ORGANIZATION] *Name, country, agreement, basis.* `AIMEAT_AI_PROVIDERS` |
| Local models | Nothing leaves the server when the model is at a loopback address; an operator provider at an internal origin listed in `AIMEAT_AI_PROVIDER_EGRESS` also counts as local, although data crosses the network to it | Not listed: a provider the node counts as local is not a processor (`aimeat/src/services/ai/providers.ts`) | [ORGANIZATION] *Name any internal model host as a recipient yourself.* |
| Email provider | Recipient addresses and message content of mail the node sends | Processor `email-smtp` when `AIMEAT_SMTP_HOST` is set | [ORGANIZATION] *Provider, country, agreement.* |
| Hosting provider | Everything on the server | Processor `hosting` when `AIMEAT_OPERATOR_HOSTING_NAME` is set, with `AIMEAT_OPERATOR_HOSTING_LOCATION` as country | [ORGANIZATION] *Agreement reference.* |
| Federation peers | Only with federation on, and only what a person shares and its label allows | Not a processor and not recorded as a transfer: a copy for another node is stopped only when its label may not leave the organism; content without such a label, which is all content while classification is off, goes to peers unrecorded (`aimeat/src/services/compliance/processing.ts`, limit `federation-peers-not-processors`) | [ORGANIZATION] *Whether you federate; if so, each peer's operator and the agreement with it.* [Federation](../../operations/federation.md) |
| Payment providers | Payment data, when a seller on the node takes payments | Not drafted: each seller uses their own Stripe account and keys; the node needs no Stripe setting of its own ([bookkeeping](../../operations/bookkeeping.md)) | [ORGANIZATION] *Whether selling is allowed on your node.* |
| Outside mail accounts a person connects | Mail the person's agent reads or sends | Not drafted | [ORGANIZATION] *Whether staff may connect them.* [Connecting an outside account](../../connecting-an-outside-account.md) |

## Part E: security measures (Article 30(1)(g))

| Measure | Where it is described |
|---|---|
| Data protection, encryption of secrets, export and erasure | [05 Data protection](../05-data-protection.md) |
| Sign-in protections, authorisation, audit and hardening | [07 Security](../07-security.md), [09 Hardening guide](../09-hardening-guide.md) |
| Classification and its audit, when switched on | [Data classification](../../data-classification.md) |
| The node's own statement of its measures, as Annex III of a generated data processing agreement | `aimeat_compliance_agreement` |
| Measures of the server, network and backups | [ORGANIZATION] *Reference to your own security documentation.* |

## Part F: review

| Field | Answer |
|---|---|
| Record reviewed by | [ORGANIZATION] *Name and role.* |
| Date | [ORGANIZATION] *Date; the node sets the next review 12 months later for its drafts.* |
| DPIA needed | [ORGANIZATION] *Yes or no per activity. The node reports a missing DPIA as a gap where a register names a domain that needs one (`aimeat/src/data/compliance-domains.ts`).* |
| Open gaps on the node | [ORGANIZATION] *Count from `GET /v1/compliance/gaps`, and the plan for each.* |

## Open questions

- OPEN: How long does the node keep the sign-in and security log and the AI usage ledger in its database, and is either one pruned by a scheduled job? The node's drafts for `node-security-log` and `node-ai-usage` state no retention (`aimeat/src/services/compliance/derived.ts`). The maintainer named in `.github/SECURITY.md` can answer.
