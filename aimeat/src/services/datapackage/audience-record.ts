/**
 * @file src/services/datapackage/audience-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audience of a data package and of each of its versions, as the datapackage
 *   service wrote it (secaudit2026oct31w2 round 10, datapackage:audience-trusts-client-writable-pointer).
 *
 *   WHY A RECORD OF ITS OWN. The audience used to be read from the package's `latest.json` pointer and
 *   from a tag on each version's descriptor file. Both are ordinary storage files: POST /v1/storage
 *   writes a pointer and PATCH /v1/memory/files/:key rewrites a tag, so a principal with storage:write
 *   could make a package's rows public with neither the publish gate nor a label cap asked. The
 *   record `datapkg-audience.<name>` sits in the package owner's memory under a service-owned prefix
 *   (utils/reserved-keys.ts SERVICE_OWNED_KEY_PREFIXES), which no memory route writes, restores or
 *   deletes for any principal. Only writeLatest (./version-audience.ts) writes it, on every publish,
 *   every re-publish of the same bytes under another audience and every approved publish request.
 *   The pointer and the tag are still written as before, so a reader of the files sees what it saw.
 *
 *   WHAT A READ TRUSTS. Once the node has recorded the packages that existed at the update (the boot
 *   step below), the package's audience, the version it points at and each version's audience come from
 *   the record. A pointer with no record behind it was not written by the service and reads as private:
 *   its owner and the owner's principals with storage:read read it, nobody else. So does a version the
 *   record does not name.
 *
 *   EXISTING PACKAGES KEEP THEIR AUDIENCE. recordDatapackageAudiencesOnce runs once per node before it
 *   serves (server-bootstrap/once-only-keep-steps.ts) and writes the record of every package that has
 *   a version, from its pointer and each version's descriptor file as they are at the update, by the
 *   rule the reads used then (versionAudienceAtUpdate). Until it has run (a start where it failed),
 *   reads take the pointer and the tags as before.
 *
 *   THE WITHDRAWAL. withdrawPackage (./withdraw.ts) records `withdrawnAt` on the record as well as on
 *   the pointer, and the next publish (writeLatest) writes the record without it. A read takes the
 *   package as withdrawn when the record or the pointer says so: a writer of the pointer can then only
 *   withdraw a package, which storage:write already lets it do, and never bring a withdrawn one back.
 *   The pointer's mark still counts for a package withdrawn before the record carried the mark;
 *   recordPointerStateOnce (./sale-terms-record.ts) copies those marks onto the records.
 *
 *   THE CONFIRMATION OF A PUBLIC PACKAGE FROM PERSONAL DATA (plan D1.7, ./personal-guard.ts). A publish
 *   that carried the owner's confirmation records it here, and every later version keeps it. The guard
 *   decides on the record's: a pointer an app rewrote with a confirmation skips no question. The
 *   pointer keeps a copy no decision reads; until recordPointerStateOnce has copied the existing
 *   pointers' confirmations, a recorded package without one takes its pointer's, as before.
 *
 *   OUTSIDE THE SERVICE. trustedPackageOf reads the pointer and answers it with the trusted facts, so
 *   a share, a sale, a data product source or the Dataspace catalogue decides on the record without
 *   reading the pointer itself; the pointer it hands back is for display fields only.
 * @structure AUDIENCE_RECORD_PREFIX · DATAPACKAGE_AUDIENCE_STEP_KEY · audienceRecordKey ·
 *   recordPackageAudience · recordPackageWithdrawal · recordPublicConfirmation · PublicConfirmation ·
 *   publicConfirmationOf · DATAPACKAGE_POINTER_STATE_STEP_KEY · pointerStateInForce · TrustedAudience ·
 *   trustedAudienceOf · trustedPackageOf · RecordedAudience · recordedAudiencesOf · packageNamespaces ·
 *   recordDatapackageAudiencesOnce
 * @usage
 *   const trusted = await trustedAudienceOf(storage, nodeId, ownerGhii, name, pointer);
 *   if (!(await datapackageReadable(storage, ownerGhii, trusted.visibility, reader))) return null;
 * @version-history
 *   2026-11-04 — No per-package getMemory for a storage without getMemoryByKeysAnyOwner: it is required
 *     on Storage (codebase analysis 2026-11-03, item D-e).
 *   v1.3.0 -- 2026-11-02 -- recordedAudiencesOf: the recorded audience and withdrawal of many packages in
 *     one bulk read, for the node-wide catalogue listing (secaudit2026nov02d round 13).
 *   v1.2.0 -- 2026-11-01 -- The record carries the owner's confirmation of a public package from personal
 *     data (`personalPublicConfirmed`, ./personal-guard.ts): recordPackageAudience writes it from the
 *     publish that carried it and keeps it on every later version; TrustedAudience answers it, and the
 *     pointer's copy counts only until the boot step copied the existing ones (pointerStateInForce)
 *     (WP9e, plan D1.7).
 *   v1.1.0 -- 2026-11-01 -- The record carries the withdrawal (recordPackageWithdrawal); TrustedAudience
 *     answers the current version (`current`) and the withdrawal (`withdrawnAt`); trustedPackageOf for
 *     the readers outside the service (WP9e, Lifecycle Central incidents ...-mvxmm7ex and ...-mvxozs2r).
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { withAudienceTag, recordedAudienceOf, fileVisibilityOf } from './audience.js';
import { bare, latestKey, type LatestPointer } from './contract.js';

/** The service-owned memory prefix the record lives under, in the package owner's namespace. */
export const AUDIENCE_RECORD_PREFIX = 'datapkg-audience.';

/** The record under `system@<nodeId>` that says the existing packages have been recorded. */
export const DATAPACKAGE_AUDIENCE_STEP_KEY = 'migrations.datapackage-audience';

/** One package's audience as the service wrote it. */
interface AudienceRecord {
    name: string;
    /** The package's audience: public, members, organism:<id> or private. */
    visibility: string;
    /** The version the package points at, `sha256:<hex>`. */
    current: string;
    /** Each version's own audience, by bare content hash. */
    versions: Record<string, string>;
    /** When the owner withdrew the package; absent once a version is published again. */
    withdrawnAt?: string;
    /** The confirmation that the package goes public although its producer's data map marks its data
     *  personal (./personal-guard.ts): written by a publish that carried it, kept on every later version. */
    personalPublicConfirmed?: PublicConfirmation;
}

/** A confirmation of a public package from personal data: when, and the principal whose request carried it. */
export type PublicConfirmation = { at: string; by: string };

export function audienceRecordKey(name: string): string {
    return `${AUDIENCE_RECORD_PREFIX}${name}`;
}

/** A confirmation as stored, or undefined when the value is not one. */
export function publicConfirmationOf(v: unknown): PublicConfirmation | undefined {
    const c = v as Partial<PublicConfirmation> | null | undefined;
    return c && typeof c === 'object' && typeof c.at === 'string' && c.at && typeof c.by === 'string' && c.by
        ? { at: c.at, by: c.by } : undefined;
}

function parseRecord(v: unknown): AudienceRecord | null {
    if (!v || typeof v !== 'object') return null;
    const r = v as Partial<AudienceRecord>;
    if (typeof r.visibility !== 'string' || typeof r.current !== 'string') return null;
    const versions = r.versions && typeof r.versions === 'object' ? r.versions : {};
    const confirmed = publicConfirmationOf(r.personalPublicConfirmed);
    return {
        name: String(r.name ?? ''), visibility: r.visibility, current: r.current, versions: { ...versions },
        ...(typeof r.withdrawnAt === 'string' && r.withdrawnAt ? { withdrawnAt: r.withdrawnAt } : {}),
        ...(confirmed ? { personalPublicConfirmed: confirmed } : {}),
    };
}

/**
 * Record that `name` points at `contentHash` with `visibility`, and that this version's audience is
 * `visibility`. Called by writeLatest before it moves the pointer, so a pointer never names a version
 * the record does not. A publish restores a withdrawn package, so the record it writes has no
 * `withdrawnAt`. `confirmed` is the confirmation this publish carried (./personal-guard.ts); without
 * one, the record keeps the confirmation it has, as the pointer kept it on every later version.
 */
export async function recordPackageAudience(
    storage: Storage, ownerGhii: string, name: string, contentHash: string, visibility: string,
    confirmed?: PublicConfirmation,
): Promise<void> {
    await updateRecord(storage, ownerGhii, audienceRecordKey(name), parseRecord, cur => {
        const keep = confirmed ?? cur?.personalPublicConfirmed;
        return {
            name,
            visibility,
            current: contentHash,
            versions: { ...(cur?.versions ?? {}), [bare(contentHash)]: visibility },
            ...(keep ? { personalPublicConfirmed: keep } : {}),
        };
    }, { tag: 'datapackage-audience', ttlHours: null });
}

/**
 * Record a confirmation an existing pointer carries onto the package's record (the boot step,
 * ./sale-terms-record.ts recordPointerStateOnce). A package with no record keeps none, and a record that
 * has a confirmation keeps its own. Answers whether this call wrote it.
 */
export async function recordPublicConfirmation(storage: Storage, ownerGhii: string, name: string, confirmed: PublicConfirmation): Promise<boolean> {
    let wrote = false;
    await updateRecord(storage, ownerGhii, audienceRecordKey(name), parseRecord, cur => {
        if (!cur || cur.personalPublicConfirmed) return UNCHANGED;
        wrote = true;
        return { ...cur, personalPublicConfirmed: confirmed };
    }, { tag: 'datapackage-audience', ttlHours: null });
    return wrote;
}

/**
 * Record that the owner withdrew `name` at `withdrawnAt` (./withdraw.ts). A package with no record
 * (written past the service) keeps none; its pointer's mark is what withdraws it. A record that has a
 * mark keeps its own. Answers whether this call wrote the mark.
 */
export async function recordPackageWithdrawal(storage: Storage, ownerGhii: string, name: string, withdrawnAt: string): Promise<boolean> {
    let wrote = false;
    await updateRecord(storage, ownerGhii, audienceRecordKey(name), parseRecord, cur => {
        if (!cur || cur.withdrawnAt) return UNCHANGED;
        wrote = true;
        return { ...cur, withdrawnAt };
    }, { tag: 'datapackage-audience', ttlHours: null });
    return wrote;
}

/** The pointer fields a trusted read looks at: the version and audience it names and its withdrawal mark. */
export type PointerFacts = Pick<LatestPointer, 'contentHash' | 'visibility'> & Partial<Pick<LatestPointer, 'status' | 'withdrawnAt' | 'personalPublicConfirmed'>>;

/** The withdrawal a pointer names, or undefined. */
function pointerWithdrawal(pointer: PointerFacts | undefined | null): string | undefined {
    return pointer?.status === 'withdrawn' && pointer.withdrawnAt ? pointer.withdrawnAt : undefined;
}

/** The audience inputs a read decides on, as ./audience.ts takes them. */
export interface TrustedAudience {
    /** The package's audience, for datapackageReadable (undefined reads as public, as a pointer without one did). */
    visibility: string | undefined;
    /** The version the package points at and its audience, for versionOpenTo. */
    pointer: { contentHash?: string; visibility?: string } | undefined;
    /** A version file as versionOpenTo reads it: its stored tier, and the audience recorded for that version. */
    versionFile(contentHash: string, file: { visibility?: string; tags?: readonly string[] }): { visibility?: string; tags?: readonly string[] };
    /**
     * The version the package points at now: the record's, else (no record, or before the boot step
     * ran) the pointer's own, as openPackage opens it. Undefined when no version is published.
     */
    current: string | undefined;
    /** When the package was withdrawn: the record's mark, else the pointer's. Undefined when it is not withdrawn. */
    withdrawnAt: string | undefined;
    /** The owner's confirmation of a public package from personal data, as the service recorded it (./personal-guard.ts). */
    personalPublicConfirmed: PublicConfirmation | undefined;
}

/** True once the boot step has recorded the existing packages; read once per process after it is true. */
let ruleInForce = false;

async function audienceRuleInForce(storage: Storage, nodeId: string): Promise<boolean> {
    if (ruleInForce) return true;
    const rec = await storage.getMemory(`system@${nodeId}`, DATAPACKAGE_AUDIENCE_STEP_KEY);
    const value = rec?.value as { state?: unknown } | undefined;
    if (rec && value?.state !== 'running') ruleInForce = true;
    return ruleInForce;
}

/** True once the boot step has recorded the existing packages, so a later step may build on the records. */
export function audienceRecordsInPlace(storage: Storage, nodeId: string): Promise<boolean> {
    return audienceRuleInForce(storage, nodeId);
}

/** The record under `system@<nodeId>` that says the existing pointers' terms, withdrawals and confirmations are recorded. */
export const DATAPACKAGE_POINTER_STATE_STEP_KEY = 'migrations.datapackage-pointer-state';

/** True once ./sale-terms-record.ts recordPointerStateOnce has run; read once per process after it is true. */
let pointerStateRecorded = false;

/** Has the boot step copied the existing pointers' state onto the records? Until then a read takes the pointer's, as before. */
export async function pointerStateInForce(storage: Storage, nodeId: string): Promise<boolean> {
    if (pointerStateRecorded) return true;
    const rec = await storage.getMemory(`system@${nodeId}`, DATAPACKAGE_POINTER_STATE_STEP_KEY);
    const value = rec?.value as { state?: unknown } | undefined;
    if (rec && value?.state !== 'running') pointerStateRecorded = true;
    return pointerStateRecorded;
}

/** Called by the boot step once it has finished in this process. */
export function markPointerStateInForce(): void {
    pointerStateRecorded = true;
}

/**
 * What a read of `ownerGhii`'s package `name` decides the audience on. `pointer` is the stored
 * `latest.json` as read (or undefined when there is none).
 */
export async function trustedAudienceOf(
    storage: Storage, nodeId: string, ownerGhii: string, name: string, pointer: PointerFacts | undefined | null,
): Promise<TrustedAudience> {
    const ownCurrent = pointer?.contentHash || undefined;
    const ownWithdrawal = pointerWithdrawal(pointer);
    const ownConfirmation = publicConfirmationOf(pointer?.personalPublicConfirmed);
    if (!(await audienceRuleInForce(storage, nodeId))) {
        // Before the existing packages are recorded: the pointer and the tags, as before.
        return {
            visibility: pointer?.visibility, pointer: pointer ?? undefined, versionFile: (_h, f) => f, current: ownCurrent, withdrawnAt: ownWithdrawal,
            personalPublicConfirmed: ownConfirmation,
        };
    }
    const rec = parseRecord((await storage.getMemory(ownerGhii, audienceRecordKey(name)))?.value);
    if (!rec) {
        // Not written by the service: the owner and the owner's principals with storage:read only, and
        // no confirmation the service did not record.
        return {
            visibility: 'private', pointer: { visibility: 'private' }, versionFile: (_h, f) => ({ visibility: f.visibility, tags: [] }),
            current: ownCurrent, withdrawnAt: ownWithdrawal, personalPublicConfirmed: undefined,
        };
    }
    return {
        visibility: rec.visibility,
        pointer: { contentHash: rec.current, visibility: rec.visibility },
        // A version the record does not name was not published by the service: its owner reads it.
        versionFile: (hash, f) => ({ visibility: f.visibility, tags: withAudienceTag([], rec.versions[bare(hash)] ?? 'private') }),
        current: rec.current || undefined,
        withdrawnAt: rec.withdrawnAt ?? ownWithdrawal,
        // The record's confirmation; the pointer's only until the boot step has copied the existing ones.
        personalPublicConfirmed: rec.personalPublicConfirmed
            ?? (await pointerStateInForce(storage, nodeId) ? undefined : ownConfirmation),
    };
}

/** A package as a reader outside the service decides on it: the stored pointer for display, and the trusted facts. */
export interface TrustedPackage {
    /** The stored `latest.json`, for its display fields (updatedAt, lastError, packageId) only. */
    pointer: LatestPointer;
    trusted: TrustedAudience;
}

/**
 * Read `ownerGhii`'s package `name` for a decision outside the datapackage service: null when it has
 * no pointer (no such package, or a purged one), else the pointer and what trustedAudienceOf says of it.
 * A pointer that is not readable JSON is no package, as every read already answers it.
 */
export async function trustedPackageOf(storage: Storage, nodeId: string, ownerGhii: string, name: string): Promise<TrustedPackage | null> {
    const file = await storage.getStorageFile(ownerGhii, latestKey(name));
    const pointer = file ? pointerOf(ownerGhii, latestKey(name), file.data) : null;
    if (!pointer) return null;
    return { pointer, trusted: await trustedAudienceOf(storage, nodeId, ownerGhii, name, pointer) };
}

/** What a listing of every package takes from one package's record: its audience and its withdrawal. */
export interface RecordedAudience {
    visibility: string;
    withdrawnAt?: string;
}

/** Records read per bulk read in recordedAudiencesOf. */
const RECORD_READ_CHUNK = 500;

/**
 * The recorded audience of many packages in one bulk read, for a listing of every package of the node
 * (./catalogue-facts.ts allDatasetFacts), keyed `${ownerGhii}|${name}`. A package with no record reads
 * as private, as trustedAudienceOf reads it. Null before the boot step has recorded the existing
 * packages: the listing then keeps the audience it read before.
 */
export async function recordedAudiencesOf(
    storage: Storage, nodeId: string, pkgs: ReadonlyArray<{ ownerGhii: string; name: string }>,
): Promise<Map<string, RecordedAudience> | null> {
    if (!(await audienceRuleInForce(storage, nodeId))) return null;
    const found = new Map<string, unknown>();
    const keys = [...new Set(pkgs.map(p => audienceRecordKey(p.name)))];
    for (let i = 0; i < keys.length; i += RECORD_READ_CHUNK) {
        for (const r of await storage.getMemoryByKeysAnyOwner(keys.slice(i, i + RECORD_READ_CHUNK))) found.set(`${r.ownerGaii}|${r.key}`, r.value);
    }
    const out = new Map<string, RecordedAudience>();
    for (const p of pkgs) {
        const rec = parseRecord(found.get(`${p.ownerGhii}|${audienceRecordKey(p.name)}`));
        out.set(`${p.ownerGhii}|${p.name}`, rec
            ? { visibility: rec.visibility, ...(rec.withdrawnAt ? { withdrawnAt: rec.withdrawnAt } : {}) }
            : { visibility: 'private' });
    }
    return out;
}

/** A stored pointer, or null when it is not readable JSON: such a package stays unreadable, as every read already answers it. */
function pointerOf(owner: string, key: string, data: Buffer): LatestPointer | null {
    try {
        return JSON.parse(data.toString('utf8')) as LatestPointer;
    } catch (err) {
        logger.warn('Data packages: a pointer is not readable JSON, so no audience is recorded for it', { owner, key, error: String(err) });
        return null;
    }
}

function tierRank(visibility: string | undefined): number {
    return visibility === 'public' ? 2 : visibility === 'members' ? 1 : 0;
}

/**
 * The audience an earlier version had at the update, as ./audience.ts versionOpenTo read it then: the
 * audience tag on its descriptor file; else, for a version written before 2026-10-21, the package's
 * audience when its files are stored at least as wide as the package's tier, 'members' for a members
 * tier, and 'private' otherwise.
 */
function versionAudienceAtUpdate(file: { visibility?: string; tags?: readonly string[] }, packageAudience: string): string {
    const own = recordedAudienceOf(file.tags);
    if (own !== undefined) return own;
    if (tierRank(file.visibility) >= tierRank(fileVisibilityOf(packageAudience))) return packageAudience;
    return file.visibility === 'members' ? 'members' : 'private';
}

/**
 * Every namespace a package can sit in: each account and each agent of this node. Read whole, once per
 * node, by the once-only start steps (this file's and ./sale-terms-record.ts recordPointerStateOnce),
 * before the node serves and never in a request.
 */
export async function packageNamespaces(storage: Storage, nodeId: string): Promise<string[]> {
    return [
        ...(await storage.listOwners()).map(o => `${o.name}@${nodeId}`),
        ...(await storage.listAgents()).map(a => a.gaii),
    ];
}

/** How many namespaces one batched file listing asks for. */
const NAMESPACE_BATCH = 200;

/**
 * Once per node, before it serves: write the audience record of every package that has a version,
 * from its pointer (a pointer without a visibility is a public package's) and the audience tag on each
 * version's descriptor file. A package that already has a record is left as it is. Throws when a read
 * or a write fails, and then leaves no step record, so the next start tries again.
 */
export async function recordDatapackageAudiencesOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; recorded?: number }> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, DATAPACKAGE_AUDIENCE_STEP_KEY);
    if (!claim) return { ran: false };
    try {
        const at = new Date().toISOString();
        const namespaces = await packageNamespaces(storage, config.nodeId);
        let recorded = 0;
        for (let i = 0; i < namespaces.length; i += NAMESPACE_BATCH) {
            const byOwner = await storage.listStorageFilesForOwners(namespaces.slice(i, i + NAMESPACE_BATCH));
            for (const [owner, files] of Object.entries(byOwner)) {
                const pointers = files.filter(f => f.key.startsWith('datapkg/') && f.key.endsWith('/latest.json'));
                for (const p of pointers) {
                    const name = p.key.slice('datapkg/'.length, -'/latest.json'.length);
                    const file = await storage.getStorageFile(owner, p.key);
                    const pointer = file ? pointerOf(owner, p.key, file.data) : null;
                    if (!pointer?.contentHash) continue;
                    const visibility = pointer.visibility ?? 'public';
                    const root = `datapkg/${name}/`;
                    const versions: Record<string, string> = {};
                    for (const f of files) {
                        if (!f.key.startsWith(root) || !f.key.endsWith('/datapackage.json')) continue;
                        const hash = f.key.slice(root.length).split('/')[0];
                        if (/^[a-f0-9]{64}$/.test(hash)) versions[hash] = versionAudienceAtUpdate(f, visibility);
                    }
                    versions[bare(pointer.contentHash)] = visibility;
                    const withdrawnAt = pointerWithdrawal(pointer);
                    const confirmed = publicConfirmationOf(pointer.personalPublicConfirmed);
                    let wrote = false;
                    await updateRecord(storage, owner, audienceRecordKey(name), parseRecord, cur => {
                        if (cur) return UNCHANGED;
                        wrote = true;
                        return {
                            name, visibility, current: pointer!.contentHash, versions,
                            ...(withdrawnAt ? { withdrawnAt } : {}), ...(confirmed ? { personalPublicConfirmed: confirmed } : {}),
                        };
                    }, { tag: 'datapackage-audience', ttlHours: null });
                    if (wrote) recorded++;
                }
            }
        }
        await claim.finish({ at, recorded });
        ruleInForce = true;
        if (recorded) logger.info('Data packages: the audience of every existing package recorded', { recorded });
        return { ran: true, recorded };
    } catch (err) {
        await claim.release();
        throw err;
    }
}
