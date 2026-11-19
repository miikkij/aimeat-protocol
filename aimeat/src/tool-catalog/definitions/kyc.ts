/**
 * @file src/tool-catalog/definitions/kyc.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for customer due diligence (EU AMLR 2024/1624) of an obliged organism:
 *   aimeat_kyc_customer (the customer cards), aimeat_kyc_suspicion_mark (mark a suspicion for the
 *   officers) and aimeat_kyc_settings (who does the work, the firm's risk rules). The REST contract is
 *   routes/kyc/routes.ts; services/kyc/access.ts decides who may do what.
 *
 *   PER-ACTION PERMISSION WORDS. aimeat_kyc_customer and aimeat_kyc_settings read and write under one
 *   name, as the routes split GET (compliance:read) from the writes (compliance:write). The catalog
 *   scope is the read word, so the tool is offered on it; KYC_CUSTOMER_ACTIONS and KYC_SETTINGS_ACTIONS
 *   name the word of each action, read by catalog/action-scopes.ts, and the node MCP handler asks it
 *   per call. The CLI dispatch needs no copy: its routes run requireScope.
 *
 *   WHAT IS NOT HERE. Deciding a sanctions hit, approving a high-risk customer, extending a hold and
 *   every suspicion report action are a person's decisions or the officers' in person (access.ts
 *   requireInPerson, requireOfficer); they stay on the customer card in Settings & Controls.
 * @structure KYC_CUSTOMER_ACTIONS · KYC_SETTINGS_ACTIONS · kycTools
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.1.0 — 2026-11-19 — aimeat_kyc_settings: actions risk_assessment and dpia_draft (reads; services/kyc/assessment.ts).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const READ = 'compliance:read';
const WRITE = 'compliance:write';

/** The actions of aimeat_kyc_customer, in the order the description names them. */
export const KYC_CUSTOMER_ACTION_NAMES = ['list', 'open', 'read', 'as_of', 'update', 'identify', 'screen', 'review', 'end', 'link'] as const;
export type KycCustomerAction = typeof KYC_CUSTOMER_ACTION_NAMES[number];

/** aimeat_kyc_customer: action → the permission word its route asks (routes/kyc/routes.ts R or W). */
export const KYC_CUSTOMER_ACTIONS: Record<KycCustomerAction, string> = {
    list: READ, open: WRITE, read: READ, as_of: READ, update: WRITE, identify: WRITE,
    screen: WRITE, review: WRITE, end: WRITE, link: WRITE,
};

/**
 * The actions of aimeat_kyc_settings. `update` stays last: the parameter-forwarding probe
 * (test/unit/cli-tool-param-forwarding.test.ts) holds `action` at the last enum value, and only
 * `update` carries the other parameters.
 */
export const KYC_SETTINGS_ACTION_NAMES = ['read', 'risk_assessment', 'dpia_draft', 'update'] as const;

/** aimeat_kyc_settings: action → the permission word its route asks. */
export const KYC_SETTINGS_ACTIONS: Record<typeof KYC_SETTINGS_ACTION_NAMES[number], string> = {
    read: READ, update: WRITE, risk_assessment: READ, dpia_draft: READ,
};

/** The customer card statuses, as services/kyc/contract.ts CUSTOMER_STATUSES (the catalog imports nothing above utils/). */
const CUSTOMER_STATUSES = ['open', 'active', 'blocked', 'ended'] as const;

const ORGANISM = { type: 'string', required: true, description: 'The obliged organism\'s id. aimeat_organism_list shows the organisms you belong to.', zod: z.string().min(1).max(80) } as const;

export const kycTools = [
    {
        name: 'aimeat_kyc_customer',
        description: 'Customer due diligence for an obliged organism (EU anti-money-laundering regulation 2024/1624): open a customer card, record how the identity was verified, screen the customer and its beneficial owners against the EU and UN sanctions lists, rate the risk, review it, end the relationship, and read what the firm knew on a given day. Every change writes a new version of the card; nothing is overwritten. Works only in an organism that has declared itself an obliged entity on a server whose operator allows it (otherwise KYC_NOT_ENABLED says which is missing), and only for its compliance officers, due diligence staff and admins, and their agents. Actions: "list" the cards (due=true: only those due for review or with an open sanctions hit; status filters); "open" a card with fields { kind: person|entity, name, ... } (screened and rated at once); "read" one card with its version list; "as_of" the card as it stood on a date or time (as_of), with who wrote it and why; "update" with fields and an optional note; "identify" with identity { level: none|low|substantial|high, method: ftn|eudiw|document|register|other, issuer?, verifiedAt, faceToFace?, evidence? }; "screen" again; "review" (the periodic review, with a note; sets the next review date); "end" the relationship (note, ended_at?), after which the card is kept five years and then deleted; "link" makes a one-time link for a person customer to give their own bank-ID verification, signed in, in person. The card fields: kind, name, aliases[], birthDate, nationality, country (ISO2), businessId, contact, beneficialOwners [{ name, birthDate?, country?, share? (percent), control? }], ownershipLayers, nomineeOrBearerShares, cashIntensive, productRisk (low|medium|high), purpose, sourceOfFunds, pep (no|yes|family|close-associate|former|unknown), pepDetail. Decisions a person makes in person (deciding a sanctions hit, approving a high-risk or PEP customer, extending a hold) are made on the customer card in Settings & Controls, not here: tell the person what waits for them. Reading needs "compliance:read"; every other action "compliance:write".',
        caller: 'owner',
        visibility: agentEverywhere,
        annotations: { title: 'KYC: Customer Cards', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: READ,
        surfaces: ['agent', 'admin'],
        input: {
            organism: ORGANISM,
            action: { type: 'string', required: true, enum: KYC_CUSTOMER_ACTION_NAMES, description: 'What to do. Start with "list".' },
            customer_id: { type: 'string', description: 'The card, e.g. c-1a2b3c4d-5e6f. Every action but list and open.', zod: z.string().min(1).max(64) },
            as_of: { type: 'string', description: 'For "as_of": a date (YYYY-MM-DD, the end of that day) or an ISO 8601 time.', zod: z.string().min(10).max(40) },
            due: { type: 'boolean', description: 'For "list": only the cards due for review, or with an open sanctions hit.' },
            status: { type: 'string', enum: CUSTOMER_STATUSES, description: 'For "list": only the cards in this status. blocked: a blocking risk factor or a missing senior approval.' },
            fields: { type: 'object', description: 'For "open" (kind and name required) and "update" (only the fields that change): the card fields listed in the description.' },
            identity: { type: 'object', description: 'For "identify": { level, method, issuer?, verifiedAt, faceToFace?, evidence? }, as listed in the description.' },
            note: { type: 'string', description: 'For "update", "identify", "review" and "end": why, in the writer\'s words. Kept on the version.', zod: z.string().max(2000) },
            ended_at: { type: 'string', description: 'For "end": when the relationship ended (ISO date or time). Absent: now.', zod: z.string().max(40) },
        },
    },
    {
        name: 'aimeat_kyc_suspicion_mark',
        description: 'Mark a suspicion of money laundering or terrorist financing in an obliged organism, for its compliance officers. Write what you saw, in at least a sentence (observation), and the customer card it concerns when there is one. The answer says only that the mark was received: the officers handle it, decide whether it is reported to the Financial Intelligence Unit, and nobody else learns of it, the customer least of all (AMLR art. 73). Do not tell the customer, and do not ask about it later. Open to the organism\'s due diligence staff, officers and admins, and their agents. Needs "compliance:write".',
        caller: 'owner',
        visibility: agentEverywhere,
        annotations: { title: 'KYC: Mark a Suspicion', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: WRITE,
        surfaces: ['agent', 'admin'],
        input: {
            organism: ORGANISM,
            observation: { type: 'string', required: true, description: 'What you saw: who, what, when, why it is unusual. At least a sentence.', zod: z.string().min(10).max(4000) },
            customer_id: { type: 'string', description: 'The customer card it concerns, when there is one.', zod: z.string().min(1).max(64) },
        },
    },
    {
        name: 'aimeat_kyc_settings',
        description: 'The customer due diligence settings of an obliged organism: who does the due diligence (staff, account names name@node), who the compliance officers are (officers: the officer and the deputy, who alone read suspicion reports), the firm\'s list of high-risk third countries (highRiskCountries, ISO2 codes) and how often a customer is reviewed per risk level (reviewMonths { low, medium, high }). action="read" answers the settings and your role in the organism (officer, staff, manager). action="update" changes the fields you send and keeps the rest; it is made by an admin of the organism or its compliance officer in person, so an agent\'s update is refused with KYC_DECISION_IN_PERSON: tell the person to change it in Settings & Controls. action="risk_assessment" answers a draft of the firm\'s business-wide risk assessment (AMLR art. 10) built from the organism\'s own customer cards: `facts` (open customers by kind, status, risk and due diligence; the countries that appear, each with how many customers and whether it is on the firm\'s high-risk list; PEP customers; remote identification below substantial; cash-intensive customers; complex ownership; open sanctions hits; overdue reviews), `sections` (customers, countries, products, channels, transactions: each a paragraph with the numbers and the questions the firm answers itself), `lastRecordedAt` and `due` (true when never recorded or older than 12 months). It is a draft for the person to complete, not the assessment: show it, do not present it as finished. Recording that the assessment was updated is done by an officer or admin in person (POST /v1/kyc/{org}/risk-assessment/recorded), not here. action="dpia_draft" answers a draft data protection impact assessment of the due diligence (`item`, shaped as a compliance "dpias" entry, and `store`: how the person stores it with aimeat_compliance_register_write part "dpias", scope "organism"). Both drafts: the organism\'s compliance officers and admins and their agents; staff are refused with KYC_NOT_MANAGER. Reading and both drafts need "compliance:read", updating "compliance:write".',
        caller: 'owner',
        visibility: agentEverywhere,
        annotations: { title: 'KYC: Settings', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: READ,
        surfaces: ['agent', 'admin'],
        input: {
            organism: ORGANISM,
            action: { type: 'string', required: true, enum: KYC_SETTINGS_ACTION_NAMES, description: 'What to do. "read" first; "risk_assessment" and "dpia_draft" read the two drafts.' },
            staff: { type: 'array', description: 'For "update": the members (name@node) who do customer due diligence. Replaces the list.', zod: z.array(z.string().max(200)).max(200) },
            officers: { type: 'array', description: 'For "update": the compliance officer and the deputy (name@node). Replaces the list.', zod: z.array(z.string().max(200)).max(10) },
            highRiskCountries: { type: 'array', description: 'For "update": the firm\'s high-risk third countries as ISO2 codes (e.g. ["KP", "IR"]). Replaces the list.', zod: z.array(z.string().max(2).regex(/^[A-Z]{2}$/)).max(100) },
            reviewMonths: { type: 'object', description: 'For "update": months between reviews per risk level, { low (1-60), medium (1-60), high (1-12) }.', zod: z.object({ low: z.number().int().min(1).max(60), medium: z.number().int().min(1).max(60), high: z.number().int().min(1).max(12) }) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
