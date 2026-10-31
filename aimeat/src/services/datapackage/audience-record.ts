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
 * @structure AUDIENCE_RECORD_PREFIX · DATAPACKAGE_AUDIENCE_STEP_KEY · audienceRecordKey ·
 *   recordPackageAudience · TrustedAudience · trustedAudienceOf · recordDatapackageAudiencesOnce
 * @usage
 *   const trusted = await trustedAudienceOf(storage, nodeId, ownerGhii, name, pointer);
 *   if (!(await datapackageReadable(storage, ownerGhii, trusted.visibility, reader))) return null;
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { withAudienceTag, recordedAudienceOf, fileVisibilityOf } from './audience.js';
import { bare, type LatestPointer } from './contract.js';

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
}

export function audienceRecordKey(name: string): string {
    return `${AUDIENCE_RECORD_PREFIX}${name}`;
}

function parseRecord(v: unknown): AudienceRecord | null {
    if (!v || typeof v !== 'object') return null;
    const r = v as Partial<AudienceRecord>;
    if (typeof r.visibility !== 'string' || typeof r.current !== 'string') return null;
    const versions = r.versions && typeof r.versions === 'object' ? r.versions : {};
    return { name: String(r.name ?? ''), visibility: r.visibility, current: r.current, versions: { ...versions } };
}

/**
 * Record that `name` points at `contentHash` with `visibility`, and that this version's audience is
 * `visibility`. Called by writeLatest before it moves the pointer, so a pointer never names a version
 * the record does not.
 */
export async function recordPackageAudience(
    storage: Storage, ownerGhii: string, name: string, contentHash: string, visibility: string,
): Promise<void> {
    await updateRecord(storage, ownerGhii, audienceRecordKey(name), parseRecord, cur => ({
        name,
        visibility,
        current: contentHash,
        versions: { ...(cur?.versions ?? {}), [bare(contentHash)]: visibility },
    }), { tag: 'datapackage-audience', ttlHours: null });
}

/** The audience inputs a read decides on, as ./audience.ts takes them. */
export interface TrustedAudience {
    /** The package's audience, for datapackageReadable (undefined reads as public, as a pointer without one did). */
    visibility: string | undefined;
    /** The version the package points at and its audience, for versionOpenTo. */
    pointer: { contentHash?: string; visibility?: string } | undefined;
    /** A version file as versionOpenTo reads it: its stored tier, and the audience recorded for that version. */
    versionFile(contentHash: string, file: { visibility?: string; tags?: readonly string[] }): { visibility?: string; tags?: readonly string[] };
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

/**
 * What a read of `ownerGhii`'s package `name` decides the audience on. `pointer` is the stored
 * `latest.json` as read (or undefined when there is none).
 */
export async function trustedAudienceOf(
    storage: Storage, nodeId: string, ownerGhii: string, name: string, pointer: Pick<LatestPointer, 'contentHash' | 'visibility'> | undefined | null,
): Promise<TrustedAudience> {
    if (!(await audienceRuleInForce(storage, nodeId))) {
        // Before the existing packages are recorded: the pointer and the tags, as before.
        return { visibility: pointer?.visibility, pointer: pointer ?? undefined, versionFile: (_h, f) => f };
    }
    const rec = parseRecord((await storage.getMemory(ownerGhii, audienceRecordKey(name)))?.value);
    if (!rec) {
        // Not written by the service: the owner and the owner's principals with storage:read only.
        return { visibility: 'private', pointer: { visibility: 'private' }, versionFile: (_h, f) => ({ visibility: f.visibility, tags: [] }) };
    }
    return {
        visibility: rec.visibility,
        pointer: { contentHash: rec.current, visibility: rec.visibility },
        // A version the record does not name was not published by the service: its owner reads it.
        versionFile: (hash, f) => ({ visibility: f.visibility, tags: withAudienceTag([], rec.versions[bare(hash)] ?? 'private') }),
    };
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
        const namespaces = [
            ...(await storage.listOwners()).map(o => `${o.name}@${config.nodeId}`),
            ...(await storage.listAgents()).map(a => a.gaii),
        ];
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
                    let wrote = false;
                    await updateRecord(storage, owner, audienceRecordKey(name), parseRecord, cur => {
                        if (cur) return UNCHANGED;
                        wrote = true;
                        return { name, visibility, current: pointer!.contentHash, versions };
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
