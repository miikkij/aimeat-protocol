/**
 * @file compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_compliance_agreement: the node's data processing agreements
 *   (GDPR art. 28, plan doc-mvmr4i2wdk0p). One tool name with an `action`, for the reason the other
 *   compliance tools give: every name has to stay in step on three surfaces.
 * @structure complianceAgreementTools — the one definition
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   2026-10-29 — The status test-signed is named in the list action (secaudit2026oct26 round 8c).
 *   2026-10-27 — confirm takes uploaded_at, the copy reviewed (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.5).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const AGREEMENT_ACTIONS = [
  'list', 'mine', 'get', 'gaps', 'document', 'create', 'update', 'new_version', 'send', 'notice', 'object',
  'signed_copy', 'confirm', 'end', 'deletion_done', 'breach_notice',
] as const;

export const complianceAgreementTools = [
  {
    name: 'aimeat_compliance_agreement',
    description: 'Data processing agreements (GDPR art. 28) the node makes from its own data: the European Commission\'s standard contractual clauses (Decision 2021/915), printed word for word, with the four annexes filled from what the node holds: I the parties (the operator settings and the counterparty), II the processing (a register you name, or the product\'s default), III the security measures the node can read about itself (HTTPS, encryption of secrets, sign-in protections, classification, logs, export and erasure), IV the sub-processors from the processor list. READ THE AGREEMENTS BEFORE YOU TOUCH A CUSTOMER\'S DATA: they say what the operator promised. Actions. Operator (needs "compliance:read" to read and "compliance:write" to act, which no wildcard carries): action="list" every agreement with its status (draft, sent, review, signed, expired, ended, test-signed: both signed but a signature is a test wallet signature, so it is not in force; make a new version) and what it waits for; action="gaps" what they leave open (a copy waiting for you, a sub-processor taken into use and not announced, an objection, a deletion past its day, an open breach past the agreed hours); action="create" with input { counterparty: { name, businessId, address, country, contactName, contactRole, contactEmail, signerName, signerRole, account (their name@node when they have an account here) }, product: place|box|managed|custom, language: fi|en, registerId?, subject?, externalRef?, options?: { noticeDays, breachNoticeHours, deletionDays, subprocessorAuthorisation, dockingClause }, annexes?: { II, III: { measures: [{ area, text, source }] }, IV }, written_by: human|ai } makes version 1 as a draft (dry_run=true shows it first; the answer names `missing_measures`, the Annex III areas the node cannot see, for the person to write); action="update" with id and input changes the newest draft; action="new_version" drafts the next version with the node\'s data read again; action="send" fixes the draft\'s text, hash and PDF and sends it for signature, by bell and e-mail; action="notice" announces a change of only Annex III or IV under the general authorisation, which takes effect when the objection period ends; action="confirm" with accept (true or false) and reason decides a signed copy that came back; action="end" with choice delete|return starts the deletion clock and action="deletion_done" records it; action="breach_notice" with input { agreements: [ids], title, discovered_at, summary, breach_id? } tells the counterparties of a personal data breach. Counterparty, when it has an account here: action="mine" lists its agreements, action="get" reads one, action="signed_copy" with storage_key (upload first with aimeat_storage_upload) and kind pdf|scan sends a signed copy back, action="object" with reason objects to an announced change. Both: action="get" and action="document" (the canonical text of a version; version optional). Signing in AIMEAT (passkey, or the EU Digital Identity Wallet) happens in the signing app on the request "send" makes; a scanned copy is checked by a model and confirmed by a person, never signed by the model.',
    caller: 'owner',
    visibility: agentEverywhere,
    annotations: { title: 'Compliance: Data Processing Agreements', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'compliance:read',
    surfaces: ['agent', 'admin'],
    input: {
      action: { type: 'string', required: true, enum: [...AGREEMENT_ACTIONS], description: 'What to do. The operator starts with "list" or "gaps"; a counterparty with "mine".' },
      id: { type: 'string', description: 'The agreement, e.g. dpa-1a2b3c4d5e6f. Every action but list, mine, gaps, create and breach_notice.' },
      input: { type: 'object', description: 'For create, update and breach_notice: the fields listed in the description.' },
      dry_run: { type: 'boolean', description: 'For create: return the agreement that would be made, storing nothing.' },
      message: { type: 'string', description: 'For send: a line to the counterparty, shown on the signing request.' },
      storage_key: { type: 'string', description: 'For signed_copy: the signed PDF or the scan, in your own storage.' },
      kind: { type: 'string', enum: ['pdf', 'scan'], description: 'For signed_copy: pdf (signed in DocuSign or another e-signature service) or scan (a paper copy).' },
      party: { type: 'string', enum: ['controller', 'processor'], description: 'For signed_copy by the operator: whose signature the copy carries (default the counterparty\'s side).' },
      accept: { type: 'boolean', description: 'For confirm: true to accept the copy, false to reject it (then reason is needed).' },
      reason: { type: 'string', description: 'For confirm (a rejection), object and end: why, in a sentence or two.' },
      uploaded_at: { type: 'string', description: 'For confirm: the uploadedAt of the copy you looked at (versions[].review.uploadedAt from get). A copy that replaced it meanwhile answers COPY_CHANGED.' },
      choice: { type: 'string', enum: ['delete', 'return'], description: 'For end: whether the data is deleted or returned.' },
      note: { type: 'string', description: 'For deletion_done: what was done.' },
      version: { type: 'number', description: 'For document: which version (default the newest).' },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
