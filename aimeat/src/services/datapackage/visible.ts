/**
 * @file src/services/datapackage/visible.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data packages one caller may open, by reach (plan doc-mvwxcas3dom3, WP11; design
 *   canvas "Jaettu data"). ONE function decides what a listing of data packages names: the library
 *   (GET /v1/catalogue/knowledge?reach=...), the owner's "Data you share" (GET /v1/datapackages/shared,
 *   aimeat_dataproduct action "shared"), the discovery source (services/discovery/sources/dataset-source.ts)
 *   and the operator's list in the compliance report (./shared-data.ts nodeSharedData) all call
 *   visiblePackages, so a list never names a package the read would refuse.
 *
 *   THE REACHES.
 *     public   the packages anyone may read: audience public, not withdrawn, through the anonymous
 *              classification reader (what GET /v1/catalogue/dcat lists). Empty on a node that shows its
 *              content to signed-in accounts only.
 *     shared   another account's packages this caller may read: audience members or organism:<id> that
 *              the audience check admits; for a visitor from another AIMEAT node, the live named shares
 *              to exactly their home GHII (services/parties/visitor-read.ts reads the same shares).
 *     own      the caller's account's packages, any audience, that the caller may read (an agent without
 *              storage:read does not see a private one, as GET /v1/datapackages/{owner}/{name} refuses it).
 *     party    an outside party's live shares: the packages its shares name, of the owner who shared them.
 *     node     every package of the node, for the operator's compliance list only; the caller has
 *              checked the operator before it asks (viewer.operator).
 *
 *   THE DECISION is the read's own: the audience the service recorded (./audience-record.ts
 *   trustedAudienceOf, never the pointer an app can rewrite), then ./audience.ts datapackageReadable with
 *   the caller's roles and scopes. A withdrawn package is never listed. The audiences of the node's
 *   packages are read once and cached with the catalogue scan (./catalogue-facts.ts), dropped on the same
 *   memory, file and catalogue changes.
 * @structure PackageReach · PACKAGE_REACHES · PackageViewer · VisibleWhy · VisiblePackage · trustedAudiences ·
 *   visiblePackages · viewerOf · shareRow · versionFacts
 * @usage const rows = await visiblePackages(deps, viewerOf(config, req.auth), 'shared');
 * @version-history
 *   2026-11-08 — A party's and a visitor's shares are listed through the reader the read builds from the
 *     same share (publicOnly, the pin, the versions of a purchased interface), and a row carries the facts
 *     of the version that read serves (secaudit2026nov08 round 14,
 *     datapackage:visible:party-listing-reader-omits-share-limits).
 *   2026-11-04 — The cached audiences carry MEMORY_ANY_LEVEL_TAG: they read audience records of every
 *     level (codebase analysis 2026-11-03, item C4).
 *   v1.0.0 — 2026-11-02 — Initial (WP11, plan doc-mvwxcas3dom3; design canvas "Jaettu data").
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import { cached, MEMORY_ANY_LEVEL_TAG, TTL } from '../cache.js';
import { signedInOnly } from '../../config-visibility.js';
import { readerFor } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';
import { resolveIdentity, isForeignPrincipal, ownerGhiiOf } from '../../utils/gaii.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { parseAudience } from '../audience.js';
import { allDatasetFacts, csvUrlOf, DATASET_FACTS_CACHE_KEY, type DatasetFacts } from './catalogue-facts.js';
import { datapackageReadable, readsAsPackageOwner, type DatapackageReader } from './audience.js';
import { audienceRecordsInPlace, trustedAudienceOf } from './audience-record.js';
import { i18nTitles, licenseOf, readPointer } from './version-audience.js';
import { bare, packageId, type Descriptor } from './contract.js';
import { openPackage } from './store.js';
import { contractVersionHashes } from '../exchange-datapackage.js';
import { isLiveShare, packageOfPattern, partySharesOf, shareMetaOf, standingShares } from '../parties/shares.js';
import { shareOfUnversionedRead, shareReader } from '../parties/read-gate.js';
import type { PartyContext } from '../parties/verify.js';

type Deps = { storage: Storage; config: AimeatConfig };

export const PACKAGE_REACHES = ['public', 'shared', 'own', 'party', 'node'] as const;
export type PackageReach = typeof PACKAGE_REACHES[number];

/** Who asks. Built by viewerOf for a session, or by the route that verified a party. */
export interface PackageViewer {
    /** The token's facts as the audience check reads them; null for a reader with no session. */
    reader: DatapackageReader | null;
    /** The account the caller acts in, as a GHII: set for an account of this node. */
    ownerGhii?: string;
    /** A visitor from another AIMEAT node: their home GHII. */
    visitorGhii?: string;
    /** An outside party verified on this request (services/parties/verify.ts). */
    party?: PartyContext;
    /** The caller is the node's operator, checked by the route: only then does reach `node` list anything. */
    operator?: boolean;
}

/** Why this viewer sees a package. */
export type VisibleWhy =
    | { kind: 'public' }
    | { kind: 'members' }
    | { kind: 'organism'; organism_id: string }
    | { kind: 'own' }
    | { kind: 'share'; share_id: string; expires: string | null }
    | { kind: 'node' };

/** One package this viewer may open, with the audience the service recorded and why it is listed. */
export interface VisiblePackage {
    facts: DatasetFacts;
    /** public, members, organism:<id> or private. */
    audience: string;
    why: VisibleWhy;
    /** The live shares that admit this viewer (reach shared for a visitor, reach party). */
    shares?: ConsentRecord[];
}

/** The viewer of a verified session (or of none). An anonymous token reads as nobody. */
export function viewerOf(config: Pick<AimeatConfig, 'nodeId'>, auth: DatapackageReader | null | undefined): PackageViewer {
    if (!auth || isAnonymousPrincipal(auth)) return { reader: null };
    if (isForeignPrincipal(auth)) return { reader: auth, visitorGhii: resolveIdentity(auth as Parameters<typeof resolveIdentity>[0], config.nodeId) };
    const principal = resolveIdentity(auth as Parameters<typeof resolveIdentity>[0], config.nodeId);
    return { reader: auth, ownerGhii: ownerGhiiOf(principal) };
}

const TRUSTED_CACHE_KEY = `${DATASET_FACTS_CACHE_KEY}:trusted`;
const READ_CHUNK = 50;

interface TrustedFacts { visibility: string | undefined; withdrawn: boolean }

/**
 * The audience the service recorded for every catalogued package, keyed `${ownerGhii}|${name}`. Once the
 * boot step has recorded the existing packages, the record alone decides and no pointer file is read;
 * before it, the pointer, as the read itself does then.
 */
export async function trustedAudiences(deps: Deps): Promise<Map<string, TrustedFacts>> {
    return cached(TRUSTED_CACHE_KEY, TTL.catalogue, async () => {
        const { storage, config } = deps;
        const facts = await allDatasetFacts(storage);
        const inPlace = await audienceRecordsInPlace(storage, config.nodeId);
        const out = new Map<string, TrustedFacts>();
        for (let i = 0; i < facts.length; i += READ_CHUNK) {
            await Promise.all(facts.slice(i, i + READ_CHUNK).map(async f => {
                const pointer = inPlace ? null : await readPointer(deps, f.ownerGhii, f.name);
                const t = await trustedAudienceOf(storage, config.nodeId, f.ownerGhii, f.name, pointer);
                out.set(`${f.ownerGhii}|${f.name}`, { visibility: t.visibility, withdrawn: !!t.withdrawnAt });
            }));
        }
        return out;
    }, ['domain:memory', MEMORY_ANY_LEVEL_TAG, 'domain:files', 'domain:catalogue']);
}

const audienceWord = (visibility: string | undefined): string => visibility ?? 'public';

/** Why a package of another account is visible on its audience: members or the organism. */
function audienceWhy(audience: string): VisibleWhy {
    const a = parseAudience(audience);
    if (a?.level === 'organism' && a.organismId) return { kind: 'organism', organism_id: a.organismId };
    if (a?.level === 'members') return { kind: 'members' };
    return { kind: 'public' };
}

/** The packages `viewer` may open at `reach`, newest first. */
export async function visiblePackages(deps: Deps, viewer: PackageViewer, reach: PackageReach): Promise<VisiblePackage[]> {
    const { storage, config } = deps;
    const all = await allDatasetFacts(storage);
    const trusted = await trustedAudiences(deps);
    const live = (f: DatasetFacts): TrustedFacts | null => {
        const t = trusted.get(`${f.ownerGhii}|${f.name}`);
        return t && !t.withdrawn ? t : null;
    };
    const shown = (list: VisiblePackage[], reader: DatapackageReader | null) =>
        readerFor({ storage, config }, reader as Parameters<typeof readerFor>[1]).show(list, v => memoryTarget(v.facts.ownerGhii, v.facts.manifestKey));

    switch (reach) {
        case 'public': {
            if (signedInOnly(config)) return [];
            const list = all.flatMap(f => {
                const t = live(f);
                return t && audienceWord(t.visibility) === 'public' ? [{ facts: f, audience: 'public', why: { kind: 'public' } as VisibleWhy }] : [];
            });
            // What a reader with no account sees, whoever asks: the anonymous classification reader.
            return shown(list, null);
        }
        case 'own': {
            const own = viewer.ownerGhii;
            if (!own) return [];
            const out: VisiblePackage[] = [];
            for (const f of all.filter(x => x.ownerGhii === own)) {
                const t = live(f);
                if (!t) continue;
                if (!readsAsPackageOwner(own, viewer.reader) && !(await datapackageReadable(storage, f.ownerGhii, t.visibility, viewer.reader, f.name))) continue;
                out.push({ facts: f, audience: audienceWord(t.visibility), why: { kind: 'own' } });
            }
            return shown(out, viewer.reader);
        }
        case 'shared': {
            if (viewer.visitorGhii) return visitorShares(deps, viewer.visitorGhii, all, live);
            const own = viewer.ownerGhii;
            if (!own) return [];
            const out: VisiblePackage[] = [];
            for (const f of all) {
                if (f.ownerGhii === own) continue;
                const t = live(f);
                const audience = t ? audienceWord(t.visibility) : '';
                if (!t || (audience !== 'members' && !audience.startsWith('organism:'))) continue;
                if (!(await datapackageReadable(storage, f.ownerGhii, t.visibility, viewer.reader, f.name))) continue;
                out.push({ facts: f, audience, why: audienceWhy(audience) });
            }
            return shown(out, viewer.reader);
        }
        case 'party': {
            const ctx = viewer.party;
            if (!ctx) return [];
            const shares = await standingShares(storage, ctx.ownerGhii, (await partySharesOf(storage, ctx.ownerGhii, ctx.party, config.nodeId))
                .filter(c => !ctx.keyShare || c.id === ctx.keyShare));
            const out: VisiblePackage[] = [];
            for (const f of all.filter(x => x.ownerGhii === ctx.ownerGhii)) {
                const t = live(f);
                const mine = shares.filter(c => packageOfPattern(c.dataPattern) === f.name);
                if (!t || !mine.length) continue;
                const row = await shareRow(deps, ctx.partyRef, f, t, mine);
                if (row) out.push(row);
            }
            return out;
        }
        case 'node': {
            if (!viewer.operator) return [];
            return all.flatMap(f => {
                const t = live(f);
                return t ? [{ facts: f, audience: audienceWord(t.visibility), why: { kind: 'node' } as VisibleWhy }] : [];
            });
        }
    }
}

/**
 * A visitor's shares: on each owner that has a package, the live named shares to exactly this home
 * GHII with `visitor` in their metadata, as services/parties/visitor-read.ts admits them on a read.
 */
async function visitorShares(
    deps: Deps, visitorGhii: string, all: DatasetFacts[], live: (f: DatasetFacts) => TrustedFacts | null,
): Promise<VisiblePackage[]> {
    const out: VisiblePackage[] = [];
    for (const owner of new Set(all.map(f => f.ownerGhii))) {
        const shares = (await deps.storage.listConsents(owner, { recipient: visitorGhii }))
            .filter(c => c.recipient === visitorGhii && shareMetaOf(c).visitor === true && isLiveShare(c));
        if (!shares.length) continue;
        for (const f of all.filter(x => x.ownerGhii === owner)) {
            const t = live(f);
            const mine = shares.filter(c => packageOfPattern(c.dataPattern) === f.name);
            if (!t || !mine.length) continue;
            const row = await shareRow(deps, visitorGhii, f, t, mine);
            if (row) out.push(row);
        }
    }
    return out;
}

/**
 * The row of a package a party or a visitor reads through `mine`, its live shares of that package, or
 * null when the read through them is refused. The share and the reader are the read's own
 * (services/parties/read-gate.ts shareOfUnversionedRead, shareReader): its pin, the versions of a
 * purchased interface and `publicOnly`. The row's facts are those of the version a read that names no
 * version serves, so a share pinned to an earlier version, or bound to an earlier interface, does not
 * show the newest version's description, tables and row counts.
 */
async function shareRow(deps: Deps, sub: string, f: DatasetFacts, t: TrustedFacts, mine: ConsentRecord[]): Promise<VisiblePackage | null> {
    const { storage, config } = deps;
    const share = shareOfUnversionedRead(mine);
    const meta = shareMetaOf(share);
    const versions = meta.contract ? await contractVersionHashes(storage, f.ownerGhii, f.name, meta.contract.ifaceVersion) : undefined;
    if (versions && !versions.length) return null;
    const reader = shareReader(sub, f.ownerGhii, f.name, share, versions);
    if (!(await datapackageReadable(storage, f.ownerGhii, t.visibility, reader, f.name))) return null;
    const served = meta.pinnedVersion ?? versions?.[0];
    let facts = f;
    if (served && bare(served) !== bare(f.contentHash)) {
        const opened = await openPackage(deps, `${packageId(f.owner, f.name)}@sha256:${bare(served)}`, config.nodeId, reader);
        if (!opened) return null;
        facts = versionFacts(f, opened.descriptor, opened.descriptorUrl);
    }
    return { facts, audience: audienceWord(t.visibility), why: { kind: 'share', share_id: share.id, expires: share.expires ?? null }, shares: mine };
}

/** The listing facts of one stored version, in place of the newest version's (`f`). */
function versionFacts(f: DatasetFacts, d: Descriptor, descriptorUrl: string): DatasetFacts {
    const out: DatasetFacts = {
        ...f,
        title: d.title ?? d.name,
        keywords: [...new Set([d.name, ...(d.keywords ?? [])])],
        contentHash: d.aimeat.contentHash,
        descriptorUrl,
        resources: d.resources.map(r => ({
            name: r.name, rowCount: r.rowCount, fields: r.schema.fields.length, bytes: r.bytes,
            ...(r.title ? { title: r.title } : {}),
            csvUrl: csvUrlOf(descriptorUrl, r.name),
        })),
        modified: d.created,
    };
    // The words of this version, never the newest version's.
    delete out.description;
    delete out.i18n;
    delete out.license;
    const i18n = i18nTitles(d);
    const license = licenseOf(d);
    if (d.description) out.description = d.description;
    if (i18n) out.i18n = i18n;
    if (license) out.license = license;
    return out;
}
