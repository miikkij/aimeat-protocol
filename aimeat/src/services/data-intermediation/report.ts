/**
 * @file src/services/data-intermediation/report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data intermediation section of the compliance report (plan doc-mvwxcas3dom3, D7;
 *   section 12 on the Compliance page): the setting and what it means, the provider's notification
 *   record, the findings with their reasons and the regulation they cite, and the Article 12 checklist.
 *   GET /v1/admin/compliance/report, GET /v1/compliance/report/mine and aimeat_compliance_report carry
 *   it through services/compliance/report.ts, so one builder serves all three.
 *
 *   THE OWNER'S SLICE is the owner's own findings and the notification of the organisms they manage;
 *   the node's record and the other accounts' items are not in it.
 * @structure DataIntermediationSection · MODE_TEXT · buildDataIntermediationSection
 * @usage const di = await buildDataIntermediationSection({ storage, config }, { ownerGhii });
 * @version-history
 *   v1.1.0 — 2026-11-02 — The node's report carries `shared_data`, the packages behind the four figures
 *     (services/datapackage/shared-data.ts nodeSharedData; WP11, board Admin-aineistot).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.1–D7.6).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { signedInOnly } from '../../config/visibility.js';
import { readDoc } from '../compliance/docs.js';
import type { IntermediationNotification } from '../compliance/docs-schemas.js';
import { isOrgManager } from '../workspace-access.js';
import { DGA_REFS, type Art12Row, type DgaRef, type IntermediationFinding } from './contract.js';
import { art12Rows } from './art12.js';
import { buildFindings, gatherFacts } from './findings.js';
import { readIntermediationDocs, providerOrganisms } from './gate.js';
import { nodeSharedData, type NodeSharedRow } from '../datapackage/shared-data.js';

export interface DataIntermediationSection {
    /** The section's place on the Compliance page and in the printout. */
    section: '12';
    mode: AimeatConfig['dataIntermediation'];
    /** A stable code for the mode's meaning, and the English sentence. */
    mode_code: string;
    mode_text: string;
    /** The node's notification record (node ring), or null. */
    notification: IntermediationNotification | null;
    /** Organisms that keep a notification record: all of them for the operator, the ones the owner manages in a slice. */
    providers: Array<{ organism_id: string; legal_name: string; business_id: string; notified_at: string | null }>;
    findings: IntermediationFinding[];
    totals: { findings: number; with_items: number; proposed: number; reviewed: number };
    art12: Art12Row[];
    regulation: DgaRef[];
    /** Where the notification and the reviews are written. */
    edit: { method: 'PUT' | 'PATCH'; url: string; note: string };
    note: string;
    /**
     * The node's report only: the packages behind the four figures, one row each with its name, owner,
     * audience, licence, readers in 30 days and freshness, and the flags each figure filters on
     * (services/datapackage/shared-data.ts nodeSharedData). Never a row of data, never a named recipient.
     */
    shared_data?: { rows: NodeSharedRow[]; total: number; capped: boolean };
}

const MODE_TEXT: Record<AimeatConfig['dataIntermediation'], string> = {
    report: 'Nothing is refused. This section lists what in this node could count as data intermediation, for a person to decide.',
    none: 'This node does not intermediate data. An offering that delivers data is not listed to everyone; data goes to named recipients only.',
    node: 'The operator provides the data intermediation service and keeps the notification record below.',
    owners: 'The node is a tool. An owner or organism that declared itself a provider may run an open data marketplace; everyone else is as none.',
};

/** Build the section for the node (no owner) or for one owner's slice. */
export async function buildDataIntermediationSection(
    deps: { storage: Storage; config: AimeatConfig }, opts: { ownerGhii?: string } = {},
): Promise<DataIntermediationSection> {
    const { storage, config } = deps;
    const owner = opts.ownerGhii ? localAccountName(opts.ownerGhii) : null;
    const facts = await gatherFacts(deps, { owner });
    const findings = buildFindings(facts);

    const docs = await readIntermediationDocs(storage, config.nodeId);
    const providers: DataIntermediationSection['providers'] = [];
    for (const [organismId, n] of providerOrganisms(docs)) {
        if (owner && !(await isOrgManager(storage, organismId, owner))) continue;
        providers.push({ organism_id: organismId, legal_name: n.legalName, business_id: n.businessId, notified_at: n.notifiedAt ?? null });
    }
    const breaches = owner ? 0 : (await readDoc(storage, config.nodeId, 'breaches', { kind: 'node' })).items.length;

    const art12 = art12Rows({
        mode: config.dataIntermediation,
        notificationLegalName: facts.nodeNotification?.legalName ?? null,
        providerOrganisms: facts.providers.length,
        packages: facts.counts.packages,
        dcatOpen: !signedInOnly(config),
        dataspaceProtocol: (config as unknown as { dataspaceEnabled?: unknown }).dataspaceEnabled === true,
        consentEnabled: config.consentEnabled,
        consentAuditRetentionDays: config.consentAuditRetentionDays,
        activeConsents: facts.counts.consents,
        liveNamedShares: facts.counts.liveShares,
        breachesRecorded: breaches,
    });

    return {
        section: '12',
        mode: config.dataIntermediation,
        mode_code: `di-mode-${config.dataIntermediation}`,
        mode_text: MODE_TEXT[config.dataIntermediation],
        notification: owner ? null : facts.nodeNotification,
        providers,
        findings,
        totals: {
            findings: findings.length,
            with_items: findings.filter(f => f.count > 0).length,
            proposed: findings.filter(f => f.source === 'proposed' && f.count > 0).length,
            reviewed: findings.filter(f => f.source === 'human').length,
        },
        art12,
        regulation: [DGA_REFS.def, DGA_REFS.marketplace, DGA_REFS.closedGroup, DGA_REFS.art11, DGA_REFS.art12],
        edit: owner
            ? { method: 'PUT', url: '/v1/compliance/docs/intermediation?scope=organism&organism_id=<id>', note: 'An organism you manage keeps its own notification record and reviews (mode owners).' }
            : { method: 'PUT', url: '/v1/compliance/docs/intermediation', note: 'The node\'s notification record (an item of type notification) and a review per finding (type review, the finding\'s id, accepted or dismissed). aimeat_compliance_register_write with kind intermediation does the same.' },
        note: 'This is a reading of Regulation (EU) 2022/868, not a legal opinion. Each finding is a proposal until a person reviews it.',
        ...(owner ? {} : { shared_data: await nodeSharedData(deps) }),
    };
}
