/**
 * @file src/services/datapackage/shared-data.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person shares as data, and who reads it (plan doc-mvwxcas3dom3, WP11; design canvas
 *   "Jaettu data", boards Jakamasi-data, Chat and Admin-aineistot). Built on ./visible.ts visiblePackages,
 *   so the owner's page, the owner's AI and the operator's list name exactly what the read decides.
 *
 *   sharedDataOf (reach own): per package its title and words per language, audience, licence,
 *   freshness, size, its live named shares (who, kind, until, last read, reads in 30 days), whether it is
 *   for sale on EXCHANGE, how many data space participants hold a share, and its served reads in 30
 *   days; then the filter counts (all, public, named shares, for sale, data space), the shares to people
 *   as one list, and the readers from the party read log (services/parties/read-stats.ts). GET
 *   /v1/datapackages/shared and aimeat_dataproduct action "shared" answer it.
 *
 *   nodeSharedData (reach node): the operator's list behind the four figures of the compliance report's
 *   section 12: per package its name, owner, audience, licence, readers in 30 days and freshness, and
 *   whether an EXCHANGE data offering lists it, how many outside buyers hold a contract on it, and whether
 *   it is shared to an organism anyone may join. Never a row of data and never a named recipient: a
 *   named share is counted, not named.
 *
 *   A public read with no account is not logged anywhere on this node, so the readers are the outside
 *   parties and the visitors from other nodes, whose reads the party read log keeps.
 * @structure SharedShareRow · SharedPackageRow · SharedDataView · sharedDataOf · sharedDataForCaller · NodeSharedRow · nodeSharedData ·
 *   SHARED_FILTERS · NODE_ROW_CAP
 * @usage const view = await sharedDataOf(deps, viewerOf(config, req.auth));
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11, plan doc-mvwxcas3dom3; design canvas "Jaettu data").
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { datasetLandingUrl, type DatasetFacts } from './catalogue-facts.js';
import { visiblePackages, viewerOf, type PackageViewer } from './visible.js';
import type { CallerContext } from '../caller-context.js';
import { packageFreshness } from './freshness-read.js';
import { freshnessBrief, type FreshnessBrief } from './freshness.js';
import { saleTermsOf } from './sale-terms-record.js';
import { isLiveShare, isNamedShare, packageOfPattern, shareMetaOf } from '../parties/shares.js';
import { parsePartyRef } from '../parties/contract.js';
import { readParties } from '../parties/store.js';
import { readStats30, type ReadStats30 } from '../parties/read-stats.js';
import { DATAPRODUCT_KEY_PREFIX } from '../dataproduct/definition.js';
import { listOfferings } from '../exchange-market.js';
import { listAllEntitlements } from '../metered-entitlements.js';
import { offeringDeliversData } from '../data-intermediation/contract.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The owner page's filters, in the board's order after "all". */
export const SHARED_FILTERS = ['public', 'named', 'sale', 'space'] as const;
export type SharedFilter = typeof SHARED_FILTERS[number];

/** The most rows the operator's list carries; the count is always the whole. */
export const NODE_ROW_CAP = 500;

/** One live named share, as the owner reads it. */
export interface SharedShareRow {
    id: string;
    /** The party's name, or a visitor's home GHII. */
    party: string;
    party_name: string;
    party_kind: string;
    package: string;
    package_title: string;
    expires: string | null;
    last_read_at: string | null;
    reads_30d: number;
}

/** One package of the owner, with what the owner page and the owner's AI say about it. */
export interface SharedPackageRow {
    owner: string;
    name: string;
    package_id: string;
    title: string;
    description?: string;
    i18n?: Record<string, { title?: string; description?: string }>;
    license?: string;
    /** public, members, organism:<id> or private. */
    audience: string;
    organism_name?: string;
    freshness: FreshnessBrief | null;
    updated_at: string;
    tables: number;
    rows: number;
    /** A data product of the owner builds it: its page opens in the profile. */
    product: boolean;
    landing_url?: string;
    shares: SharedShareRow[];
    sale: boolean;
    /** Live shares to data space participants. */
    dataspace: number;
    reads_30d: number;
    last_read_at: string | null;
    filters: SharedFilter[];
}

export interface SharedDataView {
    packages: SharedPackageRow[];
    counts: Record<'all' | SharedFilter, number>;
    /** Every live named share, newest end last. */
    people: SharedShareRow[];
    /** Who read in the last 30 days, per reader and package. */
    readers: Array<{ who: string; kind: string; party?: string; package: string; package_title: string; last_read_at: string; reads_30d: number; via: string[] }>;
    reads_30d: number;
    /** What the owner's AI does next, and on which tool and route. */
    actions: Array<{ what: string; tool: string; route: string }>;
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

async function organismNames(storage: Storage, audiences: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of new Set(audiences.filter(a => a.startsWith('organism:')).map(a => a.slice('organism:'.length)))) {
        const org = await storage.getOrganism(id);
        if (org) out.set(id, org.name);
    }
    return out;
}

/** The facts every row carries, from the catalogue entry. */
function baseOf(baseUrl: string, f: DatasetFacts, audience: string, orgs: Map<string, string>) {
    const orgId = audience.startsWith('organism:') ? audience.slice('organism:'.length) : '';
    return {
        owner: f.owner, name: f.name, package_id: f.packageId, title: f.title,
        ...(f.description ? { description: f.description } : {}),
        ...(f.i18n ? { i18n: f.i18n } : {}),
        ...(f.license ? { license: f.license } : {}),
        audience,
        ...(orgId && orgs.get(orgId) ? { organism_name: orgs.get(orgId)! } : {}),
        updated_at: f.modified,
        tables: f.resources.length,
        rows: sum(f.resources.map(r => r.rowCount)),
        ...(audience === 'public' ? { landing_url: datasetLandingUrl(baseUrl, f.owner, f.name) } : {}),
    };
}

async function freshnessFor(deps: Deps, f: DatasetFacts): Promise<FreshnessBrief | null> {
    const fr = await packageFreshness(deps, f.ownerGhii, f.name, f.producerKind ? { schedule: f.schedule ?? '', producerKind: f.producerKind } : {});
    return fr ? freshnessBrief(fr) : null;
}

/** A live named share as a row: the party by its display name, a visitor by their home account. */
function shareRow(c: ConsentRecord, partyOf: Map<string, { displayName: string; kind: string }>, stats: ReadStats30, titles: Map<string, string>): SharedShareRow {
    const pkg = packageOfPattern(c.dataPattern) ?? c.dataPattern;
    const ref = parsePartyRef(c.recipient);
    const party = ref?.name ?? c.recipient;
    const p = ref ? partyOf.get(ref.name) : undefined;
    const st = stats.byShare.get(c.id);
    return {
        id: c.id, party, party_name: p?.displayName ?? (typeof c.metadata?.displayName === 'string' ? c.metadata.displayName : party),
        party_kind: shareMetaOf(c).visitor ? 'visitor' : p?.kind ?? 'program', package: pkg, package_title: titles.get(pkg) ?? pkg,
        expires: c.expires ?? null, last_read_at: st?.last_read_at ?? null, reads_30d: st?.reads_30d ?? 0,
    };
}

/** The owner's shared data: every package of the caller's account it may read, and who reads it. */
export async function sharedDataOf(deps: Deps, viewer: PackageViewer): Promise<SharedDataView> {
    const { storage, config } = deps;
    const ownerGhii = viewer.ownerGhii;
    const empty: SharedDataView = { packages: [], counts: { all: 0, public: 0, named: 0, sale: 0, space: 0 }, people: [], readers: [], reads_30d: 0, actions: [] };
    if (!ownerGhii) return empty;
    const visible = await visiblePackages(deps, viewer, 'own');
    const titles = new Map(visible.map(v => [v.facts.name, v.facts.title]));
    const orgs = await organismNames(storage, visible.map(v => v.audience));
    const stats = await readStats30(storage, ownerGhii);
    const { parties } = await readParties(storage, ownerGhii);
    const partyOf = new Map(parties.map(p => [p.name, { displayName: p.displayName, kind: p.kind }]));
    const now = Date.now();
    const live = (await storage.listConsents(ownerGhii, { status: 'active' })).filter(c => isNamedShare(c) && isLiveShare(c, now));
    const products = new Set((await storage.listMemory(ownerGhii, { prefix: DATAPRODUCT_KEY_PREFIX })).map(r => r.key.slice(DATAPRODUCT_KEY_PREFIX.length)));
    const people = live.map(c => shareRow(c, partyOf, stats, titles))
        .sort((a, b) => String(a.expires ?? '').localeCompare(String(b.expires ?? '')));

    const packages: SharedPackageRow[] = [];
    for (const v of visible) {
        const f = v.facts;
        const shares = people.filter(s => s.package === f.name);
        const sale = (await saleTermsOf(storage, config.nodeId, f.ownerGhii, f.name))?.exchange === true;
        const dataspace = live.filter(c => packageOfPattern(c.dataPattern) === f.name
            && (!!shareMetaOf(c).dspAgreement || partyOf.get(parsePartyRef(c.recipient)?.name ?? '')?.kind === 'dataspace')).length;
        const reads = stats.byPackage.get(f.name);
        const filters: SharedFilter[] = [];
        if (v.audience === 'public') filters.push('public');
        if (shares.some(s => s.party_kind !== 'dataspace')) filters.push('named');
        if (sale) filters.push('sale');
        if (dataspace) filters.push('space');
        packages.push({
            ...baseOf(config.baseUrl, f, v.audience, orgs),
            freshness: await freshnessFor(deps, f),
            product: products.has(f.name), shares, sale, dataspace,
            reads_30d: reads?.reads_30d ?? 0, last_read_at: reads?.last_read_at ?? null, filters,
        });
    }
    const count = (k: SharedFilter) => packages.filter(p => p.filters.includes(k)).length;
    const readers = stats.readers.map(r => {
        const visitor = r.uid.startsWith('visitor:');
        const p = visitor ? undefined : partyOf.get(r.party);
        return {
            who: visitor ? r.party : p?.displayName ?? r.party, kind: visitor ? 'visitor' : p?.kind ?? 'program',
            ...(visitor ? {} : { party: r.party }),
            package: r.package, package_title: titles.get(r.package) ?? r.package,
            last_read_at: r.last_read_at, reads_30d: r.reads_30d, via: r.what,
        };
    });
    return {
        packages,
        counts: { all: packages.length, public: count('public'), named: count('named'), sale: count('sale'), space: count('space') },
        people, readers, reads_30d: sum(packages.map(p => p.reads_30d)),
        actions: [
            { what: 'Stop one share: the next read through it is refused.', tool: 'aimeat_consent_revoke { consent_id }', route: 'DELETE /v1/consent/{id}' },
            { what: 'Build and publish a new version of a data product now.', tool: 'aimeat_dataproduct { action: "run", name }', route: 'POST /v1/dataproducts/{name}/run' },
            { what: 'Withdraw a package: every share ends and its addresses stop answering.', tool: 'aimeat_datapackage_withdraw', route: 'DELETE /v1/datapackages/{owner}/{name}' },
        ],
    };
}

/**
 * The shared data view for one caller, as GET /v1/datapackages/shared and aimeat_dataproduct action
 * "shared" answer it: the person in person, or their own agent holding storage:read (the route's and the
 * tool's catalog scope). The view names the owner's parties, so an app, an ecosystem app and a visitor
 * are refused, as the exposure report refuses them.
 */
export async function sharedDataForCaller(
    deps: Deps, caller: Pick<CallerContext, 'kind' | 'has' | 'auth'>,
): Promise<{ ok: true; data: SharedDataView } | { ok: false; status: 403; code: string; message: string }> {
    if (caller.kind !== 'owner' && caller.kind !== 'agent') {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'The shared data view covers the whole account and names who reads it; the person or their own agent reads it, an app or a visitor does not.' };
    }
    if (!caller.has('storage:read')) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: 'Reading what this account shares needs the "storage:read" permission.' };
    }
    return { ok: true, data: await sharedDataOf(deps, viewerOf(deps.config, caller.auth)) };
}

/** One package of the node in the operator's list: names, owner, audience and counts, never rows or recipients. */
export interface NodeSharedRow {
    title: string;
    /** `<owner>/<name>`. */
    name: string;
    owner: string;
    audience: string;
    organism_name?: string;
    /** Live named shares, counted. */
    named_shares: number;
    license?: string;
    readers_30d: number;
    freshness: string | null;
    /** A listed EXCHANGE offering that delivers data names this package. */
    offered: boolean;
    /** Contracts on it held by another account or an outside party. */
    outside_buyers: number;
    /** Shared to an organism anyone may join. */
    open_organism: boolean;
}

/**
 * The operator's list of the node's packages that someone other than the owner can read (an audience
 * wider than private, a live named share, or an EXCHANGE listing), with the counts section 12 asks.
 * The caller has checked the operator; `viewer.operator` says so to visiblePackages.
 */
export async function nodeSharedData(deps: Deps): Promise<{ rows: NodeSharedRow[]; total: number; capped: boolean }> {
    const { storage } = deps;
    const visible = await visiblePackages(deps, { reader: null, operator: true }, 'node');
    const orgs = await organismNames(storage, visible.map(v => v.audience));
    const open = new Set<string>();
    for (const id of orgs.keys()) {
        const org = await storage.getOrganism(id);
        if (org?.joinPolicy === 'open') open.add(id);
    }
    const offerings = (await listOfferings(storage)).filter(o => offeringDeliversData(o));
    const offered = new Set(offerings.flatMap(o => (o.surface?.kind === 'datapackage' ? [`${o.providerOwner}/${(o.surface as { packageName?: string }).packageName}`] : [])));
    const buyers = new Map<string, number>();
    for (const e of await listAllEntitlements(storage)) {
        if (e.state === 'revoked') continue;
        const s = e.surface as { kind?: string; packageName?: string } | null | undefined;
        if (s?.kind !== 'datapackage' || !s.packageName) continue;
        const provider = localAccountName(e.providerGhii);
        const party = e.consumerGaii.startsWith('party:');
        if (!party && localAccountName(e.consumerGaii) === provider) continue;
        const k = `${provider}/${s.packageName}`;
        buyers.set(k, (buyers.get(k) ?? 0) + 1);
    }
    const now = Date.now();
    const sharesByOwner = new Map<string, ConsentRecord[]>();
    const statsByOwner = new Map<string, ReadStats30>();
    const rows: NodeSharedRow[] = [];
    for (const v of visible) {
        const f = v.facts;
        if (!sharesByOwner.has(f.ownerGhii)) {
            sharesByOwner.set(f.ownerGhii, (await storage.listConsents(f.ownerGhii, { status: 'active' })).filter(c => isNamedShare(c) && isLiveShare(c, now)));
            statsByOwner.set(f.ownerGhii, await readStats30(storage, f.ownerGhii));
        }
        const named = sharesByOwner.get(f.ownerGhii)!.filter(c => packageOfPattern(c.dataPattern) === f.name).length;
        const key = `${f.owner}/${f.name}`;
        const isOffered = offered.has(key);
        if (v.audience === 'private' && !named && !isOffered) continue;
        const orgId = v.audience.startsWith('organism:') ? v.audience.slice('organism:'.length) : '';
        rows.push({
            title: f.title, name: key, owner: f.owner, audience: v.audience,
            ...(orgId && orgs.get(orgId) ? { organism_name: orgs.get(orgId)! } : {}),
            named_shares: named, ...(f.license ? { license: f.license } : {}),
            readers_30d: statsByOwner.get(f.ownerGhii)!.byPackage.get(f.name)?.reads_30d ?? 0,
            freshness: (await freshnessFor(deps, f))?.state ?? null,
            offered: isOffered, outside_buyers: buyers.get(key) ?? 0, open_organism: !!orgId && open.has(orgId),
        });
    }
    return { rows: rows.slice(0, NODE_ROW_CAP), total: rows.length, capped: rows.length > NODE_ROW_CAP };
}
