/**
 * @file src/services/data-intermediation/art12.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The conditions of Article 12 of the Data Governance Act (2022/868) as a checklist, each
 *   row with what in this node proves it (plan doc-mvwxcas3dom3, D7.4, D7.5). Pure: the inputs are read
 *   by ./report.ts, and a unit test holds every row.
 *
 *   THE STATUS SAYS HOW SURE THE PROOF IS. `evidence`: the node itself does it, and the row names how.
 *   `check`: the node holds part of it, and a person confirms the rest (a separate legal person, a breach
 *   notice to the holders). `missing`: the node is set to provide the service and the row has nothing.
 *
 *   THE ROWS: (a) purpose limitation and a separate legal person, (c) use of metadata, (d) the format is
 *   kept, (h) continuity and export, (i) interoperability, (k) notice of unauthorised access to the
 *   holders, (n) consent and permission tools, (o) a log of the activity.
 *
 *   (a) AND THE NODE'S OWN AI (D7.5). NODE_SIDE_READERS_OF_EXCHANGED_DATA lists every node-side analytics
 *   or AI code path that reads data delivered through EXCHANGE. It is empty: a metered call's result is
 *   handed to the buyer and to nothing else (services/metered-access.ts states it where the call is
 *   settled). A code path that starts reading exchanged data for the node's own use adds itself here,
 *   and the row then reads `check` with the path named.
 * @structure NODE_SIDE_READERS_OF_EXCHANGED_DATA · Art12Input · art12Rows
 * @usage const rows = art12Rows({ mode, notification, ... });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.4, D7.5).
 */
import type { Art12Row } from './contract.js';

/** Node-side analytics or AI code paths that read data delivered through EXCHANGE. See the header. */
export const NODE_SIDE_READERS_OF_EXCHANGED_DATA: readonly string[] = [];

export interface Art12Input {
    mode: 'report' | 'none' | 'node' | 'owners';
    notificationLegalName: string | null;
    providerOrganisms: number;
    packages: number;
    /** The DCAT feed answers outside harvesters (not a node that shows content to signed-in accounts only). */
    dcatOpen: boolean;
    dataspaceProtocol: boolean;
    consentEnabled: boolean;
    consentAuditRetentionDays: number;
    activeConsents: number;
    liveNamedShares: number;
    breachesRecorded: number;
    readers?: readonly string[];
}

/** The eight rows. */
export function art12Rows(i: Art12Input): Art12Row[] {
    const providing = i.mode === 'node' || i.mode === 'owners';
    const readers = i.readers ?? NODE_SIDE_READERS_OF_EXCHANGED_DATA;
    const noProvider = providing && !i.notificationLegalName && !(i.mode === 'owners' && i.providerOrganisms > 0);
    return [
        {
            point: 'a', code: 'di-art12-a', title: 'Purpose limitation and a separate legal person',
            // A separate legal person is a fact about the provider the node cannot read, so at best `check`.
            status: noProvider ? 'missing' : 'check',
            evidence: {
                mode: i.mode, provider: i.notificationLegalName, provider_organisms: i.providerOrganisms,
                node_side_readers_of_exchanged_data: [...readers],
            },
            text: (readers.length
                ? `The node's own code reads exchanged data in: ${readers.join(', ')}. `
                : 'No node-side analytics or AI path reads data delivered through EXCHANGE; a metered result goes to the buyer only. ')
                + (noProvider ? 'No provider is recorded.' : 'A person confirms that the service is provided through a separate legal person.'),
        },
        {
            point: 'c', code: 'di-art12-c', title: 'Use of metadata',
            status: 'evidence',
            evidence: { party_read_log: 'party-reads.<yyyy-mm>', used_for: ['the owner\'s view of who read', 'the read rate and abuse limits'] },
            text: 'Every outside party read is logged for the data holder, and the log is used for the holder\'s own view and the abuse limits only.',
        },
        {
            point: 'd', code: 'di-art12-d', title: 'The format is kept',
            status: 'evidence',
            evidence: { packages: i.packages, format: 'Frictionless Data Package with CSV', transformations_recorded: true, versions_immutable: true },
            text: 'Every data package keeps its CSV and Table Schema as published, at a permanent address, and records its sources and transformations.',
        },
        {
            point: 'h', code: 'di-art12-h', title: 'Continuity and export',
            status: 'evidence',
            evidence: { package_export: 'aimeat_datapackage_export', permanent_addresses: true, organism_export: 'aimeat_organism_export' },
            text: 'A holder exports any package and its connection instructions, and every version stays at its permanent address under the holder\'s retention policy.',
        },
        {
            point: 'i', code: 'di-art12-i', title: 'Interoperability',
            status: i.dcatOpen ? 'evidence' : 'check',
            evidence: { dcat_feed: i.dcatOpen ? '/v1/catalogue/dcat' : null, odps: true, frictionless: true, odata: true, dataspace_protocol: i.dataspaceProtocol },
            text: (i.dcatOpen ? 'The DCAT-AP feed, ODPS sheets, Frictionless descriptors and OData feeds describe and serve every package.' : 'This node lists nothing to outside harvesters, so the DCAT feed is empty; ODPS, Frictionless and OData serve each package.')
                + (i.dataspaceProtocol ? ' The Dataspace Protocol is on.' : ' The Dataspace Protocol is not on.'),
        },
        {
            point: 'k', code: 'di-art12-k', title: 'Notice of unauthorised access to the holders',
            status: 'check',
            evidence: { breaches_recorded: i.breachesRecorded, register: 'compliance document breaches' },
            text: 'Breaches are recorded in the compliance document "breaches"; a person confirms that the holders are told without delay.',
        },
        {
            point: 'n', code: 'di-art12-n', title: 'Consent and permission tools',
            status: i.consentEnabled ? 'evidence' : 'missing',
            evidence: { consent_enabled: i.consentEnabled, active_consents: i.activeConsents, live_named_shares: i.liveNamedShares },
            text: i.consentEnabled
                ? 'Holders grant, see and revoke every consent and named share, and a revocation refuses the next read.'
                : 'The consent layer is off on this node (AIMEAT_CONSENT_ENABLED).',
        },
        {
            point: 'o', code: 'di-art12-o', title: 'A log of the activity',
            status: i.consentEnabled ? 'evidence' : 'check',
            evidence: { consent_audit_retention_days: i.consentAuditRetentionDays, party_read_log: true },
            text: `Consent use is audited and kept ${i.consentAuditRetentionDays} days, and every outside party read is logged.`,
        },
    ];
}
