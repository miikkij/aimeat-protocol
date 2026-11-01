/**
 * @file src/services/data-intermediation/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data intermediation vocabulary of this node (plan doc-mvwxcas3dom3, D7; Data
 *   Governance Act, Regulation (EU) 2022/868): the shapes of a finding and of an Article 12 row, the
 *   regulation references the findings cite as data, and which EXCHANGE offering delivers data.
 *
 *   THIS IS A READING, NOT A LEGAL OPINION. A finding says what in this node looks like intermediation
 *   by the plan's reading of art. 2(11) and recital 28, and cites them; a person decides (the finding's
 *   source is `proposed` until a review in the compliance document `intermediation` says otherwise).
 *
 *   WHICH OFFERING DELIVERS DATA. Every offering carries `deliversData` (plan D5.5): the provider's
 *   statement on its source, else the node's proposal (services/exchange-datapackage.ts
 *   proposeDeliversData: a data package, and an action or tool whose output schema returns rows or
 *   records). A listing made before the field existed is read by its kind until its next projection
 *   writes the field: an `ext-action` and a `datapackage` as data, an app tool and agent work as a service.
 * @structure DGA_REFS · DgaRef · FindingKind · IntermediationFinding · Art12Status · Art12Row ·
 *   offeringDeliversData · INTERMEDIATION_FINDING_KINDS
 * @usage if (offeringDeliversData(o)) refuse();
 * @version-history
 *   v1.1.0 — 2026-11-01 — The offering's `deliversData` decides; the kind only for a listing written before it (plan D5.5).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.1, D7.3, D7.4).
 */

/** A reference into the regulation, rendered by the page; `text` is the English summary. */
export interface DgaRef { act: '2022/868'; ref: string; text: string }

/** The references the findings and the checklist cite. */
export const DGA_REFS = {
    def: { act: '2022/868', ref: 'art. 2(11)', text: 'A data intermediation service establishes commercial relationships for data sharing between an undetermined number of data holders and data users.' },
    closedGroup: { act: '2022/868', ref: 'art. 2(11)(c)', text: 'A service used by a closed group of legal persons, such as supplier or customer relationships or contractual collaborations, is not data intermediation.' },
    marketplace: { act: '2022/868', ref: 'recital 28', text: 'Data marketplaces where undertakings make data available to others, and data sharing ecosystems open to all interested parties, are data intermediation. A technical tool for the data holder alone is not.' },
    art10a: { act: '2022/868', ref: 'art. 10(a)', text: 'Intermediation services between data holders and potential data users, including bilateral or multilateral exchanges and platforms, are subject to notification.' },
    art10b: { act: '2022/868', ref: 'art. 10(b)', text: 'Services between data subjects who make their personal data available and potential data users are subject to notification.' },
    art11: { act: '2022/868', ref: 'art. 11', text: 'A provider of data intermediation services notifies the competent authority before it starts.' },
    art12: { act: '2022/868', ref: 'art. 12', text: 'The conditions for providing data intermediation services.' },
} as const satisfies Record<string, DgaRef>;

export const INTERMEDIATION_FINDING_KINDS = [
    'data_offering_public', 'contract_outside_buyer', 'open_organism_with_data', 'app_open_registration_commerce',
    'priced_named_share', 'person_party_contact', 'notification_missing', 'node_ai_reads_exchanged_data',
] as const;
export type FindingKind = typeof INTERMEDIATION_FINDING_KINDS[number];

/** One finding of the data intermediation section. */
export interface IntermediationFinding {
    /** Stable: the kind and, when it is about one thing, that thing (`open_organism_with_data:<id>`). */
    id: string;
    kind: FindingKind;
    count: number;
    /** What it is about, in data: an offering id and title, an organism, a contract. Capped at 50. */
    items: Array<Record<string, unknown>>;
    /** The reason in plain English, for a machine and as the fallback; `code` is what a page translates. */
    reason: string;
    code: string;
    regulation: DgaRef[];
    /** `proposed` until a person reviewed it; then `human` with the decision. */
    source: 'proposed' | 'human';
    review?: { decision: 'accepted' | 'dismissed'; note?: string; at?: string; by?: string };
    /** What the node proposes a person does, when it is one action (D7.6). */
    proposal?: { action: string; text: string; request?: { method: string; url: string; body?: Record<string, unknown> } };
    /** The account it is about, so the owner's slice keeps only the owner's. */
    owner?: string;
}

export type Art12Status = 'evidence' | 'check' | 'missing';

/** One Article 12 condition: what in this node proves it, and how sure that proof is. */
export interface Art12Row {
    /** The point of art. 12: a, c, d, h, i, k, n, o. */
    point: string;
    code: string;
    title: string;
    status: Art12Status;
    /** What the node read: counts, switches, addresses. */
    evidence: Record<string, unknown>;
    /** The English sentence the page shows when it has no string for the code. */
    text: string;
}

/** Does this offering deliver data? Its own `deliversData` when it states one (D5.5), else by kind. */
export function offeringDeliversData(o: { kind?: string; deliversData?: boolean | null }): boolean {
    if (typeof o.deliversData === 'boolean') return o.deliversData;
    return o.kind === 'ext-action' || o.kind === 'datapackage';
}
