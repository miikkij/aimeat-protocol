/**
 * @file src/services/exchange-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data package sold on EXCHANGE (plan doc-mvwxcas3dom3, D5.1, D5.2, D5.5): the fourth
 *   offering kind, `datapackage`. This file holds what every surface of it shares:
 *
 *     THE SOURCE. The service-owned record `datapkg-exchange.<name>` (datapackage/sale-terms-record.ts)
 *     carries the sale terms (contract.ts DatapackageExchangeTerms): the switch, the money prices, the
 *     model (`per_month` or `per_read`), the pacing, the usage terms (required) and the ODPS fields.
 *     setPackageExchange writes them, after the same refusals the REST route and the MCP tool ask, and
 *     the EXCHANGE projection lists the package from them (services/exchange-projection-datapackage.ts),
 *     on the version the service recorded. The record is per package, so a new version stays on sale.
 *     The pointer `latest.json` gets a copy of the terms, which no decision reads: the generic storage
 *     routes write that file, and an app with storage:write must not set the price a buyer pays.
 *
 *     THE COORDINATE. `datapkg:{owner}/{name}` and the action `read`: the key an entitlement, a grant and
 *     the usage rows are kept on. One metered call is one data read: an OData entity set, a row window
 *     or the CSV of a resource. A read of the descriptor, the versions, the ODPS sheet or the OData
 *     metadata is admitted by the contract and not charged.
 *
 *     THE INTERFACE. A package's Table Schemas are its interface. Each schema mints an interface version
 *     (services/app/tool-interfaces.ts, keyed `datapkg:{name}` / `read`), a listing names the current one
 *     and a contract pins the one it was signed on. THE PINNED VERSION RANGE of a contract is every
 *     stored version of the package whose schemas hash to that interface (contractVersionHashes): a read
 *     with no version reads the newest of them, and a version outside them is refused. A schema change
 *     therefore leaves an existing contract on the versions it bought, and a new contract on the new ones.
 *
 *     THE PRICE. `per_read` is the per-call price of the listing; `per_month` is a subscription plan of
 *     30 days with a reads-per-minute window, which the contract is minted on by default. A morsel is
 *     pacing and never a price: a package without a money price lists free, with its pacing per read.
 *
 *     DELIVERS DATA (D5.5). Every offering states `deliversData`; when its source says nothing the node
 *     proposes it (proposeDeliversData): true for a data package and for an extension action or app tool
 *     whose output schema returns rows or records, false for agent work and for any other output.
 * @structure DATAPACKAGE_ACTION · PER_MONTH_SECONDS · datapackageCoordinate · parseDatapackageCoordinate ·
 *   packageIfaceApp · proposeDeliversData · validateExchangeTerms · plansForTerms · setPackageExchange ·
 *   resolveDatapackagePricing · packageSchemaDef · contractVersionHashes · packageForSale · packageDescriptor
 * @usage
 *   const coord = datapackageCoordinate('alice', 'budget');   // { ext: 'datapkg:alice/budget', action: 'read' }
 *   const out = await setPackageExchange(deps, caller, 'alice', 'budget', body);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The sale terms live on the service-owned record, and the version and the
 *     withdrawal come from the audience record; packagePointer became packageForSale (WP9e, incident
 *     incident-data-products-party-shares-and-exchange-sale-read-latest-jso-mvxozs2r).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.1, D5.2, D5.5).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CallerContext } from './caller-context.js';
import { OdpsExtrasSchema, ProvenanceSchema } from '../models/odps-schemas.js';
import {
    descriptorKey, validateName, bare,
    type DatapackageExchangeTerms, type Descriptor, type LatestPointer,
} from './datapackage/contract.js';
import { trustedPackageOf, type TrustedAudience } from './datapackage/audience-record.js';
import { saleTermsOf, writeSaleTerms } from './datapackage/sale-terms-record.js';
import { currentNodeId } from '../utils/gaii.js';
import { hashDef, getInterfaceVersion, type InterfaceDef } from './app/tool-interfaces.js';
import { resolveActionPricing, type OfferingPlan } from './exchange-action-pricing.js';
import type { EntitlementUnit, PricingSpec, DatapackageSurface } from './metered-entitlements.js';
import { dataListingRefusal } from './data-intermediation/gate.js';
import { logger } from '../utils/logger.js';

/** The action of every data package coordinate: one read. */
export const DATAPACKAGE_ACTION = 'read';

/** The period of a `per_month` contract. */
export const PER_MONTH_SECONDS = 30 * 86_400;

/** The scope a principal of the owner sets a package's sale terms with, as for every other listing. */
export const EXCHANGE_WRITE_SCOPE = 'exchange:write';

/** The metered coordinate of a data package. */
export function datapackageCoordinate(ownerName: string, name: string): { ext: string; action: string } {
    return { ext: `datapkg:${ownerName}/${name}`, action: DATAPACKAGE_ACTION };
}

/** The owner and package a data package coordinate names, or null. */
export function parseDatapackageCoordinate(ext: string): { ownerName: string; name: string } | null {
    const m = /^datapkg:([^/]+)\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])$/.exec(ext);
    return m ? { ownerName: m[1]!, name: m[2]! } : null;
}

/** The interface key a package's schemas are versioned under (services/app/tool-interfaces.ts). */
export const packageIfaceApp = (name: string): string => `datapkg:${name}`;

/** Does a JSON Schema describe rows or records: an array of objects, or an object whose rows/records/items is one? */
function returnsRows(schema: unknown, depth = 0): boolean {
    if (!schema || typeof schema !== 'object' || depth > 3) return false;
    const s = schema as Record<string, unknown>;
    if (s.type === 'array') {
        const items = s.items as Record<string, unknown> | undefined;
        return !!items && (items.type === 'object' || !!items.properties);
    }
    const props = s.properties as Record<string, unknown> | undefined;
    if (!props) return false;
    return ['rows', 'records', 'items', 'data', 'results'].some(k => returnsRows(props[k], depth + 1));
}

/**
 * The node's proposal of `deliversData` when the source states none (D5.5). The provider's own
 * statement always wins over this; it is asked only when there is none.
 */
export function proposeDeliversData(kind: string, outputSchema?: unknown): boolean {
    if (kind === 'datapackage') return true;
    if (kind === 'agent-work') return false;
    return returnsRows(outputSchema);
}

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

const CURRENCIES = ['EUR', 'USD'];

/**
 * Read a request's sale terms. `exchange: false` needs nothing else (it delists). A listing needs
 * `usage_terms` and a money price or a pacing amount; the amounts are whole 6-decimal micro-units.
 */
export function validateExchangeTerms(body: Record<string, unknown>, by: string):
    { ok: true; terms: DatapackageExchangeTerms } | Refusal {
    const now = new Date().toISOString();
    const exchange = body.exchange !== false;
    const model = body.model ?? body.pricing_model ?? 'per_month';
    if (model !== 'per_month' && model !== 'per_read') return refuse(400, 'INVALID_INPUT', 'model is "per_month" (a month of reads) or "per_read" (each read).');
    const rawPrices = (body.prices_money ?? body.pricesMoney) as unknown;
    const prices: Array<{ amount: number; currency: string }> = [];
    if (rawPrices !== undefined) {
        if (!Array.isArray(rawPrices) || rawPrices.length > 2) return refuse(400, 'INVALID_INPUT', 'prices_money is a list of at most two { amount, currency }: amount in 6-decimal micro-units (1 EUR = 1000000), currency EUR or USD.');
        for (const p of rawPrices as Array<Record<string, unknown>>) {
            const amount = p?.amount, currency = typeof p?.currency === 'string' ? p.currency.toUpperCase() : '';
            if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000_000) return refuse(400, 'INVALID_INPUT', 'A price amount is a positive whole number of 6-decimal micro-units (1 EUR = 1000000).');
            if (!CURRENCIES.includes(currency)) return refuse(400, 'INVALID_INPUT', 'A price currency is EUR or USD.');
            if (prices.some(x => x.currency === currency)) return refuse(400, 'INVALID_INPUT', `prices_money names ${currency} twice.`);
            prices.push({ amount, currency });
        }
    }
    const tollRaw = body.toll_morsels ?? body.tollMorsels;
    if (tollRaw !== undefined && tollRaw !== null && (typeof tollRaw !== 'number' || !Number.isInteger(tollRaw) || tollRaw < 0 || tollRaw > 100)) {
        return refuse(400, 'INVALID_INPUT', 'toll_morsels is the pacing each read carries: a whole number of morsels from 0 to 100. It is not a price.');
    }
    const usageRaw = (body.usage_terms ?? body.usageTerms) as Record<string, unknown> | undefined;
    if (exchange && (!usageRaw || typeof usageRaw !== 'object')) {
        return refuse(400, 'USAGE_TERMS_REQUIRED', 'A data package on EXCHANGE states how a buyer may use the data: usage_terms { derivatives, resale, attribution, note? }.');
    }
    if (exchange && !prices.length && !(typeof tollRaw === 'number' && tollRaw > 0)) {
        return refuse(400, 'NOT_PRICED', 'Set a money price (prices_money) or a pacing amount (toll_morsels) for the package to list.');
    }
    const rpm = body.reads_per_minute ?? body.readsPerMinute;
    if (rpm !== undefined && (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm < 1 || rpm > 6000)) {
        return refuse(400, 'INVALID_INPUT', 'reads_per_minute is a whole number from 1 to 6000.');
    }
    const delivers = body.delivers_data ?? body.deliversData;
    if (delivers !== undefined && typeof delivers !== 'boolean') return refuse(400, 'INVALID_INPUT', 'delivers_data is true or false.');
    let odps: Record<string, unknown> | null = null;
    if (body.odps !== undefined && body.odps !== null) {
        const parsed = OdpsExtrasSchema.safeParse(body.odps);
        if (!parsed.success) return refuse(400, 'INVALID_ODPS', `odps does not validate: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        odps = parsed.data as Record<string, unknown>;
    }
    let provenance: Record<string, unknown> | null = null;
    if (body.provenance !== undefined && body.provenance !== null) {
        const parsed = ProvenanceSchema.safeParse(body.provenance);
        if (!parsed.success) return refuse(400, 'INVALID_PROVENANCE', `provenance does not validate: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        provenance = parsed.data as Record<string, unknown>;
    }
    const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const usage = usageRaw ?? {};
    const terms: DatapackageExchangeTerms = {
        exchange, model, pricesMoney: prices,
        ...(typeof tollRaw === 'number' ? { tollMorsels: tollRaw } : {}),
        usageTerms: {
            ...(typeof usage.derivatives === 'boolean' ? { derivatives: usage.derivatives } : {}),
            ...(typeof usage.resale === 'boolean' ? { resale: usage.resale } : {}),
            ...(typeof usage.attribution === 'boolean' ? { attribution: usage.attribution } : {}),
            ...(text(usage.note, 500) ? { note: text(usage.note, 500) } : {}),
        },
        ...(typeof rpm === 'number' ? { readsPerMinute: rpm } : {}),
        ...(typeof delivers === 'boolean' ? { deliversData: delivers } : {}),
        ...(text(body.title, 200) ? { title: text(body.title, 200) } : {}),
        ...(text(body.description, 2000) ? { description: text(body.description, 2000) } : {}),
        ...(Array.isArray(body.tags) ? { tags: (body.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 20).map(t => t.slice(0, 40)) } : {}),
        ...(odps ? { odps } : {}),
        ...(provenance ? { provenance } : {}),
        updatedAt: now, updatedBy: by,
    };
    return { ok: true, terms };
}

/** The plans a listing of these terms carries on one money row (`amount` is that row's price). */
export function plansForTerms(terms: Pick<DatapackageExchangeTerms, 'model' | 'readsPerMinute'>, unit: EntitlementUnit, amount: number): OfferingPlan[] {
    if (terms.model !== 'per_month' || unit !== 'money') return [];
    return [{ id: 'per_month', model: 'subscription', periodSeconds: PER_MONTH_SECONDS, periodPrice: amount, callsPerWindow: terms.readsPerMinute ?? 60, windowSeconds: 60 }];
}

/** The Table Schemas of a version as the interface definition they are versioned and matched by. */
export function packageSchemaDef(d: Pick<Descriptor, 'resources'>): InterfaceDef {
    return {
        inputSchema: {},
        outputSchema: { resources: d.resources.map(r => ({ name: r.name, schema: r.schema })) },
        binding: null,
    };
}

/** A stored JSON file of the owner, or null. */
async function storedJson<T>(storage: Storage, ownerGhii: string, key: string): Promise<T | null> {
    const file = await storage.getStorageFile(ownerGhii, key);
    if (!file) return null;
    try { return JSON.parse(file.data.toString('utf8')) as T; } catch (err) {
        logger.warn('exchange-datapackage: a stored package file is not readable JSON', { key, error: String(err) });
        return null;
    }
}

/**
 * Set (or with `exchange: false` clear) a package's sale terms, then project its listing. The owner in
 * person, or a principal of the owner holding exchange:write. Every refusal comes before the write: the
 * package must be the caller's own, published and not withdrawn, and a NEW listing of data asks the
 * node's data intermediation setting first (D7.1), as an extension action's listing does.
 */
export async function setPackageExchange(
    deps: { storage: Storage; config: AimeatConfig }, caller: Pick<CallerContext, 'owner' | 'ownerGhii' | 'visitor' | 'kind' | 'principal' | 'has'>,
    ownerName: string, name: string, body: Record<string, unknown>,
    project: (ownerGhii: string, name: string) => Promise<unknown>,
): Promise<{ ok: true; terms: DatapackageExchangeTerms; listing: unknown } | Refusal> {
    const { storage, config } = deps;
    if (caller.visitor || caller.kind === 'anonymous') return refuse(403, 'FORBIDDEN', 'Selling a data package is for an account of this node. Sign in to your own account.');
    if (caller.owner !== ownerName) return refuse(403, 'FORBIDDEN', 'You can sell only your own data packages.');
    if (!caller.has(EXCHANGE_WRITE_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Setting a package's sale terms needs the "${EXCHANGE_WRITE_SCOPE}" permission.`);
    const nameError = validateName(name);
    if (nameError) return refuse(400, 'INVALID_INPUT', nameError);
    const ownerGhii = caller.ownerGhii;
    // The version, the withdrawal and the terms now on sale are the service's records, never the
    // pointer file an app with storage:write rewrites (services/datapackage/audience-record.ts,
    // sale-terms-record.ts).
    const pkg = await trustedPackageOf(storage, config.nodeId, ownerGhii, name);
    if (!pkg?.trusted.current) return refuse(404, 'NOT_FOUND', `You have no data package called "${name}". Publish a version first.`);
    if (pkg.trusted.withdrawnAt) return refuse(409, 'PACKAGE_WITHDRAWN', `The data package "${name}" is withdrawn. Publish a version again before you sell it.`);
    const parsed = validateExchangeTerms(body, caller.principal);
    if (!parsed.ok) return parsed;
    const terms = parsed.terms;
    const onSale = await saleTermsOf(storage, config.nodeId, ownerGhii, name, pkg.pointer);
    if (terms.exchange && !onSale?.exchange) {
        const refused = await dataListingRefusal({ storage, config }, { providerOwner: ownerName, kind: 'datapackage', deliversData: terms.deliversData ?? true });
        if (refused) return refuse(refused.status, refused.code, refused.message);
    }
    const written = await writeSaleTerms(deps, ownerGhii, name, terms, pkg.pointer, pkg.trusted.visibility);
    if (!written.ok) return refuse(500, 'WRITE_FAILED', `The sale terms could not be stored: ${written.message}`);
    return { ok: true, terms, listing: await project(ownerGhii, name) };
}

/**
 * The price of a contract on a datapackage listing, from the listing (the projection put the source's
 * terms there). `per_month` mints the subscription plan unless another plan is asked for.
 */
export function resolveDatapackagePricing(
    o: { unit: EntitlementUnit; basePrice: number; currency: string | null; plans: OfferingPlan[]; surface: unknown },
    planId: string | null,
): { ok: true; unit: EntitlementUnit; pricePerCall: number; currency: string | null; pricing: PricingSpec | null } | { ok: false; code: string; message: string } {
    const surface = o.surface as DatapackageSurface | null;
    const plan = planId ?? (surface?.model === 'per_month' && o.plans.some(p => p.id === 'per_month') ? 'per_month' : null);
    return resolveActionPricing({
        tollMorsels: o.unit === 'morsels' ? o.basePrice : undefined,
        payMoney: o.unit === 'money' ? { amount: o.basePrice, currency: o.currency ?? 'EUR' } : undefined,
        plans: o.plans,
    }, plan);
}

/**
 * THE PINNED VERSION RANGE of a contract on interface `ifaceVersion`: the stored versions of the package
 * whose Table Schemas hash to that interface, newest first. Empty when the interface is unknown or no
 * stored version has its schemas any more.
 */
export async function contractVersionHashes(storage: Storage, ownerGhii: string, name: string, ifaceVersion: number): Promise<string[]> {
    const iface = await getInterfaceVersion(storage, ownerGhii, packageIfaceApp(name), DATAPACKAGE_ACTION, ifaceVersion);
    if (!iface) return [];
    const root = `datapkg/${name}/`;
    const files = (await storage.listStorageFiles(ownerGhii))
        .filter(f => f.key.startsWith(root) && f.key.endsWith('/datapackage.json'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const out: string[] = [];
    for (const f of files) {
        const hash = f.key.slice(root.length).split('/')[0] ?? '';
        if (!/^[a-f0-9]{64}$/.test(hash)) continue;
        const d = await storedJson<Descriptor>(storage, ownerGhii, descriptorKey(name, hash));
        if (d && hashDef(packageSchemaDef(d)) === iface.schemaHash) out.push(`sha256:${bare(d.aimeat.contentHash)}`);
    }
    return out;
}

/**
 * A package as the EXCHANGE projection lists it, read without the store: its version and withdrawal as
 * the service recorded them (`trusted`), and the terms it is sold under from the service's own record.
 * Null when the package has no pointer. The pointer comes back for display fields only.
 */
export async function packageForSale(storage: Storage, ownerGhii: string, name: string): Promise<{
    pointer: LatestPointer; trusted: TrustedAudience; terms: DatapackageExchangeTerms | null;
} | null> {
    const nodeId = currentNodeId() ?? '';
    const pkg = await trustedPackageOf(storage, nodeId, ownerGhii, name);
    if (!pkg) return null;
    return { ...pkg, terms: await saleTermsOf(storage, nodeId, ownerGhii, name, pkg.pointer) };
}

/** The descriptor of one stored version, read without the store. */
export async function packageDescriptor(storage: Storage, ownerGhii: string, name: string, contentHash: string): Promise<Descriptor | null> {
    return storedJson<Descriptor>(storage, ownerGhii, descriptorKey(name, contentHash));
}
