/**
 * @file src/services/data-intermediation/findings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What in this node may be data intermediation (plan doc-mvwxcas3dom3, D7.3, D7.5, D7.6,
 *   D2.10), read from the records that already exist and from nothing new:
 *     (a) data_offering_public          EXCHANGE offerings that deliver data, listed to everyone;
 *     (b) contract_outside_buyer        contracts on such offerings with a buyer of another account or a party;
 *     (c) open_organism_with_data       organisms anyone may join that carry data packages shared to them,
 *                                       one finding each, with the proposal to require approval (D7.6);
 *     (d) app_open_registration_commerce apps that let outside parties register and sell (the setting is
 *                                       not on this node yet, so the count is 0 and the evidence says why);
 *     (e) priced_named_share            named shares to parties that carry a price (none can yet);
 *     person_party_contact              outside parties that are persons with a contact: the owner holds
 *                                       personal data about them and is its controller (D2.10);
 *     notification_missing              mode node or owners with no notification record;
 *     node_ai_reads_exchanged_data      mode node, a data package sold on EXCHANGE while the node's own
 *                                       classification reads stored files (D7.5).
 *   Findings (a) to (e) are always present, with count 0 when nothing matches, so a reader sees what was
 *   looked at. Every finding is a proposal (source `proposed`) until a person reviews it in the
 *   compliance document `intermediation` (decision 2026-10-28, a rule-based classification is a proposal).
 *
 *   THE OWNER'S SLICE holds only the owner's own: their offerings, the contracts they sell, the
 *   organisms they manage, their shares and their parties. Nothing about another account.
 * @structure IntermediationFacts · gatherFacts · buildFindings · ITEM_CAP
 * @usage const facts = await gatherFacts(deps, { owner }); const findings = buildFindings(facts);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.3, D7.5, D7.6, D2.10).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { listOfferings, type Offering } from '../exchange-market.js';
import { listAllEntitlements } from '../metered-entitlements.js';
import { allDatasetFacts } from '../datapackage/catalogue-facts.js';
import { isOrgManager } from '../workspace-access.js';
import { PARTIES_KEY, parsePartiesValue } from '../parties/contract.js';
import { isLiveShare, packageOfPattern } from '../parties/shares.js';
import type { IntermediationNotification, IntermediationReview } from '../compliance-docs-schemas.js';
import { listDocs } from '../compliance-docs.js';
import { DGA_REFS, offeringDeliversData, type IntermediationFinding } from './contract.js';
import { nodeNotification, providerOrganisms, readIntermediationDocs } from './gate.js';

/** Items a finding lists; the count is the whole. */
export const ITEM_CAP = 50;

/** What the findings and the Article 12 rows are computed from. */
export interface IntermediationFacts {
    mode: AimeatConfig['dataIntermediation'];
    owner: string | null;
    nodeNotification: IntermediationNotification | null;
    /** Organisms that keep a notification record (mode owners). */
    providers: Array<{ organismId: string; legalName: string }>;
    dataOfferings: Array<Pick<Offering, 'offeringId' | 'title' | 'providerOwner' | 'kind'>>;
    outsideContracts: Array<{ entitlementId: string; provider: string; buyer: string; capability: string; buyerKind: 'account' | 'party' }>;
    openOrganisms: Array<{ id: string; name: string; packages: string[] }>;
    appsOpenRegistration: Array<{ app: string; owner: string }>;
    appRegistrationSettingPresent: boolean;
    pricedShares: Array<{ id: string; owner: string; package: string | null }>;
    personParties: Array<{ owner: string; count: number }>;
    exchangedPackages: Array<{ offeringId: string; title: string }>;
    nodeAiReadsFiles: boolean;
    reviews: Map<string, IntermediationReview>;
    /** For the Article 12 rows. */
    counts: { packages: number; liveShares: number; parties: number; consents: number };
}

/** Read everything the section needs once. `owner` narrows every list to that account. */
export async function gatherFacts(deps: { storage: Storage; config: AimeatConfig }, opts: { owner?: string | null } = {}): Promise<IntermediationFacts> {
    const { storage, config } = deps;
    const owner = opts.owner ?? null;
    const mine = (account: string) => !owner || account === owner;

    const docs = await readIntermediationDocs(storage, config.nodeId);
    const providers = [...providerOrganisms(docs).entries()].map(([organismId, n]) => ({ organismId, legalName: n.legalName }));
    const reviews = new Map<string, IntermediationReview>();
    // The node's reviews win over an organism's for the same finding.
    for (const d of (await listDocs(storage, config.nodeId, 'intermediation')).sort((a, b) => (a.scope.kind === 'node' ? 1 : 0) - (b.scope.kind === 'node' ? 1 : 0))) {
        for (const i of d.doc.items) if (i.type === 'review') reviews.set(i.id, i);
    }

    const listed = await listOfferings(storage);
    const dataOfferings = listed.filter(o => offeringDeliversData(o) && mine(o.providerOwner))
        .map(o => ({ offeringId: o.offeringId, title: o.title, providerOwner: o.providerOwner, kind: o.kind }));
    const exchangedPackages = listed.filter(o => (o.kind as string) === 'datapackage' && mine(o.providerOwner)).map(o => ({ offeringId: o.offeringId, title: o.title }));

    const outsideContracts: IntermediationFacts['outsideContracts'] = [];
    for (const e of await listAllEntitlements(storage)) {
        if (e.state === 'revoked') continue;
        const provider = localAccountName(e.providerGhii);
        if (!mine(provider)) continue;
        const surfaceKind = (e.surface as { kind?: string } | null | undefined)?.kind;
        const data = surfaceKind ? surfaceKind === 'datapackage' : !e.ext.startsWith('apptool:') && !e.ext.startsWith('agentwork:');
        if (!data) continue;
        const party = e.consumerGaii.startsWith('party:');
        const buyer = party ? e.consumerGaii : localAccountName(ownerGhiiOf(e.consumerGaii));
        if (!party && buyer === provider) continue;
        outsideContracts.push({ entitlementId: e.entitlementId, provider, buyer: party ? 'an outside party' : buyer, capability: e.capabilityLabel, buyerKind: party ? 'party' : 'account' });
    }

    // Data packages shared to an organism, by organism.
    const packagesByOrg = new Map<string, string[]>();
    for (const f of await allDatasetFacts(storage)) {
        if (!f.audience.startsWith('organism:')) continue;
        const id = f.audience.slice('organism:'.length);
        packagesByOrg.set(id, [...(packagesByOrg.get(id) ?? []), f.packageId]);
    }
    const openOrganisms: IntermediationFacts['openOrganisms'] = [];
    for (const [id, packages] of packagesByOrg) {
        const org = await storage.getOrganism(id);
        if (!org || org.joinPolicy !== 'open') continue;
        if (owner && !(await isOrgManager(storage, id, owner))) continue;
        openOrganisms.push({ id, name: org.name, packages });
    }

    // The owners' parties and shares, read through the parties records (one per owner that has any).
    const pricedShares: IntermediationFacts['pricedShares'] = [];
    const personParties: IntermediationFacts['personParties'] = [];
    let liveShares = 0, parties = 0, consents = 0;
    const partyRecords = storage.getMemoryByKeysAnyOwner ? await storage.getMemoryByKeysAnyOwner([PARTIES_KEY]) : [];
    for (const rec of partyRecords) {
        const account = localAccountName(rec.ownerGaii);
        if (!mine(account) || !rec.ownerGaii.endsWith(`@${config.nodeId}`)) continue;
        const list = parsePartiesValue(rec.value).parties;
        parties += list.length;
        const persons = list.filter(p => p.kind === 'person' && !!p.contact).length;
        if (persons) personParties.push({ owner: account, count: persons });
        const shares = (await storage.listConsents(rec.ownerGaii, { status: 'active' })).filter(c => c.recipient.startsWith('party:') && isLiveShare(c));
        liveShares += shares.length;
        for (const c of shares) {
            const m = (c.metadata ?? {}) as Record<string, unknown>;
            if (m.price !== undefined && m.price !== null) pricedShares.push({ id: c.id, owner: account, package: packageOfPattern(c.dataPattern) });
        }
    }
    if (owner) consents = (await storage.listConsents(`${owner}@${config.nodeId}`, { status: 'active' })).length;
    else {
        for (const f of await storage.consentFacets({ since: new Date(0).toISOString() })) if (f.status === 'active') consents += f.count;
    }

    // The app setting that lets outside parties register (plan D4.3) is not on this node yet.
    const appRegistrationSettingPresent = 'partySelfRegistration' in (config as unknown as Record<string, unknown>);

    const packages = (await allDatasetFacts(storage)).filter(f => mine(f.owner)).length;
    return {
        mode: config.dataIntermediation, owner, nodeNotification: nodeNotification(docs), providers,
        dataOfferings, outsideContracts, openOrganisms, appsOpenRegistration: [], appRegistrationSettingPresent,
        pricedShares, personParties, exchangedPackages,
        nodeAiReadsFiles: config.classificationMode !== 'off' || (config as { contentClassMode?: string }).contentClassMode !== 'off',
        reviews, counts: { packages, liveShares, parties, consents },
    };
}

const cap = <T>(xs: T[]): T[] => xs.slice(0, ITEM_CAP);

/** The findings, from the facts. Pure. */
export function buildFindings(f: IntermediationFacts): IntermediationFinding[] {
    const out: IntermediationFinding[] = [];
    const add = (x: Omit<IntermediationFinding, 'source' | 'review'>) => {
        const r = f.reviews.get(x.id);
        out.push({ ...x, source: r ? 'human' : 'proposed', ...(r ? { review: { decision: r.decision, ...(r.note ? { note: r.note } : {}), ...(r.reviewedAt ?? r.updatedAt ? { at: r.reviewedAt ?? r.updatedAt } : {}), ...(r.updatedBy ? { by: r.updatedBy } : {}) } } : {}) });
    };

    add({
        id: 'data_offering_public', kind: 'data_offering_public', code: 'di-data-offering-public',
        count: f.dataOfferings.length, items: cap(f.dataOfferings.map(o => ({ offering_id: o.offeringId, title: o.title, provider: o.providerOwner, kind: o.kind }))),
        reason: f.dataOfferings.length
            ? `${f.dataOfferings.length} EXCHANGE offering(s) deliver data and are listed to everyone. A marketplace where anyone lists data for anyone is the regulation's own example of data intermediation.`
            : 'No EXCHANGE offering that delivers data is listed to everyone.',
        regulation: [DGA_REFS.marketplace, DGA_REFS.art10a],
    });
    add({
        id: 'contract_outside_buyer', kind: 'contract_outside_buyer', code: 'di-contract-outside-buyer',
        count: f.outsideContracts.length, items: cap(f.outsideContracts.map(c => ({ entitlement_id: c.entitlementId, provider: c.provider, buyer: c.buyer, buyer_kind: c.buyerKind, capability: c.capability }))),
        reason: f.outsideContracts.length
            ? `${f.outsideContracts.length} contract(s) sell data to a buyer of another account or an outside party, and this node keeps the contract. A service that knows of the commercial relationship it set up is more than a technical tool.`
            : 'No contract sells data to a buyer of another account or an outside party.',
        regulation: [DGA_REFS.def, DGA_REFS.marketplace],
    });
    for (const o of f.openOrganisms) {
        add({
            id: `open_organism_with_data:${o.id}`, kind: 'open_organism_with_data', code: 'di-open-organism-with-data',
            count: o.packages.length, items: cap(o.packages.map(p => ({ organism_id: o.id, organism: o.name, package_id: p }))),
            reason: `Anyone may join the organism "${o.name}", and ${o.packages.length} data package(s) are shared to its members. A data sharing group open to everyone is not a closed group; one that asks for approval can be.`,
            regulation: [DGA_REFS.marketplace, DGA_REFS.closedGroup],
            proposal: {
                action: 'require_approval',
                text: `The organism's creator or an admin changes who may join to "approval required". The node does not change it by itself.`,
                request: { method: 'PUT', url: `/v1/organisms/${encodeURIComponent(o.id)}`, body: { join_policy: 'approval_required' } },
            },
        });
    }
    if (!f.openOrganisms.length) {
        add({ id: 'open_organism_with_data', kind: 'open_organism_with_data', code: 'di-open-organism-with-data', count: 0, items: [],
            reason: 'No organism that anyone may join has data packages shared to its members.', regulation: [DGA_REFS.closedGroup] });
    }
    add({
        id: 'app_open_registration_commerce', kind: 'app_open_registration_commerce', code: 'di-app-open-registration',
        count: f.appsOpenRegistration.length, items: cap(f.appsOpenRegistration.map(a => ({ app: a.app, owner: a.owner }))),
        reason: f.appRegistrationSettingPresent
            ? (f.appsOpenRegistration.length ? `${f.appsOpenRegistration.length} app(s) let outside parties register and sell to them: the app's owner may be the provider of a marketplace.` : 'No app lets outside parties register and sell to them.')
            : 'No app can let outside parties register on this node yet, so none runs an open marketplace of its own.',
        regulation: [DGA_REFS.marketplace],
    });
    add({
        id: 'priced_named_share', kind: 'priced_named_share', code: 'di-priced-named-share',
        count: f.pricedShares.length, items: cap(f.pricedShares.map(s => ({ share_id: s.id, owner: s.owner, package: s.package }))),
        reason: f.pricedShares.length
            ? `${f.pricedShares.length} named share(s) to an outside party carry a price, and this node knows of the sale.`
            : 'No named share to an outside party carries a price. A free share to a named recipient is a technical tool of the data holder.',
        regulation: [DGA_REFS.marketplace],
    });
    for (const p of f.personParties) {
        add({
            id: `person_party_contact:${p.owner}`, kind: 'person_party_contact', code: 'di-person-party-contact', owner: p.owner,
            count: p.count, items: [{ owner: p.owner, persons: p.count }],
            reason: `${p.count} outside part${p.count === 1 ? 'y is a person' : 'ies are persons'} with a contact. The contact is personal data the account holds, and the account is its controller: it belongs in that account's records of processing.`,
            regulation: [DGA_REFS.art10b],
            proposal: { action: 'record_processing', text: 'Add the outside parties to the records of processing (the compliance document "registers" of the organism or app they are kept for): who they are, why their contact is kept, and until when. Delete a party when nothing is shared with it any more.' },
        });
    }
    if ((f.mode === 'node' && !f.nodeNotification) || (f.mode === 'owners' && !f.providers.length && !f.nodeNotification)) {
        add({
            id: 'notification_missing', kind: 'notification_missing', code: 'di-notification-missing', count: 1, items: [],
            reason: f.mode === 'node'
                ? 'This node is set to provide a data intermediation service, and no notification record is kept. A provider notifies the authority before it starts.'
                : 'This node lets declared providers run marketplaces, and no owner or organism has declared itself one.',
            regulation: [DGA_REFS.art11],
            proposal: { action: 'record_notification', text: 'Record the notification: the legal person, its business id, when it notified the authority and the reference it got.', request: { method: 'PUT', url: '/v1/compliance/docs/intermediation' } },
        });
    }
    if (f.mode === 'node' && f.exchangedPackages.length && f.nodeAiReadsFiles) {
        add({
            id: 'node_ai_reads_exchanged_data', kind: 'node_ai_reads_exchanged_data', code: 'di-node-ai-reads-exchanged', count: f.exchangedPackages.length,
            items: cap(f.exchangedPackages.map(p => ({ offering_id: p.offeringId, title: p.title }))),
            reason: 'Data packages are sold on EXCHANGE while this node classifies stored files, which reads their contents. A provider uses the data it intermediates only to put it at the users\' disposal.',
            regulation: [{ act: '2022/868', ref: 'art. 12(a)', text: 'The provider does not use the data it intermediates for any purpose other than putting it at the disposal of data users.' }],
        });
    }
    return out;
}
