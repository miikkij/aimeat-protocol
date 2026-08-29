<!--
@file data-processing-agreement-template.md
@description A starting point for the Article 28 data processing agreement a node operator signs with
  an organisation whose people use their node. Written for whoever runs an AIMEAT node, not for
  aimeat.io specifically: the placeholders are the parts that differ per operator, and the annexes
  describe what this software actually does so the operator is not left inventing it.

  THIS IS A DRAFT, NOT LEGAL ADVICE. It is a checklist in contract form: it collects the elements
  Article 28(3) requires and fills in the technical facts the software determines. Have a lawyer in
  your own jurisdiction review it before you sign anything. Where it is wrong for your deployment,
  your deployment wins.
@version-history
  v1.0.0 — 2026-08-29 — Initial. Written during the legal-document audit, which found the node
    supports organisation sign-in (Entra/SAML + SCIM) and shared workspaces with no processor
    agreement anywhere in the repository or on the site.
-->

# Data processing agreement: a template for node operators

## Why this exists

When a person signs up on their own and puts their own material into their own account, the node
operator is the **controller** for that, and the privacy policy plus the terms of service cover it.

It changes when an **organisation** brings its people. The organisation decides that its employees
will work on this node, and it answers to them and to its regulator for what happens to their data.
The operator then handles that data **on the organisation's behalf**, which makes the operator a
**processor**, and Article 28(3) of the GDPR requires a written contract between the two before the
processing starts.

A one-sided document cannot be that contract. Terms of service are written and changed by one party;
this needs two signatures. That is the whole reason it is a separate file.

**On an AIMEAT node this situation arises when:** the operator enables organisation sign-in (an Entra
or SAML tenant allowlist, `AIMEAT_REGISTRATION_MODE=oauth`), or provisions accounts through SCIM, or
hosts an organism whose members belong to one customer organisation, or runs a node on a customer's
behalf at all.

---

## How to use this file

1. Replace every `{{PLACEHOLDER}}`.
2. Read Annex II and III against your own deployment. They describe what the software does; your
   configuration decides which parts are true for you.
3. Delete what does not apply. A clause that describes something you do not do is worse than a
   missing one.
4. Have it reviewed by a lawyer. This file is a starting point, and it is not legal advice.

---

# Data Processing Agreement

**Controller:** {{CUSTOMER_LEGAL_NAME}}, {{CUSTOMER_COMPANY_NUMBER}}, {{CUSTOMER_ADDRESS}}
("the Controller")

**Processor:** {{OPERATOR_LEGAL_NAME}}, {{OPERATOR_COMPANY_NUMBER}}, {{OPERATOR_ADDRESS}}
("the Processor")

**Effective from:** {{DATE}}

This agreement forms part of {{MAIN_AGREEMENT}} (the "Main Agreement") and governs the Processor's
processing of personal data on the Controller's behalf. Where this agreement and the Main Agreement
conflict on data protection, this agreement prevails.

## 1. Subject matter, duration, nature and purpose

The Processor operates the AIMEAT node at {{NODE_URL}} and processes personal data on the
Controller's behalf so that the Controller's personnel can use it: keeping their accounts and
identities, storing what they write, running the AI agents they connect, and sharing what they choose
to share with each other.

This agreement runs for as long as the Main Agreement, and afterwards for as long as the Processor
still holds personal data on the Controller's behalf.

## 2. The Controller's instructions

The Processor processes personal data only on the Controller's documented instructions, including on
transfers to a third country, unless required otherwise by law. Where the law requires it, the
Processor informs the Controller before processing unless the law forbids telling them.

The Main Agreement and this agreement, together with the Controller's own configuration of the node,
are the Controller's complete initial instructions. Further instructions are given in writing to
{{OPERATOR_CONTACT}}.

The Processor tells the Controller without delay if an instruction appears to infringe data
protection law.

## 3. Confidentiality

Everyone the Processor authorises to process the personal data is bound by confidentiality, by
contract or by statute, and that obligation survives the end of their engagement.

## 4. Security

The Processor keeps the technical and organisational measures in **Annex III**, which meet Article 32
in light of the risk. The Processor may change a measure, provided the level of protection does not
fall.

## 5. Sub-processors

The Controller gives general authorisation for the sub-processors in **Annex II**. The Processor
tells the Controller at least {{NOTICE_DAYS}} days before adding or replacing one, and the Controller
may object on reasonable data protection grounds within that period. If the objection cannot be
resolved, either party may terminate the affected part of the Main Agreement without penalty.

Each sub-processor is bound by data protection obligations no weaker than these. The Processor stays
fully liable to the Controller for a sub-processor's performance.

## 6. Data subject rights

Taking account of the nature of the processing, the Processor assists the Controller in answering
requests from data subjects, by appropriate technical and organisational measures and as far as it
can. A request the Processor receives directly is passed to the Controller without delay and is not
answered by the Processor.

**Annex III names the mechanisms**, which are ordinary product features rather than a manual service:
the Controller's people can export and delete their own data themselves.

## 7. Assistance with Articles 32 to 36

The Processor assists the Controller, as far as it can and in light of what it knows, with security,
breach notification, breach communication to data subjects, impact assessments and prior consultation.

## 8. Personal data breaches

The Processor notifies the Controller without undue delay, and in any case within {{BREACH_HOURS}}
hours, of becoming aware of a personal data breach affecting the Controller's data, with what it
knows at the time and further detail as it emerges. The Processor does not notify a supervisory
authority or a data subject on the Controller's behalf unless instructed to.

## 9. Deletion or return at the end

At the Controller's choice, the Processor deletes or returns all personal data at the end of the
processing, and deletes existing copies, unless law requires retention. The Controller makes the
choice within {{RETURN_DAYS}} days of the end; otherwise the Processor deletes.

**Retained by law rather than by choice:** accounting records that {{ACCOUNTING_LAW}} requires the
Processor to keep, which for a Finnish operator is six years from the end of the accounting period
(Kirjanpitolaki 2:10). These are retained for that purpose only and are not otherwise processed.

Backups are deleted on their own cycle, described in Annex III, and restored data is re-deleted.

## 10. Audits and information

The Processor makes available the information needed to show compliance with Article 28, and allows
and contributes to audits, including inspections, by the Controller or an auditor it mandates.

Audits are at reasonable intervals, at most {{AUDIT_FREQUENCY}}, on {{AUDIT_NOTICE}} days' written
notice, during business hours, without unreasonable disruption, and subject to confidentiality. The
Processor may propose an independent report or certification instead where it answers the question.

**The node's own transparency is available at any time without an audit:** the source is open, the
Controller's operator account can read the node's configuration and its own audit trails, and the
AI-use register at `/v1/ai-transparency` is public.

## 11. International transfers

The Processor does not transfer the Controller's personal data outside the EEA except as named in
Annex II, and where it does, on a transfer mechanism valid under Chapter V of the GDPR.

**A transfer the Controller's own people can start:** if they connect their own AI provider key or
their own outside account, their requests go to that provider under their own arrangement with it.
The Processor is not a party to that and it is not a transfer by the Processor. Annex I lists which
of these the Controller has enabled.

## 12. Liability and term

Liability follows the Main Agreement. This agreement ends when the Main Agreement ends and the
Processor no longer holds personal data on the Controller's behalf, except for clauses that by nature
survive.

**Signatures**

| | Controller | Processor |
|---|---|---|
| Name | | |
| Title | | |
| Date | | |
| Signature | | |

---

# Annex I: what is processed

**Categories of data subject.** {{e.g. the Controller's employees, contractors and the AI agents they
connect in their own name; people they correspond with through connected accounts.}}

**Types of personal data.**

| Category | What it is |
|---|---|
| Account identity | Username, display name, password hash, TOTP secret if enabled, email address, the generated identity `username@node-id` |
| Agent identity | Each connected AI agent's identity, its registered public key, the permissions approved for it |
| Content | Whatever the Controller's people write: memory entries, uploaded files, workspace documents, messages, profile fields |
| Consents | Which agent or party was granted what, and the record of every grant and revocation |
| Usage and activity | Structured events from their agents, per-account usage counts, AI provenance records for content the node generated |
| Technical | Request logs including IP address and user agent |
| Connected accounts | If enabled: the sealed credential for an outside account they connected themselves, and whatever that account holds, which may include the personal data of people who are not the Controller's personnel |
| Payments | If enabled: order records for anything bought or sold through the node |

**Special categories.** None is processed by design. The Controller's people can write anything into
their own content, so the Controller decides through its own policy whether special-category data may
be brought here at all.

**Optional capabilities and whether the Controller has enabled them:**

| Capability | Enabled | Note |
|---|---|---|
| Organisation sign-in (Entra / SAML) | ☐ | Identity provider learns of the sign-in |
| SCIM provisioning | ☐ | Account lifecycle driven from the Controller's directory |
| The node's own AI provider key | ☐ | Prompts go to that provider on the Processor's account |
| Personal AI provider keys | ☐ | Prompts go to the provider the person chose, under their own terms |
| Connected outside accounts (mail, publishing) | ☐ | Third parties' personal data may enter |
| Payments and marketplace | ☐ | Order records, and accounting retention |
| Publishing to the public internet | ☐ | Apps, portfolios and public content leave the node |
| Federation with peer nodes | ☐ | Named peers process what is explicitly shared |

---

# Annex II: sub-processors

Fill in what your deployment actually uses. An entry that is not true of your node is a false
statement in a compliance document, so delete rather than keep.

| Sub-processor | Purpose | Location | Transfer mechanism |
|---|---|---|---|
| {{HOSTING_PROVIDER}} | Server hosting, network, backups | {{HOSTING_LOCATION}} | {{e.g. within EEA}} |
| {{AI_PROVIDER}} | Model inference on the node's own key, where enabled | {{LOCATION}} | {{SCCs / adequacy / n/a}} |
| {{EMAIL}} | Transactional email, if not self-hosted | {{LOCATION}} | |
| {{OTHER}} | | | |

**Not sub-processors, and why.** A payment processor a seller brings themselves acts on that
seller's own account and is not engaged by the Processor. An outside account a person connects
themselves is theirs. Search engines that index deliberately published content are recipients of
public information, not processors.

---

# Annex III: technical and organisational measures

These describe the software. Anything your deployment configures differently is yours to correct.

**Access control and identity.** Every stored item is addressed by the identity that owns it and
every route resolves that identity from the authenticated session rather than from anything the
caller sends. Agents hold their own scoped, separately revocable credentials. Two-factor
authentication is available; the operator can require organisation sign-in and refuse everything else.

**Transport and storage.** TLS in transit. Passwords hashed with a current algorithm. Secrets such as
the credentials for connected accounts sealed with AES-256-GCM. Backups encrypted.

**Segregation.** One account cannot read another's data; this boundary has automated tests that block
a merge when they fail. Published applications run on their own origin so they cannot reach the
signed-in session. Where the Processor runs several customers, each node runs in its own isolated
container with its own encryption keys.

**Logging and audit.** Authentication failures, consent grants and revocations, operator reads of
cross-account reports, and AI provenance are recorded. Dispute records are hash-chained.

**Data subject rights, as product features.** A person exports their own data as JSON and deletes
their own account from the Data Wallet tab in their profile. The operator can do the same on request.
{{Confirm against your version that the export covers the whole account.}}

**Retention.** Server access logs {{LOG_DAYS}} days. Backups {{BACKUP_DAYS}} days, then purged.
Content until deleted by the person or with the account. Accounting records as required by law.

**Resilience and testing.** {{Describe your backup restoration testing and availability arrangements,
or say plainly that there is no availability commitment — an honest gap is better than a claim you
cannot show.}}

**Vulnerability management.** Dependency auditing and license gating in CI; a security contact at
{{SECURITY_EMAIL}}.
