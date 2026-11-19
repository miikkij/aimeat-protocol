/**
 * @file src/services/aml/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The anti-money-laundering vocabulary of this node (Regulation (EU) 2024/1624, AMLR;
 *   decision decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila): the shape of a finding and of
 *   an obligation row, and the regulation references both cite as data.
 *
 *   THIS IS A READING, NOT A LEGAL OPINION. A finding says what in this node looks like work that the
 *   regulation gives an obliged entity, or what an obliged entity here still leaves open, and cites the
 *   article; a person decides (a finding's source is `proposed` until a review in the compliance
 *   document `aml` says otherwise). The article numbers follow the regulation as published in the
 *   Official Journal on 19.6.2024.
 *
 *   THE SAME SHAPE AS SECTION 12. A finding and its review have the shape of the data intermediation
 *   findings (services/data-intermediation/contract.ts), so the Compliance page, the printout and an
 *   AI read both sections the same way.
 * @structure AmlRef · AMLR_REFS · AML_FINDING_KINDS · AmlFindingKind · AmlFinding · AmlObligationStatus ·
 *   AmlObligationRow
 * @usage import { AMLR_REFS, type AmlFinding } from './contract.js';
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */

/** A reference into a regulation, rendered by the page; `text` is the English summary. */
export interface AmlRef { act: string; ref: string; text: string }

/** The references the findings and the obligation rows cite. */
export const AMLR_REFS = {
  obliged: { act: '2024/1624', ref: 'art. 3', text: 'The obliged entities: credit and financial institutions, auditors, accountants and tax advisers, notaries and lawyers, trust and company service providers, estate agents, traders in high-value goods, gambling services, crypto-asset service providers, crowdfunding service providers, and others the article names.' },
  riskAssessment: { act: '2024/1624', ref: 'art. 10', text: 'An obliged entity assesses the money laundering and terrorist financing risks of its business, documents the assessment and keeps it up to date.' },
  compliance: { act: '2024/1624', ref: 'art. 11', text: 'An obliged entity names a member of its management body who answers for compliance, and a compliance officer who does the work.' },
  cdd: { act: '2024/1624', ref: 'art. 19–22', text: 'Customer due diligence: identify the customer and verify the identity, identify the beneficial owner, learn the purpose of the business relationship, and monitor it.' },
  monitoring: { act: '2024/1624', ref: 'art. 26', text: 'Customer information is kept up to date: at least once a year for a high-risk customer and at least once every five years for others.' },
  pep: { act: '2024/1624', ref: 'art. 42–46', text: 'A politically exposed person, their family members and close associates get enhanced due diligence, for at least twelve months after the public function ends.' },
  reporting: { act: '2024/1624', ref: 'art. 69, 73', text: 'A suspicious transaction is reported to the Financial Intelligence Unit, and the customer is not told of the report.' },
  retention: { act: '2024/1624', ref: 'art. 77', text: 'The due diligence records are kept five years after the business relationship ends, and then deleted.' },
  cash: { act: '2024/1624', ref: 'art. 80', text: 'A trader in goods or services does not accept a cash payment of more than EUR 10 000.' },
  sanctions: { act: 'TFEU', ref: 'art. 215', text: 'No funds or economic resources are made available to a person or entity on an EU sanctions list. This applies to everyone in the EU, not only to obliged entities.' },
  dsaTraders: { act: '2022/2065', ref: 'art. 30', text: 'An online marketplace where consumers buy from traders collects and checks the traders\' details; a micro or small enterprise is exempt (art. 19).' },
  dac7: { act: '2021/514', ref: 'Annex V', text: 'A digital platform operator reports the sellers of personal services, goods, property rental and transport rental to the tax authority.' },
  mica: { act: '2023/1114', ref: 'art. 3(1)(16)', text: 'A service that transfers crypto-assets on behalf of a client is a crypto-asset service, and its provider is an obliged entity.' },
} as const satisfies Record<string, AmlRef>;

export const AML_FINDING_KINDS = [
  'org_declares_obliged', 'declaration_missing', 'roles_incomplete', 'registration_missing', 'risk_assessment_stale',
  'payouts_for_others', 'crypto_for_others', 'agent_spends_money', 'payers_not_screened', 'personal_services_sold',
  'marketplace_traders',
] as const;
export type AmlFindingKind = typeof AML_FINDING_KINDS[number];

/** One finding of the anti-money-laundering section. */
export interface AmlFinding {
  /** Stable: the kind and, when it is about one thing, that thing (`roles_incomplete:<organism>`). */
  id: string;
  kind: AmlFindingKind;
  count: number;
  /** What it is about, in data: an organism, an account, an offering. Capped at 50. */
  items: Array<Record<string, unknown>>;
  /** The reason in plain English, for a machine and as the fallback; `code` is what a page translates. */
  reason: string;
  code: string;
  regulation: AmlRef[];
  /** `proposed` until a person reviewed it; then `human` with the decision. */
  source: 'proposed' | 'human';
  review?: { decision: 'accepted' | 'dismissed'; note?: string; at?: string; by?: string };
  /** What the node proposes a person does, when it is one action. */
  proposal?: { action: string; text: string; request?: { method: string; url: string; body?: Record<string, unknown> } };
  /** The account it is about, so the owner's slice keeps only the owner's. */
  owner?: string;
}

export type AmlObligationStatus = 'evidence' | 'check' | 'missing' | 'not_applicable';

/** One obligation: what in this node shows it is met, and in which modes it applies. */
export interface AmlObligationRow {
  code: string;
  ref: AmlRef;
  status: AmlObligationStatus;
  /** What the node read: counts, switches. */
  evidence: Record<string, unknown>;
  /** The English sentence the page shows when it has no string for the code. */
  text: string;
}
