/**
 * @file src/services/datapackage/withdraw.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Withdrawing a data package: the one implementation DELETE /v1/datapackages/{owner}/{name}
 *   and the MCP tool aimeat_datapackage_withdraw call.
 *
 *   A package had no way back once published: its files stayed at their permanent addresses, the
 *   catalogue kept listing it, and the exposure report told the owner to delete the files by hand.
 *
 *   WHAT A WITHDRAWAL DOES. The `latest.json` pointer gets `status: 'withdrawn'` and `withdrawnAt`, and
 *   the catalogue entry (`packages/{id}/manifest` and its per-resource entries) is removed, so the
 *   package leaves the public catalogue and discovery. Every read path then refuses: openPackage
 *   (./store.ts) answers null for a withdrawn package, so the descriptor, the versions, the rows, the
 *   OData feed, the ODPS sheet, the MCP export and the extension capability read nothing, and GET
 *   /v1/pub refuses the package's own files (./file-read.ts). A route answers 410 Gone to a reader the
 *   package's audience admits (withdrawalFor), and 404 to anyone else, so a withdrawn non-public
 *   package does not reveal that it existed. The version files stay, under the owner's retention
 *   policy, and a new publish of the package restores it. With `purge` every stored file of the
 *   package, the pointer included, is deleted, and the package is gone.
 *
 *   WHO. The owner in person, or a principal of the owner (agent, app grant, ecosystem app) holding
 *   storage:write. Anyone else is refused, and every refusal comes before any write.
 * @structure WithdrawCaller · WithdrawResult · withdrawalOf · withdrawalFor · withdrawalOfRef ·
 *   withdrawnMessage · withdrawPackage
 * @usage
 *   const out = await withdrawPackage({ storage, config }, callerOf(req, nodeId, storage), owner, name, { purge });
 *
 *   WHAT IT DECIDES ON. The package's audience, the version it points at and its withdrawal are the
 *   service's record (./audience-record.ts trustedAudienceOf), never the pointer, which the generic
 *   storage routes write: a pointer rewritten to say public opens no withdrawal notice to a stranger,
 *   and a pointer with the withdrawal mark cleared brings no package back. The withdrawal is recorded
 *   on the record and on the pointer. A purge deletes the package's sale terms record too.
 * @version-history
 *   v1.4.0 — 2026-11-01 — Decides on trustedAudienceOf, not the pointer's visibility, version or
 *     withdrawal mark; records the withdrawal on the audience record; a purge deletes the sale terms
 *     record (WP9e, incident-datapackage-withdraw-ts-decides-on-latest-json-s-visibility--mvxmm7ex).
 *   v1.3.0 — 2026-11-01 — A package on EXCHANGE is delisted when it is withdrawn (runLatestHooks; plan D5.1).
 *   v1.2.0 — 2026-11-01 — The party of each share a withdrawal ends is mailed when it has an address
 *     (./share-notices.ts), and the withdrawal emits the `datapackages` change to the owner's streams
 *     (plan doc-mvwxcas3dom3, D6.2).
 *   v1.1.0 — 2026-11-01 — A withdrawal ends the package's named shares (status revoked, endedReason
 *     package-withdrawn) and answers how many (`sharesEnded`); the withdrawal a reader learns of names
 *     the package to datapackageReadable (plan doc-mvwxcas3dom3, D3).
 *   v1.0.1 — 2026-11-01 — Removing the catalogue entry drops the cached package listing
 *     (./catalogue-facts.ts), so discovery and the DCAT feed stop naming it at once (plan D1.1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D0.3).
 */
import type { StoreDeps } from './store.js';
import { parseRef } from './store.js';
import { catalogueKeyRoot, runLatestHooks } from './version-audience.js';
import { datapackageReadable, fileVisibilityOf, type DatapackageReader } from './audience.js';
import { trustedPackageOf, recordPackageWithdrawal } from './audience-record.js';
import { saleTermsOf, deleteSaleTerms } from './sale-terms-record.js';
import { latestKey, packageKeyRoot, validateName, type LatestPointer } from './contract.js';
import { writeStorageFile } from '../storage-file-write.js';
import { emitChange } from '../event-bus.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { invalidateDatasetFacts } from './catalogue-facts.js';
import { endSharesListed, packageOfPattern } from '../parties/shares.js';
import { noticeWithdrawn } from './share-notices.js';
import { DATAPACKAGES_DOMAIN } from './contract.js';

/** The caller facts a withdrawal is decided on (services/caller-context.ts CallerContext). */
export interface WithdrawCaller {
    readonly owner: string;
    readonly visitor: boolean;
    readonly kind: string;
    has(word: string): boolean;
}

export type WithdrawResult =
    | { ok: true; packageId: string; name: string; withdrawnAt: string; purged: boolean; alreadyWithdrawn: boolean;
        filesDeleted: number; catalogueRemoved: boolean; sharesEnded: number }
    | { ok: false; status: 400 | 403 | 404; code: 'INVALID_INPUT' | 'FORBIDDEN' | 'SCOPE_DENIED' | 'NOT_FOUND'; message: string };

/** The permission word a principal of the owner withdraws with. */
export const DATAPACKAGE_WITHDRAW_SCOPE = 'storage:write';

/** The withdrawal trustedAudienceOf answered, or null when the package is not withdrawn. */
export function withdrawalOf(trusted: { withdrawnAt?: string | undefined } | null | undefined): { withdrawnAt: string } | null {
    return trusted?.withdrawnAt ? { withdrawnAt: trusted.withdrawnAt } : null;
}

/**
 * The withdrawal of one package as `reader` may learn of it: present only when the package is
 * withdrawn AND its audience admits the reader. A reader the audience refuses gets null, and the
 * caller answers it as a missing package. Both come from the service's record.
 */
export async function withdrawalFor(
    deps: StoreDeps, ownerGhii: string, name: string, reader: DatapackageReader | null | undefined,
): Promise<{ withdrawnAt: string } | null> {
    const pkg = await trustedPackageOf(deps.storage, deps.config.nodeId, ownerGhii, name);
    const withdrawn = withdrawalOf(pkg?.trusted);
    if (!withdrawn) return null;
    return (await datapackageReadable(deps.storage, ownerGhii, pkg!.trusted.visibility, reader, name)) ? withdrawn : null;
}

/** withdrawalFor for a `pkg:{owner}/{name}[@version]` reference. */
export async function withdrawalOfRef(
    deps: StoreDeps, ref: string, nodeId: string, reader: DatapackageReader | null | undefined,
): Promise<{ withdrawnAt: string } | null> {
    const parsed = parseRef(ref, nodeId);
    return parsed ? withdrawalFor(deps, parsed.ownerGhii, parsed.name, reader) : null;
}

/** The sentence a read of a withdrawn package answers with (410 GONE). */
export function withdrawnMessage(what: string, withdrawnAt: string): string {
    return `The data package ${what} was withdrawn by its owner on ${withdrawnAt}. Its files are no longer served.`;
}

/**
 * Withdraw `name` of the account `owner` (an account name or its GHII on this node). Refuses before
 * any write: another account (or a visitor) 403 FORBIDDEN, a principal of the owner without
 * storage:write 403 SCOPE_DENIED, a name that is not a package name 400, a package that does not
 * exist 404. A withdrawal of a package already withdrawn answers ok with `alreadyWithdrawn`, unless
 * `purge` asks for the files to go too.
 */
export async function withdrawPackage(
    deps: StoreDeps, caller: WithdrawCaller, owner: string, name: string, opts: { purge: boolean },
): Promise<WithdrawResult> {
    const { storage, config } = deps;
    const ownerGhii = owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
    if (caller.visitor || caller.kind === 'anonymous' || !ownerGhii.endsWith(`@${config.nodeId}`)
        || localAccountName(ownerGhii) !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the owner of a data package, or an agent or app of the owner with storage:write, can withdraw it.' };
    }
    if (!caller.has(DATAPACKAGE_WITHDRAW_SCOPE)) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: 'Withdrawing a data package needs the "storage:write" scope. Ask the owner to grant it.' };
    }
    const nameError = validateName(name);
    if (nameError) return { ok: false, status: 400, code: 'INVALID_INPUT', message: nameError };
    const pkg = await trustedPackageOf(storage, config.nodeId, ownerGhii, name);
    const packageId = `pkg:${localAccountName(ownerGhii)}/${name}`;
    if (!pkg || (!pkg.trusted.current && !withdrawalOf(pkg.trusted))) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `No such data package: ${packageId}` };
    }
    const { pointer, trusted } = pkg;

    const earlier = withdrawalOf(trusted);
    // Read before a purge deletes them: a package on sale has its listing follow the withdrawal.
    const sold = await saleTermsOf(storage, config.nodeId, ownerGhii, name, pointer);
    const withdrawnAt = earlier?.withdrawnAt ?? new Date().toISOString();
    const catalogueRemoved = await removeCatalogueEntry(deps, ownerGhii, pointer.packageId || packageId);

    let filesDeleted = 0;
    if (opts.purge) {
        // Every stored file of the package, the pointer last, so a failure part way leaves a pointer
        // that still says withdrawn rather than versions with no pointer.
        const root = `${packageKeyRoot(name)}/`;
        const files = (await storage.listStorageFiles(ownerGhii)).filter(f => f.key.startsWith(root));
        const pointerKey = latestKey(name);
        for (const f of files.filter(x => x.key !== pointerKey)) if (await storage.deleteStorageFile(ownerGhii, f.key)) filesDeleted++;
        if (await storage.deleteStorageFile(ownerGhii, pointerKey)) filesDeleted++;
        // The package is gone, so are its sale terms; a later publish of the name starts off the market.
        await deleteSaleTerms(storage, ownerGhii, name);
        logger.info('datapackage: purged', { package: packageId, files: filesDeleted });
    }
    // The record's mark is the one the reads decide on (a record with a mark keeps its own); the
    // pointer's is for a reader of the file, and is written again when something cleared it.
    await recordPackageWithdrawal(storage, ownerGhii, name, withdrawnAt);
    if (!opts.purge && pointer.status !== 'withdrawn') {
        const next: LatestPointer = { ...pointer, status: 'withdrawn', withdrawnAt };
        const written = await writeStorageFile(deps, ownerGhii, {
            key: latestKey(name),
            data: Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8'),
            mimeType: 'application/json; charset=utf-8',
            visibility: fileVisibilityOf(trusted.visibility ?? 'public'),
        });
        if (!written.ok) throw new Error(`withdrawing ${packageId}: the pointer could not be written: ${written.message}`);
    }
    // Its named shares end with it (plan D0.3, D3): status revoked with endedReason package-withdrawn, so
    // the party reads SHARE_ENDED and a version published again later is not shared again by itself.
    const ended = await endSharesListed(storage, ownerGhii, c => packageOfPattern(c.dataPattern) === name, 'package-withdrawn');
    const sharesEnded = ended.length;
    if (sharesEnded) emitChange('consent');
    // Each party whose share ended is told by mail when it has an address and the node sends mail (D6.2).
    if (sharesEnded) {
        void noticeWithdrawn(deps, ownerGhii, name, ended)
            .catch(err => logger.warn('datapackage: the withdrawal notices failed', { package: packageId, error: String(err) }));
    }
    // A package on EXCHANGE leaves the market with it; its contracts stay as they are (plan D5.1).
    if (sold) await runLatestHooks(storage, ownerGhii, name, { ...pointer, exchange: sold, status: 'withdrawn', withdrawnAt });
    emitChange('files');
    emitChange(DATAPACKAGES_DOMAIN, ownerGhii);
    if (catalogueRemoved) emitChange('memory');
    return { ok: true, packageId, name, withdrawnAt, purged: opts.purge, alreadyWithdrawn: !!earlier && !opts.purge, filesDeleted, catalogueRemoved, sharesEnded };
}

/** Remove the package's catalogue manifest and its per-resource entries. True when anything was removed. */
async function removeCatalogueEntry(deps: StoreDeps, ownerGhii: string, packageId: string): Promise<boolean> {
    const root = catalogueKeyRoot(packageId);
    const manifest = await deps.storage.getMemory(ownerGhii, `${root}/manifest`);
    if (!manifest) return false;
    const entries = ((manifest.value as { entries?: Array<{ key?: unknown }> } | undefined)?.entries ?? [])
        .map(e => e.key).filter((k): k is string => typeof k === 'string' && k.startsWith(`${root}/`));
    for (const key of entries) await deps.storage.deleteMemory(ownerGhii, key, ownerGhii);
    await deps.storage.deleteMemory(ownerGhii, `${root}/manifest`, ownerGhii);
    // The node-wide package listing (./catalogue-facts.ts) is cached; this package leaves it now.
    invalidateDatasetFacts();
    return true;
}
