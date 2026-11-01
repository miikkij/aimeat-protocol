/**
 * @file src/services/dataspace/catalog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DSP catalog of this node for one participant (plan doc-mvwxcas3dom3, D8.2): the
 *   data packages that participant may see, each a Dataset with its Offers and one pull Distribution.
 *
 *   WHAT A PARTICIPANT SEES. A package is a Dataset for it when at least one offer stands:
 *     open      the package is public (the same list the DCAT feed reads, services/datapackage/
 *               catalogue-facts.ts publicDatasetFacts), and the data intermediation setting lets data
 *               be offered openly (services/data-intermediation/gate.ts);
 *     share     the owner shared the package by name with this participant's party (a live share);
 *     exchange  the package is listed on EXCHANGE with a money price, and the gate lets it be listed.
 *   A withdrawn package is no Dataset. A package of an owner who neither published it publicly, shared
 *   it with the participant nor listed it is not there at all, and its id answers 404.
 *
 *   THE SHAPE. A Catalog with `participantId` (this node), one DataService whose endpointURL is the DSP
 *   base, and `dataset` only when there is one (its schema has minItems 1). A Dataset carries `dct:title`,
 *   `dct:description`, `dct:license` and `dcat:keyword` when the package states them, its Offers
 *   (./policy.ts) and the Distribution `HttpData-PULL` through that DataService.
 * @structure DatasetView · OfferEntry · visibleDatasets · datasetFor · datasetJson · catalogJson · offerById ·
 *   CATALOG_PAGE
 * @usage const list = await visibleDatasets(deps, participant); res.json(catalogJson(config, list));
 * @version-history
 *   v1.0.1 — 2026-11-01 — A package's existence, withdrawal and usage terms come from the service's
 *     records, not the latest.json pointer (WP9e, incident ...-mvxozs2r).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.2).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName } from '../../utils/gaii.js';
import { publicDatasetFacts } from '../datapackage/catalogue-facts.js';
import { trustedPackageOf } from '../datapackage/audience-record.js';
import { saleTermsOf } from '../datapackage/sale-terms-record.js';
import { descriptorFor, isLiveShare, packageOfPattern, partySharesOf } from '../parties/shares.js';
import { listOfferings, type Offering } from '../exchange-market.js';
import { dataListingRefusal } from '../data-intermediation/gate.js';
import type { PartyRecord } from '../parties/contract.js';
import { DSP_CONTEXT, DSP_PATH, PULL_FORMAT, datasetIdOf, offerIdOf, parseDatasetId, type OfferKind } from './contract.js';
import { offerOf, type PricedTerms } from './policy.js';
import { findParticipantParty, participantParties } from './participant.js';
import { nodeParticipantId } from './settings.js';
import type { Participant } from './verifier.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The most datasets one catalog page holds; a longer catalog is paged with the Link header. */
export const CATALOG_PAGE = 100;

/** One offer of a dataset, with what it stands on. */
export interface OfferEntry {
    offer: Record<string, unknown>;
    kind: OfferKind;
    /** The share id (share) or the offering id (exchange). */
    ref?: string;
    priced?: PricedTerms;
    /** The share's purpose and end (share), copied into the agreement's share. */
    purpose?: string;
    expires?: string | null;
}

/** A dataset as this node offers it to one participant. */
export interface DatasetView {
    id: string;
    ownerGhii: string;
    owner: string;
    name: string;
    title?: string;
    description?: string;
    keywords?: string[];
    license?: string;
    offers: OfferEntry[];
}

/** The pieces the offers of one package are made from, gathered once for a whole catalog. */
interface OfferSources {
    publicKeys: Set<string>;
    openAllowed: (owner: string) => Promise<boolean>;
    partyOf: (ownerGhii: string) => Promise<PartyRecord | undefined>;
    offerings: Offering[];
}

async function sourcesFor(deps: Deps, participant: Participant): Promise<OfferSources> {
    const pub = await publicDatasetFacts(deps.config, deps.storage);
    const gate = new Map<string, boolean>();
    const parties = new Map<string, PartyRecord | undefined>();
    return {
        publicKeys: new Set(pub.map(f => `${f.owner}/${f.name}`)),
        openAllowed: async (owner) => {
            if (!gate.has(owner)) gate.set(owner, !(await dataListingRefusal(deps, { providerOwner: owner, kind: 'datapackage', deliversData: true })));
            return gate.get(owner)!;
        },
        partyOf: async (ownerGhii) => {
            if (!parties.has(ownerGhii)) parties.set(ownerGhii, await findParticipantParty(deps.storage, ownerGhii, participant.id));
            return parties.get(ownerGhii);
        },
        offerings: (await listOfferings(deps.storage)).filter(o => o.kind === 'datapackage' && o.surface?.kind === 'datapackage' && o.unit === 'money'),
    };
}

/** The offers of one package for the participant, or [] (the package is then no Dataset for it). */
async function offersOf(deps: Deps, src: OfferSources, ownerGhii: string, name: string): Promise<{ offers: OfferEntry[]; view?: Omit<DatasetView, 'offers'> }> {
    const owner = localAccountName(ownerGhii);
    // Existence, withdrawal and usage terms are the service's records, never the pointer file an app
    // with storage:write rewrites (services/datapackage/audience-record.ts, sale-terms-record.ts).
    const pkg = await trustedPackageOf(deps.storage, deps.config.nodeId, ownerGhii, name);
    if (!pkg?.trusted.current || pkg.trusted.withdrawnAt) return { offers: [] };
    const usage = (await saleTermsOf(deps.storage, deps.config.nodeId, ownerGhii, name, pkg.pointer))?.usageTerms ?? null;
    const offers: OfferEntry[] = [];
    if (src.publicKeys.has(`${owner}/${name}`) && await src.openAllowed(owner)) {
        offers.push({ kind: 'open', offer: offerOf(offerIdOf(owner, name, 'open'), { usage }) });
    }
    const party = await src.partyOf(ownerGhii);
    if (party && party.status === 'active') {
        for (const s of await partySharesOf(deps.storage, ownerGhii, party, deps.config.nodeId)) {
            if (!isLiveShare(s) || packageOfPattern(s.dataPattern) !== name) continue;
            // A share an agreement made is the agreement's own; it is not offered again.
            if ((s.metadata as Record<string, unknown> | undefined)?.dspAgreement) continue;
            offers.push({
                kind: 'share', ref: s.id, purpose: s.purpose, expires: s.expires,
                offer: offerOf(offerIdOf(owner, name, 'share', s.id), { usage, purpose: s.purpose, expires: s.expires }),
            });
        }
    }
    for (const o of src.offerings) {
        if (o.providerGhii !== ownerGhii || o.surface?.kind !== 'datapackage' || o.surface.packageName !== name) continue;
        if (!(await src.openAllowed(owner))) continue;
        const priced: PricedTerms = {
            amount: o.surface.model === 'per_month' ? (o.plans.find(p => p.id === 'per_month' && p.model === 'subscription') as { periodPrice?: number } | undefined)?.periodPrice ?? o.basePrice : o.basePrice,
            currency: o.currency ?? 'EUR', model: o.surface.model, offeringId: o.offeringId,
        };
        offers.push({ kind: 'exchange', ref: o.offeringId, priced, offer: offerOf(offerIdOf(owner, name, 'exchange', o.offeringId), { usage: o.usageTerms ?? usage, priced }) });
    }
    if (!offers.length) return { offers };
    const d = await descriptorFor(deps.storage, ownerGhii, name);
    const license = d?.aimeat.license ?? d?.licenses?.[0]?.name;
    return {
        offers,
        view: {
            id: datasetIdOf(owner, name), ownerGhii, owner, name,
            ...(d?.title ? { title: d.title } : {}), ...(d?.description ? { description: d.description } : {}),
            ...(d?.keywords?.length ? { keywords: d.keywords } : {}), ...(license ? { license } : {}),
        },
    };
}

/** Every dataset the participant may see, newest package first within each owner. */
export async function visibleDatasets(deps: Deps, participant: Participant): Promise<DatasetView[]> {
    const src = await sourcesFor(deps, participant);
    const candidates = new Map<string, { ownerGhii: string; name: string }>();
    const add = (ownerGhii: string, name: string) => candidates.set(`${ownerGhii}|${name}`, { ownerGhii, name });
    for (const f of await publicDatasetFacts(deps.config, deps.storage)) add(f.ownerGhii, f.name);
    for (const { ownerGhii, party } of await participantParties(deps.storage, participant.id)) {
        for (const s of await partySharesOf(deps.storage, ownerGhii, party, deps.config.nodeId)) {
            const pkg = packageOfPattern(s.dataPattern);
            if (pkg && isLiveShare(s)) add(ownerGhii, pkg);
        }
    }
    for (const o of src.offerings) if (o.surface?.kind === 'datapackage') add(o.providerGhii, o.surface.packageName);
    const out: DatasetView[] = [];
    for (const { ownerGhii, name } of candidates.values()) {
        const { offers, view } = await offersOf(deps, src, ownerGhii, name);
        if (view && offers.length) out.push({ ...view, offers });
    }
    return out;
}

/** One dataset by id for the participant, or null when it does not exist or is not offered to it. */
export async function datasetFor(deps: Deps, participant: Participant, id: string): Promise<DatasetView | null> {
    const parsed = parseDatasetId(id);
    if (!parsed) return null;
    const ownerGhii = `${parsed.owner}@${deps.config.nodeId}`;
    const src = await sourcesFor(deps, participant);
    const { offers, view } = await offersOf(deps, src, ownerGhii, parsed.name);
    return view && offers.length ? { ...view, offers } : null;
}

/** The offer of a dataset with this id, or null. */
export function offerById(ds: DatasetView, offerId: string): OfferEntry | null {
    return ds.offers.find(o => o.offer['@id'] === offerId) ?? null;
}

const serviceId = (config: Pick<AimeatConfig, 'baseUrl'>): string => `${config.baseUrl.replace(/\/+$/, '')}${DSP_PATH}#data-service`;

/** The DataService every distribution names. */
function dataService(config: Pick<AimeatConfig, 'baseUrl'>): Record<string, unknown> {
    return { '@id': serviceId(config), '@type': 'DataService', endpointURL: `${config.baseUrl.replace(/\/+$/, '')}${DSP_PATH}` };
}

/** A Dataset body: inside a Catalog without its own context, alone with it. */
export function datasetJson(config: Pick<AimeatConfig, 'baseUrl'>, ds: Pick<DatasetView, 'id' | 'title' | 'description' | 'keywords' | 'license' | 'offers'>, root = false): Record<string, unknown> {
    return {
        ...(root ? { '@context': [DSP_CONTEXT] } : {}),
        '@id': ds.id, '@type': 'Dataset',
        ...(ds.title ? { 'dct:title': ds.title } : {}),
        ...(ds.description ? { 'dct:description': ds.description } : {}),
        ...(ds.keywords?.length ? { 'dcat:keyword': ds.keywords } : {}),
        ...(ds.license ? { 'dct:license': ds.license } : {}),
        hasPolicy: ds.offers.map(o => o.offer),
        distribution: [{ '@type': 'Distribution', format: PULL_FORMAT, accessService: serviceId(config) }],
    };
}

/** A Catalog body for one page of datasets. */
export function catalogJson(
    config: Pick<AimeatConfig, 'baseUrl' | 'nodeId'> & Partial<Pick<AimeatConfig, 'dataspaceParticipantId'>>,
    datasets: Array<Pick<DatasetView, 'id' | 'title' | 'description' | 'keywords' | 'license' | 'offers'>>,
): Record<string, unknown> {
    return {
        '@context': [DSP_CONTEXT],
        '@id': `urn:aimeat:catalog:${config.nodeId}`,
        '@type': 'Catalog',
        participantId: nodeParticipantId(config),
        service: [dataService(config)],
        ...(datasets.length ? { dataset: datasets.map(d => datasetJson(config, d)) } : {}),
    };
}
