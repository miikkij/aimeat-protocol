/**
 * @file src/services/exchange-projection-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fourth EXCHANGE source (plan doc-mvwxcas3dom3, D5.1): an owner's data packages
 *   whose sale terms record (services/datapackage/sale-terms-record.ts) says `exchange: true`, listed
 *   on the version and withdrawal the service recorded (packageForSale), never on the `latest.json`
 *   pointer's own word, which an app with storage:write rewrites. Each one projects one listing
 *   per money currency (or one free listing with pacing), kind `datapackage`, coordinate
 *   `datapkg:{owner}/{name}` + `read`, as services/exchange-projection.ts projects the other three.
 *
 *   SKIPPED, with the reason on the report: a withdrawn package (PACKAGE_WITHDRAWN), one with no
 *   published version (NOT_PUBLISHED), a version whose resources carry no Table Schema fields
 *   (SCHEMA_REQUIRED, the readability gate every kind passes: a package's interface IS its schemas),
 *   terms without usage terms (USAGE_TERMS_REQUIRED) and terms without a price or pacing (NOT_PRICED).
 *
 *   THE INTERFACE. A pass that writes pins the package's current schemas as an interface version
 *   (services/app-tool-interfaces.ts, `datapkg:{name}` / `read`): unchanged schemas reuse the version,
 *   changed ones mint the next. The listing's surface names it and its sourceHash carries it, so a
 *   schema change updates the same listing and a contract signed earlier keeps its own version.
 * @structure desiredFromDataPackages · packageNamesOf
 * @usage const desired = await desiredFromDataPackages(storage, ownerGhii, ownerName, only, changes, dryRun);
 * @version-history
 *   v1.0.1 — 2026-11-01 — Lists from the service's records through packageForSale, not the pointer (WP9e).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.1, D5.5).
 */
import type { Storage } from '../storage/interface.js';
import type { ReconcileChange, DesiredListing } from './exchange-projection-types.js';
import { usageTermsOf, provenanceOf, moneyPricesOf, contentHash, listingTerms } from './exchange-source-terms.js';
import { ensureInterfaceVersion, getLatestInterface } from './app-tool-interfaces.js';
import {
    datapackageCoordinate, packageIfaceApp, packageForSale, packageDescriptor, packageSchemaDef, plansForTerms,
    proposeDeliversData, DATAPACKAGE_ACTION,
} from './exchange-datapackage.js';
import type { OdpsExtras, Provenance } from '../models/odps-schemas.js';

const POINTER_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/latest\.json$/;

/** The names of the owner's packages that have a pointer. */
export async function packageNamesOf(storage: Storage, ownerGhii: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of await storage.listStorageFiles(ownerGhii)) {
        const m = POINTER_RE.exec(f.key);
        if (m) out.push(m[1]!);
    }
    return out;
}

/** The listings the owner's data packages ask for. `only` scopes the pass to one package. */
export async function desiredFromDataPackages(
    storage: Storage, ownerGhii: string, ownerName: string, only: string | undefined,
    skips: ReconcileChange[], dryRun: boolean,
): Promise<DesiredListing[]> {
    const out: DesiredListing[] = [];
    const names = only ? [only] : await packageNamesOf(storage, ownerGhii);
    for (const name of names) {
        // The terms, the version and the withdrawal are the service's records, not the pointer's word.
        const sale = await packageForSale(storage, ownerGhii, name);
        const terms = sale?.terms;
        if (!sale || !terms || terms.exchange !== true) continue;
        const label = `datapkg/${name}`;
        const skip = (reason: string) => skips.push({ action: 'skipped', offeringId: null, kind: 'datapackage', label, unit: null, currency: null, reason });
        if (sale.trusted.withdrawnAt) { skip('PACKAGE_WITHDRAWN'); continue; }
        const current = sale.trusted.current;
        if (!current) { skip('NOT_PUBLISHED'); continue; }
        const descriptor = await packageDescriptor(storage, ownerGhii, name, current);
        if (!descriptor?.resources?.length || descriptor.resources.some(r => !r.schema?.fields?.length)) { skip('SCHEMA_REQUIRED'); continue; }
        if (!terms.usageTerms) { skip('USAGE_TERMS_REQUIRED'); continue; }
        const sold = listingTerms(terms.tollMorsels, terms.price?.morsels ?? 0, moneyPricesOf(null, terms.pricesMoney));
        if (!sold) { skip('NOT_PRICED'); continue; }
        const def = packageSchemaDef(descriptor);
        const iface = dryRun
            ? await getLatestInterface(storage, ownerGhii, packageIfaceApp(name), DATAPACKAGE_ACTION)
            : await ensureInterfaceVersion(storage, ownerGhii, packageIfaceApp(name), DATAPACKAGE_ACTION, def);
        const ifaceVersion = iface?.ifaceVersion ?? 1;
        const coord = datapackageCoordinate(ownerName, name);
        const deliversData = terms.deliversData ?? proposeDeliversData('datapackage');
        const base = {
            kind: 'datapackage' as const, ext: coord.ext, action: coord.action,
            title: terms.title || descriptor.title || name,
            description: terms.description || descriptor.description || '',
            usageTerms: usageTermsOf(terms.usageTerms), tags: terms.tags ?? descriptor.keywords ?? [],
            provenance: provenanceOf((terms.provenance ?? undefined) as Provenance | undefined),
            odps: (terms.odps ?? null) as OdpsExtras | null,
            tollMorsels: sold.tollMorsels, deliversData,
        };
        for (const p of sold.rows) {
            // A morsel row is free with pacing per read: a month of reads has no money to charge.
            const model = p.unit === 'money' ? terms.model : 'per_read';
            const plans = plansForTerms({ model, ...(terms.readsPerMinute ? { readsPerMinute: terms.readsPerMinute } : {}) }, p.unit, p.basePrice);
            out.push({
                ...base, ...p, plans,
                surface: { kind: 'datapackage', ownerName, packageName: name, ifaceVersion, model },
                key: `datapackage|${coord.ext}|${coord.action}|${p.unit}|${p.currency ?? ''}`,
                sourceHash: contentHash([base.title, base.description, base.usageTerms, base.provenance, base.odps, base.tollMorsels, base.tags, deliversData, ifaceVersion, model, plans, p]),
            });
        }
    }
    return out;
}
