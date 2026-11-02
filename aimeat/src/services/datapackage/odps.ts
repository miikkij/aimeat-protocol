/**
 * @file src/services/datapackage/odps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The product sheet, as a projection of the descriptor. It is projected when it is read
 *   (GET /v1/datapackages/{owner}/{name}/odps, ./odps-read.ts), so a package is describable to a buyer
 *   without anyone authoring a second document about it, and the sheet states the audience the version
 *   has now. A version published before 2026-11-01 also has an `odps.yaml` stored beside it; its
 *   /v1/pub address answers the projection too.
 *
 *   ONE SCHEMA, MANY PROJECTIONS, and this is one of the projections. The Table Schema is the only
 *   place columns and types are declared; the ODPS sheet, the CSV header and an agent's view of the
 *   package are all derived from it, so they cannot drift. Nothing here is authored — every field
 *   traces to something the descriptor already holds, which is why it stays true when the package
 *   changes and why it needs no mapping layer to maintain.
 *
 *   THREE PLACES THE SPEC'S CLOSED ENUMS DO NOT FIT, handled the same way each time: state it under
 *   `x-aimeat` rather than bend a field to nearly mean it.
 *   - `dataAccess[].format` is `TOON|JSON|XML|CSV|Excel|zip|plain text|GraphQL|MCP`. CSV is on it, so
 *     today's canonical form declares itself honestly. Parquet is not, and when Parquet arrives it
 *     goes in the extension block rather than being called `zip`.
 *   - `specification` is `OAS|RAML|Slate|MCP`. A plain file has no API specification, so the field is
 *     simply absent rather than filled with the closest wrong answer.
 *   - `updateFrequency` IS in the SLA dimension enum, and it is filled from the producer's cron —
 *     recorded, not described. A package nobody schedules gets no SLA block at all: an unstated
 *     service level is an absent one, never a promise of daily.
 *
 *   WHO READS IT is the version's audience (./audience.ts), passed in by the caller at read time. ODPS
 *   v4.1 `details.visibility` takes private|invitation|organisation|dataspace|public; public maps to
 *   public, members (every account of this node) to dataspace, organism:<id> to organisation and
 *   private to private, and the AIMEAT audience itself is stated under `x-aimeat.audience`.
 *   `authenticationMethod` is 'none' only for a public package and 'Token' (an AIMEAT bearer token)
 *   for the others.
 * @structure descriptorToOdps · odpsVisibilityOf
 * @usage const doc = descriptorToOdps({ descriptor, ownerGhii, baseUrl, resourceUrls, audience });
 * @version-history
 *   v1.4.0 -- 2026-11-01 -- `details` carries one block per language the package states its title and
 *     description in; the licence's definition names the licence, its deed and the attribution, and
 *     x-aimeat.license states them as fields (WP10e A2, A3).
 *   v1.3.1 -- 2026-11-01 -- The pricingPlans comment says the sheet's reader fills it from a listing (plan D5.1).
 *   v1.3.0 -- 2026-11-01 -- The SLA cadence is the freshness promise (a data product's schedule wins over
 *     the producer's), and x-aimeat.freshness states the package's state now (plan doc-mvwxcas3dom3, D6.1).
 *   v1.2.0 -- 2026-11-01 -- `dataHolder` from the owner's stated company (./data-holder.ts) and a
 *     `pricingPlans` slot an offering fills; absent stays absent (plan doc-mvwxcas3dom3, D1.2).
 *   v1.1.0 -- 2026-11-01 -- The sheet states the version's real audience (`audience`): visibility,
 *     authenticationMethod and the access descriptions follow it, and x-aimeat.audience names it. It
 *     said public and "No authentication" for every package (plan doc-mvwxcas3dom3, D0.1). odpsYamlKey
 *     went with the stored sheet: a publish writes none (./odps-read.ts).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1: "the package is sellable").
 */
import { stringify as yamlStringify } from 'yaml';
import { ODPS_VERSION, ODPS_SCHEMA_URL_YAML } from '../exchange-odps.js';
import { bare, type Descriptor } from './contract.js';
import { freshnessBrief, type Freshness } from './freshness.js';
import { licenceFacts, licenceUrlOf } from './licences.js';

/**
 * A cron expression as an ODPS `updateFrequency` objective.
 *
 * Deliberately coarse: the SLA dimension takes a number and a unit, and a cron says more than that
 * shape can hold. What a buyer needs from it is the ORDER OF MAGNITUDE — is this refreshed daily or
 * quarterly — and an expression it cannot express is answered with null rather than a rounded
 * fiction. `unit: 'never'` is the enum's own word for "no cadence", which is not the same as a
 * cadence nobody stated.
 */
function updateFrequencyFrom(cron: string | undefined): { objective: number; unit: 'days' | 'weeks' | 'months' } | null {
    if (!cron) return null;
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [, , dom, month, dow] = parts;
    if (month !== '*') return { objective: 1, unit: 'months' };
    if (dom !== '*') return { objective: 1, unit: 'months' };
    if (dow !== '*') {
        // A single weekday is weekly; a list of them is more often than that, and "days" is the
        // honest floor rather than a fraction of a week.
        return /^[0-7]$/.test(dow) ? { objective: 1, unit: 'weeks' } : { objective: 1, unit: 'days' };
    }
    return { objective: 1, unit: 'days' };
}

export interface OdpsProjectionInput {
    descriptor: Descriptor;
    ownerGhii: string;
    baseUrl: string;
    /** The permanent, session-free URL of each resource's CSV, keyed by resource name. */
    resourceUrls: Record<string, string>;
    descriptorUrl: string;
    /** ISO 639-1 language the `details` block is keyed by. v4.1 requires the map. */
    lang?: string;
    /** Who reads this version (./audience.ts): public, members, organism:<id> or private. Default public. */
    audience?: string;
    /** The legal entity behind the package, when the owner stated one (./data-holder.ts). Absent: no block. */
    dataHolder?: Record<string, string> | null;
    /**
     * ODPS `pricingPlans`, when an EXCHANGE offering sells this package (./odps-read.ts fills it from the
     * listing). A sheet without plans says nothing is charged rather than inventing a plan.
     */
    pricingPlans?: Record<string, unknown> | null;
    /**
     * The package's freshness against its producer's promise (./freshness.ts). Its promise is the SLA's
     * cadence (a data product's schedule wins over the producer's), and its state is stated in x-aimeat.
     */
    freshness?: Freshness | null;
}

/** ODPS v4.1 `details.visibility` for an AIMEAT audience. */
export function odpsVisibilityOf(audience: string): 'public' | 'dataspace' | 'organisation' | 'private' {
    if (audience === 'public') return 'public';
    if (audience === 'members') return 'dataspace';
    return audience.startsWith('organism:') ? 'organisation' : 'private';
}

/** Who reads a non-public version, in words for the access descriptions. */
function readersOf(audience: string): string {
    if (audience === 'members') return 'every signed-in account of this node';
    if (audience.startsWith('organism:')) return 'the active members of one organism';
    return 'the owner, and the agents and apps the owner gave storage:read';
}

/**
 * Project one published version into an ODPS v4.1 document.
 *
 * Everything traces to the descriptor. `status` is 'production' because a published version at a
 * permanent immutable address is exactly that — a draft is a thing that has not been published, and
 * this function only ever sees published ones.
 */
export function descriptorToOdps(input: OdpsProjectionInput): Record<string, unknown> {
    const { descriptor: d, resourceUrls, descriptorUrl } = input;
    const lang = input.lang ?? 'en';
    const a = d.aimeat;
    const audience = input.audience ?? 'public';
    const open = audience === 'public';
    const authenticationMethod = open ? 'none' : 'Token';
    const tokenNote = open ? '' : ` Readable by ${readersOf(audience)}: send an AIMEAT bearer token (Authorization: Bearer) of an account or agent the package admits.`;

    const columns = d.resources.flatMap(r => r.schema.fields.map(f => `${r.name}.${f.name} (${f.type})`));
    const rowTotal = d.resources.reduce((n, r) => n + r.rowCount, 0);

    const details: Record<string, unknown> = {
        name: d.title ?? d.name,
        productID: a.packageId,
        // v4.1 `type`: this is a dataset delivered as files, which is what 'dataset' means here.
        type: 'dataset',
        status: 'production',
        visibility: odpsVisibilityOf(audience),
        version: bare(a.contentHash).slice(0, 12),
        description: d.description
            ?? `${rowTotal} rows across ${d.resources.length} resource(s), as a Frictionless Data Package.`,
        // The change note is the version's own explanation, and ODPS has a field that means exactly
        // that. It is required on every AIMEAT version, so this is never empty.
        versionNotes: a.changes,
        // The columns, from the ONE place they are declared. A buyer reading the sheet knows the
        // shape before contracting, and this line cannot drift from the data.
        tags: ['frictionless', 'data-package', d.name],
        outputFileFormats: ['CSV'],
        ...(a.sources?.length ? {
            recommendedDataProducts: a.sources.filter(s => s.url).map(s => s.url as string),
        } : {}),
        // A free sample without a separate artefact: the first resource IS the file, readable by the
        // package's audience. Nobody buys data blind, and here they do not have to.
        ...(Object.values(resourceUrls)[0] ? { contentSample: Object.values(resourceUrls)[0] } : {}),
    };

    const dataAccess: Record<string, unknown> = {
        default: {
            name: { [lang]: 'Permanent file address' },
            description: {
                [lang]: (open
                    ? 'The resource CSV at a permanent, immutable URL. No authentication, no API key, '
                    : 'The resource CSV at a permanent, immutable URL. No API key, ')
                    + 'byte ranges supported. The version is the content hash in the path, so this address '
                    + 'can never answer with different bytes.' + tokenNote,
            },
            outputPortType: 'file',
            format: 'CSV',
            authenticationMethod,
            accessURL: Object.values(resourceUrls)[0] ?? descriptorUrl,
            documentationURL: descriptorUrl,
            hashType: 'SHA-256',
            checksum: bare(d.resources[0]?.hash ?? a.contentHash),
        },
        descriptor: {
            name: { [lang]: 'Frictionless descriptor' },
            description: {
                [lang]: 'datapackage.json with a Table Schema per resource. frictionless-py, R and the JS '
                    + 'client resolve the resources from it with no AIMEAT knowledge.' + tokenNote,
            },
            outputPortType: 'file',
            format: 'JSON',
            authenticationMethod,
            accessURL: descriptorUrl,
            documentationURL: descriptorUrl,
        },
    };

    // The promise the freshness was computed against: a data product's schedule, else the producer's.
    const promised = input.freshness?.promise?.cron ?? a.producer.schedule;
    const promisedBy = input.freshness?.promise?.source === 'dataproduct' ? 'dataproduct' : a.producer.kind;
    const freq = updateFrequencyFrom(promised);
    const sla = freq
        ? {
            declarative: [{
                name: { [lang]: 'Producer cadence' },
                description: {
                    [lang]: `Refreshed by a ${promisedBy} producer on the schedule "${promised}". `
                        + 'A run that fails writes no version: the package stays on its previous one and the '
                        + 'failure is recorded on the package pointer.',
                },
                dimensions: [{
                    dimension: 'updateFrequency',
                    objective: String(freq.objective),
                    unit: freq.unit,
                }],
            }],
        }
        : null;

    // ODPS keys `details` by language: the package's own words per language take that language's block,
    // and a field a language does not state keeps the base value.
    const allDetails: Record<string, Record<string, unknown>> = { [lang]: details };
    for (const [l, w] of Object.entries(a.i18n ?? {})) {
        if (!/^[a-z]{2}$/.test(l) || (!w.title && !w.description)) continue;
        allDetails[l] = { ...(allDetails[l] ?? details), ...(w.title ? { name: w.title } : {}), ...(w.description ? { description: w.description } : {}) };
    }
    const licence = a.license ? licenceFacts(a.license) : null;
    const licenceUrl = a.license ? licenceUrlOf(a.license) : undefined;

    return {
        schema: ODPS_SCHEMA_URL_YAML,
        version: ODPS_VERSION,
        product: {
            details: allDetails,
            dataAccess,
            ...(input.pricingPlans ? { pricingPlans: input.pricingPlans } : {}),
            // ODPS License `scope.definition` is one text: the licence's name and deed, and who to credit.
            ...(a.license ? { license: { scope: { definition: [
                licence ? licence.names.en : a.license,
                licenceUrl && licenceUrl !== a.license ? `(${licenceUrl})` : '',
                a.attribution ? `Attribution: ${a.attribution}` : '',
            ].filter(Boolean).join(' ') } } } : {}),
            ...(input.dataHolder ? { dataHolder: input.dataHolder } : {}),
            ...(sla ? { SLA: sla } : {}),
            // Everything the closed enums cannot hold, stated rather than bent into a near-fit.
            'x-aimeat': {
                packageId: a.packageId,
                contentHash: a.contentHash,
                descriptorUrl,
                profile: 'aimeat.datapackage/v1',
                // The AIMEAT audience the ODPS visibility enum can only approximate.
                audience,
                schemaSource: a.schemaSource,
                producer: a.producer,
                // Fresh, late, stale or unscheduled now, against the promise above (./freshness.ts).
                ...(input.freshness ? { freshness: freshnessBrief(input.freshness) } : {}),
                producedBy: a.producedBy,
                resources: d.resources.map(r => ({
                    name: r.name, rowCount: r.rowCount, bytes: r.bytes, hash: r.hash,
                    url: resourceUrls[r.name] ?? null,
                    fields: r.schema.fields.map(f => ({ name: f.name, type: f.type })),
                })),
                columns,
                // The licence id, its deed and the attribution as fields, beside the one text above.
                ...(a.license ? { license: { id: a.license, ...(licenceUrl ? { url: licenceUrl } : {}),
                    ...(a.attribution ? { attribution: a.attribution } : {}) } } : {}),
                ...(a.legalBasis ? { legalBasis: a.legalBasis } : {}),
                ...(a.consentStatus ? { consentStatus: a.consentStatus } : {}),
                ...(a.retention ? { retention: a.retention } : {}),
                ...(a.retentionPolicy ? { retentionPolicy: a.retentionPolicy } : {}),
                ...(a.lineage?.length ? { lineage: a.lineage } : {}),
                ...(a.transformations?.length ? { transformations: a.transformations } : {}),
                ...(a.supersedes ? { supersedes: a.supersedes } : {}),
                ...(a.aiProvenanceId ? { aiProvenanceId: a.aiProvenanceId } : {}),
            },
        },
    };
}

/** The generated sheet as YAML — the format ODPS leads with. */
export function odpsToYamlDocument(doc: Record<string, unknown>): string {
    return yamlStringify(doc, { lineWidth: 0 });
}
