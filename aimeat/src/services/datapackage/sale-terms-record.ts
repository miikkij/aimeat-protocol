/**
 * @file src/services/datapackage/sale-terms-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The EXCHANGE sale terms of a data package as the service wrote them (WP9e, Lifecycle
 *   Central incident incident-data-products-party-shares-and-exchange-sale-read-latest-jso-mvxozs2r).
 *
 *   WHY A RECORD OF ITS OWN. The terms used to live only on the package's `latest.json` pointer, which
 *   POST /v1/storage writes for any principal with storage:write. An app of the owner could rewrite the
 *   price, the model or the usage terms a buyer signs under without exchange:write, and without the
 *   data intermediation gate a new listing asks. The record `datapkg-exchange.<name>` sits in the
 *   package owner's memory under a service-owned prefix (utils/reserved-keys.ts
 *   SERVICE_OWNED_KEY_PREFIXES), which no memory route writes, restores or deletes. setPackageExchange
 *   (services/exchange-datapackage.ts) is its one writer, through writeSaleTerms, and a purge
 *   (./withdraw.ts) deletes it with the package. The record is per package, so the terms carry over to
 *   every new version, as writeLatest kept them on the pointer (plan doc-mvwxcas3dom3, D5.1). The pointer
 *   still gets a copy of the terms, so a reader of the file sees what it saw; no decision reads it.
 *
 *   EXISTING TERMS, WITHDRAWALS AND CONFIRMATIONS. recordPointerStateOnce runs once per node before it
 *   serves, after the audience step (server-bootstrap/once-only-keep-steps.ts). For every package
 *   pointer it copies the sale terms onto a new record, and a withdrawal mark and the owner's
 *   confirmation of a public package from personal data onto the package's audience record
 *   (./audience-record.ts recordPackageWithdrawal, recordPublicConfirmation). It acts only on what a pointer positively says,
 *   leaves a record that exists as it is, skips a pointer that is not JSON, and waits for a later start
 *   while the audience records are not in place. Until it has run, saleTermsOf answers the pointer's
 *   terms, as the reads did before.
 * @structure SALE_TERMS_PREFIX · DATAPACKAGE_POINTER_STATE_STEP_KEY · saleTermsKey · saleTermsOf ·
 *   writeSaleTerms · deleteSaleTerms · recordPointerStateOnce
 * @usage
 *   const terms = await saleTermsOf(storage, nodeId, ownerGhii, name, pointer);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The boot step copies the pointers' public confirmations too; the step key and
 *     its in-force flag moved to ./audience-record.ts, which reads them for the confirmation (WP9e, D1.7).
 *   v1.0.0 — 2026-11-01 — Initial (WP9e, cc-jouni-dataulos).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { writeStorageFile, type StorageWriteDeps } from '../storage-file-write.js';
import { fileVisibilityOf } from './audience.js';
import {
    audienceRecordsInPlace, packageNamespaces, recordPackageWithdrawal, recordPublicConfirmation, publicConfirmationOf,
    pointerStateInForce, markPointerStateInForce, DATAPACKAGE_POINTER_STATE_STEP_KEY,
} from './audience-record.js';
import { latestKey, type DatapackageExchangeTerms, type LatestPointer } from './contract.js';

/** The service-owned memory prefix the record lives under, in the package owner's namespace. */
export const SALE_TERMS_PREFIX = 'datapkg-exchange.';

/** The step record's key lives beside the audience record, which reads it too; re-exported here. */
export { DATAPACKAGE_POINTER_STATE_STEP_KEY };

export function saleTermsKey(name: string): string {
    return `${SALE_TERMS_PREFIX}${name}`;
}

interface SaleTermsRecord { name: string; terms: DatapackageExchangeTerms }

function parseRecord(v: unknown): SaleTermsRecord | null {
    if (!v || typeof v !== 'object') return null;
    const r = v as Partial<SaleTermsRecord>;
    const t = r.terms;
    return t && typeof t === 'object' && typeof t.exchange === 'boolean' ? { name: String(r.name ?? ''), terms: t } : null;
}

/**
 * The terms `ownerGhii`'s package `name` is sold under: the record's, or null when it has none. Before
 * the boot step has run, the stored pointer's terms (`pointer`), as every read took them then.
 */
export async function saleTermsOf(
    storage: Storage, nodeId: string, ownerGhii: string, name: string, pointer?: Pick<LatestPointer, 'exchange'> | null,
): Promise<DatapackageExchangeTerms | null> {
    const own = parseRecord((await storage.getMemory(ownerGhii, saleTermsKey(name)))?.value)?.terms;
    if (own) return own;
    if (await pointerStateInForce(storage, nodeId)) return null;
    return pointer?.exchange && typeof pointer.exchange.exchange === 'boolean' ? pointer.exchange : null;
}

/**
 * Store `terms` for `name`: the record first, then the copy on the pointer, written at the file tier of
 * the package's recorded `audience`. `pointer` is the stored pointer the copy is added to.
 */
export async function writeSaleTerms(
    deps: StorageWriteDeps, ownerGhii: string, name: string, terms: DatapackageExchangeTerms,
    pointer: LatestPointer, audience: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
    await updateRecord(deps.storage, ownerGhii, saleTermsKey(name), parseRecord, () => ({ name, terms }),
        { tag: 'datapackage-exchange', ttlHours: null });
    const written = await writeStorageFile(deps, ownerGhii, {
        key: latestKey(name),
        data: Buffer.from(JSON.stringify({ ...pointer, exchange: terms }, null, 2) + '\n', 'utf8'),
        mimeType: 'application/json; charset=utf-8',
        visibility: fileVisibilityOf(audience ?? 'public'),
    });
    return written.ok ? { ok: true } : { ok: false, message: written.message };
}

/** Delete the package's terms record (a purge, ./withdraw.ts). True when there was one. */
export async function deleteSaleTerms(storage: Storage, ownerGhii: string, name: string): Promise<boolean> {
    return storage.deleteMemory(ownerGhii, saleTermsKey(name), ownerGhii);
}

/** A stored pointer, or null when it is not readable JSON: the step leaves such a package as it is. */
function pointerOf(owner: string, key: string, data: Buffer): LatestPointer | null {
    try {
        const v = JSON.parse(data.toString('utf8')) as unknown;
        return v && typeof v === 'object' ? v as LatestPointer : null;
    } catch (err) {
        logger.warn('Data packages: a pointer is not readable JSON, so its terms and withdrawal are not copied', { owner, key, error: String(err) });
        return null;
    }
}

/** How many namespaces one batched file listing asks for. */
const NAMESPACE_BATCH = 200;

/**
 * Once per node, before it serves and after the audience step: copy each pointer's sale terms onto a
 * terms record the package does not have yet, and each pointer's withdrawal mark and public
 * confirmation (./personal-guard.ts) onto the package's audience record. Waits (answers ran: false, claims nothing) while the audience records are not in
 * place. Throws when a read or a write fails, and then leaves no step record, so the next start tries
 * again.
 */
export async function recordPointerStateOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; terms?: number; withdrawals?: number; confirmations?: number }> {
    if (!(await audienceRecordsInPlace(storage, config.nodeId))) return { ran: false };
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, DATAPACKAGE_POINTER_STATE_STEP_KEY);
    if (!claim) return { ran: false };
    try {
        const at = new Date().toISOString();
        const namespaces = await packageNamespaces(storage, config.nodeId);
        let terms = 0, withdrawals = 0, confirmations = 0;
        for (let i = 0; i < namespaces.length; i += NAMESPACE_BATCH) {
            const byOwner = await storage.listStorageFilesForOwners(namespaces.slice(i, i + NAMESPACE_BATCH));
            for (const [owner, files] of Object.entries(byOwner)) {
                for (const p of files.filter(f => f.key.startsWith('datapkg/') && f.key.endsWith('/latest.json'))) {
                    const name = p.key.slice('datapkg/'.length, -'/latest.json'.length);
                    const file = await storage.getStorageFile(owner, p.key);
                    const pointer = file ? pointerOf(owner, p.key, file.data) : null;
                    if (!pointer) continue;
                    const sold = pointer.exchange && typeof pointer.exchange === 'object' && typeof pointer.exchange.exchange === 'boolean'
                        ? pointer.exchange : null;
                    if (sold) {
                        let wrote = false;
                        await updateRecord(storage, owner, saleTermsKey(name), parseRecord, cur => {
                            if (cur) return UNCHANGED;
                            wrote = true;
                            return { name, terms: sold };
                        }, { tag: 'datapackage-exchange', ttlHours: null });
                        if (wrote) terms++;
                    }
                    if (pointer.status === 'withdrawn' && typeof pointer.withdrawnAt === 'string' && pointer.withdrawnAt) {
                        if (await recordPackageWithdrawal(storage, owner, name, pointer.withdrawnAt)) withdrawals++;
                    }
                    const confirmed = publicConfirmationOf(pointer.personalPublicConfirmed);
                    if (confirmed && await recordPublicConfirmation(storage, owner, name, confirmed)) confirmations++;
                }
            }
        }
        await claim.finish({ at, terms, withdrawals, confirmations });
        markPointerStateInForce();
        if (terms || withdrawals || confirmations) {
            logger.info('Data packages: the sale terms, withdrawals and public confirmations of the existing pointers recorded', { terms, withdrawals, confirmations });
        }
        return { ran: true, terms, withdrawals, confirmations };
    } catch (err) {
        await claim.release();
        throw err;
    }
}
